import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import { findCommand } from '../shared/commands'
import styles from '../shared/ListCard.module.css'

// The trust posture strip above the installed-plugins list (ADR-0051
// §4): the administrator's allow-list, reported read-only when one is
// set (it is written by policy tooling into the settings file, never
// here), and the audit export -- a registry command rendered as a
// button, like every other action.
export function ExtensionsTrustBar() {
	const { t } = useTranslation('views')
	const [allowlist, setAllowlist] = useState<string[]>([])
	useEffect(() => {
		SettingsService.GetPluginAllowlist().then((ids) => setAllowlist(ids ?? [])).catch(() => setAllowlist([]))
	}, [])
	return (
		<Stack direction="horizontal" justify="space-between" align="center" gap="condensed" data-testid="extensions-trust-bar">
			<Text size="small" className={styles.muted} data-testid="extensions-allowlist">
				{allowlist.length > 0 ? t('settings.extensions.allowlistActive', { list: allowlist.join(', ') }) : t('settings.extensions.reviewHint')}
			</Text>
			<Button size="small" onClick={() => findCommand('extensions.exportAudit')?.run()} data-testid="extensions-export-audit">
				{t('settings.extensions.exportAudit')}
			</Button>
		</Stack>
	)
}
