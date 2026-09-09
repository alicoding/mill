import { AtlasService } from '../shared/bindings'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { seatCanvasTool } from './canvasToolAdapter'
import { activeSession, buildFramedTool, commitErase, draftPlacementFor, eraseAt, forgetFramedTools } from './canvasToolFramed'
import { commitDraft, createDraft, discardDraft, dropDraftsFor, patchDraft } from './canvasDrafts'
import { measureMarkup } from './canvasMeasure'
import { CanvasProtocolError, parseErasePoint, parseObjectCommit, parseObjectCreate, parseObjectId, parseObjectMeasure, parseObjectPatch, parseRegisterTool, parseToolId } from './canvasToolProtocol'

// The host's routing table for a framed canvas tool's own doors
// (docs/goals/0380 Decision 2), kept beside the other host-door
// modules (pluginStorageHostDoors.ts) rather than inside the
// activation bridge, so the bridge stays one line per door and this
// file owns the whole canvas contract.
//
// Every door PARSES its message first (canvasToolProtocol.ts) and
// refuses a malformed one by name with nothing changed: a frame is
// untrusted, so "reject with a typed error, no side effect" is the
// contract, not a best-effort read.

// CANVAS_TOOL_DOORS is the door list itself, exported so the bridge's
// method table and the frame runtime's own call surface are checked
// against ONE source (plugin-frame/protocol.test.ts).
export const CANVAS_TOOL_DOORS = [
  'register.tool',
  'object.create', 'object.patch', 'object.commit', 'object.discard',
  'object.measure',
  'files.saveImageBytes',
  'board.eraseAt', 'board.eraseCommit',
] as const

export interface CanvasToolDoorContext {
  pluginId: string
  manifest: Manifest
  // post delivers one host->frame event to THIS plugin's activation
  // frame; the bridge owns the frame handle and supplies it.
  post: (event: string, payload: unknown) => void
}

// erasing is capability-gated exactly as the same-DOM ctx is: without
// "erase-board-items" the doors are not merely unused, they refuse.
function requireErase(ctx: CanvasToolDoorContext): void {
  if (!(ctx.manifest.capabilities ?? []).includes('erase-board-items')) {
    throw new CanvasProtocolError('board.eraseAt', 'needs the "erase-board-items" capability')
  }
}

// A door naming a tool that is not mid-gesture is refused: a draft
// only exists inside a gesture, and a commit outside one has no
// placement context to land in.
function requireSession(ctx: CanvasToolDoorContext, toolId: string) {
  const session = activeSession(ctx.pluginId, toolId)
  if (!session) throw new CanvasProtocolError('toolId', `has no gesture in progress ("${toolId}")`)
  return session
}

function doCreate(ctx: CanvasToolDoorContext, args: unknown[]): { id: string } {
  const message = parseObjectCreate(args[0])
  requireSession(ctx, message.toolId)
  const place = draftPlacementFor(ctx.pluginId, message.toolId)
  if (!place) throw new CanvasProtocolError('toolId', `has no gesture in progress ("${message.toolId}")`)
  return { id: createDraft(ctx.pluginId, message.toolId, message, place).id }
}

function doErase(ctx: CanvasToolDoorContext, args: unknown[]): boolean {
  requireErase(ctx)
  const { toolId, at } = parseErasePoint(args[0])
  eraseAt(requireSession(ctx, toolId).ctx, at)
  return true
}

function doEraseCommit(ctx: CanvasToolDoorContext, args: unknown[]): boolean {
  requireErase(ctx)
  const toolId = parseToolId(args[0], 'board.eraseCommit')
  const session = activeSession(ctx.pluginId, toolId)
  // The erase pass commits AFTER pointer-up, one bridge round trip
  // later, by which point the engine has already ended the session --
  // so an absent session here is normal, and the accumulated hits are
  // read off the ctx the gesture captured.
  if (session) commitErase(session.ctx)
  return true
}

export async function callCanvasToolDoor(ctx: CanvasToolDoorContext, method: string, args: unknown[]): Promise<unknown> {
  const [first] = args
  switch (method) {
    case 'register.tool': {
      const descriptor = parseRegisterTool(first)
      seatCanvasTool(ctx.pluginId, buildFramedTool(ctx.pluginId, ctx.manifest, descriptor, ctx.post), descriptor.styleFields)
      return true
    }
    case 'object.create': return doCreate(ctx, args)
    case 'object.patch': { patchDraft(ctx.pluginId, parseObjectPatch(first)); return true }
    case 'object.commit': {
      const message = parseObjectCommit(first)
      return { id: await commitDraft(ctx.pluginId, message.id, message.select) }
    }
    case 'object.discard': { discardDraft(ctx.pluginId, parseObjectId(first, 'object.discard')); return true }
    case 'object.measure': return measureMarkup(ctx.pluginId, parseObjectMeasure(first))
    case 'files.saveImageBytes': return AtlasService.SaveImageBytes(String(args[0]), String(args[1]), String(args[2]))
    case 'board.eraseAt': return doErase(ctx, args)
    case 'board.eraseCommit': return doEraseCommit(ctx, args)
    default: throw new CanvasProtocolError('method', `is not a canvas-tool door ("${method}")`)
  }
}

// forgetCanvasTools is the teardown half: a plugin whose frame goes
// away leaves no armed runtime and no half-drawn draft behind.
export function forgetCanvasTools(pluginId: string): void {
  forgetFramedTools(pluginId)
  dropDraftsFor(pluginId)
}
