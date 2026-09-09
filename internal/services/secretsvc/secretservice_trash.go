package secretsvc

import (
	"time"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/vaultref"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// TrashRetention is how long a trashed entry survives before the daily
// sweep destroys it (goal 0406 Decision 1) -- fixed in v1, not a
// Settings value.
const TrashRetention = 30 * 24 * time.Hour

// trashSweepInterval is how often the retention sweep re-checks (goal
// 0406): daily, not the 10s auto-lock cadence -- folded into the same
// poll goroutine startAutoLock already runs (autoLockTick calls
// trashSweepTick), so StopAutoLock's existing stop channel covers this
// too and no test call site needs a second cleanup.
const trashSweepInterval = 24 * time.Hour

// trashClockFn is time.Now's own swappable seam (mirrors idleTimeFn) so
// a test can pin "now" instead of waiting a real day.
var trashClockFn = time.Now

// TrashSummary is ListTrash's own wire shape -- mirrors
// secret.TrashSummary with JSON tags and the retention-derived
// ExpiresAt added, the same "adapter type stays free of a frontend-
// JSON concern" reasoning SecretAccessRecord's own doc comment gives.
type TrashSummary struct {
	ID        string      `json:"id"`
	Label     string      `json:"label"`
	Kind      secret.Kind `json:"kind"`
	DeletedAt time.Time   `json:"deletedAt"`
	ExpiresAt time.Time   `json:"expiresAt"`
}

func toTrashSummary(t secret.TrashSummary) TrashSummary {
	return TrashSummary{ID: t.ID, Label: t.Title, Kind: t.Kind, DeletedAt: t.DeletedAt, ExpiresAt: t.DeletedAt.Add(TrashRetention)}
}

// TrashSecret moves id into the vault's Recycle Bin (goal 0406) --
// what the Secrets view's row "Delete" and the Trash section's own
// "Delete" both do; the entry stays recoverable for TrashRetention.
func (s *SecretService) TrashSecret(id string) error {
	e, err := s.vault.Get(id)
	actx := secretaudit.AccessContext{Context: secretaudit.ContextUITrash}
	if err != nil {
		s.recordAccess(id, "", actx, secretaudit.OutcomeError, failureKindForVaultErr(err), err.Error())
		return err
	}
	if err := s.vault.TrashEntry(id); err != nil {
		s.recordAccess(id, e.Title, actx, secretaudit.OutcomeError, secretaudit.FailureKindOther, err.Error())
		return err
	}
	s.recordAccess(id, e.Title, actx, secretaudit.OutcomeDeleted, "", "")
	dataevent.Emit("secret", id)
	return nil
}

// RestoreSecret moves a trashed entry back to its original group.
func (s *SecretService) RestoreSecret(id string) error {
	label := s.trashedLabel(id)
	actx := secretaudit.AccessContext{Context: secretaudit.ContextUIRestore}
	if err := s.vault.RestoreEntry(id); err != nil {
		s.recordAccess(id, label, actx, secretaudit.OutcomeError, secretaudit.FailureKindOther, err.Error())
		return err
	}
	s.recordAccess(id, label, actx, secretaudit.OutcomeRestored, "", "")
	dataevent.Emit("secret", id)
	return nil
}

// DestroySecret permanently removes a TRASHED entry -- "Delete
// forever," reachable only from the Trash section.
func (s *SecretService) DestroySecret(id string) error {
	label := s.trashedLabel(id)
	actx := secretaudit.AccessContext{Context: secretaudit.ContextUIDestroy}
	if err := s.vault.DestroyEntry(id); err != nil {
		s.recordAccess(id, label, actx, secretaudit.OutcomeError, secretaudit.FailureKindOther, err.Error())
		return err
	}
	s.recordAccess(id, label, actx, secretaudit.OutcomeDestroyed, "", "")
	dataevent.Emit("secret", id)
	return nil
}

// ListTrash lists every currently-trashed entry, most recently trashed
// first -- the Trash section's own read.
func (s *SecretService) ListTrash() ([]TrashSummary, error) {
	items, err := s.vault.ListTrash()
	if err != nil {
		return nil, err
	}
	out := make([]TrashSummary, 0, len(items))
	for _, it := range items {
		out = append(out, toTrashSummary(it))
	}
	return out, nil
}

// trashedLabel is RestoreSecret/DestroySecret's own best-effort title
// lookup for the audit row -- a Restore/Destroy that races another
// tab's own action against the same id still records something
// (falling back to the bare id) rather than skipping the line.
func (s *SecretService) trashedLabel(id string) string {
	items, err := s.vault.ListTrash()
	if err != nil {
		return id
	}
	for _, it := range items {
		if it.ID == id {
			return it.Title
		}
	}
	return id
}

// SecretRefTrashed reports whether ref (a stored "vault:<id>"
// reference) currently names a trashed entry -- the pre-run verdict's
// own check (composition.SetSecretTrashedCheck, goal 0406), the same
// injected-seam shape SecretRefUnresolved (goal 0408 S1) already
// gives a source-backed reference. A provider-qualified reference
// (env:/bruno:/... ) is never trashable -- its own source answers
// whether it resolves. Exported for wiring only, never a frontend RPC.
//
//wails:ignore
func (s *SecretService) SecretRefTrashed(ref string) (trashed bool, label string) {
	provider, id, ok := vaultref.Split(ref)
	if !ok || provider != vaultref.ProviderVault {
		return false, ""
	}
	items, err := s.vault.ListTrash()
	if err != nil {
		return false, ""
	}
	for _, it := range items {
		if it.ID == id {
			return true, it.Title
		}
	}
	return false, ""
}

// sweepTrashNow runs the retention sweep immediately -- called at
// unlock (OnUnlock) and from trashSweepTick once a day. Best-effort:
// retention pruning is housekeeping, not correctness, mirroring
// auditsvc.PruneNow's own posture, so a failure is logged and never
// returned.
func (s *SecretService) sweepTrashNow() {
	s.trashMu.Lock()
	s.lastTrashSweep = trashClockFn()
	s.trashMu.Unlock()

	destroyed, err := s.vault.SweepTrash(trashClockFn(), TrashRetention)
	if err != nil {
		if s.auditLog != nil {
			s.auditLog.Warn("secret trash: sweep", "error", err)
		}
		return
	}
	for _, d := range destroyed {
		s.recordAccess(d.ID, d.Title, secretaudit.AccessContext{Context: secretaudit.ContextTrashSweep}, secretaudit.OutcomeDestroyed, "", "")
	}
	if len(destroyed) > 0 {
		dataevent.Emit("secret", "")
	}
}

// trashSweepTick is autoLockTick's own per-tick check: due once
// trashSweepInterval has passed since the last sweep (or never run
// yet, lastTrashSweep's zero value), so the sweep fires close to once
// a day rather than on every 10s auto-lock poll.
func (s *SecretService) trashSweepTick() {
	s.trashMu.Lock()
	due := trashClockFn().Sub(s.lastTrashSweep) >= trashSweepInterval
	s.trashMu.Unlock()
	if !due {
		return
	}
	s.sweepTrashNow()
}
