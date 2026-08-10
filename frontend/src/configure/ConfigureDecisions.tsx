import { useEffect, useRef, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Label, Select, Stack, Text, TextInput } from '@primer/react'
import { DownloadIcon, PlusIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { Decision, OutputField } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import { Category } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import { EntityRefField } from './EntityRefField'
import { downloadJSON } from '../shared/downloadJSON'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

const CATEGORY_LABEL: Record<string, string> = {
  [Category.CategoryApprove]: 'Approve',
  [Category.CategoryDeny]: 'Deny',
  [Category.CategoryManualReview]: 'Manual review',
  [Category.CategoryActionNeeded]: 'Action needed',
  [Category.CategoryUncategorized]: 'Uncategorized',
}

const TYPE_OPTIONS = ['text', 'number', 'boolean', 'options']

function emptyOutput(): OutputField {
  return { Key: '', Label: '', Type: 'text', EnumValues: null }
}

// Configure's Decisions section (docs/adr/0027): CRUD over
// ConfigureService's Decisions -- a reusable (1:many), TERMINAL outcome
// a workflow's decision-outcome node references by ID. Category is
// immutable after creation (server-enforced, ConfigureService.
// UpdateDecision) -- the create form's Category Select is a normal
// live control; the edit form's is disabled with a caption naming the
// escape hatch (duplicate = start a fresh Create with these fields
// pre-filled, same client-side pattern RequestForm.tsx's own Duplicate
// uses -- no backend DuplicateDecision RPC, checked against that
// precedent directly).
//
// Rows are the DEFAULT view (docs/goals/0007): InventoryList's shared
// row replaces the old hand-rolled card branch. Row click edits (same
// as Lists/MCP Servers); Duplicate/Export/Delete move into the
// trailing ⋯ menu.
export function ConfigureDecisions() {
  const [decisions, setDecisions] = useState<Decision[] | null>(null)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState<Category>(Category.CategoryUncategorized)
  const [outputs, setOutputs] = useState<OutputField[]>([])
  const [webhookRequestID, setWebhookRequestID] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-decisions-view-mode')

  const refetch = () => {
    ConfigureService.Decisions().then((list) => setDecisions(list ?? [])).catch(console.error)
  }
  useEffect(refetch, [])

  const exportDecision = (id: string, decisionLabel: string) => {
    ConfigureService.ExportDecision(id)
      .then((json) => downloadJSON(`${decisionLabel.trim() || 'decision'}.json`, json))
      .catch((err) => setImportError(String(err)))
  }

  const importDecision = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text()
      .then((text) => ConfigureService.ImportDecision(text))
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }

  const startCreate = (prefill?: Decision) => {
    setEditingID(null)
    setLabel(prefill ? `${prefill.Label} (copy)` : '')
    setCategory(prefill?.Category ?? Category.CategoryUncategorized)
    setOutputs(prefill?.Outputs ?? [])
    setWebhookRequestID(prefill?.WebhookRequestID ?? '')
    setFormOpen(true)
    setError('')
  }

  const startEdit = (d: Decision) => {
    setEditingID(d.ID)
    setLabel(d.Label)
    setCategory(d.Category)
    setOutputs(d.Outputs ?? [])
    setWebhookRequestID(d.WebhookRequestID)
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      if (editingID) {
        await ConfigureService.UpdateDecision(editingID, label, category, outputs, webhookRequestID)
      } else {
        await ConfigureService.CreateDecision(label, category, outputs, webhookRequestID)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string) => {
    ConfigureService.DeleteDecision(id).then(refetch).catch(console.error)
  }

  const updateOutput = (i: number, field: keyof OutputField, value: string) => {
    setOutputs((prev) => prev.map((o, idx) => {
      if (idx !== i) return o
      if (field === 'EnumValues') {
        const values = value.split(',').map((v) => v.trim()).filter(Boolean)
        return { ...o, EnumValues: values.length > 0 ? values : null }
      }
      return { ...o, [field]: value }
    }))
  }

  const decisionItems: InventoryItem[] = (decisions ?? []).map((d) => ({
    id: d.ID,
    entity: 'decision',
    icon: ENTITY_ICON.decision,
    label: d.Label,
    labelBadges: <Label variant="secondary" size="small">{CATEGORY_LABEL[d.Category] ?? d.Category}</Label>,
    description: `Outputs: ${(d.Outputs ?? []).map((o) => o.Key).join(', ') || 'none'}`,
    onOpen: () => startEdit(d),
    menuActions: [
      { label: 'Duplicate', onClick: () => startCreate(d) },
      { label: 'Export', onClick: () => exportDecision(d.ID, d.Label) },
      { label: 'Delete', onClick: () => remove(d.ID), danger: true },
    ],
  }))

  return (
    <PageContainer data-testid="configure-decisions">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small" id="decisions-heading">Decisions</Heading>
        <Stack direction="horizontal" gap="condensed">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-decision-input"
            style={{ display: 'none' }}
            onChange={importDecision}
          />
          <Button
            leadingVisual={UploadIcon}
            size="small"
            onClick={() => importInputRef.current?.click()}
            data-testid="import-decision"
          >
            Import
          </Button>
          <Button leadingVisual={PlusIcon} size="small" onClick={() => startCreate()} data-testid="new-decision">
            New decision
          </Button>
        </Stack>
      </Stack>
      <Text as="p" size="small" className={styles.muted}>
        A Decision is a reusable, typed TERMINAL outcome -- a workflow&apos;s Decision node reaches one of these to
        end the run with a real category and typed result, instead of just running out of steps.
      </Text>
      {importError && (
        <Text as="p" size="small" className={styles.error} data-testid="import-decision-error">{importError}</Text>
      )}

      {formOpen && (
        <PageContainer variant="narrow">
          <div className={styles.card}>
            <Stack direction="vertical" gap="condensed">
              <FormControl>
                <FormControl.Label>Label</FormControl.Label>
                <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block />
              </FormControl>
              <FormControl disabled={!!editingID}>
                <FormControl.Label>Category</FormControl.Label>
                <FormControl.Caption>
                  {editingID
                    ? 'Cannot be changed after creation -- duplicate this Decision to create one with a different category.'
                    : 'Cannot be changed after creation -- duplicate this Decision later to create one with a different category.'}
                </FormControl.Caption>
                <Select
                  value={category}
                  disabled={!!editingID}
                  data-testid="decision-category"
                  onChange={(e) => setCategory(e.target.value as Category)}
                >
                  {Object.values(Category).filter((c) => c !== Category.$zero).map((c) => (
                    <Select.Option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</Select.Option>
                  ))}
                </Select>
              </FormControl>

              <Text size="small" weight="semibold">Outputs</Text>
              <Text as="p" size="small" className={styles.muted}>
                This Decision&apos;s typed result fields -- what a workflow&apos;s decision-outcome node binds
                values into when it reaches this outcome.
              </Text>
              {outputs.map((o, i) => (
                <Stack key={i} direction="horizontal" gap="condensed" align="center">
                  <TextInput placeholder="key" value={o.Key} onChange={(e) => updateOutput(i, 'Key', e.target.value)} />
                  <TextInput placeholder="label" value={o.Label} onChange={(e) => updateOutput(i, 'Label', e.target.value)} />
                  <Select value={o.Type} onChange={(e) => updateOutput(i, 'Type', e.target.value)}>
                    {TYPE_OPTIONS.map((t) => (
                      <Select.Option key={t} value={t}>{t}</Select.Option>
                    ))}
                  </Select>
                  <TextInput
                    placeholder="enum values, comma separated"
                    value={(o.EnumValues ?? []).join(', ')}
                    onChange={(e) => updateOutput(i, 'EnumValues', e.target.value)}
                  />
                  <IconButton
                    icon={TrashIcon}
                    aria-label="Remove output"
                    size="small"
                    variant="invisible"
                    onClick={() => setOutputs((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                </Stack>
              ))}
              <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => setOutputs((prev) => [...prev, emptyOutput()])}>
                Add output
              </Button>

              <Text size="small" weight="semibold">Webhook (optional)</Text>
              <Text as="p" size="small" className={styles.muted}>
                Fires this HTTPRequest with the outcome&apos;s outputs as its body when this Decision is reached.
                External calls ask for approval by default, same as an Integration step.
              </Text>
              <EntityRefField refKind="request" value={webhookRequestID} onChange={setWebhookRequestID} />

              {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
              <Stack direction="horizontal" gap="condensed">
                <Button variant="primary" size="small" onClick={save} data-testid="save-decision">Save decision</Button>
                <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>Cancel</Button>
              </Stack>
            </Stack>
          </div>
        </PageContainer>
      )}

      {decisions === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {decisions !== null && viewMode === 'table' && decisions.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-decisions">
          <DataTable
            aria-labelledby="decisions-heading"
            data={decisions.map((d) => ({ ...d, id: d.ID }))}
            columns={[
              { header: 'Label', field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: 'Category', id: 'category', renderCell: (d) => <Label variant="secondary">{CATEGORY_LABEL[d.Category] ?? d.Category}</Label> },
              { header: 'Outputs', id: 'outputs', width: 'growCollapse', minWidth: '160px', renderCell: (d) => <TruncatedCell text={(d.Outputs ?? []).map((o) => o.Key).join(', ')} /> },
              { header: 'ID', field: 'ID' },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (d) => (
                  <Stack direction="horizontal" gap="condensed">
                    <Button size="small" variant="invisible" onClick={() => startEdit(d)}>Edit</Button>
                    <Button size="small" variant="invisible" onClick={() => startCreate(d)}>Duplicate</Button>
                    <IconButton icon={DownloadIcon} aria-label={`Export ${d.Label}`} size="small" variant="invisible" onClick={() => exportDecision(d.ID, d.Label)} />
                    <IconButton icon={TrashIcon} aria-label={`Delete ${d.Label}`} size="small" variant="invisible" onClick={() => remove(d.ID)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      {decisions !== null && viewMode === 'rows' && !(formOpen && decisions.length === 0) && (
        <InventoryList
          items={decisionItems}
          searchPlaceholder="Search decisions…"
          emptyState={{
            icon: ENTITY_ICON.decision.Icon,
            heading: 'No decisions yet',
            description: "A reusable, typed TERMINAL outcome a workflow's Decision node reaches to end the run.",
            action: <Button leadingVisual={PlusIcon} onClick={() => startCreate()}>New decision</Button>,
          }}
        />
      )}
    </PageContainer>
  )
}
