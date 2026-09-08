// Package reference holds the wire shape shared by ADR-0040 decision
// 3's reference-integrity check and its goal-0392 extension: what
// currently references a Configure entity, from every source that can
// hold a reference. A leaf domain package (no service state) so both
// atlassvc (owns board objects) and configuresvc (owns the combined
// check + Configure's own usage indicator) can depend on the same
// shape without importing each other.
package reference

// ObjectRef names one live board object that references a Configure
// entity -- BoardID is the object's own ParentID (the canvas/board it
// is placed on, per BoardObject's own doc comment); ObjectID is the
// object itself. Label is the object's own display name (its Payload
// title, falling back to its kind) for an error/listing that has to
// name it, the same way WorkflowsReferencing already names workflows
// by Label rather than id.
type ObjectRef struct {
	BoardID  string
	ObjectID string
	Label    string
}

// Refs is the combined answer to "what still references this Configure
// entity" -- board objects (Atlas) and workflow nodes (compositionsvc),
// the two sources refIntegrityError and Configure's own usage
// indicator both read (docs/goals/0392 Decision 3, extending ADR-0040
// decision 3's workflow-only reverse lookup).
type Refs struct {
	Boards    []ObjectRef
	Workflows []string
}

// Empty reports whether nothing references the entity at all -- the
// signal both the delete-time toast ("now unused in Configure") and
// Configure's Unused filter key off.
func (r Refs) Empty() bool {
	return len(r.Boards) == 0 && len(r.Workflows) == 0
}
