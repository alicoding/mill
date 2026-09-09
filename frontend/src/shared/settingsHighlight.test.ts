// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSettingHighlight, jumpAndHighlightSetting, waitForSettingRow } from './settingsHighlight'

// The highlight helper (goal 0412 S2 design contract item 3), driven
// against a bare DOM fixture -- no React tree (the highlight class's
// own 2-second clear lives in the calling effect,
// views/useSettingsHighlight.ts, so this file only proves the DOM
// half: scroll + class + the READY-GATED focus, Amendment 1).

const HIGHLIGHT_CLASS = 'searchHighlight'

function mountRow(id: string, controlHTML: string, ready?: boolean): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-setting-id', id)
  if (ready !== undefined) row.setAttribute('data-setting-ready', ready ? 'true' : 'false')
  row.innerHTML = `
    <div class="rowText"><a href="#">Learn more</a></div>
    <div data-setting-control>${controlHTML}</div>
  `
  document.body.append(row)
  return row
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('jumpAndHighlightSetting', () => {
  it('returns found: false and touches nothing when the id has no rendered row', () => {
    const { found } = jumpAndHighlightSetting('nonsense.setting', HIGHLIGHT_CLASS)
    expect(found).toBe(false)
  })

  it('applies the highlight class to the row', () => {
    mountRow('general.launchAtLogin', '<button>Set</button>')
    const { found } = jumpAndHighlightSetting('general.launchAtLogin', HIGHLIGHT_CLASS)
    expect(found).toBe(true)
    const row = document.querySelector('[data-setting-id="general.launchAtLogin"]')
    expect(row?.classList.contains(HIGHLIGHT_CLASS)).toBe(true)
  })

  it('focuses the row\'s own control immediately when no data-setting-ready is present (a row with no async dependency)', () => {
    mountRow('shortcuts.globalHotkey', '<button data-testid="set-summon-hotkey">Set a shortcut</button>')
    jumpAndHighlightSetting('shortcuts.globalHotkey', HIGHLIGHT_CLASS)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('set-summon-hotkey')
  })

  it('focuses immediately when data-setting-ready is already "true"', () => {
    mountRow('shortcuts.globalHotkey', '<button data-testid="set-summon-hotkey">Set a shortcut</button>', true)
    jumpAndHighlightSetting('shortcuts.globalHotkey', HIGHLIGHT_CLASS)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('set-summon-hotkey')
  })

  it('never focuses the label text\'s "Learn more" link that comes first in the DOM', () => {
    mountRow('shortcuts.globalHotkey', '<button data-testid="set-summon-hotkey">Set a shortcut</button>')
    jumpAndHighlightSetting('shortcuts.globalHotkey', HIGHLIGHT_CLASS)
    expect(document.activeElement?.getAttribute('data-testid')).not.toBe(null)
    expect(document.activeElement?.tagName).not.toBe('A')
  })

  it('scrolls the row into view when the environment supports it', () => {
    const row = mountRow('general.saveMode', '<select><option>Auto</option></select>')
    const scroll = vi.fn()
    row.scrollIntoView = scroll
    jumpAndHighlightSetting('general.saveMode', HIGHLIGHT_CLASS)
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  it('does not throw when scrollIntoView is unavailable (jsdom default)', () => {
    mountRow('general.canvasNavigation', '<button>Change</button>')
    expect(() => jumpAndHighlightSetting('general.canvasNavigation', HIGHLIGHT_CLASS)).not.toThrow()
  })

  describe('the readiness wait (Amendment 1: a control swapped in once async data resolves)', () => {
    it('waits for data-setting-ready to flip false -> true before focusing, then focuses once, on the NEW control', () => {
      const row = mountRow('shortcuts.globalHotkey', '<button data-testid="loading-placeholder" disabled>Loading</button>', false)
      jumpAndHighlightSetting('shortcuts.globalHotkey', HIGHLIGHT_CLASS)
      // Not focused yet -- still waiting.
      expect(document.activeElement).not.toBe(row.querySelector('[data-testid="loading-placeholder"]'))

      // The pane's own re-render: real content replaces the loading
      // placeholder, then the attribute flips.
      row.querySelector('[data-setting-control]')!.innerHTML = '<button data-testid="set-summon-hotkey">Set a shortcut</button>'
      row.setAttribute('data-setting-ready', 'true')

      return Promise.resolve().then(() => {
        expect(document.activeElement?.getAttribute('data-testid')).toBe('set-summon-hotkey')
      })
    })

    it('falls back to focusing whatever control exists if the row never becomes ready', () => {
      vi.useFakeTimers()
      const row = mountRow('shortcuts.globalHotkey', '<button data-testid="loading-placeholder">Loading</button>', false)
      jumpAndHighlightSetting('shortcuts.globalHotkey', HIGHLIGHT_CLASS)
      expect(document.activeElement).not.toBe(row.querySelector('[data-testid="loading-placeholder"]'))

      vi.advanceTimersByTime(2000)
      expect(document.activeElement?.getAttribute('data-testid')).toBe('loading-placeholder')
    })

    it('cancelFocusWait stops a later ready-flip from stealing focus', async () => {
      const row = mountRow('shortcuts.globalHotkey', '<button data-testid="loading-placeholder" disabled>Loading</button>', false)
      const { cancelFocusWait } = jumpAndHighlightSetting('shortcuts.globalHotkey', HIGHLIGHT_CLASS)
      cancelFocusWait()

      row.querySelector('[data-setting-control]')!.innerHTML = '<button data-testid="set-summon-hotkey">Set a shortcut</button>'
      row.setAttribute('data-setting-ready', 'true')
      await Promise.resolve()

      expect(document.activeElement?.getAttribute('data-testid')).not.toBe('set-summon-hotkey')
    })
  })
})

describe('waitForSettingRow (review finding: a row can be CONDITIONALLY ABSENT, not merely loading)', () => {
  it('calls onFound synchronously when the row already exists', () => {
    const row = mountRow('security.extensionManagedBy', '<span>IT</span>')
    const onFound = vi.fn()
    const onTimeout = vi.fn()
    waitForSettingRow('security.extensionManagedBy', onFound, onTimeout)
    expect(onFound).toHaveBeenCalledWith(row)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('calls onFound once the row appears later (a policy fetch resolving as managed)', async () => {
    const onFound = vi.fn()
    const onTimeout = vi.fn()
    waitForSettingRow('security.extensionManagedBy', onFound, onTimeout)
    expect(onFound).not.toHaveBeenCalled()

    const row = mountRow('security.extensionManagedBy', '<span>IT</span>')
    await Promise.resolve()

    expect(onFound).toHaveBeenCalledWith(row)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('calls onTimeout if the row never appears within the bound (an unmanaged policy never renders it)', () => {
    vi.useFakeTimers()
    const onFound = vi.fn()
    const onTimeout = vi.fn()
    waitForSettingRow('security.extensionManagedBy', onFound, onTimeout)

    vi.advanceTimersByTime(2000)

    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onFound).not.toHaveBeenCalled()
  })

  it('the cancel function stops either callback from firing', async () => {
    const onFound = vi.fn()
    const onTimeout = vi.fn()
    const cancel = waitForSettingRow('security.extensionManagedBy', onFound, onTimeout)
    cancel()

    mountRow('security.extensionManagedBy', '<span>IT</span>')
    await Promise.resolve()

    expect(onFound).not.toHaveBeenCalled()
    expect(onTimeout).not.toHaveBeenCalled()
  })
})

describe('clearSettingHighlight', () => {
  it('removes a highlight this file applied', () => {
    mountRow('general.launchAtLogin', '<button>Set</button>')
    jumpAndHighlightSetting('general.launchAtLogin', HIGHLIGHT_CLASS)
    clearSettingHighlight('general.launchAtLogin', HIGHLIGHT_CLASS)
    const row = document.querySelector('[data-setting-id="general.launchAtLogin"]')
    expect(row?.classList.contains(HIGHLIGHT_CLASS)).toBe(false)
  })

  it('is a no-op for a row that is no longer mounted', () => {
    expect(() => clearSettingHighlight('nonsense.setting', HIGHLIGHT_CLASS)).not.toThrow()
  })
})
