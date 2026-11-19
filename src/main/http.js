'use strict'

const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs/promises')
const zlib = require('node:zlib')
const { Transform, Writable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const pending = new Map()
const { URL } = require('node:url')
const { Jar } = require('../renderer/lib/cookies.js')

const MAX_RESPONSE_BYTES = 30 * 1024 * 1024
const MAX_REDIRECTS = 10

const TEXTUAL = /^(text\/|application\/(json|.*\+json|xml|.*\+xml|javascript|x-www-form-urlencoded|graphql|x-ndjson|yaml)|image\/svg)/i

function normalizeHeaders (headers) {
  const out = {}
  if (!headers) return out
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (!h || h.enabled === false) continue
      // The renderer sends resolved headers as [key, value] pairs; tests and
      // callers may send { key, value }. Accept both so no header is dropped.
      let key
      let value
      if (Array.isArray(h)) {
        key = h[0]
        value = h[1]
      } else {
        key = h.key
        value = h.value
      }
      key = String(key ?? '').trim()
      if (!key) continue
      out[key] = String(value ?? '')
    }
    return out
  }
  for (const [k, v] of Object.entries(headers)) out[k] = String(v)
  return out
}

function hasHeader (headers, name) {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

function multipart (fields, boundary) {
  const parts = []
  for (const f of fields) {
    if (!f || f.enabled === false) continue
    const name = String(f.key ?? '')
    if (!name) continue
    if (f.type === 'file' && f.path) {
      parts.push({
        kind: 'file',
        head: Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${escapeName(name)}"; filename="${escapeName(f.fileName || 'file')}"\r\n` +
          `Content-Type: ${f.contentType || 'application/octet-stream'}\r\n\r\n`
        ),
        path: f.path
      })
    } else {
      parts.push({
        kind: 'text',
        data: Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${escapeName(name)}"\r\n\r\n` +
          `${f.value ?? ''}\r\n`
        )
      })
    }
  }
  parts.push({ kind: 'text', data: Buffer.from(`--${boundary}--\r\n`) })
  return parts
}

function escapeName (s) {
  return String(s).replace(/[\r\n"]/g, (c) => encodeURIComponent(c))
}

async function buildBody (body, signal) {
  if (!body || body.type === 'none') return { buffer: null, headers: {} }
  const headers = {}
  switch (body.type) {
    case 'json': {
      headers['Content-Type'] = 'application/json'
      return { buffer: Buffer.from(body.text ?? '', 'utf8'), headers }
    }
    case 'text': {
      if (body.contentType) headers['Content-Type'] = body.contentType
      return { buffer: Buffer.from(body.text ?? '', 'utf8'), headers }
    }
    case 'graphql': {
      headers['Content-Type'] = 'application/json'
      const g = body.graphql || {}
      let variables = {}
      if (g.variables && String(g.variables).trim()) {
        variables = JSON.parse(g.variables)
      }
      const payload = { query: g.query || '', variables, operationName: g.operationName || undefined }
      if (!payload.operationName) delete payload.operationName
      return { buffer: Buffer.from(JSON.stringify(payload), 'utf8'), headers }
    }
    case 'form-urlencoded': {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      const pairs = (body.formUrlencoded || [])
        .filter((f) => f && f.enabled !== false && f.key)
        .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value ?? '')}`)
      return { buffer: Buffer.from(pairs.join('&'), 'utf8'), headers }
    }
    case 'form-data': {
      const boundary = `----PostLiteBoundary${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`
      const parts = multipart(body.formData || [], boundary)
      const chunks = []
      for (const p of parts) {
        if (p.kind === 'file') chunks.push(p.head, await fs.readFile(p.path, { signal }), Buffer.from('\r\n'))
        else chunks.push(p.data)
      }
      return { buffer: Buffer.concat(chunks), headers }
    }
    case 'binary': {
      if (!body.filePath) return { buffer: null, headers: {} }
      headers['Content-Type'] = body.contentType || 'application/octet-stream'
      return { buffer: await fs.readFile(body.filePath, { signal }), headers }
    }
    default:
      return { buffer: Buffer.from(body.text ?? '', 'utf8'), headers }
  }
}

function once (url, opts, bodyBuffer, signal) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    const mod = isHttps ? https : http
    const started = Date.now()
    const request = mod.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: opts.method,
      headers: opts.headers,
      rejectUnauthorized: !opts.insecure,
      servername: isHttps ? url.hostname : undefined,
      signal
    })

    let ttfb = null
    request.on('response', (res) => {
      ttfb = Date.now() - started
      resolve({ request, response: res, ttfb, started })
    })
    request.on('error', (err) => reject(err))
    if (bodyBuffer) request.write(bodyBuffer)
    request.end()
  })
}

async function collect (res, maxBytes, signal) {
  const chunks = []
  let size = 0
  let decodedSize = 0
  const limit = new Error('Response size limit reached')
  const wire = new Transform({
    transform (chunk, encoding, cb) {
      size += chunk.length
      cb(size > maxBytes ? limit : null, size > maxBytes ? undefined : chunk)
    }
  })
  const sink = new Writable({
    write (chunk, encoding, cb) {
      const remaining = maxBytes - decodedSize
      const part = chunk.subarray(0, remaining)
      chunks.push(part)
      decodedSize += part.length
      cb(chunk.length > remaining ? limit : null)
    }
  })
  const noBody = res.req?.method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304
  const encoding = noBody ? '' : String(res.headers['content-encoding'] || '').trim().toLowerCase()
  const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip()
    : encoding === 'br' ? zlib.createBrotliDecompress()
      : encoding === 'deflate' ? zlib.createInflate() : null
  // For uncompressed bodies the sink retains the exact prefix up to the limit.
  const streams = decoder ? [res, wire, decoder, sink] : [res, new Transform({
    transform (chunk, encoding, cb) { size += chunk.length; cb(null, chunk) }
  }), sink]
  let truncated = false
  try { await pipeline(...streams, { signal }) } catch (err) {
    if (err !== limit) throw err
    truncated = true
  }
  return { decoded: Buffer.concat(chunks), size, truncated }
}

function removeHeaders (headers, names) {
  for (const key of Object.keys(headers)) if (names.includes(key.toLowerCase())) delete headers[key]
}

function cancel (id) {
  const controller = pending.get(id)
  if (controller) controller.abort(new Error('Request cancelled'))
  return { ok: !!controller }
}

function cancelAll () {
  for (const id of pending.keys()) cancel(id)
}

function shouldRedirect (status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function redirectMethod (status, method) {
  if (status === 303) return method === 'HEAD' ? 'HEAD' : 'GET'
  if ((status === 301 || status === 302) && method === 'POST') return 'GET'
  return method
}

async function send (payload) {
  const startedAt = Date.now()
  const opts = payload.options || {}
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120000
  const maxResponseBytes = Number(opts.maxResponseBytes) > 0 ? Number(opts.maxResponseBytes) : MAX_RESPONSE_BYTES
  if (payload.id && pending.has(payload.id)) return { error: 'Request already in progress' }
  const controller = new AbortController()
  if (payload.id) pending.set(payload.id, controller)
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
  const cookieUpdates = []
  try {
    let current
    try {
      current = new URL(String(payload.url || ''))
      if (!/^https?:$/.test(current.protocol)) throw new Error('Only http:// and https:// URLs are supported')
    } catch (err) { throw new Error(`Invalid URL: ${err.message}`) }
    const headers = normalizeHeaders(payload.headers)
    if (!hasHeader(headers, 'accept-encoding')) headers['Accept-Encoding'] = 'gzip, deflate, br'
    const jar = new Jar(Array.isArray(payload.cookies) ? payload.cookies.map((c) => ({ ...c })) : [])
    const built = await buildBody(payload.body, controller.signal)
    let buffer = built.buffer
    for (const [k, v] of Object.entries(built.headers)) if (!hasHeader(headers, k)) headers[k] = v
    if (payload.body?.type === 'form-data') {
      removeHeaders(headers, ['content-type'])
      headers['Content-Type'] = built.headers['Content-Type']
    }
    const redirects = []
    let method = String(payload.method || 'GET').toUpperCase()
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      controller.signal.throwIfAborted()
      const hopHeaders = { ...headers }
      if (!hasHeader(hopHeaders, 'cookie')) {
        const value = jar.headerValue(current.href)
        if (value) hopHeaders.Cookie = value
      }
      const { request, response, ttfb } = await once(current, { method, headers: hopHeaders, insecure: !!opts.insecure }, buffer, controller.signal)
      const setCookies = Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'] : []
      for (const value of setCookies) {
        jar.store(value, current.href)
        cookieUpdates.push({ value, url: current.href })
      }
      if (opts.followRedirects !== false && shouldRedirect(response.statusCode) && response.headers.location) {
        response.resume()
        request.destroy()
        const next = new URL(response.headers.location, current)
        if (!/^https?:$/.test(next.protocol)) throw new Error('Only http:// and https:// redirect URLs are supported')
        if (current.origin !== next.origin) removeHeaders(headers, ['authorization', 'proxy-authorization', 'cookie', 'host'])
        redirects.push({ status: response.statusCode, url: next.href })
        const nextMethod = redirectMethod(response.statusCode, method)
        if (nextMethod === 'GET' && (nextMethod !== method || response.statusCode === 303)) {
          buffer = null
          removeHeaders(headers, ['content-type', 'content-length', 'transfer-encoding'])
        }
        method = nextMethod
        current = next
        continue
      }
      const { decoded, size, truncated } = await collect(response, maxResponseBytes, controller.signal)
      const contentType = String(response.headers['content-type'] || '')
      const textual = TEXTUAL.test(contentType) || (!contentType && isProbablyText(decoded))
      return {
        status: response.statusCode, statusText: response.statusMessage || '',
        httpVersion: response.httpVersion, headers: flattenHeaders(response.headers),
        contentType, setCookies, cookieUpdates, finalUrl: current.href, redirects, size, truncated,
        bodyKind: textual ? 'text' : 'binary',
        text: textual ? decoded.toString('utf8') : undefined,
        base64: textual ? undefined : decoded.toString('base64'),
        timings: { start: startedAt, ttfb, total: Date.now() - startedAt }
      }
    }
    throw new Error(`Too many redirects (>${MAX_REDIRECTS})`)
  } catch (err) {
    return {
      error: describeError(controller.signal.aborted ? controller.signal.reason : err),
      cookieUpdates, timings: { total: Date.now() - startedAt }
    }
  } finally {
    clearTimeout(timer)
    if (payload.id && pending.get(payload.id) === controller) pending.delete(payload.id)
  }
}

function isProbablyText (buf) {
  const n = Math.min(buf.length, 512)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false
  return true
}

function flattenHeaders (headers) {
  const out = []
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) for (const item of v) out.push([k, String(item)])
    else out.push([k, String(v)])
  }
  return out
}

function describeError (err) {
  if (!err) return 'Unknown error'
  if (err.code === 'ENOTFOUND') return `DNS lookup failed (${err.hostname || 'host not found'})`
  if (err.code === 'ECONNREFUSED') return 'Connection refused'
  if (err.code === 'ECONNRESET') return 'Connection reset by peer'
  if (err.code === 'ETIMEDOUT' || err.code === 'UND_ERR_CONNECT_TIMEOUT') return 'Connection timed out'
  if (err.code === 'CERT_HAS_EXPIRED') return 'TLS certificate has expired (enable "Allow insecure TLS" to bypass)'
  if (/certificate|self.signed|unable to verify/i.test(err.message || '')) {
    return `${err.message} — enable "Allow insecure TLS" to bypass certificate checks`
  }
  if (err.name === 'AbortError') return err.message || 'Request aborted'
  return err.message || String(err)
}

module.exports = { send, cancel, cancelAll, normalizeHeaders, describeError }
