import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { MirrorKind } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { BoardObject, MirrorContent } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { boardObjectContentFor } from '../atlasNounRegistry'
import { dispatchObjectEdit } from '../objectSeams'
import type { MirrorReadState } from '../useAtlasObjectMirrorRead'
import { sheetTruncationNote, truncateSheetRows } from '../atlasSheetTruncate'
import { TABLE_WIDTH, TABLE_HEIGHT } from '../atlasBoardLayout'
import runbookStyles from '../../shared/ListCard.module.css'
import styles from './AtlasSheetObjectContent.module.css'

type SheetRows = unknown[][]

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
async function parseSheet(content: MirrorContent): Promise<SheetRows> {
  if (content.Kind === MirrorKind.MirrorKindSheet) {
    const { readSheet } = await import('read-excel-file/universal')
    const rows = await readSheet(base64ToArrayBuffer(content.Content))
    return rows as SheetRows
  }
  const Papa = (await import('papaparse')).default
  return Papa.parse<string[]>(content.Content, { skipEmptyLines: true }).data
}

// A "sheet" object's own persisted render (goal 0232 S2): the first
// slice of the file-backed preview/open/watch contract's own S2
// consumer (goal 0232 S1) with a genuinely new renderer, rather than
// migrating an existing one. Read-only by construction -- there is no
// edit affordance anywhere in this component; the only door onto the
// real file is "Open in default app" (object.openInDefaultApp,
// rendered generically by useAtlasObjectMenu.ts's context menu, plus
// the button below for the unreadable state so the empty state itself
// offers the action it names).
export function AtlasSheetObjectContent({ object, mirrorContent }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState }) {
  const { t } = useTranslation('atlas')
  const content = mirrorContent?.content
  const fetchError = mirrorContent?.error ?? ''
  const [rows, setRows] = useState<SheetRows | null>(null)
  const [parseFailed, setParseFailed] = useState(false)

  // content is now the host's own settled read (ADR-0046, goal 0244
  // S1b) rather than something this component fetches -- !content
  // covers both "not yet loaded" and the identity-change reset the old
  // local fetch effect used to perform explicitly, so rows/parseFailed
  // clear here exactly when they used to.
  useEffect(() => {
    if (!content || content.Missing || content.TooLarge) {
      setRows(null)
      setParseFailed(false)
      return undefined
    }
    let stale = false
    setParseFailed(false)
    parseSheet(content)
      .then((parsed) => {
        if (!stale) setRows(parsed)
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
    dispatchObjectEdit(object, editRoute).catch(() => {
      // The context menu's own "Open in default app" item surfaces the
      // same failure via its onError toast -- this button is a second
      // entry point to the identical RPC, not a second error surface.
    })
  }

  // rows only ever becomes non-null once content exists, is neither
  // Missing nor TooLarge, and parsing actually succeeded (the parse
  // effect above never runs at all for Missing/TooLarge, and never
  // calls setRows on a parse failure) -- so these branches are
  // mutually exclusive in exactly this order, never nested.
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
  } else if (!rows) {
    inner = <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-sheet-loading">{t('overlay.mirrorLoading')}</Text>
  } else {
    const capped = truncateSheetRows(rows)
    const note = sheetTruncationNote(capped)
    const [header, ...body] = capped.rows
    inner = (
      <>
        <div className={`${styles.scroll} nowheel nodrag`}>
          <table className={styles.table} data-testid="atlas-object-sheet-grid">
            {header && (
              <thead>
                <tr>
                  {header.map((cell, i) => <th key={i}>{formatCell(cell)}</th>)}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => <td key={c}>{formatCell(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    <div className={styles.wrap} style={style}>
      {inner}
    </div>
  )
}
