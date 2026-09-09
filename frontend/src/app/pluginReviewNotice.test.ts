// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useNoticeStore } from '../shared/noticeStore'
import { PLUGIN_REVIEW_NOTICE_ID, syncPluginReviewNotice } from './pluginReviewNotice'

const t = (key: string, opts?: Record<string, unknown>) => (opts?.count === undefined ? key : `${key}:${String(opts.count)}`)
const notice = () => useNoticeStore.getState().notices.find((n) => n.id === PLUGIN_REVIEW_NOTICE_ID)

describe('syncPluginReviewNotice', () => {
	beforeEach(() => {
		useNoticeStore.setState({ notices: [] })
		localStorage.clear()
	})

	it('a new arrival shows the notice under one stable id with the Review action', () => {
		syncPluginReviewNotice(2, t)
		expect(notice()).toMatchObject({
			level: 'info',
			text: 'settings.extensions.awaitingReviewNotice:2',
			actions: [{ id: 'review-plugins', commandId: 'extensions.review' }],
		})
		expect(typeof notice()?.onDismiss).toBe('function')
	})

	it('a boot with the same plugins still waiting does not re-toast', () => {
		syncPluginReviewNotice(2, t)
		useNoticeStore.setState({ notices: [] }) // the app restarted: the store is empty, storage remembers 2
		syncPluginReviewNotice(2, t)
		expect(notice()).toBeUndefined()
		syncPluginReviewNotice(3, t)
		expect(notice()?.text).toBe('settings.extensions.awaitingReviewNotice:3')
	})

	it('the text follows the count while the notice is up, and the notice leaves at zero', () => {
		syncPluginReviewNotice(3, t)
		syncPluginReviewNotice(1, t)
		expect(notice()?.text).toBe('settings.extensions.awaitingReviewNotice:1')
		expect(useNoticeStore.getState().notices).toHaveLength(1)
		syncPluginReviewNotice(0, t)
		expect(notice()).toBeUndefined()
	})

	it('a dismissed notice does not come back when the count merely drops', () => {
		syncPluginReviewNotice(3, t)
		notice()?.onDismiss?.()
		expect(notice()).toBeUndefined()
		syncPluginReviewNotice(2, t)
		expect(notice()).toBeUndefined()
		syncPluginReviewNotice(4, t)
		expect(notice()?.text).toBe('settings.extensions.awaitingReviewNotice:4')
	})
})
