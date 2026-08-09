import { useEffect, useRef, useState } from 'react'
import { Button, Heading, Stack, Text } from '@primer/react'
import { PlusIcon, UploadIcon } from '@primer/octicons-react'
import { CompositionService, ExecutionService } from '../../bindings/github.com/alicoding/mill'
import { RunKind } from '../../bindings/github.com/alicoding/mill/models'
import { generateSamplePayload } from '../shared/configSchema'
import { refreshNodeTypes, refreshWorkflows, useAppStore } from '../shared/store'
import TestRunDialog from './TestRunDialog'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { WorkflowsTable } from './WorkflowsTable'
import { WorkflowsCards } from './WorkflowsCards'

// The Workflows list page (SPEC.md §3 / ADR-0005). Editor tabs no
// longer live here: opening/editing a workflow goes through the store's
// app-wide work-tab strip (docs/SPEC.md §3.8, app/WorkTabShell.tsx), so
// an open canvas survives navigating to any other section. This page is
// purely the inventory -- list, Run (a test run of the draft,
// docs/adr/0008/0021), Import/Export, and open-in-tab actions.
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

  useEffect(() => {
    void refreshWorkflows()
    void refreshNodeTypes()
  }, [])

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
      {workflows === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {workflows !== null && viewMode === 'table' && workflows.length > 0 && (
        <WorkflowsTable
          workflows={workflows}
          runningId={runningId}
          editDisabled={nodeTypes === null}
          onRun={run}
          onEdit={(id) => openWorkTab({ kind: 'workflow-edit', workflowId: id })}
          onExport={exportWorkflow}
          onDelete={removeWorkflow}
        />
      )}
      {workflows !== null && viewMode === 'cards' && (
        <WorkflowsCards
          workflows={workflows}
          nodeTypes={nodeTypes}
          runningId={runningId}
          errors={errors}
          results={results}
          onRun={run}
          onEdit={(id) => openWorkTab({ kind: 'workflow-edit', workflowId: id })}
          onExport={exportWorkflow}
          onDelete={removeWorkflow}
        />
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
