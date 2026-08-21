import { useEffect, useRef, useState } from 'react'
import styles from './CodeEditor.module.css'
import type { CodeEditorLanguage } from './codeEditorCore'

export type { CodeEditorLanguage }

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language: CodeEditorLanguage
  ariaLabel: string
  minHeightRows?: number
  testId?: string
  prose?: boolean
  placeholder?: string
}

type CoreModule = typeof import('./codeEditorCore')

// The ONE editor door (ports/adapters): no @codemirror import may
// appear outside this file and codeEditorCore.ts, the lazy chunk it
// loads. Cached module-level promise mirrors
// atlas/useMermaidRendering.ts's own dynamic-import shape, so the
// CodeMirror bundle weight loads once, only when an editor actually
// mounts.
let corePromise: Promise<CoreModule> | null = null
function loadCore() {
  corePromise ??= import('./codeEditorCore')
  return corePromise
}

// A code-shaped input (a shell script, a JSON body, an HTML/Markdown
// document) rendered with line numbers and syntax highlighting.
// `onChange` absent means readonly. While the CodeMirror engine is
// still loading -- or if it fails to load at all -- this renders a
// plain textarea carrying the same value/onChange/aria-label, so the
// field is never dead.
export function CodeEditor({ value, onChange, language, ariaLabel, minHeightRows = 6, testId, placeholder, prose }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<InstanceType<CoreModule['EditorView']> | null>(null)
  const syncingRef = useRef(false)
  const [core, setCore] = useState<CoreModule | null>(null)
  const editable = onChange !== undefined

  useEffect(() => {
    let cancelled = false
    loadCore()
      .then((mod) => {
        if (!cancelled) setCore(mod)
      })
      .catch(() => {
        // Honest degradation: stay on the textarea fallback rather than
        // rendering a broken editor.
        console.warn('CodeEditor: the CodeMirror engine failed to load; staying on the plain-text fallback.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!core || !containerRef.current) return
    const { EditorState, EditorView, buildExtensions } = core
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: buildExtensions({
          language,
          prose,
          editable,
          minHeightRows,
          placeholderText: placeholder,
          onDocChange: onChange
            ? (next) => {
                if (syncingRef.current) return
                onChange(next)
              }
            : undefined,
        }),
      }),
      parent: containerRef.current,
    })
    view.contentDOM.setAttribute('aria-label', ariaLabel)
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // `value`/`onChange` are deliberately excluded: the initial doc is
    // set once here, and every later external value change flows
    // through the sync effect below via a targeted dispatch instead of
    // a remount (which would drop cursor/selection/undo history).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, language, editable, minHeightRows, placeholder, ariaLabel])

  // Controlled-component sync: an external value change (not caused by
  // the editor's own onChange) replaces the full document. Guarded by
  // syncingRef so the resulting docChanged update doesn't re-fire
  // onChange for a change the editor itself didn't originate.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    syncingRef.current = true
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    syncingRef.current = false
  }, [value])

  return (
    <div className={styles.wrapper} data-testid={testId}>
      {!core ? (
        <textarea
          className={styles.fallback}
          style={{ minHeight: `${minHeightRows * 1.4}em` }}
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          readOnly={!editable}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
      ) : (
        <div ref={containerRef} className={styles.mount} />
      )}
    </div>
  )
}
