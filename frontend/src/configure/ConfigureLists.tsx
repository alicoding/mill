import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormControl, Heading, IconButton, Select, Stack, Text, TextInput, VisuallyHidden } from '@primer/react'
import { DownloadIcon, ListUnorderedIcon, PencilIcon, PlusIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import { RowStatus } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import type { Field, FieldTombstone } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { ListRowEditor } from './ListRowEditor'
import { ListRowImport } from './ListRowImport'
import { ListVersionsSection } from './ListVersionsSection'
import { downloadJSON } from '../shared/downloadJSON'
import { refreshLists, useConfigureEntityStore } from '../shared/configureEntityStore'
import { useUISignalStore } from '../shared/uiSignalStore'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { useImportConfirm } from '../shared/useImportConfirm'
import { describeSeedReset } from '../shared/seedLifecycle'
import { RestoreExamplesButton } from '../shared/RestoreExamplesButton'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

function typeLabelFor(t: (key: string) => string): Record<string, string> {
  return {
    [ConfigFieldType.TypeText]: t('configureLists.typeLabel.text'),
    [ConfigFieldType.TypeNumber]: t('configureLists.typeLabel.number'),
    [ConfigFieldType.TypeBoolean]: t('configureLists.typeLabel.boolean'),
  }
}

function emptyColumn(): Field {
  return {
    Key: '', Label: '', Type: ConfigFieldType.TypeText, Required: false, Default: '', Description: '',
    Options: null, Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
  }
}

// Configure's Lists section (docs/SPEC.md §3.5, docs/goals/0011-lists-
// maturation.md): CRUD over ConfigureService's typed Lists -- a
// key/label/type Column-schema editor mirroring ConfigureAttributes.
// tsx's own flat style (the goal's own instruction), plus a schema-
// generated row editor once a list's columns are saved. Both a
// list-lookup and a list-search workflow node resolve against these
// same Columns/Rows.
export function ConfigureLists() {
  const { t } = useTranslation('configure')
  const TYPE_LABEL = typeLabelFor(t)
  // Store-shared (refreshLists, shared/configureEntityStore.ts), the
  // same one-fetch-many-consumers pattern store.ts's workflows/requests
  // already use -- so App.tsx's mill-data-changed handler pushing a
  // live update lands here even when this tab is already open,
  // mounted, and idle (goal 0017 P1-1).
  const lists = useConfigureEntityStore((s) => s.lists)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [columns, setColumns] = useState<Field[]>([])
  // fieldTombstones/originalColumnKeys back docs/adr/0040 decision 3's
  // field-delete -- see ConfigureDecisions.tsx's identical state for
  // the full reasoning, applied here to Columns instead of Outputs.
  const [fieldTombstones, setFieldTombstones] = useState<FieldTombstone[]>([])
  const [originalColumnKeys, setOriginalColumnKeys] = useState<Set<string>>(new Set())
  const [pendingDeleteColumnIndex, setPendingDeleteColumnIndex] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [rowError, setRowError] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-lists-view-mode')
  // Seed lifecycle (docs/goals/0037) -- see CompositionView.tsx's
  // identical state for the full reasoning.
  const [seedRevisions, setSeedRevisions] = useState<Record<string, number | undefined>>({})
  const [restorable, setRestorable] = useState<List[]>([])

  const refreshSeedLifecycle = () => {
    ConfigureService.SeedRevisions().then((m) => setSeedRevisions(m ?? {})).catch(console.error)
    ConfigureService.RestorableLists().then((r) => setRestorable(r ?? [])).catch(console.error)
  }

  const refetch = () => {
    void refreshLists()
  }

  const exportList = (id: string, label: string) => {
    ConfigureService.ExportList(id)
      .then((json) => downloadJSON(`${label.trim() || 'list'}.json`, json))
      .catch((err) => setImportError(String(err)))
  }

  const openImportPicker = () => {
    setImportError(null)
    importInputRef.current?.click()
  }

  // A payload whose id matches a list already here updates it in place
  // instead of creating a new one -- confirmed first via importConfirm
  // below, naming the list it will replace.
  const runImport = (text: string) => {
    ConfigureService.ImportList(text)
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }
  const importConfirm = useImportConfirm({ existing: lists ?? [], onImport: runImport })
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

  const editingList = lists?.find((l) => l.ID === editingID) ?? null

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setDescription('')
    setColumns([emptyColumn()])
    setFieldTombstones([])
    setOriginalColumnKeys(new Set())
    setFormOpen(true)
    setError('')
    setRowError('')
  }

  // configure.new.lists (shared/configureCreateCommands.ts, goal 0071
  // G6): the palette's "New list" command sets this tab's own
  // configureCreateRequest signal, consumed here the same set-then-
  // consume shape composition/useCanvasCommandDispatch.ts's own
  // canvasCommandRequest already uses (shared/uiSignalStore.ts's own
  // header covers why this can't be atlasUpRequest's counter shape).
  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'lists') return
    startCreate()
    consumeConfigureCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate/consumeConfigureCreate deliberately excluded, same reasoning useCanvasCommandDispatch.ts's own identical effect documents
  }, [configureCreateRequest])

  const startEdit = (l: List) => {
    setEditingID(l.ID)
    setLabel(l.Label)
    setDescription(l.Description)
    setColumns(l.Columns && l.Columns.length > 0 ? l.Columns : [emptyColumn()])
    setFieldTombstones(l.FieldTombstones ?? [])
    setOriginalColumnKeys(new Set((l.Columns ?? []).map((c) => c.Key)))
    setFormOpen(true)
    setError('')
    setRowError('')
  }

  const updateColumn = (i: number, field: keyof Field, value: string) => {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)))
  }

  const toggleColumnDeprecated = (i: number, deprecated: boolean) => {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, deprecated } : c)))
  }

  // requestRemoveColumn is the column editor's remove action (docs/adr/
  // 0040 decision 3) -- see ConfigureDecisions.tsx's requestRemoveOutput
  // for the full reasoning, applied here to Columns instead of Outputs.
  const requestRemoveColumn = (i: number) => {
    if (!originalColumnKeys.has(columns[i].Key)) {
      setColumns((prev) => prev.filter((_, idx) => idx !== i))
      return
    }
    setPendingDeleteColumnIndex(i)
  }
  const confirmRemoveColumn = () => {
    if (pendingDeleteColumnIndex === null) return
    const removed = columns[pendingDeleteColumnIndex]
    setFieldTombstones((prev) => [...prev, { Key: removed.Key, Type: removed.Type }])
    setColumns((prev) => prev.filter((_, idx) => idx !== pendingDeleteColumnIndex))
    setPendingDeleteColumnIndex(null)
  }

  const saveSchema = async () => {
    setError('')
    try {
      // Drop any never-touched blank column row (the default starting
      // state for a new list, and what's left if the user deletes down
      // to nothing) -- same "an empty draft row isn't a real column"
      // filtering the old key/value editor's rowsToEntries applied, so
      // Save still works with zero columns declared, not just a full one.
      const nonEmptyColumns = columns.filter((c) => c.Key.trim() !== '')
      let saved: List
      if (editingID) {
        saved = await ConfigureService.UpdateList(editingID, label, description, nonEmptyColumns, fieldTombstones)
      } else {
        saved = await ConfigureService.CreateList(label, description, nonEmptyColumns)
      }
      setEditingID(saved.ID)
      // Re-sync the draft to the persisted truth (docs/adr/0040 decision
      // 3): a column just Saved is now genuinely persisted, so removing
      // it on the very next Save must tombstone it too -- the form
      // stays open after a Save (row editing follows), and only
      // startEdit re-loaded originalColumnKeys/fieldTombstones before.
      setColumns(saved.Columns && saved.Columns.length > 0 ? saved.Columns : [emptyColumn()])
      setFieldTombstones(saved.FieldTombstones ?? [])
      setOriginalColumnKeys(new Set((saved.Columns ?? []).map((c) => c.Key)))
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string) => {
    ConfigureService.DeleteList(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }

  // Reset-to-shipped-example / restore-deleted-example (docs/goals/0037
  // items 4/5).
  const resetToSeed = (id: string) => {
    ConfigureService.ResetListToSeed(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }
  const restoreExample = (id: string) => {
    ConfigureService.RestoreList(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }

  // Table-view direct-wiring half of the Button-semantics convention
  // (.claude/rules/frontend.md) -- see ConfigureRequests.tsx's
  // identical comment.
  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<List>({
    entityType: 'list',
    labelOf: (l) => l.Label,
    onConfirm: (l) => remove(l.ID),
  })

  const addRow = async () => {
    if (!editingID) return
    setRowError('')
    const values: Record<string, string> = {}
    for (const c of columns) values[c.Key] = ''
    try {
      await ConfigureService.AddListRow(editingID, values)
      refetch()
    } catch (err) {
      setRowError(String(err))
    }
  }

  const updateRow = async (rowID: string, values: Record<string, string>, status: RowStatus) => {
    if (!editingID) return
    setRowError('')
    try {
      await ConfigureService.UpdateListRow(editingID, rowID, values, status)
      refetch()
    } catch (err) {
      setRowError(String(err))
    }
  }

  const deleteRow = async (rowID: string) => {
    if (!editingID) return
    setRowError('')
    try {
      await ConfigureService.DeleteListRow(editingID, rowID)
      refetch()
    } catch (err) {
      setRowError(String(err))
    }
  }

  // Last-updated-first, applied once so both view modes render the
  // same order (docs/SPEC.md §3.8's InventoryList entry).
  const sortedLists = useMemo(() => sortByUpdatedDesc(lists ?? [], (l) => l.UpdatedAt), [lists])

  const listItems: InventoryItem[] = sortedLists.map((l) => {
    const seedReset = describeSeedReset(l.Seed, seedRevisions[l.ID] ?? l.Seed.SeedRevision)
    return {
      id: l.ID,
      entity: 'list',
      icon: ENTITY_ICON.list,
      label: l.Label,
      updatedLabel: formatUpdated(l.UpdatedAt),
      // No !l.BuiltIn guard on Delete -- a seeded example is ordinary and
      // fully editable/deletable (docs/SPEC.md §2.2's Update note), same
      // as ConfigureRequests.tsx's identical badge.
      labelBadges: l.BuiltIn ? <StatusStamp variant="identity">{t('builtIn')}</StatusStamp> : undefined,
      description: t('configureLists.columnsRowsSummary', { columns: (l.Columns ?? []).length, rows: (l.Rows ?? []).length }),
      onOpen: () => startEdit(l),
      menuActions: [
        { label: t('export'), onClick: () => exportList(l.ID, l.Label) },
        // Reset-to-shipped-example (docs/goals/0037 item 4) -- hidden
        // (not shown-disabled) when already current, same reasoning
        // CompositionView.tsx's identical wiring documents.
        ...(l.BuiltIn && !seedReset.disabled ? [{ label: seedReset.label, onClick: () => resetToSeed(l.ID) }] : []),
        {
          label: t('delete'),
          onClick: () => remove(l.ID),
          danger: true,
          confirm: { title: t('configureLists.deleteConfirmTitle'), body: t('configureLists.deleteConfirmBody', { label: l.Label }) },
        },
      ],
    }
  })

  return (
    <PageContainer data-testid="configure-lists">
      <Stack direction="horizontal" justify="end" align="center" className={styles.sectionHeading}>
        {/* Design-wave-1 fix #6: the Configure tab already names this
            section -- visually hidden (not removed) so the aria-labelledby
            wiring below and the a11y heading structure both stay intact. */}
        <VisuallyHidden>
          <Heading as="h2" variant="small" id="lists-heading">{t('configureLists.heading')}</Heading>
        </VisuallyHidden>
        <Stack direction="horizontal" gap="condensed">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-list-input"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <Button leadingVisual={UploadIcon} size="small" onClick={openImportPicker} data-testid="import-list">
            {t('import')}
          </Button>
          <RestoreExamplesButton items={restorable} onRestore={restoreExample} />
          <Button leadingVisual={PlusIcon} variant="primary" size="small" onClick={startCreate} data-testid="new-list">
            {t('configureLists.newList')}
          </Button>
        </Stack>
      </Stack>
      {importError && (
        <Text as="p" size="small" className={styles.error} data-testid="import-list-error">{importError}</Text>
      )}

      {formOpen && (
        <PageContainer variant="narrow">
          <div className={styles.card}>
            <Stack direction="vertical" gap="condensed">
              <FormControl>
                <FormControl.Label>{t('configureLists.label')}</FormControl.Label>
                <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block data-testid="list-label" />
              </FormControl>
              <FormControl>
                <FormControl.Label>{t('configureLists.description')}</FormControl.Label>
                <TextInput value={description} onChange={(e) => setDescription(e.target.value)} block />
              </FormControl>

              <Text size="small" weight="semibold">{t('configureLists.columns')}</Text>
              {columns.map((c, i) => (
                <Stack key={i} direction="horizontal" gap="condensed" align="center" className={c.deprecated ? styles.muted : undefined} data-testid="list-column-row">
                  <TextInput placeholder={t('configureLists.keyPlaceholder')} value={c.Key} onChange={(e) => updateColumn(i, 'Key', e.target.value)} data-testid="list-column-key" />
                  <TextInput placeholder={t('configureLists.labelPlaceholder')} value={c.Label} onChange={(e) => updateColumn(i, 'Label', e.target.value)} />
                  <Select value={c.Type} onChange={(e) => updateColumn(i, 'Type', e.target.value)} data-testid="list-column-type">
                    {Object.entries(TYPE_LABEL).map(([v, l]) => (
                      <Select.Option key={v} value={v}>{l}</Select.Option>
                    ))}
                  </Select>
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Checkbox
                      checked={c.deprecated ?? false}
                      aria-label={t('configureLists.deprecatedCheckboxAriaLabel')}
                      onChange={(e) => toggleColumnDeprecated(i, e.target.checked)}
                    />
                    <Text size="small" className={styles.muted}>{t('configureLists.deprecatedLabel')}</Text>
                  </Stack>
                  <IconButton
                    icon={TrashIcon}
                    aria-label={t('configureLists.removeColumnAriaLabel')}
                    size="small"
                    variant="invisible"
                    onClick={() => requestRemoveColumn(i)}
                  />
                </Stack>
              ))}
              {pendingDeleteColumnIndex !== null && (
                <ConfirmDialog
                  title={t('configureLists.deleteFieldConfirmTitle')}
                  body={t('configureLists.deleteFieldConfirmBody', { key: columns[pendingDeleteColumnIndex].Key })}
                  confirmLabel={t('delete')}
                  cancelLabel={t('configureLists.close')}
                  onCancel={() => setPendingDeleteColumnIndex(null)}
                  onConfirm={confirmRemoveColumn}
                />
              )}
              <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => setColumns((prev) => [...prev, emptyColumn()])}>
                {t('configureLists.addColumn')}
              </Button>

              {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
              <Stack direction="horizontal" gap="condensed">
                <Button variant="primary" size="small" onClick={saveSchema} data-testid="save-list">{t('configureLists.saveList')}</Button>
                <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('configureLists.close')}</Button>
              </Stack>
            </Stack>
          </div>

          {editingID && editingList && (
            <div className={styles.card}>
              <ListVersionsSection list={editingList} onPublished={refetch} />
            </div>
          )}

          {editingID && editingList && (
            <div className={styles.card} data-testid="list-rows-editor">
              <Stack direction="vertical" gap="condensed">
                <Stack direction="horizontal" justify="space-between" align="center">
                  <Text size="small" weight="semibold">{t('configureLists.rows')}</Text>
                  {(editingList.Columns ?? []).length > 0 && (
                    <ListRowImport listId={editingID} columns={editingList.Columns ?? []} onImported={refetch} />
                  )}
                </Stack>
                {(editingList.Columns ?? []).length === 0 ? (
                  <Text as="p" size="small" className={styles.muted}>{t('configureLists.addColumnFirst')}</Text>
                ) : (
                  <>
                    {(editingList.Rows ?? []).map((r) => (
                      <ListRowEditor
                        key={r.ID}
                        row={r}
                        columns={editingList.Columns ?? []}
                        onSave={(values, status) => updateRow(r.ID, values, status)}
                        onDelete={() => deleteRow(r.ID)}
                      />
                    ))}
                    <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={addRow} data-testid="add-list-row">
                      {t('configureLists.addRow')}
                    </Button>
                  </>
                )}
                {rowError && <Text as="p" size="small" className={styles.error}>{rowError}</Text>}
              </Stack>
            </div>
          )}
        </PageContainer>
      )}

      {lists === null && <Text as="p" className={styles.muted}>{t('loading')}</Text>}
      {lists !== null && viewMode === 'table' && lists.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-lists">
          <DataTable
            aria-labelledby="lists-heading"
            data={sortedLists.map((l) => ({ ...l, id: l.ID }))}
            columns={[
              { header: t('configureLists.tableColumns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureLists.tableColumns.columns'), id: 'columns', width: 'auto', renderCell: (l) => (l.Columns ?? []).length },
              { header: t('configureLists.tableColumns.rows'), id: 'rows', width: 'auto', renderCell: (l) => (l.Rows ?? []).length },
              { header: t('configureLists.tableColumns.id'), field: 'ID' },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (l) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureLists.editAriaLabel', { label: l.Label })} size="small" variant="invisible" onClick={() => startEdit(l)} />
                    <IconButton icon={DownloadIcon} aria-label={t('configureLists.exportAriaLabel', { label: l.Label })} size="small" variant="invisible" onClick={() => exportList(l.ID, l.Label)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureLists.deleteAriaLabel', { label: l.Label })} size="small" variant="invisible" onClick={() => requestDelete(l)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      {lists !== null && viewMode === 'rows' && !(formOpen && lists.length === 0) && (
        <InventoryList
          items={listItems}
          searchPlaceholder={t('configureLists.searchPlaceholder')}
          emptyState={{
            icon: ListUnorderedIcon,
            heading: t('configureLists.emptyHeading'),
            description: t('configureLists.emptyDescription'),
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>{t('configureLists.newList')}</Button>,
          }}
        />
      )}
      {confirmDialog}
      {importConfirm.dialog}
    </PageContainer>
  )
}
