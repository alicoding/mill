import { useTranslation } from 'react-i18next'
import { Button, FormControl, Stack, Text, TextInput, Textarea } from '@primer/react'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { EntityRefField } from '../configure/EntityRefField'
import { AtlasFieldsForm } from './AtlasFieldsForm'
import { AtlasCardOverlayLinks } from './AtlasCardOverlayLinks'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasCardPage.module.css'

// The page's own edit affordances (goal 0072 slice C item 3): every
// field/link/delete capability the old overlay carried, relocated
// below the Contents column rather than lost -- the page is the ONLY
// place any of this edits (board faces are read-only, per slice A).
export function AtlasCardPageEditSection({
  card, kind, allCards, links, linkKinds,
  title, note, fields, source, mirrorPath, refreshWorkflowID,
  onTitleChange, onNoteChange, onFieldsChange, onSourceChange, onMirrorPathChange, onRefreshWorkflowChange,
  onAddLink, onRemoveLink,
  saving, error, onSave, onDelete,
}: {
  card: Card
  kind: Kind | undefined
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  title: string
  note: string
  fields: Record<string, string>
  source: string
  mirrorPath: string
  refreshWorkflowID: string
  onTitleChange: (value: string) => void
  onNoteChange: (value: string) => void
  onFieldsChange: (key: string, value: string) => void
  onSourceChange: (value: string) => void
  onMirrorPathChange: (value: string) => void
  onRefreshWorkflowChange: (value: string) => void
  onAddLink: (toCardID: string, linkKindID: string) => Promise<void>
  onRemoveLink: (linkID: string) => Promise<void>
  saving: boolean
  error: string
  onSave: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('atlas')

  // A native <details> disclosure, collapsed by default: the page
  // reads first (the mock's fullview shows no form at all) and edits
  // on demand -- an always-open field dump was drowning the Contents
  // the page exists to present.
  return (
    <details className={styles.editSection} data-testid="atlas-page-edit-section">
      <summary className={styles.editSummary} data-testid="atlas-page-edit-toggle">{t('page.editHeading')}</summary>
      <div className={styles.editFields}>

      <FormControl>
        <FormControl.Label>{t('overlay.titleLabel')}</FormControl.Label>
        <TextInput value={title} data-testid="atlas-overlay-title" onChange={(e) => onTitleChange(e.target.value)} block />
      </FormControl>

      <FormControl>
        <FormControl.Label>{t('overlay.noteLabel')}</FormControl.Label>
        <Textarea value={note} data-testid="atlas-overlay-note" rows={3} block onChange={(e) => onNoteChange(e.target.value)} />
      </FormControl>

      {kind && (kind.Fields ?? []).length > 0 ? (
        <AtlasFieldsForm fields={kind.Fields ?? []} values={fields} onChange={onFieldsChange} />
      ) : (
        <Text as="p" size="small" className={runbookStyles.muted}>{t('overlay.noFields')}</Text>
      )}

      <FormControl>
        <FormControl.Label>{t('overlay.sourceLabel')}</FormControl.Label>
        <TextInput value={source} data-testid="atlas-overlay-source" onChange={(e) => onSourceChange(e.target.value)} block />
      </FormControl>

      <FormControl>
        <FormControl.Label>{t('overlay.mirrorPathLabel')}</FormControl.Label>
        <TextInput value={mirrorPath} data-testid="atlas-overlay-mirror-path" onChange={(e) => onMirrorPathChange(e.target.value)} block />
      </FormControl>

      <FormControl>
        <FormControl.Label>{t('overlay.refreshWorkflowLabel')}</FormControl.Label>
        <EntityRefField refKind="workflow" value={refreshWorkflowID} onChange={onRefreshWorkflowChange} />
      </FormControl>

      <AtlasCardOverlayLinks card={card} allCards={allCards} links={links} linkKinds={linkKinds} onAdd={onAddLink} onRemove={onRemoveLink} />

      {error && <Text as="p" size="small" className={runbookStyles.error}>{error}</Text>}
      <Stack direction="horizontal" gap="condensed">
        <Button variant="primary" size="small" data-testid="atlas-overlay-save" disabled={saving || !title.trim()} onClick={onSave}>
          {t('overlay.save')}
        </Button>
        <Button variant="danger" size="small" data-testid="atlas-overlay-delete" onClick={onDelete}>
          {t('overlay.delete')}
        </Button>
      </Stack>
      </div>
    </details>
  )
}
