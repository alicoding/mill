import { AtlasCardMirrorPreview } from './AtlasCardMirrorPreview'
import type { UnitRenderProps } from './unitRegistry'
import styles from './AtlasNoteCardNode.module.css'

// The mirror-image unit's board face (goal 0179 closing gap 2): a
// small thumbnail so a PROMOTED image card shows its picture without
// opening the card. Reuses AtlasCardMirrorPreview -- the exact same
// mirror-content read seam the card page's own Page renderer already
// uses -- rather than a second fetch path for the same bytes.
export function AtlasUnitMirrorImageFace({ card }: UnitRenderProps) {
  return (
    <div className={styles.mirrorFacePreview}>
      <AtlasCardMirrorPreview cardID={card.ID} mirrorPath={card.MirrorPath} />
    </div>
  )
}
