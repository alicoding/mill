import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { pluginsAwaitingReview } from '../plugins/loader'
import { pushNotice } from '../shared/noticeStore'

// The count last shown, across boots (docs/goals/0420): a boot with the
// SAME plugins still waiting must not re-toast -- only a genuinely NEW
// arrival (the count going up since the last time this ran) does. The
// nav badge (app/AppSidebar.tsx), not this hook, is what stays visible
// for as long as anything waits.
const LAST_SHOWN_COUNT_KEY = 'mill.pluginReviewNotice.lastShownCount'

function readLastShownCount(): number {
	try {
		return Number(localStorage.getItem(LAST_SHOWN_COUNT_KEY) ?? '0')
	} catch {
		return 0
	}
}

function writeLastShownCount(count: number): void {
	try {
		localStorage.setItem(LAST_SHOWN_COUNT_KEY, String(count))
	} catch {
		// Best-effort: a toast repeating on a boot where storage is
		// unavailable is no worse than the pre-goal-0420 behavior.
	}
}

// One boot notice when a plugin is installed but not yet allowed to run,
// or its files changed, or its manifest widened past its consent (ADR-
// 0051 §4's install-time review): the notice channel, not a bespoke
// banner, with Extensions as its one action. Dismissible, and stays
// until dismissed (ttlMs=0) -- a plugin waiting on the user is a pending
// decision, not a transient event.
export function usePluginReviewNotice() {
	const { t } = useTranslation('views')
	useEffect(() => {
		const count = pluginsAwaitingReview()
		const lastShown = readLastShownCount()
		writeLastShownCount(count)
		if (count === 0 || count <= lastShown) return
		return pushNotice({
			level: 'info',
			ttlMs: 0,
			text: t('settings.extensions.awaitingReviewNotice', { count }),
			actions: [{ id: 'review-plugins', label: t('settings.extensions.awaitingReviewAction'), commandId: 'extensions.review' }],
		})
	}, [t])
}
