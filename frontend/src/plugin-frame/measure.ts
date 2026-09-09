import type { MeasureFrameInit } from '../app/pluginFrameBootstrap'

// The off-board measuring stage (docs/goals/0380 Decision 3). A face
// whose own layout depends on how big its content turned out used to
// be handed a real host element to lay out in; a sandboxed extension
// can never hold one. Instead Mill renders the markup HERE -- its own
// frame, off-screen, at real pixel size and unscaled by the board's
// zoom -- and answers with the size it took.
//
// Nothing in this document is reachable from the extension: it holds
// only the markup that was measured, on an opaque origin, under a CSP
// that loads no script but this one. The answer is two numbers.
//
// Built from this TypeScript source into a self-contained IIFE
// (frontend/vite.config.frame.ts), like every other frame runtime
// entry -- never a hand-written file under public/.

;(function () {
  const initMeta = document.querySelector('meta[name="mill-frame-init"]')
  let init: MeasureFrameInit = { callId: 0, markup: '', maxWidth: 0 }
  try {
    if (initMeta) init = JSON.parse(initMeta.getAttribute('content') || '{}') as MeasureFrameInit
  } catch (err) {
    console.error('the measuring frame could not read its own mount data', err)
  }

  function answer(width: number, height: number): void {
    window.parent.postMessage({ mill: 1, kind: 'measure.result', callId: init.callId, width, height }, '*')
  }

  // width:max-content inside a max-width box is the one layout that
  // answers both questions at once: how wide the content WANTS to be,
  // capped at the caller's own maximum, and how tall it is once
  // wrapped to that width.
  const stage = document.createElement('div')
  stage.style.cssText = `position:absolute;left:-100000px;top:0;width:max-content;max-width:${Number(init.maxWidth) || 0}px`
  stage.innerHTML = init.markup
  document.body.appendChild(stage)

  // Measured after fonts settle where the browser can say so, and
  // immediately otherwise: a text block measured against a fallback
  // font answers a different height than the one that renders.
  const measure = (): void => {
    const box = stage.getBoundingClientRect()
    answer(Math.ceil(box.width), Math.ceil(box.height))
  }
  const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
  if (fonts?.ready) void fonts.ready.then(measure, measure)
  else measure()
})()
