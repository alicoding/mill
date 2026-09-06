import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Stack, Text, TextInput } from '@primer/react'
import { FileCodeIcon, FoldIcon, SearchIcon, UnfoldIcon } from '@primer/octicons-react'
import type { BoardObject } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { boardObjectContentFor } from '../atlasNounRegistry'
import { dispatchObjectEdit } from '../objectSeams'
import { background } from '../../shared/background'
import { JsonTree } from '../../shared/JsonTree'
import { matchCount, nodeCopyText, type JsonNode } from '../../shared/jsonTreeModel'
import type { ContextMenuItem } from '../../shared/ContextMenu'
import { runCommand } from '../../shared/commands'
import { useUISignalStore } from '../../shared/uiSignalStore'
import type { MirrorReadState } from '../useAtlasObjectMirrorRead'
import { isParseError, jsonFormatFor, parseJsonDocument, type JsonDocFormat, type JsonParseError } from '../jsonTree'
import { TABLE_WIDTH, TABLE_HEIGHT } from '../atlasBoardLayout'
import runbookStyles from '../../shared/ListCard.module.css'
import nodeStyles from '../AtlasBoardObjectNode.module.css'
import styles from './AtlasJsonObjectContent.module.css'

// A "json" object's own persisted render (goal 0269): a dropped
// .json/.yaml/.yml file as an indented, collapsible tree -- the form
// seven of the eight researched inspectors show a document in. Nothing
// here edits: "Open in default app" is the editor, and the tree is
// structure over the same text.
//
// The tree itself is shared/JsonTree.tsx (Primer's TreeView, goal
// 0326's component), reached with this surface's own root-less paths,
// its depth-2 arrival state and its three registry copy commands --
// one JSON tree in the app, configured per surface.

// Past this size the arrival state opens one level instead of two and
// Expand all is refused: a file this large unrolled at once is tens of
// thousands of rows in a board-sized box.
const LARGE_FILE_BYTES = 1_000_000

interface FaceState {
  value: unknown
  error: JsonParseError | null
}

function formatMirrorSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

// The non-tree states this face can land in before there is a parsed
// document to show a row of -- pulled out of the component so adding
// the preview short-circuit above it doesn't also grow ITS cognitive
// complexity (scripts/check-go-coverage.sh's frontend twin, the
// sonarjs gate, caps this at 15).
function emptyStateFor(args: {
  fetchError: string
  content: MirrorReadState['content'] | undefined
  isEmpty: boolean
  parsed: FaceState | null
  format: JsonDocFormat
  t: (key: string, opts?: Record<string, unknown>) => string
  openDoor: ReactNode
}): ReactNode | null {
  const { fetchError, content, isEmpty, parsed, format, t, openDoor } = args
  if (fetchError) return <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-object-json-error">{fetchError}</Text>
  if (!content) return <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-json-loading">{t('overlay.mirrorLoading')}</Text>
  if (content.Missing) {
    return (
      <Stack direction="vertical" gap="condensed" data-testid="atlas-object-json-unreadable">
        <Text as="p" size="small" className={runbookStyles.error}>{t(`json.unreadable.${format}`)}</Text>
        {openDoor}
      </Stack>
    )
  }
  if (content.TooLarge) {
    // Past the server's own preview cap the bytes never reach the
    // browser at all, so there is no tree to build -- the file's own
    // app is the only door left, and the state says so rather than
    // sitting on a spinner.
    return (
      <Stack direction="vertical" gap="condensed" data-testid="atlas-object-json-too-large">
        <Text as="p" size="small" className={runbookStyles.muted}>{t('overlay.mirrorTooLarge', { size: formatMirrorSize(content.Size) })}</Text>
        {openDoor}
      </Stack>
    )
  }
  if (isEmpty) {
    return (
      <Stack direction="vertical" gap="condensed" data-testid="atlas-object-json-empty">
        <Text as="p" size="small" className={runbookStyles.muted}>{t('json.empty')}</Text>
        {openDoor}
      </Stack>
    )
  }
  if (parsed?.error) {
    return (
      <Stack direction="vertical" gap="condensed" data-testid="atlas-object-json-parse-error">
        <Text as="p" size="small" className={runbookStyles.error}>{t(`json.unreadable.${format}`)}</Text>
        <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-json-parse-detail">
          {parseDetail(parsed.error)}
        </Text>
        {openDoor}
      </Stack>
    )
  }
  if (!parsed) return <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-json-loading">{t('overlay.mirrorLoading')}</Text>
  return null
}

function frameStyle(hasSize: boolean) {
  const base = { display: 'flex', flexDirection: 'column' as const, gap: 4 }
  // A persisted Size wins forever once a resize happens (goal 0193);
  // before that the box follows the same TABLE_WIDTH/TABLE_HEIGHT
  // footprint every other grid-shaped board object lands at, so a
  // one-key document and a deep one open at the same readable size.
  return hasSize ? { ...base, width: '100%', height: '100%' } : { ...base, width: TABLE_WIDTH, height: 'auto', maxHeight: TABLE_HEIGHT }
}

export function AtlasJsonObjectContent({ object, mirrorContent, preview, onEditingChange }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState; preview?: boolean; onEditingChange?: (editing: boolean) => void }) {
  const { t } = useTranslation('atlas')
  // This face lives inside a React Flow node's own scaled/translated
  // subtree, where a locally-rendered menu's position:fixed anchor
  // resolves against that transform instead of the viewport (goal
  // 0346) -- the row's menu opens through the board's own top-level
  // renderer instead of one JsonTree would otherwise render in place.
  const requestContextMenu = useUISignalStore((s) => s.requestAtlasContextMenu)
  const content = mirrorContent?.content
  const fetchError = mirrorContent?.error ?? ''
  const format: JsonDocFormat = jsonFormatFor(object.Payload?.mirrorPath ?? '')
  const [parsed, setParsed] = useState<FaceState | null>(null)
  const [query, setQuery] = useState('')
  // The tree has no in-place VALUE editor, so the filter input is this
  // face's whole editing state (goal 0354): while it holds focus the
  // board's own shortcuts must stand down, or a typed key reaches the
  // canvas instead of the field. Reported through an effect rather than
  // straight from onFocus/onBlur so an unmount while focused (the
  // object deselected out from under the field) still hands the frame
  // its `false`, which a blur that never fires would not.
  const [filterFocused, setFilterFocused] = useState(false)
  useEffect(() => {
    onEditingChange?.(filterFocused)
    return () => onEditingChange?.(false)
  }, [filterFocused, onEditingChange])
  const [expandToken, setExpandToken] = useState(0)
  const [collapseToken, setCollapseToken] = useState(0)
  const [focusedRow, setFocusedRow] = useState<JsonNode | null>(null)
  const text = content?.Content ?? ''
  const isEmpty = !!content && !content.Missing && !content.TooLarge && text.trim() === ''
  const isLarge = (content?.Size ?? 0) > LARGE_FILE_BYTES

  // A mirror change re-parses in place; JsonTree stays mounted, so
  // every path still present keeps whatever expansion it had.
  useEffect(() => {
    if (!content || content.Missing || content.TooLarge || text.trim() === '') {
      setParsed(null)
      return undefined
    }
    let stale = false
    void parseJsonDocument(text, format).then((result) => {
      if (stale) return
      setParsed(isParseError(result) ? { value: null, error: result.error } : { value: result.value, error: null })
    })
    return () => { stale = true }
  }, [content, text, format])

  // A frame's preview tile never renders the tree -- the same call
  // diagram/pdf make for their own engines (goal 0267): the tile is
  // capped and nothing in it is interactable, so the filter input,
  // expand/collapse buttons, and treeitem rows this face renders below
  // would otherwise sit focusable inside an aria-hidden preview.
  if (preview) {
    return (
      <div className={nodeStyles.placeholder} data-testid="atlas-object-json-preview-tile">
        <FileCodeIcon size={24} />
      </div>
    )
  }

  // ADR-0046 (goal 0244 S0): the button declares no editor of its own
  // -- it reads this Kind's registered editRoute back and hands it to
  // the host's dispatchObjectEdit, the one place that calls the
  // service.
  const openInDefaultApp = () => {
    const editRoute = boardObjectContentFor(object.Kind)?.editRoute
    if (!editRoute) return
    void background(dispatchObjectEdit(object, editRoute), 'atlasJsonObjectContent.openInDefaultApp')
  }

  const openDoor = (
    <Button size="small" onClick={openInDefaultApp} data-testid="atlas-object-json-open-in-default-app">
      {t('contextMenu.openInDefaultApp')}
    </Button>
  )

  const rowContext = (node: JsonNode) => ({ kind: 'jsonNode' as const, path: node.path, key: node.key, value: nodeCopyText(node) })

  const rowMenuItems = (node: JsonNode): ContextMenuItem[] => [
    { id: 'copy-value', commandId: 'atlas.json.copyValue', ctx: rowContext(node) },
    { id: 'copy-path', commandId: 'atlas.json.copyPath', ctx: rowContext(node) },
    { id: 'copy-key', commandId: 'atlas.json.copyKey', ctx: rowContext(node) },
  ]

  const emptyState = emptyStateFor({ fetchError, content, isEmpty, parsed, format, t, openDoor })
  let inner: ReactNode
  if (emptyState) {
    inner = emptyState
  } else if (parsed) {
    const matches = matchCount(parsed.value, query, '')
    inner = (
      <>
        <Stack direction="horizontal" gap="condensed" align="center" className={styles.toolbar}>
          <TextInput
            className={styles.filter}
            size="small"
            leadingVisual={SearchIcon}
            value={query}
            aria-label={t('json.filterLabel')}
            placeholder={t('json.filterLabel')}
            onChange={(e) => setQuery(e.target.value)}
            // The field owns its own keys (the board must not act on a
            // typed character), and Escape is the way back out of it --
            // blurring hands the frame its `editing` false, the same
            // exit every other face's in-place editor offers.
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
            onFocus={() => setFilterFocused(true)}
            onBlur={() => setFilterFocused(false)}
            data-testid="atlas-object-json-filter"
          />
          <IconButton
            icon={UnfoldIcon}
            aria-label={t('json.expandAll')}
            title={isLarge ? t('json.expandAllRefused') : t('json.expandAll')}
            size="small"
            variant="invisible"
            disabled={isLarge}
            onClick={() => setExpandToken((n) => n + 1)}
            data-testid="atlas-object-json-expand-all"
          />
          <IconButton
            icon={FoldIcon}
            aria-label={t('json.collapseAll')}
            title={t('json.collapseAll')}
            size="small"
            variant="invisible"
            onClick={() => setCollapseToken((n) => n + 1)}
            data-testid="atlas-object-json-collapse-all"
          />
        </Stack>
        {query !== '' && (
          <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-json-matches">
            {matches === 0 ? t('json.noMatches') : t('json.matches', { count: matches })}
          </Text>
        )}
        <div
          className={`${styles.scroll} nowheel nodrag`}
          onKeyDown={(e) => {
            // Cmd+C copies the focused row's value, the inspector
            // convention. The keystroke never reaches the generic
            // dispatcher (the command needs a row only this face can
            // name), so it runs here with the row as the target.
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && focusedRow) {
              e.stopPropagation()
              void runCommand('atlas.json.copyValue', rowContext(focusedRow))
            }
          }}
        >
          <JsonTree
            value={parsed.value}
            query={query}
            expandAllToken={expandToken}
            collapseAllToken={collapseToken}
            rootPath=""
            defaultExpandDepth={isLarge ? 1 : 2}
            rowMenuItems={rowMenuItems}
            onOpenContextMenu={requestContextMenu}
            filterRows
            onFocusedRowChange={setFocusedRow}
            ariaLabel={t('boardObject.jsonAriaLabel')}
            testId="atlas-object-json-tree"
          />
        </div>
      </>
    )
  }

  return (
    <div className={styles.wrap} style={frameStyle(!!object.Size)}>
      {inner}
    </div>
  )
}

// The parser's own sentence, with the place it failed when it knows
// one -- what a reader takes back to the file.
function parseDetail(error: JsonParseError): string {
  if (error.line === undefined) return error.message
  return `${error.line}:${error.column ?? 1} ${error.message}`
}
