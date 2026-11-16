'use strict'

// MD5 is provided for checksum compatibility; Web Crypto supplies SHA algorithms.
;(function (root) {
  function md5 (input) {
    const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64)
    bytes.set(input)
    bytes[input.length] = 0x80
    const view = new DataView(bytes.buffer)
    view.setUint32(bytes.length - 8, (input.length * 8) >>> 0, true)
    view.setUint32(bytes.length - 4, Math.floor(input.length / 0x20000000), true)
    const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
    const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0)
    const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
    for (let offset = 0; offset < bytes.length; offset += 64) {
      let [a, b, c, d] = state
      for (let i = 0; i < 64; i++) {
        let f, g
        if (i < 16) { f = (b & c) | (~b & d); g = i }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
        else { f = c ^ (b | ~d); g = (7 * i) % 16 }
        const x = (a + f + k[i] + view.getUint32(offset + g * 4, true)) | 0
        const shift = shifts[Math.floor(i / 16) * 4 + i % 4]
        ;[a, b, c, d] = [d, (b + ((x << shift) | (x >>> (32 - shift)))) | 0, b, c]
      }
      ;[a, b, c, d].forEach((v, i) => { state[i] = (state[i] + v) | 0 })
    }
    const out = new DataView(new ArrayBuffer(16))
    state.forEach((v, i) => out.setUint32(i * 4, v, true))
    return hex(new Uint8Array(out.buffer))
  }
  function hex (bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') }
  function decode (text, encoding) {
    const value = String(text || '')
    if (encoding === 'hex') {
      const clean = value.replace(/\s+/g, '')
      if (!/^(?:[\da-f]{2})+$/i.test(clean)) throw new Error('Hex 输入必须是完整的十六进制字节')
      return Uint8Array.from(clean.match(/../g), (s) => parseInt(s, 16))
    }
    if (encoding === 'base64') {
      return Uint8Array.from(atob(value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')), (s) => s.charCodeAt(0))
    }
    return new TextEncoder().encode(value)
  }
  async function digest (bytes, algorithms = ['sha256']) {
    const hashes = {}
    for (const name of algorithms) {
      if (name === 'md5') hashes[name] = md5(bytes)
      else {
        const algorithm = { sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' }[name]
        if (!algorithm) throw new Error(`不支持的算法: ${name}`)
        hashes[name] = hex(new Uint8Array(await crypto.subtle.digest(algorithm, bytes)))
      }
    }
    return { ok: true, algorithms, hashes, bytes: bytes.length }
  }
  const api = { md5, decode, digest }
  if (typeof module !== 'undefined') module.exports = api
  else root.ExtensionHash = api
})(globalThis)
