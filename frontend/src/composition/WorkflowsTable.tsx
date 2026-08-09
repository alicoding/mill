import { Button, IconButton, Label, Stack } from '@primer/react'
import { DownloadIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// The Workflows list's table view (docs/SPEC.md §3.5's Update: every
// data-inventory page gets a cards/table switch) -- Primer's own
// DataTable, extracted as its own component so CompositionView.tsx
// stays under the 500-line limit. Same actions, same handlers as the
// card view; only the presentation differs.
export function WorkflowsTable({ workflows, runningId, editDisabled, onRun, onEdit, onExport, onDelete }: {
  workflows: Workflow[]
  runningId: string | null
  editDisabled: boolean
  onRun: (id: string) => void
  onEdit: (id: string) => void
  onExport: (id: string, label: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <ResizableTableContainer>
      <DataTable
        aria-labelledby="workflows-heading"
        data={workflows.map((wf) => ({ ...wf, id: wf.ID }))}
        columns={[
          { header: 'Label', field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
          {
            header: 'Status', id: 'status', width: 'auto',
            renderCell: (wf) => (
              <Stack direction="horizontal" gap="condensed">
                {wf.PublishedVersion > 0
                  ? <Label variant="success" size="small">v{wf.PublishedVersion} live</Label>
                  : <Label variant="attention" size="small">draft</Label>}
                {wf.Disabled && <Label variant="severe" size="small">disabled</Label>}
              </Stack>
            ),
          },
          { header: 'Description', id: 'description', renderCell: (wf) => <TruncatedCell text={wf.Description} /> },
          { header: 'Steps', id: 'steps', width: 'auto', align: 'end', renderCell: (wf) => (wf.Nodes ?? []).length },
          {
            header: '', id: 'actions', width: 'auto', align: 'end',
            renderCell: (wf) => (
              <Stack direction="horizontal" gap="condensed">
                <Button size="small" onClick={() => onRun(wf.ID)} disabled={runningId === wf.ID} aria-label={`Run ${wf.Label}`}>
                  {runningId === wf.ID ? 'Running…' : 'Run'}
                </Button>
                <IconButton icon={PencilIcon} aria-label={`Edit ${wf.Label}`} size="small" variant="invisible" disabled={editDisabled} onClick={() => onEdit(wf.ID)} />
                <IconButton icon={DownloadIcon} aria-label={`Export ${wf.Label}`} size="small" variant="invisible" onClick={() => onExport(wf.ID, wf.Label)} />
                <IconButton icon={TrashIcon} aria-label={`Delete ${wf.Label}`} size="small" variant="invisible" onClick={() => onDelete(wf.ID)} />
              </Stack>
            ),
          },
        ]}
      />
    </ResizableTableContainer>
  )
}
