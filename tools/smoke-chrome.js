'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const http = require('node:http')
const { WebSocketServer } = require('ws')
const root = path.resolve(__dirname, '..')
const { chromium } = require(require.resolve('playwright', { paths: [root, path.join(root, '.cache/chrome-test-tools')] }))

async function main () {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/echo' }); res.end(); return }
    if (req.url === '/slow') { setTimeout(() => res.end('late'), 1000); return }
    if (req.url === '/bytes') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(Buffer.from([0, 1, 255])); return }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    if (req.url === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('id: 7\r')
      setTimeout(() => res.end(`\nevent: test\r\ndata: 你好\r\ndata: ${body || 'GET'}\r\n\r\n`), 20)
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'server=private' })
    res.end(JSON.stringify({ method: req.method, headers: req.headers, body }))
  })
  const wss = new WebSocketServer({ server })
  wss.on('connection', (socket) => socket.on('message', (data, binary) => socket.send(data, { binary })))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const dir = path.join(root, 'release/chrome-extension')
  const profile = await fs.mkdtemp(path.join(root, '.cache/chrome-smoke-'))
  let context
  const errors = []
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.MOZI_CHROME_PATH ? { executablePath: process.env.MOZI_CHROME_PATH } : { channel: 'chromium' }), headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [...(process.env.MOZI_CHROME_PATH ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`]), '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      viewport: { width: 1440, height: 960 }
    })
    let id
    if (process.env.MOZI_CHROME_PATH) {
      const client = await context.browser().newBrowserCDPSession()
      id = (await client.send('Extensions.loadUnpacked', { path: dir })).id
      await client.detach()
    }
    if (!id) {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 })
      id = new URL(worker.url()).host
    }
    const page = await context.newPage()
    page.on('pageerror', (err) => { errors.push(err.message); console.error('PAGE:', err.message) })
    page.on('console', (msg) => { if (msg.type() === 'error') { errors.push(msg.text()); console.error('CONSOLE:', msg.text()) } })
    await page.goto(`chrome-extension://${id}/index.html`)
    await page.waitForSelector('.tool-card')
    assert.equal(await page.locator('.tool-card').count(), 14)
    console.log('PASS: MV3 loads, all 14 tools render')

    assert.equal(await page.locator('#game-frame').getAttribute('src'), null)
    await page.locator('[data-open="game"].tool-card').click()
    let game = await (await page.locator('#game-frame').elementHandle()).contentFrame()
    await game.waitForSelector('#boot.done', { timeout: 60000 })
    await game.locator('[data-act="deploy"]').click()
    await game.waitForFunction(() => window.__G?.game?.state !== 'title' && !document.querySelector('[data-act="deploy"]').checkVisibility())
    assert.deepEqual(await game.evaluate(() => window.__errors || []), [])
    assert.equal(await game.evaluate(() => { try { return !!parent.api } catch { return false } }), false)
    await page.screenshot({ path: path.join(root, '.cache/chrome-game.png') })
    await game.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock() })
    await page.locator('#game-restart').click()
    game = await (await page.locator('#game-frame').elementHandle()).contentFrame()
    await game.waitForSelector('[data-act="deploy"]', { timeout: 60000 })
    await page.locator('#view-game [data-back]').click()
    await page.waitForFunction(() => !document.querySelector('#game-frame').hasAttribute('src'))
    await page.locator('[data-open="game"].tool-card').click()
    game = await (await page.locator('#game-frame').elementHandle()).contentFrame()
    await game.waitForSelector('#boot.done', { timeout: 60000 })
    await page.locator('#view-game [data-back]').click()
    console.log('PASS: isolated game boots, starts, restarts, unloads on exit and opens again')

    const network = await page.evaluate(async (base) => {
      const send = (p) => api.http.send({ url: `${base}/echo`, ...p })
      const post = await send({ method: 'POST', headers: [['X-Mozi', 'test']], body: { type: 'json', text: '{"hello":"世界"}' } })
      const form = await send({ method: 'POST', body: { type: 'form-urlencoded', formUrlencoded: [{ key: '你好', value: 'a&b' }] } })
      const graphql = await send({ method: 'POST', body: { type: 'graphql', graphql: { query: '{ hello }', variables: '{"a":1}' } } })
      const binary = await send({ url: `${base}/bytes` })
      const redirect = await send({ url: `${base}/redirect` })
      const manual = await send({ url: `${base}/redirect`, options: { followRedirects: false } })
      const timeout = await send({ url: `${base}/slow`, options: { timeoutMs: 30 } })
      const limit = await send({ options: { maxResponseBytes: 10 } })
      return { post, form, graphql, binary, redirect, manual, timeout, limit }
    }, base)
    assert.equal(network.post.status, 200, JSON.stringify(network))
    assert.equal(JSON.parse(network.post.text).headers['x-mozi'], 'test')
    assert.equal(JSON.parse(network.post.text).headers.cookie, undefined)
    assert.equal(JSON.parse(network.post.text).body, '{"hello":"世界"}')
    assert.deepEqual(network.post.setCookies, [])
    assert.equal(JSON.parse(network.form.text).body, '%E4%BD%A0%E5%A5%BD=a%26b')
    assert.equal(JSON.parse(JSON.parse(network.graphql.text).body).variables.a, 1)
    assert.equal(network.binary.base64, 'AAH/')
    assert.equal(network.redirect.status, 200)
    assert.match(network.manual.error, /重定向/)
    assert.match(network.timeout.error, /超时/)
    assert.equal(network.limit.size, 10)
    assert.equal(network.limit.truncated, true)
    console.log('PASS: cross-origin HTTP without CORS headers, JSON/form/GraphQL, binary, redirects, timeout, size cap, cookie isolation')

    await page.locator('[data-open="http"].tool-card').click()
    await page.locator('#urlInput').fill(`${base}/echo`)
    await page.locator('#btn-send').click()
    await page.waitForFunction(() => document.querySelector('#respStatus').textContent.includes('200'))
    await page.keyboard.press('Escape')
    console.log('PASS: request UI sends and renders response')

    const files = await page.evaluate(async (base) => {
      // Real browser filesystem handles; replace only the OS picker UI.
      const dir = await navigator.storage.getDirectory()
      const handle = await dir.getFileHandle('smoke.txt', { create: true })
      let writer = await handle.createWritable()
      await writer.write('hello file'); await writer.close()
      const openPicker = window.showOpenFilePicker
      const savePicker = window.showSaveFilePicker
      window.showOpenFilePicker = async () => [handle]
      window.showSaveFilePicker = async () => handle
      try {
        const [picked] = await api.files.pick()
        const read = await api.files.readBase64(picked.path)
        const hashes = await api.hash.files({ algorithms: ['md5', 'sha256'], filePaths: [picked.path] })
        const multipart = await api.http.send({ url: `${base}/echo`, method: 'POST', body: { type: 'form-data', formData: [{ key: 'upload', type: 'file', path: picked.path }] } })
        const saved = await api.files.writeText({ path: picked.path, content: 'saved text' })
        const content = await (await handle.getFile()).text()
        const reopened = await api.dialog.openText()
        const saveAs = await api.dialog.saveText({ defaultName: 'new.md', content: '# saved' })
        return { read, hashes, multipart, saved, content, reopened, saveAs }
      } finally { window.showOpenFilePicker = openPicker; window.showSaveFilePicker = savePicker }
    }, base)
    assert.equal(files.read.base64, Buffer.from('hello file').toString('base64'))
    assert.equal(files.hashes.results[0].error, null)
    assert(JSON.parse(files.multipart.text).body.includes('hello file'))
    assert.equal(files.saved.ok, true)
    assert.equal(files.content, 'saved text')
    assert.equal(files.reopened.content, 'saved text')
    assert.equal(files.saveAs.ok, true)
    console.log('PASS: filesystem-handle read/write, hash, multipart upload and save-as (picker UI stubbed)')

    const streaming = await page.evaluate(async (base) => {
      const wait = (kind, start) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${kind} timeout`)), 5000)
        const events = []
        const off = api[kind].onEvent((e) => {
          events.push(e)
          if (kind === 'ws' && e.kind === 'open') api.ws.send({ id: 'smoke-ws', data: '你好' })
          if ((kind === 'ws' && e.kind === 'message') || (kind === 'sse' && e.kind === 'close')) {
            clearTimeout(timer); off(); resolve(events)
          }
        })
        start()
      })
      const ws = await wait('ws', () => api.ws.open({ id: 'smoke-ws', url: base.replace('http:', 'ws:') }))
      api.ws.close({ id: 'smoke-ws' })
      const sse = await wait('sse', () => api.sse.open({ id: 'smoke-sse', url: `${base}/sse`, method: 'POST', body: 'payload' }))
      return { ws, sse }
    }, base)
    assert.equal(streaming.ws.find((e) => e.kind === 'message').data, '你好')
    const sse = streaming.sse.find((e) => e.kind === 'event')
    assert.equal(sse.data, '你好\npayload')
    assert.equal(sse.lastEventId, '7')
    assert.equal(sse.event, 'test')
    console.log('PASS: real WebSocket echo and POST SSE with split CRLF/UTF-8')

    await page.locator('[data-open="http"].tool-card').click()
    await page.locator('#kindSelect').selectOption('ws')
    await page.locator('#urlInput').fill(base.replace('http:', 'ws:'))
    await page.locator('#btn-send').click()
    await page.waitForFunction(() => document.querySelector('#streamStatus').textContent.includes('open'))
    await page.locator('#streamInput').fill('UI echo')
    await page.locator('#btn-stream-send').click()
    await page.waitForFunction(() => document.querySelector('#streamInput').value === '' && document.querySelector('#streamLog').textContent.includes('UI echo'))
    await page.locator('#btn-send').click()
    await page.keyboard.press('Escape')
    console.log('PASS: WebSocket UI sends a message and clears the input')

    await page.locator('[data-open="markdown"].tool-card').click()
    // Exercise real input selection and browser downloads instead of mocked handles.
    for (const mode of ['missing', 'denied']) {
      await page.evaluate((mode) => {
        window.showOpenFilePicker = mode === 'missing' ? undefined : async () => { throw new DOMException('Blocked by policy', 'SecurityError') }
        window.showSaveFilePicker = mode === 'missing' ? undefined : async () => { throw new DOMException('Blocked by policy', 'NotAllowedError') }
      }, mode)
      const chooserEvent = page.waitForEvent('filechooser')
      await page.locator('#md-open').click()
      const chooser = await chooserEvent
      await chooser.setFiles({ name: 'compat.md', mimeType: 'text/markdown', buffer: Buffer.from(`# ${mode} 文件\n\n中文内容`) })
      await page.waitForFunction((mode) => document.querySelector('#md-in').value.includes(`${mode} 文件`), mode)
      await page.waitForFunction((mode) => document.querySelector('#md-preview h1')?.textContent === `${mode} 文件`, mode)
      const content = `# ${mode} 编辑后的文件\n\n保存测试 ✅`
      await page.locator('#md-in').fill(content)
      for (const button of ['#md-tb-save', '#md-save-as']) {
        const downloading = page.waitForEvent('download')
        await page.locator(button).click()
        const download = await downloading
        assert.equal(download.suggestedFilename(), 'compat.md')
        assert.equal(await fs.readFile(await download.path(), 'utf8'), content)
      }
      const exporting = page.waitForEvent('download')
      await page.locator('#md-export').click()
      const exported = await exporting
      assert.equal(exported.suggestedFilename(), 'mozi-markdown.html')
      assert((await fs.readFile(await exported.path(), 'utf8')).includes('保存测试'))
    }
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => { throw new DOMException('simulated disk failure', 'NotReadableError') }
    })
    await page.locator('#md-save-as').click()
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('simulated disk failure'))
    console.log('PASS: Markdown open/save/save-as/export through real file input and downloads; missing/denied picker fallback; visible errors')
    await page.locator('#md-in').fill('# Chrome 草稿\n\n```mermaid\ngraph TD\n A --> B\n```')
    await page.waitForSelector('#md-preview svg', { timeout: 15000 })
    await page.waitForFunction(() => __moziData.mdDoc().text.includes('Chrome 草稿'))
    await page.keyboard.press('Escape')
    await page.locator('[data-open="notepad"].tool-card').click()
    await page.locator('#np-editor').fill('扩展版笔记内容')
    await page.locator('#np-title').fill('扩展版笔记')
    await page.evaluate(() => __moziData.setTodos([{ id: 'smoke-todo', title: 'Chrome 待办', due: '2026-11-11', done: false }]))
    await page.waitForFunction(async () => {
      const data = await api.store.load()
      return data?.notes?.some((n) => n.title === '扩展版笔记') && data?.mdDoc?.text.includes('Chrome 草稿') && data?.todos?.length
    })
    await page.screenshot({ path: path.join(root, '.cache/chrome-notepad.png') })
    await page.reload()
    await page.waitForSelector('.tool-card', { state: 'attached' })
    const state = await page.evaluate(() => ({ notes: __moziData.notes(), todos: __moziData.todos(), md: __moziData.mdDoc() }))
    assert(state.notes.some((n) => n.title === '扩展版笔记' && n.html.includes('扩展版笔记内容')))
    assert.equal(state.todos[0].title, 'Chrome 待办')
    assert(state.md.text.includes('Chrome 草稿'))
    await page.keyboard.press('Escape')
    await page.screenshot({ path: path.join(root, '.cache/chrome-home.png') })
    console.log('PASS: Mermaid under extension CSP; notes/todos/Markdown survive reload')
    assert.deepEqual(await page.evaluate(() => window.__errors), [])
    assert.deepEqual(errors, [])
    console.log('PASS: no renderer errors or CSP errors')
    if (process.env.MOZI_CHROME_PATH) {
      const client = await context.browser().newBrowserCDPSession()
      const pageClient = await context.newCDPSession(page)
      const targetInfo = (await client.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] })).targetInfos.find(t => t.url === page.url())
      await client.send('Extensions.triggerAction', { id, targetId: targetInfo.targetId })
      const tabs = await page.evaluate(() => chrome.tabs.query({ url: chrome.runtime.getURL('index.html') }))
      assert.equal(tabs.length, 1)
      await pageClient.detach()
      await page.close()
      const blank = context.pages()[0]
      const blankClient = await context.newCDPSession(blank)
      const target = (await client.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] })).targetInfos.find(t => t.url === blank.url()).targetId
      const created = context.waitForEvent('page', { timeout: 10000 })
      await client.send('Extensions.triggerAction', { id, targetId: target })
      const reopened = await created
      await reopened.waitForSelector('.tool-card', { state: 'attached' })
      await reopened.waitForFunction(() => __moziData.todos().some(t => t.title === 'Chrome 待办'))
      await blankClient.detach()
      await client.detach()
      console.log('PASS: toolbar action reuses workspace, opens a new one after close, and restores data')
    }

  } finally {
    if (context) await context.close()
    for (const socket of wss.clients) socket.terminate()
    wss.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true })
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1 })
