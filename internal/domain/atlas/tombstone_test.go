package atlas

import (
	"testing"
	"time"
)

func TestEffectiveParentID_LiveParentReturnedUnchanged(t *testing.T) {
	byID := map[string]Card{
		"parent": {ID: "parent"},
	}
	if got := EffectiveParentID(byID, "parent"); got != "parent" {
		t.Errorf("EffectiveParentID() = %q, want %q", got, "parent")
	}
}

func TestEffectiveParentID_RootReturnedUnchanged(t *testing.T) {
	if got := EffectiveParentID(map[string]Card{}, ""); got != "" {
		t.Errorf("EffectiveParentID() = %q, want \"\"", got)
	}
}

func TestEffectiveParentID_WalksPastOneTombstonedAncestor(t *testing.T) {
	byID := map[string]Card{
		"grandparent": {ID: "grandparent"},
		"parent":      {ID: "parent", ParentID: "grandparent", DeletedAt: time.Now()},
	}
	if got := EffectiveParentID(byID, "parent"); got != "grandparent" {
		t.Errorf("EffectiveParentID() = %q, want walked past the tombstone to %q", got, "grandparent")
	}
}

func TestEffectiveParentID_WalksPastAChainOfTombstonedAncestors(t *testing.T) {
	now := time.Now()
	byID := map[string]Card{
		"root":   {ID: "root"},
		"middle": {ID: "middle", ParentID: "root", DeletedAt: now},
		"parent": {ID: "parent", ParentID: "middle", DeletedAt: now},
	}
	if got := EffectiveParentID(byID, "parent"); got != "root" {
		t.Errorf("EffectiveParentID() = %q, want walked past the whole chain to %q", got, "root")
	}
}

func TestEffectiveParentID_MissingAncestorReturnedUnchanged(t *testing.T) {
	// A parentID absent from byID (dangling reference, not this
	// function's concern per its own doc comment) is returned as-is.
	if got := EffectiveParentID(map[string]Card{}, "unknown"); got != "unknown" {
		t.Errorf("EffectiveParentID() = %q, want %q unchanged", got, "unknown")
	}
}

func TestEffectiveParentID_CycleNeverHangs(t *testing.T) {
	now := time.Now()
	byID := map[string]Card{
		"a": {ID: "a", ParentID: "b", DeletedAt: now},
		"b": {ID: "b", ParentID: "a", DeletedAt: now},
	}
	done := make(chan string, 1)
	go func() { done <- EffectiveParentID(byID, "a") }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("EffectiveParentID hung on a cycle")
	}
}
