import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import { deriveFileTag } from './atlasCardPresentation'
import { isPersonKind } from './atlasCardPageContent'
import styles from './AtlasCardPage.module.css'

// The page's own header (goal 0072 slice C, the ratified anatomy): a
// kind glyph (circle for the seeded person-kind example, square
// otherwise) · title · the same file-tag chip the board card derives ·
// a right-aligned, bordered Close button. Below it, a 1px border
// separates header from the two-column body (AtlasCardPage.module.css's
// own .header rule).
export function AtlasCardPageHeader({ card, kind, dialogLabelId, onClose }: {
  card: Card
  kind: Kind | undefined
  dialogLabelId?: string
  onClose: () => void
}) {
  const { t } = useTranslation('atlas')
  const tokens = kindColorTokens(card.KindID)
  const fileTag = deriveFileTag(card)
  const contact = isPersonKind(card.KindID)

  return (
    <div className={styles.header} data-testid="atlas-page-header">
      <span
        className={`${styles.glyph} ${contact ? styles.glyphCircle : ''}`}
        style={{ background: `var(${tokens.emphasis})` }}
        data-testid="atlas-page-glyph"
      >
        {(kind?.Label ?? '?').charAt(0).toUpperCase()}
      </span>
      <span id={dialogLabelId} className={styles.title} data-testid="atlas-page-title">{card.Title}</span>
      {fileTag && (
        <span className={`${styles.fileTag} ${styles[`fileTag-${fileTag.color}`]}`} data-testid="atlas-page-file-tag">
          {fileTag.label}
        </span>
      )}
      <Button size="small" variant="default" className={styles.closeButton} data-testid="atlas-page-close" onClick={onClose}>
        {t('page.close')}
      </Button>
    </div>
  )
}
