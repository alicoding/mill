package configuresvc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

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
// resolveHTTPRequest/resolveList/resolveMCPServer.
func (c *ConfigureService) resolveDecision(id string) (composition.ResolvedDecision, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, d := range c.decisions {
		if d.ID == id {
			return composition.ResolvedDecision{
				Label: d.Label, Category: string(d.Category), Outputs: d.Outputs, WebhookRequestID: d.WebhookRequestID,
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

	c.mu.Lock()
	c.decisions = append(c.decisions, d)
	c.mu.Unlock()

	if err := c.persistDecisions(); err != nil {
		c.mu.Lock()
		for i, existing := range c.decisions {
			if existing.ID == d.ID {
				c.decisions = append(c.decisions[:i], c.decisions[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return decision.Decision{}, fmt.Errorf("save decision: %w", err)
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
	c.mu.Lock()
	idx := -1
	for i, existing := range c.decisions {
		if existing.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return decision.Decision{}, fmt.Errorf("no decision with id %q", id)
	}
	existing := c.decisions[idx]
	c.mu.Unlock()

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
		// Modified latch (docs/goals/0037 item 2), same reasoning as
		// httprequest's UpdateHTTPRequest.
		Seed: existing.Seed.Touch(),
	}
	if err := decision.Validate(d); err != nil {
		return decision.Decision{}, err
	}

	c.mu.Lock()
	idx = -1
	for i, e := range c.decisions {
		if e.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return decision.Decision{}, fmt.Errorf("no decision with id %q", id)
	}
	previous := c.decisions[idx]
	c.decisions[idx] = d
	c.mu.Unlock()

	if err := c.persistDecisions(); err != nil {
		c.mu.Lock()
		for i, existing := range c.decisions {
			if existing.ID == id {
				c.decisions[i] = previous
				break
			}
		}
		c.mu.Unlock()
		return decision.Decision{}, fmt.Errorf("save decision: %w", err)
	}
	dataevent.Emit("decision", d.ID) // goal 0017: live-sync every open surface
	return d, nil
}

func (c *ConfigureService) DeleteDecision(id string) error {
	if err := c.refIntegrityError("decision", "decision", id); err != nil {
		return err
	}

	c.mu.Lock()
	idx := -1
	for i, d := range c.decisions {
		if d.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no decision with id %q", id)
	}
	removed := c.decisions[idx]
	wasBuiltIn := removed.BuiltIn
	c.decisions = append(c.decisions[:idx], c.decisions[idx+1:]...)
	c.mu.Unlock()

	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it (topUpBuiltInDecisions, configureservice_builtin.go)
	// -- same discipline DeleteHTTPRequest already applies. Removal and
	// tombstone must succeed together (docs/goals/0025 item 2).
	if wasBuiltIn {
		if err := seeding.RecordTombstone(c.store, id); err != nil {
			c.mu.Lock()
			c.decisions = insertDecisionAt(c.decisions, idx, removed)
			c.mu.Unlock()
			return fmt.Errorf("tombstone deleted decision %q: %w", id, err)
		}
	}
	if err := c.persistDecisions(); err != nil {
		c.mu.Lock()
		c.decisions = insertDecisionAt(c.decisions, idx, removed)
		c.mu.Unlock()
		return fmt.Errorf("save decision deletion: %w", err)
	}
	dataevent.Emit("decision", id) // goal 0017: live-sync every open surface
	return nil
}

// insertDecisionAt reinserts d at idx (clamped to the current length)
// -- used to undo DeleteDecision's removal when the tombstone or
// persist step that must accompany it fails.
func insertDecisionAt(decisions []decision.Decision, idx int, d decision.Decision) []decision.Decision {
	if idx < 0 || idx > len(decisions) {
		idx = len(decisions)
	}
	decisions = append(decisions, decision.Decision{})
	copy(decisions[idx+1:], decisions[idx:])
	decisions[idx] = d
	return decisions
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
	c.mu.Lock()
	decisions := make([]decision.Decision, len(c.decisions))
	copy(decisions, c.decisions)
	c.mu.Unlock()

	data, err := json.Marshal(decisions)
	if err != nil {
		return fmt.Errorf("marshal decisions: %w", err)
	}
	if err := c.store.Set(decisionsKey, string(data)); err != nil {
		return fmt.Errorf("persist decisions: %w", err)
	}
	return nil
}

func (c *ConfigureService) restoreDecisions() {
	raw, ok := c.store.Get(decisionsKey).(string)
	if !ok || raw == "" {
		return
	}
	var decisions []decision.Decision
	if err := json.Unmarshal([]byte(raw), &decisions); err != nil {
		return
	}
	c.mu.Lock()
	c.decisions = decisions
	c.mu.Unlock()
}
