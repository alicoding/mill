package settingssvc

import "errors"

// errAuditRetentionMustBePositive is SetAuditRetentionEntries' own
// rejection -- a cap of zero or less would prune the trail to nothing.
var errAuditRetentionMustBePositive = errors.New("settingssvc: audit retention must keep at least 1 entry")

// auditRetentionEntriesKey persists the shared audit trail's retention
// cap (goal 0351 Decision 4): the newest N rows across every kind
// (mcp-call, secret-access, bridge-command) survive a prune -- ONE
// kernel setting replacing the two per-source caps
// (mcpauditsvc.RetentionKeep, secretsvc.AuditRetentionKeep) that
// preceded it, both of which happened to already be this same number.
const auditRetentionEntriesKey = "settings-audit-retention-entries"

// AuditRetentionEntriesDefault is the largest of the two per-source
// caps this setting replaces (both were 10000).
const AuditRetentionEntriesDefault = 10000

// GetAuditRetentionEntries returns the persisted cap, defaulting to
// AuditRetentionEntriesDefault when unset or set to a non-positive
// value (a cap of zero or less would prune the trail to nothing). A
// value set THIS run reads back as the int SetAuditRetentionEntries
// stored (kvstore.Set keeps it as-is in memory); a value loaded from a
// PRIOR run's settings.json reads back as float64 (JSON numbers decode
// to float64 into an `any` -- kvstore.Load's own json.Unmarshal target)
// -- both are handled so the setting survives a restart unchanged.
func (s *SettingsService) GetAuditRetentionEntries() int {
	switch v := s.store.Get(auditRetentionEntriesKey).(type) {
	case int:
		if v > 0 {
			return v
		}
	case float64:
		if v > 0 {
			return int(v)
		}
	}
	return AuditRetentionEntriesDefault
}

// SetAuditRetentionEntries persists the cap. Rejects a non-positive
// value so the trail can never be configured to prune itself to
// nothing.
func (s *SettingsService) SetAuditRetentionEntries(n int) error {
	if n <= 0 {
		return errAuditRetentionMustBePositive
	}
	return s.store.Set(auditRetentionEntriesKey, n)
}
