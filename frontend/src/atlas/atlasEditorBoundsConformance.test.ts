import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Regression coverage for goal 0199's own correction: AtlasStickyNode
// constrained its editor correctly; MarkdownNoteField had zero
// bounding rules at all, so the editor grew with row count at both of
// its own mount sites (AtlasNoteOverlay.tsx and AtlasCardPageFields.tsx,
// both delegating to the one shared MarkdownNoteField component). The
// contract every Atlas canvas text-editing surface must hold: an
// editor mount never grows its own box past a bound. Goal 0244 S3
// replaced the note's editor (CodeEditor/CodeMirror -> MilkdownEditor/
// ProseMirror); this file's DISCOVERY pattern tracks the current
// component name rather than pinning one now-retired engine, so the
// same regression guarantee survives an editor-technology swap.
//
// Three shapes satisfy the contract today, and this check accepts any
// of them rather than forcing one:
//   (a) AtlasStickyNode's own `.cm-editor { height: 100% }` +
//       `.cm-scroller { overflow-y: ... }` pair (composition/'s own
//       remaining CodeEditor mounts, e.g. TryConversionSection).
//   (b) AtlasStickyNode's current `.milkdown { height: 100% }` +
//       an ancestor `overflow-y` (its own `.sticky.editing`), filling
//       a box the PARENT already bounds (a persisted Size, or
//       editingUnsized's own grow-to-fit cap) -- same shape as (a),
//       one level up since Milkdown's own mount carries no scroller
//       class of its own to target directly.
//   (c) MarkdownNoteField's own wrapper `max-height` + `overflow-y`,
//       for a mount with no persisted Size of its own to inherit --
//       tried the (a)/(b) shape first and measured it NOT to work here
//       (MarkdownNoteField.module.css's own header has the full
//       Chromium percentage-resolution finding).
//
// DISCOVERY, not a hand-maintained list (the exact shape this goal
// exists to replace): every .tsx file directly under frontend/src/atlas
// is scanned for a `<CodeEditor` or `<MilkdownEditor` JSX mount; a
// THIRD future mount site is caught automatically without anyone
// remembering to add it here. Scoped to atlas/ specifically --
// composition/'s own CodeEditor mounts (script/HTML config fields) are
// page-scrollable form fields in a different bounded context, never
// proven broken, and out of this goal's own five-defect scope.
//
// STATIC SOURCE-AUDIT test (see atlasSelectionRingConformance.test.ts's
// header for why): reads each component's OWN co-located CSS Module as
// text, since this repo carries no component-rendering harness to
// measure a real computed height against.
const atlasDir = dirname(fileURLToPath(import.meta.url))

function textEditorMountFiles(): string[] {
  return readdirSync(atlasDir)
    .filter((f) => f.endsWith('.tsx'))
    .filter((f) => /<CodeEditor\b|<MilkdownEditor\b/.test(readFileSync(join(atlasDir, f), 'utf8')))
}

function hasBoundedHeightDeclaration(cssText: string): boolean {
  const cmEditorBounded = /\.cm-editor\s*\)?\s*\{[^}]*height\s*:\s*100%/s.test(cssText)
  const cmScrollerOverflows = /\.cm-scroller\s*\)?\s*\{[^}]*overflow(?:-y)?\s*:/s.test(cssText)
  const milkdownBounded = /\.milkdown\s*\)?\s*\{[^}]*height\s*:\s*100%/s.test(cssText)
  const ancestorOverflows = /\{[^}]*overflow(?:-y)?\s*:\s*auto/s.test(cssText)
  const wrapperBounded = /\{[^}]*max-height\s*:[^}]*overflow(?:-y)?\s*:/s.test(cssText)
    || /\{[^}]*overflow(?:-y)?\s*:[^}]*max-height\s*:/s.test(cssText)
  return (cmEditorBounded && cmScrollerOverflows) || (milkdownBounded && ancestorOverflows) || wrapperBounded
}

describe('atlas text-editor bounded-height conformance (goal 0181 S3, regression for goal 0199, updated for goal 0244 S3)', () => {
  it('discovers at least the two known Atlas canvas mount sites', () => {
    // Pins the discovery mechanism itself: if this drops to zero, the
    // scan broke, not the feature -- the two mount sites (sticky's own
    // inline editor, the card note field) are long-standing.
    expect(textEditorMountFiles().length).toBeGreaterThanOrEqual(2)
  })

  it('requires a bounded-height CSS rule co-located with every text-editor mount under atlas/', () => {
    const unbounded: string[] = []
    for (const file of textEditorMountFiles()) {
      const cssFile = file.replace(/\.tsx$/, '.module.css')
      let cssText: string
      try {
        cssText = readFileSync(join(atlasDir, cssFile), 'utf8')
      } catch {
        unbounded.push(`${file}: mounts an editor but has no co-located ${cssFile} at all`)
        continue
      }
      if (!hasBoundedHeightDeclaration(cssText)) {
        unbounded.push(`${file}: mounts an editor but ${cssFile} declares none of the accepted bounded-height shapes -- the editor grows with row count (goal 0199's own regression)`)
      }
    }
    expect(unbounded).toEqual([])
  })
})
