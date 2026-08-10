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
// Defaults are expected to fit the container without horizontal
// scroll: long free-text columns declare width: 'growCollapse'
// (Primer's own option that may shrink below content width) plus
// TruncatedCell, so resizing is an opt-in refinement, not a repair.
//
// Resized widths persist per table via `storageKey` (the same
// localStorage-per-table convention AG Grid/TanStack column-sizing
// state established) and are reapplied after any re-render -- including
// a sort click, which previously reset them. Double-clicking any
// handle resets the table to its default widths and clears the saved
// state (the divider-double-click reset convention from AG Grid/
// Excel/Finder).
export function ResizableTableContainer({ children, storageKey }: {
  children: ReactNode
  storageKey?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const table = root.querySelector('table')
    if (!table) return

    // Column headers only -- rowHeader cells render as <th scope="row">
    // inside tbody, and counting those would misalign handle indexes
    // with grid tracks (caught by a real failing reapply-guard).
    const headers = Array.from(table.querySelectorAll('thead th'))
    const cleanups: (() => void)[] = []

    // DataTable sets --grid-template-columns as its own inline style on
    // every render (this, not React reconciliation, is why a sort click
    // used to discard manual widths). Stash its default once per table
    // element so reset can restore it without a re-render.
    if (!table.dataset.defaultGridTemplate) {
      table.dataset.defaultGridTemplate = table.style.getPropertyValue('--grid-template-columns')
    }

    const persist = () => {
      if (!storageKey) return
      const value = table.style.getPropertyValue('--grid-template-columns')
      if (value) localStorage.setItem(storageKey, value)
    }
    const reset = () => {
      table.style.setProperty('--grid-template-columns', table.dataset.defaultGridTemplate ?? '')
      if (storageKey) localStorage.removeItem(storageKey)
    }

    // Reapply persisted widths on every render -- DataTable's own
    // inline style would otherwise win (see above); this is also what
    // makes a saved layout survive a sort click. Guard on track count:
    // a table whose columns changed since the save (e.g. Activity's
    // per-workflow attribute columns) ignores the stale value.
    if (storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved && saved.split(' ').length === headers.length &&
          table.style.getPropertyValue('--grid-template-columns') !== saved) {
        table.style.setProperty('--grid-template-columns', saved)
      }
    }

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
          persist()
        }
        handle.addEventListener('pointermove', onMove)
        handle.addEventListener('pointerup', onUp)
      }

      const onDoubleClick = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        reset()
      }

      handle.addEventListener('pointerdown', onPointerDown)
      handle.addEventListener('dblclick', onDoubleClick)
      th.appendChild(handle)
      cleanups.push(() => {
        handle.removeEventListener('pointerdown', onPointerDown)
        handle.removeEventListener('dblclick', onDoubleClick)
        handle.remove()
        th.classList.remove(styles.resizableHeader)
      })
    })

    return () => cleanups.forEach((fn) => fn())
    // Re-attach on every render: React reconciliation can replace the
    // header row (a sort click re-renders it), which silently discards
    // imperatively-added handles -- and the persisted-width reapply
    // above must run again for the same reason.
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
