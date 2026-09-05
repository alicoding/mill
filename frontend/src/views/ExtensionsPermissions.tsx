import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import type { InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { permissionLines } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// "What it can do" (docs/goals/0349): the same list in both places it
// belongs -- above every install prompt, and on an installed
// extension's Verification tab. One component, so the sentences a
// person agreed to are the sentences they can re-read later.
export function ExtensionsPermissions({ preview, testId }: {
  preview: InstallPreview | null
  testId?: string
}) {
  const { t } = useTranslation('views')
  const lines = permissionLines(preview)
  if (lines.length === 0) return null
  return (
    <Stack direction="vertical" gap="none" data-testid={testId ?? 'extensions-permissions'}>
      <Text as="h4" size="small" weight="semibold">{t('extensions.canHeading')}</Text>
      <ul aria-label={t('extensions.canHeading')} className={styles.plainList}>
        {lines.map((line) => (
          <li key={`${line.key}:${line.params?.list ?? line.params?.kind ?? ''}`}>
            <Text size="small" className={listStyles.muted}>{t(line.key, line.params)}</Text>
          </li>
        ))}
      </ul>
    </Stack>
  )
}
