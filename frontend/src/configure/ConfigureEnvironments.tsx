import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormControl, IconButton, Stack, Text, TextInput } from '@primer/react'
import { DownloadIcon, GlobeIcon, PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { Environment } from '../../bindings/github.com/alicoding/mill/internal/domain/environment/models'
import { refreshEnvironments, useConfigureEntityStore } from '../shared/configureEntityStore'
import { countsFor, isValidKey, needsValueCount, rowsToVars, varsToRows, type VarRow } from './environmentRows'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { entityRowContext } from '../shared/entityRowCommands'
import { useEntityActionError } from '../shared/entityActionErrorStore'
import { runCommand } from '../shared/commands'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { describeSeedReset } from '../shared/seedLifecycle'
import { useUISignalStore } from '../shared/uiSignalStore'
import { SecretPicker } from '../shared/SecretPicker'
import { ConfigureEntityPage } from './ConfigureEntityPage'
import { useSeedLifecycle } from './useSeedLifecycle'
import { useEntityImportExport } from './useEntityImportExport'
import styles from '../shared/ListCard.module.css'

// VARIABLE_EXAMPLE is the reference syntax shown in the form's own
// caption. It lives here rather than in the locale file because the
// braces around it are interpolation syntax to i18next, not text.
const VARIABLE_EXAMPLE = '{{API_BASE}}'

// Configure's Environments section (goal 0306 S5): a named set of
// variables a run selects instead of editing the request it is about
// to send. A variable is plain (its value is the text substituted for
// {{name}}) or secret (its value is a pick from the secret store), so
// the row editor here has two controls behind one checkbox rather than
// two separate lists. Page chrome comes from the shared
// ConfigureEntityPage (docs/goals/0167).
export function ConfigureEnvironments() {
  const { t } = useTranslation('configure')
  const rowActionError = useEntityActionError('environment')
  const environments = useConfigureEntityStore((s) => s.environments)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [varRows, setVarRows] = useState<VarRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useViewMode('mill-environments-view-mode')

  const seedLifecycle = useSeedLifecycle<Environment>(() => ConfigureService.RestorableEnvironments(), environments)

  const refetch = () => {
    void refreshEnvironments()
  }

  const importExport = useEntityImportExport<Environment>({
    existing: environments ?? [],
    exportEntity: (id) => ConfigureService.ExportEnvironment(id),
    importEntity: (text) => ConfigureService.ImportEnvironment(text),
    onImported: refetch,
    filenameFallback: 'environment',
  })

  useEffect(() => {
    refetch()
    seedLifecycle.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch, same reasoning every sibling Configure page's identical effect documents
  }, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setVarRows([{ key: '', value: '', secret: false }])
    setFormOpen(true)
    setError('')
  }

  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'environments') return
    startCreate()
    consumeConfigureCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate/consumeConfigureCreate deliberately excluded, same reasoning useCanvasCommandDispatch.ts's own identical effect documents
  }, [configureCreateRequest])

  const startEdit = (e: Environment) => {
    setEditingID(e.ID)
    setLabel(e.Label)
    setVarRows(varsToRows(e.Vars))
    setFormOpen(true)
    setError('')
  }

  // goal 0312: a reference field's Open in Configure lands on THIS
  // entity's editor, once its list has loaded.
  const configureEditRequest = useUISignalStore((s) => s.configureEditRequest)
  const consumeConfigureEdit = useUISignalStore((s) => s.consumeConfigureEdit)
  useEffect(() => {
    if (configureEditRequest?.tab !== 'environments' || environments === null) return
    const target = environments.find((x) => x.ID === configureEditRequest.id)
    consumeConfigureEdit()
    if (target) startEdit(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit/consumeConfigureEdit deliberately excluded, same reasoning as the create effect above
  }, [configureEditRequest, environments])

  // A duplicate opens the create form prefilled from the row (goal
  // 0346), the same signal every other Configure family consumes.
  const configureDuplicateRequest = useUISignalStore((s) => s.configureDuplicateRequest)
  const consumeConfigureDuplicate = useUISignalStore((s) => s.consumeConfigureDuplicate)
  useEffect(() => {
    if (configureDuplicateRequest?.tab !== 'environments' || environments === null) return
    const source = environments.find((x) => x.ID === configureDuplicateRequest.id)
    consumeConfigureDuplicate()
    if (!source) return
    setEditingID(null)
    setLabel(t('configureEnvironments.copyOf', { label: source.Label }))
    setVarRows(varsToRows(source.Vars))
    setFormOpen(true)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same reasoning as the create effect above
  }, [configureDuplicateRequest, environments])

  const updateVarRow = (i: number, patch: Partial<VarRow>) => {
    setVarRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const invalidKey = varRows.find((r) => r.key.trim() !== '' && !isValidKey(r.key.trim()))

  const save = async () => {
    setError('')
    if (invalidKey) {
      setError(t('configureEnvironments.invalidName', { name: invalidKey.key }))
      return
    }
    try {
      const vars = rowsToVars(varRows)
      if (editingID) {
        await ConfigureService.UpdateEnvironment(editingID, label, vars)
      } else {
        await ConfigureService.CreateEnvironment(label, vars)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const sortedEnvironments = useMemo(() => sortByUpdatedDesc(environments ?? [], (e) => e.UpdatedAt), [environments])

  const describe = (e: Environment) => {
    const { total, secret } = countsFor(e)
    return t('configureEnvironments.summary', { total, secret })
  }

  const items: InventoryItem[] = sortedEnvironments.map((e) => {
    const seedReset = describeSeedReset(e.Seed, seedLifecycle.seedRevisions[e.ID] ?? e.Seed.SeedRevision)
    const unset = needsValueCount(e)
    return {
      id: e.ID,
      entity: 'environment',
      icon: ENTITY_ICON.environment,
      label: e.Label,
      updatedLabel: formatUpdated(e.UpdatedAt),
      builtIn: e.BuiltIn,
      updatedAt: e.UpdatedAt,
      createdAt: e.CreatedAt,
      labelBadges: (
        <>
          {e.BuiltIn && <StatusStamp variant="identity">{t('builtIn')}</StatusStamp>}
          {unset > 0 && <StatusStamp variant="caution">{t('configureEnvironments.needsValue')}</StatusStamp>}
        </>
      ),
      description: describe(e),
      onOpen: () => startEdit(e),
      menuActions: [
        { commandId: 'configure.environment.duplicate', ctx: entityRowContext('environment', e.ID) },
        { commandId: 'configure.environment.export', ctx: entityRowContext('environment', e.ID) },
        { commandId: 'configure.environment.reset', ctx: entityRowContext('environment', e.ID), label: seedReset.label },
        { commandId: 'configure.environment.delete', ctx: entityRowContext('environment', e.ID), danger: true },
      ],
    }
  })

  return (
    <ConfigureEntityPage
      pageTestId="configure-environments"
      headingId="environments-heading"
      headingText={t('configureEnvironments.heading')}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      importInputRef={importExport.importInputRef}
      importInputTestId="import-environment-input"
      importTestId="import-environment"
      onImportFile={importExport.handleImportFile}
      onImportClick={importExport.openImportPicker}
      importErrorNode={(importExport.importError ?? rowActionError) && (
        <Text as="p" size="small" className={styles.error} data-testid="import-environment-error">{importExport.importError ?? rowActionError}</Text>
      )}
      restorable={seedLifecycle.restorable}
      onRestore={(id) => ConfigureService.RestoreEnvironment(id).then(() => { refetch(); seedLifecycle.refresh() }).catch((err) => importExport.setImportError(String(err)))}
      primaryLabel={t('configureEnvironments.newEnvironment')}
      primaryTestId="new-environment"
      onPrimary={startCreate}
      formOpen={formOpen}
      formContent={(
        <Stack direction="vertical" gap="condensed">
          <FormControl>
            <FormControl.Label>{t('configureEnvironments.label')}</FormControl.Label>
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} data-testid="environment-label" block />
          </FormControl>
          <Text size="small" weight="semibold">{t('configureEnvironments.variables')}</Text>
          <FormControl.Caption>{t('configureEnvironments.variablesCaption', { example: VARIABLE_EXAMPLE })}</FormControl.Caption>
          {varRows.map((row, i) => (
            <Stack key={i} direction="vertical" gap="none">
              <Stack direction="horizontal" gap="condensed" align="center">
                <TextInput
                  placeholder={t('configureEnvironments.namePlaceholder')}
                  aria-label={t('configureEnvironments.variableNameAriaLabel', { n: i + 1 })}
                  data-testid="environment-var-key"
                  value={row.key}
                  onChange={(e) => updateVarRow(i, { key: e.target.value })}
                  validationStatus={row.key.trim() !== '' && !isValidKey(row.key.trim()) ? 'error' : undefined}
                  style={{ width: '13rem', flexShrink: 0 }}
                />
                {/* The value control changes shape with the kind, so it
                    sits in one growing cell -- otherwise the two kinds
                    of row line up differently down the list. */}
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  {row.secret ? (
                    <SecretPicker
                      value={row.value}
                      onChange={(reference) => updateVarRow(i, { value: reference })}
                      newEntryTitle={row.key.trim()}
                      ariaLabel={t('configureEnvironments.variableSecretAriaLabel', { n: i + 1 })}
                      testID="environment-var-secret"
                    />
                  ) : (
                    <TextInput
                      placeholder={t('configureEnvironments.valuePlaceholder')}
                      aria-label={t('configureEnvironments.variableValueAriaLabel', { n: i + 1 })}
                      data-testid="environment-var-value"
                      value={row.value}
                      onChange={(e) => updateVarRow(i, { value: e.target.value })}
                      block
                    />
                  )}
                </div>
                {/* Flipping the checkbox clears the value: a literal is
                    not a reference and a reference is not a literal, so
                    carrying one across would store a value the other
                    control cannot read. */}
                <Checkbox
                  checked={row.secret}
                  aria-label={t('configureEnvironments.variableSecretToggleAriaLabel', { n: i + 1 })}
                  data-testid="environment-var-secret-toggle"
                  onChange={(e) => updateVarRow(i, { secret: e.target.checked, value: '' })}
                />
                <Text size="small">{t('configureEnvironments.secret')}</Text>
                <IconButton
                  icon={TrashIcon}
                  aria-label={t('configureEnvironments.removeVariableAriaLabel')}
                  size="small"
                  variant="invisible"
                  onClick={() => setVarRows((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </Stack>
            </Stack>
          ))}
          <Stack direction="horizontal" gap="condensed">
            <Button size="small" variant="invisible" data-testid="environment-add-variable" onClick={() => setVarRows((prev) => [...prev, { key: '', value: '', secret: false }])}>
              {t('configureEnvironments.addVariable')}
            </Button>
          </Stack>
          {error && <Text as="p" size="small" className={styles.error} data-testid="environment-form-error">{error}</Text>}
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" size="small" data-testid="save-environment" onClick={save}>{t('configureEnvironments.saveEnvironment')}</Button>
            <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
          </Stack>
        </Stack>
      )}
      loading={environments === null}
      showTable={environments !== null && viewMode === 'table' && environments.length > 0}
      tableContent={(
        <ResizableTableContainer storageKey="mill-cols-environments">
          <DataTable
            aria-labelledby="environments-heading"
            data={sortedEnvironments.map((e) => ({ ...e, id: e.ID }))}
            columns={[
              { header: t('configureEnvironments.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureEnvironments.columns.variables'), id: 'variables', width: 'growCollapse', renderCell: (e) => describe(e) },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (e) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureEnvironments.editAriaLabel', { label: e.Label })} size="small" variant="invisible" onClick={() => startEdit(e)} />
                    <IconButton icon={DownloadIcon} aria-label={t('configureEnvironments.exportAriaLabel', { label: e.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.environment.export', entityRowContext('environment', e.ID))} />
                    <IconButton icon={TrashIcon} aria-label={t('configureEnvironments.deleteAriaLabel', { label: e.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.environment.delete', entityRowContext('environment', e.ID))} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      showRows={environments !== null && viewMode === 'rows' && !(formOpen && environments.length === 0)}
      rowsContent={(
        <InventoryList
          listId="configure.environment"
          items={items}
          searchPlaceholder={t('configureEnvironments.searchPlaceholder')}
          emptyState={{
            icon: GlobeIcon,
            heading: t('configureEnvironments.emptyHeading'),
            description: t('configureEnvironments.emptyDescription'),
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>{t('configureEnvironments.newEnvironment')}</Button>,
          }}
        />
      )}
      importConfirmDialog={importExport.importConfirm.dialog}
    />
  )
}
