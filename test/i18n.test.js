'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

global.window = {}
require('../src/renderer/lib/i18n-dict.js')
const DICT = global.window.I18N_DICT

const html = read('src/renderer/index.html')
const rendererSources = ['src/renderer/app.js', 'src/renderer/tools.js', 'src/renderer/tools2.js'].map(read)

/** Product, protocol and key-notation words that legitimately stay Latin in Chinese. */
const ALLOWED_IN_ZH = new Set([
  'Mozi', 'HTTP', 'HTTPS', 'JSON', 'GraphQL', 'WebSocket', 'WS', 'SSE', 'Base64', 'Markdown',
  'Mermaid', 'JWT', 'HS256', 'MD5', 'SHA-1', 'SHA-256', 'SHA-512', 'cURL', 'UUID', 'URL', 'URI',
  'TLS', 'SSL', 'API', 'Cookie', 'Key', 'ID', 'CSV', 'YAML', 'XML', 'TOML', 'PNG', 'JPG', 'JPEG',
  'GIF', 'WebP', 'SVG', 'ICO', 'MD', 'HTML', 'JS', 'Python', 'Go', 'Java', 'Node', 'axios',
  'fetch', 'OkHttp', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'UTF-8', 'Hex',
  'Electron', 'Bearer', 'Basic', 'Token', 'npm', 'PDF', 'Word', 'Unix', 'UTC', 'ISO', 'macOS',
  'Windows', 'Unicode', 'Content-Type', 'Set-Cookie', 'Data', 'Crypto', 'Esc', 'Enter', 'Ctrl',
  'text/plain', 'application/json', 'Data URL', 'JSON5', 'QS', 'v4/v7',
  'token', 'multipart', 'Cookie Jar', 'Cookie', 'md', 'BMP', 'HEIC'
])

const CJK = /[\u4e00-\u9fa5]/
const LATIN_WORD = /[A-Za-z][A-Za-z0-9+.#/_-]*/g

test('dictionary has both languages for every key', () => {
  const zh = Object.keys(DICT.zh)
  const en = Object.keys(DICT.en)
  assert.ok(zh.length > 200, `expected a full dictionary, got ${zh.length} keys`)
  assert.deepEqual(zh.filter((k) => !(k in DICT.en)), [], 'keys missing an English value')
  assert.deepEqual(en.filter((k) => !(k in DICT.zh)), [], 'keys missing a Chinese value')
})

test('every value is non-empty in both languages', () => {
  for (const lang of ['zh', 'en']) {
    for (const [key, value] of Object.entries(DICT[lang])) {
      assert.equal(typeof value, 'string', `${lang}.${key} must be a string`)
      assert.ok(value.trim().length > 0, `${lang}.${key} is empty`)
    }
  }
})

test('English values contain no Chinese characters', () => {
  const offenders = Object.entries(DICT.en).filter(([, v]) => CJK.test(v)).map(([k]) => k)
  assert.deepEqual(offenders, [], 'English text must not fall back to Chinese')
})

test('Chinese values contain no untranslated English words', () => {
  const offenders = []
  const allowed = new Set([...ALLOWED_IN_ZH].map((w) => w.toLowerCase()))
  for (const [key, value] of Object.entries(DICT.zh)) {
    // a value that is simply a URL or a command example is data, not prose
    if (/^(https?:\/\/|\/|[a-z-]+\.(com|cn|test))/i.test(value.trim())) continue
    // placeholders are template syntax, not prose; single letters are key
    // notation (⌘K, ⌘S) which is conventional in Chinese UIs too
    const prose = value.replace(/\{\{[^}]*\}\}/g, ' ').replace(/\{[^}]*\}/g, ' ')
    const words = [...new Set(prose.match(LATIN_WORD) || [])].filter((w) => w.length > 1)
    const bad = words.filter((w) => !allowed.has(w.toLowerCase()))
    if (bad.length) offenders.push(`${key}="${value}" -> ${bad.join(', ')}`)
  }
  assert.deepEqual(offenders, [], 'Chinese UI text must not mix in English interface words')
})

test('every markup key resolves to a dictionary entry', () => {
  const keys = new Set()
  for (const m of html.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="([^"]+)"/g)) keys.add(m[1])
  assert.ok(keys.size > 150, `expected markup to use i18n keys, found ${keys.size}`)
  const missing = [...keys].filter((k) => !(k in DICT.zh) || !(k in DICT.en))
  assert.deepEqual(missing, [], 'index.html references keys the dictionary does not define')
})

test('every tr() key used in renderer scripts exists in the dictionary', () => {
  const keys = new Set()
  for (const src of rendererSources) {
    for (const m of src.matchAll(/\btr\(\s*'([a-z][a-zA-Z0-9.]*)'/g)) keys.add(m[1])
    for (const m of src.matchAll(/I18N\.t\(\s*'([a-z][a-zA-Z0-9.]*)'/g)) keys.add(m[1])
  }
  assert.ok(keys.size > 10, `expected script-level lookups, found ${keys.size}`)
  const missing = [...keys].filter((k) => !(k in DICT.zh) || !(k in DICT.en))
  assert.deepEqual(missing, [], 'renderer scripts reference keys the dictionary does not define')
})

test('tool cards and home groups are translatable', () => {
  const tools = ['http', 'jwt', 'regex', 'codegen', 'escape', 'base64', 'hash', 'timestamp', 'json', 'markdown', 'generator']
  for (const id of tools) {
    for (const field of ['name', 'desc']) {
      assert.ok(DICT.zh[`tool.${id}.${field}`], `missing zh tool.${id}.${field}`)
      assert.ok(DICT.en[`tool.${id}.${field}`], `missing en tool.${id}.${field}`)
    }
  }
  for (const group of ['dev', 'encode', 'text']) {
    assert.ok(DICT.zh[`group.${group}`] && DICT.en[`group.${group}`], `missing group.${group}`)
  }
})

test('tool names in the registry match the Chinese dictionary', () => {
  const app = read('src/renderer/app.js')
  const re = /id: '([a-z]+)', name: '([^']+)'/g
  let seen = 0
  for (const m of app.matchAll(re)) {
    const [, id, name] = m
    if (!DICT.zh[`tool.${id}.name`]) continue
    seen++
    assert.equal(DICT.zh[`tool.${id}.name`], name, `registry name for ${id} drifted from the dictionary`)
  }
  assert.ok(seen >= 10, `expected to compare every tool, compared ${seen}`)
})

test('language switcher is present and wired', () => {
  assert.match(html, /id="langSeg"/, 'home header must expose the language switcher')
  assert.match(html, /data-lang-choice="zh"/)
  assert.match(html, /data-lang-choice="en"/)
  const app = read('src/renderer/app.js')
  assert.match(app, /applyLanguage/, 'renderer must handle language changes')
  assert.match(app, /I18N\.init/, 'renderer must restore the saved language at boot')
})
