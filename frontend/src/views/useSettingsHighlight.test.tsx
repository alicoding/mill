// @vitest-environment jsdom
import { useState } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsHighlight } from './useSettingsHighlight'
import { useUISignalStore } from '../shared/uiSignalStore'
import { useNoticeStore } from '../shared/noticeStore'
import type { SettingsGroupID } from '../shared/settingsGroups'
import styles from './SettingsView.module.css'

// The race useSettingsHighlight.ts's own header comment names (goal
// 0412 S2 review finding): a SECOND jump superseding a still-active
// highlight, and an unmount while one is pending -- neither had
// coverage. Mounted the same createRoot/act way settingsPanes.test.tsx
// already does (no @testing-library/react in this repo).

function mountRow(id: string): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-setting-id', id)
  row.innerHTML = '<div data-setting-control><button>Set</button></div>'
  document.body.append(row)
  return row
}

function isHighlighted(id: string): boolean {
  return document.querySelector(`[data-setting-id="${id}"]`)?.classList.contains(styles.searchHighlight) ?? false
}

function Harness({ initialGroup }: { initialGroup: SettingsGroupID }) {
  const [group, setGroup] = useState(initialGroup)
  useSettingsHighlight(group, setGroup)
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  useUISignalStore.setState({ settingsHighlightRequest: null })
  useNoticeStore.setState({ notices: [] })
  root = createRoot(container)
  act(() => { root.render(<Harness initialGroup="general" />) })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.querySelectorAll('[data-setting-id]').forEach((el) => el.remove())
  vi.useRealTimers()
})

describe('useSettingsHighlight', () => {
  it('a second jump supersedes a still-active highlight immediately, rather than waiting for the first timer', () => {
    mountRow('general.launchAtLogin')
    mountRow('general.saveMode')

    act(() => { useUISignalStore.getState().requestSettingsHighlight('general.launchAtLogin') })
    expect(isHighlighted('general.launchAtLogin')).toBe(true)

    act(() => { vi.advanceTimersByTime(500) })
    act(() => { useUISignalStore.getState().requestSettingsHighlight('general.saveMode') })

    // Superseded immediately -- not still lit, and not waiting for its
    // OWN now-cleared 2000ms timer to fire.
    expect(isHighlighted('general.launchAtLogin')).toBe(false)
    expect(isHighlighted('general.saveMode')).toBe(true)

    // The first setting's original timer (armed at t=0, due at t=2000)
    // must not clear the SECOND setting's highlight at t=2000 -- it
    // was cancelled when superseded.
    act(() => { vi.advanceTimersByTime(1500) })
    expect(isHighlighted('general.saveMode')).toBe(true)

    // The second setting's OWN 2000ms window (armed at t=500) elapses.
    act(() => { vi.advanceTimersByTime(500) })
    expect(isHighlighted('general.saveMode')).toBe(false)
  })

  it('cancels a pending highlight timer on unmount, so it never fires against a later mount\'s same-id row', () => {
    mountRow('general.launchAtLogin')
    const clearSpy = vi.spyOn(window, 'clearTimeout')

    act(() => { useUISignalStore.getState().requestSettingsHighlight('general.launchAtLogin') })
    expect(isHighlighted('general.launchAtLogin')).toBe(true)

    act(() => { root.unmount() })
    expect(clearSpy).toHaveBeenCalled()

    // A fresh row for the SAME id, as a later navigation would render.
    // The cancelled timer must never reach into it.
    document.querySelector('[data-setting-id="general.launchAtLogin"]')?.remove()
    mountRow('general.launchAtLogin')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(isHighlighted('general.launchAtLogin')).toBe(false)
    clearSpy.mockRestore()
  })

  it('notifies rather than navigating silently when a registry entry\'s row never renders in the current state (review finding)', () => {
    // security.extensionManagedBy is a REAL registry entry, but its
    // row is CONDITIONALLY absent (SettingsExtensionPolicy.tsx only
    // renders it once an org policy resolves as managed) -- never
    // mounted here, standing in for that state.
    act(() => { root.unmount() })
    root = createRoot(container)
    act(() => { root.render(<Harness initialGroup="security" />) })

    act(() => { useUISignalStore.getState().requestSettingsHighlight('security.extensionManagedBy') })
    expect(useNoticeStore.getState().notices).toHaveLength(0)

    act(() => { vi.advanceTimersByTime(2000) })
    const notices = useNoticeStore.getState().notices
    expect(notices).toHaveLength(1)
    // No i18next instance is booted in this test (no react-i18next
    // mock, unlike settingsPanes.test.tsx's real-copy resolution) --
    // useTranslation() falls back to the raw key, which is still
    // proof the RIGHT key was asked for.
    expect(notices[0].text).toBe('settings.search.notFound')
  })
})
