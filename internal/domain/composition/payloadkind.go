package composition

import "fmt"

// PayloadKind is the coarse media kind of the payload a step consumes
// or produces -- the step I/O contract (ADR-0042). A closed lattice,
// not an open string: any ⊃ text ⊃ {html, markdown, json}; none means
// no payload flows. Deliberately coarse -- the researched convergence
// is "refuse on coarse kind at draw time, validate deeper shape at run
// time, if at all"; a per-field schema layer is ADR-0042's named
// future extension, not this type.
type PayloadKind string

const (
	// PayloadAny accepts everything as a consume declaration and
	// promises nothing as a produce declaration (a script's stdout, an
	// MCP tool's result).
	PayloadAny PayloadKind = "any"
	// PayloadText is the family root: every concrete kind IS text
	// (the payload stays a string -- the contract is typed, the
	// ExecContext is not restructured).
	PayloadText     PayloadKind = "text"
	PayloadHTML     PayloadKind = "html"
	PayloadMarkdown PayloadKind = "markdown"
	PayloadJSON     PayloadKind = "json"
	// PayloadNone: no payload. As a produce declaration -- entry
	// points that start with an empty payload, terminals that end the
	// flow. In a Consumes list: alone, "this step reads no payload"
	// (compatible with every upstream, it ignores the payload);
	// alongside other kinds, "the payload is optional" (an empty
	// upstream is acceptable too).
	PayloadNone PayloadKind = "none"
)

// PayloadProduce declares what leaves a step. Passthrough means the
// payload is forwarded unchanged (guardrail gates, notifications,
// attribute-writing lookups) -- the effective kind at such a step is
// its upstream's, resolved by EffectivePayloadKind.
type PayloadProduce struct {
	Kind        PayloadKind `json:"kind,omitempty"`
	Passthrough bool        `json:"passthrough,omitempty"`
}

// kindAccepts reports whether a consumer declaring kind c accepts a
// producer's effective kind p, under the lattice: any accepts
// everything; text accepts every concrete text kind; a concrete kind
// accepts itself; a producer of any is never refused (nothing is
// certain enough to refuse). none as a consumer kind is handled by
// ConsumesAccepts, not here.
func kindAccepts(c, p PayloadKind) bool {
	if c == PayloadAny || p == PayloadAny {
		return true
	}
	if c == p {
		return true
	}
	if c == PayloadText && (p == PayloadHTML || p == PayloadMarkdown || p == PayloadJSON) {
		return true
	}
	return false
}

// ConsumesAccepts reports whether a step's Consumes declaration
// accepts an upstream's effective produce kind. A step that reads no
// payload (Consumes exactly [none]) accepts anything -- it ignores the
// payload entirely. A producer of none (an entry point's empty
// payload) is universally accepted: the payload is a string, empty is
// legal input to every step at run time, and refusing it would break
// legitimate graphs (a bare manual trigger clearing the clipboard).
// none inside a longer Consumes list is display-honesty ("the payload
// is optional"), not a validation distinction. What this function
// refuses is definite MEDIA mismatch: a concrete produced kind no
// declared consumer kind accepts under the lattice.
func ConsumesAccepts(consumes []PayloadKind, produced PayloadKind) bool {
	if produced == PayloadNone {
		return true
	}
	if len(consumes) == 1 && consumes[0] == PayloadNone {
		return true
	}
	for _, c := range consumes {
		if c == PayloadNone {
			continue
		}
		if kindAccepts(c, produced) {
			return true
		}
	}
	return false
}

// EffectivePayloadKind resolves what actually flows out of nodeID:
// walking back through passthrough steps to the nearest real
// producer. The walk follows incoming edges; Mill's graphs are
// trigger-rooted with every non-Decision node at out-degree ≤ 1, so
// a node has at most one incoming path worth resolving -- if a
// passthrough node somehow has multiple incoming edges, the first
// resolvable kind wins and any ambiguity stays PayloadAny (never a
// false refusal).
func EffectivePayloadKind(nodeID string, byID map[string]Node, incoming map[string][]Edge, visited map[string]bool) PayloadKind {
	if visited[nodeID] {
		return PayloadAny
	}
	visited[nodeID] = true
	node, ok := byID[nodeID]
	if !ok {
		return PayloadAny
	}
	nt, ok := nodeType(node.NodeTypeID)
	if !ok {
		return PayloadAny
	}
	if !nt.Produces.Passthrough {
		if nt.Produces.Kind == "" {
			return PayloadAny
		}
		return nt.Produces.Kind
	}
	for _, e := range incoming[nodeID] {
		if k := EffectivePayloadKind(e.Source, byID, incoming, visited); k != PayloadAny {
			return k
		}
	}
	return PayloadAny
}

// payloadKindIssues checks every edge's data compatibility: the
// upstream's effective produce kind against the downstream's Consumes
// declaration. Only definite incompatibilities become issues (any on
// either side always connects) -- the ADR-0042 refusal semantics, the
// same check the canvas mirrors at draw time.
func payloadKindIssues(byID map[string]Node, edges []Edge) []Issue {
	incoming := map[string][]Edge{}
	for _, e := range edges {
		incoming[e.Target] = append(incoming[e.Target], e)
	}
	var issues []Issue
	for _, e := range edges {
		target, ok := byID[e.Target]
		if !ok {
			continue
		}
		nt, ok := nodeType(target.NodeTypeID)
		if !ok || len(nt.Consumes) == 0 {
			continue
		}
		produced := EffectivePayloadKind(e.Source, byID, incoming, map[string]bool{})
		if ConsumesAccepts(nt.Consumes, produced) {
			continue
		}
		issues = append(issues, errorIssue(e.Target, e.ID, fmt.Sprintf(
			"step %s needs %s but its previous step produces %s",
			e.Target, describeConsumes(nt.Consumes), describeKind(produced))))
	}
	return issues
}

func describeKind(k PayloadKind) string {
	switch k {
	case PayloadNone:
		return "nothing"
	case PayloadAny:
		return "anything"
	case PayloadHTML:
		return "HTML"
	case PayloadJSON:
		return "JSON"
	case PayloadMarkdown:
		return "Markdown"
	default:
		return string(k)
	}
}

func describeConsumes(kinds []PayloadKind) string {
	switch len(kinds) {
	case 0:
		return "anything"
	case 1:
		return describeKind(kinds[0])
	}
	out := ""
	for i, k := range kinds {
		if k == PayloadNone {
			continue
		}
		if out != "" && i > 0 {
			out += " or "
		}
		out += describeKind(k)
	}
	if out == "" {
		return "nothing"
	}
	return out
}
