import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import type { InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { permissionLines, type PermissionLine } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// One <ul> of permission lines, each with its optional caption
// (canvas-host's "not sandboxed" sentence) -- shared by the "now also
// asks to" block and the full list below it, so they read identically.
function PermissionListItems({ lines, ariaLabel }: { lines: PermissionLine[]; ariaLabel: string }) {
  const { t } = useTranslation('views')
  return (
    <ul aria-label={ariaLabel} className={styles.plainList}>
      {lines.map((line) => (
        <li key={`${line.key}:${line.params?.list ?? line.params?.kind ?? ''}`}>
          <Text size="small" className={listStyles.muted}>{t(line.key, line.params)}</Text>
          {line.captionKey && <Text as="p" size="small" className={listStyles.muted}>{t(line.captionKey)}</Text>}
        </li>
      ))}
    </ul>
  )
}

// "What it can do" (docs/goals/0349): the same list in both places it
// belongs -- above every install prompt, and on an installed
// extension's Verification tab. One component, so the sentences a
// person agreed to are the sentences they can re-read later.
//
// widened (docs/goals/0375 S2) is the NEW elements only, in the same
// shape: when present it renders a "now also asks to" block ABOVE the
// full list, since that is what changed since the user last agreed.
export function ExtensionsPermissions({ preview, widened, testId }: {
  preview: InstallPreview | null
  widened?: InstallPreview | null
  testId?: string
}) {
  const { t } = useTranslation('views')
  const lines = permissionLines(preview)
  const widenedLines = widened ? permissionLines(widened) : []
  if (lines.length === 0 && widenedLines.length === 0) return null
  return (
    <Stack direction="vertical" gap="condensed" data-testid={testId ?? 'extensions-permissions'}>
      {widenedLines.length > 0 && (
        <Stack direction="vertical" gap="none" data-testid="extensions-permissions-widened">
          <Text as="h4" size="small" weight="semibold">{t('extensions.widened.heading')}</Text>
          <Text as="p" size="small" className={listStyles.muted}>{t('extensions.widened.caption')}</Text>
          <PermissionListItems lines={widenedLines} ariaLabel={t('extensions.widened.heading')} />
        </Stack>
      )}
      {lines.length > 0 && (
        <Stack direction="vertical" gap="none">
          <Text as="h4" size="small" weight="semibold">{t('extensions.canHeading')}</Text>
          <PermissionListItems lines={lines} ariaLabel={t('extensions.canHeading')} />
        </Stack>
      )}
    </Stack>
  )
}
