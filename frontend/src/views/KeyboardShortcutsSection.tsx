import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, Stack, Text, TextInput } from '@primer/react'
import { KeyIcon, SearchIcon } from '@primer/octicons-react'
import { COMMANDS, effectiveBinding } from '../shared/commands'
import type { KeyCombo } from '../shared/keybinding'
import { formatCombo } from '../shared/keybinding'
import { useAppStore } from '../shared/store'
import { useCommandKeybindingCapture } from '../composition/hotkeyCapture'
import styles from '../shared/ListCard.module.css'

// Settings → Keyboard Shortcuts (docs/goals/0016-keymap-system.md): a
// searchable list of every registered command (shared/commands.ts),
// each rebindable via the EXISTING press-to-capture recorder workflow
// hotkeys already use (composition/hotkeyCapture.ts's
// useCommandKeybindingCapture -- menu-accelerator suspension +
// OS-reserved-combo blocking come along for free, same hook). Conflict
// checking is split across both sides on purpose: this frontend module
// is the only place that knows every command's DEFAULT binding, so a
// clash against a still-default command is caught here before
// SetKeybinding is ever called; a clash against another OVERRIDDEN
// command or a workflow's trigger hotkey is caught server-side
// (settingsservice_keymap.go's own doc comment covers why the backend
// can't do the former).
//
// `role="list"` on the ActionList container (not decorative -- see
// shared/InventoryList.tsx's own header comment) is what lets each row
// nest real interactive buttons (Change/Reset) as valid HTML instead of
// a <button> inside a <button>.
export default function KeyboardShortcutsSection() {
  const { t } = useTranslation('views')
  const [query, setQuery] = useState('')
  const keybindingOverrides = useAppStore((s) => s.keybindingOverrides)

  const q = query.trim().toLowerCase()
  const filtered = q === ''
    ? COMMANDS
    : COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))

  return (
    <Stack direction="vertical" gap="condensed">
      <TextInput
        leadingVisual={SearchIcon}
        placeholder={t('keyboardShortcutsSection.searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t('keyboardShortcutsSection.searchAriaLabel')}
        data-testid="keymap-search"
        block
      />
      {filtered.length === 0 ? (
        <Text as="p" size="small" className={styles.muted}>{t('keyboardShortcutsSection.noMatches', { query })}</Text>
      ) : (
        <ActionList role="list" showDividers data-testid="keymap-list">
          {filtered.map((command) => (
            <ActionList.Item key={command.id} data-testid="keymap-row" data-command-id={command.id}>
              <KeymapRow
                commandId={command.id}
                label={command.label}
                binding={effectiveBinding(command, keybindingOverrides)}
                isOverridden={command.id in keybindingOverrides}
              />
            </ActionList.Item>
          ))}
        </ActionList>
      )}
    </Stack>
  )
}

function KeymapRow({ commandId, label, binding, isOverridden }: {
  commandId: string
  label: string
  binding: KeyCombo | null
  isOverridden: boolean
}) {
  const { t } = useTranslation('views')
  const hk = useCommandKeybindingCapture(commandId)

  // hk.binding only ever reflects a real OVERRIDE (useCommandKeybindingCapture
  // reads SettingsService.ListKeybindings, which never carries a
  // frontend-only default) -- falls back to the merged `binding` prop
  // (shared/commands.ts's effectiveBinding) for a still-default command.
  const displayLabel = hk.binding ?? (binding ? formatCombo(binding.mods, binding.key) : t('keyboardShortcutsSection.unbound'))

  return (
    <Stack direction="vertical" gap="none" style={{ width: '100%' }}>
      <Stack direction="horizontal" gap="condensed" align="center" justify="space-between">
        <Text size="small">{label}</Text>
        <Stack direction="horizontal" gap="condensed" align="center">
          {hk.recording ? (
            <Text size="small" className={styles.recording}>{t('keyboardShortcutsSection.pressCombo')}</Text>
          ) : (
            <Button
              size="small"
              variant="invisible"
              leadingVisual={KeyIcon}
              title={t('keyboardShortcutsSection.clickToChange')}
              onClick={hk.startRecording}
              data-testid="keymap-row-combo"
            >
              {displayLabel}
            </Button>
          )}
          {isOverridden && !hk.recording && (
            <Button size="small" variant="invisible" onClick={hk.clear} data-testid="keymap-row-reset">
              {t('keyboardShortcutsSection.reset')}
            </Button>
          )}
        </Stack>
      </Stack>
      {hk.error && <Text as="p" size="small" className={styles.error}>{hk.error}</Text>}
    </Stack>
  )
}
