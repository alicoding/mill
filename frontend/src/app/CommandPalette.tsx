import { useMemo, useRef, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Text } from '@primer/react'
import { FilteredActionList } from '@primer/react/experimental'
import { CommandPaletteIcon, PencilIcon, PlayIcon, TabIcon, XIcon } from '@primer/octicons-react'
import { ExecutionService, RunKind } from '../shared/bindings'
import { COMMANDS } from '../shared/commands'
import { generateSamplePayload } from '../shared/configSchema'
import { useAppStore } from '../shared/store'
import type { WorkTab } from '../shared/store'
import { tabLabel } from './workTabLabel'
import { findRootNode } from '../composition/triggerRowInfo'
import { clearScratch } from '../composition/canvasScratch'
import { filterPaletteEntries } from './paletteFilter'
import type { PaletteSearchable } from './paletteFilter'
import { HotkeyHint } from './HotkeyHint'
import styles from './CommandPalette.module.css'

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
// ⌘? / ⌘/ aliases (the goal's "owner reinforcement" note) are
// deliberately NOT built: shared/commands.ts's Command shape is one
// binding per command (`defaultBinding: KeyCombo | null`), and both
// dispatchCommandForEvent and the Settings "Keyboard Shortcuts" rebind
// UI (KeyboardShortcutsSection.tsx) key off that 1:1 assumption, as
// does the Go side's persisted-override map (settingsservice_keymap.go,
// one KeyCombo per command id). Adding a second real `palette.open`
// command row instead would show two identically-labelled, independently
// rebindable rows in Settings -- not a clean alias. A real alias needs
// either `defaultBinding: KeyCombo[]` threaded through all of the above,
// or teaching shared/keybinding.ts's keyFromEventCode a bare '/'/'?' key
// outside the registry entirely -- both cross-cutting enough that this
// stays ⌘K-only per this goal's own "don't restructure the registry,
// ship ⌘K only and note the deferral" instruction.

type PaletteGroupId = 'commands' | 'workflows' | 'tabs'

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
    { groupId: 'commands' as const, header: { title: t('commandPalette.groups.commands') } },
    { groupId: 'workflows' as const, header: { title: t('commandPalette.groups.workflows') } },
    { groupId: 'tabs' as const, header: { title: t('commandPalette.groups.tabs') } },
  ]
}

// A workflow row's description: the label of its root Trigger node's
// NodeType (e.g. "Hotkey trigger", "Schedule trigger") -- a cheap,
// purely-textual derivation (findRootNode + a nodeTypes lookup, no RPC,
// no live hook) rather than the full interactive TriggerRowLabel
// (composition/TriggerRowLabel.tsx, which owns its own hotkey-capture
// state and Publish button -- built for a table row, not a
// filtered-list item). Doesn't show the live armed/hotkey-combo detail
// TriggerRowLabel does; that's a real, named simplification, not an
// oversight -- see this task's own report for the full reasoning.
// Computed inline in the entries useMemo below rather than as a
// standalone helper -- it's a one-line lookup once findRootNode has run.

export function CommandPalette() {
  const { t } = useTranslation('app')
  const GROUP_METADATA = groupMetadataFor(t)
  const paletteOpen = useAppStore((s) => s.paletteOpen)
  const closePalette = useAppStore((s) => s.closePalette)
  const workflows = useAppStore((s) => s.workflows)
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  const requests = useAppStore((s) => s.requests)
  const workTabs = useAppStore((s) => s.workTabs)
  const openWorkTab = useAppStore((s) => s.openWorkTab)
  const activateWorkTab = useAppStore((s) => s.activateWorkTab)
  const closeWorkTab = useAppStore((s) => s.closeWorkTab)
  const pushActivity = useAppStore((s) => s.pushActivity)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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
          id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
          source: 'composition', workflowID: id, label,
          success: !summary.error,
          detail: summary.error ? summary.error : `completed (${summary.output.length} bytes)`,
          result: summary.error ? '' : summary.output,
        })
      })
      .catch((err) => {
        pushActivity({
          id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
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

  const allEntries = useMemo<PaletteEntry[]>(() => {
    const entries: PaletteEntry[] = []

    for (const command of COMMANDS) {
      entries.push({
        id: `cmd:${command.id}`,
        groupId: 'commands',
        text: command.label,
        searchText: `${command.label} ${command.id}`.toLowerCase(),
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
    }

    for (const wf of workflows ?? []) {
      const root = findRootNode(wf.Nodes, wf.Edges)
      const kindLabel = root ? nodeTypes?.find((nt) => nt.ID === root.NodeTypeID)?.Label : undefined
      entries.push({
        id: `run:${wf.ID}`,
        groupId: 'workflows',
        text: t('commandPalette.runLabel', { label: wf.Label }),
        description: kindLabel ?? t('commandPalette.testRun'),
        searchText: `run ${wf.Label}`.toLowerCase(),
        leadingVisual: PlayIcon,
        run: () => runWorkflowTest(wf.ID, wf.Label),
      })
      entries.push({
        id: `open:${wf.ID}`,
        groupId: 'workflows',
        text: t('commandPalette.openLabel', { label: wf.Label }),
        description: t('commandPalette.openInEditor'),
        searchText: `open editor ${wf.Label}`.toLowerCase(),
        leadingVisual: PencilIcon,
        // "Open in editor" is an explicit edit gesture (docs/goals/0022),
        // matching the PencilIcon/description above.
        run: () => openWorkTab({ kind: 'workflow-edit', workflowId: wf.ID, mode: 'edit' }),
      })
    }

    for (const tab of workTabs) {
      const label = tabLabel(tab, workflowLabel, requestLabel, t)
      entries.push({
        id: `switch:${tab.key}`,
        groupId: 'tabs',
        text: t('commandPalette.switchToLabel', { label }),
        description: t('commandPalette.openTab'),
        searchText: `switch tab ${label}`.toLowerCase(),
        leadingVisual: TabIcon,
        run: () => activateWorkTab(tab.key),
      })
      entries.push({
        id: `close:${tab.key}`,
        groupId: 'tabs',
        text: t('commandPalette.closeLabel', { label }),
        description: t('commandPalette.closeTab'),
        searchText: `close tab ${label}`.toLowerCase(),
        leadingVisual: XIcon,
        run: () => closeTab(tab),
      })
    }

    return entries
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runWorkflowTest/closeTab close over workflows/pushActivity/etc, already listed
  }, [workflows, nodeTypes, requests, workTabs, t])

  const filtered = filterPaletteEntries(allEntries, query)

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
      <FilteredActionList
        items={items}
        groupMetadata={GROUP_METADATA}
        filterValue={query}
        onFilterChange={(value) => setQuery(value)}
        placeholderText={t('commandPalette.searchPlaceholder')}
        inputRef={inputRef}
        textInputProps={{ 'aria-label': t('commandPalette.searchAriaLabel') }}
        showItemDividers
        messageText={{ title: t('search.noMatchesTitle'), description: t('search.noMatchesDescription', { query }) }}
      />
      {allEntries.length === 0 && (
        <Text as="p" size="small" className={styles.empty}>{t('commandPalette.nothingToSearchYet')}</Text>
      )}
    </Dialog>
  )
}
