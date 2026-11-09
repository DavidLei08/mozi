'use strict'

;(function () {
  const api = window.api
  const $ = (sel, root) => (root || document).querySelector(sel)
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel))
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}${Date.now()}`)
  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)))

  // ---------------------------------------------------------------- state
  const defaults = () => ({
    collections: [],
    history: [],
    environments: [{ id: uid(), name: 'Default', vars: [] }],
    activeEnvId: null,
    settings: { historyLimit: 300, timeoutMs: 120000, theme: 'dark' },
    tabs: [],
    activeTabId: null,
    ui: { view: 'home', toolQuery: '', recent: [], side: 'collections', reqTab: 'params', respTab: 'pretty', search: '', split: 52, collapsed: [] }
  })

  let state = defaults()
  let saveTimer = null
  let renderTimer = null

  function activeTab () { return state.tabs.find((t) => t.id === state.activeTabId) || null }
  function activeEnv () { return state.environments.find((e) => e.id === state.activeEnvId) || state.environments[0] || null }

  function saveSoon () {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, 350)
  }

  async function saveNow () {
    const payload = {
      collections: state.collections,
      history: state.history,
      environments: state.environments,
      activeEnvId: state.activeEnvId,
      settings: state.settings,
      ui: state.ui,
      activeTabId: state.activeTabId,
      tabs: state.tabs.map((t) => ({ id: t.id, request: t.request, dirty: t.dirty, savedNodeId: t.savedNodeId }))
    }
    try { await api.store.save(payload) } catch (err) { console.error('save failed', err) }
  }

  function markDirty () {
    const tab = activeTab()
    if (tab) tab.dirty = true
    renderTabs()
    saveSoon()
  }

  // ---------------------------------------------------------------- model
  function makeBody () {
    return {
      type: 'none',
      text: '',
      contentType: '',
      graphql: { query: '', variables: '' },
      formUrlencoded: [],
      formData: [],
      filePath: '',
      fileName: ''
    }
  }

  function makeRequest (overrides) {
    const base = {
      kind: 'http',
      method: 'GET',
      url: '',
      params: [],
      headers: [],
      body: makeBody(),
      auth: { type: 'none', token: '', username: '', password: '', key: '', value: '', addTo: 'header' },
      options: { followRedirects: true, insecure: false, timeoutMs: 120000 }
    }
    return Object.assign(base, overrides || {})
  }

  function normalizeRequest (request) {
    const base = makeRequest()
    const merged = Object.assign(base, request || {})
    merged.params = Array.isArray(merged.params) ? merged.params : []
    merged.headers = Array.isArray(merged.headers) ? merged.headers : []
    merged.body = Object.assign(makeBody(), merged.body || {})
    merged.body.graphql = Object.assign({ query: '', variables: '' }, merged.body.graphql || {})
    merged.body.formUrlencoded = Array.isArray(merged.body.formUrlencoded) ? merged.body.formUrlencoded : []
    merged.body.formData = Array.isArray(merged.body.formData) ? merged.body.formData : []
    merged.auth = Object.assign({ type: 'none', token: '', username: '', password: '', key: '', value: '', addTo: 'header' }, merged.auth || {})
    merged.options = Object.assign({ followRedirects: true, insecure: false, timeoutMs: 120000 }, merged.options || {})
    merged.kind = ['http', 'ws', 'sse'].includes(merged.kind) ? merged.kind : 'http'
    return merged
  }

  function makeTab (request) {
    return {
      id: uid(),
      request: normalizeRequest(request),
      dirty: false,
      savedNodeId: null,
      response: null,
      stream: { connected: false, streamId: uid(), log: [], status: null, count: 0 }
    }
  }

  // ---------------------------------------------------------------- helpers
  function el (tag, cls, text) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    return node
  }

  function toast (message) {
    const t = $('#toast')
    t.textContent = message
    t.classList.remove('hidden')
    clearTimeout(toast._timer)
    toast._timer = setTimeout(() => t.classList.add('hidden'), 2400)
  }

  function fmtBytes (n) {
    if (!n && n !== 0) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
  }

  function fmtTime (ts) {
    const d = new Date(ts)
    return d.toTimeString().slice(0, 8)
  }

  function statusClass (status) {
    if (!status) return ''
    if (status >= 200 && status < 300) return 'ok'
    if (status >= 300 && status < 400) return 'redirect'
    return 'err'
  }

  function methodClass (method, kind) {
    if (kind === 'ws') return 'ws'
    if (kind === 'sse') return 'sse'
    return String(method || 'GET').toLowerCase()
  }

  // ---------------------------------------------------------------- env vars
  function envVars () {
    const env = activeEnv()
    const out = {}
    if (!env) return out
    for (const v of env.vars || []) {
      if (v && v.enabled !== false && v.key) out[v.key] = v.value ?? ''
    }
    return out
  }

  function builtin (name) {
    switch (name) {
      case 'timestamp': return String(Date.now())
      case 'isoTimestamp': return new Date().toISOString()
      case 'uuid': return uid()
      case 'randomInt': return String(Math.floor(Math.random() * 1000))
      default: return ''
    }
  }

  function resolveEnvString (input) {
    const vars = envVars()
    return String(input == null ? '' : input).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, raw) => {
      const name = raw.trim()
      if (name.startsWith('$')) {
        const v = builtin(name.slice(1))
        return v || match
      }
      return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match
    })
  }
  window.resolveEnvString = resolveEnvString

  // ---------------------------------------------------------------- url <-> params
  let syncingParams = false

  function applyParams (baseUrl, params) {
    const enabled = (params || []).filter((p) => p && p.enabled !== false && p.key)
    if (!enabled.length) return baseUrl
    const qs = enabled.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(resolveEnvString(p.value ?? ''))}`).join('&')
    const hashIdx = baseUrl.indexOf('#')
    const hash = hashIdx >= 0 ? baseUrl.slice(hashIdx) : ''
    const noHash = hashIdx >= 0 ? baseUrl.slice(0, hashIdx) : baseUrl
    return `${noHash}${noHash.includes('?') ? '&' : '?'}${qs}${hash}`
  }

  function syncParamsFromUrl () {
    const tab = activeTab()
    if (!tab || tab.request.kind !== 'http') return
    const raw = tab.request.url || ''
    if (!raw.includes('?')) { tab.request.params = []; return }
    try {
      const u = new URL(raw)
      tab.request.params = Array.from(u.searchParams.entries()).map(([key, value]) => ({ key, value, enabled: true }))
    } catch {
      // Non-absolute URL: parse the query part by hand.
      const qi = raw.indexOf('?')
      const qs = raw.slice(qi + 1).split('#')[0]
      tab.request.params = qs.split('&').filter(Boolean).map((pair) => {
        const eq = pair.indexOf('=')
        if (eq < 0) return { key: decodeSafe(pair), value: '', enabled: true }
        return { key: decodeSafe(pair.slice(0, eq)), value: decodeSafe(pair.slice(eq + 1)), enabled: true }
      })
    }
    if (state.ui.reqTab === 'params') renderParams()
  }

  function decodeSafe (s) {
    try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch { return s }
  }

  function syncUrlFromParams () {
    const tab = activeTab()
    if (!tab || tab.request.kind !== 'http') return
    const raw = tab.request.url || ''
    const hashIdx = raw.indexOf('#')
    const hash = hashIdx >= 0 ? raw.slice(hashIdx) : ''
    const noHash = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw
    const qi = noHash.indexOf('?')
    const base = qi >= 0 ? noHash.slice(0, qi) : noHash
    const params = (tab.request.params || []).filter((p) => p && p.enabled !== false && p.key)
    const qs = params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`).join('&')
    tab.request.url = `${base}${qs ? `?${qs}` : ''}${hash}`
    syncingParams = true
    $('#urlInput').value = tab.request.url
    syncingParams = false
  }

  // ---------------------------------------------------------------- sidebar
  function renderSidebar () {
    renderEnvSelect()
    const tree = $('#collectionTree')
    const hist = $('#historyList')
    const q = (state.ui.search || '').trim().toLowerCase()

    if (state.ui.side === 'collections') {
      tree.classList.remove('hidden')
      hist.classList.add('hidden')
      tree.textContent = ''
      if (!state.collections.length) {
        tree.appendChild(el('p', 'muted small', 'No collections yet. Save a request to start one.'))
        return
      }
      for (const coll of state.collections) tree.appendChild(renderCollectionNode(coll, 0, q))
    } else {
      tree.classList.add('hidden')
      hist.classList.remove('hidden')
      hist.textContent = ''
      const items = state.history.filter((h) => !q || `${h.method} ${h.url}`.toLowerCase().includes(q))
      if (!items.length) hist.appendChild(el('p', 'muted small', q ? 'No history matches.' : 'No requests sent yet.'))
      for (const h of items.slice(0, 200)) hist.appendChild(renderHistoryRow(h))
    }
  }

  function renderCollectionNode (node, depth, q) {
    const wrap = el('div')
    const row = el('div', 'node')
    row.style.paddingLeft = `${8 + depth * 12}px`

    const caret = el('span', 'caret', node.type === 'request' ? '' : (isCollapsed(node.id) ? '▸' : '▾'))
    row.appendChild(caret)

    if (node.type === 'request') {
      const tag = el('span', `method-tag ${methodClass(node.request.method, node.request.kind)}`, node.request.kind === 'ws' ? 'WS' : node.request.kind === 'sse' ? 'SSE' : node.request.method)
      row.appendChild(tag)
    } else {
      const icon = el('span', 'caret', node.type === 'collection' ? '⌸' : '▸')
      icon.style.fontSize = '11px'
      row.appendChild(icon)
    }

    const name = el('span', 'node-name', node.name || 'Untitled')
    row.appendChild(name)

    const actions = el('span', 'node-actions')
    if (node.type === 'request') {
      actions.appendChild(miniIcon('✎', 'Rename', (e) => { e.stopPropagation(); renameNode(node) }))
      actions.appendChild(miniIcon('⧉', 'Duplicate', (e) => { e.stopPropagation(); duplicateRequestNode(node) }))
      actions.appendChild(miniIcon('✕', 'Delete', (e) => { e.stopPropagation(); deleteNode(node) }))
    } else {
      actions.appendChild(miniIcon('＋', 'New request', (e) => { e.stopPropagation(); createRequestIn(node) }))
      actions.appendChild(miniIcon('▣', 'New folder', (e) => { e.stopPropagation(); createFolderIn(node) }))
      actions.appendChild(miniIcon('✎', 'Rename', (e) => { e.stopPropagation(); renameNode(node) }))
      actions.appendChild(miniIcon('✕', 'Delete', (e) => { e.stopPropagation(); deleteNode(node) }))
    }
    row.appendChild(actions)

    if (node.type === 'request') {
      row.addEventListener('click', () => openRequest(node.request, node.name, node.id))
    } else {
      row.addEventListener('click', () => {
        toggleCollapsed(node.id)
        renderSidebar()
      })
    }

    if (q && node.type === 'request' && !`${node.name} ${node.request.url}`.toLowerCase().includes(q)) {
      // keep filtering applied only to requests; folders still render for context
    }
    wrap.appendChild(row)

    if (node.type !== 'request' && (q || !isCollapsed(node.id))) {
      const kids = (node.items || [])
      const filtered = q
        ? kids.filter((k) => k.type !== 'request' || `${k.name} ${k.request.url}`.toLowerCase().includes(q))
        : kids
      if (!filtered.length) {
        const empty = el('div', 'muted small')
        empty.style.paddingLeft = `${8 + (depth + 1) * 12}px`
        empty.textContent = 'empty'
        wrap.appendChild(empty)
      }
      for (const kid of filtered) wrap.appendChild(renderCollectionNode(kid, depth + 1, q))
    }
    return wrap
  }

  function miniIcon (label, title, onClick) {
    const b = el('button', 'mini-icon', label)
    b.title = title
    b.addEventListener('click', onClick)
    return b
  }

  function isCollapsed (id) { return (state.ui.collapsed || []).includes(id) }
  function toggleCollapsed (id) {
    const list = state.ui.collapsed || (state.ui.collapsed = [])
    const idx = list.indexOf(id)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(id)
    saveSoon()
  }

  function renderHistoryRow (h) {
    const row = el('div', 'hist-row')
    row.appendChild(el('span', `method-tag ${methodClass(h.method, h.kind)}`, h.kind === 'ws' ? 'WS' : h.kind === 'sse' ? 'SSE' : h.method))
    const main = el('div', 'hist-main')
    main.appendChild(el('div', 'hist-url', h.url))
    main.appendChild(el('div', 'hist-sub', `${fmtTime(h.at)} · ${h.durationMs || 0} ms${h.error ? ` · ${h.error}` : ''}`))
    row.appendChild(main)
    const st = el('span', `hist-status ${h.status ? statusClass(h.status) : 'err'}`, h.error ? 'ERR' : String(h.status || ''))
    row.appendChild(st)
    row.title = h.url
    row.addEventListener('click', () => {
      if (h.request) openRequest(clone(h.request), h.name || h.url, null)
    })
    return row
  }

  function renderEnvSelect () {
    const sel = $('#envSelect')
    sel.textContent = ''
    for (const env of state.environments) {
      const opt = el('option', null, env.name)
      opt.value = env.id
      sel.appendChild(opt)
    }
    sel.value = (activeEnv() || {}).id || ''
  }

  function findNode (id, nodes) {
    for (const node of nodes || []) {
      if (node.id === id) return node
      if (node.items) {
        const found = findNode(id, node.items)
        if (found) return found
      }
    }
    return null
  }

  function removeNode (id, nodes) {
    for (let i = 0; i < (nodes || []).length; i++) {
      if (nodes[i].id === id) { nodes.splice(i, 1); return true }
      if (nodes[i].items && removeNode(id, nodes[i].items)) return true
    }
    return false
  }

  function parentListOf (node) {
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (n === node) return nodes
        if (n.items) { const r = walk(n.items); if (r) return r }
      }
      return null
    }
    return walk(state.collections)
  }

  // ---------------------------------------------------------------- tabs
  function newTab (request) {
    const tab = makeTab(request)
    state.tabs.push(tab)
    state.activeTabId = tab.id
    renderAll()
    saveSoon()
    return tab
  }

  function openRequest (request, name, savedNodeId) {
    const existing = state.tabs.find((t) => t.savedNodeId && t.savedNodeId === savedNodeId)
    if (existing) {
      state.activeTabId = existing.id
      renderAll()
      return
    }
    const cloned = clone(request)
    if (name) cloned.name = name
    const tab = makeTab(cloned)
    tab.savedNodeId = savedNodeId || null
    state.tabs.push(tab)
    state.activeTabId = tab.id
    renderAll()
    saveSoon()
  }

  function closeTab (id) {
    const idx = state.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const tab = state.tabs[idx]
    if (tab.stream && tab.stream.connected) stopStream(tab)
    state.tabs.splice(idx, 1)
    if (state.activeTabId === id) {
      const next = state.tabs[Math.max(0, idx - 1)] || state.tabs[0]
      state.activeTabId = next ? next.id : null
    }
    if (!state.tabs.length) newTab()
    else renderAll()
    saveSoon()
  }

  function renderTabs () {
    const bar = $('#tabbar')
    bar.textContent = ''
    for (const tab of state.tabs) {
      const btn = el('div', `tab${tab.id === state.activeTabId ? ' is-active' : ''}`)
      const tag = el('span', `method-tag ${methodClass(tab.request.method, tab.request.kind)}`, tab.request.kind === 'ws' ? 'WS' : tab.request.kind === 'sse' ? 'SSE' : tab.request.method)
      btn.appendChild(tag)
      btn.appendChild(el('span', 'tab-name', `${tab.request.name || 'Untitled'}${tab.dirty ? ' •' : ''}`))
      const close = el('button', 'tab-close', '✕')
      close.title = 'Close tab'
      close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id) })
      btn.appendChild(close)
      btn.addEventListener('click', () => {
        if (state.activeTabId === tab.id) return
        state.activeTabId = tab.id
        renderAll()
        saveSoon()
      })
      bar.appendChild(btn)
    }
  }

  // ---------------------------------------------------------------- request editors
  function renderRequest () {
    const tab = activeTab()
    if (!tab) return
    const req = tab.request

    $('#kindSelect').value = req.kind
    $('#methodSelect').value = req.method
    $('#methodSelect').disabled = req.kind === 'ws'
    $('#methodSelect').style.opacity = req.kind === 'ws' ? 0.45 : 1
    $('#urlInput').value = req.url || ''
    const kindBadge = $('#urlKind')
    kindBadge.classList.toggle('hidden', req.kind === 'http')
    kindBadge.textContent = req.kind.toUpperCase()
    $('#urlInput').placeholder = req.kind === 'ws'
      ? 'wss://echo.websocket.events'
      : req.kind === 'sse' ? 'https://example.com/events' : 'https://api.example.com/v1/things'

    $('#opt-follow').checked = req.options.followRedirects !== false
    $('#opt-insecure').checked = !!req.options.insecure

    safeCall('renderParams', renderParams)
    safeCall('renderHeaders', renderHeaders)
    safeCall('renderBody', renderBody)
    safeCall('renderAuth', renderAuth)
    safeCall('updateSendButton', updateSendButton)
    safeCall('updateBadges', updateBadges)
    safeCall('setReqTab', () => setReqTab(state.ui.reqTab, false))

    const isStream = req.kind !== 'http'
    $('.response-pane').classList.toggle('hidden', isStream)
    $('.stream-pane').classList.toggle('hidden', !isStream)
    $('#splitter').classList.toggle('hidden', isStream)
    if (isStream) renderStream()
    else renderResponse()
  }

  function safeCall (name, fn) {
    try {
      fn()
    } catch (err) {
      window.__errors = window.__errors || []
      window.__errors.push(`${name}: ${err && err.message ? err.message : err}`)
      console.error(name, err)
    }
  }

  function setReqTab (name, doRender) {
    state.ui.reqTab = name
    $$('.req-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.reqtab === name))
    $$('.panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === name))
    if (doRender !== false) saveSoon()
  }

  function updateBadges () {
    const req = activeTab().request
    $('#badge-params').textContent = (req.params || []).filter((p) => p.key).length || ''
    $('#badge-headers').textContent = (req.headers || []).filter((h) => h.key).length || ''
    $('#badge-body').textContent = req.body && req.body.type !== 'none' ? '•' : ''
    $('#badge-auth').textContent = req.auth && req.auth.type !== 'none' ? '•' : ''
  }

  function renderKv (container, list, opts) {
    container.textContent = ''
    list = Array.isArray(list) ? list : []
    list.forEach((item, index) => {
      const row = el('div', 'kv-row')

      const chk = document.createElement('input')
      chk.type = 'checkbox'
      chk.checked = item.enabled !== false
      chk.addEventListener('change', () => { item.enabled = chk.checked; opts.onChange() })
      row.appendChild(chk)

      const key = document.createElement('input')
      key.type = 'text'
      key.value = item.key ?? ''
      key.placeholder = 'key'
      key.spellcheck = false
      key.addEventListener('input', () => { item.key = key.value; opts.onChange() })
      row.appendChild(key)

      const valueCell = el('div', 'value-cell')
      if (opts.fileRow && item.type === 'file') {
        const label = document.createElement('input')
        label.type = 'text'
        label.readOnly = true
        label.value = item.fileName || item.path || '(no file)'
        label.title = item.path || ''
        valueCell.appendChild(label)
        const pick = el('button', 'mini-icon', '…')
        pick.title = 'Choose file'
        pick.addEventListener('click', async () => {
          const files = await api.files.pick()
          if (files[0]) { item.path = files[0].path; item.fileName = files[0].name; opts.onChange(true) }
        })
        valueCell.appendChild(pick)
      } else {
        const value = document.createElement('input')
        value.type = 'text'
        value.value = item.value ?? ''
        value.placeholder = 'value'
        value.spellcheck = false
        value.addEventListener('input', () => { item.value = value.value; opts.onChange() })
        valueCell.appendChild(value)
      }
      row.appendChild(valueCell)

      const actions = el('div', 'kv-actions')
      if (opts.fileRow) {
        const toggle = el('button', 'mini-icon', item.type === 'file' ? 'T' : 'F')
        toggle.title = item.type === 'file' ? 'Switch to text value' : 'Switch to file'
        toggle.addEventListener('click', () => {
          item.type = item.type === 'file' ? 'text' : 'file'
          opts.onChange(true)
        })
        actions.appendChild(toggle)
      }
      const remove = el('button', 'mini-icon', '✕')
      remove.title = 'Remove'
      remove.addEventListener('click', () => {
        list.splice(index, 1)
        opts.onChange(true)
      })
      actions.appendChild(remove)
      row.appendChild(actions)

      container.appendChild(row)
    })
  }

  function renderParams () {
    const req = activeTab().request
    renderKv($('#paramsTable'), req.params, {
      onChange: (structural) => {
        syncUrlFromParams()
        updateBadges()
        markDirty()
        if (structural) renderParams()
      }
    })
  }

  function renderHeaders () {
    const req = activeTab().request
    renderKv($('#headersTable'), req.headers, {
      onChange: (structural) => {
        updateBadges()
        markDirty()
        if (structural) renderHeaders()
      }
    })
  }

  function renderBody () {
    const req = activeTab().request
    const type = req.body.type || 'none'
    $$('#bodyType .seg-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.bodytype === type))
    $$('[data-bodyview]').forEach((v) => v.classList.toggle('hidden', v.dataset.bodyview !== type))

    $('#body-json').value = req.body.text || ''
    $('#gql-query').value = req.body.graphql.query || ''
    $('#gql-vars').value = req.body.graphql.variables || ''
    $('#body-text').value = req.body.text || ''
    $('#body-contentType').value = req.body.contentType || ''

    renderKv($('#formUrlencodedTable'), req.body.formUrlencoded, {
      onChange: (structural) => { markDirty(); if (structural) renderBody() }
    })
    renderKv($('#formDataTable'), req.body.formData, {
      fileRow: true,
      onChange: (structural) => { markDirty(); if (structural) renderBody() }
    })

    $('#binary-label').textContent = req.body.filePath
      ? `${req.body.fileName || req.body.filePath.split('/').pop()} (${req.body.filePath})`
      : 'No file selected'
    updateBadges()
  }

  function renderAuth () {
    const req = activeTab().request
    const auth = req.auth || { type: 'none' }
    $('#authType').value = auth.type
    $$('.auth-fields').forEach((f) => f.classList.toggle('hidden', f.dataset.auth !== auth.type))
    $('#auth-token').value = auth.token || ''
    $('#auth-username').value = auth.username || ''
    $('#auth-password').value = auth.password || ''
    $('#auth-key').value = auth.key || ''
    $('#auth-value').value = auth.value || ''
    $('#auth-addto').value = auth.addTo || 'header'
    updateBadges()
  }

  function updateSendButton () {
    const tab = activeTab()
    if (!tab) return
    const btn = $('#btn-send')
    if (tab.request.kind === 'http') {
      btn.textContent = 'Send'
      btn.classList.remove('stream-btn')
      btn.disabled = false
    } else {
      const connected = tab.stream && tab.stream.connected
      btn.textContent = connected ? 'Disconnect' : 'Connect'
      btn.classList.add('stream-btn')
      btn.disabled = false
    }
  }

  // ---------------------------------------------------------------- send
  function effectiveHeaders (req) {
    const out = []
    const seen = new Set()
    for (const h of req.headers || []) {
      if (!h || h.enabled === false || !h.key) continue
      const key = h.key.trim()
      if (!key) continue
      out.push([key, resolveEnvString(h.value ?? '')])
      seen.add(key.toLowerCase())
    }

    const body = req.body || {}
    const ct = bodyContentType(req)
    if (ct && !seen.has('content-type')) out.push(['Content-Type', ct])

    const auth = req.auth || {}
    if (auth.type === 'bearer' && auth.token) out.push(['Authorization', `Bearer ${resolveEnvString(auth.token)}`])
    if (auth.type === 'basic') {
      const raw = `${resolveEnvString(auth.username || '')}:${resolveEnvString(auth.password || '')}`
      out.push(['Authorization', `Basic ${btoa(unescape(encodeURIComponent(raw)))}`])
    }
    if (auth.type === 'api-key' && auth.key && auth.addTo !== 'query') {
      out.push([resolveEnvString(auth.key), resolveEnvString(auth.value || '')])
    }
    return out
  }

  function bodyContentType (req) {
    const body = req.body || { type: 'none' }
    switch (body.type) {
      case 'json': return 'application/json'
      case 'graphql': return 'application/json'
      case 'form-urlencoded': return 'application/x-www-form-urlencoded'
      case 'form-data': return null // boundary is generated by the main process
      case 'text': return body.contentType || 'text/plain'
      case 'binary': return body.contentType || 'application/octet-stream'
      default: return null
    }
  }

  function buildPayload (req) {
    const headers = effectiveHeaders(req)
    let url = resolveEnvString(req.url || '')
    if (req.kind === 'http') url = applyParams(url, req.params)
    const auth = req.auth || {}
    if (auth.type === 'api-key' && auth.key && auth.addTo === 'query') {
      const sep = url.includes('?') ? '&' : '?'
      url += `${sep}${encodeURIComponent(resolveEnvString(auth.key))}=${encodeURIComponent(resolveEnvString(auth.value || ''))}`
    }

    const body = clone(req.body || {})
    if (body.type === 'json') body.text = resolveEnvString(body.text || '')
    if (body.type === 'text') body.text = resolveEnvString(body.text || '')
    if (body.type === 'graphql') {
      body.graphql = {
        query: resolveEnvString(body.graphql.query || ''),
        variables: resolveEnvString(body.graphql.variables || '')
      }
    }
    if (body.type === 'form-urlencoded') {
      body.formUrlencoded = (body.formUrlencoded || []).map((f) => ({ ...f, value: resolveEnvString(f.value ?? '') }))
    }
    if (body.type === 'form-data') {
      body.formData = (body.formData || []).map((f) => ({ ...f, value: resolveEnvString(f.value ?? '') }))
    }

    return {
      method: req.method,
      url,
      headers,
      body,
      options: {
        followRedirects: req.options.followRedirects !== false,
        insecure: !!req.options.insecure,
        timeoutMs: Number(req.options.timeoutMs) || state.settings.timeoutMs
      }
    }
  }

  async function sendActive () {
    const tab = activeTab()
    if (!tab) return
    if (tab.request.kind !== 'http') return toggleStream(tab)
    if (!String(tab.request.url || '').trim()) { toast('Enter a URL first'); $('#urlInput').focus(); return }

    const btn = $('#btn-send')
    btn.disabled = true
    btn.textContent = 'Sending…'
    const started = Date.now()
    try {
      const payload = buildPayload(tab.request)
      const res = await api.http.send(payload)
      tab.response = res
      renderResponse()
      if (!res.error) $('#respNote').textContent = ''
      addHistory(tab.request, res, Date.now() - started)
      if (res.error) toast(res.error)
    } catch (err) {
      tab.response = { error: err.message || String(err) }
      renderResponse()
      toast(tab.response.error)
    } finally {
      updateSendButton()
      saveSoon()
    }
  }

  function addHistory (req, res, durationMs) {
    const entry = {
      id: uid(),
      at: Date.now(),
      kind: req.kind,
      method: req.method,
      name: req.name,
      url: resolveEnvString(req.url),
      status: res && res.status,
      error: res && res.error,
      durationMs: (res && res.timings && res.timings.total) || durationMs,
      request: clone(req)
    }
    state.history.unshift(entry)
    const limit = state.settings.historyLimit || 300
    if (state.history.length > limit) state.history.length = limit
    if (state.ui.side === 'history') renderSidebar()
    saveSoon()
  }

  // ---------------------------------------------------------------- response
  function renderResponse () {
    const tab = activeTab()
    const res = tab && tab.response
    const hasRes = !!res
    $('#respEmpty').classList.toggle('hidden', hasRes)
    $$('.resp-view').forEach((v) => v.classList.toggle('hidden', !hasRes))

    if (!hasRes) {
      $('#respStatus').classList.add('hidden')
      $('#respTime').classList.add('hidden')
      $('#respSize').classList.add('hidden')
      return
    }

    const statusEl = $('#respStatus')
    statusEl.classList.remove('hidden', 'ok', 'redirect', 'err')
    const timeEl = $('#respTime')
    const sizeEl = $('#respSize')

    if (res.error) {
      statusEl.textContent = 'ERROR'
      statusEl.classList.add('err')
      timeEl.classList.add('hidden')
      sizeEl.classList.add('hidden')
      $('#respNote').textContent = res.error
      $('#respPretty').textContent = ''
      const wrap = el('div', 'error-block')
      wrap.appendChild(el('div', 'error-title', 'Request failed'))
      wrap.appendChild(el('div', 'error-msg', res.error))
      $('#respPretty').appendChild(wrap)
      $('#respRaw').textContent = ''
      $('#respHeaders').textContent = ''
      $('#respPreview').textContent = ''
      setRespTab(state.ui.respTab)
      return
    }

    $('#respNote').textContent = res.truncated ? 'Response truncated (size limit)' : ''
    statusEl.textContent = `${res.status} ${res.statusText || ''}`.trim()
    statusEl.classList.add(statusClass(res.status))
    timeEl.textContent = `${res.timings ? res.timings.total : 0} ms`
    timeEl.classList.toggle('hidden', state.settings.showTiming === false)
    timeEl.title = res.timings ? `TTFB ${res.timings.ttfb} ms` : ''
    sizeEl.textContent = fmtBytes(res.size)
    sizeEl.classList.remove('hidden')

    renderPretty(res)
    renderRaw(res)
    renderRespHeaders(res)
    renderPreview(res)
    setRespTab(state.ui.respTab)
  }

  function setRespTab (name) {
    state.ui.respTab = name
    $$('.resp-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.resptab === name))
    const order = { pretty: '#respPretty', raw: '#respRaw', headers: '#respHeaders', preview: '#respPreview' }
    for (const [key, sel] of Object.entries(order)) $(sel).classList.toggle('hidden', key !== name || !activeTab() || !activeTab().response)
  }

  function parseJson (text) {
    if (typeof text !== 'string') return null
    const trimmed = text.trim()
    if (!trimmed) return null
    if (!/^[[{]/.test(trimmed)) return null
    try { return JSON.parse(trimmed) } catch { return null }
  }

  function renderPretty (res) {
    const container = $('#respPretty')
    container.textContent = ''
    if (res.bodyKind === 'binary') {
      container.appendChild(el('p', 'muted', `Binary response · ${fmtBytes(res.size)} · ${res.contentType || 'unknown type'}`))
      return
    }
    const json = parseJson(res.text)
    if (json !== null) {
      window.JsonTree.render(json, container, { expandDepth: 2 })
      return
    }
    const pre = el('pre', 'code')
    pre.textContent = res.text || '(empty body)'
    container.appendChild(pre)
  }

  function renderRaw (res) {
    const pre = $('#respRaw')
    if (res.bodyKind === 'binary') {
      pre.textContent = `${res.contentType || 'binary'} · ${fmtBytes(res.size)} · base64 preview\n\n${String(res.base64 || '').slice(0, 20000)}`
    } else {
      pre.textContent = res.text || ''
    }
  }

  function renderRespHeaders (res) {
    const box = $('#respHeaders')
    box.textContent = ''
    const table = el('div', 'headers-table')
    for (const [k, v] of res.headers || []) {
      const row = el('div', 'headers-row')
      row.appendChild(el('span', 'h-key', k))
      row.appendChild(el('span', 'h-val', v))
      table.appendChild(row)
    }
    if (!(res.headers || []).length) table.appendChild(el('p', 'muted', 'No response headers.'))
    box.appendChild(table)
  }

  function renderPreview (res) {
    const box = $('#respPreview')
    box.textContent = ''
    const ct = String(res.contentType || '')
    if (/^image\//i.test(ct) && res.base64) {
      const img = document.createElement('img')
      img.className = 'preview-img'
      img.src = `data:${ct.split(';')[0]};base64,${res.base64}`
      box.appendChild(img)
      return
    }
    if (/html/i.test(ct) && res.text) {
      const frame = document.createElement('iframe')
      frame.className = 'preview-frame'
      frame.setAttribute('sandbox', '')
      frame.srcdoc = res.text
      box.appendChild(frame)
      return
    }
    box.appendChild(el('p', 'muted', `No preview available for ${ct || 'this content type'}. Try the Pretty or Raw tab.`))
  }

  // ---------------------------------------------------------------- streams (WS / SSE)
  function streamUrl (req) {
    let url = resolveEnvString(req.url || '').trim()
    url = applyParams(url, req.params)
    if (req.kind === 'ws') {
      url = url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
    }
    return url
  }

  function sseBody (req) {
    const body = req.body || {}
    switch (body.type) {
      case 'json':
      case 'text':
        return resolveEnvString(body.text || '')
      case 'graphql': {
        const g = body.graphql || {}
        let variables = {}
        try { variables = g.variables ? JSON.parse(resolveEnvString(g.variables)) : {} } catch { variables = {} }
        return JSON.stringify({ query: resolveEnvString(g.query || ''), variables })
      }
      case 'form-urlencoded':
        return (body.formUrlencoded || [])
          .filter((f) => f && f.enabled !== false && f.key)
          .map((f) => `${encodeURIComponent(resolveEnvString(f.key))}=${encodeURIComponent(resolveEnvString(f.value ?? ''))}`)
          .join('&')
      default:
        return null
    }
  }

  function toggleStream (tab) {
    if (tab.stream.connected) { stopStream(tab); return }
    const url = streamUrl(tab.request)
    if (!url) { toast('Enter a URL first'); return }
    const headers = {}
    for (const [k, v] of effectiveHeaders(tab.request)) headers[k] = v

    tab.stream.log = []
    tab.stream.count = 0
    tab.stream.status = 'connecting'
    tab.stream.connected = true
    tab.stream.startedAt = Date.now()
    renderStream()

    if (tab.request.kind === 'ws') {
      api.ws.open({
        id: tab.stream.streamId,
        url,
        headers,
        protocols: [],
        insecure: !!tab.request.options.insecure
      })
    } else {
      const body = tab.request.method === 'GET' || tab.request.method === 'HEAD' ? null : sseBody(tab.request)
      if (body === null && (tab.request.body || {}).type === 'form-data') {
        toast('SSE 暂不支持 multipart 请求体')
      }
      api.sse.open({
        id: tab.stream.streamId,
        url,
        headers,
        method: tab.request.method,
        body,
        insecure: !!tab.request.options.insecure
      })
    }
    updateSendButton()
  }

  function stopStream (tab) {
    if (!tab.stream.connected) return
    if (tab.request.kind === 'ws') api.ws.close({ id: tab.stream.streamId })
    else api.sse.close({ id: tab.stream.streamId })
    tab.stream.connected = false
    tab.stream.status = 'closed'
    appendStream(tab, { kind: 'system', message: 'Disconnected', ts: Date.now() })
    updateSendButton()
  }

  function appendStream (tab, entry) {
    tab.stream.log.push(entry)
    if (tab.stream.log.length > 2000) tab.stream.log.splice(0, tab.stream.log.length - 2000)
    tab.stream.count = tab.stream.log.filter((e) => e.kind === 'in' || e.kind === 'out').length
    if (tab.id === state.activeTabId) renderStreamLog()
  }

  function findStreamTab (streamId) {
    return state.tabs.find((t) => t.stream && t.stream.streamId === streamId) || null
  }

  function onWsEvent (ev) {
    const tab = findStreamTab(ev.id)
    if (!tab) return
    if (ev.kind === 'open') {
      tab.stream.status = `open (${ev.status})`
      appendStream(tab, { kind: 'system', message: `Connected · ${ev.protocol || 'no subprotocol'}`, ts: ev.ts })
    } else if (ev.kind === 'message') {
      appendStream(tab, { kind: 'in', data: ev.binary ? `[binary ${ev.size} bytes] ${ev.base64.slice(0, 200)}` : ev.data, ts: ev.ts })
    } else if (ev.kind === 'close') {
      tab.stream.connected = false
      tab.stream.status = `closed (${ev.code})`
      appendStream(tab, { kind: 'system', message: `Closed · code ${ev.code}${ev.reason ? ` · ${ev.reason}` : ''}`, ts: ev.ts })
      updateSendButton()
    } else if (ev.kind === 'error') {
      tab.stream.connected = false
      tab.stream.status = 'error'
      appendStream(tab, { kind: 'system', message: `Error: ${ev.message}`, ts: ev.ts })
      updateSendButton()
    } else if (ev.kind === 'system') {
      appendStream(tab, { kind: 'system', message: ev.message, ts: ev.ts })
    }
    if (tab.id === state.activeTabId) renderStream()
  }

  function onSseEvent (ev) {
    const tab = findStreamTab(ev.id)
    if (!tab) return
    if (ev.kind === 'open') {
      tab.stream.status = `open (${ev.status})`
      appendStream(tab, { kind: 'system', message: `Connected · ${ev.method || 'GET'} · HTTP ${ev.status}`, ts: ev.ts })
    } else if (ev.kind === 'event') {
      const data = ev.data || ''
      appendStream(tab, { kind: 'in', data: `event: ${ev.event}\nid: ${ev.lastEventId || '—'}\ndata: ${data}`, ts: ev.ts })
    } else if (ev.kind === 'warn') {
      appendStream(tab, { kind: 'system', message: ev.message, ts: ev.ts })
    } else if (ev.kind === 'close') {
      tab.stream.connected = false
      tab.stream.status = 'closed'
      appendStream(tab, { kind: 'system', message: 'Stream closed', ts: ev.ts })
      updateSendButton()
    } else if (ev.kind === 'error') {
      tab.stream.connected = false
      tab.stream.status = 'error'
      appendStream(tab, { kind: 'system', message: `Error: ${ev.message}`, ts: ev.ts })
      updateSendButton()
    }
    if (tab.id === state.activeTabId) renderStream()
  }

  function renderStream () {
    const tab = activeTab()
    if (!tab) return
    const st = tab.stream
    const pill = $('#streamStatus')
    pill.classList.remove('hidden', 'ok', 'err', 'redirect')
    const connected = st.connected
    pill.textContent = st.status ? st.status : (connected ? 'connected' : 'idle')
    pill.classList.add(connected ? 'ok' : st.status === 'error' ? 'err' : 'redirect')
    const countEl = $('#streamCount')
    countEl.textContent = `${st.count} messages`
    countEl.classList.remove('hidden')
    renderStreamLog()
    $('#streamInput').disabled = tab.request.kind === 'sse'
    $('#btn-stream-send').disabled = tab.request.kind === 'sse'
    $('#streamInput').placeholder = tab.request.kind === 'sse' ? 'SSE is receive-only' : 'Message to send (WS)…'
  }

  function renderStreamLog () {
    const tab = activeTab()
    if (!tab) return
    const box = $('#streamLog')
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
    box.textContent = ''
    for (const entry of tab.stream.log) {
      const line = el('div', `stream-line ${entry.kind === 'in' ? 'in' : entry.kind === 'out' ? 'out' : 'sys'}`)
      line.appendChild(el('span', 'dir', entry.kind === 'in' ? '← recv' : entry.kind === 'out' ? 'send →' : 'system'))
      line.appendChild(el('span', 'stream-time', new Date(entry.ts).toTimeString().slice(0, 8)))
      const data = el('span', 'stream-data', entry.data ?? entry.message ?? '')
      line.appendChild(data)
      box.appendChild(line)
    }
    if (atBottom) box.scrollTop = box.scrollHeight
  }

  function sendStreamMessage () {
    const tab = activeTab()
    if (!tab || tab.request.kind !== 'ws') return
    const input = $('#streamInput')
    const text = input.value
    if (!text.trim()) return
    const result = api.ws.send({ id: tab.stream.streamId, data: text })
    result.then((res) => {
      if (res && res.ok === false) toast(res.error || 'Send failed')
      else {
        appendStream(tab, { kind: 'out', data: text, ts: Date.now() })
        input.value = ''
      }
    })
  }

  // ---------------------------------------------------------------- save / collections
  function saveRequestModal () {
    const tab = activeTab()
    if (!tab) return
    const existing = tab.savedNodeId ? findNode(tab.savedNodeId, state.collections) : null
    const body = el('div', 'form-grid')
    body.appendChild(el('div', 'mini-label', 'Request name'))
    const name = document.createElement('input')
    name.className = 'mini-input'
    name.value = (existing && existing.name) || tab.request.name || 'Untitled'
    body.appendChild(name)

    if (!existing) {
      body.appendChild(el('div', 'mini-label', 'Collection'))
      const select = document.createElement('select')
      select.className = 'mini-input'
      for (const c of state.collections) {
        const opt = el('option', null, c.name)
        opt.value = c.id
        select.appendChild(opt)
      }
      const newOpt = el('option', null, '+ New collection…')
      newOpt.value = '__new__'
      select.appendChild(newOpt)
      body.appendChild(select)
      const newName = document.createElement('input')
      newName.className = 'mini-input hidden'
      newName.placeholder = 'New collection name'
      body.appendChild(newName)
      select.addEventListener('change', () => newName.classList.toggle('hidden', select.value !== '__new__'))

      openModal({
        title: existing ? 'Rename saved request' : 'Save request',
        body,
        actions: [
          { label: 'Cancel', kind: 'secondary' },
          {
            label: 'Save',
            kind: 'primary',
            onClick: () => {
              const finalName = name.value.trim() || 'Untitled'
              if (existing) {
                existing.name = finalName
                existing.request = clone(tab.request)
                tab.request.name = finalName
              } else {
                let target = state.collections.find((c) => c.id === select.value)
                if (select.value === '__new__') {
                  target = { id: uid(), type: 'collection', name: newName.value.trim() || 'New collection', items: [] }
                  state.collections.push(target)
                }
                if (!target) {
                  target = { id: uid(), type: 'collection', name: 'My Collection', items: [] }
                  state.collections.push(target)
                }
                const node = { id: uid(), type: 'request', name: finalName, request: clone(tab.request) }
                node.request.name = finalName
                target.items.push(node)
                tab.savedNodeId = node.id
                tab.request.name = finalName
              }
              tab.dirty = false
              closeModal()
              renderAll()
              saveSoon()
              toast('Saved')
            }
          }
        ]
      })
      return
    }

    openModal({
      title: 'Save request',
      body,
      actions: [
        { label: 'Cancel', kind: 'secondary' },
        {
          label: 'Save',
          kind: 'primary',
          onClick: () => {
            const finalName = name.value.trim() || 'Untitled'
            existing.name = finalName
            existing.request = clone(tab.request)
            tab.request.name = finalName
            tab.dirty = false
            closeModal()
            renderAll()
            saveSoon()
            toast('Saved')
          }
        }
      ]
    })
  }

  function createRequestIn (node) {
    const req = makeRequest()
    req.name = 'Untitled'
    const tab = makeTab(req)
    state.tabs.push(tab)
    state.activeTabId = tab.id
    tab.dirty = true
    renderAll()
    toast('New request tab — press ⌘S to save into the folder')
    saveSoon()
  }

  function createFolderIn (node) {
    const folder = { id: uid(), type: 'folder', name: 'New folder', items: [] }
    node.items.push(folder)
    renderSidebar()
    saveSoon()
  }

  function renameNode (node) {
    const body = el('div')
    const input = document.createElement('input')
    input.className = 'mini-input'
    input.value = node.name || ''
    body.appendChild(input)
    openModal({
      title: 'Rename',
      body,
      actions: [
        { label: 'Cancel', kind: 'secondary' },
        {
          label: 'Rename',
          kind: 'primary',
          onClick: () => {
            node.name = input.value.trim() || node.name
            closeModal()
            renderAll()
            saveSoon()
          }
        }
      ]
    })
    setTimeout(() => { input.focus(); input.select() }, 40)
  }

  function deleteNode (node) {
    openModal({
      title: 'Delete',
      body: el('p', null, `Delete "${node.name}"? This cannot be undone.`),
      actions: [
        { label: 'Cancel', kind: 'secondary' },
        {
          label: 'Delete',
          kind: 'danger',
          onClick: () => {
            removeNode(node.id, state.collections)
            for (const tab of state.tabs) if (tab.savedNodeId === node.id) tab.savedNodeId = null
            closeModal()
            renderAll()
            saveSoon()
          }
        }
      ]
    })
  }

  function duplicateRequestNode (node) {
    const copy = { id: uid(), type: 'request', name: `${node.name} copy`, request: clone(node.request) }
    const parent = parentListOf(node)
    if (parent) parent.splice(parent.indexOf(node) + 1, 0, copy)
    renderSidebar()
    saveSoon()
  }

  // ---------------------------------------------------------------- cURL
  function importCurlModal () {
    const body = el('div')
    body.appendChild(el('div', 'mini-label', 'Paste a cURL command'))
    const ta = el('textarea', 'code-area')
    ta.style.minHeight = '180px'
    ta.placeholder = "curl 'https://api.example.com/v1/things' -H 'Authorization: Bearer …'"
    body.appendChild(ta)
    openModal({
      title: 'Import cURL',
      body,
      actions: [
        { label: 'Cancel', kind: 'secondary' },
        {
          label: 'Import',
          kind: 'primary',
          onClick: () => {
            const result = window.Curl.parse(ta.value)
            if (!result.ok) { toast(result.error); return }
            result.request.name = newTabNameFromUrl(result.request.url)
            const tab = makeTab(result.request)
            state.tabs.push(tab)
            state.activeTabId = tab.id
            closeModal()
            renderAll()
            saveSoon()
            if (result.warnings.length) toast(`Imported with ${result.warnings.length} note(s)`)
          }
        }
      ]
    })
    setTimeout(() => ta.focus(), 40)
  }

  function newTabNameFromUrl (url) {
    try {
      const u = new URL(url)
      return (u.pathname === '/' ? u.host : u.pathname.split('/').filter(Boolean).pop()) || 'Request'
    } catch { return 'Request' }
  }

  async function exportCurl () {
    const tab = activeTab()
    if (!tab) return
    const req = tab.request
    const payload = buildPayload(req)
    const text = window.Curl.build(req, payload.url, payload.headers, req.body && req.body.type !== 'none' ? { present: true } : null)
    await api.clipboard.write(text)
    toast('cURL copied to clipboard')
  }

  // ---------------------------------------------------------------- environments modal
  function envModal () {
    const body = el('div')
    const render = () => {
      body.textContent = ''
      state.environments.forEach((env) => {
        const card = el('div', 'env-card')
        const head = el('div', 'env-head')
        const name = document.createElement('input')
        name.className = 'mini-input'
        name.value = env.name
        name.style.maxWidth = '220px'
        name.addEventListener('input', () => { env.name = name.value; renderEnvSelect(); saveSoon() })
        head.appendChild(name)
        const activeBtn = el('button', `ghost-btn${env.id === state.activeEnvId ? ' is-active' : ''}`, env.id === state.activeEnvId ? 'active' : 'set active')
        activeBtn.addEventListener('click', () => { state.activeEnvId = env.id; render(); renderEnvSelect(); saveSoon() })
        head.appendChild(activeBtn)
        const del = el('button', 'ghost-btn', 'delete')
        del.addEventListener('click', () => {
          state.environments = state.environments.filter((e) => e.id !== env.id)
          if (state.activeEnvId === env.id) state.activeEnvId = (state.environments[0] || {}).id || null
          render(); renderEnvSelect(); saveSoon()
        })
        head.appendChild(del)
        card.appendChild(head)

        const table = el('div', 'kv-table')
        renderKv(table, env.vars, {
          onChange: (structural) => { saveSoon(); if (structural) render() }
        })
        card.appendChild(table)
        const add = el('button', 'ghost-btn', '+ Add variable')
        add.addEventListener('click', () => { env.vars.push({ key: '', value: '', enabled: true }); render() })
        card.appendChild(add)
        body.appendChild(card)
      })
      const addEnv = el('button', 'ghost-btn', '+ Add environment')
      addEnv.addEventListener('click', () => {
        const env = { id: uid(), name: `Env ${state.environments.length + 1}`, vars: [] }
        state.environments.push(env)
        render()
        saveSoon()
      })
      body.appendChild(addEnv)
      body.appendChild(el('p', 'muted small', 'Reference variables anywhere with {{name}}. Built-ins: {{$timestamp}}, {{$isoTimestamp}}, {{$uuid}}, {{$randomInt}}.'))
    }
    render()
    openModal({ title: 'Environments', body, actions: [{ label: 'Done', kind: 'primary' }] })
  }

  // ---------------------------------------------------------------- modal & toast
  function openModal ({ title, body, actions }) {
    $('#modalTitle').textContent = title
    const box = $('#modalBody')
    box.textContent = ''
    box.appendChild(body)
    const foot = $('#modalFoot')
    foot.textContent = ''
    for (const action of actions || []) {
      const btn = el('button', action.kind === 'primary' ? 'btn-primary' : 'btn-secondary', action.label)
      if (action.kind === 'danger') btn.style.background = 'var(--red)'
      btn.addEventListener('click', () => {
        if (action.onClick) action.onClick()
        else closeModal()
      })
      foot.appendChild(btn)
    }
    $('#modal').classList.remove('hidden')
  }

  function closeModal () { $('#modal').classList.add('hidden') }

  // ---------------------------------------------------------------- tool registry
  const TOOL_GROUPS = [
    {
      id: 'dev', title: '开发', tools: [
        { id: 'http', name: '请求工具', tone: 'indigo', icon: '⇄', tag: '主力', desc: 'HTTP · GraphQL · WebSocket · SSE，集合、历史、环境变量、cURL' },
        { id: 'jwt', name: 'JWT 解析', tone: 'cyan', icon: '⚿', desc: '拆 Header / Payload，过期与时间声明，HS256 验签' },
        { id: 'regex', name: '正则测试', tone: 'violet', icon: '.*', desc: '实时高亮、分组捕获、替换预览、常用正则收藏' },
        { id: 'codegen', name: 'cURL 转代码', tone: 'indigo', icon: '</>', desc: 'cURL 一键生成 Python / JS / Go / Java 请求代码' }
      ]
    },
    {
      id: 'encode', title: '编码与转换', tools: [
        { id: 'escape', name: '字符转义', tone: 'cyan', icon: 'Esc', desc: 'JS / JSON / URL / HTML 实体 / Unicode 正向与反向转义' },
        { id: 'base64', name: 'Base64 工具箱', tone: 'amber', icon: '64', desc: '文本加解密 · 图片转 Base64 · Base64 转图片' },
        { id: 'hash', name: 'Hash 摘要', tone: 'green', icon: '#', desc: 'MD5 / SHA-1 / SHA-256 / SHA-512，文本与文件' },
        { id: 'timestamp', name: '时间戳转换', tone: 'pink', icon: 'Ts', desc: 'Unix 时间戳与日期互转、多时区对照、相对时间' }
      ]
    },
    {
      id: 'text', title: '文本与生成', tools: [
        { id: 'json', name: 'JSON 格式化', tone: 'green', icon: '{ }', desc: '格式化、压缩、键排序、校验与错误定位' },
        { id: 'markdown', name: 'Markdown 编辑器', tone: 'violet', icon: 'M↓', desc: '实时预览、图片回显、Mermaid 流程图、导出 HTML' },
        { id: 'generator', name: 'UUID / 密码', tone: 'cyan', icon: '⧉', desc: 'UUID v4/v7 批量、随机密码与强度估算' }
      ]
    }
  ]

  const VIEWS = ['home', ...TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.id))]
  // ⌘1 = 工具箱, ⌘2…⌘9 = the first eight tools in registry order
  const SHORTCUT_ORDER = VIEWS.slice(0, 9)

  function allTools () {
    return TOOL_GROUPS.flatMap((g) => g.tools.map((t) => Object.assign({ group: g.title }, t)))
  }

  function renderHome (query) {
    const box = $('#toolGroups')
    if (!box) return
    box.textContent = ''
    const q = (query || '').trim().toLowerCase()
    let shown = 0

    // recent tools: a compact strip above the groups, hidden while filtering
    const recent = (state.ui.recent || []).filter((id) => allTools().some((t) => t.id === id))
    if (!q && recent.length) {
      const section = el('div', 'tool-group is-recent')
      section.appendChild(el('h3', null, '最近使用'))
      const row = el('div', 'recent-row')
      for (const id of recent.slice(0, 6)) {
        const tool = allTools().find((t) => t.id === id)
        const chip = el('button', 'recent-chip', tool.name)
        chip.dataset.open = tool.id
        row.appendChild(chip)
      }
      section.appendChild(row)
      box.appendChild(section)
    }

    for (const group of TOOL_GROUPS) {
      const tools = group.tools.filter((t) => !q || `${t.name} ${t.desc} ${t.id}`.toLowerCase().includes(q))
      if (!tools.length) continue
      shown += tools.length
      const section = el('div', 'tool-group')
      section.appendChild(el('h3', null, group.title))
      const row = el('div', 'row')
      for (const tool of tools) {
        const card = el('button', `tool-card${q ? ' is-match' : ''}`)
        card.dataset.open = tool.id
        card.dataset.tone = tool.tone
        const icon = el('span', 'tool-icon', tool.icon)
        card.appendChild(icon)
        card.appendChild(el('span', 'tool-name', tool.name))
        card.appendChild(el('span', 'tool-desc', tool.desc))
        if (tool.tag) card.appendChild(el('span', 'tool-tag', tool.tag))
        row.appendChild(card)
      }
      section.appendChild(row)
      box.appendChild(section)
    }

    if (!shown) {
      box.appendChild(el('p', 'no-result', `没有匹配「${q}」的工具`))
    }
    const counter = $('#toolCount')
    if (counter) counter.textContent = `${allTools().length} 个工具 · 全部本地运行`
  }

  function showView (name) {
    if (!VIEWS.includes(name)) name = 'home'
    if (name !== 'home') {
      const recent = state.ui.recent || (state.ui.recent = [])
      const idx = recent.indexOf(name)
      if (idx >= 0) recent.splice(idx, 1)
      recent.unshift(name)
      if (recent.length > 8) recent.length = 8
    }
    state.ui.view = name
    for (const view of $$('.view')) view.classList.toggle('is-active', view.dataset.view === name)
    if (name === 'home') renderHome(state.ui.toolQuery || '')
    if (name === 'http') {
      renderAll()
    } else if (name === 'markdown' && typeof window.__moziRenderMarkdown === 'function') {
      window.__moziRenderMarkdown()
    }
    saveSoon()
  }

  // ---------------------------------------------------------------- render orchestration
  function renderAll () {
    renderSidebar()
    renderTabs()
    renderRequest()
    saveSoon()
  }

  // ---------------------------------------------------------------- wiring
  function wire () {
    $('#search').addEventListener('input', (e) => { state.ui.search = e.target.value; renderSidebar() })
    $('#sidebar-scroll').addEventListener('scroll', () => {}, { passive: true })

    $$('.side-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.ui.side = btn.dataset.side
        $$('.side-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.side === state.ui.side))
        renderSidebar()
        saveSoon()
      })
    })

    $('#toolGroups').addEventListener('click', (e) => {
      const target = e.target.closest('.tool-card, .recent-chip')
      if (target) showView(target.dataset.open)
    })
    $('#toolSearch').addEventListener('input', (e) => {
      state.ui.toolQuery = e.target.value
      renderHome(e.target.value)
      saveSoon()
    })
    for (const back of $$('[data-back]')) {
      back.addEventListener('click', () => showView('home'))
    }
    $('#btn-home').addEventListener('click', () => showView('home'))

    $('#btn-new-request').addEventListener('click', () => newTab())
    $('#btn-new-tab').addEventListener('click', () => newTab())
    $('#btn-new-collection').addEventListener('click', () => {
      const body = el('div')
      const input = document.createElement('input')
      input.className = 'mini-input'
      input.placeholder = 'Collection name'
      body.appendChild(input)
      openModal({
        title: 'New collection',
        body,
        actions: [
          { label: 'Cancel', kind: 'secondary' },
          {
            label: 'Create',
            kind: 'primary',
            onClick: () => {
              state.collections.push({ id: uid(), type: 'collection', name: input.value.trim() || 'New collection', items: [] })
              closeModal()
              renderSidebar()
              saveSoon()
            }
          }
        ]
      })
      setTimeout(() => input.focus(), 40)
    })

    $('#envSelect').addEventListener('change', (e) => { state.activeEnvId = e.target.value; saveSoon(); renderRequest() })
    $('#btn-env-manage').addEventListener('click', envModal)

    $$('.req-tab').forEach((btn) => btn.addEventListener('click', () => setReqTab(btn.dataset.reqtab)))
    $$('.resp-tab').forEach((btn) => btn.addEventListener('click', () => setRespTab(btn.dataset.resptab)))

    $('#kindSelect').addEventListener('change', (e) => {
      const tab = activeTab()
      if (tab.stream && tab.stream.connected) stopStream(tab)
      tab.request.kind = e.target.value
      if (tab.request.kind === 'ws') tab.request.method = 'GET'
      renderRequest()
      markDirty()
    })

    $('#methodSelect').addEventListener('change', (e) => { activeTab().request.method = e.target.value; renderTabs(); markDirty() })

    $('#urlInput').addEventListener('input', (e) => {
      if (syncingParams) return
      activeTab().request.url = e.target.value
      syncParamsFromUrl()
      renderTabs()
      markDirty()
    })

    $('#urlInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendActive() }
    })

    $('#btn-send').addEventListener('click', sendActive)
    $('#btn-save').addEventListener('click', saveRequestModal)
    $('#btn-curl-import').addEventListener('click', importCurlModal)
    $('#btn-curl-export').addEventListener('click', exportCurl)

    $('#opt-follow').addEventListener('change', (e) => { activeTab().request.options.followRedirects = e.target.checked; markDirty() })
    $('#opt-insecure').addEventListener('change', (e) => { activeTab().request.options.insecure = e.target.checked; markDirty() })
    $('#opt-timing').addEventListener('change', (e) => { state.settings.showTiming = e.target.checked; renderResponse(); saveSoon() })

    $('#btn-add-param').addEventListener('click', () => { activeTab().request.params.push({ key: '', value: '', enabled: true }); renderParams(); markDirty() })
    $('#btn-add-header').addEventListener('click', () => { activeTab().request.headers.push({ key: '', value: '', enabled: true }); renderHeaders(); markDirty() })
    $('#btn-header-preset').addEventListener('click', () => {
      const headers = activeTab().request.headers
      if (!headers.some((h) => /^content-type$/i.test(h.key))) headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
      renderHeaders()
      markDirty()
    })

    $$('#bodyType .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = activeTab()
        tab.request.body.type = btn.dataset.bodytype
        renderBody()
        markDirty()
      })
    })

    $('#body-json').addEventListener('input', (e) => { activeTab().request.body.text = e.target.value; markDirty() })
    $('#body-text').addEventListener('input', (e) => { activeTab().request.body.text = e.target.value; markDirty() })
    $('#body-contentType').addEventListener('input', (e) => { activeTab().request.body.contentType = e.target.value; markDirty() })
    $('#gql-query').addEventListener('input', (e) => { activeTab().request.body.graphql.query = e.target.value; markDirty() })
    $('#gql-vars').addEventListener('input', (e) => { activeTab().request.body.graphql.variables = e.target.value; markDirty() })

    $('#btn-format-json').addEventListener('click', () => {
      const tab = activeTab()
      try {
        tab.request.body.text = JSON.stringify(JSON.parse(tab.request.body.text || '{}'), null, 2)
        renderBody()
        markDirty()
        toast('JSON formatted')
      } catch (err) { toast(`Invalid JSON: ${err.message}`) }
    })

    $('#btn-add-form-urlencoded').addEventListener('click', () => { activeTab().request.body.formUrlencoded.push({ key: '', value: '', enabled: true }); renderBody(); markDirty() })
    $('#btn-add-form-data').addEventListener('click', () => { activeTab().request.body.formData.push({ key: '', value: '', type: 'text', enabled: true }); renderBody(); markDirty() })
    $('#btn-add-file').addEventListener('click', async () => {
      const files = await api.files.pick()
      for (const f of files) activeTab().request.body.formData.push({ key: f.name, value: '', type: 'file', path: f.path, fileName: f.name, enabled: true })
      renderBody()
      markDirty()
    })
    $('#btn-pick-binary').addEventListener('click', async () => {
      const files = await api.files.pick()
      if (files[0]) {
        const body = activeTab().request.body
        body.filePath = files[0].path
        body.fileName = files[0].name
        renderBody()
        markDirty()
      }
    })

    $('#authType').addEventListener('change', (e) => { activeTab().request.auth.type = e.target.value; renderAuth(); markDirty() })
    $('#auth-token').addEventListener('input', (e) => { activeTab().request.auth.token = e.target.value; markDirty() })
    $('#auth-username').addEventListener('input', (e) => { activeTab().request.auth.username = e.target.value; markDirty() })
    $('#auth-password').addEventListener('input', (e) => { activeTab().request.auth.password = e.target.value; markDirty() })
    $('#auth-key').addEventListener('input', (e) => { activeTab().request.auth.key = e.target.value; markDirty() })
    $('#auth-value').addEventListener('input', (e) => { activeTab().request.auth.value = e.target.value; markDirty() })
    $('#auth-addto').addEventListener('change', (e) => { activeTab().request.auth.addTo = e.target.value; markDirty() })

    $('#btn-copy-resp').addEventListener('click', async () => {
      const tab = activeTab()
      if (!tab || !tab.response) return
      const res = tab.response
      await api.clipboard.write(res.text || res.base64 || res.error || '')
      toast('Response copied')
    })
    $('#btn-clear-resp').addEventListener('click', () => { const tab = activeTab(); if (tab) { tab.response = null; renderResponse() } })

    $('#btn-stream-clear').addEventListener('click', () => { const tab = activeTab(); if (tab) { tab.stream.log = []; tab.stream.count = 0; renderStream() } })
    $('#btn-stream-close').addEventListener('click', () => { const tab = activeTab(); if (tab) stopStream(tab) })
    $('#btn-stream-send').addEventListener('click', sendStreamMessage)
    $('#streamInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendStreamMessage() } })

    $('#modalClose').addEventListener('click', closeModal)
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal() })

    api.menu.onHome(() => showView('home'))
    api.menu.onTool((name) => showView(name))
    api.menu.onNewRequest(() => { showView('http'); newTab() })
    api.menu.onImportCurl(() => { showView('http'); importCurlModal() })
    api.menu.onSaveRequest(() => { showView('http'); saveRequestModal() })

    api.ws.onEvent(onWsEvent)
    api.sse.onEvent(onSseEvent)

    // request | response vertical split (the stream pane swaps in for the
    // response pane in WS/SSE mode, so both are given as candidates)
    Split.handle({
      first: $('.request-pane'),
      second: [$('.response-pane'), $('.stream-pane')],
      handle: $('#splitter'),
      axis: 'y',
      unit: 'pct',
      storageKey: 'http.vertical',
      def: 52,
      min: 20,
      max: 80
    })
    Split.auto()

    // Esc: close a dialog first, otherwise go back to the toolbox
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      if (!$('#modal').classList.contains('hidden')) { closeModal(); return }
      if (state.ui.view !== 'home') {
        e.preventDefault()
        showView('home')
      }
    })

    // shortcuts
    window.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      // ⌘1…⌘9 jump straight to a tool from anywhere (⌘1 is the toolbox itself)
      if (/^[1-9]$/.test(e.key)) {
        const target = SHORTCUT_ORDER[Number(e.key) - 1]
        if (target) { e.preventDefault(); showView(target) }
        return
      }
      if (e.key.toLowerCase() === 'e') { e.preventDefault(); showView('home'); $('#toolSearch').focus(); return }

      if (state.ui.view !== 'http') {
        if (e.key === 'Escape') closeModal()
        return
      }
      if (e.key === 'Enter') { e.preventDefault(); sendActive() }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); saveRequestModal() }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); newTab() }
      else if (e.key.toLowerCase() === 'i') { e.preventDefault(); importCurlModal() }
      else if (e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus() }
      else if (e.key.toLowerCase() === 'w') { e.preventDefault(); if (state.activeTabId) closeTab(state.activeTabId) }
    })

    window.addEventListener('beforeunload', () => { saveNow() })
  }

  // ---------------------------------------------------------------- init
  async function init () {
    const info = await api.info()
    document.body.classList.add(`platform-${info.platform}`)

    let data = null
    try { data = await api.store.load() } catch { data = null }
    if (data) {
      state = Object.assign(defaults(), data)
      state.settings = Object.assign(defaults().settings, data.settings || {})
      state.ui = Object.assign(defaults().ui, data.ui || {})
      if (!state.environments || !state.environments.length) state.environments = defaults().environments
      if (!state.activeEnvId) state.activeEnvId = state.environments[0].id
    } else {
      seed()
    }

    // Rehydrate tabs from persistence (responses are not persisted).
    state.tabs = (state.tabs || []).map((t) => Object.assign(makeTab(t.request), t, {
      request: Object.assign(makeRequest(), t.request || {}),
      response: null,
      stream: { connected: false, streamId: uid(), log: [], status: null, count: 0 }
    }))
    if (!state.tabs.length) state.tabs = [makeTab(makeRequest())]
    if (!state.tabs.some((t) => t.id === state.activeTabId)) state.activeTabId = state.tabs[0].id

    $('#opt-timing').checked = state.settings.showTiming !== false
    wire()
    renderAll()
    renderSidebar()
    renderHome('')
    showView(state.ui.view || 'home')
  }

  function seed () {
    const coll = { id: uid(), type: 'collection', name: 'Examples', items: [] }
    const jsonReq = makeRequest({
      name: 'JSON sample',
      method: 'GET',
      url: 'https://httpbin.org/json'
    })
    const postReq = makeRequest({
      name: 'POST echo',
      method: 'POST',
      url: 'https://postman-echo.com/post',
      body: { ...makeBody(), type: 'json', text: '{\n  "hello": "postlite"\n}' }
    })
    const wsReq = makeRequest({
      name: 'WebSocket echo',
      kind: 'ws',
      method: 'GET',
      url: 'wss://echo.websocket.events'
    })
    coll.items.push(
      { id: uid(), type: 'request', name: jsonReq.name, request: jsonReq },
      { id: uid(), type: 'request', name: postReq.name, request: postReq },
      { id: uid(), type: 'request', name: wsReq.name, request: wsReq }
    )
    state.collections = [coll]
    state.activeEnvId = state.environments[0].id
    state.ui.reqTab = 'params'
    state.ui.respTab = 'pretty'
  }

  init().catch((err) => {
    console.error(err)
    const box = document.createElement('pre')
    box.style.cssText = 'color:#f2555a;padding:20px;white-space:pre-wrap'
    box.textContent = `PostLite failed to start:\n${err.stack || err.message}`
    document.body.appendChild(box)
  })
})()
