import { buildFrameSrcdoc, hostTokenReader, measureScriptUrl, millTokenCss, type MeasureFrameInit } from '../app/pluginFrameBootstrap'
import { CanvasProtocolError, type ObjectMeasureMessage } from './canvasToolProtocol'

// object.measure's host side (docs/goals/0380 Decision 3): the answer
// to the one gap no precedent closes -- a sandboxed extension whose
// face needs to know how big its own content turned out. Mill lays the
// markup out itself, in a throwaway sandboxed frame parked off-screen
// at real pixel size (a face is CSS-scaled with the board, so anything
// measured in place answers the wrong number at any zoom but 1), and
// hands back two numbers.
//
// One frame per measurement, removed as soon as it answers: a
// measurement is a rare, one-shot question, and a reused frame would
// have to carry state between two extensions' questions for no gain.

const MEASURE_TIMEOUT_MS = 5_000

let nextCallId = 0

// measureMarkup renders `markup` off-screen and resolves with the size
// it took. A frame that never answers -- a document that wedges its
// own layout -- rejects rather than leaving the caller pending.
export function measureMarkup(pluginId: string, message: ObjectMeasureMessage): Promise<{ width: number; height: number }> {
  nextCallId += 1
  const callId = nextCallId
  const init: MeasureFrameInit = { callId, markup: message.markup, maxWidth: message.maxWidth }
  const script = measureScriptUrl()
  // The base is the app's own origin rather than the plugin's folder:
  // this document holds no plugin page and loads no plugin asset, only
  // the markup handed in and Mill's own measuring script.
  const base = new URL('/', window.location.href).href
  const srcdoc = buildFrameSrcdoc(base, [script], '', init, millTokenCss(hostTokenReader()))

  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('data-testid', `plugin-measure-frame-${pluginId}`)
  frame.setAttribute('title', `${pluginId} measuring stage`)
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:absolute;left:-100000px;top:0;width:0;height:0;border:0'

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      frame.remove()
      fn()
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow) return
      const data = event.data as { mill?: number; kind?: string; callId?: number; width?: number; height?: number } | null
      if (!data || data.mill !== 1 || data.kind !== 'measure.result' || data.callId !== callId) return
      const width = Number(data.width)
      const height = Number(data.height)
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        finish(() => reject(new CanvasProtocolError('measure', 'answered with a size that is not a number')))
        return
      }
      finish(() => resolve({ width, height }))
    }
    const timer = setTimeout(() => {
      finish(() => reject(new CanvasProtocolError('measure', 'took too long to lay out')))
    }, MEASURE_TIMEOUT_MS)
    window.addEventListener('message', onMessage)
    document.body.appendChild(frame)
    frame.srcdoc = srcdoc
  })
}
