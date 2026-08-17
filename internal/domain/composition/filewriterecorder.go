package composition

// recordFileWriteFn notifies the filesystem-watch structural cycle
// guard (docs/goals/0087, triggersvc.TriggerService.RecordRunFileWrite)
// that workflowID's own run wrote/moved path -- so a trigger-filesystem-
// watch fire on that exact path can be skipped for THAT workflow's own
// watch, while a different workflow's watch on the same folder still
// fires (pipeline chaining stays intact). No-op default, same shape as
// every other injected seam in this package (e.g. atlasruncontext.go's
// lookupCurrentRunIDFn): a bare unit test that never wires
// SetFileWriteRecorder just means nothing is recorded, not a crash.
var recordFileWriteFn = func(_, _ string) {}

// SetFileWriteRecorder installs the seam. triggersvc wires this to its
// own TriggerService.RecordRunFileWrite once constructed -- composition
// itself never imports triggersvc (.claude/rules/backend.md's injected-
// function-var rule).
func SetFileWriteRecorder(fn func(workflowID, path string)) {
	recordFileWriteFn = fn
}
