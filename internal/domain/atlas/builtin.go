package atlas

import (
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// This file is the ONE place a card-type or link-type NAME may appear
// in Go source (ADR-0038 Decision 2, docs/goals/0061): every ID/Label/
// Description below is a seeded EXAMPLE, exactly as user-editable and
// deletable as anything a user declares themselves (docs/SPEC.md
// §2.2) -- atlassvc's own no-hardcode tripwire test greps this
// package and internal/services/atlassvc, this file excluded, for
// these exact strings.
const (
	kindSpaceID    = "atlas-kind-space"
	kindTopicID    = "atlas-kind-topic"
	kindContactID  = "atlas-kind-contact"
	kindDocumentID = "atlas-kind-document"
	// kindIntakeID (goal 0066, ADR-0035/0038's composed integration
	// example) is a dedicated seeded example kind so the seeded
	// "Example: Card intake" workflow (internal/domain/composition/
	// builtinworkflows_atlascard.go) has a real card-type to watch
	// without retrofitting automated behavior onto the unrelated Topic
	// example above.
	kindIntakeID = "atlas-kind-intake"

	linkKindRelatesToID = "atlas-linkkind-relates-to"

	cardMySpaceID     = "atlas-card-my-space"
	cardExampleAreaID = "atlas-card-example-area"
	cardGettingID     = "atlas-card-getting-started"
	cardContactID     = "atlas-card-example-contact"
	cardDocumentID    = "atlas-card-example-document"

	linkGettingToContactID  = "atlas-link-getting-to-contact"
	linkContactToDocumentID = "atlas-link-contact-to-document"
)

// BuiltInKinds returns the seeded example card types -- pure config,
// no persistence (mirrors list.BuiltIn/decision.BuiltIn's shape:
// atlassvc owns seeding/top-up, this package stays free of the
// settings-store concern). "Space" is a generic container kind (every
// card can already contain per ADR-0038 Decision 3; Space just gives
// a purely-organizational card something to call itself) -- Topic/
// Contact/Document are the worked examples ADR-0038's Decision 2
// requires: ordinary, fully-editable seeded data, never a built-in
// concept.
func BuiltInKinds() []Kind {
	now := time.Now()
	return []Kind{
		{
			ID: kindSpaceID, Label: "Space", Icon: "🗂️",
			Description: "A container for organizing other cards.",
			Fields:      nil,
			CreatedAt:   now, UpdatedAt: now,
			// SeedRevision 2: atlas.Kind gained FieldTombstones (goal
			// 0063's absorbed 0046 leftover) -- structural only, no
			// change to Fields itself.
			BuiltIn: true, Seed: seedorigin.Stamp(2),
		},
		{
			ID: kindTopicID, Label: "Topic", Icon: "🧭",
			Description: "Something being tracked or worked through.",
			Fields: []typedfield.Field{
				{Key: "summary", Label: "Summary", Type: typedfield.TypeText, Multiline: true},
				{Key: "status", Label: "Status", Type: typedfield.TypeOptions,
					Options: []string{"Open", "In progress", "Done"}, Default: "Open"},
			},
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(2), // FieldTombstones added, structural only
		},
		{
			ID: kindContactID, Label: "Contact", Icon: "👤",
			Description: "A person, with how to reach them.",
			Fields: []typedfield.Field{
				{Key: "email", Label: "Email", Type: typedfield.TypeText},
				{Key: "role", Label: "Role", Type: typedfield.TypeText},
			},
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(2), // FieldTombstones added, structural only
		},
		{
			ID: kindDocumentID, Label: "Document", Icon: "📄",
			Description: "A reference to written material, on this machine or elsewhere.",
			Fields: []typedfield.Field{
				{Key: "owner", Label: "Owner", Type: typedfield.TypeText},
			},
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(2), // FieldTombstones added, structural only
		},
		{
			ID: kindIntakeID, Label: "Intake", Icon: "📥",
			Description: "Something arriving to be triaged -- the seeded card-intake workflow " +
				"example (docs/adr/0038, goal 0066) watches this kind and stamps its own status.",
			Fields: []typedfield.Field{
				{Key: "status", Label: "Status", Type: typedfield.TypeOptions,
					Options: []string{"New", "Processed"}, Default: "New"},
			},
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(2), // FieldTombstones added, structural only
		},
	}
}

// BuiltInLinkKinds returns the seeded example relation types.
func BuiltInLinkKinds() []LinkKind {
	now := time.Now()
	return []LinkKind{
		{
			ID: linkKindRelatesToID, Label: "relates to",
			Description: "A general association between two cards.",
			CreatedAt:   now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
	}
}

// BuiltInCards returns the seeded example space: a root container
// ("My space", canvas mode) holding one Topic card and one nested
// container ("Example area", shelves mode) which in turn holds a
// Contact and a mirrored Document -- the proof that containment,
// per-container view mode, and the mirror attributes (Source set,
// MirrorPath empty until a refresh runs) all work end to end.
func BuiltInCards() []Card {
	now := time.Now()
	return []Card{
		{
			ID: cardMySpaceID, KindID: kindSpaceID, Title: "My space",
			ParentID: "", ViewMode: ViewModeCanvas,
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			ID: cardExampleAreaID, KindID: kindSpaceID, Title: "Example area",
			ParentID: cardMySpaceID, ViewMode: ViewModeShelves,
			Position:  &Position{X: 80, Y: 80},
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			ID: cardGettingID, KindID: kindTopicID, Title: "Getting started",
			Note:      "Declare a Kind, drop a card, link it to something.",
			ParentID:  cardMySpaceID,
			Position:  &Position{X: 320, Y: 80},
			Fields:    map[string]string{"summary": "How this space is organized.", "status": "Open"},
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			ID: cardContactID, KindID: kindContactID, Title: "Ada Lovelace",
			ParentID:  cardExampleAreaID,
			Fields:    map[string]string{"email": "ada@example.com", "role": "Point of contact"},
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			// RefreshWorkflowID (goal 0061 slice C) proves "Update now"
			// live from seeds alone: composition.ExampleChildWorkflowID
			// is deterministic (no clipboard, no network) and already
			// PUBLISHED, the same requirement RunKindTriggered holds
			// every refresh workflow to.
			ID: cardDocumentID, KindID: kindDocumentID, Title: "Project charter",
			ParentID:          cardExampleAreaID,
			Source:            "https://example.com/project-charter",
			Fields:            map[string]string{"owner": "Ada Lovelace"},
			RefreshWorkflowID: composition.ExampleChildWorkflowID,
			CreatedAt:         now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(2),
		},
	}
}

// BuiltInLinks returns the seeded example relations connecting the
// seeded cards above.
func BuiltInLinks() []Link {
	now := time.Now()
	return []Link{
		{
			ID: linkGettingToContactID, FromCardID: cardGettingID, ToCardID: cardContactID,
			LinkKindID: linkKindRelatesToID,
			CreatedAt:  now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			ID: linkContactToDocumentID, FromCardID: cardContactID, ToCardID: cardDocumentID,
			LinkKindID: linkKindRelatesToID,
			CreatedAt:  now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
	}
}
