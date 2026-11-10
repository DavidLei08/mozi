'use strict'

/**
 * Mozi toolbox views: the rich-text notepad and the todo list.
 * Pure logic lives in lib/notepad.js and lib/todos.js; this file only wires it
 * to the DOM and to the store owned by app.js.
 */
;(function () {
  const api = window.api
  // translation helper: dictionary lookup, falling back to the Chinese source
  const tr = (key, fallback) => (window.I18N && window.I18N.t) ? window.I18N.t(key, fallback) : fallback
  const $ = (sel) => document.querySelector(sel)

  function bridge () { return window.__moziData }
  const data = {
    notes: () => bridge().notes(),
    setNotes: (list) => bridge().setNotes(list),
    notesUI: () => bridge().notesUI(),
    todos: () => bridge().todos(),
    setTodos: (list) => bridge().setTodos(list),
    todosUI: () => bridge().todosUI()
  }

  function uid (prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  function debounce (fn, ms) {
    let timer = null
    return (...args) => {
      clearTimeout(timer)
      timer = setTimeout(() => fn(...args), ms)
    }
  }

  function toast (message) {
    if (typeof window.__moziToast === 'function') window.__moziToast(message)
  }

  function lang () {
    return (window.I18N && window.I18N.get) ? window.I18N.get() : 'zh'
  }

  function stamp (iso) {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  function el (tag, cls, text) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined && text !== null) node.textContent = text
    return node
  }

  // ================================================================ notepad
  const NP = window.Notepad

  function initNotepad () {
    const list = $('#np-list')
    const editor = $('#np-editor')
    const titleEl = $('#np-title')
    const metaEl = $('#np-meta')
    const countEl = $('#np-count')
    if (!list || !editor || !NP) return

    let composing = false

    function all () { return data.notes() }
    function active () {
      const ui = data.notesUI()
      let note = all().find((n) => n.id === ui.activeId)
      if (!note) {
        note = all()[0]
        if (!note) {
          note = NP.emptyNote()
          data.setNotes([note])
        }
        ui.activeId = note.id
      }
      return note
    }

    function patch (id, changes) {
      data.setNotes(all().map((n) => (n.id === id ? { ...n, ...changes, updatedAt: new Date().toISOString() } : n)))
    }

    // With no hand-written title the field stays empty, so the placeholder
    // previews what the list will show (the first line of the body).
    function syncTitleHint (html) {
      const derived = NP.titleFrom(html === undefined ? editor.innerHTML : html, '')
      titleEl.placeholder = derived || tr('np.untitled', '未命名')
    }

    function showTitle (note) {
      titleEl.value = note.title || ''
      syncTitleHint(note.html)
    }

    function renderList () {
      const notes = all().slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      const ui = data.notesUI()
      list.textContent = ''
      for (const note of notes) {
        const item = el('button', 'np-item' + (note.id === ui.activeId ? ' is-active' : ''))
        item.type = 'button'
        item.appendChild(el('span', 'np-item-title', note.title || NP.titleFrom(note.html, tr('np.untitled', '未命名'))))
        const preview = NP.plainText(note.html)
        item.appendChild(el('span', 'np-item-sub', preview ? `${stamp(note.updatedAt)} · ${preview.slice(0, 40)}` : stamp(note.updatedAt)))
        item.addEventListener('click', () => select(note.id))
        list.appendChild(item)
      }
      countEl.textContent = notes.length ? String(notes.length) : ''
    }

    function select (id) {
      data.notesUI().activeId = id
      const note = active()
      editor.innerHTML = NP.sanitize(note.html)
      showTitle(note)
      const words = NP.wordCount(note.html)
      metaEl.textContent = tr('np.meta', '{time} · {chars} 字 · {words} 词')
        .replace('{time}', stamp(note.updatedAt))
        .replace('{chars}', String(words.chars))
        .replace('{words}', String(words.words))
      renderList()
    }

    const persist = debounce(() => {
      const note = active()
      const html = NP.sanitize(editor.innerHTML)
      const changes = { html }
      // a hand-typed title wins; otherwise fall back to the first body line
      if (!note.titleEdited) changes.title = NP.titleFrom(html, '')
      patch(note.id, changes)
      syncTitleHint(html)
      const words = NP.wordCount(html)
      metaEl.textContent = tr('np.meta', '{time} · {chars} 字 · {words} 词')
        .replace('{time}', stamp(new Date().toISOString()))
        .replace('{chars}', String(words.chars))
        .replace('{words}', String(words.words))
      renderList()
    }, 350)

    const saveTitle = debounce(() => {
      const note = active()
      const value = titleEl.value.trim()
      patch(note.id, { title: value, titleEdited: value.length > 0 })
      syncTitleHint(editor.innerHTML)
      renderList()
    }, 250)

    titleEl.addEventListener('input', saveTitle)
    titleEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); editor.focus() }
    })

    editor.addEventListener('input', () => { if (!composing) persist() })
    editor.addEventListener('compositionstart', () => { composing = true })
    editor.addEventListener('compositionend', () => { composing = false; persist() })

    // formatting commands
    function exec (cmd, value) {
      editor.focus()
      try { document.execCommand(cmd, false, value) } catch { /* older engines */ }
      persist()
    }
    function formatBlock (tag) {
      editor.focus()
      try { document.execCommand('formatBlock', false, tag) } catch { /* ignore */ }
      persist()
    }

    $('#np-toolbar').addEventListener('click', (event) => {
      const cmdBtn = event.target.closest('[data-np-cmd]')
      if (cmdBtn) {
        const cmd = cmdBtn.dataset.npCmd
        if (cmd === 'createLink') { askLink(); return }
        exec(cmd)
        return
      }
      const blockBtn = event.target.closest('[data-np-block]')
      if (blockBtn) formatBlock(blockBtn.dataset.npBlock)
    })

    // link: asked inline (Electron has no window.prompt)
    function askLink () {
      const existing = $('#np-link-row')
      if (existing) { existing.remove(); return }
      const row = el('div', 'td-form-row')
      row.id = 'np-link-row'
      const input = el('input', 'td-input')
      input.type = 'url'
      input.placeholder = tr('np.linkPlaceholder', 'https://example.com')
      const ok = el('button', 'btn-primary', tr('np.applyLink', '插入链接'))
      ok.type = 'button'
      const cancel = el('button', 'btn-secondary', tr('btn.cancel', '取消'))
      cancel.type = 'button'
      cancel.addEventListener('click', () => row.remove())
      ok.addEventListener('click', () => {
        const url = input.value.trim()
        row.remove()
        if (!/^https?:|^mailto:|^file:/i.test(url)) { toast(tr('np.badLink', '请输入 http(s) 链接')); return }
        editor.focus()
        const selection = window.getSelection()
        if (selection && selection.isCollapsed) document.execCommand('insertHTML', false, `<a href="${url}">${url}</a>`)
        else document.execCommand('createLink', false, url)
        persist()
      })
      row.append(input, ok, cancel)
      $('#np-toolbar').after(row)
      input.focus()
    }

    function insertImage (dataUrl, name) {
      editor.focus()
      const html = NP.insertImage(editor.innerHTML, dataUrl, name || '')
      editor.innerHTML = NP.sanitize(html)
      persist()
    }

    // Images come from three places: the file picker, a clipboard blob, or a path
    // copied in Finder. All of them end up here so failures are always reported
    // instead of silently doing nothing.
    const IMAGE_EXT_MIME = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
      ico: 'image/x-icon', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff'
    }
    function imageMimeFor (mime, filePath) {
      if (mime && /^image\//i.test(mime) && mime !== 'image/heic' && mime !== 'image/heif') return mime
      const ext = String(filePath || '').toLowerCase().split('.').pop()
      return IMAGE_EXT_MIME[ext] || ''
    }
    function localPathFromText (text) {
      const raw = String(text || '').trim().split(/[\r\n]/)[0]
      if (!raw) return ''
      if (raw.startsWith('file://')) {
        try { return decodeURIComponent(new URL(raw).pathname) } catch { return '' }
      }
      return raw.startsWith('/') ? raw : ''
    }
    async function insertImageFromDisk (filePath, label) {
      if (!filePath) return false
      try {
        const result = await api.files.readBase64(filePath)
        if (!result || !result.ok) {
          toast(`${tr('img.readFailed', '读取图片失败')}: ${(result && result.error) || filePath}`)
          return false
        }
        const mime = imageMimeFor(result.mime, filePath)
        if (!mime) {
          toast(tr('img.unsupported', '不支持的图片格式（请用 PNG / JPEG / GIF / WebP / BMP）'))
          return false
        }
        insertImage(`data:${mime};base64,${result.base64}`, label || result.name || '')
        toast(tr('img.inserted', '图片已插入'))
        return true
      } catch (err) {
        toast(`${tr('img.readFailed', '读取图片失败')}: ${err && err.message ? err.message : err}`)
        return false
      }
    }

    $('#np-image').addEventListener('click', async () => {
      let files = []
      try {
        files = await api.files.pick()
      } catch (err) {
        toast(`${tr('img.readFailed', '读取图片失败')}: ${err && err.message ? err.message : err}`)
        return
      }
      if (!files || !files[0]) return
      await insertImageFromDisk(files[0].path, files[0].name)
    })
    $('#np-tb-image').addEventListener('click', () => $('#np-image').click())

    // paste or drop an image straight into the note
    function insertBlob (file, label) {
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => {
          insertImage(String(reader.result), label)
          toast(tr('img.inserted', '图片已插入'))
          resolve(true)
        }
        reader.onerror = () => { toast(tr('img.readFailed', '读取图片失败')); resolve(false) }
        reader.readAsDataURL(file)
      })
    }

    editor.addEventListener('paste', async (event) => {
      const clip = event.clipboardData
      if (!clip) return
      // 1) a real image on the clipboard (screenshot, "copy image" in a browser)
      const items = Array.from(clip.items || [])
      const imageItem = items.find((item) => item.type && item.type.startsWith('image/'))
      const blob = imageItem ? imageItem.getAsFile() : (clip.files && clip.files[0] ? clip.files[0] : null)
      if (blob && blob.type && blob.type.startsWith('image/')) {
        event.preventDefault()
        await insertBlob(blob, tr('np.pasted', '粘贴的图片'))
        return
      }
      // 2) a file copied in Finder: the clipboard carries its path, not the bitmap
      const asText = clip.getData('text/uri-list') || clip.getData('text/plain')
      const localPath = localPathFromText(asText)
      if (localPath && /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|avif|ico)$/i.test(localPath)) {
        event.preventDefault()
        await insertImageFromDisk(localPath)
        return
      }
      if (/^image\//i.test(String(clip.types ? Array.from(clip.types).join(',') : ''))) {
        event.preventDefault()
        toast(tr('img.unsupported', '不支持的图片格式（请用 PNG / JPEG / GIF / WebP / BMP）'))
      }
    })
    editor.addEventListener('dragover', (event) => { event.preventDefault() })
    editor.addEventListener('drop', async (event) => {
      const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null
      if (!file || !file.type.startsWith('image/')) return
      event.preventDefault()
      const reader = new FileReader()
      reader.onload = () => { insertImage(String(reader.result), file.name); toast(tr('img.inserted', '图片已插入')) }
      reader.readAsDataURL(file)
    })

    $('#np-new').addEventListener('click', () => {
      const note = NP.emptyNote()
      data.setNotes([note, ...all()])
      select(note.id)
      editor.focus()
    })

    $('#np-delete').addEventListener('click', (event) => {
      const button = event.currentTarget
      const target = active()
      if (button.dataset.armed !== target.id) {
        button.dataset.armed = target.id
        button.textContent = tr('np.deleteConfirm', '再点一次删除')
        setTimeout(() => { button.dataset.armed = ''; button.textContent = tr('np.delete', '删除笔记') }, 3000)
        return
      }
      const rest = all().filter((n) => n.id !== target.id)
      data.setNotes(rest)
      button.dataset.armed = ''
      button.textContent = tr('np.delete', '删除笔记')
      data.notesUI().activeId = null
      select(active().id)
      toast(tr('np.deleted', '已删除笔记'))
    })

    $('#np-export').addEventListener('click', async () => {
      const note = active()
      const name = (note.title || 'note').replace(/[\\/:*?"<>|]/g, '_')
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body>${NP.sanitize(note.html)}</body></html>`
      const result = await api.dialog.saveText({ defaultPath: `${name}.html`, content: html })
      if (result && result.ok) toast(tr('np.exported', '已导出 HTML'))
    })

    window.__moziNotepadRender = () => select(active().id)
    // test seam: the picker's insert path without opening a native dialog
    window.__moziNotepadInsertFromFile = (filePath) => insertImageFromDisk(filePath)
    select(active().id)
  }

  // ================================================================== todos
  const TD = window.Todos

  function initTodos () {
    const form = $('#td-form')
    const titleInput = $('#td-title')
    const descInput = $('#td-desc')
    const dueInput = $('#td-due')
    const hint = $('#td-form-hint')
    const statsEl = $('#td-stats')
    if (!form || !TD) return

    let editingId = null

    function all () { return data.todos() }
    function ui () { return data.todosUI() }
    function openForm (todo) {
      editingId = todo ? todo.id : null
      form.classList.remove('hidden')
      titleInput.value = todo ? todo.title : ''
      descInput.value = todo ? todo.desc : ''
      dueInput.value = todo ? todo.due : TD.today()
      hint.textContent = ''
      titleInput.focus()
    }
    function closeForm () {
      editingId = null
      form.classList.add('hidden')
      titleInput.value = ''
      descInput.value = ''
    }

    function save (list) { data.setTodos(list) }

    function row (todo, now) {
      const overdue = TD.isOverdue(todo, now)
      const node = el('div', 'td-row' + (overdue ? ' is-overdue' : '') + (todo.done ? ' is-done' : '') + (editingId === todo.id ? ' is-editing' : ''))

      const check = el('input', 'td-check')
      check.type = 'checkbox'
      check.checked = !!todo.done
      check.title = tr('td.toggle', '标记完成')
      check.addEventListener('change', () => {
        save(all().map((t) => (t.id === todo.id ? TD.toggle(t) : t)))
        render()
      })
      node.appendChild(check)

      const main = el('div', 'td-main')
      main.appendChild(el('div', 'td-row-title', todo.title))
      if (todo.desc) main.appendChild(el('div', 'td-row-desc', todo.desc))

      const meta = el('div', 'td-meta')
      const due = el('input', 'td-due')
      due.type = 'date'
      due.value = todo.due
      due.title = tr('td.reschedule', '改期')
      due.addEventListener('change', () => {
        if (!due.value) { due.value = todo.due; return }
        save(all().map((t) => (t.id === todo.id ? TD.reschedule(t, due.value) : t)))
        render()
      })
      meta.appendChild(due)

      const days = TD.daysUntil(todo.due, now)
      const badge = el('span', 'td-badge' + (overdue ? ' td-badge-overdue' : ''))
      if (todo.done) badge.textContent = tr('td.done', '已完成')
      else if (overdue) badge.textContent = tr('td.overdueBy', '逾期 {n} 天').replace('{n}', String(Math.abs(days)))
      else if (days === 0) badge.textContent = tr('td.dueToday', '今天到期')
      else if (days === 1) badge.textContent = tr('td.dueTomorrow', '明天到期')
      else if (days > 1) badge.textContent = tr('td.dueIn', '{n} 天后').replace('{n}', String(days))
      else badge.textContent = todo.due
      meta.appendChild(badge)
      main.appendChild(meta)
      node.appendChild(main)

      const actions = el('div', 'td-actions')
      const edit = el('button', 'td-icon-btn', tr('td.edit', '编辑'))
      edit.type = 'button'
      edit.title = tr('td.edit', '编辑')
      edit.addEventListener('click', () => openForm(todo))
      actions.appendChild(edit)

      const del = el('button', 'td-icon-btn', '✕')
      del.type = 'button'
      del.title = tr('dlg.delete', '删除')
      del.addEventListener('click', () => {
        if (del.dataset.armed !== todo.id) {
          del.dataset.armed = todo.id
          del.textContent = '?'
          setTimeout(() => { del.dataset.armed = ''; del.textContent = '✕' }, 3000)
          return
        }
        save(all().filter((t) => t.id !== todo.id))
        render()
      })
      actions.appendChild(del)
      node.appendChild(actions)
      return node
    }

    function fill (container, items, now, emptyText) {
      container.textContent = ''
      if (!items.length) {
        if (emptyText) container.appendChild(el('div', 'td-empty', emptyText))
        return
      }
      for (const todo of items) container.appendChild(row(todo, now))
    }

    function monthLabel (key) {
      const [year, month] = key.split('-')
      if (lang() === 'en') {
        const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        return `${names[Number(month) - 1] || month} ${year}`
      }
      return `${year} 年 ${Number(month)} 月`
    }

    function render () {
      const now = new Date()
      const list = all()
      const hideDone = !!ui().hideDone
      const grouped = TD.group(list, now)
      const s = TD.stats(list, now)

      statsEl.textContent = ''
      const summary = [
        [tr('td.statTotal', '全部'), s.total],
        [tr('td.statOpen', '未完成'), s.open],
        [tr('td.statOverdue', '逾期'), s.overdue],
        [tr('td.statDone', '已完成'), s.done]
      ]
      for (const [label, value] of summary) {
        const item = el('span')
        item.appendChild(document.createTextNode(`${label} `))
        item.appendChild(el('b', null, String(value)))
        statsEl.appendChild(item)
      }

      const overdueSection = $('#td-overdue-section')
      const overdueItems = hideDone ? grouped.overdue.filter((t) => !t.done) : grouped.overdue
      overdueSection.classList.toggle('hidden', overdueItems.length === 0)
      fill($('#td-overdue'), overdueItems, now)

      const current = hideDone ? grouped.current.filter((t) => !t.done) : grouped.current
      fill($('#td-current'), current, now, tr('td.emptyCurrent', '本月还没有待办，点「新建待办」开始'))

      const archiveSection = $('#td-archive-section')
      const hasArchive = grouped.archived.length > 0
      archiveSection.classList.toggle('hidden', !hasArchive)
      const archiveHead = $('#td-archive-head')
      const totalArchived = grouped.archived.reduce((sum, m) => sum + m.items.length, 0)
      archiveHead.textContent = `${tr('td.archiveHeading', '归档')}（${totalArchived}）${ui().archiveOpen ? '▾' : '▸'}`
      const archiveBody = $('#td-archive')
      archiveBody.classList.toggle('hidden', !ui().archiveOpen)
      archiveBody.textContent = ''
      if (ui().archiveOpen) {
        for (const group of grouped.archived) {
          const header = el('div', 'td-month', `${monthLabel(group.month)} · ${group.items.filter((t) => t.done).length}/${group.items.length}`)
          archiveBody.appendChild(header)
          const wrap = el('div', 'td-list')
          for (const todo of group.items) {
            if (hideDone && todo.done) continue
            wrap.appendChild(row(todo, now))
          }
          archiveBody.appendChild(wrap)
        }
      }

      $('#td-archive-toggle').textContent = ui().archiveOpen
        ? tr('td.archiveHide', '收起归档')
        : tr('td.archiveToggle', '归档')
    }

    $('#td-new').addEventListener('click', () => {
      if (!form.classList.contains('hidden') && !editingId) { closeForm(); return }
      openForm(null)
    })
    $('#td-cancel').addEventListener('click', closeForm)
    $('#td-submit').addEventListener('click', () => {
      try {
        if (editingId) {
          save(all().map((t) => (t.id === editingId ? TD.update(t, { title: titleInput.value, desc: descInput.value, due: dueInput.value }) : t)))
          toast(tr('td.updated', '已更新待办'))
        } else {
          save([...all(), TD.create({ title: titleInput.value, desc: descInput.value, due: dueInput.value })])
          toast(tr('td.added', '已添加待办'))
        }
        closeForm()
        render()
      } catch (err) {
        hint.textContent = err && err.message === 'title is required' ? tr('td.titleRequired', '请填写主题') : String(err && err.message ? err.message : err)
      }
    })
    for (const input of [titleInput, descInput, dueInput]) {
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('#td-submit').click() } })
    }

    $('#td-hide-done').addEventListener('change', (event) => { ui().hideDone = event.target.checked; render() })
    $('#td-archive-toggle').addEventListener('click', () => { ui().archiveOpen = !ui().archiveOpen; render() })
    $('#td-archive-head').addEventListener('click', () => { ui().archiveOpen = !ui().archiveOpen; render() })

    window.__moziTodosRender = () => {
      $('#td-hide-done').checked = !!ui().hideDone
      render()
    }
    $('#td-hide-done').checked = !!ui().hideDone
    render()
  }

  initNotepad()
  initTodos()
})()
