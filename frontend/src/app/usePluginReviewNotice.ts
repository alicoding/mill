import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { pluginsAwaitingReview } from '../plugins/loader'
import { usePluginReloadVersion } from '../plugins/pluginReloadSignal'
import { usePluginRemoveVersion } from '../shared/pluginRemoveSignal'
import { syncPluginReviewNotice } from './pluginReviewNotice'

// The review notice when a plugin is installed but not yet allowed to
// run, or its files changed, or its manifest widened past its consent
// (ADR-0051 §4's install-time review): the notice channel, not a
// bespoke banner, with Extensions as its one action. It stays until
// dismissed or until nothing waits -- a plugin waiting on the user is
// a pending decision, not a transient event -- and re-syncs on every
// in-page plugin reload or removal, which is how an Allow + Reload or
// a Remove clears it without a full app restart.
export function usePluginReviewNotice() {
	const { t } = useTranslation('views')
	const reloadVersion = usePluginReloadVersion()
	const removeVersion = usePluginRemoveVersion()
	useEffect(() => {
		syncPluginReviewNotice(pluginsAwaitingReview(), t)
	}, [t, reloadVersion, removeVersion])
}
