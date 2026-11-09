'use strict'

const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs/promises')
const zlib = require('node:zlib')
const { URL } = require('node:url')
const { Jar } = require('../renderer/lib/cookies.js')

const MAX_RESPONSE_BYTES = 30 * 1024 * 1024
const MAX_REDIRECTS = 10

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|x-ndjson|yaml)|image\/svg)/i

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
  return String(s).replace(/"/g, '%22')
}

async function buildBody (body) {
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
        try { variables = JSON.parse(g.variables) } catch { variables = { _raw: String(g.variables) } }
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
        if (p.kind === 'file') chunks.push(p.head, await fs.readFile(p.path))
        else chunks.push(p.data)
      }
      return { buffer: Buffer.concat(chunks), headers }
    }
    case 'binary': {
      if (!body.filePath) return { buffer: null, headers: {} }
      headers['Content-Type'] = body.contentType || 'application/octet-stream'
      return { buffer: await fs.readFile(body.filePath), headers }
    }
    default:
      return { buffer: Buffer.from(body.text ?? '', 'utf8'), headers }
  }
}

function decode (buffer, encoding) {
  const enc = String(encoding || '').toLowerCase()
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buffer)
    if (enc === 'deflate') return zlib.inflateSync(buffer)
    if (enc === 'br') return zlib.brotliDecompressSync(buffer)
  } catch { /* leave raw when the body is not actually encoded */ }
  return buffer
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

async function collect (res, maxBytes) {
  const chunks = []
  let size = 0
  let truncated = false
  return new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        truncated = true
        res.destroy()
        if (res.req) res.req.destroy()
        resolve({ chunks, size, truncated })
        return
      }
      chunks.push(chunk)
    })
    res.on('end', () => resolve({ chunks, size, truncated }))
    res.on('error', (err) => (truncated ? resolve({ chunks, size, truncated }) : reject(err)))
  })
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
  const follow = opts.followRedirects !== false
  const maxResponseBytes = Number(opts.maxResponseBytes) > 0 ? Number(opts.maxResponseBytes) : MAX_RESPONSE_BYTES

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)

  let current
  try {
    current = new URL(String(payload.url || ''))
    if (!/^https?:$/.test(current.protocol)) throw new Error('Only http:// and https:// URLs are supported')
  } catch (err) {
    clearTimeout(timer)
    return { error: `Invalid URL: ${err.message}`, timings: { total: Date.now() - startedAt } }
  }

  const headers = normalizeHeaders(payload.headers)
  headers['Accept-Encoding'] = headers['Accept-Encoding'] || 'gzip, deflate, br'
  if (Array.isArray(payload.cookies) && payload.cookies.length && !hasHeader(headers, 'cookie')) {
    try {
      const jarValue = new Jar(payload.cookies).headerValue(current.href)
      if (jarValue) headers.Cookie = jarValue
    } catch { /* malformed jar entries are simply skipped */ }
  }

  const built = await buildBody(payload.body)
  let buffer = built.buffer
  const bodyHeaders = built.headers
  for (const [k, v] of Object.entries(bodyHeaders)) if (!hasHeader(headers, k)) headers[k] = v
  if (buffer && (payload.method === 'GET' || payload.method === 'HEAD')) {
    // GET with a body is unusual; still allow it when explicitly provided.
  }

  const redirects = []
  let method = String(payload.method || 'GET').toUpperCase()

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const { request, response, ttfb } = await once(current, { method, headers, insecure: !!opts.insecure }, buffer, controller.signal)

      if (follow && shouldRedirect(response.statusCode) && response.headers.location) {
        const next = new URL(response.headers.location, current)
        redirects.push({ status: response.statusCode, url: next.href })
        response.resume()
        request.destroy()
        current = next
        const nextMethod = redirectMethod(response.statusCode, method)
        if (nextMethod !== method && (nextMethod === 'GET' || nextMethod === 'HEAD')) buffer = null
        method = nextMethod
        continue
      }

      const { chunks, size, truncated } = await collect(response, maxResponseBytes)
      clearTimeout(timer)

      const raw = Buffer.concat(chunks)
      const decoded = decode(raw, response.headers['content-encoding'])
      const contentType = String(response.headers['content-type'] || '')
      const textual = TEXTUAL.test(contentType) || (!contentType && isProbablyText(decoded))

      return {
        status: response.statusCode,
        statusText: response.statusMessage || '',
        httpVersion: response.httpVersion,
        headers: flattenHeaders(response.headers),
        contentType,
        setCookies: Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'] : [],
        finalUrl: current.href,
        redirects,
        size,
        truncated,
        bodyKind: textual ? 'text' : 'binary',
        text: textual ? decoded.toString('utf8') : undefined,
        base64: textual ? undefined : decoded.toString('base64'),
        timings: {
          start: startedAt,
          ttfb,
          total: Date.now() - startedAt
        }
      }
    }
    clearTimeout(timer)
    return { error: `Too many redirects (>${MAX_REDIRECTS})`, timings: { total: Date.now() - startedAt } }
  } catch (err) {
    clearTimeout(timer)
    return {
      error: describeError(err),
      timings: { total: Date.now() - startedAt }
    }
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

module.exports = { send, normalizeHeaders, describeError }
