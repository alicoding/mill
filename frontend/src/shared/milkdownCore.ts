import { Crepe } from '@milkdown/crepe'
// Structural layout only (flex/spacing/box-model) -- every color/font/
// shadow value it references is a `--crepe-*` custom property, left
// unset here and supplied by MilkdownEditor.module.css's own Primer-
// token mapping (frontend.md: Primer tokens only, no hand-picked
// hex). Verified against the installed package: only ai.css/diff.css
// (both unused -- the AI feature stays off, see the note below) carry
// any literal color.
import '@milkdown/crepe/theme/common/style.css'
import { $inputRule, $remark } from '@milkdown/utils'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { findWrapping } from '@milkdown/kit/prose/transform'
import { splitListItem } from '@milkdown/kit/prose/schema-list'
import { tooltipFactory, TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import { commandsCtx, editorViewOptionsCtx } from '@milkdown/kit/core'
import {
  isMarkSelectedCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  strongSchema,
  emphasisSchema,
  inlineCodeSchema,
  bulletListSchema,
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

// Typing `[] `, `[ ] `, or `[x] ` at the START of a plain paragraph
// creates a to-do (goal 0254) -- the converged line-start convention
// of the WYSIWYG family this editor adopted into. The engine's OWN
// task rule (preset-gfm's wrapInTaskListInputRule) deliberately only
// fires INSIDE an existing list item; this rule owns exactly the
// complementary case and bails inside a list item, so one keystroke
// can never match both. Registered through $inputRule, the same
// extension seam disableIndentedCodeBlock uses.
export const taskAtLineStart = $inputRule((ctx) => {
  return new InputRule(/^\[(?<checked>[xX ])?\]\s$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start)
    if ($start.parent.type.name !== 'paragraph') return null
    const checked = (match.groups?.checked ?? '').toLowerCase() === 'x'
    if ($start.depth >= 2 && $start.node(-1).type.name === 'list_item') {
      // Inside a list item the stock rule runs first and handles the
      // plain-bullet case; it structurally can't handle `[] ` (its
      // regex requires a character between the brackets) or an item
      // that is ALREADY a to-do (it refuses checked != null -- and
      // Enter-continuation inherits the previous item's checked
      // state, so re-marking is the everyday follow-up-line case).
      const li = $start.node(-1)
      const tr = state.tr.deleteRange(start, end)
      tr.setNodeMarkup($start.before($start.depth - 1), undefined, { ...li.attrs, checked })
      return tr.scrollIntoView()
    }
    const tr = state.tr.deleteRange(start, end)
    const range = tr.doc.resolve(start).blockRange()
    if (!range) return null
    const wrapping = findWrapping(range, bulletListSchema.type(ctx))
    if (!wrapping) return null
    tr.wrap(range, wrapping)
    // The wrap inserted `wrapping.length` opening tokens before the
    // paragraph; the freshly-created list item sits one position
    // inside the outermost wrapper.
    const liPos = range.start + wrapping.length - 1
    const li = tr.doc.nodeAt(liPos)
    if (!li || li.type.name !== 'list_item') return null
    tr.setNodeMarkup(liPos, undefined, { ...li.attrs, checked })
    return tr.scrollIntoView()
  })
})

// Pressing Enter at the end of a CHECKED to-do continues with another
// CHECKED one -- the engine's list split copies the item's attrs,
// where every converged to-do surface starts the next item unchecked.
// Intercepted at the VIEW level (editorViewOptionsCtx's direct props
// run before every plugin keymap) so the new item is BORN unchecked
// in the split's own single transaction -- a post-split attr flip was
// measured live to remount the item's checkbox widget under the caret
// and drop in-flight keystrokes, so the state must never change after
// the item mounts. Enter on an EMPTY to-do falls through to the
// default (exit the list), and modified Enters are untouched.
export function configureTaskEnter(crepe: Crepe): void {
  crepe.editor.config((ctx) => {
    ctx.update(editorViewOptionsCtx, (prev) => ({
      ...prev,
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const { $from } = view.state.selection
          if ($from.depth >= 2) {
            const li = $from.node(-1)
            if (li.type.name === 'list_item' && li.attrs.checked === true && li.textContent !== '') {
              if (splitListItem(li.type, { ...li.attrs, checked: false })(view.state, view.dispatch)) return true
            }
          }
        }
        const prevHandler = prev.handleKeyDown
        return typeof prevHandler === 'function' ? (prevHandler.call(view, view, event) ?? false) : false
      },
    }))
  })
}

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

// Re-exported through this lazy core module so @codemirror/* stays out
// of every eager import graph that reaches MilkdownEditor (goal 0268).
export { codeBlockFormatKeymap } from './codeBlockFormat'
