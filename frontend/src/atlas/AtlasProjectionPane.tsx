import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import PageContainer from '../shared/PageContainer'
import type { AtlasBoardView } from '../shared/viewKinds'
import { AtlasContentsView } from './AtlasContentsView'
import { AtlasMatrixView } from './AtlasMatrixView'
import { AtlasCoverageView } from './AtlasCoverageView'
import { AtlasRoadmapView } from './AtlasRoadmapView'
import pageStyles from './AtlasView.module.css'

export type AtlasProjectionKind = Exclude<AtlasBoardView, 'board'>

// The one host every projection pane renders through (goal 0355 S2):
// the switcher's active view replaces the canvas in place -- same
// content region the board owns, toolbar row above it untouched.
// Each projection keeps its own content and interactions; this host
// owns only what the pane-shape of the region demands of all four:
//
// - PageContainer owns the inset: 'wide' for the list/table views,
//   'full' for the roadmap's canvas-shaped swimlane grid (whose own
//   module CSS then supplies the pad), never a new wrapper.
// - Focus moves INTO the pane on view activation, so Escape -- the
//   dialog-Escape gesture these views carried as dialogs, kept --
//   reaches the pane's keydown handler from any focused child, and
//   portaled overlays (menus, the jump dialog) never bubble into it.
// - Escape swaps back to the Board; the switcher is the other way out.
const PANE_VARIANT: Record<AtlasProjectionKind, 'wide' | 'full'> = {
  list: 'wide',
  matrix: 'wide',
  coverage: 'wide',
  roadmap: 'full',
}

// The label a screen reader gets for the region -- each projection's
// own longstanding name (its dialog title while it was one).
const PANE_LABEL_KEY: Record<AtlasProjectionKind, string> = {
  list: 'contents.title',
  matrix: 'matrix.title',
  coverage: 'coverage.title',
  roadmap: 'roadmap.title',
}

export function AtlasProjectionPane({ view, cards, kinds, links, linkKinds, onOpenCard, onFocusItem, onBackToBoard }: {
  view: AtlasProjectionKind
  // cards is the viewed space's own children -- the subset every
  // projection has always projected (AtlasView's childrenAll), never
  // the lens- or perspective-filtered set.
  cards: Card[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  onOpenCard: (id: string) => void
  onFocusItem: (id: string) => void
  onBackToBoard: () => void
}) {
  const { t } = useTranslation('atlas')
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    hostRef.current?.focus({ preventScroll: true })
  }, [view])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onBackToBoard()
  }

  const variant = PANE_VARIANT[view]
  return (
    <div
      ref={hostRef}
      className={pageStyles.projectionPane}
      tabIndex={-1}
      role="region"
      aria-label={t(PANE_LABEL_KEY[view])}
      onKeyDown={onKeyDown}
      data-testid="atlas-projection-pane"
      data-view={view}
    >
      <PageContainer variant={variant} className={variant === 'full' ? pageStyles.projectionPad : undefined}>
        {view === 'list' && <AtlasContentsView kinds={kinds} onOpenCard={onOpenCard} onFocusItem={onFocusItem} />}
        {view === 'matrix' && <AtlasMatrixView cards={cards} kinds={kinds} links={links} linkKinds={linkKinds} onOpenCard={onOpenCard} />}
        {view === 'coverage' && <AtlasCoverageView cards={cards} links={links} linkKinds={linkKinds} onOpenCard={onOpenCard} />}
        {view === 'roadmap' && <AtlasRoadmapView cards={cards} kinds={kinds} onOpenCard={onOpenCard} />}
      </PageContainer>
    </div>
  )
}
