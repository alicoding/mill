import { create } from 'zustand'

// The prescoped-import door's own tiny cross-tree request channel
// (goal 0081 slice A3, LOCKED design §3b's "2+ files or a directory
// dropped: route into the existing folder-import preview flow,
// pre-scoped"): AtlasBoard.tsx (the drop lands on the canvas) and
// AtlasCardOverlay.tsx (D5's card-foremost drop) each request a scan
// this way; AtlasFolderImport.tsx (mounted inside AtlasToolbar, a
// SIBLING of both, several levels up through AtlasView) consumes it.
// A standalone store rather than prop-drilling through AtlasView/
// AtlasToolbar -- both already sit at architecture.md's 500-line cap --
// same token-carrying shape useAtlasCreationRequests.ts already uses
// for AtlasView's OWN downward requests, just addressable without
// going through that component at all.
interface FolderImportRequest {
  root: string
  parentID: string
  token: number
}

interface FolderImportRequestState {
  request: FolderImportRequest | null
  requestFolderImport: (root: string, parentID: string) => void
}

let counter = 0

export const useAtlasFolderImportRequestStore = create<FolderImportRequestState>()((set) => ({
  request: null,
  requestFolderImport: (root, parentID) => {
    counter += 1
    set({ request: { root, parentID, token: counter } })
  },
}))
