package composition

// RefExists reports whether kind's entity id currently resolves through
// the same lookup seam execution already uses (lookupHTTPRequestFn et
// al., wired once by configuresvc.NewConfigureService's Set*Lookup
// calls) -- built for docs/goals/0039's clipboard-apply dangling-
// reference preview, which needs a yes/no answer rather than a
// resolved value, so this wraps rather than duplicates those lookups.
//
// id="" is never "dangling" here: an empty RefKind value means "not
// configured yet," a distinct, pre-existing warning
// (validateRequiredRefs in graph.go, docs/adr/0028), not a reference to
// something that doesn't exist.
func RefExists(kind, id string) bool {
	if id == "" {
		return true
	}
	switch kind {
	case "request":
		_, err := lookupHTTPRequestFn(id)
		return err == nil
	case "list":
		_, err := lookupListFn(id)
		return err == nil
	case "mcpserver":
		_, err := lookupMCPServerFn(id)
		return err == nil
	case "decision":
		// Existence check only -- pinnedVersion=0 (live) regardless of
		// whatever version a real decision-outcome node's config might
		// pin to, since a dangling ENTITY reference is what this
		// function answers, not whether a particular pinned snapshot
		// still exists.
		_, err := lookupDecisionFn(id, 0)
		return err == nil
	case "execenv":
		_, err := lookupExecEnvFn(id)
		return err == nil
	default:
		// "workflow"/"workflow-scope" (childworkflow.go/triggers.go)
		// resolve against compositionsvc's own workflow list -- no
		// cross-package lookup seam is wired for those the way the
		// Configure-entity kinds above are, so the caller
		// (compositionsvc, which owns that list) checks them itself.
		// Any other/future RefKind this function doesn't know how to
		// check is left unflagged rather than guessed at.
		return true
	}
}
