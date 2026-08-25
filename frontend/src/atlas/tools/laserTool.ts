import { ZapIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import { AtlasLaserTrail } from '../AtlasLaserTrail'

const laserIdentity = identityOf('laser')

// Laser fade duration (goal 0169 slice 4): a point stays visible for
// this many ms after being drawn, then ages out on its own via the
// gesture engine's own ephemeral prune loop (useAtlasToolGesture.ts) --
// long enough to trace a gesture while talking, short enough to never
// read as a lingering mark. Exported so AtlasLaserTrail.tsx's own
// per-point opacity math shares the exact same window.
export const LASER_FADE_MS = 700

// Laser (goal 0169 slice 4): ephemeral-drag's own proof -- a pointer
// trail for pointing at things while talking. Renders from the gesture
// engine's own local point accumulation (useAtlasToolGesture.ts), the
// same ephemeral-overlay pattern AtlasPencilLivePreview.tsx already
// established, and
// makes NO AtlasService call at any point in its lifecycle: nothing is
// ever created, so there is nothing to place and nothing for a reload
// to read back. commit() below is never called, for the same reason
// eraserTool's isn't -- kept only to satisfy AtlasToolShape's shape.
export const laserTool = {
  id: laserIdentity.id,
  icon: ZapIcon,
  label: laserIdentity.commandLabel,
  shortcutKey: laserIdentity.shortcutKey,
  tray: 'quick',
  interaction: laserIdentity.interaction,
  // Continuous tool, plain toggle-to-disarm -- never reads a lock flag.
  lockable: false,
  // Local-component-state-only trail, never persisted, no node type.
  resizable: false,
  boardNodeType: null,
  // No node type renders it at all -- always false, not N/A.
  dragBand: false,
  // No style surface of its own (goal 0209) -- always empty, not
  // omitted.
  styleFields: [],
  // Continuous tool, plain toggle-to-disarm -- never reads a lock flag.
  sticky: true,
  gesture: {
    // Never commits anything -- a laser trail makes NO AtlasService
    // call at any point in its lifecycle, so there is nothing for a
    // reload to read back. onEnd exists only to satisfy the contract;
    // the trail's own fade is entirely the engine's fadeMs mechanism.
    onEnd: () => {},
    preview: AtlasLaserTrail,
    fadeMs: LASER_FADE_MS,
  },
  commit: (): null => null,
} as const satisfies AtlasToolShape

registerNoun(laserTool)
