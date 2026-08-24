import type { ReactNode } from 'react'
import type { Card, Kind, Link, LinkKind, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { refreshAtlas } from './atlasStore'
import { AtlasJumpDialog } from './AtlasJumpDialog'
import { AtlasCardOverlay } from './AtlasCardOverlay'
import { AtlasNoteOverlay } from './AtlasNoteOverlay'
import { ContextMenu, type ContextMenuState } from '../shared/ContextMenu'
import { AtlasMatrixView } from './AtlasMatrixView'
import { AtlasCoverageView } from './AtlasCoverageView'
import { AtlasKindManager } from './AtlasKindManager'
import { AtlasStructureDialogs } from './AtlasStructureDialogs'
import type { useAtlasUndoToast } from './useAtlasUndoToast'
import type { useAtlasLinkMenus } from './useAtlasLinkMenus'
import type { useAtlasContainmentMenus } from './useAtlasContainmentMenus'
import type { useAtlasDeleteConfirm } from './useAtlasDeleteConfirm'

// The rest of AtlasView's own dialogs/overlays/menus (architecture.md's
// 500-line convention -- AtlasView.tsx sits at the cap): every one of
// these is a self-contained conditional render reading AtlasView's own
// state, with no interaction contract of its own beyond what its props
// name -- pulled out wholesale rather than split by feature, since none
// of them share logic with each other, only with the state AtlasView
// still owns.
export function AtlasViewOverlays({
  jumpOpen, onCloseJump, allCards, allKinds, allLinks, allLinkKinds, jumpToCard,
  overlayCard, onCloseOverlay, undoToast, openGroupEntry, guardDelete,
  importConfirmDialog,
  tableFromListOpen, onCloseTableFromList, newSpaceOpen, onCloseNewSpace, onCreateTable, onCreateSpace,
  menu, onCloseMenu, linkMenus, containmentMenus, deleteConfirm,
  openNote, onCloseNote,
  matrixOpen, onCloseMatrix, coverageOpen, onCloseCoverage, childrenAll, kindsOpen, onCloseKinds, onOpenCardFromProjection,
}: {
  jumpOpen: boolean
  onCloseJump: () => void
  allCards: Card[]
  allKinds: Kind[]
  allLinks: Link[]
  allLinkKinds: LinkKind[]
  jumpToCard: (card: Card, openImmediately: boolean) => void
  overlayCard: Card | null
  onCloseOverlay: () => void
  undoToast: ReturnType<typeof useAtlasUndoToast>
  openGroupEntry: (target: Card) => void
  guardDelete: ReturnType<typeof useAtlasDeleteConfirm>['guardDelete']
  importConfirmDialog: ReactNode
  tableFromListOpen: boolean
  onCloseTableFromList: () => void
  newSpaceOpen: boolean
  onCloseNewSpace: () => void
  onCreateTable: (listID: string) => Promise<void>
  onCreateSpace: (kindID: string, title: string) => Promise<void>
  menu: ContextMenuState | null
  onCloseMenu: () => void
  linkMenus: ReturnType<typeof useAtlasLinkMenus>
  containmentMenus: ReturnType<typeof useAtlasContainmentMenus>
  deleteConfirm: ReturnType<typeof useAtlasDeleteConfirm>
  openNote: Note | null
  onCloseNote: () => void
  matrixOpen: boolean
  onCloseMatrix: () => void
  coverageOpen: boolean
  onCloseCoverage: () => void
  childrenAll: Card[]
  kindsOpen: boolean
  onCloseKinds: () => void
  onOpenCardFromProjection: (id: string) => void
}) {
  return (
    <>
      <AtlasJumpDialog open={jumpOpen} onClose={onCloseJump} cards={allCards} kinds={allKinds} onJump={jumpToCard} />

      {overlayCard && (
        <AtlasCardOverlay
          card={overlayCard}
          kinds={allKinds}
          allCards={allCards}
          links={allLinks}
          linkKinds={allLinkKinds}
          onClose={onCloseOverlay}
          onSaved={() => void refreshAtlas()}
          onDeleted={undoToast.registerDelete}
          onOpenGroupEntry={openGroupEntry}
          guardDelete={guardDelete}
        />
      )}
      {importConfirmDialog}
      <AtlasStructureDialogs kinds={allKinds} tableFromListOpen={tableFromListOpen} onCloseTableFromList={onCloseTableFromList} newSpaceOpen={newSpaceOpen} onCloseNewSpace={onCloseNewSpace} onCreateTable={onCreateTable} onCreateSpace={onCreateSpace} />
      <ContextMenu state={menu} onClose={onCloseMenu} />
      {linkMenus.labelPopover}
      {containmentMenus.dissolveDialog}{deleteConfirm.deleteConfirmDialog}
      {openNote && <AtlasNoteOverlay key={openNote.ID} note={openNote} onClose={onCloseNote} />}

      <AtlasMatrixView
        open={matrixOpen}
        onClose={onCloseMatrix}
        cards={childrenAll}
        kinds={allKinds}
        links={allLinks}
        linkKinds={allLinkKinds}
        onOpenCard={onOpenCardFromProjection}
      />
      <AtlasCoverageView
        open={coverageOpen}
        onClose={onCloseCoverage}
        cards={childrenAll}
        links={allLinks}
        linkKinds={allLinkKinds}
        onOpenCard={onOpenCardFromProjection}
      />
      <AtlasKindManager open={kindsOpen} onClose={onCloseKinds} kinds={allKinds} linkKinds={allLinkKinds} />
    </>
  )
}
