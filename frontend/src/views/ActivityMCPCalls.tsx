import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Heading, IconButton, Label, type LabelProps, Select, Stack, Text, TextInput } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { ArrowDownIcon, ArrowUpIcon, PulseIcon, ChevronLeftIcon, ChevronRightIcon } from '@primer/octicons-react'
import { MCPAuditService } from '../shared/bindings'
import type { MCPCallRecord } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { OutputViewer } from '../shared/OutputViewer'
import styles from '../shared/ListCard.module.css'

// The MCP calls section (goal 0159 slice 1): every call Mill's own MCP
// server received (from an external agent, or Mill's own agent loop --
// audited identically, no special path) and every call Mill itself made
// to a configured MCP server. Deliberately its OWN layout -- a compact,
// divider-separated ActionList, not a DataTable -- so it reads at a
// glance as a call LOG, never a clone of the runs table above it
// (recognition rule: two different kinds of surface must never share
// one undifferentiated look). Server-paged (limit/offset) and
// server-filtered (direction, tool) via the bound read API; a manual
// refresh only, no live push -- v1 scope, named in the goal file's own
// non-goals.
const PAGE_SIZE = 25

type DirectionFilter = 'all' | 'server' | 'client'

const OUTCOME_LABEL: Record<string, string> = {
  success: 'Succeeded',
  error: 'Failed',
  denied: 'Denied',
  parked: 'Awaiting approval',
  parked_approved: 'Approved',
  parked_denied: 'Denied',
  parked_expired: 'Expired',
  parked_cancelled: 'Cancelled',
}

const OUTCOME_VARIANT: Record<string, LabelProps['variant']> = {
  success: 'success',
  error: 'danger',
  denied: 'danger',
  parked: 'attention',
  parked_approved: 'success',
  parked_denied: 'danger',
  parked_expired: 'attention',
  parked_cancelled: 'secondary',
}

function outcomeLabel(outcome: string): string {
  return OUTCOME_LABEL[outcome] ?? outcome
}

function outcomeVariant(outcome: string): LabelProps['variant'] {
  return OUTCOME_VARIANT[outcome] ?? 'secondary'
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function ActivityMCPCalls() {
  const { t } = useTranslation('views')
  const setView = useAppStore((s) => s.setView)
  const [records, setRecords] = useState<MCPCallRecord[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [tool, setTool] = useState('')
  const [offset, setOffset] = useState(0)
  // Which call's detail is open. A record carries its failure text and
  // nothing else of the exchange -- the audit row records that a call
  // happened, its outcome and its argument SIZE, never the argument or
  // result bodies -- so this expands the one piece of output there is.
  const [expanded, setExpanded] = useState<number | null>(null)

  const refresh = useCallback(() => {
    MCPAuditService.ListMCPCalls({
      direction: direction === 'all' ? '' : direction,
      tool,
      limit: PAGE_SIZE,
      offset,
    })
      .then((resp) => {
        setRecords(resp.records ?? [])
        setTotal(resp.total)
      })
      .catch((err) => setError(String(err)))
  }, [direction, tool, offset])

  useEffect(() => { refresh() }, [refresh])

  const changeDirection = (next: DirectionFilter) => {
    setDirection(next)
    setOffset(0)
  }
  const changeTool = (next: string) => {
    setTool(next)
    setOffset(0)
  }

  if (error) {
    return <Text as="p" size="small" className={styles.error}>{error}</Text>
  }
  if (records === null) {
    return null
  }

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + records.length, total)

  return (
    <section data-testid="activity-mcp-calls">
      <Stack direction="horizontal" justify="space-between" align="center">
        <Heading as="h2" variant="small" className={styles.sectionHeading}>
          {t('activityView.mcpCalls.heading')}
        </Heading>
        <IconButton
          icon={PulseIcon}
          aria-label={t('activityView.mcpCalls.refreshAriaLabel')}
          size="small"
          variant="invisible"
          onClick={refresh}
          data-testid="mcp-calls-refresh"
        />
      </Stack>
      <Text as="p" size="small" className={styles.muted}>
        {t('activityView.mcpCalls.description')}
      </Text>

      <Stack direction="horizontal" gap="condensed" className={styles.filterRow}>
        <Select
          value={direction}
          onChange={(e) => changeDirection(e.target.value as DirectionFilter)}
          aria-label={t('activityView.mcpCalls.filterByDirectionAriaLabel')}
          data-testid="mcp-calls-direction-filter"
        >
          <Select.Option value="all">{t('activityView.mcpCalls.allDirections')}</Select.Option>
          <Select.Option value="server">{t('activityView.mcpCalls.received')}</Select.Option>
          <Select.Option value="client">{t('activityView.mcpCalls.sent')}</Select.Option>
        </Select>
        <TextInput
          value={tool}
          onChange={(e) => changeTool(e.target.value)}
          placeholder={t('activityView.mcpCalls.filterByToolPlaceholder')}
          aria-label={t('activityView.mcpCalls.filterByToolAriaLabel')}
          data-testid="mcp-calls-tool-filter"
        />
      </Stack>

      {records.length === 0 ? (
        <Blankslate data-testid="activity-mcp-calls-empty">
          <Blankslate.Visual>
            <PulseIcon size={32} />
          </Blankslate.Visual>
          <Blankslate.Heading>{t('activityView.mcpCalls.noCallsHeading')}</Blankslate.Heading>
          <Blankslate.Description>{t('activityView.mcpCalls.noCallsDescription')}</Blankslate.Description>
          {/* The first-run door (goal 0202's empty-state rule: offer
              the action the sentence names): connecting an agent starts
              at the MCP access address in Settings. */}
          <Blankslate.PrimaryAction onClick={() => setView({ kind: 'settings', section: 'mcp-access' })}>
            {t('activityView.mcpCalls.connectAgentAction')}
          </Blankslate.PrimaryAction>
        </Blankslate>
      ) : (
        <>
          <ActionList showDividers aria-label={t('activityView.mcpCalls.heading')}>
            {records.map((r) => (
              <ActionList.Item
                key={r.id}
                role="listitem"
                data-testid="mcp-call-row"
                active={expanded === r.id}
                onSelect={r.errorText ? () => setExpanded((current) => (current === r.id ? null : r.id)) : undefined}
              >
                <ActionList.LeadingVisual>
                  {r.direction === 'server' ? (
                    <ArrowDownIcon size={16} aria-label={t('activityView.mcpCalls.receivedAriaLabel')} />
                  ) : (
                    <ArrowUpIcon size={16} aria-label={t('activityView.mcpCalls.sentAriaLabel')} />
                  )}
                </ActionList.LeadingVisual>
                {r.toolName || r.methodName}
                <ActionList.Description variant="block">
                  {[r.callerIdentity, formatTimestamp(r.timestamp)].filter(Boolean).join(' · ')}
                </ActionList.Description>
                <ActionList.TrailingVisual>
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Label variant={outcomeVariant(r.outcome)} size="small">{outcomeLabel(r.outcome)}</Label>
                    <Text size="small" className={styles.muted}>{t('activityView.mcpCalls.durationMs', { ms: r.durationMs })}</Text>

                  </Stack>
                </ActionList.TrailingVisual>
              </ActionList.Item>
            ))}
          </ActionList>
          {records.filter((r) => r.id === expanded && r.errorText).map((r) => (
            <div key={r.id} data-testid="mcp-call-detail">
              <OutputViewer
                value={r.errorText}
                shape="error"
                title={r.toolName || r.methodName}
                site="mcp-call-error"
                testId="mcp-call-error"
                context={{ tool: r.toolName || r.methodName, direction: r.direction, caller: r.callerIdentity }}
              />
            </div>
          ))}
          <Stack direction="horizontal" justify="space-between" align="center" className={styles.filterRow}>
            <Text size="small" className={styles.muted}>
              {t('activityView.mcpCalls.showingRange', { start: rangeStart, end: rangeEnd, total })}
            </Text>
            <Stack direction="horizontal" gap="condensed">
              <IconButton
                icon={ChevronLeftIcon}
                aria-label={t('activityView.mcpCalls.previousPageAriaLabel')}
                size="small"
                variant="invisible"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                data-testid="mcp-calls-prev-page"
              />
              <IconButton
                icon={ChevronRightIcon}
                aria-label={t('activityView.mcpCalls.nextPageAriaLabel')}
                size="small"
                variant="invisible"
                disabled={rangeEnd >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                data-testid="mcp-calls-next-page"
              />
            </Stack>
          </Stack>
        </>
      )}
    </section>
  )
}
