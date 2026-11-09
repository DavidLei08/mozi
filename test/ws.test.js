'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { WebSocketServer } = require('ws')
const manager = require('../src/main/ws')

function startEchoServer () {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    wss.on('connection', (socket, req) => {
      socket.send('welcome')
      socket.on('message', (data) => socket.send(`echo:${data}`))
    })
    wss.on('listening', () => resolve({ wss, port: wss.address().port }))
  })
}

function waitFor (events, predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), timeout)
    const check = () => {
      const found = events.find(predicate)
      if (found) { clearTimeout(timer); resolve(found) }
      else setTimeout(check, 25)
    }
    check()
  })
}

test('connects, receives and sends messages, then reports close', async () => {
  const { wss, port } = await startEchoServer()
  const events = []
  try {
    manager.open({ id: 'w1', url: `ws://127.0.0.1:${port}` }, (ev) => events.push(ev))
    const opened = await waitFor(events, (e) => e.kind === 'open')
    assert.equal(opened.status, 101)

    const welcome = await waitFor(events, (e) => e.kind === 'message' && e.data === 'welcome')
    assert.equal(welcome.binary, false)

    const sent = manager.send('w1', 'ping')
    assert.deepEqual(sent, { ok: true })
    const echoed = await waitFor(events, (e) => e.kind === 'message' && e.data === 'echo:ping')
    assert.ok(echoed.data.startsWith('echo:'))

    manager.close('w1', (ev) => events.push(ev))
    await waitFor(events, (e) => e.kind === 'close')
  } finally { wss.close() }
})

test('sending on a closed socket fails cleanly', () => {
  const result = manager.send('missing', 'hello')
  assert.equal(result.ok, false)
  assert.match(result.error, /not open/i)
})

test('connection errors are reported', async () => {
  const events = []
  manager.open({ id: 'w2', url: 'ws://127.0.0.1:1' }, (ev) => events.push(ev))
  const error = await waitFor(events, (e) => e.kind === 'error', 3000)
  assert.ok(error.message)
})
