import { Crepe } from '@milkdown/crepe'
// Structural layout only (flex/spacing/box-model) -- every color/font/
// shadow value it references is a `--crepe-*` custom property, left
// unset here and supplied by MilkdownEditor.module.css's own Primer-
// token mapping (frontend.md: Primer tokens only, no hand-picked
// hex). Verified against the installed package: only ai.css/diff.css
// (both unused -- the AI feature stays off, see the note below) carry
// any literal color.
import '@milkdown/crepe/theme/common/style.css'

// The Milkdown machinery behind shared/MilkdownEditor.tsx -- reachable
// only through that component's dynamic import (goal 0244 S3), so the
// ProseMirror/remark tree stays inside this module's own lazy chunk
// rather than the eagerly-loaded main bundle. Re-exports Crepe so the
// door component never imports @milkdown/crepe itself.
export { Crepe }

// The canvas-note trim (ADR-0046, goal 0244 S3's converged-pattern
// verdict): inline formatting + lists + checkboxes stay, the
// block-tree editor's own signature features (slash-command menu,
// tables, LaTeX) don't fit a short sticky and are cut. AI stays off by
// construction -- Crepe.Feature.AI defaults to false and is never
// listed here, so its llm-providers code path is never reachable
// (CLAUDE.md's no-AI-API-calls constraint).
export const NOTE_FEATURES = {
  [Crepe.Feature.Table]: false,
  [Crepe.Feature.Latex]: false,
  [Crepe.Feature.BlockEdit]: false,
}
