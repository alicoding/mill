import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Stack, Text, TextInput } from '@primer/react'
import { DownloadIcon, PencilIcon, PlusIcon, SparkleFillIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { AIProvider } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import { Kind as AIProviderKind } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { refreshAIProviders, useConfigureEntityStore } from '../shared/configureEntityStore'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { describeSeedReset } from '../shared/seedLifecycle'
import { useUISignalStore } from '../shared/uiSignalStore'
import { EntityConfigFields } from './EntityConfigFields'
import { ConfigureEntityPage } from './ConfigureEntityPage'
import { useSeedLifecycle } from './useSeedLifecycle'
import { useEntityImportExport } from './useEntityImportExport'
import styles from '../shared/ListCard.module.css'

function kindLabelFor(t: (key: string) => string): Record<string, string> {
  return {
    [AIProviderKind.KindOpenAICompat]: t('configureAIProviders.kindLabel.openaiCompat'),
    [AIProviderKind.KindAnthropic]: t('configureAIProviders.kindLabel.anthropic'),
  }
}

const emptyValues = { label: '', kind: AIProviderKind.KindOpenAICompat as string, baseURL: '', model: '' }

// Configure's AI Providers section (docs/goals/0031-ai-node-family.md):
// CRUD over ConfigureService's AIProviders, each a reusable connection
// an ai-completion/ai-extract-structured/ai-classify node resolves by
// ID -- the AIProvider Configure entity recipe, mirroring
// ConfigureMCPServers.tsx's own shape (create/edit inline, rows are the
// default view per docs/goals/0007). Label/Kind/Base URL/Model render
// from AIProviderFields' descriptor (docs/adr/0166) via the shared
// EntityConfigFields renderer; Secret stays its own field outside the
// descriptor -- write-only (ADR/§3.5's established pattern, mirrored
// from RequestForm.tsx): typing a value and saving calls
// SetAIProviderSecret as a second, best-effort step after the entity
// itself saves; the field never pre-fills on edit and always clears
// after a successful save. Page chrome (header row, import/export,
// seed lifecycle, view-mode switch, confirm dialogs) comes from the
// shared ConfigureEntityPage (docs/goals/0167); only the field set and
// list columns are this entity's own.
export function ConfigureAIProviders() {
  const { t } = useTranslation('configure')
  const KIND_LABEL = kindLabelFor(t)
  const providers = useConfigureEntityStore((s) => s.aiProviders)
  const [fields, setFields] = useState<Field[]>([])
  const [editingID, setEditingID] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>(emptyValues)
  const [secret, setSecret] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useViewMode('mill-aiproviders-view-mode')

  const seedLifecycle = useSeedLifecycle<AIProvider>(() => ConfigureService.RestorableAIProviders())

  const refetch = () => {
    void refreshAIProviders()
  }

  const importExport = useEntityImportExport<AIProvider>({
    existing: providers ?? [],
    exportEntity: (id) => ConfigureService.ExportAIProvider(id),
    importEntity: (text) => ConfigureService.ImportAIProvider(text),
    onImported: refetch,
    filenameFallback: 'ai-provider',
  })

  useEffect(() => {
    refetch()
    seedLifecycle.refresh()
    ConfigureService.AIProviderFields().then((f) => setFields(f ?? [])).catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch, same reasoning every sibling Configure page's identical effect documents
  }, [])

  const startCreate = () => {
    setEditingID(null)
    setValues(emptyValues)
    setSecret('')
    setFormOpen(true)
    setError('')
  }

  // configure.new.aiproviders (shared/configureCreateCommands.ts, goal
  // 0071 G6) -- same signal-consumption shape as ConfigureLists.tsx's
  // own configureCreateRequest effect.
  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'aiproviders') return
    startCreate()
    consumeConfigureCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate/consumeConfigureCreate deliberately excluded, same reasoning useCanvasCommandDispatch.ts's own identical effect documents
  }, [configureCreateRequest])

  const startEdit = (p: AIProvider) => {
    setEditingID(p.ID)
    setValues({ label: p.Label, kind: p.Kind, baseURL: p.BaseURL, model: p.Model })
    setSecret('') // write-only -- never pre-fills
    setFormOpen(true)
    setError('')
  }

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }))

  const save = async () => {
    setError('')
    try {
      const kind = values.kind as AIProviderKind
      const saved = editingID
        ? await ConfigureService.UpdateAIProvider(editingID, values.label, kind, values.baseURL, values.model)
        : await ConfigureService.CreateAIProvider(values.label, kind, values.baseURL, values.model)
      if (secret) {
        try {
          await ConfigureService.SetAIProviderSecret(saved.ID, secret)
        } catch (err) {
          // Same best-effort posture RequestForm.tsx's own secret write
          // already documents -- the provider itself is saved; only the
          // credential write failed (e.g. no OS keychain available).
          console.error('AI provider secret write failed (provider was still saved):', err)
        }
      }
      setFormOpen(false)
      setSecret('')
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string) => {
    ConfigureService.DeleteAIProvider(id).then(() => {
      refetch()
      seedLifecycle.refresh()
    }).catch((err) => importExport.setImportError(String(err)))
  }

  const resetToSeed = (id: string) => {
    ConfigureService.ResetAIProviderToSeed(id).then(() => {
      refetch()
      seedLifecycle.refresh()
    }).catch((err) => importExport.setImportError(String(err)))
  }

  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<AIProvider>({
    entityType: 'AI provider',
    labelOf: (p) => p.Label,
    onConfirm: (p) => remove(p.ID),
  })

  const sortedProviders = useMemo(() => sortByUpdatedDesc(providers ?? [], (p) => p.UpdatedAt), [providers])

  const providerItems: InventoryItem[] = sortedProviders.map((p) => {
    const seedReset = describeSeedReset(p.Seed, seedLifecycle.seedRevisions[p.ID] ?? p.Seed.SeedRevision)
    return {
      id: p.ID,
      entity: 'aiprovider',
      icon: ENTITY_ICON.aiprovider,
      label: p.Label,
      updatedLabel: formatUpdated(p.UpdatedAt),
      labelBadges: p.BuiltIn ? <StatusStamp variant="identity">{t('builtIn')}</StatusStamp> : undefined,
      description: `${KIND_LABEL[p.Kind] ?? p.Kind} – ${p.Model}${p.BaseURL ? ` – ${p.BaseURL}` : ''}`,
      onOpen: () => startEdit(p),
      menuActions: [
        { label: t('export'), onClick: () => importExport.exportItem(p.ID, p.Label) },
        ...(p.BuiltIn && !seedReset.disabled ? [{ label: seedReset.label, onClick: () => resetToSeed(p.ID) }] : []),
        {
          label: t('delete'),
          onClick: () => remove(p.ID),
          danger: true,
          confirm: { title: t('configureAIProviders.deleteConfirmTitle'), body: t('configureAIProviders.deleteConfirmBody', { label: p.Label }) },
        },
      ],
    }
  })

  return (
    <ConfigureEntityPage
      pageTestId="configure-aiproviders"
      headingId="aiproviders-heading"
      headingText={t('configureAIProviders.heading')}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      importInputRef={importExport.importInputRef}
      importInputTestId="import-aiprovider-input"
      importTestId="import-aiprovider"
      onImportFile={importExport.handleImportFile}
      onImportClick={importExport.openImportPicker}
      importErrorNode={importExport.importError && (
        <Text as="p" size="small" className={styles.error} data-testid="import-aiprovider-error">{importExport.importError}</Text>
      )}
      restorable={seedLifecycle.restorable}
      onRestore={(id) => ConfigureService.RestoreAIProvider(id).then(() => { refetch(); seedLifecycle.refresh() }).catch((err) => importExport.setImportError(String(err)))}
      primaryLabel={t('configureAIProviders.newAiProvider')}
      primaryTestId="new-aiprovider"
      onPrimary={startCreate}
      formOpen={formOpen}
      formContent={(
        <Stack direction="vertical" gap="condensed">
          <EntityConfigFields
            fields={fields}
            values={values}
            onChange={setValue}
            placeholders={{ baseURL: t('configureAIProviders.baseUrlPlaceholder'), model: t('configureAIProviders.modelPlaceholder') }}
            captionOverrides={{
              baseURL: values.kind === AIProviderKind.KindAnthropic
                ? t('configureAIProviders.baseUrlCaptionAnthropic')
                : t('configureAIProviders.baseUrlCaptionOther'),
            }}
            optionLabels={{ kind: KIND_LABEL }}
            testIds={{ kind: 'aiprovider-kind' }}
          />
          <FormControl>
            <FormControl.Label>{t('configureAIProviders.secretApiKey')}</FormControl.Label>
            <FormControl.Caption>{t('configureAIProviders.secretCaption')}</FormControl.Caption>
            <TextInput type="password" value={secret} onChange={(e) => setSecret(e.target.value)} block />
          </FormControl>
          {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" size="small" onClick={save}>{t('configureAIProviders.saveAiProvider')}</Button>
            <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
          </Stack>
        </Stack>
      )}
      loading={providers === null}
      showTable={providers !== null && viewMode === 'table' && providers.length > 0}
      tableContent={(
        <ResizableTableContainer storageKey="mill-cols-aiproviders">
          <DataTable
            aria-labelledby="aiproviders-heading"
            data={sortedProviders.map((p) => ({ ...p, id: p.ID }))}
            columns={[
              { header: t('configureAIProviders.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureAIProviders.columns.kind'), id: 'kind', renderCell: (p) => <Text>{KIND_LABEL[p.Kind] ?? p.Kind}</Text> },
              { header: t('configureAIProviders.columns.model'), field: 'Model' },
              { header: t('configureAIProviders.columns.baseUrl'), id: 'baseURL', width: 'growCollapse', minWidth: '160px', renderCell: (p) => <TruncatedCell text={p.BaseURL} mono /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (p) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureAIProviders.editAriaLabel', { label: p.Label })} size="small" variant="invisible" onClick={() => startEdit(p)} />
                    <IconButton icon={DownloadIcon} aria-label={t('configureAIProviders.exportAriaLabel', { label: p.Label })} size="small" variant="invisible" onClick={() => importExport.exportItem(p.ID, p.Label)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureAIProviders.deleteAriaLabel', { label: p.Label })} size="small" variant="invisible" onClick={() => requestDelete(p)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      showRows={providers !== null && viewMode === 'rows' && !(formOpen && providers.length === 0)}
      rowsContent={(
        <InventoryList
          items={providerItems}
          searchPlaceholder={t('configureAIProviders.searchPlaceholder')}
          emptyState={{
            icon: SparkleFillIcon,
            heading: t('configureAIProviders.emptyHeading'),
            description: t('configureAIProviders.emptyDescription'),
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>{t('configureAIProviders.newAiProvider')}</Button>,
          }}
        />
      )}
      confirmDialog={confirmDialog}
      importConfirmDialog={importExport.importConfirm.dialog}
    />
  )
}
