'use strict'

/**
 * Zero-dependency Markdown -> HTML renderer for the preview pane.
 * Pure string processing (no DOM), no imports/exports: attaches `window.Markdown = { render }`.
 * Every user string is HTML-escaped; only the tags emitted below appear in the output.
 */
window.Markdown = (function () {
  const BREAK = '\u0000'
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', sol: '/' }
  const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/
  const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
  const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
  const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/
  const HR_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/

  function esc (value) {
    return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c])
  }

  // Entities are decoded before the protocol check so `javascript&#58;` cannot slip through.
  function decodeEntities (s) {
    const cp = (n) => (Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '')
    return s
      .replace(/&#x([0-9a-f]+);?/gi, (_, h) => cp(parseInt(h, 16)))
      .replace(/&#(\d+);?/g, (_, d) => cp(parseInt(d, 10)))
      .replace(/&(amp|lt|gt|quot|apos|colon|tab|newline|sol);/gi, (_, n) => NAMED[n.toLowerCase()])
  }

  // Whitelist: http(s), mailto, data:image/ and relative paths. Any other explicit
  // scheme (javascript:, vbscript:, file:, data:text/html, ...) is dropped.
  function safeUrl (raw) {
    const url = String(raw == null ? '' : raw).trim()
    if (!url) return null
    const probe = decodeEntities(url).replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase()
    if (!probe) return null
    if (/^(https?:|mailto:)/.test(probe) || /^data:image\//.test(probe)) return url
    return /^[a-z][a-z0-9+.-]*:/.test(probe) ? null : url
  }

  function attr (value) {
    return esc(value).split(BREAK).join('')
  }

  // Inline rules are tried left-to-right; URLs allow one level of balanced parens.
  const INLINE_RULES = [
    { // image
      re: /!\[([^\]\n]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))*)(?:\s+"([^"\n]*)")?\s*\)/y,
      build (m) {
        const src = safeUrl(m[2])
        if (!src) return esc(m[1])
        const title = m[3] ? ` title="${attr(m[3])}"` : ''
        return `<img src="${attr(src)}" alt="${attr(m[1])}"${title}>`
      }
    },
    { // link
      re: /\[([^\]\n]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))*)(?:\s+"([^"\n]*)")?\s*\)/y,
      build (m) {
        const href = safeUrl(m[2])
        if (!href) return inline(m[1])
        const title = m[3] ? ` title="${attr(m[3])}"` : ''
        return `<a href="${attr(href)}"${title}>${inline(m[1])}</a>`
      }
    },
    { re: /`([^`\n]+)`/y, build: (m) => `<code>${esc(m[1])}</code>` },
    { re: /\*\*([\s\S]+?)\*\*/y, build: (m) => `<strong>${inline(m[1])}</strong>` },
    { re: /~~([\s\S]+?)~~/y, build: (m) => `<del>${inline(m[1])}</del>` },
    { re: /\*([^*\n]+)\*/y, build: (m) => `<em>${inline(m[1])}</em>` },
    { re: /(?<![\w])_([^_\n]+)_(?![\w])/y, build: (m) => `<em>${inline(m[1])}</em>` },
    { re: /\\([\\`*_{}\[\]()#+\-.!>~|])/y, build: (m) => esc(m[1]) }
  ]

  function inline (source) {
    const src = String(source)
    let out = ''
    let i = 0
    let last = 0
    while (i < src.length) {
      let hit = null
      for (const rule of INLINE_RULES) {
        rule.re.lastIndex = i
        const m = rule.re.exec(src)
        if (m && m.index === i) {
          hit = { end: rule.re.lastIndex, html: rule.build(m) }
          break
        }
      }
      if (hit) {
        out += esc(src.slice(last, i)) + hit.html
        i = last = hit.end
      } else i++
    }
    return (out + esc(src.slice(last))).split(BREAK).join('<br>')
  }

  function isBlockStart (line) {
    return FENCE_RE.test(line) || HEADING_RE.test(line) || QUOTE_RE.test(line) ||
      HR_RE.test(line) || LIST_RE.test(line)
  }

  // GFM soft breaks become a space; two trailing spaces or a trailing backslash are hard breaks.
  function paragraphText (lines) {
    let text = ''
    let hard = false
    for (let k = 0; k < lines.length; k++) {
      if (k) text += hard ? BREAK : ' '
      const twoSpaces = / {2,}$/.test(lines[k])
      let content = lines[k].replace(/[ \t]+$/, '')
      hard = twoSpaces || /(?<!\\)\\$/.test(content)
      if (!twoSpaces && hard) content = content.slice(0, -1)
      text += content
    }
    return text
  }

  function splitRow (line) {
    let s = line.trim()
    if (s.startsWith('|')) s = s.slice(1)
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
    const cells = []
    let buf = ''
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { buf += '|'; i++; continue }
      if (s[i] === '|') { cells.push(buf.trim()); buf = ''; continue }
      buf += s[i]
    }
    cells.push(buf.trim())
    return cells
  }

  function isTableDelimiter (line) {
    if (!line || !line.includes('-')) return false
    const cells = splitRow(line)
    return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
  }

  function alignOf (cell) {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    return left && right ? 'center' : left ? 'left' : right ? 'right' : ''
  }

  function renderTable (lines, start) {
    const head = splitRow(lines[start])
    const delim = splitRow(lines[start + 1])
    const aligns = head.map((_, k) => alignOf(delim[k] || ''))
    const cell = (tag, text, k) => {
      const style = aligns[k] ? ` style="text-align:${aligns[k]}"` : ''
      return `<${tag}${style}>${inline(text)}</${tag}>`
    }
    const rows = []
    let i = start + 2
    while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !HR_RE.test(lines[i])) {
      rows.push(splitRow(lines[i]))
      i++
    }
    let html = '<table>\n<thead>\n<tr>\n'
    head.forEach((text, k) => { html += cell('th', text, k) + '\n' })
    html += '</tr>\n</thead>\n'
    if (rows.length) {
      html += '<tbody>\n'
      for (const row of rows) {
        html += '<tr>\n'
        head.forEach((_, k) => { html += cell('td', row[k] || '', k) + '\n' })
        html += '</tr>\n'
      }
      html += '</tbody>\n'
    }
    return { html: html + '</table>\n', next: i }
  }

  function renderList (lines, start) {
    const first = lines[start].match(LIST_RE)
    const baseIndent = first[1].length
    const ordered = /^\d/.test(first[2])
    const items = []
    let i = start
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) {
        // Blank line: keep the list open only if it continues afterwards.
        let j = i + 1
        while (j < lines.length && !lines[j].trim()) j++
        const next = j < lines.length ? lines[j].match(LIST_RE) : null
        const indent = j < lines.length ? lines[j].match(/^\s*/)[0].length : 0
        if (j < lines.length && ((next && next[1].length >= baseIndent) || indent > baseIndent)) {
          i = j
          continue
        }
        break
      }
      const m = line.match(LIST_RE)
      if (m) {
        const indent = m[1].length
        const isOrdered = /^\d/.test(m[2])
        if (indent < baseIndent) break
        if (indent > baseIndent) {
          if (!items.length) break
          const sub = renderList(lines, i) // nested level, recursive
          items[items.length - 1].children.push(sub.html)
          i = sub.next
          continue
        }
        if (isOrdered !== ordered) break
        items.push({ text: m[3].trim(), children: [] })
        i++
        continue
      }
      // Continuation text for the current item (indented or lazy).
      if (!items.length || isBlockStart(line)) break
      items[items.length - 1].text += ' ' + line.trim()
      i++
    }
    const tag = ordered ? 'ol' : 'ul'
    let html = `<${tag}>\n`
    for (const item of items) html += `<li>${inline(item.text)}${item.children.join('')}</li>\n`
    return { html: html + `</${tag}>\n`, next: i }
  }

  function renderBlocks (lines) {
    const out = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) { i++; continue }
      let m

      if ((m = line.match(FENCE_RE))) {
        const fence = m[1]
        const lang = (m[2].trim().split(/\s+/)[0] || '').replace(/[^\w+.-]/g, '')
        const body = []
        i++
        while (i < lines.length) {
          const close = lines[i].match(FENCE_RE)
          if (close && close[1][0] === fence[0] && close[1].length >= fence.length && !close[2].trim()) {
            i++
            break
          }
          body.push(lines[i])
          i++
        }
        const code = body.join('\n')
        const cls = lang ? ` class="language-${lang}"` : ''
        out.push(`<pre><code${cls}>${esc(code)}${code ? '\n' : ''}</code></pre>\n`)
        continue
      }

      if ((m = line.match(HEADING_RE))) {
        const text = (m[2] || '').replace(/[ \t]+#+[ \t]*$/, '').trim()
        out.push(`<h${m[1].length}>${inline(text)}</h${m[1].length}>\n`); i++; continue
      }
      if (HR_RE.test(line)) { out.push('<hr>\n'); i++; continue }

      if ((m = line.match(QUOTE_RE))) {
        const inner = []
        while (i < lines.length) {
          const q = lines[i].match(QUOTE_RE)
          if (q) { inner.push(q[1]); i++; continue }
          if (!lines[i].trim() && i + 1 < lines.length && QUOTE_RE.test(lines[i + 1])) {
            inner.push('')
            i++
            continue
          }
          break
        }
        out.push(`<blockquote>\n${renderBlocks(inner)}</blockquote>\n`)
        continue
      }

      if (LIST_RE.test(line)) {
        const list = renderList(lines, i)
        out.push(list.html); i = list.next; continue
      }
      if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
        const table = renderTable(lines, i)
        out.push(table.html)
        i = table.next
        continue
      }

      const para = []
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
        para.push(lines[i])
        i++
      }
      if (para.length) out.push(`<p>${inline(paragraphText(para))}</p>\n`)
    }
    return out.join('')
  }

  function render (markdown) {
    const src = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
    return renderBlocks(src.split('\n'))
  }

  return { render }
})()
