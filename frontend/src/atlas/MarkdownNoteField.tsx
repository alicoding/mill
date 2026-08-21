import { useEffect, useRef, useState } from 'react'
import { AtlasService } from '../shared/bindings'
import { CodeEditor } from '../shared/CodeEditor'
import mirrorStyles from './AtlasCardMirrorPreview.module.css'
import styles from './MarkdownNoteField.module.css'

// The note as a record (goal 0145): the stored string IS markdown.
// At rest it renders (same safe GFM path the mirror preview trusts);
// click to edit the source in the one editor door (CodeEditor,
// markdown mode); blur commits and returns to the rendered view. An
// empty note stays an editor -- the write invitation is the field.
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

  if (showEditor) {
    return (
      <div
        ref={editorWrapRef}
        className={styles.editorWrap}
        // Interacting with the empty-state editor IS editing -- without
        // this, the first typed character flips the field to rendered
        // mid-keystroke (value no longer empty, editing still false).
        onFocus={() => setEditing(true)}
        onBlur={(e) => {
          // focusout only counts when focus actually left the field.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setEditing(false)
          onCommit()
        }}
      >
        <CodeEditor
          value={value}
          onChange={onChange}
          language="markdown"
          ariaLabel={ariaLabel}
          placeholder={placeholder}
          minHeightRows={2}
          testId={testId}
          prose
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
