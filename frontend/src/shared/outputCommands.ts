import type { Command } from './commands'
import { focusedOutputViewer } from './outputFocusStore'
import { writeClipboardText } from './clipboardWrite'

// The output viewer's actions as registry commands (goal 0326,
// architecture.md: every user-facing action is a command with an honest
// enablement predicate). Each acts on the viewer that currently holds
// focus, so one command serves every output surface in the app rather
// than each panel growing its own handler.
//
// Enablement is what makes ⌘F safe to claim: with no output focused,
// every command below is unavailable, the keydown dispatcher skips the
// binding, and the browser's own find still works everywhere else.

export const OUTPUT_COMMANDS: Command[] = [
  {
    id: 'output.copy',
    label: 'commands.output.copy',
    keywords: ['copy output', 'copy result'],
    defaultBinding: null,
    paletteHidden: true,
    enabled: () => focusedOutputViewer() !== null,
    run: () => {
      const handle = focusedOutputViewer()
      if (handle) void writeClipboardText(handle.copyText())
    },
  },
  {
    id: 'output.find',
    label: 'commands.output.find',
    keywords: ['find in output', 'search output'],
    defaultBinding: { mods: ['cmd'], key: 'F' },
    paletteHidden: true,
    enabled: () => focusedOutputViewer() !== null,
    run: () => focusedOutputViewer()?.toggleFind(),
  },
  {
    id: 'output.toggleWrap',
    label: 'commands.output.toggleWrap',
    keywords: ['wrap lines'],
    defaultBinding: null,
    paletteHidden: true,
    enabled: () => focusedOutputViewer()?.toggleWrap !== undefined,
    run: () => focusedOutputViewer()?.toggleWrap?.(),
  },
  {
    id: 'output.openFull',
    label: 'commands.output.openFull',
    keywords: ['open output', 'full output'],
    defaultBinding: null,
    paletteHidden: true,
    enabled: () => focusedOutputViewer()?.openFull !== undefined,
    run: () => focusedOutputViewer()?.openFull?.(),
  },
]
