import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Label, Stack, Text, ToggleSwitch } from '@primer/react'
import { ATLAS_TOOLS, type AtlasToolID, type AtlasToolShape } from '../atlas/atlasTools'
import { SettingsService } from '../shared/bindings'
import { refreshDisabledExtensions, useExtensionEnablementStore } from '../shared/extensionEnablementStore'
import { editRouteLabel, groupLabel, sourceLabel } from './extensionMeta'
import styles from '../shared/ListCard.module.css'

// Settings > Extensions (goal 0237 S2): a registry-DERIVED list of
// every registered canvas tool (ATLAS_TOOLS, atlas/atlasTools.ts) --
// never a hand-curated array, so a new tool's own registerNoun() call
// (atlasNounRegistry.ts) makes it appear here with zero edits to this
// file. `card` is the one exception: it's the kernel knowledge object
// (ADR-0046), not a guest extension, so its row renders a "Built-in"
// label instead of a toggle -- shown rather than omitted, so the
// Extensions list still reads as a complete inventory of every canvas
// tool, not a mysteriously-short one.
//
// Disabling a tool here only changes what CAN be created from now on:
// it removes the tool's own button from the creation tray
// (AtlasCreationTray.tsx's own ATLAS_TOOLS.filter) and its
// `atlas.create.<id>` command from the palette/keyboard
// (shared/commands.ts's own `enabled()` predicate) -- existing board
// objects of that kind keep rendering exactly as before, since neither
// the board's own render path nor AtlasBoardObjectNode.tsx's content
// lookup (atlasNounRegistry.ts's boardObjectContentFor) ever consults
// this list at all.
const CARD_TOOL_ID: AtlasToolID = 'card'

export default function ExtensionsSection() {
  const { t } = useTranslation('views')
  const disabledIds = useExtensionEnablementStore((s) => s.disabledExtensionIds)

  useEffect(() => {
    void refreshDisabledExtensions()
  }, [])

  const toggle = (id: AtlasToolID, enabled: boolean) => {
    SettingsService.SetExtensionEnabled(id, enabled).then(refreshDisabledExtensions).catch(console.error)
  }

  return (
    <Stack direction="vertical" gap="condensed">
      <Text as="p" size="small" className={styles.muted}>
        {t('settings.extensions.subtitle')}
      </Text>
      <ActionList role="list" showDividers data-testid="extensions-list">
        {ATLAS_TOOLS.map((tool) => (
          <ActionList.Item key={tool.id} data-testid="extensions-row" data-extension-id={tool.id}>
            <ExtensionRow
              tool={tool}
              builtIn={tool.id === CARD_TOOL_ID}
              enabled={!disabledIds.includes(tool.id)}
              onToggle={(enabled) => toggle(tool.id, enabled)}
            />
          </ActionList.Item>
        ))}
      </ActionList>
    </Stack>
  )
}

function ExtensionRow({ tool, builtIn, enabled, onToggle }: {
  tool: AtlasToolShape
  builtIn: boolean
  enabled: boolean
  onToggle: (enabled: boolean) => void
}) {
  const { t } = useTranslation('views')
  const Icon = tool.icon
  const labelId = `extension-row-label-${tool.id}`
  const meta = [groupLabel(tool.group), sourceLabel(tool.content?.source), editRouteLabel(tool.content?.editRoute)]
    .filter((m): m is string => m !== null)

  return (
    <Stack direction="horizontal" gap="condensed" align="center" justify="space-between" style={{ width: '100%' }}>
      <Stack direction="horizontal" gap="condensed" align="center">
        <Icon size={16} />
        <Stack direction="vertical" gap="none">
          <Text id={labelId} size="small" weight="semibold">{tool.label}</Text>
          {meta.length > 0 && (
            <Text size="small" className={styles.muted}>{meta.join(' · ')}</Text>
          )}
        </Stack>
      </Stack>
      {builtIn ? (
        <Label data-testid="extensions-row-built-in">{t('settings.extensions.builtIn')}</Label>
      ) : (
        <ToggleSwitch
          aria-labelledby={labelId}
          checked={enabled}
          onChange={onToggle}
          size="small"
          data-testid="extensions-row-toggle"
        />
      )}
    </Stack>
  )
}
