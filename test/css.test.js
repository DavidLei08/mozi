'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8')

const declared = new Set()
for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) declared.add(m[1])

const used = new Set()
for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) used.add(m[1])

test('every CSS custom property is declared', () => {
  // --panel / --muted / --line-strong were referenced all over the UI but never
  // declared, so panels rendered transparent and muted text inherited the body
  // colour. Keep this list empty.
  const missing = [...used].filter((name) => !declared.has(name)).sort()
  assert.deepEqual(missing, [], `undeclared custom properties: ${missing.join(', ')}`)
})

test('the light theme overrides the shared tokens', () => {
  const light = css.slice(css.indexOf('[data-theme="light"]'))
  const lightBlock = light.slice(0, light.indexOf('}'))
  for (const token of ['--panel', '--panel-2', '--panel-solid', '--muted', '--line-strong', '--shadow-md']) {
    assert.ok(lightBlock.includes(token), `light theme must define ${token}`)
  }
})

test('dropdown panels are opaque', () => {
  // a transparent panel was why menu rows looked like they overlapped the code
  const body = css.slice(css.indexOf('.md-menu-body {'))
  const rule = body.slice(0, body.indexOf('}'))
  assert.match(rule, /background:\s*var\(--panel-solid\)/, 'menu panel must use the solid panel colour')
  assert.ok(!/background:\s*transparent/.test(rule))
})

test('no stylesheet rule leaves the save dot unstyled', () => {
  assert.match(css, /\.md-dot\s*\{[^}]*background:\s*var\(--red/)
})
