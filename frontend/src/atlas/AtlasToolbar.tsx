import type { Card, Kind, ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { AtlasDepth } from './useAtlasDepth'
import { AtlasBreadcrumb } from './AtlasBreadcrumb'
import { AtlasLensControl } from './AtlasLensControl'
import { AtlasCreateMenu } from './AtlasCreateMenu'
import styles from './AtlasView.module.css'

// The toolbar row every viewed space shows: breadcrumb trail (left),
// lens + create controls (right) -- bundled into its own file so
// AtlasView.tsx stays focused on data-fetching/state wiring
// (architecture.md's 500-line convention).
export function AtlasToolbar({
  cards, viewedID, onNavigate,
  kinds, presentKinds, hiddenKindIDs, onChangeHidden,
  depth, onChangeDepth, viewMode, onChangeViewMode, showViewModeToggle,
  canAddSibling, onCreate,
}: {
  cards: Card[]
  viewedID: string
  onNavigate: (id: string) => void
  kinds: Kind[]
  presentKinds: Kind[]
  hiddenKindIDs: string[]
  onChangeHidden: (hidden: string[]) => void
  depth: AtlasDepth
  onChangeDepth: (depth: AtlasDepth) => void
  viewMode: ViewMode
  onChangeViewMode: (mode: ViewMode) => void
  showViewModeToggle: boolean
  canAddSibling: boolean
  onCreate: (containment: 'sibling' | 'child', kindID: string, title: string) => Promise<void>
}) {
  return (
    <div className={styles.toolbar} data-testid="atlas-toolbar">
      <AtlasBreadcrumb cards={cards} viewedID={viewedID} onNavigate={onNavigate} />
      <div className={styles.toolbarActions}>
        <AtlasLensControl
          presentKinds={presentKinds}
          hiddenKindIDs={hiddenKindIDs}
          onChangeHidden={onChangeHidden}
          depth={depth}
          onChangeDepth={onChangeDepth}
          viewMode={viewMode}
          onChangeViewMode={onChangeViewMode}
          showViewModeToggle={showViewModeToggle}
        />
        <AtlasCreateMenu kinds={kinds} canAddSibling={canAddSibling} onCreate={onCreate} />
      </div>
    </div>
  )
}
