import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges, useNodes, useReactFlow } from '@xyflow/react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { ClipboardHistoryService } from '../shared/bindings'
import { blobToBase64 } from '../shared/base64Blob'
import { useBuildInfoStore } from '../shared/buildInfoStore'
import { downloadBlob } from '../shared/downloadBlob'
import { pushNotice } from '../shared/noticeStore'
import { useUISignalStore } from '../shared/uiSignalStore'
import { UNEXPECTED_CODE, appTranslate, messageOf, userErrorFrom } from '../shared/userError'
import { AtlasImageExportDialog, type ImageExportSettings } from './AtlasImageExportDialog'
import { IMAGE_COPY_SCALE, copiedNoticeKey, edgeIDsWithin, imageFilename, padBounds, rasterizeBoard, resolveBoardBackground } from './atlasImageExport'

// The board's own image-capture door (docs/goals/0201): mounted inside
// the board so it can read React Flow's live nodes/edges and the
// board's real DOM, and so the two registry commands stay pure signals
// the way every other Atlas board command already is.
//
// Both commands act on the CURRENT selection and widen to the whole
// board when nothing is selected. Nothing here is disabled for an empty
// selection.
//
// The clipboard write goes to the HOST through Go, never
// navigator.clipboard: that API is secure-context-only, so a Mill
// server reached over plain http from another device has none of it
// (.claude/rules/frontend.md). The consequence is disclosed rather than
// hidden, because on a remote device the picture lands on the DESKTOP's
// clipboard, not this one's.

// The monotonic-counter consumption every Atlas command signal already
// uses (useAtlasCommandSignals.ts), as a hook so both requests read the
// same way. A `latest` ref keeps the effect off the callback's identity,
// which changes whenever the board's nodes do.
function useSignal(request: number, run: () => void) {
  const latest = useRef(run)
  useEffect(() => { latest.current = run })
  const last = useRef(request)
  useEffect(() => {
    if (request === last.current) return
    last.current = request
    latest.current()
  }, [request])
}

export function AtlasImageExportHost({ wrapperRef, viewedID, allCards }: {
  wrapperRef: RefObject<HTMLDivElement | null>
  viewedID: string
  allCards: Card[]
}) {
  const { t } = useTranslation('atlas')
  const nodes = useNodes()
  const edges = useEdges()
  const { getNodesBounds } = useReactFlow()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const failureText = useCallback((err: unknown) => {
    const userError = userErrorFrom(err)
    // A rejection thrown on this side carries no code, and its message
    // is a developer diagnostic rather than copy.
    return userError.code === UNEXPECTED_CODE ? t('imageExport.failed') : messageOf(userError, appTranslate)
  }, [t])

  const capture = useCallback(async ({ scale, transparent }: ImageExportSettings) => {
    const viewport = wrapperRef.current?.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewport) throw new Error('the board viewport is not mounted')
    const selected = nodes.filter((n) => n.selected)
    const scoped = selected.length > 0
    const inScope = scoped ? selected : nodes
    const nodeIDs = scoped ? new Set(inScope.map((n) => n.id)) : null
    const blob = await rasterizeBoard({
      viewport,
      bounds: padBounds(getNodesBounds(inScope)),
      scope: { nodeIDs, edgeIDs: nodeIDs ? edgeIDsWithin(edges, nodeIDs) : null },
      scale,
      backgroundColor: transparent ? null : resolveBoardBackground(viewport),
    })
    return { blob, scoped }
  }, [edges, getNodesBounds, nodes, wrapperRef])

  const copyImage = useCallback(() => {
    void (async () => {
      try {
        const { blob, scoped } = await capture({ scale: IMAGE_COPY_SCALE, transparent: false })
        await ClipboardHistoryService.CopyImagePNG(await blobToBase64(blob))
        // Server mode writes the DESKTOP's clipboard, never this
        // device's -- the notice says so rather than letting a paste
        // that produces nothing look like a bug.
        const remote = !useBuildInfoStore.getState().isDesktop
        pushNotice({
          level: 'success',
          source: 'atlas.selection.copyAsImage',
          text: t(copiedNoticeKey(scoped, remote)),
        })
      } catch (err) {
        pushNotice({ level: 'error', source: 'atlas.selection.copyAsImage', text: failureText(err) })
      }
    })()
  }, [capture, failureText, t])

  const exportImage = useCallback((settings: ImageExportSettings) => {
    void (async () => {
      setBusy(true)
      try {
        const { blob, scoped } = await capture(settings)
        const title = allCards.find((c) => c.ID === viewedID)?.Title || t('breadcrumbRoot')
        downloadBlob(imageFilename(scoped ? t('imageExport.selectionFilename', { title }) : title), blob)
        setDialogOpen(false)
      } catch (err) {
        pushNotice({ level: 'error', source: 'atlas.selection.exportAsImage', text: failureText(err) })
      } finally {
        setBusy(false)
      }
    })()
  }, [allCards, capture, failureText, t, viewedID])

  useSignal(useUISignalStore((s) => s.atlasCopyImageRequest), copyImage)
  useSignal(useUISignalStore((s) => s.atlasExportImageRequest), useCallback(() => setDialogOpen(true), []))

  if (!dialogOpen) return null
  return <AtlasImageExportDialog busy={busy} onCancel={() => setDialogOpen(false)} onExport={exportImage} />
}
