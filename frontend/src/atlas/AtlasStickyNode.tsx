import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeResizer } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { MilkdownEditor } from '../shared/MilkdownEditor'
import { registerFlusher } from '../shared/flushRegistry'
import { useSaveMode } from '../shared/saveMode'
import { DirtyDot } from '../shared/DirtyDot'
import { STICKY_HEIGHT } from './atlasBoardLayout'
import styles from './AtlasStickyNode.module.css'

export interface AtlasStickyData extends Record<string, unknown> {
  // null for a draft sticky -- not yet persisted; the commit creates
  // it (blank included: the placement itself is the capture, Escape is
  // the cancel). A note NEVER carries a kind chip or link handle --
  // structurally annotation, not data.
  note: Note | null
  editing: boolean
  // Held unsaved (explicit save mode, useAtlasStickyNodes.ts): the
  // note's Text is the held text and the dirty marker shows.
  dirty: boolean
  onCommit: (text: string) => void
  // ⌘S / the leave sheet's Save all mid-edit: the write, session kept
  // (a draft's save is its creation and does end the session).
  onSave: (text: string) => void
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
  // Set only by a region frame's own preview grid (atlasBuildBoardNodes
  // .ts): a fixed uniform slot height, clamped rather than content-
  // driven, since the grid's own layout never reads a child's Size.
  // undefined for a normal top-level board note, which uses the
  // content-driven box model instead (this component's own header
  // comment).
  previewHeight?: number
}

export type AtlasStickyRFNode = RFNode<AtlasStickyData>

// A sticky note (goal 0081 slice A1's LOCKED design, section 5; goal
// 0145 made its text markdown; goal 0244 S3 replaced the editor with
// Milkdown, a markdown-canonical WYSIWYG): unmistakably annotation --
// soft tinted background, no kind glyph, no flip, no connection
// handles (a note can never be a link endpoint). At rest AND while
// editing, the SAME engine renders formatted markdown (lists, bold,
// headings, checkboxes) -- no raw source is ever shown, and no server
// round-trip renders it (MilkdownEditor is client-side, ADR-0046).
// Editing swaps in an editable Milkdown mount in place of the
// read-only one. Doubles as both the draft-in-progress node
// (note === null, always editing) and an existing note's own
// render/re-edit -- one component, since the two states differ only in
// whether a commit creates or updates.
//
// One box model, editing or at rest (never a size snap between them):
// the box's height is content-driven (CSS auto-height), floored by a
// min-height -- either a persisted Note.Size.H (once the user has
// resized) or STICKY_HEIGHT's default. Content taller than that floor
// grows the box; it never clips invisibly. Width stays the one
// RF-controlled, user-resizable dimension.
export const AtlasStickyNode = memo(function AtlasStickyNode({ data, selected }: NodeProps<AtlasStickyRFNode>) {
  const { t } = useTranslation('atlas')
  const { note, editing, dirty, onCommit, onSave, onCancelEdit, onEnterEdit, onOpenBig, isSoleSelected, previewHeight } = data
  const saveMode = useSaveMode()
  // Typed since the session started (or since the last ⌘S): explicit
  // mode's dirty marker while the note is still being edited.
  const [changed, setChanged] = useState(false)
  // The content-driven box model's own min-height floor (this
  // component's own header comment) -- a region-frame preview slot
  // overrides both height AND overflow instead, clamping to its fixed
  // uniform grid size rather than growing with content.
  const boxStyle = previewHeight !== undefined
    ? { height: previewHeight, minHeight: previewHeight, overflow: 'hidden' as const }
    : { minHeight: note?.Size?.H ?? STICKY_HEIGHT }
  const [draftText, setDraftText] = useState(note?.Text ?? '')
  // Guards against a double-fire: Escape (which unmounts this editing
  // view) must never also let a trailing outside-press re-commit the
  // same text.
  const settledRef = useRef(false)
  // CodeEditor's onChange lands in state for re-render, but commit
  // handlers read this ref -- an outside press arriving in the same
  // tick as the last keystroke must never commit the previous
  // render's stale text.
  const draftRef = useRef(draftText)
  // The authoritative read at commit time (MilkdownEditor's own
  // onReady) -- draftRef alone isn't enough once Milkdown owns the
  // surface: its markdownUpdated listener is DEBOUNCED, so a fast
  // pointer-driven commit (this component's own interaction model) can
  // fire before the listener ever lands, committing stale/empty text.
  // getMarkdown() reads the live document directly. Falls back to
  // draftRef while the engine is still on its textarea fallback (that
  // path's onChange is synchronous, no debounce to race).
  const getMarkdownRef = useRef<(() => string) | undefined>(undefined)

  const text = note?.Text ?? ''

  // Each edit entry is a fresh session: re-seed the draft from the
  // note's current text and re-arm the commit guard (the node instance
  // persists across edit sessions, so mount-time init alone would
  // leave a spent guard and a stale draft on the second edit).
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!editing) return
    settledRef.current = false
    setChanged(false)
    draftRef.current = note?.Text ?? ''
    setDraftText(note?.Text ?? '')
    // Focus whichever editing surface is mounted, and HOLD it for the
    // entry's whole settling window rather than stopping at first
    // success: the first-ever editor mount swaps a fallback textarea
    // for the lazily-loaded engine's own contenteditable (dropping
    // focus mid-draft), and the engine's own async plumbing can strip
    // focus once more 45-200ms after it landed (measured live:
    // focusout to BODY with no blur() call, no DOM detach, no
    // attribute flip -- focus simply falls to nobody). Re-asserting
    // only while nothing else holds focus never fights a real focus
    // move; commit is pointer-driven, so nothing here can race or
    // cancel a commit.
    let tries = 0
    const id = window.setInterval(() => {
      const editable = wrapRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')
      const target = editable ?? wrapRef.current?.querySelector<HTMLElement>('textarea')
      // Done the moment the engine's own root has focus: a later
      // focus() on a content-editable moves the caret to the START, and
      // this loop was still firing while the user's first keystrokes
      // landed (goal 0296: under CPU throttle a momentary focus flicker
      // let it re-focus mid-word, so text arrived reordered or lost).
      if (editable && document.activeElement === editable) {
        window.clearInterval(id)
        return
      }
      const idle = document.activeElement === document.body || document.activeElement === null
      if (target && document.activeElement !== target && (idle || wrapRef.current?.contains(document.activeElement))) target.focus()
      // Long enough to outlast the engine's own create() under load:
      // the mount is inert until then (MilkdownEditor.tsx), so focus
      // can only land once typing is safe.
      if (++tries > 30) window.clearInterval(id)
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
  const saveRef = useRef<() => void>(() => {})
  const cancelRef = useRef<() => void>(() => {})
  const saveModeRef = useRef(saveMode)
  useEffect(() => {
    saveModeRef.current = saveMode
  }, [saveMode])
  // While editing, this note is a live edit the leave handshake settles
  // (shared/flushRegistry.ts, goal 0295 S2): in automatic mode its
  // flusher is the same commit a click-away performs; in explicit mode
  // it is the write itself (⌘S), session kept. Its discard is the
  // session's cancel; its root lets ⌘S find it by focus.
  useEffect(() => {
    if (!editing) return
    return registerFlusher(`sticky:${note?.ID ?? 'draft'}`, {
      flush: () => (saveModeRef.current === 'explicit' ? saveRef.current() : commitRef.current()),
      discard: () => cancelRef.current(),
      root: () => wrapRef.current,
    })
  }, [editing, note?.ID])

  // Commit is POINTER-driven (the FigJam/Miro/tldraw canvas
  // convergence), not focus-driven: a press outside this note while
  // editing commits it, same as a press anywhere else on the board
  // deselecting/reselecting -- capture phase so it fires before the
  // press's own target handling (React Flow's pane click, another
  // node's select), and never preventDefault so that press still does
  // whatever it does. A window blur (the whole app losing focus --
  // app/tab switch) commits too, since no further press is coming. A
  // press on this note's OWN resize handle is explicitly excluded --
  // never treated as an outside press -- so a resize drag can never
  // commit/unmount the edit session mid-gesture, named here rather
  // than left to depend on the handle's own DOM position inside
  // wrapRef.
  useEffect(() => {
    if (!editing) return
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (wrapRef.current?.contains(target)) return
      if (target?.closest('.react-flow__resize-control')) return
      // The floating selection toolbar (goal 0253) lives at body
      // level -- outside wrapRef by design, so board zoom/clipping
      // can't touch it -- but a press on it is part of THIS edit
      // session, never an outside press.
      if (target?.closest('[data-milkdown-selection-toolbar]')) return
      commitRef.current()
    }
    const handleWindowBlur = () => {
      commitRef.current()
    }
    // A press on a resize handle must not move DOM focus off the
    // contenteditable at all (the handle is part of this note's own
    // surface, never an interruption of the edit session): suppressing
    // mousedown's default is THE focus-preserving primitive here --
    // editor toolbars converge on the same move. The library's own
    // resize drag still runs: its drag machinery never consults
    // defaultPrevented, only the event's button/position.
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (target?.closest('.react-flow__resize-control')) e.preventDefault()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [editing])

  // A resize drag can shift DOM focus away from the contenteditable as
  // a pointer-event side effect of the handle itself (outside this
  // component's control) -- captured at resize-start and restored at
  // resize-end so the edit session survives a resize (contract: the
  // resize handles are part of this note's own surface, never an
  // interruption of the edit session).
  const resizeFocusRef = useRef<HTMLElement | null>(null)
  const captureResizeFocus = () => {
    resizeFocusRef.current = wrapRef.current?.querySelector<HTMLElement>('[contenteditable="true"], textarea') ?? null
  }
  const restoreResizeFocus = () => {
    const target = resizeFocusRef.current
    resizeFocusRef.current = null
    if (!target) return
    // A windowed hold, not a one-shot: onResizeEnd fires during the
    // drag's own pointerup dispatch, and focus is stripped again up to
    // ~200ms later (measured live: focusout to BODY with no blur()
    // call and no DOM detach -- the engine's own async plumbing).
    // Re-asserting only while focus sits on nobody never fights a real
    // focus move (an outside press's commit path included).
    window.setTimeout(() => {
      if (target.isConnected) target.focus()
    }, 0)
    let ticks = 0
    const id = window.setInterval(() => {
      const idle = document.activeElement === document.body || document.activeElement === null
      if (target.isConnected && document.activeElement !== target && idle) target.focus()
      if (++ticks > 6) window.clearInterval(id)
    }, 60)
  }

  const commit = () => {
    if (settledRef.current) return
    settledRef.current = true
    onCommit(getMarkdownRef.current?.() ?? draftRef.current)
  }
  // Refreshes commitRef with this render's closure -- outside render,
  // per React's own rule (no dependency array: every render's commit
  // must land, not just the one active when the effect was created).
  useEffect(() => {
    commitRef.current = commit
    saveRef.current = () => {
      setChanged(false)
      onSave(getMarkdownRef.current?.() ?? draftRef.current)
    }
    cancelRef.current = () => {
      settledRef.current = true
      onCancelEdit()
    }
  })
  const showDirty = dirty || (saveMode === 'explicit' && editing && changed)

  // Empty-state unification (goal 0247, the 0226 rule): an empty note
  // has no separate at-rest presentation -- the write invitation IS
  // the field, same as MarkdownNoteField's own `showEditor` contract.
  // Every note -- draft or existing -- shares the SAME box model here:
  // min-height floored by its persisted size (or the default, for a
  // draft with no prior Size), growing with typed content.
  if (editing || text.trim() === '') {
    return (
      <div
        ref={wrapRef}
        // nodrag/nopan/nowheel only while a REAL edit session runs: the
        // empty-note invitation (editing false) must stay an ordinary
        // draggable/selectable board node -- its editor subtree is
        // pointer-inert instead (styles.invitation), so the canvas
        // library owns every press until a click promotes to editing.
        className={`${styles.sticky} ${styles.editing} ${editing ? 'nodrag nopan nowheel' : styles.invitation}`}
        style={boxStyle}
        data-testid="atlas-sticky-note"
        data-editing={editing ? 'true' : 'false'}
        // Keyboard focus (Tab) landing on the invitation's field
        // promotes to a real editing session -- the same promotion
        // MarkdownNoteField's onFocus does; pointer presses never
        // focus the field (it is pointer-inert at rest). Idle while
        // already editing (editing is already true).
        onFocus={() => {
          if (!editing) onEnterEdit()
        }}
        // A single click anywhere in the invitation starts typing --
        // no prior selection needed, the placeholder IS the invitation
        // (unlike a non-empty note's select-then-click). Modifier
        // gestures match the at-rest branch: shift leaves the click to
        // multi-select, ⌘ opens the big surface. A real drag never
        // reaches here -- the drag machinery suppresses the click that
        // follows a moved gesture.
        onClick={(e) => {
          if (editing || e.shiftKey) return
          if (e.metaKey || e.ctrlKey) {
            onOpenBig()
            return
          }
          onEnterEdit()
        }}
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
        {/* Resize persists as Note.Size -- available while editing too,
            since resizing IS the answer to "I can't see enough while
            editing". The persisted height becomes this box's own
            min-height floor (see the component header comment), never
            a clamp. onResizeStart/onResizeEnd around the write also
            carry the edit session's focus across the drag (N3's own
            contract: the resize handles never interrupt editing). */}
        {showDirty && <DirtyDot />}
        {note && (
          <NodeResizer
            isVisible={selected ?? false}
            minWidth={100}
            minHeight={70}
            onResizeStart={captureResizeFocus}
            onResizeEnd={(_e, params) => {
              void AtlasService.SetNoteSize(note.ID, { W: params.width, H: params.height })
              restoreResizeFocus()
            }}
          />
        )}
        <MilkdownEditor
          value={draftText}
          onChange={(v) => {
            draftRef.current = v
            if (!changed && v !== (note?.Text ?? '')) setChanged(true)
            // State (and its re-render) only while the plain-textarea
            // fallback is mounted -- that path renders `value`
            // controlled. The engine mount reads `value` once at
            // create and never again, so re-rendering per keystroke
            // there only pits the whole node tree's re-render against
            // the user's own typing (measured under load: keystrokes
            // and input-rule transactions dropped mid-word).
            if (!getMarkdownRef.current) setDraftText(v)
          }}
          onReady={(fn) => {
            getMarkdownRef.current = fn
          }}
          ariaLabel={t('sticky.ariaLabel')}
          placeholder={t('sticky.placeholder')}
          // The real editing session keeps the stable testid every
          // existing fixture (stickyEditor/blurSticky) targets; the
          // pre-click invitation (editing still false, text empty)
          // shares the rest render's own testid -- it detaches the
          // moment a real session starts, same as the rest view would.
          testId={editing ? 'atlas-sticky-editor' : 'atlas-sticky-note-render'}
        />
      </div>
    )
  }

  return (
    <div
      className={styles.sticky}
      style={boxStyle}
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
      {/* Resize persists as Note.Size -- the canvas library's own
          resizer, shown only while selected so the face stays quiet at
          rest. The persisted height becomes this box's own min-height
          floor (see the component header comment), never a clamp. */}
      {showDirty && <DirtyDot />}
      {note && (
        <NodeResizer
          isVisible={selected ?? false}
          minWidth={100}
          minHeight={70}
          onResizeEnd={(_e, params) => {
            void AtlasService.SetNoteSize(note.ID, { W: params.width, H: params.height })
          }}
        />
      )}
      <div className={`${styles.text} nowheel`}>
        {/* Read-only Milkdown mount (goal 0244 S3): the SAME engine
            that edits also renders at rest, client-side -- no
            server round-trip (the old RenderNoteMarkdown RPC).
            Keyed by the note's own text so an external change (a
            background refresh landing while this note isn't the one
            being edited) remounts fresh rather than needing a live
            external-value sync the editing session never needs. */}
        <MilkdownEditor key={text} value={text} ariaLabel={t('sticky.ariaLabel')} testId="atlas-sticky-note-render" />
      </div>
    </div>
  )
})
