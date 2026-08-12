import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { ShieldIcon } from '@primer/octicons-react'
import { Events } from '@wailsio/runtime'
import { SettingsService } from '../shared/bindings'
import type { MCPWriteRequest } from '../shared/bindings'
import { StalenessBadge } from '../shared/StalenessBadge'
import styles from './App.module.css'

// The per-write MCP approval surface (docs/adr/0032's park-and-poll
// lifecycle, superseding ADR-0017/0022's old bounded-blocking-wait
// shape): when an external MCP client asks to write and the per-write
// toggle is on, the write parks as a durable record -- surviving even a
// Mill restart -- while this banner (the co-present shortcut) and the
// Review queue (ReviewView.tsx, always-durable surface) both ask the
// human. Listens for the push event AND polls once on mount, so a
// request raised before this window rendered still shows up.
export function MCPWriteApprovals() {
  const { t } = useTranslation('app')
  const [pending, setPending] = useState<MCPWriteRequest[]>([])
  const [error, setError] = useState('')

  const refresh = () => {
    SettingsService.PendingMCPWrites().then((p) => setPending(p ?? [])).catch(() => {})
  }

  useEffect(() => {
    refresh()
    return Events.On('mcp-write-approval', () => refresh())
  }, [])

  // A direct user action's failure is SURFACED, never swallowed --
  // audit-caught (2026-08-11): this used to be `.catch(() => {})` while
  // ReviewView's resolveWrite for the identical action correctly showed
  // the error; two paths to one guarded action must both tell the user
  // when it didn't work. Background refresh above stays best-effort.
  const resolve = (id: string, approve: boolean) => {
    setError('')
    SettingsService.ResolveMCPWrite(id, approve).catch((err) => setError(String(err))).finally(refresh)
  }

  if (pending.length === 0 && !error) return null
  return (
    <div className={styles.mcpApprovalBanner} data-testid="mcp-write-approval-banner">
      {error && (
        <Text as="p" size="small" data-testid="mcp-write-approval-error">{error}</Text>
      )}
      {pending.map((p) => (
        <Stack key={p.id} direction="horizontal" gap="condensed" align="center" justify="space-between">
          <Stack direction="horizontal" gap="condensed" align="center">
            <ShieldIcon size={16} />
            <Text size="small" weight="semibold">{p.description}</Text>
            <StalenessBadge createdAt={p.createdAt} testId="mcp-write-approval-age" />
          </Stack>
          <Stack direction="horizontal" gap="condensed">
            <Button size="small" variant="primary" onClick={() => resolve(p.id, true)}>{t('common:actions.approve')}</Button>
            <Button size="small" variant="danger" onClick={() => resolve(p.id, false)}>{t('common:actions.deny')}</Button>
          </Stack>
        </Stack>
      ))}
    </div>
  )
}
