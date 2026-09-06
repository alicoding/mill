import { useTranslation } from 'react-i18next'
import { SegmentedControl } from '@primer/react'
import { ChecklistIcon, ListUnorderedIcon, ProjectRoadmapIcon, ProjectIcon, TableIcon } from '@primer/octicons-react'
import type { Icon } from '@primer/octicons-react'
import { runCommand } from '../shared/commands'
import type { AtlasBoardView } from '../shared/viewKinds'

// Which way the viewed space is being looked at right now (goal 0355).
// Board is the canvas itself; the other four are projection panes IN
// the board's own region over the same space, so they belong on one
// switcher rather than four buttons that each look like an unrelated
// action. Picking Board swaps whichever pane is showing back for the
// canvas, which is what "go back to the board" means here.
// The type itself lives in shared/viewKinds.ts, a field of the
// persisted View union; re-exported so atlas/ call sites keep their
// existing import path.
export type { AtlasBoardView }

// Each projection segment is a registry command, except Board, whose
// "action" is swapping the pane back for the canvas -- there is nothing
// to run for it.
const VIEWS: { view: AtlasBoardView; icon: Icon; labelKey: string; commandId: string | null }[] = [
  { view: 'board', icon: ProjectIcon, labelKey: 'viewSwitcher.board', commandId: null },
  { view: 'list', icon: ListUnorderedIcon, labelKey: 'viewSwitcher.list', commandId: 'atlas.contents.open' },
  { view: 'matrix', icon: TableIcon, labelKey: 'viewSwitcher.matrix', commandId: 'atlas.matrix' },
  { view: 'coverage', icon: ChecklistIcon, labelKey: 'viewSwitcher.coverage', commandId: 'atlas.coverage' },
  { view: 'roadmap', icon: ProjectRoadmapIcon, labelKey: 'viewSwitcher.roadmap', commandId: 'atlas.roadmap' },
]

// The testid every projection door has always carried, kept on its
// segment so the doors that pre-date this switcher still find it.
const VIEW_TESTIDS: Record<AtlasBoardView, string> = {
  board: 'atlas-open-board',
  list: 'atlas-open-contents',
  matrix: 'atlas-open-matrix',
  coverage: 'atlas-open-coverage',
  roadmap: 'atlas-open-roadmap',
}

export function AtlasViewSwitcher({ activeView, onBackToBoard }: {
  activeView: AtlasBoardView
  onBackToBoard: () => void
}) {
  const { t } = useTranslation('atlas')
  return (
    <SegmentedControl
      size="small"
      aria-label={t('viewSwitcher.ariaLabel')}
      // CONTROLLED, deliberately: SegmentedControl keeps its own
      // selected index unless onChange is supplied (verified against
      // its own source), and an uncontrolled switcher would keep
      // showing List after a keyboard Escape back to the board. With
      // this handler the highlight is always the derived `activeView`.
      onChange={(index) => {
        const entry = VIEWS[index]
        if (!entry) return
        // The panes replace the canvas in place, so switching is the
        // same store write for every segment; Board's is the only one
        // with no command to run (no signal to issue -- nothing
        // listens for "board opened").
        if (entry.view === 'board') onBackToBoard()
        else if (entry.commandId) void runCommand(entry.commandId)
      }}
      // Icons until the window is genuinely wide (Primer's own `wide`
      // range): five labelled segments are ~440px, which at Mill's
      // default window leaves no room for the trail beside them, and a
      // row that grows a second line moves the board underneath it.
      // Each segment keeps its aria-label and title, so the hidden text
      // is never the only way to tell the views apart.
      variant={{ narrow: 'hideLabels', regular: 'hideLabels', wide: 'default' }}
      data-testid="atlas-view-switcher"
    >
      {VIEWS.map((entry) => (
        <SegmentedControl.Button
          key={entry.view}
          selected={activeView === entry.view}
          leadingVisual={entry.icon}
          aria-label={t(entry.labelKey)}
          title={t(entry.labelKey)}
          data-testid={VIEW_TESTIDS[entry.view]}
        >
          {t(entry.labelKey)}
        </SegmentedControl.Button>
      ))}
    </SegmentedControl>
  )
}
