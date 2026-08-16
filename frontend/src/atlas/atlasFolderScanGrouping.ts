import { ScanCategory } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { FolderScanEntry } from '../shared/bindings'

// The synced-folder-onboarding preview's own pure grouping/ordering
// logic (goal 0067), extracted so it's unit-testable independent of
// the dialog that renders it -- same split AtlasView.tsx's own
// atlasGrouping.ts already establishes for the space shelves.

export interface FolderScanGroup {
  category: ScanCategory
  entries: FolderScanEntry[]
}

// Containers first (so the tree's own structure reads top-down),
// then files, then images -- a fixed, deterministic display order
// rather than first-seen-in-scan order.
const CATEGORY_ORDER: ScanCategory[] = [ScanCategory.ScanCategoryContainer, ScanCategory.ScanCategoryFile, ScanCategory.ScanCategoryImage]

// groupFolderScanEntries buckets entries by their own Category,
// dropping any category with nothing in it, in CATEGORY_ORDER.
export function groupFolderScanEntries(entries: FolderScanEntry[]): FolderScanGroup[] {
  const byCategory = new Map<ScanCategory, FolderScanEntry[]>()
  for (const entry of entries) {
    const list = byCategory.get(entry.Category)
    if (list) {
      list.push(entry)
    } else {
      byCategory.set(entry.Category, [entry])
    }
  }
  return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
    category,
    entries: byCategory.get(category) ?? [],
  }))
}

// folderScanEntryDepth reports how deeply nested a RelPath is (0 for a
// root-level entry) -- the preview tree's own indentation amount.
export function folderScanEntryDepth(relPath: string): number {
  if (relPath === '') return 0
  return relPath.split('/').length - 1
}
