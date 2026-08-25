import type { BoardObject, Card, Kind, Link, LinkKind, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { BoardFilter } from './cardFilter'
import type { AtlasFocusRequest } from './useBoardFocus'
import type { AtlasGroupRequest, AtlasPlacementRequest, AtlasPromoteRequest } from './useAtlasCreation'

// AtlasBoardInner's own prop contract -- pulled out of AtlasBoard.tsx
// at the 500-line seam (architecture.md's convention): a pure type
// definition with no closure over the component's own state, so it
// moves cleanly without touching behavior.
export interface AtlasBoardInnerProps {
  // The board filter (goal 0129 slice 1) -- applied as dim-in-place
  // by the node builder; state lives in AtlasView; rendered as a
  // floating top-right Panel (the toolbar row is full by its own
  // recorded constraint, and a canvas filter belongs on the canvas).
  boardFilter: BoardFilter
  onBoardFilterChange: (next: BoardFilter) => void
  filterMatchCount: number
  filterTotalCount: number
  // Offerable kind facets = kinds of the RENDERED leaves (frame
  // children included) -- computed by AtlasView beside the counts.
  filterPresentKindIDs: Set<string>
  cards: Card[]
  allCards: Card[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  // Notes (goal 0081 slice A1) -- this board's own container's notes
  // only, same "already scoped by the caller" contract `cards` uses.
  // parentID is the board's CURRENT container (AtlasView's viewedID).
  notes: Note[]
  // Board objects (goal 0179/0180): board-local canvas nouns (image,
  // ink, ...), scoped to this container the same way notes are; objects
  // has no allObjects counterpart since an object never renders inside
  // a region frame's own preview (S1 -- see AtlasBoardObjectNode.tsx).
  objects: BoardObject[]
  parentID: string
  // Arrange-is-an-action (goal 0089): a one-shot token; each bump
  // runs the packer over this level and PERSISTS the result.
  arrangeRequest?: number
  viewedID: string
  focusRequest: AtlasFocusRequest | null
  onDrill: (id: string) => void
  onOpenOverlay: (id: string) => void
  onFocusHandled: () => void
  // Right-click on a card (goal 0075): the board only reports WHERE
  // and ON WHAT -- AtlasView owns the menu items (it holds the
  // card/share/delete context this component deliberately doesn't).
  onCardContextMenu: (cardID: string, pos: { x: number; y: number }) => void
  // Right-click on empty board (goal 0075's audit G3): same
  // where-only contract as the card opener above.
  onPaneContextMenu: (pos: { x: number; y: number }) => void
  // Right-click on an artery (goal 0075 G4, goal 0081 A4's edge menu):
  // endpoints + its representative link id/count -- count gates the kind/label/remove items to 1.
  onArteryContextMenu: (sourceID: string, targetID: string, linkID: string, count: number, pos: { x: number; y: number }) => void
  // The edge hover chip's own two actions -- the SAME handlers the right-click artery menu's own items call.
  onEdgeDeleteLink: (linkID: string) => void
  onEdgeChangeKind: (linkID: string, pos: { x: number; y: number }) => void
  // Right-click on a note (goal 0081 slice A1): same where/what-only
  // contract as onCardContextMenu -- AtlasView owns Promote/Delete.
  onNoteContextMenu: (noteID: string, pos: { x: number; y: number }) => void
  // Right-click on a board object (goal 0179/0180): same where/what-
  // only contract -- AtlasView owns Promote to card/Delete.
  onObjectContextMenu: (objectID: string, pos: { x: number; y: number }) => void
  // Right-click on a frame's own header/border (goal 0081 slice A2,
  // LOCKED design §6d): reports the frame's own card id -- AtlasView
  // builds Add-inside/Zoom/Dissolve/Delete.
  onFrameContextMenu: (frameID: string, pos: { x: number; y: number }) => void
  // Right-click on a frame's interior empty space: reports the
  // frame's card id -- AtlasView builds the frame-scoped Add pair.
  onFrameInteriorContextMenu: (frameID: string, pos: { x: number; y: number }) => void
  // Right-click on a 2+ multi-selection member: reports the split
  // card/note/object ids -- AtlasView builds Group into new area / Delete.
  onMultiSelectContextMenu: (cardIDs: string[], noteIDs: string[], objectIDs: string[], pos: { x: number; y: number }) => void
  // Keyboard Delete/Backspace over the live selection (goal 0089
  // rider): routed through the same confirm dialog as the menu item;
  // React Flow's own deleteKeyCode stays disabled -- a local node
  // removal would just resurrect on the next data refresh. objectIDs is
  // optional so the eraser's own gesture.onEnd (tools/eraserTool.ts,
  // cards/notes only in S1) keeps calling this with two arguments.
  onDeleteSelection: (cardIDs: string[], noteIDs: string[], objectIDs?: string[]) => void
  onPasteConverted: (res: import('../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models').PasteResult) => void
  onQuietToast: (text: string, action?: { label: string; run: () => void }) => void
  onOpenNote: (id: string) => void
  allNotes: import('../../bindings/github.com/alicoding/mill/internal/domain/atlas/models').Note[]
  onCreateTableSized: (cols: number, rows: number, at?: { X: number; Y: number }, parentID?: string) => void
  onOpenTableFromList: () => void
  // The selection tray's own "Group into new area" -- the multi-select context menu's own dispatcher, reused.
  onGroupSelection: (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => void
  // AtlasView's downward creation requests (pane-menu adds, promote,
  // frame placements, group) -- useAtlasCreation.ts has the shape.
  placementRequest?: AtlasPlacementRequest | null
  promoteRequest?: AtlasPromoteRequest | null
  groupRequest?: AtlasGroupRequest | null
}
