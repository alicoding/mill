import { Button, IconButton, Label, Stack } from '@primer/react'
import { DownloadIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { TriggerRowLabel } from './TriggerRowLabel'
import { findRootNode } from './triggerRowInfo'
import { hasDraftDrift } from './draftDrift'

// The Workflows list's table view (docs/SPEC.md §3.5's Update: every
// data-inventory page gets a cards/table switch) -- Primer's own
// DataTable, extracted as its own component so CompositionView.tsx
// stays under the 500-line limit. Same actions, same handlers as the
// card view; only the presentation differs.
export function WorkflowsTable({
  workflows, runningId, editDisabled, armedWorkflows, publishingId,
  onRun, onEdit, onExport, onDelete, onPublish, onHotkeyChanged,
}: {
  workflows: Workflow[]
  runningId: string | null
  editDisabled: boolean
  // TriggerService.ArmedWorkflows(), keyed by workflow ID (docs/goals/
  // 0006-trigger-aware-workflows-list.md) -- fetched once by
  // CompositionView, not recomputed per row.
  armedWorkflows: Record<string, boolean | undefined>
  publishingId: string | null
  onRun: (id: string) => void
  onEdit: (id: string) => void
  onExport: (id: string, label: string) => void
  onDelete: (id: string) => void
  onPublish: (id: string) => void
  onHotkeyChanged: () => void
}) {
  return (
    <ResizableTableContainer storageKey="mill-cols-workflows">
      <DataTable
        aria-labelledby="workflows-heading"
        data={workflows.map((wf) => ({ ...wf, id: wf.ID }))}
        columns={[
          { header: 'Label', field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
          {
            // growCollapse (not 'auto'): a Publish CTA + badge can run
            // wide (schedule/filesystem-watch text plus a badge plus a
            // button) -- 'auto' would force the grid track to its
            // widest cell and reintroduce the horizontal-overflow bug
            // §3.8's long-column pattern exists to prevent, same
            // reasoning as the Description column below.
            header: 'Trigger', id: 'trigger', width: 'growCollapse', minWidth: '90px',
            renderCell: (wf) => (
              <TriggerRowLabel
                workflow={wf}
                armed={armedWorkflows[wf.ID] === true}
                publishing={publishingId === wf.ID}
                onPublish={onPublish}
                onHotkeyChanged={onHotkeyChanged}
              />
            ),
          },
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
          { header: 'Description', id: 'description', width: 'growCollapse', minWidth: '200px', renderCell: (wf) => <TruncatedCell text={wf.Description} /> },
          { header: 'Steps', id: 'steps', width: 'auto', align: 'end', renderCell: (wf) => (wf.Nodes ?? []).length },
          {
            header: '', id: 'actions', width: 'auto', align: 'end',
            renderCell: (wf) => {
              // trigger-callable rows: this workflow only ever runs
              // when invoked as a child by another workflow's Child
              // Workflow node (docs/SPEC.md §3.3/ADR-0010) -- a primary
              // Run button here was the exact incoherence the goal
              // names ("Example: Echo message (callable child)" says
              // it's only runnable by another workflow and still shows
              // Run). Demoted to a small secondary "Test" action instead
              // of removed outright, since exercising a callable
              // workflow directly (docs/adr/0008's RunKindTest) is still
              // a real, useful thing to do while authoring it.
              const isCallable = findRootNode(wf.Nodes, wf.Edges)?.NodeTypeID === 'trigger-callable'
              const runTitle = hasDraftDrift(wf)
                ? 'Test run of the draft — differs from the published version.'
                : 'Test run of the draft.'
              return (
                <Stack direction="horizontal" gap="condensed">
                  {isCallable ? (
                    <Button
                      size="small"
                      variant="invisible"
                      onClick={() => onRun(wf.ID)}
                      disabled={runningId === wf.ID}
                      aria-label={`Test ${wf.Label}`}
                      title={runTitle}
                      data-testid="callable-test-run"
                    >
                      {runningId === wf.ID ? 'Running…' : 'Test'}
                    </Button>
                  ) : (
                    <Button size="small" onClick={() => onRun(wf.ID)} disabled={runningId === wf.ID} aria-label={`Run ${wf.Label}`} title={runTitle}>
                      {runningId === wf.ID ? 'Running…' : 'Run'}
                    </Button>
                  )}
                  <IconButton icon={PencilIcon} aria-label={`Edit ${wf.Label}`} size="small" variant="invisible" disabled={editDisabled} onClick={() => onEdit(wf.ID)} />
                  <IconButton icon={DownloadIcon} aria-label={`Export ${wf.Label}`} size="small" variant="invisible" onClick={() => onExport(wf.ID, wf.Label)} />
                  <IconButton icon={TrashIcon} aria-label={`Delete ${wf.Label}`} size="small" variant="invisible" onClick={() => onDelete(wf.ID)} />
                </Stack>
              )
            },
          },
        ]}
      />
    </ResizableTableContainer>
  )
}
