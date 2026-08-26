import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Heading, Stack, Text } from '@primer/react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { CompositionService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { findCommand } from '../shared/commands'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import styles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'
import PageContainer from '../shared/PageContainer'

// The Versions tab on a saved workflow's editor (docs/adr/0021): the
// draft/publish/disable lifecycle surface. The canvas edits the DRAFT;
// nothing a trigger or child call executes changes until Publish. The
// version list is Primer's own DataTable, same adopted component every
// other tabular surface uses.
export function WorkflowVersionsPanel({ workflow, onChanged, tabKey }: {
  workflow: Workflow
  onChanged: () => void
  // The owning WorkTab's own identity (composition/WorkflowEditorTab.tsx)
  // -- workflow.publish (shared/commands.ts) can't reach this specific
  // mounted panel directly (shared/ can't import composition/), so it
  // sets the store's canvasCommandRequest signal instead, same seam
  // workflow.save/workflow.run already use; this panel (like every
  // WorkflowEditorTab's own sub-panel) stays mounted-hidden alongside
  // the canvas, so it consumes the request itself rather than relying
  // on CompositionCanvas's own useCanvasCommandDispatch to reach it.
  tabKey: string
}) {
  const { t } = useTranslation('composition')
  const [error, setError] = useState('')

  const act = (p: Promise<unknown>) => {
    setError('')
    p.then(onChanged).catch((err) => setError(String(err)))
  }

  const canvasCommandRequest = useAppStore((s) => s.canvasCommandRequest)
  const consumeCanvasCommandRequest = useAppStore((s) => s.consumeCanvasCommandRequest)
  const activeWorkTabKey = useAppStore((s) => s.activeWorkTabKey)

  useEffect(() => {
    if (canvasCommandRequest !== 'publish') return
    if (activeWorkTabKey !== tabKey) return
    act(CompositionService.PublishWorkflow(workflow.ID))
    consumeCanvasCommandRequest()
    // act/workflow.ID/consumeCanvasCommandRequest deliberately excluded,
    // same reasoning composition/useCanvasCommandDispatch.ts's own
    // effect gives: act is a fresh closure every render, re-running just
    // because its identity changed risks double-consuming a request
    // mid-render -- canvasCommandRequest/activeWorkTabKey/tabKey are the
    // real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasCommandRequest, activeWorkTabKey, tabKey])

  const versions = [...(workflow.Versions ?? [])].sort((a, b) => b.Version - a.Version)

  return (
    <PageContainer data-testid="workflow-versions-panel">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Heading as="h2" variant="small" id="versions-heading">{t('workflowVersionsPanel.heading')}</Heading>
          {workflow.PublishedVersion > 0 ? (
            <StatusStamp variant="success" data-testid="published-badge">{t('publishedVersionLive', { version: workflow.PublishedVersion })}</StatusStamp>
          ) : (
            <StatusStamp variant="caution" data-testid="published-badge">{t('workflowVersionsPanel.neverPublished')}</StatusStamp>
          )}
          {workflow.Disabled && <StatusStamp variant="danger" data-testid="disabled-badge">{t('disabled')}</StatusStamp>}
        </Stack>
        <Stack direction="horizontal" gap="condensed">
          <Button
            size="small"
            variant="invisible"
            onClick={() => act(CompositionService.SetWorkflowDisabled(workflow.ID, !workflow.Disabled))}
            data-testid="toggle-disabled"
          >
            {workflow.Disabled ? t('workflowVersionsPanel.enable') : t('workflowVersionsPanel.disable')}
          </Button>
          <Button
            size="small"
            variant="primary"
            onClick={() => findCommand('workflow.publish')?.run()}
            data-testid="publish-workflow"
          >
            {t('workflowVersionsPanel.publishCurrentDraft')}
          </Button>
        </Stack>
      </Stack>

      <Text as="p" size="small" className={styles.muted}>
        {t('workflowVersionsPanel.description')}
      </Text>
      {error && <Text as="p" size="small" className={styles.error} data-testid="versions-error">{error}</Text>}

      {versions.length === 0 && (
        <Text as="p" className={styles.muted}>{t('workflowVersionsPanel.noVersionsYet')}</Text>
      )}
      {versions.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-versions">
          <DataTable
            aria-labelledby="versions-heading"
            data={versions.map((v) => ({ ...v, id: v.Version }))}
            columns={[
              {
                header: t('workflowVersionsPanel.columns.version'), field: 'Version', rowHeader: true, width: 'auto',
                renderCell: (v) => (
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Text weight="semibold">{t('workflowVersionsPanel.versionPrefix', { version: v.Version })}</Text>
                    {v.Version === workflow.PublishedVersion && <StatusStamp variant="success">{t('workflowVersionsPanel.live')}</StatusStamp>}
                  </Stack>
                ),
              },
              {
                header: t('workflowVersionsPanel.columns.saved'), id: 'saved', width: 'auto',
                renderCell: (v) => <span className={monoStyles.mono}>{new Date(v.SavedAt as unknown as string).toLocaleString()}</span>,
              },
              { header: t('workflowVersionsPanel.columns.label'), id: 'label', width: 'growCollapse', minWidth: '160px', renderCell: (v) => <TruncatedCell text={v.Label} /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (v) => (
                  <Stack direction="horizontal" gap="condensed">
                    {v.Version !== workflow.PublishedVersion && (
                      <Button size="small" onClick={() => act(CompositionService.PublishExistingVersion(workflow.ID, v.Version))}>
                        {t('workflowVersionsPanel.makeLive')}
                      </Button>
                    )}
                    <Button size="small" variant="invisible" onClick={() => act(CompositionService.RestoreVersionToDraft(workflow.ID, v.Version))}>
                      {t('workflowVersionsPanel.loadIntoDraft')}
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
