import { useEffect, useState } from 'react'
import { Label, Stack, Text, TextInput } from '@primer/react'
import { DataTable, type Column } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ExecutionService } from '../shared/bindings'
import type { RunSummary } from '../shared/bindings'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import styles from '../shared/ListCard.module.css'

// The source-first half of the reference analytics pattern
// (docs/SPEC.md §3.2, asked for directly: "select the input source
// then you see the list of activity for it ... columns ... search
// based on the attributes available for the input itself"): once a
// specific workflow is selected on Activity, this replaces the
// session-only feed with that workflow's DURABLE run history
// (ExecutionService.ListRunsForWorkflow -- DBOS-backed, survives
// restarts), with one column per attribute the workflow declares
// (values from what each run was invoked with) and search across
// attribute values and output.
export function ActivityRunsExplorer({ workflow }: { workflow: Workflow }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setRuns(null)
    setError('')
    ExecutionService.ListRunsForWorkflow(workflow.ID)
      .then((list) => setRuns(list ?? []))
      .catch((err) => setError(String(err)))
  }, [workflow.ID])

  const attrs = workflow.Attributes ?? []
  const query = search.trim().toLowerCase()
  const filtered = (runs ?? []).filter((run) => {
    if (query === '') return true
    const values = Object.values(run.values ?? {}).map((v) => String(v ?? '').toLowerCase())
    return values.some((v) => v.includes(query)) || (run.output ?? '').toLowerCase().includes(query)
  })

  const columns: Column<RunSummary & { id: string }>[] = [
    {
      id: 'started', header: 'Started', width: 'auto',
      renderCell: (run) => <Text size="small" className={styles.muted}>{new Date(run.startedAt as unknown as string).toLocaleString()}</Text>,
    },
    {
      id: 'kind', header: 'Kind', width: 'auto',
      renderCell: (run) => <Label size="small" variant={run.kind === 'triggered' ? 'severe' : 'secondary'}>{run.kind}</Label>,
    },
    {
      id: 'version', header: 'Version', width: 'auto',
      renderCell: (run) => (run.version > 0 ? `v${run.version}` : 'draft'),
    },
    {
      id: 'status', header: 'Status', width: 'auto',
      renderCell: (run) => (
        <Label size="small" variant={run.status === 'SUCCESS' ? 'success' : run.status === 'ERROR' ? 'danger' : 'attention'}>
          {run.status}
        </Label>
      ),
    },
    // One column per declared attribute -- the workflow's own typed
    // input schema drives the table's shape, exactly the reference
    // pattern's point.
    ...attrs.map((a): Column<RunSummary & { id: string }> => ({
      id: `attr-${a.Key}`, header: a.Label || a.Key, width: 'auto',
      renderCell: (run) => <Text size="small">{run.values?.[a.Key] ?? ''}</Text>,
    })),
    {
      id: 'output', header: 'Output', width: 'growCollapse', minWidth: '160px',
      renderCell: (run) => <TruncatedCell text={run.output ?? ''} />,
    },
  ]

  return (
    <Stack direction="vertical" gap="normal" data-testid="activity-runs-explorer">
      <TextInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={attrs.length > 0
          ? `Search runs by ${attrs.map((a) => a.Label || a.Key).join(', ')} or output…`
          : 'Search runs by output…'}
        aria-label="Search runs"
        data-testid="runs-explorer-search"
      />
      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      {runs === null && !error && <Text as="p" className={styles.muted}>Loading…</Text>}
      {runs !== null && filtered.length === 0 && (
        <Text as="p" className={styles.muted}>
          {runs.length === 0
            ? 'No recorded runs for this workflow yet — durable run history appears here after a Run or trigger fire.'
            : 'No runs match this search.'}
        </Text>
      )}
      {filtered.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-activity-runs">
          <DataTable
            aria-label={`${workflow.Label} runs`}
            data={filtered.map((r) => ({ ...r, id: r.runID }))}
            columns={columns}
          />
        </ResizableTableContainer>
      )}
    </Stack>
  )
}
