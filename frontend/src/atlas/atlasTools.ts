import type { AtlasToolIdentity } from '../shared/atlasToolIdentity'
import { assertRegistryAgreesWithIdentity, orderedRegisteredTools } from './atlasNounRegistry'

// The canvas tool registry (goal 0169 slice 1, re-platformed onto
// self-registration in goal 0180 slice 1): every creatable thing's own
// descriptor, in tray render order -- AtlasCreationTray, commands.ts,
// and useKeymapDispatch all derive their per-tool behaviour from
// ATLAS_TOOLS below rather than holding a parallel list of their own.
//
// THE TRAP (read before touching this file): import.meta.glob returns
// Record<string, unknown> -- TypeScript cannot infer a literal union
// from modules the bundler discovers at build time. AtlasToolID/
// AtlasCreationTool/AtlasArmableTool below are therefore derived from
// shared/atlasToolIdentity.ts's own still-literal AtlasToolIdentity
// union, NEVER from `typeof ATLAS_TOOLS` -- ATLAS_TOOLS itself is a
// plain runtime AtlasToolShape[], built by looking up each identity's
// registered descriptor, and widening it back into the source of the
// three union types would silently collapse them to `string` (see
// shared/atlasToolIdentity.ts's own header for why `interaction` moved
// there rather than staying only on each noun's own descriptor).
//
// Each noun's own fat descriptor -- icon, style picker, commit path --
// self-registers from its own frontend/src/atlas/tools/<id>Tool.ts by
// calling registerNoun() at module-eval time (atlasNounRegistry.ts),
// mirroring internal/domain/composition/registry.go's own
// RegisterNodeType/init() pattern (ADR-0006). This file only ITERATES
// the registry -- eager glob-importing every tools/*.ts module (which
// runs their registerNoun() calls) is the one thing that still has to
// happen here, because Vite's glob pattern is necessarily written
// somewhere, and nowhere else needs to enumerate the tools/ directory.
import.meta.glob(['./tools/*.ts', '!./tools/*.test.ts'], { eager: true })

// Fails fast (at the module-eval time every test/dev/build reaches by
// importing this file) if a noun's identity and registered descriptor
// ever disagree -- a noun that half-exists on either side never ships
// half-wired.
assertRegistryAgreesWithIdentity()

export const ATLAS_TOOLS = orderedRegisteredTools()

export { cardTool, type AtlasCardArtifact } from './tools/cardTool'
export { noteTool, type AtlasNoteArtifact } from './tools/noteTool'
export { areaTool, type AtlasAreaArtifact } from './tools/areaTool'
export { tableTool, type AtlasTableArtifact } from './tools/tableTool'
export { imageTool, type AtlasImageArtifact } from './tools/imageTool'
export { pencilTool, type AtlasPencilArtifact } from './tools/pencilTool'
export { eraserTool } from './tools/eraserTool'
export { laserTool } from './tools/laserTool'
export { shapeTool, type AtlasShapeArtifact } from './tools/shapeTool'

export type { AtlasToolShape, AtlasToolInteraction, AtlasToolStyleDefaults } from './atlasNounRegistry'

export type AtlasToolID = AtlasToolIdentity['id']

// The narrower id set for tools whose tray gesture is click-to-arm
// (Card/Note/Area) -- Table's own arming (a picked size) never goes
// through the same armedTool state, so it's excluded here exactly as
// it always has been.
export type AtlasCreationTool = Extract<AtlasToolIdentity, { interaction: 'arm-then-click' }>['id']

// The wider id set for every tool whose tray gesture ARMS a placement
// state at all -- arm-then-click's single-click tools plus every other
// click-to-arm-then-drag tool (pencil, eraser, laser). AtlasBoard.tsx's
// creation.armedTool is typed this wide so any of them can be the live
// armedTool value without widening AtlasCreationTool itself and
// disturbing every arm-then-click-only caller (placeAt's own
// single-click placement, which none of these three ever go through).
export type AtlasArmableTool = Extract<AtlasToolIdentity, { interaction: 'arm-then-click' | 'drag-to-draw' | 'drag-to-erase' | 'ephemeral-drag' }>['id']

// Discrete placement tools disarm after ONE commit and leave the new
// object selected (goal 0199); continuous tools (pencil, eraser,
// laser) stay armed across strokes, unchanged -- that split is the
// point of the goal, never unified. Reads each tool's own declared
// `lockable` (atlasNounRegistry.ts, goal 0181 S3) rather than a hand-
// maintained id set here -- a new discrete tool that copies a sibling's
// arming behaviour without its own answer fails to compile instead of
// silently inheriting the wrong one. image/table arm through a popover/
// dialog, never this toggle-to-lock state machine at all, so both
// declare `lockable: false` for that reason, same as every other
// non-lockable tool.
export function isLockableArmTool(tool: AtlasArmableTool): boolean {
  return ATLAS_TOOLS.find((t) => t.id === tool)?.lockable ?? false
}
