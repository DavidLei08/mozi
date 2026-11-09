'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

// markdown.js is a browser script that attaches to `window`; give it one.
global.window = {}
require('../src/renderer/lib/markdown.js')
const { render } = global.window.Markdown

test('ATX headings h1-h6', () => {
  assert.equal(render('# One'), '<h1>One</h1>\n')
  assert.equal(render('## Two'), '<h2>Two</h2>\n')
  assert.equal(render('### Three'), '<h3>Three</h3>\n')
  assert.equal(render('#### Four'), '<h4>Four</h4>\n')
  assert.equal(render('##### Five'), '<h5>Five</h5>\n')
  assert.equal(render('###### Six'), '<h6>Six</h6>\n')
  assert.equal(render('## Closed ##'), '<h2>Closed</h2>\n')
  assert.equal(render('#nospace'), '<p>#nospace</p>\n')
  assert.equal(render('####### seven'), '<p>####### seven</p>\n')
  assert.equal(render('# *em* and **strong**'), '<h1><em>em</em> and <strong>strong</strong></h1>\n')
})

test('paragraphs, soft breaks and hard breaks', () => {
  assert.equal(render('hello'), '<p>hello</p>\n')
  assert.equal(render('line one\nline two'), '<p>line one line two</p>\n')
  assert.equal(render('para one\n\npara two'), '<p>para one</p>\n<p>para two</p>\n')
  assert.equal(render('a  \nb'), '<p>a<br>b</p>\n')
  assert.equal(render('a\\\nb'), '<p>a<br>b</p>\n')
  assert.equal(render('a  \nb  \nc'), '<p>a<br>b<br>c</p>\n')
  assert.equal(render('end with backslash\\'), '<p>end with backslash</p>\n')
  assert.equal(render('a\r\nb\rc'), '<p>a b c</p>\n')
})

test('bold, italic, strikethrough and inline code', () => {
  assert.equal(render('**bold**'), '<p><strong>bold</strong></p>\n')
  assert.equal(render('*italic*'), '<p><em>italic</em></p>\n')
  assert.equal(render('_italic_'), '<p><em>italic</em></p>\n')
  assert.equal(render('~~gone~~'), '<p><del>gone</del></p>\n')
  assert.equal(render('`code`'), '<p><code>code</code></p>\n')
  assert.equal(render('**bold _inner_**'), '<p><strong>bold <em>inner</em></strong></p>\n')
  assert.equal(render('a **b** c *d* e ~~f~~ g `h`'), '<p>a <strong>b</strong> c <em>d</em> e <del>f</del> g <code>h</code></p>\n')
  // Underscores inside words are not emphasis.
  assert.equal(render('snake_case_name'), '<p>snake_case_name</p>\n')
})

test('inline code is never parsed as Markdown and is escaped', () => {
  assert.equal(render('`**not bold** _nor italic_`'), '<p><code>**not bold** _nor italic_</code></p>\n')
  assert.equal(render('`<b> & "quoted"`'), '<p><code>&lt;b&gt; &amp; &quot;quoted&quot;</code></p>\n')
})

test('backslash escapes Markdown punctuation', () => {
  assert.equal(render('\\*not italic\\*'), '<p>*not italic*</p>\n')
  assert.equal(render('\\[not a link](x)'), '<p>[not a link](x)</p>\n')
  assert.equal(render('\\\\'), '<p>\\</p>\n')
})

test('fenced code blocks keep content verbatim and carry the language class', () => {
  assert.equal(
    render('```js\nif (a < b && c) {}\n```'),
    '<pre><code class="language-js">if (a &lt; b &amp;&amp; c) {}\n</code></pre>\n'
  )
  assert.equal(render('```\nplain\n```'), '<pre><code>plain\n</code></pre>\n')
  assert.equal(render('```\n**not bold**\n```'), '<pre><code>**not bold**\n</code></pre>\n')
  assert.equal(render('~~~\ntilde\n~~~'), '<pre><code>tilde\n</code></pre>\n')
  assert.equal(render('```c++\nint x;\n```'), '<pre><code class="language-c++">int x;\n</code></pre>\n')
  // An unterminated fence runs to the end of the document.
  assert.equal(render('```\nabc'), '<pre><code>abc\n</code></pre>\n')
  assert.equal(render('```html\n<script>alert(1)</script>\n```'),
    '<pre><code class="language-html">&lt;script&gt;alert(1)&lt;/script&gt;\n</code></pre>\n')
})

test('unordered lists accept -, * and +', () => {
  assert.equal(render('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n')
  assert.equal(render('* a\n+ b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n')
  assert.equal(render('- **bold** item'), '<ul>\n<li><strong>bold</strong> item</li>\n</ul>\n')
})

test('ordered lists', () => {
  assert.equal(render('1. one\n2. two'), '<ol>\n<li>one</li>\n<li>two</li>\n</ol>\n')
  assert.equal(render('1) paren'), '<ol>\n<li>paren</li>\n</ol>\n')
})

test('nested lists (one level)', () => {
  assert.equal(
    render('- a\n  - b\n  - c\n- d'),
    '<ul>\n<li>a<ul>\n<li>b</li>\n<li>c</li>\n</ul>\n</li>\n<li>d</li>\n</ul>\n'
  )
  assert.equal(
    render('- a\n  1. x\n  2. y\n- b'),
    '<ul>\n<li>a<ol>\n<li>x</li>\n<li>y</li>\n</ol>\n</li>\n<li>b</li>\n</ul>\n'
  )
})

test('list continuation lines and blank lines inside a list', () => {
  assert.equal(render('- a\n  continued'), '<ul>\n<li>a continued</li>\n</ul>\n')
  assert.equal(render('- a\n\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n')
  assert.equal(render('- a\n\ntext after'), '<ul>\n<li>a</li>\n</ul>\n<p>text after</p>\n')
})

test('blockquotes', () => {
  assert.equal(render('> quote'), '<blockquote>\n<p>quote</p>\n</blockquote>\n')
  assert.equal(
    render('> a\n>\n> b'),
    '<blockquote>\n<p>a</p>\n<p>b</p>\n</blockquote>\n'
  )
  assert.equal(
    render('> ## title\n> - item'),
    '<blockquote>\n<h2>title</h2>\n<ul>\n<li>item</li>\n</ul>\n</blockquote>\n'
  )
})

test('horizontal rules', () => {
  assert.equal(render('---'), '<hr>\n')
  assert.equal(render('***'), '<hr>\n')
  assert.equal(render('___'), '<hr>\n')
  assert.equal(render('- - -'), '<hr>\n')
  assert.equal(render('text\n\n---\n\ntext'), '<p>text</p>\n<hr>\n<p>text</p>\n')
})

test('links with optional titles', () => {
  assert.equal(render('[text](https://example.com)'), '<p><a href="https://example.com">text</a></p>\n')
  assert.equal(
    render('[text](https://example.com "a title")'),
    '<p><a href="https://example.com" title="a title">text</a></p>\n'
  )
  assert.equal(
    render('[**bold**](https://example.com)'),
    '<p><a href="https://example.com"><strong>bold</strong></a></p>\n'
  )
  assert.equal(render('[docs](./docs/a.md)'), '<p><a href="./docs/a.md">docs</a></p>\n')
  assert.equal(render('[top](#section)'), '<p><a href="#section">top</a></p>\n')
  assert.equal(render('[mail](mailto:dev@example.com)'), '<p><a href="mailto:dev@example.com">mail</a></p>\n')
})

test('images with alt text and optional titles', () => {
  assert.equal(render('![alt](img.png)'), '<p><img src="img.png" alt="alt"></p>\n')
  assert.equal(render('![alt](img.png "t")'), '<p><img src="img.png" alt="alt" title="t"></p>\n')
  assert.equal(render('![a "quoted" alt](img.png)'), '<p><img src="img.png" alt="a &quot;quoted&quot; alt"></p>\n')
  assert.equal(
    render('![pixel](data:image/png;base64,AAAA)'),
    '<p><img src="data:image/png;base64,AAAA" alt="pixel"></p>\n'
  )
})

test('GFM tables with alignment and inline formatting', () => {
  const md = [
    '| Name | Score | Note |',
    '| :--- | :---: | ---: |',
    '| **A** | 1 | ok |',
    '| B |',
    '| C | 3 | `x` |'
  ].join('\n')
  const html = [
    '<table>',
    '<thead>',
    '<tr>',
    '<th style="text-align:left">Name</th>',
    '<th style="text-align:center">Score</th>',
    '<th style="text-align:right">Note</th>',
    '</tr>',
    '</thead>',
    '<tbody>',
    '<tr>',
    '<td style="text-align:left"><strong>A</strong></td>',
    '<td style="text-align:center">1</td>',
    '<td style="text-align:right">ok</td>',
    '</tr>',
    '<tr>',
    '<td style="text-align:left">B</td>',
    '<td style="text-align:center"></td>',
    '<td style="text-align:right"></td>',
    '</tr>',
    '<tr>',
    '<td style="text-align:left">C</td>',
    '<td style="text-align:center">3</td>',
    '<td style="text-align:right"><code>x</code></td>',
    '</tr>',
    '</tbody>',
    '</table>',
    ''
  ].join('\n')
  assert.equal(render(md), html)
})

test('table cells with columns that have no alignment and escaped pipes', () => {
  assert.equal(
    render('| a \\| b | c |\n| --- | --- |\n| d | e |'),
    '<table>\n<thead>\n<tr>\n<th>a | b</th>\n<th>c</th>\n</tr>\n</thead>\n' +
      '<tbody>\n<tr>\n<td>d</td>\n<td>e</td>\n</tr>\n</tbody>\n</table>\n'
  )
})

test('a pipe line without a delimiter row stays a paragraph', () => {
  assert.equal(render('a | b'), '<p>a | b</p>\n')
})

test('raw HTML is escaped everywhere', () => {
  assert.equal(
    render('<img src=x onerror=alert(1)>'),
    '<p>&lt;img src=x onerror=alert(1)&gt;</p>\n'
  )
  assert.equal(render('# <b>title</b>'), '<h1>&lt;b&gt;title&lt;/b&gt;</h1>\n')
  assert.equal(render('> <script>x</script>'), '<blockquote>\n<p>&lt;script&gt;x&lt;/script&gt;</p>\n</blockquote>\n')
  assert.equal(render('| <b> |\n| --- |'), '<table>\n<thead>\n<tr>\n<th>&lt;b&gt;</th>\n</tr>\n</thead>\n</table>\n')
  assert.equal(
    render('[<script>](https://example.com)'),
    '<p><a href="https://example.com">&lt;script&gt;</a></p>\n'
  )
})

test('HTML metacharacters in text are escaped', () => {
  assert.equal(
    render('He said "hi" & \'bye\' <x>'),
    '<p>He said &quot;hi&quot; &amp; &#39;bye&#39; &lt;x&gt;</p>\n'
  )
})

test('javascript:, vbscript: and other unsafe schemes are dropped', () => {
  const bad = [
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert)',
    '[x](vbscript:msgbox)',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](file:///etc/passwd)',
    '![alt](javascript:alert(1))'
  ]
  for (const md of bad) {
    const html = render(md)
    assert.ok(!/href=|<img|javascript:|vbscript:|data:text/i.test(html), `unsafe output for ${md}: ${html}`)
  }
  assert.equal(render('[x](javascript:alert(1))'), '<p>x</p>\n')
  assert.equal(render('[x](javascript:alert)'), '<p>x</p>\n')
  assert.equal(render('![alt](javascript:alert(1))'), '<p>alt</p>\n')
})

test('entity-encoded and whitespace-obfuscated schemes are rejected', () => {
  assert.equal(render('[x](javascript&#58;alert)'), '<p>x</p>\n')
  assert.equal(render('[x](javascript&colon;alert)'), '<p>x</p>\n')
  assert.equal(render('[x](java&Tab;script:alert)'), '<p>x</p>\n')
  assert.equal(render('[x](&#x6a;avascript:alert)'), '<p>x</p>\n')
})

test('safe protocols and relative URLs still work', () => {
  assert.ok(render('[x](http://example.com)').includes('href="http://example.com"'))
  assert.ok(render('[x](https://example.com)').includes('href="https://example.com"'))
  assert.ok(render('[x](mailto:a@b.c)').includes('href="mailto:a@b.c"'))
  assert.ok(render('[x](./local/path)').includes('href="./local/path"'))
  assert.ok(render('[x](../up)').includes('href="../up"'))
  assert.ok(render('[x](#frag)').includes('href="#frag"'))
  assert.ok(render('[x](?q=1)').includes('href="?q=1"'))
  assert.ok(render('![x](data:image/svg+xml;base64,AAAA)').includes('src="data:image/svg+xml;base64,AAAA"'))
})

test('quotes in URLs cannot break out of the href attribute', () => {
  const html = render('[x](https://example.com/"onmouseover=alert(1))')
  assert.ok(html.includes('&quot;onmouseover'), html)
  assert.ok(!html.includes('"onmouseover'), `raw quote leaked: ${html}`)
})

test('only whitelisted tags are ever produced', () => {
  const html = render([
    '<script>alert(1)</script>',
    '<iframe src="x"></iframe>',
    '<svg onload=alert(1)>',
    '[x](javascript:alert(1))',
    '![x](javascript:alert(1))'
  ].join('\n\n'))
  const tags = [...html.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map((m) => m[1].toLowerCase())
  const allowed = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre',
    'ul', 'ol', 'li', 'blockquote', 'hr', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'])
  for (const tag of tags) assert.ok(allowed.has(tag), `unexpected tag <${tag}>`)
})

test('empty and non-string input', () => {
  assert.equal(render(''), '')
  assert.equal(render('   \n\n  '), '')
  assert.equal(render(null), '')
  assert.equal(render(undefined), '')
  assert.equal(render(42), '<p>42</p>\n')
})

test('output is deterministic', () => {
  const md = '# Title\n\n- a\n  - b\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n`code` and [l](https://e.com)'
  assert.equal(render(md), render(md))
})
