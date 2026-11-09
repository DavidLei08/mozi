'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

// curl.js is a browser script that attaches to `window`; give it one.
global.window = {}
require('../src/renderer/lib/curl.js')
const Curl = global.window.Curl

test('parses a simple GET with query params and headers', () => {
  const out = Curl.parse(`curl 'https://api.example.com/v1/items?page=2&q=hi' -H 'Accept: application/json'`)
  assert.equal(out.ok, true)
  assert.equal(out.request.method, 'GET')
  assert.equal(out.request.url, 'https://api.example.com/v1/items')
  assert.deepEqual(out.request.params.map((p) => [p.key, p.value]), [['page', '2'], ['q', 'hi']])
  assert.deepEqual(out.request.headers.map((h) => [h.key, h.value]), [['Accept', 'application/json']])
})

test('parses -X, JSON body and bearer auth', () => {
  const out = Curl.parse(`curl -X PUT 'https://api.example.com/things/1' \\
    -H 'Content-Type: application/json' \\
    -H 'Authorization: Bearer tok123' \\
    -d '{"name":"box"}'`)
  assert.equal(out.ok, true)
  const req = out.request
  assert.equal(req.method, 'PUT')
  assert.equal(req.auth.type, 'bearer')
  assert.equal(req.auth.token, 'tok123')
  assert.equal(req.body.type, 'json')
  assert.deepEqual(JSON.parse(req.body.text), { name: 'box' })
  assert.equal(req.headers.some((h) => /authorization/i.test(h.key)), false, 'auth header is folded into auth')
})

test('infers POST for --data-raw with urlencoded content type', () => {
  const out = Curl.parse(`curl https://api.example.com/login --data-raw 'user=a&pass=b' -H 'Content-Type: application/x-www-form-urlencoded'`)
  assert.equal(out.request.method, 'POST')
  assert.equal(out.request.body.type, 'form-urlencoded')
  assert.deepEqual(out.request.body.formUrlencoded.map((f) => [f.key, f.value]), [['user', 'a'], ['pass', 'b']])
})

test('parses basic auth, insecure flag and redirects flag', () => {
  const out = Curl.parse(`curl -k -L -u 'alice:s3cret' https://self-signed.example.com/api`)
  assert.equal(out.request.auth.type, 'basic')
  assert.equal(out.request.auth.username, 'alice')
  assert.equal(out.request.auth.password, 's3cret')
  assert.equal(out.request.options.insecure, true)
  assert.equal(out.request.options.followRedirects, true)
})

test('parses multipart form data with file uploads', () => {
  const out = Curl.parse(`curl -F 'name=postlite' -F 'avatar=@/tmp/a.png' https://api.example.com/upload`)
  assert.equal(out.request.body.type, 'form-data')
  const [nameField, fileField] = out.request.body.formData
  assert.equal(nameField.key, 'name')
  assert.equal(nameField.value, 'postlite')
  assert.equal(fileField.type, 'file')
  assert.equal(fileField.path, '/tmp/a.png')
})

test('supports single quoted, double quoted and escaped payloads', () => {
  const out = Curl.parse(`curl 'https://x.test' -H "X-A: it's here" -d "{\\"k\\":\\"v\\"}"`)
  assert.equal(out.request.headers[0].value, "it's here")
  assert.equal(out.request.body.text, '{"k":"v"}')
})

test('rejects non-curl input and missing URL', () => {
  assert.equal(Curl.parse('wget https://x.test').ok, false)
  assert.equal(Curl.parse('curl -X POST').ok, false)
})

test('builds a curl command that round-trips through the parser', () => {
  const req = {
    method: 'POST',
    url: 'https://api.example.com/v1/things',
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    body: { type: 'json', text: '{"a":1}', formData: [], formUrlencoded: [] },
    auth: { type: 'none' },
    options: { followRedirects: true, insecure: false }
  }
  const text = Curl.build(req, 'https://api.example.com/v1/things?page=1', [['Accept', 'application/json'], ['Content-Type', 'application/json']], { present: true })
  assert.match(text, /^curl/)
  assert.match(text, /-X POST/)
  assert.match(text, /--data-raw/)
  assert.match(text, /-L/)

  const back = Curl.parse(text.replace(/\\\n\s*/g, ' '))
  assert.equal(back.ok, true)
  assert.equal(back.request.method, 'POST')
  assert.equal(back.request.url, 'https://api.example.com/v1/things')
  assert.equal(back.request.params[0].key, 'page')
})

test('builds multipart and binary curl commands', () => {
  const multipart = Curl.build({
    method: 'POST',
    url: 'https://x.test/up',
    headers: [],
    body: { type: 'form-data', formData: [{ key: 'file', type: 'file', path: '/tmp/a.png', enabled: true }, { key: 'n', type: 'text', value: 'v', enabled: true }], formUrlencoded: [] },
    auth: { type: 'none' },
    options: {}
  }, 'https://x.test/up', [], { present: true })
  assert.match(multipart, /-F 'file=@\/tmp\/a\.png'/)
  assert.match(multipart, /-F 'n=v'/)

  const binary = Curl.build({
    method: 'PUT',
    url: 'https://x.test/blob',
    headers: [],
    body: { type: 'binary', filePath: '/tmp/b.bin', formData: [], formUrlencoded: [] },
    auth: { type: 'none' },
    options: {}
  }, 'https://x.test/blob', [], { present: true })
  assert.match(binary, /--data-binary '@\/tmp\/b\.bin'/)
})
