import { useEffect, useRef, useState } from 'react'
import { AtlasService } from '../shared/bindings'
import { CodeEditor } from '../shared/CodeEditor'
import mirrorStyles from './AtlasCardMirrorPreview.module.css'
import styles from './MarkdownNoteField.module.css'

// The note as a record (goal 0145): the stored string IS markdown.
// At rest it renders (same safe GFM path the mirror preview trusts);
// click to edit the source in the one editor door (CodeEditor,
// markdown mode); a press outside the editor commits it and returns
// to the rendered view. An empty note stays an editor -- the write
// invitation is the field.
export function MarkdownNoteField({ value, onChange, onCommit, placeholder, ariaLabel, testId }: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  placeholder: string
  ariaLabel: string
  testId: string
}) {
  const [editing, setEditing] = useState(false)
  const [html, setHtml] = useState('')
  const editorWrapRef = useRef<HTMLDivElement>(null)

  const showEditor = editing || value.trim() === ''

  // commitRef always holds the current render's commit closure -- see
  // AtlasStickyNode's own commitRef comment.
  const commitRef = useRef<() => void>(() => {})

  // Commit is POINTER-driven (same canvas convergence as
  // AtlasStickyNode): a press outside the editor while editing
  // commits it; a window blur (app/tab switch) commits too.
  useEffect(() => {
    if (!editing) return
    const handlePointerDown = (e: PointerEvent) => {
      if (editorWrapRef.current?.contains(e.target as Node | null)) return
      commitRef.current()
    }
    const handleWindowBlur = () => {
      commitRef.current()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [editing])

  useEffect(() => {
    if (showEditor) return
    let stale = false
    AtlasService.RenderNoteMarkdown(value)
      .then((h) => {
        if (!stale) setHtml(h)
      })
      .catch(() => setHtml(''))
    return () => {
      stale = true
    }
  }, [value, showEditor])

  // Entering edit puts the caret where the click promised it.
  useEffect(() => {
    if (!editing) return
    editorWrapRef.current?.querySelector<HTMLElement>('.cm-content, textarea')?.focus()
  }, [editing])

  // Refreshes commitRef with this render's closure -- outside render,
  // per React's own rule (no dependency array: every render's commit
  // must land, not just the one active when the effect was created).
  useEffect(() => {
    commitRef.current = () => {
      setEditing(false)
      onCommit()
    }
  })

  if (showEditor) {
    return (
      <div
        ref={editorWrapRef}
        className={styles.editorWrap}
        // Interacting with the empty-state editor IS editing -- without
        // this, the first typed character flips the field to rendered
        // mid-keystroke (value no longer empty, editing still false).
        onFocus={() => setEditing(true)}
      >
        <CodeEditor
          value={value}
          onChange={onChange}
          language="markdown"
          prose
          ariaLabel={ariaLabel}
          placeholder={placeholder}
          minHeightRows={2}
          testId={testId}
        />
      </div>
    )
  }
  return (
    <div
      className={`${mirrorStyles.markdownBody} ${styles.rendered}`}
      data-testid={`${testId}-rendered`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') setEditing(true)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
