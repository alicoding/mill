// The extension's half of the bridge. It holds ONE WebSocket open to
// Mill and runs whatever arrives on it. Mill never opens a connection
// to the browser: this worker -- or the popup, waking it -- decides
// the channel exists, and closing it or revoking the pairing ends it.
//
// Chrome tears an extension service worker down after ~30s idle.
// WebSocket message activity is one of the events that resets that
// timer (Chrome 116+), so the open socket is what keeps this worker
// alive between commands -- Mill's own keepalive message every 25
// seconds is what supplies that activity while no command is running.
// If the worker is torn down anyway (Chrome can still do this under
// memory pressure), nothing here runs again until something wakes it:
// a chrome.alarms tick (the platform's own 30s floor), the browser
// starting up, the extension installing, a stored-settings change, or
// the popup's own reconnect message. ensureConnected() is idempotent,
// so every one of those triggers can call it with no risk of ever
// opening a second socket.

const STORAGE_KEY = 'millBridge'
const RECONNECT_MS = 5000
const RECONNECT_ALARM = 'mill-reconnect'

async function settings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return stored[STORAGE_KEY] || {}
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

// wsURL turns the stored http(s) address into the ws(s) one the
// platform's WebSocket constructor requires -- it accepts nothing else.
function wsURL(address) {
  return `${address.replace(/^http/, 'ws')}/__mill/bridge/ws`
}

let socket = null

// ensureConnected is the ONE place a socket opens. It is a no-op while
// one is already OPEN or CONNECTING, so every trigger below can call it
// freely without coordinating with the others.
async function ensureConnected() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  const { address, token } = await settings()
  if (!address || !token) return

  let next
  try {
    // The bearer token rides as the Sec-WebSocket-Protocol value
    // (`mill-token.<token>`): a WebSocket constructor cannot set an
    // Authorization header at all.
    next = new WebSocket(wsURL(address), [`mill-token.${token}`])
  } catch {
    await setStatus('disconnected')
    setTimeout(() => void ensureConnected(), RECONNECT_MS)
    return
  }
  socket = next

  next.addEventListener('open', () => { void setStatus('connected') })
  next.addEventListener('message', (event) => {
    let command
    try {
      command = JSON.parse(event.data)
    } catch {
      // A message this build cannot parse is skipped, never fatal.
      return
    }
    if (command.kind === 'replay') void runFlow(command)
  })
  next.addEventListener('close', () => {
    if (socket === next) socket = null
    void setStatus('disconnected')
    setTimeout(() => void ensureConnected(), RECONNECT_MS)
  })
  // A WebSocket always fires 'close' right after 'error', so the
  // reconnect and status update both live in the 'close' handler above
  // -- this listener exists only so an error is never left unhandled in
  // the worker's own console.
  next.addEventListener('error', () => {})
}

async function setStatus(status) {
  const current = await settings()
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...current, status } })
}

async function report(result) {
  const { address, token } = await settings()
  if (!address || !token) return
  await fetch(`${address}/__mill/bridge/result`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  })
}

// Downloads that land while a run is in flight, keyed by the run they
// belong to -- Chrome reports a download's final path asynchronously,
// well after the step that triggered it returned.
const downloads = new Map()

// DOWNLOAD_BYTES_CAP mirrors browserbridge.DownloadBytesCap (Go) -- the
// wire contract both sides agree to. Over this, the download still
// reports its path/filename, but not its content: mirror-not-point
// only works for a file small enough to actually carry across.
const DOWNLOAD_BYTES_CAP = 10 * 1024 * 1024

// pendingDownloads counts downloads Chrome has started but not yet
// completed -- so a step that triggered one (a click on a download
// link) can wait for it rather than reporting before it lands, without
// making every OTHER step (the vast majority, which never download
// anything) pay a fixed delay.
let pendingDownloads = 0
chrome.downloads.onCreated.addListener(() => { pendingDownloads++ })

const DOWNLOAD_WAIT_MS = 5000
const DOWNLOAD_POLL_MS = 50

// waitForPendingDownload blocks only while a download this run started
// hasn't landed in sink yet, bounded so a download that never completes
// (a blocked save prompt, an interrupted transfer) can't hang the run.
async function waitForPendingDownload(sink) {
  if (pendingDownloads <= 0) return
  const deadline = Date.now() + DOWNLOAD_WAIT_MS
  while (sink.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_POLL_MS))
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state || delta.state.current !== 'complete') return
  void handleDownloadComplete(delta.id)
})

async function handleDownloadComplete(downloadId) {
  const items = await chrome.downloads.search({ id: downloadId })
  const item = items && items[0]
  if (!item) return
  pendingDownloads = Math.max(0, pendingDownloads - 1)
  const entry = { path: item.filename, filename: item.filename.split('/').pop(), bytes: item.fileSize || 0 }
  if (item.fileSize > 0 && item.fileSize <= DOWNLOAD_BYTES_CAP) {
    entry.data = await fetchAsBase64(item.finalUrl || item.url).catch(() => undefined)
  }
  if (!entry.data) entry.tooLarge = item.fileSize > DOWNLOAD_BYTES_CAP
  for (const [, sink] of downloads) sink.push(entry)
}

// fetchAsBase64 re-reads the file over its own source address rather
// than the local disk: an extension service worker has no file-system
// API onto a completed download, and the bridge's own fixture (and any
// site serving a stable export) answers the same bytes it just saved.
async function fetchAsBase64(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`download refetch failed: ${response.status}`)
  const buffer = await response.arrayBuffer()
  return arrayBufferToBase64(buffer)
}

// arrayBufferToBase64 chunks the conversion -- String.fromCharCode's
// own argument-count ceiling would throw applied to a whole multi-
// megabyte buffer at once.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function waitForLoad(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') return true
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

// Reuses a tab already on the flow's own origin, so a run lands in the
// session the user is already signed into rather than a fresh tab that
// may not be.
async function tabForFlow(url) {
  let origin
  try {
    origin = new URL(url).origin
  } catch {
    origin = null
  }
  if (origin) {
    const existing = await chrome.tabs.query({ url: `${origin}/*` })
    if (existing.length > 0) return existing[0].id
  }
  const created = await chrome.tabs.create({ url, active: true })
  return created.id
}

const STEP_TIMEOUT_FALLBACK = 5000

function stepTimeout(step) {
  return step && step.timeout > 0 ? step.timeout : STEP_TIMEOUT_FALLBACK
}

// Runs one step in the page. `waitForExpression` runs in the page's own
// world because that is where the expression's names live; every other
// step runs in the isolated world, which has the same DOM and none of
// the page's globals.
async function runStepInTab(tabId, step, index) {
  const world = step.type === 'waitForExpression' ? 'MAIN' : 'ISOLATED'
  await chrome.scripting.executeScript({ target: { tabId }, files: ['replayRunner.js'], world })
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world,
    args: [step, index],
    func: (s, i) => globalThis.MillReplayRunner.runStep(s, i),
  })
  return result || { status: 'failed', error: `Step ${index + 1} didn't report back.` }
}

async function runFlow(command) {
  const sink = []
  downloads.set(command.id, sink)
  const steps = (command.flow && command.flow.steps) || []
  const target = (command.target && command.target.url) || firstNavigate(steps)
  let tabId = null
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      let result
      if (step.type === 'navigate') {
        tabId = tabId === null ? await tabForFlow(step.url || target) : tabId
        await chrome.tabs.update(tabId, { url: step.url || target })
        const loaded = await waitForLoad(tabId, stepTimeout(step))
        result = loaded ? { status: 'ok' } : { status: 'failed', error: `Step ${i + 1} never finished loading.` }
      } else {
        if (tabId === null) tabId = await tabForFlow(target)
        result = await runStepInTab(tabId, step, i)
      }
      await waitForPendingDownload(sink)
      const download = sink.shift()
      await report({ id: command.id, stepIndex: i, ...result, download })
      if (result.status === 'failed') {
        await report({ id: command.id, status: 'failed', error: result.error })
        return
      }
      // A step the recording asserted causes a navigation must not race
      // the next step against the old document.
      if (step.assertedEvents && step.assertedEvents.length > 0 && tabId !== null) {
        await waitForLoad(tabId, stepTimeout(step))
      }
    }
    await report({ id: command.id, status: 'done' })
  } catch (err) {
    await report({ id: command.id, status: 'failed', error: 'The browser couldn’t finish the steps.', detail: String(err) })
  } finally {
    downloads.delete(command.id)
  }
}

function firstNavigate(steps) {
  const step = steps.find((s) => s.type === 'navigate')
  return step ? step.url : ''
}

// chrome.alarms' own floor is 30s (120+), matching the worker's own
// idle ceiling -- this is the ONE trigger that can wake a fully
// terminated worker with no user or browser action at all.
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void ensureConnected()
})
chrome.runtime.onStartup.addListener(() => void ensureConnected())
chrome.runtime.onInstalled.addListener(() => void ensureConnected())
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) void ensureConnected()
})
// The popup's own wake call (goal 0418): opening the popup is a real
// user action Chrome always delivers, even to a fully terminated
// worker, so it never has to wait out an alarm cycle.
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'reconnect') void ensureConnected()
})
void ensureConnected()
