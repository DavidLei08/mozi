'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const zlib = require('node:zlib')
const { send } = require('../src/main/http')

function listen (handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

test('GET returns text body, status, headers and timings', async () => {
  const { server, base } = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('hello world')
  })
  try {
    const res = await send({ method: 'GET', url: `${base}/hello` })
    assert.equal(res.status, 200)
    assert.equal(res.text, 'hello world')
    assert.equal(res.bodyKind, 'text')
    assert.ok(res.timings.total >= 0)
    assert.ok(res.timings.ttfb >= 0)
    assert.equal(res.size, 11)
  } finally { server.close() }
})

test('headers arrive as [key, value] pairs, matching the renderer', async () => {
  const { server, base } = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      auth: req.headers.authorization,
      custom: req.headers['x-test'],
      accept: req.headers.accept
    }))
  })
  try {
    // effectiveHeaders() in the renderer returns resolved headers as [key, value]
    // tuples — the exact shape that previously dropped every header.
    const res = await send({
      method: 'GET',
      url: `${base}/echo`,
      headers: [
        ['Authorization', 'Bearer sk-abc123'],
        ['X-Test', 'pair-form'],
        ['Accept', 'application/json']
      ]
    })
    assert.equal(res.status, 200)
    const parsed = JSON.parse(res.text)
    assert.equal(parsed.auth, 'Bearer sk-abc123')
    assert.equal(parsed.custom, 'pair-form')
    assert.equal(parsed.accept, 'application/json')
  } finally { server.close() }
})

test('POST sends JSON body and headers', async () => {
  const { server, base } = await listen(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ method: req.method, contentType: req.headers['content-type'], body: JSON.parse(body), custom: req.headers['x-test'] }))
  })
  try {
    const res = await send({
      method: 'POST',
      url: `${base}/echo`,
      headers: [{ key: 'X-Test', value: 'yes', enabled: true }],
      body: { type: 'json', text: '{"a":1}' }
    })
    assert.equal(res.status, 201)
    const parsed = JSON.parse(res.text)
    assert.equal(parsed.method, 'POST')
    assert.equal(parsed.contentType, 'application/json')
    assert.deepEqual(parsed.body, { a: 1 })
    assert.equal(parsed.custom, 'yes')
  } finally { server.close() }
})

test('follows redirects and reports the chain', async () => {
  const { server, base } = await listen((req, res) => {
    if (req.url === '/a') {
      res.writeHead(302, { Location: '/b' })
      res.end()
    } else if (req.url === '/b') {
      res.writeHead(301, { Location: '/c' })
      res.end()
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('done')
    }
  })
  try {
    const res = await send({ method: 'GET', url: `${base}/a`, options: { followRedirects: true } })
    assert.equal(res.status, 200)
    assert.equal(res.text, 'done')
    assert.equal(res.redirects.length, 2)
    assert.equal(res.finalUrl, `${base}/c`)
  } finally { server.close() }
})

test('does not follow redirects when disabled', async () => {
  const { server, base } = await listen((req, res) => {
    res.writeHead(302, { Location: '/other' })
    res.end()
  })
  try {
    const res = await send({ method: 'GET', url: `${base}/a`, options: { followRedirects: false } })
    assert.equal(res.status, 302)
    assert.equal(res.redirects.length, 0)
  } finally { server.close() }
})

test('decodes gzip response bodies', async () => {
  const { server, base } = await listen((req, res) => {
    const payload = zlib.gzipSync(Buffer.from('compressed payload'))
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' })
    res.end(payload)
  })
  try {
    const res = await send({ method: 'GET', url: `${base}/gzip` })
    assert.equal(res.text, 'compressed payload')
  } finally { server.close() }
})

test('marks binary bodies with base64', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
  const { server, base } = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(bytes)
  })
  try {
    const res = await send({ method: 'GET', url: `${base}/img` })
    assert.equal(res.bodyKind, 'binary')
    assert.equal(res.base64, bytes.toString('base64'))
    assert.equal(res.text, undefined)
  } finally { server.close() }
})

test('reports HTTP error statuses without throwing', async () => {
  const { server, base } = await listen((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end('{"error":"boom"}')
  })
  try {
    const res = await send({ method: 'GET', url: `${base}/fail` })
    assert.equal(res.status, 500)
    assert.equal(res.error, undefined)
    assert.equal(JSON.parse(res.text).error, 'boom')
  } finally { server.close() }
})

test('flags truncation when the body exceeds the limit', async () => {
  const { server, base } = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('x'.repeat(4096))
  })
  try {
    const res = await send({ method: 'GET', url: `${base}/big`, options: { maxResponseBytes: 512 } })
    assert.equal(res.truncated, true)
    assert.ok(res.size >= 512)
  } finally { server.close() }
})

test('connection errors surface as an error message', async () => {
  const res = await send({ method: 'GET', url: 'http://127.0.0.1:1/nope', options: { timeoutMs: 500 } })
  assert.ok(res.error)
  assert.match(res.error, /refused|reset|timed out/i)
})

test('rejects non-http protocols', async () => {
  const res = await send({ method: 'GET', url: 'ftp://example.com/file' })
  assert.match(res.error, /Only http/)
})
