import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@primer/react'
import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { MarkdownNoteField } from './MarkdownNoteField'
import styles from './AtlasNoteOverlay.module.css'

// The note's big surface (docs/goals/0154): ⌘-click / ⌘↵ / the
// context menu's Open note lands here -- a centered dialog holding
// the SAME markdown note machinery the card page uses (the shared
// MarkdownNoteField, Milkdown-backed since goal 0244 S3: formatted at
// rest and while editing, no raw source ever shown). No title (notes
// are title-less by design) and no footer -- Escape or the close
// affordance leaves, and onClose always commits the current draft
// (MarkdownNoteField's own pointer/window-blur commit may already
// have run first; commit() below is idempotent against that).
export function AtlasNoteOverlay({ note, onClose }: {
  note: Note
  onClose: () => void
}) {
  const { t } = useTranslation('atlas')
  const [text, setText] = useState(note.Text)
  // MarkdownNoteField's own live commit trigger (its onRequestCommitReady)
  // -- reused by close() below so Escape/the close affordance commits
  // the AUTHORITATIVE current document the same way a press-outside
  // does, never `text` state alone (which trails Milkdown's debounced
  // markdownUpdated listener and can be stale at the moment a fast
  // dismissal fires).
  const requestCommitRef = useRef<(() => void) | undefined>(undefined)

  // Takes the AUTHORITATIVE current text directly from MarkdownNoteField
  // (via its own onCommit(text) -- testing.md: computed and passed, not
  // re-read from `text` state).
  const commit = (current: string) => {
    if (current === note.Text) return
    void AtlasService.UpdateNoteText(note.ID, current).then(() => refreshAtlas())
  }

  const close = () => {
    if (requestCommitRef.current) requestCommitRef.current()
    else commit(text)
    onClose()
  }

  return (
    // data-component, not data-testid: Dialog only forwards its own
    // special-cased "data-component" prop (AtlasCardOverlay.tsx's own
    // comment has the full reasoning).
    <Dialog
      title={t('noteOverlay.title')}
      onClose={close}
      width="xlarge"
      data-component="atlas-note-overlay"
    >
      {/* Own Escape handler, not just Dialog's built-in one: ProseMirror
          calls preventDefault() on every Escape keydown by construction
          (a defensive default, not a specific keybinding of ours), and
          Dialog's own close-on-Escape skips a defaultPrevented event --
          so with focus inside the Milkdown editor, Escape would
          otherwise silently do nothing. Catching it here, before it
          bubbles to Dialog's own listener, restores the close. */}
      <div className={styles.body} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
        <MarkdownNoteField
          value={text}
          onChange={setText}
          onCommit={commit}
          onRequestCommitReady={(fn) => {
            requestCommitRef.current = fn
          }}
          placeholder={t('sticky.placeholder')}
          ariaLabel={t('sticky.ariaLabel')}
          testId="atlas-note-overlay-editor"
        />
      </div>
    </Dialog>
  )
}
