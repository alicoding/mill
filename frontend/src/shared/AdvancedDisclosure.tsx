import type { ReactNode } from 'react'
import { Details, Stack } from '@primer/react'
import { ChevronRightIcon } from '@primer/octicons-react'
import own from './AdvancedDisclosure.module.css'

// A form/list's one disclosure (goal 0327, promoted to shared/ in goal
// 0405 S1 once Settings' own "Unbound ({n})" row needed the identical
// shell with a different summary than configure/'s "Advanced" --
// configure/AdvancedDisclosure.tsx is now a thin wrapper over this one,
// supplying its own copy so every existing caller there is unaffected):
// closed by default, one level only -- a form/list never nests a second
// disclosure inside this one. `summary` is caller-supplied (a resolved
// string or richer content, e.g. KeyboardShortcutsSection.tsx's own
// "Unbound (n)" count) rather than a locale key read internally, since
// callers now span more than one i18next namespace.
export function AdvancedDisclosure({ open, testId, summary, children }: {
  open: boolean
  testId: string
  summary: ReactNode
  children: ReactNode
}) {
  return (
    <Details open={open || undefined} data-testid={testId}>
      <Details.Summary className={own.summary} data-testid={`${testId}-summary`}>
        <ChevronRightIcon size={16} className={own.chevron} aria-hidden />
        {summary}
      </Details.Summary>
      <Stack direction="vertical" gap="condensed" className={own.body}>
        {children}
      </Stack>
    </Details>
  )
}
