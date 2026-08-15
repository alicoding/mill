// Package versioning holds the generic draft/publish snapshot mechanics
// docs/adr/0021 established for Workflow and docs/adr/0040 decision 4
// extends to Decision: an entity's own head is the editable draft, a
// Publish action freezes it as the next monotonically-numbered
// immutable snapshot. A leaf package (zero internal imports) so both
// composition and decision can depend on it without creating a cycle
// between them.
package versioning

// Numbered is anything carrying an immutable, monotonically assigned
// version number -- the shape composition.WorkflowVersion and
// decision.DecisionVersion both satisfy, so the numbering/lookup
// mechanics below are written once instead of duplicated per entity.
type Numbered interface {
	VersionNumber() int
}

// NextNumber returns the next monotonic version number for an existing
// snapshot slice (max existing + 1) -- publishing after a rollback to
// an older version never collides with a later one.
func NextNumber[T Numbered](versions []T) int {
	next := 1
	for _, v := range versions {
		if v.VersionNumber() >= next {
			next = v.VersionNumber() + 1
		}
	}
	return next
}

// ByNumber finds one snapshot by its version number.
func ByNumber[T Numbered](versions []T, n int) (T, bool) {
	for _, v := range versions {
		if v.VersionNumber() == n {
			return v, true
		}
	}
	var zero T
	return zero, false
}
