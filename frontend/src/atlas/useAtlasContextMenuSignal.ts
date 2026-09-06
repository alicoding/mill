import { useEffect, useState } from 'react'
import type { ContextMenuState } from '../shared/ContextMenu'
import { useUISignalStore } from '../shared/uiSignalStore'

// AtlasView's own right-click menu state (goal 0075) plus the one
// extra door into it goal 0346 adds: a face that can't render its own
// menu in the right frame (a row inside a React Flow node's
// transformed subtree -- position:fixed there resolves against the
// transform, not the viewport) raises atlasContextMenuRequest instead
// of rendering one of its own. Moved straight into this same menu
// state, the set-then-consume shape shared/uiSignalStore.ts's other
// request fields already use, so it opens through the SAME context
// menu every other right-click on the board already shares. Split out
// of AtlasView.tsx (architecture.md's 500-line convention), same shape
// useAtlasNoteMenu/useAtlasObjectMenu already established for their
// own entity's menu.
export function useAtlasContextMenuSignal() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRequest = useUISignalStore((s) => s.atlasContextMenuRequest)
  const consumeContextMenuRequest = useUISignalStore((s) => s.consumeAtlasContextMenu)
  useEffect(() => {
    if (!contextMenuRequest) return
    setMenu(contextMenuRequest)
    consumeContextMenuRequest()
  }, [contextMenuRequest, consumeContextMenuRequest])
  return { menu, setMenu }
}
