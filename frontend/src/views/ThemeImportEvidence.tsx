import { Stack, Text } from '@primer/react'
import { useTranslation } from 'react-i18next'
import type { ThemeImportMetadata } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { AdvancedDisclosure } from '../shared/AdvancedDisclosure'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// The adapter's receipt is useful after installation too: it explains which
// source bytes produced this extension and how much of the source palette the
// fixed mapper understood. Keep paths out of this surface; the receipt stores
// the original basename and content hash instead.
export function ThemeImportEvidence({ metadata, compact = false }: {
  metadata: ThemeImportMetadata
  compact?: boolean
}) {
  const { t } = useTranslation('views')
  return (
    <Stack direction="vertical" gap="condensed" data-testid="extensions-theme-import-evidence">
      <Text as="p" size="small" className={listStyles.muted}>
        {t('extensions.themeImport.installedSource', { file: metadata.sourceName })}
      </Text>
      <Text as="p" size="small" className={`${listStyles.muted} ${styles.themeImportHash}`} data-testid="extensions-theme-import-hash">
        {t('extensions.themeImport.installedHash', { hash: metadata.sourceSHA256 })}
      </Text>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('extensions.themeImport.installedMapper', { version: metadata.mapperVersion })}
      </Text>
      {!compact && (
        <>
          <Text as="p" size="small">
            {t('extensions.themeImport.summary', { mapped: metadata.mapped, total: metadata.total })}
          </Text>
          <AdvancedDisclosure open={false} testId="extensions-theme-import-compatibility" summary={t('extensions.themeImport.compatibility')}>
            <EvidenceList label={t('extensions.themeImport.used')} keys={metadata.mappedKeys ?? []} />
            <EvidenceList label={t('extensions.themeImport.unmapped')} keys={metadata.unmappedKeys ?? []} />
            {(metadata.invalidKeys?.length ?? 0) > 0 && (
              <EvidenceList label={t('extensions.themeImport.invalid')} keys={metadata.invalidKeys ?? []} />
            )}
          </AdvancedDisclosure>
        </>
      )}
    </Stack>
  )
}

function EvidenceList({ label, keys }: { label: string; keys: string[] }) {
  const { t } = useTranslation('views')
  return (
    <Stack direction="vertical" gap="none">
      <Text size="small" weight="semibold">{label}</Text>
      <Text as="p" size="small" className={listStyles.muted}>
        {keys.length > 0 ? keys.join(', ') : t('extensions.themeImport.none')}
      </Text>
    </Stack>
  )
}
