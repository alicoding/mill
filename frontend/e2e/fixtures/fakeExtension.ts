import type { Page } from '@playwright/test'

// A stand-in for the Mill browser extension (examples/browser-extension),
// speaking its exact wire protocol against a running Mill: pair with a
// code, hold one WebSocket open, replay whatever arrives, and post a
// result per step plus one closing result.
//
// It exists because loading a real unpacked MV3 extension into the
// suite's Chromium would make every run carry a second browser profile
// and a service worker whose lifetime the test cannot observe (the real
// wake-from-idle path is instead proven by browser-extension-mv3.spec.ts,
// which DOES load the real unpacked extension, under Playwright's own
// persistent-context path). The contract is what matters here -- the
// runner's own logic is unit-tested directly
// (frontend/src/shared/replayRunner.test.ts). What this proves is Mill's
// half: the code exchange, the socket, the correlation of results by run
// id, and the sentence the test result renders.

interface Step {
  type: string
  url?: string
  selectors?: string[][]
  value?: string
  key?: string
  timeout?: number
}

interface Command {
  id?: string
  kind: string
  flow?: { title: string; steps: Step[] }
}

export interface FakeExtension {
  /** Resolves once the stream is open and Mill has registered it. */
  ready: Promise<void>
  /** Every command the stream delivered, newest last. */
  received: Command[]
  stop: () => void
}

/** Exchanges a pairing code for this browser's bearer token. */
export async function pairFakeExtension(bridgeURL: string, code: string, label = 'Chrome'): Promise<string> {
  const response = await fetch(`${bridgeURL}/__mill/bridge/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, label }),
  })
  if (!response.ok) {
    throw new Error(`pairing refused (${response.status}): ${await response.text()}`)
  }
  const body = (await response.json()) as { token?: string }
  if (!body.token) throw new Error('pairing returned no token')
  return body.token
}

/** Mints a nearby-flow pairing request (goal 0379): the popup's own
 * "Pair with Mill" call, before any human has accepted anything. */
export async function requestPairing(bridgeURL: string, label = 'Chrome'): Promise<{ requestId: string; code: string; expiresAt: string }> {
  const response = await fetch(`${bridgeURL}/__mill/bridge/pair-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  })
  if (!response.ok) {
    throw new Error(`pair-request refused (${response.status}): ${await response.text()}`)
  }
  return (await response.json()) as { requestId: string; code: string; expiresAt: string }
}

/** Polls a nearby-flow pairing request's status -- the popup's own
 * pair-status call. */
export async function pairRequestStatus(bridgeURL: string, requestId: string): Promise<{ status: string; token?: string; deviceId?: string; label?: string }> {
  const response = await fetch(`${bridgeURL}/__mill/bridge/pair-status?requestId=${encodeURIComponent(requestId)}`)
  return (await response.json()) as { status: string; token?: string; deviceId?: string; label?: string }
}

/**
 * Connects to the bridge and replays every flow it receives in `page`.
 * The caller owns `page`; this never closes it.
 */
export function connectFakeExtension(bridgeURL: string, token: string, page: Page): FakeExtension {
  const controller = new AbortController()
  const received: Command[] = []
  let markReady = () => {}
  const ready = new Promise<void>((resolve) => { markReady = resolve })

  const post = async (body: unknown) => {
    await fetch(`${bridgeURL}/__mill/bridge/result`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  }

  const replay = async (command: Command) => {
    const steps = command.flow?.steps ?? []
    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        if (step.type === 'navigate') {
          await page.goto(step.url ?? '')
          await post({ id: command.id, stepIndex: i, status: 'ok' })
          continue
        }
        const selector = cssSelectorFor(step)
        if (!selector) {
          await post({ id: command.id, stepIndex: i, status: 'skipped' })
          continue
        }
        if (step.type === 'waitForElement') {
          await page.locator(selector).waitFor({ state: 'visible', timeout: step.timeout ?? 5000 })
        } else if (step.type === 'change') {
          await page.locator(selector).fill(step.value ?? '')
        } else if (step.type === 'keyDown') {
          await page.locator(selector).press(step.key ?? 'Enter')
        } else {
          await page.locator(selector).click()
        }
        // The real runner reports the element's own value or text back
        // on every element step (examples/browser-extension's
        // replayRunner.js); a step that extracts nothing here would
        // make an extraction look broken when it is the stand-in that
        // is incomplete.
        const download = await downloadFrom(page, selector)
        await post({ id: command.id, stepIndex: i, status: 'ok', extracted: await extractedFrom(page, selector), download })
      }
      await post({ id: command.id, status: 'done' })
    } catch (err) {
      await post({ id: command.id, status: 'failed', error: String(err) })
    }
  }

  const onCommand = async (command: Command) => {
    received.push(command)
    if (command.kind === 'replay') await replay(command)
  }

  // Node's own global WebSocket (Node 22+) speaks the same wire shape
  // the real extension's worker does: the bearer token as the
  // Sec-WebSocket-Protocol value, one JSON message per envelope.
  const wsURL = `${bridgeURL.replace(/^http/, 'ws')}/__mill/bridge/ws`
  const socket = new WebSocket(wsURL, [`mill-token.${token}`])
  socket.addEventListener('open', () => markReady())
  socket.addEventListener('message', (event: MessageEvent) => {
    let command: Command
    try {
      command = JSON.parse(String(event.data)) as Command
    } catch {
      return
    }
    if (command.kind === 'keepalive') return
    void onCommand(command)
  })

  return {
    ready,
    received,
    stop: () => {
      controller.abort()
      socket.close()
    },
  }
}

// downloadFrom stands in for chrome.downloads: a real extension
// observes the browser's own completed download and re-fetches its
// source address for the bytes (examples/browser-extension/
// background.js); this fake has no such event, so it asks the clicked
// element directly whether it names one (an `<a download>`, same as
// the bridge's own test-page fixture) and, if so, fetches that address
// itself -- proving the SAME wire shape (path/filename/bytes/data)
// process-browser-replay and apply-atlas-file-object actually consume,
// without a real unpacked extension in the suite's Chromium.
async function downloadFrom(page: Page, selector: string): Promise<{ path: string; filename: string; bytes: number; data?: string } | undefined> {
  const href = await page.locator(selector).evaluate((el) => (el instanceof HTMLAnchorElement && el.hasAttribute('download') ? el.href : null))
  if (!href) return undefined
  const response = await page.request.get(href)
  if (!response.ok()) return undefined
  const body = await response.body()
  const disposition = response.headers()['content-disposition'] ?? ''
  const named = /filename="?([^";]+)"?/.exec(disposition)?.[1]
  const filename = named ?? href.split('/').pop() ?? 'download'
  return { path: `/fake-downloads/${filename}`, filename, bytes: body.byteLength, data: body.toString('base64') }
}

// The element's own value if it has one, else its trimmed text --
// exactly what the real runner reports.
async function extractedFrom(page: Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate((el) => {
    const value = (el as HTMLInputElement).value
    return (typeof value === 'string' ? value : (el.textContent ?? '')).trim().slice(0, 200)
  })
}

// The first CSS chain in the step's fallback list. The fake client
// understands only plain CSS on purpose -- the prefixed grammars are
// the real runner's job, proven in its own unit test.
function cssSelectorFor(step: Step): string | null {
  for (const chain of step.selectors ?? []) {
    const first = chain[0]
    if (first && !first.includes('/')) return first
  }
  return null
}
