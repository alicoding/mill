import { Label } from '@primer/react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindLabelColor } from './atlasKindColor'

// The ambient "which kind is this card" cue every card shows regardless
// of view mode (frontend.md's recognition-not-confirmation rule) --
// kind.Icon is the user's own optional emoji glyph (atlas.Kind.Icon),
// kind.Label its own declared name; neither is ever a Mill-owned
// string. Color comes from atlasKindColor's hash, not the kind's
// identity, so this never needs a lookup table keyed by a name this
// package isn't allowed to hardcode.
export function AtlasKindChip({ kind, size = 'small' }: { kind: Kind | undefined; size?: 'small' | 'large' }) {
  if (!kind) return null
  return (
    <Label variant={kindLabelColor(kind.ID)} size={size} data-testid="atlas-kind-chip">
      {kind.Icon ? `${kind.Icon} ` : ''}{kind.Label}
    </Label>
  )
}
