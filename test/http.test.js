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

test('multipart files have CRLF before the next boundary, including empty files', async () => {
  const fs = require('node:fs/promises')
  const os = require('node:os')
  const path = require('node:path')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mozi-upload-'))
  await fs.writeFile(path.join(dir, 'one'), 'contents')
  await fs.writeFile(path.join(dir, 'empty'), '')
  const { server, base } = await listen(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const boundary = req.headers['content-type'].split('boundary=')[1]
    const raw = Buffer.concat(chunks).toString()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ valid: raw.includes(`contents\r\n--${boundary}`) && raw.includes(`filename="empty"\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--${boundary}`) }))
  })
  try {
    const res = await send({ url: base, method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: { type: 'form-data', formData: [
      { key: 'one', type: 'file', path: path.join(dir, 'one'), fileName: 'one' },
      { key: 'empty', type: 'file', path: path.join(dir, 'empty'), fileName: 'empty' },
      { key: 'text', value: 'last' }
    ] } })
    assert.equal(JSON.parse(res.text).valid, true)
  } finally { server.close(); await fs.rm(dir, { recursive: true }) }
})

test('cross-origin redirects strip sensitive headers and use destination cookies', async () => {
  const target = await listen((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.headers))
  })
  const source = await listen((req, res) => { res.writeHead(302, { Location: target.base + '/destination' }); res.end() })
  try {
    const result = await send({ url: source.base, headers: { Authorization: 'secret', 'Proxy-Authorization': 'proxy', Cookie: 'manual=secret', 'X-Keep': 'yes' }, cookies: [
      { name: 'dest', value: 'ok', domain: '127.0.0.1', hostOnly: true, path: '/destination', expires: null }
    ] })
    const headers = JSON.parse(result.text)
    assert.equal(headers.authorization, undefined)
    assert.equal(headers['proxy-authorization'], undefined)
    assert.equal(headers.cookie, 'dest=ok')
    assert.equal(headers['x-keep'], 'yes')
    assert.equal(headers.host, new URL(target.base).host)
  } finally { source.server.close(); target.server.close() }
})

test('redirect cookies are collected and applied before the final response', async () => {
  const { server, base } = await listen((req, res) => {
    if (req.url === '/login') { res.writeHead(302, { Location: '/app/me', 'Set-Cookie': 'sid=abc; Path=/app' }); res.end(); return }
    res.setHeader('Content-Type', 'text/plain')
    res.setHeader('Set-Cookie', 'final=yes')
    res.end(req.headers.cookie || '')
  })
  try {
    const result = await send({ url: base + '/login', headers: { Authorization: 'same-origin' } })
    assert.equal(result.text, 'sid=abc')
    assert.deepEqual(result.cookieUpdates.map(c => c.url), [base + '/login', base + '/app/me'])
  } finally { server.close() }
})

test('POST redirect to GET removes body headers while 307 preserves the body', async () => {
  const { server, base } = await listen(async (req, res) => {
    if (req.url !== '/final') { res.writeHead(Number(req.url.slice(1)), { Location: '/final' }); res.end(); return }
    const chunks = []
    for await (const c of req) chunks.push(c)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }))
  })
  try {
    for (const status of [302, 303, 307, 308]) {
      const result = await send({ url: `${base}/${status}`, method: 'POST', headers: { 'Content-Length': '2' }, body: { type: 'json', text: '{}' } })
      const data = JSON.parse(result.text)
      const preserved = status >= 307
      assert.equal(data.method, preserved ? 'POST' : 'GET')
      assert.equal(data.body, preserved ? '{}' : '')
      assert.equal(data.headers['content-type'], preserved ? 'application/json' : undefined)
      assert.equal(data.headers['content-length'], preserved ? '2' : undefined)
    }
  } finally { server.close() }
})

for (const [encoding, compress] of [['gzip', zlib.gzipSync], ['br', zlib.brotliCompressSync], ['deflate', zlib.deflateSync]]) {
  test(`${encoding} decompression respects decoded size limit`, async () => {
    const { server, base } = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': encoding })
      res.end(compress('x'.repeat(100000)))
    })
    try {
      const result = await send({ url: base, options: { maxResponseBytes: 1024 } })
      assert.equal(result.truncated, true)
      assert.equal(result.text, 'x'.repeat(1024))
    } finally { server.close() }
  })
}

test('cancellation and timeout stop in-flight requests with distinct errors', async () => {
  const { cancel } = require('../src/main/http')
  let received
  let arrival = new Promise(resolve => { received = resolve })
  const { server, base } = await listen((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.write('waiting'); received() })
  try {
    const pending = send({ id: 'cancel-test', url: base })
    await arrival
    assert.match((await send({ id: 'cancel-test', url: base })).error, /already/)
    assert.equal(cancel('cancel-test').ok, true)
    assert.match((await pending).error, /cancelled/)
    assert.equal(cancel('cancel-test').ok, false)
    assert.match((await send({ url: base, options: { timeoutMs: 30 } })).error, /timed out/)
  } finally { server.closeAllConnections(); server.close() }
})

test('missing upload files and invalid GraphQL variables return structured errors', async () => {
  const result = await send({ url: 'http://127.0.0.1', body: { type: 'binary', filePath: '/nonexistent/mozi-upload-file' } })
  assert.match(result.error, /ENOENT/)
  const gql = await send({ url: 'http://127.0.0.1', body: { type: 'graphql', graphql: { variables: '{bad' } } })
  assert.ok(gql.error)
})


test('HEAD and bodyless responses do not attempt to decompress empty bodies', async () => {
  const { server, base } = await listen((req, res) => {
    res.writeHead(Number(req.url.slice(1)), { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' })
    res.end()
  })
  try {
    for (const [method, status] of [['HEAD', 200], ['GET', 204], ['GET', 304]]) {
      const result = await send({ url: `${base}/${status}`, method })
      assert.equal(result.status, status)
      assert.equal(result.text, '')
    }
  } finally { server.close() }
})
