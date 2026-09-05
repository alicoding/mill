import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import listStyles from '../shared/ListCard.module.css'

// Updates (docs/goals/0349). Mill never checks on its own: an
// extension update is found because someone asked for one, the same
// rule every other outbound request here follows.
export function ExtensionsUpdatesTab() {
  const { t } = useTranslation('views')
  return (
    <Stack direction="vertical" gap="condensed" data-testid="extensions-updates">
      <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-updates-empty">
        {t('extensions.updates.empty')}
      </Text>
    </Stack>
  )
}
