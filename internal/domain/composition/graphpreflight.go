package composition

import (
	"fmt"
	"strings"
)

// Warn-tier validations (docs/adr/0028's warn-don't-block, goal 0127's
// will-fail tier) -- split out of graph.go at the 500-line limit;
// graph.go keeps the structural (error-tier) validations.

// validateLeaves is docs/adr/0028's ending-model warning: a Capture or
// Process node with no outgoing edge computed something and delivered
// it nowhere -- legal to save (fine for a test run), but flagged.
// KindApply is deliberately exempt (an Apply ending is a real,
// legitimate ending -- ADR-0028 rejected "unify Apply into terminal" as
// removing real capability), and so is KindTerminal (the only
// structurally terminal kind, ADR-0027) since it's neither Capture nor
// Process to begin with.
func validateLeaves(nodes []Node, outgoingEdges map[string][]Edge) []Issue {
	var issues []Issue
	for _, n := range nodes {
		if n.Kind != KindCapture && n.Kind != KindProcess {
			continue
		}
		if len(outgoingEdges[n.ID]) > 0 {
			continue
		}
		issues = append(issues, warningIssue(n.ID, "",
			fmt.Sprintf("step %s: this step's result isn't delivered anywhere. Fine for a test run; add an Apply or Decision step to act on it", stepName(n))))
	}
	return issues
}

// validateRequiredRefs is docs/adr/0028's other new warning: a node
// whose ConfigField declares a Configure-entity reference (RefKind --
// requestId/listId/mcpServerId/workflowId/decisionId, docs/adr/0009)
// but hasn't picked one yet. A warning, not an error: blocking would
// forbid saving a work-in-progress draft, but the step genuinely will
// fail the moment it actually runs.
func validateRequiredRefs(nodes []Node) []Issue {
	var issues []Issue
	for _, n := range nodes {
		// A Trigger never executes as a step (it's the entry point; its
		// exec is nil), so an empty ref on it cannot fail at run time --
		// system-event's workflow scope is legitimately empty ("all
		// workflows").
		if n.Kind == KindTrigger {
			continue
		}
		nt, ok := nodeType(n.NodeTypeID)
		if !ok {
			continue
		}
		for _, field := range nt.ConfigFields {
			if field.RefKind == "" || field.OptionalRef {
				continue
			}
			if strings.TrimSpace(n.Config[field.Key]) != "" {
				continue
			}
			issues = append(issues, willFailIssue(n.ID,
				fmt.Sprintf("step %s: %s isn't set. This step isn't configured yet and will fail at run time", stepName(n), field.Label)))
		}
	}
	return issues
}

// credentialGapFn reports whether a request reference is CONFIGURED
// but missing its stored credential on this device (goal 0127 slice
// 3) -- the gap graph validation can't see on its own: the ref
// resolves, yet the run is certain to fail at the keychain. Injected
// from the composition root (wiring); nil (check off) in tests that
// never wire it. label names the integration for the user-facing
// message.
var credentialGapFn func(requestID string) (missing bool, label string)

// SetCredentialGapCheck wires the Configure-side credential-presence
// check. Same injected-seam shape as SetExecEnvLookup.
func SetCredentialGapCheck(fn func(requestID string) (missing bool, label string)) {
	credentialGapFn = fn
}

// validateCredentialGaps flags every set "request" reference whose
// integration has no stored credential -- legal to save (the fix
// lives in Configure, not the graph), but the run pre-flight refuses
// on it with this same message instead of failing mid-run.
func validateCredentialGaps(nodes []Node) []Issue {
	if credentialGapFn == nil {
		return nil
	}
	var issues []Issue
	for _, n := range nodes {
		if n.Kind == KindTrigger {
			continue
		}
		issues = append(issues, nodeCredentialGaps(n)...)
	}
	return issues
}

// nodeCredentialGaps checks one node's request references.
func nodeCredentialGaps(n Node) []Issue {
	nt, ok := nodeType(n.NodeTypeID)
	if !ok {
		return nil
	}
	var issues []Issue
	for _, field := range nt.ConfigFields {
		if field.RefKind != "request" {
			continue
		}
		id := strings.TrimSpace(n.Config[field.Key])
		if id == "" {
			continue // validateRequiredRefs owns the unset case
		}
		if missing, label := credentialGapFn(id); missing {
			issues = append(issues, willFailIssue(n.ID,
				fmt.Sprintf("step %s: the integration %q has no credential saved on this device. Open it in Configure and enter its token or secret", stepName(n), label)))
		}
	}
	return issues
}

// environmentVarGapFn answers which {{var}} names a request carries
// that the given Environment cannot resolve (goal 0306 S5). Injected
// from the composition root, exactly like credentialGapFn above: the
// request's fields and the environment's keys both live in
// configuresvc, and this package resolves neither. environmentID ""
// means no environment was selected, in which case every reference the
// request carries is a gap.
var environmentVarGapFn func(requestID, environmentID string) []string

// SetEnvironmentVarGapCheck wires the Configure-side variable-gap
// check. Same injected-seam shape as SetCredentialGapCheck.
func SetEnvironmentVarGapCheck(fn func(requestID, environmentID string) []string) {
	environmentVarGapFn = fn
}

// ValidateEnvironmentVars flags every {{var}} a step's request
// references that the run's selected Environment does not define --
// the will-fail tier, so saving the workflow stays legal and only
// starting a run is refused (executionsvc's preflightRefusal, which is
// the one caller: unlike every other check here, the answer depends on
// WHICH environment this run picked, so it cannot be part of the
// environment-blind ValidateGraph).
func ValidateEnvironmentVars(nodes []Node, environmentID string) []Issue {
	if environmentVarGapFn == nil {
		return nil
	}
	var issues []Issue
	for _, n := range nodes {
		if n.Kind == KindTrigger {
			continue
		}
		issues = append(issues, nodeEnvironmentVarGaps(n, environmentID)...)
	}
	return issues
}

// nodeEnvironmentVarGaps checks one node's request references.
func nodeEnvironmentVarGaps(n Node, environmentID string) []Issue {
	nt, ok := nodeType(n.NodeTypeID)
	if !ok {
		return nil
	}
	var issues []Issue
	for _, field := range nt.ConfigFields {
		if field.RefKind != "request" {
			continue
		}
		id := strings.TrimSpace(n.Config[field.Key])
		if id == "" {
			continue // validateRequiredRefs owns the unset case
		}
		for _, key := range environmentVarGapFn(id, environmentID) {
			issues = append(issues, willFailIssue(n.ID, environmentVarGapMessage(n, key, environmentID)))
		}
	}
	return issues
}

// environmentVarGapMessage words the two shapes this gap takes: a
// variable the chosen environment does not have, and no environment
// chosen at all. Both name the variable as it was written, so the fix
// is a search away.
func environmentVarGapMessage(n Node, key, environmentID string) string {
	if strings.TrimSpace(environmentID) == "" {
		return fmt.Sprintf("step %s: the request uses {{%s}} but no environment is selected for this run", stepName(n), key)
	}
	return fmt.Sprintf("step %s: the request uses {{%s}} but the selected environment has no such variable", stepName(n), key)
}
