import { useEffect, useState } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { UnitComponent, UnitComponentLoader } from './unitRegistry'

// Mounts one board unit's lazily-loaded render component (ADR-0043
// §4's chunking shape) -- the ONE place that awaits a UnitComponentLoader
// and swaps in the resolved component, so every unit's Page/Face stays
// a plain dynamic import with no per-renderer loading boilerplate.
// Renders nothing while the chunk loads: unlike shared/CodeEditor.tsx
// (which needs a non-empty textarea fallback so a field is never
// dead), a unit's chunk here is small enough that the loading gap is
// effectively instant, and the alternative -- an empty content column
// for a beat -- is the same "nothing yet" state the column already
// shows before its own data fetch resolves (see
// AtlasCardMirrorPreview's own atlas-mirror-loading state).
export function UnitRenderSlot({ loader, card }: { loader: UnitComponentLoader; card: Card }) {
  const [Component, setComponent] = useState<UnitComponent | null>(null)

  useEffect(() => {
    let cancelled = false
    setComponent(null)
    loader().then((mod) => {
      if (!cancelled) setComponent(() => mod)
    }).catch((err) => {
      console.warn('UnitRenderSlot: renderer chunk failed to load', err)
    })
    return () => {
      cancelled = true
    }
  }, [loader])

  if (!Component) return null
  return <Component card={card} />
}
