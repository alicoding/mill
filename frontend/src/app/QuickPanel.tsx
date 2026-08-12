import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import { Events } from '@wailsio/runtime'
import { CounterLabel, Text } from '@primer/react'
import { FilteredActionList } from '@primer/react/experimental'
import { GearIcon, HomeIcon, PlayIcon } from '@primer/octicons-react'
import { ExecutionService, RunKind, SettingsService } from '../shared/bindings'
import { generateSamplePayload } from '../shared/configSchema'
import { useAppStore, refreshWorkflows, refreshRequests, refreshKeybindings } from '../shared/store'
import { useConfigureEntityStore, refreshLists, refreshMCPServers } from '../shared/configureEntityStore'
import { ENTITY_ICON } from '../shared/entityIcons'
import { CAPABILITY_ICON } from './navIcon'
import { filterPaletteEntries } from './paletteFilter'
import type { PaletteSearchable } from './paletteFilter'
import { sortWorkflowsByFrecency } from './workflowFrecency'
import { HotkeyHint } from './HotkeyHint'
import styles from './QuickPanel.module.css'

// docs/adr/0033-quick-panel-second-window.md: the search+run surface
// hosted in the Quick Panel's own dedicated Wails window, toggled by
// the global summon hotkey (settingsservice_summonhotkey.go). Modeled
// directly on app/CommandPalette.tsx (the same FilteredActionList +
// filterPaletteEntries shapes, the same ExecutionService.RunWorkflow
// test-run path) rather than rebuilt from scratch -- but NOT the same
// component: CommandPalette is a Dialog mounted inside the MAIN
// window's own React tree (it needs workTabs/keybindingOverrides/
// closePalette, none of which make sense for a standalone window with
// no work-tab strip of its own), where this is the entire content of a
// separate, frameless top-level window with no Dialog chrome to
// provide Escape handling or a backdrop -- HideOnEscape (Go-side window
// option) covers Escape natively, so this deliberately does not
// duplicate that handling in JS.
//
// Every dismiss (Escape, focus-lost, a run starting, an Open-Mill/
// Open-Settings row) goes through the Go side (native HideOnEscape/
// HideOnFocusLost, or the SettingsService.DismissPanel RPC below) --
// this component never calls window.close() or touches window
// visibility itself.

type PanelGroupId = 'workflows' | 'configure' | 'actions'

interface PanelEntry extends PaletteSearchable {
  id: string
  groupId: PanelGroupId
  text: string
  description?: string
  leadingVisual: ElementType
  trailingVisual?: ReactNode
  run: () => void
}

const GROUP_METADATA = [
  { groupId: 'workflows' as const, header: { title: 'Workflows' } },
  { groupId: 'configure' as const, header: { title: 'Configure' } },
  { groupId: 'actions' as const, header: { title: 'Mill' } },
]

// Frequency-only ranking window (goal 0015's remainder): the entire
// local run history, not a rolling recent window -- "frequently-used
// float up" shouldn't reset just because a workflow's last run was
// over a month ago. ExecutionService.HomeMetrics requires an RFC3339
// instant, not an "all time" flag, so this is simply an instant well
// before Mill could have any real run history.
const FRECENCY_FROM_ISO = new Date(0).toISOString()

export function QuickPanel() {
  const workflows = useAppStore((s) => s.workflows)
  // Configure's three reusable, already-Wails-bound entity kinds
  // (goal 0015's remainder item 3) -- connectors ("Integration" in the
  // UI, still the HTTPRequest/`request` entity under the hood, ADR-0016),
  // Lists, MCP Servers. Read off the SAME shared stores App.tsx's own
  // mill-data-changed router feeds (store.ts's `requests`,
  // configureEntityStore.ts's `lists`/`mcpServers`) rather than a new
  // QuickPanel-local fetch shape -- this window still refetches them
  // itself below (goal 0017's per-window fetch pattern: store state
  // isn't shared across separate Wails windows/JS contexts, only the
  // fetch FUNCTIONS are reused).
  const requests = useAppStore((s) => s.requests)
  const lists = useConfigureEntityStore((s) => s.lists)
  const mcpServers = useConfigureEntityStore((s) => s.mcpServers)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  // Frecency ranking (goal 0015's remainder item 1): workflowID ->
  // RunCount, straight off ExecutionService.HomeMetrics' MostUsed --
  // the same usage substrate goal 0014's Home value mirror already
  // computes (executionservice_home.go's mostUsedFor), not a new
  // algorithm. Pins are explicitly OUT of scope (docs/goals/BACKLOG.md
  // tech-debt line) -- no pin/favorite concept exists anywhere in Mill
  // yet, so this is frequency-only, matching what the substrate
  // actually provides today.
  const [mostUsedRank, setMostUsedRank] = useState<Record<string, number>>({})
  // Pending-review count (goal 0015's remainder item 2): the Quick
  // Panel is its own Wails window (ADR-0033) -- App.tsx's own
  // reviewPendingCount effect only runs in the main window's React
  // tree, so this is a second, independent instance of the exact same
  // read (ExecutionService.ListRuns' pending runs + SettingsService.
  // PendingMCPWrites) and the exact same live-update events
  // (guardrail-pending-changed, mcp-write-approval) -- display-only
  // here, deliberately NOT re-running App.tsx's SetPendingBadge/
  // NotifyPendingApproval side effects (the main window already owns
  // those; duplicating them per-window would double-fire OS
  // notifications for the same pending item).
  const [reviewPendingCount, setReviewPendingCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Every show of this window is a fresh session, not a continuation --
  // refetch so a workflow created/renamed/deleted since the panel was
  // last open is never stale, and reset any leftover query/status from
  // the previous show. Runs on mount (the window's own React tree is
  // created once at Go startup and never remounted -- Show()/Hide()
  // just toggle native visibility) and again on every regained window
  // focus/visibility, which is also when a summon-hotkey toggle brings
  // it back to the front.
  useEffect(() => {
    const focusAndReset = () => {
      void refreshWorkflows()
      void refreshRequests()
      void refreshLists()
      void refreshMCPServers()
      void refreshFrecency()
      // This window is a separate Wails webview/JS context from the
      // main window (docs/adr/0033) -- its own keybindingOverrides copy
      // (shared/store.ts) only ever reflects whatever was true the last
      // time THIS window fetched it, never a live push from a rebind
      // made in the main window's Settings. Refetching on every show
      // (same "fresh session" reasoning as the refreshes above) is
      // enough for the O(1)-source-of-truth requirement to hold in
      // practice: the hint is wrong for at most the current show, never
      // permanently stale.
      void refreshKeybindings()
      setQuery('')
      setStatus(null)
      // One frame so a just-unhidden webview has actually finished
      // laying out before focus is requested -- matches the same
      // "focus after paint" caution other Mill recorders already take
      // (composition/hotkeyCapture.ts's own capture-start focus calls).
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') focusAndReset()
    }
    focusAndReset()
    window.addEventListener('focus', focusAndReset)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', focusAndReset)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const refreshFrecency = () => {
    ExecutionService.HomeMetrics(FRECENCY_FROM_ISO, new Date().toISOString(), true)
      .then((metrics) => {
        const rank: Record<string, number> = {}
        for (const usage of metrics.mostUsed ?? []) rank[usage.workflowID] = usage.runCount
        setMostUsedRank(rank)
      })
      .catch(() => {})
  }

  // Live sync while the panel stays open (goal 0017's mill-data-changed
  // infra, docs/adr/0025): a Configure entity created/renamed/deleted
  // elsewhere -- the main window, another tool, an MCP author -- while
  // this window happens to be open updates the jump rows without
  // waiting for the next show. Scoped to just the entity kinds this
  // panel actually renders (workflow/run for frecency+the row list,
  // request/list/mcpserver for the Configure jump rows); 'run' also
  // refreshes frecency since a new run changes MostUsed's ranking.
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'workflow') void refreshWorkflows()
      if (entity === 'run') { void refreshWorkflows(); refreshFrecency() }
      if (entity === 'request') void refreshRequests()
      if (entity === 'list') void refreshLists()
      if (entity === 'mcpserver') void refreshMCPServers()
    })
  }, [])

  // Same two events + same two RPCs App.tsx's own reviewPendingCount
  // effect uses -- see this state's own declaration comment above for
  // why this is a second, display-only instance rather than a shared
  // one.
  useEffect(() => {
    const refresh = () => {
      Promise.all([
        ExecutionService.ListRuns().then((runs) => (runs ?? []).filter((r) => r.pending)).catch(() => []),
        SettingsService.PendingMCPWrites().then((p) => p ?? []).catch(() => []),
      ]).then(([guardrailPending, mcpPending]) => {
        setReviewPendingCount(guardrailPending.length + mcpPending.length)
      })
    }
    refresh()
    const offGuardrail = Events.On('guardrail-pending-changed', refresh)
    const offMCP = Events.On('mcp-write-approval', refresh)
    return () => { offGuardrail(); offMCP() }
  }, [])

  // ⌘, opens Settings directly, matching the "Open Settings · ⌘," row's
  // own shortcut hint -- HideOnEscape covers Escape natively (Go-side),
  // this is the one panel-local keydown binding that has no native
  // equivalent to defer to.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        openMain('settings')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const openMain = (view: string) => {
    void SettingsService.OpenMainWindow(view).catch(() => {})
  }

  // A Configure-entity row's "run" is a jump, not an execution: shows
  // the main window navigated straight to the tab that entity lives on
  // (App.tsx's useMillNavigate parses 'configure:<tab>' -- see that
  // hook's own doc comment). Lands on the TAB, not the individual row
  // within it -- deep-linking to one specific entity's own edit form
  // would need ConfigureView's tab components to accept a selected-row
  // id too, real additional scope beyond what this goal's DoR covered
  // (self-contained items only); jumping to the right tab already
  // answers "where do I find/edit this."
  const jumpToConfigure = (tab: string) => {
    openMain(`configure:${tab}`)
  }

  // Same RPC + RunKind CompositionView's own list-row Run button and
  // CommandPalette's runWorkflowTest use (ExecutionService.RunWorkflow,
  // RunKindTest -- docs/adr/0008's single execution path). A workflow
  // with declared Attributes runs with generateSamplePayload's defaults
  // immediately, same "skip the manual-review step, this is a *quick*
  // invoke" reasoning CommandPalette already documents. Shows a brief
  // started/failed confirmation, then dismisses the panel shortly after
  // so the confirmation is actually readable before the window
  // disappears.
  const runWorkflow = (id: string, label: string) => {
    const wf = workflows?.find((w) => w.ID === id)
    const attrs = wf?.Attributes ?? []
    const values = attrs.length > 0 ? generateSamplePayload(attrs) : null
    setStatus(`Running "${label}"…`)
    ExecutionService.RunWorkflow(id, RunKind.RunKindTest, values)
      .then((summary) => {
        setStatus(summary.error ? `"${label}" failed: ${summary.error}` : `Started "${label}"`)
        window.setTimeout(() => { void SettingsService.DismissPanel().catch(() => {}) }, 600)
      })
      .catch((err) => {
        setStatus(`"${label}" failed: ${String(err)}`)
      })
  }

  const allEntries = useMemo<PanelEntry[]>(() => {
    const entries: PanelEntry[] = []
    // Frecency-sorted (goal 0015's remainder item 1) -- frequency-only,
    // see mostUsedRank's own declaration comment.
    for (const wf of sortWorkflowsByFrecency(workflows ?? [], mostUsedRank)) {
      entries.push({
        id: `run:${wf.ID}`,
        groupId: 'workflows',
        text: wf.Label,
        description: 'Enter to run',
        searchText: wf.Label.toLowerCase(),
        leadingVisual: PlayIcon,
        run: () => runWorkflow(wf.ID, wf.Label),
      })
    }
    // Configure entities (goal 0015's remainder item 3): connectors
    // ("Integration" tab), Lists, MCP Servers -- searchable/jumpable
    // rows alongside workflows, same ENTITY_ICON per-kind leading
    // visual InventoryList rows already use elsewhere (recognition, not
    // confirmation), each landing on its own Configure tab via
    // jumpToConfigure.
    for (const req of requests ?? []) {
      entries.push({
        id: `configure:integration:${req.ID}`,
        groupId: 'configure',
        text: req.Label,
        description: 'Jump to Integration',
        searchText: req.Label.toLowerCase(),
        leadingVisual: ENTITY_ICON.request.Icon,
        run: () => jumpToConfigure('integration'),
      })
    }
    for (const list of lists ?? []) {
      entries.push({
        id: `configure:lists:${list.ID}`,
        groupId: 'configure',
        text: list.Label,
        description: 'Jump to Lists',
        searchText: list.Label.toLowerCase(),
        leadingVisual: ENTITY_ICON.list.Icon,
        run: () => jumpToConfigure('lists'),
      })
    }
    for (const server of mcpServers ?? []) {
      entries.push({
        id: `configure:mcpservers:${server.ID}`,
        groupId: 'configure',
        text: server.Label,
        description: 'Jump to MCP Servers',
        searchText: server.Label.toLowerCase(),
        leadingVisual: ENTITY_ICON.mcpserver.Icon,
        run: () => jumpToConfigure('mcpservers'),
      })
    }
    entries.push({
      id: 'open-mill',
      groupId: 'actions',
      text: 'Open Mill',
      searchText: 'open mill window',
      leadingVisual: HomeIcon,
      run: () => openMain(''),
    })
    entries.push({
      id: 'open-settings',
      groupId: 'actions',
      text: 'Open Settings',
      searchText: 'open settings preferences',
      leadingVisual: GearIcon,
      // HotkeyHint (app/HotkeyHint.tsx) reads settings.open's live
      // effective binding (shared/commands.ts + any Settings override)
      // -- this row used to hardcode "⌘," directly, which would have
      // silently gone stale the moment someone rebound settings.open in
      // Settings (docs/goals/0015's O(1) single-source-of-truth
      // requirement).
      trailingVisual: <HotkeyHint commandId="settings.open" />,
      run: () => openMain('settings'),
    })
    // Pending-review count (goal 0015's remainder item 2): always
    // present (unblock-yourself-in-place -- "Review" is a real jump
    // target even at zero), badged with the live count once non-zero.
    entries.push({
      id: 'open-review',
      groupId: 'actions',
      text: 'Review',
      description: reviewPendingCount > 0 ? `${reviewPendingCount} pending` : 'No pending reviews',
      searchText: 'review pending approval guardrail mcp write',
      leadingVisual: CAPABILITY_ICON['capability-review'],
      trailingVisual: reviewPendingCount > 0 ? (
        <CounterLabel data-testid="quick-panel-review-count" aria-label={`${reviewPendingCount} pending in Review`}>
          {reviewPendingCount}
        </CounterLabel>
      ) : undefined,
      run: () => openMain('review'),
    })
    return entries
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runWorkflow/jumpToConfigure/openMain close over state already listed or are stable
  }, [workflows, mostUsedRank, requests, lists, mcpServers, reviewPendingCount])

  const filtered = filterPaletteEntries(allEntries, query)

  const items = filtered.map((entry) => ({
    key: entry.id,
    id: entry.id,
    groupId: entry.groupId,
    text: entry.text,
    description: entry.description,
    leadingVisual: entry.leadingVisual,
    trailingVisual: entry.trailingVisual,
    onAction: () => entry.run(),
  }))

  return (
    <div className={styles.panel} data-testid="quick-panel">
      <FilteredActionList
        items={items}
        groupMetadata={GROUP_METADATA}
        filterValue={query}
        onFilterChange={(value) => setQuery(value)}
        placeholderText="Search workflows or jump into Mill…"
        inputRef={inputRef}
        textInputProps={{ 'aria-label': 'Quick Panel search', autoFocus: true }}
        showItemDividers
        messageText={{ title: 'No matches', description: `Nothing matches "${query}"` }}
      />
      {status && (
        <Text as="p" size="small" className={styles.status} data-testid="quick-panel-status">
          {status}
        </Text>
      )}
      {allEntries.length === 0 && (
        <Text as="p" size="small" className={styles.status}>No workflows yet.</Text>
      )}
    </div>
  )
}
