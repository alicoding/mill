import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Link, Stack } from '@primer/react'
import { DownloadIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable, Table } from '@primer/react/experimental'
import { ListToolbar } from '../shared/ListToolbar'
import {
  LIST_PAGE_SIZE, availableSorts, clampPage, listCountLabel, pageCountFor, pageItems, sortItems,
} from '../shared/listStandard'
import { useListState } from '../shared/useListState'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { TriggerRowLabel } from './TriggerRowLabel'
import { findRootNode } from './triggerRowInfo'
import { hasDraftDrift } from './draftDrift'

// The Workflows list's table view (docs/SPEC.md §3.5's Update: every
// data-inventory page gets a cards/table switch) -- Primer's own
// DataTable, extracted as its own component so CompositionView.tsx
// stays under the 500-line limit. Same actions, same handlers as the
// card view; only the presentation differs.
//
// It wears the same list standard as the row view (docs/goals/0337):
// the shared toolbar above, the same fixed page size below, its own
// persisted sort/page so switching view modes doesn't drag one view's
// page position onto the other. Seeded examples are NOT split out here
// -- a table's rows are read as one ordered grid, and the built-in
// badge already marks them in the Name column.
export function WorkflowsTable({
  workflows, runningId, editDisabled, armedWorkflows, publishingId,
  onRun, onOpenView, onEdit, onExport, onDelete, onPublish, onHotkeyChanged,
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
  // docs/goals/0036-view-mode-ux-hardening.md item 1: table view's own
  // entry into VIEW mode -- InventoryList's row-view already opens VIEW
  // on a plain row click (CompositionView.tsx's onOpen); the table view
  // had no equivalent, so the Label cell becomes the same affordance
  // here, matching goal 0022's "row click inspects, Edit is explicit"
  // grammar rather than adding a second table-only entry point.
  onOpenView: (id: string) => void
  onEdit: (id: string) => void
  onExport: (id: string, label: string) => void
  onDelete: (id: string) => void
  onPublish: (id: string) => void
  onHotkeyChanged: () => void
}) {
  const { t } = useTranslation('composition')
  // Table-view direct-wiring half of the Button-semantics convention
  // (.claude/rules/frontend.md) -- the row menu path (WorkflowsTable's
  // InventoryList sibling in CompositionView.tsx) gets confirmation
  // for free via InventoryList's own opt-in `confirm` field; this
  // TrashIcon is a bare icon button, so it wires ConfirmDialog directly
  // via the shared hook.
  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<Workflow>({
    entityType: 'workflow',
    labelOf: (wf) => wf.Label,
    onConfirm: (wf) => onDelete(wf.ID),
  })
  const { state, setSort, setPage, resetPage } = useListState('workflows.table')
  const [query, setQuery] = useState('')

  const sortable = workflows.map((wf) => ({ wf, label: wf.Label, updatedAt: wf.UpdatedAt, createdAt: wf.CreatedAt }))
  const sortOptions = availableSorts(sortable)
  const sort = sortOptions.includes(state.sort) ? state.sort : 'updated'
  const q = query.trim().toLowerCase()
  const filtered = sortItems(sortable, sort)
    .map((entry) => entry.wf)
    .filter((wf) => q === '' || wf.Label.toLowerCase().includes(q) || (wf.Description ?? '').toLowerCase().includes(q))

  const pageCount = pageCountFor(filtered.length)
  const page = clampPage(state.page, pageCount)
  const rows = pageItems(filtered, page)
  const first = (page - 1) * LIST_PAGE_SIZE + 1
  const count = listCountLabel({
    total: workflows.length,
    shown: filtered.length,
    ...(pageCount > 1 ? { from: first, to: first + rows.length - 1 } : {}),
  })
  // Table.Pagination keeps its page index internally, so remounting it
  // is what returns to page one when the search narrows the table.
  const [mountQuery] = useState(q)
  const [restorePageIndex] = useState(() => Math.max(0, state.page - 1))

  return (
    <>
    <ListToolbar
      query={query}
      onQueryChange={(next) => { setQuery(next); resetPage() }}
      searchPlaceholder={t('compositionView.searchPlaceholder')}
      sort={sort}
      sortOptions={sortOptions}
      onSortChange={setSort}
      count={count}
    />
    <ResizableTableContainer storageKey="mill-cols-workflows">
      <DataTable
        aria-labelledby="workflows-heading"
        data={rows.map((wf) => ({ ...wf, id: wf.ID }))}
        columns={[
          {
            // rowHeader stays true (the accessible name for the row);
            // renderCell layers the click-to-view affordance on top of
            // the same field, sort/field wiring untouched -- DataTable's
            // own sort strategy reads `field`/`sortBy`, not renderCell's
            // output (checked against DataTable.js's getValue()).
            header: t('workflowsTable.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric',
            renderCell: (wf) => (
              <Link as="button" type="button" onClick={() => onOpenView(wf.ID)} data-testid="workflow-view-link">
                {wf.Label}
              </Link>
            ),
          },
          {
            // growCollapse (not 'auto'): a Publish CTA + badge can run
            // wide (schedule/filesystem-watch text plus a badge plus a
            // button) -- 'auto' would force the grid track to its
            // widest cell and reintroduce the horizontal-overflow bug
            // §3.8's long-column pattern exists to prevent, same
            // reasoning as the Description column below.
            header: t('workflowsTable.columns.trigger'), id: 'trigger', width: 'growCollapse', minWidth: '90px',
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
            header: t('workflowsTable.columns.status'), id: 'status', width: 'auto',
            renderCell: (wf) => (
              <Stack direction="horizontal" gap="condensed">
                {wf.PublishedVersion > 0
                  ? <StatusStamp variant="success">{t('publishedVersionLive', { version: wf.PublishedVersion })}</StatusStamp>
                  : <StatusStamp variant="caution">{t('workflowsTable.draft')}</StatusStamp>}
                {wf.Disabled && <StatusStamp variant="danger">{t('disabled')}</StatusStamp>}
              </Stack>
            ),
          },
          { header: t('workflowsTable.columns.description'), id: 'description', width: 'growCollapse', minWidth: '200px', renderCell: (wf) => <TruncatedCell text={wf.Description} /> },
          { header: t('workflowsTable.columns.steps'), id: 'steps', width: 'auto', align: 'end', renderCell: (wf) => (wf.Nodes ?? []).length },
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
                ? t('workflowsTable.runTitleDrifted')
                : t('workflowsTable.runTitle')
              return (
                <Stack direction="horizontal" gap="condensed">
                  {isCallable ? (
                    <Button
                      size="small"
                      variant="invisible"
                      onClick={() => onRun(wf.ID)}
                      disabled={runningId === wf.ID}
                      aria-label={t('workflowsTable.testAriaLabel', { label: wf.Label })}
                      title={runTitle}
                      data-testid="callable-test-run"
                    >
                      {runningId === wf.ID ? t('running') : t('workflowsTable.test')}
                    </Button>
                  ) : (
                    <Button size="small" onClick={() => onRun(wf.ID)} disabled={runningId === wf.ID} aria-label={t('workflowsTable.runAriaLabel', { label: wf.Label })} title={runTitle}>
                      {runningId === wf.ID ? t('running') : t('workflowsTable.run')}
                    </Button>
                  )}
                  <IconButton icon={PencilIcon} aria-label={t('workflowsTable.editAriaLabel', { label: wf.Label })} size="small" variant="invisible" disabled={editDisabled} onClick={() => onEdit(wf.ID)} />
                  <IconButton icon={DownloadIcon} aria-label={t('workflowsTable.exportAriaLabel', { label: wf.Label })} size="small" variant="invisible" onClick={() => onExport(wf.ID, wf.Label)} />
                  <IconButton icon={TrashIcon} aria-label={t('workflowsTable.deleteAriaLabel', { label: wf.Label })} size="small" variant="invisible" onClick={() => requestDelete(wf)} />
                </Stack>
              )
            },
          },
        ]}
      />
      {pageCount > 1 && (
        <Table.Pagination
          key={q}
          aria-label={t('compositionView.savedWorkflowsHeading')}
          pageSize={LIST_PAGE_SIZE}
          totalCount={filtered.length}
          defaultPageIndex={q === mountQuery ? restorePageIndex : 0}
          onChange={({ pageIndex }) => setPage(pageIndex + 1)}
        />
      )}
      {confirmDialog}
    </ResizableTableContainer>
    </>
  )
}
