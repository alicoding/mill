package triggersvc

import "time"

// fileWriteGuardTTL bounds how long a recorded file write suppresses a
// re-fire of its own workflow's filesystem watch (docs/goals/0087) --
// long enough to absorb the OS event delivery + dispatch latency
// between a step's os.Rename/os.WriteFile call and fsnotify's own event
// arriving back at this process, short enough that a genuinely new
// external write to the same path minutes later isn't silently
// swallowed.
const fileWriteGuardTTL = 10 * time.Second

// fileWriteRecord is one recorded write's bookkeeping: which workflow
// made it, and until when it still suppresses that same workflow's own
// re-fire on the path.
type fileWriteRecord struct {
	workflowID string
	expiry     time.Time
}

// RecordRunFileWrite is composition.SetFileWriteRecorder's wired
// implementation (installed from NewTriggerService): apply-file-move
// and apply-file-write call this after a successful write, naming the
// workflow whose own trigger-filesystem-watch must not re-fire on this
// exact path. A blank workflowID or path (an unwired caller, or a run
// with no WorkflowID) is a no-op -- there is nothing meaningful to
// suppress.
//
//wails:ignore
func (s *TriggerService) RecordRunFileWrite(workflowID, path string) {
	if workflowID == "" || path == "" {
		return
	}
	s.fwMu.Lock()
	defer s.fwMu.Unlock()
	s.fileWrites[path] = fileWriteRecord{workflowID: workflowID, expiry: time.Now().Add(fileWriteGuardTTL)}
}

// shouldSkipFileWatchFire reports whether workflowID's own
// trigger-filesystem-watch fire on path should be suppressed because a
// run just wrote that exact path itself -- the structural cycle guard
// (docs/goals/0087): a DIFFERENT workflow watching the same path is
// unaffected (its own workflowID never matches the recorded one), so
// pipeline chaining between two independently authored workflows still
// works. Prunes the looked-up entry once it's past fileWriteGuardTTL so
// a later, genuinely external write to the same path is never falsely
// suppressed and the map never grows unbounded.
func (s *TriggerService) shouldSkipFileWatchFire(path, workflowID string) bool {
	s.fwMu.Lock()
	defer s.fwMu.Unlock()
	rec, ok := s.fileWrites[path]
	if !ok {
		return false
	}
	if time.Now().After(rec.expiry) {
		delete(s.fileWrites, path)
		return false
	}
	return rec.workflowID == workflowID
}
