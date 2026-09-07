import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// STATIC SOURCE-AUDIT test (see atlasEditorBoundsConformance.test.ts's
// header for why): reads QuickPanel.module.css as text, since this
// repo carries no component-rendering harness that loads real CSS
// (NavRail.test.tsx's own comment: the kit's own stylesheet "pulls its
// stylesheet in at import, which the node test runtime cannot load").
//
// Pins goal 0377's drag-region contract: the facet-chip row and
// FilteredActionList's own "Header" wrapper (the search input's
// container -- @primer/react's own name for it, confirmed directly
// against the installed FilteredActionListInput.js's
// data-component="FilteredActionList.Header") carry
// --wails-draggable: drag, and every interactive descendant -- the
// input itself, its buttons, the chip buttons, the result rows -- opts
// back out with --wails-draggable: no-drag. Nothing else in the panel
// needs a no-drag rule: the custom property defaults to no-drag
// everywhere it's unset, so only the two drag containers' own
// descendants matter.
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'QuickPanel.module.css')

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasDragRule(selector: string, value: 'drag' | 'no-drag', css: string): boolean {
  const pattern = `${escapeRegExp(selector)}[^{]*\\{[^}]*--wails-draggable:\\s*${value}`
  return new RegExp(pattern).test(css)
}

describe('QuickPanel drag region conformance (goal 0377)', () => {
  it('drags by the facet-chip row and the search input\'s own Header wrapper', () => {
    const css = readFileSync(cssPath, 'utf8')
    expect(hasDragRule('[data-testid="facet-chip-row"]', 'drag', css)).toBe(true)
    expect(hasDragRule('[data-component="FilteredActionList.Header"]', 'drag', css)).toBe(true)
  })

  it('opts every interactive descendant of the drag region back out', () => {
    const css = readFileSync(cssPath, 'utf8')
    expect(hasDragRule('[data-testid="facet-chip-row"] button', 'no-drag', css)).toBe(true)
    expect(hasDragRule('[data-component="FilteredActionList.Header"] input', 'no-drag', css)).toBe(true)
    expect(hasDragRule('[data-component="FilteredActionList.Header"] button', 'no-drag', css)).toBe(true)
  })

  it('keeps the result rows and their scroll container out of the drag region', () => {
    const css = readFileSync(cssPath, 'utf8')
    expect(hasDragRule('[role="option"]', 'no-drag', css)).toBe(true)
    expect(hasDragRule('[role="listbox"]', 'no-drag', css)).toBe(true)
  })
})
