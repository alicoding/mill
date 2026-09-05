// The popup does two things: it holds the address of the Mill this
// browser talks to, and it exchanges a pairing code for the token the
// background worker then uses. The token is written to
// chrome.storage.local and never read back into this page, never sent
// anywhere but Mill, and never shown.

const STORAGE_KEY = 'millBridge'
const DEFAULT_ADDRESS = 'http://127.0.0.1:8092'

const addressField = document.getElementById('address')
const codeField = document.getElementById('code')
const pairButton = document.getElementById('pair')
const status = document.getElementById('status')

function show(text, state) {
  status.textContent = text
  status.dataset.state = state
}

async function load() {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const current = stored[STORAGE_KEY] || {}
  addressField.value = current.address || DEFAULT_ADDRESS
  if (!current.token) {
    show('Not paired', 'idle')
  } else if (current.status === 'connected') {
    show('Connected to Mill', 'connected')
  } else {
    show("Mill isn't running", 'error')
  }
}

pairButton.addEventListener('click', async () => {
  const address = addressField.value.trim().replace(/\/$/, '')
  const code = codeField.value.trim().toUpperCase()
  if (!address || !code) {
    show('Enter the address and the code, then pair.', 'error')
    return
  }
  show('Pairing…', 'idle')
  let response
  try {
    response = await fetch(`${address}/__mill/bridge/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, label: browserLabel() }),
    })
  } catch {
    show("Mill isn't running", 'error')
    return
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    show(body.error || "That didn't work. Generate a new code and try again.", 'error')
    return
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: { address, token: body.token, deviceId: body.deviceId, status: 'connected' } })
  codeField.value = ''
  show('Connected to Mill', 'connected')
})

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

void load()
