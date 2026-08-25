package atlassvc

// Undo pops the UI actor's last mark and applies every entry's inverse,
// through the same mutation doors that made the original changes
// (ADR-0044 decision 3) -- never a state rollback. Entries within a
// mark apply in REVERSE recording order (last change undone first),
// mirroring how a multi-step gesture must unwind. The whole mark then
// moves onto the redo stack UNCHANGED, so Redo() can replay it forward.
func (a *AtlasService) Undo() UndoResult {
	return a.applyMark(actorUI, true)
}

// Redo re-applies the UI actor's last undone mark, forward, through the
// same doors (ADR-0044 decision 3: "redo is the inverse's inverse,
// same rule").
func (a *AtlasService) Redo() UndoResult {
	return a.applyMark(actorUI, false)
}

// applyMark pops the last mark from actor's undo (isUndo) or redo
// (!isUndo) stack, applies each entry's undoApply/redoApply closure,
// and pushes the same mark onto the OTHER stack. Popping/pushing is
// done under a.mu in two short critical sections; the closures
// themselves run UNLOCKED (each internally re-locks via the ordinary
// mutation door it calls -- SetPosition, DeleteCard, etc.) with
// a.suppressRecording held true for the duration, so those nested door
// calls persist and emit exactly like any other call but skip minting
// a redundant journal entry (recordUndo's own suppression check) --
// the entry pair built at ORIGINAL record time already IS the other
// direction. ADR-0044 decision 5's apply-time staleness is handled
// per-entry, not mark-wide: a closure that errors (most commonly
// "no card/note/object with id ...", the target having been deleted
// or otherwise invalidated since) is skipped and reported, while the
// rest of the mark still applies -- "conflicting untouched properties
// are preserved" from the ADR is exactly this per-entry independence.
func (a *AtlasService) applyMark(actor undoActor, isUndo bool) UndoResult {
	mark, ok := a.popMark(actor, isUndo)
	if !ok {
		return UndoResult{}
	}

	skipped, skipLabel := applyMarkEntries(a, mark, isUndo)

	a.mu.Lock()
	if isUndo {
		a.redoStacks[actor] = append(a.redoStacks[actor], mark...)
	} else {
		a.undoStacks[actor] = append(a.undoStacks[actor], mark...)
	}
	a.mu.Unlock()

	if skipped {
		return UndoResult{Applied: true, Skipped: true, Message: skipMessage(skipLabel)}
	}
	return UndoResult{Applied: true}
}

// popMark removes and returns the last mark (every entry sharing the
// topmost markID) from actor's undo (isUndo) or redo (!isUndo) stack --
// ok is false when that stack is empty. Caller owns pushing the
// returned mark onto the OTHER stack once applied.
func (a *AtlasService) popMark(actor undoActor, isUndo bool) (mark []undoEntry, ok bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	src := a.redoStacks[actor]
	if isUndo {
		src = a.undoStacks[actor]
	}
	if len(src) == 0 {
		return nil, false
	}
	markID := src[len(src)-1].markID
	i := len(src)
	for i > 0 && src[i-1].markID == markID {
		i--
	}
	mark = append([]undoEntry(nil), src[i:]...)
	if isUndo {
		a.undoStacks[actor] = src[:i]
	} else {
		a.redoStacks[actor] = src[:i]
	}
	return mark, true
}

// applyMarkEntries runs every entry's undoApply (isUndo, reverse
// recording order) or redoApply (forward order) UNLOCKED, with
// a.suppressRecording held for the duration -- see applyMark's own
// header for why. Returns whether any entry was skipped (ADR-0044
// decision 5) and the last skipped entry's label.
func applyMarkEntries(a *AtlasService, mark []undoEntry, isUndo bool) (skipped bool, skipLabel string) {
	order := mark
	if isUndo {
		order = reversedEntries(mark)
	}
	a.setSuppressRecording(true)
	defer a.setSuppressRecording(false)
	for _, e := range order {
		var err error
		if isUndo {
			err = e.undoApply(a)
		} else {
			err = e.redoApply(a)
		}
		if err != nil {
			skipped = true
			skipLabel = e.label
		}
	}
	return skipped, skipLabel
}

// reversedEntries returns a new slice with entries in reverse order --
// entries is never mutated in place (it's the mark snapshot the caller
// still needs to push onto the other stack afterward, in its ORIGINAL
// order).
func reversedEntries(entries []undoEntry) []undoEntry {
	out := make([]undoEntry, len(entries))
	for i, e := range entries {
		out[len(entries)-1-i] = e
	}
	return out
}
