package decision

import "github.com/alicoding/mill/internal/domain/seedorigin"

// Seeded example Decisions (docs/adr/0027, and the standing "the seed
// IS the proof" rule, .claude/rules/testing.md): one per category the
// v1 seeded workflows exercise. Approve/Deny share an output shape
// (an enum + a score) specifically so the seeded branch workflow
// (composition.BuiltInWorkflows) can bind the same Attribute into
// either terminal depending on which branch a run takes -- proving the
// typed-outcome contract is real, not just declared.
const (
	ExampleApproveID      = "example-approve-decision"
	ExampleDenyID         = "example-deny-decision"
	ExampleManualReviewID = "example-manual-review-decision"
)

// approveDenyOutputs mirrors composition.FieldText/FieldNumber's own
// wire values ("text"/"number") without importing composition (see
// OutputField's own doc comment for why).
var approveDenyOutputs = []OutputField{
	{Key: "decision", Label: "Decision", Type: "text", Options: []string{"APPROVED", "DECLINED"}},
	{Key: "score", Label: "Score", Type: "number"},
}

// approveV1Outputs is a defensive copy of approveDenyOutputs frozen
// into ExampleApproveID's published v1 (below) -- copied rather than
// shared so a future edit to approveDenyOutputs (Deny's own live
// shape) can never accidentally reach back and mutate an already-
// "published" snapshot through a shared backing array.
var approveV1Outputs = append([]OutputField{}, approveDenyOutputs...)

// BuiltIn returns the seeded example Decisions -- pure config, no
// persistence (mirrors httprequest.BuiltIn's shape: this package stays
// free of the settings-store concern, per CLAUDE.md's backend rule --
// ConfigureService owns seeding/top-up).
func BuiltIn() []Decision {
	return []Decision{
		{
			ID: ExampleApproveID, Label: "Approve", Category: CategoryApprove,
			// The live draft carries an ADDITIONAL field ("reviewNote") past
			// what v1 (below) published (docs/adr/0040 decisions 4-5's seeded
			// proof): the seeded parent-branch workflow's PINNED outcome node
			// (composition.BuiltInWorkflows) resolves v1's two-field shape
			// regardless of this drift; its unpinned sibling resolves this
			// three-field live shape -- proving both resolution paths on one
			// entity, not just declared.
			Outputs: append(append([]OutputField{}, approveDenyOutputs...),
				OutputField{Key: "reviewNote", Label: "Review note (live only)", Type: "text"}),
			BuiltIn: true, Seed: seedorigin.Stamp(4),
			PublishedVersion: 1,
			Versions: []DecisionVersion{{
				Version: 1, Label: "Approve", Category: CategoryApprove,
				Outputs: approveV1Outputs,
			}},
		},
		{
			ID: ExampleDenyID, Label: "Deny", Category: CategoryDeny,
			Outputs: approveDenyOutputs, BuiltIn: true, Seed: seedorigin.Stamp(4),
		},
		{
			ID: ExampleManualReviewID, Label: "Manual review", Category: CategoryManualReview,
			// legacyPriority is the seeded proof for docs/adr/0040 decision
			// 2: a Deprecated output field, still valid on any past run's
			// bound value, de-emphasized in this Decision's own edit form
			// and excluded from a decision-outcome node's new binding rows.
			Outputs: []OutputField{
				{Key: "reviewedBy", Label: "Reviewed by", Type: "text"},
				{Key: "legacyPriority", Label: "Priority (legacy)", Type: "text", Deprecated: true},
			},
			BuiltIn: true, Seed: seedorigin.Stamp(4),
		},
	}
}
