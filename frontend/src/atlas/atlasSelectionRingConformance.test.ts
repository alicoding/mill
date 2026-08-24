import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLeafCssRules } from './atlasCssRuleScan'

// Regression coverage for goal 0197: every noun's selection ring reads
// from AtlasBoard.module.css's ONE shared `.react-flow__node.selected`
// box-shadow rule (that file's own header has the full outline-vs-
// box-shadow reasoning -- React Flow's own stylesheet resets
// `.selectable:focus` to `outline: none` at higher specificity than a
// single-type `.selected` rule, so an outline-based ring silently loses
// the instant the wrapper holds real DOM focus). A per-noun CSS module
// may only override the two custom properties (`--mill-ring-inner`/
// `--mill-ring-outer`/`--mill-ring-radius`) that rule reads; declaring
// its OWN `outline` for a `.selected` state is the exact regression
// this test pins -- a real value (not `none`) silently loses to React
// Flow's reset the moment the node is clicked.
//
// STATIC SOURCE-AUDIT test (a third kind alongside compile-time/module-
// eval, named explicitly per this goal's own contract): reads each CSS
// Module file's text directly via Node `fs`, never renders anything --
// this repo carries no component-rendering harness (no
// @testing-library/react/jsdom dependency), and computed-style
// assertions on real CSS cascade order aren't reachable from a plain
// unit test even if it did. Text-scanning a small, explicit rule shape
// is the cheapest check that actually falls over when the shape
// regresses.
const atlasDir = dirname(fileURLToPath(import.meta.url))
const SHARED_RULE_FILE = 'AtlasBoard.module.css'

function ownCssModuleFiles(): string[] {
  return readdirSync(atlasDir).filter((f) => f.endsWith('.module.css') && f !== SHARED_RULE_FILE)
}

function outlineViolations(selector: string, body: string): string | null {
  if (!selector.includes('.selected')) return null
  const outlineMatch = /outline(?!-offset)\s*:\s*([^;]+);/.exec(body)
  if (!outlineMatch) return null
  const value = outlineMatch[1].trim()
  if (value === 'none') return null
  return `selector "${selector}" sets outline: ${value} -- React Flow's own .selectable:focus reset silently wins over this; vary only --mill-ring-inner/--mill-ring-outer/--mill-ring-radius (AtlasBoard.module.css) instead`
}

describe('atlas selection ring conformance (goal 0181 S3, regression for goal 0197)', () => {
  it('keeps the shared box-shadow rule declared in AtlasBoard.module.css', () => {
    const sharedCss = readFileSync(join(atlasDir, SHARED_RULE_FILE), 'utf8')
    const rules = parseLeafCssRules(sharedCss)
    const sharedRing = rules.find((r) => r.selector.includes('.react-flow__node.selected'))
    expect(sharedRing, 'AtlasBoard.module.css must declare the shared .react-flow__node.selected rule').toBeDefined()
    expect(sharedRing?.body).toMatch(/box-shadow\s*:/)
  })

  it('never lets a per-noun CSS module declare its own outline for a .selected state', () => {
    const violations: string[] = []
    for (const file of ownCssModuleFiles()) {
      const text = readFileSync(join(atlasDir, file), 'utf8')
      for (const { selector, body } of parseLeafCssRules(text)) {
        const violation = outlineViolations(selector, body)
        if (violation) violations.push(`${file}: ${violation}`)
      }
    }
    expect(violations).toEqual([])
  })
})
