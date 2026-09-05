import { describe, expect, it } from 'vitest'
import { runEntryPointFor } from './startWorkflowRun'

describe('runEntryPointFor', () => {
  it('uses the environment entry point whenever the caller offered the choice, empty included', () => {
    expect(runEntryPointFor(undefined, '')).toBe('environment')
    expect(runEntryPointFor('some payload', 'env-1')).toBe('environment')
  })

  it('falls back to the payload entry point, then the plain one', () => {
    expect(runEntryPointFor('some payload', undefined)).toBe('payload')
    expect(runEntryPointFor(undefined, undefined)).toBe('plain')
    expect(runEntryPointFor('', undefined)).toBe('plain')
  })
})
