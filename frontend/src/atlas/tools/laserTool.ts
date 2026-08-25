import { ZapIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'

const laserIdentity = identityOf('laser')

// Laser (goal 0169 slice 4): ephemeral-drag's own proof -- a pointer
// trail for pointing at things while talking. Renders from LOCAL
// component state only (useAtlasLaserDraw.ts), the same ephemeral-
// overlay pattern AtlasPencilLivePreview.tsx already established, and
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
  commit: (): null => null,
} as const satisfies AtlasToolShape

registerNoun(laserTool)
