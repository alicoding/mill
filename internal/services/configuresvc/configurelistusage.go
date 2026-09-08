package configuresvc

// ListUsage is one List's own usage count against the combined
// reference index (docs/goals/0392 Decision 3) -- Boards/Workflows are
// counts, not the full reference.Refs, since Configure's Lists page
// only ever renders "Used on N boards, M workflows" and the Unused
// filter (both == 0), never the referencing names themselves (those
// surface in the blocked-delete error instead).
type ListUsage struct {
	ListID    string
	Boards    int
	Workflows int
}

// ListUsageSummary returns every List's own usage count in one call --
// the Lists page's per-row indicator and Unused filter read this
// instead of one RPC per row.
func (c *ConfigureService) ListUsageSummary() []ListUsage {
	c.mu.Lock()
	ids := make([]string, len(c.lists))
	for i, l := range c.lists {
		ids[i] = l.ID
	}
	c.mu.Unlock()
	out := make([]ListUsage, len(ids))
	for i, id := range ids {
		refs := c.References("list", id)
		out[i] = ListUsage{ListID: id, Boards: len(refs.Boards), Workflows: len(refs.Workflows)}
	}
	return out
}
