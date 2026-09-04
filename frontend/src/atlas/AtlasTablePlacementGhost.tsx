import { useEffect, useRef, type RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Text } from '@primer/react'
import { TABLE_HEIGHT, TABLE_WIDTH } from './atlasBoardLayout'
import styles from './AtlasBoard.module.css'

// The placement preview (goal 0273): after the size picker arms the
// table tool, the footprint the next click will land follows the
// pointer, carrying the name the table will be minted with. The
// converged create-by-pointing pattern -- the preview IS the placement,
// so "where does it go" is answered before the click, not after it.
//
// The footprint follows the pointer by writing a transform straight to
// the node: a pointer move is a per-frame event, and routing it through
// React state would re-render the whole board on every one.
export function AtlasTablePlacementGhost({ size, wrapperRef, title }: {
  size: { cols: number; rows: number }
  wrapperRef: RefObject<HTMLDivElement | null>
  title: string
}) {
  const ghostRef = useRef<HTMLDivElement>(null)
  const { getViewport } = useReactFlow()

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onMove = (e: MouseEvent) => {
      const el = ghostRef.current
      if (!el) return
      const rect = wrapper.getBoundingClientRect()
      const { zoom } = getViewport()
      el.style.width = `${TABLE_WIDTH * zoom}px`
      el.style.height = `${TABLE_HEIGHT * zoom}px`
      el.style.transform = `translate(${e.clientX - rect.left}px, ${e.clientY - rect.top}px)`
      // Hidden until the pointer has actually said where it is -- a
      // ghost parked at the wrapper's corner would name a landing spot
      // the user never pointed at.
      el.style.display = 'block'
    }
    const onLeave = () => {
      if (ghostRef.current) ghostRef.current.style.display = 'none'
    }
    wrapper.addEventListener('mousemove', onMove)
    wrapper.addEventListener('mouseleave', onLeave)
    return () => {
      wrapper.removeEventListener('mousemove', onMove)
      wrapper.removeEventListener('mouseleave', onLeave)
    }
  }, [wrapperRef, getViewport])

  return (
    <div
      ref={ghostRef}
      className={styles.tableGhost}
      data-testid="atlas-table-ghost"
      data-cols={size.cols}
      data-rows={size.rows}
      style={{ display: 'none' }}
    >
      <Text size="small" className={styles.tableGhostLabel}>{title}</Text>
    </div>
  )
}
