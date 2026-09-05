package compositionsvc

import "github.com/alicoding/mill/internal/domain/composition"

// WorkflowsReferencing returns the Label of every workflow whose node
// config still binds a ConfigField of the given RefKind to id --
// docs/adr/0040 decision 3's reverse lookup, the one place Configure-
// entity delete integrity is checked from. compositionsvc owns
// workflow data, so ConfigureService's Delete* methods call this
// directly through the *CompositionService pointer NewConfigureService
// already holds (configureservice.go), rather than a second injected-
// function seam duplicating that existing wiring. DeleteWorkflow below
// uses it the same way for RefKind "workflow" (child-workflow
// references), self-contained since compositionsvc owns both sides of
// that check.
//
// Marked wails:ignore: this is a backend-internal integrity check, not
// something the frontend calls directly -- a blocked Delete* RPC's own
// error already names the referencing workflow(s).
//
//wails:ignore
func (c *CompositionService) WorkflowsReferencing(refKind, id string) []string {
	if id == "" {
		return nil
	}
	keysByType := make(map[string][]string)
	for _, nt := range composition.NodeTypes() {
		for _, f := range nt.ConfigFields {
			if f.RefKind == refKind {
				keysByType[nt.ID] = append(keysByType[nt.ID], f.Key)
			}
		}
	}

	var labels []string
workflowLoop:
	for _, wf := range c.Workflows() {
		// A workflow's default Environment is a reference the graph
		// cannot show: it lives on the workflow itself, not in any
		// node's config, so the node scan below would never see it and
		// the entity would look unreferenced right up to the moment a
		// run needed it.
		if refKind == "environment" && wf.DefaultEnvironmentID == id {
			labels = append(labels, wf.Label)
			continue
		}
		for _, n := range wf.Nodes {
			for _, key := range keysByType[n.NodeTypeID] {
				if n.Config[key] == id {
					labels = append(labels, wf.Label)
					continue workflowLoop
				}
			}
		}
	}
	return labels
}
