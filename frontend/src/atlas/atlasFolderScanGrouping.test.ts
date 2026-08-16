import { describe, expect, it } from 'vitest'
import { ScanCategory } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { FolderScanEntry } from '../shared/bindings'
import { folderScanEntryDepth, groupFolderScanEntries } from './atlasFolderScanGrouping'

function entry(overrides: Partial<FolderScanEntry>): FolderScanEntry {
  return {
    RelPath: 'x', ParentRelPath: '', Name: 'x', IsDir: false,
    Category: ScanCategory.ScanCategoryFile, SuggestedTitle: 'X',
    ...overrides,
  }
}

describe('groupFolderScanEntries', () => {
  it('buckets by category, containers first, then files, then images', () => {
    const groups = groupFolderScanEntries([
      entry({ RelPath: 'logo.png', Category: ScanCategory.ScanCategoryImage }),
      entry({ RelPath: 'notes.md', Category: ScanCategory.ScanCategoryFile }),
      entry({ RelPath: 'Reports', Category: ScanCategory.ScanCategoryContainer, IsDir: true }),
    ])
    expect(groups.map((g) => g.category)).toEqual([
      ScanCategory.ScanCategoryContainer,
      ScanCategory.ScanCategoryFile,
      ScanCategory.ScanCategoryImage,
    ])
    expect(groups[0].entries).toHaveLength(1)
    expect(groups[0].entries[0].RelPath).toBe('Reports')
  })

  it('drops an empty category rather than returning an empty group', () => {
    const groups = groupFolderScanEntries([entry({ RelPath: 'notes.md', Category: ScanCategory.ScanCategoryFile })])
    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBe(ScanCategory.ScanCategoryFile)
  })

  it('returns nothing for an empty scan', () => {
    expect(groupFolderScanEntries([])).toEqual([])
  })
})

describe('folderScanEntryDepth', () => {
  it('is 0 for a root-level entry', () => {
    expect(folderScanEntryDepth('notes.md')).toBe(0)
  })

  it('grows with each nested path segment', () => {
    expect(folderScanEntryDepth('Reports/Q1 Summary.md')).toBe(1)
    expect(folderScanEntryDepth('a/b/c.txt')).toBe(2)
  })
})
