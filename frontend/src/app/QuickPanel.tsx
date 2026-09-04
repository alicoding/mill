import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Text } from '@primer/react'
import { FilteredActionList } from '@primer/react/experimental'
import { PlayIcon } from '@primer/octicons-react'
import { ExecutionService, SettingsService, TriggerService } from '../shared/bindings'
import { useAppStore, refreshWorkflows, refreshRequests, refreshKeybindings } from '../shared/store'
import {
  useConfigureEntityStore, refreshLists, refreshMCPServers, refreshDecisions, refreshExecEnvs, refreshAIProviders, refreshDeclaredStepTypes,
} from '../shared/configureEntityStore'
import { useAtlasStore, scheduleAtlasRefresh, refreshAtlasCards, refreshAtlasKinds, refreshAtlasNotes } from '../atlas/atlasStore'
import { refreshUpdateNoticeState, useUpdateNoticeStore } from '../shared/updateNoticeStore'
import { findRootNode } from '../composition/triggerRowInfo'
import { sortWorkflowsByPinnedAndFrecency } from './workflowFrecency'
import { WorkflowRowTrailingVisual } from './WorkflowRowTrailingVisual'
import { buildConfigureAndActionEntries } from './quickPanelActionEntries'
import type { PanelEntry } from './quickPanelActionEntries'
import { useQuickPanelCaptureDoors } from './useQuickPanelCaptureDoors'
import { QuickPanelClipboardApplyDoor } from './QuickPanelClipboardApplyDoor'
import { QuickPanelCodingLoop } from './QuickPanelCodingLoop'
import { useQuickPanelCodingLoopDoor } from './useQuickPanelCodingLoopDoor'
import { QuickPanelReplyReviewDoor } from './QuickPanelReplyReviewDoor'
import { useQuickPanelClipboardDoor } from './useQuickPanelClipboardDoor'
import { FacetChipRow } from '../shared/FacetChipRow'
import { useQuickPanelFacetSearch } from './quickPanelFacets'
import { useQuickPanelRun, useQuickPanelWorkflowActions } from './useQuickPanelWorkflowActions'
import { QuickPanelFooter } from './QuickPanelFooter'
import { useQuickPanelUpdateStatus } from './useQuickPanelUpdateStatus'
import styles from './QuickPanel.module.css'
import { searchInputTextAssistOff } from '../shared/searchInputProps'
import { background } from '../shared/background'

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

function groupMetadataFor(t: (key: string) => string) {
  return [
    { groupId: 'workflows' as const, header: { title: t('quickPanel.groups.workflows') } },
    { groupId: 'configure' as const, header: { title: t('quickPanel.groups.configure') } },
    { groupId: 'atlas' as const, header: { title: t('quickPanel.groups.atlas') } },
    { groupId: 'actions' as const, header: { title: t('quickPanel.groups.actions') } },
  ]
}

// Frequency-only ranking window (goal 0015's remainder): the entire
// local run history, not a rolling recent window -- "frequently-used
// float up" shouldn't reset just because a workflow's last run was
// over a month ago. ExecutionService.HomeMetrics requires an RFC3339
// instant, not an "all time" flag, so this is simply an instant well
// before Mill could have any real run history.
const FRECENCY_FROM_ISO = new Date(0).toISOString()

export function QuickPanel() {
  const { t } = useTranslation('app')
  const GROUP_METADATA = groupMetadataFor(t)
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
  // Quick-access parity sweep (goal 0071 G5): the same jump-row
  // pattern's remaining four Configure entity kinds.
  const decisions = useConfigureEntityStore((s) => s.decisions)
  const execEnvs = useConfigureEntityStore((s) => s.execEnvs)
  const aiProviders = useConfigureEntityStore((s) => s.aiProviders)
  const declaredStepTypes = useConfigureEntityStore((s) => s.declaredStepTypes)
  const atlasCards = useAtlasStore((s) => s.cards)
  const atlasKinds = useAtlasStore((s) => s.kinds)
  // The away-capture door's own cascade math (docs/goals/0090) needs
  // the current note count per parent -- fetched alongside cards/kinds
  // below, never rendered as its own row (notes stay excluded from
  // search, same as the main Atlas surface).
  // Workflow pins/favorites (docs/goals/BACKLOG.md Standing #5): a
  // plain ordered workflow-ID list, store-owned/localStorage-tier --
  // see shared/store.ts's own declaration comment for the schema.
  const pinnedWorkflowIds = useAppStore((s) => s.pinnedWorkflowIds)
  const togglePinnedWorkflow = useAppStore((s) => s.togglePinnedWorkflow)
  // Subscribed (not getState()) so the update pipeline's quickPanel rows
  // (shared/settingsCommands.ts) re-derive live -- same subscription
  // CommandPalette.tsx already carries for the identical reason.
  const updateNoticeState = useUpdateNoticeStore((s) => s.updateNoticeState)
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
  // workflowID -> its trigger-hotkey combo label (TriggerService.
  // ListHotkeys(), e.g. "⌘⇧M") -- the workflow-trigger half of goal
  // 0015's inline-hotkey-hint remainder, display-when-configured only
  // (no live armed-state fetch, same simplification the palette's own
  // hotkeyCombos state documents).
  const [hotkeyCombos, setHotkeyCombos] = useState<Record<string, string | undefined>>({})
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

  // Declared before the effects that reference them (react-hooks/
  // immutability, eslint-plugin-react-hooks 7.x's React-Compiler-derived
  // check) -- functionally identical either way since the effects only
  // invoke these in later callbacks, but the rule wants the lexical
  // declaration to precede any reference.
  const refreshFrecency = () => {
    void background(ExecutionService.HomeMetrics(FRECENCY_FROM_ISO, new Date().toISOString(), true)
      .then((metrics) => {
        const rank: Record<string, number> = {}
        for (const usage of metrics.mostUsed ?? []) rank[usage.workflowID] = usage.runCount
        setMostUsedRank(rank)
      }), 'quick.homeMetrics')
  }

  const refreshHotkeyCombos = () => {
    void background(TriggerService.ListHotkeys().then((combos) => setHotkeyCombos(combos ?? {})), 'quick.listHotkeys')
  }

  const openMain = (view: string) => {
    void background(SettingsService.OpenMainWindow(view), 'quick.openMainWindow')
  }

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
      void refreshDecisions()
      void refreshExecEnvs()
      void refreshAIProviders()
      void refreshDeclaredStepTypes()
      void refreshAtlasCards()
      void refreshAtlasKinds()
      void refreshAtlasNotes()
      void refreshFrecency()
      void refreshHotkeyCombos()
      // The update pipeline's quickPanel rows need this window's own
      // copy of the state door, same per-window reasoning as above.
      void refreshUpdateNoticeState()
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

  // Live sync while the panel stays open (goal 0017's mill-data-changed
  // infra, docs/adr/0025): a Configure entity created/renamed/deleted
  // elsewhere -- the main window, another tool, an MCP author -- while
  // this window happens to be open updates the jump rows without
  // waiting for the next show. Scoped to just the entity kinds this
  // panel actually renders (workflow/run for frecency+the row list,
  // request/list/mcpserver for the Configure jump rows, hotkey/
  // keybinding for the inline combo hints); 'run' also refreshes
  // frecency since a new run changes MostUsed's ranking. hotkey/
  // keybinding are ALSO refetched on every show (focusAndReset above)
  // -- this closes the gap while the panel stays open between shows.
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'workflow') void refreshWorkflows()
      if (entity === 'run') { void refreshWorkflows(); refreshFrecency() }
      if (entity === 'request') void refreshRequests()
      if (entity === 'list') void refreshLists()
      if (entity === 'mcpserver') void refreshMCPServers()
      if (entity === 'decision') void refreshDecisions()
      if (entity === 'execenv') void refreshExecEnvs()
      if (entity === 'aiprovider') void refreshAIProviders()
      if (entity === 'steptype') void refreshDeclaredStepTypes()
      if (entity === 'update-notice') void refreshUpdateNoticeState()
      // Coalesced (goal 0147): the shared debounced refresher covers
      // every store consumer, this window included.
      if (entity === 'atlas') scheduleAtlasRefresh()
      if (entity === 'hotkey') refreshHotkeyCombos()
      if (entity === 'keybinding') void refreshKeybindings()
    })
  }, [])

  // Same two events + same two RPCs App.tsx's own reviewPendingCount
  // effect uses -- see this state's own declaration comment above for
  // why this is a second, display-only instance rather than a shared
  // one.
  useEffect(() => {
    const refresh = () => {
      void Promise.all([
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

  // A card row's "run" is a jump, same shape as jumpToConfigure above --
  // shows the main window on the Atlas surface, already drilled to the
  // card's parent with its own overlay open (App.tsx's useMillNavigate).
  const jumpToAtlasCard = (cardID: string) => {
    openMain(`atlas:${cardID}`)
  }

  // Workflow row actions (goal 0294): Enter runs, ⌘Enter opens the
  // workflow, ⌘⇧Enter runs and opens its canvas, ⌘K lists them all.
  const { runWorkflow: runWorkflowRow, lastRun } = useQuickPanelRun({ setStatus, t })
  useQuickPanelUpdateStatus(setStatus, t)
  const runWorkflow = (id: string) => {
    const wf = workflows?.find((w) => w.ID === id)
    if (wf) runWorkflowRow(wf)
  }

  // The clipboard door (goals 0039 + 0099) lives in its own hook --
  // one row recognizes both a workflow export and a mill reply.
  const { clipboardApply, setClipboardApply, replyReview, setReplyReview, applyFromClipboard } = useQuickPanelClipboardDoor(t)
  const { codingLoopText, runFromClipboard: runCodingLoopFromClipboard, closeCodingLoop } = useQuickPanelCodingLoopDoor()

  // The capture doors (note, task) live in their own hook.
  const { captureEntries, captureLaunchEntries, pluginCaptures } = useQuickPanelCaptureDoors({ t, setQuery, setStatus })

  const allEntries = useMemo<PanelEntry[]>(() => {
    const entries: PanelEntry[] = []
    // Pinned-then-frecency-sorted (docs/goals/BACKLOG.md Standing #5 +
    // goal 0015's remainder item 1) -- frequency-only among the
    // unpinned tail, see mostUsedRank's own declaration comment.
    for (const wf of sortWorkflowsByPinnedAndFrecency(workflows ?? [], mostUsedRank, pinnedWorkflowIds)) {
      const pinned = pinnedWorkflowIds.includes(wf.ID)
      const root = findRootNode(wf.Nodes, wf.Edges)
      const combo = root?.NodeTypeID === 'trigger-hotkey' ? hotkeyCombos[wf.ID] : undefined
      entries.push({
        id: `run:${wf.ID}`,
        groupId: 'workflows',
        text: wf.Label,
        description: t('quickPanel.entries.enterToRun'),
        searchText: wf.Label.toLowerCase(),
        leadingVisual: PlayIcon,
        trailingVisual: (
          <WorkflowRowTrailingVisual
            combo={combo}
            pinned={pinned}
            pinnedClassName={styles.pinnedIndicator}
            unpinnedClassName={styles.pinToggle}
            pinAriaLabel={pinned ? t('quickPanel.entries.unpinWorkflow', { label: wf.Label }) : t('quickPanel.entries.pinWorkflow', { label: wf.Label })}
            onTogglePin={() => togglePinnedWorkflow(wf.ID)}
          />
        ),
        run: () => runWorkflow(wf.ID),
      })
    }
    // Configure-entity jump rows + the panel's fixed action rows
    // (goal 0015's remainder items 2/3) -- extracted to
    // quickPanelActionEntries.tsx (architecture.md's 500-line
    // convention); this useMemo owns only the workflow-row loop above,
    // which needs per-row pin/hotkey-chip state this shared builder
    // doesn't.
    entries.push(...captureLaunchEntries())
    entries.push(...buildConfigureAndActionEntries({
      t, requests, lists, mcpServers, decisions, execEnvs, aiProviders, declaredStepTypes,
      atlasCards, atlasKinds, reviewPendingCount, jumpToConfigure, jumpToAtlasCard, openMain, applyFromClipboard,
      runCodingLoopFromClipboard,
    }))
    return entries
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runWorkflow/jumpToConfigure/jumpToAtlasCard/openMain/applyFromClipboard/runCodingLoopFromClipboard/togglePinnedWorkflow close over state already listed or are stable
  }, [
    workflows, mostUsedRank, hotkeyCombos, pinnedWorkflowIds, requests, lists, mcpServers,
    decisions, execEnvs, aiProviders, declaredStepTypes, atlasCards, atlasKinds, reviewPendingCount,
    // The capture launch rows (goal 0309) re-render once the plugin
    // captures list resolves.
    pluginCaptures,
    // Not read directly below -- the command enabled() checks inside
    // buildConfigureAndActionEntries read it via getState() instead.
    updateNoticeState,
  ])

  // Faceted search (goal 0086) -- quickPanelFacets.ts's own hook, same
  // scope-then-rank shape app/CommandPalette.tsx runs inline.
  const { filtered, chipSuggestions, selectChip } = useQuickPanelFacetSearch({ t, allEntries, query, setQuery, inputRef })

  // The save-note row (docs/goals/0090) never goes through
  // filterPaletteEntries -- it isn't a match against the typed text,
  // it's an action ON the typed text, so it's appended after
  // filtering rather than searched. Pushed onto the 'actions' group
  // (GROUP_METADATA's own last group) AFTER every other action row,
  // which keeps it the last-rendered entry overall: FilteredActionList
  // buckets items by groupId while preserving each bucket's original
  // push order.
  const trimmedQuery = query.trim()
  const withCapture: PanelEntry[] = [...filtered, ...captureEntries(trimmedQuery)]

  // Group order follows the ranking while a query is typed (goal 0295):
  // the group holding the best match renders first, so a keyword hit
  // on a Mill action outranks a workflow that merely contains the
  // word. At rest the fixed order stands.
  // Only groups with a row render (goal 0303): the kit renders every
  // group header it is handed, rows or not, and a no-match query left
  // three empty headings under the capture rows.
  const presentGroups = GROUP_METADATA.filter((g) => withCapture.some((e) => e.groupId === g.groupId))
  const groupMetadata = trimmedQuery
    ? [...presentGroups].sort((a, b) => {
      const rank = (id: string) => { const i = withCapture.findIndex((e) => e.groupId === id); return i < 0 ? Number.MAX_SAFE_INTEGER : i }
      return rank(a.groupId) - rank(b.groupId)
    })
    : presentGroups
  // The rows the shortcuts can target, in list order (the hook falls
  // back to the first when the list has no active row yet).
  const visibleWorkflowIds = withCapture.filter((e) => e.groupId === 'workflows').map((e) => e.id.slice('run:'.length))
  const rowActions = useQuickPanelWorkflowActions({ workflows, visibleWorkflowIds, pinnedWorkflowIds, runWorkflow: runWorkflowRow, lastRun, t })
  const items = withCapture.map((entry) => ({
    key: entry.id,
    id: entry.id,
    groupId: entry.groupId,
    text: entry.text,
    description: entry.description,
    leadingVisual: entry.leadingVisual,
    trailingVisual: entry.trailingVisual,
    // The row's own entry id, read back off the active descendant by
    // useQuickPanelWorkflowActions (the list generates the DOM id).
    'data-entry-id': entry.id,
    onAction: () => entry.run(),
  }))

  // docs/goals/0039: a non-null clipboardApply/replyReview/codingLoopText
  // swaps the ENTIRE panel body -- the frameless floating window
  // (ADR-0033) has no room for a second, nested surface, so this is a
  // full replacement, not an overlay.
  if (replyReview) {
    return (
      <QuickPanelReplyReviewDoor
        preview={replyReview}
        t={t}
        onCancel={() => setReplyReview(null)}
        onApplied={(msg) => { setReplyReview(null); setStatus(msg) }}
      />
    )
  }

  if (codingLoopText) {
    return <QuickPanelCodingLoop clipboardText={codingLoopText} onClose={closeCodingLoop} />
  }

  if (clipboardApply) {
    return (
      <QuickPanelClipboardApplyDoor
        json={clipboardApply.json}
        preview={clipboardApply.preview}
        t={t}
        onCancel={() => setClipboardApply(null)}
        onApplied={(msg) => { setClipboardApply(null); setStatus(msg) }}
      />
    )
  }

  return (
    <div className={styles.panel} data-testid="quick-panel">
      <FacetChipRow
        items={chipSuggestions.map((entry) => ({ key: entry.key, label: entry.label }))}
        onSelect={selectChip}
        ariaLabel={t('quickPanel.facets.suggestionsAriaLabel')}
      />
      <FilteredActionList
        items={items}
        groupMetadata={groupMetadata}
        filterValue={query}
        onFilterChange={(value) => setQuery(value)}
        placeholderText={t('quickPanel.searchPlaceholder')}
        inputRef={inputRef}
        textInputProps={{ 'aria-label': t('quickPanel.searchAriaLabel'), autoFocus: true, ...searchInputTextAssistOff }}
        showItemDividers
        onActiveDescendantChanged={rowActions.onActiveDescendantChanged}
        messageText={{ title: t('search.noMatchesTitle'), description: t('search.noMatchesDescription', { query }) }}
      />
      {allEntries.length === 0 && (
        <Text as="p" size="small" className={styles.status}>{t('quickPanel.noWorkflowsYet')}</Text>
      )}
      <QuickPanelFooter
        status={status}
        hasWorkflowRow={rowActions.activeWorkflow !== null}
        actions={rowActions.actions}
        open={rowActions.actionsOpen}
        onOpenChange={(open) => {
          rowActions.setActionsOpen(open)
          // The menu hands focus back to its anchor button; typing must
          // land in the search again, after the menu's own focus return.
          if (!open) window.requestAnimationFrame(() => inputRef.current?.focus())
        }}
        t={t}
      />
    </div>
  )
}
