'use strict'

const { WebSocket } = require('ws')

/** id -> { ws, closed } */
const connections = new Map()

function open (payload, emit) {
  const id = payload.id
  if (connections.has(id)) close(id, emit)

  let ws
  try {
    ws = new WebSocket(String(payload.url || ''), payload.protocols || [], {
      headers: payload.headers || {},
      handshakeTimeout: Number(payload.timeoutMs) > 0 ? Number(payload.timeoutMs) : 15000,
      rejectUnauthorized: !payload.insecure,
      perMessageDeflate: false
    })
  } catch (err) {
    emit({ id, kind: 'error', message: err.message, ts: Date.now() })
    return
  }

  connections.set(id, ws)
  const openedAt = Date.now()

  ws.on('open', () => {
    emit({
      id,
      kind: 'open',
      status: 101,
      statusText: 'Switching Protocols',
      protocol: ws.protocol || '',
      ts: Date.now()
    })
    emit({ id, kind: 'system', message: `Connected in ${Date.now() - openedAt}ms`, ts: Date.now() })
  })

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      emit({ id, kind: 'message', binary: true, base64: Buffer.from(data).toString('base64'), size: data.length, ts: Date.now() })
    } else {
      emit({ id, kind: 'message', binary: false, data: String(data), size: Buffer.byteLength(String(data)), ts: Date.now() })
    }
  })

  ws.on('ping', () => emit({ id, kind: 'system', message: 'ping received', ts: Date.now() }))
  ws.on('pong', () => emit({ id, kind: 'system', message: 'pong received', ts: Date.now() }))

  ws.on('close', (code, reason) => {
    connections.delete(id)
    emit({ id, kind: 'close', code, reason: String(reason || ''), ts: Date.now() })
  })

  ws.on('error', (err) => {
    connections.delete(id)
    emit({ id, kind: 'error', message: err.message || String(err), ts: Date.now() })
  })
}

function send (id, data, isBinary) {
  const ws = connections.get(id)
  if (!ws || ws.readyState !== WebSocket.OPEN) return { ok: false, error: 'Socket is not open' }
  try {
    if (isBinary) ws.send(Buffer.from(data, 'base64'), { binary: true })
    else ws.send(String(data))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function closeAll (emit) {
  for (const id of [...connections.keys()]) close(id, emit)
}

function close (id, emit) {
  const ws = connections.get(id)
  if (!ws) return
  connections.delete(id)
  try { ws.close() } catch { /* ignore */ }
  if (emit) emit({ id, kind: 'close', code: 1000, reason: 'client closed', ts: Date.now() })
}

module.exports = { open, send, close, closeAll }
