import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataEditorRef, Rectangle } from '@glideapps/glide-data-grid'
import type { GridColumn } from './listGridTypes'
import type { Anchor } from './ListGridGlideMenus'
import { resolvePendingRename } from './listGridGlideRename'

// The column-rename overlay's own open/close, split out of
// ListGridGlide.tsx at the 500-line convention (CLAUDE.md): everything
// about WHEN a rename opens -- a menu click's real anchor, or a fresh
// column's own arrival -- lives here; ListGridGlide.tsx only renders
// the returned `renaming` state and feeds it insertColumn's resolved
// key through `armPendingRename`.
export function useListGridGlideRename(gridRef: React.RefObject<DataEditorRef | null>, columns: GridColumn[], toAnchor: (bounds: Rectangle) => Anchor, closeMenu: () => void) {
  const [renaming, setRenaming] = useState<{ key: string; at: Anchor } | null>(null)
  const closeRename = useCallback(() => setRenaming(null), [])

  // Bounds are valid only after the grid reports the region: getBounds
  // on a column the grid has not yet painted returns a zero-width
  // rectangle (getBoundsForItem scales against the canvas's own
  // measured clientRect, which is 0 before the grid's first layout
  // pass -- confirmed against the vendored source). This is never the
  // READINESS signal (see the pending-rename block below); it is
  // called only once a column is already known to be in the grid's
  // own reported visible range, to compute where to anchor the
  // overlay.
  const getColumnBounds = useCallback((col: number) => {
    const bounds = gridRef.current?.getBounds(col, -1)
    return bounds && bounds.width > 0 ? bounds : undefined
  }, [gridRef])

  const openRename = useCallback((col: number, at?: Anchor) => {
    const column = columns[col]
    if (!column) return
    closeMenu()
    if (at) {
      setRenaming({ key: column.Key, at })
      return
    }
    const bounds = getColumnBounds(col)
    if (bounds) setRenaming({ key: column.Key, at: toAnchor(bounds) })
  }, [columns, toAnchor, getColumnBounds, closeMenu])

  // A fresh column opens its rename once the grid's own
  // onVisibleRegionChanged reports it inside the visible range -- the
  // grid's own readiness signal (resolvePendingRename), never a bounds
  // probe. The intent lives in STATE, not a ref: when the list starts
  // empty, the DataEditor mounts only once the first column exists,
  // and its FIRST region report can land before or after the insert's
  // own round trip sets the pending key -- and, independently, before
  // or after `columns` itself comes to include the new key (the round
  // trip that resolves the key and the one that lands it in the list's
  // own store are separate). State makes the key's own arrival
  // re-check against the most recently reported range (visibleRangeRef)
  // no matter which of the three landed last. A pendingKey naming a
  // column that never arrives (removed before the insert round-tripped)
  // never resolves -- resolvePendingRename finds no such column and
  // stays null -- so the intent is dropped by simply never firing,
  // never by a guard that could fire before `columns` has caught up.
  const [pendingRenameKey, setPendingRenameKey] = useState<string | null>(null)
  const visibleRangeRef = useRef<Rectangle | null>(null)

  // visibleRangeRef holds the MOST RECENT report from whichever grid
  // INSTANCE is currently mounted -- an empty list unmounts the
  // DataEditor entirely, so a range reported by a PRIOR instance
  // describes a canvas that no longer exists. Left stale, a pending
  // key set after that instance is gone can satisfy resolvePendingRename
  // against geometry the new, not-yet-painted instance never reported
  // -- openRename then reads getBounds on a column the new canvas
  // hasn't laid out yet, gets an empty rectangle, and the intent is
  // dropped for good (goal 0390 amendment 2: the second add-column in
  // schema-evolution.spec.ts, after the first column's removal
  // remounts the grid). Clearing it exactly when the grid unmounts
  // means every mount's resolution can only ever use THAT mount's own
  // reports.
  useEffect(() => {
    if (columns.length === 0) visibleRangeRef.current = null
  }, [columns.length])

  // Resolving (is the pending column inside the reported range?) and
  // opening it (which reads real pixel bounds) are two different
  // moments: the library reports the region and updates its own
  // canvas-sizing state in the SAME event, so the canvas's pixel
  // width the bounds read from is only current once THIS component
  // has re-rendered past that event -- never synchronously inside the
  // callback that reported it (confirmed against the vendored
  // source's getBoundsForItem, which scales against the canvas's
  // client width from that same state). resolvedRenameCol records the
  // resolution; the effect below opens it on the NEXT render, after
  // the commit both this component's and the library's state landed
  // in has already happened.
  const [resolvedRenameCol, setResolvedRenameCol] = useState<number | null>(null)
  // A pending column already landed in `columns` but still outside the
  // reported range is off screen, not un-ready -- an unsized table
  // object's own width caps below its full content width
  // (atlasTableWidth.ts's TABLE_MAX_WIDTH), so a column past the cap
  // never enters the grid's visible range on its own (goal 0390
  // amendment 2: atlas-table-object.spec.ts's widening test). The
  // grid's own scrollTo (DataEditorRef, the same ref family as
  // getBounds) brings it into view; its own onVisibleRegionChanged
  // report -- never this call's return value -- is what resolves the
  // rename, so this fires at most once per pending key.
  const scrolledForKeyRef = useRef<string | null>(null)
  const tryResolvePendingRename = useCallback((range: Rectangle | null) => {
    const col = resolvePendingRename(columns, pendingRenameKey, range)
    if (col !== null) {
      setPendingRenameKey(null)
      setResolvedRenameCol(col)
      scrolledForKeyRef.current = null
      return
    }
    if (pendingRenameKey === null || range === null || scrolledForKeyRef.current === pendingRenameKey) return
    const pendingCol = columns.findIndex((c) => c.Key === pendingRenameKey)
    if (pendingCol !== -1 && (pendingCol < range.x || pendingCol >= range.x + range.width)) {
      scrolledForKeyRef.current = pendingRenameKey
      gridRef.current?.scrollTo(pendingCol, -1, 'horizontal')
    }
  }, [columns, pendingRenameKey, gridRef])
  const onVisibleRegionChanged = useCallback((range: Rectangle) => {
    visibleRangeRef.current = range
    tryResolvePendingRename(range)
  }, [tryResolvePendingRename])
  useEffect(() => {
    if (pendingRenameKey === null) return
    tryResolvePendingRename(visibleRangeRef.current)
  }, [pendingRenameKey, columns, tryResolvePendingRename])
  useEffect(() => {
    if (resolvedRenameCol === null) return
    setResolvedRenameCol(null)
    openRename(resolvedRenameCol)
  }, [resolvedRenameCol, openRename])

  return { renaming, closeRename, openRename, armPendingRename: setPendingRenameKey, onVisibleRegionChanged }
}
