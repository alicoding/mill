package composition

// findAnyCycle -- split out of graph.go once that file crossed the
// 500-line limit (CLAUDE.md/§1.3), the same "split along a real seam"
// discipline this package's other split files already established.
// Naming an actual cycle is a genuinely separable diagnostic concern
// from buildGraph/findRoot's core structural checks (goal 0021 gap 4:
// the old "a workflow must have exactly one starting node" message was
// technically true on a pure cycle but left an authoring agent to find
// the loop by process of elimination).

// findAnyCycle returns one real cycle's node IDs in traversal order
// (the loop's first node repeated at the end, e.g. ["a", "b", "c",
// "a"]), or nil if the graph is acyclic. Standard white/gray/black DFS
// -- gray means "on the current recursion stack"; hitting a gray node
// closes a cycle back to that node's position on the stack. Iterates
// nodes/outgoingEdges in their given (deterministic, insertion-preserving
// per buildGraph's own doc comment) order, so the same graph always
// reports the same cycle rather than one that varies with map
// iteration order.
func findAnyCycle(nodes []Node, outgoingEdges map[string][]Edge) []string {
	const (
		white = iota
		gray
		black
	)
	color := make(map[string]int, len(nodes))
	var stack []string
	var cycle []string

	var visit func(id string) bool
	visit = func(id string) bool {
		color[id] = gray
		stack = append(stack, id)
		for _, e := range outgoingEdges[id] {
			switch color[e.Target] {
			case white:
				if visit(e.Target) {
					return true
				}
			case gray:
				for i, sid := range stack {
					if sid == e.Target {
						cycle = append(append([]string{}, stack[i:]...), e.Target)
						break
					}
				}
				return true
			}
		}
		color[id] = black
		stack = stack[:len(stack)-1]
		return false
	}

	for _, n := range nodes {
		if color[n.ID] == white {
			if visit(n.ID) {
				return cycle
			}
		}
	}
	return nil
}
