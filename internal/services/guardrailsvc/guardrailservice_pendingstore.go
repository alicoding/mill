package guardrailsvc

// The durable generic pending-action store (docs/adr/0047 §5.4's
// follow-up): one persistence mechanism at the STRONGER guarantee
// mcpsvc.MCPWriteRecord already proved out for MCP writes specifically
// (restart survival, 24h retention, at-most-once apply) -- generalized
// here so any guarded-action caller shares it. RequestGuardedAction
// (guardrailservice_request.go) is the first consumer; mcpsvc's gated-
// write park (millmcpservice_approval.go) is the second, migrated up
// from its own bespoke settings-store persistence rather than the two
// ever unifying at the weaker (in-memory-only) guarantee.
//
// Two distinct consumption shapes share this one store:
//   - RequestGuardedAction: a blocking in-process caller that awaits a
//     raw yes/no directly on the record's own decision channel (via
//     decisionChan/signal below) and unconditionally deletes the
//     record on any exit (decision, ctx-cancel, or timeout) -- no
//     resolved-history consumer, so nothing is retained.
//   - mcpsvc's gated-write park: a courtesy-window waiter (AwaitDecision,
//     guardrailservice_pendingstore_query.go) that returns "still
//     pending" on timeout WITHOUT deleting anything, and a separate,
//     later call (Resolve/Withdraw) durably records the human's
//     decision, retained for 24h the same as the MCP park's own
//     retention.

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/google/uuid"
)

// GuardedActionStatus is one guarded action's lifecycle state -- the
// generalized vocabulary mcpsvc.MCPWriteStatus already proved out for
// MCP writes specifically. String values deliberately match
// mcpsvc.MCPWriteStatus's own literals so mcpsvc's wire/JSON contract
// (check_write_status, Review, the sidebar badge) needs no translation
// at the seam.
type GuardedActionStatus string

const (
	GuardedActionPending   GuardedActionStatus = "pending"
	GuardedActionApproved  GuardedActionStatus = "approved"
	GuardedActionDenied    GuardedActionStatus = "denied"
	GuardedActionExpired   GuardedActionStatus = "expired"
	GuardedActionCancelled GuardedActionStatus = "cancelled"
)

// guardedPendingActionsKey persists every GuardedActionRecord (pending
// and, for guardedActionRetention, resolved) as one JSON blob -- the
// same one-atomic-blob-per-key shape guardrailRulesKey and the retired
// mcpPendingWritesKey (mcpsvc, pre-migration) already used.
const guardedPendingActionsKey = "guardrail-pending-actions"

// defaultGuardedActionRetention is the fallback retention window used
// only at construction time (load's own initial sweep, before any real
// caller has stated an opinion). Every other sweep-triggering method
// takes retention as an explicit parameter instead of reading a shared
// package var -- retention is a CALLER policy (mcpsvc's gated writes
// use their own mcpWriteExpiry, matching docs/adr/0032 §8's fail-safe
// window; a future guarded-action consumer may want a different one),
// not a single global every consumer of this shared store would
// otherwise be forced to agree on.
var defaultGuardedActionRetention = 24 * time.Hour

// GuardedActionRecord is one guarded action's full durable lifecycle
// record -- persisted via the settings store so it survives a restart
// (docs/adr/0032 §1's "the record... is what must be durable",
// generalized beyond MCP writes). Payload is opaque to this package:
// the apply-on-approve consumer's own re-dispatchable request (mcpsvc
// carries {ToolName,ArgsJSON} JSON here) -- a closure can't survive a
// persisted record's trip through a restart, dispatch through an
// opaque payload can.
type GuardedActionRecord struct {
	ID          string              `json:"id"`
	Kind        string              `json:"kind"`
	Attributes  map[string]string   `json:"attributes,omitempty"`
	Description string              `json:"description"`
	Source      string              `json:"source,omitempty"`
	CreatedAt   time.Time           `json:"createdAt"`
	Status      GuardedActionStatus `json:"status"`
	Payload     []byte              `json:"payload,omitempty"`
	// ResultText is the apply callback's own success text, set once
	// approved and the real side effect succeeds.
	ResultText string `json:"resultText,omitempty"`
	// Error explains a denial/withdrawal/expiry, or -- distinctly -- an
	// approved action whose own apply then failed (Status stays
	// "approved", since the human's decision was to approve it; Error
	// then carries the side effect's own failure).
	Error      string     `json:"error,omitempty"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
	// LastPolledAt records the most recent status read for this record
	// (docs/goals/0026 item 3, generalized) -- a pending record nobody
	// has checked on in a while visibly reads as abandoned.
	LastPolledAt *time.Time `json:"lastPolledAt,omitempty"`

	// decision signals a waiter (AwaitDecision, or RequestGuardedAction's
	// own direct select via decisionChan) once Resolve/signal finalizes
	// this record -- unexported, so encoding/json already skips it with
	// no explicit tag needed; rebuilt on load for any record that
	// survived a restart. Buffered size 1: a send must never block on
	// whether anyone is still listening.
	decision chan bool
}

// PendingActionStore is the durable generic pending-action store
// itself -- one settings-store-backed map, guarded by mu, shared by
// every caller that parks a guarded action through it.
type PendingActionStore struct {
	mu      sync.Mutex
	store   settings.Store
	records map[string]*GuardedActionRecord
}

// NewPendingActionStore restores any persisted record and rebuilds
// every pending record's decision channel -- the restart-survival half
// of the durability contract (docs/adr/0032 §1).
func NewPendingActionStore(store settings.Store) *PendingActionStore {
	s := &PendingActionStore{store: store, records: map[string]*GuardedActionRecord{}}
	s.load()
	return s
}

func (s *PendingActionStore) load() {
	if raw, ok := s.store.Get(guardedPendingActionsKey).(string); ok && raw != "" {
		var loaded map[string]*GuardedActionRecord
		if err := json.Unmarshal([]byte(raw), &loaded); err == nil {
			s.records = loaded
		}
	}
	for _, rec := range s.records {
		if rec.decision == nil {
			rec.decision = make(chan bool, 1)
		}
	}
	// Discard the expired list here rather than reporting it: no window
	// is open yet at construction time for anyone to see it, and the
	// record itself is still correctly marked expired either way -- a
	// later Pending/Resolved/Get call sweeps again (with ITS OWN
	// caller-stated retention) and reports normally for anything that
	// expires from then on.
	_ = s.sweepLocked(time.Now(), defaultGuardedActionRetention)
}

// persistLocked marshals every record to the settings store -- caller
// must hold mu. Returns the marshal/store error rather than swallowing
// it (docs/goals/0025 item 1): a park/resolution that silently failed
// to save would look identical to a successful one to its caller.
func (s *PendingActionStore) persistLocked() error {
	data, err := json.Marshal(s.records)
	if err != nil {
		return fmt.Errorf("marshal pending guarded actions: %w", err)
	}
	if err := s.store.Set(guardedPendingActionsKey, string(data)); err != nil {
		return fmt.Errorf("persist pending guarded actions: %w", err)
	}
	return nil
}

func snapshotGuardedAction(rec *GuardedActionRecord) GuardedActionRecord {
	out := *rec
	out.decision = nil // never leak the channel out of the store
	return out
}

// Park persists a new pending record for action, minting its ID and
// CreatedAt -- rolled back (never left phantom-parked) if the durable
// write fails, so a record that failed to durably park never sits in
// memory looking parked.
func (s *PendingActionStore) Park(action GuardedAction, payload []byte) (GuardedActionRecord, error) {
	rec := &GuardedActionRecord{
		ID: uuid.NewString(), Kind: action.Kind, Attributes: action.Attributes,
		Description: action.Description, Source: action.Source, CreatedAt: time.Now(),
		Status: GuardedActionPending, Payload: payload, decision: make(chan bool, 1),
	}
	s.mu.Lock()
	s.records[rec.ID] = rec
	if err := s.persistLocked(); err != nil {
		delete(s.records, rec.ID)
		s.mu.Unlock()
		return GuardedActionRecord{}, fmt.Errorf("park guarded action: %w", err)
	}
	out := snapshotGuardedAction(rec)
	s.mu.Unlock()
	return out, nil
}

// Resolve delivers a reviewer's approve/deny decision to a still-
// pending record -- at-most-once (docs/adr/0032 §1, generalized): apply
// runs INSIDE the same lock hold that checked Status==pending, so two
// concurrent resolutions of the same id can never both observe it
// pending -- no separate compare-and-swap needed. approve=false never
// calls apply; denyReason becomes the record's Error. apply may be nil
// (a guarded action with nothing to apply-on-approve).
//
// Deliberately does NOT roll the record back on a persist failure
// (mirrors mcpsvc's own pre-migration finalizeLocked, docs/goals/0025
// items 1/2): for an approved action, apply's real side effect has
// already run by the time the persist is attempted, so reverting
// Status to pending would let a second Resolve call re-run apply after
// a crash wiped the unpersisted change -- a real double-execution risk
// strictly worse than a resolution that's merely slow to durably
// record. The error is still returned, it just doesn't undo a decision
// that's already real.
func (s *PendingActionStore) Resolve(id string, approve bool, denyReason string, retention time.Duration, apply func(payload []byte) (resultText string, err error)) (rec GuardedActionRecord, expired []GuardedActionRecord, err error) {
	s.mu.Lock()
	expired = s.sweepLocked(time.Now(), retention)
	target, ok := s.records[id]
	if !ok {
		s.mu.Unlock()
		return GuardedActionRecord{}, expired, fmt.Errorf("no guarded action with id %s (it may have already been swept, %s after resolution)", id, retention)
	}
	if target.Status != GuardedActionPending {
		s.mu.Unlock()
		return GuardedActionRecord{}, expired, fmt.Errorf("guarded action %s was already resolved (%s)", id, target.Status)
	}

	now := time.Now()
	switch {
	case !approve:
		target.Status, target.Error = GuardedActionDenied, denyReason
	case apply != nil:
		resultText, applyErr := apply(target.Payload)
		if applyErr != nil {
			target.Status, target.Error = GuardedActionApproved, applyErr.Error()
		} else {
			target.Status, target.ResultText = GuardedActionApproved, resultText
		}
	default:
		target.Status = GuardedActionApproved
	}
	target.ResolvedAt = &now
	persistErr := s.persistLocked()
	select {
	case target.decision <- approve:
	default:
	}
	out := snapshotGuardedAction(target)
	s.mu.Unlock()
	if persistErr != nil {
		return out, expired, fmt.Errorf("save guarded action resolution: %w", persistErr)
	}
	return out, expired, nil
}

// Withdraw lets the ORIGINAL REQUESTER cancel their own still-pending
// record (docs/goals/0026 item 1, generalized) -- a terminal outcome
// DISTINCT from denied: nobody weighed in and said no, the requester
// simply stopped needing it. Same at-most-once locking shape as
// Resolve.
func (s *PendingActionStore) Withdraw(id, reason string, retention time.Duration) (rec GuardedActionRecord, expired []GuardedActionRecord, err error) {
	s.mu.Lock()
	expired = s.sweepLocked(time.Now(), retention)
	target, ok := s.records[id]
	if !ok {
		s.mu.Unlock()
		return GuardedActionRecord{}, expired, fmt.Errorf("no guarded action with id %s (it may have already been swept, %s after resolution)", id, retention)
	}
	if target.Status != GuardedActionPending {
		s.mu.Unlock()
		return GuardedActionRecord{}, expired, fmt.Errorf("guarded action %s was already resolved (%s)", id, target.Status)
	}
	now := time.Now()
	target.Status, target.Error, target.ResolvedAt = GuardedActionCancelled, reason, &now
	persistErr := s.persistLocked()
	select {
	case target.decision <- false:
	default:
	}
	out := snapshotGuardedAction(target)
	s.mu.Unlock()
	if persistErr != nil {
		return out, expired, fmt.Errorf("save guarded action withdrawal: %w", persistErr)
	}
	return out, expired, nil
}

// Delete hard-removes id immediately, no retention -- backs
// RequestGuardedAction's own unconditional cleanup (docs/adr/0047 §5):
// a blocking in-process caller that stops waiting (decision, ctx-
// cancel, or timeout) has no resolved-history consumer, unlike
// mcpsvc's poll-and-retain flow (Resolve/Withdraw above, which leave
// the record for guardedActionRetention instead).
func (s *PendingActionStore) Delete(id string) {
	s.mu.Lock()
	delete(s.records, id)
	// Best-effort: if this fails to persist, the stale (pre-delete)
	// version on disk still has the record, which self-heals on the
	// next successful persist or -- worst case -- reappears once after
	// a restart for a human to notice and resolve, never silently lost.
	if err := s.persistLocked(); err != nil {
		slog.Error("failed to persist guarded-action deletion", "error", err)
	}
	s.mu.Unlock()
}

// decisionChan returns id's raw decision channel for a direct select --
// package-private, used only by RequestGuardedAction
// (guardrailservice_request.go) to await a bare yes/no in the same
// single flat select its ctx-cancel/timeout paths already need, with no
// bridging goroutine. Cross-package callers (mcpsvc) use AwaitDecision
// instead (guardrailservice_pendingstore_query.go).
func (s *PendingActionStore) decisionChan(id string) (<-chan bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.records[id]
	if !ok {
		return nil, false
	}
	return rec.decision, true
}

// signal delivers a raw yes/no directly to id's decision channel with
// NO status transition or persistence -- backs RequestGuardedAction's
// own resolveGuardedAction (no real caller yet this slice, docs/adr/0047
// §5): a blocking in-process caller reads the bool off its own select
// and Delete (always deferred by that caller) is what actually clears
// the record either way, so there is nothing durable to record here.
// mcpsvc's own resolve path uses Resolve instead, which durably
// records the decision.
func (s *PendingActionStore) signal(id string, approve bool) bool {
	s.mu.Lock()
	rec, ok := s.records[id]
	s.mu.Unlock()
	if !ok {
		return false
	}
	select {
	case rec.decision <- approve:
	default:
	}
	return true
}

// sweepLocked lazily transitions any pending record whose retention
// window has elapsed to expired, and deletes any terminal record whose
// own retention-since-resolution has elapsed -- caller must hold mu.
// retention is the caller's own stated window (see
// defaultGuardedActionRetention's doc comment for why this isn't a
// single shared package var). Returns a snapshot of every record that
// just expired, for the caller to report onward (mcpsvc's Activity row
// + pending-changed signal).
func (s *PendingActionStore) sweepLocked(now time.Time, retention time.Duration) []GuardedActionRecord {
	var expired []GuardedActionRecord
	changed := false
	for id, rec := range s.records {
		if rec.Status == GuardedActionPending && now.Sub(rec.CreatedAt) > retention {
			rec.Status = GuardedActionExpired
			rec.Error = "no decision within the retention window"
			rec.ResolvedAt = &now
			expired = append(expired, snapshotGuardedAction(rec))
			changed = true
			continue
		}
		if rec.Status != GuardedActionPending && rec.ResolvedAt != nil && now.Sub(*rec.ResolvedAt) > retention {
			delete(s.records, id)
			changed = true
		}
	}
	if changed {
		// Incidental bookkeeping riding along a read call -- log-only,
		// same fire-and-forget treatment as mcpsvc's own (retired)
		// sweepLocked and the compositionsvc/configuresvc top-up-seeding
		// sweeps. A failure here just means the same records get swept
		// again on the next call.
		if err := s.persistLocked(); err != nil {
			slog.Error("failed to persist guarded-action sweep", "error", err)
		}
	}
	return expired
}
