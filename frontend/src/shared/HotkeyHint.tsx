import { KeyComboChip } from './KeyComboChip'
import { useCommandBinding } from './hotkeyHintLogic'

// Renders nothing for a command with no binding (defaultBinding null
// and no override) -- never a placeholder/broken chip, per this goal's
// own acceptance bar. commandId is intentionally loose (a plain
// string, not a Command['id'] union) since every caller sources it
// from shared/commands.ts's own COMMANDS list already, not a literal.
export function HotkeyHint({ commandId }: { commandId: string }) {
  const label = useCommandBinding(commandId)
  if (!label) return null
  return <KeyComboChip label={label} data-testid="hotkey-hint" data-command-id={commandId} />
}
