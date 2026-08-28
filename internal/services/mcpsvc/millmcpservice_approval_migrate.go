package mcpsvc

// The one-shot upgrade path off the retired bespoke MCP-write park
// (docs/adr/0047 §5.4's follow-up): a settings file written by a
// pre-migration Mill still carries its pending/recently-resolved writes
// under the OLD "mcp-pending-writes" key, in the OLD MCPWriteRecord
// JSON shape -- this converts them into the shared
// guardrailsvc.PendingActionStore's own record shape under its NEW key,
// then clears the old key, so nobody's still-pending write silently
// vanishes across the upgrade.

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// legacyMCPPendingWritesKey is the retired settings key
// millmcpservice_approval.go's own MCPWriteRecord persisted under
// before this migration -- kept here, private to the migration path
// only, never reintroduced as live storage.
const legacyMCPPendingWritesKey = "mcp-pending-writes"

// legacyMCPWriteRecord mirrors the retired MCPWriteRecord's exact JSON
// shape, field-for-field -- ONLY for decoding a pre-migration settings
// file; never constructed as live state.
type legacyMCPWriteRecord struct {
	ID           string     `json:"id"`
	Description  string     `json:"description"`
	ToolName     string     `json:"toolName"`
	ArgsJSON     string     `json:"argsJson"`
	CreatedAt    time.Time  `json:"createdAt"`
	Status       string     `json:"status"`
	ResultText   string     `json:"resultText,omitempty"`
	Error        string     `json:"error,omitempty"`
	ResolvedAt   *time.Time `json:"resolvedAt,omitempty"`
	LastPolledAt *time.Time `json:"lastPolledAt,omitempty"`
}

// MigrateLegacyPendingWrites converts any pre-migration MCP write
// records into the shared guardrailsvc.PendingActionStore's own shape
// and clears the old key. MUST run before ANY
// guardrailsvc.PendingActionStore is constructed against store
// (directly, or via guardrailsvc.NewGuardrailService) -- main.go calls
// this first, ahead of guardrailsvc.NewGuardrailService, specifically
// so the shared store's own construction-time load already sees the
// migrated data; running it any later would leave an already-constructed
// GuardrailService holding a stale in-memory view even after this
// correctly rewrites the key on disk (a live object never re-reads its
// own settings key after construction).
func MigrateLegacyPendingWrites(store settings.Store) error {
	raw, ok := store.Get(legacyMCPPendingWritesKey).(string)
	if !ok || raw == "" {
		return nil
	}
	var loaded map[string]legacyMCPWriteRecord
	if err := json.Unmarshal([]byte(raw), &loaded); err != nil {
		return fmt.Errorf("migrate legacy MCP pending writes: decode: %w", err)
	}
	if len(loaded) == 0 {
		if err := store.Set(legacyMCPPendingWritesKey, ""); err != nil {
			return fmt.Errorf("migrate legacy MCP pending writes: clear empty old key: %w", err)
		}
		return nil
	}

	legacy := make(map[string]guardrailsvc.LegacyGuardedAction, len(loaded))
	for id, rec := range loaded {
		payload, err := json.Marshal(mcpWritePayload{ToolName: rec.ToolName, ArgsJSON: rec.ArgsJSON})
		if err != nil {
			return fmt.Errorf("migrate legacy MCP pending writes: encode payload for %s: %w", id, err)
		}
		legacy[id] = guardrailsvc.LegacyGuardedAction{
			ID: rec.ID, Kind: mcpWriteGuardrailKind, Description: rec.Description, Source: "mcp",
			CreatedAt: rec.CreatedAt, Status: guardrailsvc.GuardedActionStatus(rec.Status), Payload: payload,
			ResultText: rec.ResultText, Error: rec.Error, ResolvedAt: rec.ResolvedAt, LastPolledAt: rec.LastPolledAt,
		}
	}
	if err := guardrailsvc.MergeLegacyPendingActions(store, legacy); err != nil {
		return fmt.Errorf("migrate legacy MCP pending writes: %w", err)
	}
	if err := store.Set(legacyMCPPendingWritesKey, ""); err != nil {
		return fmt.Errorf("migrate legacy MCP pending writes: clear old key: %w", err)
	}
	return nil
}
