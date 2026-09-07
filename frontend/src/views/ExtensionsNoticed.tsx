import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import { withoutRuleNumber } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// What the install checks noticed but did not refuse (goal 0349 S6):
// code Mill can't read easily, a bundled library naming a host. Shown
// in the install prompt and again on the Verification tab, the same
// one-component rule ExtensionsPermissions follows -- the sentences a
// person weighed before installing are the sentences they re-read.
// Each finding arrives as "standard rule N: file: sentence"; the rule
// number is the author's, so only the file and the sentence render.
export function ExtensionsNoticed({ warnings, testId }: {
  warnings: string[]
  testId: string
}) {
  const { t } = useTranslation('views')
  if (warnings.length === 0) return null
  return (
    <Stack direction="vertical" gap="none" data-testid={testId}>
      <Text as="h4" size="small" weight="semibold">{t('extensions.noticedHeading')}</Text>
      <ul aria-label={t('extensions.noticedHeading')} className={styles.plainList}>
        {warnings.map((line) => (
          <li key={line}>
            <Text size="small" className={listStyles.muted}>{withoutRuleNumber(line)}</Text>
          </li>
        ))}
      </ul>
    </Stack>
  )
}

