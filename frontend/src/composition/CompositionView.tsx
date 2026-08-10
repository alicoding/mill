import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Heading, Label, Stack, Text } from '@primer/react'
import { PlusIcon, UploadIcon, WorkflowIcon } from '@primer/octicons-react'
import { CompositionService, ExecutionService, TriggerService } from '../shared/bindings'
import { RunKind } from '../shared/bindings'
import { generateSamplePayload } from '../shared/configSchema'
import { refreshNodeTypes, refreshWorkflows, useAppStore } from '../shared/store'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import TestRunDialog from './TestRunDialog'
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
  const [testRunTarget, setTestRunTarget] = useState<{ id: string; values: Record<string, string> } | null>(null)
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

  const refreshArmed = useCallback(() => {
    TriggerService.ArmedWorkflows()
      .then((m) => setArmedWorkflows(m ?? {}))
      .catch(console.error)
  }, [])

  useEffect(() => {
    void refreshWorkflows()
    void refreshNodeTypes()
    refreshArmed()
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
  const runWithValues = (id: string, values: Record<string, string> | null) => {
    const label = workflows?.find((w) => w.ID === id)?.Label ?? id
    setRunningId(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    ExecutionService.RunWorkflow(id, RunKind.RunKindTest, values)
      .then((summary) => {
        if (summary.error) {
          setErrors((prev) => ({ ...prev, [id]: summary.error }))
          pushActivity({
            id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
            source: 'composition', workflowID: id, label,
            success: false, detail: summary.error, result: '',
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
          success: false, detail: String(err), result: '',
        })
      })
      .finally(() => setRunningId(null))
  }

  // A workflow with no declared Attributes runs immediately; the
  // test-input dialog only appears when there's something to fill in.
  const run = (id: string) => {
    const wf = workflows?.find((w) => w.ID === id)
    const attrs = wf?.Attributes ?? []
    if (attrs.length === 0) {
      runWithValues(id, null)
      return
    }
    setTestRunTarget({ id, values: generateSamplePayload(attrs) })
  }

  const removeWorkflow = (id: string) => {
    CompositionService.DeleteWorkflow(id).then(() => refreshWorkflows()).catch(console.error)
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
  const openEditor = (id: string) => {
    if (editDisabled) return
    openWorkTab({ kind: 'workflow-edit', workflowId: id })
  }

  const workflowItems: InventoryItem[] = (workflows ?? []).map((wf) => {
    const isCallable = findRootNode(wf.Nodes, wf.Edges)?.NodeTypeID === 'trigger-callable'
    const runTitle = hasDraftDrift(wf)
      ? 'Test run of the draft — differs from the published version.'
      : 'Test run of the draft.'
    return {
      id: wf.ID,
      entity: 'workflow',
      icon: ENTITY_ICON.workflow,
      label: wf.Label,
      labelBadges: (
        <Stack direction="horizontal" gap="condensed" align="center">
          {wf.BuiltIn && <Label variant="secondary" size="small">built-in</Label>}
          {/* Lifecycle badges (docs/adr/0021): live version, or a never-
              published draft; disabled pauses triggers. */}
          {wf.PublishedVersion > 0
            ? <Label variant="success" size="small">v{wf.PublishedVersion} live</Label>
            : <Label variant="attention" size="small">draft</Label>}
          {wf.Disabled && <Label variant="severe" size="small">disabled</Label>}
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
          aria-label={`Test ${wf.Label}`}
          title={runTitle}
          data-testid="callable-test-run"
        >
          {runningId === wf.ID ? 'Running…' : 'Test'}
        </Button>
      ) : (
        <Button onClick={() => run(wf.ID)} disabled={runningId === wf.ID} size="small" aria-label={`Run ${wf.Label}`} title={runTitle}>
          {runningId === wf.ID ? 'Running…' : 'Run'}
        </Button>
      ),
      // No !wf.BuiltIn guard -- every workflow, seeded or user-composed,
      // is ordinary and fully editable/deletable from the moment it
      // exists (docs/SPEC.md §2.2's Update note). BuiltIn only drives
      // the informational "built-in" badge above.
      onOpen: () => openEditor(wf.ID),
      menuActions: [
        { label: 'Export', onClick: () => exportWorkflow(wf.ID, wf.Label) },
        { label: 'Delete', onClick: () => removeWorkflow(wf.ID), danger: true },
      ],
    }
  })

  return (
    <PageContainer data-testid="composition-view">
      <Heading as="h1">Workflows</Heading>
      <Text as="p" className={styles.subtitle}>
        Compose a workflow by connecting trigger, capture, process, and
        apply steps on a canvas — configuring each step happens as you
        add it, right there on the canvas. Every workflow, including the
        seeded examples below, is fully editable and deletable from the
        moment it exists.
      </Text>

      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small" id="workflows-heading">Saved workflows</Heading>
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
            Import
          </Button>
          <Button
            leadingVisual={PlusIcon}
            size="small"
            onClick={() => openWorkTab({ kind: 'workflow-new' })}
            disabled={nodeTypes === null}
            data-testid="new-workflow"
          >
            New workflow
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
      {workflows === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {workflows !== null && viewMode === 'table' && workflows.length > 0 && (
        <WorkflowsTable
          workflows={workflows}
          runningId={runningId}
          editDisabled={editDisabled}
          armedWorkflows={armedWorkflows}
          publishingId={publishingId}
          onRun={run}
          onEdit={openEditor}
          onExport={exportWorkflow}
          onDelete={removeWorkflow}
          onPublish={publishWorkflow}
          onHotkeyChanged={refreshArmed}
        />
      )}
      {workflows !== null && viewMode === 'rows' && (
        <InventoryList
          items={workflowItems}
          searchPlaceholder="Search workflows…"
          emptyState={{
            icon: WorkflowIcon,
            heading: 'No workflows yet',
            description: 'Compose a workflow from trigger, capture, process, and apply steps on the canvas.',
            action: (
              <Button leadingVisual={PlusIcon} onClick={() => openWorkTab({ kind: 'workflow-new' })} disabled={nodeTypes === null}>
                New workflow
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
          onCancel={() => setTestRunTarget(null)}
          onRun={() => {
            runWithValues(testRunTarget.id, testRunTarget.values)
            setTestRunTarget(null)
          }}
        />
      )}
    </PageContainer>
  )
}

export default CompositionView
