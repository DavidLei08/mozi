'use strict'

/**
 * Minimal cookie jar for the request tool.
 * Pure logic so it is unit-testable in Node: window.Cookies = { Jar, parseSetCookie, match }
 */
const Cookies = (function () {
  const MAX_AGE_RE = /max-age=(-?\d+)/i

  function domainMatches (cookieDomain, requestHost) {
    const cd = String(cookieDomain || '').toLowerCase().replace(/^\./, '')
    const rh = String(requestHost || '').toLowerCase()
    if (!cd) return false
    if (cd === rh) return true
    // a cookie for example.com matches api.example.com but not notexample.com
    return rh.endsWith('.' + cd)
  }

  function pathMatches (cookiePath, requestPath) {
    const cp = String(cookiePath || '/').toLowerCase()
    const rp = String(requestPath || '/').toLowerCase()
    if (cp === '/') return true
    if (rp === cp) return true
    if (rp.startsWith(cp)) return rp[cp.length] === '/' || cp.endsWith('/')
    return false
  }

  /** Parse one Set-Cookie header value into a stored cookie. */
  function parseSetCookie (value, requestUrl) {
    const parts = String(value || '').split(';').map((p) => p.trim())
    if (!parts[0] || !parts[0].includes('=')) return null
    const eq = parts[0].indexOf('=')
    const name = parts[0].slice(0, eq).trim()
    const cookieValue = parts[0].slice(eq + 1).trim()
    if (!name) return null

    let url
    try { url = new URL(requestUrl) } catch { url = null }

    const cookie = {
      name,
      value: cookieValue,
      domain: url ? url.hostname.toLowerCase() : '',
      path: '/',
      secure: false,
      httpOnly: false,
      hostOnly: true,
      expires: null, // epoch ms or null (session)
      enabled: true
    }
    if (url) {
      const seg = url.pathname.split('/').filter(Boolean)
      cookie.path = seg.length ? `/${seg.slice(0, -1).join('/')}` : '/'
    }

    for (const attr of parts.slice(1)) {
      const a = attr.toLowerCase()
      if (a === 'secure') cookie.secure = true
      else if (a === 'httponly') cookie.httpOnly = true
      else if (a.startsWith('domain=')) {
        cookie.domain = attr.slice(7).trim().toLowerCase().replace(/^\./, '')
        cookie.hostOnly = false
      } else if (a.startsWith('path=')) {
        const p = attr.slice(5).trim()
        if (p.startsWith('/')) cookie.path = p
      } else if (a.startsWith('expires=')) {
        const t = Date.parse(attr.slice(8).trim())
        if (!Number.isNaN(t)) cookie.expires = t
      } else {
        const m = MAX_AGE_RE.exec(attr)
        if (m) cookie.expires = Date.now() + Number(m[1]) * 1000
      }
    }
    return cookie
  }

  function isExpired (cookie, now) {
    return cookie.expires !== null && cookie.expires <= (now || Date.now())
  }

  class Jar {
    constructor (entries) {
      this.cookies = Array.isArray(entries) ? entries : []
    }

    /** Store one Set-Cookie header for the given request URL. Mutates in
     *  place: callers share the backing array (state.cookies), so rebinding
     *  this.cookies here would silently drop their view of new entries. */
    store (setCookieValue, requestUrl) {
      const parsed = parseSetCookie(setCookieValue, requestUrl)
      if (!parsed) return null
      this.remove(parsed.name, parsed.domain, parsed.path)
      this.cookies.push(parsed)
      return parsed
    }

    remove (name, domain, path) {
      for (let i = this.cookies.length - 1; i >= 0; i--) {
        const c = this.cookies[i]
        if (c.name === name && (c.domain || '') === (domain || '') && (c.path || '/') === (path || '/')) this.cookies.splice(i, 1)
      }
    }

    clear () { this.cookies.length = 0 }

    /** Cookies that should be sent to url now. */
    match (url, now) {
      let parsed
      try { parsed = new URL(url) } catch { return [] }
      const host = parsed.hostname.toLowerCase()
      const secureRequest = parsed.protocol === 'https:'
      return this.cookies.filter((c) => {
        if (c.enabled === false) return false
        if (isExpired(c, now)) return false
        if (c.secure && !secureRequest) return false
        if (c.hostOnly && c.domain !== host) return false
        if (!c.hostOnly && !domainMatches(c.domain, host)) return false
        return pathMatches(c.path, parsed.pathname)
      })
    }

    headerValue (url, now) {
      const sorted = this.match(url, now).sort((a, b) => (a.path.length - b.path.length) * -1 || a.name.localeCompare(b.name))
      return sorted.map((c) => `${c.name}=${c.value}`).join('; ')
    }

    prune (now) {
      const before = this.cookies.length
      for (let i = this.cookies.length - 1; i >= 0; i--) {
        if (isExpired(this.cookies[i], now)) this.cookies.splice(i, 1)
      }
      return before - this.cookies.length
    }

    toJSON () { return this.cookies }
  }

  return { Jar, parseSetCookie, isExpired, domainMatches, pathMatches }
})()

// UMD-ish: browser global for the renderer, module.exports for the main process.
if (typeof window !== 'undefined') window.Cookies = Cookies
if (typeof module !== 'undefined' && module.exports) module.exports = Cookies
