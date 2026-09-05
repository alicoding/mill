import { useEffect, useRef, useState } from 'react'
import { registerFlusher } from '../../shared/flushRegistry'
import { useSaveMode } from '../../shared/saveMode'
import { DirtyDot } from '../../shared/DirtyDot'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { MirrorKind } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { BoardObject, MirrorContent } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { boardObjectContentFor } from '../atlasNounRegistry'
import { dispatchObjectEdit, writeObjectMirror } from '../objectSeams'
import { background } from '../../shared/background'
import type { MirrorReadState } from '../useAtlasObjectMirrorRead'
import type { CsvEditModel } from '../atlasCsvQuickEdit'
import { SHEET_MAX_COLS, SHEET_MAX_ROWS, sheetTruncationNote, truncateSheetRows } from '../atlasSheetTruncate'
import { extensionSetting, useExtensionSettingsStore } from '../../shared/extensionSettingsStore'
import { TABLE_WIDTH, TABLE_HEIGHT } from '../atlasBoardLayout'
import runbookStyles from '../../shared/ListCard.module.css'
import styles from './AtlasSheetObjectContent.module.css'

type SheetRows = unknown[][]

// The parsed sheet, tagged by which rung it sits on: an xlsx renders
// read-only (every researched writer either rewrites lossily or is
// dormant -- goal 0239 S2's data-stewardship refusal; revisit when an
// in-place editor earns a track record), a csv carries the full-
// fidelity edit model quick-edit serializes back through.
type ParsedSheet =
  | { kind: 'readonly'; rows: SheetRows }
  | { kind: 'csv'; model: CsvEditModel }

interface CellEdit { row: number; col: number; value: string }

// Explicit save mode's held cells (goal 0295 S2b), keyed by display
// row and column.
const cellKey = (row: number, col: number) => `${row}:${col}`
const parseCellKey = (key: string): { row: number; col: number } => {
  const [row, col] = key.split(':').map(Number)
  return { row, col }
}

function formatMirrorSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

// Dynamically imported per-format (goal 0232 S2's own bundle-strategy
// research): a board without any sheet object never pays for either
// parser, matching the vendored drawio viewer's own lazy-load
// precedent (useDrawioRendering.ts) one level up (this whole content
// component is already React.lazy-loaded from tools/sheetNoun.ts).
// read-excel-file's own `/universal` export takes a Blob/ArrayBuffer
// and runs single-threaded (no Web Worker) -- the right fit for files
// already capped at mirrorPreviewMaxBytes server-side.
async function parseSheet(content: MirrorContent): Promise<ParsedSheet> {
  if (content.Kind === MirrorKind.MirrorKindSheet) {
    const { readSheet } = await import('read-excel-file/universal')
    const rows = await readSheet(base64ToArrayBuffer(content.Content))
    return { kind: 'readonly', rows: rows as SheetRows }
  }
  const { parseCsvForEdit: parse } = await import('../atlasCsvQuickEdit')
  return { kind: 'csv', model: parse(content.Content) }
}

// A "sheet" object's own persisted render (goal 0232 S2), grown a
// middle rung by goal 0239 S2: a csv-backed sheet quick-edits in
// place -- double-click a cell, type, Enter (or click away) commits
// the whole file back through the same write door the embedded
// diagram editor saves through; Escape cancels. The deep edit stays
// "Open in default app" (object.openInDefaultApp, rendered generically
// by useAtlasObjectMenu.ts's context menu, plus the button below for
// the unreadable state so the empty state itself offers the action it
// names). An xlsx keeps the read-only preview: no edit affordance at
// all.
export function AtlasSheetObjectContent({ object, mirrorContent, onEditingChange }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState; onEditingChange?: (editing: boolean) => void }) {
  const { t } = useTranslation('atlas')
  // The sheet noun's declared preview caps (goal 0258 slice 1) --
  // subscribed, not just read, so a cap change in Settings re-renders
  // every open sheet live.
  useExtensionSettingsStore((s) => s.values)
  const previewRows = extensionSetting('sheet', 'previewRows', SHEET_MAX_ROWS)
  const previewCols = extensionSetting('sheet', 'previewCols', SHEET_MAX_COLS)
  const content = mirrorContent?.content
  const fetchError = mirrorContent?.error ?? ''
  const [parsed, setParsed] = useState<ParsedSheet | null>(null)
  const [parseFailed, setParseFailed] = useState(false)
  const [editing, setEditing] = useState<CellEdit | null>(null)
  const [writeError, setWriteError] = useState(false)
  // The in-place cell editor's own open/close, reported to the frame
  // (goal 0354) -- what turns this object's activation state into
  // `editing` while a cell input is mounted.
  useEffect(() => { onEditingChange?.(editing !== null) }, [editing, onEditingChange])
  const saveMode = useSaveMode()
  // Cells committed (Enter / click-away) but not yet written -- only
  // ever non-empty in explicit save mode. Rendered over the parsed
  // grid; one write for all of them on ⌘S / Save all.
  const [pendingCells, setPendingCells] = useState<Map<string, string>>(() => new Map())
  const pendingRef = useRef(pendingCells)
  useEffect(() => {
    pendingRef.current = pendingCells
  }, [pendingCells])
  const wrapRef = useRef<HTMLDivElement>(null)
  // Escape cancels by clearing this ref BEFORE the editor unmounts --
  // the input's own blur (which commits) may still fire during that
  // unmount, and must find nothing to commit. Synced by effect (never
  // written during render); the cancel/edit handlers below keep it
  // current within a single event turn themselves.
  const editingRef = useRef<CellEdit | null>(null)
  useEffect(() => {
    editingRef.current = editing
  }, [editing])

  // content is the host's own settled read (ADR-0046, goal 0244 S1b)
  // -- !content covers both "not yet loaded" and the identity-change
  // reset, so parsed/parseFailed clear here exactly when they used to.
  // An open cell editor survives a refresh landing mid-edit (our own
  // write's watch echo, or an external change): the value being typed
  // lives in `editing`, not in the re-parsed grid.
  useEffect(() => {
    if (!content || content.Missing || content.TooLarge) {
      setParsed(null)
      setParseFailed(false)
      return undefined
    }
    let stale = false
    setParseFailed(false)
    parseSheet(content)
      .then((next) => {
        if (!stale) setParsed(next)
      })
      .catch(() => {
        if (!stale) setParseFailed(true)
      })
    return () => {
      stale = true
    }
  }, [content])

  // ADR-0046 (goal 0244 S0): this button declares no editor of its own
  // -- it reads sheet's own registered editRoute back and hands it to
  // the host's dispatchObjectEdit (objectSeams.ts), which is the one
  // place that actually calls AtlasService.
  const openInDefaultApp = () => {
    const editRoute = boardObjectContentFor(object.Kind)?.editRoute
    if (!editRoute) return
    // The context menu's own "Open in default app" item surfaces the
    // same failure via its onError toast -- this button is a second
    // entry point to the identical RPC, not a second error surface.
    void background(dispatchObjectEdit(object, editRoute), 'atlasSheetObjectContent.openInDefaultApp')
  }

  const cancelEdit = () => {
    editingRef.current = null
    setEditing(null)
  }

  // A cell mid-edit, or any held cell, is a live edit the leave
  // handshake settles (shared/flushRegistry.ts, goal 0295 S2): in
  // automatic mode the flusher is commitEdit; in explicit mode it is
  // the one write of every held cell (the open cell included). Reached
  // through refs so the registration never goes stale; the discard
  // drops every held cell and the open editor; the root lets ⌘S find
  // this sheet by focus.
  const commitEditRef = useRef<() => void>(() => {})
  const flushPendingRef = useRef<() => void | Promise<void>>(() => {})
  const saveModeRef = useRef(saveMode)
  useEffect(() => {
    saveModeRef.current = saveMode
  }, [saveMode])
  const hasPending = pendingCells.size > 0
  useEffect(() => {
    if (!editing && !hasPending) return
    return registerFlusher(`sheet:${object.ID}`, {
      flush: () => (saveModeRef.current === 'explicit' ? flushPendingRef.current() : commitEditRef.current()),
      discard: () => {
        editingRef.current = null
        setEditing(null)
        setPendingCells(new Map())
      },
      root: () => wrapRef.current,
    })
  }, [editing, hasPending, object.ID])
  const savedValue = (row: number, col: number): string => (parsed?.kind === 'csv' ? parsed.model.displayRows[row]?.[col] ?? '' : '')
  // Explicit mode: the whole held set, plus the open cell, as ONE write.
  const flushPending = (): void | Promise<void> => {
    if (parsed?.kind !== 'csv') return
    const edits = new Map(pendingRef.current)
    const open = editingRef.current
    if (open) {
      cancelEdit()
      if (open.value !== savedValue(open.row, open.col)) edits.set(cellKey(open.row, open.col), open.value)
      else edits.delete(cellKey(open.row, open.col))
    }
    if (edits.size === 0) {
      setPendingCells(new Map())
      return
    }
    return import('../atlasCsvQuickEdit').then(({ parseCsvForEdit, serializeCellEdits }) => {
      const text = serializeCellEdits(parsed.model, Array.from(edits, ([key, value]) => ({ ...parseCellKey(key), value })))
      setParsed({ kind: 'csv', model: parseCsvForEdit(text) })
      setPendingCells(new Map())
      setWriteError(false)
      return writeObjectMirror(object.ID, text).catch(() => {
        setParsed({ kind: 'csv', model: parseCsvForEdit(content?.Content ?? '') })
        setPendingCells(edits)
        setWriteError(true)
      })
    })
  }
  useEffect(() => {
    flushPendingRef.current = flushPending
  })
  const commitEdit = () => {
    const edit = editingRef.current
    if (!edit || parsed?.kind !== 'csv') return
    cancelEdit()
    const current = savedValue(edit.row, edit.col)
    if (saveMode === 'explicit') {
      // Held, not written: the cell shows its new value with the
      // dirty marker until ⌘S / Save all writes the file.
      setPendingCells((prev) => {
        const next = new Map(prev)
        if (edit.value === current) next.delete(cellKey(edit.row, edit.col))
        else next.set(cellKey(edit.row, edit.col), edit.value)
        return next
      })
      return
    }
    if (edit.value === current) return
    // The dynamic import resolves from cache -- parseSheet already
    // loaded this module before any csv model could exist.
    void import('../atlasCsvQuickEdit').then(({ parseCsvForEdit, serializeCellEdit }) => {
      const text = serializeCellEdit(parsed.model, edit.row, edit.col, edit.value)
      // Optimistic: the grid shows the committed value immediately;
      // the mirror watch's own refresh re-parses the same bytes right
      // after.
      setParsed({ kind: 'csv', model: parseCsvForEdit(text) })
      setWriteError(false)
      return writeObjectMirror(object.ID, text).catch(() => {
        // Revert to the last content the host actually read -- the
        // file never changed -- and say so inline.
        setParsed({ kind: 'csv', model: parseCsvForEdit(content?.Content ?? '') })
        setWriteError(true)
      })
    })
  }
  useEffect(() => {
    commitEditRef.current = commitEdit
  })

  const editableCell = (row: number, col: number, cell: unknown, isHeader: boolean): ReactNode => {
    const Tag = isHeader ? 'th' : 'td'
    if (editing && editing.row === row && editing.col === col) {
      return (
        <Tag key={col} className={styles.editingCell}>
          <input
            className={styles.cellInput}
            data-testid="atlas-object-sheet-cell-input"
            value={editing.value}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setEditing({ row, col, value: e.target.value })}
            onKeyDown={(e) => {
              // Enter commits, Escape cancels -- both stop here so the
              // board's own window-level listeners (tool disarm,
              // gesture cancel) never see a keystroke meant for the
              // cell.
              if (e.key === 'Enter') {
                e.stopPropagation()
                commitEdit()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                cancelEdit()
              }
            }}
            onBlur={commitEdit}
          />
        </Tag>
      )
    }
    const editable = parsed?.kind === 'csv'
    const pending = pendingCells.get(cellKey(row, col))
    const shown = pending ?? formatCell(cell)
    return (
      <Tag
        key={col}
        className={pending !== undefined ? styles.pendingCell : undefined}
        data-pending={pending !== undefined ? 'true' : undefined}
        onDoubleClick={
          editable
            ? (e) => {
                e.stopPropagation()
                setWriteError(false)
                setEditing({ row, col, value: shown })
              }
            : undefined
        }
      >
        {shown}
      </Tag>
    )
  }

  // parsed only ever becomes non-null once content exists, is neither
  // Missing nor TooLarge, and parsing actually succeeded -- so these
  // branches are mutually exclusive in exactly this order, never
  // nested.
  let inner: ReactNode
  if (fetchError) {
    inner = <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-object-sheet-error">{fetchError}</Text>
  } else if (!content) {
    inner = <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-sheet-loading">{t('overlay.mirrorLoading')}</Text>
  } else if (content.Missing || parseFailed) {
    inner = (
      <Stack direction="vertical" gap="condensed" data-testid="atlas-object-sheet-unreadable">
        <Text as="p" size="small" className={runbookStyles.error}>{t('sheet.unreadable')}</Text>
        <Button size="small" onClick={openInDefaultApp} data-testid="atlas-object-sheet-open-in-default-app">
          {t('contextMenu.openInDefaultApp')}
        </Button>
      </Stack>
    )
  } else if (content.TooLarge) {
    inner = (
      <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-sheet-fallback">
        {t('overlay.mirrorTooLarge', { size: formatMirrorSize(content.Size) })}
      </Text>
    )
  } else if (!parsed) {
    inner = <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-sheet-loading">{t('overlay.mirrorLoading')}</Text>
  } else {
    const displayRows = parsed.kind === 'csv' ? parsed.model.displayRows : parsed.rows
    const capped = truncateSheetRows(displayRows, previewRows, previewCols)
    const note = sheetTruncationNote(capped, previewRows, previewCols)
    const [header, ...body] = capped.rows
    inner = (
      <>
        <div className={`${styles.scroll} nowheel nodrag`}>
          <table className={styles.table} data-testid="atlas-object-sheet-grid">
            {header && (
              <thead>
                <tr>
                  {header.map((cell, i) => editableCell(0, i, cell, true))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => editableCell(r + 1, c, cell, false))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {writeError && (
          <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-object-sheet-write-error">
            {t('sheet.writeFailed')}
          </Text>
        )}
        {note && (
          <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-sheet-truncated">
            {t(note.key, note.values)}
          </Text>
        )}
      </>
    )
  }

  // A persisted Size wins forever once a resize happens (goal 0193);
  // before that, the box follows its own natural footprint -- the same
  // TABLE_WIDTH ceiling/TABLE_HEIGHT scroll-cap AtlasTableObjectContent.tsx
  // already establishes for a grid-shaped board object, reused here
  // rather than a second set of constants -- so a small (loading/
  // unreadable) or large (a real grid) render never collapses to a
  // near-zero footprint the board's own fixed chrome (the creation
  // tray) could sit on top of.
  const hasSize = !!object.Size
  const style = hasSize
    ? { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const, gap: 4 }
    : { width: TABLE_WIDTH, height: 'auto', maxHeight: TABLE_HEIGHT, display: 'flex', flexDirection: 'column' as const, gap: 4 }
  return (
    <div ref={wrapRef} className={styles.wrap} style={style}>
      {hasPending && <DirtyDot testId="atlas-object-sheet-unsaved-dot" />}
      {inner}
    </div>
  )
}
