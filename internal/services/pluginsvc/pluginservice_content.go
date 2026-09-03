package pluginsvc

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// The plugin content-write door (docs/goals/0289): a plugin with the
// "write-content" capability creates notes and cards and appends List
// rows through the SAME guarded plane an agent's writes take -- one
// guard, two callers, never a parallel write path. The writes
// themselves live behind ContentWriter (wired at the composition root
// to atlassvc's plugin-actor doors and Configure's List row append),
// so this file owns only the ask and the dispatch.

// ContentWriteKind is the guardrail action kind every plugin content
// write is evaluated under; attributes carry op + the target.
const ContentWriteKind = "content.write"

// ContentWriter is the seam pluginsvc writes through; nil until wired.
type ContentWriter interface {
	CreateNote(text, parentID string, pos *atlas.Position) (atlas.Note, error)
	CreateCard(kindID, title, note string, fields map[string]string, parentID string) (atlas.Card, error)
	UpdateCard(id, title, note string, fields map[string]string) (atlas.Card, error)
	AppendListRow(listID string, values map[string]string) error
	// CreateList creates a Configure List with its first rows (rows
	// keyed by column key) and returns the new list's id.
	CreateList(label, description string, columns []typedfield.Field, rows []map[string]string) (string, error)
}

// WireContentWrites installs the writer (composition root only).
func (p *PluginService) WireContentWrites(w ContentWriter) { p.content = w }

// PluginListColumn is one column of a plugin-created list: a display
// name (its key is derived) and an optional type from listColumnTypes
// (text when empty).
type PluginListColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// PluginContentWrite is one ask. Op is "note", "card", "card-update",
// "list-row", or "list"; the other fields apply per op.
type PluginContentWrite struct {
	Op       string            `json:"op"`
	Text     string            `json:"text"`
	Title    string            `json:"title"`
	Note     string            `json:"note"`
	KindID   string            `json:"kindId"`
	CardID   string            `json:"cardId"`
	ParentID string            `json:"parentId"`
	ListID   string            `json:"listId"`
	Fields   map[string]string `json:"fields"`
	Values   map[string]string `json:"values"`
	Position *atlas.Position   `json:"position"`
	// The "list" op: Title names the list; Rows are keyed by column
	// name (or derived key).
	Description string              `json:"description"`
	Columns     []PluginListColumn  `json:"columns"`
	Rows        []map[string]string `json:"rows"`
}

// PluginContentWriteResult carries the decision and, when performed,
// the created/updated entity's id.
type PluginContentWriteResult struct {
	Approved  bool   `json:"approved"`
	Effect    string `json:"effect"`
	RuleLabel string `json:"ruleLabel"`
	ID        string `json:"id"`
}

// WriteContentForPlugin performs one guarded content write. Refusals
// that need no rule -- undeclared capability, unknown op, a malformed
// ask -- happen BEFORE the guardrail is consulted.
func (p *PluginService) WriteContentForPlugin(pluginID string, req PluginContentWrite) (PluginContentWriteResult, error) {
	plugin := p.resolvePlugin(pluginID)
	if plugin.Error != "" {
		return PluginContentWriteResult{}, fmt.Errorf("plugin %q: %s", pluginID, plugin.Error)
	}
	if !hasCapability(plugin.Manifest, "write-content") {
		return PluginContentWriteResult{}, fmt.Errorf("plugin %q does not declare the \"write-content\" capability in its manifest", pluginID)
	}
	attrs, description, err := describeContentWrite(req)
	if err != nil {
		return PluginContentWriteResult{}, err
	}
	if p.guardrail == nil || p.content == nil {
		return PluginContentWriteResult{}, errors.New("content writes unavailable: a plugin write is always guarded and wired at the composition root")
	}
	decision, err := p.guardrail.RequestGuardedAction(context.Background(), guardrailsvc.GuardedAction{
		Kind: ContentWriteKind, Attributes: attrs, Description: description, Source: "plugin:" + pluginID,
	})
	if err != nil {
		return PluginContentWriteResult{}, err
	}
	out := PluginContentWriteResult{Approved: decision.Approved, Effect: string(decision.Effect), RuleLabel: decision.RuleLabel}
	if !decision.Approved {
		return out, nil
	}
	id, err := p.performContentWrite(req)
	if err != nil {
		return out, err
	}
	out.ID = id
	return out, nil
}

func describeContentWrite(req PluginContentWrite) (map[string]string, string, error) {
	attrs := map[string]string{"op": req.Op}
	switch req.Op {
	case "note":
		if strings.TrimSpace(req.Text) == "" {
			return nil, "", errors.New("a note needs text")
		}
		attrs["parentId"] = req.ParentID
		return attrs, "Create a note: " + atlas.NoteDisplayName(req.Text), nil
	case "card":
		if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.KindID) == "" {
			return nil, "", errors.New("a card needs a kindId and a title")
		}
		attrs["kindId"], attrs["parentId"] = req.KindID, req.ParentID
		return attrs, fmt.Sprintf("Create a card: %s", req.Title), nil
	case "card-update":
		if strings.TrimSpace(req.CardID) == "" {
			return nil, "", errors.New("a card update needs a cardId")
		}
		attrs["cardId"] = req.CardID
		return attrs, fmt.Sprintf("Update card %s", req.CardID), nil
	case "list-row":
		if strings.TrimSpace(req.ListID) == "" {
			return nil, "", errors.New("a list row needs a listId")
		}
		attrs["listId"] = req.ListID
		return attrs, fmt.Sprintf("Add a row to list %s", req.ListID), nil
	case "list":
		return describeListWrite(req, attrs)
	default:
		return nil, "", fmt.Errorf("unknown content write op %q (note, card, card-update, list-row, or list)", req.Op)
	}
}

// listColumnTypes are the column types a plugin may declare -- the
// cell-editable scalar types; reference and structured types stay a
// Configure-page decision.
var listColumnTypes = map[string]typedfield.Type{
	"": typedfield.TypeText, "text": typedfield.TypeText, "number": typedfield.TypeNumber, "integer": typedfield.TypeInteger,
	"boolean": typedfield.TypeBoolean, "date": typedfield.TypeDate, "datetime": typedfield.TypeDatetime,
}

func describeListWrite(req PluginContentWrite, attrs map[string]string) (map[string]string, string, error) {
	if strings.TrimSpace(req.Title) == "" {
		return nil, "", errors.New("a list needs a title")
	}
	if len(req.Columns) == 0 {
		return nil, "", errors.New("a list needs at least one column")
	}
	for _, c := range req.Columns {
		if strings.TrimSpace(c.Name) == "" {
			return nil, "", errors.New("every list column needs a name")
		}
		if _, ok := listColumnTypes[c.Type]; !ok {
			return nil, "", fmt.Errorf("column type %q is not one of text, number, integer, boolean, date, datetime", c.Type)
		}
	}
	attrs["title"] = req.Title
	return attrs, fmt.Sprintf("Create a list: %s (%d columns, %d rows)", req.Title, len(req.Columns), len(req.Rows)), nil
}

// columnKey derives a list column's key from its display name: a
// lowercase slug, "column" when nothing survives.
func columnKey(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		case !dash && b.Len() > 0:
			b.WriteByte('-')
			dash = true
		}
	}
	key := strings.TrimSuffix(b.String(), "-")
	if key == "" {
		return "column"
	}
	return key
}

// listColumns turns declared columns into fields with unique keys, and
// remaps the rows' name-keyed values onto those keys.
func listColumns(columns []PluginListColumn, rows []map[string]string) ([]typedfield.Field, []map[string]string) {
	fields := make([]typedfield.Field, 0, len(columns))
	keyOf := map[string]string{}
	taken := map[string]bool{}
	for _, c := range columns {
		key := columnKey(c.Name)
		for n := 2; taken[key]; n++ {
			key = fmt.Sprintf("%s-%d", columnKey(c.Name), n)
		}
		taken[key] = true
		keyOf[c.Name] = key
		fields = append(fields, typedfield.Field{Key: key, Label: strings.TrimSpace(c.Name), Type: listColumnTypes[c.Type]})
	}
	out := make([]map[string]string, 0, len(rows))
	for _, row := range rows {
		values := map[string]string{}
		for name, v := range row {
			if key, ok := keyOf[name]; ok {
				values[key] = v
			} else {
				values[name] = v
			}
		}
		out = append(out, values)
	}
	return fields, out
}

func (p *PluginService) performContentWrite(req PluginContentWrite) (string, error) {
	switch req.Op {
	case "note":
		n, err := p.content.CreateNote(req.Text, req.ParentID, req.Position)
		return n.ID, err
	case "card":
		c, err := p.content.CreateCard(req.KindID, req.Title, req.Note, req.Fields, req.ParentID)
		return c.ID, err
	case "card-update":
		c, err := p.content.UpdateCard(req.CardID, req.Title, req.Note, req.Fields)
		return c.ID, err
	case "list":
		fields, rows := listColumns(req.Columns, req.Rows)
		return p.content.CreateList(req.Title, req.Description, fields, rows)
	default:
		return req.ListID, p.content.AppendListRow(req.ListID, req.Values)
	}
}
