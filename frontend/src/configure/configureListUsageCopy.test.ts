import { describe, expect, it } from 'vitest'
import { isUnusedList, usageLineFor } from './configureListUsageCopy'

// A tiny stand-in for i18next's t(): resolves the SAME keys/params
// configure.json actually declares, so this test catches a renamed key
// the same way a real mount would.
const t = (key: string, opts?: Record<string, unknown>): string => {
  const count = opts?.count as number | undefined
  switch (key) {
    case 'configureLists.usageNone': return 'Not used anywhere'
    case 'configureLists.usageBoards': return count === 1 ? '1 board' : `${count} boards`
    case 'configureLists.usageWorkflows': return count === 1 ? '1 workflow' : `${count} workflows`
    case 'configureLists.usageLine': return `Used on ${opts?.boards} · ${opts?.workflows}`
    default: return key
  }
}

describe('usageLineFor', () => {
  it('reports "Not used anywhere" when both counts are zero', () => {
    expect(usageLineFor(t, { Boards: 0, Workflows: 0 })).toBe('Not used anywhere')
  })

  it('treats an unresolved usage (undefined) the same as zero', () => {
    expect(usageLineFor(t, undefined)).toBe('Not used anywhere')
  })

  it('joins the boards and workflows fragments, singular and plural', () => {
    expect(usageLineFor(t, { Boards: 1, Workflows: 2 })).toBe('Used on 1 board · 2 workflows')
    expect(usageLineFor(t, { Boards: 3, Workflows: 1 })).toBe('Used on 3 boards · 1 workflow')
  })
})

describe('isUnusedList', () => {
  it('is false while usage is unresolved (undefined)', () => {
    expect(isUnusedList(undefined)).toBe(false)
  })

  it('is true only when both counts are zero', () => {
    expect(isUnusedList({ Boards: 0, Workflows: 0 })).toBe(true)
    expect(isUnusedList({ Boards: 1, Workflows: 0 })).toBe(false)
    expect(isUnusedList({ Boards: 0, Workflows: 1 })).toBe(false)
  })
})
