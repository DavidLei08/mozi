'use strict'

/**
 * Mozi toolbox views: escape / json / base64 / image / markdown.
 * The HTTP tool lives in app.js; this file only owns the small utilities.
 */
;(function () {
  const api = window.api
  // translation helper: dictionary lookup, falling back to the Chinese source
  const tr = (key, fallback) => (window.I18N && window.I18N.t) ? window.I18N.t(key, fallback) : fallback
  const C = window.Codec
  const $ = (sel, root) => (root || document).querySelector(sel)

  function toast (message) {
    const el = $('#toast')
    el.textContent = message
    el.classList.remove('hidden')
    clearTimeout(toast._timer)
    toast._timer = setTimeout(() => el.classList.add('hidden'), 2200)
  }

  async function copy (text, label) {
    await api.clipboard.write(String(text ?? ''))
    toast(`${label || '内容'}已复制`)
  }

  function debounce (fn, ms) {
    let timer = null
    return (...args) => {
      clearTimeout(timer)
      timer = setTimeout(() => fn(...args), ms)
    }
  }

  function setStats (el, text) {
    if (el) el.textContent = text || ''
  }

  // generic buttons: data-copy-from / data-clear / data-clipboard-from
  function wireGeneric () {
    document.addEventListener('click', async (e) => {
      const copyBtn = e.target.closest('[data-copy-from]')
      if (copyBtn) {
        const src = document.getElementById(copyBtn.dataset.copyFrom)
        if (src) await copy(src.value, '内容')
        return
      }
      const clearBtn = e.target.closest('[data-clear]')
      if (clearBtn) {
        const target = document.getElementById(clearBtn.dataset.clear)
        if (target) { target.value = ''; target.dispatchEvent(new Event('input', { bubbles: true })) }
        return
      }
      const pasteBtn = e.target.closest('[data-clipboard-from]')
      if (pasteBtn) {
        const target = document.getElementById(pasteBtn.dataset.clipboardFrom)
        if (target) {
          const text = await api.clipboard.read()
          target.value = text
          target.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
    })
  }

  // ================================================================ ESCAPE
  function initEscape () {
    const input = $('#esc-in')
    const output = $('#esc-out')
    const mode = $('#esc-mode')
    const note = $('#esc-note')

    const forward = {
      js: C.escapeJs,
      json: C.escapeJson,
      url: C.urlEncode,
      html: C.escapeHtml,
      unicode: C.unicodeEscape
    }
    const reverse = {
      js: C.unescapeJs,
      json: C.unescapeJson,
      url: C.urlDecode,
      html: C.unescapeHtml,
      unicode: C.unicodeUnescape
    }

    function run (direction) {
      const fn = direction === 'reverse' ? reverse[mode.value] : forward[mode.value]
      try {
        output.value = fn(input.value)
        note.textContent = direction === 'reverse' ? '已执行去转义' : '已执行转义'
      } catch (err) {
        output.value = ''
        note.textContent = `转换失败：${err.message}`
      }
    }

    input.addEventListener('input', () => run('forward'))
    mode.addEventListener('change', () => run('forward'))
    $('#esc-do').addEventListener('click', () => run('forward'))
    $('#esc-undo').addEventListener('click', () => run('reverse'))
    $('#esc-swap').addEventListener('click', () => {
      const tmp = input.value
      input.value = output.value
      output.value = tmp
      note.textContent = tr('msg.swappedIO', '已交换输入与输出')
    })
  }

  // ================================================================ JSON
  function initJson () {
    const input = $('#json-in')
    const output = $('#json-out')
    const status = $('#json-status')
    const stats = $('#json-stats')

    function describe (value) {
      const s = C.statsJson(value)
      return `${s.keys} 个键 · ${s.nodes} 个节点`
    }

    function fail (result) {
      const pos = result.position
      status.textContent = `✗ ${result.error}${pos ? `（第 ${pos.line} 行，第 ${pos.column} 列）` : ''}`
      status.style.color = 'var(--red)'
      return false
    }

    function ok (text, extra) {
      status.textContent = `✓ 合法 JSON${extra ? ' · ' + extra : ''}`
      status.style.color = 'var(--green)'
      return true
    }

    function liveFormat () {
      const text = input.value.trim()
      if (!text) {
        output.value = ''
        status.textContent = tr('msg.waitingInput', '等待输入…')
        status.style.color = ''
        setStats(stats, '')
        return
      }
      const result = C.formatJson(text, 2)
      if (!result.ok) {
        output.value = ''
        fail(result)
        setStats(stats, '')
        return
      }
      output.value = result.text
      const parsed = C.parseJson(text)
      ok(result.text, describe(parsed.value))
      setStats(stats, `${text.length} 字符 → ${result.text.length} 字符`)
    }

    input.addEventListener('input', debounce(liveFormat, 120))

    $('#json-format2').addEventListener('click', () => {
      const r = C.formatJson(input.value, 2)
      if (!r.ok) return fail(r)
      output.value = r.text
      const parsed = C.parseJson(input.value)
      ok(r.text, '2 空格缩进 · ' + describe(parsed.value))
    })
    $('#json-format4').addEventListener('click', () => {
      const r = C.formatJson(input.value, 4)
      if (!r.ok) return fail(r)
      output.value = r.text
      const parsed = C.parseJson(input.value)
      ok(r.text, '4 空格缩进 · ' + describe(parsed.value))
    })
    $('#json-minify').addEventListener('click', () => {
      const r = C.minifyJson(input.value)
      if (!r.ok) return fail(r)
      output.value = r.text
      ok(r.text, '已压缩')
    })
    $('#json-sort').addEventListener('click', () => {
      const parsed = C.parseJson(input.value)
      if (!parsed.ok) return fail(parsed)
      const text = JSON.stringify(C.sortJsonKeys(parsed.value), null, 2)
      output.value = text
      ok(text, '键名已排序')
    })
    $('#json-validate').addEventListener('click', () => {
      const parsed = C.parseJson(input.value)
      if (!parsed.ok) { fail(parsed); toast(tr('json.invalid', 'JSON 不合法')); return }
      ok(input.value, describe(parsed.value))
      toast(tr('json.valid', 'JSON 合法'))
    })
    $('#json-swap').addEventListener('click', () => {
      if (!output.value) return
      input.value = output.value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  // ================================================================ BASE64 (text + images)
  function initBase64Tool () {
    // ---- sub-tab switching
    for (const btn of $$('#b64-tabs .seg-btn')) {
      btn.addEventListener('click', () => {
        for (const b of $$('#b64-tabs .seg-btn')) b.classList.toggle('is-active', b === btn)
        for (const panel of $$('[data-b64panel]')) panel.classList.toggle('hidden', panel.dataset.b64panel !== btn.dataset.b64tab)
      })
    }

    // ---------------------------------------------------------- text mode
    const input = $('#b64-in')
    const output = $('#b64-out')
    const mode = $('#b64-mode')
    const urlSafe = $('#b64-urlsafe')
    const note = $('#b64-note')
    const stats = $('#b64-stats')
    const inLabel = $('#b64-in-label')
    const outLabel = $('#b64-out-label')

    function labels () {
      const encode = mode.value === 'encode'
      inLabel.textContent = encode ? '明文' : 'Base64'
      outLabel.textContent = encode ? 'Base64' : '明文'
      input.placeholder = encode ? '输入任意文本（支持中文）…' : '粘贴 Base64 字符串…'
    }

    function run () {
      const text = input.value
      if (!text) {
        output.value = ''
        setStats(stats, '')
        note.textContent = tr('msg.waitingInput', '等待输入…')
        return
      }
      try {
        if (mode.value === 'encode') {
          output.value = C.base64Encode(text, urlSafe.checked)
          note.textContent = tr('msg.encoded', '已编码') + (urlSafe.checked ? '（URL-safe）' : '')
        } else {
          output.value = C.base64Decode(text, urlSafe.checked)
          note.textContent = tr('msg.decoded', '已解码')
        }
        note.style.color = ''
        setStats(stats, `输入 ${text.length} 字符 · 输出 ${output.value.length} 字符`)
      } catch (err) {
        output.value = ''
        note.textContent = `转换失败：不是合法的 Base64（${err.message}）`
        note.style.color = 'var(--red)'
        setStats(stats, '')
      }
    }

    mode.addEventListener('change', () => { labels(); run() })
    urlSafe.addEventListener('change', run)
    input.addEventListener('input', debounce(run, 120))
    $('#b64-run').addEventListener('click', run)
    $('#b64-swap').addEventListener('click', () => {
      if (!output.value) return
      const tmp = input.value
      input.value = output.value
      mode.value = mode.value === 'encode' ? 'decode' : 'encode'
      labels()
      output.value = tmp
      run()
      toast(tr('msg.swapped', '已交换'))
    })
    labels()

    // ---------------------------------------------------------- image -> base64
    let picked = null

    function showPreview (container, dataUrl, mime, bytes) {
      container.textContent = ''
      const img = document.createElement('img')
      img.alt = 'preview'
      img.src = dataUrl
      container.appendChild(img)
      img.addEventListener('load', () => {
        setStats($('#img2-note'), `${mime} · ${img.naturalWidth}×${img.naturalHeight} · ${C.humanSize(bytes)}`)
      })
      img.addEventListener('error', () => {
        container.textContent = ''
        container.appendChild(Object.assign(document.createElement('span'), { className: 'muted', textContent: '无法解析为图片' }))
      })
    }

    $('#img2-pick').addEventListener('click', async () => {
      const files = await api.files.pick()
      if (!files[0]) return
      const result = await api.files.readBase64(files[0].path)
      if (!result.ok) { toast(result.error || '读取失败'); return }
      picked = { mime: result.mime, base64: result.base64, dataUrl: `data:${result.mime};base64,${result.base64}` }
      showPreview($('#img2-preview'), picked.dataUrl, result.mime, result.size)
      $('#img2-out').value = picked.base64
      toast(`已读取 ${files[0].name}`)
    })

    $('#img2-copy-base64').addEventListener('click', () => {
      if (!picked) return toast(tr('img.noneSelected', '还没有选择图片'))
      copy(picked.base64, 'Base64')
    })
    $('#img2-copy-dataurl').addEventListener('click', () => {
      if (!picked) return toast(tr('img.noneSelected', '还没有选择图片'))
      copy(picked.dataUrl, 'Data URL')
    })

    // ---------------------------------------------------------- base64 -> image
    const inArea = $('#img-in')
    const preview = $('#img-preview')
    const imgNote = $('#img-note')
    let current = null

    function renderFromBase64 () {
      const text = inArea.value.trim()
      if (!text) {
        preview.textContent = ''
        preview.appendChild(Object.assign(document.createElement('span'), { className: 'muted', textContent: '还没有可预览的图片' }))
        imgNote.textContent = tr('img.inputHint2', '粘贴 Base64 或 Data URL，自动预览')
        imgNote.style.color = ''
        return
      }
      const parsed = C.normalizeDataUrl(text)
      if (!parsed) {
        imgNote.textContent = tr('img.unrecognized', '无法识别为 Base64 或 Data URL')
        imgNote.style.color = 'var(--red)'
        return
      }
      current = parsed
      imgNote.style.color = ''
      preview.textContent = ''
      const img = document.createElement('img')
      img.alt = 'preview'
      img.src = parsed.dataUrl
      preview.appendChild(img)
      img.addEventListener('load', () => {
        imgNote.textContent = `${parsed.mime} · ${img.naturalWidth}×${img.naturalHeight} · ${C.humanSize(C.byteLengthOfBase64(parsed.base64))}`
      })
      img.addEventListener('error', () => {
        preview.textContent = ''
        preview.appendChild(Object.assign(document.createElement('span'), { className: 'muted', textContent: '无法解析为图片' }))
        imgNote.textContent = tr('img.notAnImage', 'Base64 内容不是有效的图片')
        imgNote.style.color = 'var(--red)'
      })
    }

    inArea.addEventListener('input', debounce(renderFromBase64, 250))
    $('#img-render').addEventListener('click', renderFromBase64)
    $('#img-save').addEventListener('click', async () => {
      if (!current) return toast(tr('img.nothingToSave', '没有可保存的图片'))
      const ext = (current.mime.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg')
      const result = await api.files.saveBase64({ defaultName: `mozi-image.${ext}`, base64: current.base64, mime: current.mime })
      if (result.ok) toast(`已保存到 ${result.path}`)
      else if (result.error) toast(result.error)
    })
  }

  function $$ (sel, root) {
    return Array.from((root || document).querySelectorAll(sel))
  }

  // ================================================================ MARKDOWN
  const SAMPLE_MD = `# Mozi Markdown

一个**轻量**的 Markdown 编辑器，左边写、右边看。

## 支持语法

- 标题、粗体、*斜体*、~~删除线~~、\`行内代码\`
- 有序列表
- 引用块
- 表格

| 工具 | 状态 |
| :--- | ---: |
| 请求工具 | ✅ |
| JSON 格式化 | ✅ |

> 提示：可以用 ⌘/Ctrl + S 导出 HTML。

\`\`\`js
const mozi = { name: 'Mozi', local: true }
console.log(mozi)
\`\`\`

\`\`\`mermaid
flowchart LR
  A[输入 Markdown] --> B{有 mermaid 代码块?}
  B -- 是 --> C[渲染流程图]
  B -- 否 --> D[普通预览]
\`\`\`

[了解 Electron](https://www.electronjs.org)
`

  // Mermaid reads its theme at initialize() time, so every render pass must
  // re-apply it — otherwise diagrams stay dark after a switch to light.
  function configureMermaid () {
    if (!window.mermaid || typeof window.mermaid.initialize !== 'function') return
    const light = document.documentElement.dataset.theme === 'light'
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: light ? 'default' : 'dark',
        securityLevel: 'strict',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
        themeVariables: { fontSize: '14px' }
      })
    } catch { /* keep previous settings */ }
  }

  let mermaidLoading = null
  let mermaidSeq = 0
  let mermaidIdSeq = 0

  function loadMermaid () {
    if (window.mermaid) return Promise.resolve(window.mermaid)
    if (!mermaidLoading) {
      mermaidLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'lib/mermaid.min.js'
        script.onload = () => {
          configureMermaid()
          resolve(window.mermaid)
        }
        script.onerror = () => reject(new Error('Mermaid 资源加载失败'))
        document.head.appendChild(script)
      })
    }
    return mermaidLoading
  }

  async function renderMermaid (container, token) {
    const blocks = Array.from(container.querySelectorAll('pre > code.language-mermaid'))
    if (!blocks.length) return
    let mermaid
    try {
      mermaid = await loadMermaid()
    } catch (err) {
      for (const code of blocks) {
        const holder = document.createElement('div')
        holder.className = 'md-mermaid md-mermaid-error'
        holder.textContent = err.message
        code.parentElement.replaceWith(holder)
      }
      return
    }
    configureMermaid()
    for (const code of blocks) {
      if (token !== undefined && token !== mermaidSeq) return
      const pre = code.parentElement
      const text = code.textContent
      const holder = document.createElement('div')
      holder.className = 'md-mermaid'
      pre.replaceWith(holder)
      try {
        const id = `md-mermaid-${++mermaidIdSeq}-${Date.now()}`
        const result = await mermaid.render(id, text)
        if (token !== undefined && token !== mermaidSeq) return
        const svg = typeof result === 'string'
          ? result
          : (result && (result.svg || result.data || result.output))
        if (!svg) throw new Error('Mermaid 没有返回 SVG')
        holder.textContent = ''
        holder.innerHTML = svg
      } catch (err) {
        holder.className = 'md-mermaid md-mermaid-error'
        holder.textContent = `流程图渲染失败：${(err && err.message) || err}`
        const source = document.createElement('pre')
        source.textContent = text
        holder.appendChild(source)
      }
    }
  }

  function fileToDataUrl (file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error || new Error('读取失败'))
      reader.readAsDataURL(file)
    })
  }

  // Register a listener only when the element exists: one missing id used to
  // throw and abort the rest of the tool's init, silently disabling live
  // preview and draft saving.
  function on (selector, type, handler, opts) {
    const node = document.querySelector(selector)
    if (!node) { console.warn('missing element for listener:', selector); return null }
    node.addEventListener(type, handler, opts)
    return node
  }

  function initMarkdown () {
    const input = $('#md-in')
    const preview = $('#md-preview')
    const stats = $('#md-stats')
    let token = 0

    const fallbackRender = (md) => {
      const esc = C.escapeHtml(md)
      return esc.split(/\n{2,}/).map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`).join('')
    }

    function insertAtCursor (text) {
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? input.value.length
      input.value = input.value.slice(0, start) + text + input.value.slice(end)
      input.selectionStart = input.selectionEnd = start + text.length
      render()
    }

    async function insertImageFile (file) {
      if (!file) return
      if (!/^image\//.test(file.type)) { toast(tr('img.pickPrompt', '请选择图片文件')); return }
      const dataUrl = await fileToDataUrl(file)
      const name = (file.name || 'image').replace(/[\r\n]/g, '')
      insertAtCursor(`\n![${name}](${dataUrl})\n`)
      toast(tr('img.inserted', '图片已插入'))
    }

    // ---- relative image paths -------------------------------------------------
    // Markdown written next to its assets uses `./img/x.png`; the renderer runs
    // in a file:// document, so those URLs must be rewritten against the folder
    // of the .md file the user opened.
    // The markdown document is a draft that survives restarts: the text and the
    // file it came from live in the store, so nothing is lost between sessions.
    let mdFilePath = null
    const mdBridge = () => window.__moziData
    function mdSaveDraft () {
      if (!mdBridge || !mdBridge()) return
      mdBridge().setMdDoc({ text: input.value, path: mdFilePath, updatedAt: new Date().toISOString() })
    }
    function mdShowFile () {
      const label = document.querySelector('#md-file')
      if (!label) return
      label.textContent = mdFilePath ? mdFilePath : tr('md.unsavedDraft', '未保存的草稿')
      label.title = mdFilePath ? mdFilePath : tr('md.unsavedDraftHint', '草稿会自动保存，重启后仍在；点「保存」写入 .md 文件')
    }

    const MD_BASE_KEY = 'mozi.mdBaseDir'
    let mdBaseDir = (() => { try { return localStorage.getItem(MD_BASE_KEY) || '' } catch { return '' } })()
    let mdFullscreen = false

    function dirName (filePath) {
      const normalised = String(filePath || '').replace(/\\/g, '/')
      const cut = normalised.lastIndexOf('/')
      return cut > 0 ? normalised.slice(0, cut) : ''
    }

    function joinPath (dir, rel) {
      const parts = String(dir).replace(/\\/g, '/').split('/')
      for (const piece of String(rel).replace(/\\/g, '/').split('/')) {
        if (!piece || piece === '.') continue
        if (piece === '..') { if (parts.length > 1) parts.pop(); continue }
        parts.push(piece)
      }
      const joined = parts.join('/')
      return joined.startsWith('/') ? joined : '/' + joined
    }

    function fileUrl (absPath) {
      return 'file://' + String(absPath).split('/').map(encodeURIComponent).join('/')
    }

    function isRelativeSrc (src) {
      const value = String(src == null ? '' : src).trim()
      if (!value) return false
      if (value.startsWith('//')) return false
      return !/^[a-z][a-z0-9+.-]*:/i.test(value)
    }

    function resolveRelativeImages (root) {
      for (const img of root.querySelectorAll('img[src]')) {
        const original = img.getAttribute('src')
        if (!isRelativeSrc(original)) continue
        if (!mdBaseDir) {
          img.classList.add('img-unresolved')
          img.title = tr('md.needBaseDir', '相对路径需要先打开本地 .md 文件')
          continue
        }
        const abs = original.startsWith('/') ? original : joinPath(mdBaseDir, original)
        img.dataset.resolvedFrom = original
        img.setAttribute('src', fileUrl(abs))
      }
    }

    function setBaseDir (dir, opts) {
      mdBaseDir = String(dir || '')
      try {
        if (mdBaseDir) localStorage.setItem(MD_BASE_KEY, mdBaseDir)
        else localStorage.removeItem(MD_BASE_KEY)
      } catch { /* private mode */ }
      const label = document.querySelector('#md-base')
      if (label) {
        label.textContent = mdBaseDir || ''
        label.title = mdBaseDir ? tr('md.baseDirHint', '图片相对路径按此目录解析') + '：' + mdBaseDir : ''
      }
      if (!opts || opts.rerender !== false) render()
    }

    // load a markdown file that is already on disk; the dialog handler and the
    // smoke harness both go through here
    function openMarkdownFile (filePath, content) {
      input.value = String(content == null ? '' : content)
      mdFilePath = filePath || null
      mdSavedText = input.value
      setBaseDir(dirName(filePath), { rerender: false })
      mdShowFile()
      render()
      mdUpdateDirty()
      mdSaveDraft()
    }

    function setFullscreen (on) {
      mdFullscreen = !!on
      const view = document.querySelector('#view-markdown')
      if (view) view.classList.toggle('is-md-fullscreen', mdFullscreen)
      render()
    }

    // app.js asks this before treating Esc as "go back to the toolbox"
    window.__moziHandleEscape = () => {
      if (!mdFullscreen) return false
      setFullscreen(false)
      return true
    }
    // test seam: point the resolver at a folder without going through a dialog
    window.__moziSetMdBaseDir = (dir) => setBaseDir(dir)
    window.__moziOpenMarkdownFile = openMarkdownFile
    window.__moziMarkdownSave = (forceDialog) => saveMarkdown(!!forceDialog)
    window.__moziMarkdownState = () => ({ path: mdFilePath, draft: dollarInputValue() })
    function dollarInputValue () { return input.value }
    window.__moziMdState = () => ({ baseDir: mdBaseDir, fullscreen: mdFullscreen })

    function render () {
      const myToken = ++token
      mermaidSeq = myToken
      const text = input.value
      const renderer = (window.Markdown && typeof window.Markdown.render === 'function') ? window.Markdown.render : fallbackRender
      try {
        preview.innerHTML = renderer(text)
      } catch (err) {
        preview.textContent = `渲染失败：${err.message}`
      }
      resolveRelativeImages(preview)
      renderMermaid(preview, myToken).catch(() => {})
      const fullBtn = document.querySelector('#md-full')
      if (fullBtn) {
        const label = mdFullscreen ? tr('md.exitFullscreen', '退出全屏') : tr('md.fullscreen', '全屏预览')
        fullBtn.title = label
        fullBtn.setAttribute('aria-label', label)
        fullBtn.classList.toggle('is-on', mdFullscreen)
      }
      const chars = text.length
      const words = (text.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_\u00c0-\u024f]+/g) || []).length
      stats.textContent = `${chars} 字符 · ${words} 词`
    }

    if (mdBaseDir) setBaseDir(mdBaseDir, { rerender: false })
    const draft = mdBridge && mdBridge() ? mdBridge().mdDoc() : null
    if (draft && draft.text) {
      input.value = draft.text
      mdFilePath = draft.path || null
    }
    mdShowFile()
    render()
    on('#md-full', 'click', () => setFullscreen(!mdFullscreen))
    on('#md-exit-full', 'click', () => setFullscreen(false))
    const mdPersist = debounce(mdSaveDraft, 400)
    async function saveMarkdown (forceDialog) {
      const content = input.value
      if (!forceDialog && mdFilePath) {
        const result = await api.files.writeText({ path: mdFilePath, content })
        if (result && result.ok) {
          mdSavedText = content
          mdUpdateDirty()
          toast(tr('md.savedTo', '已保存到 {name}').replace('{name}', mdFilePath.split('/').pop()))
          mdSaveDraft(); mdShowFile(); return
        }
        toast(`${tr('md.saveFailed', '保存失败')}: ${(result && result.error) || mdFilePath}`)
        return
      }
      const suggested = mdFilePath ? mdFilePath.split('/').pop() : 'note.md'
      const result = await api.dialog.saveText({
        defaultName: suggested,
        content,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      })
      if (result && result.ok) {
        mdFilePath = result.path
        mdSavedText = content
        mdUpdateDirty()
        setBaseDir(dirName(result.path), { rerender: false })
        mdSaveDraft()
        mdShowFile()
        toast(tr('md.savedTo', '已保存到 {name}').replace('{name}', String(result.path).split('/').pop()))
      }
    }
    on('#md-save-as', 'click', () => { saveMarkdown(true) })

    window.addEventListener('keydown', (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      if (document.querySelector('.view.is-active')?.dataset.view !== 'markdown') return
      event.preventDefault()
      saveMarkdown(false)
    })

    input.addEventListener('input', () => { mdUpdateDirty(); mdPersist() })
    input.addEventListener('input', debounce(render, 100))
    async function pickAndInsertImage () {
      let files = []
      try { files = await api.files.pick() } catch (err) { toast(`${tr('img.readFailed', '读取图片失败')}: ${err && err.message ? err.message : err}`); return }
      if (!files || !files[0]) return
      try {
        const result = await api.files.readBase64(files[0].path)
        if (!result || !result.ok) { toast(`${tr('img.readFailed', '读取图片失败')}: ${(result && result.error) || files[0].path}`); return }
        const mime = (result.mime && /^image\//i.test(result.mime)) ? result.mime : 'image/png'
        insertAtCursor(`\n![${files[0].name}](data:${mime};base64,${result.base64})\n`)
        toast(tr('img.inserted', '图片已插入'))
      } catch (err) {
        toast(`${tr('img.readFailed', '读取图片失败')}: ${err && err.message ? err.message : err}`)
      }
    }

    input.addEventListener('paste', async (e) => {
      const items = e.clipboardData ? Array.from(e.clipboardData.items || []) : []
      const imageItem = items.find((item) => item.type && item.type.startsWith('image/'))
      if (!imageItem) return
      e.preventDefault()
      const file = imageItem.getAsFile()
      if (file) await insertImageFile(file)
    })

    input.addEventListener('dragover', (e) => { e.preventDefault() })
    input.addEventListener('drop', async (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
      if (!file) return
      e.preventDefault()
      await insertImageFile(file)
    })

    $('#md-open').addEventListener('click', async () => {
      const result = await api.dialog.openText({ filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }] })
      if (!result.ok) return
      openMarkdownFile(result.path, result.content)
      const name = String(result.path).split(/[\\/]/).pop()
      toast(`已打开 ${name}`)
    })

    $('#md-sample').addEventListener('click', () => { input.value = SAMPLE_MD; render(); toast(tr('msg.sampleInserted', '已插入示例')) })
    $('#md-clear').addEventListener('click', () => { input.value = ''; render() })
    $('#md-copy-html').addEventListener('click', () => {
      copy(preview.innerHTML, 'HTML')
    })
    $('#md-export').addEventListener('click', async () => {
      const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Mozi Markdown</title>
<style>
  body { max-width: 780px; margin: 40px auto; padding: 0 20px; font: 16px/1.7 -apple-system, "Segoe UI", "PingFang SC", sans-serif; color: #1f2430; }
  pre { background: #f4f6fa; padding: 14px; border-radius: 8px; overflow: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
  table { border-collapse: collapse; } th, td { border: 1px solid #d8dee9; padding: 6px 12px; }
  blockquote { border-left: 3px solid #c8cfdb; margin: 0; padding: 2px 16px; color: #5c6577; }
  img { max-width: 100%; }
</style>
</head>
<body>
${preview.innerHTML}
</body>
</html>
`
      const result = await api.dialog.saveText({ defaultName: 'mozi-markdown.html', content: html, filters: [{ name: 'HTML', extensions: ['html'] }] })
      if (result.ok) toast(`已导出到 ${result.path}`)
    })

    // ---- in-editor quick actions -------------------------------------------
    // The editor is a plain textarea, so every action rewrites markdown source
    // and restores the caret/selection, which also makes it undoable with ⌘Z.
    let mdSavedText = input.value

    function mdDirty () {
      if (!input.value.trim()) return false
      return !(mdFilePath && mdSavedText === input.value)
    }
    function mdUpdateDirty () {
      const dot = document.querySelector('#md-dirty')
      if (dot) dot.hidden = !mdDirty()
    }
    function mdCloseMenus () {
      for (const menu of document.querySelectorAll('#md-toolbar .md-menu[open]')) menu.removeAttribute('open')
    }
    function mdTouch () {
      render()
      mdUpdateDirty()
      mdPersist()
    }
    function mdReplace (from, to, text, selFrom, selTo) {
      const value = input.value
      input.value = value.slice(0, from) + text + value.slice(to)
      const start = selFrom === undefined ? from + text.length : selFrom
      const end = selTo === undefined ? start : selTo
      input.focus()
      input.setSelectionRange(start, end)
      mdTouch()
    }
    function mdLineRange () {
      const text = input.value
      const start = input.selectionStart
      const end = input.selectionEnd
      const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      let lineEnd = text.indexOf('\n', end)
      if (lineEnd === -1) lineEnd = text.length
      return { text, start, end, lineStart, lineEnd, block: text.slice(lineStart, lineEnd) }
    }
    function mdWrapInline (kind) {
      const marks = {
        bold: ['**', '**', '加粗文本'],
        italic: ['*', '*', '斜体文本'],
        strike: ['~~', '~~', '删除文本'],
        code: ['`', '`', 'code']
      }
      const spec = marks[kind]
      if (!spec) return
      const [before, after, placeholder] = spec
      const { start, end } = { start: input.selectionStart, end: input.selectionEnd }
      const selected = input.value.slice(start, end)
      const outerBefore = input.value.slice(Math.max(0, start - before.length), start)
      const outerAfter = input.value.slice(end, end + after.length)
      if (selected && outerBefore === before && outerAfter === after) {
        mdReplace(start - before.length, end + after.length, selected)
        return
      }
      const body = selected || placeholder
      mdReplace(start, end, before + body + after, start + before.length, start + before.length + body.length)
    }
    function mdHeading (level) {
      const { lineStart, lineEnd, block } = mdLineRange()
      const prefix = '#'.repeat(level) + ' '
      const lines = block.split('\n')
      const all = lines.every((line) => line.startsWith(prefix))
      const next = lines.map((line) => {
        const stripped = line.replace(/^#{1,6}\s+/, '')
        return all ? stripped : prefix + stripped
      }).join('\n')
      mdReplace(lineStart, lineEnd, next, lineStart, lineStart + next.length)
    }
    function mdLinePrefix (kind) {
      const { lineStart, lineEnd, block } = mdLineRange()
      const lines = block.split('\n')
      let next
      if (kind === 'ol') {
        const all = lines.every((line) => /^\d+\.\s/.test(line))
        next = lines.map((line, i) => (all ? line.replace(/^\d+\.\s/, '') : `${i + 1}. ${line.replace(/^\d+\.\s/, '')}`)).join('\n')
      } else {
        const prefix = { ul: '- ', task: '- [ ] ', quote: '> ' }[kind]
        if (!prefix) return
        const all = lines.every((line) => line.startsWith(prefix))
        next = lines.map((line) => (all ? line.slice(prefix.length) : prefix + line)).join('\n')
      }
      mdReplace(lineStart, lineEnd, next, lineStart, lineStart + next.length)
    }
    function mdInsertBlock (kind) {
      const NL = String.fromCharCode(10)
      const pad = (n) => String(n).padStart(2, '0')
      const now = new Date()
      const stamp = {
        date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        time: `${pad(now.getHours())}:${pad(now.getMinutes())}`
      }
      const start = input.selectionStart
      if (kind === 'date' || kind === 'time') {
        mdReplace(start, input.selectionEnd, stamp[kind])
        return
      }
      const blocks = {
        code: ['```', '', '```'].join(NL),
        hr: ['', '---', ''].join(NL),
        table: ['', '| 列 1 | 列 2 |', '| --- | --- |', '| 内容 | 内容 |', ''].join(NL),
        details: ['', '<details>', '<summary>标题</summary>', '', '内容', '', '</details>', ''].join(NL)
      }
      const text = blocks[kind]
      if (!text) return
      const insertAt = input.value.slice(0, start).endsWith(NL) ? start : start
      mdReplace(insertAt, input.selectionEnd, text)
    }
    function mdClearMarks () {
      const { start, end } = { start: input.selectionStart, end: input.selectionEnd }
      const hasSelection = end > start
      const value = input.value
      const from = hasSelection ? start : 0
      const to = hasSelection ? end : value.length
      const cleaned = value.slice(from, to).replace(/(\*\*|~~|`|\*)/g, '')
      mdReplace(from, to, cleaned)
    }
    function mdInsertLink () {
      const start = input.selectionStart
      const end = input.selectionEnd
      const label = input.value.slice(start, end) || tr('md.linkLabel', '链接文字')
      const text = `[${label}](https://)`
      const urlFrom = start + label.length + 3
      mdReplace(start, end, text, urlFrom, urlFrom + 8)
    }

    const mdActions = {
      'data-md-inline': (value) => mdWrapInline(value),
      'data-md-heading': (value) => mdHeading(Number(value)),
      'data-md-line': (value) => mdLinePrefix(value),
      'data-md-block': (value) => mdInsertBlock(value),
      'data-md-clear': () => mdClearMarks()
    }
    on('#md-toolbar', 'click', (event) => {
      const button = event.target.closest('button[data-md-inline], button[data-md-heading], button[data-md-line], button[data-md-block], button[data-md-clear]')
      if (!button) return
      event.preventDefault()
      for (const [attr, run] of Object.entries(mdActions)) {
        const value = button.getAttribute(attr)
        if (value !== null) { run(value); break }
      }
      mdCloseMenus()
    })
    on('#md-toolbar', 'keydown', (event) => { if (event.key === 'Escape') mdCloseMenus() })
    on('#md-tb-image', 'click', () => { pickAndInsertImage() })
    on('#md-tb-link', 'click', () => mdInsertLink())
    on('#md-tb-save', 'click', () => { saveMarkdown(false) })

    render()
    return render
  }

  // ================================================================ init
  function init () {
    if (!C) return
    wireGeneric()
    initEscape()
    initJson()
    initBase64Tool()
    window.__moziRenderMarkdown = initMarkdown()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
