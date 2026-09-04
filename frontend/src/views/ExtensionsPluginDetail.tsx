import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { AlertIcon, PlugIcon } from '@primer/octicons-react'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { drainedPluginCommands } from '../plugins/pluginCommands'
import { pluginLoadStates } from '../plugins/loader'
import { settingDeclsFromManifest } from '../plugins/pluginSettings'
import { findCommand, runCommand } from '../shared/commands'
import { ExtensionDetailPane, type ExtensionDetail } from './ExtensionDetailPane'
import { reachLabel } from './extensionMeta'
import listStyles from '../shared/ListCard.module.css'

// The detail pane for an INSTALLED plugin (goal 0321): the same
// adapter job ExtensionsBuiltInDetail does, over the manifest and the
// boot scan's own load state. Everything the row used to say inline --
// what it contributes, what it can reach, why it is not running, its
// declared settings, and the actions on it -- reads here, once.
//
// Reload and Remove are both REGISTRY COMMANDS rendered as controls,
// never a second code path: the palette entry and this button run the
// identical action, and each command's own enabled() is the one truth
// about whether it can do anything.
export default function ExtensionsPluginDetail({ plugin, allowed, onAllow, showBackLink, onClose }: {
  plugin: PluginInfo
  allowed: boolean
  onAllow: () => void
  showBackLink: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('views')
  const id = plugin.Manifest.id
  const name = plugin.Manifest.name || id
  const runtime = pluginLoadStates().get(id)
  const error = plugin.Error || (runtime?.status === 'error' ? runtime.error : '')
  const contributes = plugin.Manifest.contributes

  const adds = pluginAdds(id, contributes)
  const reach = pluginReach(contributes, t)
  const claims = pluginClaims(plugin, t)
  const meta = [
    plugin.Manifest.version ? `v${plugin.Manifest.version}` : '',
    plugin.Manifest.author,
    plugin.Builtin ? t('settings.extensions.pluginBuiltIn') : '',
  ].filter(Boolean).join(' · ')

  const reloadCommand = findCommand(`plugin.reload.${id}`)
  const removeCommand = findCommand(`plugin.remove.${id}`)

  const detail: ExtensionDetail = {
    id,
    icon: PlugIcon,
    name,
    metaLine: meta || undefined,
    description: plugin.Manifest.description,
    chips: [],
    settings: settingDeclsFromManifest(plugin.Manifest),
    adds,
    reach,
    claims,
    // A bundled plugin's header meta line already says "Built into
    // Mill"; only an installed one has a folder worth naming.
    provenance: plugin.Builtin ? undefined : t('settings.extensions.pluginSource', { path: plugin.Dir }),
    status: <PluginStatusNote error={error} status={runtime?.status} allowed={allowed} onAllow={onAllow} />,
    actions: reloadCommand?.enabled?.() ? (
      <Button
        size="small"
        onClick={() => void runCommand(reloadCommand.id)}
        aria-label={t('settings.extensions.pluginReloadAria', { name })}
        data-testid="extensions-plugin-reload"
      >
        {t('settings.extensions.pluginReload')}
      </Button>
    ) : undefined,
    onRemove: removeCommand?.enabled?.() ? () => void runCommand(removeCommand.id) : undefined,
  }
  return <ExtensionDetailPane detail={detail} showBackLink={showBackLink} onClose={onClose} />
}


type Contributes = PluginInfo['Manifest']['contributes']
type Translate = (key: string, options?: Record<string, unknown>) => string

// What the plugin declares it contributes, in the order the pane lists
// it. Commands come from the live registry (a plugin registers them at
// activation, not in the manifest); everything else is manifest-
// declared and readable whether or not the plugin ever ran.
//
// The host's own per-plugin actions ride the SAME collector as the
// plugin's contributions (so a reload sweeps them together), so they
// are filtered out here -- reloading a plugin is not something the
// plugin adds.
const HOST_COMMAND_PREFIXES = ['plugin.reload.', 'plugin.remove.']

function pluginAdds(id: string, contributes: Contributes): ExtensionDetail['adds'] {
  const adds: ExtensionDetail['adds'] = []
  const commands = drainedPluginCommands()
    .filter((c) => c.pluginId === id && !HOST_COMMAND_PREFIXES.some((prefix) => c.id.startsWith(prefix)))
    .map((c) => c.label)
  if (commands.length > 0) adds.push({ kind: 'commands', items: commands })
  const objects = (contributes?.canvasObjects ?? []).map((c) => c.kind)
  if (objects.length > 0) adds.push({ kind: 'objects', items: objects })
  const steps = (contributes?.steps ?? []).map((s) => s.label)
  if (steps.length > 0) adds.push({ kind: 'steps', items: steps })
  const views = (contributes?.views ?? []).map((v) => v.title)
  if (views.length > 0) adds.push({ kind: 'views', items: views })
  const captures = (contributes?.captures ?? []).map((c) => c.label)
  if (captures.length > 0) adds.push({ kind: 'captures', items: captures })
  return adds
}

// The honest reach line: the declared hosts, or nothing at all.
function pluginReach(contributes: Contributes, t: Translate): string {
  const network = contributes?.network ?? []
  if (network.length === 0) return reachLabel(undefined)
  if (network.some((n) => n.host === '*')) return t('settings.extensions.pluginReachesAnyHost')
  return t('settings.extensions.pluginReachesHosts', { list: network.map((n) => n.host).join(', ') })
}

// The ingestion claims (docs/goals/0251): what a plugin catches is
// visible before it ever runs, beside what it can request.
function pluginClaims(plugin: PluginInfo, t: Translate): string[] {
  const objects = plugin.Manifest.contributes?.canvasObjects ?? []
  const claims: string[] = []
  const fileExtensions = objects.flatMap((c) => c.fileExtensions ?? [])
  if (fileExtensions.length > 0) claims.push(t('settings.extensions.pluginCatchesFiles', { list: fileExtensions.join(', ') }))
  if (objects.some((c) => c.pastesURLs)) claims.push(t('settings.extensions.pluginCatchesLinks'))
  if ((plugin.Manifest.capabilities?.length ?? 0) > 0) {
    claims.push(t('settings.extensions.pluginCapabilities', { list: (plugin.Manifest.capabilities ?? []).join(', ') }))
  }
  return claims
}

// What actually happened to this plugin this boot, stated in full --
// including the two states that ask the user to act.
function PluginStatusNote({ error, status, allowed, onAllow }: {
  error: string | undefined
  status: string | undefined
  allowed: boolean
  onAllow: () => void
}) {
  const { t } = useTranslation('views')
  if (error) {
    return (
      <Stack direction="horizontal" gap="condensed" align="center">
        <AlertIcon size={14} />
        <Text size="small" data-testid="extensions-plugin-error">{error}</Text>
      </Stack>
    )
  }
  if (status === 'disabled') {
    return <Text as="p" size="small" className={listStyles.muted}>{t('settings.extensions.pluginDisabledNote')}</Text>
  }
  if (status === 'blocked') {
    return <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-plugin-blocked">{t('settings.extensions.pluginBlockedNote')}</Text>
  }
  if (status === 'unsigned') {
    return <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-plugin-unsigned">{t('settings.extensions.pluginUnsignedNote')}</Text>
  }
  if (status === 'unallowed' || status === 'changed') {
    return (
      <Stack direction="horizontal" gap="condensed" align="center" data-testid="extensions-plugin-review">
        <Text size="small" weight="semibold">
          {allowed
            ? t('settings.extensions.pluginAllowedNote')
            : status === 'changed' ? t('settings.extensions.pluginChangedNote') : t('settings.extensions.pluginAwaitingNote')}
        </Text>
        {!allowed && (
          <Button size="small" variant="primary" onClick={onAllow} data-testid="extensions-plugin-allow">
            {t('settings.extensions.pluginAllow')}
          </Button>
        )}
      </Stack>
    )
  }
  return null
}
