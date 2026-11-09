'use strict'

/**
 * Request -> runnable code snippets (Python / JS / Node / Go / Java / cURL).
 * Pure string handling: no DOM access, loadable from Node for tests.
 */
window.Codegen = (function () {
  const languages = [
    { id: 'python', label: 'Python (requests)' },
    { id: 'javascript', label: 'JavaScript (fetch)' },
    { id: 'node-axios', label: 'Node.js (axios)' },
    { id: 'go', label: 'Go (net/http)' },
    { id: 'java', label: 'Java (OkHttp)' },
    { id: 'curl', label: 'cURL' }
  ]
  const BUILDERS = { python: python, javascript: javascript, 'node-axios': nodeAxios, go: go, java: java, curl: curl }
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip' }

  function generate (langId, request) {
    const fn = BUILDERS[String(langId)]
    if (!fn) return { ok: false, error: 'Unknown language: ' + langId }
    if (!request || !String(request.url || '')) return { ok: false, error: 'A request with a url is required' }
    try {
      return { ok: true, code: fn(prepare(request)) }
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) }
    }
  }

  /* ---------- shared preparation: url, query, headers, auth and body ---------- */

  function prepare (request) {
    const body = request.body || {}
    const opts = request.options || {}
    const auth = request.auth || {}
    const type = body.type || 'none'

    const query = on(request.params).map((p) => [s(p.key), s(p.value)])
    let headers = on(request.headers).map((h) => [s(h.key), s(h.value)])
    const ct = contentType(request, body, type)
    if (ct) headers = headers.filter((h) => !/^content-type$/i.test(h[0])).concat([['Content-Type', ct]])
    if (type === 'form-data') headers = headers.filter((h) => !/^content-type$/i.test(h[0]))

    const at = auth.type || 'none'
    if (at === 'bearer') headers.push(['Authorization', 'Bearer ' + s(auth.token)])
    else if (at === 'basic') headers.push(['Authorization', 'Basic ' + b64(s(auth.username) + ':' + s(auth.password))])
    else if (at === 'api-key' && auth.key) {
      if (String(auth.addTo) === 'query') query.push([s(auth.key), s(auth.value)])
      else headers.push([s(auth.key), s(auth.value)])
    }

    let filePath = s(body.filePath)
    if (type === 'binary' && !filePath) {
      const maybe = s(body.text).replace(/^@/, '')
      if (/^[\w.+\-/\\ ]*[/\\][\w.+\-/\\ ]+$/.test(maybe)) filePath = maybe
    }
    if (type === 'binary' && !filePath) throw new Error('Binary body has no file path')

    const gq = body.graphql || {}
    return {
      body, type,
      method: s(request.method || 'GET').toUpperCase() || 'GET',
      url: s(request.url),
      hasQuery: s(request.url).indexOf('?') >= 0,
      query, headers, ct,
      payload: type === 'graphql' ? JSON.stringify({ query: s(gq.query), variables: parseJson(s(gq.variables)) }) : s(body.text),
      formUrl: on(body.formUrlencoded).map((f) => [s(f.key), s(f.value)]),
      fields: (body.formData || []).filter((f) => f && String(f.key) && f.enabled !== false)
        .map((f) => ({ key: s(f.key), value: s(f.value), path: s(f.path), name: s(f.fileName) || s(f.path).split(/[\\/]/).pop(), file: f.type === 'file' })),
      filePath,
      follow: opts.followRedirects === true,
      insecure: opts.insecure === true
    }
  }

  function contentType (request, body, type) {
    const given = on(request.headers).filter((h) => /^content-type$/i.test(s(h.key))).pop()
    if (given) return s(given.value)
    if (type === 'json' || type === 'graphql') return 'application/json'
    if (type === 'form-urlencoded') return 'application/x-www-form-urlencoded'
    if (type === 'text') return s(body.contentType) || 'text/plain'
    if (type === 'binary') return mimeOf(s(body.fileName) || s(body.filePath))
    return ''
  }

  /* ---------- helpers ---------- */

  function s (v) { return v == null ? '' : String(v) }
  const on = (list) => (Array.isArray(list) ? list : []).filter((x) => x && s(x.key) && x.enabled !== false)
  function str (v) { return JSON.stringify(s(v)) }
  function parseJson (t) { if (!t) return {}; try { return JSON.parse(t) } catch { return {} } }
  function pct (v) { return encodeURIComponent(s(v)) }
  function mimeOf (name) { return MIME[s(name).toLowerCase().split('.').pop()] || 'application/octet-stream' }
  function formUrlRaw (c) { return c.formUrl.map((kv) => pct(kv[0]) + '=' + pct(kv[1])).join('&') }
  function warn (c, mark) { return c.insecure ? mark + ' TLS certificate verification is disabled here - review before running.' : '' }
  function emit (c, L, mark) {
    const out = []
    if (c.insecure) out.push(warn(c, mark || '//'))
    for (const line of L) {
      if (line === '' && (!out.length || out[out.length - 1] === '')) continue
      out.push(line)
    }
    while (out.length && out[out.length - 1] === '') out.pop()
    return out.join('\n') + '\n'
  }
  function flat (pairs) { return pairs.length ? '{ ' + pairs.map((kv) => `${str(kv[0])}: ${str(kv[1])}`).join(', ') + ' }' : '{}' }
  function braces (items) { return items.length ? '{\n    ' + items.join(',\n    ') + ',\n}' : '{}' }
  function obj (pairs) { return braces(pairs.map((kv) => `${str(kv[0])}: ${str(kv[1])}`)) }
  function b64 (text) {
    const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const bytes = []
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0)
      if (cp < 0x80) bytes.push(cp)
      else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63))
      else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
      else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    }
    let out = ''
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
      out += T[(n >> 18) & 63] + T[(n >> 12) & 63] + (i + 1 < bytes.length ? T[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? T[n & 63] : '=')
    }
    return out
  }

  /* ---------- Python (requests) ---------- */

  function python (c) {
    const L = ['import requests', '', 'url = ' + str(c.url), 'params = ' + obj(c.query), 'headers = ' + obj(c.headers)]
    const kw = []
    if (c.type === 'json' || c.type === 'text' || c.type === 'graphql') {
      L.push('', 'payload = ' + str(c.payload))
      kw.push('data=payload')
    } else if (c.type === 'form-urlencoded') {
      L.push('', 'data = ' + obj(c.formUrl))
      kw.push('data=data')
    } else if (c.type === 'form-data') {
      L.push('', 'files = ' + braces(c.fields.map((f) => f.file
        ? `${str(f.key)}: (${str(f.name)}, open(${str(f.path)}, 'rb'), ${str(mimeOf(f.name))})`
        : `${str(f.key)}: ${str(f.value)}`)))
      kw.push('files=files')
    } else if (c.type === 'binary') {
      L.push('', "payload = open(" + str(c.filePath) + ", 'rb').read()")
      kw.push('data=payload')
    }
    L.push('', 'response = requests.request(', `    ${str(c.method)},`, '    url,', '    headers=headers,', '    params=params,')
    for (const k of kw) L.push(`    ${k},`)
    L.push(`    allow_redirects=${c.follow ? 'True' : 'False'},`)
    if (c.insecure) L.push('    verify=False,')
    L.push(')', '', 'print(response.status_code)\nprint(response.text)')
    return emit(c, L, '#')
  }


  /* ---------- JavaScript (fetch) ---------- */

  function javascript (c) {
    const fs = c.type === 'binary' || c.fields.some((f) => f.file)
    const L = []
    if (fs) L.push("const fs = require('fs')", '')
    L.push('const url = new URL(' + str(c.url) + ')')
    for (const kv of c.query) L.push(`url.searchParams.append(${str(kv[0])}, ${str(kv[1])})`)
    L.push('', 'const headers = new Headers(' + obj(c.headers) + ')')
    let bodyExpr = ''
    if (c.type === 'form-data') {
      L.push('const form = new FormData()')
      for (const f of c.fields) L.push(f.file
        ? `form.append(${str(f.key)}, new Blob([fs.readFileSync(${str(f.path)})], { type: ${str(mimeOf(f.name))} }), ${str(f.name)})`
        : `form.append(${str(f.key)}, ${str(f.value)})`)
      L.push('', 'const body = form')
      bodyExpr = 'body'
    } else if (c.type === 'form-urlencoded') {
      L.push('const body = new URLSearchParams(' + obj(c.formUrl) + ').toString()')
      bodyExpr = 'body'
    } else if (c.type === 'json' || c.type === 'text' || c.type === 'graphql') {
      L.push('const body = ' + str(c.payload))
      bodyExpr = 'body'
    } else if (c.type === 'binary') {
      L.push('const body = new Blob([fs.readFileSync(' + str(c.filePath) + ')])')
      bodyExpr = 'body'
    }
    L.push('', 'const response = await fetch(url, {', `  method: ${str(c.method)},`, '  headers,')
    if (bodyExpr) L.push(`  body: ${bodyExpr},`)
    L.push(`  redirect: '${c.follow ? 'follow' : 'manual'}'`, '})', '', 'console.log(response.status)\nconsole.log(await response.text())')
    return emit(c, L)
  }


  /* ---------- Node.js (axios) ---------- */

  function nodeAxios (c) {
    const isForm = c.type === 'form-data'
    const needFs = isForm || c.type === 'binary'
    const L = ["const axios = require('axios')"]
    if (needFs) L.push("const fs = require('fs')")
    if (isForm) L.push("const FormData = require('form-data')")
    if (isForm) {
      L.push('', 'const form = new FormData()')
      for (const f of c.fields) L.push(f.file
        ? `form.append(${str(f.key)}, fs.readFileSync(${str(f.path)}), { filename: ${str(f.name)}, contentType: ${str(mimeOf(f.name))} })`
        : `form.append(${str(f.key)}, ${str(f.value)})`)
    }
    const cfg = [`  method: ${str(c.method.toLowerCase())}`, `  url: ${str(c.url)}`]
    if (c.query.length) cfg.push('  params: ' + flat(c.query))
    cfg.push('  headers: ' + (isForm ? `Object.assign(${flat(c.headers)}, form.getHeaders())` : flat(c.headers)))
    if (c.type === 'json' || c.type === 'text' || c.type === 'graphql') cfg.push('  data: ' + str(c.payload))
    else if (c.type === 'form-urlencoded') cfg.push('  data: ' + str(formUrlRaw(c)))
    else if (isForm) cfg.push('  data: form')
    else if (c.type === 'binary') cfg.push('  data: fs.readFileSync(' + str(c.filePath) + ')')
    cfg.push(`  maxRedirects: ${c.follow ? 5 : 0}`)
    if (c.insecure) cfg.push("  httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })")
    L.push('', 'const config = {', cfg.join(',\n') + ',', '}', '', 'axios(config)')
    L.push('  .then((response) => {', '    console.log(response.status)', '    console.log(response.data)', '  })')
    L.push('  .catch((error) => {', '    console.error(error.message)', '  })')
    return emit(c, L)
  }


  /* ---------- Go (net/http) ---------- */

  function go (c) {
    const imports = new Set(['"fmt"', '"io"', '"net/http"'])
    if (c.query.length) imports.add('"net/url"')
    if (c.type === 'json' || c.type === 'text' || c.type === 'graphql' || c.type === 'form-urlencoded') imports.add('"strings"')
    if (c.type === 'form-data' || c.type === 'binary') imports.add('"bytes"')
    if (c.type === 'form-data') imports.add('"mime/multipart"')
    if (c.type === 'form-data' || c.type === 'binary') imports.add('"os"')
    if (c.insecure) imports.add('"crypto/tls"')
    const L = ['package main', '', 'import (']
    for (const imp of [...imports].sort()) L.push('\t' + imp)
    L.push(')', '', 'func main() {', '\treqUrl := ' + goLit(c.url))
    if (c.query.length) {
      L.push('\tvalues := url.Values{}')
      for (const kv of c.query) L.push(`\tvalues.Add(${goLit(kv[0])}, ${goLit(kv[1])})`)
      L.push('\tif enc := values.Encode(); enc != "" {', `\t\treqUrl += ${goLit(c.hasQuery ? '&' : '?')} + enc`, '\t}')
    }
    if (c.type === 'form-data') {
      L.push('\tbody := &bytes.Buffer{}', '\twriter := multipart.NewWriter(body)')
      for (const f of c.fields) {
        if (!f.file) { L.push(`\t_ = writer.WriteField(${goLit(f.key)}, ${goLit(f.value)})`); continue }
        L.push('\t{', `\t\tfile, err := os.Open(${goLit(f.path)})`, '\t\tif err != nil {', '\t\t\tpanic(err)', '\t\t}',
          `\t\tpart, err := writer.CreateFormFile(${goLit(f.key)}, ${goLit(f.name)})`, '\t\tif err != nil {', '\t\t\tpanic(err)', '\t\t}',
          '\t\tif _, err = io.Copy(part, file); err != nil {', '\t\t\tpanic(err)', '\t\t}', '\t\t_ = file.Close()', '\t}')
      }
      L.push('\tcontentType := writer.FormDataContentType()', '\tif err := writer.Close(); err != nil {', '\t\tpanic(err)', '\t}')
    } else if (c.type === 'binary') {
      L.push('\tdata, err := os.ReadFile(' + goLit(c.filePath) + ')', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tbody := bytes.NewReader(data)')
    } else if (c.type === 'form-urlencoded') {
      L.push('\tbody := strings.NewReader(' + goLit(formUrlRaw(c)) + ')')
    } else if (c.type === 'json' || c.type === 'text' || c.type === 'graphql') {
      L.push('\tbody := strings.NewReader(' + goLit(c.payload) + ')')
    } else {
      L.push('\tvar body io.Reader')
    }
    L.push('', `\treq, err := http.NewRequest(${goLit(c.method)}, reqUrl, body)`, '\tif err != nil {', '\t\tpanic(err)', '\t}')
    for (const kv of c.headers) L.push(`\treq.Header.Set(${goLit(kv[0])}, ${goLit(kv[1])})`)
    if (c.type === 'form-data') L.push('\treq.Header.Set("Content-Type", contentType)')
    const client = []
    if (!c.follow) client.push('\t\tCheckRedirect: func(*http.Request, []*http.Request) error {', '\t\t\treturn http.ErrUseLastResponse', '\t\t},')
    if (c.insecure) client.push('\t\tTransport: &http.Transport{', '\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},', '\t\t},')
    L.push('', client.length ? '\tclient := &http.Client{' : '\tclient := &http.Client{} // follows redirects (Go default)')
    for (const l of client) L.push(l)
    if (client.length) L.push('\t}')
    L.push('\tresp, err := client.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer resp.Body.Close()')
    L.push('\tout, err := io.ReadAll(resp.Body)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '')
    L.push('\tfmt.Println(resp.StatusCode)', '\tfmt.Println(string(out))', '}')
    return emit(c, L)
  }


  function goLit (v) {
    const text = s(v)
    return !text || (text.indexOf('`') < 0 && !/^\s|\s$|\n/.test(text)) ? '`' + text + '`' : str(text)
  }

  /* ---------- Java (OkHttp) ---------- */

  function java (c) {
    const imports = new Set(['okhttp3.Headers', 'okhttp3.MediaType', 'okhttp3.OkHttpClient', 'okhttp3.Request', 'okhttp3.RequestBody', 'okhttp3.Response'])
    if (c.query.length) imports.add('okhttp3.HttpUrl')
    if (c.type === 'form-data') imports.add('okhttp3.MultipartBody')
    if (c.type === 'form-urlencoded') imports.add('okhttp3.FormBody')
    if (c.type === 'form-data' || c.type === 'binary') { imports.add('java.nio.file.Files'); imports.add('java.nio.file.Paths') }
    const L = []
    for (const imp of [...imports].sort()) L.push('import ' + imp + ';')
    L.push('', 'public class MoziRequest {', '\tpublic static void main(String[] args) throws Exception {')
    if (c.query.length) {
      L.push('\t\tHttpUrl.Builder urlBuilder = HttpUrl.parse(' + str(c.url) + ').newBuilder();')
      for (const kv of c.query) L.push(`\t\turlBuilder.addQueryParameter(${str(kv[0])}, ${str(kv[1])});`)
      L.push('\t\tString url = urlBuilder.build().toString();')
    } else L.push('\t\tString url = ' + str(c.url) + ';')
    L.push('\t\tHeaders headers = new Headers.Builder()' + c.headers.map((kv) => `\n\t\t\t\t.add(${str(kv[0])}, ${str(kv[1])})`).join('') + '.build();')
    if (c.type === 'form-data') {
      L.push('\t\tMultipartBody.Builder formBuilder = new MultipartBody.Builder().setType(MultipartBody.FORM);')
      for (const f of c.fields) L.push(f.file
        ? `\t\tformBuilder.addFormDataPart(${str(f.key)}, ${str(f.name)}, RequestBody.create(Files.readAllBytes(Paths.get(${str(f.path)})), MediaType.parse(${str(mimeOf(f.name))})));`
        : `\t\tformBuilder.addFormDataPart(${str(f.key)}, ${str(f.value)});`)
      L.push('\t\tRequestBody body = formBuilder.build();')
    } else if (c.type === 'form-urlencoded') {
      L.push('\t\tRequestBody body = new FormBody.Builder()' + c.formUrl.map((kv) => `.add(${str(kv[0])}, ${str(kv[1])})`).join('') + '.build();')
    } else if (c.type === 'json' || c.type === 'text' || c.type === 'graphql') {
      L.push('\t\tRequestBody body = RequestBody.create(' + str(c.payload) + ', MediaType.parse(' + str(c.ct) + '));')
    } else if (c.type === 'binary') {
      L.push('\t\tRequestBody body = RequestBody.create(Files.readAllBytes(Paths.get(' + str(c.filePath) + ')), MediaType.parse(' + str(c.ct || 'application/octet-stream') + '));')
    } else L.push('\t\tRequestBody body = null;')
    L.push('\t\tRequest request = new Request.Builder().url(url).headers(headers).method(' + str(c.method) + ', body).build();')
    if (!c.follow) L.push('\t\t// followRedirects is false: build the client with .followRedirects(false) / .followSslRedirects(false).')
    L.push('\t\tOkHttpClient client = new OkHttpClient.Builder().build();')
    L.push('\t\tResponse response = client.newCall(request).execute();', '\t\tSystem.out.println(response.code());')
    L.push('\t\tSystem.out.println(response.body().string());', '\t}', '}')
    return emit(c, L)
  }


  /* ---------- cURL (beautified, delegated to Curl.build) ---------- */

  function curl (c) {
    const C = window.Curl
    const url = c.url + (c.query.length ? (c.hasQuery ? '&' : '?') + c.query.map((kv) => pct(kv[0]) + '=' + pct(kv[1])).join('&') : '')
    if (!C || typeof C.build !== 'function') return emit(c, ["curl '" + url + "'"], '#')
    const body = Object.assign({}, c.body, {
      type: c.type,
      text: c.payload,
      filePath: c.filePath,
      formUrlencoded: c.formUrl.map((kv) => ({ key: kv[0], value: kv[1], enabled: true })),
      formData: c.fields.map((f) => (f.file ? { key: f.key, type: 'file', path: f.path, fileName: f.name, enabled: true } : { key: f.key, type: 'text', value: f.value, enabled: true }))
    })
    const req = { method: c.method, url, body, options: { insecure: c.insecure, followRedirects: c.follow } }
    return emit(c, C.build(req, url, c.headers, { present: c.type !== 'none' }).split('\n'), '#')
  }

  return { languages, generate }
})()
