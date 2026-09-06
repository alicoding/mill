import { Button, Stack } from '@primer/react'
import { StopIcon, UnlockIcon } from '@primer/octicons-react'
import { commandAvailable, commandLabel, findCommand, runCommand } from './commands'
import type { CommandContext } from './commandContext'

// The two actions a vault wait offers, wherever it is rendered (Review,
// the Runs tab, the canvas dock): Unlock vault and Stop run -- both the
// registry commands the palette already has, with their own labels and
// their own enablement, never a second implementation.
export function VaultWaitActions({ ctx, testIdPrefix, onClick }: {
  ctx: CommandContext
  testIdPrefix: string
  onClick?: (e: React.MouseEvent) => void
}) {
  const unlock = findCommand('secrets.unlockVault')
  const stop = findCommand('run.stop')
  if (!unlock || !stop) return null
  return (
    <Stack direction="horizontal" gap="condensed" onClick={onClick}>
      <Button
        size="small"
        variant="primary"
        leadingVisual={UnlockIcon}
        disabled={!commandAvailable(unlock)}
        data-testid={`${testIdPrefix}-unlock-vault`}
        onClick={() => { void runCommand('secrets.unlockVault') }}
      >
        {commandLabel(unlock)}
      </Button>
      <Button
        size="small"
        variant="danger"
        leadingVisual={StopIcon}
        disabled={!commandAvailable(stop, ctx)}
        data-testid={`${testIdPrefix}-stop-run`}
        onClick={() => { void runCommand('run.stop', ctx) }}
      >
        {commandLabel(stop)}
      </Button>
    </Stack>
  )
}
