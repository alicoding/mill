import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu } from '@primer/react'
import { atlasSpaceShareActions } from './atlasSpaceShareActions'

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
//
// The trigger itself lives in the caller (AtlasToolbar's own ActionBar,
// goal 0216) rather than here, anchored externally via `anchorRef` --
// ActionMenu positions its Overlay off that ref alone, no
// ActionMenu.Anchor child required (AnchoredOverlay's renderAnchor is
// optional) -- so this component owns only the menu's own items/logic.
export function AtlasSpaceShareMenu({ spaceID, onError, anchorRef, open, onOpenChange }: {
  spaceID: string
  onError: (message: string) => void
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('atlas')
  const { revealFolder, bundleContext, copyLinks } = atlasSpaceShareActions(spaceID, onError)

  return (
    <ActionMenu anchorRef={anchorRef} open={open} onOpenChange={onOpenChange}>
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
