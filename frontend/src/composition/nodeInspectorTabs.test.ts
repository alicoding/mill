import { describe, expect, it } from 'vitest'
import type { RunStep } from '../shared/bindings'
import { clampTab, hasRunStepData, inspectorTabBadges, inspectorTabsFor } from './nodeInspectorTabs'

function step(over: Partial<RunStep>): RunStep {
  return { nodeID: 'n1', input: '', output: '', ...over } as RunStep
}

describe('inspectorTabsFor', () => {
  it('offers Parameters and Settings only for a trigger', () => {
    expect(inspectorTabsFor('trigger')).toEqual(['parameters', 'settings'])
  })

  it('offers Parameters and Settings only for a decision', () => {
    expect(inspectorTabsFor('decision')).toEqual(['parameters', 'settings'])
  })

  it('offers all three tabs for process, apply, capture and terminal', () => {
    for (const kind of ['process', 'apply', 'capture', 'terminal']) {
      expect(inspectorTabsFor(kind)).toEqual(['parameters', 'settings', 'test'])
    }
  })

  it('gives a trigger or decision its Test tab back once a run recorded data for it', () => {
    expect(inspectorTabsFor('trigger', true)).toEqual(['parameters', 'settings', 'test'])
    expect(inspectorTabsFor('decision', true)).toEqual(['parameters', 'settings', 'test'])
  })
})

describe('clampTab', () => {
  it('keeps a tab the kind offers', () => {
    expect(clampTab('settings', 'trigger')).toBe('settings')
    expect(clampTab('test', 'process')).toBe('test')
  })

  it('falls back to parameters for a tab the kind refuses', () => {
    expect(clampTab('test', 'trigger')).toBe('parameters')
    expect(clampTab('test', 'decision')).toBe('parameters')
  })

  it('keeps a remembered Test tab on a trigger the run recorded data for', () => {
    expect(clampTab('test', 'trigger', true)).toBe('test')
  })

  it('falls back to parameters for nothing remembered or an unknown value', () => {
    expect(clampTab(null, 'process')).toBe('parameters')
    expect(clampTab('nonsense', 'process')).toBe('parameters')
  })
})

describe('hasRunStepData', () => {
  it('is false with no step at all', () => {
    expect(hasRunStepData(undefined)).toBe(false)
  })

  it('is false for a step that recorded nothing', () => {
    expect(hasRunStepData(step({ input: '', output: '' }))).toBe(false)
    expect(hasRunStepData(step({ inputAttributes: {}, outputAttributes: {} }))).toBe(false)
  })

  it('is true for any recorded payload or attribute', () => {
    expect(hasRunStepData(step({ input: 'hello' }))).toBe(true)
    expect(hasRunStepData(step({ output: 'world' }))).toBe(true)
    expect(hasRunStepData(step({ inputAttributes: { a: 1 } }))).toBe(true)
    expect(hasRunStepData(step({ outputAttributes: { b: 2 } }))).toBe(true)
  })
})

describe('inspectorTabBadges', () => {
  it('leaves both labels bare with no rules, no breakpoint and no run data', () => {
    expect(inspectorTabBadges({ ruleCount: 0, breakpointSet: false, runStep: undefined })).toEqual({
      settingsCount: undefined,
      settingsBreakpoint: false,
      testCount: undefined,
    })
  })

  it('counts the rules that apply to the step', () => {
    expect(inspectorTabBadges({ ruleCount: 2, breakpointSet: false, runStep: undefined }).settingsCount).toBe(2)
  })

  it('marks a set breakpoint as a state, never a count', () => {
    const badges = inspectorTabBadges({ ruleCount: 0, breakpointSet: true, runStep: undefined })
    expect(badges.settingsBreakpoint).toBe(true)
    expect(badges.settingsCount).toBeUndefined()
  })

  it('carries both a rule count and the breakpoint mark together', () => {
    const badges = inspectorTabBadges({ ruleCount: 3, breakpointSet: true, runStep: undefined })
    expect(badges).toEqual({ settingsCount: 3, settingsBreakpoint: true, testCount: undefined })
  })

  it('counts run data as one, and only when the step recorded something', () => {
    expect(inspectorTabBadges({ ruleCount: 0, breakpointSet: false, runStep: step({ input: 'x' }) }).testCount).toBe(1)
    expect(inspectorTabBadges({ ruleCount: 0, breakpointSet: false, runStep: step({}) }).testCount).toBeUndefined()
  })
})
