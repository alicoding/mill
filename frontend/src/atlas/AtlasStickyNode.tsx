import { memo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import styles from './AtlasStickyNode.module.css'

export interface AtlasStickyData extends Record<string, unknown> {
  // null for a draft sticky -- not yet persisted; created only once its
  // text commits non-blank (the LOCKED design's own "empty text on
  // blur = cancel, nothing created"). A note NEVER carries a kind chip,
  // flip face, or link handle -- structurally annotation, not data.
  note: Note | null
  editing: boolean
  onCommit: (text: string) => void
  onCancelEdit: () => void
  onEnterEdit: () => void
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
  const { note, editing, onCommit, onCancelEdit, onEnterEdit } = data
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
      onDoubleClick={(e) => {
        e.stopPropagation()
        onEnterEdit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onEnterEdit()
        }
      }}
    >
      <div className={styles.text}>{note?.Text}</div>
    </div>
  )
})
