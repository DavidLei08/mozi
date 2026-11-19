'use strict'

// Browser implementation of the desktop preload contract. Streams belong to the
// workspace tab, so MV3 service-worker suspension cannot interrupt an open stream.
;(function () {
  const fileRefs = new Map()
  const sockets = new Map()
  const streams = new Map()
  const requests = new Map()
  const MAX_BYTES = 30 * 1024 * 1024
  const fail = (error) => ({ ok: false, error: error.message || String(error) })
  const cancelled = (err) => err && err.name === 'AbortError'
  const events = () => {
    const listeners = new Set()
    return {
      on: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
      emit: (event) => { for (const fn of listeners) fn({ ts: Date.now(), ...event }) }
    }
  }
  const wsEvents = events()
  const sseEvents = events()
  const saveEvents = events()
  const toBase64 = (bytes) => {
    let text = ''
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(text)
  }
  const remember = async (handle) => {
    const file = await handle.getFile()
    const path = `picked:${crypto.randomUUID()}/${file.name}`
    fileRefs.set(path, handle)
    return { path, name: file.name, size: file.size }
  }
  async function fileAt (path) {
    const handle = fileRefs.get(path)
    if (!handle) throw new Error('请重新选择文件：浏览器重启后需要重新授权文件访问')
    return handle.getFile()
  }
  const pickerUnavailable = (err) => ['SecurityError', 'NotAllowedError', 'NotSupportedError', 'TypeError'].includes(err?.name)
  function inputFiles (multiple, filters) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = multiple
      input.hidden = true
      input.accept = (filters || []).flatMap(f => f.extensions || []).filter(e => e !== '*').map(e => `.${e}`).join(',')
      const finish = (files) => { input.remove(); resolve(files) }
      input.addEventListener('change', () => finish(Array.from(input.files || [])), { once: true })
      input.addEventListener('cancel', () => finish([]), { once: true })
      document.body.appendChild(input)
      try { input.click() } catch (err) { input.remove(); reject(err) }
    })
  }
  async function pickHandles (multiple, filters) {
    if (typeof window.showOpenFilePicker === 'function') {
      try { return await window.showOpenFilePicker({ multiple }) }
      catch (err) {
        if (cancelled(err)) return []
        if (!pickerUnavailable(err)) throw err
      }
    }
    // Standard file inputs also work where File System Access is unavailable.
    return (await inputFiles(multiple, filters)).map(file => ({ getFile: async () => file }))
  }
  async function pick () {
    return Promise.all((await pickHandles(true)).map(remember))
  }
  function downloadBlob (blob, name) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.hidden = true
    document.body.appendChild(link)
    try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
    return { ok: true, path: `download:/${name}`, downloaded: true }
  }
  async function saveBlob (blob, name) {
    const filename = String(name || 'mozi-export.txt').split(/[\\/]/).pop()
    try {
      if (typeof window.showSaveFilePicker !== 'function') return downloadBlob(blob, filename)
      let handle
      try { handle = await window.showSaveFilePicker({ suggestedName: filename }) }
      catch (err) {
        if (cancelled(err)) return { ok: false }
        if (pickerUnavailable(err)) return downloadBlob(blob, filename)
        throw err
      }
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      const ref = await remember(handle)
      return { ok: true, path: ref.path }
    } catch (err) { return cancelled(err) ? { ok: false } : fail(err) }
  }
  async function saveText (p) {
    return saveBlob(new Blob([String(p.content ?? '')], { type: 'text/plain;charset=utf-8' }), p.defaultName || p.defaultPath)
  }
  const FORBIDDEN = /^(accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|permissions-policy|referer|set-cookie|te|trailer|transfer-encoding|upgrade|via|proxy-.*|sec-.*)$/i
  function headersFor (input) {
    const headers = new Headers()
    for (const row of Array.isArray(input) ? input : Object.entries(input || {})) {
      if (!row || row.enabled === false) continue
      const [key, value] = Array.isArray(row) ? row : [row.key, row.value]
      if (!String(key || '').trim()) continue
      if (FORBIDDEN.test(String(key).trim())) throw new Error(`Chrome 管理请求头 ${key}，扩展版无法自定义；请删除该请求头`)
      headers.set(key, String(value ?? ''))
    }
    return headers
  }
  function urlFor (url, protocols = ['http:', 'https:']) {
    const parsed = new URL(url)
    if (!protocols.includes(parsed.protocol)) throw new Error('不支持的 URL 协议')
    if (parsed.username || parsed.password) throw new Error('请在认证面板设置用户名和密码，不要放在 URL 中')
    return parsed.href
  }
  function checkTLS (insecure) {
    if (insecure) throw new Error('Chrome 扩展不能跳过 TLS 证书校验，请关闭 allow insecure TLS')
  }
  async function bodyFor (body, headers) {
    if (!body || body.type === 'none') return undefined
    const type = (value) => { if (!headers.has('Content-Type')) headers.set('Content-Type', value) }
    switch (body.type) {
      case 'json': type('application/json'); return body.text || ''
      case 'graphql': {
        type('application/json')
        const g = body.graphql || {}
        return JSON.stringify({ query: g.query || '', variables: g.variables ? JSON.parse(g.variables) : {}, operationName: g.operationName || undefined })
      }
      case 'form-urlencoded': {
        type('application/x-www-form-urlencoded')
        return new URLSearchParams((body.formUrlencoded || []).filter((f) => f.enabled !== false && f.key).map((f) => [f.key, f.value || '']))
      }
      case 'form-data': {
        const form = new FormData()
        for (const f of body.formData || []) {
          if (f.enabled === false || !f.key) continue
          if (f.type === 'file') {
            const file = await fileAt(f.path)
            form.append(f.key, file, f.fileName || file.name)
          } else form.append(f.key, f.value || '')
        }
        headers.delete('Content-Type') // Chrome supplies the actual multipart boundary.
        return form
      }
      case 'binary': type(body.contentType || 'application/octet-stream'); return fileAt(body.filePath)
      default: type(body.contentType || 'text/plain'); return body.text || ''
    }
  }
  async function readLimited (response, maxBytes) {
    if (!response.body) return { bytes: new Uint8Array(), truncated: false }
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    let truncated = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const remaining = maxBytes - size
        const part = value.subarray(0, remaining)
        chunks.push(part)
        size += part.length
        if (value.length > remaining) { truncated = true; await reader.cancel(); break }
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return { bytes, truncated }
  }
  async function send (payload) {
    const start = Date.now()
    const options = payload.options || {}
    if (payload.id && requests.has(payload.id)) return { error: 'Request already in progress' }
    const controller = new AbortController()
    if (payload.id) requests.set(payload.id, controller)
    const timeout = setTimeout(() => controller.abort(new Error('请求超时')), Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 120000)
    try {
      checkTLS(options.insecure)
      const url = urlFor(payload.url)
      if (window.Cookies && new window.Cookies.Jar(payload.cookies || []).headerValue(url)) {
        throw new Error('扩展版不发送独立 Cookie Jar；请停用匹配的 Cookie，或使用桌面版')
      }
      const headers = headersFor(payload.headers)
      const body = await bodyFor(payload.body, headers)
      const response = await fetch(url, {
        method: payload.method || 'GET', headers, body, signal: controller.signal,
        credentials: 'omit', redirect: options.followRedirects === false ? 'manual' : 'follow', cache: 'no-store'
      })
      const ttfb = Date.now() - start
      if (response.type === 'opaqueredirect') throw new Error('Chrome 隐藏未跟随重定向的响应，请启用 Follow redirects')
      const { bytes, truncated } = await readLimited(response, Number(options.maxResponseBytes) > 0 ? Number(options.maxResponseBytes) : MAX_BYTES)
      const contentType = response.headers.get('content-type') || ''
      const textual = /^(text\/|application\/(json|.*\+json|xml|.*\+xml|javascript|x-www-form-urlencoded|graphql|x-ndjson|yaml)|image\/svg)/i.test(contentType) || (!contentType && !bytes.subarray(0, 512).includes(0))
      return {
        status: response.status, statusText: response.statusText, headers: [...response.headers],
        contentType, finalUrl: response.url, redirects: [], setCookies: [], size: bytes.length, truncated,
        bodyKind: textual ? 'text' : 'binary', text: textual ? new TextDecoder().decode(bytes) : undefined,
        base64: textual ? undefined : toBase64(bytes), timings: { start, ttfb, total: Date.now() - start }
      }
    } catch (err) {
      return { error: controller.signal.aborted ? controller.signal.reason.message : err.message, timings: { total: Date.now() - start } }
    } finally { clearTimeout(timeout); if (requests.get(payload.id) === controller) requests.delete(payload.id) }
  }

  function openWS (p) {
    if (sockets.has(p.id)) sockets.get(p.id).close()
    try {
      checkTLS(p.insecure)
      if ([...headersFor(p.headers)].length) throw new Error('Chrome WebSocket 不支持自定义握手请求头，请移除 Headers 和认证配置')
      const socket = new WebSocket(urlFor(p.url, ['ws:', 'wss:']), p.protocols || [])
      socket.binaryType = 'arraybuffer'
      sockets.set(p.id, socket)
      const emit = (value) => { if (sockets.get(p.id) === socket) wsEvents.emit({ id: p.id, ...value }) }
      const timer = setTimeout(() => { emit({ kind: 'error', message: 'WebSocket 连接超时' }); socket.close() }, Number(p.timeoutMs) || 15000)
      socket.onopen = () => { clearTimeout(timer); emit({ kind: 'open', status: 101, statusText: 'Switching Protocols', protocol: socket.protocol }) }
      socket.onmessage = ({ data }) => {
        const binary = typeof data !== 'string'
        emit(binary ? { kind: 'message', binary, base64: toBase64(new Uint8Array(data)), size: data.byteLength }
          : { kind: 'message', binary, data, size: new TextEncoder().encode(data).length })
      }
      socket.onerror = () => { clearTimeout(timer); emit({ kind: 'error', message: 'WebSocket 连接失败，请检查 URL、证书和服务端 Origin 策略' }) }
      socket.onclose = (e) => {
        clearTimeout(timer)
        emit({ kind: 'close', code: e.code, reason: e.reason })
        if (sockets.get(p.id) === socket) sockets.delete(p.id)
      }
      return { ok: true }
    } catch (err) { wsEvents.emit({ id: p.id, kind: 'error', message: err.message }); return fail(err) }
  }

  function openSSE (p) {
    if (streams.has(p.id)) streams.get(p.id).abort()
    const controller = new AbortController()
    streams.set(p.id, controller)
    const emit = (value) => { if (streams.get(p.id) === controller) sseEvents.emit({ id: p.id, ...value }) }
    ;(async () => {
      let reader
      try {
        checkTLS(p.insecure)
        const headers = headersFor(p.headers)
        headers.set('Accept', 'text/event-stream')
        if (p.lastEventId) headers.set('Last-Event-ID', p.lastEventId)
        const response = await fetch(urlFor(p.url), {
          method: p.method || 'GET', headers, body: p.body || undefined,
          signal: controller.signal, credentials: 'omit', cache: 'no-store'
        })
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
        const ct = response.headers.get('content-type') || ''
        if (!ct.includes('text/event-stream')) emit({ kind: 'warn', message: `预期 text/event-stream，收到 ${ct}` })
        emit({ kind: 'open', status: response.status, statusText: response.statusText, method: p.method || 'GET', headers: [...response.headers] })
        reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = '', data = [], event = '', lastEventId = p.lastEventId || '', retry = null, eventSize = 0
        const line = (value) => {
          if (value === '') {
            if (data.length) emit({ kind: 'event', event: event || 'message', data: data.join('\n'), lastEventId, retry })
            data = []; event = ''; eventSize = 0
            return
          }
          eventSize += value.length
          if (eventSize > 4 * 1024 * 1024) throw new Error('SSE 单条事件超过 4 MB')
          if (value.startsWith(':')) return
          const colon = value.indexOf(':')
          const key = colon < 0 ? value : value.slice(0, colon)
          const val = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '')
          if (key === 'data') data.push(val)
          else if (key === 'event') event = val
          else if (key === 'id' && !val.includes('\0')) lastEventId = val
          else if (key === 'retry' && /^\d+$/.test(val)) retry = Number(val)
        }
        while (true) {
          const { done, value } = await reader.read()
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
          let match
          while ((match = /[\r\n]/.exec(buffer))) {
            const index = match.index
            if (!done && buffer[index] === '\r' && index === buffer.length - 1) break
            const length = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1
            line(buffer.slice(0, index)); buffer = buffer.slice(index + length)
          }
          if (buffer.length > 4 * 1024 * 1024) throw new Error('SSE 行长度超过 4 MB')
          if (done) break // Incomplete events at EOF are intentionally discarded.
        }
      } catch (err) { if (!controller.signal.aborted) emit({ kind: 'error', message: err.message }) }
      finally {
        if (reader) { try { await reader.cancel() } catch {} }
        emit({ kind: 'close' })
        if (streams.get(p.id) === controller) streams.delete(p.id)
      }
    })()
    return { ok: true }
  }

  window.api = {
    platform: 'chrome-extension',
    info: async () => ({ name: 'Mozi', version: chrome.runtime.getManifest().version, platform: 'browser', dark: matchMedia('(prefers-color-scheme: dark)').matches }),
    http: { send, cancel: async (id) => {
      const controller = requests.get(id)
      if (controller) controller.abort(new Error('请求已取消'))
      return { ok: !!controller }
    } },
    ws: {
      open: openWS, onEvent: wsEvents.on,
      close: ({ id }) => { const socket = sockets.get(id); if (socket) socket.close(); return { ok: true } },
      send: async ({ id, data, isBinary }) => {
        try {
          const socket = sockets.get(id)
          if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Socket is not open')
          socket.send(isBinary ? ExtensionHash.decode(data, 'base64') : String(data))
          return { ok: true }
        } catch (err) { return fail(err) }
      }
    },
    sse: { open: openSSE, onEvent: sseEvents.on, close: ({ id }) => { streams.get(id)?.abort(); return { ok: true } } },
    store: {
      load: async () => (await chrome.storage.local.get('workspace')).workspace || null,
      save: async (data) => { await chrome.storage.local.set({ workspace: data }); return { ok: true } },
      path: async () => 'Chrome 扩展本地存储'
    },
    files: {
      pick,
      readBase64: async (path) => {
        try {
          const file = await fileAt(path)
          return { ok: true, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', base64: toBase64(new Uint8Array(await file.arrayBuffer())) }
        } catch (err) { return fail(err) }
      },
      saveBase64: async (p) => {
        try { return await saveBlob(new Blob([ExtensionHash.decode(p.base64, 'base64')], { type: p.mime }), p.defaultName) }
        catch (err) { return fail(err) }
      },
      writeText: async (p) => {
        try {
          const handle = fileRefs.get(p.path)
          if (!handle || !handle.createWritable) return saveText({ content: p.content, defaultName: p.path })
          const writable = await handle.createWritable()
          await writable.write(String(p.content ?? ''))
          await writable.close()
          return { ok: true, path: p.path }
        } catch (err) { return cancelled(err) ? { ok: false } : fail(err) }
      }
    },
    dialog: {
      saveText,
      openText: async (options = {}) => {
        try {
          const [handle] = await pickHandles(false, options.filters)
          if (!handle) return { ok: false }
          const file = await handle.getFile()
          const ref = await remember(handle)
          return { ok: true, path: ref.path, content: await file.text() }
        } catch (err) { return cancelled(err) ? { ok: false } : fail(err) }
      }
    },
    hash: {
      text: async (p) => { try { return await ExtensionHash.digest(ExtensionHash.decode(p.text, p.encoding), p.algorithms) } catch (err) { return fail(err) } },
      files: async (p) => {
        try {
          const paths = p.filePaths?.length ? p.filePaths : (await pick()).map((f) => f.path)
          const results = []
          for (const path of paths) {
            const entry = { path, name: path.split('/').pop(), size: 0, hashes: {}, error: null }
            try {
              const file = await fileAt(path)
              if (file.size > 128 * 1024 * 1024) throw new Error('扩展版单文件 Hash 上限 128 MB，请用桌面版处理更大文件')
              entry.size = file.size
              entry.hashes = (await ExtensionHash.digest(new Uint8Array(await file.arrayBuffer()), p.algorithms)).hashes
            } catch (err) { entry.error = err.message }
            results.push(entry)
          }
          return { ok: true, algorithms: p.algorithms, results }
        } catch (err) { return fail(err) }
      }
    },
    setTheme: async () => ({ ok: true }), setLanguage: async () => ({ ok: true }),
    clipboard: { read: () => navigator.clipboard.readText(), write: async (text) => { await navigator.clipboard.writeText(String(text)); return { ok: true } } },
    openExternal: async (url) => { await chrome.tabs.create({ url: urlFor(url) }); return { ok: true } },
    menu: { onSaveRequest: saveEvents.on, onHome: () => {}, onTool: () => {}, onNewRequest: () => {}, onImportCurl: () => {} }
  }
  // Desktop delegates Cmd/Ctrl+S to a native menu; Chrome uses the same dispatcher.
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); e.stopImmediatePropagation(); saveEvents.emit({})
    }
  }, true)
})()
