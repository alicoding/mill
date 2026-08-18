import { memo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import styles from './AtlasStickyNode.module.css'

export interface AtlasStickyData extends Record<string, unknown> {
  // null for a draft sticky -- not yet persisted; created only once its
  // text commits non-blank (the LOCKED design's own "empty text on
  // blur = cancel, nothing created"). A note NEVER carries a kind chip
  // or link handle -- structurally annotation, not data.
  note: Note | null
  editing: boolean
  onCommit: (text: string) => void
  onCancelEdit: () => void
  onEnterEdit: () => void
  // The click model's own commit test (goal 0102's gesture table,
  // uniform across every node type): true when this note was the sole
  // selected node before the current click gesture began -- see
  // useAtlasSelection.ts's own header comment.
  isSoleSelected: (id: string) => boolean
}

export type AtlasStickyRFNode = RFNode<AtlasStickyData>

// A sticky note (goal 0081 slice A1's LOCKED design, section 5):
// unmistakably annotation -- soft tinted background, text-only, no
// kind glyph, no flip, no connection handles (a note can never be a
// link endpoint). Doubles as both the draft-in-progress node (note ===
// null, always editing) and an existing note's own render/re-edit --
// one component, since the two states differ only in whether a commit
// creates or updates.
export const AtlasStickyNode = memo(function AtlasStickyNode({ data }: NodeProps<AtlasStickyRFNode>) {
  const { t } = useTranslation('atlas')
  const { note, editing, onCommit, onCancelEdit, onEnterEdit, isSoleSelected } = data
  const [draftText, setDraftText] = useState(note?.Text ?? '')
  // Guards against a double-fire: Escape (which unmounts this editing
  // view) must never also let a trailing blur re-commit the same text.
  const settledRef = useRef(false)

  const commit = () => {
    if (settledRef.current) return
    settledRef.current = true
    onCommit(draftText)
  }

  if (editing) {
    return (
      <div className={`${styles.sticky} ${styles.editing}`} data-testid="atlas-sticky-note" data-editing="true">
        <textarea
          className={`${styles.textarea} nodrag nopan`}
          data-testid="atlas-sticky-textarea"
          autoFocus
          placeholder={t('sticky.placeholder')}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={commit}
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
        if (e.metaKey || e.ctrlKey) { onEnterEdit(); return }
        if (note && isSoleSelected(note.ID)) onEnterEdit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEnterEdit()
        }
      }}
    >
      <div className={note?.Text ? styles.text : `${styles.text} ${styles.emptyText}`}>
        {note?.Text || t('sticky.empty')}
      </div>
    </div>
  )
})
