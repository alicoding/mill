import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, Stack, Text, ToggleSwitch } from '@primer/react'
import { AlertIcon } from '@primer/octicons-react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { SettingsService } from '../shared/bindings'
import { pluginLoadStates } from '../plugins/loader'
import { refreshDisabledExtensions, useExtensionEnablementStore } from '../shared/extensionEnablementStore'
import styles from '../shared/ListCard.module.css'

// The installed-plugins section of Settings > Extensions (docs/goals/
// 0249): every folder in the plugins directory, with its manifest
// metadata and what actually happened to it this boot -- loaded,
// disabled, or visibly broken with the exact reason. The install
// story lives here too: the folder is one click away, and a fresh
// install takes effect on reload (plugins load at app start).
// The row states a plugin's ingestion claims (docs/goals/0251) so
// what a plugin catches is visible before it ever runs -- the same
// declare-first posture the capabilities line carries.
function claimedExtensions(p: PluginInfo): string[] {
	return (p.Manifest.contributes?.canvasObjects ?? []).flatMap((c) => c.fileExtensions ?? [])
}

function claimsURLPastes(p: PluginInfo): boolean {
	return (p.Manifest.contributes?.canvasObjects ?? []).some((c) => c.pastesURLs)
}

export function ExtensionsInstalledPlugins() {
	const { t } = useTranslation('views')
	const disabledIds = useExtensionEnablementStore((s) => s.disabledExtensionIds)
	const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)

	useEffect(() => {
		PluginService.ListPlugins().then((p) => setPlugins(p ?? [])).catch(() => setPlugins([]))
	}, [])

	const toggle = (id: string, enabled: boolean) => {
		SettingsService.SetExtensionEnabled(id, enabled).then(refreshDisabledExtensions).catch(console.error)
	}
	const openFolder = () => {
		PluginService.RevealPluginsDir().catch(console.error)
	}
	const states = pluginLoadStates()

	return (
		<Stack direction="vertical" gap="condensed" data-testid="extensions-installed-plugins">
			<Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
				<Text as="h3" size="small" weight="semibold" className={styles.muted}>
					{t('settings.extensions.pluginsTitle')}
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
			<Text as="p" size="small" className={styles.muted}>
				{t('settings.extensions.installHint')}
			</Text>
			{plugins !== null && plugins.length === 0 && (
				<Text size="small" className={styles.muted} data-testid="extensions-no-plugins">
					{t('settings.extensions.noPlugins')}
				</Text>
			)}
			{plugins !== null && plugins.length > 0 && (
				<ActionList role="list" showDividers>
					{plugins.map((p) => {
						const id = p.Manifest.id
						const runtime = states.get(id)
						const error = p.Error || (runtime?.status === 'error' ? runtime.error : '')
						const enabled = !disabledIds.includes(id)
						return (
							<ActionList.Item key={id} data-testid="extensions-plugin-row" data-plugin-id={id}>
								<Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
									<Stack direction="vertical" gap="none">
										<Stack direction="horizontal" gap="condensed" align="center">
											<Text weight="semibold" id={`plugin-name-${id}`}>{p.Manifest.name || id}</Text>
											<Text size="small" className={styles.muted}>
												{p.Manifest.version}
												{p.Manifest.author ? ` · ${p.Manifest.author}` : ''}
												{p.Builtin ? ` · ${t('settings.extensions.pluginBuiltIn')}` : ''}
											</Text>
										</Stack>
										{p.Manifest.description && <Text size="small">{p.Manifest.description}</Text>}
										{(p.Manifest.capabilities?.length ?? 0) > 0 && (
											<Text size="small" className={styles.muted}>
												{t('settings.extensions.pluginCapabilities', { list: (p.Manifest.capabilities ?? []).join(', ') })}
											</Text>
										)}
										{claimedExtensions(p).length > 0 && (
											<Text size="small" className={styles.muted} data-testid="extensions-plugin-catches">
												{t('settings.extensions.pluginCatchesFiles', { list: claimedExtensions(p).join(', ') })}
											</Text>
										)}
										{claimsURLPastes(p) && (
											<Text size="small" className={styles.muted} data-testid="extensions-plugin-catches">
												{t('settings.extensions.pluginCatchesLinks')}
											</Text>
										)}
										{error && (
											<Stack direction="horizontal" gap="condensed" align="center">
												<AlertIcon size={14} />
												<Text size="small" data-testid="extensions-plugin-error">{error}</Text>
											</Stack>
										)}
										{!error && runtime?.status === 'disabled' && (
											<Text size="small" className={styles.muted}>{t('settings.extensions.pluginDisabledNote')}</Text>
										)}
									</Stack>
									{!error && (
										<ToggleSwitch
											size="small"
											checked={enabled}
											onChange={(on) => toggle(id, on)}
											aria-labelledby={`plugin-name-${id}`}
											data-testid="extensions-plugin-toggle"
										/>
									)}
								</Stack>
							</ActionList.Item>
						)
					})}
				</ActionList>
			)}
		</Stack>
	)
}
