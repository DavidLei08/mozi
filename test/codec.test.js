'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

global.window = {}
require('../src/renderer/lib/codec.js')
const C = global.window.Codec

test('js string escape/unescape round-trips', () => {
  const raw = `line1\nline2\t"quoted" 'single' \\ backslash 😀`
  const escaped = C.escapeJs(raw)
  assert.ok(escaped.includes('\\n'))
  assert.ok(escaped.includes('\\t'))
  assert.equal(C.unescapeJs(escaped), raw)
})

test('js unescape handles unicode escapes', () => {
  assert.equal(C.unescapeJs('\\u4f60\\u597d'), '你好')
  assert.equal(C.unescapeJs('\\u{1F600}'), '😀')
  assert.equal(C.unescapeJs('\\x41'), 'A')
})

test('json string escape/unescape', () => {
  const raw = '{"a":"b"}\n第二行'
  const escaped = C.escapeJson(raw)
  assert.equal(escaped.includes('\\n'), true)
  assert.equal(C.unescapeJson(escaped), raw)
})

test('url encode/decode handles unicode and spaces', () => {
  const raw = '你好 world&x=1'
  const encoded = C.urlEncode(raw)
  assert.ok(!encoded.includes(' '))
  assert.equal(C.urlDecode(encoded), raw)
  assert.equal(C.urlDecode('%E4%BD%A0%E5%A5%BD'), '你好')
  assert.equal(C.urlDecode('%zz'), '%zz', 'invalid sequences are returned unchanged')
})

test('html escape/unescape', () => {
  const raw = '<div class="a">Tom & Jerry\'s</div>'
  const escaped = C.escapeHtml(raw)
  assert.equal(escaped, '&lt;div class=&quot;a&quot;&gt;Tom &amp; Jerry&#39;s&lt;/div&gt;')
  assert.equal(C.unescapeHtml(escaped), raw)
  assert.equal(C.unescapeHtml('&#65;&#x42;&nbsp;'), 'AB\u00a0')
})

test('unicode escape/unescape handles astral characters', () => {
  const escaped = C.unicodeEscape('hi你好😀')
  assert.ok(escaped.includes('\\u4f60'))
  assert.ok(escaped.includes('\\ud83d'))
  assert.equal(C.unicodeUnescape(escaped), 'hi你好😀')
})

test('base64 encodes and decodes UTF-8 text', () => {
  const raw = 'Mozi 工具箱 🚀'
  const b64 = C.base64Encode(raw, false)
  assert.equal(C.base64Decode(b64, false), raw)
  assert.equal(C.base64Encode('hello'), 'aGVsbG8=')
})

test('base64 url-safe variant round-trips without padding', () => {
  const raw = '??>>??>>'
  const safe = C.base64Encode(raw, true)
  assert.ok(!safe.includes('+'))
  assert.ok(!safe.includes('/'))
  assert.ok(!safe.includes('='))
  assert.equal(C.base64Decode(safe, true), raw)
})

test('base64 decoding rejects garbage', () => {
  assert.throws(() => C.base64Decode('!!!not-base64!!!'))
})

test('data url normalization supports data urls and raw base64', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const fromRaw = C.normalizeDataUrl(png)
  assert.equal(fromRaw.mime, 'image/png')
  assert.equal(fromRaw.base64, png)
  assert.ok(fromRaw.dataUrl.startsWith('data:image/png;base64,'))

  const fromData = C.normalizeDataUrl(`data:image/jpeg;base64,${png}`)
  assert.equal(fromData.mime, 'image/jpeg')

  assert.equal(C.normalizeDataUrl('not base64 !!!'), null)
  assert.equal(C.normalizeDataUrl(''), null)
})

test('image mime sniffing and byte length', () => {
  assert.equal(C.sniffImageMime('iVBORw0KGgo'), 'image/png')
  assert.equal(C.sniffImageMime('R0lGODlh'), 'image/gif')
  assert.equal(C.sniffImageMime('zzzz'), null)
  assert.equal(C.byteLengthOfBase64('aGVsbG8='), 5)
  assert.equal(C.humanSize(2048), '2.0 KB')
})

test('json format/minify/sort/stats', () => {
  const raw = '{"b":2,"a":{"z":1,"y":[3,4]}}'
  const formatted = C.formatJson(raw, 2)
  assert.equal(formatted.ok, true)
  assert.ok(formatted.text.includes('\n  "b": 2'))

  const minified = C.minifyJson(formatted.text)
  assert.equal(minified.ok, true)
  assert.equal(minified.text, raw)

  const parsed = C.parseJson(raw)
  const sorted = JSON.stringify(C.sortJsonKeys(parsed.value))
  assert.equal(sorted, '{"a":{"y":[3,4],"z":1},"b":2}')

  assert.deepEqual(C.statsJson({ a: 1, b: [2, 3] }), { keys: 2, nodes: 5 })
})

test('json errors carry a message and, when V8 provides it, a line/column', () => {
  const withPosition = C.parseJson('{"a":1,}')
  assert.equal(withPosition.ok, false)
  assert.ok(withPosition.error)
  assert.equal(withPosition.position.line, 1)
  assert.equal(withPosition.position.column, 8)

  const withoutPosition = C.parseJson('{\n  "a": 1,\n  "b":\n}')
  assert.equal(withoutPosition.ok, false)
  assert.ok(withoutPosition.error)
  // V8 omits the position for some malformed inputs; the renderer falls back to a message-only status.
  assert.ok(withoutPosition.position === null || typeof withoutPosition.position.line === 'number')
})
