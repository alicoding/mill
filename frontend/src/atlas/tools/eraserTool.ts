import { TrashIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'

const eraserIdentity = identityOf('eraser')

// Eraser (goal 0169 slice 4): drag-to-erase's own proof. Whole-element
// only -- never a partial/pixel erase (the converged default this
// goal's own research recorded: pixel-erase is contested even
// upstream). Deletion is NOT unrecoverable: it never calls
// AtlasService directly at all -- useAtlasEraserDraw.ts hands its
// accumulated hit set straight to the SAME onDeleteSelection door the
// selection tray's own Delete key already uses (AtlasBoard.tsx), which
// routes through goal 0093's quick-delete-WITH-UNDO guard (a 10s toast
// + Cmd-Z, AtlasUndoToast.tsx) -- the exact mechanism every other
// Atlas delete already relies on, never a bespoke one. Scoped to
// TOP-LEVEL boxes only, same as every other spatial gesture on this
// board (area-draw, drag-filing, slot-drag) -- a card nested inside a
// frame's own preview isn't independently erasable by a drag over that
// preview. Containers (isFrame boxes) are excluded from the hit test
// entirely: a frame's own rendered bounds cover its whole child area,
// so treating it as touchable would make erasing something INSIDE a
// frame risk sweeping the frame itself away too -- the highest-blast-
// radius accident this tool could cause. Deleting a container stays a
// deliberate act (the frame's own Delete/Dissolve menu item).
// commit() below is never called -- this tool bypasses the "commit
// produces an artifact for placement" model entirely, since erasing
// destroys board state rather than creating any; it exists only to
// satisfy AtlasToolShape's own required shape.
export const eraserTool = {
  id: eraserIdentity.id,
  icon: TrashIcon,
  label: eraserIdentity.commandLabel,
  shortcutKey: eraserIdentity.shortcutKey,
  tray: 'quick',
  interaction: eraserIdentity.interaction,
  // Continuous tool, plain toggle-to-disarm -- never reads a lock flag.
  lockable: false,
  // Never persists an instance of its own (it destroys others'), so
  // there is nothing to resize and no node type renders it.
  resizable: false,
  boardNodeType: null,
  // No node type renders it at all -- always false, not N/A.
  dragBand: false,
  commit: (): null => null,
} as const satisfies AtlasToolShape

registerNoun(eraserTool)
