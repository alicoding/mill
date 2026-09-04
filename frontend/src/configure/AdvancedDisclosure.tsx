import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Details, Stack } from '@primer/react'
import { ChevronRightIcon } from '@primer/octicons-react'
import own from './AdvancedDisclosure.module.css'

// A Configure form's one disclosure (goal 0327): the rare fields a
// form's tier 1 must not carry, closed by default and open whenever
// anything inside holds a value, so an edited record shows its own
// settings without a hunt. One level only -- a form never nests a
// second disclosure inside this one.
//
// Extracted from the Integration form's own Advanced section (goal
// 0315) once the Execution environment form needed the identical
// shape; the summary reads like a sibling section heading.
export function AdvancedDisclosure({ open, testId, children }: {
  open: boolean
  testId: string
  children: ReactNode
}) {
  const { t } = useTranslation('configure')
  return (
    <Details open={open || undefined} data-testid={testId}>
      <Details.Summary className={own.summary} data-testid={`${testId}-summary`}>
        <ChevronRightIcon size={16} className={own.chevron} aria-hidden />
        {t('advancedDisclosure.summary')}
      </Details.Summary>
      <Stack direction="vertical" gap="condensed" className={own.body}>
        {children}
      </Stack>
    </Details>
  )
}
