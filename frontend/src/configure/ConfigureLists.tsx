import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Label, Stack, Text, TextInput } from '@primer/react'
import { DownloadIcon, ListUnorderedIcon, PlusIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import { downloadJSON } from '../shared/downloadJSON'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

interface EntryRow {
  key: string
  value: string
}

function entriesToRows(entries: { [key: string]: string | undefined } | null | undefined): EntryRow[] {
  return Object.entries(entries ?? {}).map(([key, value]) => ({ key, value: value ?? '' }))
}

function rowsToEntries(rows: EntryRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (r.key.trim() !== '') out[r.key] = r.value
  }
  return out
}

// Configure's Lists section (docs/SPEC.md §3.5): CRUD over
// ConfigureService's Lists, each a named key/value lookup table a
// workflow's list-lookup node can resolve against (composition.go's
// SetListLookup seam).
//
// Rows are the DEFAULT view (docs/goals/0007): InventoryList's shared
// row replaces the old hand-rolled card branch. Row click edits
// (today's only real per-row interaction, same as before this goal);
// Export/Delete move into the trailing ⋯ menu.
export function ConfigureLists() {
  const [lists, setLists] = useState<List[] | null>(null)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [rows, setRows] = useState<EntryRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-lists-view-mode')

  const refetch = () => {
    ConfigureService.Lists().then((list) => setLists(list ?? [])).catch(console.error)
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

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text()
      .then((text) => ConfigureService.ImportList(text))
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }

  useEffect(refetch, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setRows([{ key: '', value: '' }])
    setFormOpen(true)
    setError('')
  }

  const startEdit = (l: List) => {
    setEditingID(l.ID)
    setLabel(l.Label)
    setRows(entriesToRows(l.Entries).length > 0 ? entriesToRows(l.Entries) : [{ key: '', value: '' }])
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      const entries = rowsToEntries(rows)
      if (editingID) {
        await ConfigureService.UpdateList(editingID, label, entries)
      } else {
        await ConfigureService.CreateList(label, entries)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string) => {
    ConfigureService.DeleteList(id).then(refetch).catch(console.error)
  }

  // Table-view direct-wiring half of the Button-semantics convention
  // (.claude/rules/frontend.md) -- see ConfigureRequests.tsx's
  // identical comment.
  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<List>({
    entityType: 'list',
    labelOf: (l) => l.Label,
    onConfirm: (l) => remove(l.ID),
  })

  const updateRow = (i: number, field: 'key' | 'value', value: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  // Last-updated-first, applied once so both view modes render the
  // same order (docs/SPEC.md §3.8's InventoryList entry).
  const sortedLists = useMemo(() => sortByUpdatedDesc(lists ?? [], (l) => l.UpdatedAt), [lists])

  const listItems: InventoryItem[] = sortedLists.map((l) => ({
    id: l.ID,
    entity: 'list',
    icon: ENTITY_ICON.list,
    label: l.Label,
    updatedLabel: formatUpdated(l.UpdatedAt),
    // No !l.BuiltIn guard on Delete -- a seeded example is ordinary and
    // fully editable/deletable (docs/SPEC.md §2.2's Update note), same
    // as ConfigureRequests.tsx's identical badge.
    labelBadges: l.BuiltIn ? <Label variant="secondary" size="small">built-in</Label> : undefined,
    description: `${Object.keys(l.Entries ?? {}).length} entries`,
    onOpen: () => startEdit(l),
    menuActions: [
      { label: 'Export', onClick: () => exportList(l.ID, l.Label) },
      {
        label: 'Delete',
        onClick: () => remove(l.ID),
        danger: true,
        confirm: { title: 'Delete list?', body: `This permanently deletes "${l.Label}". This cannot be undone.` },
      },
    ],
  }))

  return (
    <PageContainer data-testid="configure-lists">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small" id="lists-heading">Lists</Heading>
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
            Import
          </Button>
          <Button leadingVisual={PlusIcon} variant="primary" size="small" onClick={startCreate} data-testid="new-list">
            New list
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
              <FormControl.Label>Label</FormControl.Label>
              <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block />
            </FormControl>
            <Text size="small" weight="semibold">Entries</Text>
            {rows.map((row, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput placeholder="key" value={row.key} onChange={(e) => updateRow(i, 'key', e.target.value)} />
                <TextInput placeholder="value" value={row.value} onChange={(e) => updateRow(i, 'value', e.target.value)} />
                <IconButton
                  icon={TrashIcon}
                  aria-label="Remove row"
                  size="small"
                  variant="invisible"
                  onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </Stack>
            ))}
            <Button size="small" variant="invisible" onClick={() => setRows((prev) => [...prev, { key: '', value: '' }])}>
              Add row
            </Button>
            {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
            <Stack direction="horizontal" gap="condensed">
              <Button variant="primary" size="small" onClick={save}>Save list</Button>
              <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>Cancel</Button>
            </Stack>
          </Stack>
        </div>
        </PageContainer>
      )}

      {lists === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {lists !== null && viewMode === 'table' && lists.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-lists">
          <DataTable
            aria-labelledby="lists-heading"
            data={sortedLists.map((l) => ({ ...l, id: l.ID }))}
            columns={[
              { header: 'Label', field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: 'Entries', id: 'entries', width: 'auto', renderCell: (l) => Object.keys(l.Entries ?? {}).length },
              { header: 'ID', field: 'ID' },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (l) => (
                  <Stack direction="horizontal" gap="condensed">
                    <Button size="small" variant="invisible" onClick={() => startEdit(l)}>Edit</Button>
                    <IconButton icon={DownloadIcon} aria-label={`Export ${l.Label}`} size="small" variant="invisible" onClick={() => exportList(l.ID, l.Label)} />
                    <IconButton icon={TrashIcon} aria-label={`Delete ${l.Label}`} size="small" variant="invisible" onClick={() => requestDelete(l)} />
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
          searchPlaceholder="Search lists…"
          emptyState={{
            icon: ListUnorderedIcon,
            heading: 'No lists yet',
            description: "A reusable key/value lookup table a workflow's List node can resolve against.",
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>New list</Button>,
          }}
        />
      )}
      {confirmDialog}
    </PageContainer>
  )
}
