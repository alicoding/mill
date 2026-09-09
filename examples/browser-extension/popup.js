// The popup finds Mill on this computer the way Bluetooth finds a
// nearby device: it asks whether Mill is here and already paired, and
// if not it offers ONE button. Pressing it shows a code that Mill also
// shows, in Settings > Connections > Browsers -- comparing the two and
// pressing Accept THERE is what proves this popup and that Mill are
// the same conversation, not just two processes on the same machine.
// Typing an address and a code by hand still works, behind "Enter a
// code instead", for whenever discovery itself can't run (a remote
// Mill, a security tool blocking loopback, re-pairing from a code
// Settings minted first).
//
// Every credential this popup holds (the bearer token) is written to
// chrome.storage.local and never read back into this page, never sent
// anywhere but Mill, and never shown.

const STORAGE_KEY = 'millBridge'
const DEFAULT_ADDRESS = 'http://127.0.0.1:8092'
const POLL_MS = 1000
const RECONNECT_POLL_MS = 2000

const views = {
  closed: document.getElementById('view-closed'),
  unpaired: document.getElementById('view-unpaired'),
  waiting: document.getElementById('view-waiting'),
  reconnecting: document.getElementById('view-reconnecting'),
  connected: document.getElementById('view-connected'),
}

const pairWithMillButton = document.getElementById('pair-with-mill')
const unpairedMessage = document.getElementById('unpaired-message')
const waitingCode = document.getElementById('waiting-code')
const connectedLabel = document.getElementById('connected-label')
const connectedAddress = document.getElementById('connected-address')
const disconnectButton = document.getElementById('disconnect')
const copyAddressButton = document.getElementById('copy-address')

const addressField = document.getElementById('address')
const codeField = document.getElementById('code')
const pairTypedButton = document.getElementById('pair-typed')
const typedStatus = document.getElementById('typed-status')

let pollTimer = null

function showView(name, message) {
  for (const key of Object.keys(views)) views[key].hidden = key !== name
  if (name === 'unpaired') unpairedMessage.textContent = message || ''
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

async function stored() {
  const data = await chrome.storage.local.get(STORAGE_KEY)
  return data[STORAGE_KEY] || {}
}

async function setStored(patch) {
  await chrome.storage.local.set({ [STORAGE_KEY]: patch })
}

// The name Mill shows for this browser in its Browsers list. Derived
// from the user agent, so the row reads like a browser rather than an
// id -- renameable in Mill afterwards like any paired thing.
function browserLabel() {
  const ua = navigator.userAgent
  if (ua.includes('Edg/')) return 'Microsoft Edge'
  if (ua.includes('OPR/')) return 'Opera'
  if (ua.includes('Chrome/')) return 'Chrome'
  if (ua.includes('Firefox/')) return 'Firefox'
  return 'Browser'
}

// discover reports whether Mill answered at all (reachable), whether
// THIS browser is already paired, and whether its credential also
// holds a live socket right now (goal 0418) -- paired and connected are
// two separate facts. A response that came back but was refused (Mill
// running, but this request wasn't loopback -- a remote Mill) still
// counts as reachable: the typed fallback stays available for exactly
// that case, discovery just can't finish it.
async function discover(address, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  let response
  try {
    response = await fetch(`${address}/__mill/bridge/discover`, { headers })
  } catch {
    return { reachable: false, paired: false, connected: false }
  }
  if (!response.ok) return { reachable: true, paired: false, connected: false }
  const body = await response.json().catch(() => ({}))
  return { reachable: true, paired: Boolean(body.paired), connected: Boolean(body.connected) }
}

function showConnected(address, label) {
  connectedLabel.textContent = label || 'Browser'
  connectedAddress.textContent = address
  showView('connected')
}

// pollReconnect watches discover() every RECONNECT_POLL_MS while the
// reconnecting view is showing: the worker's own alarm/message trigger
// reconnects it in the background, and this is what notices and moves
// the popup on once it does, without the person having to reopen it.
function pollReconnect(address, token, label) {
  pollTimer = setInterval(async () => {
    const result = await discover(address, token)
    if (!result.reachable) {
      stopPolling()
      showView('closed')
      return
    }
    if (!result.paired) {
      stopPolling()
      showView('unpaired')
      return
    }
    if (result.connected) {
      stopPolling()
      showConnected(address, label)
    }
  }, RECONNECT_POLL_MS)
}

async function init() {
  stopPolling()
  const current = await stored()
  const address = current.address || DEFAULT_ADDRESS
  addressField.value = address

  const result = await discover(address, current.token)
  if (!result.reachable) {
    showView('closed')
    return
  }
  if (result.paired && result.connected) {
    showConnected(address, current.label)
    return
  }
  if (result.paired) {
    // Paired, but this credential holds no live socket right now --
    // the worker likely went idle. Ask it to reconnect: a real user
    // action (opening this popup) always reaches even a fully
    // terminated worker, where the platform's own alarm would have to
    // wait out its next cycle.
    showView('reconnecting')
    try {
      chrome.runtime.sendMessage({ type: 'reconnect' })
    } catch {
      // No background context to reach (e.g. this popup loaded outside
      // a real extension) -- the poll below still catches a reconnect
      // from any of the worker's OTHER triggers.
    }
    pollReconnect(address, current.token, current.label)
    return
  }
  // Reachable but not paired -- including a token this browser held
  // that Mill no longer honours (revoked elsewhere). Never keep
  // offering Disconnect for a credential that is already dead.
  if (current.token) await setStored({ address })
  showView('unpaired')
}

pairWithMillButton.addEventListener('click', async () => {
  const current = await stored()
  const address = current.address || DEFAULT_ADDRESS
  let response
  try {
    response = await fetch(`${address}/__mill/bridge/pair-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: browserLabel() }),
    })
  } catch {
    showView('closed')
    return
  }
  if (!response.ok) {
    showView('unpaired', "That didn't work. Try again.")
    return
  }
  const { requestId, code, expiresAt } = await response.json()
  waitingCode.textContent = code
  showView('waiting')
  pollStatus(address, requestId, expiresAt)
})

function pollStatus(address, requestId, expiresAt) {
  const deadline = new Date(expiresAt).getTime()
  pollTimer = setInterval(async () => {
    if (Date.now() > deadline) {
      stopPolling()
      showView('unpaired', 'That request expired. Try again.')
      return
    }
    let status
    try {
      const response = await fetch(`${address}/__mill/bridge/pair-status?requestId=${encodeURIComponent(requestId)}`)
      status = await response.json()
    } catch {
      // A transient fetch hiccup stays in "Waiting…" -- the deadline
      // check above is the real timeout, not this poll succeeding.
      return
    }
    if (status.status === 'pending') return
    stopPolling()
    if (status.status === 'accepted') {
      await setStored({ address, token: status.token, deviceId: status.deviceId, label: status.label })
      showConnected(address, status.label)
      return
    }
    if (status.status === 'denied') {
      showView('unpaired', 'Pairing declined in Mill.')
      return
    }
    showView('unpaired', 'That request expired. Try again.')
  }, POLL_MS)
}

pairTypedButton.addEventListener('click', async () => {
  const address = addressField.value.trim().replace(/\/$/, '')
  const code = codeField.value.trim().toUpperCase()
  if (!address || !code) {
    typedStatus.textContent = 'Enter the address and the code, then pair.'
    typedStatus.dataset.state = 'error'
    return
  }
  typedStatus.textContent = 'Pairing…'
  typedStatus.dataset.state = 'idle'
  let response
  try {
    response = await fetch(`${address}/__mill/bridge/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, label: browserLabel() }),
    })
  } catch {
    typedStatus.textContent = "Mill isn't running."
    typedStatus.dataset.state = 'error'
    return
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    typedStatus.textContent = body.error || "That didn't work. Generate a new code and try again."
    typedStatus.dataset.state = 'error'
    return
  }
  await setStored({ address, token: body.token, deviceId: body.deviceId, label: body.label })
  codeField.value = ''
  showConnected(address, body.label)
})

disconnectButton.addEventListener('click', async () => {
  // Ends the pairing in Mill first (POST /__mill/bridge/disconnect,
  // this browser's own bearer token as proof) -- best-effort: a failed
  // or unreachable call still falls through to the local clear below,
  // since disconnecting must never depend on Mill being reachable
  // right now.
  const current = await stored()
  if (current.address && current.token) {
    try {
      await fetch(`${current.address}/__mill/bridge/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${current.token}` },
      })
    } catch {
      // Mill unreachable -- the local clear below still runs.
    }
  }
  await setStored({ address: current.address })
  await init()
})

copyAddressButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(connectedAddress.textContent || '')
})

void init()
