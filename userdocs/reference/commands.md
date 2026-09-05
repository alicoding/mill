# Commands

Press ⌘K and type any action's name — "lock vault", "check for
updates", "add a card" — and it runs from wherever you are.
Abbreviations work too: "gtw" finds "Go to Workflows". Every
user-facing action in Mill is a registered command, and the palette,
the Quick Panel, keyboard shortcuts, and Settings → Keyboard shortcuts
all read from the same list, so a command registered once shows up
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
| `atlas.contents.open` | Contents | — | atlas | Always available |
| `atlas.coverage` | Open coverage | — | atlas | Always available |
| `atlas.create.area` | Draw an area | — | atlas | Conditional — available only in a matching state |
| `atlas.create.card` | Add a card | — | atlas | Conditional — available only in a matching state |
| `atlas.create.image` | Add an image | — | atlas | Conditional — available only in a matching state |
| `atlas.create.note` | Add a note | — | atlas | Conditional — available only in a matching state |
| `atlas.create.table` | New table | — | atlas | Conditional — available only in a matching state |
| `atlas.delete.selection` | Delete selection | `⌫` | atlas | Always available |
| `atlas.escapeLadder` | Clear selection or go up a level | `ESCAPE` | atlas | Always available |
| `atlas.export` | Export atlas | — | atlas | Always available |
| `atlas.focusDirection` | Focus the nearest card in a direction | `⌥→` | atlas | Always available |
| `atlas.focusNext` | Focus next card | `TAB` | atlas | Always available |
| `atlas.focusPrevious` | Focus previous card | `⇧TAB` | atlas | Always available |
| `atlas.group.selection` | Group into a new area | `G` | atlas | Always available |
| `atlas.import` | Import atlas | — | atlas | Always available |
| `atlas.jump` | Jump to a card or object | `⌘K` | atlas | Always available |
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
| `capture.note` | Capture a note | — | Global | Always available |
| `clipboard.delete` | Delete | — | Global | Acts on the selected clipboard entry |
| `clipboard.history.open` | Clipboard history | — | Global | Always available |
| `clipboard.pin` | Pin | — | Global | Acts on the selected clipboard entry |
| `clipboard.unpin` | Unpin | — | Global | Acts on the selected clipboard entry |
| `codingLoop.run` | Run from clipboard… | — | Global | Always available |
| `configure.aiprovider.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.aiprovider.export` | Export | — | Global | Acts on the selected entity |
| `configure.aiprovider.reset` | Reset to shipped example | — | Global | Acts on the selected entity |
| `configure.conversionprofile.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.decision.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.decision.duplicate` | Duplicate | — | Global | Acts on the selected entity |
| `configure.decision.export` | Export | — | Global | Acts on the selected entity |
| `configure.decision.reset` | Reset to shipped example | — | Global | Acts on the selected entity |
| `configure.execenv.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.execenv.export` | Export | — | Global | Acts on the selected entity |
| `configure.execenv.reset` | Reset to shipped example | — | Global | Acts on the selected entity |
| `configure.list.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.list.export` | Export | — | Global | Acts on the selected entity |
| `configure.list.reset` | Reset to shipped example | — | Global | Acts on the selected entity |
| `configure.mcpserver.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.mcpserver.export` | Export | — | Global | Acts on the selected entity |
| `configure.mcpserver.listTools` | List tools | — | Global | Acts on the selected entity |
| `configure.mcpserver.reset` | Reset to shipped example | — | Global | Acts on the selected entity |
| `configure.new.aiproviders` | New AI provider | — | Global | Always available |
| `configure.new.conversionprofiles` | New conversion profile | — | Global | Always available |
| `configure.new.decisions` | New decision | — | Global | Always available |
| `configure.new.execenvs` | New environment | — | Global | Always available |
| `configure.new.integration` | New integration | — | Global | Always available |
| `configure.new.lists` | New list | — | Global | Always available |
| `configure.new.mcpservers` | New MCP server | — | Global | Always available |
| `configure.new.steptypes` | New step type | — | Global | Always available |
| `configure.request.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.request.edit` | Edit | — | Global | Acts on the selected entity |
| `configure.request.export` | Export | — | Global | Acts on the selected entity |
| `configure.request.reset` | Reset to shipped example | — | Global | Acts on the selected entity |
| `configure.secretsource.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.steptype.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.steptype.export` | Export | — | Global | Acts on the selected entity |
| `docs.search` | Search docs | — | Global | Always available |
| `edit.save` | Save | `⌘S` | Global | Conditional — available only in a matching state |
| `edit.saveAll` | Save all changes | — | Global | Conditional — available only in a matching state |
| `extensions.exportAudit` | Export plugin audit | — | Global | Always available |
| `help.openDataFolder` | Open data folder | — | Global | Always available |
| `help.reportIssue` | Report an issue… | — | Global | Always available |
| `help.shortcuts` | Keyboard shortcuts help | — | Global | Always available |
| `object.openInDefaultApp` | Open in default app | — | atlas | Always available |
| `object.rename` | Rename | — | atlas | Always available |
| `output.copy` | Copy output | — | Global | Conditional — available only in a matching state |
| `output.find` | Find in output | `⌘F` | Global | Conditional — available only in a matching state |
| `output.openFull` | Open output in full | — | Global | Conditional — available only in a matching state |
| `output.toggleWrap` | Wrap output lines | — | Global | Conditional — available only in a matching state |
| `palette.open` | Open command palette | `⌘K` | Global | Always available |
| `panel.applyClipboard` | Apply from clipboard | — | Global | Always available |
| `panel.open` | Open Quick Panel | — | Global | Conditional — available only in a matching state |
| `panel.openMill` | Open Mill | — | Global | Always available |
| `review.rules` | Guardrail rules | — | review | Always available |
| `run.continue` | Continue | — | Global | Acts on the selected run |
| `run.monitor` | Show run steps | — | Global | Acts on the selected run |
| `run.open` | Open run | — | Global | Acts on the selected run |
| `run.step` | Step | — | Global | Acts on the selected run |
| `run.stop` | Stop run | — | Global | Acts on the selected run |
| `runMonitor.open` | Run monitor | — | Global | Conditional — available only in a matching state |
| `secret.row.delete` | Delete | — | Global | Acts on the selected entity |
| `secret.row.edit` | Edit | — | Global | Acts on the selected entity |
| `secret.row.history` | History | — | Global | Acts on the selected entity |
| `secrets.lockVault` | Lock vault | — | Global | Conditional — available only in a matching state |
| `secrets.resetVault` | Start a new vault | — | Global | Conditional — available only in a matching state |
| `secrets.unlockVault` | Unlock vault | — | Global | Conditional — available only in a matching state |
| `settings.open` | Open Settings | `⌘,` | Global | Always available |
| `settings.open.appearance` | Settings › Appearance | — | Global | Always available |
| `settings.open.backups` | Settings › Backups | — | Global | Always available |
| `settings.open.connections` | Settings › Connections | — | Global | Always available |
| `settings.open.extensions` | Settings › Extensions | — | Global | Always available |
| `settings.open.general` | Settings › General | — | Global | Always available |
| `settings.open.notifications` | Settings › Notifications | — | Global | Always available |
| `settings.open.shortcuts` | Settings › Shortcuts | — | Global | Always available |
| `settings.open.updates` | Settings › Updates | — | Global | Always available |
| `tab.close` | Close tab | `⌘W` | Global | Conditional — available only in a matching state |
| `tab.closeAll` | Close all tabs | `⌘⇧W` | Global | Always available |
| `tab.closeOthers` | Close other tabs | `⌘⌥W` | Global | Conditional — available only in a matching state |
| `tab.next` | Next tab | `⌃TAB` | Global | Always available |
| `tab.prev` | Previous tab | `⌃⇧TAB` | Global | Always available |
| `update.check` | Check for updates | — | Global | Conditional — available only in a matching state |
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
| `workflow.edit` | Edit workflow | — | Global | Conditional — available only in a matching state |
| `workflow.new` | New workflow | `⌘N` | Global | Conditional — available only in a matching state |
| `workflow.open` | Open workflow | — | Global | Acts on the selected workflow |
| `workflow.pin` | Pin | — | Global | Acts on the selected workflow |
| `workflow.publish` | Publish current draft | — | composition | Conditional — available only in a matching state |
| `workflow.row.delete` | Delete | — | Global | Acts on the selected entity |
| `workflow.row.edit` | Edit | — | Global | Acts on the selected entity |
| `workflow.row.export` | Export | — | Global | Acts on the selected entity |
| `workflow.row.reset` | Reset to shipped example | — | Global | Acts on the selected entity |
| `workflow.run` | Run workflow | `⌘↩` | Global | Conditional — available only in a matching state |
| `workflow.runAndWatch` | Run and watch | — | Global | Acts on the selected workflow |
| `workflow.runStepped` | Run step by step | — | Global | Conditional — available only in a matching state |
| `workflow.save` | Save workflow | `⌘S` | Global | Conditional — available only in a matching state |
| `workflow.unpin` | Unpin | — | Global | Acts on the selected workflow |
| `workflow.view` | View workflow | — | Global | Conditional — available only in a matching state |

<!-- END GENERATED -->

See "Register a command" for how to add a new one, and Settings →
Keyboard shortcuts to rebind any command's default combo.
