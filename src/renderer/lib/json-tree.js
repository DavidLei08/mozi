'use strict'

/**
 * Minimal, dependency-free JSON tree renderer for the response pane.
 * Builds DOM nodes (no innerHTML with user data) with collapse/expand.
 */
window.JsonTree = (function () {
  const MAX_CHILDREN = 5000

  function typeOf (value) {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    return typeof value
  }

  function preview (value) {
    const t = typeOf(value)
    if (t === 'array') return `[${value.length}]`
    if (t === 'object') {
      const keys = Object.keys(value)
      const head = keys.slice(0, 4).join(', ')
      return `{${head}${keys.length > 4 ? ', …' : ''}}`
    }
    return ''
  }

  function primitive (value) {
    const t = typeOf(value)
    const span = document.createElement('span')
    if (t === 'string') {
      const shown = value.length > 400 ? `${value.slice(0, 400)}…` : value
      span.className = 'jt-str'
      span.textContent = JSON.stringify(shown)
      if (value.length > 400) span.title = 'truncated for display'
    } else if (t === 'number') {
      span.className = 'jt-num'
      span.textContent = String(value)
    } else if (t === 'boolean') {
      span.className = 'jt-bool'
      span.textContent = String(value)
    } else {
      span.className = 'jt-null'
      span.textContent = 'null'
    }
    return span
  }

  function buildRow (key, value, depth, opts) {
    const row = document.createElement('div')
    row.className = 'jt-row'

    const t = typeOf(value)
    const isContainer = t === 'object' || t === 'array'

    const toggle = document.createElement('span')
    toggle.className = 'jt-toggle'
    row.appendChild(toggle)

    if (key !== undefined) {
      const k = document.createElement('span')
      k.className = 'jt-key'
      k.textContent = typeof key === 'number' ? key : key
      row.appendChild(k)
      const colon = document.createElement('span')
      colon.className = 'jt-colon'
      colon.textContent = ':'
      row.appendChild(colon)
    }

    if (!isContainer) {
      row.appendChild(primitive(value))
      return row
    }

    const open = t === 'array' ? '[' : '{'
    const close = t === 'array' ? ']' : '}'
    const punc = document.createElement('span')
    punc.className = 'jt-punc'
    punc.textContent = open
    row.appendChild(punc)

    const previewEl = document.createElement('span')
    previewEl.className = 'jt-preview'
    previewEl.textContent = ` ${preview(value)} `
    row.appendChild(previewEl)

    const closePunc = document.createElement('span')
    closePunc.className = 'jt-punc'
    closePunc.textContent = close
    row.appendChild(closePunc)

    const children = document.createElement('div')
    children.className = 'jt-children'

    const entries = t === 'array'
      ? value.map((v, i) => [i, v])
      : Object.entries(value)

    if (entries.length === 0) {
      previewEl.textContent = ''
      return row
    }

    const collapsed = opts && opts.expandDepth !== undefined
      ? depth >= opts.expandDepth
      : entries.length > 12 && depth > 0
    if (collapsed) previewEl.textContent = ` ${preview(value)} `

    for (const [k, v] of entries.slice(0, MAX_CHILDREN)) {
      children.appendChild(buildRow(k, v, depth + 1, opts))
    }
    if (entries.length > MAX_CHILDREN) {
      const more = document.createElement('div')
      more.className = 'jt-preview'
      more.textContent = `… ${entries.length - MAX_CHILDREN} more`
      children.appendChild(more)
    }

    const node = document.createElement('div')
    node.className = collapsed ? 'jt-collapsed' : ''
    node.appendChild(row)
    node.appendChild(children)

    toggle.textContent = collapsed ? '▸' : '▾'
    toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      const isCollapsed = node.classList.toggle('jt-collapsed')
      toggle.textContent = isCollapsed ? '▸' : '▾'
    })

    return node
  }

  function render (value, container, opts) {
    container.textContent = ''
    const root = document.createElement('div')
    root.className = 'jt'
    root.appendChild(buildRow(undefined, value, 0, opts || { expandDepth: 2 }))
    container.appendChild(root)
  }

  return { render }
})()
