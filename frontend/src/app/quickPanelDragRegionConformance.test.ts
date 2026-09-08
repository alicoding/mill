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
// Pins goal 0377's drag-region contract, amended after an installed-
// build check found the first cut's two-header approach left only a
// ~4px ungrabbable sliver: the panel's own OUTER container (.panel)
// carries --wails-draggable: drag -- the converged Raycast/Alfred
// shape, not a single handpicked row -- and every interactive
// descendant (the input, buttons, role=button spans like the pin
// toggle, links, the listbox/its options, and FilteredActionList's own
// root, which covers its scroll container) opts back out with
// --wails-draggable: no-drag. A top padding of at least 12px on .panel
// guarantees a grabbable strip exists even when the facet-chip row
// (its own conditional render) is absent.
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'QuickPanel.module.css')

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasDragRule(selector: string, value: 'drag' | 'no-drag', css: string): boolean {
  const pattern = `${escapeRegExp(selector)}[^{]*\\{[^}]*--wails-draggable:\\s*${value}`
  return new RegExp(pattern).test(css)
}

// The .panel rule block only -- not any compound selector built off it
// (.panel input, .panel button, ...) -- so the padding-top assertion
// below can't accidentally match a different rule's own padding.
function panelRuleBlock(css: string): string {
  const match = /\.panel\s*\{([^}]*)\}/.exec(css)
  if (!match) throw new Error('QuickPanel.module.css has no bare .panel rule to read')
  return match[1]
}

describe('QuickPanel drag region conformance (goal 0377)', () => {
  it('drags by its own outer container', () => {
    const css = readFileSync(cssPath, 'utf8')
    expect(hasDragRule('.panel', 'drag', css)).toBe(true)
  })

  it('opts every interactive descendant back out of the drag region', () => {
    const css = readFileSync(cssPath, 'utf8')
    for (const selector of ['input', 'button', 'a', '[role="button"]', '[role="listbox"]', '[role="option"]', '[data-component="FilteredActionList"]']) {
      expect(hasDragRule(`.panel ${selector}`, 'no-drag', css)).toBe(true)
    }
  })

  it('keeps a grabbable top strip of at least 12px whether or not the facet-chip row renders', () => {
    const css = readFileSync(cssPath, 'utf8')
    const panelBlock = panelRuleBlock(css)
    const match = /padding-top:\s*(\d+)px/.exec(panelBlock)
    expect(match, '.panel has no padding-top declaration').not.toBeNull()
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(12)
  })
})
