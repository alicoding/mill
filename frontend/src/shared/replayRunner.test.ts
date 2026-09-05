// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import '../../../examples/browser-extension/replayRunner.js'

// The replay runner ships inside the browser extension
// (examples/browser-extension/replayRunner.js) and is injected into a
// page, so it assigns onto globalThis rather than exporting. It is
// pinned here because it is the one part of the extension with real
// logic: which selector resolves an element, and what each recorded
// step actually does to it.
//
// The step and selector vocabulary is Chrome DevTools Recorder's own --
// a case failing here means Mill stopped replaying a flow DevTools
// exported, which is the whole contract.

interface StepResult { status: string; error?: string; extracted?: string }
interface Runner {
  parseSelector(raw: string): { kind: string; value: string }
  resolveElement(selectors: string[][], root?: ParentNode): Element | null
  runStep(step: Record<string, unknown>, index: number, root?: Document): Promise<StepResult>
  notFoundMessage(step: Record<string, unknown>, index: number): string
  accessibleName(el: Element): string
}

const runner = (globalThis as unknown as { MillReplayRunner: Runner }).MillReplayRunner

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('the Recorder selector grammar', () => {
  it('recognises every prefix the Recorder emits, and treats the rest as CSS', () => {
    expect(runner.parseSelector('#search')).toEqual({ kind: 'css', value: '#search' })
    expect(runner.parseSelector('aria/Search')).toEqual({ kind: 'aria', value: 'Search' })
    expect(runner.parseSelector('text/Search')).toEqual({ kind: 'text', value: 'Search' })
    expect(runner.parseSelector('xpath///*[@id="a"]')).toEqual({ kind: 'xpath', value: '//*[@id="a"]' })
    expect(runner.parseSelector('pierce/#inner')).toEqual({ kind: 'pierce', value: '#inner' })
  })

  it('resolves a CSS selector', () => {
    document.body.innerHTML = '<button id="go">Go</button>'
    expect(runner.resolveElement([['#go']])?.id).toBe('go')
  })

  it('resolves an aria selector by accessible name, label before text', () => {
    document.body.innerHTML = '<button aria-label="Search">Magnifier</button>'
    expect(runner.resolveElement([['aria/Search']])?.tagName).toBe('BUTTON')
    expect(runner.resolveElement([['aria/Magnifier']])).toBeNull()
  })

  it('resolves an aria selector through aria-labelledby', () => {
    document.body.innerHTML = '<span id="lbl">Send it</span><button aria-labelledby="lbl">x</button>'
    expect(runner.resolveElement([['aria/Send it']])?.tagName).toBe('BUTTON')
  })

  it('resolves a text selector on exact trimmed text', () => {
    document.body.innerHTML = '<div><a href="#">  Docs  </a></div>'
    expect(runner.resolveElement([['text/Docs']])?.tagName).toBe('A')
    expect(runner.resolveElement([['text/Doc']])).toBeNull()
  })

  it('resolves an xpath selector', () => {
    document.body.innerHTML = '<ul><li>one</li><li id="two">two</li></ul>'
    expect(runner.resolveElement([['xpath///*[@id="two"]']])?.id).toBe('two')
  })

  it('resolves a pierce selector through an open shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    host.attachShadow({ mode: 'open' }).innerHTML = '<button id="inner">Inner</button>'
    expect(runner.resolveElement([['pierce/#inner']])?.id).toBe('inner')
  })

  it('walks a chain into the previous element\'s shadow root', () => {
    const host = document.createElement('div')
    host.id = 'host'
    document.body.append(host)
    host.attachShadow({ mode: 'open' }).innerHTML = '<button id="inner">Inner</button>'
    expect(runner.resolveElement([['#host', '#inner']])?.id).toBe('inner')
  })

  it('falls through to the next chain when an earlier one misses', () => {
    document.body.innerHTML = '<button aria-label="Confirm">ok</button>'
    expect(runner.resolveElement([['#gone'], ['aria/Confirm']])?.tagName).toBe('BUTTON')
  })

  it('returns null when no chain resolves, rather than the first thing it finds', () => {
    document.body.innerHTML = '<button>ok</button>'
    expect(runner.resolveElement([['#gone'], ['aria/Missing'], ['unknown/thing']])).toBeNull()
  })

  it('skips empty chains the Recorder leaves behind', () => {
    document.body.innerHTML = '<button id="go">Go</button>'
    expect(runner.resolveElement([[], ['#go']])?.id).toBe('go')
  })
})

describe('step dispatch', () => {
  it('clicks the element a chain resolves', async () => {
    document.body.innerHTML = '<button id="go">Go</button><div id="out" hidden>done</div>'
    document.getElementById('go')!.addEventListener('click', () => {
      ;(document.getElementById('out') as HTMLElement).hidden = false
    })
    const result = await runner.runStep({ type: 'click', selectors: [['#go']] }, 0)
    expect(result.status).toBe('ok')
    expect((document.getElementById('out') as HTMLElement).hidden).toBe(false)
  })

  it('sets a value and fires input and change, so a framework sees it', async () => {
    document.body.innerHTML = '<input id="q">'
    const seen: string[] = []
    const input = document.getElementById('q') as HTMLInputElement
    input.addEventListener('input', () => seen.push('input'))
    input.addEventListener('change', () => seen.push('change'))
    const result = await runner.runStep({ type: 'change', value: 'guardrails', selectors: [['#q']] }, 0)
    expect(result.status).toBe('ok')
    expect(input.value).toBe('guardrails')
    expect(seen).toEqual(['input', 'change'])
    expect(result.extracted).toBe('guardrails')
  })

  it('sends a real key event carrying the recorded key', async () => {
    document.body.innerHTML = '<input id="q">'
    let pressed = ''
    document.getElementById('q')!.addEventListener('keydown', (e) => { pressed = (e as KeyboardEvent).key })
    const result = await runner.runStep({ type: 'keyDown', key: 'Enter', selectors: [['#q']] }, 0)
    expect(result.status).toBe('ok')
    expect(pressed).toBe('Enter')
  })

  it('hovers by dispatching the pointer events a page listens for', async () => {
    document.body.innerHTML = '<div id="t">t</div>'
    let hovered = false
    document.getElementById('t')!.addEventListener('mouseover', () => { hovered = true })
    expect((await runner.runStep({ type: 'hover', selectors: [['#t']] }, 0)).status).toBe('ok')
    expect(hovered).toBe(true)
  })

  it('waits for an element that appears after the step starts', async () => {
    document.body.innerHTML = '<div id="host"></div>'
    setTimeout(() => {
      document.getElementById('host')!.innerHTML = '<span id="late">here</span>'
    }, 60)
    const result = await runner.runStep({ type: 'waitForElement', selectors: [['#late']], timeout: 2000 }, 0)
    expect(result.status).toBe('ok')
  })

  it('reports skipped for a recorded step no page-side runner can honour', async () => {
    for (const type of ['setViewport', 'emulateNetworkConditions', 'close']) {
      expect((await runner.runStep({ type }, 0)).status).toBe('skipped')
    }
  })
})

describe('the failure a reader can act on', () => {
  it('names the step number and the step\'s own first selector', async () => {
    document.body.innerHTML = '<div></div>'
    const step = { type: 'click', selectors: [['#mill-bridge-button'], ['aria/Confirm']], timeout: 30 }
    const result = await runner.runStep(step, 1)
    expect(result.status).toBe('failed')
    expect(result.error).toBe("Couldn't find the element for step 2 (#mill-bridge-button).")
  })

  it('says "no selector" rather than crashing when the chains are all empty', () => {
    expect(runner.notFoundMessage({ selectors: [[]] }, 0)).toBe("Couldn't find the element for step 1 (no selector).")
  })

  it('reports a wait that never came true, without throwing', async () => {
    const result = await runner.runStep({ type: 'waitForElement', selectors: [['#never']], timeout: 30 }, 4)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('step 5')
  })
})
