import { KeybindingHint } from '@primer/react/experimental'
import { hintKeysFromLabel } from './keybinding'
import { useCommandBinding } from './hotkeyHintLogic'

// Renders nothing for a command with no binding (defaultBinding null
// and no override) -- never a placeholder/broken chip, per this goal's
// own acceptance bar. commandId is intentionally loose (a plain
// string, not a Command['id'] union) since every caller sources it
// from shared/commands.ts's own COMMANDS list already, not a literal.
// The wrapping span carries the stable testid/data-command-id --
// KeybindingHint (@primer/react/experimental, goal 0405 S1's
// KeyComboChip replacement) forwards only its own named props, never
// arbitrary rest attributes.
export function HotkeyHint({ commandId }: { commandId: string }) {
  const label = useCommandBinding(commandId)
  if (!label) return null
  return (
    <span data-testid="hotkey-hint" data-command-id={commandId}>
      <KeybindingHint keys={hintKeysFromLabel(label)} />
    </span>
  )
}
