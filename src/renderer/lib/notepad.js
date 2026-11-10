'use strict';

/**
 * Notepad logic for Mozi — HTML sanitising, titles and image insertion.
 * No DOM, no storage, no i18n, so every rule below is unit tested.
 *
 * The editor is contenteditable, so whatever ends up in storage is also
 * whatever gets rendered back with innerHTML. sanitize() is the trust boundary:
 * it keeps a small allowlist of formatting tags and drops everything else,
 * including script/style bodies.
 */
(function (root) {
  const ALLOWED = new Set([
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code', 'pre',
    'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'span', 'div',
    'hr', 'figure', 'figcaption'
  ])
  const VOID = new Set(['br', 'hr', 'img'])
  const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'noscript', 'template', 'svg']
  const SAFE_HREF = /^(https?:|mailto:|file:)/i
  const SCHEME = /^[a-z][a-z0-9+.-]*:/i
  const TITLE_LIMIT = 60

  function uid () {
    return `nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  function emptyNote (now) {
    const stamp = (now instanceof Date ? now : new Date(now == null ? Date.now() : now)).toISOString()
    // titleEdited: a hand-typed title must never be overwritten by the
    // first line of the body, which is only a fallback label
    return { id: uid(), title: '', titleEdited: false, html: '', createdAt: stamp, updatedAt: stamp }
  }

  function escAttr (value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  /** data/http(s)/file URLs, protocol-relative and plain relative paths are fine. */
  function isSafeImage (src) {
    const value = String(src == null ? '' : src).trim()
    if (!value) return false
    if (/^data:image\//i.test(value)) return true
    if (/^(https?:|file:)/i.test(value)) return true
    if (value.startsWith('//')) return true
    return !SCHEME.test(value)
  }

  function stripDangerousBlocks (html) {
    let out = String(html).replace(/<!--[\s\S]*?-->/g, '')
    const paired = new RegExp(`<(${DROP_WITH_CONTENT.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi')
    out = out.replace(paired, '')
    const dangling = new RegExp(`</?(${DROP_WITH_CONTENT.join('|')})\\b[^>]*>`, 'gi')
    return out.replace(dangling, '')
  }

  function parseAttrs (raw) {
    const attrs = []
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    let m
    while ((m = re.exec(raw || ''))) {
      const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : ''
      attrs.push([m[1].toLowerCase(), value])
    }
    return attrs
  }

  function attrOf (attrs, name) {
    const hit = attrs.find((a) => a[0] === name)
    return hit ? hit[1] : ''
  }

  function sanitize (html) {
    if (typeof html !== 'string' || !html) return ''
    const src = stripDangerousBlocks(html)
    const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
    let out = ''
    let last = 0
    let m
    while ((m = tagRe.exec(src))) {
      out += src.slice(last, m.index)
      last = tagRe.lastIndex
      const name = m[1].toLowerCase()
      const closing = m[0].charAt(1) === '/'
      if (!ALLOWED.has(name)) continue // drop the tag, keep its text

      if (name === 'img') {
        if (closing) continue
        const attrs = parseAttrs(m[2])
        const imgSrc = attrOf(attrs, 'src')
        if (!isSafeImage(imgSrc)) continue // an unsafe image goes away entirely
        out += `<img src="${escAttr(imgSrc)}" alt="${escAttr(attrOf(attrs, 'alt'))}">`
        continue
      }
      if (name === 'a') {
        if (closing) { out += '</a>'; continue }
        const href = attrOf(parseAttrs(m[2]), 'href')
        out += SAFE_HREF.test(href.trim()) ? `<a href="${escAttr(href)}">` : '<a>'
        continue
      }
      if (VOID.has(name)) { out += `<${name}>`; continue }
      out += closing ? `</${name}>` : `<${name}>`
    }
    return out + src.slice(last)
  }

  const ENTITIES = [
    [/&nbsp;/gi, ' '], [/&lt;/gi, '<'], [/&gt;/gi, '>'],
    [/&quot;/gi, '"'], [/&#0*39;/g, "'"], [/&#x27;/gi, "'"], [/&amp;/gi, '&']
  ]

  function plainText (html) {
    if (typeof html !== 'string' || !html) return ''
    let text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h1|h2|h3|li|blockquote|pre|figure|figcaption)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
    for (const [re, replacement] of ENTITIES) text = text.replace(re, replacement)
    return text
      .split('\n')
      .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  function titleFrom (html, fallback) {
    const text = plainText(html)
    const first = (text.split('\n').find((line) => line.trim()) || '').trim()
    if (!first) return fallback === undefined ? '' : fallback
    return first.length > TITLE_LIMIT ? `${first.slice(0, TITLE_LIMIT - 1)}…` : first
  }

  function insertImage (html, src, alt) {
    const base = typeof html === 'string' ? html : ''
    if (!isSafeImage(src)) return base
    const label = String(alt == null ? '' : alt).trim()
    const caption = label ? `<figcaption>${escAttr(label)}</figcaption>` : ''
    return `${base}<figure><img src="${escAttr(String(src).trim())}" alt="${escAttr(label)}">${caption}</figure>`
  }

  function wordCount (html) {
    const text = plainText(html)
    const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length
    const latin = (text.match(/[A-Za-z0-9_\u00c0-\u024f]+/g) || []).length
    return { chars: text.length, words: cjk + latin }
  }

  const Notepad = { emptyNote, sanitize, titleFrom, plainText, isSafeImage, insertImage, wordCount, TITLE_LIMIT }

  if (typeof module !== 'undefined' && module.exports) module.exports = Notepad
  if (root) root.Notepad = Notepad
})(typeof window !== 'undefined' ? window : null)
