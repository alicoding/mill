import { describe, expect, it } from 'vitest'
import { pluginNeedsActivation } from './loader'

describe('pluginNeedsActivation', () => {
  it('skips main.js only for a backend-classified data-only package', () => {
    expect(pluginNeedsActivation({ DataOnly: true })).toBe(false)
    expect(pluginNeedsActivation({ DataOnly: false })).toBe(true)
  })
})
