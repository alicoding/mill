---
kind: reference
---

# Menu bar

Every menu in Mill's menu bar is built from the same list of actions
the command palette reads. An action registered once shows up in the
palette, in Settings → Keyboard shortcuts, and — if it has a menu seat
— in the menu bar, all describing the same thing.

Items that appear dimmed are actions that do not apply right now: Save
needs an open workflow, the Atlas menu needs the Atlas view. A dimmed
item's keyboard shortcut does nothing either, so a shortcut that only
makes sense on one view stays quiet everywhere else.

Standard items — About, Services, Hide, Quit, the whole Edit menu,
zoom, Minimize — are macOS's own. They behave the way they do in every
other Mac app, and macOS shows them in your language.

Reload, Force Reload and Open Developer Tools live in **Help →
Developer**, out of the way of everyday use.

Shortcuts listed here are the shipped defaults. Rebind any of them in
Settings → Keyboard shortcuts, and the menu updates to match.

<!-- BEGIN GENERATED: menu bar (source: frontend/src/shared/menuDeclaration.json) -->

### Mill

| Item | Shortcut | Command |
|---|---|---|
| About Mill | — | Provided by macOS |
| Check for updates… | — | `update.check` |
| Settings… | ⌘, | `settings.open` |
| Back up now | — | `backup.now` |
| Services | — | Provided by macOS |
| Hide Mill | — | Provided by macOS |
| Hide Others | — | Provided by macOS |
| Show All | — | Provided by macOS |
| Quit Mill | — | Provided by macOS |

### File

| Item | Shortcut | Command |
|---|---|---|
| New workflow | ⌘N | `workflow.new` |
| New note | — | `capture.note` |

### File > New…

| Item | Shortcut | Command |
|---|---|---|
| New integration | — | `configure.new.integration` |
| New list | — | `configure.new.lists` |
| New MCP server | — | `configure.new.mcpservers` |
| New decision | — | `configure.new.decisions` |
| New execution environment | — | `configure.new.execenvs` |
| New environment | — | `configure.new.environments` |
| New AI provider | — | `configure.new.aiproviders` |
| New client certificate | — | `configure.new.certificates` |
| New conversion profile | — | `configure.new.conversionprofiles` |
| New step type | — | `configure.new.steptypes` |

### File

| Item | Shortcut | Command |
|---|---|---|
| Close tab | ⌘W | `tab.close` |
| Close other tabs | ⌘⌥W | `tab.closeOthers` |
| Close all tabs | ⌘⇧W | `tab.closeAll` |
| Save | ⌘S | `workflow.save` |
| Export everything | — | `backup.export` |
| Export plugin audit | — | `extensions.exportAudit` |
| Lock vault | — | `secrets.lockVault` |

### Edit

| Item | Shortcut | Command |
|---|---|---|
| Undo, Redo, Cut, Copy, Paste, Select All, Speech | — | Provided by macOS |

### View

| Item | Shortcut | Command |
|---|---|---|
| Home | ⌘0 | `view.home` |
| Workflows | ⌘1 | `view.composition` |
| Configure | ⌘2 | `view.configure` |
| Atlas | ⌘3 | `view.atlas` |
| Activity | ⌘4 | `view.activity` |
| Review | ⌘5 | `view.review` |
| Review rules | — | `review.rules` |
| Secrets | ⌘6 | `view.secrets` |
| Extensions | ⌘⇧X | `extensions.open` |
| Docs | — | `view.docs` |
| Command palette | ⌘K | `palette.open` |
| Next tab | ⌃TAB | `tab.next` |
| Previous tab | ⌃⇧TAB | `tab.prev` |
| Clipboard history | — | `clipboard.history.open` |
| Actual Size | — | Provided by macOS |
| Zoom In | — | Provided by macOS |
| Zoom Out | — | Provided by macOS |
| Enter Full Screen | — | Provided by macOS |

### Workflow

| Item | Shortcut | Command |
|---|---|---|
| Run workflow | ⌘↩ | `workflow.run` |
| Run step by step | — | `workflow.runStepped` |
| Run from clipboard… | — | `codingLoop.run` |
| View workflow | — | `workflow.view` |
| Edit workflow | — | `workflow.edit` |
| Save | ⌘S | `edit.save` |
| Save all changes | — | `edit.saveAll` |
| Undo | ⌘Z | `canvas.undo` |
| Redo | ⌘⇧Z | `canvas.redo` |
| Delete selected | ⌫ | `canvas.delete` |
| Zoom in | ⌘+ | `canvas.zoomIn` |
| Zoom out | ⌘- | `canvas.zoomOut` |
| Fit view | — | `canvas.fitView` |
| Publish current draft | — | `workflow.publish` |

### Atlas

| Item | Shortcut | Command |
|---|---|---|
| Go up one level | ⌘↑ | `atlas.up` |
| Jump to a card or object | ⌘K | `atlas.jump` |
| Undo | — | `atlas.undo` |
| Redo | — | `atlas.redo` |
| Open traceability matrix | — | `atlas.matrix` |
| Open coverage | — | `atlas.coverage` |
| Open roadmap | — | `atlas.roadmap` |
| Auto-arrange | — | `atlas.arrange` |
| Contents | — | `atlas.contents.open` |
| Import atlas | — | `atlas.import` |
| Export atlas | — | `atlas.export` |
| Export board as .drawio | — | `atlas.export.drawio` |
| Kinds | — | `atlas.kinds.open` |
| Add a file to the board | — | `atlas.addFile` |
| Copy as image | — | `atlas.selection.copyAsImage` |
| Export as image… | — | `atlas.selection.exportAsImage` |
| Add cards from a folder | — | `atlas.addFromFolder` |
| Copy space as context | — | `atlas.share.copyContext` |
| Copy space links | — | `atlas.share.copyLinks` |
| Open perspective switcher | — | `atlas.perspective` |
| Select all | ⌘A | `atlas.selectAll` |
| Previous page | — | `diagram.previousPage` |
| Next page | — | `diagram.nextPage` |
| Fit diagram | — | `diagram.fit` |
| Toggle companion panel | — | `atlas.companion.toggle` |
| Toggle minimap | — | `atlas.minimap.toggle` |
| Export card as… | — | `atlas.card.exportAs` |
| Add a card | — | `atlas.create.card` |
| Add a note | — | `atlas.create.note` |
| Draw an area | — | `atlas.create.area` |
| New table | — | `atlas.create.table` |
| Add an image | — | `atlas.create.image` |

### Window

| Item | Shortcut | Command |
|---|---|---|
| Minimize | — | Provided by macOS |
| Zoom | — | Provided by macOS |
| Quick panel | — | `panel.open` |
| Run monitor | — | `runMonitor.open` |
| Bring All to Front | — | Provided by macOS |

### Help

| Item | Shortcut | Command |
|---|---|---|
| Mill help | — | `view.docs` |
| Search docs | — | `docs.search` |
| Keyboard shortcuts | — | `help.shortcuts` |
| What's new | — | `update.whatsNew` |
| Report an issue… | — | `help.reportIssue` |
| Open data folder | — | `help.openDataFolder` |

### Help > Developer

| Item | Shortcut | Command |
|---|---|---|
| Reload | — | Provided by macOS |
| Force Reload | — | Provided by macOS |
| Open Developer Tools | — | Provided by macOS |

<!-- END GENERATED -->
