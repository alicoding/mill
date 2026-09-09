import { useTranslation } from 'react-i18next'
import { UndoToast } from '../shared/UndoToast'
import styles from './AtlasUndoToast.module.css'

// One locale-key pair per board-object kind that declares an entityRef
// (goal 0392 S1's own registry field, internal/domain/atlas/
// boardobjectkind.go) -- table is the only kind with one today; a
// second entity-projecting kind adds its own pair here, never a new
// branch of copy-composing logic.
const ENTITY_DELETE_TOAST_KEYS: Record<string, { stays: string; unused: string }> = {
  table: { stays: 'undo.tableRemovedListStays', unused: 'undo.tableRemovedListUnused' },
}

// The board's quick-delete toast (goal 0093): the shared UndoToast with
// the board's own message segments and its in-board position.
export function AtlasUndoToast({
  count, linksRemoved, childrenReparented, objectKind, entityRefKind, entityStillUsed, onUndo,
}: {
  count: number
  linksRemoved: number
  childrenReparented: number
  // The deleted board object's own entity-reference outcome (goal 0392
  // S1) -- objectKind/entityRefKind are '' for a card/note delete or a
  // kind with no declared entityRef, in which case no entity-outcome
  // segment renders at all.
  objectKind: string
  entityRefKind: string
  entityStillUsed: boolean
  onUndo: () => void
}) {
  const { t } = useTranslation('atlas')
  // An entity-projecting kind (table) states its own full outcome
  // sentence in place of the generic "Deleted N" -- board objects carry
  // no link/child blast radius of their own (TombstoneResult's own doc
  // comment), so there is nothing else this segment would otherwise
  // need to say alongside it.
  const entityCopy = entityRefKind !== '' ? ENTITY_DELETE_TOAST_KEYS[objectKind] : undefined
  const segments = entityCopy
    ? [t(entityStillUsed ? entityCopy.stays : entityCopy.unused)]
    : [t('board.deletedToast', { count })]
  if (linksRemoved > 0) segments.push(t('board.linksHiddenToast', { count: linksRemoved }))
  if (childrenReparented > 0) segments.push(t('board.childrenMovedToast', { count: childrenReparented }))
  return <UndoToast className={styles.toast} message={segments.join(' ')} undoLabel={t('board.undo')} onUndo={onUndo} testId="atlas-undo-toast" />
}
