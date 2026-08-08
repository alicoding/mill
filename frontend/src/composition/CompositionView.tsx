import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Dialog, FormControl, Heading, IconButton, Label, Stack, Text, TextInput, Token } from '@primer/react'
import { Tabs } from '@primer/react/experimental'
import { PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { CompositionService, ExecutionService } from '../../bindings/github.com/alicoding/mill'
import { RunKind } from '../../bindings/github.com/alicoding/mill/models'
import { ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { AttributeDef, Edge, Node, NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { generateSamplePayload } from '../shared/configSchema'
import { useAppStore } from '../shared/store'
import { loadPersistedTabs, savePersistedTabs } from '../shared/persistedTabs'
import CompositionCanvas from './CompositionCanvas'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import styles from '../shared/ListCard.module.css'
import editorStyles from './CompositionView.module.css'

// A workflow's Nodes/Edges are an unordered graph on the wire -- this
// walks them into the single execution-order chain composition.go's own
// linearOrder (Go) guarantees every saved workflow already forms, purely
// for display (the chip chain below). Not a general graph-execution
// engine, same scope as the backend: a saved workflow that isn't a valid
// chain can't exist (CreateWorkflow/UpdateWorkflow validate it via zod
// before Save, ExecuteWorkflow validates it again before Run), so this
// trusts that invariant rather than re-deriving it defensively.
function orderNodes(nodes: Node[] | null, edges: Edge[] | null): Node[] {
  const nodeList = nodes ?? []
  const edgeList = edges ?? []
  if (nodeList.length === 0) return []
  const byId = new Map(nodeList.map((n) => [n.ID, n]))
  const outgoing = new Map(edgeList.map((e) => [e.Source, e.Target]))
  const hasIncoming = new Set(edgeList.map((e) => e.Target))
  const root = nodeList.find((n) => !hasIncoming.has(n.ID))
  if (!root) return nodeList
  const order: Node[] = []
  let current: string | undefined = root.ID
  const visited = new Set<string>()
  while (current && !visited.has(current)) {
    visited.add(current)
    const node = byId.get(current)
    if (!node) break
    order.push(node)
    current = outgoing.get(current)
  }
  return order
}

// One open editor tab per workflow being composed/edited at once --
// workflowId null means composing a new workflow.
interface EditorTab {
  key: string
  workflowId: string | null
}

const WORKFLOWS_TAB = 'workflows'
const TABS_STORAGE_KEY = 'mill-composition-tabs'

// A prototype for SPEC.md §3 / ADR-0005 (A2: MCP-tool + control-flow
// nodes; B2's canvas deferral overridden by explicit decision -- see
// docs/adr/0005-capability-composition-node-schema.md's Update section).
// The Workflows list is the default, pinned tab; "New workflow" or
// editing an existing one opens its own tab, matching the reference
// no-code platform's own tabbed Workflows-list/canvas-editor split
// (SPEC.md §3.2/its Update note) rather than a single view that swaps
// wholesale. Each open tab's CompositionCanvas keeps its own
// nodes/edges/undo history (canvasStore.ts's createCanvasStore factory,
// one instance per mounted canvas) -- Primer's Tabs/TabPanel keep every
// open panel mounted (toggling a `hidden` attribute, not unmounting),
// so switching tabs preserves in-progress edits in the others. This is
// now the successor to the retired Runbook page (docs/SPEC.md §2.2's
// Update note) -- its two actions live on as ordinary, fully-editable
// seeded workflows (composition.go's BuiltInWorkflows), not a separate
// page.
function CompositionView() {
  const pushActivity = useAppStore((s) => s.pushActivity)
  const [nodeTypes, setNodeTypes] = useState<NodeType[] | null>(null)
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Test-input form (docs/adr/0008, SPEC.md §3.2's "per-record test
  // harness"): set only while the dialog for a workflow with declared
  // Attributes is open -- a workflow with none never touches this,
  // matching the rest of this codebase's "no UI for a decision that
  // doesn't exist yet" discipline (§3.5's Configure recheck).
  const [testRunTarget, setTestRunTarget] = useState<{ id: string; values: Record<string, string> } | null>(null)
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTab, setActiveTab] = useState(WORKFLOWS_TAB)
  // Guards the one-shot restore effect below from re-firing on every
  // later refetch (e.g. after Save) -- it must only apply the persisted
  // tab set once, the first time `workflows` becomes available, never
  // clobber tabs the user has since opened or closed.
  const restoredTabs = useRef(false)

  const refetchWorkflows = () => {
    CompositionService.Workflows().then((list) => setWorkflows(list ?? [])).catch(console.error)
  }

  useEffect(() => {
    CompositionService.NodeTypes().then((list) => setNodeTypes(list ?? [])).catch(console.error)
    refetchWorkflows()
  }, [])

  // Restores which workflow tabs were open (docs/SPEC.md §3.7's
  // Update) once the real workflow list is in, filtering out any
  // persisted ID for a workflow deleted since last session -- a
  // persisted tab pointing at nothing would be worse than not
  // restoring it.
  useEffect(() => {
    if (workflows === null || restoredTabs.current) return
    restoredTabs.current = true
    const persisted = loadPersistedTabs(TABS_STORAGE_KEY)
    const validIds = persisted.ids.filter((id) => workflows.some((w) => w.ID === id))
    if (validIds.length === 0) return
    const restored = validIds.map((workflowId) => ({ key: crypto.randomUUID(), workflowId }))
    setTabs(restored)
    // activeTab must match a real tab's freshly-generated `key`, not
    // the stale persisted workflowId itself.
    const active = restored.find((t) => t.workflowId === persisted.activeId)
    setActiveTab(active ? active.key : WORKFLOWS_TAB)
  }, [workflows])

  // Persists the open, saved-workflow tab set (never a "new workflow"
  // draft, workflowId === null) on every change. Gated on
  // restoredTabs.current: this effect also fires on the very first
  // mount (React runs every effect at least once regardless of its
  // dependency array), before the restore effect above has had a
  // chance to run (it's waiting on the async Workflows() fetch) -- an
  // unguarded write here would overwrite the previous session's
  // persisted tabs with the empty initial state, destroying the exact
  // data the restore effect is about to read. A real bug caught via a
  // real reload-and-check e2e test, not assumed away
  // (.claude/rules/testing.md).
  useEffect(() => {
    if (!restoredTabs.current) return
    const savedTabs = tabs.filter((t): t is EditorTab & { workflowId: string } => t.workflowId !== null)
    const activeSaved = savedTabs.find((t) => t.key === activeTab)
    savePersistedTabs(TABS_STORAGE_KEY, {
      ids: savedTabs.map((t) => t.workflowId),
      activeId: activeSaved ? activeSaved.workflowId : null,
    })
  }, [tabs, activeTab])

  // Runs through ExecutionService.RunWorkflow, tagged RunKindTest --
  // docs/adr/0008's single execution path: a canvas click is a manual
  // test run (Oscilar's own "test run" naming, SPEC.md §3.2), not a real
  // triggered event, but it's still a full durable/checkpointed run --
  // it shows up on the Runs page the same as any other, unlike the old
  // plain in-memory CompositionService.RunWorkflow this replaces.
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

  // A workflow with no declared Attributes runs immediately, exactly as
  // before this existed -- the test-input dialog only appears when
  // there's actually something to fill in, same "no UI for a decision
  // that doesn't exist yet" discipline as §3.5's Configure recheck.
  // Values are auto-generated (zod-schema-faker, same mechanism already
  // adopted for a NodeType's "Generate test payload" button, §3.4) so
  // the common case is still a one-click Run, not a form to fill out
  // every time.
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
    CompositionService.DeleteWorkflow(id).then(refetchWorkflows).catch(console.error)
  }

  // Every click makes its own new tab (matching the reference's own
  // "Create workflow" behavior) -- composing two brand-new workflows
  // side by side is a real, intentional use of tabs, not a bug.
  const openNewWorkflowTab = () => {
    const key = crypto.randomUUID()
    setTabs((prev) => [...prev, { key, workflowId: null }])
    setActiveTab(key)
  }

  // Editing the same workflow twice reuses its existing tab instead of
  // opening a duplicate editor over the same data.
  const openEditTab = (workflowId: string) => {
    const existing = tabs.find((t) => t.workflowId === workflowId)
    if (existing) {
      setActiveTab(existing.key)
      return
    }
    const key = crypto.randomUUID()
    setTabs((prev) => [...prev, { key, workflowId }])
    setActiveTab(key)
  }

  const closeTab = (key: string) => {
    setTabs((prev) => prev.filter((t) => t.key !== key))
    setActiveTab((current) => (current === key ? WORKFLOWS_TAB : current))
  }

  return (
    <Tabs value={activeTab} onValueChange={({ value }) => setActiveTab(value)}>
      <TabList aria-label="Composition">
        <TabItem value={WORKFLOWS_TAB}>Workflows</TabItem>
        {tabs.map((t) => (
          <TabItem key={t.key} value={t.key} onClose={() => closeTab(t.key)}>
            {t.workflowId ? (workflows?.find((w) => w.ID === t.workflowId)?.Label ?? 'Workflow') : 'New workflow'}
          </TabItem>
        ))}
      </TabList>

      <TabPanel value={WORKFLOWS_TAB}>
        <div className={styles.page} data-testid="composition-view">
          <Heading as="h1">Capability composition</Heading>
          <Text as="p" className={styles.subtitle}>
            Prototype for docs/SPEC.md §3 (ADR-0005): compose a workflow on a real
            canvas from reusable node primitives, configuring each node as you add
            it — composing without configuring isn&apos;t a real workflow. Built
            ahead of ADR-0005 B2&apos;s original canvas-deferral trigger, by
            explicit decision. Workflows persist across restarts, and every
            one -- seeded example or user-composed -- is fully editable and
            deletable from the moment it exists.
          </Text>

          <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
            <Heading as="h2" variant="small">Workflows</Heading>
            <Button
              leadingVisual={PlusIcon}
              size="small"
              onClick={openNewWorkflowTab}
              disabled={nodeTypes === null}
              data-testid="new-workflow"
            >
              New workflow
            </Button>
          </Stack>
          {workflows === null && <Text as="p" className={styles.muted}>Loading…</Text>}
          {workflows !== null && (
            <Stack direction="vertical" gap="condensed">
              {workflows.map((wf) => (
                <div key={wf.ID} className={styles.card} data-testid="workflow-row">
                  <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                    <div>
                      <Stack direction="horizontal" gap="condensed" align="center">
                        <Text weight="semibold">{wf.Label}</Text>
                        {wf.BuiltIn && <Label variant="secondary" size="small">built-in</Label>}
                      </Stack>
                      <Text as="p" size="small" className={styles.muted}>{wf.Description}</Text>
                    </div>
                    <Stack direction="horizontal" gap="condensed">
                      <Button
                        onClick={() => run(wf.ID)}
                        disabled={runningId === wf.ID}
                        size="small"
                        aria-label={`Run ${wf.Label}`}
                      >
                        {runningId === wf.ID ? 'Running…' : 'Run'}
                      </Button>
                      {/* No !wf.BuiltIn guard -- every workflow, seeded or
                          user-composed, is ordinary and fully editable/
                          deletable from the moment it exists (docs/SPEC.md
                          §2.2's Update note: this is the same pattern
                          Zapier/n8n use for their own seeded/template
                          workflows, confirmed via research, not Mill's own
                          invention). BuiltIn only drives the informational
                          "built-in" badge above now. */}
                      <IconButton
                        icon={PencilIcon}
                        aria-label={`Edit ${wf.Label}`}
                        size="small"
                        variant="invisible"
                        disabled={nodeTypes === null}
                        onClick={() => openEditTab(wf.ID)}
                      />
                      <IconButton icon={TrashIcon} aria-label={`Delete ${wf.Label}`} size="small" variant="invisible" onClick={() => removeWorkflow(wf.ID)} />
                    </Stack>
                  </Stack>

                  <Stack direction="vertical" gap="condensed" className={styles.stepChain}>
                    {orderNodes(wf.Nodes, wf.Edges).map((node, i) => {
                      const nt = nodeTypes?.find((n) => n.ID === node.NodeTypeID)
                      const configEntries = Object.entries(node.Config ?? {})
                      return (
                        <Stack key={node.ID} direction="horizontal" align="start" gap="condensed">
                          {i > 0 && <Text className={styles.muted}>→</Text>}
                          <Token text={nt?.Label ?? node.NodeTypeID} size="large" />
                          {configEntries.length > 0 && (
                            <Text size="small" className={styles.muted}>
                              {configEntries.map(([k, v]) => `${k}: ${(v ?? '').slice(0, 40)}${(v ?? '').length > 40 ? '…' : ''}`).join(', ')}
                            </Text>
                          )}
                        </Stack>
                      )
                    })}
                  </Stack>

                  {errors[wf.ID] && (
                    <Text as="p" size="small" className={styles.error}>{errors[wf.ID]}</Text>
                  )}
                  {results[wf.ID] !== undefined && !errors[wf.ID] && (
                    <pre className={styles.result}>{results[wf.ID]}</pre>
                  )}
                </div>
              ))}
            </Stack>
          )}
        </div>
      </TabPanel>

      {nodeTypes !== null && tabs.map((t) => {
        const editingWorkflow = t.workflowId ? (workflows?.find((w) => w.ID === t.workflowId) ?? null) : null
        return (
          <TabPanel key={t.key} value={t.key} className={editorStyles.editorPanel}>
            <CompositionCanvas
              nodeTypes={nodeTypes}
              workflow={editingWorkflow}
              onBack={() => closeTab(t.key)}
              onSaved={() => { refetchWorkflows(); closeTab(t.key) }}
            />
          </TabPanel>
        )
      })}

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
    </Tabs>
  )
}

// The test-input form itself (docs/adr/0008, SPEC.md §3.2's per-record
// test harness): one field per declared Attribute, pre-filled via
// generateSamplePayload (run() above), each still a normal editable
// input -- submit as-is for the common case, or override a specific
// value first. AttributeDef never declares FieldOptions (§3.3's
// rule-builder Update note: "AttributeDef carries no Options list"), so
// unlike NodeInspector's ConfigField switch, there's no Select branch
// here -- every non-boolean/non-number field is plain text.
function TestRunDialog({
  workflowLabel, attributes, values, onChange, onCancel, onRun,
}: {
  workflowLabel: string
  attributes: AttributeDef[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  onCancel: () => void
  onRun: () => void
}) {
  return (
    <Dialog title={`Test run — ${workflowLabel}`} onClose={onCancel} footerButtons={[
      { content: 'Cancel', onClick: onCancel },
      { content: 'Run', buttonType: 'primary', onClick: onRun },
    ]}>
      <Stack direction="vertical" gap="normal">
        {attributes.map((attr) => (
          <FormControl key={attr.Key}>
            <FormControl.Label>{attr.Label}</FormControl.Label>
            {attr.Type === ConfigFieldType.FieldBoolean ? (
              <Checkbox
                checked={values[attr.Key] === 'true'}
                data-testid="test-run-field"
                onChange={(e) => onChange(attr.Key, String(e.target.checked))}
              />
            ) : attr.Type === ConfigFieldType.FieldNumber ? (
              <TextInput
                type="number"
                value={values[attr.Key] ?? ''}
                block
                data-testid="test-run-field"
                onChange={(e) => onChange(attr.Key, e.target.value)}
              />
            ) : (
              <TextInput
                value={values[attr.Key] ?? ''}
                block
                data-testid="test-run-field"
                onChange={(e) => onChange(attr.Key, e.target.value)}
              />
            )}
          </FormControl>
        ))}
      </Stack>
    </Dialog>
  )
}

export default CompositionView
