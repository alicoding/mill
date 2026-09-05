import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormControl, IconButton, Stack, Text, TextInput } from '@primer/react'
import { PencilIcon, PlusIcon, TrashIcon, ArrowSwitchIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { CompositionService, ConfigureService } from '../shared/bindings'
import type { Profile } from '../../bindings/github.com/alicoding/mill/internal/domain/conversionprofile/models'
import type { RuleSet } from '../../bindings/github.com/alicoding/mill/internal/adapters/markdown/models'
import { refreshConversionProfiles, useConfigureEntityStore } from '../shared/configureEntityStore'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { entityRowContext } from '../shared/entityRowCommands'
import { useEntityActionError } from '../shared/entityActionErrorStore'
import { runCommand } from '../shared/commands'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useUISignalStore } from '../shared/uiSignalStore'
import { ConfigureEntityPage } from './ConfigureEntityPage'
import { ConversionSamplePreview } from './ConversionSamplePreview'
import styles from '../shared/ListCard.module.css'
import { background } from '../shared/background'

// Conversion profiles (goal 0305 slice 6): which source-specific rule
// sets an HTML-to-Markdown conversion applies -- a named option set,
// never an engine switch. Three seeded examples; the sample preview
// below the list runs one pasted sample through every profile so the
// difference is visible before a step is configured.
export function ConfigureConversionProfiles() {
  const { t } = useTranslation('configure')
  // A row action's refusal, recorded by the command that met it
  // (shared/entityActionErrorStore.ts, goal 0346).
  const rowActionError = useEntityActionError('conversionprofile')
  const profiles = useConfigureEntityStore((s) => s.conversionProfiles)
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([])
  const [viewMode, setViewMode] = useViewMode('mill-view-conversionprofiles')
  const [formOpen, setFormOpen] = useState(false)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [error, setError] = useState('')

  const refetch = () => { void refreshConversionProfiles() }
  useEffect(() => {
    refetch()
    void background(CompositionService.ConversionRuleSets().then((r) => setRuleSets(r ?? [])), 'configureConversionProfiles.conversionRuleSets')
  }, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setDescription('')
    setChosen(ruleSets.map((r) => r.id))
    setFormOpen(true)
    setError('')
  }
  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'conversionprofiles') return
    startCreate()
    consumeConfigureCreate()
  }, [configureCreateRequest])

  const startEdit = (p: Profile) => {
    setEditingID(p.ID)
    setLabel(p.Label)
    setDescription(p.Description)
    setChosen(p.RuleSets ?? [])
    setFormOpen(true)
    setError('')
  }
  // goal 0312: a reference field's Open in Configure lands on THIS
  // entity's editor, once its list has loaded.
  const configureEditRequest = useUISignalStore((s) => s.configureEditRequest)
  const consumeConfigureEdit = useUISignalStore((s) => s.consumeConfigureEdit)
  useEffect(() => {
    if (configureEditRequest?.tab !== 'conversionprofiles' || profiles === null) return
    const target = profiles.find((x) => x.ID === configureEditRequest.id)
    consumeConfigureEdit()
    if (target) startEdit(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit/consumeConfigureEdit deliberately excluded, same reasoning as the create effect above
  }, [configureEditRequest, profiles])
  const toggle = (id: string, on: boolean) => setChosen((prev) => (on ? [...prev.filter((x) => x !== id), id] : prev.filter((x) => x !== id)))

  const save = async () => {
    setError('')
    try {
      if (editingID) await ConfigureService.UpdateConversionProfile(editingID, label, description, chosen)
      else await ConfigureService.CreateConversionProfile(label, description, chosen)
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }
  const ruleLabel = (id: string) => ruleSets.find((r) => r.id === id)?.label ?? id
  const rulesText = (p: Profile) => ((p.RuleSets ?? []).length > 0 ? (p.RuleSets ?? []).map(ruleLabel).join(', ') : t('configureConversionProfiles.noRules'))
  const sorted = useMemo(() => sortByUpdatedDesc(profiles ?? [], (p) => p.UpdatedAt), [profiles])
  const items: InventoryItem[] = sorted.map((p) => ({
    id: p.ID,
    entity: 'conversionprofile',
    icon: ENTITY_ICON.conversionprofile,
    label: p.Label,
    updatedLabel: formatUpdated(p.UpdatedAt),
    builtIn: p.BuiltIn,
    updatedAt: p.UpdatedAt,
    createdAt: p.CreatedAt,
    description: rulesText(p),
    onOpen: () => startEdit(p),
    menuActions: [
      { commandId: 'configure.conversionprofile.delete', ctx: entityRowContext('conversionprofile', p.ID), danger: true },
    ],
  }))

  return (
    <ConfigureEntityPage
      pageTestId="configure-conversionprofiles"
      headingId="conversionprofiles-heading"
      headingText={t('configureConversionProfiles.heading')}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      importErrorNode={rowActionError && (
        <Text as="p" size="small" className={styles.error} data-testid="conversionprofile-row-error">{rowActionError}</Text>
      )}
      primaryLabel={t('configureConversionProfiles.newProfile')}
      primaryTestId="new-conversionprofile"
      onPrimary={startCreate}
      formOpen={formOpen}
      formContent={(
        <Stack direction="vertical" gap="condensed">
          <FormControl>
            <FormControl.Label>{t('configureConversionProfiles.label')}</FormControl.Label>
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block data-testid="conversionprofile-label" />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('configureConversionProfiles.description')}</FormControl.Label>
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} block data-testid="conversionprofile-description" />
          </FormControl>
          <Text size="small" weight="semibold">{t('configureConversionProfiles.ruleSets')}</Text>
          {ruleSets.map((r) => (
            <FormControl key={r.id}>
              <Checkbox checked={chosen.includes(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} data-testid={`conversionprofile-rule-${r.id}`} />
              <FormControl.Label>{r.label}</FormControl.Label>
              <FormControl.Caption>{r.description}</FormControl.Caption>
            </FormControl>
          ))}
          {error && <Text as="p" size="small" className={styles.error} data-testid="conversionprofile-error">{error}</Text>}
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" size="small" onClick={save} data-testid="save-conversionprofile">{t('configureConversionProfiles.saveProfile')}</Button>
            <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
          </Stack>
        </Stack>
      )}
      loading={profiles === null}
      showTable={profiles !== null && viewMode === 'table' && profiles.length > 0}
      tableContent={(
        <ResizableTableContainer storageKey="mill-cols-conversionprofiles">
          <DataTable
            aria-labelledby="conversionprofiles-heading"
            data={sorted.map((p) => ({ ...p, id: p.ID }))}
            columns={[
              { header: t('configureConversionProfiles.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureConversionProfiles.columns.ruleSets'), id: 'rules', width: 'growCollapse', minWidth: '160px', renderCell: (p) => <TruncatedCell text={rulesText(p)} /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (p) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureConversionProfiles.editAriaLabel', { label: p.Label })} size="small" variant="invisible" onClick={() => startEdit(p)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureConversionProfiles.deleteAriaLabel', { label: p.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.conversionprofile.delete', entityRowContext('conversionprofile', p.ID))} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      showRows={profiles !== null && viewMode === 'rows' && !(formOpen && profiles.length === 0)}
      rowsContent={(
        <Stack direction="vertical" gap="normal">
          <InventoryList
            listId="configure.conversionprofiles"
            items={items}
            searchPlaceholder={t('configureConversionProfiles.searchPlaceholder')}
            emptyState={{
              icon: ArrowSwitchIcon,
              heading: t('configureConversionProfiles.emptyHeading'),
              description: t('configureConversionProfiles.emptyDescription'),
              action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>{t('configureConversionProfiles.newProfile')}</Button>,
            }}
          />
          <ConversionSamplePreview profiles={sorted} />
        </Stack>
      )}
    />
  )
}
