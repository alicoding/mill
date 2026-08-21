import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

// Live preview for prose-mode markdown (goal 0145 slice 2): the
// converged Obsidian/Bear model built on CodeMirror's own syntax
// tree -- formatting shows IN PLACE (heading scale, bold, italic),
// and syntax marks (#, **, -, >) recede except on the caret's own
// line, where they stay editable at full strength. Decorations only:
// nothing is hidden or replaced, so the document, positions, and the
// stored string never diverge from what's on screen.

const headingLine: Record<string, Decoration> = {
  ATXHeading1: Decoration.line({ class: 'cm-mill-h1' }),
  ATXHeading2: Decoration.line({ class: 'cm-mill-h2' }),
  ATXHeading3: Decoration.line({ class: 'cm-mill-h3' }),
  ATXHeading4: Decoration.line({ class: 'cm-mill-h4' }),
  ATXHeading5: Decoration.line({ class: 'cm-mill-h4' }),
  ATXHeading6: Decoration.line({ class: 'cm-mill-h4' }),
}
const markDim = Decoration.mark({ class: 'cm-mill-mark' })
const MARK_NODES = new Set(['HeaderMark', 'EmphasisMark', 'ListMark', 'QuoteMark', 'CodeMark', 'LinkMark'])

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const caretLine = view.state.doc.lineAt(view.state.selection.main.head).number
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (node) => {
        const line = headingLine[node.name]
        if (line) {
          builder.add(view.state.doc.lineAt(node.from).from, view.state.doc.lineAt(node.from).from, line)
          return
        }
        if (MARK_NODES.has(node.name) && view.state.doc.lineAt(node.from).number !== caretLine) {
          builder.add(node.from, node.to, markDim)
        }
      },
    })
  }
  return builder.finish()
}

const plugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) {
    this.decorations = buildDecorations(view)
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = buildDecorations(u.view)
  }
}, { decorations: (v) => v.decorations })

const previewTheme = EditorView.theme({
  '.cm-mill-h1': { fontSize: '1.5em', fontWeight: '700', lineHeight: '1.3' },
  '.cm-mill-h2': { fontSize: '1.3em', fontWeight: '700', lineHeight: '1.3' },
  '.cm-mill-h3': { fontSize: '1.15em', fontWeight: '600' },
  '.cm-mill-h4': { fontWeight: '600' },
  '.cm-mill-mark': { color: 'var(--fgColor-muted)', opacity: '0.55' },
})

export function markdownLivePreview(): Extension {
  return [plugin, previewTheme]
}
