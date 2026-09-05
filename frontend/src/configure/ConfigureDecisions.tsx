import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormControl, Heading, IconButton, Label, Select, Stack, Text, TextInput, VisuallyHidden } from '@primer/react'
import { CopyIcon, DownloadIcon, PencilIcon, PlusIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { Decision, OutputField } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import { Category } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { FieldTombstone } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { EntityRefField, decisionCategoryLabelFor } from './EntityRefField'
import { DecisionVersionsSection } from './DecisionVersionsSection'
import { refreshDecisions, useConfigureEntityStore } from '../shared/configureEntityStore'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { entityRowContext } from '../shared/entityRowCommands'
import { useEntityActionError } from '../shared/entityActionErrorStore'
import { runCommand } from '../shared/commands'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useImportConfirm } from '../shared/useImportConfirm'
import { describeSeedReset } from '../shared/seedLifecycle'
import { useSeedLifecycle } from './useSeedLifecycle'
import { RestoreExamplesButton } from '../shared/RestoreExamplesButton'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useUISignalStore } from '../shared/uiSignalStore'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

const TYPE_OPTIONS = ['text', 'number', 'boolean', 'options']

function emptyOutput(): OutputField {
  return {
    Key: '', Label: '', Type: ConfigFieldType.TypeText,
    Required: false, Default: '', Description: '',
    Options: null, Suggestions: null,
    Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
  }
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
  const { t } = useTranslation('configure')
  // A row action's refusal, recorded by the command that met it
  // (shared/entityActionErrorStore.ts, goal 0346).
  const rowActionError = useEntityActionError('decision')
  const CATEGORY_LABEL = decisionCategoryLabelFor(t)
  // Store-shared (refreshDecisions, shared/configureEntityStore.ts) --
  // see ConfigureLists.tsx's identical comment (goal 0017 P1-1).
  const decisions = useConfigureEntityStore((s) => s.decisions)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState<Category>(Category.CategoryUncategorized)
  const [outputs, setOutputs] = useState<OutputField[]>([])
  // fieldTombstones/originalOutputKeys back docs/adr/0040 decision 3's
  // field-delete: removing an already-saved output tombstones its
  // Key+Type (confirmed first, see requestRemoveOutput below) rather
  // than just vanishing from the array; a never-saved draft row (not
  // in originalOutputKeys) still removes silently.
  const [fieldTombstones, setFieldTombstones] = useState<FieldTombstone[]>([])
  const [originalOutputKeys, setOriginalOutputKeys] = useState<Set<string>>(new Set())
  const [pendingDeleteOutputIndex, setPendingDeleteOutputIndex] = useState<number | null>(null)
  const [webhookRequestID, setWebhookRequestID] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-decisions-view-mode')
  // Seed lifecycle (docs/goals/0037): the shipped-revision map is
  // app-wide (shared/seedRevisionStore.ts) so the reset command can
  // answer its own enablement; only this family's restorable list is
  // local.
  const seedLifecycle = useSeedLifecycle<Decision>(() => ConfigureService.RestorableDecisions(), decisions)
  const seedRevisions = seedLifecycle.seedRevisions
  const restorable = seedLifecycle.restorable
  const refreshSeedLifecycle = seedLifecycle.refresh

  const refetch = () => {
    void refreshDecisions()
  }
  useEffect(() => {
    refetch()
    refreshSeedLifecycle()
  }, [])

  // A payload whose id matches a decision already here updates it in
  // place instead of creating a new one -- confirmed first via
  // importConfirm below, naming the decision it will replace.
  const runImport = (text: string) => {
    ConfigureService.ImportDecision(text)
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }
  const importConfirm = useImportConfirm({ existing: decisions ?? [], onImport: runImport })
  const importDecision = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(importConfirm.requestImport).catch((err) => setImportError(String(err)))
  }

  const startCreate = (prefill?: Decision) => {
    setEditingID(null)
    setLabel(prefill ? `${prefill.Label} (copy)` : '')
    setCategory(prefill?.Category ?? Category.CategoryUncategorized)
    setOutputs(prefill?.Outputs ?? [])
    // A duplicate starts as an unsaved draft -- its fields aren't
    // "already saved" from this form's own perspective even though the
    // source Decision has them, so removing one here needs no confirm.
    setFieldTombstones([])
    setOriginalOutputKeys(new Set())
    setWebhookRequestID(prefill?.WebhookRequestID ?? '')
    setFormOpen(true)
    setError('')
  }

  // configure.new.decisions (shared/configureCreateCommands.ts, goal
  // 0071 G6) -- same signal-consumption shape as ConfigureLists.tsx's
  // own configureCreateRequest effect. Always the bare create form
  // (startCreate()'s optional `prefill` is only ever passed by the
  // row-level Duplicate action, not this signal).
  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'decisions') return
    startCreate()
    consumeConfigureCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate/consumeConfigureCreate deliberately excluded, same reasoning useCanvasCommandDispatch.ts's own identical effect documents
  }, [configureCreateRequest])

  // configure.decision.duplicate (goal 0346): the row's Duplicate is a
  // registry command, which cannot reach this form -- it names the row
  // through the same set-then-consume signal the create/edit jumps use.
  const configureDuplicateRequest = useUISignalStore((s) => s.configureDuplicateRequest)
  const consumeConfigureDuplicate = useUISignalStore((s) => s.consumeConfigureDuplicate)
  useEffect(() => {
    if (configureDuplicateRequest?.tab !== 'decisions' || decisions === null) return
    const target = decisions.find((x) => x.ID === configureDuplicateRequest.id)
    consumeConfigureDuplicate()
    if (target) startCreate(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate/consumeConfigureDuplicate deliberately excluded, same reasoning as the create effect above
  }, [configureDuplicateRequest, decisions])

  const startEdit = (d: Decision) => {
    setEditingID(d.ID)
    setLabel(d.Label)
    setCategory(d.Category)
    setOutputs(d.Outputs ?? [])
    setFieldTombstones(d.FieldTombstones ?? [])
    setOriginalOutputKeys(new Set((d.Outputs ?? []).map((o) => o.Key)))
    setWebhookRequestID(d.WebhookRequestID)
    setFormOpen(true)
    setError('')
  }
  // goal 0312: a reference field's Open in Configure lands on THIS
  // entity's editor, once its list has loaded.
  const configureEditRequest = useUISignalStore((s) => s.configureEditRequest)
  const consumeConfigureEdit = useUISignalStore((s) => s.consumeConfigureEdit)
  useEffect(() => {
    if (configureEditRequest?.tab !== 'decisions' || decisions === null) return
    const target = decisions.find((x) => x.ID === configureEditRequest.id)
    consumeConfigureEdit()
    if (target) startEdit(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit/consumeConfigureEdit deliberately excluded, same reasoning as the create effect above
  }, [configureEditRequest, decisions])

  const save = async () => {
    setError('')
    try {
      if (editingID) {
        await ConfigureService.UpdateDecision(editingID, label, category, outputs, fieldTombstones, webhookRequestID)
      } else {
        await ConfigureService.CreateDecision(label, category, outputs, webhookRequestID)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  // Restore-deleted-example (docs/goals/0037 item 5) -- a header
  // action over the tombstoned set, not a row action.
  const restoreExample = (id: string) => {
    ConfigureService.RestoreDecision(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }

  // Table-view direct-wiring half of the Button-semantics convention
  // (.claude/rules/frontend.md) -- see ConfigureRequests.tsx's
  // identical comment.
  const updateOutput = (i: number, field: keyof OutputField, value: string) => {
    setOutputs((prev) => prev.map((o, idx) => {
      if (idx !== i) return o
      if (field === 'Options') {
        const values = value.split(',').map((v) => v.trim()).filter(Boolean)
        return { ...o, Options: values.length > 0 ? values : null }
      }
      return { ...o, [field]: value }
    }))
  }

  const toggleOutputDeprecated = (i: number, deprecated: boolean) => {
    setOutputs((prev) => prev.map((o, idx) => (idx === i ? { ...o, deprecated } : o)))
  }

  // requestRemoveOutput is the field editor's remove action (docs/adr/
  // 0040 decision 3): a never-saved draft row (added to this form but
  // never yet reaching a real Save) just disappears; an already-saved
  // output asks for confirmation first, since removing it tombstones
  // the Key -- stored data and any workflow already bound to it keep
  // working, but the Key can never come back under a different type.
  const requestRemoveOutput = (i: number) => {
    if (!originalOutputKeys.has(outputs[i].Key)) {
      setOutputs((prev) => prev.filter((_, idx) => idx !== i))
      return
    }
    setPendingDeleteOutputIndex(i)
  }
  const confirmRemoveOutput = () => {
    if (pendingDeleteOutputIndex === null) return
    const removed = outputs[pendingDeleteOutputIndex]
    setFieldTombstones((prev) => [...prev, { Key: removed.Key, Type: removed.Type }])
    setOutputs((prev) => prev.filter((_, idx) => idx !== pendingDeleteOutputIndex))
    setPendingDeleteOutputIndex(null)
  }

  // Last-updated-first, applied once so both view modes render the
  // same order (docs/SPEC.md §3.8's InventoryList entry).
  const sortedDecisions = useMemo(() => sortByUpdatedDesc(decisions ?? [], (d) => d.UpdatedAt), [decisions])
  // The Versions section (docs/adr/0040 decision 4) reads the STORE's
  // own copy, not local form state -- Publish is a real mutation this
  // form doesn't otherwise track, and re-deriving from the store keeps
  // it live-synced the same way every other read here already is.
  const editingDecision = editingID ? (decisions ?? []).find((d) => d.ID === editingID) : undefined

  const decisionItems: InventoryItem[] = sortedDecisions.map((d) => {
    const seedReset = describeSeedReset(d.Seed, seedRevisions[d.ID] ?? d.Seed.SeedRevision)
    return {
      id: d.ID,
      entity: 'decision',
      icon: ENTITY_ICON.decision,
      label: d.Label,
      updatedLabel: formatUpdated(d.UpdatedAt),
      builtIn: d.BuiltIn,
      updatedAt: d.UpdatedAt,
      createdAt: d.CreatedAt,
      labelBadges: <Label variant="secondary" size="small">{CATEGORY_LABEL[d.Category] ?? d.Category}</Label>,
      description: t('configureDecisions.outputsSummary', { keys: (d.Outputs ?? []).map((o) => o.Key).join(', ') || t('configureDecisions.none') }),
      onOpen: () => startEdit(d),
      menuActions: [
        { commandId: 'configure.decision.duplicate', ctx: entityRowContext('decision', d.ID) },
        { commandId: 'configure.decision.export', ctx: entityRowContext('decision', d.ID) },
        // Reset-to-shipped-example (docs/goals/0037 item 4): the command's
        // own enabled() hides it once the row matches the shipped golden,
        // so the row only names the revision it would restore.
        { commandId: 'configure.decision.reset', ctx: entityRowContext('decision', d.ID), label: seedReset.label },
        { commandId: 'configure.decision.delete', ctx: entityRowContext('decision', d.ID), danger: true },
      ],
    }
  })

  return (
    <PageContainer data-testid="configure-decisions">
      <Stack direction="horizontal" justify="end" align="center" className={styles.sectionHeading}>
        {/* Design-wave-1 fix #6: the Configure tab already names this
            section -- visually hidden (not removed) so the aria-labelledby
            wiring below and the a11y heading structure both stay intact. */}
        <VisuallyHidden>
          <Heading as="h2" variant="small" id="decisions-heading">{t('configureDecisions.heading')}</Heading>
        </VisuallyHidden>
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
            {t('import')}
          </Button>
          <RestoreExamplesButton items={restorable} onRestore={restoreExample} />
          <Button leadingVisual={PlusIcon} variant="primary" size="small" onClick={() => startCreate()} data-testid="new-decision">
            {t('configureDecisions.newDecision')}
          </Button>
        </Stack>
      </Stack>
      <Text as="p" size="small" className={styles.muted}>
        {t('configureDecisions.pageDescription')}
      </Text>
      {(importError ?? rowActionError) && (
        <Text as="p" size="small" className={styles.error} data-testid="import-decision-error">{importError ?? rowActionError}</Text>
      )}

      {formOpen && (
        <PageContainer variant="narrow">
          <div className={styles.card}>
            <Stack direction="vertical" gap="condensed">
              <FormControl>
                <FormControl.Label>{t('configureDecisions.label')}</FormControl.Label>
                <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block />
              </FormControl>
              <FormControl disabled={!!editingID}>
                <FormControl.Label>{t('configureDecisions.category')}</FormControl.Label>
                <FormControl.Caption>
                  {editingID
                    ? t('configureDecisions.categoryCaptionEditing')
                    : t('configureDecisions.categoryCaptionCreating')}
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

              <Text size="small" weight="semibold">{t('configureDecisions.outputs')}</Text>
              <Text as="p" size="small" className={styles.muted}>
                {t('configureDecisions.outputsDescription')}
              </Text>
              {outputs.map((o, i) => (
                <Stack key={i} direction="horizontal" gap="condensed" align="center" className={o.deprecated ? styles.muted : undefined} data-testid="decision-output-row">
                  <TextInput placeholder={t('configureDecisions.keyPlaceholder')} value={o.Key} onChange={(e) => updateOutput(i, 'Key', e.target.value)} />
                  <TextInput placeholder={t('configureDecisions.labelPlaceholder')} value={o.Label} onChange={(e) => updateOutput(i, 'Label', e.target.value)} />
                  <Select value={o.Type} onChange={(e) => updateOutput(i, 'Type', e.target.value)}>
                    {TYPE_OPTIONS.map((opt) => (
                      <Select.Option key={opt} value={opt}>{opt}</Select.Option>
                    ))}
                  </Select>
                  <TextInput
                    placeholder={t('configureDecisions.enumValuesPlaceholder')}
                    value={(o.Options ?? []).join(', ')}
                    onChange={(e) => updateOutput(i, 'Options', e.target.value)}
                  />
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Checkbox
                      checked={o.deprecated ?? false}
                      aria-label={t('configureDecisions.deprecatedCheckboxAriaLabel')}
                      onChange={(e) => toggleOutputDeprecated(i, e.target.checked)}
                    />
                    <Text size="small" className={styles.muted}>{t('configureDecisions.deprecatedLabel')}</Text>
                  </Stack>
                  <IconButton
                    icon={TrashIcon}
                    aria-label={t('configureDecisions.removeOutputAriaLabel')}
                    size="small"
                    variant="invisible"
                    onClick={() => requestRemoveOutput(i)}
                  />
                </Stack>
              ))}
              {pendingDeleteOutputIndex !== null && (
                <ConfirmDialog
                  title={t('configureDecisions.deleteFieldConfirmTitle')}
                  body={t('configureDecisions.deleteFieldConfirmBody', { key: outputs[pendingDeleteOutputIndex].Key })}
                  confirmLabel={t('delete')}
                  cancelLabel={t('entityRefField.cancel')}
                  onCancel={() => setPendingDeleteOutputIndex(null)}
                  onConfirm={confirmRemoveOutput}
                />
              )}
              <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => setOutputs((prev) => [...prev, emptyOutput()])}>
                {t('configureDecisions.addOutput')}
              </Button>

              <Text size="small" weight="semibold">{t('configureDecisions.webhookOptional')}</Text>
              <Text as="p" size="small" className={styles.muted}>
                {t('configureDecisions.webhookDescription')}
              </Text>
              <EntityRefField refKind="request" value={webhookRequestID} onChange={setWebhookRequestID} />

              {editingID && editingDecision && (
                <DecisionVersionsSection decision={editingDecision} onPublished={refetch} />
              )}

              {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
              <Stack direction="horizontal" gap="condensed">
                <Button variant="primary" size="small" onClick={save} data-testid="save-decision">{t('configureDecisions.saveDecision')}</Button>
                <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
              </Stack>
            </Stack>
          </div>
        </PageContainer>
      )}

      {decisions === null && <Text as="p" className={styles.muted}>{t('loading')}</Text>}
      {decisions !== null && viewMode === 'table' && decisions.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-decisions">
          <DataTable
            aria-labelledby="decisions-heading"
            data={sortedDecisions.map((d) => ({ ...d, id: d.ID }))}
            columns={[
              { header: t('configureDecisions.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureDecisions.columns.category'), id: 'category', renderCell: (d) => <Label variant="secondary">{CATEGORY_LABEL[d.Category] ?? d.Category}</Label> },
              { header: t('configureDecisions.columns.outputs'), id: 'outputs', width: 'growCollapse', minWidth: '160px', renderCell: (d) => <TruncatedCell text={(d.Outputs ?? []).map((o) => o.Key).join(', ')} mono /> },
              { header: t('configureDecisions.columns.id'), field: 'ID' },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (d) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureDecisions.editAriaLabel', { label: d.Label })} size="small" variant="invisible" onClick={() => startEdit(d)} />
                    <IconButton icon={CopyIcon} aria-label={t('configureDecisions.duplicateAriaLabel', { label: d.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.decision.duplicate', entityRowContext('decision', d.ID))} />
                    <IconButton icon={DownloadIcon} aria-label={t('configureDecisions.exportAriaLabel', { label: d.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.decision.export', entityRowContext('decision', d.ID))} />
                    <IconButton icon={TrashIcon} aria-label={t('configureDecisions.deleteAriaLabel', { label: d.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.decision.delete', entityRowContext('decision', d.ID))} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      {decisions !== null && viewMode === 'rows' && !(formOpen && decisions.length === 0) && (
        <InventoryList
          listId="configure.decisions"
          items={decisionItems}
          searchPlaceholder={t('configureDecisions.searchPlaceholder')}
          emptyState={{
            icon: ENTITY_ICON.decision.Icon,
            heading: t('configureDecisions.emptyHeading'),
            description: t('configureDecisions.emptyDescription'),
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={() => startCreate()}>{t('configureDecisions.newDecision')}</Button>,
          }}
        />
      )}
      {importConfirm.dialog}
    </PageContainer>
  )
}
