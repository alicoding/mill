import { useEffect, useRef, useState } from 'react'
import { NodeResizer } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Textarea } from '@primer/react'
import type { CanvasNoteNode } from './canvasStore'
import { useNoteActions } from './canvasNoteActions'
import { CANVAS_NOTE_WIDTH, CANVAS_NOTE_HEIGHT } from './canvasConstants'
import styles from './CanvasNoteView.module.css'

// The small fixed palette composition.NoteColor declares -- '' (the Go
// zero value) renders first as the neutral default swatch.
const NOTE_COLORS = ['', 'yellow', 'blue', 'green', 'pink'] as const

// A note (docs/goals/0055) renders as a borderless sticky, visually
// unmistakable from a step card (CanvasNodeView.tsx): no icon square,
// no kind chip, no Handles -- recognition-not-confirmation applied to
// "this is authoring annotation, not a step with ports." Double-click
// enters inline text editing (a separate handler from the step card's
// own onNodeDoubleClick, which CompositionCanvas.tsx explicitly skips
// for a note node so opening the step-detail overlay and editing note
// text never collide).
export function CanvasNoteView({ id, data, selected }: NodeProps<CanvasNoteNode>) {
  const { t } = useTranslation('composition')
  const { readOnly, updateText, updateColor } = useNoteActions()
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  return (
    <div
      className={styles.note}
      data-color={data.color || 'default'}
      data-selected={!!selected}
      onDoubleClick={() => {
        if (!readOnly) setEditing(true)
      }}
    >
      <NodeResizer
        isVisible={!!selected && !readOnly}
        minWidth={CANVAS_NOTE_WIDTH}
        minHeight={CANVAS_NOTE_HEIGHT}
        handleClassName={styles.resizeHandle}
        lineClassName={styles.resizeLine}
      />
      {editing ? (
        <Textarea
          ref={textareaRef}
          className={`${styles.textarea} nodrag`}
          value={data.text}
          resize="none"
          block
          aria-label={t('canvasNoteView.textAriaLabel')}
          onChange={(e) => updateText(id, e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur()
          }}
        />
      ) : (
        <div className={styles.text} data-testid="canvas-note-text" data-empty={!data.text}>
          {data.text || t('canvasNoteView.emptyPlaceholder')}
        </div>
      )}
      {selected && !readOnly && !editing && (
        <div className={`${styles.swatches} nodrag`} data-testid="canvas-note-swatches">
          {NOTE_COLORS.map((color) => (
            <button
              key={color || 'default'}
              type="button"
              className={styles.swatch}
              data-color={color || 'default'}
              data-active={data.color === color}
              aria-label={t(`canvasNoteView.color.${color || 'default'}`)}
              onClick={() => updateColor(id, color)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
