import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AdvancedDisclosure as SharedAdvancedDisclosure } from '../shared/AdvancedDisclosure'

// configure/'s own thin wrapper over the promoted shared/AdvancedDisclosure.tsx
// (goal 0405 S1): every existing `<AdvancedDisclosure open testId>` call
// site here is unaffected -- only the "Advanced" summary copy itself
// still resolves from the configure locale namespace.
export function AdvancedDisclosure({ open, testId, children }: {
  open: boolean
  testId: string
  children: ReactNode
}) {
  const { t } = useTranslation('configure')
  return (
    <SharedAdvancedDisclosure open={open} testId={testId} summary={t('advancedDisclosure.summary')}>
      {children}
    </SharedAdvancedDisclosure>
  )
}
