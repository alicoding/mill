import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Dialog, Link as PrimerLink, Stack } from '@primer/react'
import { KeybindingHint } from '@primer/react/experimental'
import { COMMANDS, commandLabel, effectiveBinding } from '../shared/commands'
import type { Command } from '../shared/commands'
import type { KeyCombo } from '../shared/keybinding'
import { formatCombo, hintKeysFromLabel } from '../shared/keybinding'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { groupCommandsBySurface } from '../shared/groupCommandsBySurface'
import styles from './ShortcutsHelpDialog.module.css'

// The bare-?/⌘? shortcuts-help overlay (goal 0071): context-first, the
// same "here vs. everywhere" split GitHub's own shortcuts dialog uses
// (the goal file's own recorded research verdict) -- generated
// entirely from the command registry (shared/commands.ts), never a
// hand-maintained list. goal 0405 S1: sources its bound-only rows from
// shared/groupCommandsBySurface.ts, the SAME projection Settings'
// Keyboard Shortcuts editor groups by -- this dialog keeps its own
// "on this page" vs "everywhere" split rather than the full surface
// taxonomy, reading each surface group's `bound` bucket directly.

function chipLabelsFor(command: Command, overrides: Record<string, KeyCombo>): string[] {
  const binding = effectiveBinding(command, overrides)
  return [
    ...(binding ? [formatCombo(binding.mods, binding.key)] : []),
    ...(command.extraBindings ?? []).map((b) => formatCombo(b.mods, b.key)),
  ]
}

function ShortcutRow({ command, overrides }: { command: Command; overrides: Record<string, KeyCombo> }) {
  return (
    <ActionList.Item data-testid="shortcuts-help-row" data-command-id={command.id}>
      <Stack direction="horizontal" justify="space-between" align="center" style={{ width: '100%' }}>
        <span>{commandLabel(command)}</span>
        <Stack direction="horizontal" gap="condensed">
          {chipLabelsFor(command, overrides).map((label) => (
            <KeybindingHint key={label} keys={hintKeysFromLabel(label)} />
          ))}
        </Stack>
      </Stack>
    </ActionList.Item>
  )
}

export function ShortcutsHelpDialog() {
  const { t } = useTranslation('app')
  const open = useUISignalStore((s) => s.helpOpen)
  const closeHelp = useUISignalStore((s) => s.closeHelp)
  const setView = useAppStore((s) => s.setView)
  const activeKind = useAppStore((s) => s.view.kind)
  const keybindingOverrides = useAppStore((s) => s.keybindingOverrides)

  const groups = useMemo(() => groupCommandsBySurface(COMMANDS, keybindingOverrides), [keybindingOverrides])
  const onThisPage = useMemo(
    () => groups.find((g) => g.surface === activeKind)?.bound ?? [],
    [groups, activeKind],
  )
  const everywhere = useMemo(
    () => groups.find((g) => g.surface === 'everywhere')?.bound ?? [],
    [groups],
  )

  if (!open) return null

  return (
    <Dialog title={t('shortcutsHelp.title')} onClose={closeHelp} width="480px" data-component="shortcuts-help">
      <ActionList showDividers data-testid="shortcuts-help-list">
        {onThisPage.length > 0 && (
          <ActionList.Group>
            <ActionList.GroupHeading as="h3">{t('shortcutsHelp.onThisPage')}</ActionList.GroupHeading>
            {onThisPage.map((c) => (
              <ShortcutRow key={c.id} command={c} overrides={keybindingOverrides} />
            ))}
          </ActionList.Group>
        )}
        <ActionList.Group>
          <ActionList.GroupHeading as="h3">{t('shortcutsHelp.everywhere')}</ActionList.GroupHeading>
          {everywhere.map((c) => (
            <ShortcutRow key={c.id} command={c} overrides={keybindingOverrides} />
          ))}
        </ActionList.Group>
      </ActionList>
      <div className={styles.footer}>
        <PrimerLink
          as="button"
          type="button"
          onClick={() => {
            setView({ kind: 'settings', section: 'keyboard-shortcuts' })
            closeHelp()
          }}
          data-testid="shortcuts-help-rebind"
        >
          {t('shortcutsHelp.rebindInSettings')}
        </PrimerLink>
      </div>
    </Dialog>
  )
}
