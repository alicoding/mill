import { IconButton, Stack } from '@primer/react'
import { PinIcon } from '@primer/octicons-react'
import { KeyComboChip } from '../shared/KeyComboChip'

// The workflow-row trailing-visual composition app/CommandPalette.tsx
// and app/QuickPanel.tsx both need: an optional hotkey-trigger combo
// chip (docs/goals/0015-summon-quick-invoke.md's workflow-trigger
// remainder -- display-when-configured, the same simplification
// composition/TriggerRowLabel.tsx's own armed-state handling already
// established: this shows the combo only, never the live armed fact)
// plus the pin toggle (docs/goals/BACKLOG.md Standing #5). Each caller
// still owns its own CSS module import for the pinned/unpinned
// classNames -- see either module's own comment for why those stay
// duplicated rather than promoted here too.
export function WorkflowRowTrailingVisual({
  combo, pinned, pinnedClassName, unpinnedClassName, pinAriaLabel, onTogglePin,
}: {
  combo?: string
  pinned: boolean
  pinnedClassName: string
  unpinnedClassName: string
  pinAriaLabel: string
  onTogglePin: () => void
}) {
  return (
    <Stack direction="horizontal" gap="condensed" align="center">
      {combo && <KeyComboChip label={combo} data-testid="workflow-hotkey-chip" />}
      <IconButton
        icon={PinIcon}
        aria-label={pinAriaLabel}
        size="small"
        variant="invisible"
        className={pinned ? pinnedClassName : unpinnedClassName}
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin()
        }}
      />
    </Stack>
  )
}
