import { useTranslation } from 'react-i18next'
import { SegmentedControl, Stack, Text } from '@primer/react'
import { setCanvasNavigationMode, useCanvasNavigationMode } from '../shared/canvasNavigation'
import styles from '../shared/ListCard.module.css'

// Settings > General's "Canvas navigation" choice (goal 0257): the
// per-device scroll-gesture mode every interactive canvas follows
// (shared/canvasNavigation.ts). Self-contained -- reads and writes the
// shared store directly, so SettingsView carries no state for it.
export function CanvasNavigationControl() {
  const { t } = useTranslation('views')
  const mode = useCanvasNavigationMode()
  return (
    <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-16)' }}>
      <Text as="p" size="small" weight="semibold">{t('settings.general.canvasNavigationLabel')}</Text>
      <SegmentedControl
        aria-label={t('settings.general.canvasNavigationLabel')}
        onChange={(i) => setCanvasNavigationMode(i === 1 ? 'mouse' : 'trackpad')}
        data-testid="canvas-navigation-control"
      >
        <SegmentedControl.Button selected={mode === 'trackpad'}>
          {t('settings.general.canvasNavigationTrackpad')}
        </SegmentedControl.Button>
        <SegmentedControl.Button selected={mode === 'mouse'}>
          {t('settings.general.canvasNavigationMouse')}
        </SegmentedControl.Button>
      </SegmentedControl>
      <Text as="p" size="small" className={styles.muted} data-testid="canvas-navigation-caption">
        {mode === 'mouse'
          ? t('settings.general.canvasNavigationMouseCaption')
          : t('settings.general.canvasNavigationTrackpadCaption')}
      </Text>
    </Stack>
  )
}
