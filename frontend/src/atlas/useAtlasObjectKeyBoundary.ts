import { useEffect, type RefObject } from 'react'
import type { AtlasActivation } from './atlasActivation'

// The board object's keyboard boundary (goal 0354), owned by the frame
// rather than by each face. A native listener, not a React prop: the
// board's own keymap listens on window, so this box has to run before
// React's root dispatches anything.
//
// An event whose target is a real editor is left untouched -- stopping
// propagation here would ALSO stop React dispatching that editor's own
// handlers, since React listens above this box. Escape while selected
// hands the keyboard back to the object: the canvas node takes focus,
// so the next Escape reaches the board's own ladder.
//
// The wheel needs no code at all: a live face carries the canvas kit's
// own `nowheel` class (atlasActivation.ts's faceOwnsInput), which the
// kit resolves by ancestry, and nothing ever hands a wheel back to the
// canvas.
export function useAtlasObjectKeyBoundary(boxRef: RefObject<HTMLDivElement | null>, state: AtlasActivation): void {
  useEffect(() => {
    const box = boxRef.current
    if (!box || state === 'idle') return undefined
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
    box.addEventListener('keydown', onKeyDown)
    return () => {
      box.removeEventListener('keydown', onKeyDown)
    }
  }, [boxRef, state])
}
