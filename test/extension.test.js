'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const vm = require('node:vm')
const { md5, decode, digest } = require('../src/extension/hash')

for (const size of [0, 1, 3, 55, 56, 63, 64, 65, 127, 1024, 1000000]) {
  test(`extension MD5 agrees with Node for ${size} bytes`, () => {
    const data = crypto.randomBytes(size)
    assert.equal(md5(data), crypto.createHash('md5').update(data).digest('hex'))
  })
}
test('extension hash decoding and all SHA digests', async () => {
  assert.equal(new TextDecoder().decode(decode('5L2g5aW9', 'base64')), '你好')
  assert.deepEqual([...decode('00 ff 1a', 'hex')], [0, 255, 26])
  assert.throws(() => decode('1', 'hex'))
  assert.throws(() => decode('zz', 'hex'))
  assert.throws(() => decode('!!!', 'base64'))
  const data = decode('你好 👋', 'utf8')
  const result = await digest(data, ['md5', 'sha1', 'sha256', 'sha512'])
  for (const [algorithm, value] of Object.entries(result.hashes)) {
    assert.equal(value, crypto.createHash(algorithm).update(data).digest('hex'))
  }
})

function bridge () {
  const ctx = vm.createContext({
    window: { addEventListener () {} }, TextEncoder, TextDecoder, Headers, URL, URLSearchParams,
    AbortController, setTimeout, clearTimeout, crypto, Blob, FormData, Uint8Array, atob, btoa,
    fetch: () => { throw new Error('Unexpected network request') }
  })
  vm.runInContext(fs.readFileSync(require.resolve('../src/extension/bridge'), 'utf8'), ctx)
  return ctx.window.api
}
test('extension refuses unsupported requests before touching network', async () => {
  const api = bridge()
  for (const [payload, error] of [
    [{ url: 'https://example.com', options: { insecure: true } }, /TLS/],
    [{ url: 'file:///etc/passwd' }, /URL/],
    [{ url: 'https://example.com', headers: [['Cookie', 'secret=1']] }, /Cookie/],
    [{ url: 'https://example.com', headers: [{ key: 'Host', value: 'other.test' }] }, /Host/],
    [{ url: 'https://example.com', body: { type: 'binary', filePath: 'stale' } }, /重新选择/]
  ]) assert.match((await api.http.send(payload)).error, error)
  const sending = api.ws.send({ id: 'closed', data: 'test' })
  assert.equal(typeof sending.then, 'function')
  assert.equal((await sending).ok, false)
  const events = []
  api.ws.onEvent((e) => events.push(e))
  assert.equal(api.ws.open({ id: '1', url: 'wss://example.com', headers: { Authorization: 'Bearer token' } }).ok, false)
  assert.equal(events[0].kind, 'error')
  assert.match(events[0].message, /握手/)
})
