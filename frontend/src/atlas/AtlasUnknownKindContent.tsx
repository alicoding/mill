import { useTranslation } from 'react-i18next'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import styles from './AtlasUnknownKindContent.module.css'

// The board face for an object whose Kind has NO registered content
// (docs/goals/0249's audit rider): a plugin turned off or uninstalled
// leaves its objects on the board by promise ("objects it already
// placed stay untouched"), and an ingestion claim can land an object
// before its plugin ever renders -- both previously rendered NOTHING
// (AtlasBoardObjectNode returned null), an invisible, unselectable
// node. This face keeps the object visible, selectable, and deletable,
// and says honestly why it isn't rendering.
export function AtlasUnknownKindContent({ object }: { object: BoardObject; mirrorVersion: number }) {
  const { t } = useTranslation('atlas')
  return (
    <div className={styles.face} data-testid="atlas-unknown-kind-face">
      <span className={styles.title}>{object.Payload?.title || object.Kind}</span>
      <span className={styles.note}>{t('unknownKind.note', { kind: object.Kind })}</span>
    </div>
  )
}
