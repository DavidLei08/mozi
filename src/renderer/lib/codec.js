'use strict'

/**
 * Pure text codec helpers used by the toolbox views.
 * No DOM access, so this file can be unit-tested in Node:
 *   global.window = {}; require('.../codec.js'); const C = global.window.Codec
 */
window.Codec = (function () {
  // ---------------------------------------------------------------- JavaScript string
  function escapeJs (text) {
    return String(text).replace(/[\\'"\n\r\t\b\f\v\u2028\u2029\u0000-\u001f]/g, (ch) => {
      switch (ch) {
        case '\\': return '\\\\'
        case "'": return "\\'"
        case '"': return '\\"'
        case '\n': return '\\n'
        case '\r': return '\\r'
        case '\t': return '\\t'
        case '\b': return '\\b'
        case '\f': return '\\f'
        case '\v': return '\\v'
        case '\u2028': return '\\u2028'
        case '\u2029': return '\\u2029'
        default: return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
      }
    })
  }

  function unescapeJs (text) {
    return String(text).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\\'"`bfnrtv0])/g, (match, seq) => {
      if (seq[0] === 'u') {
        if (seq[1] === '{') return String.fromCodePoint(parseInt(seq.slice(2, -1), 16))
        return String.fromCharCode(parseInt(seq.slice(1), 16))
      }
      if (seq[0] === 'x') return String.fromCharCode(parseInt(seq.slice(1), 16))
      const map = { '\\': '\\', "'": "'", '"': '"', '`': '`', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0' }
      return map[seq] !== undefined ? map[seq] : match
    })
  }

  // ---------------------------------------------------------------- JSON string
  function escapeJson (text) {
    return JSON.stringify(String(text)).slice(1, -1)
  }

  function unescapeJson (text) {
    const raw = String(text)
    try {
      return JSON.parse('"' + raw.replace(/\r?\n/g, '\\n') + '"')
    } catch {
      return unescapeJs(raw)
    }
  }

  // ---------------------------------------------------------------- URL
  function urlEncode (text) {
    return encodeURIComponent(String(text))
  }

  function urlDecode (text) {
    try { return decodeURIComponent(String(text)) } catch { return String(text) }
  }

  // ---------------------------------------------------------------- HTML entities
  const HTML_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const HTML_REVERSE = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: '\u00a0' }

  function escapeHtml (text) {
    return String(text).replace(/[&<>"']/g, (ch) => HTML_MAP[ch])
  }

  function unescapeHtml (text) {
    return String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : match
      }
      const mapped = HTML_REVERSE[body.toLowerCase()]
      return mapped !== undefined ? mapped : match
    })
  }

  // ---------------------------------------------------------------- Unicode
  function unicodeEscape (text) {
    let out = ''
    for (const ch of String(text)) {
      const code = ch.codePointAt(0)
      if (code > 0xffff) {
        const high = Math.floor((code - 0x10000) / 0x400) + 0xd800
        const low = ((code - 0x10000) % 0x400) + 0xdc00
        out += '\\u' + high.toString(16).padStart(4, '0') + '\\u' + low.toString(16).padStart(4, '0')
      } else if (code < 0x20 || code > 0x7e) {
        out += '\\u' + code.toString(16).padStart(4, '0')
      } else {
        out += ch
      }
    }
    return out
  }

  function unicodeUnescape (text) {
    return String(text).replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (match, braced, four) =>
      String.fromCodePoint(parseInt(braced || four, 16))
    )
  }

  // ---------------------------------------------------------------- Base64
  function utf8ToBase64 (text) {
    const bytes = new TextEncoder().encode(String(text))
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  }

  function base64ToUtf8 (b64) {
    const binary = atob(String(b64))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }

  function toUrlSafe (b64) {
    return String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function fromUrlSafe (b64) {
    let s = String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')
    const pad = s.length % 4
    if (pad) s += '='.repeat(4 - pad)
    return s
  }

  function base64Encode (text, urlSafe) {
    const b64 = utf8ToBase64(text)
    return urlSafe ? toUrlSafe(b64) : b64
  }

  function base64Decode (text, urlSafe) {
    const normalized = fromUrlSafe(urlSafe ? String(text) : String(text).replace(/\s+/g, ''))
    return base64ToUtf8(normalized)
  }

  function looksLikeBase64 (text) {
    const s = String(text).trim()
    return s.length > 0 && s.length % 4 !== 1 && /^[A-Za-z0-9+/=_\-\s]+$/.test(s)
  }

  // ---------------------------------------------------------------- JSON tools
  function parseJson (text) {
    try {
      return { ok: true, value: JSON.parse(text) }
    } catch (err) {
      return { ok: false, error: err.message, position: positionOf(err, text) }
    }
  }

  function positionOf (err, text) {
    const msg = String(err.message || '')
    let m = /position (\d+)/i.exec(msg)
    if (m) {
      const idx = Number(m[1])
      const before = text.slice(0, idx)
      const lines = before.split('\n')
      return { index: idx, line: lines.length, column: lines[lines.length - 1].length + 1 }
    }
    m = /line (\d+) column (\d+)/i.exec(msg)
    if (m) return { line: Number(m[1]), column: Number(m[2]) }
    return null
  }

  function formatJson (text, indent) {
    const parsed = parseJson(text)
    if (!parsed.ok) return { ok: false, error: parsed.error, position: parsed.position }
    return { ok: true, text: JSON.stringify(parsed.value, null, indent) }
  }

  function minifyJson (text) {
    const parsed = parseJson(text)
    if (!parsed.ok) return { ok: false, error: parsed.error, position: parsed.position }
    return { ok: true, text: JSON.stringify(parsed.value) }
  }

  function sortJsonKeys (value) {
    if (Array.isArray(value)) return value.map(sortJsonKeys)
    if (value && typeof value === 'object') {
      const out = {}
      for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) out[key] = sortJsonKeys(value[key])
      return out
    }
    return value
  }

  function statsJson (value) {
    let keys = 0
    let nodes = 0
    const walk = (node) => {
      nodes++
      if (Array.isArray(node)) {
        for (const item of node) walk(item)
      } else if (node && typeof node === 'object') {
        for (const key of Object.keys(node)) { keys++; walk(node[key]) }
      }
    }
    walk(value)
    return { keys, nodes }
  }

  // ---------------------------------------------------------------- image helpers
  const IMAGE_MIME = /^image\/(png|jpeg|jpg|gif|webp|svg\+xml|bmp|x-icon|avif)$/i

  function normalizeDataUrl (input) {
    const text = String(input || '').trim()
    if (!text) return null
    const dataUrl = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(text)
    if (dataUrl) {
      const mime = dataUrl[1] || 'application/octet-stream'
      if (dataUrl[2]) return { mime, base64: dataUrl[3].replace(/\s+/g, ''), dataUrl: text }
      return { mime, base64: utf8ToBase64(decodeURIComponent(dataUrl[3])), dataUrl: text }
    }
    const clean = text.replace(/\s+/g, '')
    if (!looksLikeBase64(clean)) return null
    const mime = sniffImageMime(fromUrlSafe(clean)) || 'image/png'
    return { mime, base64: clean, dataUrl: `data:${mime};base64,${clean}` }
  }

  function sniffImageMime (b64) {
    const signatures = [
      ['iVBORw0KGgo', 'image/png'],
      ['/9j/', 'image/jpeg'],
      ['R0lGOD', 'image/gif'],
      ['UklGR', 'image/webp'],
      ['Qk0', 'image/bmp'],
      ['AAABAA', 'image/x-icon'],
      ['PHN2Zy', 'image/svg+xml']
    ]
    for (const [prefix, mime] of signatures) if (b64.startsWith(prefix)) return mime
    return null
  }

  function byteLengthOfBase64 (b64) {
    const clean = String(b64).replace(/=+$/, '').replace(/\s+/g, '')
    return Math.floor(clean.length * 3 / 4)
  }

  function humanSize (bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  return {
    escapeJs,
    unescapeJs,
    escapeJson,
    unescapeJson,
    urlEncode,
    urlDecode,
    escapeHtml,
    unescapeHtml,
    unicodeEscape,
    unicodeUnescape,
    utf8ToBase64,
    base64ToUtf8,
    toUrlSafe,
    fromUrlSafe,
    base64Encode,
    base64Decode,
    looksLikeBase64,
    normalizeDataUrl,
    sniffImageMime,
    byteLengthOfBase64,
    humanSize,
    parseJson,
    formatJson,
    minifyJson,
    sortJsonKeys,
    statsJson,
    IMAGE_MIME
  }
})()
