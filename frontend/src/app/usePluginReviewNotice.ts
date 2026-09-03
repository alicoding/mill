import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { pluginsAwaitingReview } from '../plugins/loader'
import { pushNotice } from '../shared/noticeStore'

// One boot notice when plugins are installed but not yet allowed to run
// (ADR-0051 §4's install-time review): the notice channel, not a
// bespoke banner, with the Extensions section as its one action. Stays
// until dismissed -- a plugin waiting on the user is a pending decision,
// not a transient event.
export function usePluginReviewNotice() {
	const { t } = useTranslation('views')
	useEffect(() => {
		const count = pluginsAwaitingReview()
		if (count === 0) return
		return pushNotice({
			level: 'info',
			ttlMs: 0,
			text: t('settings.extensions.awaitingReviewNotice', { count }),
			actions: [{ id: 'review-plugins', label: t('settings.extensions.awaitingReviewAction'), commandId: 'settings.open.extensions' }],
		})
	}, [t])
}
