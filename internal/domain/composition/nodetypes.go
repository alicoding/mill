package composition

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"slices"
	"sort"
)

// kindOrder is NodeTypes()'s display-order tiebreaker -- Trigger nodes
// first (a workflow's root, matching linearOrder's "exactly one
// starting node" expectation), then Capture/Process/Apply/Decision, the
// same sequence the old literal slice used. Reading from a map
// (nodeTypeRegistry, registry.go) has no ordering guarantee of its own,
// so NodeTypes() sorts explicitly rather than depending on Go's
// init()-file-order behavior, which is real but not worth relying on
// silently (docs/adr/0006-extension-point-registration.md).
var kindOrder = map[NodeKind]int{
	KindTrigger:  0,
	KindCapture:  1,
	KindProcess:  2,
	KindApply:    3,
	KindDecision: 4,
	KindTerminal: 5,
}

func NodeTypes() []NodeType {
	out := make([]NodeType, 0, len(nodeTypeRegistry))
	for _, entry := range nodeTypeRegistry {
		out = append(out, entry.nodeType)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return kindOrder[out[i].Kind] < kindOrder[out[j].Kind]
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func nodeType(id string) (NodeType, bool) {
	entry, ok := nodeTypeRegistry[id]
	return entry.nodeType, ok
}

// newNodeID derives a collision-resistant node ID when the caller (the
// canvas, composing a brand-new node) doesn't supply one -- same random-
// suffix shape as compositionservice.go's newWorkflowID, scoped to this
// package since node IDs are a domain concern, not a service one.
func newNodeID(nodeTypeID string) string {
	suffix := make([]byte, 3)
	_, _ = rand.Read(suffix)
	return nodeTypeID + "-" + hex.EncodeToString(suffix)
}

// BuiltInWorkflows/ExampleChildWorkflowID live in builtinworkflows.go --
// split out of this file once it crossed the 500-line limit
// (.claude/rules/architecture.md, prompted by docs/goals/0010's own new
// seeded workflows). This file stays the node-type-REGISTRY half
// (NodeTypes/nodeType/newNodeID/ResolveNodeDefaults below); the other
// file is the seeded-DATA half -- a real, independent seam, not an
// arbitrary split.

// ResolveNodeDefaults validates every node's NodeTypeID against
// NodeTypes(), fills in any missing config key with that field's
// Default, assigns a fresh ID to any node the caller didn't already
// give one, and derives Kind from the looked-up node type (overwriting
// whatever the client sent, so it can never drift out of sync) -- so the
// returned nodes are always fully resolved. Composing a workflow always
// configures it, even implicitly via defaults. Called once, when a
// workflow is created; never lazily at execution time.
func ResolveNodeDefaults(nodes []Node) ([]Node, error) {
	resolved := make([]Node, len(nodes))
	for i, node := range nodes {
		nt, ok := nodeType(node.NodeTypeID)
		if !ok {
			return nil, fmt.Errorf("unknown node type: %s", node.NodeTypeID)
		}

		config := make(map[string]string, len(nt.ConfigFields))
		for k, v := range node.Config {
			config[k] = v
		}
		for _, field := range nt.ConfigFields {
			if _, ok := config[field.Key]; !ok {
				config[field.Key] = field.Default
			}
			// Guards against a stale persisted value after a node type's
			// Options list changes underneath it -- e.g. a workflow saved
			// before an option was removed. Only FieldOptions has a closed
			// value set; every other type accepts whatever string is there.
			if field.Type == FieldOptions && !slices.Contains(field.Options, config[field.Key]) {
				return nil, fmt.Errorf("node %s: %q is not a valid value for %s (want one of %v)", node.NodeTypeID, config[field.Key], field.Key, field.Options)
			}
		}

		id := node.ID
		if id == "" {
			id = newNodeID(node.NodeTypeID)
		}

		resolved[i] = Node{
			ID:         id,
			Kind:       nt.Kind,
			NodeTypeID: node.NodeTypeID,
			Config:     config,
			Position:   node.Position,
		}
	}
	return resolved, nil
}
