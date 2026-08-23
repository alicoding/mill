import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import { AtlasCardMirrorPreview } from './AtlasCardMirrorPreview'
import type { UnitRenderProps } from './unitRegistry'

// The markdown-mirror and image units' shared card-page presentation
// -- moved here unchanged from AtlasCardPageContents.tsx's old
// hardcoded `card.MirrorPath && (...)` block (goal 0133 slice 1).
// AtlasCardMirrorPreview itself is untouched: it already branches
// internally on the mirror's own Kind (markdown/text/image/other), so
// one Page component correctly serves both units -- they differ only
// in which extensions detect() claims and which file-tag they render,
// never in how the content itself displays.
export function AtlasUnitMirrorPage({ card }: UnitRenderProps) {
  const { t } = useTranslation('atlas')
  return (
    <Stack direction="vertical" gap="condensed" data-testid="atlas-card-mirror-content">
      <Text weight="semibold">{t('overlay.mirrorContentHeading')}</Text>
      <AtlasCardMirrorPreview cardID={card.ID} mirrorPath={card.MirrorPath} />
    </Stack>
  )
}
