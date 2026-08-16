package configuresvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// ApplyListRow implements composition.go's applyListRowFn seam
// (docs/goals/0070's write path): creates a new Active row when no
// existing row's keyColumn value matches the resolved key, otherwise
// merges values into the first matching row -- unbound columns stay
// untouched, the same "only the named fields change" precedent
// apply-atlas-card-update's own AtlasCard merge documents. Typed-column
// validation happens here (not composition), since Columns is this
// service's own domain knowledge: an invalid value is rejected before
// anything is persisted, never silently coerced. Always writes the
// LIVE list -- never a published/pinned snapshot (list.Resolve's own
// doc comment: a write always targets the draft).
func (c *ConfigureService) ApplyListRow(listID, keyColumn string, values map[string]string) (list.Row, error) {
	c.mu.Lock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		c.mu.Unlock()
		return list.Row{}, fmt.Errorf("no list with id %q", listID)
	}
	previous := c.lists[idx]
	l := previous

	for _, col := range l.Columns {
		v, ok := values[col.Key]
		if !ok {
			continue
		}
		if err := typedfield.ValidateValue(col, v); err != nil {
			c.mu.Unlock()
			return list.Row{}, err
		}
	}

	keyVal, ok := values[keyColumn]
	if !ok {
		c.mu.Unlock()
		return list.Row{}, fmt.Errorf("no value bound for key column %q", keyColumn)
	}

	now := time.Now()
	rows := append([]list.Row{}, l.Rows...)
	matchIdx := -1
	for i, r := range rows {
		if r.Values[keyColumn] == keyVal {
			matchIdx = i
			break
		}
	}

	var result list.Row
	if matchIdx == -1 {
		result = list.Row{ID: seeding.NewSlugID("", "row"), Values: values, CreatedAt: now, UpdatedAt: now, Status: list.RowActive}
		rows = append(rows, result)
	} else {
		merged := make(map[string]string, len(rows[matchIdx].Values)+len(values))
		for k, v := range rows[matchIdx].Values {
			merged[k] = v
		}
		for k, v := range values {
			merged[k] = v
		}
		rows[matchIdx].Values = merged
		rows[matchIdx].UpdatedAt = now
		result = rows[matchIdx]
	}
	l.Rows = rows
	l.UpdatedAt = now
	l.Seed = l.Seed.Touch() // docs/goals/0037 item 2
	if err := list.Validate(l); err != nil {
		c.mu.Unlock()
		return list.Row{}, err
	}
	c.lists[idx] = l
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.Row{}, fmt.Errorf("save list: %w", err)
	}
	dataevent.Emit("list", l.ID) // goal 0017: live-sync every open surface
	return result, nil
}
