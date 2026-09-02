import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Text } from '@primer/react'
import { FilteredActionList } from '@primer/react/experimental'
import { CommandPaletteIcon, PencilIcon, PlayIcon, TabIcon, XIcon } from '@primer/octicons-react'
import { Events } from '@wailsio/runtime'
import { ExecutionService, RunKind, TriggerService } from '../shared/bindings'
import { COMMANDS } from '../shared/commands'
import { generateSamplePayload } from '../shared/configSchema'
import { useAppStore } from '../shared/store'
import { useVaultStatusStore } from '../shared/vaultStatusStore'
import { useUpdateNoticeStore } from '../shared/updateNoticeStore'
import type { WorkTab } from '../shared/store'
import { tabLabel } from './workTabLabel'
import { findRootNode } from '../composition/triggerRowInfo'
import { clearScratch } from '../composition/canvasScratch'
import { filterPaletteEntries } from './paletteFilter'
import type { PaletteSearchable } from './paletteFilter'
import { sortWorkflowsByPinnedAndFrecency } from './workflowFrecency'
import { HotkeyHint } from '../shared/HotkeyHint'
import { WorkflowRowTrailingVisual } from './WorkflowRowTrailingVisual'
import { matchFacetSuggestions, parseFacetQuery } from '../shared/facetQuery'
import type { FacetVocabEntry } from '../shared/facetQuery'
import { FacetChipRow } from '../shared/FacetChipRow'
import styles from './CommandPalette.module.css'
import { newLocalID } from '../shared/localId'
import { searchInputTextAssistOff } from '../shared/searchInputProps'

// The ⌘K command palette (docs/goals/0015-summon-quick-invoke.md): the
// "what can I do, and what's the shortcut for it next time" surface --
// not just a runner. Lives in app/, not shared/, even though it spans
// commands+workflows+tabs (three genuinely cross-cutting concerns):
// closing a canvas tab correctly needs composition/canvasScratch.ts's
// clearScratch, and shared/ is a dependency-cruiser leaf that can never
// import from composition/ (.claude/rules/frontend.md). app/ has no
// such restriction -- app/WorkTabShell.tsx already imports from both
// composition/ and configure/ for exactly this kind of app-level,
// multi-domain chrome, and this is the same shape.
//
// Built on Primer's FilteredActionList (only exported from
// '@primer/react/experimental' in the installed version -- confirmed
// directly against node_modules/@primer/react/dist/experimental/index.d.ts,
// not assumed from docs; the stable '@primer/react' barrel doesn't
// re-export it) inside the STABLE '@primer/react' Dialog (the same
// Dialog every other modal in this codebase already uses --
// TestRunDialog.tsx, EntityRefField.tsx -- so this doesn't introduce a
// second modal primitive). Dialog's own useOnEscapePress already calls
// onClose('escape') and preventDefault()s, so Escape-to-close needs no
// extra wiring here.
//
// ⌘? / ⌘/ aliases (the goal's "owner reinforcement" note, deferred at
// the time as a cross-cutting registry change) landed later as
// docs/goals/BACKLOG.md Standing #6: shared/commands.ts's Command grew
// an optional `extraBindings: KeyCombo[]` alongside `defaultBinding`
// (backward-compatible), and shared/keybinding.ts's keyFromEventCode
// now recognizes the '/' key. dispatchCommandForEvent checks every
// command's extras too; this Dialog itself needs no changes -- it
// still just renders off the store's paletteOpen flag regardless of
// which bound combo flipped it.

type PaletteGroupId = 'surface' | 'commands' | 'workflows' | 'tabs'

interface PaletteEntry extends PaletteSearchable {
  id: string
  groupId: PaletteGroupId
  text: string
  description?: string
  leadingVisual: ElementType
  trailingVisual?: ReactNode
  run: () => void
}

function groupMetadataFor(t: (key: string) => string) {
  return [
    { groupId: 'surface' as const, header: { title: t('commandPalette.groups.surface') } },
    { groupId: 'commands' as const, header: { title: t('commandPalette.groups.commands') } },
    { groupId: 'workflows' as const, header: { title: t('commandPalette.groups.workflows') } },
    { groupId: 'tabs' as const, header: { title: t('commandPalette.groups.tabs') } },
  ]
}

// Faceted search (goal 0086): vocabulary drawn straight from the
// palette's own groups/types -- "command" covers both the 'commands'
// and 'surface' groupIds (a surface-scoped command is still a
// command, just ranked first), "setting" narrows further still, to
// the per-section deep-link commands shared/settingsCommands.ts
// registers (id `settings.open.<section>`) -- a strict subset of
// "command". Quick Panel's own configure-entity-type facets don't
// apply here: this surface has no Configure jump rows at all.
function facetVocabularyFor(t: (key: string) => string): FacetVocabEntry[] {
  return [
    { key: 'command', label: t('commandPalette.facets.command') },
    { key: 'workflow', label: t('commandPalette.facets.workflow') },
    { key: 'tab', label: t('commandPalette.facets.tab') },
    { key: 'setting', label: t('commandPalette.facets.setting') },
  ]
}

function matchesPaletteFacet(scopeKey: string, entry: PaletteEntry): boolean {
  if (scopeKey === 'command') return entry.groupId === 'commands' || entry.groupId === 'surface'
  if (scopeKey === 'workflow') return entry.groupId === 'workflows'
  if (scopeKey === 'tab') return entry.groupId === 'tabs'
  if (scopeKey === 'setting') return entry.id === 'cmd:settings.open' || entry.id.startsWith('cmd:settings.open.')
  return true
}

// Rest-state bound (design-wave-1 fix #2, Spotlight/Raycast/VS Code
// convention: an empty query shows a short, useful default rather than
// every command/workflow/tab at once). Nav commands are every
// "Go to <capability>" command plus Settings -- the same `view.*` id
// prefix shared/commands.ts already uses, checked once here rather
// than re-deriving a parallel label list.
function isNavCommandId(id: string): boolean {
  return id.startsWith('view.') || id === 'settings.open'
}
const REST_STATE_WORKFLOW_LIMIT = 5

// Frecency ranking window: the entire local run history, same
// frequency-only reasoning + "all time" instant app/QuickPanel.tsx's
// own FRECENCY_FROM_ISO already documents (ExecutionService.HomeMetrics'
// MostUsed, goal 0014's value mirror) -- this is a second, independent
// fetch of the same substrate, not a new algorithm: the palette
// (main-window Dialog) and the Quick Panel (its own Wails window,
// ADR-0033) are different JS contexts with no shared store.
const FRECENCY_FROM_ISO = new Date(0).toISOString()

// A workflow row's description: the label of its root Trigger node's
// NodeType (e.g. "Hotkey trigger", "Schedule trigger") -- a cheap,
// purely-textual derivation (findRootNode + a nodeTypes lookup) rather
// than the full interactive TriggerRowLabel (composition/TriggerRowLabel.tsx,
// which owns its own hotkey-capture state and Publish button -- built
// for a table row, not a filtered-list item). Still doesn't show the
// live ARMED fact TriggerRowLabel does (that's TriggerService.Sync's
// own gate, a separate live-listener check this row has no need to
// re-derive) -- but a trigger-hotkey root's own assigned combo IS shown
// (below, via hotkeyCombos), the same display-when-configured
// simplification TriggerRowLabel's own schedule/watch rows already use
// for "configured" vs "armed." Computed inline in the entries useMemo
// below rather than as a standalone helper -- it's a one-line lookup
// once findRootNode has run.

export function CommandPalette() {
  const { t } = useTranslation('app')
  const GROUP_METADATA = groupMetadataFor(t)
  const paletteOpen = useAppStore((s) => s.paletteOpen)
  const closePalette = useAppStore((s) => s.closePalette)
  const workflows = useAppStore((s) => s.workflows)
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  const requests = useAppStore((s) => s.requests)
  const workTabs = useAppStore((s) => s.workTabs)
  const viewKind = useAppStore((s) => s.view.kind)
  const openWorkTab = useAppStore((s) => s.openWorkTab)
  const activateWorkTab = useAppStore((s) => s.activateWorkTab)
  const closeWorkTab = useAppStore((s) => s.closeWorkTab)
  const pushActivity = useAppStore((s) => s.pushActivity)
  // Workflow pins/favorites (docs/goals/BACKLOG.md Standing #5) -- same
  // store-owned ordered id list app/QuickPanel.tsx reads, shared across
  // both surfaces since they run in the same main-window JS context
  // (unlike the Quick Panel's separate Wails window).
  const pinnedWorkflowIds = useAppStore((s) => s.pinnedWorkflowIds)
  const togglePinnedWorkflow = useAppStore((s) => s.togglePinnedWorkflow)
  // Subscribed so a state door changing WHILE the palette is open
  // (unlocking the vault from another tab, an update finishing its
  // download) re-filters live -- goal 0222 S1's enablement predicates
  // read these same stores (shared/vaultStatusStore.ts,
  // shared/updateNoticeStore.ts) via getState(), which on its own
  // wouldn't trigger a re-render here.
  const vaultStatus = useVaultStatusStore((s) => s.vaultStatus)
  const updateNoticeState = useUpdateNoticeStore((s) => s.updateNoticeState)
  const [query, setQuery] = useState('')
  const [mostUsedRank, setMostUsedRank] = useState<Record<string, number>>({})
  // workflowID -> its trigger-hotkey combo label (TriggerService.
  // ListHotkeys(), e.g. "⌘⇧M") -- fetched the same "on every open, not
  // on mount" way mostUsedRank is, below.
  const [hotkeyCombos, setHotkeyCombos] = useState<Record<string, string | undefined>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetched on every open (not on mount -- the palette stays mounted
  // and toggled via paletteOpen, so a stale rank from an earlier open
  // would otherwise persist across a full session's worth of runs),
  // same substrate app/QuickPanel.tsx's own refreshFrecency reads.
  useEffect(() => {
    if (!paletteOpen) return
    ExecutionService.HomeMetrics(FRECENCY_FROM_ISO, new Date().toISOString(), true)
      .then((metrics) => {
        const rank: Record<string, number> = {}
        for (const usage of metrics.mostUsed ?? []) rank[usage.workflowID] = usage.runCount
        setMostUsedRank(rank)
      })
      .catch(() => {})
    TriggerService.ListHotkeys().then((combos) => setHotkeyCombos(combos ?? {})).catch(() => {})
  }, [paletteOpen])

  // Live sync while the palette stays open: a hotkey assigned/cleared
  // elsewhere (Composition's NodeInspector, another open tab) refreshes
  // the inline combo hints without waiting for the palette to be
  // closed and reopened.
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'hotkey') TriggerService.ListHotkeys().then((combos) => setHotkeyCombos(combos ?? {})).catch(() => {})
    })
  }, [])

  // Runs a workflow through the exact same RPC + RunKind CompositionView's
  // own list-row Run button uses (ExecutionService.RunWorkflow,
  // RunKind.RunKindTest -- docs/adr/0008's single execution path), and
  // pushes the same Activity-feed shape CompositionView.runWithValues
  // does (source: 'composition') so "did it run" is answerable from
  // Activity regardless of which UI fired it. A workflow with declared
  // Attributes runs with generateSamplePayload's defaults immediately
  // rather than opening a review dialog first -- the same defaults
  // TestRunDialog would pre-fill with, just skipping the manual-review
  // step, which is the whole point of a *quick* invoke (the goal's own
  // framing) rather than a second copy of the full test-input flow.
  const runWorkflowTest = (id: string, label: string) => {
    const wf = workflows?.find((w) => w.ID === id)
    const attrs = wf?.Attributes ?? []
    const values = attrs.length > 0 ? generateSamplePayload(attrs) : null
    ExecutionService.RunWorkflow(id, RunKind.RunKindTest, values)
      .then((summary) => {
        pushActivity({
          id: newLocalID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
          source: 'composition', workflowID: id, label,
          success: !summary.error,
          detail: summary.error ? summary.error : `completed (${summary.output.length} bytes)`,
          result: summary.error ? '' : summary.output,
        })
      })
      .catch((err) => {
        pushActivity({
          id: newLocalID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
          source: 'composition', workflowID: id, label,
          success: false, detail: String(err), result: '',
        })
      })
  }

  const workflowLabel = (id: string) => workflows?.find((w) => w.ID === id)?.Label
  const requestLabel = (id: string) => requests?.find((r) => r.ID === id)?.Label

  // Closing a workflow-edit/workflow-new tab from the palette clears its
  // hot-exit scratch too (composition/canvasScratch.ts) -- the same
  // "deliberate tab close discards scratch" contract
  // app/WorkTabShell.tsx's own ✕ button and overflow menu already honor
  // (docs/goals/0012-authoring-hot-exit.md); a request tab never wrote
  // scratch, so clearing it there is a harmless no-op.
  const closeTab = (tab: WorkTab) => {
    if (tab.kind === 'workflow-edit' || tab.kind === 'workflow-new') clearScratch(tab.key)
    closeWorkTab(tab.key)
  }

  // Surface-scoped commands (goal 0071): the active surface's own
  // commands seat FIRST in their own group -- rank, not hide; the
  // global set stays right below. Commands scoped to a DIFFERENT
  // surface are omitted (they cannot run here).
  const commandEntry = (command: (typeof COMMANDS)[number]): PaletteEntry => ({
    id: `cmd:${command.id}`,
    groupId: command.surface ? 'surface' : 'commands',
    text: command.label,
    searchText: `${command.label} ${command.id}`.toLowerCase(),
    keywords: command.keywords,
    leadingVisual: CommandPaletteIcon,
    // HotkeyHint (app/HotkeyHint.tsx) resolves the command's live
    // effective binding itself (default merged with any Settings
    // override) and renders nothing when unbound -- the single
    // source of truth every inline hint in the app now shares
    // (docs/goals/0015), replacing this file's own former local
    // ShortcutHint + effectiveBinding computation.
    trailingVisual: <HotkeyHint commandId={command.id} />,
    run: command.run,
  })

  const workflowEntries = (wf: NonNullable<typeof workflows>[number]): PaletteEntry[] => {
    const root = findRootNode(wf.Nodes, wf.Edges)
    const kindLabel = root ? nodeTypes?.find((nt) => nt.ID === root.NodeTypeID)?.Label : undefined
    const combo = root?.NodeTypeID === 'trigger-hotkey' ? hotkeyCombos[wf.ID] : undefined
    const pinned = pinnedWorkflowIds.includes(wf.ID)
    return [
      {
        id: `run:${wf.ID}`,
        groupId: 'workflows',
        text: t('commandPalette.runLabel', { label: wf.Label }),
        description: kindLabel ?? t('commandPalette.testRun'),
        searchText: `run ${wf.Label}`.toLowerCase(),
        leadingVisual: PlayIcon,
        trailingVisual: (
          <WorkflowRowTrailingVisual
            combo={combo}
            pinned={pinned}
            pinnedClassName={styles.pinnedIndicator}
            unpinnedClassName={styles.pinToggle}
            pinAriaLabel={pinned ? t('commandPalette.unpinWorkflow', { label: wf.Label }) : t('commandPalette.pinWorkflow', { label: wf.Label })}
            onTogglePin={() => togglePinnedWorkflow(wf.ID)}
          />
        ),
        run: () => runWorkflowTest(wf.ID, wf.Label),
      },
      {
        id: `open:${wf.ID}`,
        groupId: 'workflows',
        text: t('commandPalette.openLabel', { label: wf.Label }),
        description: t('commandPalette.openInEditor'),
        searchText: `open editor ${wf.Label}`.toLowerCase(),
        leadingVisual: PencilIcon,
        // "Open in editor" is an explicit edit gesture (docs/goals/0022),
        // matching the PencilIcon/description above.
        run: () => openWorkTab({ kind: 'workflow-edit', workflowId: wf.ID, mode: 'edit' }),
      },
    ]
  }

  const tabEntries = (tab: WorkTab): PaletteEntry[] => {
    const label = tabLabel(tab, workflowLabel, requestLabel, t)
    return [
      {
        id: `switch:${tab.key}`,
        groupId: 'tabs',
        text: t('commandPalette.switchToLabel', { label }),
        description: t('commandPalette.openTab'),
        searchText: `switch tab ${label}`.toLowerCase(),
        leadingVisual: TabIcon,
        run: () => activateWorkTab(tab.key),
      },
      {
        id: `close:${tab.key}`,
        groupId: 'tabs',
        text: t('commandPalette.closeLabel', { label }),
        description: t('commandPalette.closeTab'),
        searchText: `close tab ${label}`.toLowerCase(),
        leadingVisual: XIcon,
        run: () => closeTab(tab),
      },
    ]
  }

  // Rest state (empty query): a bounded set -- every "Go to <X>" nav
  // command + the settings.open command, plus the ~5 most
  // frequently-run workflows (design-wave-1 fix #2's rest-state
  // requirement) -- rather than the full command+workflow+tab list
  // FilteredActionList would otherwise render unfiltered. Work tabs
  // stay unbounded either way: there are only ever as many as the user
  // actually has open, already a small, self-limiting set.
  const restState = query.trim().length === 0

  // A disabled command is OMITTED, not dimmed (goal 0222 S1, VSCode's
  // own palette convention: a command failing its `when` clause simply
  // doesn't appear in results) -- checked last since it's the only
  // predicate that can call into live app state.
  const isCommandAvailable = (c: (typeof COMMANDS)[number]) => !c.paletteHidden && (!c.enabled || c.enabled())

  const allEntries = useMemo<PaletteEntry[]>(() => {
    if (restState) {
      const surfaceCommands = COMMANDS.filter((c) => c.surface?.includes(viewKind) && isCommandAvailable(c)).map(commandEntry)
      const navCommands = COMMANDS.filter((c) => isNavCommandId(c.id)).map(commandEntry)
      const topWorkflows = sortWorkflowsByPinnedAndFrecency(workflows ?? [], mostUsedRank, pinnedWorkflowIds).slice(0, REST_STATE_WORKFLOW_LIMIT)
      return [...surfaceCommands, ...navCommands, ...topWorkflows.flatMap(workflowEntries), ...workTabs.flatMap(tabEntries)]
    }
    return [
      ...COMMANDS.filter((c) => (!c.surface || c.surface.includes(viewKind)) && isCommandAvailable(c)).map(commandEntry),
      ...sortWorkflowsByPinnedAndFrecency(workflows ?? [], mostUsedRank, pinnedWorkflowIds).flatMap(workflowEntries),
      ...workTabs.flatMap(tabEntries),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commandEntry/workflowEntries/tabEntries/isCommandAvailable close over workflows/nodeTypes/requests/workTabs/mostUsedRank/hotkeyCombos/pinnedWorkflowIds/togglePinnedWorkflow/vaultStatus/updateNoticeState/t, already listed
  }, [restState, workflows, nodeTypes, requests, workTabs, mostUsedRank, hotkeyCombos, pinnedWorkflowIds, viewKind, vaultStatus, updateNoticeState, t])

  // Faceted search (goal 0086): the scope narrows allEntries FIRST,
  // then filterPaletteEntries ranks the remainder against the
  // post-token text -- an empty text (just "workflow: ") already lists
  // every entry in that scope, since filterPaletteEntries returns its
  // input unranked for a blank query.
  const facetVocab = useMemo(() => facetVocabularyFor(t), [t])
  const parsed = useMemo(() => parseFacetQuery(query, facetVocab), [query, facetVocab])
  const chipSuggestions = useMemo(
    () => (parsed.scopeKey || !query.trim() ? [] : matchFacetSuggestions(query, facetVocab)),
    [parsed.scopeKey, query, facetVocab],
  )
  const scopedEntries = useMemo(
    () => (parsed.scopeKey ? allEntries.filter((e) => matchesPaletteFacet(parsed.scopeKey!, e)) : allEntries),
    [allEntries, parsed.scopeKey],
  )
  const filtered = restState ? allEntries : filterPaletteEntries(scopedEntries, parsed.text)

  const selectChip = (key: string) => {
    const entry = facetVocab.find((v) => v.key === key)
    if (!entry) return
    setQuery(`${entry.label}: `)
    inputRef.current?.focus()
  }

  const items = filtered.map((entry) => ({
    key: entry.id,
    id: entry.id,
    groupId: entry.groupId,
    text: entry.text,
    description: entry.description,
    leadingVisual: entry.leadingVisual,
    trailingVisual: entry.trailingVisual,
    onAction: () => {
      entry.run()
      closePalette()
    },
  }))

  if (!paletteOpen) return null

  return (
    <Dialog
      title={t('commandPalette.title')}
      subtitle={t('commandPalette.subtitle')}
      onClose={() => closePalette()}
      width="large"
      height="auto"
      initialFocusRef={inputRef}
    >
      <FacetChipRow
        items={chipSuggestions.map((entry) => ({ key: entry.key, label: entry.label }))}
        onSelect={selectChip}
        ariaLabel={t('commandPalette.facets.suggestionsAriaLabel')}
      />
      <FilteredActionList
        className={styles.list}
        items={items}
        groupMetadata={GROUP_METADATA}
        filterValue={query}
        onFilterChange={(value) => setQuery(value)}
        placeholderText={t('commandPalette.searchPlaceholder')}
        inputRef={inputRef}
        textInputProps={{ 'aria-label': t('commandPalette.searchAriaLabel'), ...searchInputTextAssistOff }}
        showItemDividers
        messageText={{ title: t('search.noMatchesTitle'), description: t('search.noMatchesDescription', { query }) }}
      />
      {allEntries.length === 0 && (
        <Text as="p" size="small" className={styles.empty}>{t('commandPalette.nothingToSearchYet')}</Text>
      )}
    </Dialog>
  )
}
