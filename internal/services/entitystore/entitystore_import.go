package entitystore

// DispatchImport implements ADR-0036 decision 3's uniform import
// rule: a caller-supplied id already present locally updates in
// place; a caller-supplied id absent locally creates preserving it;
// no id creates fresh with a freshly-minted one. Every hand-written
// ImportX method's own three-way branch, collapsed to one call.
func DispatchImport[T any](exists func(id string) bool, id string, update, createWithID, create func() (T, error)) (T, error) {
	if id != "" {
		if exists(id) {
			return update()
		}
		return createWithID()
	}
	return create()
}
