package composition

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// ResolvedList is a List's data, assembled by whatever owns List
// storage at request time. Same shape and same reasoning as
// ResolvedHTTPRequest (integration.go): composition.go doesn't own List
// persistence (ConfigureService does), so this is injected once via
// SetListLookup rather than composition depending on ConfigureService
// directly.
//
// Entries stays list-lookup's own flat key/value read -- the
// resolver's own list.DeriveEntries output (goal 0011), computed
// once at resolve time so list-lookup's execution logic here needed
// zero changes when List grew typed columns. Columns/Rows are goal
// 0011's typed additions, read by list-search (listsearch.go).
type ResolvedList struct {
	Entries map[string]string
	Columns []typedfield.Field
	Rows    []list.Row
	// VersionStamp is "v<N>" for a pinned resolution, "live@<N>"/
	// "live@draft" for an unpinned one (docs/adr/0040 decisions 4-5,
	// applied to List by goal 0070) -- list.ResolvedSnapshot.VersionStamp,
	// carried across the lookup seam unchanged.
	VersionStamp string
}

// lookupListFn defaults to erroring so a list-lookup/list-search node
// run before ConfigureService exists (or before SetListLookup wires it)
// fails loudly instead of silently no-op'ing. pinnedVersion is 0 for
// live resolution, or the version number a list-lookup/list-search
// node's optional "version" config pins to.
var lookupListFn = func(listID string, pinnedVersion int) (ResolvedList, error) {
	return ResolvedList{}, fmt.Errorf("no list lookup registered (yet) for id %q", listID)
}

// SetListLookup wires the function list-lookup/list-search nodes use to
// resolve a listId (optionally pinned to a published version) into its
// entries/columns/rows. Called once from main.go once ConfigureService
// exists.
func SetListLookup(fn func(listID string, pinnedVersion int) (ResolvedList, error)) {
	lookupListFn = fn
}

// listPinnedVersion parses list-lookup/list-search's shared optional
// "version" config (docs/adr/0040 decision 4, goal 0070) -- same shape
// and precedent as decision-outcome's own version pin
// (decisionPinnedVersion, decisionoutcome.go).
func listPinnedVersion(node Node) (int, error) {
	raw := strings.TrimSpace(node.Config["version"])
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 0, fmt.Errorf("version %q is not a positive version number", raw)
	}
	return n, nil
}

func init() {
	RegisterNodeType(NodeType{
		ID: "list-lookup", Kind: KindProcess,
		Label: "Look up list row",
		// ClassRead: resolves a Configure-authored List's persisted
		// entries (lookupListFn) -- the same "reads state outside this
		// workflow's own payload/Attributes" classification capture-file
		// declares for a local filesystem read, not left at the zero
		// value (docs/goals/0030-node-standard.md item b).
		Effect:      guardrail.ClassRead,
		Complexity:  ComplexityBasic,
		Output:      "payload unchanged; match → attribute",
		Description: "Looks up an Attributes value in a Configure-authored List and writes the matched entry back into Attributes. listId is FieldText for the same reason integration-http's requestId is above -- Lists are runtime, Configure-authored data (the Inspector renders a live picker for it, RefKind, docs/adr/0009).",
		ConfigFields: []ConfigField{
			{
				Key: "listId", Label: "List ID",
				Description: "The ID of a list configured on the Configure page.",
				Default:     "", Type: FieldText, RefKind: "list",
			},
			{
				Key: "inputKey", Label: "Input attribute",
				Description: "Which Attributes field's value to look up.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "outputKey", Label: "Output attribute",
				Description: "Which Attributes field the matched value gets written to.",
				Default:     "", Type: FieldText,
			},
			{
				// Explicit miss behavior (goal 0001 node maturity): the
				// old node always failed the run on a miss, with no way
				// to say "that's fine, continue." Default stays "fail" so
				// every persisted node behaves exactly as before.
				Key: "onMiss", Label: "If no match", Type: FieldOptions,
				Description: "What to do when the input value isn't in the list.",
				Default:     "fail",
				Options:     []string{"fail", "continue", "default"},
			},
			{
				Key: "defaultValue", Label: "Default value",
				Description: "Written to the output attribute when there's no match and \"If no match\" is \"default\".",
				Default:     "", Type: FieldText,
			},
			{
				// docs/adr/0040 decision 4's version pin, applied to List
				// by goal 0070 -- same shape and precedent as
				// decision-outcome's own "version" config.
				Key: "version", Label: "Pin to version (optional)",
				Description: "Leave empty to always resolve this List's current rows. Enter a version number to pin this step to that exact published snapshot, unaffected by later row edits.",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		pinned, err := listPinnedVersion(node)
		if err != nil {
			return ctx, fmt.Errorf("list-lookup: %w", err)
		}
		rl, err := lookupListFn(node.Config["listId"], pinned)
		if err != nil {
			return ctx, fmt.Errorf("list-lookup: %w", err)
		}

		// The resolved version stamp is recorded alongside the matched
		// value under a key derived from outputKey (never a fixed key --
		// two list-lookup nodes in one workflow could otherwise collide
		// on the same Attributes entry), the same run-stamping audit
		// trail decision-outcome's own resolvedVersion establishes.
		if outKey := node.Config["outputKey"]; outKey != "" {
			ctx.Attributes[outKey+"_version"] = rl.VersionStamp
		}

		inputVal := fmt.Sprintf("%v", ctx.Attributes[node.Config["inputKey"]])
		matched, ok := rl.Entries[inputVal]
		if !ok {
			switch node.Config["onMiss"] {
			case "continue":
				// Leave Attributes unchanged, proceed -- an explicit
				// "a miss is fine" (goal 0001).
				return ctx, nil
			case "default":
				ctx.Attributes[node.Config["outputKey"]] = node.Config["defaultValue"]
				return ctx, nil
			default: // "fail" and any legacy-empty value
				return ctx, fmt.Errorf("list-lookup: no entry for %q", inputVal)
			}
		}
		ctx.Attributes[node.Config["outputKey"]] = matched
		return ctx, nil
	})
}
