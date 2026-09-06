import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Link, Stack, Text } from '@primer/react'
import { ATLAS_TOOLS, type AtlasToolID } from '../atlas/atlasTools'
import { isThirdPartyToolId, toolLessNounExtensions } from '../atlas/atlasNounRegistry'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { SettingsService } from '../shared/bindings'
import { refreshDisabledExtensions, useExtensionEnablementStore } from '../shared/extensionEnablementStore'
import { usePluginRemoveVersion } from '../shared/pluginRemoveSignal'
import { usePluginReloadVersion } from '../plugins/pluginReloadSignal'
import { useHasSidePane } from '../shared/useNarrowViewport'
import { useAppStore } from '../shared/store'
import { ExtensionRow } from './ExtensionRow'
import { ExtensionsInstalledPlugins } from './ExtensionsInstalledPlugins'
import ExtensionsBuiltInDetail from './ExtensionsBuiltInDetail'
import ExtensionsPluginDetail from './ExtensionsPluginDetail'
import { lazyArray } from '../shared/lazySnapshot'
import { descriptionLabel, groupSectionLabel, toolLessRowSource, toolRowSource, type ExtensionRowSource } from './extensionMeta'
import type { AtlasNounGroup } from '../atlas/atlasNounRegistry'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'
import { background } from '../shared/background'

// Every canvas tool is an Atlas object -- ONE docs link for the whole
// page, never a per-row URL guess.
const ATLAS_CONCEPTS_DOCS_PAGE = 'concepts/atlas.md'

// Settings > Extensions (goal 0237 S2/S3, re-shaped by goal 0321): one
// LIST of every extension, built-in and installed alike, beside a
// DETAIL pane. A row is identity only; everything else -- what it
// adds, what it can reach, its declared settings, its docs link --
// reads in the pane. The rows are registry-DERIVED: a new tray tool's
// registerNoun() call or a new tool-less noun's own `extension`
// declaration makes it appear here with zero edits to this file.
//
// `card` is the one exception: it's the kernel knowledge object
// (ADR-0046), not a guest extension, so its row renders a "Built-in"
// label instead of a toggle -- shown rather than omitted, so the list
// still reads as a complete inventory of every canvas noun.
//
// Disabling a TRAY tool only changes what CAN be created from now on:
// it removes the tool's button from the creation tray and its
// `atlas.create.<id>` command from the palette/keyboard -- existing
// board objects of that kind keep rendering exactly as before.
const CARD_TOOL_ID: AtlasToolID = 'card'
const EXTENSION_ROWS: ExtensionRowSource[] = lazyArray(() => [
  // Runtime plugin tools are excluded here -- they get their own row
  // in the Installed list below, from their manifest, never a second
  // compiled-in-style one.
  ...ATLAS_TOOLS.filter((tool) => !(tool as { thirdParty?: boolean }).thirdParty).map(toolRowSource),
  ...toolLessNounExtensions().filter((n) => !isThirdPartyToolId(n.kind)).map(toolLessRowSource),
])
const NON_BUILT_IN_IDS: string[] = lazyArray(() => EXTENSION_ROWS.filter((r) => r.id !== CARD_TOOL_ID).map((r) => r.id))

// The built-in list's own sub-headings, in the same
// objects-then-media-then-annotate order the creation dock renders
// (goal 0355). Rows within each keep EXTENSION_ROWS' registry order.
const SECTION_ORDER: AtlasNounGroup[] = ['objects', 'media', 'annotate', 'embed']

type Selection = { kind: 'builtin' | 'plugin'; id: string } | null

export default function ExtensionsSection() {
  const { t } = useTranslation('views')
  const disabledIds = useExtensionEnablementStore((s) => s.disabledExtensionIds)
  const hasSidePane = useHasSidePane()
  const [appVersion, setAppVersion] = useState('')
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [allowedNow, setAllowedNow] = useState<string[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  // A reload re-registers contributions; a removal takes a folder off
  // disk. Either invalidates what this list is showing.
  usePluginReloadVersion()
  const removeVersion = usePluginRemoveVersion()

  useEffect(() => {
    void refreshDisabledExtensions()
    void background(SettingsService.AppVersion().then(setAppVersion), 'extensions.appVersion')
  }, [])

  useEffect(() => {
    PluginService.ListPlugins().then((p) => setPlugins(p ?? [])).catch(() => setPlugins([]))
  }, [removeVersion])

  // A removed plugin's detail pane has nothing left to show.
  useEffect(() => {
    if (selection?.kind !== 'plugin' || plugins === null) return
    if (!plugins.some((p) => p.Manifest.id === selection.id)) setSelection(null)
  }, [plugins, selection])

  const toggle = (id: string, enabled: boolean) => {
    void background(SettingsService.SetExtensionEnabled(id, enabled).then(refreshDisabledExtensions), 'extensions.setExtensionEnabled')
  }

  // Escape closes the pane and focus returns to the row that opened
  // it -- the row is where the user was, and the pane is what they
  // just left.
  const closeDetail = useCallback(() => {
    const id = selection?.id
    setSelection(null)
    if (!id) return
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-extension-id="${id}"] [data-testid="extensions-row-open"]`)?.focus()
    })
  }, [selection])

  // One control turns every non-built-in compiled-in extension off at
  // once, or back on. The calls run SEQUENTIALLY, not Promise.all:
  // SetExtensionEnabled is a read-modify-write over one shared JSON
  // blob, so firing the whole set concurrently lets a later write's
  // own read miss an earlier write's still-in-flight update.
  const allOff = NON_BUILT_IN_IDS.length > 0 && NON_BUILT_IN_IDS.every((id) => disabledIds.includes(id))
  const toggleAll = async () => {
    for (const id of NON_BUILT_IN_IDS) {
      await background(SettingsService.SetExtensionEnabled(id, allOff), 'extensions.setExtensionEnabled')
    }
    await refreshDisabledExtensions()
  }

  const selectedRow = selection?.kind === 'builtin' ? EXTENSION_ROWS.find((r) => r.id === selection.id) : undefined
  const selectedPlugin = selection?.kind === 'plugin' ? plugins?.find((p) => p.Manifest.id === selection.id) : undefined
  const detail = selectedRow
    ? <ExtensionsBuiltInDetail row={selectedRow} appVersion={appVersion} showBackLink={!hasSidePane} onClose={closeDetail} />
    : selectedPlugin
      ? (
        <ExtensionsPluginDetail
          plugin={selectedPlugin}
          allowed={allowedNow.includes(selectedPlugin.Manifest.id)}
          onAllow={() => {
            const id = selectedPlugin.Manifest.id
            void background(SettingsService.SetPluginAllowed(id, true).then(() => setAllowedNow((prev) => [...prev, id])), 'extensions.setPluginAllowed')
          }}
          showBackLink={!hasSidePane}
          onClose={closeDetail}
        />
      )
      : null

  // Below the two-pane breakpoint the detail REPLACES the list, with
  // its own back link -- the converged narrow-viewport list/detail
  // shape, never a side pane squeezed into a phone width.
  const listHidden = !hasSidePane && detail !== null

  return (
    <Stack direction="vertical" gap="condensed">
      <Stack direction="horizontal" justify="space-between" align="start" gap="condensed">
        <Text as="p" size="small" className={listStyles.muted}>
          {t('settings.extensions.subtitle')}
        </Text>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Link
            href="#"
            onClick={(e) => {
              e.preventDefault()
              useAppStore.getState().setView({ kind: 'docs', page: ATLAS_CONCEPTS_DOCS_PAGE })
            }}
            className={styles.headerLink}
            data-testid="extensions-docs-link"
          >
            {t('settings.extensions.docsLink')}
          </Link>
          <Button size="small" onClick={toggleAll} data-testid="extensions-toggle-all">
            {t(allOff ? 'settings.extensions.turnAllOn' : 'settings.extensions.turnAllOff')}
          </Button>
        </Stack>
      </Stack>

      <div className={hasSidePane && detail ? styles.split : undefined}>
        {!listHidden && (
          <Stack direction="vertical" gap="condensed" data-testid="extensions-list">
            <Text as="h3" size="small" weight="semibold" className={listStyles.muted}>
              {t('settings.extensions.builtInTitle')}
            </Text>
            {/* One labelled list PER GROUP: a group as its own list
                keeps the headings out of the list's accessibility
                tree, where a single flat list would have hoisted them
                in as non-listitem children (aria-required-children). */}
            {SECTION_ORDER.map((group) => {
              const rows = EXTENSION_ROWS.filter((row) => row.group === group)
              if (rows.length === 0) return null
              return (
                <Stack direction="vertical" gap="none" key={group} data-testid={`extensions-group-${group}`}>
                  <Text as="h4" size="small" className={listStyles.muted}>
                    {groupSectionLabel(group)}
                  </Text>
                  <ul className={styles.rows} aria-label={groupSectionLabel(group)}>
                    {rows.map((row) => (
                      <li key={row.id}>
                        <ExtensionRow
                          id={row.id}
                          icon={row.icon}
                          name={row.label}
                          description={descriptionLabel(row)}
                          control={row.id === CARD_TOOL_ID ? 'built-in' : 'switch'}
                          enabled={!disabledIds.includes(row.id)}
                          selected={selection?.kind === 'builtin' && selection.id === row.id}
                          builtInLabel={t('settings.extensions.builtIn')}
                          onSelect={() => setSelection({ kind: 'builtin', id: row.id })}
                          onToggle={(enabled) => toggle(row.id, enabled)}
                        />
                      </li>
                    ))}
                  </ul>
                </Stack>
              )
            })}
            <ExtensionsInstalledPlugins
              plugins={plugins}
              selectedId={selection?.kind === 'plugin' ? selection.id : null}
              onSelect={(id) => setSelection({ kind: 'plugin', id })}
            />
          </Stack>
        )}
        {detail}
      </div>
    </Stack>
  )
}
