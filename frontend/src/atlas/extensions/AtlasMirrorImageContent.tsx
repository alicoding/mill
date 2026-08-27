import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { Icon } from '@primer/octicons-react'
import type { BoardObject } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { MirrorReadState } from '../useAtlasObjectMirrorRead'
import styles from '../AtlasBoardObjectNode.module.css'

// Shared file-backed content renderer for image/ink board objects
// (goal 0215 S3): both Kinds resolve to base64 image bytes through the
// SAME mirrored-file door (ObjectMirrorContent, read by the host --
// ADR-0046, goal 0244 S1b -- and handed down here as mirrorContent),
// differing only in their fallback glyph -- makeMirrorImageContent below
// parameterizes that one difference rather than branching on Kind at
// render time.
function AtlasMirrorImageContentInner({ object, mirrorContent, Glyph }: { object: BoardObject; mirrorContent: MirrorReadState | undefined; Glyph: Icon | null }) {
  const { t } = useTranslation('atlas')
  const hasSize = !!object.Size
  const content = mirrorContent?.content
  // src/failed are now DERIVED from the host-supplied read on every
  // render, never local state this component resets/fetches itself --
  // the host's own useAtlasObjectMirrorRead owns exactly that reset/
  // refetch timing (goal 0243's no-flash contract), this component only
  // interprets the settled result.
  const src = content?.MimeType && content?.Content ? `data:${content.MimeType};base64,${content.Content}` : null
  const failed = !!mirrorContent?.error || (!!content && !src)

  return src ? (
    <img className={styles.image} data-sized={hasSize} src={src} alt="" draggable={false} />
  ) : (
    <div className={styles.placeholder} data-testid="atlas-board-object-placeholder">
      {/* Glyph is null for a Kind whose content is never available any
          faster than this same load (ink, goal 0243): its stroke bytes
          only ever exist as the file this read resolves, so a fallback
          GLYPH would show a wrong picture (a pencil) for every load,
          not just a failure -- an empty frame is the honest "not there
          yet" state. A Kind whose bytes may already be resident
          elsewhere (image, pasted/dropped before this read resolves)
          keeps its glyph. */}
      {Glyph && <Glyph size={24} />}
      {failed && <span className={styles.error}>{t('boardObject.loadFailed')}</span>}
    </div>
  )
}

// makeMirrorImageContent -- each file-backed noun's own tools/<id>Tool.ts
// calls this once, at module scope, to build the Component its
// `content` declaration carries. Never called per-render. Pass null for
// a Kind whose fallback should render an empty frame instead of a glyph
// (see the comment above). mirrorContent is optional (unlike a normal
// ADR-0046 host-supplied prop) because AtlasMirrorImageContent.test.tsx
// (goal 0243's regression pin) constructs this Component directly with
// no host at all -- omitting it resolves to the exact same not-yet-
// loaded frame a real mount shows before AtlasBoardObjectNode.tsx's own
// read settles.
export function makeMirrorImageContent(Glyph: Icon | null): ComponentType<{ object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState }> {
  return function AtlasMirrorImageContent({ object, mirrorContent }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState }) {
    return <AtlasMirrorImageContentInner object={object} mirrorContent={mirrorContent} Glyph={Glyph} />
  }
}
