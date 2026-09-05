import type { Page } from '@playwright/test'

// A stand-in for the Mill browser extension (examples/browser-extension),
// speaking its exact wire protocol against a running Mill: pair with a
// code, hold one SSE stream open, replay whatever arrives, and post a
// result per step plus one closing result.
//
// It exists because loading a real unpacked MV3 extension into the
// suite's Chromium would make every run carry a second browser profile
// and a service worker whose lifetime the test cannot observe. The
// contract is what matters here -- the runner's own logic is unit-tested
// directly (frontend/src/shared/replayRunner.test.ts). What this proves
// is Mill's half: the code exchange, the stream, the correlation of
// results by run id, and the sentence the test result renders.

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
        } else {
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
        }
        await post({ id: command.id, stepIndex: i, status: 'ok' })
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

  void (async () => {
    const response = await fetch(`${bridgeURL}/__mill/bridge/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`stream refused (${response.status})`)
    markReady()
    await readSSE(response.body.getReader(), onCommand)
  })().catch(() => { /* the stream ends when the test aborts it */ })

  return { ready, received, stop: () => controller.abort() }
}

// Reads the SSE body frame by frame, handing each `data:` line's
// envelope to onCommand.
async function readSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onCommand: (command: Command) => Promise<void>,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let split: number
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      for (const line of frame.split('\n')) {
        if (line.startsWith('data: ')) await onCommand(JSON.parse(line.slice(6)) as Command)
      }
    }
  }
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
