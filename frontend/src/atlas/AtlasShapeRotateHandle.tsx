import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AtlasService } from '../shared/bindings'
import { angleFromCenter, normalizeAngle, snapAngle } from './atlasRotation'
import { setAtlasShapeRotateLive } from './atlasShapeRotateLiveStore'
import { refreshAtlas } from './atlasStore'
import { isPrimaryButton } from './useAtlasToolGesture'
import styles from './AtlasShapeRotateHandle.module.css'

const ROTATE_SNAP_STEP = 15

// The rotate handle's own drag gesture (goal 0214) -- deliberately its
// own small pointer-event state machine rather than routed through
// useAtlasToolGesture.ts: that engine owns ARMED-tool draw gestures on
// the pane (pointerdown starts on the canvas, ctx carries
// screenToFlowPosition); this drag starts on a small fixed handle
// whose pointer routinely leaves its own bounding box mid-drag, so it
// needs window-level pointermove/pointerup listeners the way
// NodeResizer's own internal drag does, not the pane-relative point
// accumulation that engine provides. Every listener set is local to
// ONE drag (created fresh at pointerdown, torn down at pointerup/
// Escape/unmount via cleanupRef) rather than shared mutable callbacks,
// so there's no cross-render staleness to reason about.
export function AtlasShapeRotateHandle({ objectID, containerRef, baseAngle }: {
  objectID: string
  containerRef: RefObject<HTMLDivElement | null>
  baseAngle: number
}) {
  const { t } = useTranslation('atlas')
  const baseAngleRef = useRef(baseAngle)
  useEffect(() => { baseAngleRef.current = baseAngle }, [baseAngle])
  const cleanupRef = useRef<(() => void) | null>(null)
  const clickSuppressorRef = useRef<((ev: MouseEvent) => void) | null>(null)

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (!isPrimaryButton(e.button)) return
    e.stopPropagation()
    e.preventDefault()
    const startAngle = baseAngleRef.current
    let liveAngle = startAngle

    function cleanup() {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      cleanupRef.current = null
    }

    // The pointer routinely ends up over the PANE or another node by
    // the time it releases, never back over this small handle -- the
    // browser still synthesizes a native 'click' from that mousedown/
    // mouseup pair (preventDefault on pointerup does NOT suppress this
    // synthesis, confirmed live), targeting whatever is now under the
    // cursor. Left unhandled, that click reaches React Flow's own
    // pane-click deselect listener and clears the very selection this
    // drag is rotating (confirmed live: the wrapper's own `selected`
    // class was gone immediately on pointerup, no async work --
    // refreshAtlas -- involved). `once: true` self-removes after
    // exactly one click -- registered OUTSIDE cleanup() deliberately,
    // since cleanup() itself runs synchronously inside handleUp, BEFORE
    // the browser has dispatched the trailing click the listener still
    // needs to catch.
    function suppressTrailingClick(ev: MouseEvent) {
      ev.preventDefault()
      ev.stopPropagation()
    }

    function handleMove(ev: PointerEvent) {
      ev.preventDefault()
      const box = containerRef.current?.getBoundingClientRect()
      if (!box) return
      const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      let angle = angleFromCenter(center, { x: ev.clientX, y: ev.clientY })
      if (ev.shiftKey) angle = snapAngle(angle, ROTATE_SNAP_STEP)
      angle = normalizeAngle(angle)
      liveAngle = angle
      setAtlasShapeRotateLive(objectID, angle)
    }

    function handleUp(ev: PointerEvent) {
      ev.preventDefault()
      cleanup()
      if (liveAngle !== startAngle) {
        void AtlasService.SetBoardObjectRotation(objectID, liveAngle)
          .then(() => refreshAtlas())
          .finally(() => setAtlasShapeRotateLive(objectID, null))
      } else {
        setAtlasShapeRotateLive(objectID, null)
      }
    }

    // Capture phase, and preventDefault when consumed (Primer's own
    // Escape composition contract, useAtlasSelectionTray.ts's own
    // header comment): useAtlasSelectionTray's board-wide Escape
    // ladder is a BUBBLE-phase window listener registered once at
    // mount, well before this one exists (attached fresh, only for
    // this drag's duration) -- without capture + preventDefault, that
    // earlier-attached listener would run FIRST on the same keydown
    // and clear the whole board selection out from under an in-flight
    // rotate-cancel, a side effect the contract never asked for.
    function handleKeyDown(ev: KeyboardEvent) {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      cleanup()
      setAtlasShapeRotateLive(objectID, null)
    }

    cleanupRef.current = cleanup
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    // once: true is the ONLY teardown this one needs -- the browser
    // removes it the instant it fires, and a real pointer gesture
    // always ends in a click (or never fires at all if the component
    // unmounts first, in which case the unmount effect below removes
    // the still-armed listener as a safety net).
    window.addEventListener('click', suppressTrailingClick, { capture: true, once: true })
    clickSuppressorRef.current = suppressTrailingClick
    // eslint-disable-next-line react-hooks/exhaustive-deps -- containerRef is a stable ref object read at call time
  }, [objectID])

  // A shape deleted, deselected, or unmounted mid-drag must not leave
  // window listeners registered forever. The click suppressor is
  // tracked separately (not folded into cleanupRef) since its own
  // teardown must NOT happen at pointerup time -- see its own comment.
  useEffect(() => () => {
    cleanupRef.current?.()
    if (clickSuppressorRef.current) window.removeEventListener('click', clickSuppressorRef.current, { capture: true })
  }, [])

  return (
    <div
      className={styles.handle}
      data-testid="atlas-shape-rotate-handle"
      role="button"
      aria-label={t('boardObject.rotateHandleTitle')}
      title={t('boardObject.rotateHandleTitle')}
      onPointerDown={onPointerDown}
    />
  )
}
