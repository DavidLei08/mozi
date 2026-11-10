'use strict';

/**
 * Todo logic for Mozi — no DOM, no storage, no i18n. The renderer owns wording;
 * this module only produces and classifies data so it can be unit tested.
 *
 * Dates are plain 'YYYY-MM-DD' strings in the local time zone; comparing them
 * lexicographically is therefore also chronological (including across years).
 */
(function (root) {
  const DAY_MS = 86400000
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

  const pad = (n) => String(n).padStart(2, '0')
  const asDate = (now) => (now instanceof Date ? new Date(now.getTime()) : new Date(now == null ? Date.now() : now))
  const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

  function isDateString (value) {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return false
    const parsed = new Date(`${value}T00:00:00`)
    return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value
  }

  function uid () {
    return `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  /** Local 'YYYY-MM-DD' for the given moment. */
  function today (now) {
    return isoDate(asDate(now))
  }

  /** 'YYYY-MM' of a due string — or of a todo object. */
  function monthKey (value) {
    const due = typeof value === 'string' ? value : (value && value.due)
    return isDateString(due) ? due.slice(0, 7) : ''
  }

  /** Whole days from today until due: 0 today, negative when past, NaN if invalid. */
  function daysUntil (due, now) {
    if (!isDateString(due)) return NaN
    const base = asDate(now)
    base.setHours(0, 0, 0, 0)
    return Math.round((new Date(`${due}T00:00:00`) - base) / DAY_MS)
  }

  function create (input, now) {
    const source = input || {}
    const title = String(source.title == null ? '' : source.title).trim()
    if (!title) throw new Error('title is required')
    const stamp = asDate(now).toISOString()
    return {
      id: uid(),
      title,
      desc: String(source.desc == null ? '' : source.desc).trim(),
      due: isDateString(source.due) ? source.due : today(now),
      done: false,
      doneAt: null,
      createdAt: stamp,
      updatedAt: stamp
    }
  }

  function update (todo, patch, now) {
    const next = { ...todo, ...(patch || {}) }
    if (patch && patch.title !== undefined) {
      const title = String(patch.title == null ? '' : patch.title).trim()
      if (!title) throw new Error('title is required')
      next.title = title
    }
    if (patch && patch.desc !== undefined) next.desc = String(patch.desc == null ? '' : patch.desc).trim()
    if (patch && patch.due !== undefined) next.due = isDateString(patch.due) ? patch.due : todo.due
    next.updatedAt = asDate(now).toISOString()
    return next
  }

  function toggle (todo, now) {
    const done = !todo.done
    return {
      ...todo,
      done,
      doneAt: done ? asDate(now).toISOString() : null,
      updatedAt: asDate(now).toISOString()
    }
  }

  function reschedule (todo, due, now) {
    const next = { ...todo }
    if (isDateString(due)) next.due = due
    next.updatedAt = asDate(now).toISOString()
    return next
  }

  function isOverdue (todo, now) {
    return !todo.done && daysUntil(todo.due, now) < 0
  }

  function sortByDue (list) {
    return list.slice().sort((a, b) => {
      if (a.due !== b.due) return a.due < b.due ? -1 : 1
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
      return 0
    })
  }

  /**
   * Split todos into the three buckets the UI shows.
   *
   * Precedence is overdue -> archived -> current, and every todo lands in
   * exactly one bucket: an unfinished task from a past month is overdue (so it
   * stays visible) rather than archived, while finished past-month work files
   * itself away.
   */
  function group (todos, now) {
    const list = Array.isArray(todos) ? todos : []
    const thisMonth = monthKey(today(now))
    const overdue = []
    const current = []
    const archived = new Map()

    for (const todo of list) {
      if (!todo) continue
      if (isOverdue(todo, now)) { overdue.push(todo); continue }
      const key = monthKey(todo)
      if (key && key < thisMonth) {
        if (!archived.has(key)) archived.set(key, [])
        archived.get(key).push(todo)
        continue
      }
      current.push(todo)
    }

    const open = sortByDue(current.filter((t) => !t.done))
    const done = sortByDue(current.filter((t) => t.done))

    return {
      overdue: sortByDue(overdue),
      current: open.concat(done),
      archived: [...archived.keys()].sort().reverse().map((month) => ({
        month,
        items: sortByDue(archived.get(month))
      }))
    }
  }

  function stats (todos, now) {
    const list = (Array.isArray(todos) ? todos : []).filter(Boolean)
    return {
      total: list.length,
      open: list.filter((t) => !t.done).length,
      overdue: list.filter((t) => isOverdue(t, now)).length,
      done: list.filter((t) => t.done).length
    }
  }

  const Todos = {
    today, create, update, toggle, reschedule, isOverdue, daysUntil,
    monthKey, group, stats, isDateString, sortByDue
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = Todos
  if (root) root.Todos = Todos
})(typeof window !== 'undefined' ? window : null)
