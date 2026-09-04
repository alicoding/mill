import { useEffect, useMemo, useState } from 'react'
import { deleteWithUndo } from './deleteWithUndo'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { LockIcon, PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ConfigureService, SecretService } from '../shared/bindings'
import type { Source as SecretSource } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import { refreshSecretSources, useConfigureEntityStore } from '../shared/configureEntityStore'
import { refreshSecretTitles } from '../shared/secretTitleCache'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
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
  const [kind, setKind] = useState<Kind>(Kind.KindEnv)
  // Per-source problems (a missing or locked CLI, an unreadable file):
  // the row states why a source lists nothing right now.
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const refetch = () => {
    void refreshSecretSources()
    void refreshSecretTitles()
    SecretService.SourceProblems()
      .then((p) => setProblems(Object.fromEntries(Object.entries(p ?? {}).flatMap(([id, v]) => (v ? [[id, v]] : [])))))
      .catch(() => setProblems({}))
  }
  const kindLabel = (k: Kind) => {
    if (k === Kind.KindBruno) return t('configureSecretSources.kindBruno')
    if (k === Kind.KindOnePassword) return t('configureSecretSources.kindOnePassword')
    if (k === Kind.KindBitwarden) return t('configureSecretSources.kindBitwarden')
    return t('configureSecretSources.kindDotenv')
  }
  const needsPath = kind === Kind.KindEnv || kind === Kind.KindBruno
  const pathCaption = kind === Kind.KindBruno ? t('configureSecretSources.pathCaptionBruno') : kind === Kind.KindOnePassword ? t('configureSecretSources.pathCaptionOnePassword') : kind === Kind.KindBitwarden ? t('configureSecretSources.pathCaptionBitwarden') : t('configureSecretSources.pathCaption')
  const pathPlaceholder = kind === Kind.KindBruno ? t('configureSecretSources.pathPlaceholderBruno') : kind === Kind.KindOnePassword ? t('configureSecretSources.pathPlaceholderOnePassword') : kind === Kind.KindBitwarden ? '' : t('configureSecretSources.pathPlaceholderDotenv')
  useEffect(() => { refetch() }, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setPath('')
    setKind(Kind.KindEnv)
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
    setKind(s.Kind)
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      if (editingID) await ConfigureService.UpdateSecretSource(editingID, label, kind, path)
      else await ConfigureService.CreateSecretSource(label, kind, path)
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string, label: string) => {
    void deleteWithUndo({ entity: 'secretsource', id, label, remove: () => ConfigureService.DeleteSecretSource(id), refetch: refetch, onError: (err) => setError(String(err)) })
  }
  const sorted = useMemo(() => sortByUpdatedDesc(sources ?? [], (s) => s.UpdatedAt), [sources])
  const items: InventoryItem[] = sorted.map((s) => ({
    id: s.ID,
    entity: 'secretsource',
    icon: ENTITY_ICON.secretsource,
    label: s.Label,
    updatedLabel: formatUpdated(s.UpdatedAt),
    builtIn: s.BuiltIn,
    updatedAt: s.UpdatedAt,
    createdAt: s.CreatedAt,
    description: [kindLabel(s.Kind), s.Path, problems[s.ID] ? `⚠ ${problems[s.ID]}` : ''].filter(Boolean).join(' · '),
    onOpen: () => startEdit(s),
    menuActions: [
      {
        label: t('delete'),
        onClick: () => remove(s.ID, s.Label),
        danger: true,
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
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} data-testid="secretsource-kind">
              <Select.Option value={Kind.KindEnv}>{t('configureSecretSources.kindDotenv')}</Select.Option>
              <Select.Option value={Kind.KindBruno}>{t('configureSecretSources.kindBruno')}</Select.Option>
              <Select.Option value={Kind.KindOnePassword}>{t('configureSecretSources.kindOnePassword')}</Select.Option>
              <Select.Option value={Kind.KindBitwarden}>{t('configureSecretSources.kindBitwarden')}</Select.Option>
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label>{needsPath ? t('configureSecretSources.path') : t('configureSecretSources.filter')}</FormControl.Label>
            <TextInput value={path} onChange={(e) => setPath(e.target.value)} block placeholder={pathPlaceholder} disabled={kind === Kind.KindBitwarden} data-testid="secretsource-path" />
            <FormControl.Caption>{pathCaption}</FormControl.Caption>
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
              { header: t('configureSecretSources.columns.kind'), id: 'kind', renderCell: (s) => kindLabel(s.Kind) },
              { header: t('configureSecretSources.columns.path'), id: 'path', width: 'growCollapse', minWidth: '160px', renderCell: (s) => <TruncatedCell text={s.Path} mono /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (s) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureSecretSources.editAriaLabel', { label: s.Label })} size="small" variant="invisible" onClick={() => startEdit(s)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureSecretSources.deleteAriaLabel', { label: s.Label })} size="small" variant="invisible" onClick={() => remove(s.ID, s.Label)} />
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
          listId="configure.secretsources"
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
    />
  )
}
