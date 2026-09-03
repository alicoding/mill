import { useTranslation } from 'react-i18next'
import { SegmentedControl, Stack, Text } from '@primer/react'
import { setSaveMode, useSaveMode } from '../shared/saveMode'
import styles from '../shared/ListCard.module.css'

// Settings > General's "Save changes" choice (goal 0295 S2b): the app-
// level save mode every editing surface and the leave handshake follow
// (shared/saveMode.ts). Self-contained, same shape as
// CanvasNavigationControl -- reads and writes the shared store, so
// SettingsView carries no state for it.
export function SaveModeControl() {
  const { t } = useTranslation('views')
  const mode = useSaveMode()
  return (
    <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-16)' }}>
      <Text as="p" size="small" weight="semibold">{t('settings.general.saveModeLabel')}</Text>
      <SegmentedControl
        aria-label={t('settings.general.saveModeLabel')}
        onChange={(i) => { void setSaveMode(i === 1 ? 'explicit' : 'automatic').catch(console.error) }}
        data-testid="save-mode-control"
      >
        <SegmentedControl.Button selected={mode === 'automatic'}>
          {t('settings.general.saveModeAutomatic')}
        </SegmentedControl.Button>
        <SegmentedControl.Button selected={mode === 'explicit'}>
          {t('settings.general.saveModeExplicit')}
        </SegmentedControl.Button>
      </SegmentedControl>
      <Text as="p" size="small" className={styles.muted} data-testid="save-mode-caption">
        {mode === 'explicit'
          ? t('settings.general.saveModeExplicitCaption')
          : t('settings.general.saveModeAutomaticCaption')}
      </Text>
    </Stack>
  )
}
