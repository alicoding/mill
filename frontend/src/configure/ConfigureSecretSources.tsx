import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { LockIcon, PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { Source as SecretSource } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import { refreshSecretSources, useConfigureEntityStore } from '../shared/configureEntityStore'
import { refreshSecretTitles } from '../shared/secretTitleCache'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { useUISignalStore } from '../shared/uiSignalStore'
import { ConfigureEntityPage } from './ConfigureEntityPage'
import styles from '../shared/ListCard.module.css'

// Secret sources (ADR-0050): a store on this machine that Mill reads
// secrets through -- a dotenv file today -- whose keys then appear in
// every secret picker beside the vault's own entries. No import/export
// (a source names a path on this machine) and no seeds (enabling a
// source is always the user's act), so the shared page renders without
// those controls.
export function ConfigureSecretSources() {
  const { t } = useTranslation('configure')
  const sources = useConfigureEntityStore((s) => s.secretSources)
  const [viewMode, setViewMode] = useViewMode('mill-view-secretsources')
  const [formOpen, setFormOpen] = useState(false)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState('')

  const refetch = () => { void refreshSecretSources(); void refreshSecretTitles() }
  useEffect(() => { refetch() }, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setPath('')
    setFormOpen(true)
    setError('')
  }
  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'secretsources') return
    startCreate()
    consumeConfigureCreate()
  }, [configureCreateRequest])

  const startEdit = (s: SecretSource) => {
    setEditingID(s.ID)
    setLabel(s.Label)
    setPath(s.Path)
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      if (editingID) await ConfigureService.UpdateSecretSource(editingID, label, Kind.KindEnv, path)
      else await ConfigureService.CreateSecretSource(label, Kind.KindEnv, path)
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string) => {
    ConfigureService.DeleteSecretSource(id).then(refetch).catch((err) => setError(String(err)))
  }
  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<SecretSource>({
    entityType: 'secret source',
    labelOf: (s) => s.Label,
    onConfirm: (s) => remove(s.ID),
  })

  const sorted = useMemo(() => sortByUpdatedDesc(sources ?? [], (s) => s.UpdatedAt), [sources])
  const items: InventoryItem[] = sorted.map((s) => ({
    id: s.ID,
    entity: 'secretsource',
    icon: ENTITY_ICON.secretsource,
    label: s.Label,
    updatedLabel: formatUpdated(s.UpdatedAt),
    description: `${t('configureSecretSources.kindDotenv')} · ${s.Path}`,
    onOpen: () => startEdit(s),
    menuActions: [
      {
        label: t('delete'),
        onClick: () => remove(s.ID),
        danger: true,
        confirm: { title: t('configureSecretSources.deleteConfirmTitle'), body: t('configureSecretSources.deleteConfirmBody', { label: s.Label }) },
      },
    ],
  }))

  return (
    <ConfigureEntityPage
      pageTestId="configure-secretsources"
      headingId="secretsources-heading"
      headingText={t('configureSecretSources.heading')}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      primaryLabel={t('configureSecretSources.newSource')}
      primaryTestId="new-secretsource"
      onPrimary={startCreate}
      formOpen={formOpen}
      formContent={(
        <Stack direction="vertical" gap="condensed">
          <FormControl>
            <FormControl.Label>{t('configureSecretSources.label')}</FormControl.Label>
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block data-testid="secretsource-label" />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('configureSecretSources.kind')}</FormControl.Label>
            <Select value={Kind.KindEnv} onChange={() => undefined} data-testid="secretsource-kind">
              <Select.Option value={Kind.KindEnv}>{t('configureSecretSources.kindDotenv')}</Select.Option>
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('configureSecretSources.path')}</FormControl.Label>
            <TextInput value={path} onChange={(e) => setPath(e.target.value)} block placeholder="/path/to/project/.env" data-testid="secretsource-path" />
            <FormControl.Caption>{t('configureSecretSources.pathCaption')}</FormControl.Caption>
          </FormControl>
          {error && <Text as="p" size="small" className={styles.error} data-testid="secretsource-error">{error}</Text>}
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" size="small" onClick={save} data-testid="save-secretsource">{t('configureSecretSources.saveSource')}</Button>
            <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
          </Stack>
        </Stack>
      )}
      loading={sources === null}
      showTable={sources !== null && viewMode === 'table' && sources.length > 0}
      tableContent={(
        <ResizableTableContainer storageKey="mill-cols-secretsources">
          <DataTable
            aria-labelledby="secretsources-heading"
            data={sorted.map((s) => ({ ...s, id: s.ID }))}
            columns={[
              { header: t('configureSecretSources.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureSecretSources.columns.kind'), id: 'kind', renderCell: () => t('configureSecretSources.kindDotenv') },
              { header: t('configureSecretSources.columns.path'), id: 'path', width: 'growCollapse', minWidth: '160px', renderCell: (s) => <TruncatedCell text={s.Path} mono /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (s) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureSecretSources.editAriaLabel', { label: s.Label })} size="small" variant="invisible" onClick={() => startEdit(s)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureSecretSources.deleteAriaLabel', { label: s.Label })} size="small" variant="invisible" onClick={() => requestDelete(s)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      showRows={sources !== null && viewMode === 'rows' && !(formOpen && sources.length === 0)}
      rowsContent={(
        <InventoryList
          items={items}
          searchPlaceholder={t('configureSecretSources.searchPlaceholder')}
          emptyState={{
            icon: LockIcon,
            heading: t('configureSecretSources.emptyHeading'),
            description: t('configureSecretSources.emptyDescription'),
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>{t('configureSecretSources.newSource')}</Button>,
          }}
        />
      )}
      confirmDialog={confirmDialog}
    />
  )
}
