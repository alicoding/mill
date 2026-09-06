import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { AtlasService } from '../shared/bindings'
import { pushNotice } from '../shared/noticeStore'
import { copy } from '../shared/copy'
import { useUISignalStore } from '../shared/uiSignalStore'

// The creation dock's "From file…" door (goal 0355). Picking a file and
// dropping one land through the SAME routing -- useAtlasNativeFileDrop's
// own landFiles, which resolves the path, honours every extension claim
// and enablement toggle, and falls back to a reference card -- so the
// two doors can never diverge on what a given file becomes. This hook
// only answers WHICH file and WHERE it lands.
//
// Also the consumer of atlas.addFile's own signal
// (shared/atlasBoardCommands.ts): the dock's flyout item and the
// palette both run that one command, never a second inline handler.
export function useAtlasPickBoardFile({ landFiles, wrapperRef }: {
  landFiles: (filenames: string[], screenPoint: { x: number; y: number }) => Promise<unknown>
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  // A picked file has no drop point of its own, so it lands at the
  // board's visible centre -- where the person who opened the dialog is
  // already looking.
  const pick = useCallback(() => {
    AtlasService.PickBoardFile()
      .then((path) => {
        if (!path) return // cancelled -- nothing was asked for
        const box = wrapperRef.current?.getBoundingClientRect()
        const point = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: 0, y: 0 }
        return landFiles([path], point)
      })
      .catch(() => pushNotice({ level: 'error', text: copy('atlas:capture.pickError') }))
  }, [landFiles, wrapperRef])

  const latest = useRef(pick)
  useEffect(() => { latest.current = pick })
  const request = useUISignalStore((s) => s.atlasAddFileRequest)
  const lastRequest = useRef(request)
  useEffect(() => {
    if (request === lastRequest.current) return
    lastRequest.current = request
    latest.current()
  }, [request])

  return pick
}
