import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteWithUndo } from './deleteWithUndo'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, Heading, IconButton, Stack, Text, TextInput, VisuallyHidden } from '@primer/react'
import { DownloadIcon, ListUnorderedIcon, PencilIcon, PlusIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import { ListGridGlide } from '../shared/ListGridGlide'
import type { GridColumn, GridRow } from '../shared/listGridTypes'
import { ListRowImport } from './ListRowImport'
import { NewListFromFile } from './NewListFromFile'
import { ListVersionsSection } from './ListVersionsSection'
import { downloadJSON } from '../shared/downloadJSON'
import { refreshLists, useConfigureEntityStore } from '../shared/configureEntityStore'
import { useUISignalStore } from '../shared/uiSignalStore'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useImportConfirm } from '../shared/useImportConfirm'
import { describeSeedReset } from '../shared/seedLifecycle'
import { RestoreExamplesButton } from '../shared/RestoreExamplesButton'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'
import { background } from '../shared/background'

// Configure's Lists section (docs/SPEC.md §3.5): CRUD over
// ConfigureService's typed Lists. Schema AND data edit in the ONE
// shared grid (shared/ListGridGlide, goal 0136 / ADR-0049) -- the
// header menu is the columns editor, cells are the rows, identical to
// the Atlas table face. Both a list-lookup and a list-search workflow node resolve
// against these same Columns/Rows.
export function ConfigureLists() {
  const { t } = useTranslation('configure')
  // Store-shared (refreshLists, shared/configureEntityStore.ts), the
  // same one-fetch-many-consumers pattern store.ts's workflows/requests
  // already use -- so App.tsx's mill-data-changed handler pushing a
  // live update lands here even when this tab is already open,
  // mounted, and idle (goal 0017 P1-1).
  const lists = useConfigureEntityStore((s) => s.lists)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-lists-view-mode')
  // Seed lifecycle (docs/goals/0037) -- see CompositionView.tsx's
  // identical state for the full reasoning.
  const [seedRevisions, setSeedRevisions] = useState<Record<string, number | undefined>>({})
  const [restorable, setRestorable] = useState<List[]>([])

  const refreshSeedLifecycle = () => {
    void background(ConfigureService.SeedRevisions().then((m) => setSeedRevisions(m ?? {})), 'configureLists.seedRevisions')
    void background(ConfigureService.RestorableLists().then((r) => setRestorable(r ?? [])), 'configureLists.restorableLists')
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
    setFormOpen(true)
    setError('')
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
    setFormOpen(true)
    setError('')
  }
  // goal 0312: a reference field's Open in Configure lands on THIS
  // entity's editor, once its list has loaded.
  const configureEditRequest = useUISignalStore((s) => s.configureEditRequest)
  const consumeConfigureEdit = useUISignalStore((s) => s.consumeConfigureEdit)
  useEffect(() => {
    if (configureEditRequest?.tab !== 'lists' || lists === null) return
    const target = lists.find((x) => x.ID === configureEditRequest.id)
    consumeConfigureEdit()
    if (target) startEdit(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit/consumeConfigureEdit deliberately excluded, same reasoning as the create effect above
  }, [configureEditRequest, lists])

  // Save persists label/description; the grid below owns columns and
  // rows through the List's own methods (its read-modify-write always
  // reloads the record first, so the two never fight).
  const saveMeta = async () => {
    setError('')
    try {
      let saved: List
      if (editingID) {
        saved = await ConfigureService.UpdateList(editingID, label, description, editingList?.Columns ?? [], null)
      } else {
        saved = await ConfigureService.CreateList(label, description, [])
      }
      setEditingID(saved.ID)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string, label: string) => {
    void deleteWithUndo({ entity: 'list', id, label, remove: () => ConfigureService.DeleteList(id), refetch: () => {
      refetch()
      refreshSeedLifecycle()
    }, onError: (err) => setImportError(String(err)) })
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
      builtIn: l.BuiltIn,
      updatedAt: l.UpdatedAt,
      createdAt: l.CreatedAt,
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
          onClick: () => remove(l.ID, l.Label),
          danger: true,
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
          <NewListFromFile onCreated={(l) => { refetch(); startEdit(l) }} />
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

              {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
              <Stack direction="horizontal" gap="condensed">
                <Button variant="primary" size="small" onClick={saveMeta} data-testid="save-list">{t('configureLists.saveList')}</Button>
                <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('configureLists.close')}</Button>
              </Stack>
            </Stack>
          </div>

          {editingID && editingList && (
            <div className={styles.card} data-testid="list-rows-editor">
              <Stack direction="vertical" gap="condensed">
                {(editingList.Columns ?? []).length > 0 && (
                  <Stack direction="horizontal" justify="end" align="center">
                    <ListRowImport listId={editingID} columns={editingList.Columns ?? []} onImported={refetch} />
                  </Stack>
                )}
                <ListGridGlide
                  listID={editingID}
                  columns={(editingList.Columns ?? []).map((c): GridColumn => ({
                    Key: c.Key, Label: c.Label, Type: c.Type,
                    Options: c.Options, OptionColors: c.OptionColors ?? null,
                    Deprecated: c.deprecated ?? false,
                  }))}
                  rows={(editingList.Rows ?? []).map((r): GridRow => ({ ID: r.ID, Status: r.Status, Values: r.Values }))}
                />
              </Stack>
            </div>
          )}

          {/* Publishing history sits under the list's own rows, never
              between what the list IS and what it holds (goal 0327's
              tiers). */}
          {editingID && editingList && (
            <div className={styles.card}>
              <ListVersionsSection list={editingList} onPublished={refetch} />
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
                    <IconButton icon={TrashIcon} aria-label={t('configureLists.deleteAriaLabel', { label: l.Label })} size="small" variant="invisible" onClick={() => remove(l.ID, l.Label)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      {lists !== null && viewMode === 'rows' && !(formOpen && lists.length === 0) && (
        <InventoryList
          listId="configure.lists"
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
      {importConfirm.dialog}
    </PageContainer>
  )
}
