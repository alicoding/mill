import { useState } from 'react'
import { Button, Heading, Label, Stack, Text } from '@primer/react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { CompositionService } from '../../bindings/github.com/alicoding/mill'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

// The Versions tab on a saved workflow's editor (docs/adr/0021): the
// draft/publish/disable lifecycle surface. The canvas edits the DRAFT;
// nothing a trigger or child call executes changes until Publish. The
// version list is Primer's own DataTable, same adopted component every
// other tabular surface uses.
export function WorkflowVersionsPanel({ workflow, onChanged }: {
  workflow: Workflow
  onChanged: () => void
}) {
  const [error, setError] = useState('')

  const act = (p: Promise<unknown>) => {
    setError('')
    p.then(onChanged).catch((err) => setError(String(err)))
  }

  const versions = [...(workflow.Versions ?? [])].sort((a, b) => b.Version - a.Version)

  return (
    <PageContainer data-testid="workflow-versions-panel">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Heading as="h2" variant="small" id="versions-heading">Versions</Heading>
          {workflow.PublishedVersion > 0 ? (
            <Label variant="success" data-testid="published-badge">v{workflow.PublishedVersion} live</Label>
          ) : (
            <Label variant="attention" data-testid="published-badge">never published</Label>
          )}
          {workflow.Disabled && <Label variant="severe" data-testid="disabled-badge">disabled</Label>}
        </Stack>
        <Stack direction="horizontal" gap="condensed">
          <Button
            size="small"
            variant="invisible"
            onClick={() => act(CompositionService.SetWorkflowDisabled(workflow.ID, !workflow.Disabled))}
            data-testid="toggle-disabled"
          >
            {workflow.Disabled ? 'Enable' : 'Disable'}
          </Button>
          <Button
            size="small"
            variant="primary"
            onClick={() => act(CompositionService.PublishWorkflow(workflow.ID))}
            data-testid="publish-workflow"
          >
            Publish current draft
          </Button>
        </Stack>
      </Stack>

      <Text as="p" size="small" className={styles.muted}>
        The canvas edits the draft. Triggers and child-workflow calls always run the published (live)
        version — publishing is the explicit go-live act, and a test Run exercises the draft without
        publishing. Disabling pauses triggers and child calls; test runs keep working.
      </Text>
      {error && <Text as="p" size="small" className={styles.error} data-testid="versions-error">{error}</Text>}

      {versions.length === 0 && (
        <Text as="p" className={styles.muted}>No versions yet — publish the draft to create v1.</Text>
      )}
      {versions.length > 0 && (
        <ResizableTableContainer>
          <DataTable
            aria-labelledby="versions-heading"
            data={versions.map((v) => ({ ...v, id: v.Version }))}
            columns={[
              {
                header: 'Version', field: 'Version', rowHeader: true, width: 'auto',
                renderCell: (v) => (
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Text weight="semibold">v{v.Version}</Text>
                    {v.Version === workflow.PublishedVersion && <Label variant="success" size="small">live</Label>}
                  </Stack>
                ),
              },
              {
                header: 'Saved', id: 'saved', width: 'auto',
                renderCell: (v) => new Date(v.SavedAt as unknown as string).toLocaleString(),
              },
              { header: 'Label', id: 'label', renderCell: (v) => <TruncatedCell text={v.Label} /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (v) => (
                  <Stack direction="horizontal" gap="condensed">
                    {v.Version !== workflow.PublishedVersion && (
                      <Button size="small" onClick={() => act(CompositionService.PublishExistingVersion(workflow.ID, v.Version))}>
                        Make live
                      </Button>
                    )}
                    <Button size="small" variant="invisible" onClick={() => act(CompositionService.RestoreVersionToDraft(workflow.ID, v.Version))}>
                      Load into draft
                    </Button>
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
    </PageContainer>
  )
}
