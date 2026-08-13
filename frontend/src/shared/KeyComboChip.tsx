import type { HTMLAttributes } from 'react'
import styles from './KeyComboChip.module.css'

// The one presentational renderer for an already-formatted key combo
// string (design-wave-1 fix #5) -- a dumb wrapper around a `label`, not
// coupled to a Command id or the keybinding store the way
// app/HotkeyHint.tsx's own commandId-driven component is (that
// component renders through this one internally). Lives in shared/
// specifically so views/ (KeyboardShortcutsSection.tsx) and
// composition/ (TriggerRowLabel.tsx's per-workflow hotkey-trigger row,
// which has no Command id to resolve at all) can both render a combo
// through the exact same chip app/'s inline hints already use, without
// either importing app/ (dependency-cruiser forbids both
// "views-must-not-depend-on-app" and composition/configure depending
// on views-or-app).
export function KeyComboChip({ label, ...rest }: { label: string } & HTMLAttributes<HTMLSpanElement>) {
  // A stable default testid (overridable, e.g. HotkeyHint.tsx's own
  // "hotkey-hint" for backward compatibility with its existing e2e
  // coverage) -- callers that render this inside a Primer `Button`
  // (KeyboardShortcutsSection.tsx, TriggerRowLabel.tsx) need a way to
  // select just this span, not the button's own internal wrapper spans
  // (`Button`'s compiled DOM nests 3-4 of its own around any children).
  const testId = 'data-testid' in rest ? rest['data-testid'] : 'key-combo-chip'
  return (
    <span className={styles.hint} {...rest} data-testid={testId}>
      {label}
    </span>
  )
}
