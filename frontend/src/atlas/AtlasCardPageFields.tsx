import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FormControl, Text, TextInput, Textarea } from '@primer/react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasCardActions } from './AtlasCardActions'
import { AtlasFieldsForm } from './AtlasFieldsForm'
import { isMirrorKind } from './atlasCardPageContent'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasCardPage.module.css'

// The page's own editable fields (goal 0081 slice A5, LOCKED design
// §5b "read is edit"): every card-level/kind field as its typed
// control, in place -- no separate edit-mode disclosure, no Save
// button. Note/kind-Fields/Source/Mirror path/Refresh workflow each
// commit through their own onCommit* callback at the point that
// matches their control's interaction model (blur for continuous
// typing, change for a discrete select/checkbox) -- AtlasCardOverlay
// owns the actual persistence + per-field error/tick state, this
// component only wires each control to it.
export function AtlasCardPageFields({
  kind, note, noteError, onNoteChange, onNoteCommit,
  fields, fieldErrors, onFieldsChange, onFieldsCommit,
  source, sourceError, onSourceChange, onSourceCommit,
  mirrorPath, mirrorPathError, onMirrorPathChange, onMirrorPathCommit,
  cardID, actionWorkflowIDs, onActionsChanged,
}: {
  kind: Kind | undefined
  note: string
  noteError: string
  onNoteChange: (value: string) => void
  onNoteCommit: () => void
  fields: Record<string, string>
  fieldErrors: Record<string, string>
  onFieldsChange: (key: string, value: string) => void
  onFieldsCommit: (key: string, value: string) => void
  source: string
  sourceError: string
  onSourceChange: (value: string) => void
  onSourceCommit: () => void
  mirrorPath: string
  mirrorPathError: string
  onMirrorPathChange: (value: string) => void
  onMirrorPathCommit: () => void
  cardID: string
  actionWorkflowIDs: string[]
  onActionsChanged: (next: string[]) => void
}) {
  const { t } = useTranslation('atlas')
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const showMirrorFields = kind ? isMirrorKind(kind.ID) : false

  // Auto-grow (LOCKED design §5b's "Note (multiline, auto-growing)"):
  // a textarea's own scrollHeight already accounts for its wrapped
  // line count, so resetting height then reading it back is enough --
  // no external autosize library needed for a single-element case this
  // small.
  useEffect(() => {
    const el = noteRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note])

  return (
    <div className={styles.fieldsCol} data-testid="atlas-page-fields">
      <FormControl>
        <FormControl.Label>{t('overlay.noteLabel')}</FormControl.Label>
        <Textarea
          ref={noteRef}
          value={note}
          rows={2}
          block
          resize="none"
          data-testid="atlas-page-note"
          onChange={(e) => onNoteChange(e.target.value)}
          onBlur={onNoteCommit}
        />
        {noteError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-page-note-error">{noteError}</Text>}
      </FormControl>

      {kind && (kind.Fields ?? []).length > 0 ? (
        <AtlasFieldsForm fields={kind.Fields ?? []} values={fields} onChange={onFieldsChange} onCommit={onFieldsCommit} errors={fieldErrors} />
      ) : (
        <Text as="p" size="small" className={runbookStyles.muted}>{t('overlay.noFields')}</Text>
      )}

      {showMirrorFields && (
        <>
          <FormControl>
            <FormControl.Label>{t('overlay.sourceLabel')}</FormControl.Label>
            <TextInput value={source} data-testid="atlas-page-source" onChange={(e) => onSourceChange(e.target.value)} onBlur={onSourceCommit} block />
            {sourceError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-page-source-error">{sourceError}</Text>}
          </FormControl>

          <FormControl>
            <FormControl.Label>{t('overlay.mirrorPathLabel')}</FormControl.Label>
            <TextInput value={mirrorPath} data-testid="atlas-page-mirror-path" onChange={(e) => onMirrorPathChange(e.target.value)} onBlur={onMirrorPathCommit} block />
            {mirrorPathError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-page-mirror-path-error">{mirrorPathError}</Text>}
          </FormControl>
        </>
      )}

      <AtlasCardActions cardID={cardID} actionWorkflowIDs={actionWorkflowIDs} onActionsChanged={onActionsChanged} />
    </div>
  )
}
