# Commands

Every user-facing action in Mill — a menu item, a toolbar button, a
keyboard shortcut — is a registered command. The command palette (⌘K),
the Quick Panel, keyboard shortcuts, and Settings → Keyboard shortcuts
all read from this one list, so a command registered once shows up
everywhere it applies automatically.

Each command has a stable `id`, a label shown in the palette and
Settings, an optional default keyboard binding, an optional surface
scope (some commands only apply on one view, like Atlas), and an
optional enablement rule (some commands are only available in a
matching app state — an open workflow tab, an unlocked vault). A
command with no listed binding still works from the palette and Quick
Panel; it just has no keyboard shortcut by default. "Conditional"
enablement means the command is hidden from the palette entirely,
rather than shown disabled, whenever its state doesn't currently apply.

<!-- BEGIN GENERATED: command registry (source: frontend/src/shared/commandsDeclaration.json) -->

| ID | Label | Default binding | Surface | Enablement |
|---|---|---|---|---|
| `atlas.addFromFolder` | Add cards from a folder | — | atlas | Always available |
| `atlas.arrange` | Auto-arrange | — | atlas | Always available |
| `atlas.card.exportAs` | Export card as… | — | atlas | Always available |
| `atlas.companion.toggle` | Toggle companion panel | — | atlas | Always available |
| `atlas.coverage` | Open coverage | — | atlas | Always available |
| `atlas.create.area` | Draw an area | — | atlas | Always available |
| `atlas.create.card` | Add a card | — | atlas | Always available |
| `atlas.create.eraser` | Erase things on the board | — | atlas | Always available |
| `atlas.create.image` | Add an image | — | atlas | Always available |
| `atlas.create.laser` | Point with the laser | — | atlas | Always available |
| `atlas.create.note` | Add a note | — | atlas | Always available |
| `atlas.create.pencil` | Draw with the pencil | — | atlas | Always available |
| `atlas.create.shape` | Draw a shape | — | atlas | Always available |
| `atlas.create.table` | New table | — | atlas | Always available |
| `atlas.delete.selection` | Delete selection | `⌫` | atlas | Always available |
| `atlas.escapeLadder` | Clear selection or go up a level | `ESCAPE` | atlas | Always available |
| `atlas.export` | Export atlas | — | atlas | Always available |
| `atlas.focusDirection` | Focus the nearest card in a direction | `⌥→` | atlas | Always available |
| `atlas.focusNext` | Focus next card | `TAB` | atlas | Always available |
| `atlas.focusPrevious` | Focus previous card | `⇧TAB` | atlas | Always available |
| `atlas.group.selection` | Group into a new area | `G` | atlas | Always available |
| `atlas.import` | Import atlas | — | atlas | Always available |
| `atlas.jump` | Jump to a card | `⌘K` | atlas | Always available |
| `atlas.matrix` | Open traceability matrix | — | atlas | Always available |
| `atlas.minimap.toggle` | Toggle minimap | — | atlas | Always available |
| `atlas.nudgeSelection` | Move the selected card | `→` | atlas | Always available |
| `atlas.openFocused` | Open or zoom the focused card | `↩` | atlas | Always available |
| `atlas.perspective` | Open perspective switcher | — | atlas | Always available |
| `atlas.redo` | Redo | — | atlas | Always available |
| `atlas.roadmap` | Open roadmap | — | atlas | Always available |
| `atlas.selectAll` | Select all | `⌘A` | atlas | Always available |
| `atlas.share.copyContext` | Copy space as context | — | atlas | Always available |
| `atlas.share.copyLinks` | Copy space links | — | atlas | Always available |
| `atlas.undo` | Undo | — | atlas | Always available |
| `atlas.up` | Go up one level | `⌘↑` | atlas | Always available |
| `backup.export` | Export everything | — | Global | Always available |
| `backup.now` | Back up now | — | Global | Always available |
| `canvas.delete` | Delete selected | `⌫` | composition | Always available |
| `canvas.fitView` | Fit view | — | composition | Always available |
| `canvas.redo` | Redo | `⌘⇧Z` | composition | Always available |
| `canvas.undo` | Undo | `⌘Z` | composition | Always available |
| `canvas.zoomIn` | Zoom in | `⌘+` | composition | Always available |
| `canvas.zoomOut` | Zoom out | `⌘-` | composition | Always available |
| `configure.new.aiproviders` | New AI provider | — | Global | Always available |
| `configure.new.decisions` | New decision | — | Global | Always available |
| `configure.new.execenvs` | New environment | — | Global | Always available |
| `configure.new.integration` | New integration | — | Global | Always available |
| `configure.new.lists` | New list | — | Global | Always available |
| `configure.new.mcpservers` | New MCP server | — | Global | Always available |
| `configure.new.steptypes` | New step type | — | Global | Always available |
| `help.shortcuts` | Keyboard shortcuts help | — | Global | Always available |
| `object.openInDefaultApp` | Open in default app | — | atlas | Always available |
| `palette.open` | Open command palette | `⌘K` | Global | Always available |
| `panel.applyClipboard` | Apply from clipboard | — | Global | Always available |
| `panel.openMill` | Open Mill | — | Global | Always available |
| `review.rules` | Guardrail rules | — | review | Always available |
| `secrets.lockVault` | Lock vault | — | Global | Conditional — available only in a matching state |
| `secrets.unlockVault` | Unlock vault | — | Global | Conditional — available only in a matching state |
| `settings.open` | Open Settings | `⌘,` | Global | Always available |
| `settings.open.appearance` | Open Settings → Appearance | — | Global | Always available |
| `settings.open.backups` | Open Settings → Backups | — | Global | Always available |
| `settings.open.contract` | Open Settings → Contract | — | Global | Always available |
| `settings.open.general` | Open Settings → General | — | Global | Always available |
| `settings.open.global-hotkey` | Open Settings → Global hotkey | — | Global | Always available |
| `settings.open.keyboard-shortcuts` | Open Settings → Keyboard Shortcuts | — | Global | Always available |
| `settings.open.mcp-access` | Open Settings → MCP access | — | Global | Always available |
| `settings.open.notifications` | Open Settings → Notifications | — | Global | Always available |
| `settings.open.remote-access` | Open Settings → Remote access | — | Global | Always available |
| `settings.open.updates` | Open Settings → Updates | — | Global | Always available |
| `tab.close` | Close tab | `⌘W` | Global | Conditional — available only in a matching state |
| `tab.closeAll` | Close all tabs | `⌘⇧W` | Global | Always available |
| `tab.closeOthers` | Close other tabs | `⌘⌥W` | Global | Conditional — available only in a matching state |
| `tab.next` | Next tab | `⌃TAB` | Global | Always available |
| `tab.prev` | Previous tab | `⌃⇧TAB` | Global | Always available |
| `update.check` | Check for updates | — | Global | Always available |
| `update.downloadAndInstall` | Download the update and install | — | Global | Conditional — available only in a matching state |
| `update.relaunch` | Restart to finish updating | — | Global | Conditional — available only in a matching state |
| `update.trustSigning` | Trust Mill's signing | — | Global | Always available |
| `update.whatsNew` | What's new | — | Global | Always available |
| `view.activity` | Go to Activity | `⌘4` | Global | Always available |
| `view.atlas` | Go to Atlas | `⌘3` | Global | Always available |
| `view.composition` | Go to Workflows | `⌘1` | Global | Always available |
| `view.configure` | Go to Configure | `⌘2` | Global | Always available |
| `view.docs` | Open docs | — | Global | Always available |
| `view.home` | Go to Home | `⌘0` | Global | Always available |
| `view.review` | Go to Review | `⌘5` | Global | Always available |
| `view.secrets` | Go to Secrets | `⌘6` | Global | Always available |
| `workflow.new` | New workflow | `⌘N` | Global | Conditional — available only in a matching state |
| `workflow.publish` | Publish current draft | — | composition | Conditional — available only in a matching state |
| `workflow.run` | Run workflow | `⌘↩` | Global | Conditional — available only in a matching state |
| `workflow.save` | Save workflow | `⌘S` | Global | Conditional — available only in a matching state |

<!-- END GENERATED -->

See "Register a command" for how to add a new one, and Settings →
Keyboard shortcuts to rebind any command's default combo.
