import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { MirrorKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { BoardObject, MirrorContent } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { sheetTruncationNote, truncateSheetRows } from './atlasSheetTruncate'
import { TABLE_WIDTH, TABLE_HEIGHT } from './atlasBoardLayout'
import runbookStyles from '../shared/ListCard.module.css'
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
export function AtlasSheetObjectContent({ object, mirrorVersion }: { object: BoardObject; mirrorVersion: number }) {
  const { t } = useTranslation('atlas')
  const [content, setContent] = useState<MirrorContent | null>(null)
  const [fetchError, setFetchError] = useState('')
  const [rows, setRows] = useState<SheetRows | null>(null)
  const [parseFailed, setParseFailed] = useState(false)

  const fetchContent = useCallback(() => {
    AtlasService.ObjectMirrorContent(object.ID)
      .then(setContent)
      .catch((err) => setFetchError(String(err)))
  }, [object.ID])

  useEffect(() => {
    setContent(null)
    setRows(null)
    setParseFailed(false)
    setFetchError('')
    fetchContent()
  }, [object.ID, fetchContent])

  // mirrorVersion starts at 0 for a freshly mounted node and only
  // increments on a REAL fsnotify-observed change (AtlasBoardObjectNode.tsx)
  // -- skipping the initial 0 avoids a redundant second fetch alongside
  // the identity effect above's own mount-time fetch.
  const mountedVersion = useRef(mirrorVersion)
  useEffect(() => {
    if (mirrorVersion !== mountedVersion.current) fetchContent()
  }, [mirrorVersion, fetchContent])

  useEffect(() => {
    if (!content || content.Missing || content.TooLarge) return
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

  const openInDefaultApp = () => {
    AtlasService.OpenObjectMirrorInDefaultApp(object.ID).catch(() => {
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
