import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { FileIcon } from '@primer/octicons-react'
import { AtlasService } from '../shared/bindings'
import { normalizeExternalURL } from '../shared/externalUrl'
import { extensionOf } from './unitRegistry'
import type { UnitRenderProps } from './unitRegistry'
import styles from './AtlasUnitIconFallback.module.css'

// The board-unit registry's floor (ADR-0043 §2): any card whose
// detected type has no registered renderer lands here instead of a
// dead drop -- a typed icon face, Open-externally always present. The
// resolved unit's own declared exporters (ADR-0043 §3, empty for
// every slice-1 unit) surface through the Export-as menu once that
// surface exists -- a later slice, not this box.
export function AtlasUnitIconFallback({ card }: UnitRenderProps) {
  const { t } = useTranslation('atlas')
  const ext = extensionOf(card.MirrorPath)
  const heading = ext ? t('unitFallback.heading', { type: ext.slice(1).toUpperCase() }) : card.Source ? t('unitFallback.linkHeading') : t('unitFallback.genericHeading')

  return (
    <Stack direction="vertical" gap="condensed" className={styles.wrap} data-testid="atlas-unit-icon-fallback">
      <span className={styles.glyph}>
        <FileIcon size={24} />
      </span>
      <Text weight="semibold">{heading}</Text>
      {ext && <span className={styles.extension}>{ext}</span>}
      <Text as="p" size="small">{t('unitFallback.caption')}</Text>
      {card.MirrorPath ? (
        <Button
          size="small"
          data-testid="atlas-unit-fallback-open"
          onClick={() => void AtlasService.OpenCardMirror(card.ID)}
        >
          {t('unitFallback.openExternally')}
        </Button>
      ) : card.Source ? (
        <Button
          as="a"
          size="small"
          data-testid="atlas-unit-fallback-open"
          href={normalizeExternalURL(card.Source)}
          data-wml-openURL={normalizeExternalURL(card.Source)}
        >
          {t('unitFallback.openLink')}
        </Button>
      ) : null}
    </Stack>
  )
}
