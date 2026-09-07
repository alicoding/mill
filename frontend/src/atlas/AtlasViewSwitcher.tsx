import { useTranslation } from 'react-i18next'
import { SegmentedControl } from '@primer/react'
import { ChecklistIcon, ListUnorderedIcon, ProjectIcon, TableIcon } from '@primer/octicons-react'
import type { Icon } from '@primer/octicons-react'
import { runCommand } from '../shared/commands'
import type { AtlasBoardView } from '../shared/viewKinds'
import { boardSwitcherPluginViews, type PluginView } from '../plugins/pluginViews'

// Which way the viewed space is being looked at right now (goal 0355).
// Board is the canvas itself; the other CORE entries are projection
// panes IN the board's own region over the same space, so they belong
// on one switcher rather than four buttons that each look like an
// unrelated action -- and a plugin's own view whose manifest placement
// is 'board-switcher' (goal 0357) appends after them, never between.
// Picking Board swaps whichever pane is showing back for the canvas,
// which is what "go back to the board" means here.
// The type itself lives in shared/viewKinds.ts, a field of the
// persisted View union; re-exported so atlas/ call sites keep their
// existing import path.
export type { AtlasBoardView }

// Each projection segment is a registry command, except Board, whose
// "action" is swapping the pane back for the canvas -- there is nothing
// to run for it.
const CORE_VIEWS: { view: AtlasBoardView; icon: Icon; labelKey: string; commandId: string | null; testId: string }[] = [
  { view: 'board', icon: ProjectIcon, labelKey: 'viewSwitcher.board', commandId: null, testId: 'atlas-open-board' },
  { view: 'list', icon: ListUnorderedIcon, labelKey: 'viewSwitcher.list', commandId: 'atlas.contents.open', testId: 'atlas-open-contents' },
  { view: 'matrix', icon: TableIcon, labelKey: 'viewSwitcher.matrix', commandId: 'atlas.matrix', testId: 'atlas-open-matrix' },
  { view: 'coverage', icon: ChecklistIcon, labelKey: 'viewSwitcher.coverage', commandId: 'atlas.coverage', testId: 'atlas-open-coverage' },
]

interface SwitcherEntry {
  view: AtlasBoardView
  testId: string
  commandId: string | null
  label: string
  // A core entry's octicon, or a contributed entry's own plugin icon
  // (<img> -- the switcher is atlas/, never app/, so it builds the
  // asset URL itself rather than reusing the frame bootstrap's).
  icon: Icon | null
  iconUrl: string | null
}

// contributedEntries appends every board-switcher-placed plugin view
// after the core four (goal 0357), in collection order. The registry
// is populated before the app module graph evaluates (loader.ts's own
// boot-order contract), so a plain read at render time is the honest
// enumeration -- no subscription to invent.
function contributedEntries(): SwitcherEntry[] {
  return boardSwitcherPluginViews().map((view: PluginView) => ({
    view: `plugin:${view.pluginId}.${view.viewId}`,
    testId: `atlas-open-plugin-${view.pluginId}-${view.viewId}`,
    commandId: `atlas.pluginView.${view.pluginId}.${view.viewId}.open`,
    label: view.title,
    icon: null,
    iconUrl: view.icon ? `/plugins/${view.pluginId}/${view.icon}?v=${encodeURIComponent(view.version)}` : null,
  }))
}

export function AtlasViewSwitcher({ activeView, onBackToBoard }: {
  activeView: AtlasBoardView
  onBackToBoard: () => void
}) {
  const { t } = useTranslation('atlas')
  const entries: SwitcherEntry[] = [
    ...CORE_VIEWS.map((v) => ({ view: v.view, testId: v.testId, commandId: v.commandId, label: t(v.labelKey), icon: v.icon, iconUrl: null })),
    ...contributedEntries(),
  ]
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
        const entry = entries[index]
        if (!entry) return
        // The panes replace the canvas in place, so switching is the
        // same store write for every segment; Board's is the only one
        // with no command to run (no signal to issue -- nothing
        // listens for "board opened").
        if (entry.view === 'board') onBackToBoard()
        else if (entry.commandId) void runCommand(entry.commandId)
      }}
      // Icons until the window is genuinely wide (Primer's own `wide`
      // range): a labelled row would crowd the trail beside it at Mill's
      // default window, and a row that grows a second line moves the
      // board underneath it. Each segment keeps its aria-label and
      // title, so the hidden text is never the only way to tell the
      // views apart.
      variant={{ narrow: 'hideLabels', regular: 'hideLabels', wide: 'default' }}
      data-testid="atlas-view-switcher"
    >
      {entries.map((entry) => (
        <SegmentedControl.Button
          key={entry.view}
          selected={activeView === entry.view}
          leadingVisual={entry.icon ?? (entry.iconUrl ? (() => <img src={entry.iconUrl ?? ''} alt="" width={16} height={16} />) : undefined)}
          aria-label={entry.label}
          title={entry.label}
          data-testid={entry.testId}
        >
          {entry.label}
        </SegmentedControl.Button>
      ))}
    </SegmentedControl>
  )
}
