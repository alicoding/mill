import { describe, expect, it } from 'vitest'
import { redirectRetiredView } from './viewRedirects'

// Regression: a link to a view that moved must land where the view
// actually is, not on an empty tab that no longer renders anything.
describe('redirectRetiredView', () => {
  it('sends the retired Configure secret-sources tab to Secrets > Sources', () => {
    expect(redirectRetiredView({ kind: 'configure', tab: 'secretsources' })).toEqual({ kind: 'secrets', tab: 'sources' })
  })

  it('leaves every other view exactly as it is', () => {
    expect(redirectRetiredView({ kind: 'configure', tab: 'integration' })).toEqual({ kind: 'configure', tab: 'integration' })
    expect(redirectRetiredView({ kind: 'secrets' })).toEqual({ kind: 'secrets' })
    expect(redirectRetiredView({ kind: 'home' })).toEqual({ kind: 'home' })
  })
})
