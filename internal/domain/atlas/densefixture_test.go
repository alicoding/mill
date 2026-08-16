package atlas

import (
	"testing"
	"time"
)

func TestDenseFixture_DeterministicAndShaped(t *testing.T) {
	now := time.Date(2026, 8, 16, 0, 0, 0, 0, time.UTC)
	cards1, links1 := DenseFixture("parent", now)
	cards2, links2 := DenseFixture("parent", now)

	// 1 velocity + 4 areas + 4*12 area cards + 8 loose = 61
	if got, want := len(cards1), 61; got != want {
		t.Errorf("card count = %d, want %d", got, want)
	}
	// 24 cross-area + 1 outbound = 25
	if got, want := len(links1), 25; got != want {
		t.Errorf("link count = %d, want %d", got, want)
	}
	if len(cards1) != len(cards2) || len(links1) != len(links2) {
		t.Fatal("fixture is not deterministic in size")
	}
	for i := range cards1 {
		if cards1[i].ID != cards2[i].ID {
			t.Fatalf("card order/id not deterministic at %d: %q vs %q", i, cards1[i].ID, cards2[i].ID)
		}
	}

	// Velocity roots at the given parent; every other card sits inside
	// the dense subtree (no strays leaking onto arbitrary boards).
	byID := map[string]Card{}
	for _, c := range cards1 {
		byID[c.ID] = c
	}
	if byID["atlas-dense-velocity"].ParentID != "parent" {
		t.Errorf("velocity ParentID = %q, want parent", byID["atlas-dense-velocity"].ParentID)
	}
	for _, c := range cards1 {
		if c.ID == "atlas-dense-velocity" {
			continue
		}
		p, ok := byID[c.ParentID]
		if !ok {
			t.Errorf("card %s has parent %q outside the fixture", c.ID, c.ParentID)
			continue
		}
		_ = p
	}
}
