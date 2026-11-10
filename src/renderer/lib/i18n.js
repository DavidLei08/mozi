'use strict'

/**
 * Tiny i18n runtime for Mozi.
 *
 * Dictionaries live in lib/i18n-dict.js as { zh: {...}, en: {...} }. Every
 * lookup takes the Chinese source string as a fallback, so a partially
 * translated build degrades to Chinese instead of showing raw keys.
 *
 * Markup hooks:
 *   data-i18n="key"                -> textContent
 *   data-i18n-title="key"          -> title attribute
 *   data-i18n-placeholder="key"    -> placeholder attribute
 */
window.I18N = (function () {
  const STORAGE_KEY = 'mozi.language'
  const SUPPORTED = ['zh', 'en']
  let lang = 'zh'

  function dictionaries () {
    return (typeof window.I18N_DICT === 'object' && window.I18N_DICT) || { zh: {}, en: {} }
  }

  function t (key, fallback) {
    if (!key) return fallback || ''
    const dict = dictionaries()
    const table = dict[lang] || {}
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key]
    const zh = (dict.zh || {})[key]
    if (zh !== undefined) return zh
    return fallback !== undefined ? fallback : key
  }

  function applyOne (node) {
    const key = node.dataset.i18n
    if (key) node.textContent = t(key, node.textContent)
    const titleKey = node.dataset.i18nTitle
    if (titleKey) node.title = t(titleKey, node.title)
    const phKey = node.dataset.i18nPlaceholder
    if (phKey) node.placeholder = t(phKey, node.placeholder)
    const ariaKey = node.dataset.i18nAria
    if (ariaKey) node.setAttribute('aria-label', t(ariaKey, node.getAttribute('aria-label') || ''))
  }

  function applyStatic (root) {
    const scope = root || document
    if (scope.dataset && (scope.dataset.i18n || scope.dataset.i18nTitle || scope.dataset.i18nPlaceholder)) applyOne(scope)
    for (const node of scope.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria]')) applyOne(node)
  }

  function get () { return lang }

  function set (next, opts) {
    if (!SUPPORTED.includes(next)) next = 'zh'
    lang = next
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* private mode */ }
    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN'
    applyStatic()
    if (!opts || opts.announce !== false) {
      window.dispatchEvent(new CustomEvent('mozi-language', { detail: next }))
    }
  }

  function init (initial) {
    let stored = initial
    if (!stored) {
      try { stored = localStorage.getItem(STORAGE_KEY) } catch { stored = null }
    }
    set(SUPPORTED.includes(stored) ? stored : 'zh', { announce: false })
  }

  return { t, get, set, init, applyStatic, supported: SUPPORTED.slice() }
})()
