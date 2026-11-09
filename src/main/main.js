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
    backgroundColor: '#0e1015',
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
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Request', accelerator: 'CmdOrCtrl+N', click: () => emitToRenderer('menu:new-request') },
        { label: 'Import cURL', accelerator: 'CmdOrCtrl+I', click: () => emitToRenderer('menu:import-curl') },
        { label: 'Save Request', accelerator: 'CmdOrCtrl+S', click: () => emitToRenderer('menu:save-request') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Go',
      submenu: [
        { label: '工具箱', accelerator: 'CmdOrCtrl+1', click: () => emitToRenderer('menu:home') },
        { type: 'separator' },
        { label: '请求工具', accelerator: 'CmdOrCtrl+2', click: () => emitToRenderer('menu:tool', 'http') },
        { label: 'JWT 解析', accelerator: 'CmdOrCtrl+3', click: () => emitToRenderer('menu:tool', 'jwt') },
        { label: '正则测试', accelerator: 'CmdOrCtrl+4', click: () => emitToRenderer('menu:tool', 'regex') },
        { label: 'cURL 转代码', accelerator: 'CmdOrCtrl+5', click: () => emitToRenderer('menu:tool', 'codegen') },
        { label: '字符转义', accelerator: 'CmdOrCtrl+6', click: () => emitToRenderer('menu:tool', 'escape') },
        { label: 'Base64 工具箱', accelerator: 'CmdOrCtrl+7', click: () => emitToRenderer('menu:tool', 'base64') },
        { label: 'Hash 摘要', accelerator: 'CmdOrCtrl+8', click: () => emitToRenderer('menu:tool', 'hash') },
        { label: '时间戳转换', accelerator: 'CmdOrCtrl+9', click: () => emitToRenderer('menu:tool', 'timestamp') }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function mimeForPath (filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    '.avif': 'image/avif', '.pdf': 'application/pdf', '.json': 'application/json',
    '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html'
  }
  return map[ext] || 'application/octet-stream'
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

  ipcMain.handle('clipboard:write', (_event, text) => { clipboard.writeText(String(text)); return { ok: true } })
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('shell:open-external', (_event, url) => {
    if (/^https?:/i.test(String(url))) shell.openExternal(String(url))
    return { ok: true }
  })
}

app.whenReady().then(async () => {
  store = createStore(app.getPath('userData'))
  nativeTheme.themeSource = 'dark'
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
