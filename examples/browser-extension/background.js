// The extension's half of the bridge. It holds ONE stream open to Mill
// and runs whatever arrives on it. Mill never opens a connection to the
// browser: this worker decides the channel exists, and closing it or
// revoking the pairing ends it.
//
// Chrome tears an extension service worker down when it goes idle, so
// the open stream is what keeps this alive -- Mill's keepalive is a
// chunk every 25 seconds, and each chunk resets that timer. If the
// worker is torn down anyway, connect() runs again on the next startup
// event and the stream is re-established.

const STORAGE_KEY = 'millBridge'
const RECONNECT_MS = 5000

async function settings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return stored[STORAGE_KEY] || {}
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

// Reads the SSE body as it arrives and hands each `data:` frame to
// onEvent. Server-sent events over fetch rather than EventSource:
// EventSource does not exist in an extension service worker, and it
// could not carry the Authorization header the bridge requires anyway.
async function readStream(response, onEvent) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let split
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          onEvent(JSON.parse(line.slice(6)))
        } catch {
          // A frame this build cannot parse is skipped, never fatal --
          // dropping the whole stream would take the working commands
          // down with the one bad frame.
        }
      }
    }
  }
}

let connecting = false

async function connect() {
  if (connecting) return
  connecting = true
  try {
    const { address, token } = await settings()
    if (!address || !token) return
    const response = await fetch(`${address}/__mill/bridge/events`, { headers: authHeaders(token) })
    if (!response.ok || !response.body) throw new Error(`stream refused: ${response.status}`)
    await setStatus('connected')
    await readStream(response, (event) => {
      if (event.kind === 'replay') void runFlow(event)
    })
  } catch {
    await setStatus('disconnected')
  } finally {
    connecting = false
    setTimeout(() => void connect(), RECONNECT_MS)
  }
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
chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state || delta.state.current !== 'complete') return
  chrome.downloads.search({ id: delta.id }, (items) => {
    const item = items && items[0]
    if (!item) return
    for (const [, sink] of downloads) {
      sink.push({ path: item.filename, filename: item.filename.split('/').pop(), bytes: item.fileSize || 0 })
    }
  })
})

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

chrome.runtime.onStartup.addListener(() => void connect())
chrome.runtime.onInstalled.addListener(() => void connect())
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) void connect()
})
void connect()
