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

// BuiltIn returns the seeded example Decisions -- pure config, no
// persistence (mirrors httprequest.BuiltIn's shape: this package stays
// free of the settings-store concern, per CLAUDE.md's backend rule --
// ConfigureService owns seeding/top-up).
func BuiltIn() []Decision {
	return []Decision{
		{
			ID: ExampleApproveID, Label: "Approve (example)", Category: CategoryApprove,
			Outputs: approveDenyOutputs, BuiltIn: true, Seed: seedorigin.Stamp(2),
		},
		{
			ID: ExampleDenyID, Label: "Deny (example)", Category: CategoryDeny,
			Outputs: approveDenyOutputs, BuiltIn: true, Seed: seedorigin.Stamp(2),
		},
		{
			ID: ExampleManualReviewID, Label: "Manual review (example)", Category: CategoryManualReview,
			// legacyPriority is the seeded proof for docs/adr/0040 decision
			// 2: a Deprecated output field, still valid on any past run's
			// bound value, de-emphasized in this Decision's own edit form
			// and excluded from a decision-outcome node's new binding rows.
			Outputs: []OutputField{
				{Key: "reviewedBy", Label: "Reviewed by", Type: "text"},
				{Key: "legacyPriority", Label: "Priority (legacy)", Type: "text", Deprecated: true},
			},
			BuiltIn: true, Seed: seedorigin.Stamp(2),
		},
	}
}
