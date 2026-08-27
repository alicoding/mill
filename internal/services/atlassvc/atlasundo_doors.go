package atlassvc

// The three sets TestUndoCompleteness_EveryMutationDoorIsClassified
// checks every exported AtlasService method against (ADR-0044
// Consequences: "a door that skips it is a review defect, not a
// silent gap"). Every map value is the reason a door landed where it
// did -- read at review time, not by the test itself.

// journaledDoors are the v1 board-surface mutation doors (ADR-0044
// Scope: cards/notes/objects/links -- create/delete/position/size/
// move/content/promote/rotation/lens): each has a recordUndo call at
// its own seam. PasteToBoard/AddLinkedCard/CreateCardLinkedFrom/
// CreateLinkedFileCard don't call recordUndo directly -- they compose
// already-journaled doors (CreateCard/CreateBoardObject/CreateLink/
// DeleteCard) under one BeginUndoMark/EndUndoMark grouping instead.
var journaledDoors = map[string]string{
	"AddLinkedCard":          "composes CreateCard-equivalent (commitLinkedCardLocked) + DeleteCard as its undo",
	"CreateBoardObject":      "create family",
	"CreateCard":             "create family",
	"CreateCardForMCP":       "create family, actor=mcp (never popped by the UI actor)",
	"CreateCardForWorkflow":  "create family, actor=workflow (never popped by the UI actor)",
	"CreateCardFromFileDrop": "create family",
	"CreateCardLinkedFrom":   "composes commitLinkedCardLocked + DeleteCard as its undo",
	"CreateLink":             "create family",
	"CreateLinkedFileCard":   "create family (card+link, link recovers via the card's own tombstone hiding)",
	"CreateLinkForMCP":       "create family, actor=mcp",
	"CreateNote":             "create family",
	"DeleteBoardObject":      "delete family (tombstone)",
	"DeleteCard":             "delete family (tombstone)",
	"DeleteLink":             "delete family (hard-delete, undo recreates with the same id)",
	"DeleteNote":             "delete family (tombstone)",
	"MoveBoardObject":        "move family",
	"MoveCard":               "move family",
	"MoveNote":               "move family",
	"PasteToBoard":           "multi-entity create, wrapped in ONE BeginUndoMark/EndUndoMark (goal 0218 paste-landing)",
	"PromoteBoardObject":     "promote family (demote/repromote, atlasundo_promote.go)",
	"PromoteNote":            "promote family (demote/repromote, atlasundo_promote.go)",
	"SetBoardObjectPosition": "scalar family",
	"SetBoardObjectRotation": "scalar family",
	"SetBoardObjectSize":     "scalar family",
	"SetCardSize":            "scalar family",
	"SetLens":                "scalar family",
	"SetLinkKind":            "scalar family",
	"SetNotePosition":        "scalar family",
	"SetNoteSize":            "scalar family",
	"SetPosition":            "scalar family",
	"UpdateCard":             "content family",
	"UpdateCardForMCP":       "content family, actor=mcp",
	"UpdateLink":             "scalar family (label)",
	"UpdateNoteText":         "content family",
}

// exemptDoors mutate state but are deliberately NOT journaled --
// each reason is the actual scope boundary, not a placeholder.
var exemptDoors = map[string]string{
	// Kind/LinkKind/Perspective structural edits: named OUT of v1 by
	// ADR-0044's own Scope section ("revisit when a real editing
	// session loses work there").
	"AddToPerspective":      "perspective structural edit, out of v1 (ADR-0044 Scope)",
	"CreateKind":            "Kind structural edit, out of v1 (ADR-0044 Scope)",
	"CreateLinkKind":        "LinkKind structural edit, out of v1 (ADR-0044 Scope)",
	"CreatePerspective":     "perspective structural edit, out of v1 (ADR-0044 Scope)",
	"DeleteKind":            "Kind structural edit, out of v1 (ADR-0044 Scope)",
	"DeleteLinkKind":        "LinkKind structural edit, out of v1 (ADR-0044 Scope)",
	"DeletePerspective":     "perspective structural edit, out of v1 (ADR-0044 Scope)",
	"RemoveFromPerspective": "perspective structural edit, out of v1 (ADR-0044 Scope)",
	"RenamePerspective":     "perspective structural edit, out of v1 (ADR-0044 Scope)",
	"ReorderPerspective":    "perspective structural edit, out of v1 (ADR-0044 Scope)",
	"UpdateKind":            "Kind structural edit, out of v1 (ADR-0044 Scope)",
	"UpdateLinkKind":        "LinkKind structural edit, out of v1 (ADR-0044 Scope)",

	// Background/bulk/non-gesture callers (goal 0219 S2 scope cut,
	// named in the PR report): not a single user gesture, or not
	// reachable from the UI at all.
	"CreateListProjectionCard": "wails:ignore, list-projection wiring call, not a canvas gesture",
	"ImportAtlas":              "bulk multi-entity import, not a single gesture -- out of v1 scope",
	"MergeCardFields":          "wails:ignore, workflow-only write -- never a UI actor's gesture",
	"SyncDocsFolder":           "wails:ignore, background folder sync, not a canvas gesture",
	"SyncLedgerFolder":         "wails:ignore, background folder sync, not a canvas gesture",

	// Mirror/file-management + app-config doors: not named in
	// ADR-0044's v1 door enumeration (position/size/move/content/
	// promote/rotation/lens).
	"MirrorImageFromPath":      "mirror/file-management operation, not in ADR-0044's v1 door list",
	"MirrorRawBytes":           "mirror content read/write helper, not a board-content door",
	"RefreshMirrorContainer":   "mirror bulk resync, not in ADR-0044's v1 door list",
	"RepickCardMirror":         "mirror-path repick, not in ADR-0044's v1 door list",
	"RepickObjectMirror":       "mirror-path repick, not in ADR-0044's v1 door list",
	"RunCardAction":            "triggers a workflow run, not a board-content mutation",
	"SaveImageBytes":           "writes an image file to disk; the resulting board entity lands via a separate, already-journaled create door",
	"SetAtlasSession":          "navigation/viewport state, not board content",
	"SetCapturesDir":           "wails:ignore, app-level config, not board content",
	"SetCardActions":           "wails:ignore, workflow-attachment config, not board content",
	"SetCardProjectionDensity": "a view-density preference, not board content",
	"SetGuardedDataPaths":      "wails:ignore, app-level config, not board content",
	"SetMirrorsDir":            "wails:ignore, app-level config, not board content",
	"SetViewMode":              "container view-mode toggle, not in ADR-0044's v1 door list",
	"WriteObjectMirror":        "the embedded editor engine's own continuous autosave writes (goal 0237 S1) -- journaling every keystroke-driven autosave would flood the undo stack with noise no user gesture maps to; the engine's own in-app undo (Ctrl+Z inside the editor) is the actual undo surface for an in-progress edit",
	"UpdateNow":                "triggers a workflow run against a card, not a canvas gesture",
	"NotifyRunCompleted":       "workflow-run completion bookkeeping, not a canvas gesture",

	// The undo mechanism's own doors: recording an entry for a call
	// that IS the undo/redo mechanism (or its raw inverse-application
	// primitive) would double the journal rather than complete it.
	"Undo":          "the undo mechanism itself",
	"Redo":          "the redo mechanism itself",
	"UndoDelete":    "the delete family's own inverse-application primitive, invoked via journal replay",
	"BeginUndoMark": "mark-boundary RPC, not itself a mutation door",
	"EndUndoMark":   "mark-boundary RPC, not itself a mutation door",
}

// notMutationDoors are pure reads, exports, native-dialog pickers, or
// //wails:ignore wiring calls from main.go -- nothing here changes
// persisted Atlas state.
//
//nolint:gosec // G101 false-positive: a doc-string lookup table, not a credential
var notMutationDoors = map[string]string{
	"AtlasSession": "read", "CardContextBlock": "read/export text", "CardContextEnvelope": "read/export text",
	"CardListProjection": "read", "Cards": "read", "CardsByKind": "read", "CardSourceOffer": "read",
	"CloseAllMirrorWatches": "test/shutdown helper", "ConvertHTMLToMarkdown": "pure conversion, no state",
	"CorrectionEnvelope": "read/export text", "DetectSyncRoots": "read/scan", "DiffPerspectives": "read/diff",
	"ExportAtlas": "read/export", "ExportBoardAsDrawio": "read/export", "ImportFolderSuggestions": "read/scan",
	"Kinds": "read", "Lens": "read", "LinkKinds": "read", "Links": "read", "MirrorContent": "read",
	"Notes": "read", "ObjectListProjection": "read", "ObjectMirrorContent": "read", "Objects": "read",
	"OpenCardMirror":               "OS side effect (opens the file), no board-state change",
	"OpenObjectMirrorInDefaultApp": "OS side effect (opens the file), no board-state change",
	"Perspectives":                 "read", "PickDiagramFile": "native file picker, no board-state change",
	"PickFolder": "native folder picker, no board-state change", "PickImageFile": "native file picker, no board-state change",
	"PreviewClipbridgeReply": "read/preview", "RenderNoteMarkdown": "pure conversion, no state",
	"ResolveFileDropRoute": "read/route decision", "RevealCardMirror": "OS reveal-in-Finder, no board-state change",
	"RevealSpaceFolder": "OS reveal-in-Finder, no board-state change", "ScanFolder": "read/scan",
	"SpaceBundleContext": "read/export text", "SpaceContextEnvelope": "read/export text", "SpaceLinksList": "read/export text",
	"TableProjectionExport": "read/export", "UndoState": "read",
	"WireCompositionSeams": "wails:ignore wiring call", "WireFileDropWindow": "wails:ignore wiring call",
	"WireListProjection": "wails:ignore wiring call", "WirePasteListWrites": "wails:ignore wiring call",
	"WireSourceRecognition": "wails:ignore wiring call",
}
