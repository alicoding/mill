import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { newLocalID } from '../shared/localId'
import { modalSurfaceOpen } from '../shared/modalGate'
import type { CanvasStore } from './canvasStore'
import { materializeCanvasClones, parseWorkflowClonePayload, serializeCanvasSelection } from './canvasClipboard'

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

// The canvas's copy/paste door (docs/goals/0153): ⌘C serializes the
// selection through the copy EVENT's own clipboardData (synchronous,
// works in insecure contexts -- the remote-instance posture
// frontend.md guards), ⌘V materializes a recognized payload at the
// cursor. Copy works read-only too (copying is a read); paste
// respects readOnly. Document-level listeners live only while the
// canvas is mounted -- views are exclusive, so no other surface can
// receive them.
export function useCanvasClipboard({ store, readOnly, screenToFlowPosition, flash }: {
  // The canvas's own per-instance store (created in component state,
  // never a module singleton -- canvasStore.ts's own contract).
  store: CanvasStore
  readOnly: boolean
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  flash: (message: string) => void
}) {
  const { t } = useTranslation('composition')
  const lastMouse = useRef<{ x: number; y: number } | null>(null)
  const stateRef = useRef({ store, readOnly, screenToFlowPosition, flash, t })
  useEffect(() => {
    stateRef.current = { store, readOnly, screenToFlowPosition, flash, t }
  }, [store, readOnly, screenToFlowPosition, flash, t])

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }
    const onCopy = (e: ClipboardEvent) => {
      // A modal above the canvas owns the screen (shared/modalGate.ts):
      // copying here would silently overwrite the clipboard with a
      // hidden canvas selection.
      if (modalSurfaceOpen()) return
      if (isEditableTarget(document.activeElement)) return
      if (window.getSelection()?.toString()) return
      const { nodes, edges, notes } = stateRef.current.store.getState()
      const payload = serializeCanvasSelection(nodes, edges, notes)
      if (!payload) {
        if (nodes.some((n) => n.selected && n.data.kind === 'trigger')) {
          e.preventDefault()
          stateRef.current.flash(stateRef.current.t('canvasClipboard.triggerRefusal'))
        }
        return
      }
      e.preventDefault()
      e.clipboardData?.setData('text/plain', JSON.stringify(payload))
      stateRef.current.flash(stateRef.current.t('canvasClipboard.copied', { count: payload.nodes.length + payload.notes.length }))
    }
    const onPaste = (e: ClipboardEvent) => {
      const { readOnly: ro, screenToFlowPosition: toFlow, flash: show, t: tt } = stateRef.current
      if (ro) return
      // Same modal stand-down as onCopy: pasted clones would land
      // behind the open dialog.
      if (modalSurfaceOpen()) return
      if (isEditableTarget(document.activeElement)) return
      const payload = parseWorkflowClonePayload(e.clipboardData?.getData('text/plain') ?? '')
      if (!payload) return
      e.preventDefault()
      const at = lastMouse.current ? toFlow(lastMouse.current) : { x: 220, y: 220 }
      const clones = materializeCanvasClones(payload, at, newLocalID)
      stateRef.current.store.getState().addClones(clones)
      show(tt('canvasClipboard.pasted', { count: clones.nodes.length + clones.notes.length }))
    }
    window.addEventListener('pointermove', onPointerMove)
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [])
}
