import type { Command } from './commands'
import { useUISignalStore } from './uiSignalStore'
import { soleObject } from './atlasSelectionShape'

// A diagram board object's own paging/fit actions (goal 0354), split out
// of shared/atlasBoardCommands.ts (CLAUDE.md's 500-line convention) --
// spread into that file's own ATLAS_BOARD_COMMANDS array at the same
// position, so the registry's overall order is unchanged.

// The board's currently selected DIAGRAM object, read from the live
// canvas the same way atlasBoardCommands.ts's own atlasBoardHasContent
// reads it -- the node's own data-id IS the object id
// (atlasBuildBoardObjectNodes.ts). The paging commands' band buttons
// run them bare (no ctx), so they read this DOM state directly rather
// than the selection context diagram.fit and the object menu use.
function selectedDiagramObjectID(): string | null {
  if (typeof document === 'undefined') return null
  const face = document.querySelector('.react-flow__node.selected [data-object-kind="diagram"]')
  return face?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
}

// The selected diagram's own page cursor, published by the frame on the
// object's box (AtlasBoardObjectNode.tsx) exactly while its band shows
// the control -- absent for a single-page file, which is what makes
// both paging commands honestly unavailable there.
function selectedDiagramPage(): { id: string; index: number; count: number } | null {
  const id = selectedDiagramObjectID()
  if (id === null) return null
  const face = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"] [data-object-kind="diagram"]`)
  const index = Number(face?.getAttribute('data-page-index') ?? NaN)
  const count = Number(face?.getAttribute('data-page-count') ?? NaN)
  if (!Number.isFinite(index) || !Number.isFinite(count)) return null
  return { id, index, count }
}

export const ATLAS_DIAGRAM_COMMANDS: Command[] = [
  {
    // "Previous page" / "Next page" (goal 0354): a multi-page .drawio is
    // paged from the object's own chrome now that its face carries no
    // vendored toolbar. Both stop at the file's ends rather than
    // wrapping, so the enablement is the honest one -- unavailable, not
    // dimmed, on a single-page file or at the page you are already on.
    // No default binding: ⌥←/⌥→ already move the caret by word in every
    // text field on this surface, and a board shortcut that only ever
    // applies to one selected kind is not worth that collision.
    id: 'diagram.previousPage',
    label: 'commands.diagram.previousPage',
    defaultBinding: null,
    surface: ['atlas'],
    enabled: () => {
      const page = selectedDiagramPage()
      return page !== null && page.count > 1 && page.index > 0
    },
    run: () => {
      const page = selectedDiagramPage()
      if (page) useUISignalStore.getState().requestAtlasDiagramPage(page.id, -1)
    },
  },
  {
    id: 'diagram.nextPage',
    label: 'commands.diagram.nextPage',
    defaultBinding: null,
    surface: ['atlas'],
    enabled: () => {
      const page = selectedDiagramPage()
      return page !== null && page.count > 1 && page.index < page.count - 1
    },
    run: () => {
      const page = selectedDiagramPage()
      if (page) useUISignalStore.getState().requestAtlasDiagramPage(page.id, 1)
    },
  },
  {
    // "Fit diagram" (goal 0354): a diagram board object shows no
    // vendored toolbar, so its zoom-to-fit is the object's own action --
    // on the palette, and on the object's menu beside the full-editor
    // door, over the selection like every other object command (goal
    // 0346 slice B). The run bumps the signal the frame holding that
    // object's live viewer watches, which calls the viewer's own
    // graph.fit() (atlas/drawioInteraction.ts) rather than a second
    // geometry.
    id: 'diagram.fit',
    label: 'commands.diagram.fit',
    defaultBinding: null,
    surface: ['atlas'],
    needs: 'selection',
    enabled: (ctx) => soleObject(ctx)?.fitDiagram === true,
    run: (ctx) => {
      const object = soleObject(ctx)
      if (object) useUISignalStore.getState().requestAtlasDiagramFit(object.id)
    },
  },
]
