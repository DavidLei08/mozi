'use strict'

const http = require('node:http')
const https = require('node:https')
const { URL } = require('node:url')
const { describeError } = require('./http')

const MAX_BUFFER = 4 * 1024 * 1024

/**
 * Opens a text/event-stream connection and dispatches parsed events.
 */
function open (payload, emit) {
  const id = payload.id
  let closed = false
  let request = null
  let response = null

  let buffer = ''
  let lastEventId = ''
  let retry = null
  let eventName = ''
  let dataLines = []

  const finishEvent = () => {
    if (dataLines.length === 0 && !eventName && !lastEventId) return
    const data = dataLines.join('\n')
    emit({ id, kind: 'event', event: eventName || 'message', data, lastEventId, retry, ts: Date.now() })
    dataLines = []
    eventName = ''
  }

  const flushLines = () => {
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line === '') { finishEvent(); continue }
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      switch (field) {
        case 'event': eventName = value; break
        case 'data': dataLines.push(value); break
        case 'id': if (!value.includes('\0')) lastEventId = value; break
        case 'retry': if (/^\d+$/.test(value)) retry = Number(value); break
        default: break
      }
    }
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER)
  }

  const close = () => {
    if (closed) return
    closed = true
    try { if (response) response.destroy() } catch { /* ignore */ }
    try { if (request) request.destroy() } catch { /* ignore */ }
    emit({ id, kind: 'close', ts: Date.now() })
  }

  let url
  try {
    url = new URL(String(payload.url || ''))
    if (!/^https?:$/.test(url.protocol)) throw new Error('Only http:// and https:// URLs are supported')
  } catch (err) {
    emit({ id, kind: 'error', message: `Invalid URL: ${err.message}`, ts: Date.now() })
    return { close: () => {} }
  }

  const headers = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' }
  if (payload.lastEventId) headers['Last-Event-ID'] = payload.lastEventId
  for (const [k, v] of Object.entries(payload.headers || {})) headers[k] = String(v)

  const bodyBuffer = payload.body ? Buffer.from(String(payload.body), 'utf8') : null
  if (bodyBuffer) headers['Content-Length'] = String(bodyBuffer.length)

  const isHttps = url.protocol === 'https:'
  const mod = isHttps ? https : http

  request = mod.request({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: String(payload.method || 'GET').toUpperCase(),
    headers,
    rejectUnauthorized: !payload.insecure
  })

  request.on('response', (res) => {
    response = res
    if (res.statusCode >= 400) {
      emit({ id, kind: 'error', message: `HTTP ${res.statusCode} ${res.statusMessage || ''}`.trim(), ts: Date.now() })
    }
    const ct = String(res.headers['content-type'] || '')
    if (ct && !/text\/event-stream/i.test(ct)) {
      emit({ id, kind: 'warn', message: `Server sent Content-Type "${ct}" (expected text/event-stream)`, ts: Date.now() })
    }
    emit({
      id,
      kind: 'open',
      status: res.statusCode,
      statusText: res.statusMessage || '',
      method: String(payload.method || 'GET').toUpperCase(),
      headers: Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]),
      ts: Date.now()
    })
    res.setEncoding('utf8')
    res.on('data', (chunk) => { buffer += chunk; flushLines() })
    res.on('end', () => { finishEvent(); emit({ id, kind: 'close', ts: Date.now() }) })
    res.on('error', (err) => emit({ id, kind: 'error', message: describeError(err), ts: Date.now() }))
  })

  request.on('error', (err) => emit({ id, kind: 'error', message: describeError(err), ts: Date.now() }))
  if (bodyBuffer) request.write(bodyBuffer)
  request.end()

  return { close }
}

module.exports = { open }
