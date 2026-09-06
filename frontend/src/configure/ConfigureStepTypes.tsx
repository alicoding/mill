import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, Heading, IconButton, Select, Stack, Text, TextInput, VisuallyHidden } from '@primer/react'
import { DownloadIcon, InfoIcon, PackageIcon, PencilIcon, PlusIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import type { DeclaredStepType } from '../../bindings/github.com/alicoding/mill/internal/domain/declaredsteptype/models'
import { Engine, PaletteGroup } from '../../bindings/github.com/alicoding/mill/internal/domain/declaredsteptype/models'
import { refreshDeclaredStepTypes, useConfigureEntityStore } from '../shared/configureEntityStore'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { entityRowContext } from '../shared/entityRowCommands'
import { useEntityActionError } from '../shared/entityActionErrorStore'
import { runCommand } from '../shared/commands'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useImportConfirm } from '../shared/useImportConfirm'
import { PALETTE_GROUP_LABEL, PALETTE_GROUP_ORDER } from '../shared/paletteGroups'
import { bindingComplete, bindingFieldKeysFor, engineNodeTypeIdFor } from './declaredStepTypeEngine'
import { StepTypeEngineBindingFields, type EngineBinding } from './StepTypeEngineBindingFields'
import { StepTypePinnedFieldsEditor, type PinnedFieldsState } from './StepTypePinnedFieldsEditor'
import { useUISignalStore } from '../shared/uiSignalStore'
import styles from '../shared/ListCard.module.css'
import { PaneLoading } from './PaneLoading'
import PageContainer from '../shared/PageContainer'

type BindingKind = Engine | 'needs-code'

const EMPTY_BINDING: EngineBinding = { engine: Engine.EngineHTTP, requestID: '', mcpServerID: '', toolName: '', workflowID: '' }
const EMPTY_PINNED: PinnedFieldsState = { pinnedConfig: {}, hiddenFields: [] }

function engineLabelFor(t: (key: string) => string): Record<Engine, string> {
  return {
    [Engine.EngineHTTP]: t('configureStepTypes.engineHttp'),
    [Engine.EngineMCP]: t('configureStepTypes.engineMcp'),
    [Engine.EngineWorkflow]: t('configureStepTypes.engineWorkflow'),
    [Engine.$zero]: '',
  }
}

// Configure's Step types section (ADR-0037, goal 0054 slice B): CRUD
// over ConfigureService's DeclaredStepTypes -- a reusable (1:many), named
// palette step assembled from an already-configured HTTP operation, MCP
// tool, or callable workflow, with optional pinned fields. Mirrors
// ConfigureExecEnv.tsx/ConfigureDecisions.tsx's shape closely: the same
// inventory-list + create/edit form + delete-with-confirm +
// export/import recipe every Configure family page already follows.
export function ConfigureStepTypes() {
  const { t } = useTranslation('configure')
  // A row action's refusal, recorded by the command that met it
  // (shared/entityActionErrorStore.ts, goal 0346).
  const rowActionError = useEntityActionError('steptype')
  const ENGINE_LABEL = engineLabelFor(t)
  const stepTypes = useConfigureEntityStore((s) => s.declaredStepTypes)
  const nodeTypes = useAppStore((s) => s.nodeTypes)

  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [paletteGroup, setPaletteGroup] = useState<PaletteGroup>(PaletteGroup.GroupActions)
  const [bindingKind, setBindingKind] = useState<BindingKind>(Engine.EngineHTTP)
  const [binding, setBinding] = useState<EngineBinding>(EMPTY_BINDING)
  const [pinned, setPinned] = useState<PinnedFieldsState>(EMPTY_PINNED)
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-steptypes-view-mode')

  const refetch = () => { void refreshDeclaredStepTypes() }
  useEffect(() => { refetch() }, [])

  const runImport = (text: string) => {
    ConfigureService.ImportDeclaredStepType(text)
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }
  const importConfirm = useImportConfirm({ existing: stepTypes ?? [], onImport: runImport })
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(importConfirm.requestImport).catch((err) => setImportError(String(err)))
  }

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setDescription('')
    setPaletteGroup(PaletteGroup.GroupActions)
    setBindingKind(Engine.EngineHTTP)
    setBinding(EMPTY_BINDING)
    setPinned(EMPTY_PINNED)
    setFormOpen(true)
    setError('')
  }

  // configure.new.steptypes (shared/configureCreateCommands.ts, goal
  // 0071 G6) -- same signal-consumption shape as ConfigureLists.tsx's
  // own configureCreateRequest effect.
  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'steptypes') return
    startCreate()
    consumeConfigureCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate/consumeConfigureCreate deliberately excluded, same reasoning useCanvasCommandDispatch.ts's own identical effect documents
  }, [configureCreateRequest])

  const startEdit = (d: DeclaredStepType) => {
    setEditingID(d.ID)
    setLabel(d.Label)
    setDescription(d.Description)
    setPaletteGroup(d.PaletteGroup)
    setBindingKind(d.Engine)
    setBinding({ engine: d.Engine, requestID: d.RequestID, mcpServerID: d.MCPServerID, toolName: d.ToolName, workflowID: d.WorkflowID })
    setPinned({ pinnedConfig: Object.fromEntries(Object.entries(d.PinnedConfig ?? {}).filter((e): e is [string, string] => e[1] !== undefined)), hiddenFields: [...(d.HiddenFields ?? [])] })
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    if (bindingKind === 'needs-code') return
    try {
      if (editingID) {
        await ConfigureService.UpdateDeclaredStepType(editingID, label, description, paletteGroup, binding.engine, binding.requestID, binding.mcpServerID, binding.toolName, binding.workflowID, pinned.pinnedConfig, pinned.hiddenFields)
      } else {
        await ConfigureService.CreateDeclaredStepType(label, description, paletteGroup, binding.engine, binding.requestID, binding.mcpServerID, binding.toolName, binding.workflowID, pinned.pinnedConfig, pinned.hiddenFields)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }


  // The underlying engine's own raw ConfigFields (not the synthesized
  // declared view -- that already has PinnedConfig/HiddenFields applied,
  // which is exactly what this form is still deciding), minus the
  // engine's own binding field(s): those are covered by the binding
  // picker above and always force-hidden server-side, never offered as
  // a pinnable field here.
  const pinnableFields = useMemo(() => {
    if (bindingKind === 'needs-code') return []
    const engineNodeType = (nodeTypes ?? []).find((nt) => nt.ID === engineNodeTypeIdFor(binding.engine) && !nt.Declared)
    const bindingKeys = bindingFieldKeysFor(binding.engine)
    return (engineNodeType?.ConfigFields ?? []).filter((f) => !bindingKeys.has(f.Key))
  }, [nodeTypes, binding.engine, bindingKind])

  const saveDisabled = label.trim() === '' || bindingKind === 'needs-code' || !bindingComplete(binding.engine, binding.requestID, binding.mcpServerID, binding.toolName, binding.workflowID)

  const sortedStepTypes = useMemo(() => sortByUpdatedDesc(stepTypes ?? [], (d) => d.UpdatedAt), [stepTypes])

  const stepTypeItems: InventoryItem[] = sortedStepTypes.map((d) => ({
    id: d.ID,
    entity: 'steptype',
    icon: ENTITY_ICON.steptype,
    label: d.Label,
    updatedLabel: formatUpdated(d.UpdatedAt),
    builtIn: d.BuiltIn,
    updatedAt: d.UpdatedAt,
    createdAt: d.CreatedAt,
    description: `${ENGINE_LABEL[d.Engine] ?? d.Engine} · ${PALETTE_GROUP_LABEL[d.PaletteGroup as keyof typeof PALETTE_GROUP_LABEL] ?? d.PaletteGroup}`,
    onOpen: () => startEdit(d),
    menuActions: [
      { commandId: 'configure.steptype.export', ctx: entityRowContext('steptype', d.ID) },
      { commandId: 'configure.steptype.delete', ctx: entityRowContext('steptype', d.ID), danger: true },
    ],
  }))

  return (
    <PageContainer data-testid="configure-steptypes">
      <Stack direction="horizontal" justify="end" align="center" className={styles.sectionHeading}>
        <VisuallyHidden>
          <Heading as="h2" variant="small" id="steptypes-heading">{t('configureStepTypes.heading')}</Heading>
        </VisuallyHidden>
        <Stack direction="horizontal" gap="condensed">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-steptype-input"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <Button leadingVisual={UploadIcon} size="small" onClick={() => importInputRef.current?.click()} data-testid="import-steptype">
            {t('import')}
          </Button>
          <Button leadingVisual={PlusIcon} variant="primary" size="small" onClick={startCreate} data-testid="new-steptype">
            {t('configureStepTypes.newStepType')}
          </Button>
        </Stack>
      </Stack>
      <Text as="p" size="small" className={styles.muted}>
        {t('configureStepTypes.pageDescription')}
      </Text>
      {(importError ?? rowActionError) && (
        <Text as="p" size="small" className={styles.error} data-testid="import-steptype-error">{importError ?? rowActionError}</Text>
      )}

      {formOpen && (
        <PageContainer variant="narrow">
          <div className={styles.card}>
            <Stack direction="vertical" gap="condensed">
              <FormControl>
                <FormControl.Label>{t('configureStepTypes.label')}</FormControl.Label>
                <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block data-testid="steptype-label" />
              </FormControl>
              <FormControl>
                <FormControl.Label>{t('configureStepTypes.description')}</FormControl.Label>
                <TextInput value={description} onChange={(e) => setDescription(e.target.value)} block />
              </FormControl>
              <FormControl>
                <FormControl.Label>{t('configureStepTypes.paletteGroup')}</FormControl.Label>
                <Select value={paletteGroup} data-testid="steptype-palette-group" onChange={(e) => setPaletteGroup(e.target.value as PaletteGroup)}>
                  {PALETTE_GROUP_ORDER.map((g) => (
                    <Select.Option key={g} value={g}>{PALETTE_GROUP_LABEL[g]}</Select.Option>
                  ))}
                </Select>
              </FormControl>

              <FormControl>
                <FormControl.Label>{t('configureStepTypes.bindingKind')}</FormControl.Label>
                <FormControl.Caption>{t('configureStepTypes.engineCaption')}</FormControl.Caption>
                <Select
                  value={bindingKind}
                  data-testid="steptype-binding-kind"
                  onChange={(e) => {
                    const kind = e.target.value as BindingKind
                    setBindingKind(kind)
                    if (kind !== 'needs-code') {
                      setBinding({ ...EMPTY_BINDING, engine: kind })
                      setPinned(EMPTY_PINNED)
                    }
                  }}
                >
                  <Select.Option value={Engine.EngineHTTP}>{t('configureStepTypes.engineHttp')}</Select.Option>
                  <Select.Option value={Engine.EngineMCP}>{t('configureStepTypes.engineMcp')}</Select.Option>
                  <Select.Option value={Engine.EngineWorkflow}>{t('configureStepTypes.engineWorkflow')}</Select.Option>
                  <Select.Option value="needs-code">{t('configureStepTypes.needsCodeOption')}</Select.Option>
                </Select>
              </FormControl>

              {bindingKind === 'needs-code' ? (
                <Stack direction="horizontal" gap="condensed" align="start" data-testid="steptype-needs-code" className={styles.card}>
                  <InfoIcon size={16} />
                  <Text as="p" size="small">{t('configureStepTypes.needsCodeExplanation')}</Text>
                </Stack>
              ) : (
                <>
                  <StepTypeEngineBindingFields binding={binding} onChange={setBinding} />

                  <Text size="small" weight="semibold">{t('configureStepTypes.pinnedFieldsHeading')}</Text>
                  <Text as="p" size="small" className={styles.muted}>
                    {t('configureStepTypes.pinnedFieldsDescription')}
                  </Text>
                  <StepTypePinnedFieldsEditor fields={pinnableFields} state={pinned} onChange={setPinned} />
                </>
              )}

              {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
              <Stack direction="horizontal" gap="condensed">
                <Button variant="primary" size="small" onClick={save} disabled={saveDisabled} data-testid="save-steptype">
                  {t('configureStepTypes.saveStepType')}
                </Button>
                <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
              </Stack>
            </Stack>
          </div>
        </PageContainer>
      )}

      {stepTypes === null && <PaneLoading />}
      {stepTypes !== null && viewMode === 'table' && stepTypes.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-steptypes">
          <DataTable
            aria-labelledby="steptypes-heading"
            data={sortedStepTypes.map((d) => ({ ...d, id: d.ID }))}
            columns={[
              { header: t('configureStepTypes.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureStepTypes.columns.engine'), id: 'engine', renderCell: (d) => ENGINE_LABEL[d.Engine] ?? d.Engine },
              { header: t('configureStepTypes.columns.group'), id: 'group', renderCell: (d) => PALETTE_GROUP_LABEL[d.PaletteGroup as keyof typeof PALETTE_GROUP_LABEL] ?? d.PaletteGroup },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (d) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureStepTypes.editAriaLabel', { label: d.Label })} size="small" variant="invisible" onClick={() => startEdit(d)} />
                    <IconButton icon={DownloadIcon} aria-label={t('configureStepTypes.exportAriaLabel', { label: d.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.steptype.export', entityRowContext('steptype', d.ID))} />
                    <IconButton icon={TrashIcon} aria-label={t('configureStepTypes.deleteAriaLabel', { label: d.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.steptype.delete', entityRowContext('steptype', d.ID))} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      {stepTypes !== null && viewMode === 'rows' && !(formOpen && stepTypes.length === 0) && (
        <InventoryList
          listId="configure.steptypes"
          items={stepTypeItems}
          searchPlaceholder={t('configureStepTypes.searchPlaceholder')}
          emptyState={{
            icon: PackageIcon,
            heading: t('configureStepTypes.emptyHeading'),
            description: t('configureStepTypes.emptyDescription'),
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>{t('configureStepTypes.newStepType')}</Button>,
          }}
        />
      )}
      {importConfirm.dialog}
    </PageContainer>
  )
}
