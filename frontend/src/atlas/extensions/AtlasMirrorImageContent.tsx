import type { ComponentType } from 'react'
import type { Icon } from '@primer/octicons-react'
import type { BoardObject } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { MirrorReadState } from '../useAtlasObjectMirrorRead'
import { AtlasMirrorImageContentInner } from './AtlasMirrorImageContentInner'

// makeMirrorImageContent -- each file-backed noun's own tools/<id>Tool.ts
// calls this once, at module scope, to build the Component its
// `content` declaration carries. Never called per-render. Pass null for
// a Kind whose fallback should render an empty frame instead of a glyph
// (AtlasMirrorImageContentInner.tsx's own comment). mirrorContent is
// optional (unlike a normal ADR-0046 host-supplied prop) because
// AtlasMirrorImageContent.test.tsx (goal 0243's regression pin)
// constructs this Component directly with no host at all -- omitting it
// resolves to the exact same not-yet-loaded frame a real mount shows
// before AtlasBoardObjectNode.tsx's own read settles.
export function makeMirrorImageContent(Glyph: Icon | null): ComponentType<{ object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState }> {
  return function AtlasMirrorImageContent({ object, mirrorContent }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState }) {
    return <AtlasMirrorImageContentInner object={object} mirrorContent={mirrorContent} Glyph={Glyph} />
  }
}
