import { EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, placeholder as placeholderExt } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, bracketMatching, StreamLanguage } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { tags } from '@lezer/highlight'

// The CodeMirror machinery behind shared/CodeEditor.tsx -- reachable
// only through that component's dynamic import, so every @codemirror/
// @lezer package stays inside this module's own lazy chunk rather than
// the eagerly-loaded main bundle. Re-exports EditorState/EditorView so
// the door component never imports @codemirror itself.
export { EditorState, EditorView }

export type CodeEditorLanguage = 'shell' | 'json' | 'html' | 'markdown'

// Pure language -> extension mapping, unit-tested directly (this
// module has no DOM dependency until an EditorView actually mounts).
export function languageExtension(language: CodeEditorLanguage): Extension {
  switch (language) {
    case 'json':
      return json()
    case 'html':
      return html()
    case 'markdown':
      return markdown()
    case 'shell':
      return StreamLanguage.define(shell)
  }
}

// Syntax colors via Primer's shipped prettylights variables (verified
// present in @primer/primitives' functional theme CSS -- grep
// --color-prettylights-syntax- in node_modules/@primer/primitives/
// dist/css/functional/themes/light.css). Each falls back to a
// light-safe hex so the editor stays legible even if a future Primer
// major renames the token.
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--color-prettylights-syntax-keyword, #cf222e)' },
  { tag: tags.string, color: 'var(--color-prettylights-syntax-string, #0a3069)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--color-prettylights-syntax-constant, #0550ae)' },
  { tag: tags.comment, color: 'var(--color-prettylights-syntax-comment, #6e7781)', fontStyle: 'italic' },
  { tag: tags.propertyName, color: 'var(--color-prettylights-syntax-entity, #8250df)' },
  { tag: tags.tagName, color: 'var(--color-prettylights-syntax-entity-tag, #116329)' },
  { tag: tags.attributeName, color: 'var(--color-prettylights-syntax-constant, #0550ae)' },
  { tag: tags.heading, color: 'var(--color-prettylights-syntax-markup-heading, #0550ae)', fontWeight: 'bold' },
  { tag: tags.strong, color: 'var(--color-prettylights-syntax-markup-bold, #1f2328)', fontWeight: 'bold' },
  { tag: tags.emphasis, color: 'var(--color-prettylights-syntax-markup-italic, #1f2328)', fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--color-prettylights-syntax-constant-other-reference-link, #0a3069)' },
])

// Primer tokens only (frontend.md) -- every color/border/font value
// below is a design-system variable, never a literal (the highlight
// style's hex fallbacks above are the sole deliberate exception, kept
// there rather than here since they only apply when the token itself
// is missing).
export function editorTheme(minHeightRows: number): Extension {
  return EditorView.theme({
    '&': {
      backgroundColor: 'var(--bgColor-default)',
      color: 'var(--fgColor-default)',
      border: '1px solid var(--borderColor-default)',
      borderRadius: '6px',
      fontSize: '12px',
    },
    '&.cm-focused': {
      outline: 'none',
      borderColor: 'var(--borderColor-accent-emphasis)',
    },
    '.cm-content': {
      fontFamily: 'var(--mill-mono)',
      minHeight: `${minHeightRows * 1.4}em`,
    },
    '.cm-scroller': { fontFamily: 'inherit' },
    '.cm-gutters': {
      backgroundColor: 'var(--bgColor-muted)',
      color: 'var(--fgColor-muted)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'var(--bgColor-neutral-muted)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--bgColor-neutral-muted)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--bgColor-accent-muted) !important',
    },
    '.cm-placeholder': { color: 'var(--fgColor-muted)' },
  })
}

export interface BuildExtensionsOptions {
  language: CodeEditorLanguage
  editable: boolean
  minHeightRows: number
  placeholderText?: string
  onDocChange?: (value: string) => void
  // prose drops the code chrome (line numbers, active-line stripe) --
  // a NOTE edits as text that happens to be markdown, not as code
  // (goal 0145's de-jank: the edit/render swap must not also swap
  // visual registers).
  prose?: boolean
}

// Assembles one editor instance's full extension set. Editing niceties
// (history, bracket matching, closeBrackets, active-line highlight)
// apply in edit mode only -- readonly stays line numbers plus syntax
// highlighting, nothing else, per shared/CodeEditor.tsx's contract.
export function buildExtensions(opts: BuildExtensionsOptions): Extension[] {
  const ext: Extension[] = [
    ...(opts.prose ? [] : [lineNumbers()]),
    // A long unwrapped line drags the shared horizontal scroll
    // position for every line in the document (CM6's lines share one
    // scroller), hiding the start of shorter lines above/below it once
    // the cursor scrolls past the panel's width. Wrapping keeps every
    // line visible at the narrow widths CodeEditor renders at.
    EditorView.lineWrapping,
    languageExtension(opts.language),
    syntaxHighlighting(highlightStyle),
    editorTheme(opts.minHeightRows),
    EditorState.readOnly.of(!opts.editable),
    EditorView.editable.of(opts.editable),
  ]
  if (opts.placeholderText) {
    ext.push(placeholderExt(opts.placeholderText))
  }
  if (opts.editable) {
    ext.push(
      history(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
    )
  }
  if (opts.onDocChange) {
    const onDocChange = opts.onDocChange
    ext.push(EditorView.updateListener.of((update) => {
      if (update.docChanged) onDocChange(update.state.doc.toString())
    }))
  }
  return ext
}
