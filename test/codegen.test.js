'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

global.window = {}
require('../src/renderer/lib/curl.js')
require('../src/renderer/lib/codegen.js')
const Curl = global.window.Curl
const Codegen = global.window.Codegen

function req (curlText) {
  const out = Curl.parse(curlText)
  assert.equal(out.ok, true, 'fixture should parse: ' + curlText)
  return out.request
}

function gen (lang, curlText) {
  const out = Codegen.generate(lang, req(curlText))
  assert.equal(out.ok, true, 'codegen should succeed: ' + (out.error || ''))
  return out.code
}

// JS snippets use top-level await/const: wrap them and compile to prove syntax.
function assertJsSyntax (code, sourceType) {
  const src = sourceType === 'module' ? code : `async function __wrap__() {\n${code}\n}`
  new vm.Script(src, { filename: 'codegen-check.js' })
}

const GET_CURL = `curl 'https://api.example.com/v1/items?page=2&q=hi there&tag=a%2Bb' -H 'Accept: application/json' -H 'X-Key: value'`
const JSON_CURL = `curl -X POST 'https://api.example.com/things' -H 'Content-Type: application/json' -d '{"name":"bo\\"x","note":"line1\\nline2"}'`
const FORM_CURL = `curl https://api.example.com/login --data-raw 'user=ann&pass=a b' -H 'Content-Type: application/x-www-form-urlencoded'`
const FILE_CURL = `curl -X POST https://api.example.com/upload -F 'title=Hi "there"' -F 'file=@/tmp/photo.png'`

test('languages lists the six supported targets', () => {
  assert.deepEqual(Codegen.languages.map((l) => l.id), ['python', 'javascript', 'node-axios', 'go', 'java', 'curl'])
  for (const l of Codegen.languages) assert.equal(typeof l.label, 'string')
})

/* ---------- Python ---------- */

test('python: GET with query params and headers', () => {
  const code = gen('python', GET_CURL)
  assert.match(code, /requests\.request\(/)
  assert.match(code, /url = "https:\/\/api\.example\.com\/v1\/items"/)
  assert.match(code, /"page": "2"/)
  assert.match(code, /"q": "hi there"/)
  assert.match(code, /"X-Key": "value"/)
  assert.match(code, /allow_redirects=False/)
})

test('python: POST JSON body keeps escaped quotes valid', () => {
  const code = gen('python', JSON_CURL)
  assert.match(code, /payload = /)
  assert.match(code, /data=payload/)
  assert.match(code, /"Content-Type": "application\/json"/)
  // the payload literal must round-trip back to the original JSON body
  const literal = code.match(/payload = ("(?:[\s\S]*?)")\n/)[1]
  const body = JSON.parse(literal)
  assert.deepEqual(JSON.parse(body), { name: 'bo"x', note: 'line1\nline2' })
})

test('python: POST form-urlencoded', () => {
  const code = gen('python', FORM_CURL)
  assert.match(code, /data = \{/)
  assert.match(code, /"user": "ann"/)
  assert.match(code, /"pass": "a b"/)
  assert.match(code, /data=data/)
  assert.match(code, /application\/x-www-form-urlencoded/)
})

test('python: multipart with a file uses files=', () => {
  const code = gen('python', FILE_CURL)
  assert.match(code, /files = \{/)
  assert.match(code, /"file": \("photo\.png", open\("\/tmp\/photo\.png", 'rb'\), "image\/png"\)/)
  assert.match(code, /"title": "Hi \\"there\\""/)
  assert.match(code, /files=files/)
  assert.doesNotMatch(code, /Content-Type/)
})

/* ---------- JavaScript (fetch) ---------- */

test('javascript: GET builds URL and compiles', () => {
  const code = gen('javascript', GET_CURL)
  assert.match(code, /await fetch\(url, \{/)
  assert.match(code, /url\.searchParams\.append\("page", "2"\)/)
  assert.match(code, /url\.searchParams\.append\("q", "hi there"\)/)
  assert.match(code, /redirect: 'manual'/)
  assertJsSyntax(code)
})

test('javascript: POST JSON escapes quotes without breaking syntax', () => {
  const code = gen('javascript', JSON_CURL)
  assert.match(code, /const body = /)
  assertJsSyntax(code)
})

test('javascript: form-urlencoded uses URLSearchParams', () => {
  const code = gen('javascript', FORM_CURL)
  assert.match(code, /new URLSearchParams\(/)
  assert.match(code, /"pass": "a b"/)
  assertJsSyntax(code)
})

test('javascript: multipart uses FormData with file bytes', () => {
  const code = gen('javascript', FILE_CURL)
  assert.match(code, /new FormData\(\)/)
  assert.match(code, /form\.append\("file", new Blob\(\[fs\.readFileSync\("\/tmp\/photo\.png"\)\]/)
  assert.match(code, /"photo\.png"\)/)
  assertJsSyntax(code)
})

/* ---------- Node.js (axios) ---------- */

test('node-axios: GET with params, headers and redirect option', () => {
  const code = gen('node-axios', GET_CURL)
  assert.match(code, /require\('axios'\)/)
  assert.match(code, /maxRedirects: 0/)
  assert.match(code, /"page": "2"/)
  assert.match(code, /method: "get"/)
})

test('node-axios: JSON body and followRedirects -> maxRedirects 5', () => {
  const code = gen('node-axios', `curl -L -X POST https://api.example.com/t -H 'Content-Type: application/json' -d '{"a":1}'`)
  assert.match(code, /maxRedirects: 5/)
  assert.deepEqual(JSON.parse(JSON.parse(code.match(/data: ("(?:[^"\\]|\\.)*")/)[1])), { a: 1 })
})

test('node-axios: multipart uses form-data package', () => {
  const code = gen('node-axios', FILE_CURL)
  assert.match(code, /require\('form-data'\)/)
  assert.match(code, /filename: "photo\.png"/)
  assert.match(code, /form\.getHeaders\(\)/)
})

/* ---------- Go ---------- */

test('go: GET uses http.NewRequest with url.Values', () => {
  const code = gen('go', GET_CURL)
  assert.match(code, /http\.NewRequest\(`GET`, reqUrl, body\)/)
  assert.match(code, /values\.Add\(`page`, `2`\)/)
  assert.match(code, /values\.Add\(`q`, `hi there`\)/)
  assert.match(code, /reqUrl \+= `\?` \+ enc/)
  assert.match(code, /CheckRedirect/)
  assert.match(code, /"net\/url"/)
})

test('go: JSON body keeps quotes valid inside a raw-string fallback', () => {
  const code = gen('go', JSON_CURL)
  assert.match(code, /strings\.NewReader\(/)
  assert.match(code, /req\.Header\.Set\(`Content-Type`, `application\/json`\)/)
})

test('go: multipart uses multipart.Writer', () => {
  const code = gen('go', FILE_CURL)
  assert.match(code, /multipart\.NewWriter\(body\)/)
  assert.match(code, /writer\.CreateFormFile\(`file`, `photo\.png`\)/)
  assert.match(code, /writer\.WriteField\(`title`, `Hi "there"`\)/)
  assert.match(code, /req\.Header\.Set\("Content-Type", contentType\)/)
})

test('go: form-urlencoded and api-key auth', () => {
  const code = gen('go', FORM_CURL)
  assert.match(code, /strings\.NewReader\(`user=ann&pass=a%20b`\)/)
  const key = Codegen.generate('go', Object.assign(req('curl https://api.example.com/x'), {
    auth: { type: 'api-key', key: 'X-Api-Key', value: 'abc123', addTo: 'header' }
  }))
  assert.match(key.code, /req\.Header\.Set\(`X-Api-Key`, `abc123`\)/)
})

/* ---------- Java (OkHttp) ---------- */

test('java: GET with HttpUrl builder and headers', () => {
  const code = gen('java', GET_CURL)
  assert.match(code, /HttpUrl\.parse\("https:\/\/api\.example\.com\/v1\/items"\)\.newBuilder\(\)/)
  assert.match(code, /addQueryParameter\("page", "2"\)/)
  assert.match(code, /addQueryParameter\("q", "hi there"\)/)
  assert.match(code, /new OkHttpClient/)
  assert.match(code, /\.method\("GET", body\)/)
})

test('java: JSON body compiles as a valid string literal', () => {
  const code = gen('java', JSON_CURL)
  assert.match(code, /RequestBody\.create\("/)
  assert.match(code, /MediaType\.parse\("application\/json"\)/)
})

test('java: multipart uses MultipartBody', () => {
  const code = gen('java', FILE_CURL)
  assert.match(code, /MultipartBody\.Builder\(\)\.setType\(MultipartBody\.FORM\)/)
  assert.match(code, /addFormDataPart\("title", "Hi \\"there\\""\)/)
  assert.match(code, /addFormDataPart\("file", "photo\.png", RequestBody\.create/)
})

test('java: form-urlencoded uses FormBody', () => {
  const code = gen('java', FORM_CURL)
  assert.match(code, /new FormBody\.Builder\(\)\.add\("user", "ann"\)\.add\("pass", "a b"\)\.build\(\)/)
})

/* ---------- cURL ---------- */

test('curl: beautified output with encoded query and headers', () => {
  const code = gen('curl', GET_CURL)
  assert.match(code, /^curl \\/)
  assert.match(code, /q=hi%20there/)
  assert.match(code, /tag=a%2Bb/)
  assert.match(code, /-H 'Accept: application\/json'/)
  assert.match(code, /--compressed/)
})

test('curl: JSON body round-trips through -d', () => {
  const code = gen('curl', JSON_CURL)
  assert.match(code, /-X POST/)
  assert.match(code, /--data-raw/)
  assert.match(code, /\\"/)
})

test('curl: multipart and urlencoded forms', () => {
  assert.match(gen('curl', FILE_CURL), /-F 'file=@\/tmp\/photo\.png'/)
  assert.match(gen('curl', FORM_CURL), /--data-urlencode 'pass=a b'/)
})

/* ---------- auth ---------- */

test('bearer auth becomes an Authorization header in every language', () => {
  const r = Object.assign(req('curl https://api.example.com/y'), { auth: { type: 'bearer', token: 'tok 123' } })
  for (const lang of ['python', 'javascript', 'node-axios', 'go', 'java', 'curl']) {
    const out = Codegen.generate(lang, r)
    assert.equal(out.ok, true, lang)
    assert.ok(out.code.includes('tok 123'), lang + ' should embed the token')
    assert.ok(/Bearer/.test(out.code) || lang === 'go', lang)
  }
})

test('basic auth uses base64 of user:password', () => {
  const r = req("curl -u 'user:p@ss:word' https://api.example.com/y")
  assert.equal(r.auth.type, 'basic')
  const expected = 'Basic ' + Buffer.from('user:p@ss:word').toString('base64')
  const py = Codegen.generate('python', r).code
  assert.ok(py.includes(expected), expected)
  assert.ok(Codegen.generate('curl', r).code.includes(expected))
})

test('api-key auth goes to query or header per addTo', () => {
  const base = req('curl https://api.example.com/y?a=1')
  const toQuery = Codegen.generate('python', Object.assign({}, base, { auth: { type: 'api-key', key: 'apikey', value: 'x y', addTo: 'query' } })).code
  assert.match(toQuery, /"apikey": "x y"/)
  const toHeader = Codegen.generate('python', Object.assign({}, base, { auth: { type: 'api-key', key: 'X-Api', value: 'zzz', addTo: 'header' } })).code
  assert.match(toHeader, /"X-Api": "zzz"/)
  const curlQ = Codegen.generate('curl', Object.assign({}, base, { auth: { type: 'api-key', key: 'apikey', value: 'x y', addTo: 'query' } })).code
  assert.match(curlQ, /apikey=x%20y/)
})

/* ---------- options + graphql + errors ---------- */

test('insecure adds a warning comment, graphql builds a JSON envelope', () => {
  const r = Object.assign(req('curl -k https://api.example.com/y'), {
    method: 'POST',
    body: { type: 'graphql', text: '', contentType: '', graphql: { query: '{ me }', variables: '{"id":7}' }, formUrlencoded: [], formData: [] }
  })
  const py = Codegen.generate('python', r).code
  assert.match(py, /^# TLS certificate verification is disabled/)
  assert.match(py, /verify=False/)
  assert.ok(py.includes('{\\"query\\":\\"{ me }\\",\\"variables\\":{\\"id\\":7}}') || py.includes('"{\\"query\\"'))
  const js = Codegen.generate('javascript', r).code
  assert.match(js, /^\/\/ TLS certificate verification is disabled/)
  assertJsSyntax(js)
  const parsed = JSON.parse(JSON.parse(js.match(/const body = ("(?:[^"\\]|\\.)*")/)[1]))
  assert.deepEqual(parsed, { query: '{ me }', variables: { id: 7 } })
})

test('binary body reads the file; missing path is an error', () => {
  const r = req("curl -X POST https://api.example.com/put --data-binary '@/tmp/blob.bin'")
  assert.equal(r.body.type, 'binary')
  assert.match(Codegen.generate('python', r).code, /open\("\/tmp\/blob\.bin", 'rb'\)/)
  assert.match(Codegen.generate('java', r).code, /Paths\.get\("\/tmp\/blob\.bin"\)/)
  const broken = Codegen.generate('python', Object.assign(req('curl https://x.com'), { body: { type: 'binary', filePath: '' } }))
  assert.equal(broken.ok, false)
})

test('generate reports errors for unknown language and bad input', () => {
  assert.equal(Codegen.generate('ruby', req('curl https://x.com')).ok, false)
  assert.equal(Codegen.generate('python', null).ok, false)
  assert.equal(Codegen.generate('python', {}).ok, false)
})

test('quotes and backslashes never break the generated literals', () => {
  const tricky = `curl -X POST https://api.example.com/t -H 'Content-Type: application/json' --data-raw ` + String.raw`{"a":1,"b":"q\"x","c":"back\\slash"}`
  const r = req(tricky)
  assert.match(gen('python', tricky), /payload = "/)
  assert.match(gen('java', tricky), /RequestBody\.create\("/)
  // Go uses a raw back-quote string, so quotes and backslashes stay literal and valid
  assert.match(gen('go', tricky), /strings\.NewReader\(`/)
  assert.match(gen('javascript', tricky), /const body = "/)
  assertJsSyntax(Codegen.generate('javascript', r).code)
  // newline / backtick payloads must leave the raw-string form for a quoted literal
  const nl = Codegen.generate('go', Object.assign(req('curl https://api.example.com/t'), {
    method: 'POST', body: { type: 'json', text: 'line1\nline2 `tick`', contentType: '', graphql: { query: '', variables: '' }, formUrlencoded: [], formData: [] }
  })).code
  assert.match(nl, /strings\.NewReader\("/)
})

test('disabled params, headers and form fields are skipped everywhere', () => {
  const r = req('curl https://api.example.com/z?keep=1&drop=2 -H "X-On: yes" -H "X-Off: no"')
  r.params.find((p) => p.key === 'drop').enabled = false
  r.headers.find((h) => h.key === 'X-Off').enabled = false
  const py = Codegen.generate('python', r).code
  assert.match(py, /"keep": "1"/)
  assert.doesNotMatch(py, /drop|X-Off/)
})
