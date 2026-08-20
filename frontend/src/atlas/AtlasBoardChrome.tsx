import { useTranslation } from 'react-i18next'
import { Background, Controls, Panel } from '@xyflow/react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasBoardMinimapButton } from './AtlasBoardMinimapButton'
import { ThemedMiniMap } from '../shared/ThemedMiniMap'
import { AtlasLinkRefusalHint } from './AtlasLinkRefusalHint'
import { AtlasFilterBar } from './AtlasFilterBar'
import { type BoardFilter } from './cardFilter'

// The board's in-canvas chrome (background, filter panel, controls,
// minimap, refusal hint) -- split out of AtlasBoard.tsx at the
// 500-line limit; pure presentation over props the board owns.
// The filter floats over the canvas it filters (goal 0129 slice 1):
// the toolbar row is full by its own recorded constraint.
export function AtlasBoardChrome({ kinds, filterPresentKindIDs, boardFilter, onBoardFilterChange, filterMatchCount, filterTotalCount, minimapVisible, onMinimapToggle, refusalHint }: {
  kinds: Kind[]
  filterPresentKindIDs: Set<string>
  boardFilter: BoardFilter
  onBoardFilterChange: (next: BoardFilter) => void
  filterMatchCount: number
  filterTotalCount: number
  minimapVisible: boolean
  onMinimapToggle: () => void
  refusalHint: string | null
}) {
  const { t } = useTranslation('atlas')
  return (
    <>
      <Background />
      <Panel position="top-right">
        <AtlasFilterBar
          kinds={kinds}
          presentKindIDs={filterPresentKindIDs}
          filter={boardFilter}
          onChange={onBoardFilterChange}
          matchCount={filterMatchCount}
          totalCount={filterTotalCount}
        />
      </Panel>
      <Controls>
        <AtlasBoardMinimapButton visible={minimapVisible} onToggle={onMinimapToggle} ariaLabel={t('board.minimapToggleAriaLabel')} />
      </Controls>
      {minimapVisible && <ThemedMiniMap />}
      <AtlasLinkRefusalHint hint={refusalHint} />
    </>
  )
}
