'use strict'

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu, nativeTheme } = require('electron')
const path = require('node:path')
const fsp = require('node:fs/promises')
const nodeCrypto = require('node:crypto')
const nodeFs = require('node:fs')

const httpEngine = require('./http')
const sse = require('./sse')
const ws = require('./ws')
const { createStore } = require('./store')

const isMac = process.platform === 'darwin'
const isSmoke = process.argv.includes('--smoke')

// Allows running under restricted environments (CI, sandboxes) with a workspace-local profile.
const customUserData = process.env.MOZI_USER_DATA || process.env.POSTLITE_USER_DATA
if (customUserData) app.setPath('userData', customUserData)

let win = null
let store = null
let uiLanguage = 'zh'

const MENU_TEXT = {
  zh: {
    file: '文件', newRequest: '新建请求', importCurl: '导入 cURL', saveRequest: '保存请求',
    go: '前往', toolbox: '工具箱',
    tools: { http: '请求工具', jwt: 'JWT 解析', regex: '正则测试', codegen: 'cURL 转代码', escape: '字符转义', base64: 'Base64 工具箱', hash: 'Hash 摘要', timestamp: '时间戳转换', json: 'JSON 格式化', markdown: 'Markdown 编辑器', generator: 'UUID / 密码' }
  },
  en: {
    file: 'File', newRequest: 'New Request', importCurl: 'Import cURL', saveRequest: 'Save Request',
    go: 'Go', toolbox: 'Toolbox',
    tools: { http: 'API Client', jwt: 'JWT Decoder', regex: 'Regex Tester', codegen: 'cURL to Code', escape: 'Escaping', base64: 'Base64 Tools', hash: 'Hash', timestamp: 'Timestamp', json: 'JSON Formatter', markdown: 'Markdown Editor', generator: 'UUID / Password' }
  }
}

function mt () { return MENU_TEXT[uiLanguage] || MENU_TEXT.zh }
const sseHandles = new Map()

function emitToRenderer (channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}
const emitSse = (payload) => emitToRenderer('sse:event', payload)
const emitWs = (payload) => emitToRenderer('ws:event', payload)

function createWindow () {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1015' : '#f4f6fa',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    ws.closeAll(emitWs)
    for (const handle of sseHandles.values()) handle.close()
    sseHandles.clear()
    win = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

function buildMenu () {
  const L = mt()
  const toolItem = (id, accelIndex) => ({
    label: L.tools[id],
    accelerator: `CmdOrCtrl+${accelIndex}`,
    click: () => emitToRenderer('menu:tool', id)
  })
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: L.file,
      submenu: [
        { label: L.newRequest, accelerator: 'CmdOrCtrl+N', click: () => emitToRenderer('menu:new-request') },
        { label: L.importCurl, accelerator: 'CmdOrCtrl+I', click: () => emitToRenderer('menu:import-curl') },
        { label: L.saveRequest, accelerator: 'CmdOrCtrl+S', click: () => emitToRenderer('menu:save-request') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: L.go,
      submenu: [
        { label: L.toolbox, accelerator: 'CmdOrCtrl+1', click: () => emitToRenderer('menu:home') },
        { type: 'separator' },
        toolItem('http', 2),
        toolItem('jwt', 3),
        toolItem('regex', 4),
        toolItem('codegen', 5),
        toolItem('escape', 6),
        toolItem('base64', 7),
        toolItem('hash', 8),
        toolItem('timestamp', 9)
      ]
    },
    { role: 'editMenu' },
    {
      role: 'viewMenu'
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc () {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    },
    dark: nativeTheme.shouldUseDarkColors
  }))

  ipcMain.handle('http:send', async (_event, payload) => httpEngine.send(payload))

  ipcMain.handle('ws:open', (_event, payload) => { ws.open(payload, emitWs); return { ok: true } })
  ipcMain.handle('ws:send', (_event, { id, data, isBinary }) => ws.send(id, data, isBinary))
  ipcMain.handle('ws:close', (_event, { id }) => { ws.close(id, emitWs); return { ok: true } })

  ipcMain.handle('sse:open', (_event, payload) => {
    const existing = sseHandles.get(payload.id)
    if (existing) existing.close()
    sseHandles.set(payload.id, sse.open(payload, emitSse))
    return { ok: true }
  })
  ipcMain.handle('sse:close', (_event, { id }) => {
    const handle = sseHandles.get(id)
    if (handle) { handle.close(); sseHandles.delete(id) }
    return { ok: true }
  })

  ipcMain.handle('store:load', () => store.load())
  ipcMain.handle('store:save', (_event, data) => store.save(data))
  ipcMain.handle('store:path', () => store.path())

  ipcMain.handle('fs:pick-files', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return []
    const files = []
    for (const p of result.filePaths) {
      try {
        const stat = await fsp.stat(p)
        files.push({ path: p, name: path.basename(p), size: stat.size })
      } catch { /* skip unreadable */ }
    }
    return files
  })

  ipcMain.handle('dialog:save-text', async (_event, { defaultName, content, filters }) => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'postlite-export.json',
      filters: filters || [{ name: 'All files', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    await fsp.writeFile(result.filePath, content, 'utf8')
    return { ok: true, path: result.filePath }
  })

  ipcMain.handle('dialog:open-text', async (_event, { filters } = {}) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All files', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false }
    const content = await fsp.readFile(result.filePaths[0], 'utf8')
    return { ok: true, path: result.filePaths[0], content }
  })

  // Extension -> mime map for the file IPC. mimeForPath used to be called but
  // never defined, so every read-base64 call rejected with a ReferenceError and
  // the picker-based image inserts silently did nothing.
  const MIME_BY_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    ico: 'image/x-icon', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
    tif: 'image/tiff', tiff: 'image/tiff', pdf: 'application/pdf', txt: 'text/plain',
    md: 'text/markdown', json: 'application/json', csv: 'text/csv', xml: 'application/xml',
    html: 'text/html', htm: 'text/html', yml: 'text/yaml', yaml: 'text/yaml',
    zip: 'application/zip', gz: 'application/gzip'
  }

  function mimeForPath (filePath) {
    const ext = path.extname(String(filePath || '')).slice(1).toLowerCase()
    return MIME_BY_EXT[ext] || 'application/octet-stream'
  }

  ipcMain.handle('files:read-base64', async (_event, filePath) => {
    const p = String(filePath || '')
    if (!p) return { ok: false, error: 'No file path' }
    try {
      const buf = await fsp.readFile(p)
      const mime = mimeForPath(p)
      return { ok: true, name: path.basename(p), size: buf.length, mime, base64: buf.toString('base64') }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('files:save-base64', async (_event, { defaultName, base64, mime }) => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'mozi-output.bin',
      filters: [{ name: 'All files', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    try {
      await fsp.writeFile(result.filePath, Buffer.from(String(base64 || ''), 'base64'))
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('hash:text', (_event, { algorithms, text, encoding }) => {
    const algos = (Array.isArray(algorithms) && algorithms.length ? algorithms : ['sha256'])
      .map((a) => String(a).toLowerCase())
      .filter((a) => ['md5', 'sha1', 'sha256', 'sha512'].includes(a))
    let bytes
    try {
      const enc = String(encoding || 'utf8')
      if (enc === 'base64') bytes = Buffer.from(String(text || '').replace(/\s+/g, ''), 'base64')
      else if (enc === 'hex') bytes = Buffer.from(String(text || '').replace(/[^0-9a-fA-F]/g, ''), 'hex')
      else bytes = Buffer.from(String(text || ''), 'utf8')
    } catch (err) {
      return { ok: false, error: `输入不是合法的 ${encoding}：${err.message}` }
    }
    if (encoding === 'hex') {
      const clean = String(text || '').replace(/[^0-9a-fA-F]/g, '')
      if (!clean || clean.length % 2) return { ok: false, error: 'Hex 输入长度必须是偶数' }
    }
    if (encoding === 'base64') {
      const clean = String(text || '').replace(/\s+/g, '')
      if (!/^[A-Za-z0-9+/=\-_]*$/.test(clean)) return { ok: false, error: 'Base64 输入含非法字符' }
    }
    const hashes = {}
    for (const algo of algos) hashes[algo] = nodeCrypto.createHash(algo).update(bytes).digest('hex')
    return { ok: true, algorithms: algos, hashes, bytes: bytes.length }
  })

  ipcMain.handle('hash:files', async (_event, { algorithms, filePaths }) => {
    const algos = (Array.isArray(algorithms) && algorithms.length ? algorithms : ['sha256'])
      .map((a) => String(a).toLowerCase())
      .filter((a) => ['md5', 'sha1', 'sha256', 'sha512'].includes(a))
    const files = Array.isArray(filePaths) && filePaths.length ? filePaths : (await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })).filePaths || []
    const out = []
    for (const p of files) {
      const entry = { path: p, name: path.basename(p), size: 0, hashes: {}, error: null }
      try {
        const stat = await fsp.stat(p)
        entry.size = stat.size
        const digests = algos.map((a) => nodeCrypto.createHash(a))
        const stream = nodeFs.createReadStream(p)
        for (const d of digests) stream.pipe(d)
        await new Promise((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject) })
        algos.forEach((a, i) => { entry.hashes[a] = digests[i].digest('hex') })
      } catch (err) {
        entry.error = err.message
      }
      out.push(entry)
    }
    return { ok: true, algorithms: algos, results: out }
  })

  ipcMain.handle('language:set', (_event, lang) => {
    uiLanguage = lang === 'en' ? 'en' : 'zh'
    buildMenu()
    return { ok: true, language: uiLanguage }
  })

  ipcMain.handle('theme:set', (_event, mode) => {
    const m = ['light', 'dark', 'system'].includes(mode) ? mode : 'system'
    nativeTheme.themeSource = m
    return { ok: true, resolvedDark: nativeTheme.shouldUseDarkColors }
  })

  ipcMain.handle('clipboard:write', (_event, text) => { clipboard.writeText(String(text)); return { ok: true } })
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('shell:open-external', (_event, url) => {
    if (/^https?:/i.test(String(url))) shell.openExternal(String(url))
    return { ok: true }
  })
}

app.whenReady().then(async () => {
  store = createStore(app.getPath('userData'))
  nativeTheme.themeSource = 'system'
  registerIpc()
  buildMenu()
  createWindow()

  if (isSmoke) {
    win.webContents.once('did-finish-load', () => setTimeout(() => require('./smoke').runSmoke(win, app), 300))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac || isSmoke) app.quit()
})
