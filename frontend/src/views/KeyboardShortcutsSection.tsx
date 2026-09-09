import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, SegmentedControl, Stack, Text, TextInput } from '@primer/react'
import { KeybindingHint } from '@primer/react/experimental'
import { KeyIcon, SearchIcon } from '@primer/octicons-react'
import { COMMANDS, commandLabel, effectiveBinding } from '../shared/commands'
import { isKeyboardDispatchable } from '../shared/ambientContext'
import type { KeyCombo } from '../shared/keybinding'
import { formatCombo, hintKeysFromLabel } from '../shared/keybinding'
import { useAppStore } from '../shared/store'
import { AdvancedDisclosure } from '../shared/AdvancedDisclosure'
import {
  countCommandsByFacet, filterCommandsByChord, filterCommandsByFacet, groupCommandsBySurface,
  type ShortcutFacet, type SurfaceGroup,
} from '../shared/groupCommandsBySurface'
import { useCommandKeybindingCapture, useShortcutSearchCapture } from '../composition/hotkeyCapture'
import styles from '../shared/ListCard.module.css'
import { searchInputTextAssistOff } from '../shared/searchInputProps'

// Settings → Keyboard Shortcuts (docs/goals/0405-shortcuts-editor-precedent.md
// Decisions 1-7): grouped by surface, bound-first, the unbound tail
// collapsed per group rather than an endless flat scroll -- VS Code's
// own "searchable, never hidden" answer to the same question, adapted
// to Mill's own conflict model (assign-time refusal means no Conflicts
// facet can ever have a member, a design fact, not an omission).
// Rebinding stays the EXISTING press-to-capture recorder workflow
// hotkeys already use (composition/hotkeyCapture.ts's
// useCommandKeybindingCapture); "find by shortcut" reuses the same
// underlying capture mechanics via useShortcutSearchCapture, which
// assigns nothing -- it only reports the pressed chord to filter by.
//
// `role="list"` on each ActionList container (not decorative -- see
// shared/InventoryList.tsx's own header comment) is what lets each row
// nest real interactive buttons (Change/Reset) as valid HTML instead of
// a <button> inside a <button>.
export default function KeyboardShortcutsSection() {
  const { t } = useTranslation('views')
  const [query, setQuery] = useState('')
  const [facet, setFacet] = useState<ShortcutFacet>('all')
  const [chord, setChord] = useState<KeyCombo | null>(null)
  const keybindingOverrides = useAppStore((s) => s.keybindingOverrides)
  const find = useShortcutSearchCapture((mods, key) => setChord({ mods, key }))

  // hintOnly commands dispatch through a dedicated listener elsewhere,
  // and a command needing a target the keydown dispatcher cannot
  // resolve (a Configure row's own Delete) has no keystroke that could
  // ever reach it -- rebinding either here would silently do nothing,
  // so both are excluded from the list entirely
  // (shared/ambientContext.ts).
  const rebindable = COMMANDS.filter(isKeyboardDispatchable)
  const q = query.trim().toLowerCase()
  const base = chord
    ? filterCommandsByChord(rebindable, keybindingOverrides, chord)
    : q === ''
      ? rebindable
      : rebindable.filter((c) => commandLabel(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q))

  const counts = countCommandsByFacet(base, keybindingOverrides)
  const visible = filterCommandsByFacet(base, keybindingOverrides, facet)
  const groups = groupCommandsBySurface(visible, keybindingOverrides)
  // A non-empty search or the Unbound facet reveals every matching
  // unbound row automatically (Decision 1) -- find-by-shortcut mode
  // never needs this: a chord can never match an unbound command, so
  // every group's own `unbound` bucket is already empty there.
  const unboundOpen = facet === 'unbound' || q !== ''

  const clearChord = () => setChord(null)

  return (
    <Stack direction="vertical" gap="condensed">
      <Stack direction="horizontal" gap="condensed" align="center">
        <TextInput
          leadingVisual={SearchIcon}
          placeholder={t('keyboardShortcutsSection.searchPlaceholder')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); clearChord() }}
          aria-label={t('keyboardShortcutsSection.searchAriaLabel')}
          {...searchInputTextAssistOff}
          data-testid="keymap-search"
          block
        />
        {find.recording ? (
          <Text size="small" className={styles.recording}>{t('keyboardShortcutsSection.findByShortcutPrompt')}</Text>
        ) : (
          <Button
            size="small"
            variant="invisible"
            leadingVisual={KeyIcon}
            title={t('keyboardShortcutsSection.findByShortcut')}
            onClick={chord ? clearChord : find.startRecording}
            data-testid="keymap-find-by-shortcut"
          >
            {chord ? <KeybindingHint keys={hintKeysFromLabel(formatCombo(chord.mods, chord.key))} /> : t('keyboardShortcutsSection.findByShortcut')}
          </Button>
        )}
      </Stack>

      <SegmentedControl aria-label={t('keyboardShortcutsSection.facetsAriaLabel')} onChange={(i) => setFacet((['all', 'bound', 'unbound', 'customised'] as const)[i])}>
        <SegmentedControl.Button selected={facet === 'all'} count={counts.all} data-testid="keymap-facet-all">
          {t('keyboardShortcutsSection.facets.all')}
        </SegmentedControl.Button>
        <SegmentedControl.Button selected={facet === 'bound'} count={counts.bound} data-testid="keymap-facet-bound">
          {t('keyboardShortcutsSection.facets.bound')}
        </SegmentedControl.Button>
        <SegmentedControl.Button
          selected={facet === 'unbound'} count={counts.unbound} data-testid="keymap-facet-unbound"
          aria-label={t('keyboardShortcutsSection.facets.unboundAriaLabel', { n: counts.unbound })}
        >
          {t('keyboardShortcutsSection.facets.unbound')}
        </SegmentedControl.Button>
        <SegmentedControl.Button selected={facet === 'customised'} count={counts.customised} data-testid="keymap-facet-customised">
          {t('keyboardShortcutsSection.facets.customised')}
        </SegmentedControl.Button>
      </SegmentedControl>

      {groups.length === 0 ? (
        <Text as="p" size="small" className={styles.muted}>
          {chord ? t('keyboardShortcutsSection.noMatchesForShortcut') : t('keyboardShortcutsSection.noMatches', { query })}
        </Text>
      ) : (
        groups.map((group) => <SurfaceGroupBlock key={group.surface} group={group} unboundOpen={unboundOpen} overrides={keybindingOverrides} />)
      )}
    </Stack>
  )
}

function SurfaceGroupBlock({ group, unboundOpen, overrides }: { group: SurfaceGroup; unboundOpen: boolean; overrides: Record<string, KeyCombo> }) {
  const { t } = useTranslation('views')
  return (
    <Stack direction="vertical" gap="none">
      <ActionList role="list" showDividers data-testid="keymap-list" data-surface={group.surface}>
        <ActionList.Group>
          <ActionList.GroupHeading as="h3">{t(group.label)}</ActionList.GroupHeading>
          {group.bound.map((command) => (
            <ActionList.Item key={command.id} data-testid="keymap-row" data-command-id={command.id}>
              <KeymapRow
                commandId={command.id}
                label={commandLabel(command)}
                binding={effectiveBinding(command, overrides)}
                isOverridden={command.id in overrides}
                extraBindings={command.extraBindings}
              />
            </ActionList.Item>
          ))}
        </ActionList.Group>
      </ActionList>
      {group.unbound.length > 0 && (
        <AdvancedDisclosure
          open={unboundOpen}
          testId={`keymap-unbound-${group.surface}`}
          summary={t('keyboardShortcutsSection.unboundDisclosure', { n: group.unbound.length })}
        >
          <ActionList role="list" showDividers>
            {group.unbound.map((command) => (
              <ActionList.Item key={command.id} data-testid="keymap-row" data-command-id={command.id}>
                <KeymapRow
                  commandId={command.id}
                  label={commandLabel(command)}
                  binding={null}
                  isOverridden={false}
                  extraBindings={command.extraBindings}
                />
              </ActionList.Item>
            ))}
          </ActionList>
        </AdvancedDisclosure>
      )}
    </Stack>
  )
}

function KeymapRow({ commandId, label, binding, isOverridden, extraBindings }: {
  commandId: string
  label: string
  binding: KeyCombo | null
  isOverridden: boolean
  extraBindings?: KeyCombo[]
}) {
  const { t } = useTranslation('views')
  const hk = useCommandKeybindingCapture(commandId)

  // hk.binding only ever reflects a real OVERRIDE (useCommandKeybindingCapture
  // reads SettingsService.ListKeybindings, which never carries a
  // frontend-only default) -- falls back to the merged `binding` prop
  // (shared/commands.ts's effectiveBinding) for a still-default command.
  const displayLabel = hk.binding ?? (binding ? formatCombo(binding.mods, binding.key) : null)

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
              {displayLabel ? <KeybindingHint keys={hintKeysFromLabel(displayLabel)} /> : t('keyboardShortcutsSection.unbound')}
            </Button>
          )}
          {isOverridden && !hk.recording && (
            <Button size="small" variant="invisible" onClick={hk.clear} data-testid="keymap-row-reset">
              {t('keyboardShortcutsSection.reset')}
            </Button>
          )}
          {/* Multi-binding aliases (docs/goals/BACKLOG.md Standing #6):
              read-only this pass -- Command.extraBindings' own doc
              comment (shared/commands.ts) covers why these aren't
              wired into the press-to-capture recorder above. */}
          {extraBindings && extraBindings.length > 0 && !hk.recording && (
            <Stack direction="horizontal" gap="condensed" align="center">
              <Text size="small" className={styles.muted}>{t('keyboardShortcutsSection.alsoLabel')}</Text>
              {extraBindings.map((extra) => (
                // KeybindingHint (@primer/react/experimental) forwards
                // only its own named props -- data-testid/title need a
                // wrapping element, same reason the Change button above
                // carries keymap-row-combo rather than the hint itself.
                <span key={formatCombo(extra.mods, extra.key)} data-testid="keymap-row-extra-binding" title={t('keyboardShortcutsSection.extraBindingTitle')}>
                  <KeybindingHint keys={hintKeysFromLabel(formatCombo(extra.mods, extra.key))} />
                </span>
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
      {hk.error && <Text as="p" size="small" className={styles.error}>{hk.error}</Text>}
    </Stack>
  )
}
