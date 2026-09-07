---
kind: reference
---

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
| `atlas.addFile` | Add a file to the board | — | atlas | Always available |
| `atlas.addFromFolder` | Add cards from a folder | — | atlas | Always available |
| `atlas.arrange` | Auto-arrange | — | atlas | Conditional — available only in a matching state |
| `atlas.board.addCard` | Add card here | — | atlas | Acts on the board's current selection |
| `atlas.board.addNote` | Add note here | — | atlas | Acts on the board's current selection |
| `atlas.card.addLinkedCard` | Add linked card… | — | atlas | Acts on the board's current selection |
| `atlas.card.copyContext` | Copy card as context | — | atlas | Acts on the board's current selection |
| `atlas.card.copyLink` | Copy card link | — | atlas | Acts on the board's current selection |
| `atlas.card.dissolve` | Dissolve area | — | atlas | Acts on the board's current selection |
| `atlas.card.exportAs` | Export card as… | — | atlas | Conditional — available only in a matching state |
| `atlas.card.fitToContent` | Fit card to content | — | atlas | Acts on the board's current selection |
| `atlas.card.open` | Open card | — | atlas | Acts on the board's current selection |
| `atlas.card.openFile` | Open card file | — | atlas | Acts on the board's current selection |
| `atlas.card.refreshFromFolder` | Refresh area from folder | — | atlas | Acts on the board's current selection |
| `atlas.card.revealInFileManager` | Reveal card in file manager | — | atlas | Acts on the board's current selection |
| `atlas.card.zoomIn` | Zoom into card | — | atlas | Acts on the board's current selection |
| `atlas.companion.toggle` | Toggle companion panel | — | atlas | Always available |
| `atlas.contents.open` | Contents | — | atlas | Always available |
| `atlas.coverage` | Open coverage | — | atlas | Always available |
| `atlas.create.area` | Draw an area | — | atlas | Conditional — available only in a matching state |
| `atlas.create.card` | Add a card | — | atlas | Conditional — available only in a matching state |
| `atlas.create.image` | Add an image | — | atlas | Conditional — available only in a matching state |
| `atlas.create.note` | Add a note | — | atlas | Conditional — available only in a matching state |
| `atlas.create.table` | New table | — | atlas | Conditional — available only in a matching state |
| `atlas.delete.selection` | Delete selection | `⌫` | atlas | Acts on the board's current selection |
| `atlas.escapeLadder` | Clear selection or go up a level | `ESCAPE` | atlas | Always available |
| `atlas.export` | Export atlas | — | atlas | Always available |
| `atlas.export.drawio` | Export board as .drawio | — | atlas | Always available |
| `atlas.focusDirection` | Focus the nearest card in a direction | `⌥→` | atlas | Always available |
| `atlas.focusNext` | Focus next card | `TAB` | atlas | Always available |
| `atlas.focusPrevious` | Focus previous card | `⇧TAB` | atlas | Always available |
| `atlas.group.selection` | Group into a new area | `G` | atlas | Acts on the board's current selection |
| `atlas.import` | Import atlas | — | atlas | Always available |
| `atlas.json.copyKey` | Copy key | — | atlas | Acts on the selected tree row |
| `atlas.json.copyPath` | Copy path | — | atlas | Acts on the selected tree row |
| `atlas.json.copyValue` | Copy value | `⌘C` | atlas | Acts on the selected tree row |
| `atlas.jump` | Jump to a card or object | `⌘K` | atlas | Always available |
| `atlas.kinds.open` | Kinds | — | atlas | Always available |
| `atlas.link.editLabel` | Edit link label… | — | atlas | Acts on the board's current selection |
| `atlas.link.remove` | Remove link | — | atlas | Acts on the board's current selection |
| `atlas.link.setKind` | Change link kind | — | atlas | Acts on the board's current selection |
| `atlas.matrix` | Open traceability matrix | — | atlas | Always available |
| `atlas.minimap.toggle` | Toggle minimap | — | atlas | Always available |
| `atlas.note.open` | Open note | — | atlas | Acts on the board's current selection |
| `atlas.note.promote` | Promote note to card… | — | atlas | Acts on the board's current selection |
| `atlas.nudgeSelection` | Move the selected card | `→` | atlas | Always available |
| `atlas.object.pluginAction` | Extension action | — | atlas | Acts on the board's current selection |
| `atlas.object.promote` | Promote object to card… | — | atlas | Acts on the board's current selection |
| `atlas.openFocused` | Open or zoom the focused card | `↩` | atlas | Always available |
| `atlas.perspective` | Open perspective switcher | — | atlas | Always available |
| `atlas.redo` | Redo | — | atlas | Always available |
| `atlas.roadmap` | Open roadmap | — | atlas | Always available |
| `atlas.selectAll` | Select all | `⌘A` | atlas | Always available |
| `atlas.selection.addToPerspective` | Add to perspective | — | atlas | Acts on the board's current selection |
| `atlas.selection.copyAsImage` | Copy as image | — | atlas | Conditional — available only in a matching state |
| `atlas.selection.exportAsImage` | Export as image… | — | atlas | Conditional — available only in a matching state |
| `atlas.selection.removeFromPerspective` | Remove from perspective | — | atlas | Acts on the board's current selection |
| `atlas.share.copyContext` | Copy space as context | — | atlas | Always available |
| `atlas.share.copyLinks` | Copy space links | — | atlas | Always available |
| `atlas.space.delete` | Delete space | — | atlas | Acts on the board's current selection |
| `atlas.space.new` | New space… | — | atlas | Always available |
| `atlas.space.rename` | Rename space… | — | atlas | Acts on the board's current selection |
| `atlas.undo` | Undo | — | atlas | Always available |
| `atlas.up` | Go up one level | `⌘↑` | atlas | Always available |
| `backup.export` | Export everything | — | Global | Always available |
| `backup.now` | Back up now | — | Global | Always available |
| `browser.pair` | Pair a browser | — | Global | Always available |
| `browser.revealExtension` | Reveal the extension folder | — | Global | Always available |
| `browser.test` | Test the browser connection | — | Global | Conditional — available only in a matching state |
| `canvas.addNote` | Add note | — | Global | Acts on the item you clicked |
| `canvas.addStep` | Add step | — | Global | Acts on the item you clicked |
| `canvas.delete` | Delete selected | `⌫` | composition | Always available |
| `canvas.edge.delete` | Delete connection | — | Global | Acts on the item you clicked |
| `canvas.edge.select` | Select connection | — | Global | Acts on the item you clicked |
| `canvas.fitView` | Fit view | — | composition | Always available |
| `canvas.redo` | Redo | `⌘⇧Z` | composition | Always available |
| `canvas.step.delete` | Delete step | — | Global | Acts on the item you clicked |
| `canvas.step.openDetails` | Open step details | — | Global | Acts on the item you clicked |
| `canvas.undo` | Undo | `⌘Z` | composition | Always available |
| `canvas.zoomIn` | Zoom in | `⌘+` | composition | Always available |
| `canvas.zoomOut` | Zoom out | `⌘-` | composition | Always available |
| `capture.note` | Capture a note | — | Global | Always available |
| `clientcert.delete` | Delete certificate | — | Global | Acts on the selected entity |
| `clientcert.duplicate` | Duplicate certificate | — | Global | Acts on the selected entity |
| `clientcert.edit` | Edit certificate | — | Global | Acts on the selected entity |
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
| `configure.environment.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.environment.duplicate` | Duplicate | — | Global | Acts on the selected entity |
| `configure.environment.export` | Export | — | Global | Acts on the selected entity |
| `configure.environment.reset` | Reset to shipped example | — | Global | Acts on the selected entity |
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
| `configure.new.certificates` | New client certificate | — | Global | Always available |
| `configure.new.conversionprofiles` | New conversion profile | — | Global | Always available |
| `configure.new.decisions` | New decision | — | Global | Always available |
| `configure.new.environments` | New environment | — | Global | Always available |
| `configure.new.execenvs` | New execution environment | — | Global | Always available |
| `configure.new.integration` | New integration | — | Global | Always available |
| `configure.new.lists` | New list | — | Global | Always available |
| `configure.new.mcpservers` | New MCP server | — | Global | Always available |
| `configure.new.steptypes` | New step type | — | Global | Always available |
| `configure.open.aiproviders` | Configure › AI Providers | — | Global | Always available |
| `configure.open.attributes` | Configure › Attributes | — | Global | Always available |
| `configure.open.certificates` | Configure › Certificates | — | Global | Always available |
| `configure.open.conversionprofiles` | Configure › Conversion profiles | — | Global | Always available |
| `configure.open.decisions` | Configure › Decisions | — | Global | Always available |
| `configure.open.environments` | Configure › Environments | — | Global | Always available |
| `configure.open.execenvs` | Configure › Execution Environments | — | Global | Always available |
| `configure.open.integration` | Configure › Integrations | — | Global | Always available |
| `configure.open.lists` | Configure › Lists | — | Global | Always available |
| `configure.open.mcpservers` | Configure › MCP Servers | — | Global | Always available |
| `configure.open.steptypes` | Configure › Step types | — | Global | Always available |
| `configure.request.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.request.edit` | Edit | — | Global | Acts on the selected entity |
| `configure.request.export` | Export | — | Global | Acts on the selected entity |
| `configure.request.reset` | Reset to shipped example | — | Global | Acts on the selected entity |
| `configure.secretsource.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.steptype.delete` | Delete | — | Global | Acts on the selected entity |
| `configure.steptype.export` | Export | — | Global | Acts on the selected entity |
| `diagram.fit` | Fit diagram | — | atlas | Acts on the board's current selection |
| `diagram.nextPage` | Next page | — | atlas | Conditional — available only in a matching state |
| `diagram.previousPage` | Previous page | — | atlas | Conditional — available only in a matching state |
| `docs.search` | Search docs | — | Global | Always available |
| `edit.save` | Save | `⌘S` | Global | Conditional — available only in a matching state |
| `edit.saveAll` | Save all changes | — | Global | Conditional — available only in a matching state |
| `extension.addMcpServer` | Add to Configure | — | Global | Acts on the selected entity |
| `extension.checkUpdates` | Check for updates | — | Global | Acts on the selected entity |
| `extension.disable` | Turn off | — | Global | Acts on the selected entity |
| `extension.enable` | Turn on | — | Global | Acts on the selected entity |
| `extension.refreshSources` | Extensions: refresh sources | — | Global | Always available |
| `extension.remove` | Remove | — | Global | Acts on the selected entity |
| `extension.reveal` | Reveal folder | — | Global | Acts on the selected entity |
| `extension.update` | Update | — | Global | Acts on the selected entity |
| `extensions.checkUpdates` | Extensions: check for updates | — | Global | Always available |
| `extensions.exportAudit` | Export plugin audit | — | Global | Always available |
| `extensions.open` | Extensions | `⌘⇧X` | Global | Always available |
| `extensions.sources` | Extensions: marketplace sources | — | Global | Always available |
| `extensions.updateAll` | Extensions: update all | — | Global | Conditional — available only in a matching state |
| `guardrail.rule.delete` | Delete rule | — | Global | Acts on the selected entity |
| `guardrail.rule.edit` | Edit rule | — | Global | Acts on the selected entity |
| `help.openDataFolder` | Open data folder | — | Global | Always available |
| `help.reportIssue` | Report an issue… | — | Global | Always available |
| `help.shortcuts` | Keyboard shortcuts help | — | Global | Always available |
| `listGrid.addColumn` | Add a column | — | Global | Acts on the selected table rows |
| `listGrid.addRow` | Add a row | — | Global | Acts on the selected table rows |
| `listGrid.copyRows` | Copy selected rows | — | Global | Acts on the selected table rows |
| `listGrid.deleteColumn` | Delete selected column | — | Global | Acts on the selected table rows |
| `listGrid.deleteRows` | Delete selected rows | — | Global | Acts on the selected table rows |
| `listGrid.search` | Find in this list | `⌘F` | Global | Acts on the selected table rows |
| `object.editDiagram` | Edit diagram… | — | atlas | Acts on the board's current selection |
| `object.openInDefaultApp` | Open in default app | — | atlas | Acts on the board's current selection |
| `object.rename` | Rename | — | atlas | Acts on the board's current selection |
| `output.copy` | Copy output | — | Global | Conditional — available only in a matching state |
| `output.find` | Find in output | `⌘F` | Global | Conditional — available only in a matching state |
| `output.openFull` | Open output in full | — | Global | Conditional — available only in a matching state |
| `output.toggleWrap` | Wrap output lines | — | Global | Conditional — available only in a matching state |
| `palette.open` | Open command palette | `⌘K` | Global | Always available |
| `panel.applyClipboard` | Apply from clipboard | — | Global | Always available |
| `panel.open` | Open Quick Panel | — | Global | Conditional — available only in a matching state |
| `panel.openMill` | Open Mill | — | Global | Always available |
| `perspective.row.delete` | Delete perspective | — | Global | Acts on the selected entity |
| `perspective.row.rename` | Rename perspective | — | Global | Acts on the selected entity |
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
| `secrets.findDotenvFiles` | Find .env files… | — | Global | Always available |
| `secrets.lockVault` | Lock vault | — | Global | Conditional — available only in a matching state |
| `secrets.resetVault` | Start a new vault | — | Global | Conditional — available only in a matching state |
| `secrets.restoreVaultFromBackup` | Restore the last backup | — | Global | Conditional — available only in a matching state |
| `secrets.unlockVault` | Unlock vault | — | Global | Conditional — available only in a matching state |
| `settings.open` | Open Settings | `⌘,` | Global | Always available |
| `settings.open.appearance` | Settings › Appearance | — | Global | Always available |
| `settings.open.backups` | Settings › Backups | — | Global | Always available |
| `settings.open.connections` | Settings › Connections | — | Global | Always available |
| `settings.open.general` | Settings › General | — | Global | Always available |
| `settings.open.notifications` | Settings › Notifications | — | Global | Always available |
| `settings.open.security` | Settings › Security | — | Global | Always available |
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
