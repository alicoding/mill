import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Stack, Text } from '@primer/react'
import { ShieldIcon, XIcon } from '@primer/octicons-react'
import { Events } from '@wailsio/runtime'
import { ExecutionService, SettingsService } from '../shared/bindings'
import { isVaultWait } from '../shared/parkReason'
import type { RunSummary, MCPWriteRequest } from '../shared/bindings'
import { StalenessBadge } from '../shared/StalenessBadge'
import styles from './ApprovalPrompt.module.css'
import { background } from '../shared/background'

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
  const { t } = useTranslation('app')
  const [guardrail, setGuardrail] = useState<RunSummary[]>([])
  const [mcpWrites, setMcpWrites] = useState<MCPWriteRequest[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  // The one dismiss path this window has, shared by the close control,
  // the empty-state fallback and "Open in Mill". The window is
  // frameless with no native close control, so a visible one is the
  // only way out that does not depend on the window having keyboard
  // focus (docs/goals/0344).
  const dismiss = useCallback(() => {
    void background(SettingsService.DismissApprovalPrompt(), 'approvalPrompt.dismissApprovalPrompt')
  }, [])

  const refresh = () => {
    void Promise.all([
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
      description: isVaultWait(r.pending)
          ? t('pendingVaultWaitDescription', { workflowLabel: r.workflowLabel })
          : t('pendingApprovalDescription', { workflowLabel: r.workflowLabel, step: r.pending?.nodeTypeLabel || r.pending?.nodeTypeID || t('pendingApprovalStepFallback') }),
      time: Date.parse(r.startedAt),
    }))
    const m: PromptItem[] = mcpWrites.map((w) => ({
      kind: 'mcp-write',
      id: w.id,
      description: w.description,
      time: Date.parse(w.createdAt),
    }))
    return [...g, ...m].sort((a, b) => a.time - b.time)
  }, [guardrail, mcpWrites, t])

  const oldest = items[0] ?? null

  // Auto-hide once there's nothing left to show -- gated on `loaded` so
  // the very first render (before the first fetch resolves, both lists
  // still empty) never dismisses a window that was just shown for a
  // real item still in flight over the wire.
  useEffect(() => {
    if (loaded && items.length === 0) {
      dismiss()
    }
  }, [loaded, items.length, dismiss])

  const resolveWrite = (id: string, approve: boolean) => {
    setError('')
    SettingsService.ResolveMCPWrite(id, approve).then(refresh).catch((err) => setError(String(err)))
  }

  const openInMill = () => {
    void background(SettingsService.OpenMainWindow('review'), 'approvalPrompt.openMainWindow')
    dismiss()
  }

  return (
    <div className={styles.prompt} data-testid="approval-prompt">
      <IconButton
        icon={XIcon}
        aria-label={t('approvalPrompt.close')}
        size="small"
        variant="invisible"
        className={styles.close}
        onClick={dismiss}
        data-testid="approval-prompt-close"
      />
      {oldest && (
        <Stack direction="vertical" gap="condensed">
          <Stack direction="horizontal" gap="condensed" align="center">
            <ShieldIcon size={16} />
            <Text weight="semibold" size="small" data-testid="approval-prompt-description">{oldest.description}</Text>
          </Stack>
          <StalenessBadge createdAt={new Date(oldest.time)} testId="approval-prompt-age" />
          {items.length > 1 && (
            <Text size="small" className={styles.muted}>{t('approvalPrompt.moreWaiting', { count: items.length - 1 })}</Text>
          )}
          {oldest.kind === 'mcp-write' ? (
            <Stack direction="horizontal" gap="condensed">
              <Button size="small" variant="primary" onClick={() => resolveWrite(oldest.id, true)} data-testid="approval-prompt-approve">
                {t('common:actions.approve')}
              </Button>
              <Button size="small" variant="danger" onClick={() => resolveWrite(oldest.id, false)} data-testid="approval-prompt-deny">
                {t('common:actions.deny')}
              </Button>
            </Stack>
          ) : (
            <Stack direction="horizontal" gap="condensed">
              <Button size="small" variant="primary" onClick={openInMill} data-testid="approval-prompt-open">
                {t('approvalPrompt.openInMill')}
              </Button>
              {/* Same navigation as "Open in Mill" -- Review's Queue tab
                  (door 1's landing spot) already shows this exact card
                  with its own "Always…" action once there. A distinct
                  button exists purely so the rule-authoring path is
                  discoverable straight from the toast, not buried behind
                  a generic "open the run" label. */}
              <Button size="small" variant="invisible" onClick={openInMill} data-testid="approval-prompt-set-rule">
                {t('approvalPrompt.setRule')}
              </Button>
            </Stack>
          )}
          {error && <Text size="small" className={styles.error}>{error}</Text>}
        </Stack>
      )}
      {!oldest && loaded && (
        <Text size="small" className={styles.muted} data-testid="approval-prompt-empty">{t('approvalPrompt.empty')}</Text>
      )}
    </div>
  )
}
