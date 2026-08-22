package configuresvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// decisionDescriptor is Decision's entitystore.Descriptor (goal
// 0165): the small per-kind shape Create/Update/Delete/reconcile/
// Reset/Restorable/Restore all key off, replacing what used to be
// ~10 hand-copied methods.
var decisionDescriptor = entitystore.Descriptor[decision.Decision]{
	Label:     "decision",
	GetID:     func(d decision.Decision) string { return d.ID },
	IsBuiltIn: func(d decision.Decision) bool { return d.BuiltIn },
	GetSeed:   func(d decision.Decision) seedorigin.Origin { return d.Seed },
	SetSeed:   func(d decision.Decision, o seedorigin.Origin) decision.Decision { d.Seed = o; return d },
	StampNew: func(d decision.Decision, now time.Time) decision.Decision {
		d.CreatedAt, d.UpdatedAt = now, now
		return d
	},
	Upgrade: upgradeDecisionToGolden,
	BuiltIn: decision.BuiltIn,
}

// findGoldenDecision returns a copy of the golden Decision with id, if
// one exists among decision.BuiltIn().
func findGoldenDecision(id string) (decision.Decision, bool) {
	for _, g := range decision.BuiltIn() {
		if g.ID == id {
			return g, true
		}
	}
	return decision.Decision{}, false
}

// upgradeDecisionToGolden replaces existing's content with golden's,
// preserving existing's identity (ID/CreatedAt) -- shared by
// reconcileBuiltInDecisions' upgrade branch and ResetDecisionToSeed
// via decisionDescriptor.Upgrade.
func upgradeDecisionToGolden(existing, golden decision.Decision, now time.Time) decision.Decision {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

// decisionsKey mirrors requestsKey/listsKey/mcpServersKey's shape
// (configureservice.go/configuremcpserver.go): one atomic JSON blob,
// same settings.json file. In its own file (not appended to
// configureservice.go) to keep that file under CLAUDE.md's 500-line
// convention, same reasoning configuremcpserver.go's own header
// comment already gives.
const decisionsKey = "configure-decisions"

// resolveDecision implements composition.go's lookupDecisionFn seam
// (decisionoutcome.go). Unexported, so Wails never binds it as a
// callable frontend method -- Go-internal wiring only, same as
// resolveHTTPRequest/resolveList/resolveMCPServer. decision.ResolveOutcome
// is the ONE seam that decides live-vs-pinned (docs/adr/0040 decisions
// 4-5); this method's only job is finding the Decision and adapting its
// result to composition's own ResolvedDecision shape.
func (c *ConfigureService) resolveDecision(id string, pinnedVersion int) (composition.ResolvedDecision, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, d := range c.decisions {
		if d.ID == id {
			resolved, err := decision.ResolveOutcome(d, pinnedVersion)
			if err != nil {
				return composition.ResolvedDecision{}, err
			}
			return composition.ResolvedDecision{
				Label: resolved.Label, Category: string(resolved.Category),
				Outputs: resolved.Outputs, WebhookRequestID: resolved.WebhookRequestID,
				Version: resolved.VersionStamp,
			}, nil
		}
	}
	return composition.ResolvedDecision{}, fmt.Errorf("no decision with id %q", id)
}

// --- Decisions ---

func (c *ConfigureService) Decisions() []decision.Decision {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]decision.Decision, len(c.decisions))
	copy(out, c.decisions)
	return out
}

// decisionExistsLocked reports whether id names a real local Decision
// -- callers must hold c.mu. ImportDecision's own create-vs-update
// check (configureservice_export.go).
func (c *ConfigureService) decisionExistsLocked(id string) bool {
	for _, d := range c.decisions {
		if d.ID == id {
			return true
		}
	}
	return false
}

func (c *ConfigureService) CreateDecision(label string, category decision.Category, outputs []decision.OutputField, webhookRequestID string) (decision.Decision, error) {
	return c.createDecisionWithID(seeding.NewSlugID(label, "decision"), label, category, outputs, nil, webhookRequestID)
}

// createDecisionWithID is CreateDecision's own logic, parameterized on
// the new decision's id -- the seam ImportDecision uses to preserve a
// caller-supplied id (ADR-0036 decision 3). fieldTombstones lets an
// import carry a portable export's own deletion history forward onto
// the fresh local entity (nil for every ordinary CreateDecision call,
// which starts with none).
func (c *ConfigureService) createDecisionWithID(id, label string, category decision.Category, outputs []decision.OutputField, fieldTombstones []typedfield.FieldTombstone, webhookRequestID string) (decision.Decision, error) {
	now := time.Now()
	d := decision.Decision{
		ID: id, Label: label, Category: category,
		Outputs: outputs, WebhookRequestID: webhookRequestID, FieldTombstones: fieldTombstones,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := decision.Validate(d); err != nil {
		return decision.Decision{}, err
	}

	if err := entitystore.Insert(&c.mu, &c.decisions, c.persistDecisions, decisionDescriptor, d); err != nil {
		return decision.Decision{}, err
	}
	dataevent.Emit("decision", d.ID) // goal 0017: live-sync every open surface
	return d, nil
}

// UpdateDecision rejects a category change server-side (docs/adr/0027:
// category is immutable after creation -- Duplicate is the migration
// path, same as the reference no-code platform this was designed
// against). category is still a real parameter (not silently dropped
// from the call shape) so the RPC mirrors CreateDecision's own shape;
// the frontend disables the control and always resubmits the existing
// value, but this check is the actual authority, not the disabled
// control alone -- a save-time error and a run-time error never
// disagree, same discipline ValidateGraph's own doc comment names.
// newFieldTombstones names any Key+Type this call is deleting from
// Outputs/Columns right now -- the explicit, UI-declared half of
// docs/adr/0040 decision 3's evolution check (typedfield.
// ValidateFieldEvolution's own doc comment has the full rule).
func (c *ConfigureService) UpdateDecision(id, label string, category decision.Category, outputs []decision.OutputField, newFieldTombstones []typedfield.FieldTombstone, webhookRequestID string) (decision.Decision, error) {
	updated, err := entitystore.Update(&c.mu, &c.decisions, c.persistDecisions, decisionDescriptor, id, func(existing decision.Decision) (decision.Decision, error) {
		if existing.Category != category {
			return decision.Decision{}, fmt.Errorf(
				"a decision's category cannot be changed after creation (it is %q) -- duplicate this decision to create one with a different category",
				existing.Category)
		}

		tombstones := typedfield.MergeTombstones(existing.FieldTombstones, newFieldTombstones)
		if err := typedfield.ValidateFieldEvolution(existing.Outputs, outputs, tombstones); err != nil {
			return decision.Decision{}, err
		}

		d := decision.Decision{
			ID: id, Label: label, Category: category, Outputs: outputs, WebhookRequestID: webhookRequestID, BuiltIn: existing.BuiltIn,
			// CreatedAt is preserved from the stored entity, never trusted
			// from the wire; UpdatedAt always advances on a real update.
			CreatedAt:       existing.CreatedAt,
			UpdatedAt:       time.Now(),
			FieldTombstones: tombstones,
			// Versions/PublishedVersion are preserved untouched (docs/adr/0040
			// decision 4): editing the draft never mutates or drops publish
			// history -- only PublishDecision (configuredecision_versioning.go)
			// is allowed to change either of these.
			Versions:         existing.Versions,
			PublishedVersion: existing.PublishedVersion,
			// Modified latch (docs/goals/0037 item 2), same reasoning as
			// httprequest's UpdateHTTPRequest.
			Seed: existing.Seed.Touch(),
		}
		if err := decision.Validate(d); err != nil {
			return decision.Decision{}, err
		}
		return d, nil
	})
	if err != nil {
		return decision.Decision{}, err
	}
	dataevent.Emit("decision", updated.ID) // goal 0017: live-sync every open surface
	return updated, nil
}

func (c *ConfigureService) DeleteDecision(id string) error {
	if err := c.refIntegrityError("decision", "decision", id); err != nil {
		return err
	}
	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it -- same discipline DeleteHTTPRequest already
	// applies. Removal and tombstone must succeed together
	// (docs/goals/0025 item 2).
	recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
	if err := entitystore.DeleteWithTombstone(&c.mu, &c.decisions, c.persistDecisions, recordTombstone, decisionDescriptor, id); err != nil {
		return err
	}
	dataevent.Emit("decision", id) // goal 0017: live-sync every open surface
	return nil
}

// No DuplicateDecision RPC: checked against the precedent first
// (ADR-0013's own HTTPRequest Duplicate has no backend RPC either --
// RequestSummary.tsx's onDuplicate just pre-fills RequestForm.tsx's
// create form from the source's fields, and Save calls the ordinary
// CreateHTTPRequest). Decision does the same client-side, and it's
// what actually makes "duplicate to change category" work: the
// pre-filled form is still an unsaved CREATE draft, so its category
// control is the normal (enabled) create-time picker, not the
// disabled edit-time one -- UpdateDecision's immutability check is
// never even in the picture until the first Save.

// --- persistence ---

func (c *ConfigureService) persistDecisions() error {
	return entitystore.Persist(&c.mu, &c.decisions, c.store, decisionsKey, decisionDescriptor)
}

func (c *ConfigureService) restoreDecisions() {
	entitystore.Load(&c.mu, &c.decisions, c.store, decisionsKey)
}
