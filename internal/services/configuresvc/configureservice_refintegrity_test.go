package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/reference"
)

// TestReferences_CombinesBoardsAndWorkflows is the combined index
// (docs/goals/0392 Decision 3) that both refIntegrityError and
// Configure's own usage indicator read -- proven here against a hand-
// built board reference (compositionservice_refintegrity_test.go
// already covers the workflow half against a real workflow).
func TestReferences_CombinesBoardsAndWorkflows(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.WireBoardReferenceLookup(func(entityKind, id string) []reference.ObjectRef {
		if entityKind == "list" && id == "list-under-test" {
			return []reference.ObjectRef{{BoardID: "board-1", ObjectID: "object-1", Label: "Vendors"}}
		}
		return nil
	})

	refs := cfg.References("list", "list-under-test")
	if len(refs.Boards) != 1 || refs.Boards[0].Label != "Vendors" {
		t.Fatalf("References().Boards = %v, want one ref labeled Vendors", refs.Boards)
	}
	if refs.Empty() {
		t.Error("References().Empty() = true with a board reference present, want false")
	}
}

func TestReferences_EmptyWithNoBoardLookupWired(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	// WireBoardReferenceLookup deliberately never called -- the nil-
	// means-off discipline every cross-service seam in this package
	// follows.
	if refs := cfg.References("list", "anything"); !refs.Empty() {
		t.Errorf("References() with no board lookup wired = %+v, want Empty()", refs)
	}
}

// TestDeleteList_BlockedByBoardReference_NamesIt is the Atlas half of
// ADR-0040 decision 3's block, extending the existing workflow-only
// rule (compositionservice_refintegrity_test.go's own
// TestDeleteWorkflow_BlockedByChildWorkflowReference_NamesIt) rather
// than duplicating it.
func TestDeleteList_BlockedByBoardReference_NamesIt(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Vendors", "", nil)
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	cfg.WireBoardReferenceLookup(func(entityKind, id string) []reference.ObjectRef {
		if entityKind == "list" && id == l.ID {
			return []reference.ObjectRef{{BoardID: "board-1", ObjectID: "object-1", Label: "Vendor table"}}
		}
		return nil
	})

	err = cfg.DeleteList(l.ID)
	if err == nil {
		t.Fatal("DeleteList while a board object references it returned nil error, want it blocked")
	}
	if !strings.Contains(err.Error(), "Vendor table") {
		t.Errorf("DeleteList blocked-error = %q, want it to name the referencing board object", err.Error())
	}

	cfg.WireBoardReferenceLookup(func(string, string) []reference.ObjectRef { return nil })
	if err := cfg.DeleteList(l.ID); err != nil {
		t.Fatalf("DeleteList after the board reference clears: %v", err)
	}
}

// TestReferences_IncludesPluginReferences and
// TestDeleteHTTPRequest_BlockedByPluginReference_NamesIt are docs/
// goals/0400's own addition to the combined index: a plugin's
// entityRef setting counts exactly like a board object or workflow
// node reference.
func TestReferences_IncludesPluginReferences(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.WirePluginReferenceLookup(func(entityKind, id string) []reference.PluginRef {
		if entityKind == "request" && id == "req-under-test" {
			return []reference.PluginRef{{PluginID: "mill-live-view", SettingKey: "integrationId", Label: "Live view"}}
		}
		return nil
	})

	refs := cfg.References("request", "req-under-test")
	if len(refs.Plugins) != 1 || refs.Plugins[0].Label != "Live view" {
		t.Fatalf("References().Plugins = %v, want one ref labeled Live view", refs.Plugins)
	}
	if refs.Empty() {
		t.Error("References().Empty() = true with a plugin reference present, want false")
	}
	if got := refs.Count(); got != 1 {
		t.Errorf("References().Count() = %d, want 1", got)
	}
}

func TestDeleteHTTPRequest_BlockedByPluginReference_NamesIt(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("Tracked items", "https://example.invalid", "GET", "", "none", "", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	cfg.WirePluginReferenceLookup(func(entityKind, id string) []reference.PluginRef {
		if entityKind == "request" && id == req.ID {
			return []reference.PluginRef{{PluginID: "mill-live-view", SettingKey: "integrationId", Label: "Live view"}}
		}
		return nil
	})

	err = cfg.DeleteHTTPRequest(req.ID)
	if err == nil {
		t.Fatal("DeleteHTTPRequest while a plugin references it returned nil error, want it blocked")
	}
	if !strings.Contains(err.Error(), "Live view") {
		t.Errorf("DeleteHTTPRequest blocked-error = %q, want it to name the referencing extension", err.Error())
	}

	cfg.WirePluginReferenceLookup(func(string, string) []reference.PluginRef { return nil })
	if err := cfg.DeleteHTTPRequest(req.ID); err != nil {
		t.Fatalf("DeleteHTTPRequest after the plugin reference clears: %v", err)
	}
}
