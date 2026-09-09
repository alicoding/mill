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

// PluginRef names one installed plugin whose declared entityRef
// setting currently holds a reference to a Configure entity (docs/
// goals/0400): PluginID+SettingKey identify the reference the same way
// ObjectRef's BoardID+ObjectID do; Label is the plugin's own display
// name (falling back to its id) for an error/listing that has to name
// it.
type PluginRef struct {
	PluginID   string
	SettingKey string
	Label      string
}

// Refs is the combined answer to "what still references this Configure
// entity" -- board objects (Atlas), workflow nodes (compositionsvc),
// and plugin settings (pluginsvc), the sources refIntegrityError and
// Configure's own usage indicator all read (docs/goals/0392 Decision
// 3, extending ADR-0040 decision 3's workflow-only reverse lookup;
// docs/goals/0400 adds the plugin-settings source).
type Refs struct {
	Boards    []ObjectRef
	Workflows []string
	Plugins   []PluginRef
}

// Empty reports whether nothing references the entity at all -- the
// signal both the delete-time toast ("now unused in Configure") and
// Configure's Unused filter key off.
func (r Refs) Empty() bool {
	return len(r.Boards) == 0 && len(r.Workflows) == 0 && len(r.Plugins) == 0
}

// Count is the total live reference count across every source -- the
// same "boards plus workflows" sum entity.dereferenced's remaining
// payload already reported (docs/goals/0392 S2), now including plugin
// settings so a still-referenced-by-a-plugin entity is never announced
// as unused.
func (r Refs) Count() int {
	return len(r.Boards) + len(r.Workflows) + len(r.Plugins)
}
