import { useEffect, useMemo, useState } from 'react'
import { Button, Stack, Text } from '@primer/react'
import { ShieldIcon } from '@primer/octicons-react'
import { Events } from '@wailsio/runtime'
import { ExecutionService, SettingsService } from '../shared/bindings'
import type { RunSummary, MCPWriteRequest } from '../shared/bindings'
import { StalenessBadge } from '../shared/StalenessBadge'
import styles from './ApprovalPrompt.module.css'

// docs/goals/0023-attention-escalation.md item 1: the floating
// approval-prompt window's own content -- the incoming-call/askpass
// pattern. Shows the OLDEST unresolved pending item across both
// pending sources (a guardrail/human-review park, an MCP write) --
// mirrors ReviewView.tsx's own two-source read (ExecutionService.ListRuns
// filtered on r.pending + SettingsService.PendingMCPWrites), but renders
// only the single oldest item rather than a full inbox, since this
// window is a small floating surface, not a second Review queue.
//
// An MCP write gets Approve/Deny inline (SettingsService.ResolveMCPWrite,
// the same RPC MCPWriteApprovals.tsx/ReviewView.tsx already call). A
// guardrail/human-review park gets an "Open in Mill" button instead --
// never blind-approve, mirroring the OS-notification split
// (settingsservice_attention.go's own NotifyPendingApproval doc
// comment): typed input may be required to resolve one of those.
//
// After resolving (or once nothing is left to show), the window
// auto-hides via SettingsService.DismissApprovalPrompt -- the
// DismissPanel-equivalent RPC for this window (ADR-0033's own
// focus-yield mitigation applies there, Go-side).

type PromptItem =
  | { kind: 'mcp-write'; id: string; description: string; time: number }
  | { kind: 'guardrail'; id: string; description: string; time: number }

export function ApprovalPrompt() {
  const [guardrail, setGuardrail] = useState<RunSummary[]>([])
  const [mcpWrites, setMcpWrites] = useState<MCPWriteRequest[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const refresh = () => {
    Promise.all([
      ExecutionService.ListRuns().then((runs) => (runs ?? []).filter((r) => r.pending)).catch(() => []),
      SettingsService.PendingMCPWrites().then((p) => p ?? []).catch(() => []),
    ]).then(([g, m]) => {
      setGuardrail(g)
      setMcpWrites(m)
      setLoaded(true)
    })
  }

  // This window's own React tree is created once at Go startup and
  // never remounted (Show()/Hide() just toggle native visibility, same
  // as QuickPanel) -- refetch on every regained visibility/focus so a
  // resolution made elsewhere (the Review queue, a canvas approve) is
  // never stale here, plus the two push events every other pending
  // surface already listens to, plus a short poll as a backstop.
  useEffect(() => {
    refresh()
    const offGuardrail = Events.On('guardrail-pending-changed', refresh)
    const offMCP = Events.On('mcp-write-approval', refresh)
    const timer = window.setInterval(refresh, 2000)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    return () => {
      offGuardrail()
      offMCP()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const items = useMemo<PromptItem[]>(() => {
    const g: PromptItem[] = guardrail.map((r) => ({
      kind: 'guardrail',
      id: r.runID,
      description: `${r.workflowLabel}: ${r.pending?.nodeTypeLabel || r.pending?.nodeTypeID || 'a step'} needs approval`,
      time: Date.parse(r.startedAt),
    }))
    const m: PromptItem[] = mcpWrites.map((w) => ({
      kind: 'mcp-write',
      id: w.id,
      description: w.description,
      time: Date.parse(w.createdAt),
    }))
    return [...g, ...m].sort((a, b) => a.time - b.time)
  }, [guardrail, mcpWrites])

  const oldest = items[0] ?? null

  // Auto-hide once there's nothing left to show -- gated on `loaded` so
  // the very first render (before the first fetch resolves, both lists
  // still empty) never dismisses a window that was just shown for a
  // real item still in flight over the wire.
  useEffect(() => {
    if (loaded && items.length === 0) {
      void SettingsService.DismissApprovalPrompt().catch(() => {})
    }
  }, [loaded, items.length])

  const resolveWrite = (id: string, approve: boolean) => {
    setError('')
    SettingsService.ResolveMCPWrite(id, approve).then(refresh).catch((err) => setError(String(err)))
  }

  const openInMill = () => {
    void SettingsService.OpenMainWindow('review').catch(() => {})
    void SettingsService.DismissApprovalPrompt().catch(() => {})
  }

  return (
    <div className={styles.prompt} data-testid="approval-prompt">
      {oldest && (
        <Stack direction="vertical" gap="condensed">
          <Stack direction="horizontal" gap="condensed" align="center">
            <ShieldIcon size={16} />
            <Text weight="semibold" size="small" data-testid="approval-prompt-description">{oldest.description}</Text>
          </Stack>
          <StalenessBadge createdAt={new Date(oldest.time)} testId="approval-prompt-age" />
          {items.length > 1 && (
            <Text size="small" className={styles.muted}>+{items.length - 1} more waiting</Text>
          )}
          {oldest.kind === 'mcp-write' ? (
            <Stack direction="horizontal" gap="condensed">
              <Button size="small" variant="primary" onClick={() => resolveWrite(oldest.id, true)} data-testid="approval-prompt-approve">
                Approve
              </Button>
              <Button size="small" variant="danger" onClick={() => resolveWrite(oldest.id, false)} data-testid="approval-prompt-deny">
                Deny
              </Button>
            </Stack>
          ) : (
            <Button size="small" variant="primary" onClick={openInMill} data-testid="approval-prompt-open">
              Open in Mill
            </Button>
          )}
          {error && <Text size="small" className={styles.error}>{error}</Text>}
        </Stack>
      )}
      {!oldest && loaded && (
        <Text size="small" className={styles.muted} data-testid="approval-prompt-empty">No pending approvals.</Text>
      )}
    </div>
  )
}
