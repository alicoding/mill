import { Label, Stack, Text } from '@primer/react'
import { formatUpdated } from './inventorySort'
import { ageTier, formatExpiresIn, MCP_WRITE_EXPIRY_MS } from './staleness'
import styles from './ListCard.module.css'

// Shared age-tiered presentation for a pending actionable item
// (docs/goals/0026 item 2): fresh (<15m) renders as plain relative time,
// exactly as every other row already did; aging (15m+) gets visible
// emphasis (an attention-colored Label instead of plain muted text) plus
// an "expires in Nh" caption counting down the shared 24h clock. Reused
// verbatim by ReviewView's pending rows (both guardrail/human-review/
// debug parks and MCP write requests), MCPWriteApprovals' banner, and
// ApprovalPrompt's floating prompt -- one component, not three
// near-identical age renderings.
export function StalenessBadge({
  createdAt,
  expiryMs = MCP_WRITE_EXPIRY_MS,
  thresholdMs,
  showExpiry = true,
  testId,
}: {
  createdAt: string | Date
  expiryMs?: number
  // thresholdMs overrides the default 15-minute age-tier bar -- item
  // 8's stuck-ENQUEUED presentation passes its own 5-minute bar
  // ("same tier language" at a different cutoff, not a second
  // mechanism).
  thresholdMs?: number
  // showExpiry hides the "expires in Nh" caption -- a stuck-ENQUEUED
  // run (item 8) has no 24h expiry concept of its own, only the age
  // emphasis; every 24h-clocked pending item (item 2) keeps it.
  showExpiry?: boolean
  testId?: string
}) {
  // Intentional: this badge's whole job is showing how stale `createdAt`
  // is *right now*, same as every other relative-time/"time ago"
  // component; reading the live clock at render is the correct behavior
  // here, not a bug the rule is catching (worst case under concurrent
  // rendering is a one-render-old relative-time label, not a
  // correctness issue).
  // eslint-disable-next-line react-hooks/purity
  const tier = ageTier(createdAt, Date.now(), thresholdMs)
  const relative = formatUpdated(typeof createdAt === 'string' ? createdAt : createdAt.toISOString())
  if (tier === 'fresh') {
    return <Text size="small" className={styles.muted} data-testid={testId}>{relative}</Text>
  }
  const expires = showExpiry ? formatExpiresIn(createdAt, expiryMs) : ''
  return (
    <Stack direction="horizontal" gap="condensed" align="center" data-testid={testId} data-age-tier="aging">
      <Label variant="attention" size="small">{relative}</Label>
      {expires && <Text size="small" className={styles.muted}>{expires}</Text>}
    </Stack>
  )
}
