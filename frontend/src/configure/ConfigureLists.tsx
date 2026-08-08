import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import styles from '../shared/ListCard.module.css'

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
export function ConfigureLists() {
  const [lists, setLists] = useState<List[] | null>(null)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [rows, setRows] = useState<EntryRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')

  const refetch = () => {
    ConfigureService.Lists().then((list) => setLists(list ?? [])).catch(console.error)
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

  const updateRow = (i: number, field: 'key' | 'value', value: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  return (
    <div className={styles.page} data-testid="configure-lists">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small">Lists</Heading>
        <Button leadingVisual={PlusIcon} size="small" onClick={startCreate} data-testid="new-list">
          New list
        </Button>
      </Stack>

      {formOpen && (
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
      )}

      {lists === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {lists !== null && lists.length === 0 && !formOpen && (
        <Text as="p" className={styles.muted}>No lists yet.</Text>
      )}
      {lists !== null && (
        <Stack direction="vertical" gap="condensed">
          {lists.map((l) => (
            <div key={l.ID} className={styles.card} data-testid="list-row">
              <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                <div>
                  <Text weight="semibold">{l.Label}</Text>
                  <Text as="p" size="small" className={styles.muted}>
                    {Object.keys(l.Entries ?? {}).length} entries · ID: {l.ID}
                  </Text>
                </div>
                <Stack direction="horizontal" gap="condensed">
                  <Button size="small" variant="invisible" onClick={() => startEdit(l)}>Edit</Button>
                  <IconButton icon={TrashIcon} aria-label={`Delete ${l.Label}`} size="small" variant="invisible" onClick={() => remove(l.ID)} />
                </Stack>
              </Stack>
            </div>
          ))}
        </Stack>
      )}
    </div>
  )
}
