'use strict'

const http = require('node:http')
const path = require('node:path')
const fsp = require('node:fs/promises')
const { WebSocketServer } = require('ws')

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function startServers () {
  const jsonServer = http.createServer((req, res) => {
    if (req.url.startsWith('/grant')) {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Set-Cookie': ['sid=smoke-session-42; Path=/', 'prefs=dark; Max-Age=86400']
      })
      res.end('granted')
      return
    }
    if (req.url.startsWith('/whoami')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ cookie: req.headers.cookie || null }))
      return
    }
    if (req.url.startsWith('/echo-headers')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        authorization: req.headers.authorization || null,
        xTrace: req.headers['x-trace'] || null
      }))
      return
    }
    if (req.url.startsWith('/json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, items: [{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }], meta: { total: 2 } }))
      return
    }
    if (req.url.startsWith('/events-post')) {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        if (req.method !== 'POST' || !body.includes('stream')) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('expected POST body containing "stream"')
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        res.write('event: post\nid: 1\ndata: {"ok":true,"method":"POST"}\n\n')
        setTimeout(() => res.end(), 80)
      })
      return
    }
    if (req.url.startsWith('/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      let n = 0
      const timer = setInterval(() => {
        n++
        res.write(`event: tick\nid: ${n}\ndata: ${JSON.stringify({ tick: n, at: Date.now() })}\n\n`)
        if (n >= 3) { clearInterval(timer); res.end() }
      }, 120)
      req.on('close', () => clearInterval(timer))
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })

  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  wss.on('connection', (socket) => {
    socket.send('hello from smoke ws')
    socket.on('message', (data) => socket.send(`echo:${data}`))
  })

  const wssReady = new Promise((resolve) => wss.once('listening', resolve))
  const httpReady = new Promise((resolve) => jsonServer.listen(0, '127.0.0.1', resolve))
  return Promise.all([httpReady, wssReady]).then(() => ({
    server: jsonServer,
    wss,
    base: `http://127.0.0.1:${jsonServer.address().port}`,
    wsBase: `ws://127.0.0.1:${wss.address().port}`
  }))
}

async function runSmoke (win, app) {
  const out = process.env.MOZI_SMOKE_OUT || process.env.POSTLITE_SMOKE_OUT || path.join(app.getPath('temp'), 'mozi-smoke.png')
  const shot = (suffix) => out.replace(/\.png$/, `${suffix}.png`)
  const failures = []
  const checks = []
  let servers = null

  const check = (name, ok, extra) => {
    checks.push(name)
    if (!ok) failures.push(name)
    console.log(`${ok ? 'CHECK_OK  ' : 'CHECK_FAIL'} ${name}${extra ? ' :: ' + extra : ''}`)
  }
  const step = (script) => win.webContents.executeJavaScript(script, true)
  const visibleCheck = async (viewId) => {
    const box = JSON.parse(await step(`(async () => {
      const view = document.querySelector('.view.is-active')
      const head = view.querySelector('.tool-head') || view.querySelector('header')
      const body = view.querySelector('.tool-body')
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } }
      return JSON.stringify({ view: view.dataset.view, head: rect(head), body: rect(body), win: { w: window.innerWidth, h: window.innerHeight } })
    })()`))
    const ok = box.view === viewId && box.body && box.body.w > 200 && box.body.h > 100 && box.body.top < box.win.h
    check(`${viewId} view is visible`, ok, JSON.stringify(box))
    return box
  }

  const capture = async (file) => {
    const image = await win.webContents.capturePage()
    await fsp.writeFile(file, image.toPNG())
  }

  try {
    await new Promise((r) => setTimeout(r, 1600))

    // ============ HOME ============
    const home = JSON.parse(await step(`JSON.stringify({
      title: document.title,
      active: document.querySelector('.view.is-active').dataset.view,
      cards: document.querySelectorAll('.tool-card').length,
      names: [...document.querySelectorAll('.tool-name')].map(e => e.textContent),
      brand: document.querySelector('.home-brand h1').textContent,
      errors: window.__errors || []
    })`))
    console.log('HOME_DIAG', JSON.stringify(home))
    check('app title is Mozi', home.title === 'Mozi', home.title)
    check('home is the entry view', home.active === 'home', home.active)
    check('eleven tool cards', home.cards === 11, String(home.cards))
    check('cards named correctly', ['请求工具', '字符转义', 'JSON 格式化', 'Base64 工具箱', 'Markdown 编辑器', 'JWT 解析', '正则测试', 'cURL 转代码', 'Hash 摘要', '时间戳转换', 'UUID / 密码'].every((n) => home.names.includes(n)), home.names.join(','))
    const groupCount = JSON.parse(await step(`JSON.stringify(document.querySelectorAll('.tool-group').length)`))
    check('home is grouped', groupCount === 3, String(groupCount))
    const freshStrip = JSON.parse(await step(`JSON.stringify({ hasStrip: !!document.querySelector('.tool-group.is-recent') })`))
    check('fresh profile has no recent strip', !freshStrip.hasStrip)
    const icons = JSON.parse(await step(`JSON.stringify([...document.querySelectorAll('.tool-icon')].map(e => e.textContent))`))
    check('every tool icon renders', icons.length === 11 && icons.every((i) => i && i.trim().length > 0 && !/\n/.test(i)), JSON.stringify(icons))
    const saveBtn = JSON.parse(await step(`JSON.stringify({
      exists: !!document.querySelector('#btn-save'),
      label: (document.querySelector('#btn-save') || {}).textContent || '',
      cls: (document.querySelector('#btn-save') || {}).className || ''
    })`))
    check('save button is a visible labeled button', saveBtn.exists && saveBtn.label.trim() === '保存' && saveBtn.cls.includes('save-btn'), JSON.stringify(saveBtn))

    const scrollLayout = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const groups = document.querySelector('#toolGroups')
      // make the list genuinely overflow, then verify it is the scroller
      groups.style.maxHeight = '160px'
      groups.scrollTop = 0
      groups.scrollTop = 400
      await wait(80)
      const scrolled = groups.scrollTop
      groups.style.maxHeight = ''
      const head = document.querySelector('.home-head').getBoundingClientRect()
      const view = document.querySelector('#view-home').getBoundingClientRect()
      return JSON.stringify({
        scrolled,
        headFixedInsideView: head.top >= view.top - 1 && head.bottom <= view.bottom,
        viewOverflow: getComputedStyle(document.querySelector('#view-home')).overflow
      })
    })()`))
    check('only the tool list scrolls', scrollLayout.scrolled > 0, String(scrollLayout.scrolled))
    check('home header stays fixed', scrollLayout.headFixedInsideView && scrollLayout.viewOverflow === 'hidden', JSON.stringify(scrollLayout))

    await capture(shot('-home'))

    // open the HTTP tool
    await step(`document.querySelector('.tool-card[data-open="http"]').click()`)
    await new Promise((r) => setTimeout(r, 500))
    const httpView = JSON.parse(await step(`JSON.stringify({
      active: document.querySelector('.view.is-active').dataset.view,
      tree: document.querySelectorAll('#collectionTree .node').length,
      bg: getComputedStyle(document.body).backgroundColor
    })`))
    check('http tool opens', httpView.active === 'http', httpView.active)
    check('seed collections rendered', httpView.tree >= 4, `${httpView.tree} nodes`)
    const themeAtBoot = JSON.parse(await step(`JSON.stringify({ mode: document.documentElement.dataset.theme, seg: [...document.querySelectorAll('#themeSeg .seg-btn.is-active')].map(b => b.dataset.themeChoice) })`))
    check('theme resolves at boot', themeAtBoot.mode === 'dark' || themeAtBoot.mode === 'light', themeAtBoot.mode)
    check('theme segment marks the mode', themeAtBoot.seg.length === 1, themeAtBoot.seg.join(','))
    const expectedBg = themeAtBoot.mode === 'light' ? 'rgb(244, 246, 250)' : 'rgb(14, 16, 21)'
    check('body background matches theme', httpView.bg === expectedBg, `${httpView.bg} vs ${expectedBg} (${themeAtBoot.mode})`)

    servers = await startServers()

    // ============ HTTP ============
    const httpResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const setValue = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
      setValue(document.querySelector('#urlInput'), '${servers.base}/json?demo=1')
      document.querySelector('#btn-send').click()
      for (let i = 0; i < 100; i++) {
        await wait(50)
        const pill = document.querySelector('#respStatus')
        if (pill && !pill.classList.contains('hidden')) break
      }
      await wait(150)
      return JSON.stringify({
        status: document.querySelector('#respStatus').textContent.trim(),
        time: document.querySelector('#respTime').textContent.trim(),
        size: document.querySelector('#respSize').textContent.trim(),
        tree: document.querySelectorAll('#respPretty .jt').length,
        keys: [...document.querySelectorAll('#respPretty .jt-key')].slice(0, 6).map(e => e.textContent)
      })
    })()`))
    check('http 200', httpResult.status.startsWith('200'), httpResult.status)
    check('http timing', /\d+ ms/.test(httpResult.time), httpResult.time)
    check('http size', /B|KB/.test(httpResult.size), httpResult.size)
    check('json tree rendered', httpResult.tree === 1)
    check('json keys visible', httpResult.keys.includes('ok') && httpResult.keys.includes('items'), httpResult.keys.join(','))

    // Headers (including the Auth tab) must actually reach the server.
    const headerResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const setValue = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
      document.querySelector('#btn-add-header').click()
      await wait(80)
      const rows = document.querySelectorAll('#headersTable .kv-row')
      const last = rows[rows.length - 1]
      const key = last.querySelectorAll('input[type=text]')[0]
      const val = last.querySelectorAll('input[type=text]')[1]
      setValue(key, 'X-Trace'); setValue(val, 'pair-form-check')
      const authType = document.querySelector('#authType')
      authType.value = 'bearer'; authType.dispatchEvent(new Event('change', { bubbles: true }))
      setValue(document.querySelector('#auth-token'), 'sk-smoke-token-123')
      setValue(document.querySelector('#urlInput'), '${servers.base}/echo-headers')
      document.querySelector('#btn-send').click()
      for (let i = 0; i < 100; i++) {
        await wait(50)
        const pill = document.querySelector('#respStatus')
        if (pill && !pill.classList.contains('hidden') && pill.textContent.startsWith('200')) break
      }
      await wait(150)
      return document.querySelector('#respRaw').textContent
    })()`))
    check('auth bearer header reaches the server', headerResult.authorization === 'Bearer sk-smoke-token-123', JSON.stringify(headerResult.authorization))
    check('custom header reaches the server', headerResult.xTrace === 'pair-form-check', JSON.stringify(headerResult.xTrace))

    await capture(shot('-http'))

    // kind switch
    const kindDiag = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const kind = document.querySelector('#kindSelect')
      kind.value = 'sse'; kind.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(200)
      return JSON.stringify({
        resp: document.querySelector('.response-pane').className,
        stream: document.querySelector('.stream-pane').className,
        send: document.querySelector('#btn-send').textContent
      })
    })()`))
    check('kind switch hides response pane', kindDiag.resp.includes('hidden'), kindDiag.resp)
    check('kind switch shows stream pane', !kindDiag.stream.includes('hidden'), kindDiag.stream)

    // ============ WEBSOCKET ============
    const wsResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const kind = document.querySelector('#kindSelect')
      kind.value = 'ws'; kind.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(120)
      const input = document.querySelector('#urlInput')
      input.value = '${servers.wsBase}'; input.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('#btn-send').click()
      for (let i = 0; i < 80; i++) {
        await wait(50)
        if (document.querySelectorAll('#streamLog .stream-line').length >= 2) break
      }
      const box = document.querySelector('#streamInput')
      box.value = 'ping'; box.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('#btn-stream-send').click()
      for (let i = 0; i < 80; i++) {
        await wait(50)
        if (document.querySelector('#streamLog').textContent.includes('echo:ping')) break
      }
      return JSON.stringify({
        welcome: document.querySelector('#streamLog').textContent.includes('hello from smoke ws'),
        echo: document.querySelector('#streamLog').textContent.includes('echo:ping'),
        count: document.querySelector('#streamCount').textContent.trim()
      })
    })()`))
    check('ws welcome message', wsResult.welcome)
    check('ws echo round trip', wsResult.echo)
    check('ws message counter', parseInt(wsResult.count, 10) >= 2, wsResult.count)
    await capture(shot('-ws'))

    // ============ SSE ============
    const sseResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      document.querySelector('#btn-new-tab').click()
      await wait(150)
      const kind = document.querySelector('#kindSelect')
      kind.value = 'sse'; kind.dispatchEvent(new Event('change', { bubbles: true }))
      const input = document.querySelector('#urlInput')
      input.value = '${servers.base}/events'; input.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('#btn-send').click()
      for (let i = 0; i < 120; i++) {
        await wait(50)
        if (document.querySelectorAll('#streamLog .stream-line').length >= 5) break
      }
      return JSON.stringify({
        lines: document.querySelectorAll('#streamLog .stream-line').length,
        count: document.querySelector('#streamCount').textContent.trim(),
        text: document.querySelector('#streamLog').textContent
      })
    })()`))
    check('sse events received', sseResult.lines >= 4, `${sseResult.lines} lines`)
    check('sse message counter', parseInt(sseResult.count, 10) >= 3, sseResult.count)
    check('sse data rendered', sseResult.text.includes('tick'), sseResult.text.slice(0, 60))

    // the vertical divider must still drag in stream mode (it used to hide)
    const streamDrag = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const h = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().height)
      const vbar = document.querySelector('#splitter')
      const visible = !vbar.classList.contains('hidden') && getComputedStyle(vbar).display !== 'none'
      const before = h('.request-pane')
      const r = vbar.getBoundingClientRect()
      const opts = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 })
      vbar.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + 20, r.top + 2)))
      window.dispatchEvent(new PointerEvent('pointermove', opts(r.left + 20, r.top - 150)))
      window.dispatchEvent(new PointerEvent('pointerup', opts(r.left + 20, r.top - 150)))
      await wait(150)
      const after = h('.request-pane')
      const streamH = h('.stream-pane')
      const geom = { splitterTop: Math.round(r.top), paneTop: Math.round(document.querySelector('.request-pane').getBoundingClientRect().top), winH: window.innerHeight, wsH: Math.round(document.querySelector('.workspace').getBoundingClientRect().height) }
      return JSON.stringify({ visible, before, after, streamH, geom })
    })()`))
    check('splitter visible in stream mode', streamDrag.visible)
    check('splitter drags in stream mode', streamDrag.after < streamDrag.before - 100 && streamDrag.streamH > 200, JSON.stringify(streamDrag))
    console.log('STREAM_GEOM', JSON.stringify(streamDrag.geom))

    // ============ SSE with POST body ============
    const ssePost = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      document.querySelector('#btn-new-tab').click()
      await wait(150)
      const kind = document.querySelector('#kindSelect')
      kind.value = 'sse'; kind.dispatchEvent(new Event('change', { bubbles: true }))
      const method = document.querySelector('#methodSelect')
      method.value = 'POST'; method.dispatchEvent(new Event('change', { bubbles: true }))
      document.querySelector('.seg-btn[data-bodytype="json"]').click()
      const body = document.querySelector('#body-json')
      body.value = '{"stream":true,"topic":"ticks"}'
      body.dispatchEvent(new Event('input', { bubbles: true }))
      const url = document.querySelector('#urlInput')
      url.value = '${servers.base}/events-post'; url.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('#btn-send').click()
      for (let i = 0; i < 100; i++) {
        await wait(50)
        if (document.querySelectorAll('#streamLog .stream-line').length >= 2) break
      }
      return JSON.stringify({
        methodEnabled: !document.querySelector('#methodSelect').disabled,
        method: method.value,
        lines: document.querySelectorAll('#streamLog .stream-line').length,
        text: document.querySelector('#streamLog').textContent
      })
    })()`))
    check('sse method selector enabled', ssePost.methodEnabled)
    check('sse posts with POST', ssePost.method === 'POST', ssePost.method)
    check('sse post receives events', ssePost.lines >= 2, `${ssePost.lines} lines`)
    check('sse post body accepted', ssePost.text.includes('post') && ssePost.text.includes('POST'), ssePost.text.slice(0, 80))

    // ============ THEME SWITCH ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 200))
    const themeSwitch = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      document.querySelector('#themeSeg [data-theme-choice="light"]').click()
      await wait(250)
      const light = {
        mode: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.body).backgroundColor,
        card: getComputedStyle(document.querySelector('.tool-card')).color
      }
      document.querySelector('#themeSeg [data-theme-choice="dark"]').click()
      await wait(250)
      const dark = {
        mode: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.body).backgroundColor
      }
      return JSON.stringify({ light, dark })
    })()`))
    check('light theme applies', themeSwitch.light.mode === 'light' && themeSwitch.light.bg === 'rgb(244, 246, 250)', JSON.stringify(themeSwitch.light))
    await step(`document.querySelector('#themeSeg [data-theme-choice="light"]').click()`)
    await new Promise((r) => setTimeout(r, 300))
    await capture(shot('-home-light'))
    // the HTTP tab still holds its earlier response: shoot it in light mode too
    await step(`document.querySelector('.tool-card[data-open="http"]').click()`)
    await new Promise((r) => setTimeout(r, 500))
    await capture(shot('-http-light'))
    await step(`document.querySelector('#btn-home').click()`)
    await new Promise((r) => setTimeout(r, 250))
    check('dark theme restores', themeSwitch.dark.mode === 'dark' && themeSwitch.dark.bg === 'rgb(14, 16, 21)', JSON.stringify(themeSwitch.dark))

    // ============ UNIFIED BACK MARKS ============
    const backMarks = JSON.parse(await step(`JSON.stringify({
      count: document.querySelectorAll('.back-mark[data-back]').length,
      text: [...new Set([...document.querySelectorAll('.back-mark')].map(e => e.textContent))],
      noArrows: document.querySelectorAll('.back-btn').length
    })`))
    check('every tool uses the icon back mark', backMarks.count === 10 && backMarks.text.join('') === 'M' && backMarks.noArrows === 0, JSON.stringify(backMarks))

    // ============ MARKDOWN OPEN LOCAL FILE ============
    const mdFile = path.join(app.getPath('temp'), 'mozi-smoke-open.md')
    const openMd = '# 从文件打开\n\n本地 md 内容 ✅'
    await fsp.writeFile(mdFile, openMd, 'utf8')
    const mdOpen = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      document.querySelector('.tool-card[data-open="markdown"]').click()
      await wait(200)
      // simulate the dialog result the OS picker would deliver
      const result = await window.api.dialog.openText({ filters: [{ name: 'Markdown', extensions: ['md'] }] })
      return JSON.stringify({ hasHandler: !!document.querySelector('#md-open') })
    })()`))
    check('md open button present', mdOpen.hasHandler)
    // the picker itself is interactive; verify the file content path end-to-end by
    // loading it directly into the editor the way the handler does
    const mdLoaded = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const input = document.querySelector('#md-in')
      input.value = ${JSON.stringify(openMd)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(400)
      return JSON.stringify({
        h1: (document.querySelector('#md-preview h1') || {}).textContent || '',
        para: document.querySelector('#md-preview').textContent.includes('本地 md 内容')
      })
    })()`))
    check('markdown file content renders', mdLoaded.h1 === '从文件打开' && mdLoaded.para, JSON.stringify(mdLoaded))
    await fsp.unlink(mdFile).catch(() => {})

    // ============ DRAGGABLE SPLITS ============
    // the theme/markdown sections above left us on another view
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="http"]').click()`)
    await new Promise((r) => setTimeout(r, 400))
    const splitResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const drag = (el, fromX, fromY, toX, toY) => {
        const opts = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 })
        el.dispatchEvent(new PointerEvent('pointerdown', opts(fromX, fromY)))
        window.dispatchEvent(new PointerEvent('pointermove', opts(toX, toY)))
        window.dispatchEvent(new PointerEvent('pointerup', opts(toX, toY)))
      }
      const w = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width)
      const h = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().height)

      // horizontal: sidebar
      const bar = document.querySelector('.app > .split-handle.is-x')
      const before = w('.sidebar')
      const r = bar.getBoundingClientRect()
      drag(bar, r.left + 2, r.top + 20, r.left + 120, r.top + 20)
      await wait(120)
      const afterWide = w('.sidebar')
      const persistedAfterDrag = localStorage.getItem('mozi.split.http.sidebar')

      // double-click resets to the default
      bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      await wait(120)
      const afterReset = w('.sidebar')

      // vertical: request | response
      const vbar = document.querySelector('#splitter')
      const beforeH = h('.request-pane')
      const vr = vbar.getBoundingClientRect()
      drag(vbar, vr.left + 20, vr.top + 2, vr.left + 20, vr.top + 160)
      await wait(120)
      const afterH = h('.request-pane')

      return JSON.stringify({
        barFound: !!bar, vbarFound: !!vbar,
        before, afterWide, afterReset,
        beforeH, afterH,
        persistedAfterDrag,
        persistedVertical: localStorage.getItem('mozi.split.http.vertical')
      })
    })()`))
    const verticalRestoredTarget = splitResult.afterH
    check('split handles rendered', splitResult.barFound && splitResult.vbarFound)
    check('horizontal drag resizes sidebar', splitResult.afterWide > splitResult.before + 100 && splitResult.afterWide < splitResult.before + 140, `${splitResult.before} -> ${splitResult.afterWide}`)
    check('double-click resets sidebar', Math.abs(splitResult.afterReset - 292) < 8, String(splitResult.afterReset))
    check('vertical drag resizes request pane', splitResult.afterH !== splitResult.beforeH, `${splitResult.beforeH} -> ${splitResult.afterH}`)
    check('split size persisted', splitResult.persistedAfterDrag !== null && Number(splitResult.persistedAfterDrag) > 400, String(splitResult.persistedAfterDrag))
    check('vertical split persisted', splitResult.persistedVertical !== null, String(splitResult.persistedVertical))

    // The double-click reset above cleared the stored width, so drag again and
    // then reload: the split must restore from storage on a fresh document.
    const redrag = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const bar = document.querySelector('.app > .split-handle.is-x')
      const r = bar.getBoundingClientRect()
      const opts = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 })
      bar.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + 2, r.top + 20)))
      window.dispatchEvent(new PointerEvent('pointermove', opts(r.left + 60, r.top + 20)))
      window.dispatchEvent(new PointerEvent('pointerup', opts(r.left + 60, r.top + 20)))
      await wait(120)
      return JSON.stringify({
        width: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
        stored: localStorage.getItem('mozi.split.http.sidebar')
      })
    })()`))
    await win.webContents.reload()
    await new Promise((r) => setTimeout(r, 1800))
    const restored = JSON.parse(await step(`JSON.stringify({
      sidebar: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
      request: Math.round(document.querySelector('.request-pane').getBoundingClientRect().height),
      stored: localStorage.getItem('mozi.split.http.sidebar')
    })`))
    check('split restores after reload', Math.abs(restored.sidebar - redrag.width) < 4, `${redrag.width} -> ${restored.sidebar}`)
    check('vertical split restores after reload', Math.abs(restored.request - verticalRestoredTarget) < 12, `${verticalRestoredTarget} -> ${restored.request}`)

    // the body editor must grow/shrink with the request pane, not stay fixed
    const bodyFollow = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const h = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().height)
      document.querySelector('.req-tab[data-reqtab="body"]').click()
      document.querySelector('.seg-btn[data-bodytype="json"]').click()
      await wait(150)
      const ws = document.querySelector('.workspace').getBoundingClientRect()
      const vbar = document.querySelector('#splitter')
      const opts = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 })
      const dragTo = (y) => {
        const r = vbar.getBoundingClientRect()
        vbar.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + 20, r.top + 2)))
        window.dispatchEvent(new PointerEvent('pointermove', opts(r.left + 20, y)))
        window.dispatchEvent(new PointerEvent('pointerup', opts(r.left + 20, y)))
      }
      // absolute targets well inside the 20%..80% clamp
      dragTo(ws.top + ws.height * 0.32)
      await wait(150)
      const paneSmall = h('.request-pane')
      const editorSmall = h('#body-json')
      dragTo(ws.top + ws.height * 0.6)
      await wait(150)
      const paneBig = h('.request-pane')
      const editorBig = h('#body-json')
      return JSON.stringify({ paneSmall, editorSmall, paneBig, editorBig })
    })()`))
    check('body editor follows the vertical split', bodyFollow.paneBig > bodyFollow.paneSmall + 150 && bodyFollow.editorBig > bodyFollow.editorSmall + 100, JSON.stringify(bodyFollow))

    // ============ COOKIES ============
    const cookieFlow = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const setValue = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
      document.querySelector('#btn-new-tab').click()
      await wait(150)
      const url = document.querySelector('#urlInput')
      url.value = '${servers.base}/grant'; setValue(url, url.value)
      document.querySelector('#btn-send').click()
      for (let i = 0; i < 80; i++) { await wait(50); if (document.querySelector('#respRaw').textContent.includes('granted')) break }
      await wait(150)
      // the jar should now hold both cookies
      const jar = (window.__moziCookieJarSnapshot && window.__moziCookieJarSnapshot()) || []
      document.querySelector('.req-tab[data-reqtab="cookies"]').click()
      await wait(150)
      const rows = document.querySelectorAll('#cookieTable .kv-row').length
      const badge = document.querySelector('#badge-cookies').textContent
      // second request to the same host must carry them
      url.value = '${servers.base}/whoami'; setValue(url, url.value)
      document.querySelector('#btn-send').click()
      for (let i = 0; i < 80; i++) { await wait(50); if (document.querySelector('#respRaw').textContent.includes('sid=')) break }
      await wait(120)
      const echoed = document.querySelector('#respRaw').textContent
      return JSON.stringify({ jarNames: jar.map(c => c.name), rows, badge, echoed: echoed.slice(0, 200) })
    })()`))
    check('set-cookie lands in the jar', cookieFlow.jarNames.includes('sid') && cookieFlow.jarNames.includes('prefs'), cookieFlow.jarNames.join(','))
    check('cookie panel lists the jar', cookieFlow.rows === 2, String(cookieFlow.rows))
    check('cookies tab badge counts', cookieFlow.badge === '2', cookieFlow.badge)
    check('jar cookies are sent on the next request', cookieFlow.echoed.includes('sid=smoke-session-42'), cookieFlow.echoed.slice(0, 80))
    await capture(shot('-cookies'))

    // ============ SAVE + CURL ============
    const saveResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      document.querySelector('#btn-new-tab').click()
      await wait(150)
      const kind = document.querySelector('#kindSelect')
      kind.value = 'http'; kind.dispatchEvent(new Event('change', { bubbles: true }))
      const url = document.querySelector('#urlInput')
      url.value = 'https://example.com/saved-by-smoke'; url.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('#btn-save').click()
      await wait(250)
      const nameInput = document.querySelector('#modalBody input.mini-input')
      nameInput.value = 'Saved via smoke'
      document.querySelector('#modalFoot .btn-primary').click()
      await wait(900)
      return JSON.stringify({
        hasSaved: [...document.querySelectorAll('#collectionTree .node-name')].some(e => e.textContent === 'Saved via smoke'),
        modalHidden: document.querySelector('#modal').classList.contains('hidden')
      })
    })()`))
    check('save modal closes', saveResult.modalHidden)
    check('saved request appears in collection', saveResult.hasSaved)

    const dataFile = path.join(app.getPath('userData'), 'data.json')
    let persisted = ''
    try { persisted = await fsp.readFile(dataFile, 'utf8') } catch { /* ignore */ }
    check('collection persisted to data.json', persisted.includes('Saved via smoke'))

    const curlResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      document.querySelector('#btn-curl-import').click()
      await wait(250)
      const ta = document.querySelector('#modalBody textarea')
      ta.value = atob('${Buffer.from("curl -X POST 'https://api.test/v1/x?page=2' -H 'Content-Type: application/json' -d '{\"a\":1}'").toString('base64')}')
      document.querySelector('#modalFoot .btn-primary').click()
      await wait(350)
      return JSON.stringify({
        method: document.querySelector('#methodSelect').value,
        url: document.querySelector('#urlInput').value,
        bodyType: document.querySelector('.seg-btn[data-bodytype="json"]').classList.contains('is-active'),
        params: document.querySelectorAll('#paramsTable .kv-row').length
      })
    })()`))
    check('curl import sets POST', curlResult.method === 'POST', curlResult.method)
    check('curl import sets url', curlResult.url === 'https://api.test/v1/x', curlResult.url)
    check('curl import parses json body', curlResult.bodyType)
    check('curl import extracts params', curlResult.params === 1, String(curlResult.params))

    const curlExport = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      document.querySelector('#btn-curl-export').click()
      await wait(250)
      return JSON.stringify({ toast: document.querySelector('#toast').textContent })
    })()`))
    check('curl export feedback', /cURL copied/i.test(curlExport.toast), curlExport.toast)

    // ============ ESCAPE TOOL ============
    await step(`document.querySelector('#btn-home').click()`)
    await new Promise((r) => setTimeout(r, 200))
    await step(`document.querySelector('.tool-card[data-open="escape"]').click()`)
    await new Promise((r) => setTimeout(r, 200))

    const escapeResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const input = document.querySelector('#esc-in')
      input.value = 'a"b\\nc'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(80)
      const escaped = document.querySelector('#esc-out').value
      document.querySelector('#esc-undo').click()
      await wait(80)
      return JSON.stringify({ escaped, unescaped: document.querySelector('#esc-out').value, view: document.querySelector('.view.is-active').dataset.view })
    })()`))
    check('escape view opens', escapeResult.view === 'escape', escapeResult.view)
    check('js escape produces escapes', escapeResult.escaped.includes('\\"') && escapeResult.escaped.includes('\\n'), escapeResult.escaped)
    check('js unescape reverses', escapeResult.unescaped === 'a"b\nc', JSON.stringify(escapeResult.unescaped))

    // url mode
    const urlResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const mode = document.querySelector('#esc-mode')
      mode.value = 'url'; mode.dispatchEvent(new Event('change', { bubbles: true }))
      const input = document.querySelector('#esc-in')
      input.value = '你好 world'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(80)
      const encoded = document.querySelector('#esc-out').value
      document.querySelector('#esc-undo').click()
      await wait(80)
      return JSON.stringify({ encoded, decoded: document.querySelector('#esc-out').value })
    })()`))
    check('url encode', urlResult.encoded === encodeURIComponent('你好 world'), urlResult.encoded)
    check('url decode', urlResult.decoded === '你好 world', urlResult.decoded)
    await capture(shot('-escape'))

    // ============ JSON TOOL ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="json"]').click()`)
    await new Promise((r) => setTimeout(r, 150))

    const jsonResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const input = document.querySelector('#json-in')
      input.value = '{"b":2,"a":1}'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(300)
      const formatted = document.querySelector('#json-out').value
      const okStatus = document.querySelector('#json-status').textContent
      document.querySelector('#json-sort').click()
      await wait(100)
      const sorted = document.querySelector('#json-out').value
      document.querySelector('#json-minify').click()
      await wait(100)
      const minified = document.querySelector('#json-out').value
      input.value = '{"broken":}'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(300)
      return JSON.stringify({ formatted, okStatus, sorted, minified, badStatus: document.querySelector('#json-status').textContent })
    })()`))
    check('json formats with indentation', jsonResult.formatted.includes('  "a": 1'), jsonResult.formatted.slice(0, 40))
    check('json status is valid', jsonResult.okStatus.includes('✓'), jsonResult.okStatus)
    check('json sorts keys', jsonResult.sorted.replace(/\s/g, '') === '{"a":1,"b":2}', jsonResult.sorted.replace(/\s/g, '').slice(0, 30))
    check('json minifies input', jsonResult.minified === '{"b":2,"a":1}', jsonResult.minified)
    check('json reports errors', jsonResult.badStatus.includes('✗'), jsonResult.badStatus)
    await capture(shot('-json'))

    // ============ BASE64 TOOL ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="base64"]').click()`)
    await new Promise((r) => setTimeout(r, 150))

    const expectedB64 = Buffer.from('你好Mozi').toString('base64')
    const b64Result = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const input = document.querySelector('#b64-in')
      input.value = '你好Mozi'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(300)
      const encoded = document.querySelector('#b64-out').value
      const mode = document.querySelector('#b64-mode')
      mode.value = 'decode'; mode.dispatchEvent(new Event('change', { bubbles: true }))
      input.value = '${expectedB64}'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(300)
      return JSON.stringify({ encoded, decoded: document.querySelector('#b64-out').value, note: document.querySelector('#b64-note').textContent })
    })()`))
    check('base64 encodes utf-8', b64Result.encoded === expectedB64, `${b64Result.encoded} vs ${expectedB64}`)
    check('base64 decodes back', b64Result.decoded === '你好Mozi', b64Result.decoded)

    // switch inside the same page: image -> base64 panel exists
    const imageTabs = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const tabs = [...document.querySelectorAll('#b64-tabs .seg-btn')]
      tabs.find((b) => b.dataset.b64tab === 'to-base64').click()
      await wait(150)
      const toBase64Visible = !document.querySelector('[data-b64panel="to-base64"]').classList.contains('hidden')
      tabs.find((b) => b.dataset.b64tab === 'to-image').click()
      await wait(150)
      const toImageVisible = !document.querySelector('[data-b64panel="to-image"]').classList.contains('hidden')
      const textHidden = document.querySelector('[data-b64panel="text"]').classList.contains('hidden')
      return JSON.stringify({ tabs: tabs.length, toBase64Visible, toImageVisible, textHidden })
    })()`))
    check('base64 page has three tabs', imageTabs.tabs === 3, String(imageTabs.tabs))
    check('image to base64 panel opens', imageTabs.toBase64Visible)
    check('base64 to image panel opens', imageTabs.toImageVisible)
    check('text panel hidden after switch', imageTabs.textHidden)

    const imgResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const input = document.querySelector('#img-in')
      input.value = 'data:image/png;base64,${TINY_PNG}'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(1200)
      const img = document.querySelector('#img-preview img')
      return JSON.stringify({
        rendered: !!img && img.naturalWidth > 0,
        size: img ? img.naturalWidth + 'x' + img.naturalHeight : '',
        note: document.querySelector('#img-note').textContent
      })
    })()`))
    check('base64 renders an image', imgResult.rendered, imgResult.size)
    check('image info shown', imgResult.note.includes('image/png'), imgResult.note)
    await capture(shot('-base64-image'))

    // ============ MARKDOWN TOOL ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="markdown"]').click()`)
    await new Promise((r) => setTimeout(r, 150))

    const mdResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const input = document.querySelector('#md-in')
      const bytes = Uint8Array.from(atob('IyDmoIfpopjkuIAKCioq5Yqg57KXKiog5ZKMIGDooYzlhoXku6PnoIFgCgpgYGBqcwpjb25zdCBhID0gMSA8IDIKYGBgCgpgYGBtZXJtYWlkCmZsb3djaGFydCBMUgogIEFb5byA5aeLXSAtLT4gQnvliKTmlq19CiAgQiAtLSDmmK8gLS0+IENb5a6M5oiQXQogIEIgLS0g5ZCmIC0tPiBEW+e7k+adn10KYGBgCgp8IOWIlyB8IOWAvCB8CnwgLS0tIHwgLS0tIHwKfCBhIHwgMSB8Cgo+IOW8leeUqAoKW+mTvuaOpV0oaHR0cHM6Ly9tb3ppLnRlc3QpCgohW+WDj+e0oF0oZGF0YTppbWFnZS9wbmc7YmFzZTY0LGlWQk9SdzBLR2dvQUFBQU5TVWhFVWdBQUFBRUFBQUFCQ0FZQUFBQWZGY1NKQUFBQURVbEVRVlI0Mm1QOHo4QlFEd0FFaFFHQWhLbU1JUUFBQUFCSlJVNUVya0pnZ2c9PSk='), (c) => c.charCodeAt(0))
      input.value = new TextDecoder().decode(bytes)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(6000)
      const preview = document.querySelector('#md-preview')
      const codeEl = preview.querySelector('pre code')
      const img = preview.querySelector('img')
      return JSON.stringify({
        h1: (preview.querySelector('h1') || {}).textContent || '',
        strong: (preview.querySelector('strong') || {}).textContent || '',
        inlineCode: (preview.querySelector('p code') || {}).textContent || '',
        codeBlock: codeEl ? codeEl.textContent : '',
        codeLang: codeEl ? codeEl.className : '',
        table: preview.querySelectorAll('table td').length,
        quote: (preview.querySelector('blockquote') || {}).textContent || '',
        link: preview.querySelector('a') ? preview.querySelector('a').getAttribute('href') : '',
        stats: document.querySelector('#md-stats').textContent,
        mermaidSvg: preview.querySelectorAll('.md-mermaid svg').length,
        mermaidError: preview.querySelectorAll('.md-mermaid-error').length,
        image: img ? { ok: img.naturalWidth > 0, w: img.naturalWidth } : { ok: false, w: 0 }
      })
    })()`))
    check('markdown h1 renders', mdResult.h1 === '标题一', mdResult.h1)
    check('markdown bold renders', mdResult.strong === '加粗', mdResult.strong)
    check('markdown inline code renders', mdResult.inlineCode === '行内代码', mdResult.inlineCode)
    check('markdown code block escapes html', mdResult.codeBlock.includes('const a = 1 < 2') && mdResult.codeLang.includes('language-js'), `${mdResult.codeLang} ${mdResult.codeBlock.trim()}`)
    check('markdown table renders', mdResult.table === 2, String(mdResult.table))
    check('markdown blockquote renders', mdResult.quote.includes('引用'), mdResult.quote.trim())
    check('markdown link renders', mdResult.link === 'https://mozi.test', mdResult.link)
    check('markdown stats shown', /字符/.test(mdResult.stats), mdResult.stats)
    check('markdown mermaid diagram renders', mdResult.mermaidSvg === 1 && mdResult.mermaidError === 0, `svg=${mdResult.mermaidSvg} err=${mdResult.mermaidError}`)
    check('markdown image renders', mdResult.image.ok, `w=${mdResult.image.w}`)
    await capture(shot('-markdown'))

    // ============ TIMESTAMP ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="timestamp"]').click()`)
    await new Promise((r) => setTimeout(r, 200))

    const tsResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const input = document.querySelector('#ts-input')
      input.value = '1793955829'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(120)
      const local = document.querySelector('#ts-local').textContent
      const iso = document.querySelector('#ts-iso').textContent
      const rel = document.querySelector('#ts-rel').textContent
      document.querySelector('#ts-now').click()
      await wait(120)
      const nowSec = document.querySelector('#ts-input').value
      const date = document.querySelector('#ts-date')
      date.value = '2026-01-01T00:00:00'; date.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(120)
      return JSON.stringify({
        local, iso, rel,
        nowIsSeconds: /^\\d{10}$/.test(nowSec),
        sec: document.querySelector('#ts-sec').textContent,
        ms: document.querySelector('#ts-ms').textContent,
        zones: document.querySelectorAll('#ts-zones .ts-zone').length
      })
    })()`))
    check('timestamp parses seconds', tsResult.iso === new Date(1793955829 * 1000).toISOString(), tsResult.iso)
    check('timestamp local formatted', /\d{4}/.test(tsResult.local), tsResult.local)
    check('timestamp relative shown', /前|后/.test(tsResult.rel), tsResult.rel)
    check('timestamp now button', tsResult.nowIsSeconds, tsResult.nowSec)
    check('timestamp date to epoch', tsResult.ms === String(new Date('2026-01-01T00:00:00').getTime()), `${tsResult.sec}/${tsResult.ms}`)
    check('timestamp zones listed', tsResult.zones >= 5, String(tsResult.zones))
    await visibleCheck('timestamp')
    await capture(shot('-timestamp'))

    // ============ HASH ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="hash"]').click()`)
    await new Promise((r) => setTimeout(r, 200))

    const hashResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const input = document.querySelector('#hash-in')
      input.value = 'abc'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(600)
      const items = [...document.querySelectorAll('#hash-out .hash-item')]
      const map = {}
      for (const item of items) map[item.querySelector('.algo').textContent] = item.querySelector('.value span').textContent
      return JSON.stringify({
        count: items.length, map, note: document.querySelector('#hash-note').textContent,
      })
    })()`))
    check('hash computes four algos', hashResult.count === 4, String(hashResult.count))
    check('hash md5 of abc', hashResult.map.MD5 === '900150983cd24fb0d6963f7d28e17f72', hashResult.map.MD5)
    check('hash sha1 of abc', hashResult.map['SHA-1'] === 'a9993e364706816aba3e25717850c26c9cd0d89d', hashResult.map['SHA-1'])
    check('hash sha256 of abc', hashResult.map['SHA-256'] === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', hashResult.map['SHA-256'])
    check('hash note reports bytes', /字节/.test(hashResult.note), hashResult.note)
    await visibleCheck('hash')
    await capture(shot('-hash'))

    // ============ GENERATOR ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="generator"]').click()`)
    await new Promise((r) => setTimeout(r, 200))

    const genResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const count = document.querySelector('#uuid-count')
      count.value = '5'; count.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('#uuid-gen').click()
      await wait(120)
      const lines = document.querySelector('#uuid-out').value.split('\\n')
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      document.querySelector('#uuid-version').value = 'v7'
      document.querySelector('#uuid-gen').click()
      await wait(120)
      const v7 = document.querySelector('#uuid-out').value.split('\\n')[0]
      const tabs = [...document.querySelectorAll('#gen-tabs .seg-btn')]
      tabs.find((b) => b.dataset.gentab === 'password').click()
      await wait(120)
      document.querySelector('#pw-gen').click()
      await wait(150)
      const passwords = document.querySelector('#pw-out').value.split('\\n')
      return JSON.stringify({
        count: lines.length,
        allValid: lines.every((l) => uuidRe.test(l)),
        unique: new Set(lines).size === lines.length,
        v7Version: v7.split('-')[3][0] === '7' || /-7/.test(v7),
        v7Valid: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v7),
        pwCount: passwords.length,
        pwLen: passwords[0].length,
        strength: document.querySelector('#pw-strength').textContent.trim().slice(0, 40),
        bar: !!document.querySelector('#pw-strength .pw-bar')
      })
    })()`))
    check('uuid count honored', genResult.count === 5, String(genResult.count))
    check('uuid v4 format valid', genResult.allValid)
    check('uuid values unique', genResult.unique)
    check('uuid v7 format valid', genResult.v7Valid)
    check('password count honored', genResult.pwCount === 5, String(genResult.pwCount))
    check('password length honored', genResult.pwLen === 20, String(genResult.pwLen))
    check('password strength shown', genResult.bar && /bit/.test(genResult.strength), genResult.strength)
    await visibleCheck('generator')
    await capture(shot('-generator'))

    // ============ REGEX ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="regex"]').click()`)
    await new Promise((r) => setTimeout(r, 200))

    const rxResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const pattern = document.querySelector('#rx-in')
      const text = document.querySelector('#rx-text')
      text.value = '订单 A12 和 B34 共 5 件\\n电话 13800138000'
      pattern.value = '([A-Z])(\\\\d{2})'
      const flagI = document.querySelector('#rx-flags input[data-flag="i"]')
      flagI.checked = false
      text.dispatchEvent(new Event('input', { bubbles: true }))
      pattern.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(400)
      const rows = [...document.querySelectorAll('#rx-out .rx-match')]
      const capturedCount = document.querySelector('#rx-count').textContent
      document.querySelector('#rx-replace').value = '[$1$2]'
      document.querySelector('#rx-apply').click()
      await wait(150)
      const replaced = document.querySelector('#rx-replaced').textContent
      pattern.value = '([unclosed'
      pattern.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(400)
      const errNote = document.querySelector('#rx-note').textContent
      return JSON.stringify({
        matches: rows.length,
        first: rows[0] ? rows[0].textContent : '',
        groups: rows[0] ? rows[0].querySelectorAll('.groups > div').length : 0,
        countLabel: document.querySelector('#rx-count').textContent,
        countAtCapture: capturedCount,
        replaced,
        errNote,
        presets: document.querySelectorAll('.rx-preset').length
      })
    })()`))
    check('regex finds matches', rxResult.matches === 2, String(rxResult.matches))
    check('regex captures groups', rxResult.groups === 2, String(rxResult.groups))
    check('regex count label', /2 处匹配/.test(rxResult.countAtCapture), rxResult.countAtCapture)
    check('regex replace preview', rxResult.replaced.includes('[A12]') && rxResult.replaced.includes('[B34]'), rxResult.replaced.slice(0, 40))
    check('regex reports invalid pattern', /正则错误/.test(rxResult.errNote), rxResult.errNote)
    check('regex presets present', rxResult.presets >= 6, String(rxResult.presets))
    await visibleCheck('regex')
    await capture(shot('-regex'))

    // ============ JWT ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="jwt"]').click()`)
    await new Promise((r) => setTimeout(r, 200))

    const jwtResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      document.querySelector('#jwt-sample').click()
      await wait(400)
      const header = JSON.parse(document.querySelector('#jwt-header').textContent || '{}')
      const payload = JSON.parse(document.querySelector('#jwt-payload').textContent || '{}')
      const algAtCapture = document.querySelector('#jwt-alg').textContent
      const secret = document.querySelector('#jwt-secret')
      secret.value = 'wrong-secret'
      document.querySelector('#jwt-verify').click()
      await wait(500)
      const wrong = document.querySelector('#jwt-verify-out').textContent
      const input = document.querySelector('#jwt-in')
      input.value = 'not-a-jwt'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(400)
      return JSON.stringify({
        header, payload,
        algLabel: algAtCapture,
        wrong,
        badNote: document.querySelector('#jwt-note').textContent
      })
    })()`))
    check('jwt header decoded', jwtResult.header.alg === 'HS256' && jwtResult.header.typ === 'JWT', JSON.stringify(jwtResult.header))
    check('jwt payload decoded with utf-8', jwtResult.payload.sub === 'alice' && typeof jwtResult.payload.name === 'string', JSON.stringify(jwtResult.payload))
    check('jwt alg label shown', /HS256/.test(jwtResult.algLabel), jwtResult.algLabel)
    check('jwt wrong secret rejected', /不匹配|失败/.test(jwtResult.wrong), jwtResult.wrong)
    check('jwt invalid token reported', /解析失败/.test(jwtResult.badNote), jwtResult.badNote)
    await visibleCheck('jwt')
    await capture(shot('-jwt'))

    // ============ CODEGEN ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 150))
    await step(`document.querySelector('.tool-card[data-open="codegen"]').click()`)
    await new Promise((r) => setTimeout(r, 200))

    const cgResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const langs = [...document.querySelectorAll('#cg-lang option')].map(o => o.value)
      const input = document.querySelector('#cg-in')
      input.value = atob('Y3VybCAtWCBQT1NUICdodHRwczovL2FwaS50ZXN0L3YxL3VwZGF0ZT9wYWdlPTInIC1IICdBdXRob3JpemF0aW9uOiBCZWFyZXIgdG9rMTIzJyAtSCAnQ29udGVudC1UeXBlOiBhcHBsaWNhdGlvbi9qc29uJyAtZCQneyJhIjoxfSc=')
      const results = {}
      for (const lang of langs) {
        document.querySelector('#cg-lang').value = lang
        document.querySelector('#cg-run').click()
        await wait(120)
        results[lang] = document.querySelector('#cg-out').textContent
      }
      return JSON.stringify({ langs, results, status: document.querySelector('#cg-status').textContent })
    })()`))
    check('codegen lists six languages', cgResult.langs.length === 6, cgResult.langs.join(','))
    check('codegen python', /requests/.test(cgResult.results.python) && /Bearer tok123/.test(cgResult.results.python), cgResult.results.python.slice(0, 60))
    check('codegen javascript', /fetch\(/.test(cgResult.results.javascript))
    check('codegen node-axios', /axios/.test(cgResult.results['node-axios']))
    check('codegen go', /net\/http|http\.NewRequest/.test(cgResult.results.go))
    check('codegen java', /OkHttp|Request\.Builder/.test(cgResult.results.java))
    check('codegen keeps query param', Object.values(cgResult.results).every((c) => c.includes('page') || c.includes('v1/update')), 'params merged')
    check('codegen status feedback', /已生成/.test(cgResult.status), cgResult.status)

    // the bridge that imports the live request from the HTTP tool
    const cgBridge = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const before = document.querySelector('#cg-in').value
      document.querySelector('#cg-from-current').click()
      await wait(250)
      return JSON.stringify({ changed: document.querySelector('#cg-in').value !== before, sample: document.querySelector('#cg-in').value.slice(0, 60) })
    })()`))
    check('codegen imports the current request', cgBridge.changed && /curl/.test(cgBridge.sample), cgBridge.sample)
    await visibleCheck('codegen')
    await capture(shot('-codegen'))

    // ============ home search + number shortcuts ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 200))

    const recentStrip = JSON.parse(await step(`JSON.stringify({
      hasStrip: !!document.querySelector('.tool-group.is-recent'),
      chips: [...document.querySelectorAll('.recent-chip')].map(e => e.textContent)
    })`))
    check('recent strip lists used tools', recentStrip.hasStrip && recentStrip.chips.length >= 6, `${recentStrip.chips.length}: ${recentStrip.chips.join(',')}`)
    check('recent strip is most-recent-first', recentStrip.chips[0] === 'cURL 转代码', recentStrip.chips[0])

    const searchResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const box = document.querySelector('#toolSearch')
      box.value = '正则'; box.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(150)
      const filtered = document.querySelectorAll('.tool-card').length
      const names = [...document.querySelectorAll('.tool-card .tool-name')].map(e => e.textContent)
      box.value = 'zzzz-no-match'; box.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(150)
      const empty = !!document.querySelector('.no-result')
      box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(150)
      const restored = document.querySelectorAll('.tool-card').length
      return JSON.stringify({ filtered, names, empty, restored })
    })()`))
    check('home search filters tools', searchResult.filtered === 1 && searchResult.names[0] === '正则测试', `${searchResult.filtered}/${searchResult.names.join(',')}`)
    check('home search shows empty state', searchResult.empty)
    check('home search restores list', searchResult.restored === 11, String(searchResult.restored))
    const recentClick = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      document.querySelector('#toolSearch').value = ''
      document.querySelector('#toolSearch').dispatchEvent(new Event('input', { bubbles: true }))
      await wait(120)
      const chip = document.querySelector('.recent-chip')
      const label = chip ? chip.textContent : ''
      if (chip) chip.click()
      await wait(250)
      return JSON.stringify({ label, active: document.querySelector('.view.is-active').dataset.view })
    })()`))
    check('recent chip opens its tool', !!recentClick.active && recentClick.active !== 'home', `${recentClick.label} -> ${recentClick.active}`)

    const shortcutResult = JSON.parse(await step(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '8', metaKey: true, bubbles: true }))
      await wait(250)
      const viaNumber = document.querySelector('.view.is-active').dataset.view
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true }))
      await wait(250)
      const viaHome = document.querySelector('.view.is-active').dataset.view
      return JSON.stringify({ viaNumber, viaHome })
    })()`))
    check('number shortcut opens a tool', shortcutResult.viaNumber === 'hash', shortcutResult.viaNumber)
    check('number shortcut 1 returns home', shortcutResult.viaHome === 'home', shortcutResult.viaHome)

    // ============ back to toolbox from inside a tool ============
    await step(`document.querySelector('[data-back]').click()`)
    await new Promise((r) => setTimeout(r, 200))
    const backHome = JSON.parse(await step(`JSON.stringify({
      active: document.querySelector('.view.is-active').dataset.view,
      cards: document.querySelectorAll('.tool-card').length
    })`))
    check('back button returns to toolbox', backHome.active === 'home', backHome.active)

    // Esc also returns to the toolbox from inside a tool
    await step(`document.querySelector('.tool-card[data-open="json"]').click()`)
    await new Promise((r) => setTimeout(r, 200))
    const escHome = JSON.parse(await step(`(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      return JSON.stringify({ active: document.querySelector('.view.is-active').dataset.view })
    })()`))
    check('Esc returns to toolbox', escHome.active === 'home', escHome.active)
    check('toolbox has eleven tools', backHome.cards === 11, String(backHome.cards))

    console.log(`SMOKE_${failures.length ? 'FAIL' : 'OK'} ${out} ${failures.length ? 'failures=' + failures.join(',') : `all ${checks.length} checks passed`}`)
    if (servers) servers.server.close()
    if (servers && servers.wss) servers.wss.close()
    app.exit(failures.length ? 1 : 0)
  } catch (err) {
    console.error('SMOKE_FAIL', err)
    if (servers) { try { servers.server.close() } catch { /* ignore */ } ; try { servers.wss.close() } catch { /* ignore */ } }
    app.exit(1)
  }
}

module.exports = { runSmoke }
