'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

global.window = {}
require('../src/renderer/lib/todos.js')
const Todos = global.window.Todos

const at = (iso) => new Date(`${iso}T10:00:00`)
const NOW = at('2026-11-09')

const mk = (over) => Todos.create({ title: 't', ...over }, NOW)
const withDue = (due, done) => {
  const t = Todos.create({ title: `due ${due}`, due }, NOW)
  return done ? { ...t, done: true } : t
}

test('today uses the local calendar day', () => {
  assert.equal(Todos.today(NOW), '2026-11-09')
  assert.equal(Todos.today(new Date('2026-01-01T23:30:00')), '2026-01-01')
})

test('create requires a title', () => {
  assert.throws(() => Todos.create({ title: '   ' }, NOW), /title is required/)
  assert.throws(() => Todos.create({}, NOW), /title is required/)
})

test('create defaults due to today and desc to empty', () => {
  const t = Todos.create({ title: '  写周报  ' }, NOW)
  assert.equal(t.title, '写周报')
  assert.equal(t.due, '2026-11-09')
  assert.equal(t.desc, '')
  assert.equal(t.done, false)
  assert.equal(t.doneAt, null)
  assert.equal(t.createdAt, at('2026-11-09').toISOString())
})

test('create rejects an invalid due and falls back to today', () => {
  assert.equal(Todos.create({ title: 'x', due: '2026-13-45' }, NOW).due, '2026-11-09')
  assert.equal(Todos.create({ title: 'x', due: 'not-a-date' }, NOW).due, '2026-11-09')
  assert.equal(Todos.create({ title: 'x', due: '2026-12-01' }, NOW).due, '2026-12-01')
})

test('isOverdue only counts unfinished past work', () => {
  assert.equal(Todos.isOverdue(withDue('2026-11-08'), NOW), true)
  assert.equal(Todos.isOverdue(withDue('2026-11-08', true), NOW), false)
  assert.equal(Todos.isOverdue(withDue('2026-11-09'), NOW), false)
  assert.equal(Todos.isOverdue(withDue('2026-11-10'), NOW), false)
})

test('daysUntil counts calendar days in both directions', () => {
  assert.equal(Todos.daysUntil('2026-11-09', NOW), 0)
  assert.equal(Todos.daysUntil('2026-11-12', NOW), 3)
  assert.equal(Todos.daysUntil('2026-11-01', NOW), -8)
  assert.ok(Number.isNaN(Todos.daysUntil('nope', NOW)))
})

test('monthKey works for strings and todo objects', () => {
  assert.equal(Todos.monthKey('2026-11-09'), '2026-11')
  assert.equal(Todos.monthKey({ due: '2026-12-31' }), '2026-12')
  assert.equal(Todos.monthKey({ due: 'bad' }), '')
})

test('group puts this month and future work in current', () => {
  const g = Todos.group([withDue('2026-11-09'), withDue('2026-11-30'), withDue('2027-01-05')], NOW)
  assert.equal(g.current.length, 3)
  assert.deepEqual(g.overdue, [])
  assert.deepEqual(g.archived, [])
})

test('group keeps an unfinished past-month task overdue instead of archiving it', () => {
  const past = withDue('2026-10-20')
  const g = Todos.group([past], NOW)
  assert.deepEqual(g.overdue.map((t) => t.id), [past.id])
  assert.deepEqual(g.archived, [], 'an overdue task must not be hidden in the archive')
})

test('group archives finished past-month work, newest month first', () => {
  const sep = withDue('2026-09-10', true)
  const oct = withDue('2026-10-05', true)
  const oct2 = withDue('2026-10-20', true)
  const g = Todos.group([sep, oct2, oct], NOW)
  assert.deepEqual(g.archived.map((m) => m.month), ['2026-10', '2026-09'])
  assert.deepEqual(g.archived[0].items.map((t) => t.due), ['2026-10-05', '2026-10-20'])
  assert.deepEqual(g.current, [])
})

test('group never duplicates a todo across buckets', () => {
  const list = [
    withDue('2026-09-01', true), withDue('2026-10-01', true), withDue('2026-10-02'),
    withDue('2026-11-09'), withDue('2026-11-20'), withDue('2027-02-01', true),
    withDue('2026-11-05')
  ]
  const g = Todos.group(list, NOW)
  const ids = [...g.overdue, ...g.current, ...g.archived.flatMap((m) => m.items)].map((t) => t.id)
  assert.equal(ids.length, list.length)
  assert.equal(new Set(ids).size, list.length)
})

test('group sorts current open work before finished work', () => {
  const done = withDue('2026-11-02', true)
  const open = withDue('2026-11-20')
  const g = Todos.group([done, open], NOW)
  assert.deepEqual(g.current.map((t) => t.id), [open.id, done.id])
})

test('group sorts by due date inside a bucket', () => {
  const a = withDue('2026-11-20')
  const b = withDue('2026-11-09')
  const g = Todos.group([a, b], NOW)
  assert.deepEqual(g.current.map((t) => t.due), ['2026-11-09', '2026-11-20'])
})

test('group separates this month past-due work into overdue', () => {
  const early = withDue('2026-11-02')
  const g = Todos.group([early], NOW)
  assert.deepEqual(g.overdue.map((t) => t.id), [early.id])
  assert.deepEqual(g.current, [])
})

test('group handles empty and malformed input', () => {
  assert.deepEqual(Todos.group([], NOW), { overdue: [], current: [], archived: [] })
  assert.deepEqual(Todos.group(null, NOW), { overdue: [], current: [], archived: [] })
  const odd = { ...withDue('2026-11-09'), due: 'garbage' }
  assert.equal(Todos.group([odd], NOW).current.length, 1, 'a broken due date stays visible')
})

test('group spans a year boundary', () => {
  const dec = withDue('2026-12-31')
  const jan = withDue('2027-01-01')
  const g = Todos.group([dec, jan], at('2026-12-15'))
  assert.deepEqual(g.current.map((t) => t.due), ['2026-12-31', '2027-01-01'])
})

test('toggle flips done and records when', () => {
  const t = Todos.create({ title: 'x' }, NOW)
  const done = Todos.toggle(t, NOW)
  assert.equal(done.done, true)
  assert.equal(done.doneAt, at('2026-11-09').toISOString())
  assert.equal(t.done, false, 'the input object must not be mutated')
  const reopened = Todos.toggle(done, NOW)
  assert.equal(reopened.done, false)
  assert.equal(reopened.doneAt, null)
})

test('reschedule and update return new objects', () => {
  const t = Todos.create({ title: 'x', due: '2026-11-09' }, NOW)
  const moved = Todos.reschedule(t, '2026-12-24', NOW)
  assert.equal(moved.due, '2026-12-24')
  assert.equal(t.due, '2026-11-09')
  const edited = Todos.update(t, { title: '  y  ', desc: ' note ' }, NOW)
  assert.equal(edited.title, 'y')
  assert.equal(edited.desc, 'note')
  assert.equal(t.title, 'x')
})

test('update rejects an empty title and ignores a bad due', () => {
  const t = Todos.create({ title: 'x', due: '2026-11-09' }, NOW)
  assert.throws(() => Todos.update(t, { title: ' ' }, NOW), /title is required/)
  assert.equal(Todos.update(t, { due: 'nope' }, NOW).due, '2026-11-09')
})

test('stats counts every bucket', () => {
  const list = [
    withDue('2026-10-01'), withDue('2026-10-02', true),
    withDue('2026-11-09'), withDue('2026-11-10', true)
  ]
  assert.deepEqual(Todos.stats(list, NOW), { total: 4, open: 2, overdue: 1, done: 2 })
  assert.deepEqual(Todos.stats([], NOW), { total: 0, open: 0, overdue: 0, done: 0 })
})
