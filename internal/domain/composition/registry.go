package composition

// ExecFunc executes one node's step given the running ExecContext.
// Registered per NodeTypeID alongside its NodeType via RegisterNodeType.
// Trigger and Decision kinds register with exec: nil -- ExecuteWorkflow
// skips them structurally (see its own Kind check), they carry no
// payload transformation of their own.
type ExecFunc func(node Node, ctx ExecContext) (ExecContext, error)

type nodeTypeEntry struct {
	nodeType NodeType
	exec     ExecFunc
}

var nodeTypeRegistry = map[string]nodeTypeEntry{}

// RegisterNodeType is called once per node type, from that node type's
// own init() -- the database/sql driver pattern (sql.Register), adopted
// so adding a node type means adding a file with an init(), not editing
// this package's one shared map (docs/adr/0006-extension-point-
// registration.md). Panics on a duplicate ID: a collision is a
// programming error caught at process startup, the same fail-fast
// behavior sql.Register itself uses, not a runtime data problem to
// recover from softly.
//
// Known, documented divergence (not yet reconciled -- flagged here so
// it isn't rediscovered by surprise): triggerRegistry (main.RegisterTrigger,
// triggerregistry.go) shares this exact fail-fast shape, but
// RegisterAuthStrategy (integration.go) silently overwrites on a
// duplicate AuthType instead of panicking. None of the three registries
// support intentional substitution either -- each treats "already
// registered" as purely an error case, never a valid override. Neither
// gap blocks anything today (every registration site is this repo's own
// init()-time code, never third-party), but a future extension point
// that wants to replace an existing entry (not just add a new one) will
// need a real decision here, not an accident of which registry it lands
// in.
func RegisterNodeType(nt NodeType, exec ExecFunc) {
	if _, exists := nodeTypeRegistry[nt.ID]; exists {
		panic("composition: node type " + nt.ID + " registered twice")
	}
	nodeTypeRegistry[nt.ID] = nodeTypeEntry{nodeType: nt, exec: exec}
}
