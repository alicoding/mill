import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { PlugIcon } from '@primer/octicons-react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { SettingsService } from '../shared/bindings'
import { pluginLoadStates } from '../plugins/loader'
import { ExtensionRow } from './ExtensionRow'
import { ExtensionsLinkPasteControl } from './ExtensionsLinkPasteControl'
import { ExtensionsTrustBar } from './ExtensionsTrustBar'
import { refreshDisabledExtensions, useExtensionEnablementStore } from '../shared/extensionEnablementStore'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// The Installed half of Settings > Extensions (goal 0321, re-shaping
// goal 0249's section): every folder in the plugins directory as ONE
// row apiece, in the SAME row component the built-in list uses -- the
// two lists used to be differently-shaped blocks on one page, which is
// what made the section read as two features rather than one
// inventory. What each plugin contributes, what it can reach, and why
// it is not running now live in the detail pane a row opens.
//
// The install story stays here, beside the list it explains: the
// folder is one click away, and a fresh install takes effect on
// reload (plugins load at app start).

// A plugin the user cannot simply switch on from the row -- policy or
// a pending review answers first, in the detail pane.
function rowControl(status: string | undefined, error: string | undefined): 'switch' | 'none' {
  if (error) return 'none'
  if (status === 'blocked' || status === 'unallowed' || status === 'changed' || status === 'unsigned') return 'none'
  return 'switch'
}

export function ExtensionsInstalledPlugins({ plugins, selectedId, onSelect }: {
  plugins: PluginInfo[] | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation('views')
  const disabledIds = useExtensionEnablementStore((s) => s.disabledExtensionIds)
  const states = pluginLoadStates()

  const toggle = (id: string, enabled: boolean) => {
    SettingsService.SetExtensionEnabled(id, enabled).then(refreshDisabledExtensions).catch(console.error)
  }
  const openFolder = () => {
    PluginService.RevealPluginsDir().catch(console.error)
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="extensions-installed-plugins">
      <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
        <Text as="h3" size="small" weight="semibold" className={listStyles.muted}>
          {t('settings.extensions.installedTitle')}
        </Text>
        <Stack direction="horizontal" gap="condensed">
          <Button size="small" onClick={openFolder} data-testid="extensions-open-plugins-folder">
            {t('settings.extensions.openPluginsFolder')}
          </Button>
          <Button size="small" onClick={() => window.location.reload()} data-testid="extensions-reload">
            {t('settings.extensions.reload')}
          </Button>
        </Stack>
      </Stack>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.extensions.installHint')}
      </Text>
      <ExtensionsTrustBar />
      {plugins !== null && <ExtensionsLinkPasteControl plugins={plugins} disabledIds={disabledIds} />}
      {plugins !== null && plugins.length === 0 && (
        <Text size="small" className={listStyles.muted} data-testid="extensions-no-plugins">
          {t('settings.extensions.noPlugins')}
        </Text>
      )}
      {plugins !== null && plugins.length > 0 && (
        <ul className={styles.rows} aria-label={t('settings.extensions.installedTitle')}>
          {plugins.map((p) => {
            const id = p.Manifest.id
            const runtime = states.get(id)
            const error = p.Error || (runtime?.status === 'error' ? runtime.error : '')
            return (
              <li key={id} data-testid="extensions-plugin-row" data-plugin-id={id}>
                <ExtensionRow
                  id={id}
                  icon={PlugIcon}
                  name={p.Manifest.name || id}
                  description={p.Manifest.description}
                  control={rowControl(runtime?.status, error)}
                  enabled={!disabledIds.includes(id)}
                  selected={selectedId === id}
                  builtInLabel={t('settings.extensions.pluginBuiltIn')}
                  toggleTestId="extensions-plugin-toggle"
                  onSelect={() => onSelect(id)}
                  onToggle={(enabled) => toggle(id, enabled)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Stack>
  )
}
