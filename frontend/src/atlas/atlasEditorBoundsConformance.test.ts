import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Regression coverage for goal 0199's own correction: AtlasStickyNode
// constrained CodeMirror correctly; MarkdownNoteField had zero bounding
// rules at all, so the editor grew with row count at both of its own
// mount sites (AtlasNoteOverlay.tsx and AtlasCardPageFields.tsx, both
// delegating to the one shared MarkdownNoteField component). The
// contract every Atlas canvas text-editing surface must hold: a
// CodeMirror mount never grows its own box past a bound.
//
// Two DIFFERENT implementations satisfy that same contract today, and
// this check accepts either shape rather than forcing one:
//   (a) AtlasStickyNode's own `.cm-editor { height: 100% }` +
//       `.cm-scroller { overflow-y: ... }` pair, filling a box the
//       PARENT already bounds (a persisted Size, or editingUnsized's
//       own grow-to-fit cap).
//   (b) MarkdownNoteField's own wrapper `max-height` + `overflow-y`,
//       for a mount with no persisted Size of its own to inherit --
//       tried the (a) shape first and measured it NOT to work here
//       (MarkdownNoteField.module.css's own header has the full
//       Chromium percentage-resolution finding).
//
// DISCOVERY, not a hand-maintained list (the exact shape this goal
// exists to replace): every .tsx file directly under frontend/src/atlas
// is scanned for a `<CodeEditor` JSX mount; a THIRD future mount site
// is caught automatically without anyone remembering to add it here.
// Scoped to atlas/ specifically -- composition/'s own CodeEditor mounts
// (script/HTML config fields) are page-scrollable form fields in a
// different bounded context, never proven broken, and out of this
// goal's own five-defect scope.
//
// STATIC SOURCE-AUDIT test (see atlasSelectionRingConformance.test.ts's
// header for why): reads each component's OWN co-located CSS Module as
// text, since this repo carries no component-rendering harness to
// measure a real computed height against.
const atlasDir = dirname(fileURLToPath(import.meta.url))

function codeEditorMountFiles(): string[] {
  return readdirSync(atlasDir)
    .filter((f) => f.endsWith('.tsx'))
    .filter((f) => /<CodeEditor\b/.test(readFileSync(join(atlasDir, f), 'utf8')))
}

function hasBoundedHeightDeclaration(cssText: string): boolean {
  const cmEditorBounded = /\.cm-editor\s*\)?\s*\{[^}]*height\s*:\s*100%/s.test(cssText)
  const cmScrollerOverflows = /\.cm-scroller\s*\)?\s*\{[^}]*overflow(?:-y)?\s*:/s.test(cssText)
  const wrapperBounded = /\{[^}]*max-height\s*:[^}]*overflow(?:-y)?\s*:/s.test(cssText)
    || /\{[^}]*overflow(?:-y)?\s*:[^}]*max-height\s*:/s.test(cssText)
  return (cmEditorBounded && cmScrollerOverflows) || wrapperBounded
}

describe('atlas CodeMirror editor bounded-height conformance (goal 0181 S3, regression for goal 0199)', () => {
  it('discovers at least the two known Atlas canvas mount sites', () => {
    // Pins the discovery mechanism itself: if this drops to zero, the
    // scan broke, not the feature -- the two mount sites (sticky's own
    // inline editor, the card note field) are long-standing.
    expect(codeEditorMountFiles().length).toBeGreaterThanOrEqual(2)
  })

  it('requires a bounded-height CSS rule co-located with every <CodeEditor mount under atlas/', () => {
    const unbounded: string[] = []
    for (const file of codeEditorMountFiles()) {
      const cssFile = file.replace(/\.tsx$/, '.module.css')
      let cssText: string
      try {
        cssText = readFileSync(join(atlasDir, cssFile), 'utf8')
      } catch {
        unbounded.push(`${file}: mounts <CodeEditor but has no co-located ${cssFile} at all`)
        continue
      }
      if (!hasBoundedHeightDeclaration(cssText)) {
        unbounded.push(`${file}: mounts <CodeEditor but ${cssFile} declares neither the .cm-editor/.cm-scroller pair nor a max-height+overflow wrapper -- the editor grows with row count (goal 0199's own regression)`)
      }
    }
    expect(unbounded).toEqual([])
  })
})
