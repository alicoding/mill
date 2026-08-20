import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@primer/react'
import { ChecklistIcon, DownloadIcon, TableIcon, UploadIcon, TagIcon } from '@primer/octicons-react'
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
// Import, a Download-icon button for Export -- applied here to the
// WHOLE graph rather than one row, since Atlas has no per-entity export
// unit the way a saved workflow or List does (ADR-0036, goal 0061
// slice C).
export function AtlasToolbar({
  cards, viewedID, onNavigate,
  kinds, presentKinds, hiddenKindIDs, onChangeHidden,
  onAutoArrange,
  perspectives, activePerspectiveID, onSwitchPerspective, onCreatePerspective, onRenamePerspective, onDeletePerspective, onPerspectiveToast,
  links, linkKinds,
  onExport, onImportFile, onShareError,
  onOpenMatrix, onOpenCoverage, onOpenKinds,
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
  onImportFile: (file: File) => void
  onShareError: (message: string) => void
  // Traceability matrix / coverage (docs/goals/0064): both dialogs
  // project over the viewed space's own children, so the toolbar just
  // asks AtlasView to open them rather than owning that state itself.
  onOpenMatrix: () => void
  onOpenCoverage: () => void
  onOpenKinds: () => void
  // The board pane's right-click "Add card…" (goal 0075's audit G3) --
  // forwarded straight through to AtlasCreateMenu, which owns the form.
}) {
  const { t } = useTranslation('atlas')
  const importInputRef = useRef<HTMLInputElement>(null)

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
        <Button
          size="small"
          data-testid="atlas-auto-arrange"
          aria-disabled={activePerspectiveID !== ''}
          title={activePerspectiveID !== '' ? t('viewMode.arrangeDisabledTooltip') : undefined}
          className={activePerspectiveID !== '' ? styles.arrangeDisabled : undefined}
          onClick={() => { if (activePerspectiveID === '') onAutoArrange() }}
        >
          {t('viewMode.arrangeAction')}
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          data-testid="atlas-import-input"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        <Button leadingVisual={UploadIcon} size="small" variant="invisible" data-testid="atlas-import" onClick={() => importInputRef.current?.click()}>
          {t('toolbar.import')}
        </Button>
        <Button leadingVisual={DownloadIcon} size="small" variant="invisible" data-testid="atlas-export" onClick={onExport}>
          {t('toolbar.export')}
        </Button>
        <AtlasFolderImport viewedID={viewedID} kinds={kinds} />
        <AtlasSpaceShareMenu spaceID={viewedID} onError={onShareError} />
        <Button leadingVisual={TableIcon} size="small" variant="invisible" data-testid="atlas-open-matrix" onClick={onOpenMatrix}>
          {t('toolbar.matrix')}
        </Button>
        <Button leadingVisual={ChecklistIcon} size="small" variant="invisible" data-testid="atlas-open-coverage" onClick={onOpenCoverage}>
          {t('toolbar.coverage')}
        </Button>
        {/* Icon-only, deliberately: the actions row sits ~30px from
            overflowing its panel at the default window width, and an
            overflowing row horizontally scroll-shifts the whole board
            on card focus. The next toolbar addition must adopt an
            overflow strategy instead (Primer's ActionBar is the
            researched candidate -- goal 0079's debt note). */}
        <IconButton icon={TagIcon} size="small" variant="invisible" aria-label={t('toolbar.kinds')} data-testid="atlas-open-kinds" onClick={onOpenKinds} />
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
