'use strict'

;(function () {
  const en = () => window.I18N?.get() === 'en'
  const note = document.createElement('p')
  note.className = 'muted small'
  document.querySelector('.home-brand > div').appendChild(note)
  const network = document.createElement('p')
  network.className = 'muted small'
  network.style.cssText = 'padding:6px 14px;margin:0;border-bottom:1px solid var(--line)'
  document.querySelector('.req-subbar').after(network)
  const md = document.createElement('p')
  md.className = 'muted small'
  md.style.cssText = 'margin:0;padding:6px 14px'
  document.querySelector('#view-markdown').prepend(md)
  const cookieHint = document.querySelector('#cookieHint')
  cookieHint.removeAttribute('data-i18n')
  const footer = document.querySelector('.home-foot')
  footer.removeAttribute('data-i18n')
  function update () {
    footer.textContent = `Mozi ${chrome.runtime.getManifest().version} · Chrome`
    note.textContent = en() ? 'Chrome extension · Saved locally in this browser' : 'Chrome 扩展版 · 数据保存在当前浏览器本地'
    network.textContent = en()
      ? 'Browser limits: HTTP/SSE omit cookies; WebSocket uses browser-managed cookies and cannot set handshake headers. TLS checks cannot be bypassed.'
      : '浏览器限制：HTTP/SSE 不携带 Cookie；WebSocket 的 Cookie 由浏览器管理，不能自定义握手头；不支持跳过 TLS 校验。'
    md.textContent = en()
      ? 'Use inserted/pasted images for local images. If direct file access is unavailable, Save downloads a copy; check Chrome downloads.'
      : '本地图片请用插入/粘贴；直接读写不可用时，保存会下载副本，请查看 Chrome 下载列表。'
    cookieHint.textContent = en()
      ? 'The independent Cookie Jar is unavailable in Chrome. Matching enabled entries prevent sending; disable them to continue. Set-Cookie is not exposed.'
      : 'Chrome 扩展不支持独立 Cookie Jar，也无法读取 Set-Cookie。匹配的启用项会阻止发送，请先停用。'
    document.querySelector('#opt-insecure').closest('label').title = en() ? 'Unavailable in Chrome' : 'Chrome 不支持；开启时请求会显示错误'
  }
  update()
  document.querySelector('#langSeg').addEventListener('click', () => queueMicrotask(update))
  // A restored note/todo can be saved with the same shortcut without leaving it.
  window.__moziClaimMenu('notepad', 'save-request', () => {
    document.querySelector('#np-editor').dispatchEvent(new Event('input', { bubbles: true }))
    window.__moziToast(en() ? 'Saving note…' : '正在保存笔记…')
  })
  window.__moziClaimMenu('todos', 'save-request', () => {
    window.__moziData.setTodos(window.__moziData.todos())
    window.__moziToast(en() ? 'Saved' : '已保存')
  })
})()
