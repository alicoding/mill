import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, Heading, IconButton, Select, Stack, Text, TextInput, VisuallyHidden } from '@primer/react'
import { DownloadIcon, PencilIcon, PlusIcon, SparkleFillIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { AIProvider } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import { Kind as AIProviderKind } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import { downloadJSON } from '../shared/downloadJSON'
import { refreshAIProviders, useConfigureEntityStore } from '../shared/configureEntityStore'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { useImportConfirm } from '../shared/useImportConfirm'
import { describeSeedReset } from '../shared/seedLifecycle'
import { RestoreExamplesButton } from '../shared/RestoreExamplesButton'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

function kindLabelFor(t: (key: string) => string): Record<string, string> {
  return {
    [AIProviderKind.KindOpenAICompat]: t('configureAIProviders.kindLabel.openaiCompat'),
    [AIProviderKind.KindAnthropic]: t('configureAIProviders.kindLabel.anthropic'),
  }
}

// Configure's AI Providers section (docs/goals/0031-ai-node-family.md):
// CRUD over ConfigureService's AIProviders, each a reusable connection
// an ai-completion/ai-extract-structured/ai-classify node resolves by
// ID -- the AIProvider Configure entity recipe, mirroring
// ConfigureMCPServers.tsx's own shape (create/edit inline, rows are the
// default view per docs/goals/0007). Secret is write-only (ADR/§3.5's
// established pattern, mirrored from RequestForm.tsx): typing a value
// and saving calls SetAIProviderSecret as a second, best-effort step
// after the entity itself saves; the field never pre-fills on edit and
// always clears after a successful save.
export function ConfigureAIProviders() {
  const { t } = useTranslation('configure')
  const KIND_LABEL = kindLabelFor(t)
  const providers = useConfigureEntityStore((s) => s.aiProviders)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<AIProviderKind>(AIProviderKind.KindOpenAICompat)
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [secret, setSecret] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-aiproviders-view-mode')
  // Seed lifecycle (docs/goals/0037) -- see ConfigureMCPServers.tsx's
  // identical state for the full reasoning.
  const [seedRevisions, setSeedRevisions] = useState<Record<string, number | undefined>>({})
  const [restorable, setRestorable] = useState<AIProvider[]>([])

  const refreshSeedLifecycle = () => {
    ConfigureService.SeedRevisions().then((m) => setSeedRevisions(m ?? {})).catch(console.error)
    ConfigureService.RestorableAIProviders().then((r) => setRestorable(r ?? [])).catch(console.error)
  }

  const refetch = () => {
    void refreshAIProviders()
  }

  const exportProvider = (id: string, label: string) => {
    ConfigureService.ExportAIProvider(id)
      .then((json) => downloadJSON(`${label.trim() || 'ai-provider'}.json`, json))
      .catch((err) => setImportError(String(err)))
  }

  const openImportPicker = () => {
    setImportError(null)
    importInputRef.current?.click()
  }

  // A payload whose id matches a provider already here updates it in
  // place instead of creating a new one -- confirmed first via
  // importConfirm below, naming the provider it will replace.
  const runImport = (text: string) => {
    ConfigureService.ImportAIProvider(text)
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }
  const importConfirm = useImportConfirm({ existing: providers ?? [], onImport: runImport })
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(importConfirm.requestImport).catch((err) => setImportError(String(err)))
  }

  useEffect(() => {
    refetch()
    refreshSeedLifecycle()
  }, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setKind(AIProviderKind.KindOpenAICompat)
    setBaseURL('')
    setModel('')
    setSecret('')
    setFormOpen(true)
    setError('')
  }

  const startEdit = (p: AIProvider) => {
    setEditingID(p.ID)
    setLabel(p.Label)
    setKind(p.Kind)
    setBaseURL(p.BaseURL)
    setModel(p.Model)
    setSecret('') // write-only -- never pre-fills
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      const saved = editingID
        ? await ConfigureService.UpdateAIProvider(editingID, label, kind, baseURL, model)
        : await ConfigureService.CreateAIProvider(label, kind, baseURL, model)
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
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }

  const resetToSeed = (id: string) => {
    ConfigureService.ResetAIProviderToSeed(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }
  const restoreExample = (id: string) => {
    ConfigureService.RestoreAIProvider(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }

  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<AIProvider>({
    entityType: 'AI provider',
    labelOf: (p) => p.Label,
    onConfirm: (p) => remove(p.ID),
  })

  const sortedProviders = useMemo(() => sortByUpdatedDesc(providers ?? [], (p) => p.UpdatedAt), [providers])

  const providerItems: InventoryItem[] = sortedProviders.map((p) => {
    const seedReset = describeSeedReset(p.Seed, seedRevisions[p.ID] ?? p.Seed.SeedRevision)
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
        { label: t('export'), onClick: () => exportProvider(p.ID, p.Label) },
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
    <PageContainer data-testid="configure-aiproviders">
      <Stack direction="horizontal" justify="end" align="center" className={styles.sectionHeading}>
        {/* Design-wave-1 fix #6: the Configure tab already names this
            section -- visually hidden (not removed) so the aria-labelledby
            wiring below and the a11y heading structure both stay intact. */}
        <VisuallyHidden>
          <Heading as="h2" variant="small" id="aiproviders-heading">{t('configureAIProviders.heading')}</Heading>
        </VisuallyHidden>
        <Stack direction="horizontal" gap="condensed">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-aiprovider-input"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <Button leadingVisual={UploadIcon} size="small" onClick={openImportPicker} data-testid="import-aiprovider">
            {t('import')}
          </Button>
          <RestoreExamplesButton items={restorable} onRestore={restoreExample} />
          <Button leadingVisual={PlusIcon} variant="primary" size="small" onClick={startCreate} data-testid="new-aiprovider">
            {t('configureAIProviders.newAiProvider')}
          </Button>
        </Stack>
      </Stack>
      {importError && (
        <Text as="p" size="small" className={styles.error} data-testid="import-aiprovider-error">{importError}</Text>
      )}

      {formOpen && (
        <PageContainer variant="narrow">
        <div className={styles.card}>
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>{t('configureAIProviders.label')}</FormControl.Label>
              <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block />
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('configureAIProviders.kind')}</FormControl.Label>
              <Select value={kind} onChange={(e) => setKind(e.target.value as AIProviderKind)} data-testid="aiprovider-kind">
                <Select.Option value={AIProviderKind.KindOpenAICompat}>{KIND_LABEL[AIProviderKind.KindOpenAICompat]}</Select.Option>
                <Select.Option value={AIProviderKind.KindAnthropic}>{KIND_LABEL[AIProviderKind.KindAnthropic]}</Select.Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('configureAIProviders.baseUrl')}</FormControl.Label>
              <FormControl.Caption>
                {kind === AIProviderKind.KindAnthropic
                  ? t('configureAIProviders.baseUrlCaptionAnthropic')
                  : t('configureAIProviders.baseUrlCaptionOther')}
              </FormControl.Caption>
              <TextInput value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder={t('configureAIProviders.baseUrlPlaceholder')} block />
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('configureAIProviders.model')}</FormControl.Label>
              <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('configureAIProviders.modelPlaceholder')} block />
            </FormControl>
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
        </div>
        </PageContainer>
      )}

      {providers === null && <Text as="p" className={styles.muted}>{t('loading')}</Text>}
      {providers !== null && viewMode === 'table' && providers.length > 0 && (
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
                    <IconButton icon={DownloadIcon} aria-label={t('configureAIProviders.exportAriaLabel', { label: p.Label })} size="small" variant="invisible" onClick={() => exportProvider(p.ID, p.Label)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureAIProviders.deleteAriaLabel', { label: p.Label })} size="small" variant="invisible" onClick={() => requestDelete(p)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      {providers !== null && viewMode === 'rows' && !(formOpen && providers.length === 0) && (
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
      {confirmDialog}
      {importConfirm.dialog}
    </PageContainer>
  )
}
