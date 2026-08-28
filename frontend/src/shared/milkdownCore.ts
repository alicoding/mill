import { Crepe } from '@milkdown/crepe'
// Structural layout only (flex/spacing/box-model) -- every color/font/
// shadow value it references is a `--crepe-*` custom property, left
// unset here and supplied by MilkdownEditor.module.css's own Primer-
// token mapping (frontend.md: Primer tokens only, no hand-picked
// hex). Verified against the installed package: only ai.css/diff.css
// (both unused -- the AI feature stays off, see the note below) carry
// any literal color.
import '@milkdown/crepe/theme/common/style.css'
import { $remark } from '@milkdown/utils'

// The Milkdown machinery behind shared/MilkdownEditor.tsx -- reachable
// only through that component's dynamic import (goal 0244 S3), so the
// ProseMirror/remark tree stays inside this module's own lazy chunk
// rather than the eagerly-loaded main bundle. Re-exports Crepe so the
// door component never imports @milkdown/crepe itself.
export { Crepe }

// The canvas-note trim (ADR-0046, goal 0244 S3's converged-pattern
// verdict, goal 0247's chrome-removal pass): inline formatting + lists
// + checkboxes stay, the block-tree editor's own signature features
// (slash-command menu, tables, LaTeX, the CodeMirror code-block
// widget's language picker/copy button/gutter, drag-handle block
// reorder) don't fit a short sticky and are cut. AI stays off by
// construction -- Crepe.Feature.AI defaults to false and is never
// listed here, so its llm-providers code path is never reachable
// (CLAUDE.md's no-AI-API-calls constraint).
export const NOTE_FEATURES = {
  [Crepe.Feature.Table]: false,
  [Crepe.Feature.Latex]: false,
  [Crepe.Feature.BlockEdit]: false,
  [Crepe.Feature.CodeMirror]: false,
}

// Disables CommonMark's INDENTED code block construct (a bare line
// starting with 4 spaces/a tab) via micromark's own documented
// `disable` mechanism -- Milkdown's public `$remark` extension point,
// not a hand-rolled parser. A short canvas note has no code-block
// affordance (CodeMirror feature is off above); left enabled, any
// incidental leading whitespace on a line -- including 4 literal
// spaces Milkdown's own always-on Tab-indent shortcut inserts at a
// paragraph/heading start -- silently swallows that ENTIRE line into
// a code block on next parse, hiding real content (e.g. "# ddka"
// stored with a leading tab renders as an opaque code block instead
// of the heading "ddka" the user typed). Fenced code (```) is a
// different construct and is unaffected -- it still parses (as a
// plain node once the CodeMirror feature above is off; see the
// commonmark preset's own toDOM fallback).
export const disableIndentedCodeBlock = $remark('disableIndentedCodeBlock', () => {
  return function attach(this: { data: (key?: string) => unknown }) {
    const processorData = this.data() as { micromarkExtensions?: unknown[] }
    const extensions = (processorData.micromarkExtensions ??= [])
    extensions.push({ disable: { null: ['codeIndented'] } })
  }
})
