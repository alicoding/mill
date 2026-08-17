import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, IconButton, Text, TextInput, VisuallyHidden } from '@primer/react'
import { CheckIcon, KebabHorizontalIcon } from '@primer/octicons-react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import { deriveFileTag } from './atlasCardPresentation'
import { isPersonKind } from './atlasCardPageContent'
import { truncateBackTitle } from './atlasCardPageNav'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasCardPage.module.css'

// The page's own header (goal 0072 slice C's ratified anatomy,
// extended by goal 0081 slice A5): a kind glyph · an optional ← back
// button (chip navigation's own "way back", LOCKED design §5b) · the
// title, now a single-line input styled as the heading itself (read is
// edit -- no separate read/edit representation) · the same file-tag
// chip the board card derives · a quiet "Saved" tick · an overflow
// kebab menu (kind-aware Open file/Reveal for a mirror-bearing card,
// then Delete -- rider (a): the ONE place a page card is deleted from
// now that the old edit-section Delete button is gone) · a
// right-aligned, bordered Close button.
export function AtlasCardPageHeader({
  card, kind, dialogLabelId, onClose,
  titleValue, titleError, onTitleChange, onTitleCommit,
  backTitle, onBack,
  savedTick,
  showMirrorMenuItems, onOpenFile, onRevealFile,
  onDelete,
}: {
  card: Card
  kind: Kind | undefined
  dialogLabelId?: string
  onClose: () => void
  titleValue: string
  titleError: string
  onTitleChange: (value: string) => void
  onTitleCommit: () => void
  backTitle: string | null
  onBack: () => void
  savedTick: boolean
  showMirrorMenuItems: boolean
  onOpenFile: () => void
  onRevealFile: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('atlas')
  const tokens = kindColorTokens(card.KindID)
  const fileTag = deriveFileTag(card)
  const contact = isPersonKind(card.KindID)

  return (
    <div className={styles.header} data-testid="atlas-page-header">
      {backTitle !== null && (
        <Button
          size="small"
          variant="invisible"
          className={styles.backButton}
          data-testid="atlas-page-back"
          aria-label={t('page.backAriaLabel', { title: backTitle })}
          onClick={onBack}
        >
          {`← ${truncateBackTitle(backTitle)}`}
        </Button>
      )}
      <span
        className={`${styles.glyph} ${contact ? styles.glyphCircle : ''}`}
        style={{ background: `var(${tokens.emphasis})` }}
        data-testid="atlas-page-glyph"
      >
        {(kind?.Label ?? '?').charAt(0).toUpperCase()}
      </span>
      {/* Dialog's own aria-labelledby target: a plain text node with
          the card's title, kept visually hidden -- the editable
          TextInput right below it is the visible representation, but
          an <input>'s own accessible text isn't its value, so
          aria-labelledby needs a real text node to point at instead. */}
      <VisuallyHidden id={dialogLabelId}>{titleValue}</VisuallyHidden>
      <span className={styles.titleField}>
        <TextInput
          value={titleValue}
          className={styles.titleInput}
          aria-label={t('overlay.titleLabel')}
          data-testid="atlas-page-title"
          onChange={(e) => onTitleChange(e.target.value)}
          onBlur={onTitleCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />
        {titleError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-page-title-error">{titleError}</Text>}
      </span>
      {fileTag && (
        <span className={`${styles.fileTag} ${styles[`fileTag-${fileTag.color}`]}`} data-testid="atlas-page-file-tag">
          {fileTag.label}
        </span>
      )}
      {savedTick && (
        <span className={styles.savedTick} data-testid="atlas-page-saved-tick" aria-live="polite">
          <CheckIcon size={12} /> {t('page.saved')}
        </span>
      )}
      <ActionMenu>
        <ActionMenu.Anchor>
          <IconButton
            icon={KebabHorizontalIcon}
            aria-label={t('page.menuAriaLabel')}
            size="small"
            variant="invisible"
            data-testid="atlas-page-menu"
          />
        </ActionMenu.Anchor>
        <ActionMenu.Overlay>
          <ActionList>
            {showMirrorMenuItems && (
              <>
                <ActionList.Item onSelect={onOpenFile} data-testid="atlas-page-menu-open-file">{t('contextMenu.openFile')}</ActionList.Item>
                <ActionList.Item onSelect={onRevealFile} data-testid="atlas-page-menu-reveal">{t('contextMenu.revealInFileManager')}</ActionList.Item>
                <ActionList.Divider />
              </>
            )}
            <ActionList.Item variant="danger" onSelect={onDelete} data-testid="atlas-page-menu-delete">{t('overlay.delete')}</ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
      <Button size="small" variant="default" className={styles.closeButton} data-testid="atlas-page-close" onClick={onClose}>
        {t('page.close')}
      </Button>
    </div>
  )
}
