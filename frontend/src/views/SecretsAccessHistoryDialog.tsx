import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Dialog, IconButton, Label, type LabelProps, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { ChevronLeftIcon, ChevronRightIcon, HistoryIcon } from '@primer/octicons-react'
import { CompositionService, SecretService } from '../shared/bindings'
import type { SecretAccessRecord } from '../shared/bindings'
import { formatUpdated } from '../shared/inventorySort'
import listStyles from '../shared/ListCard.module.css'

// Goal 0203 S3: "who read this credential, and when" -- read-only, one
// component for both entry points the design contract names: the
// Secrets view's header opens it with no entryId (every read across
// the vault, newest first); the detail dialog's own "Access history"
// footer button opens it pre-filtered to that one entry. Mirrors
// ActivityMCPCalls' paging shape (goal 0159), the converged pattern for
// a server-paged audit log in this app.
const PAGE_SIZE = 25

const OUTCOME_VARIANT: Record<string, LabelProps['variant']> = {
  read: 'success',
  error: 'danger',
}

// contextCopyKey maps one record's context (+ whether a workflow name
// resolved) to its locale key -- see secrets.json's accessHistory.* for
// the actual sentences. A workflow-attributed read always wins over the
// context's own generic phrase, matching the design contract's own
// "Read by workflow <name>" example.
function contextCopyKey(context: string, hasWorkflow: boolean): string {
  if (hasWorkflow && (context === 'mcp-server-spawn' || context === 'exec-env' || context === 'http-header')) {
    return 'accessHistory.readByWorkflow'
  }
  switch (context) {
    case 'mcp-server-spawn': return 'accessHistory.readMcpServerSpawn'
    case 'exec-env': return 'accessHistory.readExecEnv'
    case 'http-header': return 'accessHistory.readHttpHeader'
    case 'configure-tools-preview': return 'accessHistory.readConfigureToolsPreview'
    case 'ui-reveal': return 'accessHistory.readUiReveal'
    case 'ui-copy': return 'accessHistory.readUiCopy'
    default: return 'accessHistory.readGeneric'
  }
}

export function SecretsAccessHistoryDialog({ entryId, entryLabel, onClose }: {
  entryId?: string
  entryLabel?: string
  onClose: () => void
}) {
  const { t } = useTranslation('secrets')
  const [records, setRecords] = useState<SecretAccessRecord[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const [workflowLabels, setWorkflowLabels] = useState<Record<string, string>>({})

  useEffect(() => {
    CompositionService.Workflows()
      .then((workflows) => {
        const byID: Record<string, string> = {}
        for (const w of workflows ?? []) byID[w.ID] = w.Label
        setWorkflowLabels(byID)
      })
      .catch(() => undefined) // a label failing to resolve degrades to the generic phrase, never an error
  }, [])

  const refresh = useCallback(() => {
    SecretService.ListSecretAccess({ entryId: entryId ?? '', limit: PAGE_SIZE, offset })
      .then((resp) => {
        setRecords(resp.records ?? [])
        setTotal(resp.total)
      })
      .catch((err) => setError(String(err)))
  }, [entryId, offset])

  useEffect(() => { refresh() }, [refresh])

  if (records === null && !error) return null

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + (records?.length ?? 0), total)
  const heading = entryLabel ? t('accessHistory.headingForEntry', { label: entryLabel }) : t('accessHistory.heading')

  return (
    <Dialog
      title={heading}
      onClose={onClose}
      footerButtons={[{ content: t('history.close'), onClick: onClose, autoFocus: true }]}
    >
      {error && <Text as="p" size="small" className={listStyles.error}>{error}</Text>}
      {records && records.length === 0 && (
        <Blankslate data-testid="secrets-access-history-empty">
          <Blankslate.Visual><HistoryIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('accessHistory.emptyHeading')}</Blankslate.Heading>
          <Blankslate.Description>{t('accessHistory.emptyDescription')}</Blankslate.Description>
        </Blankslate>
      )}
      {records && records.length > 0 && (
        <>
          <ActionList showDividers aria-label={heading} data-testid="secrets-access-history-list">
            {records.map((r) => {
              const workflowLabel = r.workflowId ? workflowLabels[r.workflowId] : undefined
              const isError = r.outcome === 'error'
              const description = isError
                ? t('accessHistory.readFailed')
                : t(contextCopyKey(r.context, Boolean(workflowLabel)), { label: workflowLabel })
              return (
                <ActionList.Item key={r.id} role="listitem" data-testid="secrets-access-history-row">
                  {entryId ? description : r.label}
                  <ActionList.Description variant="block">
                    {entryId ? formatUpdated(r.timestamp) : [description, formatUpdated(r.timestamp)].join(' · ')}
                  </ActionList.Description>
                  <ActionList.TrailingVisual>
                    <Label variant={OUTCOME_VARIANT[r.outcome] ?? 'secondary'} size="small">
                      {isError ? t('accessHistory.outcomeError') : t('accessHistory.outcomeRead')}
                    </Label>
                  </ActionList.TrailingVisual>
                </ActionList.Item>
              )
            })}
          </ActionList>
          <Stack direction="horizontal" justify="space-between" align="center" className={listStyles.filterRow}>
            <Text size="small" className={listStyles.muted}>
              {t('accessHistory.showingRange', { start: rangeStart, end: rangeEnd, total })}
            </Text>
            <Stack direction="horizontal" gap="condensed">
              <IconButton
                icon={ChevronLeftIcon}
                aria-label={t('accessHistory.previousPageAriaLabel')}
                size="small"
                variant="invisible"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                data-testid="secrets-access-history-prev-page"
              />
              <IconButton
                icon={ChevronRightIcon}
                aria-label={t('accessHistory.nextPageAriaLabel')}
                size="small"
                variant="invisible"
                disabled={rangeEnd >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                data-testid="secrets-access-history-next-page"
              />
            </Stack>
          </Stack>
        </>
      )}
    </Dialog>
  )
}
