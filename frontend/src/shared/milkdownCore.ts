import { Crepe } from '@milkdown/crepe'
// Structural layout only (flex/spacing/box-model) -- every color/font/
// shadow value it references is a `--crepe-*` custom property, left
// unset here and supplied by MilkdownEditor.module.css's own Primer-
// token mapping (frontend.md: Primer tokens only, no hand-picked
// hex). Verified against the installed package: only ai.css/diff.css
// (both unused -- the AI feature stays off, see the note below) carry
// any literal color.
import '@milkdown/crepe/theme/common/style.css'
import { $remark } from '@milkdown/utils'
import { tooltipFactory, TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import { commandsCtx } from '@milkdown/kit/core'
import {
  isMarkSelectedCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  strongSchema,
  emphasisSchema,
  inlineCodeSchema,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand, strikethroughSchema } from '@milkdown/kit/preset/gfm'
import type { EditorView } from '@milkdown/kit/prose/view'

// The Milkdown machinery behind shared/MilkdownEditor.tsx -- reachable
// only through that component's dynamic import (goal 0244 S3), so the
// ProseMirror/remark tree stays inside this module's own lazy chunk
// rather than the eagerly-loaded main bundle. Re-exports Crepe so the
// door component never imports @milkdown/crepe itself.
export { Crepe }

// The canvas-note trim (ADR-0046, goal 0244 S3's converged-pattern
// verdict, goal 0247's chrome-removal pass): inline formatting + lists
// + checkboxes stay, the block-tree editor's own signature features
// (slash-command menu, tables, LaTeX, the CodeMirror code-block
// widget's language picker/copy button/gutter, drag-handle block
// reorder) don't fit a short sticky and are cut. AI stays off by
// construction -- Crepe.Feature.AI defaults to false and is never
// listed here, so its llm-providers code path is never reachable
// (CLAUDE.md's no-AI-API-calls constraint).
export const NOTE_FEATURES = {
  [Crepe.Feature.Table]: false,
  [Crepe.Feature.Latex]: false,
  [Crepe.Feature.BlockEdit]: false,
  [Crepe.Feature.CodeMirror]: false,
  // Crepe's own selection toolbar is replaced by Mill's floating one
  // (goal 0253, attachSelectionToolbar below) -- Crepe mounts its
  // toolbar inside the editor node, where a canvas note clips it.
  [Crepe.Feature.Toolbar]: false,
}

// Disables CommonMark's INDENTED code block construct (a bare line
// starting with 4 spaces/a tab) via micromark's own documented
// `disable` mechanism -- Milkdown's public `$remark` extension point,
// not a hand-rolled parser. A short canvas note has no code-block
// affordance (CodeMirror feature is off above); left enabled, any
// incidental leading whitespace on a line -- including 4 literal
// spaces Milkdown's own always-on Tab-indent shortcut inserts at a
// paragraph/heading start -- silently swallows that ENTIRE line into
// a code block on next parse, hiding real content (e.g. "# ddka"
// stored with a leading tab renders as an opaque code block instead
// of the heading "ddka" the user typed). Fenced code (```) is a
// different construct and is unaffected -- it still parses (as a
// plain node once the CodeMirror feature above is off; see the
// commonmark preset's own toDOM fallback).
export const disableIndentedCodeBlock = $remark('disableIndentedCodeBlock', () => {
  return function attach(this: { data: (key?: string) => unknown }) {
    const processorData = this.data() as { micromarkExtensions?: unknown[] }
    const extensions = (processorData.micromarkExtensions ??= [])
    extensions.push({ disable: { null: ['codeIndented'] } })
  }
})

// --- The selection toolbar (goal 0253) ---
//
// Crepe's own toolbar feature is OFF (NOTE_FEATURES below): it mounts
// its content through TooltipProvider's default parent -- inside the
// editor's own node -- where a canvas note clips it, the board's zoom
// transform shrinks it, and floating-ui misplaces it (absolute
// positioning inside a transformed ancestor). Its config exposes no
// mount point, so Mill registers its OWN selection toolbar through the
// same kit primitives, with the provider's documented `root:
// document.body` -- body is untransformed, so the toolbar floats at UI
// scale beside the selection regardless of board zoom, and nothing
// ever clips it. The toolbar CONTENT stays framework-owned: the host
// (MilkdownEditor.tsx) portals Mill's React buttons into `contentEl`;
// this module only owns registration, positioning, active-mark state,
// and the command calls.

export type SelectionToolbarAction = 'bold' | 'italic' | 'strikethrough' | 'code'

export interface SelectionToolbarState {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  code: boolean
}

export interface SelectionToolbarHandle {
  // The floating element Mill's React toolbar portals into. Appended
  // to document.body by the provider on first update; removed on
  // destroy.
  contentEl: HTMLElement
  run: (action: SelectionToolbarAction) => void
  onState: (cb: (state: SelectionToolbarState) => void) => void
  destroy: () => void
}

const millSelectionToolbar = tooltipFactory('MILL_SELECTION_TOOLBAR')

// attachSelectionToolbar wires the tooltip plugin onto a Crepe editor.
// Must run BEFORE crepe.create() (plugins register at create); the
// returned handle stays valid for the editor's whole life.
export function attachSelectionToolbar(crepe: Crepe, className: string): SelectionToolbarHandle {
  const contentEl = document.createElement('div')
  contentEl.className = className
  contentEl.dataset.testid = 'milkdown-selection-toolbar'
  // The marker outside-press commit listeners key on (goal 0253): the
  // toolbar floats at body level, OUTSIDE any editor wrapper, yet a
  // press on it is part of the edit session -- hosts exclude
  // [data-milkdown-selection-toolbar] from their own commit-on-
  // outside-press logic (AtlasStickyNode's document listener).
  contentEl.setAttribute('data-milkdown-selection-toolbar', '')
  let stateCb: ((state: SelectionToolbarState) => void) | null = null
  let provider: TooltipProvider | null = null

  const readState = (): SelectionToolbarState =>
    crepe.editor.action((ctx) => {
      const commands = ctx.get(commandsCtx)
      return {
        bold: commands.call(isMarkSelectedCommand.key, strongSchema.type(ctx)),
        italic: commands.call(isMarkSelectedCommand.key, emphasisSchema.type(ctx)),
        strikethrough: commands.call(isMarkSelectedCommand.key, strikethroughSchema.type(ctx)),
        code: commands.call(isMarkSelectedCommand.key, inlineCodeSchema.type(ctx)),
      }
    })

  class MillToolbarView {
    constructor(view: EditorView) {
      provider = new TooltipProvider({
        content: contentEl,
        root: document.body,
        debounce: 20,
        offset: 8,
      })
      provider.onShow = () => stateCb?.(readState())
      this.update(view)
    }

    update = (view: EditorView, prevState?: Parameters<TooltipProvider['update']>[1]) => {
      provider?.update(view, prevState)
      if (contentEl.dataset.show === 'true') stateCb?.(readState())
    }

    destroy = () => {
      provider?.destroy()
      contentEl.remove()
    }
  }

  crepe.editor.use(millSelectionToolbar)
  crepe.editor.config((ctx) => {
    ctx.set(millSelectionToolbar.key, {
      view: (view: EditorView) => new MillToolbarView(view),
    })
  })

  const COMMANDS = {
    bold: toggleStrongCommand,
    italic: toggleEmphasisCommand,
    strikethrough: toggleStrikethroughCommand,
    code: toggleInlineCodeCommand,
  } as const

  return {
    contentEl,
    run: (action) => {
      crepe.editor.action((ctx) => {
        ctx.get(commandsCtx).call(COMMANDS[action].key)
      })
      stateCb?.(readState())
    },
    onState: (cb) => {
      stateCb = cb
    },
    destroy: () => {
      provider?.destroy()
      contentEl.remove()
    },
  }
}
