'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

global.window = {}
require('../src/renderer/lib/notepad.js')
const Notepad = global.window.Notepad

test('sanitize keeps formatting tags and drops the rest', () => {
  assert.equal(Notepad.sanitize('<p>你好 <strong>世界</strong></p>'), '<p>你好 <strong>世界</strong></p>')
  assert.equal(Notepad.sanitize('<h1>标题</h1><ul><li>一</li></ul>'), '<h1>标题</h1><ul><li>一</li></ul>')
  assert.equal(Notepad.sanitize('<marquee>走马灯</marquee>'), '走马灯')
})

test('sanitize removes script and style bodies, not just their tags', () => {
  assert.equal(Notepad.sanitize('<p>a</p><script>alert(1)</script><p>b</p>'), '<p>a</p><p>b</p>')
  assert.equal(Notepad.sanitize('<style>p{color:red}</style>文字'), '文字')
  assert.equal(Notepad.sanitize('<iframe src="https://x"></iframe>正文'), '正文')
  assert.equal(Notepad.sanitize('<SCRIPT>bad()</SCRIPT>ok'), 'ok')
})

test('sanitize strips event handlers and dangerous hrefs', () => {
  assert.equal(Notepad.sanitize('<p onclick="steal()">x</p>'), '<p>x</p>')
  assert.equal(Notepad.sanitize('<p OnClick="steal()">x</p>'), '<p>x</p>')
  assert.equal(Notepad.sanitize('<img src="x.png" onerror="steal()">'), '<img src="x.png" alt="">')
  assert.equal(Notepad.sanitize('<a href="javascript:alert(1)">点我</a>'), '<a>点我</a>')
  assert.equal(Notepad.sanitize('<a href="JaVaScRiPt:alert(1)">点我</a>'), '<a>点我</a>')
  assert.equal(Notepad.sanitize('<a href="https://mozi.test">ok</a>'), '<a href="https://mozi.test">ok</a>')
})

test('sanitize handles attribute quoting and casing', () => {
  assert.equal(Notepad.sanitize("<img src='a.png' alt='x'>"), '<img src="a.png" alt="x">')
  assert.equal(Notepad.sanitize('<IMG SRC=a.png ALT=y>'), '<img src="a.png" alt="y">')
  assert.equal(Notepad.sanitize('<br/>'), '<br>')
  assert.equal(Notepad.sanitize('<P>大写</P>'), '<p>大写</p>')
})

test('sanitize drops unsafe images but keeps data urls', () => {
  assert.equal(Notepad.sanitize('<img src="javascript:alert(1)">'), '')
  assert.equal(Notepad.sanitize('<img src="vbscript:x">'), '')
  assert.equal(
    Notepad.sanitize('<img src="data:image/png;base64,AAA">'),
    '<img src="data:image/png;base64,AAA" alt="">'
  )
  assert.equal(Notepad.sanitize('<img src="./img/sss.png">'), '<img src="./img/sss.png" alt="">')
})

test('sanitize is idempotent', () => {
  const dirty = '<p onclick="x()">a</p><script>bad()</script><img src="data:image/gif;base64,AA"><a href="https://a.b">l</a>'
  const once = Notepad.sanitize(dirty)
  assert.equal(Notepad.sanitize(once), once)
})

test('sanitize tolerates junk input', () => {
  for (const value of [null, undefined, 42, {}, '']) assert.equal(Notepad.sanitize(value), '')
})

test('sanitize drops attributes it does not allow', () => {
  assert.equal(Notepad.sanitize('<p class="x" id="y" style="color:red" data-z="1">t</p>'), '<p>t</p>')
})

test('plainText flattens markup and collapses whitespace', () => {
  assert.equal(Notepad.plainText('<p>a</p><p>b</p>'), 'a\nb')
  assert.equal(Notepad.plainText('<p>a<br>b</p>'), 'a\nb')
  assert.equal(Notepad.plainText('<p>a   &nbsp;  b</p>'), 'a b')
  assert.equal(Notepad.plainText('<p>&lt;tag&gt; &amp; &quot;q&quot;</p>'), '<tag> & "q"')
  assert.equal(Notepad.plainText(''), '')
})

test('titleFrom takes the first non-empty line and truncates', () => {
  assert.equal(Notepad.titleFrom('<p></p><h1>第一行</h1><p>第二行</p>', '未命名'), '第一行')
  assert.equal(Notepad.titleFrom('<p>   </p>', '未命名'), '未命名')
  assert.equal(Notepad.titleFrom('', '未命名'), '未命名')
  const long = 'x'.repeat(200)
  const title = Notepad.titleFrom(`<p>${long}</p>`, '未命名')
  assert.equal(title.length, Notepad.TITLE_LIMIT)
  assert.ok(title.endsWith('…'))
})

test('titleFrom never returns markup', () => {
  const title = Notepad.titleFrom('<p><strong>加粗</strong>标题</p>', '未命名')
  assert.equal(title, '加粗标题')
})

test('insertImage appends a safe figure', () => {
  const html = Notepad.insertImage('<p>a</p>', 'data:image/png;base64,AAA', '图 1')
  assert.match(html, /<figure><img src="data:image\/png;base64,AAA" alt="图 1"><figcaption>图 1<\/figcaption><\/figure>/)
  assert.equal(Notepad.sanitize(html), html.replace('<p>a</p>', '<p>a</p>'), 'sanitize keeps the figure')
})

test('insertImage refuses unsafe sources and escapes alt', () => {
  assert.equal(Notepad.insertImage('<p>a</p>', 'javascript:alert(1)', 'x'), '<p>a</p>')
  const html = Notepad.insertImage('', 'a.png', 'say "hi" <b>')
  assert.match(html, /alt="say &quot;hi&quot; &lt;b&gt;"/)
  assert.ok(!html.includes('<b>'))
})

test('wordCount matches the markdown tool convention', () => {
  assert.deepEqual(Notepad.wordCount('<p>你好 world</p>'), { chars: '<p>你好 world</p>'.length - '<p></p>'.length, words: 3 })
  assert.deepEqual(Notepad.wordCount(''), { chars: 0, words: 0 })
})

test('emptyNote starts blank with a stamp', () => {
  const note = Notepad.emptyNote(new Date('2026-11-09T10:00:00'))
  assert.equal(note.html, '')
  assert.equal(note.title, '')
  assert.equal(note.createdAt, new Date('2026-11-09T10:00:00').toISOString())
  assert.ok(note.id)
  assert.notEqual(Notepad.emptyNote().id, note.id)
})
