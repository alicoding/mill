import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import { Text } from '@primer/react'
import { FilteredActionList } from '@primer/react/experimental'
import { GearIcon, HomeIcon, PlayIcon } from '@primer/octicons-react'
import { ExecutionService, RunKind, SettingsService } from '../shared/bindings'
import { generateSamplePayload } from '../shared/configSchema'
import { useAppStore, refreshWorkflows } from '../shared/store'
import { filterPaletteEntries } from './paletteFilter'
import type { PaletteSearchable } from './paletteFilter'
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

type PanelGroupId = 'workflows' | 'actions'

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
  { groupId: 'actions' as const, header: { title: 'Mill' } },
]

function ShortcutHint({ text }: { text: string }) {
  return <span className={styles.shortcut}>{text}</span>
}

export function QuickPanel() {
  const workflows = useAppStore((s) => s.workflows)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string | null>(null)
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
    for (const wf of workflows ?? []) {
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
      trailingVisual: <ShortcutHint text="⌘," />,
      run: () => openMain('settings'),
    })
    return entries
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runWorkflow closes over workflows, already listed
  }, [workflows])

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
