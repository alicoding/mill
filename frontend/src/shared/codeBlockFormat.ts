import { keymap } from '@codemirror/view'
import { language } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

// Format-on-demand inside a Rich code block (goal 0268, from 0261's
// extension-port roadmap): prettier/standalone behind the one
// keybinding the format action converged on everywhere (Shift-Alt-F).
// The vendored code-block chrome (CodeBlockConfig) offers no custom
// button slot, and its `extensions` hook is a first-class CodeMirror
// seam -- so the affordance is the borrowed keyboard interaction, not
// an invented chrome injection. Prettier and its parsers load
// per-invocation via dynamic import: nothing here reaches the main
// bundle until the first format.

// CM language names (from @codemirror/language-data's descriptions,
// lowercased) → the prettier parser + plugin set that formats them.
// A name outside this map is honestly unsupported: the keymap leaves
// the keystroke unclaimed rather than pretending.
type ParserSpec = { parser: string; plugins: () => Promise<unknown[]> }

async function loadPlugins(names: string[]): Promise<unknown[]> {
  return Promise.all(names.map(async (n) => {
    switch (n) {
      case 'babel': return (await import('prettier/plugins/babel')).default
      case 'estree': return (await import('prettier/plugins/estree')).default
      case 'typescript': return (await import('prettier/plugins/typescript')).default
      case 'postcss': return (await import('prettier/plugins/postcss')).default
      case 'markdown': return (await import('prettier/plugins/markdown')).default
      case 'html': return (await import('prettier/plugins/html')).default
      case 'yaml': return (await import('prettier/plugins/yaml')).default
      default: throw new Error(`unknown prettier plugin ${n}`)
    }
  }))
}

const PARSERS: Record<string, ParserSpec> = {
  json: { parser: 'json', plugins: () => loadPlugins(['babel', 'estree']) },
  javascript: { parser: 'babel', plugins: () => loadPlugins(['babel', 'estree']) },
  jsx: { parser: 'babel', plugins: () => loadPlugins(['babel', 'estree']) },
  typescript: { parser: 'typescript', plugins: () => loadPlugins(['typescript', 'estree']) },
  tsx: { parser: 'typescript', plugins: () => loadPlugins(['typescript', 'estree']) },
  css: { parser: 'css', plugins: () => loadPlugins(['postcss']) },
  scss: { parser: 'scss', plugins: () => loadPlugins(['postcss']) },
  less: { parser: 'less', plugins: () => loadPlugins(['postcss']) },
  markdown: { parser: 'markdown', plugins: () => loadPlugins(['markdown']) },
  html: { parser: 'html', plugins: () => loadPlugins(['html']) },
  yaml: { parser: 'yaml', plugins: () => loadPlugins(['yaml']) },
}

// formatSupported: the sync half the keymap needs to decide whether to
// claim the keystroke at all. Exported for its unit test.
export function formatSupported(languageName: string): boolean {
  return languageName.toLowerCase() in PARSERS
}

// formatCode: prettier over the whole block. null = unsupported
// language; a parse error (broken input) also resolves null -- the
// block keeps the user's text untouched, never a half-applied format.
// Exported for its unit test.
export async function formatCode(languageName: string, text: string): Promise<string | null> {
  const spec = PARSERS[languageName.toLowerCase()]
  if (!spec) return null
  try {
    const [prettier, plugins] = await Promise.all([import('prettier/standalone'), spec.plugins()])
    return await prettier.format(text, { parser: spec.parser, plugins: plugins as never })
  } catch {
    return null
  }
}

// The CM extension the code-block feature config mounts: Shift-Alt-F
// formats the block in one undoable transaction. Async dispatch guards
// against a stale doc (the user kept typing while prettier loaded) by
// re-checking the doc it read.
export const codeBlockFormatKeymap: Extension = keymap.of([
  {
    key: 'Shift-Alt-f',
    run: (view) => {
      const lang = view.state.facet(language)
      const name = lang?.name ?? ''
      if (!formatSupported(name)) return false
      const before = view.state.doc.toString()
      void formatCode(name, before).then((formatted) => {
        if (formatted == null || formatted === before) return
        if (view.state.doc.toString() !== before) return
        view.dispatch({ changes: { from: 0, to: before.length, insert: formatted } })
      })
      return true
    },
  },
])
