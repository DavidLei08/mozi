'use strict'

/**
 * Mozi toolbox, part 2: timestamp / hash / generator / regex / jwt / codegen.
 * Kept separate from tools.js so each file stays readable.
 */
;(function () {
  const api = window.api
  // translation helper: dictionary lookup, falling back to the Chinese source
  const tr = (key, fallback) => (window.I18N && window.I18N.t) ? window.I18N.t(key, fallback) : fallback
  const C = window.Codec
  const $ = (sel, root) => (root || document).querySelector(sel)
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel))

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

  function pad (n, len = 2) { return String(n).padStart(len, '0') }

  // copy buttons that read textContent instead of .value
  function wireTextCopy () {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-copy-from-el]')
      if (!btn) return
      const src = document.getElementById(btn.dataset.copyFromEl)
      if (src) await copy(src.textContent, '内容')
    })
  }

  // ================================================================ TIMESTAMP
  function initTimestamp () {
    const input = $('#ts-input')
    const dateInput = $('#ts-date')
    const clock = $('#ts-clock')
    const zones = $('#ts-zones')
    const ZONE_LIST = [
      ['本地', undefined],
      ['UTC', 'UTC'],
      ['纽约', 'America/New_York'],
      ['伦敦', 'Europe/London'],
      ['东京', 'Asia/Tokyo'],
      ['新加坡', 'Asia/Singapore']
    ]

    function fmtIn (date, timeZone) {
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          timeZone, hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(date)
      } catch { return '—' }
    }

    function relative (ms) {
      const diff = ms - Date.now()
      const abs = Math.abs(diff)
      const units = [[86400000, '天'], [3600000, '小时'], [60000, '分钟'], [1000, '秒']]
      for (const [size, label] of units) {
        if (abs >= size) {
          const value = Math.round(abs / size)
          return `${diff < 0 ? '' : ''}${value} ${label}${diff < 0 ? '前' : '后'}`
        }
      }
      return '刚刚'
    }

    function toEpochMs (raw) {
      const text = String(raw || '').trim()
      if (!/^-?\d+$/.test(text)) return null
      const n = Number(text)
      // 10 digits => seconds, 13 => milliseconds
      return text.replace('-', '').length >= 12 ? n : n * 1000
    }

    function renderFromEpoch () {
      const ms = toEpochMs(input.value)
      const local = $('#ts-local')
      const utc = $('#ts-utc')
      const iso = $('#ts-iso')
      const rel = $('#ts-rel')
      if (ms === null) {
        local.textContent = utc.textContent = iso.textContent = rel.textContent = ''
        return
      }
      const date = new Date(ms)
      if (Number.isNaN(date.getTime())) {
        local.textContent = tr('ts.invalid', '无效时间')
        utc.textContent = iso.textContent = rel.textContent = ''
        return
      }
      local.textContent = fmtIn(date)
      utc.textContent = fmtIn(date, 'UTC')
      iso.textContent = date.toISOString()
      rel.textContent = relative(ms)
    }

    function renderFromDate () {
      const value = dateInput.value
      const sec = $('#ts-sec')
      const ms = $('#ts-ms')
      if (!value) { sec.textContent = ms.textContent = ''; return }
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return
      sec.textContent = String(Math.floor(date.getTime() / 1000))
      ms.textContent = String(date.getTime())
    }

    function renderZones (date) {
      zones.textContent = ''
      for (const [label, timeZone] of ZONE_LIST) {
        const row = el('div', 'ts-zone')
        row.appendChild(el('span', null, label))
        row.appendChild(el('span', null, fmtIn(date, timeZone)))
        zones.appendChild(row)
      }
    }

    function el (tag, cls, text) {
      const node = document.createElement(tag)
      if (cls) node.className = cls
      if (text !== undefined) node.textContent = text
      return node
    }

    function tick () {
      const now = new Date()
      clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      renderZones(now)
    }

    input.addEventListener('input', renderFromEpoch)
    dateInput.addEventListener('input', renderFromDate)
    $('#ts-now').addEventListener('click', () => {
      const now = new Date()
      input.value = String(Math.floor(now.getTime() / 1000))
      dateInput.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
      renderFromEpoch()
      renderFromDate()
      tick()
    })
    tick()
    setInterval(tick, 1000)
  }

  // ================================================================ HASH
  const ALGOS = ['md5', 'sha1', 'sha256', 'sha512']
  const ALGO_LABELS = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' }

  function hashItem (algo, hex, onCopy) {
    const item = document.createElement('div')
    item.className = 'hash-item'
    const label = document.createElement('div')
    label.className = 'algo'
    label.textContent = ALGO_LABELS[algo] || algo.toUpperCase()
    const value = document.createElement('div')
    value.className = 'value'
    const text = document.createElement('span')
    text.textContent = hex
    value.appendChild(text)
    if (onCopy) {
      const btn = document.createElement('button')
      btn.className = 'mini-icon'
      btn.title = '复制'
      btn.textContent = '⧉'
      btn.addEventListener('click', () => onCopy(hex, algo.toUpperCase()))
      value.appendChild(btn)
    }
    item.appendChild(label)
    item.appendChild(value)
    return item
  }

  function initHash () {
    const input = $('#hash-in')
    const out = $('#hash-out')
    const enc = $('#hash-enc')
    const note = $('#hash-note')

    for (const btn of $$('#hash-tabs .seg-btn')) {
      btn.addEventListener('click', () => {
        for (const b of $$('#hash-tabs .seg-btn')) b.classList.toggle('is-active', b === btn)
        for (const panel of $$('[data-hashpanel]')) panel.classList.toggle('hidden', panel.dataset.hashpanel !== btn.dataset.hashtab)
      })
    }

    async function run () {
      const text = input.value
      if (!text) { out.textContent = ''; note.textContent = tr('ts.localNote', '本地计算，不发送任何数据'); return }
      // MD5 is not available in Web Crypto, so hashing goes through the main process.
      const result = await api.hash.text({ algorithms: ALGOS, text, encoding: enc.value })
      out.textContent = ''
      if (!result.ok) {
        note.textContent = result.error
        note.style.color = 'var(--red)'
        return
      }
      note.style.color = ''
      note.textContent = `本地计算 · 输入 ${result.bytes} 字节`
      for (const algo of result.algorithms) out.appendChild(hashItem(algo, result.hashes[algo], copy))
    }

    input.addEventListener('input', debounce(run, 150))
    enc.addEventListener('change', run)
    $('#hash-copy-all').addEventListener('click', () => {
      const lines = $$('.hash-item', out).map((node) => {
        const algo = node.querySelector('.algo').textContent
        const value = node.querySelector('.value span').textContent
        return `${algo}  ${value}`
      })
      if (!lines.length) return toast(tr('gen.empty', '还没有结果'))
      copy(lines.join('\n'), '全部摘要')
    })

    $('#hash-pick').addEventListener('click', async () => {
      const result = await api.hash.files({ algorithms: ALGOS, filePaths: [] })
      const box = $('#hash-file-out')
      box.textContent = ''
      if (!result.ok || !result.results.length) {
        box.appendChild(Object.assign(document.createElement('span'), { className: 'muted', textContent: '未选择文件' }))
        return
      }
      for (const file of result.results) {
        const card = document.createElement('div')
        card.className = 'hash-file'
        const name = document.createElement('div')
        name.className = 'name'
        name.textContent = `${file.name} · ${C ? C.humanSize(file.size) : `${file.size} B`}`
        card.appendChild(name)
        if (file.error) {
          const err = document.createElement('div')
          err.className = 'rx-error'
          err.textContent = file.error
          card.appendChild(err)
        } else {
          for (const algo of result.algorithms) card.appendChild(hashItem(algo, file.hashes[algo]))
        }
        box.appendChild(card)
      }
    })
  }

  // ================================================================ GENERATOR
  function randomBytes (n) {
    const b = new Uint8Array(n)
    crypto.getRandomValues(b)
    return b
  }

  function uuidV4 () {
    const b = randomBytes(16)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  function uuidV7 () {
    const ts = Date.now()
    const b = randomBytes(16)
    b[0] = Math.floor(ts / 2 ** 40) & 0xff
    b[1] = Math.floor(ts / 2 ** 32) & 0xff
    b[2] = Math.floor(ts / 2 ** 24) & 0xff
    b[3] = Math.floor(ts / 2 ** 16) & 0xff
    b[4] = Math.floor(ts / 2 ** 8) & 0xff
    b[5] = ts & 0xff
    b[6] = (b[6] & 0x0f) | 0x70
    b[8] = (b[8] & 0x3f) | 0x80
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  function initGenerator () {
    for (const btn of $$('#gen-tabs .seg-btn')) {
      btn.addEventListener('click', () => {
        for (const b of $$('#gen-tabs .seg-btn')) b.classList.toggle('is-active', b === btn)
        for (const panel of $$('[data-genpanel]')) panel.classList.toggle('hidden', panel.dataset.genpanel !== btn.dataset.gentab)
      })
    }

    // ---- uuid
    const uuidOut = $('#uuid-out')
    function genUuid () {
      const count = Math.min(500, Math.max(1, Number($('#uuid-count').value) || 1))
      const version = $('#uuid-version').value
      const make = version === 'v7' ? uuidV7 : uuidV4
      const lines = []
      for (let i = 0; i < count; i++) {
        let value = make()
        if ($('#uuid-upper').checked) value = value.toUpperCase()
        if ($('#uuid-braces').checked) value = `{${value}}`
        lines.push(value)
      }
      uuidOut.value = lines.join('\n')
    }
    $('#uuid-gen').addEventListener('click', genUuid)
    $('#uuid-copy').addEventListener('click', () => {
      if (!uuidOut.value) return toast(tr('gen.generateFirst', '先生成'))
      copy(uuidOut.value, 'UUID')
    })
    genUuid()

    // ---- password
    const SETS = {
      upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
      lower: 'abcdefghijkmnpqrstuvwxyz',
      digit: '23456789',
      symbol: '!@#$%^&*()-_=+[]{};:,.?/'
    }
    const SETS_FULL = {
      upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      lower: 'abcdefghijklmnopqrstuvwxyz',
      digit: '0123456789',
      symbol: '!@#$%^&*()-_=+[]{}|;:,.<>/?'
    }
    const pwOut = $('#pw-out')
    const strength = $('#pw-strength')

    function genPassword () {
      const length = Math.min(128, Math.max(4, Number($('#pw-len').value) || 20))
      const count = Math.min(100, Math.max(1, Number($('#pw-count').value) || 5))
      const table = $('#pw-ambiguous').checked ? SETS_FULL : SETS
      const pools = []
      if ($('#pw-upper').checked) pools.push(table.upper)
      if ($('#pw-lower').checked) pools.push(table.lower)
      if ($('#pw-digit').checked) pools.push(table.digit)
      if ($('#pw-symbol').checked) pools.push(table.symbol)
      if (!pools.length) { toast(tr('gen.pickCharset', '至少选择一种字符')); return }

      const all = pools.join('')
      const lines = []
      for (let i = 0; i < count; i++) {
        const chars = []
        // guarantee one char from each selected pool
        for (const pool of pools) {
          const pick = randomBytes(1)[0] % pool.length
          chars.push(pool[pick])
        }
        while (chars.length < length) chars.push(all[randomBytes(1)[0] % all.length])
        // shuffle
        for (let j = chars.length - 1; j > 0; j--) {
          const k = randomBytes(1)[0] % (j + 1)
          ;[chars[j], chars[k]] = [chars[k], chars[j]]
        }
        lines.push(chars.slice(0, length).join(''))
      }
      pwOut.value = lines.join('\n')
      showStrength(lines[0], all.length, length)
    }

    function showStrength (sample, alphabetSize, length) {
      strength.textContent = ''
      const entropy = Math.round(length * Math.log2(alphabetSize))
      const bar = document.createElement('div')
      bar.className = 'pw-bar'
      const fill = document.createElement('i')
      const pct = Math.min(100, (entropy / 128) * 100)
      fill.style.width = `${pct}%`
      fill.style.background = entropy >= 100 ? 'var(--green)' : entropy >= 60 ? 'var(--orange)' : 'var(--red)'
      bar.appendChild(fill)
      const meta = document.createElement('div')
      meta.className = 'pw-meta'
      meta.textContent = `约 ${entropy} bit 熵 · 字符集 ${alphabetSize}`
      const label = document.createElement('div')
      label.textContent = entropy >= 100 ? '很强' : entropy >= 60 ? '中等' : '偏弱'
      label.style.color = entropy >= 100 ? 'var(--green)' : entropy >= 60 ? 'var(--orange)' : 'var(--red)'
      strength.appendChild(label)
      strength.appendChild(bar)
      strength.appendChild(meta)
      if (sample) strength.appendChild(Object.assign(document.createElement('div'), { className: 'pw-meta', textContent: `示例：${sample}` }))
    }

    $('#pw-gen').addEventListener('click', genPassword)
    $('#pw-copy').addEventListener('click', () => {
      if (!pwOut.value) return toast(tr('gen.generateFirst', '先生成'))
      copy(pwOut.value, '密码')
    })
    genPassword()
  }

  // ================================================================ REGEX
  const RX_PRESETS = [
    ['手机号（中国）', '^1[3-9]\\d{9}$'],
    ['邮箱', '[\\w.+-]+@[\\w-]+\\.[\\w.-]+'],
    ['URL', 'https?://[^\\s，。]+'],
    ['IPv4', '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b'],
    ['身份证号', '^[1-9]\\d{5}(18|19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]$'],
    ['中文字符', '[\\u4e00-\\u9fa5]+'],
    ['HTML 标签', '<[a-zA-Z][^>]*>'],
    ['日期 YYYY-MM-DD', '\\d{4}-\\d{2}-\\d{2}']
  ]

  function initRegex () {
    const pattern = $('#rx-in')
    const text = $('#rx-text')
    const out = $('#rx-out')
    const note = $('#rx-note')
    const count = $('#rx-count')
    const flagsLabel = $('#rx-flags-label')
    const replaced = $('#rx-replaced')

    for (const preset of RX_PRESETS) {
      const btn = document.createElement('button')
      btn.className = 'rx-preset'
      btn.textContent = preset[0]
      btn.title = preset[1]
      btn.addEventListener('click', () => {
        pattern.value = preset[1]
        if (!text.value) text.value = '13800138000\nuser@example.com\n2026-11-06 你好'
        run()
      })
      $('#rx-presets').appendChild(btn)
    }

    function flags () {
      return $$('#rx-flags input').filter((i) => i.checked).map((i) => i.dataset.flag).join('')
    }

    function build () {
      const source = pattern.value
      if (!source) return { error: null, empty: true }
      try {
        return { re: new RegExp(source, flags()) }
      } catch (err) {
        return { error: err.message }
      }
    }

    function run () {
      flagsLabel.textContent = flags()
      out.textContent = ''
      count.textContent = ''
      note.style.color = ''
      const built = build()
      if (built.error) {
        note.textContent = `正则错误：${built.error}`
        note.style.color = 'var(--red)'
        return
      }
      if (built.empty) { note.textContent = tr('re.empty', '输入正则后显示匹配'); return }
      note.textContent = tr('re.common', '常用：')

      const re = built.re
      const source = text.value
      if (!source) { out.appendChild(Object.assign(document.createElement('span'), { className: 'muted', textContent: '输入测试文本' })); return }

      const matches = []
      if (re.global || re.sticky) {
        re.lastIndex = 0
        let m
        let guard = 0
        while ((m = re.exec(source)) !== null && guard++ < 5000) {
          matches.push(m)
          if (m[0] === '') re.lastIndex++
        }
      } else {
        const m = re.exec(source)
        if (m) matches.push(m)
      }

      count.textContent = `${matches.length} 处匹配`
      if (!matches.length) {
        out.appendChild(Object.assign(document.createElement('span'), { className: 'muted', textContent: '没有匹配' }))
        return
      }
      for (let i = 0; i < Math.min(matches.length, 200); i++) {
        const m = matches[i]
        const row = document.createElement('div')
        row.className = 'rx-match'
        const idx = document.createElement('span')
        idx.className = 'idx'
        idx.textContent = `#${i + 1} @${m.index}`
        row.appendChild(idx)
        row.appendChild(document.createTextNode(m[0] === '' ? '(空匹配)' : m[0]))
        const named = m.groups && Object.keys(m.groups).length
        const hasGroups = (m.length > 1) || named
        if (hasGroups) {
          const box = document.createElement('div')
          box.className = 'groups'
          for (let g = 1; g < m.length; g++) {
            const line = document.createElement('div')
            line.textContent = `$${g} = ${m[g] === undefined ? 'undefined' : JSON.stringify(m[g])}`
            box.appendChild(line)
          }
          if (named) {
            for (const [k, v] of Object.entries(m.groups)) {
              const line = document.createElement('div')
              line.textContent = `${k} = ${v === undefined ? 'undefined' : JSON.stringify(v)}`
              box.appendChild(line)
            }
          }
          row.appendChild(box)
        }
        out.appendChild(row)
      }

      if ($('#rx-replace').value) applyReplace()
    }

    function applyReplace () {
      const built = build()
      if (built.error || built.empty) { replaced.hidden = true; return }
      const value = $('#rx-replace').value
      try {
        replaced.textContent = text.value.replace(built.re, value)
        replaced.hidden = false
      } catch (err) {
        replaced.textContent = `替换失败：${err.message}`
        replaced.hidden = false
      }
    }

    pattern.addEventListener('input', debounce(run, 120))
    text.addEventListener('input', debounce(run, 120))
    $('#rx-replace').addEventListener('input', debounce(() => { run() }, 150))
    $('#rx-apply').addEventListener('click', applyReplace)
    for (const input of $$('#rx-flags input')) input.addEventListener('change', run)
    run()
  }

  // ================================================================ JWT
  function initJwt () {
    const input = $('#jwt-in')
    const headerBox = $('#jwt-header')
    const payloadBox = $('#jwt-payload')
    const note = $('#jwt-note')
    const algLabel = $('#jwt-alg')
    const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'
      + 'eyJzdWIiOiJhbGljZSIsIm5hbWUiOiLkv6Hmga8iLCJpYXQiOjE3OTM5NTU4MjksImV4cCI6MTc5NDA0MjIyOX0.'
      + 'dummy-signature-xxxx'

    function pretty (obj) {
      return obj === null || obj === undefined ? '' : JSON.stringify(obj, null, 2)
    }

    function run () {
      const token = input.value.trim()
      if (!token) {
        headerBox.textContent = ''
        payloadBox.textContent = ''
        algLabel.textContent = ''
        note.textContent = tr('jwt.note2', '粘贴 token 自动解析；数据只在本机处理')
        note.style.color = ''
        return
      }
      if (!window.Jwt || typeof window.Jwt.decode !== 'function') {
        note.textContent = tr('jwt.moduleMissing', 'JWT 解析模块未加载')
        note.style.color = 'var(--red)'
        return
      }
      const result = window.Jwt.decode(token)
      if (!result.ok) {
        headerBox.textContent = ''
        payloadBox.textContent = ''
        algLabel.textContent = ''
        note.textContent = `解析失败：${result.error}`
        note.style.color = 'var(--red)'
        return
      }
      note.style.color = ''
      headerBox.textContent = pretty(result.header)
      payloadBox.textContent = pretty(result.payload)
      const time = result.time || {}
      const state = time.expired ? '已过期' : time.notYetValid ? '尚未生效' : time.expDate ? '有效' : '无过期时间'
      algLabel.textContent = `${result.alg || (result.header && result.header.alg) || 'alg=?'} · ${state}`
      note.textContent = window.Jwt.textSummary ? window.Jwt.textSummary(result.payload) : state
    }

    input.addEventListener('input', debounce(run, 150))
    $('#jwt-sample').addEventListener('click', () => { input.value = SAMPLE; run() })

    $('#jwt-verify').addEventListener('click', async () => {
      const secret = $('#jwt-secret').value
      const token = input.value.trim()
      const out = $('#jwt-verify-out')
      if (!token || !secret) { out.textContent = tr('jwt.needTokenKey', '需要 token 和密钥'); return }
      if (!window.Jwt || typeof window.Jwt.verifyHs256 !== 'function') { out.textContent = tr('jwt.verifyMissing', '验签模块未加载'); return }
      out.textContent = tr('jwt.verifying', '验证中…')
      const result = await window.Jwt.verifyHs256(token, secret)
      if (!result.ok) { out.textContent = result.error || '验证失败'; out.style.color = 'var(--red)'; return }
      out.style.color = result.valid ? 'var(--green)' : 'var(--red)'
      out.textContent = result.valid ? '✓ 签名有效（HS256）' : '✗ 签名不匹配'
    })
  }

  // ================================================================ CODEGEN
  function initCodegen () {
    const langSelect = $('#cg-lang')
    const input = $('#cg-in')
    const out = $('#cg-out')
    const status = $('#cg-status')

    const languages = (window.Codegen && window.Codegen.languages) || []
    for (const lang of languages) {
      const opt = document.createElement('option')
      opt.value = lang.id
      opt.textContent = lang.label
      langSelect.appendChild(opt)
    }
    if (!languages.length) {
      status.textContent = tr('cg.moduleMissing', '代码生成模块未加载')
      status.style.color = 'var(--red)'
    }

    function run () {
      if (!window.Codegen) return
      const parsed = window.Curl.parse(input.value)
      if (!parsed.ok) {
        out.textContent = ''
        status.textContent = `解析失败：${parsed.error}`
        status.style.color = 'var(--red)'
        return
      }
      const result = window.Codegen.generate(langSelect.value, parsed.request)
      status.style.color = ''
      if (!result.ok) {
        out.textContent = ''
        status.textContent = `生成失败：${result.error}`
        return
      }
      out.textContent = result.code
      const warnings = parsed.warnings && parsed.warnings.length ? ` · ${parsed.warnings.length} 条提示` : ''
      status.textContent = `已生成 ${langSelect.selectedOptions[0].textContent}${warnings}`
    }

    langSelect.addEventListener('change', run)
    input.addEventListener('input', debounce(run, 200))
    $('#cg-run').addEventListener('click', run)
    $('#cg-copy').addEventListener('click', () => {
      if (!out.textContent) return toast(tr('cg.empty', '还没有代码'))
      copy(out.textContent, '代码')
    })
    $('#cg-save').addEventListener('click', async () => {
      if (!out.textContent) return toast(tr('cg.empty', '还没有代码'))
      const ext = { python: 'py', javascript: 'js', 'node-axios': 'js', go: 'go', java: 'java', curl: 'sh' }[langSelect.value] || 'txt'
      const result = await api.dialog.saveText({ defaultName: `mozi-request.${ext}`, content: out.textContent })
      if (result.ok) toast(`已保存到 ${result.path}`)
    })

    // import the current request from the HTTP tool
    $('#cg-from-current').addEventListener('click', () => {
      const request = typeof window.__moziCurrentRequest === 'function' ? window.__moziCurrentRequest() : null
      if (!request) { toast(tr('cg.noRequest', '请求工具里还没有请求')); return }
      input.value = request
      run()
    })
  }

  // ================================================================ init
  function init () {
    wireTextCopy()
    initTimestamp()
    initHash()
    initGenerator()
    initRegex()
    initJwt()
    initCodegen()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
