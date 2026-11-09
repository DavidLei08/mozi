'use strict'

/**
 * Draggable split panes for Mozi.
 *
 * Two entry points:
 *   Split.auto()                       wires every [data-split] container
 *   Split.handle({ first, second, ...}) wires one explicit handle element
 *
 * Sizes persist in localStorage (per app profile), double-click resets,
 * and a focused handle responds to arrow keys.
 */
window.Split = (function () {
  const NS = 'mozi.split.'
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

  function read (key) {
    try {
      const raw = localStorage.getItem(NS + key)
      if (raw === null) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    } catch { return null }
  }

  function write (key, value) {
    try { localStorage.setItem(NS + key, String(value)) } catch { /* private mode */ }
  }

  function makeHandle (axis) {
    const h = document.createElement('div')
    h.className = `split-handle is-${axis}`
    h.tabIndex = 0
    h.setAttribute('role', 'separator')
    h.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal')
    return h
  }

  /**
   * @param {object} o
   * @param {HTMLElement} o.first   pane sized by the drag
   * @param {HTMLElement} o.second  the flexible sibling
   * @param {HTMLElement} o.handle  the drag bar (must already be in the layout)
   * @param {'x'|'y'} o.axis        x = side by side, y = stacked
   * @param {string} o.storageKey
   * @param {'pct'|'px'} [o.unit]
   * @param {number} [o.def]        default size in the chosen unit
   * @param {number} [o.min]        pct mode: minimum percent
   * @param {number} [o.max]        pct mode: maximum percent
   * @param {number} [o.minFirst]   px mode: minimum pixels for the first pane
   * @param {number} [o.minSecond]  px mode: pixels reserved for the second pane
   */
  function handle (o) {
    const st = Object.assign({
      unit: 'pct', def: 50, min: 15, max: 85, minFirst: 200, minSecond: 360
    }, o)
    if (!st.first || !st.second || !st.handle) return null
    if (st.first.__moziSplit) return st.first.__moziSplit
    st.first.__moziSplit = st

    let current = 0
    let dragging = false
    let rect = null

    function available () {
      if (!rect) return 0
      return st.axis === 'x' ? rect.width : rect.height
    }

    function apply (value) {
      current = value
      if (st.unit === 'px') st.first.style.width = `${Math.round(value)}px`
      else st.first.style.flex = `0 0 ${value.toFixed(2)}%`
      st.handle.setAttribute('aria-valuenow', String(Math.round(value)))
    }

    function bounds () {
      const span = available()
      if (st.unit === 'px') {
        // A hidden panel measures 0 (e.g. the HTTP view is not the active one
        // right after a reload). Treat the upper bound as unbounded then and
        // re-clamp once the container gets real size via the observer below.
        if (span <= 0) return [st.minFirst, Number.POSITIVE_INFINITY]
        return [st.minFirst, Math.max(st.minFirst, span - st.minSecond)]
      }
      return [st.min, st.max]
    }

    // The flexible sibling may be hidden (e.g. the response pane swaps with the
    // stream pane), so measure against whichever sibling actually has size.
    function secondEl () {
      const list = Array.isArray(st.second) ? st.second : [st.second]
      for (const el of list) {
        const r = el.getBoundingClientRect()
        if ((st.axis === 'x' ? r.width : r.height) > 0) return el
      }
      return list[0]
    }

    function measure () {
      const a = st.first.getBoundingClientRect()
      const b = secondEl().getBoundingClientRect()
      const span = st.axis === 'x' ? b.right - a.left : b.bottom - a.top
      rect = st.axis === 'x'
        ? { left: a.left, width: span, height: 0 }
        : { left: a.top, width: 0, height: span }
      if (span <= 0) {
        // Nothing measurable yet (hidden panel): fall back to the container.
        const parent = st.first.parentElement
        if (parent) {
          const pr = parent.getBoundingClientRect()
          rect = st.axis === 'x'
            ? { left: pr.left, width: pr.width, height: 0 }
            : { left: pr.top, width: 0, height: pr.height }
        }
      }
    }

    function setFromPointer (clientPos) {
      measure()
      const span = available()
      if (span <= 0) return
      const offset = clientPos - (st.axis === 'x' ? rect.left : rect.left)
      if (st.unit === 'px') {
        const [lo, hi] = bounds()
        apply(clamp(offset, lo, hi))
      } else {
        apply(clamp((offset / span) * 100, st.min, st.max))
      }
    }

    function onDown (e) {
      if (e.button !== undefined && e.button !== 0) return
      dragging = true
      e.preventDefault()
      measure()
      document.body.classList.add('is-dragging', `is-dragging-${st.axis}`)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    function onMove (e) {
      if (!dragging) return
      e.preventDefault()
      setFromPointer(st.axis === 'x' ? e.clientX : e.clientY)
    }

    function onUp () {
      if (!dragging) return
      dragging = false
      document.body.classList.remove('is-dragging', `is-dragging-${st.axis}`)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      write(st.storageKey, current)
    }

    st.handle.addEventListener('pointerdown', onDown)
    st.handle.addEventListener('dblclick', () => {
      try { localStorage.removeItem(NS + st.storageKey) } catch { /* ignore */ }
      apply(st.def)
    })
    st.handle.addEventListener('keydown', (e) => {
      const step = st.unit === 'px' ? 24 : 2
      let next = null
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = current - (st.unit === 'px' ? step : step)
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = current + step
      else if (e.key === 'Home') next = st.unit === 'px' ? st.minFirst : st.min
      else if (e.key === 'End') next = st.unit === 'px' ? st.minFirst : st.max
      if (next === null) return
      e.preventDefault()
      measure()
      const [lo, hi] = bounds()
      apply(clamp(next, lo, hi))
      write(st.storageKey, current)
    })

    // Re-clamp once the container actually has size: on a reload the HTTP view
    // may still be hidden, so the first pass cannot know the real bounds.
    function reconcile () {
      measure()
      const span = available()
      if (span <= 0) return
      const [lo, hi] = bounds()
      if (current < lo || current > hi) apply(clamp(current, lo, hi))
    }

    if (typeof ResizeObserver === 'function') {
      const parent = st.first.parentElement
      if (parent) new ResizeObserver(() => reconcile()).observe(parent)
    }
    window.addEventListener('resize', reconcile)

    // initial size: stored value when sane, otherwise the default
    measure()
    const stored = read(st.storageKey)
    const [lo, hi] = bounds()
    apply(stored === null ? st.def : clamp(stored, lo, hi))

    return st
  }

  function auto (scope) {
    for (const root of (scope || document).querySelectorAll('[data-split]')) {
      if (root.__moziSplitAuto) continue
      root.__moziSplitAuto = true
      const axis = root.dataset.split
      const kids = Array.from(root.children).filter((c) => c.nodeType === 1 && !c.classList.contains('split-handle'))
      if (kids.length !== 2) continue
      const bar = makeHandle(axis)
      root.insertBefore(bar, kids[1])
      handle({
        first: kids[0],
        second: kids[1],
        handle: bar,
        axis,
        unit: root.dataset.splitUnit || 'pct',
        storageKey: root.dataset.splitKey || `${axis}:${kids[0].className}`,
        def: Number(root.dataset.splitDef || (root.dataset.splitUnit === 'px' ? 292 : 50)),
        minFirst: Number(root.dataset.splitMin || 200),
        minSecond: Number(root.dataset.splitReserve || 360)
      })
    }
  }

  return { auto, handle, makeHandle }
})()
