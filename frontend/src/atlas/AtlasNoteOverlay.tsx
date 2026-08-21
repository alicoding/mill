import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@primer/react'
import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { MarkdownNoteField } from './MarkdownNoteField'
import styles from './AtlasNoteOverlay.module.css'

// The note's big surface (docs/goals/0154): ⌘-click / ⌘↵ / the
// context menu's Open note lands here -- a centered dialog holding
// the SAME markdown note machinery the card page uses (rendered at
// rest, prose editor with live preview on click, blur commits). No
// title (notes are title-less by design) and no footer -- Escape or
// the close affordance leaves; edits are already committed on blur.
export function AtlasNoteOverlay({ note, onClose }: {
  note: Note
  onClose: () => void
}) {
  const { t } = useTranslation('atlas')
  const [text, setText] = useState(note.Text)

  const commit = () => {
    if (text === note.Text) return
    void AtlasService.UpdateNoteText(note.ID, text).then(() => refreshAtlas())
  }

  return (
    // data-component, not data-testid: Dialog only forwards its own
    // special-cased "data-component" prop (AtlasCardOverlay.tsx's own
    // comment has the full reasoning).
    <Dialog
      title={t('noteOverlay.title')}
      onClose={() => { commit(); onClose() }}
      width="xlarge"
      data-component="atlas-note-overlay"
    >
      <div className={styles.body}>
        <MarkdownNoteField
          value={text}
          onChange={setText}
          onCommit={commit}
          placeholder={t('sticky.placeholder')}
          ariaLabel={t('sticky.ariaLabel')}
          testId="atlas-note-overlay-editor"
        />
      </div>
    </Dialog>
  )
}
