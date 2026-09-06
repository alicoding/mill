import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { KeyIcon } from '@primer/octicons-react'
import { KeyComboChip } from '../shared/KeyComboChip'
import { SettingsService } from '../shared/bindings'
import { describeCombo, keyFromEventCode, modsFromEvent, reservedByMacOS } from '../shared/keybinding'
import { isAccessibilityError, ACCESSIBILITY_SETTINGS_URL } from '../composition/hotkeyCapture'
import KeyboardShortcutsSection from './KeyboardShortcutsSection'
import { SettingsRow } from './SettingsRow'
import listStyles from '../shared/ListCard.module.css'
import styles from './SettingsView.module.css'
import { background } from '../shared/background'
import { openExternalUrl } from '../shared/openExternal'

// Where the rest of the two trimmed captions lives (goal 0321): the
// commands reference names every command and how rebinding works.
const COMMANDS_DOCS_PAGE = 'reference/commands.md'

// Settings > Shortcuts (goal 0321): the global summon hotkey and the
// in-window keymap, one pane -- they were two separate sections of the
// old scroll, and a reader looking for "the shortcut for X" had no way
// to know which one to read. The recorder comes first (one binding,
// one row), the full command table below it.
export default function SettingsShortcutsPane() {
  const { t } = useTranslation('views')
  const [summonBinding, setSummonBinding] = useState<string | null>(null)
  const [summonRecording, setSummonRecording] = useState(false)
  const [summonError, setSummonError] = useState('')
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    SettingsService.GetSummonHotkey()
      .then((label) => setSummonBinding(label || null))
      .catch((err) => { console.error(err); setLoadError(true) })
  }, [])

  // Same menu-accelerator-suspension bracket as
  // composition/hotkeyCapture.ts's useHotkeyCapture -- see its own
  // comment for the full reasoning (an app-menu-reserved combo pressed
  // while a recorder was armed closed the window, since NSMenu's
  // performKeyEquivalent: intercepts the keypress before this listener
  // ever sees it). This is the third, independent recording surface;
  // duplicated here rather than generalizing onto useHotkeyCapture,
  // since the summon hotkey isn't workflow-scoped (useHotkeyCapture is
  // keyed by workflowId) and round-trips through
  // SettingsService.AssignSummonHotkey, not TriggerService.AssignHotkey.
  useEffect(() => {
    if (!summonRecording) return

    void background(SettingsService.SuspendMenuAccelerators(), 'settingsShortcutsPane.suspendMenuAccelerators')

    const onKeydown = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') {
        setSummonRecording(false)
        return
      }
      const key = keyFromEventCode(e.code)
      if (!key) return // modifier-only press, or an unsupported key -- keep waiting
      const mods = modsFromEvent(e)
      if (mods.length === 0) return // require at least one modifier

      const reserved = reservedByMacOS(mods, key)
      if (reserved) {
        setSummonRecording(false)
        setSummonError(t('settings.globalHotkey.reservedError', { combo: describeCombo(mods, key), reason: reserved }))
        return
      }

      setSummonRecording(false)
      setSummonError('')
      SettingsService.AssignSummonHotkey(mods, key)
        .then(setSummonBinding)
        .catch((err) => setSummonError(String(err)))
    }
    const onBlur = () => setSummonRecording(false)

    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('blur', onBlur)
      void background(SettingsService.RestoreMenuAccelerators(), 'settingsShortcutsPane.restoreMenuAccelerators')
    }
  }, [summonRecording, t])

  const clearSummonHotkey = () => {
    setSummonError('')
    void background(SettingsService.UnassignSummonHotkey().then(() => setSummonBinding(null)), 'settingsShortcutsPane.unassignSummonHotkey')
  }

  return (
    <>
      {loadError && (
        <Text as="p" size="small" className={listStyles.error} data-testid="settings-load-error">
          {t('settings.loadError')}
        </Text>
      )}
      <SettingsRow
        label={t('settings.globalHotkey.label')}
        caption={t('settings.globalHotkey.description')}
        docsPage={COMMANDS_DOCS_PAGE}
        control={() => (
          summonRecording ? (
            <Text size="small" className={listStyles.recording}>{t('settings.globalHotkey.recording')}</Text>
          ) : summonBinding ? (
            <>
              <KeyIcon size={12} />
              <KeyComboChip label={summonBinding} />
              <Button size="small" variant="invisible" onClick={() => setSummonRecording(true)}>{t('common:actions.change')}</Button>
              <Button size="small" variant="invisible" onClick={clearSummonHotkey}>{t('common:actions.clear')}</Button>
            </>
          ) : (
            <Button size="small" onClick={() => setSummonRecording(true)} data-testid="set-summon-hotkey">
              {t('settings.globalHotkey.setShortcut')}
            </Button>
          )
        )}
      />
      {summonError && (
        <Stack direction="vertical" gap="condensed">
          <Text as="p" size="small" className={listStyles.error}>{summonError}</Text>
          {isAccessibilityError(summonError) && (
            <Button size="small" onClick={() => openExternalUrl(ACCESSIBILITY_SETTINGS_URL)}>
              {t('settings.globalHotkey.openAccessibilitySettings')}
            </Button>
          )}
        </Stack>
      )}

      <div className={styles.panel}>
        <Text as="p" className={styles.rowLabel}>{t('settings.keyboardShortcuts.label')}</Text>
        <Text as="p" size="small" className={styles.rowCaption}>{t('settings.keyboardShortcuts.description')}</Text>
        <KeyboardShortcutsSection />
      </div>
    </>
  )
}
