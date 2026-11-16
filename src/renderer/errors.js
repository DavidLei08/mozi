'use strict'
window.__errors = []
window.addEventListener('error', (e) => window.__errors.push(`${e.message} @ ${e.filename}:${e.lineno}`))
window.addEventListener('unhandledrejection', (e) => window.__errors.push(`promise: ${e.reason && e.reason.message ? e.reason.message : e.reason}`))
