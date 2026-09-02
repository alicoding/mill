package pluginsvc

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
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
}

// WireContentWrites installs the writer (composition root only).
func (p *PluginService) WireContentWrites(w ContentWriter) { p.content = w }

// PluginContentWrite is one ask. Op is "note", "card", "card-update",
// or "list-row"; the other fields apply per op.
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
	default:
		return nil, "", fmt.Errorf("unknown content write op %q (note, card, card-update, or list-row)", req.Op)
	}
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
	default:
		return req.ListID, p.content.AppendListRow(req.ListID, req.Values)
	}
}
