import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { CodeEditor } from '../shared/CodeEditor'
import styles from './AtlasStickyNode.module.css'

export interface AtlasStickyData extends Record<string, unknown> {
  // null for a draft sticky -- not yet persisted; the commit creates
  // it (blank included: the placement itself is the capture, Escape is
  // the cancel). A note NEVER carries a kind chip or link handle --
  // structurally annotation, not data.
  note: Note | null
  editing: boolean
  onCommit: (text: string) => void
  onCancelEdit: () => void
  onEnterEdit: () => void
  // The big surface's door (docs/goals/0154): ⌘-click / ⌘↵ / the
  // context menu's Open note -- the same "⌘ opens the large surface"
  // meaning cards already carry with their page.
  onOpenBig: () => void
  // The click model's own commit test (goal 0102's gesture table,
  // uniform across every node type): true when this note was the sole
  // selected node before the current click gesture began -- see
  // useAtlasSelection.ts's own header comment.
  isSoleSelected: (id: string) => boolean
}

export type AtlasStickyRFNode = RFNode<AtlasStickyData>

// A sticky note (goal 0081 slice A1's LOCKED design, section 5; goal
// 0145 made its text markdown): unmistakably annotation -- soft tinted
// background, no kind glyph, no flip, no connection handles (a note
// can never be a link endpoint). At rest the text renders as markdown
// (lists, bold, headings) and a long note wheel-scrolls in place;
// editing swaps in the shared prose CodeEditor with live preview.
// Doubles as both the draft-in-progress node (note === null, always
// editing) and an existing note's own render/re-edit -- one component,
// since the two states differ only in whether a commit creates or
// updates.
export const AtlasStickyNode = memo(function AtlasStickyNode({ data }: NodeProps<AtlasStickyRFNode>) {
  const { t } = useTranslation('atlas')
  const { note, editing, onCommit, onCancelEdit, onEnterEdit, onOpenBig, isSoleSelected } = data
  const [draftText, setDraftText] = useState(note?.Text ?? '')
  const [html, setHtml] = useState('')
  // Guards against a double-fire: Escape (which unmounts this editing
  // view) must never also let a trailing outside-press re-commit the
  // same text.
  const settledRef = useRef(false)
  // CodeEditor's onChange lands in state for re-render, but commit
  // handlers read this ref -- an outside press arriving in the same
  // tick as the last keystroke must never commit the previous
  // render's stale text.
  const draftRef = useRef(draftText)

  const text = note?.Text ?? ''

  // Each edit entry is a fresh session: re-seed the draft from the
  // note's current text and re-arm the commit guard (the node instance
  // persists across edit sessions, so mount-time init alone would
  // leave a spent guard and a stale draft on the second edit).
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!editing) return
    settledRef.current = false
    draftRef.current = note?.Text ?? ''
    setDraftText(note?.Text ?? '')
    // Focus whichever editing surface is mounted. The first-ever
    // editor mount swaps a fallback textarea for the lazily-loaded CM6
    // content, dropping focus mid-draft -- retry briefly until the CM
    // surface exists and holds focus, then stop. Purely a focus
    // convenience now (commit is pointer-driven, below) -- nothing
    // about this loop can race or cancel a commit anymore.
    let tries = 0
    const id = window.setInterval(() => {
      const cm = wrapRef.current?.querySelector<HTMLElement>('.cm-content')
      const target = cm ?? wrapRef.current?.querySelector<HTMLElement>('textarea')
      target?.focus()
      if ((cm && document.activeElement === cm) || ++tries > 8) window.clearInterval(id)
    }, 60)
    return () => window.clearInterval(id)
    // note?.Text deliberately excluded: seeding happens on edit ENTRY
    // only, never mid-session when a background refresh lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  // commitRef always holds the current render's commit closure --
  // read by the document/window listeners below, which are only
  // re-registered when `editing` flips, never on every keystroke.
  const commitRef = useRef<() => void>(() => {})

  // Commit is POINTER-driven (the FigJam/Miro/tldraw canvas
  // convergence), not focus-driven: a press outside this note while
  // editing commits it, same as a press anywhere else on the board
  // deselecting/reselecting -- capture phase so it fires before the
  // press's own target handling (React Flow's pane click, another
  // node's select), and never preventDefault so that press still does
  // whatever it does. A window blur (the whole app losing focus --
  // app/tab switch) commits too, since no further press is coming.
  useEffect(() => {
    if (!editing) return
    const handlePointerDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node | null)) return
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
    if (editing || text.trim() === '') return
    let stale = false
    AtlasService.RenderNoteMarkdown(text)
      .then((h) => {
        if (!stale) setHtml(h)
      })
      .catch(() => setHtml(''))
    return () => {
      stale = true
    }
  }, [text, editing])

  const commit = () => {
    if (settledRef.current) return
    settledRef.current = true
    onCommit(draftRef.current)
  }
  // Refreshes commitRef with this render's closure -- outside render,
  // per React's own rule (no dependency array: every render's commit
  // must land, not just the one active when the effect was created).
  useEffect(() => {
    commitRef.current = commit
  })

  if (editing) {
    return (
      <div
        ref={wrapRef}
        className={`${styles.sticky} ${styles.editing} nodrag nopan nowheel`}
        data-testid="atlas-sticky-note"
        data-editing="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            settledRef.current = true
            onCancelEdit()
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            commit()
          }
        }}
      >
        <CodeEditor
          value={draftText}
          onChange={(v) => {
            draftRef.current = v
            setDraftText(v)
          }}
          language="markdown"
          prose
          minHeightRows={4}
          ariaLabel={t('sticky.ariaLabel')}
          placeholder={t('sticky.placeholder')}
          testId="atlas-sticky-editor"
        />
      </div>
    )
  }

  return (
    <div
      className={styles.sticky}
      data-testid="atlas-sticky-note"
      data-editing="false"
      role="button"
      tabIndex={0}
      aria-label={t('sticky.ariaLabel')}
      // The click model (goal 0102's gesture table, uniform across
      // every node type): a note's own commit is entering edit --
      // reached by ⌘-click (instant) or a plain click on the
      // already-selected note, so two ordinary clicks in a row
      // reproduce a double-click's outcome with no separate handler.
      onClick={(e) => {
        if (e.shiftKey) return
        if (e.metaKey || e.ctrlKey) { onOpenBig(); return }
        if (note && isSoleSelected(note.ID)) onEnterEdit()
      }}
      // A REAL double-click's second press can beat the selection
      // snapshot's re-render (the ref reads stale, the click-path
      // commit silently no-ops) -- the explicit handler makes the
      // gesture table's "double-click commits" deterministic instead
      // of timing luck.
      onDoubleClick={(e) => {
        if (e.shiftKey) return
        onEnterEdit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          onOpenBig()
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEnterEdit()
        }
      }}
    >
      {text.trim() === '' ? (
        <div className={`${styles.text} ${styles.emptyText}`}>{t('sticky.empty')}</div>
      ) : (
        <div
          className={`${styles.text} ${styles.mdBody} nowheel`}
          // A long note wheel-scrolls in place (AtlasStickyNode.module.css's
          // `.text` -- overflow-y:auto): a named surface for goal
          // 0156's layout-fitness audit, not an undeclared scroller.
          data-scroll-region="sticky-note-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
})
