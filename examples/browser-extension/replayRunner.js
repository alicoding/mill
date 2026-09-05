// The replay runner: it resolves one recorded step's element and
// performs that step, in the page. It is the only part of this
// extension with page knowledge, and it is deliberately free of every
// chrome.* API so it can be exercised directly under a DOM (see
// frontend/src/shared/replayRunner.test.ts).
//
// The step and selector vocabulary is Chrome DevTools Recorder's own.
// Nothing here invents a step type or a selector prefix: a flow
// exported from DevTools runs unchanged, and a prefix this file does
// not know is reported rather than guessed at.
//
// Assigned onto globalThis rather than exported, because the extension
// injects this file as a plain script into a page's isolated world,
// where module semantics are unavailable.
(function (global) {
  'use strict'

  // The selector grammar the Recorder emits. `css` is the unprefixed
  // default; the rest are prefix-tagged.
  const PREFIXES = ['aria/', 'text/', 'xpath/', 'pierce/']

  function parseSelector(raw) {
    const value = String(raw ?? '')
    for (const prefix of PREFIXES) {
      if (value.startsWith(prefix)) {
        return { kind: prefix.slice(0, -1), value: value.slice(prefix.length) }
      }
    }
    return { kind: 'css', value }
  }

  // Collects every element under root, descending through open shadow
  // roots -- what the Recorder's `pierce/`, `aria/` and `text/`
  // selectors all need, since none of them is a plain querySelector.
  function deepElements(root) {
    const found = []
    const walk = (node) => {
      const children = node.querySelectorAll ? node.querySelectorAll('*') : []
      for (const el of children) {
        found.push(el)
        if (el.shadowRoot) walk(el.shadowRoot)
      }
    }
    walk(root)
    return found
  }

  // Roles whose accessible name comes from their own content. Every
  // OTHER element names itself only through an explicit attribute --
  // without this an `aria/` selector would match any ancestor that
  // happens to contain the text, up to and including <html>.
  const NAME_FROM_CONTENT = new Set([
    'A', 'BUTTON', 'SUMMARY', 'LABEL', 'LEGEND', 'OPTION', 'TD', 'TH',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  ])
  const NAME_FROM_CONTENT_ROLES = new Set([
    'button', 'link', 'menuitem', 'option', 'tab', 'treeitem', 'heading', 'cell', 'columnheader', 'rowheader',
  ])

  function namesItselfFromContent(el) {
    if (NAME_FROM_CONTENT.has(el.tagName)) return true
    const role = el.getAttribute && el.getAttribute('role')
    return Boolean(role && NAME_FROM_CONTENT_ROLES.has(role))
  }

  // The accessible name, in the order the platform resolves it. Not a
  // full accname implementation -- the sources the Recorder actually
  // records from, with the name-from-content rule above, which is what
  // keeps a name from matching every ancestor of the named element.
  function accessibleName(el) {
    const label = el.getAttribute && el.getAttribute('aria-label')
    if (label) return label.trim()
    const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const doc = el.ownerDocument
      const target = doc && doc.getElementById(labelledBy)
      if (target) return (target.textContent || '').trim()
    }
    if (el.getAttribute && el.getAttribute('alt')) return el.getAttribute('alt').trim()
    if (el.getAttribute && el.getAttribute('title')) return el.getAttribute('title').trim()
    if (namesItselfFromContent(el)) return (el.textContent || '').trim()
    return ''
  }

  // Resolves ONE selector against a root. Returns an element or null;
  // an unknown prefix returns null rather than falling back to CSS,
  // so a chain that cannot be honoured fails over to the next chain
  // instead of silently matching something else.
  function resolveOne(raw, root) {
    const { kind, value } = parseSelector(raw)
    const scope = root || document
    switch (kind) {
      case 'css':
        try {
          return scope.querySelector(value)
        } catch {
          return null
        }
      case 'pierce':
        try {
          if (scope.querySelector(value)) return scope.querySelector(value)
        } catch {
          return null
        }
        for (const el of deepElements(scope)) {
          if (el.shadowRoot && el.shadowRoot.querySelector(value)) return el.shadowRoot.querySelector(value)
        }
        return null
      case 'aria':
        for (const el of deepElements(scope)) {
          if (accessibleName(el) === value) return el
        }
        return null
      case 'text': {
        // The DEEPEST element carrying the text, not the first one seen:
        // every ancestor of a matching node also contains that text, so
        // a document-order scan would return <html> for a link's label.
        let deepest = null
        for (const el of deepElements(scope)) {
          if ((el.textContent || '').trim() !== value) continue
          if (!deepest || deepest.contains(el)) deepest = el
        }
        return deepest
      }
      case 'xpath': {
        const doc = scope.ownerDocument || scope
        if (!doc.evaluate) return null
        try {
          const result = doc.evaluate(value, scope, null, 9 /* FIRST_ORDERED_NODE_TYPE */, null)
          return result ? result.singleNodeValue : null
        } catch {
          return null
        }
      }
      default:
        return null
    }
  }

  // Resolves one chain: each entry after the first is looked up inside
  // the previous element's shadow root, which is how the Recorder
  // records an element inside a web component.
  function resolveChain(chain, root) {
    let current = root || document
    let element = null
    for (const raw of chain) {
      element = resolveOne(raw, current)
      if (!element) return null
      current = element.shadowRoot || element
    }
    return element
  }

  // Tries the chains in order and returns the first element any of them
  // resolves. That redundancy is the whole point of the Recorder's
  // selectors[][]: a page whose classes changed but whose ARIA name and
  // text did not still replays.
  function resolveElement(selectors, root) {
    for (const chain of selectors || []) {
      if (!Array.isArray(chain) || chain.length === 0) continue
      const element = resolveChain(chain, root)
      if (element) return element
    }
    return null
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  // Polls until check() answers truthily or the budget runs out.
  async function waitFor(check, timeoutMs, intervalMs) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = check()
      if (value) return value
      if (Date.now() >= deadline) return null
      await sleep(intervalMs || 50)
    }
  }

  function stepTimeout(step) {
    return step && step.timeout > 0 ? step.timeout : 5000
  }

  // The one sentence a failed lookup reports. It names the step's own
  // first selector, which is something the reader can find in their
  // recording -- never an internal index alone.
  function notFoundMessage(step, index) {
    const chains = (step.selectors || []).filter((c) => Array.isArray(c) && c.length > 0)
    const first = chains.length > 0 ? chains[0][0] : 'no selector'
    return `Couldn't find the element for step ${index + 1} (${first}).`
  }

  function dispatch(el, type, init) {
    el.dispatchEvent(new (el.ownerDocument.defaultView || window).Event(type, Object.assign({ bubbles: true }, init)))
  }

  // Sets a value the way a person typing would leave it: the property
  // set, then input and change, so a framework's own listeners see it.
  function setValue(el, value) {
    if ('value' in el) el.value = value
    dispatch(el, 'input')
    dispatch(el, 'change')
  }

  function keyEvent(el, type, key) {
    const view = el.ownerDocument.defaultView || window
    if (typeof view.KeyboardEvent !== 'function') {
      dispatch(el, type)
      return
    }
    el.dispatchEvent(new view.KeyboardEvent(type, { key: key || '', bubbles: true, cancelable: true }))
  }

  // Dispatches one pointer/mouse event, preferring the constructor the
  // page's own listeners expect. A browser that refuses to construct
  // one falls back to a plain Event rather than failing the step: the
  // step's real effect is the click/focus that follows, not this.
  function pointer(el, type) {
    const view = el.ownerDocument.defaultView || window
    const Ctor = type.startsWith('pointer') && typeof view.PointerEvent === 'function'
      ? view.PointerEvent
      : view.MouseEvent
    try {
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true }))
    } catch {
      dispatch(el, type)
    }
  }

  // Runs one step against the current document. Returns
  // {status, error?, extracted?} -- never throws, so one bad step
  // reports rather than tearing the whole run down with a stack.
  //
  // `navigate` is absent on purpose: only the extension's background
  // worker can drive a tab, so it handles that step itself.
  async function runStep(step, index, root) {
    const scope = root || document
    try {
      switch (step.type) {
        case 'waitForExpression': {
          const view = scope.defaultView || window
          const value = await waitFor(() => {
            try {
              return view.eval(step.expression)
            } catch {
              return false
            }
          }, stepTimeout(step))
          if (!value) return { status: 'failed', error: `The page never satisfied step ${index + 1}.` }
          return { status: 'ok' }
        }
        case 'waitForElement': {
          const wanted = step.visible === false ? null : true
          const el = await waitFor(() => resolveElement(step.selectors, scope), stepTimeout(step))
          if (!el && wanted) return { status: 'failed', error: notFoundMessage(step, index) }
          return { status: 'ok' }
        }
        case 'setViewport':
        case 'emulateNetworkConditions':
        case 'close':
          // Recorded, but nothing a page-side runner can honour: the
          // browser owns the window and the network. Reported as
          // skipped rather than silently counted as done.
          return { status: 'skipped' }
        default:
          break
      }

      const el = await waitFor(() => resolveElement(step.selectors, scope), stepTimeout(step))
      if (!el) return { status: 'failed', error: notFoundMessage(step, index) }
      // Bringing the element into view is a courtesy to whoever is
      // watching the tab, never a reason a step fails -- a browser that
      // does not implement it must not turn a good step into a bad one.
      try {
        if (el.scrollIntoView) el.scrollIntoView({ block: 'center' })
      } catch {
        /* not scrollable here */
      }

      switch (step.type) {
        case 'click':
          pointer(el, 'pointerdown')
          pointer(el, 'mousedown')
          pointer(el, 'mouseup')
          el.click()
          break
        case 'doubleClick':
          el.click()
          el.click()
          pointer(el, 'dblclick')
          break
        case 'hover':
          pointer(el, 'pointerover')
          pointer(el, 'mouseover')
          break
        case 'change':
          if (el.focus) el.focus()
          setValue(el, step.value ?? '')
          break
        case 'keyDown':
          if (el.focus) el.focus()
          keyEvent(el, 'keydown', step.key)
          break
        case 'keyUp':
          keyEvent(el, 'keyup', step.key)
          break
        case 'scroll':
          if (el.scrollTo) el.scrollTo(step.x || 0, step.y || 0)
          break
        default:
          return { status: 'failed', error: `Step ${index + 1} uses something this browser can't replay.` }
      }
      const extracted = typeof el.value === 'string' ? el.value : (el.textContent || '').trim()
      return { status: 'ok', extracted: extracted.slice(0, 200) }
    } catch (err) {
      return { status: 'failed', error: `Step ${index + 1} couldn't run in this page.`, detail: String(err) }
    }
  }

  global.MillReplayRunner = { parseSelector, resolveElement, resolveChain, runStep, notFoundMessage, accessibleName }
})(typeof globalThis !== 'undefined' ? globalThis : this)
