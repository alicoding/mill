package configuresvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/list"
)

// SyncListRows is the apply-list-sync node's wired writer (docs/goals/
// 0299): every incoming row goes through ApplyListRow -- the same
// upsert-by-key, typed-validation, persist-and-emit path a single
// apply-list-row takes -- and, when asked, rows whose key the batch
// did not carry are marked expired through UpdateListRow. Never a
// delete: an issue that left the source's result set is still a row
// someone may have annotated.
func (c *ConfigureService) SyncListRows(listID, keyColumn string, rows []map[string]string, expireMissing bool) (composition.ListSyncResult, error) {
	var out composition.ListSyncResult
	seen := make(map[string]bool, len(rows))
	for i, values := range rows {
		if _, err := c.ApplyListRow(listID, keyColumn, values); err != nil {
			return out, fmt.Errorf("row %d: %w", i, err)
		}
		seen[values[keyColumn]] = true
		out.Synced++
	}
	if !expireMissing {
		return out, nil
	}
	l, err := c.GetList(listID)
	if err != nil {
		return out, err
	}
	for _, r := range l.Rows {
		if r.Status == list.RowExpired || seen[r.Values[keyColumn]] {
			continue
		}
		// The unrecorded core: a sync's expiry pass is not a user
		// gesture, so it leaves no step on the undo journal (goal 0352,
		// configurelistrow.go's own split).
		if _, err := c.updateListRow(listID, r.ID, r.Values, list.RowExpired); err != nil {
			return out, fmt.Errorf("expire row %s: %w", r.ID, err)
		}
		out.Expired++
	}
	return out, nil
}
