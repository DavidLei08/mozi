'use strict'

/**
 * JWT decode / HS256 verify for the toolbox.
 * Pure strings + Web Crypto, no DOM, unit-testable in Node:
 *   global.window = {}; require('.../jwt.js'); const J = global.window.Jwt
 */
window.Jwt = (function () {
  const B64URL_RE = /^[A-Za-z0-9_-]*$/
  const B64_CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

  // base64url (unpadded, -/_) -> bytes, pure string handling
  function b64urlToBytes (s) {
    if (!B64URL_RE.test(s)) throw new Error('base64url 含非法字符')
    if (s.length % 4 === 1) throw new Error('base64url 长度非法')
    const bytes = []
    let acc = 0
    let nbits = 0
    for (const ch of s) {
      acc = (acc << 6) | B64_CH.indexOf(ch)
      nbits += 6
      if (nbits >= 8) { nbits -= 8; bytes.push((acc >> nbits) & 0xff) }
    }
    return new Uint8Array(bytes)
  }

  function b64urlToText (s) {
    if (typeof s !== 'string') throw new TypeError('not a string')
    if (!s) return ''
    return new TextDecoder('utf-8').decode(b64urlToBytes(s))
  }

  function toMs (v) { return typeof v === 'number' && isFinite(v) ? v * 1000 : null }

  function toDate (v) {
    const ms = toMs(v)
    return ms === null ? null : new Date(ms)
  }

  function decode (token) {
    if (typeof token !== 'string' || !token.trim()) return { ok: false, error: 'token 为空或不是字符串' }
    const parts = token.trim().split('.')
    if (parts.length !== 3) return { ok: false, error: '段数不对：JWT 应为 3 段（header.payload.signature），实际 ' + parts.length + ' 段' }
    const [h, p, sig] = parts
    let header, payload, headerText, payloadText
    try {
      headerText = b64urlToText(h)
    } catch (e) { return { ok: false, error: 'header 段 ' + e.message } }
    try {
      payloadText = b64urlToText(p)
    } catch (e) { return { ok: false, error: 'payload 段 ' + e.message } }
    try {
      header = JSON.parse(headerText || 'null')
    } catch (e) { return { ok: false, error: 'header 段 JSON 解析失败：' + e.message } }
    if (header === null || typeof header !== 'object' || Array.isArray(header)) return { ok: false, error: 'header 段不是 JSON 对象' }
    try {
      payload = JSON.parse(payloadText || 'null')
    } catch (e) { return { ok: false, error: 'payload 段 JSON 解析失败：' + e.message } }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'payload 段不是 JSON 对象' }

    const keys = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti']
    const claims = {}
    for (const k of keys) claims[k] = payload[k]

    const now = Date.now()
    const expDate = toDate(payload.exp)
    const iatDate = toDate(payload.iat)
    const nbfDate = toDate(payload.nbf)
    const expired = expDate !== null && expDate.getTime() <= now
    const notYetValid = nbfDate !== null && nbfDate.getTime() > now
    const expiresInMs = expDate !== null ? expDate.getTime() - now : null

    return {
      ok: true, header, payload, signature: sig, alg: header.alg, typ: header.typ,
      headerText, payloadText, claims,
      time: { expDate, iatDate, nbfDate, expired, notYetValid, expiresInMs }
    }
  }

  // constant-time byte comparison (no early exit)
  function timingSafeEqualBytes (a, b) {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    return diff === 0
  }

  async function verifyHs256 (token, secret) {
    const d = decode(token)
    if (!d.ok) return { ok: false, valid: false, error: d.error }
    if (d.alg !== 'HS256') return { ok: false, valid: false, error: 'alg 不是 HS256，实际为 ' + String(d.alg) }
    if (typeof secret !== 'string') return { ok: false, valid: false, error: 'secret 必须是字符串' }
    const subtle = globalThis.crypto && globalThis.crypto.subtle
    if (!subtle) return { ok: false, valid: false, error: '当前环境缺少 Web Crypto（crypto.subtle）' }
    try {
      const enc = new TextEncoder()
      const key = await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const sigBuf = new Uint8Array(await subtle.sign('HMAC', key, enc.encode(token.trim().split('.').slice(0, 2).join('.'))))
      const expected = b64urlToBytes(d.signature)
      return { ok: true, valid: timingSafeEqualBytes(sigBuf, expected) }
    } catch (e) {
      return { ok: false, valid: false, error: 'HMAC 计算失败：' + e.message }
    }
  }

  function fmtDur (ms) {
    const s = Math.round(ms / 1000)
    if (s < 60) return s + ' 秒'
    const m = Math.round(s / 60)
    if (m < 60) return m + ' 分钟'
    const h = Math.round(m / 60)
    if (h < 24) return h + ' 小时'
    return Math.round(h / 24) + ' 天'
  }

  function textSummary (payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '无声明'
    const who = payload.sub !== undefined ? 'sub=' + String(payload.sub)
      : payload.iss !== undefined ? 'iss=' + String(payload.iss)
        : payload.jti !== undefined ? 'jti=' + String(payload.jti) : ''
    const now = Date.now()
    const expMs = toMs(payload.exp)
    const nbfMs = toMs(payload.nbf)
    let time = ''
    if (expMs !== null) {
      if (expMs <= now) time = '已过期 ' + fmtDur(now - expMs)
      else if (nbfMs !== null && nbfMs > now) time = '尚未生效，' + fmtDur(nbfMs - now) + '后可用'
      else time = '剩余 ' + fmtDur(expMs - now)
    } else if (nbfMs !== null && nbfMs > now) {
      time = '尚未生效，' + fmtDur(nbfMs - now) + '后可用'
    } else if (toMs(payload.iat) !== null) {
      time = '签发于 ' + fmtDur(Math.max(0, now - toMs(payload.iat))) + '前'
    }
    if (!time) return '无时间声明'
    return who ? who + ' · ' + time : time
  }

  return { decode, verifyHs256, b64urlToText, textSummary }
})()
