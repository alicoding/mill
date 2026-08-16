import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, SegmentedControl } from '@primer/react'
import { ChecklistIcon, DownloadIcon, TableIcon, UploadIcon } from '@primer/octicons-react'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasBreadcrumb } from './AtlasBreadcrumb'
import { AtlasLensControl } from './AtlasLensControl'
import { AtlasCreateMenu } from './AtlasCreateMenu'
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
  peek, onChangePeek, viewMode, onChangeViewMode, showViewModeToggle,
  canAddSibling, onCreate, onExport, onImportFile, onShareError,
  onOpenMatrix, onOpenCoverage, addChildRequest,
}: {
  cards: Card[]
  viewedID: string
  onNavigate: (id: string) => void
  kinds: Kind[]
  presentKinds: Kind[]
  hiddenKindIDs: string[]
  onChangeHidden: (hidden: string[]) => void
  peek: boolean
  onChangePeek: (peek: boolean) => void
  viewMode: ViewMode
  onChangeViewMode: (mode: ViewMode) => void
  showViewModeToggle: boolean
  canAddSibling: boolean
  onCreate: (containment: 'sibling' | 'child', kindID: string, title: string) => Promise<void>
  onExport: () => void
  onImportFile: (file: File) => void
  onShareError: (message: string) => void
  // Traceability matrix / coverage (docs/goals/0064): both dialogs
  // project over the viewed space's own children, so the toolbar just
  // asks AtlasView to open them rather than owning that state itself.
  onOpenMatrix: () => void
  onOpenCoverage: () => void
  // The board pane's right-click "Add card…" (goal 0075's audit G3) --
  // forwarded straight through to AtlasCreateMenu, which owns the form.
  addChildRequest?: number
}) {
  const { t } = useTranslation('atlas')
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onImportFile(file)
  }

  return (
    <div className={styles.toolbar} data-testid="atlas-toolbar">
      <AtlasBreadcrumb cards={cards} viewedID={viewedID} onNavigate={onNavigate} />
      <div className={styles.toolbarActions}>
        {showViewModeToggle && (
          <SegmentedControl
            aria-label={t('viewMode.ariaLabel')}
            size="small"
            data-testid="atlas-view-mode-toggle"
            onChange={(i) => onChangeViewMode(i === 0 ? ViewMode.ViewModeShelves : ViewMode.ViewModeCanvas)}
          >
            <SegmentedControl.Button selected={viewMode !== ViewMode.ViewModeCanvas}>{t('viewMode.shelves')}</SegmentedControl.Button>
            <SegmentedControl.Button selected={viewMode === ViewMode.ViewModeCanvas}>{t('viewMode.canvas')}</SegmentedControl.Button>
          </SegmentedControl>
        )}
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
        <AtlasLensControl
          presentKinds={presentKinds}
          hiddenKindIDs={hiddenKindIDs}
          onChangeHidden={onChangeHidden}
          peek={peek}
          onChangePeek={onChangePeek}
        />
        <AtlasCreateMenu kinds={kinds} canAddSibling={canAddSibling} onCreate={onCreate} openChildRequest={addChildRequest} />
      </div>
    </div>
  )
}
