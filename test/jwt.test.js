'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

global.window = {}
require('../src/renderer/lib/jwt.js')
const J = global.window.Jwt

// ---- helpers: build tokens with pure base64url (no fixtures) ----
function b64url (text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeToken (header, payload, sig = 'sig') {
  return b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload)) + '.' + sig
}

async function hs256Sign (headerB64, payloadB64, secret) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(headerB64 + '.' + payloadB64))
  let bin = ''
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function makeSigned (header, payload, secret) {
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  return h + '.' + p + '.' + await hs256Sign(h, p, secret)
}

const NOW = Math.floor(Date.now() / 1000)

test('decode standard token', () => {
  const r = J.decode(makeToken({ alg: 'HS256', typ: 'JWT' }, { sub: 'alice', exp: NOW + 3600 }))
  assert.equal(r.ok, true)
  assert.equal(r.alg, 'HS256')
  assert.equal(r.typ, 'JWT')
  assert.equal(r.payload.sub, 'alice')
  assert.equal(r.signature, 'sig')
})

test('decode chinese + emoji payload without mojibake', () => {
  const r = J.decode(makeToken({ alg: 'HS256' }, { name: '张三', note: '你好世界 😀' }))
  assert.equal(r.ok, true)
  assert.equal(r.payload.name, '张三')
  assert.equal(r.payload.note, '你好世界 😀')
  assert.ok(r.payloadText.includes('张三'))
})

test('claims extraction with missing fields as undefined', () => {
  const r = J.decode(makeToken({ alg: 'HS256' }, { iss: 'mozi', aud: ['a', 'b'], custom: 1 }))
  assert.equal(r.ok, true)
  assert.equal(r.claims.iss, 'mozi')
  assert.deepEqual(r.claims.aud, ['a', 'b'])
  assert.equal(r.claims.sub, undefined)
  assert.equal(r.claims.exp, undefined)
  assert.equal(r.claims.jti, undefined)
})

test('expired token time state', () => {
  const r = J.decode(makeToken({ alg: 'HS256' }, { exp: NOW - 180 }))
  assert.equal(r.time.expired, true)
  assert.equal(r.time.notYetValid, false)
  assert.ok(r.time.expDate instanceof Date)
  assert.ok(Math.abs(r.time.expiresInMs + 180000) < 2000)
})

test('not-yet-valid token (nbf in future)', () => {
  const r = J.decode(makeToken({ alg: 'HS256' }, { nbf: NOW + 300, exp: NOW + 3600 }))
  assert.equal(r.time.notYetValid, true)
  assert.equal(r.time.expired, false)
})

test('valid token window (nbf passed, exp future)', () => {
  const r = J.decode(makeToken({ alg: 'HS256' }, { nbf: NOW - 10, exp: NOW + 7200, iat: NOW - 10 }))
  assert.equal(r.time.expired, false)
  assert.equal(r.time.notYetValid, false)
  assert.ok(r.time.iatDate instanceof Date)
  assert.ok(r.time.expiresInMs > 7100000)
})

test('exp/nbf treated as seconds not milliseconds', () => {
  const r = J.decode(makeToken({ alg: 'HS256' }, { exp: NOW + 60 }))
  assert.equal(r.time.expired, false)
  assert.ok(Math.abs(r.time.expiresInMs - 60000) < 2000)
})

test('wrong segment count errors', () => {
  const two = J.decode('eyJhIjoxfQ.eyJzIjoxfQ')
  assert.equal(two.ok, false)
  assert.match(two.error, /段数不对/)
  const four = J.decode('a.b.c.d')
  assert.equal(four.ok, false)
  assert.match(four.error, /4 段/)
})

test('illegal base64url characters reported per segment', () => {
  const r = J.decode('eyJhIjoxfQ.p@load!x.sig')
  assert.equal(r.ok, false)
  assert.match(r.error, /payload 段 base64url 含非法字符/)
})

test('illegal JSON in payload points at the segment', () => {
  const r = J.decode(b64url(JSON.stringify({ alg: 'HS256' })) + '.' + b64url('{oops') + '.sig')
  assert.equal(r.ok, false)
  assert.match(r.error, /payload 段 JSON 解析失败/)
})

test('empty token rejected', () => {
  assert.equal(J.decode('').ok, false)
  assert.equal(J.decode(null).ok, false)
})

test('verifyHs256 with correct secret passes', async () => {
  const t = await makeSigned({ alg: 'HS256', typ: 'JWT' }, { sub: 'alice', exp: NOW + 60 }, 'secret-1')
  const r = await J.verifyHs256(t, 'secret-1')
  assert.equal(r.ok, true)
  assert.equal(r.valid, true)
})

test('verifyHs256 with wrong secret fails', async () => {
  const t = await makeSigned({ alg: 'HS256' }, { sub: 'alice' }, 'secret-1')
  const r = await J.verifyHs256(t, 'wrong-secret')
  assert.equal(r.ok, true)
  assert.equal(r.valid, false)
})

test('verifyHs256 fails on tampered payload', async () => {
  const t = await makeSigned({ alg: 'HS256' }, { role: 'user' }, 'k')
  const parts = t.split('.')
  const tampered = parts[0] + '.' + b64url(JSON.stringify({ role: 'admin' })) + '.' + parts[2]
  const r = await J.verifyHs256(tampered, 'k')
  assert.equal(r.valid, false)
})

test('verifyHs256 rejects non-HS256 alg and broken token', async () => {
  const t = makeToken({ alg: 'none' }, { sub: 'x' }, '')
  const r = await J.verifyHs256(t, 'k')
  assert.equal(r.ok, false)
  assert.match(r.error, /alg 不是 HS256/)
  const r2 = await J.verifyHs256('nope', 'k')
  assert.equal(r2.ok, false)
})

test('textSummary shows subject and expiry states', () => {
  const expired = J.textSummary({ sub: 'alice', exp: NOW - 180 })
  assert.match(expired, /^sub=alice · 已过期 3 分钟$/)
  const future = J.textSummary({ sub: 'bob', exp: NOW + 3600 })
  assert.match(future, /^sub=bob · 剩余 1 小时$/)
  const nbfed = J.textSummary({ sub: 'c', nbf: NOW + 120 })
  assert.match(nbfed, /^sub=c · 尚未生效，2 分钟后可用$/)
})

test('textSummary without time claims', () => {
  assert.equal(J.textSummary({ sub: 'alice', iss: 'mozi' }), '无时间声明')
  assert.equal(J.textSummary({ iat: NOW - 3600 }), '签发于 1 小时前')
})
