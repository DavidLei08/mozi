'use strict'

/** cURL <-> request conversion. Used by the cURL import/export buttons. */
window.Curl = (function () {
  const VALUE_FLAGS = new Set([
    '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
    '--data-urlencode', '-F', '--form', '-u', '--user', '-A', '--user-agent', '-e', '--referer',
    '-b', '--cookie', '--url', '-o', '--output', '-x', '--proxy', '--connect-timeout', '-m', '--max-time',
    '--retry', '--cacert', '--cert', '--key', '-T', '--upload-file', '--resolve', '-w', '--write-out'
  ])
  const BOOL_FLAGS = new Set(['-k', '--insecure', '-L', '--location', '-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-i', '--include', '--compressed', '-I', '--head', '-f', '--fail', '-g', '--globoff', '--no-buffer', '-N'])

  function tokenize (input) {
    const tokens = []
    let i = 0
    const n = input.length
    while (i < n) {
      const ch = input[i]
      if (ch === '\\' && (input[i + 1] === '\n' || input[i + 1] === '\r')) {
        i += input[i + 1] === '\r' && input[i + 2] === '\n' ? 3 : 2
        continue
      }
      if (/\s/.test(ch)) { i++; continue }
      if (ch === '#' && (i === 0 || /\s/.test(input[i - 1]))) {
        while (i < n && input[i] !== '\n') i++
        continue
      }
      if (ch === "'" ) {
        let out = ''
        i++
        while (i < n && input[i] !== "'") { out += input[i]; i++ }
        i++
        tokens.push({ value: out, quoted: true })
        continue
      }
      if (ch === '"') {
        let out = ''
        i++
        while (i < n && input[i] !== '"') {
          if (input[i] === '\\' && i + 1 < n) {
            const next = input[i + 1]
            if (next === '"' || next === '\\' || next === '$' || next === '`') { out += next; i += 2; continue }
            if (next === 'n') { out += '\n'; i += 2; continue }
            if (next === 't') { out += '\t'; i += 2; continue }
            if (next === 'r') { out += '\r'; i += 2; continue }
            out += input[i]; i++; continue
          }
          out += input[i]; i++
        }
        i++
        tokens.push({ value: out, quoted: true })
        continue
      }
      if (ch === '$' && input[i + 1] === "'") {
        let out = ''
        i += 2
        while (i < n && input[i] !== "'") {
          if (input[i] === '\\' && i + 1 < n) {
            const esc = input[i + 1]
            const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' }
            if (esc in map) { out += map[esc]; i += 2; continue }
            if (esc === 'x' && /^[0-9a-fA-F]{2}$/.test(input.slice(i + 2, i + 4))) {
              out += String.fromCharCode(parseInt(input.slice(i + 2, i + 4), 16)); i += 4; continue
            }
            out += esc; i += 2; continue
          }
          out += input[i]; i++
        }
        i++
        tokens.push({ value: out, quoted: true })
        continue
      }
      let out = ''
      while (i < n && !/\s/.test(input[i])) {
        if (input[i] === '\\' && i + 1 < n) { out += input[i + 1]; i += 2; continue }
        out += input[i]; i++
      }
      tokens.push({ value: out, quoted: false })
    }
    return tokens
  }

  function parse (input) {
    const text = String(input || '').trim()
    if (!text) return { ok: false, error: 'Empty input' }
    if (!/^curl\b/i.test(text)) {
      return { ok: false, error: 'Not a cURL command — it should start with "curl"' }
    }
    const tokens = tokenize(text)
    const rest = tokens.slice(1)

    const request = {
      method: 'GET',
      url: '',
      kind: 'http',
      headers: [],
      params: [],
      body: { type: 'none', text: '', contentType: '', graphql: { query: '', variables: '' }, formUrlencoded: [], formData: [], filePath: '', fileName: '' },
      auth: { type: 'none' },
      options: { followRedirects: false, insecure: false }
    }

    let method = ''
    let headers = []
    let dataParts = []
    let dataKind = 'raw'
    let forms = []
    let url = ''
    let user = ''
    let urlencodedPairs = []
    const warnings = []

    for (let idx = 0; idx < rest.length; idx++) {
      const tok = rest[idx]
      const val = tok.value

      if (BOOL_FLAGS.has(val)) {
        if (val === '-k' || val === '--insecure') request.options.insecure = true
        if (val === '-L' || val === '--location') request.options.followRedirects = true
        if (val === '-I' || val === '--head') method = 'HEAD'
        continue
      }

      if (VALUE_FLAGS.has(val)) {
        const next = rest[idx + 1]
        const value = next ? next.value : ''
        idx++
        switch (val) {
          case '-X': case '--request': method = value.toUpperCase(); break
          case '-H': case '--header': headers.push(value); break
          case '-d': case '--data': case '--data-ascii': dataParts.push(value); break
          case '--data-raw': dataParts.push(value); break
          case '--data-binary': dataParts.push(value.replace(/^@/, '')); dataKind = 'binary-file'; break
          case '--data-urlencode': urlencodedPairs.push(value); break
          case '-F': case '--form': forms.push(value); break
          case '-u': case '--user': user = value; break
          case '-A': case '--user-agent': headers.push(`User-Agent: ${value}`); break
          case '-e': case '--referer': headers.push(`Referer: ${value}`); break
          case '-b': case '--cookie': headers.push(`Cookie: ${value}`); break
          case '--url': url = value; break
          case '-T': case '--upload-file': dataParts.push(value.replace(/^@/, '')); dataKind = 'binary-file'; break
          default: warnings.push(`Ignored option ${val}`); break
        }
        continue
      }

      if (tok.quoted || !val.startsWith('-')) {
        if (!url) url = val
        else warnings.push(`Ignored extra argument "${val}"`)
      }
    }

    if (!url) return { ok: false, error: 'No URL found in the cURL command' }

    const headerList = []
    let contentType = ''
    for (const h of headers) {
      const colon = h.indexOf(':')
      if (colon < 0) { warnings.push(`Ignored malformed header "${h}"`); continue }
      const key = h.slice(0, colon).trim()
      const value = h.slice(colon + 1).trim()
      headerList.push({ key, value, enabled: true })
      if (/^content-type$/i.test(key)) contentType = value
    }

    // Auth
    if (user) {
      if (user.includes(':')) {
        const at = user.indexOf(':')
        request.auth = { type: 'basic', username: user.slice(0, at), password: user.slice(at + 1) }
      } else {
        request.auth = { type: 'bearer', token: user }
      }
    }
    const authHeader = headerList.find((h) => /^authorization$/i.test(h.key))
    if (authHeader && /^bearer\s+/i.test(authHeader.value)) {
      request.auth = { type: 'bearer', token: authHeader.value.replace(/^bearer\s+/i, '') }
      headerList.splice(headerList.indexOf(authHeader), 1)
    }

    // Body
    if (forms.length) {
      request.body.type = 'form-data'
      for (const f of forms) {
        const eq = f.indexOf('=')
        if (eq < 0) continue
        const key = f.slice(0, eq)
        const value = f.slice(eq + 1)
        if (value.startsWith('@')) {
          request.body.formData.push({ key, type: 'file', path: value.slice(1), fileName: value.slice(1).split('/').pop(), enabled: true })
        } else {
          request.body.formData.push({ key, type: 'text', value, enabled: true })
        }
      }
    } else if (dataParts.length) {
      const data = dataParts.join('&')
      if (/json/i.test(contentType)) {
        request.body.type = 'json'
        request.body.text = prettifyJson(data)
      } else if (/x-www-form-urlencoded/i.test(contentType)) {
        request.body.type = 'form-urlencoded'
        request.body.formUrlencoded = parseUrlencoded(data)
      } else if (dataKind === 'binary-file') {
        request.body.type = 'binary'
        request.body.filePath = data
        request.body.fileName = data.split('/').pop()
      } else {
        request.body.type = 'text'
        request.body.text = data
        request.body.contentType = contentType || 'text/plain'
      }
      if (!method) method = 'POST'
    } else if (urlencodedPairs.length) {
      request.body.type = 'form-urlencoded'
      request.body.formUrlencoded = urlencodedPairs.map((p) => {
        const eq = p.indexOf('=')
        return eq < 0
          ? { key: p, value: '', enabled: true }
          : { key: p.slice(0, eq), value: decodeURIComponent(p.slice(eq + 1)), enabled: true }
      })
      if (!method) method = 'POST'
    }

    request.method = method || (request.body.type !== 'none' ? 'POST' : 'GET')
    request.headers = headerList.filter((h) => !/^content-type$/i.test(h.key) || true)

    // Split query params
    try {
      const u = new URL(url)
      request.url = u.origin + u.pathname
      request.params = [...u.searchParams.entries()].map(([key, value]) => ({ key, value, enabled: true }))
      if (!request.params.length) request.url = url
    } catch {
      request.url = url
    }

    return { ok: true, request, warnings }
  }

  function parseUrlencoded (data) {
    return data.split('&').filter(Boolean).map((pair) => {
      const eq = pair.indexOf('=')
      if (eq < 0) return { key: decodeSafe(pair), value: '', enabled: true }
      return { key: decodeSafe(pair.slice(0, eq)), value: decodeSafe(pair.slice(eq + 1)), enabled: true }
    })
  }

  function decodeSafe (s) {
    try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch { return s }
  }

  function prettifyJson (text) {
    try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
  }

  function quote (s) {
    return `'${String(s).replace(/'/g, "'\\''")}'`
  }

  /**
   * @param {{method:string,url:string,headers:Array,body:object,auth:object,options:object}} req
   * @param {Array<[string,string]>} resolvedHeaders headers after env substitution + auth injection
   */
  function build (req, resolvedUrl, resolvedHeaders, resolvedBody) {
    const parts = ['curl']
    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET' || (resolvedBody && resolvedBody.present)) parts.push(`-X ${method}`)
    parts.push(quote(resolvedUrl))

    for (const [k, v] of resolvedHeaders) parts.push(`-H ${quote(`${k}: ${v}`)}`)

    const body = req.body || { type: 'none' }
    if (body.type === 'form-data') {
      for (const f of body.formData || []) {
        if (f.enabled === false || !f.key) continue
        parts.push(f.type === 'file' && f.path
          ? `-F ${quote(`${f.key}=@${f.path}`)}`
          : `-F ${quote(`${f.key}=${resolve(f.value)}`)}`)
      }
    } else if (body.type === 'form-urlencoded') {
      for (const f of body.formUrlencoded || []) {
        if (f.enabled === false || !f.key) continue
        parts.push(`--data-urlencode ${quote(`${f.key}=${resolve(f.value)}`)}`)
      }
    } else if (body.type === 'binary' && body.filePath) {
      parts.push(`--data-binary ${quote(`@${body.filePath}`)}`)
    } else if (body.type === 'graphql') {
      const g = body.graphql || {}
      let variables = {}
      try { variables = g.variables ? JSON.parse(resolve(g.variables)) : {} } catch { variables = {} }
      const payload = JSON.stringify({ query: resolve(g.query || ''), variables, operationName: g.operationName || undefined })
      parts.push(`--data-raw ${quote(payload)}`)
    } else if (body.type !== 'none') {
      parts.push(`--data-raw ${quote(resolve(body.text || ''))}`)
    }

    const opts = req.options || {}
    if (opts.insecure) parts.push('-k')
    if (opts.followRedirects) parts.push('-L')
    parts.push('--compressed')

    return parts.join(' \\\n  ')

    function resolve (v) {
      return typeof window.resolveEnvString === 'function' ? window.resolveEnvString(String(v ?? '')) : String(v ?? '')
    }
  }

  return { parse, build, tokenize, quote }
})()
