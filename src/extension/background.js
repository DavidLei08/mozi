'use strict'

// Keep one workspace: two independent editors would overwrite the same local state.
let opening = null
chrome.action.onClicked.addListener(() => {
  if (opening) return
  opening = (async () => {
    const url = chrome.runtime.getURL('index.html')
    const tabs = await chrome.tabs.query({ url })
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, { active: true })
      await chrome.windows.update(tabs[0].windowId, { focused: true })
    } else {
      await chrome.tabs.create({ url })
    }
  })().catch(console.error).finally(() => { opening = null })
})
