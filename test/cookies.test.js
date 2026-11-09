'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

global.window = {}
require('../src/renderer/lib/cookies.js')
const { Jar, parseSetCookie, domainMatches, pathMatches } = global.window.Cookies

test('parseSetCookie takes defaults from the request url', () => {
  const c = parseSetCookie('sid=abc123', 'https://api.example.com/v1/items')
  assert.equal(c.name, 'sid')
  assert.equal(c.value, 'abc123')
  assert.equal(c.domain, 'api.example.com')
  assert.equal(c.path, '/v1')
  assert.equal(c.hostOnly, true)
  assert.equal(c.secure, false)
})

test('parseSetCookie honours domain/path/secure/httpOnly attributes', () => {
  const c = parseSetCookie('tok=x; Domain=EXAMPLE.com; Path=/app; Secure; HttpOnly', 'https://api.example.com/v1')
  assert.equal(c.domain, 'example.com')
  assert.equal(c.path, '/app')
  assert.equal(c.secure, true)
  assert.equal(c.httpOnly, true)
  assert.equal(c.hostOnly, false)
})

test('parseSetCookie computes expiry from Expires and Max-Age', () => {
  const exp = parseSetCookie('a=1; Expires=Wed, 09 Jun 2100 10:18:14 GMT', 'https://x.test/')
  assert.ok(exp.expires > Date.now())
  const max = parseSetCookie('b=2; Max-Age=60', 'https://x.test/')
  assert.ok(Math.abs(max.expires - (Date.now() + 60000)) < 2000)
  const gone = parseSetCookie('c=3; Max-Age=0', 'https://x.test/')
  assert.equal(gone.expires <= Date.now(), true)
})

test('domain matching follows suffix rules', () => {
  assert.equal(domainMatches('example.com', 'api.example.com'), true)
  assert.equal(domainMatches('example.com', 'example.com'), true)
  assert.equal(domainMatches('example.com', 'notexample.com'), false)
  assert.equal(domainMatches('example.com', 'example.org'), false)
})

test('path matching follows prefix boundaries', () => {
  assert.equal(pathMatches('/', '/anything'), true)
  assert.equal(pathMatches('/api', '/api/items'), true)
  assert.equal(pathMatches('/api', '/api'), true)
  assert.equal(pathMatches('/api', '/apixyz'), false)
})

test('jar stores, replaces and matches cookies', () => {
  const jar = new Jar()
  jar.store('sid=1', 'https://a.example.com/app/x')
  jar.store('theme=dark; Path=/app', 'https://a.example.com/app/y')
  assert.equal(jar.cookies.length, 2)

  jar.store('sid=2', 'https://a.example.com/app/x')
  assert.equal(jar.cookies.length, 2, 're-set replaces, not duplicates')
  const found = jar.cookies.find((c) => c.name === 'sid')
  assert.equal(found.value, '2')

  const header = jar.headerValue('https://a.example.com/app/z')
  assert.ok(header.includes('sid=2'))
  assert.ok(header.includes('theme=dark'))
})

test('jar excludes non-matching, disabled, expired and secure-only cookies', () => {
  const jar = new Jar([
    { name: 'host', value: 'h', domain: 'a.example.com', path: '/', hostOnly: true, enabled: true, expires: null, secure: false },
    { name: 'otherhost', value: 'x', domain: 'b.example.com', path: '/', hostOnly: false, enabled: true, expires: null, secure: false },
    { name: 'off', value: 'o', domain: 'a.example.com', path: '/', hostOnly: true, enabled: false, expires: null, secure: false },
    { name: 'dead', value: 'd', domain: 'a.example.com', path: '/', hostOnly: true, enabled: true, expires: Date.now() - 1000, secure: false },
    { name: 'safe', value: 's', domain: 'a.example.com', path: '/', hostOnly: true, enabled: true, expires: null, secure: true }
  ])
  const httpHeader = jar.headerValue('http://a.example.com/x')
  assert.ok(httpHeader.includes('host=h'))
  assert.ok(!httpHeader.includes('otherhost'), 'domain mismatch excluded')
  assert.ok(!httpHeader.includes('off'), 'disabled excluded')
  assert.ok(!httpHeader.includes('dead'), 'expired excluded')
  assert.ok(!httpHeader.includes('safe'), 'secure cookie skipped on http')

  const httpsHeader = jar.headerValue('https://a.example.com/x')
  assert.ok(httpsHeader.includes('safe=s'), 'secure cookie sent on https')
})

test('jar prune removes expired entries and clear empties', () => {
  const jar = new Jar([
    { name: 'live', value: '1', domain: 'x.test', path: '/', hostOnly: true, enabled: true, expires: null, secure: false },
    { name: 'dead', value: '0', domain: 'x.test', path: '/', hostOnly: true, enabled: true, expires: 1, secure: false }
  ])
  assert.equal(jar.prune(), 1)
  assert.equal(jar.cookies.length, 1)
  jar.clear()
  assert.equal(jar.cookies.length, 0)
})

test('longer paths sort first in the header', () => {
  const jar = new Jar([
    { name: 'shallow', value: 'a', domain: 'x.test', path: '/', hostOnly: false, enabled: true, expires: null, secure: false },
    { name: 'deep', value: 'b', domain: 'x.test', path: '/app/sub', hostOnly: false, enabled: true, expires: null, secure: false }
  ])
  const header = jar.headerValue('https://x.test/app/sub/page')
  assert.ok(header.indexOf('deep') < header.indexOf('shallow'), header)
})
