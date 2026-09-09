import { useNoticeStore } from '../shared/noticeStore'

export const PLUGIN_REVIEW_NOTICE_ID = 'plugin-review'

// The count last shown, across boots: a boot with the SAME plugins
// still waiting must not re-toast -- only a genuinely NEW arrival (the
// count going up since the last time this ran) does. The nav badge
// (app/AppSidebar.tsx), not the notice, is what stays visible for as
// long as anything waits.
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
		// unavailable is no worse than never remembering.
	}
}

// syncPluginReviewNotice keeps the review notice equal to the live
// count. It runs at boot and again after every in-page plugin reload
// (an Allow followed by Reload, a Remove), so the notice can never
// outlive the decision it asked for:
//   - count 0: the notice leaves.
//   - count up since last shown: a new arrival, the notice appears.
//   - count changed while the notice is still up: its text follows.
//   - count unchanged, or dropped after the user dismissed it: nothing
//     re-toasts.
// One stable id, like the update pill's notices: pushing replaces in
// place, and the testid stays `notice-plugin-review`.
export function syncPluginReviewNotice(
	count: number,
	t: (key: string, opts?: Record<string, unknown>) => string,
): void {
	const store = useNoticeStore.getState()
	const lastShown = readLastShownCount()
	writeLastShownCount(count)
	if (count === 0) {
		store.remove(PLUGIN_REVIEW_NOTICE_ID)
		return
	}
	const showing = store.notices.some((n) => n.id === PLUGIN_REVIEW_NOTICE_ID)
	if (count <= lastShown && !showing) return
	store.push({
		id: PLUGIN_REVIEW_NOTICE_ID,
		level: 'info',
		text: t('settings.extensions.awaitingReviewNotice', { count }),
		actions: [{ id: 'review-plugins', label: t('settings.extensions.awaitingReviewAction'), commandId: 'extensions.review' }],
		onDismiss: () => useNoticeStore.getState().remove(PLUGIN_REVIEW_NOTICE_ID),
	})
}
