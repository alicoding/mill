import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionBar, ActionList, ActionMenu } from '@primer/react'
import { ChecklistIcon, DownloadIcon, ProjectRoadmapIcon, TableIcon, UploadIcon, TagIcon, SparkleFillIcon, ShareIcon } from '@primer/octicons-react'
import type { Card, Kind, Link, LinkKind, Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { useUISignalStore } from '../shared/uiSignalStore'
import { AtlasBreadcrumb } from './AtlasBreadcrumb'
import { AtlasPerspectiveSwitcher } from './AtlasPerspectiveSwitcher'
import { AtlasFolderImport } from './AtlasFolderImport'
import { AtlasSpaceShareMenu } from './AtlasSpaceShareMenu'
import styles from './AtlasView.module.css'

// The toolbar row every viewed space shows: breadcrumb trail (left),
// export/import + lens + create controls (right) -- bundled into its
// own file so AtlasView.tsx stays focused on data-fetching/state wiring
// (architecture.md's 500-line convention). Export/Import mirror the
// idiom every other surface's toolbar uses (CompositionView.tsx,
// ConfigureLists.tsx): a hidden file input + Upload-icon button for
// Import, a two-item Export menu (goal 0194's own export slice, same
// overlay machinery AtlasSpaceShareMenu.tsx already uses): the whole
// graph as portable JSON (ADR-0036, goal 0061 slice C), or just the
// viewed board as a .drawio file -- a .drawio file is inherently one
// board, never a portable multi-space bundle, so the two formats keep
// their own scope rather than sharing one.
//
// The action cluster splits across two Primer ActionBars (goal 0216):
// the row's own natural width already exceeds the space left after the
// sidebar at Mill's own minimum window width (main.go's MinWidth: 640),
// and Share sits between the two ActionBar-eligible groups in the
// required visual order, so one contiguous ActionBar can't span both
// without reordering what the user sees. Export and Share keep their
// own ActionMenu overlay (their dropdown items carry their own
// data-testid, which ActionBar's declarative Menu items can't
// reproduce) -- only their TRIGGER moves into ActionBar, anchored
// externally via a ref instead of an ActionMenu.Anchor child, which is
// enough for ActionBar's overflow registry to track them.
// AtlasFolderImport's own Button becomes an ActionBar.Button the same
// way (AtlasFolderImport.tsx) -- its Dialog needs no anchor at all, so
// only the trigger needed to move. The perspective switcher is the one
// action that stays outside ActionBar entirely: its popover (checkboxes,
// inline rename, a compare dialog launcher) can't be expressed as
// ActionBar's flat items list.
export function AtlasToolbar({
  cards, viewedID, onNavigate,
  kinds, presentKinds, hiddenKindIDs, onChangeHidden,
  onAutoArrange,
  perspectives, activePerspectiveID, onSwitchPerspective, onCreatePerspective, onRenamePerspective, onDeletePerspective, onPerspectiveToast,
  links, linkKinds,
  onExport, onExportDrawio, onImportFile, onShareError,
  onOpenMatrix, onOpenCoverage, onOpenRoadmap, onOpenKinds,
}: {
  cards: Card[]
  viewedID: string
  onNavigate: (id: string) => void
  kinds: Kind[]
  presentKinds: Kind[]
  hiddenKindIDs: string[]
  onChangeHidden: (hidden: string[]) => void
  // Arrange is an action, not a mode (goal 0089): one-shot packer run
  // over the current level, persisting the resulting positions. Disabled
  // while a perspective is active (ADR-0041): a global repack while
  // filtered would scramble sibling views.
  onAutoArrange: () => void
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
  onExport: () => void
  onExportDrawio: () => void
  onImportFile: (file: File) => void
  onShareError: (message: string) => void
  // Traceability matrix / coverage / roadmap (docs/goals/0064, 0212):
  // all three dialogs project over the viewed space's own children, so
  // the toolbar just asks AtlasView to open them rather than owning
  // that state itself.
  onOpenMatrix: () => void
  onOpenCoverage: () => void
  onOpenRoadmap: () => void
  onOpenKinds: () => void
  // The board pane's right-click "Add card…" (goal 0075's audit G3) --
  // forwarded straight through to AtlasCreateMenu, which owns the form.
}) {
  const { t } = useTranslation('atlas')
  const importInputRef = useRef<HTMLInputElement>(null)
  const toggleCompanion = useUISignalStore((s) => s.toggleCompanion)

  // Export's trigger renders as an ActionBar.Button (an anchor ref, not
  // an ActionMenu.Anchor child) so it can join ActionBar's own overflow
  // registry -- ActionMenu positions its Overlay off anchorRef alone
  // (AnchoredOverlay's renderAnchor is optional), so the dropdown's two
  // items keep their own data-testid untouched; only the trigger moves.
  const exportAnchorRef = useRef<HTMLButtonElement>(null)
  const [exportOpen, setExportOpen] = useState(false)
  // Share gets the same external-anchor treatment; see AtlasSpaceShareMenu.tsx.
  const shareAnchorRef = useRef<HTMLButtonElement>(null)
  const [shareOpen, setShareOpen] = useState(false)

  // atlas.import's own signal (shared/atlasBoardCommands.ts): a click
  // from the palette/keyboard opens the SAME native file picker the
  // toolbar's own Import button does.
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
    <div className={styles.toolbar} data-testid="atlas-toolbar">
      <AtlasBreadcrumb cards={cards} viewedID={viewedID} onNavigate={onNavigate} />
      <div className={styles.toolbarActions}>
        {/* A second ActionBar segment (goal 0216): Arrange/Import are
            equally simple single-action buttons, but Export/the folder
            import button/Share sit between them and the Matrix cluster
            in the required visual order, so one contiguous ActionBar
            can't span both without reordering what the user sees.
            Primer's ActionBar still owns all shrink/overflow logic for
            each segment independently -- no hand-rolled measurement. */}
        <ActionBar size="small" flush aria-label={t('toolbar.dataActionsLabel')}>
          <ActionBar.Button
            data-testid="atlas-auto-arrange"
            disabled={activePerspectiveID !== ''}
            title={activePerspectiveID !== '' ? t('viewMode.arrangeDisabledTooltip') : undefined}
            className={activePerspectiveID !== '' ? styles.arrangeDisabled : undefined}
            onClick={onAutoArrange}
          >
            {t('viewMode.arrangeAction')}
          </ActionBar.Button>
          <ActionBar.Button leadingVisual={UploadIcon} data-testid="atlas-import" onClick={() => importInputRef.current?.click()}>
            {t('toolbar.import')}
          </ActionBar.Button>
          <ActionBar.Button ref={exportAnchorRef} leadingVisual={DownloadIcon} data-testid="atlas-export" onClick={() => setExportOpen((open) => !open)}>
            {t('toolbar.export')}
          </ActionBar.Button>
          <AtlasFolderImport viewedID={viewedID} kinds={kinds} />
        </ActionBar>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          data-testid="atlas-import-input"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        <ActionMenu anchorRef={exportAnchorRef} open={exportOpen} onOpenChange={setExportOpen}>
          <ActionMenu.Overlay>
            <ActionList>
              <ActionList.Item onSelect={onExport} data-testid="atlas-export-json">
                {t('toolbar.exportJSON')}
              </ActionList.Item>
              <ActionList.Item onSelect={onExportDrawio} data-testid="atlas-export-drawio">
                {t('toolbar.exportDrawio')}
              </ActionList.Item>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
        {/* Primer's ActionBar (goal 0216) owns overflow for this cluster:
            it measures each child against the available row width itself
            (no hand-rolled resize observer) and moves whichever ones don't
            fit into its own "More items" menu, reading the SAME elements
            below rather than a second hand-maintained list. Share's
            trigger joins here (its overlay's own testids stay put --
            see AtlasSpaceShareMenu.tsx) since it sits immediately before
            Matrix in the required order. */}
        <ActionBar size="small" flush aria-label={t('toolbar.shareViewActionsLabel')}>
          <ActionBar.Button ref={shareAnchorRef} leadingVisual={ShareIcon} data-testid="atlas-space-share" onClick={() => setShareOpen((open) => !open)}>
            {t('share.spaceMenuButton')}
          </ActionBar.Button>
          <ActionBar.Button leadingVisual={TableIcon} data-testid="atlas-open-matrix" onClick={onOpenMatrix}>
            {t('toolbar.matrix')}
          </ActionBar.Button>
          <ActionBar.Button leadingVisual={ChecklistIcon} data-testid="atlas-open-coverage" onClick={onOpenCoverage}>
            {t('toolbar.coverage')}
          </ActionBar.Button>
          <ActionBar.Button leadingVisual={ProjectRoadmapIcon} data-testid="atlas-open-roadmap" onClick={onOpenRoadmap}>
            {t('toolbar.roadmap')}
          </ActionBar.Button>
          <ActionBar.IconButton icon={TagIcon} aria-label={t('toolbar.kinds')} data-testid="atlas-open-kinds" onClick={onOpenKinds} />
          <ActionBar.IconButton icon={SparkleFillIcon} aria-label={t('companionPanel.toggleButton')} data-testid="atlas-open-companion" onClick={toggleCompanion} />
        </ActionBar>
        <AtlasSpaceShareMenu spaceID={viewedID} onError={onShareError} anchorRef={shareAnchorRef} open={shareOpen} onOpenChange={setShareOpen} />
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
      </div>
    </div>
  )
}
