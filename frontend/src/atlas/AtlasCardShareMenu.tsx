import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, IconButton } from '@primer/react'
import { ShareIcon } from '@primer/octicons-react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { atlasCardShareActions } from './atlasCardShare'

// The card chip's own share affordance (goal 0063, ADR-0038) --
// follows AtlasCardBody's existing info-button idiom: a small,
// always-visible icon button that opens a menu, never a full dialog.
// The with/without-attachments toggle for copy-as-context is two
// explicit menu items rather than a stateful control, since a
// transient menu has nowhere to hold a checkbox's state once closed
// (AtlasCardOverlay's own Share section offers the checkbox form of
// the same toggle, for a more deliberate share).
export function AtlasCardShareMenu({ card }: { card: Card }) {
  const { t } = useTranslation('atlas')
  const { copyAsContext, copyCloudLink, revealFile } = atlasCardShareActions(card, (message) => console.error(message))

  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton
          icon={ShareIcon}
          aria-label={t('share.cardButtonAriaLabel', { title: card.Title })}
          size="small"
          variant="invisible"
          data-testid="atlas-card-share"
          className="nodrag nopan"
          onClick={(e) => e.stopPropagation()}
        />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay>
        <ActionList>
          <ActionList.Item onSelect={() => void copyAsContext(false)} data-testid="atlas-share-copy-context">
            {t('share.copyContext')}
          </ActionList.Item>
          <ActionList.Item onSelect={() => void copyAsContext(true)} data-testid="atlas-share-copy-context-attachments">
            {t('share.copyContextWithAttachments')}
          </ActionList.Item>
          {card.Source && (
            <ActionList.Item onSelect={() => void copyCloudLink()} data-testid="atlas-share-copy-link">
              {t('share.copyCloudLink')}
            </ActionList.Item>
          )}
          {card.MirrorPath && (
            <ActionList.Item onSelect={() => void revealFile()} data-testid="atlas-share-reveal-file">
              {t('share.revealFile')}
            </ActionList.Item>
          )}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
