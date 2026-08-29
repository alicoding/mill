import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, Stack, Text } from '@primer/react'
import { ATLAS_TOOLS, type AtlasToolID } from '../atlas/atlasTools'
import { toolLessNounExtensions } from '../atlas/atlasNounRegistry'
import { SettingsService } from '../shared/bindings'
import { refreshDisabledExtensions, useExtensionEnablementStore } from '../shared/extensionEnablementStore'
import { ExtensionRow } from './ExtensionRow'
import { groupSectionLabel, toolLessRowSource, toolRowSource, type ExtensionRowSource } from './extensionMeta'
import type { AtlasNounGroup } from '../atlas/atlasNounRegistry'
import styles from '../shared/ListCard.module.css'

// Settings > Extensions (goal 0237 S2, extended by goal 0211's plugin-
// manager UX slice, and by goal 0237 S3's rider): a registry-DERIVED
// list of every registered NOUN -- every tray tool (ATLAS_TOOLS) plus
// every tool-less noun that declares Extensions-row metadata
// (toolLessNounExtensions(), diagram/sheet today) -- each expandable
// into a registry-derived detail panel (ExtensionRow.tsx) via one
// normalized row shape (extensionMeta.ts's ExtensionRowSource). Never a
// hand-curated array: a new tray tool's registerNoun() call or a new
// tool-less noun's own `extension` declaration both make it appear here
// with zero edits to this file. `card` is the one exception: it's the
// kernel knowledge object (ADR-0046), not a guest extension, so its row
// renders a "Built-in" label instead of a toggle -- shown rather than
// omitted, so the Extensions list still reads as a complete inventory
// of every canvas noun, not a mysteriously-short one.
//
// Disabling a TRAY tool here only changes what CAN be created from now
// on: it removes the tool's own button from the creation tray
// (AtlasCreationTray.tsx's own ATLAS_TOOLS.filter) and its
// `atlas.create.<id>` command from the palette/keyboard
// (shared/commands.ts's own `enabled()` predicate) -- existing board
// objects of that kind keep rendering exactly as before, since neither
// the board's own render path nor AtlasBoardObjectNode.tsx's content
// lookup (atlasNounRegistry.ts's boardObjectContentFor) ever consults
// this list at all. A TOOL-LESS noun has no tray button to remove --
// its own row states its narrower disable scope directly (see each
// noun's own `extension.disableScopeNote`, atlasNounRegistry.ts).
const CARD_TOOL_ID: AtlasToolID = 'card'
const EXTENSION_ROWS: ExtensionRowSource[] = [
  ...ATLAS_TOOLS.map(toolRowSource),
  ...toolLessNounExtensions().map(toolLessRowSource),
]
const NON_BUILT_IN_IDS: string[] = EXTENSION_ROWS.filter((r) => r.id !== CARD_TOOL_ID).map((r) => r.id)

// The list's own three sections (goal 0237 S3's review rider --
// "group the list, stop repeating the group"), in the same
// knowledge-then-file-then-annotate order AtlasCreationTray.tsx's own
// PRIMARY_GROUP_ORDER renders the tray in. Rows within each section
// keep EXTENSION_ROWS' own registry order (a stable filter, never a
// re-sort) -- never a hand-curated per-id array.
const SECTION_ORDER: AtlasNounGroup[] = ['knowledge', 'file', 'annotate']

export default function ExtensionsSection() {
  const { t } = useTranslation('views')
  const disabledIds = useExtensionEnablementStore((s) => s.disabledExtensionIds)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    void refreshDisabledExtensions()
    SettingsService.AppVersion().then(setAppVersion).catch(console.error)
  }, [])

  const toggle = (id: string, enabled: boolean) => {
    SettingsService.SetExtensionEnabled(id, enabled).then(refreshDisabledExtensions).catch(console.error)
  }

  // Obsidian's restricted-mode analog (goal 0211's plugin-manager UX
  // slice): one control turns every non-built-in extension off at
  // once, or back on. Reuses the same per-id SetExtensionEnabled call
  // every row's own toggle already makes -- no new settings key. The
  // calls run SEQUENTIALLY, not Promise.all: SetExtensionEnabled is a
  // read-modify-write over one shared JSON blob
  // (settingsservice_extensions.go), so firing the whole set
  // concurrently lets a later write's own read miss an earlier write's
  // still-in-flight update, silently dropping it.
  const allOff = NON_BUILT_IN_IDS.length > 0 && NON_BUILT_IN_IDS.every((id) => disabledIds.includes(id))
  const toggleAll = async () => {
    for (const id of NON_BUILT_IN_IDS) {
      await SettingsService.SetExtensionEnabled(id, allOff).catch(console.error)
    }
    await refreshDisabledExtensions()
  }

  return (
    <Stack direction="vertical" gap="condensed">
      <Stack direction="horizontal" justify="space-between" align="start" gap="condensed">
        <Stack direction="vertical" gap="none">
          <Text as="p" size="small" className={styles.muted}>
            {t('settings.extensions.subtitle')}
          </Text>
          <Text as="p" size="small" className={styles.muted} data-testid="extensions-install-story">
            {t('settings.extensions.installStory')}
          </Text>
        </Stack>
        <Button size="small" onClick={toggleAll} data-testid="extensions-toggle-all">
          {t(allOff ? 'settings.extensions.turnAllOn' : 'settings.extensions.turnAllOff')}
        </Button>
      </Stack>
      {/* One ActionList PER SECTION rather than ActionList.Group:
          with list semantics Primer's Group renders its own <li
          role="presentation"> wrapper, hoisting the heading and inner
          <ul role="group"> into the outer list in the accessibility
          tree (aria-required-children, WCAG gate); WITHOUT list
          semantics every Item renders as a <button>, nesting the
          row's own switch inside an interactive (nested-interactive).
          A section as its own h3-labeled list is valid both ways and
          keeps the same rendered chrome. h3 nests under the page's
          own h2 section headings (SettingsView.tsx). */}
      <Stack direction="vertical" gap="condensed" data-testid="extensions-list">
        {SECTION_ORDER.map((group) => {
          const rows = EXTENSION_ROWS.filter((row) => row.group === group)
          if (rows.length === 0) return null
          return (
            <Stack direction="vertical" gap="none" key={group} data-testid={`extensions-group-${group}`}>
              <Text as="h3" size="small" weight="semibold" className={styles.muted}>
                {groupSectionLabel(group)}
              </Text>
              <ActionList role="list" showDividers aria-label={groupSectionLabel(group)}>
                {rows.map((row) => (
                  <ActionList.Item key={row.id}>
                    <ExtensionRow
                      row={row}
                      builtIn={row.id === CARD_TOOL_ID}
                      enabled={!disabledIds.includes(row.id)}
                      appVersion={appVersion}
                      onToggle={(enabled) => toggle(row.id, enabled)}
                    />
                  </ActionList.Item>
                ))}
              </ActionList>
            </Stack>
          )
        })}
      </Stack>
    </Stack>
  )
}
