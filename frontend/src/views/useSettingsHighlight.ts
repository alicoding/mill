import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { clearSettingHighlight, jumpAndHighlightSetting, SETTINGS_HIGHLIGHT_MS, waitForSettingRow } from '../shared/settingsHighlight'
import { settingById } from '../shared/settingsRegistry'
import type { SettingsGroupID } from '../shared/settingsGroups'
import { useUISignalStore } from '../shared/uiSignalStore'
import { pushNotice } from '../shared/noticeStore'
import styles from './SettingsView.module.css'

// useSettingsHighlight wires shared/uiSignalStore.ts's settingsHighlightRequest
// (goal 0412 S2 design contract item 3) to SettingsView's own `group`
// state -- split out of SettingsView.tsx (CLAUDE.md's 500-line
// convention) along the same "the request signal decides WHICH pane,
// this hook decides WHEN the DOM actually has the row" seam.
//
// Two effects, not one: the request can arrive before the target
// group's pane has rendered (a fresh mount via `initialSection`, or an
// already-mounted SettingsView on a DIFFERENT group) -- `setGroup`
// only SCHEDULES the render, it does not make the row exist yet. The
// second effect waits for `group` to actually equal the target's own
// group (confirming that render has committed) before touching the
// DOM, the same set-then-consume shape shared/uiSignalStore.ts's own
// header comment documents for a signal whose consumer may remount.
export function useSettingsHighlight(group: SettingsGroupID, setGroup: (next: SettingsGroupID) => void): void {
  const { t } = useTranslation('views')
  const request = useUISignalStore((s) => s.settingsHighlightRequest)
  const seenSeq = useRef(0)
  const [pendingID, setPendingID] = useState<string | null>(null)
  const activeID = useRef<string | null>(null)
  const timeout = useRef<number | null>(null)
  // Amendment 1: the focus half of a jump can still be WAITING on a
  // row's own async data (jumpAndHighlightSetting's own
  // focusRowWhenReady) when a second jump supersedes it -- cancelled
  // here alongside the highlight class so a late data resolution never
  // steals focus back into a discarded jump.
  const cancelFocusWait = useRef<() => void>(() => {})
  // Review finding: a row can be CONDITIONALLY ABSENT on the pane's
  // very first render (SettingsExtensionPolicy.tsx's six
  // security.extension* rows, e.g., which don't render at all until
  // the org policy resolves as managed) -- waitForSettingRow's own
  // cancel handle, superseded/unmounted the same way cancelFocusWait
  // is.
  const cancelRowWait = useRef<() => void>(() => {})

  useEffect(() => {
    if (!request || request.seq === seenSeq.current) return
    seenSeq.current = request.seq
    const entry = settingById(request.id)
    if (!entry) return
    setGroup(entry.group)
    setPendingID(request.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setGroup is SettingsView's own useState setter, stable across renders
  }, [request])

  useEffect(() => {
    if (!pendingID) return
    const entry = settingById(pendingID)
    if (!entry || entry.group !== group) return
    const id = pendingID
    setPendingID(null)

    if (timeout.current !== null) window.clearTimeout(timeout.current)
    if (activeID.current) clearSettingHighlight(activeID.current, styles.searchHighlight)
    cancelFocusWait.current()
    cancelRowWait.current()

    const applyHighlight = () => {
      const { found, cancelFocusWait: cancel } = jumpAndHighlightSetting(id, styles.searchHighlight)
      if (found) {
        activeID.current = id
        cancelFocusWait.current = cancel
        timeout.current = window.setTimeout(() => {
          if (activeID.current === id) {
            clearSettingHighlight(id, styles.searchHighlight)
            activeID.current = null
          }
        }, SETTINGS_HIGHLIGHT_MS)
        return
      }
      // The row hasn't rendered yet -- retry once it appears (a still-
      // pending fetch); if it never does within the bound, this
      // setting's CURRENT state doesn't show it at all, so land
      // silently on the pane but say why the jump had nothing to show.
      cancelRowWait.current = waitForSettingRow(id, () => applyHighlight(), () => {
        pushNotice({ text: t('settings.search.notFound'), level: 'info' })
      })
    }
    applyHighlight()
  }, [group, pendingID, t])

  useEffect(() => () => {
    if (timeout.current !== null) window.clearTimeout(timeout.current)
    cancelFocusWait.current()
    cancelRowWait.current()
  }, [])
}
