'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const sse = require('../src/main/sse')

function collectSse (server, payload) {
  return new Promise((resolve, reject) => {
    const events = []
    const timer = setTimeout(() => reject(new Error('timed out waiting for SSE events')), 4000)
    const handle = sse.open(payload, (ev) => {
      events.push(ev)
      if (ev.kind === 'close') {
        clearTimeout(timer)
        resolve(events)
      }
    })
    setTimeout(() => { try { handle.close() } catch { /* ignore */ } }, 3000)
  })
}

test('parses event-stream messages with event/id/data fields', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.accept, 'text/event-stream')
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': keepalive\n\n')
    res.write('event: greet\nid: 7\ndata: hello\n\n')
    res.write('data: line1\ndata: line2\n\n')
    setTimeout(() => res.end(), 60)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/events`
  try {
    const events = await collectSse(server, { id: 'a', url })
    const kinds = events.map((e) => e.kind)
    assert.ok(kinds.includes('open'))
    assert.ok(kinds.includes('close'))

    const greet = events.find((e) => e.event === 'greet')
    assert.equal(greet.data, 'hello')
    assert.equal(greet.lastEventId, '7')

    const multi = events.find((e) => e.event === 'message' && e.data === 'line1\nline2')
    assert.ok(multi, 'multiline data is joined with newlines')
  } finally { server.close() }
})

test('reports a non-event-stream content type as a warning', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('nope')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const events = await collectSse(server, { id: 'b', url: `http://127.0.0.1:${server.address().port}/events` })
    assert.ok(events.some((e) => e.kind === 'warn' && /text\/plain/.test(e.message)))
  } finally { server.close() }
})

test('surfaces HTTP errors', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    res.end('down')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const events = await collectSse(server, { id: 'c', url: `http://127.0.0.1:${server.address().port}/events` })
    assert.ok(events.some((e) => e.kind === 'error' && /503/.test(e.message)))
  } finally { server.close() }
})
