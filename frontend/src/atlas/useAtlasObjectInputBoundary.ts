import { useEffect, type RefObject } from 'react'
import { scrollChainTo, wheelStaysLocal, type AtlasActivation } from './atlasActivation'

// The board object's own input boundary (goal 0354): wheel routing and
// the keyboard boundary, owned by the frame rather than by each face.
// Native listeners, not React props -- React registers `wheel`
// passively at its own root, so an onWheel handler cannot
// preventDefault, and the key boundary below has to run before that
// root dispatches anything.
//
// Wheel: the node box carries `nowheel` in every live state, so the
// canvas kit stands down over the WHOLE object -- the frame then hands
// the gesture back to the canvas whenever nothing under the pointer can
// consume it (atlasActivation.ts's wheelStaysLocal). Re-dispatching on
// the kit's own zoom pane is what makes the hand-back reach it: the
// pane resolves `nowheel` from the event's own target, and the
// synthetic event's target is the pane itself, never anything inside
// the object.
//
// Keys: the board's own keymap listens on window, so this box is the
// boundary. An event whose target is a real editor is left untouched --
// stopping propagation here would ALSO stop React dispatching that
// editor's own handlers, since React listens above this box. Escape
// while selected hands the keyboard back to the object: the canvas node
// takes focus, so the next Escape reaches the board's own ladder.
export function useAtlasObjectInputBoundary(boxRef: RefObject<HTMLDivElement | null>, state: AtlasActivation): void {
  useEffect(() => {
    const box = boxRef.current
    if (!box || state === 'idle') return undefined
    const onWheel = (e: WheelEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (wheelStaysLocal(e.defaultPrevented, scrollChainTo(target, box))) return
      const pane = box.closest('.react-flow__renderer')
      if (!pane) return
      e.preventDefault()
      pane.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      }))
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (state === 'editing') {
        e.stopPropagation()
        return
      }
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      const node = box.closest('.react-flow__node')
      if (node instanceof HTMLElement) node.focus()
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    box.addEventListener('keydown', onKeyDown)
    return () => {
      box.removeEventListener('wheel', onWheel)
      box.removeEventListener('keydown', onKeyDown)
    }
  }, [boxRef, state])
}
