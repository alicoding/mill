import { useSyncExternalStore } from 'react'
import { useStore, ViewportPortal } from '@xyflow/react'
import type { GuideChannel } from './alignmentGuides'
import styles from './AtlasAlignmentGuides.module.css'

// The alignment overlay (goal 0161 slice 2). Two reasons it is shaped
// this way:
//
// 1. ViewportPortal, not a fixed screen-space overlay: a guide is a
//    line in BOARD coordinates against real board boxes, so it must
//    pan and zoom with the content it is measuring. (The slot-drag
//    line next to it is fixed-position instead because that gesture is
//    tracked in client coordinates from the start.)
// 2. useSyncExternalStore over the drag hook's own channel: the guides
//    change on every pointer frame, and only THIS component may
//    re-render for them -- state in the drag hook would re-render the
//    whole board mid-drag (goal 0161 slice 1).
export function AtlasAlignmentGuides({ channel }: { channel: GuideChannel }) {
  const guides = useSyncExternalStore(channel.subscribe, channel.snapshot)
  const zoom = useStore((s) => s.transform[2])
  if (guides.length === 0) return null
  // Thickness in board units, so the line reads as exactly one screen
  // pixel at any zoom -- the portal's content lives inside React
  // Flow's own scaled viewport.
  const thickness = 1 / zoom
  return (
    <ViewportPortal>
      {guides.map((guide) => (
        <div
          key={guide.axis}
          className={styles.guide}
          data-testid="atlas-alignment-guide"
          data-axis={guide.axis}
          style={guide.axis === 'x'
            ? { left: guide.at - thickness / 2, top: guide.from, width: thickness, height: guide.to - guide.from }
            : { left: guide.from, top: guide.at - thickness / 2, width: guide.to - guide.from, height: thickness }}
        />
      ))}
    </ViewportPortal>
  )
}
