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
// ReferenceKindID is the seeded Reference kind's stable id -- the
// exported name exists because the service layer defaults kind-less
// structural cards (a table projection created from the size picker)
// to it: the least semantic seeded kind, editable afterwards like any
// card's.
const ReferenceKindID = "atlas-kind-reference"

const (
	// kindSpaceID no longer appears in BuiltInKinds() -- containment is
	// a role every card already carries (ADR-0038 Decision 3), so a
	// dedicated container Kind added nothing a Kind-agnostic card with
	// children didn't already have. The constant stays so
	// RetiredBuiltInKindIDs can still name it for reconcile's retirement
	// pass, and so any still-existing installs' stored KindID references
	// remain a recognizable, if orphaned, string during that pass.
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
	// kindReferenceID (goal 0081 slice A3) is the instant single-file-
	// drop door's own fallback Kind: a dropped file whose extension
	// isn't in the document family still lands as a typed card, never
	// refused (LOCKED design §3b -- "a file card is a link path to
	// somewhere in the filesystem anyway").
	kindReferenceID = ReferenceKindID
	// kindComponentID (goal 0095 slice 3) is the seeded perspectives
	// example's own Kind, dedicated rather than reusing Topic so the
	// three landscape cards below never join Topic's own seeded count
	// (atlas-jump.spec.ts's "Topic: " scope asserts an exact census of
	// the four pre-existing Topic cards).
	kindComponentID = "atlas-kind-component"
	// kindDeliveredFeatureID (goal 0164 L1) is the delivery-evidence
	// ledger's own Kind: cards mirrored from docs/goals/archive's
	// frontmatter by the seeded "Example: Delivery ledger" workflow.
	kindDeliveredFeatureID = "atlas-kind-delivered-feature"

	linkKindRelatesToID = "atlas-linkkind-relates-to"

	cardMySpaceID     = "atlas-card-my-space"
	cardExampleAreaID = "atlas-card-example-area"
	cardGettingID     = "atlas-card-getting-started"
	cardContactID     = "atlas-card-example-contact"
	cardDocumentID    = "atlas-card-example-document"
	cardScratchpadID  = "atlas-card-scratchpad"
	// The seeded perspectives example (goal 0095 slice 3, ADR-0041): a
	// tiny reference-architecture landscape nested under its own
	// container (never a direct child of "The engagement" -- every existing
	// top-level census, e.g. atlas-projections.spec.ts's coverage
	// stat and atlas-scale.spec.ts's dense-fixture edge count, is
	// pinned to the pre-existing shape one level up).
	cardSystemLandscapeID = "atlas-card-system-landscape"
	cardWebAppID          = "atlas-card-web-app"
	cardDataStoreID       = "atlas-card-data-store"
	cardSyncServiceID     = "atlas-card-sync-service"

	// BuiltInScratchpadCardID is the seeded Scratchpad inbox area --
	// exported because the clipboard bridge's note route (goal 0099)
	// lands notes there from the service layer.
	BuiltInScratchpadCardID = cardScratchpadID

	linkGettingToContactID  = "atlas-link-getting-to-contact"
	linkContactToDocumentID = "atlas-link-contact-to-document"
	linkWebToStoreID        = "atlas-link-web-to-store"
	linkWebToSyncID         = "atlas-link-web-to-sync"
	linkSyncToStoreID       = "atlas-link-sync-to-store"

	perspectiveCurrentID = "atlas-perspective-current"
	perspectiveInterimID = "atlas-perspective-interim"
	perspectiveTargetID  = "atlas-perspective-target"
)

// BuiltInKinds returns the seeded example card types -- pure config,
// no persistence (mirrors list.BuiltIn/decision.BuiltIn's shape:
// atlassvc owns seeding/top-up, this package stays free of the
// settings-store concern). Every card can already contain (ADR-0038
// Decision 3), so containment needs no dedicated container Kind of its
// own -- Topic/Contact/Document are the worked examples ADR-0038's
// Decision 2 requires: ordinary, fully-editable seeded data, never a
// built-in concept.
func BuiltInKinds() []Kind {
	now := time.Now()
	return []Kind{
		{
			ID: kindTopicID, Label: "Topic", Icon: "🧭",
			Description: "Something being tracked or worked through.",
			Fields: []typedfield.Field{
				{Key: "summary", Label: "Summary", Type: typedfield.TypeText, Multiline: true},
				{Key: "status", Label: "Status", Type: typedfield.TypeOptions,
					Options: []string{"Open", "In progress", "Done"}, Default: "Open", ShowOnCard: true},
			},
			CreatedAt: now, UpdatedAt: now,
			// rev 3: status gains ShowOnCard (docs/goals/0152).
			BuiltIn: true, Seed: seedorigin.Stamp(3),
		},
		{
			ID: kindContactID, Label: "Contact", Icon: "👤",
			Description: "A person, with how to reach them.",
			Fields: []typedfield.Field{
				{Key: "email", Label: "Email", Type: typedfield.TypeText},
				{Key: "role", Label: "Role", Type: typedfield.TypeText},
				{Key: "horizon", Label: "Horizon", Type: typedfield.TypeOptions, Options: []string{"Now", "Next", "Then"}},
			},
			CreatedAt: now, UpdatedAt: now,
			// rev 3: horizon field added (docs/goals/0212).
			BuiltIn: true, Seed: seedorigin.Stamp(3),
		},
		{
			ID: kindDocumentID, Label: "Document", Icon: "📄",
			Description: "A reference to written material, on this machine or elsewhere.",
			Fields: []typedfield.Field{
				{Key: "owner", Label: "Owner", Type: typedfield.TypeText},
				// The seeded cardref example (docs/goals/0152 slice 2).
				// Additive next to the older free-text owner: converting
				// a saved field's type is exactly what the evolution
				// guard forbids, seeds included.
				{Key: "person", Label: "Person", Type: typedfield.TypeCardRef, RefKind: kindContactID},
				{Key: "horizon", Label: "Horizon", Type: typedfield.TypeOptions, Options: []string{"Now", "Next", "Then"}},
			},
			CreatedAt: now, UpdatedAt: now,
			// rev 4: horizon field added (docs/goals/0212).
			BuiltIn: true, Seed: seedorigin.Stamp(4),
		},
		{
			ID: kindIntakeID, Label: "Intake", Icon: "📥",
			Description: "Something that just arrived, waiting to be triaged.",
			Fields: []typedfield.Field{
				{Key: "status", Label: "Status", Type: typedfield.TypeOptions,
					Options: []string{"New", "Processed"}, Default: "New"},
			},
			CreatedAt: now, UpdatedAt: now,
			// rev 3: description rewritten to plain user-facing copy --
			// it used to cite an ADR/goal id, which .claude/rules/
			// ux-writing.md forbids in any string a user reads.
			BuiltIn: true, Seed: seedorigin.Stamp(3),
		},
		{
			ID: kindReferenceID, Label: "Reference", Icon: "🔗",
			Description: "Something linked in, not further categorized.",
			CreatedAt:   now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			ID: kindComponentID, Label: "Component", Icon: "🧩",
			Description: "A system or service in an architecture.",
			CreatedAt:   now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			// The delivery-evidence ledger (goal 0164 L1): every field
			// below splits mirror-owned (re-synced from a goal file's own
			// frontmatter, never hand-edited) from owner-owned (only the
			// person reviewing evidence ever sets these; a re-sync must
			// never touch them -- the ledger's whole durability promise).
			ID: kindDeliveredFeatureID, Label: "Delivered feature", Icon: "📦",
			Description: "A shipped goal, with its evidence and your sign-off.",
			Fields: []typedfield.Field{
				// Mirror-owned: the ledger sync's generic frontmatter
				// coercion (internal/domain/atlas.CoerceFrontmatterFields)
				// writes these via MergeCardFields, which touches only the
				// keys it's given -- signoff/verifiedAt/notes below are
				// never in that map.
				{Key: "goalId", Label: "Goal", Type: typedfield.TypeText, FrontmatterAliases: []string{"id"}},
				{
					Key: "shippedDate", Label: "Shipped", Type: typedfield.TypeDate, ShowOnCard: true,
					FrontmatterAliases: []string{"date"},
				},
				{Key: "prs", Label: "PRs", Type: typedfield.TypeText, Multiline: true},
				{Key: "proof", Label: "Proof", Type: typedfield.TypeText, Multiline: true},
				// Owner-owned: durable verification state a re-sync must
				// preserve. StampOnChange means verifiedAt is written by
				// the service the moment signoff leaves its Default, not
				// by whatever the edit form happens to submit.
				{
					Key: "signoff", Label: "Sign-off", Type: typedfield.TypeOptions,
					Options: []string{"pending-verify", "verified", "verified-with-notes"},
					Default: "pending-verify", ShowOnCard: true, StampOnChange: "verifiedAt",
					// The ledger is L3's first consumer of the container
					// rollup facet (docs/goals/0164 L3), not a hardcoded
					// case -- both terminal sign-off states count as
					// "done" for the "<done> of <total>" badge on the
					// Delivered features container.
					RollupDoneValues: []string{"verified", "verified-with-notes"},
				},
				{Key: "verifiedAt", Label: "Verified", Type: typedfield.TypeDate, SystemManaged: true},
				{Key: "notes", Label: "Notes", Type: typedfield.TypeText, Multiline: true},
			},
			CreatedAt: now, UpdatedAt: now,
			// rev 3: signoff gained RollupDoneValues (additive, same
			// Key/Type/Options -- ValidateFieldEvolution's identity
			// freeze is untouched) so the container the ledger's cards
			// are filed under shows a "<done> of <total>" rollup.
			BuiltIn: true, Seed: seedorigin.Stamp(3),
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

// BuiltInCards returns the seeded example space: a root card ("The
// engagement", canvas mode) holding a Topic card, a Scratchpad, and
// one nested Topic-kind card ("Client records", shelves mode) which in
// turn holds a Contact and a mirrored Document -- the proof that
// containment, per-container view mode, and the mirror attributes
// (Source set, MirrorPath empty until a refresh runs) all work end to
// end. Every title/note/field value below tells one story (goal 0118
// slice 1, ratified world "the engagement": one consultant running a
// client engagement end to end) -- the structural shape (which card
// contains which, which kind, which link) is unchanged from what
// shipped before. "The engagement" and "Client records" render as
// region frames purely because they hold children (ADR-0038 Decision
// 3's containment role), not because of any Kind of their own -- both
// are ordinary Topic cards, proving that decoupling by construction.
func BuiltInCards() []Card {
	now := time.Now()
	return []Card{
		{
			ID: cardMySpaceID, KindID: kindTopicID, Title: "The engagement",
			ParentID: "", ViewMode: ViewModeCanvas,
			CreatedAt: now, UpdatedAt: now,
			// rev 6: re-skinned into the engagement story (goal 0118 slice 1).
			BuiltIn: true, Seed: seedorigin.Stamp(6),
		},
		{
			ID: cardExampleAreaID, KindID: kindTopicID, Title: "Client records",
			ParentID: cardMySpaceID, ViewMode: ViewModeShelves,
			Position:  &Position{X: 80, Y: 80},
			CreatedAt: now, UpdatedAt: now,
			// rev 6: re-skinned into the engagement story (goal 0118 slice 1).
			BuiltIn: true, Seed: seedorigin.Stamp(6),
		},
		{
			// Position clears "Client records"'s own region-frame footprint
			// (goal 0072 slice A: a card holding cards now renders as a
			// frame sized to fit its children inline, wider than a bare
			// note card) -- 532 keeps this card from landing underneath
			// that frame in Free/canvas mode.
			ID: cardGettingID, KindID: kindTopicID, Title: "Discovery workstream",
			Note:      "First working session with the client. Scope and next steps confirmed.",
			ParentID:  cardMySpaceID,
			Position:  &Position{X: 532, Y: 80},
			Fields: map[string]string{
				"summary": "Confirm scope, stakeholders, and what a finished engagement looks like.",
				"status":  "Open",
			},
			CreatedAt: now, UpdatedAt: now,
			// rev 6: re-skinned into the engagement story (goal 0118 slice 1).
			BuiltIn: true, Seed: seedorigin.Stamp(6),
		},
		{
			// The Scratchpad seed (goal 0081 slice A3): a CONTAINER card,
			// not a structured Topic instance in its own right -- notes
			// (outside the Card/seed system entirely, atlasnote.go) arrive
			// here at runtime, never seeded, so this card carries no fields
			// of its own and holds no children on install. Kind stays
			// Topic (containment is a role every card already carries,
			// ADR-0038 Decision 3 -- there is no dedicated container Kind).
			ID: cardScratchpadID, KindID: kindTopicID, Title: "Scratchpad",
			Note:      "Meeting notes and quick captures land here. Drag them out to file, or promote into cards.",
			ParentID:  cardMySpaceID,
			Position:  &Position{X: 746, Y: 80},
			CreatedAt: now, UpdatedAt: now,
			// rev 6: note re-skinned into the engagement story (goal 0118
			// slice 1) -- the card's ROLE and ID are unchanged, referenced
			// by the clipboard bridge via BuiltInScratchpadCardID.
			BuiltIn: true, Seed: seedorigin.Stamp(6),
		},
		{
			ID: cardContactID, KindID: kindContactID, Title: "Jordan Reyes",
			ParentID:  cardExampleAreaID,
			Fields:    map[string]string{"email": "jordan@example.com", "role": "Client sponsor", "horizon": "Now"},
			CreatedAt: now, UpdatedAt: now,
			// rev 6: horizon tag added, the Roadmap view's own seeded
			// demonstration (docs/goals/0212).
			BuiltIn: true, Seed: seedorigin.Stamp(6),
		},
		{
			// The seeded action (goal 0061 slice C, generalized by 0084) proves "Update now"
			// live from seeds alone: composition.ExampleChildWorkflowID
			// is deterministic (no clipboard, no network) and already
			// PUBLISHED, the same requirement RunKindTriggered holds
			// every refresh workflow to.
			ID: cardDocumentID, KindID: kindDocumentID, Title: "Statement of work",
			ParentID:          cardExampleAreaID,
			Source:            "https://example.com/statement-of-work",
			Fields:            map[string]string{"owner": "Jordan Reyes", "person": cardContactID},
			ActionWorkflowIDs: []string{composition.ExampleChildWorkflowID},
			CreatedAt:         now, UpdatedAt: now,
			// rev 7: re-skinned into the engagement story (goal 0118 slice 1).
			BuiltIn: true, Seed: seedorigin.Stamp(7),
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

// BuiltInPerspectives seeds NO perspectives. Perspectives are a
// platform capability; a named set like "Current/Interim/Target" is a
// modeling concept the USER authors -- shipping one made it read as a
// native option in the switcher on every install (the inner-platform
// smell SPEC section 0 exists to prevent). The capability's proof
// lives at the test layer (dedicated-server e2e + Go integration
// tests build their own perspectives) and in the docs, never as
// always-present named objects in user data. The retired IDs below
// remove the previously-shipped set from existing installs.
func BuiltInPerspectives() []Perspective {
	return nil
}

// RetiredBuiltInKindIDs names a built-in Kind ID that once shipped in
// BuiltInKinds() and no longer does -- atlassvc's reconcile pass uses
// this to remove/tombstone a leftover copy from an existing install,
// once nothing references it anymore, mirroring the same insert/
// upgrade/leave-alone-once-Modified discipline BuiltInKinds' own
// callers already apply, just in the opposite direction.
func RetiredBuiltInKindIDs() []string {
	return []string{kindSpaceID}
}

// RetiredKindReplacementID names the built-in Kind that cards of a
// retired built-in Kind are migrated to during reconcile. Retirement
// must never orphan or delete a user's cards -- they carry over to the
// replacement so the retired Kind can actually reach zero references
// and be tombstoned.
func RetiredKindReplacementID(retiredID string) (string, bool) {
	if retiredID == kindSpaceID {
		return kindTopicID, true
	}
	return "", false
}

// RetiredBuiltInCardIDs names built-in cards that once shipped and no
// longer do -- the reference-architecture landscape (its concept now
// user-authored, never seeded). Reconcile removes an install's copy
// exactly when it is still an untouched golden (Seed.Modified false);
// an edited copy belongs to the user and stays.
func RetiredBuiltInCardIDs() []string {
	return []string{cardWebAppID, cardDataStoreID, cardSyncServiceID, cardSystemLandscapeID}
}

// RetiredBuiltInLinkIDs names the retired landscape's own links, same
// contract as RetiredBuiltInCardIDs.
func RetiredBuiltInLinkIDs() []string {
	return []string{linkWebToStoreID, linkWebToSyncID, linkSyncToStoreID}
}

// RetiredBuiltInPerspectiveIDs names the previously-seeded perspective
// set, same contract as RetiredBuiltInCardIDs.
func RetiredBuiltInPerspectiveIDs() []string {
	return []string{perspectiveCurrentID, perspectiveInterimID, perspectiveTargetID}
}
