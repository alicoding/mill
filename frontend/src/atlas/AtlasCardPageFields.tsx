import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, Text, TextInput } from '@primer/react'
import { MarkdownNoteField } from './MarkdownNoteField'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { AtlasCardActions } from './AtlasCardActions'
import { AtlasFieldsForm } from './AtlasFieldsForm'
import { isMirrorKind, statusFieldOf } from './atlasCardPageContent'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasCardPage.module.css'

// The page's own editable fields (goal 0081 slice A5, LOCKED design
// §5b "read is edit"; reworked into the calm document layout by goal
// 0106 slice B contract item 3): the Note is a borderless type-to-write
// area (a placeholder line when empty, never a labeled box); every
// OTHER optional field (a kind's declared Fields, Source, Mirror path)
// starts collapsed behind a one-line "+ Add {field}" invitation when
// it carries no value, and expands into its normal control -- focused
// -- the moment that line is clicked. A field that already has a value
// renders its control immediately, same as before. Every control still
// commits through its own onCommit* callback at the point that matches
// its interaction model (blur for continuous typing, change for a
// discrete select/checkbox) -- AtlasCardOverlay owns the actual
// persistence + per-field error/tick state, this component only wires
// each control to it. The caller keys this whole component by the
// displayed card's own id, so a chip navigation to a DIFFERENT card
// always starts every field's collapse/expand state fresh, seeded from
// that card's own values -- never carried over from whichever card's
// page was open a moment ago.
export function AtlasCardPageFields({
  kind, note, noteError, onNoteChange, onNoteCommit,
  fields, fieldErrors, onFieldsChange, onFieldsCommit,
  source, sourceError, onSourceChange, onSourceCommit,
  mirrorPath, mirrorPathError, onMirrorPathChange, onMirrorPathCommit,
  cardID, actionWorkflowIDs, onActionsChanged, cardRefCandidates,
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
  cardRefCandidates?: (field: Field) => { id: string; title: string }[]
}) {
  const { t } = useTranslation('atlas')
  const showMirrorFields = kind ? isMirrorKind(kind.ID) : false
  // The status field renders as the property strip's own chip instead
  // (AtlasCardPropertyStrip.tsx) -- excluded here so it's never shown
  // twice.
  const statusKey = statusFieldOf(kind)?.Key
  const kindFields = (kind?.Fields ?? []).filter((f) => f.Key !== statusKey)

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const seed = new Set<string>()
    for (const field of kindFields) if (fields[field.Key]) seed.add(field.Key)
    if (source) seed.add('source')
    if (mirrorPath) seed.add('mirrorPath')
    return seed
  })
  // The just-clicked "+ Add" line's own key, consumed by the focus
  // effect below then cleared -- distinct from `expanded` itself so a
  // field already expanded at mount (it already carries a value) never
  // steals focus, only a field expanded BY A CLICK does.
  const [justExpandedKey, setJustExpandedKey] = useState<string | null>(null)
  const expand = (key: string) => {
    setExpanded((prev) => new Set(prev).add(key))
    setJustExpandedKey(key)
  }

  useEffect(() => {
    if (!justExpandedKey) return
    const selector = justExpandedKey === 'source' ? '[data-testid="atlas-page-source"]'
      : justExpandedKey === 'mirrorPath' ? '[data-testid="atlas-page-mirror-path"]'
        : `[data-field-key="${justExpandedKey}"]`
    document.querySelector<HTMLElement>(selector)?.focus()
    setJustExpandedKey(null)
  }, [justExpandedKey])

  const expandedKindFields = kindFields.filter((f) => expanded.has(f.Key))
  const collapsedKindFields = kindFields.filter((f) => !expanded.has(f.Key))

  return (
    <div className={styles.fieldsCol} data-testid="atlas-page-fields">
      <MarkdownNoteField
        value={note}
        onChange={onNoteChange}
        onCommit={onNoteCommit}
        placeholder={t('overlay.notePlaceholder')}
        ariaLabel={t('overlay.noteLabel')}
        testId="atlas-page-note"
      />
      {noteError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-page-note-error">{noteError}</Text>}

      {expandedKindFields.length > 0 && (
        <AtlasFieldsForm fields={expandedKindFields} values={fields} onChange={onFieldsChange} onCommit={onFieldsCommit} errors={fieldErrors} cardRefCandidates={cardRefCandidates} />
      )}
      {collapsedKindFields.map((field) => (
        <Button
          key={field.Key}
          size="small"
          variant="invisible"
          className={styles.quietAdd}
          data-testid="atlas-page-add-field"
          onClick={() => expand(field.Key)}
        >
          {t('page.addField', { label: field.Label })}
        </Button>
      ))}

      {showMirrorFields && (
        <>
          {expanded.has('source') ? (
            <FormControl>
              <FormControl.Label>{t('overlay.sourceLabel')}</FormControl.Label>
              <TextInput value={source} data-testid="atlas-page-source" onChange={(e) => onSourceChange(e.target.value)} onBlur={onSourceCommit} block />
              {sourceError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-page-source-error">{sourceError}</Text>}
            </FormControl>
          ) : (
            <Button size="small" variant="invisible" className={styles.quietAdd} data-testid="atlas-page-add-source" onClick={() => expand('source')}>
              {t('page.addSource')}
            </Button>
          )}

          {expanded.has('mirrorPath') ? (
            <FormControl>
              <FormControl.Label>{t('overlay.mirrorPathLabel')}</FormControl.Label>
              <TextInput value={mirrorPath} data-testid="atlas-page-mirror-path" onChange={(e) => onMirrorPathChange(e.target.value)} onBlur={onMirrorPathCommit} block />
              {mirrorPathError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-page-mirror-path-error">{mirrorPathError}</Text>}
            </FormControl>
          ) : (
            <Button size="small" variant="invisible" className={styles.quietAdd} data-testid="atlas-page-add-mirror-path" onClick={() => expand('mirrorPath')}>
              {t('page.addMirrorPath')}
            </Button>
          )}
        </>
      )}

      <AtlasCardActions cardID={cardID} actionWorkflowIDs={actionWorkflowIDs} onActionsChanged={onActionsChanged} />
    </div>
  )
}
