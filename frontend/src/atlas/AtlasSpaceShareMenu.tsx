import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu } from '@primer/react'
import { ShareIcon } from '@primer/octicons-react'
import { AtlasService } from '../shared/bindings'

// The space toolbar's own share affordance (goal 0063, ADR-0038): the
// viewed space's mirror folder (reveal turns it into a STANDING
// reference any AI assistant can ground on, once shared), plus
// bundle-as-context (every child card's own context block,
// concatenated) and a links list -- the space-level counterpart to a
// card's own overlay Share section. Owns its own AtlasService
// calls directly (no data mutation here needing AtlasView's own
// refreshAtlas -- reveal/bundle/copy are all read-only or OS-level
// side effects), the same posture AtlasCardOverlay already takes for
// its own write actions one level up from the presentational canvas/
// shelves tree.
export function AtlasSpaceShareMenu({ spaceID, onError }: {
  spaceID: string
  onError: (message: string) => void
}) {
  const { t } = useTranslation('atlas')

  const revealFolder = () => {
    AtlasService.RevealSpaceFolder(spaceID).catch((err) => onError(String(err)))
  }
  const bundleContext = (withAttachments: boolean) => {
    AtlasService.SpaceBundleContext(spaceID, withAttachments)
      .then((text) => navigator.clipboard.writeText(text))
      .catch((err) => onError(String(err)))
  }
  const copyLinks = () => {
    AtlasService.SpaceLinksList(spaceID)
      .then((text) => navigator.clipboard.writeText(text))
      .catch((err) => onError(String(err)))
  }

  return (
    <ActionMenu>
      <ActionMenu.Button leadingVisual={ShareIcon} variant="invisible" size="small" data-testid="atlas-space-share">
        {t('share.spaceMenuButton')}
      </ActionMenu.Button>
      <ActionMenu.Overlay>
        <ActionList>
          <ActionList.Item onSelect={revealFolder} data-testid="atlas-share-reveal-folder">
            {t('share.revealFolder')}
          </ActionList.Item>
          <ActionList.Item onSelect={() => bundleContext(false)} data-testid="atlas-share-bundle-context">
            {t('share.bundleContext')}
          </ActionList.Item>
          <ActionList.Item onSelect={() => bundleContext(true)} data-testid="atlas-share-bundle-context-attachments">
            {t('share.bundleContextWithAttachments')}
          </ActionList.Item>
          <ActionList.Item onSelect={copyLinks} data-testid="atlas-share-copy-links">
            {t('share.copyLinks')}
          </ActionList.Item>
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
