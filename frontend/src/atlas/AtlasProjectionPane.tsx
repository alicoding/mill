import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import PageContainer from '../shared/PageContainer'
import { parsePluginBoardView, type AtlasBoardView } from '../shared/viewKinds'
import { getPluginView } from '../plugins/pluginViews'
import { PluginBoardPane } from '../plugins/pluginBoardPane'
import { AtlasContentsView } from './AtlasContentsView'
import pageStyles from './AtlasView.module.css'

export type AtlasProjectionKind = Exclude<AtlasBoardView, 'board'>

// The one host every projection pane renders through (goal 0355 S2):
// the switcher's active view replaces the canvas in place -- same
// content region the board owns, toolbar row above it untouched.
// Each projection keeps its own content and interactions; this host
// owns only what the pane-shape of the region demands of them all:
//
// - PageContainer owns the inset: 'wide' for the built-in list view; a
//   plugin-contributed pane (goal 0357, Matrix/Coverage/Roadmap all
//   included since goal 0357 S2) is 'full' -- the plugin's own page
//   carries its own pad.
// - Focus moves INTO the pane on view activation, so Escape -- the
//   dialog-Escape gesture these views carried as dialogs, kept --
//   reaches the pane's keydown handler from any focused child, and
//   portaled overlays (menus, the jump dialog) never bubble into it.
// - Escape swaps back to the Board; the switcher is the other way out.
const PANE_VARIANT: Record<string, 'wide'> = {
  list: 'wide',
}

// The label a screen reader gets for the region -- the one built-in
// projection's own longstanding name (its dialog title while it was
// one). A plugin pane's label is its manifest's own title instead.
const PANE_LABEL_KEY: Record<string, string> = {
  list: 'contents.title',
}

export function AtlasProjectionPane({ view, spaceID, kinds, onOpenCard, onFocusItem, onBackToBoard }: {
  view: AtlasProjectionKind
  // spaceID is the space being viewed (AtlasView's viewedID) -- a
  // plugin pane receives it as its frame context's spaceCardId.
  spaceID: string
  kinds: Kind[]
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

  const pluginView = parsePluginBoardView(view)
  const contribution = pluginView ? getPluginView(pluginView.pluginId, pluginView.viewId) : undefined
  const variant = PANE_VARIANT[view] ?? 'full'
  const label = PANE_LABEL_KEY[view] !== undefined ? t(PANE_LABEL_KEY[view]) : (contribution?.title ?? view)
  return (
    <div
      ref={hostRef}
      className={pageStyles.projectionPane}
      tabIndex={-1}
      role="region"
      aria-label={label}
      onKeyDown={onKeyDown}
      data-testid="atlas-projection-pane"
      data-view={view}
    >
      <PageContainer variant={variant} className={pluginView ? pageStyles.projectionPluginHost : undefined}>
        {view === 'list' && <AtlasContentsView kinds={kinds} onOpenCard={onOpenCard} onFocusItem={onFocusItem} />}
        {pluginView && <PluginBoardPane pluginId={pluginView.pluginId} viewId={pluginView.viewId} spaceCardId={spaceID} />}
      </PageContainer>
    </div>
  )
}
