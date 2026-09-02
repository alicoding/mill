import { useEffect, useRef } from 'react'
import { useUISignalStore } from '../shared/uiSignalStore'
import { atlasSpaceShareActions } from './atlasSpaceShareActions'

// AtlasView's own share of the Atlas toolbar/board command signals
// (shared/atlasBoardCommands.ts) -- split out of AtlasView.tsx
// (architecture.md's 500-line convention): atlas.arrange/atlas.export
// run the same callbacks the toolbar's own buttons already call;
// atlas.share.copyContext/copyLinks run the same space-scoped share
// actions AtlasSpaceShareMenu.tsx uses. A `latest` ref (Part G's own
// shape) so every effect always reads the current viewedID/callbacks
// without needing them in its dependency array.
export function useAtlasCommandSignals({ viewedID, onArrange, onExport, onError, onOpenContents }: {
  viewedID: string
  onArrange: () => void
  onExport: () => void
  onError: (message: string) => void
  onOpenContents: () => void
}) {
  const latest = useRef({ viewedID, onArrange, onExport, onError, onOpenContents })
  useEffect(() => {
    latest.current = { viewedID, onArrange, onExport, onError, onOpenContents }
  })

  const arrangeRequest = useUISignalStore((s) => s.atlasArrangeRequest)
  const lastArrangeRequest = useRef(arrangeRequest)
  useEffect(() => {
    if (arrangeRequest === lastArrangeRequest.current) return
    lastArrangeRequest.current = arrangeRequest
    latest.current.onArrange()
  }, [arrangeRequest])

  const contentsRequest = useUISignalStore((s) => s.atlasContentsRequest)
  const lastContentsRequest = useRef(contentsRequest)
  useEffect(() => {
    if (contentsRequest === lastContentsRequest.current) return
    lastContentsRequest.current = contentsRequest
    latest.current.onOpenContents()
  }, [contentsRequest])

  const exportRequest = useUISignalStore((s) => s.atlasExportRequest)
  const lastExportRequest = useRef(exportRequest)
  useEffect(() => {
    if (exportRequest === lastExportRequest.current) return
    lastExportRequest.current = exportRequest
    latest.current.onExport()
  }, [exportRequest])

  const shareCopyContextRequest = useUISignalStore((s) => s.atlasShareCopyContextRequest)
  const lastShareCopyContextRequest = useRef(shareCopyContextRequest)
  useEffect(() => {
    if (shareCopyContextRequest === lastShareCopyContextRequest.current) return
    lastShareCopyContextRequest.current = shareCopyContextRequest
    void atlasSpaceShareActions(latest.current.viewedID, latest.current.onError).bundleContext(false)
  }, [shareCopyContextRequest])

  const shareCopyLinksRequest = useUISignalStore((s) => s.atlasShareCopyLinksRequest)
  const lastShareCopyLinksRequest = useRef(shareCopyLinksRequest)
  useEffect(() => {
    if (shareCopyLinksRequest === lastShareCopyLinksRequest.current) return
    lastShareCopyLinksRequest.current = shareCopyLinksRequest
    void atlasSpaceShareActions(latest.current.viewedID, latest.current.onError).copyLinks()
  }, [shareCopyLinksRequest])
}
