package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The guarded half of Atlas over MCP (goal 0083's dogfood proper): an
// agent's card write parks through the EXACT SAME ADR-0032 pending-write
// plane import_workflow/update_workflow/etc. already use
// (millmcpservice_approval.go's gateWrite/registerWriteExecutor) --
// never a parallel queue, ADR-0035. atlas_propose_card_write covers
// both create (kindId+title, required) and update (cardId, required);
// which mode applies is decided purely by whether cardId is present.
// atlas_get_write_status is this family's own typed poll tool -- the
// generic check_write_status (millmcpservice_tools.go) already works
// against the same record (same m.writes map, same MCPWriteRecord),
// this one just unmarshals the executor's own JSON result so a caller
// gets a typed cardId back directly instead of a second decode step.

// atlasProposedLink is one link atlas_propose_card_write's create mode
// creates alongside the new card -- FromCardID is always the new card
// itself (a create-time link is always FROM what's being created).
type atlasProposedLink struct {
	ToCardID   string `json:"toCardId" jsonschema:"an existing card's ID to link the new card to"`
	LinkKindID string `json:"linkKindId" jsonschema:"the link kind for this relation (see atlas_list_kinds)"`
}

// atlasProposeCardWriteArgs backs the one guarded write tool -- create
// mode when CardID is empty (KindID/Title then required), update mode
// otherwise (KindID/ParentID/Links are create-only and ignored). Every
// update field is optional and additive: an empty Title/Note/Summary/
// Status leaves that part of the card unchanged, and Fields MERGES onto
// the card's existing fields (atlassvc.MergeCardFields's own semantics)
// rather than replacing them wholesale.
type atlasProposeCardWriteArgs struct {
	CardID   string              `json:"cardId,omitempty" jsonschema:"update mode: the existing card's ID. Omit entirely to create a new card instead."`
	KindID   string              `json:"kindId,omitempty" jsonschema:"create mode: required, the new card's Kind ID (see atlas_list_kinds). Ignored in update mode."`
	Title    string              `json:"title,omitempty" jsonschema:"create mode: required, the new card's title. update mode: optional, replaces the title when given."`
	Note     string              `json:"note,omitempty" jsonschema:"optional note text -- create mode: the initial note. update mode: replaces the note when given (omit to leave it unchanged)."`
	Summary  string              `json:"summary,omitempty" jsonschema:"optional value for the Kind's declared 'summary' field, when it has one."`
	Status   string              `json:"status,omitempty" jsonschema:"optional value for the Kind's declared 'status' field, when it has one."`
	Fields   map[string]string   `json:"fields,omitempty" jsonschema:"optional field values keyed by the Kind's declared field key -- merged onto the card's existing fields, never a wholesale replace."`
	ParentID string              `json:"parentId,omitempty" jsonschema:"create mode only: the containing card's ID; omit for a root-level card."`
	Links    []atlasProposedLink `json:"links,omitempty" jsonschema:"create mode only: links from the new card to existing cards, created alongside it."`
}

func (a atlasProposeCardWriteArgs) isUpdate() bool { return a.CardID != "" }

// atlasWriteResult is the executor's own success payload -- what
// gateWrite's ResultText carries once approved, and what
// atlas_get_write_status unmarshals back out to answer with a typed
// cardId (docs/goals/0083's own "additive field?" question: no new
// MCPWriteRecord field was needed, ResultText already carries whatever
// JSON an executor returns -- see check_write_status's identical
// pattern for import_workflow's {id,label}).
type atlasWriteResult struct {
	CardID string `json:"cardId"`
	Title  string `json:"title,omitempty"`
	// KindID/Deleted carry atlas_propose_kind_write's own result --
	// the kind tool's description points pollers at this same status
	// tool, so its payload must survive the round trip too (goal
	// 0130's dogfood finding b).
	KindID  string `json:"kindId,omitempty"`
	Deleted bool   `json:"deleted,omitempty"`
}

type atlasWriteStatusArgs struct {
	ID string `json:"id,omitempty" jsonschema:"the pending write's id, from atlas_propose_card_write's 'parked pending human approval' response text -- the same id check_write_status takes"`
	// ApprovalID is the pre-unification name for the same value; ID
	// wins when both are set. Kept so an agent mid-conversation with
	// the old schema keeps polling successfully.
	ApprovalID string `json:"approvalId,omitempty" jsonschema:"alias for id (older name); prefer id"`
}

func (a atlasWriteStatusArgs) writeID() string {
	if a.ID != "" {
		return a.ID
	}
	return a.ApprovalID
}

type atlasWriteStatusResult struct {
	Status  string `json:"status"`
	CardID  string `json:"cardId,omitempty"`
	KindID  string `json:"kindId,omitempty"`
	Deleted bool   `json:"deleted,omitempty"`
	Error   string `json:"error,omitempty"`
}

// registerAtlasWriteTools wires atlas_propose_card_write (gated,
// parks) and atlas_get_write_status (ungated poll) -- called from
// registerAtlasTools.
func (m *MillMCPService) registerAtlasWriteTools() {
	m.registerWriteExecutor("atlas_propose_card_write", m.executeAtlasProposeCardWrite)
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "atlas_propose_card_write",
		Description: "Propose creating a new Atlas card (kindId+title required, plus optional note/parentId/fields/links) or updating an existing one (cardId required, plus any of title/note/summary/status/fields to change). Requires the human-set 'Allow MCP clients to import data' toggle in Mill's Settings (default off); parks pending human approval through the SAME queue import_workflow/update_workflow use -- poll atlas_get_write_status (or check_write_status) with the returned id. On approval the write executes through Atlas's own create/update (and link-create) methods.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasProposeCardWriteArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		if !in.isUpdate() && (in.KindID == "" || strings.TrimSpace(in.Title) == "") {
			return nil, nil, fmt.Errorf("kindId and title are required to create a card (or pass cardId to update an existing one)")
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("atlas_propose_card_write", m.atlasWriteDescription(in), argsJSON)
		return res, nil, err
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "atlas_get_write_status",
		Description: "Poll a parked atlas_propose_card_write or atlas_propose_kind_write outcome by id (the id from its 'parked pending human approval' response text -- the same id every gated write reports and check_write_status takes). status is pending, approved (cardId names the created/updated card; kindId the created/updated/deleted kind), denied, cancelled, or expired.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasWriteStatusArgs) (*mcp.CallToolResult, any, error) {
		res, ok := m.writeStatus(in.writeID())
		if !ok {
			return nil, nil, fmt.Errorf("no MCP write with id %s (it may have already been swept, 24h after resolution)", in.writeID())
		}
		out := atlasWriteStatusResult{Status: res.Status, Error: res.Error}
		if res.Status == string(MCPWriteStatusApproved) && res.Result != "" {
			var wr atlasWriteResult
			if err := json.Unmarshal([]byte(res.Result), &wr); err == nil {
				out.CardID = wr.CardID
				out.KindID = wr.KindID
				out.Deleted = wr.Deleted
			}
		}
		text, err := jsonText(out)
		if err != nil {
			return nil, nil, err
		}
		return textResult(text), nil, nil
	})
}

// atlasWriteDescription renders the approval banner/Review preview for
// an atlas_propose_card_write ask -- the same "human sees the shape of
// the change, not just that something wants to write" preview
// update_workflow's updateDiffSummary already establishes.
func (m *MillMCPService) atlasWriteDescription(in atlasProposeCardWriteArgs) string {
	if in.isUpdate() {
		title := in.CardID
		for _, c := range m.atlas.Cards() {
			if c.ID == in.CardID {
				title = c.Title
				break
			}
		}
		var changed []string
		if in.Title != "" {
			changed = append(changed, "title")
		}
		if in.Note != "" {
			changed = append(changed, "note")
		}
		if in.Summary != "" {
			changed = append(changed, "summary")
		}
		if in.Status != "" {
			changed = append(changed, "status")
		}
		if len(in.Fields) > 0 {
			changed = append(changed, "fields")
		}
		if len(changed) == 0 {
			return fmt.Sprintf("An MCP client wants to UPDATE card %q (no fields named)", title)
		}
		return fmt.Sprintf("An MCP client wants to UPDATE card %q: %s", title, strings.Join(changed, ", "))
	}
	kindLabel := in.KindID
	for _, k := range m.atlas.Kinds() {
		if k.ID == in.KindID {
			kindLabel = k.Label
			break
		}
	}
	return fmt.Sprintf("An MCP client wants to CREATE card %q (%s)", in.Title, kindLabel)
}

// executeAtlasProposeCardWrite is atlas_propose_card_write's registered
// executor (registerWriteExecutor) -- dispatched by ResolveMCPWrite once
// a human approves, re-decoding argsJSON exactly like every other
// gated-write executor in this package.
func (m *MillMCPService) executeAtlasProposeCardWrite(argsJSON string) (string, error) {
	var in atlasProposeCardWriteArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", err
	}
	if in.isUpdate() {
		return m.executeAtlasUpdateCard(in)
	}
	return m.executeAtlasCreateCard(in)
}

// executeAtlasUpdateCard merges in's given fields onto the card's
// current content and writes through AtlasService.UpdateCard -- the
// SAME method the Atlas UI's own card page edit uses (never a
// duplicate write path, .claude/rules/architecture.md). Source/
// MirrorPath/RefreshWorkflowID are carried through unchanged: an MCP
// card write is content-only, never a mirror-configuration change.
func (m *MillMCPService) executeAtlasUpdateCard(in atlasProposeCardWriteArgs) (string, error) {
	var current *atlas.Card
	for _, c := range m.atlas.Cards() {
		if c.ID == in.CardID {
			cc := c
			current = &cc
			break
		}
	}
	if current == nil {
		return "", fmt.Errorf("no card with id %q", in.CardID)
	}

	title := current.Title
	if in.Title != "" {
		title = in.Title
	}
	note := current.Note
	if in.Note != "" {
		note = in.Note
	}
	fields := make(map[string]string, len(current.Fields)+len(in.Fields)+2)
	for k, v := range current.Fields {
		fields[k] = v
	}
	for k, v := range in.Fields {
		fields[k] = v
	}
	if in.Summary != "" {
		fields["summary"] = in.Summary
	}
	if in.Status != "" {
		fields["status"] = in.Status
	}

	updated, err := m.atlas.UpdateCard(current.ID, title, note, fields, current.Source, current.MirrorPath, current.RefreshWorkflowID)
	if err != nil {
		return "", err
	}
	return jsonText(atlasWriteResult{CardID: updated.ID, Title: updated.Title})
}

// executeAtlasCreateCard creates the new card via AtlasService.CreateCard,
// then CreateLink for each proposed link -- reusing Atlas's own
// existing, individually atomic/validated primitives rather than a new
// bulk-write path (.claude/rules/architecture.md's reuse discipline;
// docs/goals/0083's own "CreateLink for links" framing). Every proposed
// link's endpoints are checked up front so a bad link list errors
// before the card is created at all; a link that fails to create AFTER
// the card exists (a race against a concurrent delete, say) still
// leaves the card itself intact -- the error names the created cardId
// so the caller/approver can see what partially landed.
func (m *MillMCPService) executeAtlasCreateCard(in atlasProposeCardWriteArgs) (string, error) {
	if in.KindID == "" || strings.TrimSpace(in.Title) == "" {
		return "", fmt.Errorf("kindId and title are required to create a card")
	}

	existingCards := make(map[string]bool)
	for _, c := range m.atlas.Cards() {
		existingCards[c.ID] = true
	}
	existingLinkKinds := make(map[string]bool)
	for _, lk := range m.atlas.LinkKinds() {
		existingLinkKinds[lk.ID] = true
	}
	for _, l := range in.Links {
		if !existingCards[l.ToCardID] {
			return "", fmt.Errorf("no card with id %q to link to", l.ToCardID)
		}
		if !existingLinkKinds[l.LinkKindID] {
			return "", fmt.Errorf("no link kind with id %q", l.LinkKindID)
		}
	}

	fields := make(map[string]string, len(in.Fields)+2)
	for k, v := range in.Fields {
		fields[k] = v
	}
	if in.Summary != "" {
		fields["summary"] = in.Summary
	}
	if in.Status != "" {
		fields["status"] = in.Status
	}

	card, err := m.atlas.CreateCard(in.KindID, in.Title, in.Note, fields, in.ParentID, nil, "", "", "", "")
	if err != nil {
		return "", err
	}
	for _, l := range in.Links {
		if _, err := m.atlas.CreateLink(card.ID, l.ToCardID, l.LinkKindID, ""); err != nil {
			return "", fmt.Errorf("card %q was created but linking to %q failed: %w", card.ID, l.ToCardID, err)
		}
	}
	return jsonText(atlasWriteResult{CardID: card.ID, Title: card.Title})
}
