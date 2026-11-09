'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

function createStore (dir) {
  const file = path.join(dir, 'data.json')
  let cache = null

  async function load () {
    if (cache) return cache
    try {
      const raw = await fsp.readFile(file, 'utf8')
      cache = JSON.parse(raw)
    } catch (err) {
      cache = null
    }
    return cache
  }

  async function save (data) {
    cache = data
    await fsp.mkdir(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await fsp.rename(tmp, file)
    return { ok: true, path: file }
  }

  function path_ () { return file }
  function exists () { return fs.existsSync(file) }

  return { load, save, path: path_, exists }
}

module.exports = { createStore }
