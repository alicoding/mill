import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Table } from '@primer/react/experimental'
import styles from './ResizableTable.module.css'

// Drag-to-resize columns for Primer's DataTable, plus the
// truncate-with-hover-tooltip cell that pairs with it (docs/SPEC.md
// §3.8's long-column pattern, asked for directly). Primer's DataTable
// lays out as CSS grid (grid-template-columns: var(--grid-template-columns),
// verified against its compiled CSS -- not a <table> layout), so
// native CSS `resize:` on a header can't drive column widths; instead
// each header gets a small drag handle that rewrites the table's own
// --grid-template-columns custom property with concrete pixel tracks.
// One shared wrapper establishes the pattern for every DataTable
// surface rather than per-page reimplementations.
//
// Known bound (deliberate, not a bug): a re-render that changes the
// table's own inline style (e.g. clicking a sort header) resets any
// manual widths to the column definitions' defaults -- the resize is a
// viewing aid, not persisted state.
export function ResizableTableContainer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const table = root.querySelector('table')
    if (!table) return

    const headers = Array.from(table.querySelectorAll('th'))
    const cleanups: (() => void)[] = []

    headers.forEach((th, index) => {
      // The last column keeps flexing to fill the container.
      if (index === headers.length - 1) return
      if (th.querySelector(`.${styles.handle}`)) return
      th.classList.add(styles.resizableHeader)

      const handle = document.createElement('span')
      handle.className = styles.handle
      handle.setAttribute('data-testid', 'column-resize-handle')
      handle.setAttribute('aria-hidden', 'true')

      const onPointerDown = (down: PointerEvent) => {
        down.preventDefault()
        down.stopPropagation()
        handle.setPointerCapture(down.pointerId)
        handle.setAttribute('data-dragging', 'true')
        // Freeze every track at its current rendered pixel width, then
        // adjust only the dragged one -- getComputedStyle resolves the
        // grid template to used px values regardless of how the column
        // definitions expressed them (grow/auto/minmax).
        const tracks = getComputedStyle(table).gridTemplateColumns.split(' ').map((v) => parseFloat(v))
        const startX = down.clientX
        const startWidth = tracks[index]

        const onMove = (move: PointerEvent) => {
          const next = [...tracks]
          next[index] = Math.max(48, startWidth + (move.clientX - startX))
          table.style.setProperty('--grid-template-columns', next.map((w) => `${w}px`).join(' '))
        }
        const onUp = () => {
          handle.removeAttribute('data-dragging')
          handle.removeEventListener('pointermove', onMove)
          handle.removeEventListener('pointerup', onUp)
        }
        handle.addEventListener('pointermove', onMove)
        handle.addEventListener('pointerup', onUp)
      }

      handle.addEventListener('pointerdown', onPointerDown)
      th.appendChild(handle)
      cleanups.push(() => {
        handle.removeEventListener('pointerdown', onPointerDown)
        handle.remove()
        th.classList.remove(styles.resizableHeader)
      })
    })

    return () => cleanups.forEach((fn) => fn())
    // Re-attach on every render: React reconciliation can replace the
    // header row (a sort click re-renders it), which silently discards
    // imperatively-added handles.
  })

  return (
    <div ref={ref}>
      <Table.Container>{children}</Table.Container>
    </div>
  )
}

// The cell half of the pattern: truncate to the column's width, show
// the full value on hover via the browser's own title tooltip.
export function TruncatedCell({ text }: { text: string }) {
  return <span className={styles.truncate} title={text}>{text}</span>
}
