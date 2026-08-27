import { TrashIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import { pointHitIDs } from '../atlasEnclosure'
import { AtlasEraserLiveTrail } from '../AtlasEraserLiveTrail'

const eraserIdentity = identityOf('eraser')

// Eraser (goal 0169 slice 4): drag-to-erase's own proof. Whole-element
// only -- never a partial/pixel erase (the converged default this
// goal's own research recorded: pixel-erase is contested even
// upstream). Deletion is NOT unrecoverable: it never calls
// AtlasService directly at all -- this tool's own gesture.onEnd hands its
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
  // The freehand-marking family (goal 0224's disposition table) --
  // collapsed into the tray's one Annotate group.
  group: 'annotate',
  interaction: eraserIdentity.interaction,
  // Continuous tool, plain toggle-to-disarm -- never reads a lock flag.
  lockable: false,
  // Never persists an instance of its own (it destroys others'), so
  // there is nothing to resize and no node type renders it.
  resizable: false,
  boardNodeType: null,
  // No node type renders it at all -- always false, not N/A.
  dragBand: false,
  // No boardObjectKind means no content registration reads this at
  // all -- always false, not N/A.
  fileBacked: false,
  // Persists nothing of its own -- always null, not N/A.
  boardObjectKind: null,
  content: null,
  // No style surface of its own (goal 0209) -- always empty, not
  // omitted.
  styleFields: [],
  // Continuous tool, plain toggle-to-disarm -- never reads a lock flag;
  // erasing is naturally a multi-pass action.
  sticky: true,
  gesture: {
    // Live hit-testing (goal 0169 slice 4): every accumulated point
    // -- including the very first, at pointerdown, so a stationary
    // click-erase over a single card works with zero drag distance --
    // hit-tests against TOP-LEVEL LEAF boxes only (containers excluded:
    // a frame's own bounds cover its whole child area, so treating it
    // as touchable would risk sweeping the frame itself away). Never
    // gated by a distance threshold -- an eraser pass's own guard is
    // "did we touch anything", not how far the pointer travelled.
    onPoint: (pt, ctx) => {
      const flow = ctx.screenToFlowPosition(pt)
      for (const id of pointHitIDs(flow, ctx.cardBoxes.filter((b) => !b.isFrame))) ctx.hitAccumulator.cardIDs.add(id)
      for (const id of pointHitIDs(flow, ctx.noteBoxes)) ctx.hitAccumulator.noteIDs.add(id)
      // Board objects (ink/shape/image/table/diagram, goal 0230): the
      // same top-level leaf hit-test cards/notes already get -- an
      // erasable kind never gets a bespoke pass of its own.
      for (const id of pointHitIDs(flow, ctx.objectBoxes)) ctx.hitAccumulator.objectIDs.add(id)
    },
    // Hands the WHOLE accumulated hit set to onDeleteSelection in ONE
    // call (never incrementally during the drag) -- the same door the
    // selection tray's own Delete key uses, so erasing rides goal
    // 0093's quick-delete-WITH-UNDO guard (a 10s toast + Cmd-Z) rather
    // than a bespoke pipeline, and produces exactly one undo toast per
    // pass instead of each touched element overwriting the last one's.
    onEnd: (_points, ctx) => {
      const cardIDs = [...ctx.hitAccumulator.cardIDs]
      const noteIDs = [...ctx.hitAccumulator.noteIDs]
      const objectIDs = [...ctx.hitAccumulator.objectIDs]
      if (cardIDs.length + noteIDs.length + objectIDs.length === 0) return
      ctx.onDeleteSelection(cardIDs, noteIDs, objectIDs)
    },
    preview: AtlasEraserLiveTrail,
  },
  commit: (): null => null,
} as const satisfies AtlasToolShape

registerNoun(eraserTool)
