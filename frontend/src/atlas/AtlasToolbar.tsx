import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionBar } from '@primer/react'
import { SparkleFillIcon, ShareIcon } from '@primer/octicons-react'
import type { Card, Kind, Link, LinkKind, Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { useUISignalStore } from '../shared/uiSignalStore'
import { runCommand } from '../shared/commands'
import { AtlasBreadcrumb } from './AtlasBreadcrumb'
import { AtlasBoardMenu } from './AtlasBoardMenu'
import { AtlasViewSwitcher, type AtlasBoardView } from './AtlasViewSwitcher'
import { AtlasPerspectiveSwitcher } from './AtlasPerspectiveSwitcher'
import { AtlasFolderImport } from './AtlasFolderImport'
import { AtlasSpaceShareMenu } from './AtlasSpaceShareMenu'
import styles from './AtlasView.module.css'

// The toolbar row every viewed space shows (goal 0355), in the order
// every canvas tool converges on: where you are (the breadcrumb), what
// you can do to the whole board (one Board menu), how you are looking
// at it (one view switcher), and how you hand it to someone else
// (Share, standing alone).
//
// The clusters are deliberately different KINDS of control, so the row
// is never a line of look-alike buttons: a menu for actions, a
// segmented switcher for the one-of view choice, a button for Share.
// Only Share and the companion toggle sit in an ActionBar -- two items
// that must never overflow -- so the row has exactly one shrinking
// segment instead of two competing ones, and everything else is
// reachable at Mill's 640px minimum through the menu and the switcher's
// own icon-only variant.
//
// Import keeps a hidden file input here (the Board menu's Import item
// runs the command, whose signal clicks this input), and
// AtlasFolderImport renders its dialog with no trigger of its own for
// the same reason: Add from folder… is a menu seat, not a button.
export function AtlasToolbar({
  cards, viewedID, onNavigate,
  kinds, presentKinds, hiddenKindIDs, onChangeHidden,
  perspectives, activePerspectiveID, onSwitchPerspective, onCreatePerspective, onRenamePerspective, onDeletePerspective, onPerspectiveToast,
  links, linkKinds,
  onImportFile, onShareError,
  activeView, onBackToBoard,
}: {
  cards: Card[]
  viewedID: string
  onNavigate: (id: string) => void
  kinds: Kind[]
  presentKinds: Kind[]
  hiddenKindIDs: string[]
  onChangeHidden: (hidden: string[]) => void
  perspectives: Perspective[]
  activePerspectiveID: string
  onSwitchPerspective: (id: string) => void
  onCreatePerspective: (name: string) => Promise<void>
  onRenamePerspective: (id: string, name: string) => Promise<void>
  onDeletePerspective: (id: string) => Promise<void>
  onPerspectiveToast: (message: string) => void
  // The Compare view's own full-graph data (goal 0095 slice 3),
  // forwarded straight through to AtlasPerspectiveSwitcher -- `cards`/
  // `kinds` above already carry the full (unfiltered) sets.
  links: Link[]
  linkKinds: LinkKind[]
  onImportFile: (file: File) => void
  onShareError: (message: string) => void
  // Which of the five ways of looking at this space is on screen, and
  // the one call that swaps a projection pane back for the canvas --
  // the switcher's own "back to the board".
  activeView: AtlasBoardView
  onBackToBoard: () => void
}) {
  const { t } = useTranslation('atlas')
  const importInputRef = useRef<HTMLInputElement>(null)

  // Share's trigger renders as an ActionBar.Button (an anchor ref, not
  // an ActionMenu.Anchor child) so it can join ActionBar's own registry
  // -- ActionMenu positions its Overlay off anchorRef alone
  // (AnchoredOverlay's renderAnchor is optional), so the dropdown's
  // items keep their own data-testid untouched.
  const shareAnchorRef = useRef<HTMLButtonElement>(null)
  const [shareOpen, setShareOpen] = useState(false)

  // atlas.import's own signal (shared/atlasBoardCommands.ts): the Board
  // menu, the palette and the keyboard all open the SAME native file
  // picker.
  const atlasImportRequest = useUISignalStore((s) => s.atlasImportRequest)
  const lastImportRequest = useRef(atlasImportRequest)
  useEffect(() => {
    if (atlasImportRequest === lastImportRequest.current) return
    lastImportRequest.current = atlasImportRequest
    importInputRef.current?.click()
  }, [atlasImportRequest])

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onImportFile(file)
  }

  return (
    <div
      className={styles.toolbar}
      data-testid="atlas-toolbar"
      // Read by atlas.arrange's own enablement predicate
      // (shared/atlasBoardCommands.ts): a global repack while a
      // perspective filters the board would scramble sibling views
      // (ADR-0041), so the command is genuinely invalid then.
      data-perspective-active={activePerspectiveID !== ''}
    >
      <div className={styles.toolbarLead}>
        <AtlasBreadcrumb cards={cards} viewedID={viewedID} onNavigate={onNavigate} />
        <AtlasBoardMenu />
      </div>
      <div className={styles.toolbarActions}>
        <AtlasViewSwitcher activeView={activeView} onBackToBoard={onBackToBoard} />
        <AtlasPerspectiveSwitcher
          perspectives={perspectives}
          activePerspectiveID={activePerspectiveID}
          onSwitch={onSwitchPerspective}
          onCreate={onCreatePerspective}
          onRename={onRenamePerspective}
          onDelete={onDeletePerspective}
          onToast={onPerspectiveToast}
          presentKinds={presentKinds}
          hiddenKindIDs={hiddenKindIDs}
          onChangeHidden={onChangeHidden}
          cards={cards}
          links={links}
          kinds={kinds}
          linkKinds={linkKinds}
        />
        <ActionBar size="small" flush aria-label={t('toolbar.shareViewActionsLabel')}>
          <ActionBar.Button ref={shareAnchorRef} leadingVisual={ShareIcon} data-testid="atlas-space-share" onClick={() => setShareOpen((open) => !open)}>
            {t('share.spaceMenuButton')}
          </ActionBar.Button>
          <ActionBar.IconButton icon={SparkleFillIcon} aria-label={t('companionPanel.toggleButton')} data-testid="atlas-open-companion" onClick={() => void runCommand('atlas.companion.toggle')} />
        </ActionBar>
        <AtlasSpaceShareMenu spaceID={viewedID} onError={onShareError} anchorRef={shareAnchorRef} open={shareOpen} onOpenChange={setShareOpen} />
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        data-testid="atlas-import-input"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
      <AtlasFolderImport viewedID={viewedID} kinds={kinds} />
    </div>
  )
}
