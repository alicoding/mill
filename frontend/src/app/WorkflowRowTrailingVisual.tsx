import { Stack } from '@primer/react'
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
      {/* A plain role=button, never a focusable control: the list's
          focus zone counts every element carrying a tabindex as a
          stop, so a real button here became the first ArrowDown target
          on WebKit (goal 0303) and its 28px box grew the row. Keyboard
          pinning stays on the row's own ⌘⇧P. */}
      <span
        role="button"
        aria-label={pinAriaLabel}
        title={pinAriaLabel}
        className={pinned ? pinnedClassName : unpinnedClassName}
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin()
        }}
      >
        <PinIcon size={16} />
      </span>
    </Stack>
  )
}
