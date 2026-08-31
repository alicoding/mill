import { useEffect, useRef, useState } from 'react'
import { MilkdownEditor } from '../shared/MilkdownEditor'
import styles from './MarkdownNoteField.module.css'

// The note as a record (goal 0145); goal 0244 S3 replaced the editor
// with Milkdown, a markdown-canonical WYSIWYG: the stored string IS
// markdown, but no raw source is ever shown. At rest the SAME engine
// renders it read-only, client-side (no server round-trip); click to
// edit swaps in the editable Milkdown mount; a press outside the
// editor commits it and returns to the rendered view. An empty note
// stays an editor -- the write invitation is the field.
export function MarkdownNoteField({ value, onChange, onCommit, placeholder, ariaLabel, testId, onRequestCommitReady }: {
  value: string
  onChange: (v: string) => void
  // Receives the AUTHORITATIVE current text directly (testing.md:
  // computed into a local and passed, never round-tripped through the
  // caller's own state first) -- see getMarkdownRef's own comment
  // below for why `value`/`onChange`'s state alone isn't safe to read
  // at commit time.
  onCommit: (text: string) => void
  placeholder: string
  ariaLabel: string
  testId: string
  // Hands the caller a "commit right now, the same authoritative way a
  // press-outside does" trigger (undefined again on unmount) -- for a
  // dismissal path that isn't a pointerdown or a window blur (a
  // Dialog's own Escape/close-affordance, AtlasNoteOverlay.tsx's own
  // consumer). Without this, a caller wrapping its OWN close handler
  // around a commit would have to re-read `value` itself, which is
  // exactly the debounced, can-be-stale read this field exists to
  // avoid.
  onRequestCommitReady?: (requestCommit: (() => void) | undefined) => void
}) {
  const [editing, setEditing] = useState(false)
  const editorWrapRef = useRef<HTMLDivElement>(null)
  // The synchronous "read the doc right now" accessor MilkdownEditor's
  // own onReady hands over -- see MilkdownEditorProps's onReady comment
  // for the debounce race this exists to close. Falls back to `value`
  // (the caller's own last onChange-delivered state) before the engine
  // reports ready.
  const getMarkdownRef = useRef<(() => string) | undefined>(undefined)

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
      // The floating selection toolbar lives at body level, outside
      // this wrap -- but a press on it is part of THIS edit session,
      // never an outside press (same exclusion as AtlasStickyNode's).
      if ((e.target as Element | null)?.closest?.('[data-milkdown-selection-toolbar]')) return
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

  // Entering edit puts the caret where the click promised it.
  useEffect(() => {
    if (!editing) return
    editorWrapRef.current?.querySelector<HTMLElement>('[contenteditable="true"], textarea')?.focus()
  }, [editing])

  // Refreshes commitRef with this render's closure -- outside render,
  // per React's own rule (no dependency array: every render's commit
  // must land, not just the one active when the effect was created).
  useEffect(() => {
    commitRef.current = () => {
      setEditing(false)
      onCommit(getMarkdownRef.current?.() ?? value)
    }
  })

  // Hands the caller's own requestCommit ref this field's live commit
  // trigger once (mount) and clears it on unmount -- deliberately NOT
  // re-run every render (commitRef's own ref indirection already keeps
  // the closure fresh, so the caller's stored function never goes
  // stale).
  useEffect(() => {
    onRequestCommitReady?.(() => commitRef.current())
    return () => onRequestCommitReady?.(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (showEditor) {
    return (
      <div
        ref={editorWrapRef}
        className={styles.editorWrap}
        // The bounded box itself (goal 0199's own no-auto-resize
        // regression test measures THIS, not testId's own inner
        // MilkdownEditor wrapper -- that inner element keeps its full
        // unclipped intrinsic height; .editorWrap's own overflow is
        // what actually bounds what's visible/measurable).
        data-testid={`${testId}-wrap`}
        // Interacting with the empty-state editor IS editing -- without
        // this, the first typed character flips the field to rendered
        // mid-keystroke (value no longer empty, editing still false).
        onFocus={() => setEditing(true)}
      >
        <MilkdownEditor
          value={value}
          onChange={onChange}
          onReady={(fn) => {
            getMarkdownRef.current = fn
          }}
          ariaLabel={ariaLabel}
          placeholder={placeholder}
          testId={testId}
        />
      </div>
    )
  }
  return (
    <div
      className={styles.rendered}
      data-testid={`${testId}-rendered`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') setEditing(true)
      }}
    >
      {/* Read-only Milkdown mount, keyed by value so an external
          change remounts fresh rather than needing a live sync path
          this field's own edit sessions never need (see
          AtlasStickyNode's identical comment). */}
      <MilkdownEditor key={value} value={value} ariaLabel={ariaLabel} />
    </div>
  )
}
