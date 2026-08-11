import { useEffect, useState } from 'react'
import { Button, Stack, Text } from '@primer/react'
import { ShieldIcon } from '@primer/octicons-react'
import { Events } from '@wailsio/runtime'
import { SettingsService } from '../shared/bindings'
import type { MCPWriteRequest } from '../shared/bindings'
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
  const [pending, setPending] = useState<MCPWriteRequest[]>([])

  const refresh = () => {
    SettingsService.PendingMCPWrites().then((p) => setPending(p ?? [])).catch(() => {})
  }

  useEffect(() => {
    refresh()
    return Events.On('mcp-write-approval', () => refresh())
  }, [])

  const resolve = (id: string, approve: boolean) => {
    SettingsService.ResolveMCPWrite(id, approve).catch(() => {}).finally(refresh)
  }

  if (pending.length === 0) return null
  return (
    <div className={styles.mcpApprovalBanner} data-testid="mcp-write-approval-banner">
      {pending.map((p) => (
        <Stack key={p.id} direction="horizontal" gap="condensed" align="center" justify="space-between">
          <Stack direction="horizontal" gap="condensed" align="center">
            <ShieldIcon size={16} />
            <Text size="small" weight="semibold">{p.description}</Text>
          </Stack>
          <Stack direction="horizontal" gap="condensed">
            <Button size="small" variant="primary" onClick={() => resolve(p.id, true)}>Approve</Button>
            <Button size="small" variant="danger" onClick={() => resolve(p.id, false)}>Deny</Button>
          </Stack>
        </Stack>
      ))}
    </div>
  )
}
