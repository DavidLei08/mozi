'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const on = (channel, cb) => {
  const listener = (_event, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),

  http: { send: (payload) => ipcRenderer.invoke('http:send', payload) },

  ws: {
    open: (payload) => ipcRenderer.invoke('ws:open', payload),
    send: (payload) => ipcRenderer.invoke('ws:send', payload),
    close: (payload) => ipcRenderer.invoke('ws:close', payload),
    onEvent: (cb) => on('ws:event', cb)
  },

  sse: {
    open: (payload) => ipcRenderer.invoke('sse:open', payload),
    close: (payload) => ipcRenderer.invoke('sse:close', payload),
    onEvent: (cb) => on('sse:event', cb)
  },

  store: {
    load: () => ipcRenderer.invoke('store:load'),
    save: (data) => ipcRenderer.invoke('store:save', data),
    path: () => ipcRenderer.invoke('store:path')
  },

  files: {
    pick: () => ipcRenderer.invoke('fs:pick-files'),
    readBase64: (filePath) => ipcRenderer.invoke('files:read-base64', filePath),
    saveBase64: (payload) => ipcRenderer.invoke('files:save-base64', payload)
  },

  dialog: {
    saveText: (payload) => ipcRenderer.invoke('dialog:save-text', payload),
    openText: (payload) => ipcRenderer.invoke('dialog:open-text', payload)
  },

  hash: {
    files: (payload) => ipcRenderer.invoke('hash:files', payload),
    text: (payload) => ipcRenderer.invoke('hash:text', payload)
  },

  setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),
  setLanguage: (lang) => ipcRenderer.invoke('language:set', lang),

  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read')
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  menu: {
    onHome: (cb) => on('menu:home', cb),
    onTool: (cb) => on('menu:tool', cb),
    onNewRequest: (cb) => on('menu:new-request', cb),
    onImportCurl: (cb) => on('menu:import-curl', cb),
    onSaveRequest: (cb) => on('menu:save-request', cb)
  }
})
