import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Button, Heading, Label, Stack, Text } from '@primer/react'
import { PlusIcon, UploadIcon, WorkflowIcon } from '@primer/octicons-react'
import { CompositionService, ExecutionService, TriggerService } from '../shared/bindings'
import { RunKind } from '../shared/bindings'
import { generateSamplePayload } from '../shared/configSchema'
import { refreshNodeTypes, refreshWorkflows, useAppStore } from '../shared/store'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { describeSeedReset } from '../shared/seedLifecycle'
import { RestoreExamplesButton } from '../shared/RestoreExamplesButton'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import TestRunDialog from './TestRunDialog'
import { workflowPayloadHint } from './triggerPayload'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { WorkflowsTable } from './WorkflowsTable'
import { TriggerRowLabel } from './TriggerRowLabel'
import { findRootNode } from './triggerRowInfo'
import { hasDraftDrift } from './draftDrift'

// The Workflows list page (SPEC.md §3 / ADR-0005). Editor tabs no
// longer live here: opening/editing a workflow goes through the store's
// app-wide work-tab strip (docs/SPEC.md §3.8, app/WorkTabShell.tsx), so
// an open canvas survives navigating to any other section. This page is
// purely the inventory -- list, Run (a test run of the draft,
// docs/adr/0008/0021), Import/Export, and open-in-tab actions.
//
// Rows are the DEFAULT view (docs/goals/0007-resource-inventory-
// redesign.md): InventoryList's shared, identity-differentiated row
// replaces the old WorkflowsCards.tsx fat-card renderer outright (not
// hidden behind a flag -- deleted). Row click opens the editor (the
// old pencil-icon Edit action, now the row's primary interaction, per
// the goal's own reference-platform precedent: "row-click opens");
// Export/Delete move into the row's trailing ⋯ menu. Run/Test stays a
// directly-visible primary action, and the trigger-derived label/
// Publish CTA (docs/goals/0006) stays directly visible too -- neither
// is secondary enough to bury in a menu.
function CompositionView() {
  const { t } = useTranslation('composition')
  const pushActivity = useAppStore((s) => s.pushActivity)
  const workflows = useAppStore((s) => s.workflows)
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  const openWorkTab = useAppStore((s) => s.openWorkTab)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Test-input form (docs/adr/0008, SPEC.md §3.2's "per-record test
  // harness"): set only while the dialog for a workflow with declared
  // Attributes is open.
  const [testRunTarget, setTestRunTarget] = useState<{ id: string; values: Record<string, string>; payload: string } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-workflows-view-mode')
  // Trigger-aware row state (docs/goals/0006-trigger-aware-workflows-list.md):
  // which workflows currently have a live TriggerService listener --
  // the source of truth for a row's armed/not-live badge, fetched once
  // here (not recomputed per row) and refetched whenever it could have
  // changed (Publish, an inline hotkey assign/unassign on a row).
  const [armedWorkflows, setArmedWorkflows] = useState<Record<string, boolean | undefined>>({})
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  // Seed lifecycle (docs/goals/0037): the currently-shipped revision
  // per golden ID (drives the reset menu item's "vN" label) and the
  // tombstoned-but-restorable list (drives the header's "Restore
  // example…" button, hidden entirely when empty). Page-local state,
  // same as armedWorkflows above -- rarely changes, only this page
  // needs it.
  const [seedRevisions, setSeedRevisions] = useState<Record<string, number | undefined>>({})
  const [restorable, setRestorable] = useState<Workflow[]>([])

  const refreshSeedLifecycle = useCallback(() => {
    CompositionService.SeedRevisions().then((m) => setSeedRevisions(m ?? {})).catch(console.error)
    CompositionService.RestorableWorkflows().then((r) => setRestorable(r ?? [])).catch(console.error)
  }, [])

  const refreshArmed = useCallback(() => {
    TriggerService.ArmedWorkflows()
      .then((m) => setArmedWorkflows(m ?? {}))
      .catch(console.error)
  }, [])

  useEffect(() => {
    void refreshWorkflows()
    void refreshNodeTypes()
    refreshArmed()
    refreshSeedLifecycle()
  }, [refreshArmed, refreshSeedLifecycle])

  // goal 0017 P2: a Publish/disable/delete elsewhere (another tab, an
  // MCP author) can arm or disarm a workflow's trigger listener --
  // armedWorkflows used to only refresh from THIS page's own Publish
  // button/mount, so that badge could silently go stale for a change
  // made anywhere else. refreshWorkflows() already runs on the same
  // event (App.tsx), but the list's own store update doesn't imply
  // TriggerService's separately-tracked armed-set changed too.
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'workflow') refreshArmed()
    })
  }, [refreshArmed])

  // The row-level Publish CTA (docs/goals/0006, decision 2): publishing
  // is what's actually blocking a configured-but-not-live trigger from
  // arming (TriggerService.Sync's own gate), so this is the same
  // CompositionService.PublishWorkflow call WorkflowVersionsPanel.tsx's
  // "Publish current draft" button makes, just reachable straight from
  // the list without opening the workflow's editor first.
  const publishWorkflow = (id: string) => {
    setPublishingId(id)
    setPublishError(null)
    CompositionService.PublishWorkflow(id)
      .then(() => {
        refreshArmed()
        return refreshWorkflows()
      })
      .catch((err) => setPublishError(String(err)))
      .finally(() => setPublishingId(null))
  }

  // Runs through ExecutionService.RunWorkflow, tagged RunKindTest --
  // docs/adr/0008's single execution path; per ADR-0021 a test run
  // executes the draft head, publish state untouched.
  const runWithValues = (id: string, values: Record<string, string> | null, payload?: string) => {
    const label = workflows?.find((w) => w.ID === id)?.Label ?? id
    setRunningId(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    // payload substitutes what the workflow's trigger would have
    // delivered (triggerPayload.ts) -- same seam the canvas Run uses.
    const call = payload
      ? ExecutionService.RunWorkflowWithPayload(id, RunKind.RunKindTest, values, payload)
      : ExecutionService.RunWorkflow(id, RunKind.RunKindTest, values)
    call
      .then((summary) => {
        if (summary.error) {
          setErrors((prev) => ({ ...prev, [id]: summary.error }))
          pushActivity({
            id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
            source: 'composition', workflowID: id, label,
            // result carries the ERROR on failure (not '') so the row
            // stays expandable and the full error is inspectable, same
            // as a success's output -- §1's nothing-hidden applied to
            // failures. Found via Linux CI: clipboard steps fail there,
            // and '' made every failed row silently unexpandable.
            success: false, detail: summary.error, result: summary.error,
          })
          return
        }
        setResults((prev) => ({ ...prev, [id]: summary.output }))
        pushActivity({
          id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
          source: 'composition', workflowID: id, label,
          success: true, detail: `completed (${summary.output.length} bytes)`, result: summary.output,
        })
      })
      .catch((err) => {
        setErrors((prev) => ({ ...prev, [id]: String(err) }))
        pushActivity({
          id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
          source: 'composition', workflowID: id, label,
          success: false, detail: String(err), result: String(err),
        })
      })
      .finally(() => setRunningId(null))
  }

  // A workflow with no declared Attributes runs immediately; the
  // test-input dialog only appears when there's something to fill in.
  const run = (id: string) => {
    const wf = workflows?.find((w) => w.ID === id)
    const attrs = wf?.Attributes ?? []
    // The dialog also opens attribute-less when the trigger normally
    // supplies the run's input (triggerPayload.ts) -- otherwise a test
    // run of e.g. the saved-page seed is dead-on-arrival with an empty
    // payload, the live failure that prompted this.
    if (attrs.length === 0 && !workflowPayloadHint(wf)) {
      runWithValues(id, null)
      return
    }
    setTestRunTarget({ id, values: generateSamplePayload(attrs), payload: '' })
  }

  const removeWorkflow = (id: string) => {
    CompositionService.DeleteWorkflow(id).then(() => {
      void refreshWorkflows()
      refreshSeedLifecycle() // a deleted built-in becomes restorable
    }).catch(console.error)
  }

  // Reset-to-shipped-example (docs/goals/0037 item 4): non-destructive
  // for a workflow -- appends the golden's content as a new published
  // version, prior history untouched, reachable via the existing
  // Versions UI.
  const resetToSeed = (id: string) => {
    CompositionService.ResetWorkflowToSeed(id).then(() => {
      void refreshWorkflows()
      refreshSeedLifecycle()
    }).catch((err) => setPublishError(String(err)))
  }

  // Restore-deleted-example (docs/goals/0037 item 5).
  const restoreExample = (id: string) => {
    CompositionService.RestoreWorkflow(id).then(() => {
      void refreshWorkflows()
      refreshSeedLifecycle()
    }).catch((err) => setPublishError(String(err)))
  }

  // Downloads id's current definition as a portable .json file --
  // ExportWorkflow's own doc comment covers why the output is
  // deterministic. A Blob + synthetic anchor click is the standard
  // browser download mechanism, identical inside the Wails webview.
  const exportWorkflow = (id: string, label: string) => {
    CompositionService.ExportWorkflow(id)
      .then((json) => {
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${label.trim() || 'workflow'}.json`
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch((err) => setImportError(String(err)))
  }

  const openImportPicker = () => {
    setImportError(null)
    importFileInputRef.current?.click()
  }

  // ImportWorkflow always mints a new workflow (ADR-0013's Duplicate
  // precedent), so success is exactly "one more row," never a merge.
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file next time
    if (!file) return
    file.text()
      .then((text) => CompositionService.ImportWorkflow(text))
      .then(() => {
        setImportError(null)
        void refreshWorkflows()
      })
      .catch((err) => setImportError(String(err)))
  }

  const editDisabled = nodeTypes === null
  // mode (docs/goals/0022-workflow-view-mode.md): row click (InventoryList's
  // onOpen) opens VIEW -- read-only inspection, Run/Runs/Versions all work;
  // the row's own Edit action (its trailing menu here, the pencil in
  // WorkflowsTable's row) opens EDIT explicitly. Reusing an already-open
  // tab never downgrades edit->view (see store.ts's openWorkTab).
  const openEditor = (id: string, mode: 'view' | 'edit') => {
    if (editDisabled) return
    openWorkTab({ kind: 'workflow-edit', workflowId: id, mode })
  }

  // Last-updated-first, applied once here so every render of this data
  // (both the row view below and WorkflowsTable's own DataTable) shows
  // the same order (docs/SPEC.md §3.8's InventoryList entry).
  const sortedWorkflows = useMemo(() => sortByUpdatedDesc(workflows ?? [], (wf) => wf.UpdatedAt), [workflows])

  const workflowItems: InventoryItem[] = sortedWorkflows.map((wf) => {
    const isCallable = findRootNode(wf.Nodes, wf.Edges)?.NodeTypeID === 'trigger-callable'
    const runTitle = hasDraftDrift(wf)
      ? t('compositionView.runTitleDrifted')
      : t('compositionView.runTitle')
    const seedReset = describeSeedReset(wf.Seed, seedRevisions[wf.ID] ?? wf.Seed.SeedRevision)
    return {
      id: wf.ID,
      entity: 'workflow',
      icon: ENTITY_ICON.workflow,
      label: wf.Label,
      updatedLabel: formatUpdated(wf.UpdatedAt),
      labelBadges: (
        <Stack direction="horizontal" gap="condensed" align="center">
          {wf.BuiltIn && <Label variant="secondary" size="small">{t('compositionView.builtIn')}</Label>}
          {/* Lifecycle badges (docs/adr/0021): only the EXCEPTIONAL state
              gets colour -- "live/published" is the normal healthy default
              (true on nearly every row), so a loud green there is pure
              noise and makes the colour meaningless; it renders quiet
              (secondary). A never-published draft (attention) and a
              disabled workflow (severe) are the exceptions worth the eye.
              Owner: the badge scatter "looks like broken UI." */}
          {wf.PublishedVersion > 0
            ? <Label variant="secondary" size="small">{t('publishedVersionLive', { version: wf.PublishedVersion })}</Label>
            : <Label variant="attention" size="small">{t('compositionView.draft')}</Label>}
          {wf.Disabled && <Label variant="severe" size="small">{t('disabled')}</Label>}
        </Stack>
      ),
      description: wf.Description,
      meta: (
        <TriggerRowLabel
          workflow={wf}
          armed={armedWorkflows[wf.ID] === true}
          publishing={publishingId === wf.ID}
          onPublish={publishWorkflow}
          onHotkeyChanged={refreshArmed}
        />
      ),
      primaryAction: isCallable ? (
        <Button
          onClick={() => run(wf.ID)}
          disabled={runningId === wf.ID}
          size="small"
          variant="invisible"
          aria-label={t('compositionView.testAriaLabel', { label: wf.Label })}
          title={runTitle}
          data-testid="callable-test-run"
        >
          {runningId === wf.ID ? t('running') : t('compositionView.test')}
        </Button>
      ) : (
        <Button onClick={() => run(wf.ID)} disabled={runningId === wf.ID} size="small" aria-label={t('compositionView.runAriaLabel', { label: wf.Label })} title={runTitle}>
          {runningId === wf.ID ? t('running') : t('compositionView.run')}
        </Button>
      ),
      // Row click opens VIEW mode (docs/goals/0022) -- read-only
      // inspection, matching ADR-0014's inspect-first grammar already
      // used for Integrations (ConfigureRequests.tsx's onOpen ->
      // request-view). No !wf.BuiltIn guard -- every workflow, seeded or
      // user-composed, is ordinary and fully editable/deletable from the
      // moment it exists (docs/SPEC.md §2.2's Update note). BuiltIn only
      // drives the informational "built-in" badge above.
      onOpen: () => openEditor(wf.ID, 'view'),
      menuActions: [
        // Edit is the explicit gesture (docs/goals/0022) -- same
        // ConfigureRequests.tsx precedent, a plain menu item rather than
        // a dedicated pencil icon in the row-view (WorkflowsTable's own
        // table-view row already has a pencil for the same target).
        { label: t('compositionView.menu.edit'), onClick: () => openEditor(wf.ID, 'edit') },
        { label: t('compositionView.menu.export'), onClick: () => exportWorkflow(wf.ID, wf.Label) },
        // Reset-to-shipped-example (docs/goals/0037 item 4): on-demand
        // disclosure only, built-in-origin rows only. InventoryMenuAction
        // has no `disabled` concept, so an already-current seed's item is
        // HIDDEN rather than shown-disabled (the Primer disabled-
        // affordance rule's own "disabled OR hidden" allowance) -- only
        // a genuinely actionable reset ever appears in the menu.
        ...(wf.BuiltIn && !seedReset.disabled ? [{ label: seedReset.label, onClick: () => resetToSeed(wf.ID) }] : []),
        {
          label: t('compositionView.menu.delete'),
          onClick: () => removeWorkflow(wf.ID),
          danger: true,
          confirm: { title: t('compositionView.deleteConfirmTitle'), body: t('compositionView.deleteConfirmBody', { label: wf.Label }) },
        },
      ],
    }
  })

  return (
    <PageContainer data-testid="composition-view">
      <Heading as="h1">{t('compositionView.heading')}</Heading>
      <Text as="p" className={styles.subtitle}>
        {t('compositionView.subtitle')}
      </Text>

      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small" id="workflows-heading">{t('compositionView.savedWorkflowsHeading')}</Heading>
        <Stack direction="horizontal" gap="condensed">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <input
            ref={importFileInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-workflow-input"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <Button
            leadingVisual={UploadIcon}
            size="small"
            onClick={openImportPicker}
            data-testid="import-workflow"
          >
            {t('compositionView.import')}
          </Button>
          <RestoreExamplesButton items={restorable} onRestore={restoreExample} />
          <Button
            leadingVisual={PlusIcon}
            variant="primary"
            size="small"
            onClick={() => openWorkTab({ kind: 'workflow-new' })}
            disabled={nodeTypes === null}
            data-testid="new-workflow"
          >
            {t('compositionView.newWorkflow')}
          </Button>
        </Stack>
      </Stack>
      {importError && (
        <Text as="p" size="small" className={styles.error} data-testid="import-workflow-error">
          {importError}
        </Text>
      )}
      {publishError && (
        <Text as="p" size="small" className={styles.error} data-testid="publish-workflow-error">
          {publishError}
        </Text>
      )}
      {workflows === null && <Text as="p" className={styles.muted}>{t('loading')}</Text>}
      {workflows !== null && viewMode === 'table' && workflows.length > 0 && (
        <WorkflowsTable
          workflows={sortedWorkflows}
          runningId={runningId}
          editDisabled={editDisabled}
          armedWorkflows={armedWorkflows}
          publishingId={publishingId}
          onRun={run}
          onOpenView={(id) => openEditor(id, 'view')}
          onEdit={(id) => openEditor(id, 'edit')}
          onExport={exportWorkflow}
          onDelete={removeWorkflow}
          onPublish={publishWorkflow}
          onHotkeyChanged={refreshArmed}
        />
      )}
      {workflows !== null && viewMode === 'rows' && (
        <InventoryList
          items={workflowItems}
          searchPlaceholder={t('compositionView.searchPlaceholder')}
          emptyState={{
            icon: WorkflowIcon,
            heading: t('compositionView.emptyHeading'),
            description: t('compositionView.emptyDescription'),
            action: (
              <Button leadingVisual={PlusIcon} variant="primary" onClick={() => openWorkTab({ kind: 'workflow-new' })} disabled={nodeTypes === null}>
                {t('compositionView.newWorkflow')}
              </Button>
            ),
          }}
        />
      )}
      {workflows !== null && viewMode === 'rows' && (workflows ?? []).some((wf) => errors[wf.ID] || results[wf.ID] !== undefined) && (
        <Stack direction="vertical" gap="condensed" className={styles.sectionHeading}>
          {workflows.map((wf) => {
            if (!errors[wf.ID] && results[wf.ID] === undefined) return null
            return (
              <div key={wf.ID} data-testid="workflow-run-result" data-workflow-id={wf.ID}>
                <Text weight="semibold" size="small">{wf.Label}</Text>
                {errors[wf.ID] && <Text as="p" size="small" className={styles.error}>{errors[wf.ID]}</Text>}
                {results[wf.ID] !== undefined && !errors[wf.ID] && <pre className={styles.result}>{results[wf.ID]}</pre>}
              </div>
            )
          })}
        </Stack>
      )}

      {testRunTarget && (
        <TestRunDialog
          workflowLabel={workflows?.find((w) => w.ID === testRunTarget.id)?.Label ?? testRunTarget.id}
          attributes={workflows?.find((w) => w.ID === testRunTarget.id)?.Attributes ?? []}
          values={testRunTarget.values}
          onChange={(key, value) => setTestRunTarget((prev) => (prev ? { ...prev, values: { ...prev.values, [key]: value } } : prev))}
          payloadHint={workflowPayloadHint(workflows?.find((w) => w.ID === testRunTarget.id))}
          payload={testRunTarget.payload}
          onPayloadChange={(value) => setTestRunTarget((prev) => (prev ? { ...prev, payload: value } : prev))}
          onCancel={() => setTestRunTarget(null)}
          onRun={() => {
            runWithValues(testRunTarget.id, testRunTarget.values, testRunTarget.payload || undefined)
            setTestRunTarget(null)
          }}
        />
      )}
    </PageContainer>
  )
}

export default CompositionView
