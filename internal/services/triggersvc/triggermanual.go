package triggersvc

// Schema (composition.NodeType{ID: "trigger-manual", ...}) registers
// from internal/domain/composition/triggers.go, not here -- see that
// file's doc comment for why the schema half can't live in package
// main alongside this dispatch half.
func init() {
	RegisterTrigger("trigger-manual", func(_ *TriggerService, _ string, _ map[string]string) (*activeListener, error) {
		return nil, nil
	})
}
