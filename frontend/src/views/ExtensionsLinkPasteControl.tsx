import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormControl, Select, Stack, Text } from '@primer/react'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { linkPasteClaimants } from './linkPasteClaimants'
import { SettingsService } from '../shared/bindings'
import styles from '../shared/ListCard.module.css'

// Settings > Extensions' "Pasted links become" choice (ADR-0051 slice
// 2): which claimant a bare link pasted on the board lands as when more
// than one enabled plugin claims links. Rendered only then -- with one
// or zero claimants there is nothing to choose. The stored preference
// is the kernel's paste-chain order (SettingsService), never a plugin
// setting.
export function ExtensionsLinkPasteControl({ plugins, disabledIds }: { plugins: PluginInfo[]; disabledIds: string[] }) {
	const { t } = useTranslation('views')
	const claimants = linkPasteClaimants(plugins, disabledIds)
	const [preferred, setPreferred] = useState<string | null>(null)
	useEffect(() => {
		SettingsService.GetPreferredLinkPasteKind().then(setPreferred).catch(() => setPreferred(''))
	}, [])
	if (claimants.length < 2 || preferred === null) return null
	const current = claimants.some((c) => c.kind === preferred) ? preferred : claimants[0]!.kind
	const persist = (kind: string) => {
		setPreferred(kind)
		SettingsService.SetPreferredLinkPasteKind(kind).catch(console.error)
	}
	return (
		<Stack direction="vertical" gap="none" data-testid="extensions-link-paste">
			<FormControl>
				<FormControl.Label>{t('settings.extensions.linkPasteLabel')}</FormControl.Label>
				<Select value={current} onChange={(e) => persist(e.target.value)} data-testid="extensions-link-paste-select">
					{claimants.map((c) => <Select.Option key={c.kind} value={c.kind}>{c.label}</Select.Option>)}
				</Select>
			</FormControl>
			<Text as="p" size="small" className={styles.muted}>{t('settings.extensions.linkPasteCaption')}</Text>
		</Stack>
	)
}
