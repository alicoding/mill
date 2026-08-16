import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { AtlasFocusRequest } from './AtlasBoard'

// The pulse ring's own lifetime (goal 0072 slice B): two 600ms
// iterations of the card nodes' pulse animation, or the
// reduced-motion static-outline's flat 1.5s -- kept beside the state
// clear so it and the CSS animation duration can't drift apart.
const PULSE_MS = 1200
const PULSE_MS_REDUCED = 1500
const HINT_LIFETIME_MS = 3000

// The board's jump-focus behavior (goal 0072 slice B), split from
// AtlasBoard at the 500-line convention: the fly-to-target camera
// move, the pulse, and the transient Enter-to-open hint, with the
// latest-ref plumbing that keeps AtlasView's per-render callbacks
// from tearing down an in-flight hint.
export function useBoardFocus({ focusRequest, renderedIDs, reduceMotion, fitBounds, getNodesBounds, wrapperRef, onFocusHandled, onOpenOverlay, setPulsedID, setHintedID, hintedID }: {
  focusRequest: AtlasFocusRequest | null
  renderedIDs: Set<string>
  reduceMotion: boolean
  fitBounds: (bounds: { x: number; y: number; width: number; height: number }, opts: { duration: number; padding: number }) => Promise<boolean>
  getNodesBounds: (ids: string[]) => { x: number; y: number; width: number; height: number }
  wrapperRef: RefObject<HTMLDivElement | null>
  onFocusHandled: () => void
  onOpenOverlay: (id: string) => void
  setPulsedID: (fn: (cur: string | null) => string | null) => void
  setHintedID: (fn: (cur: string | null) => string | null) => void
  hintedID: string | null
}) {
  // AtlasView redefines onFocusHandled/onOpenOverlay inline on every one
  // of ITS OWN renders (unrelated to this board's pulse/hint state) --
  // latest-refs so the effect below reads the current callback without
  // taking a dependency on its identity, which would otherwise re-run
  // the effect (and its cleanup, dismissing an in-progress hint) on any
  // unrelated AtlasView re-render during the fly/pulse/hint window.
  const onFocusHandledRef = useRef(onFocusHandled)
  const onOpenOverlayRef = useRef(onOpenOverlay)
  useEffect(() => {
    onFocusHandledRef.current = onFocusHandled
    onOpenOverlayRef.current = onOpenOverlay
  }, [onFocusHandled, onOpenOverlay])

  // The ⌘K jump's fly (or immediate overlay open for ⌘↵): waits for
  // the target to actually be present in this board's rendered nodes
  // (a re-root AtlasView triggered first needs its own render pass
  // before the target exists here), then flies the camera to it at
  // ~zoom 1 by fitting a viewport-sized box centered on the node
  // rather than the node's own tiny bounds (fitBounds always clamps to
  // this pane's own maxZoom, which a 190x128 note card would otherwise
  // hit long before reaching "roughly full-size"). Clearing
  // focusRequest (onFocusHandled) deliberately happens here, once the
  // fly resolves -- setting pulsedID/hintedID is the ONLY other thing
  // this effect does; their own dismiss lifecycle lives in the
  // separate hint effect below, keyed on hintedID alone, specifically
  // so clearing focusRequest here (which re-runs THIS effect's own
  // cleanup on the next render) can never tear down a hint it just set.
  useEffect(() => {
    if (!focusRequest || !renderedIDs.has(focusRequest.cardID)) return
    let cancelled = false
    const nodeRect = getNodesBounds([focusRequest.cardID])
    const container = wrapperRef.current?.getBoundingClientRect()
    const w = container?.width ?? 800
    const h = container?.height ?? 600
    const cx = nodeRect.x + nodeRect.width / 2
    const cy = nodeRect.y + nodeRect.height / 2
    const bounds = { x: cx - w / 2, y: cy - h / 2, width: w, height: h }

    void fitBounds(bounds, { duration: reduceMotion ? 0 : 500, padding: 0 }).then(() => {
      if (cancelled) return
      onFocusHandledRef.current()
      if (focusRequest.openImmediately) {
        onOpenOverlayRef.current(focusRequest.cardID)
        return
      }
      const cardID = focusRequest.cardID
      setPulsedID(() => cardID)
      setHintedID(() => cardID)
      window.setTimeout(() => setPulsedID((cur) => (cur === cardID ? null : cur)), reduceMotion ? PULSE_MS_REDUCED : PULSE_MS)
    })

    return () => {
      cancelled = true
    }
  }, [focusRequest, renderedIDs, reduceMotion, fitBounds, getNodesBounds])

  // The hint chip's own lifecycle -- deliberately a separate effect
  // keyed only on hintedID (not on focusRequest, pulsedID, or any
  // callback identity), so its listeners/timer live and die exactly
  // with the hint itself: lives 3s, or until any keydown/pointerdown
  // (Enter opens the overlay first; any other key/click just dismisses).
  useEffect(() => {
    if (!hintedID) return
    const cardID = hintedID
    const dismiss = () => setHintedID((cur) => (cur === cardID ? null : cur))
    const onKeyDown = (e: KeyboardEvent) => {
      // Deferred one macrotask, not called inline: opening the overlay
      // (mounting Dialog's own focus trap) synchronously inside this
      // native keydown handler raced with that same trap's initial
      // focus-in, and the trap's focus-in on the still-live keydown
      // dispatch immediately closed the dialog it had just opened.
      if (e.key === 'Enter') window.setTimeout(() => onOpenOverlayRef.current(cardID), 0)
      dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', dismiss)
    const timer = window.setTimeout(dismiss, HINT_LIFETIME_MS)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', dismiss)
      window.clearTimeout(timer)
    }
  }, [hintedID])
}
