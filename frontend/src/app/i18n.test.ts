import { describe, expect, it } from 'vitest'
import i18n from './i18n'

// docs/goals/0032-copy-management.md's proof-of-pattern slice: confirms
// the init actually wires resources up (a config typo or a missing
// namespace in the `ns` list would otherwise only surface as a blank
// string live, in whichever component happened to call t() first).
describe('i18n init', () => {
  it('initializes synchronously with English as the active language', () => {
    expect(i18n.isInitialized).toBe(true)
    expect(i18n.language).toBe('en')
  })

  it('resolves a known key from the views namespace (Settings slice)', () => {
    expect(i18n.t('settings.title', { ns: 'views' })).toBe('Settings')
  })

  it('resolves a known key from the common namespace via the ns-prefixed form', () => {
    expect(i18n.t('common:actions.change')).toBe('Change')
  })

  it('interpolates variables into a templated key', () => {
    expect(i18n.t('settings.updates.updateAvailable', { ns: 'views', version: '1.2.3' })).toBe('Update available: v1.2.3')
  })

  it('falls back to the key itself for an unknown key, never throwing', () => {
    expect(() => i18n.t('settings.doesNotExist', { ns: 'views' })).not.toThrow()
  })
})
