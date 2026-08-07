package composition

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/capabilities"
)

func TestCapabilityMap(t *testing.T) {
	entries := CapabilityMap()
	if len(entries) == 0 {
		t.Fatal("CapabilityMap() returned no entries")
	}
	seen := make(map[string]bool)
	validApproach := map[Approach]bool{ApproachAdopt: true, ApproachBuild: true, ApproachMixed: true}
	validStatus := map[capabilities.Status]bool{
		capabilities.StatusLocked: true, capabilities.StatusOpen: true, capabilities.StatusParked: true,
	}
	for _, e := range entries {
		if e.ID == "" || e.Name == "" || e.WhatItDoes == "" {
			t.Errorf("capability map entry %+v has an empty ID/Name/WhatItDoes", e)
		}
		if seen[e.ID] {
			t.Errorf("duplicate capability map entry ID %q", e.ID)
		}
		seen[e.ID] = true
		if !validApproach[e.Approach] {
			t.Errorf("entry %q has invalid Approach %q", e.ID, e.Approach)
		}
		if !validStatus[e.Status] {
			t.Errorf("entry %q has invalid Status %q", e.ID, e.Status)
		}
		if e.ApproachDetail == "" || e.StatusDetail == "" {
			t.Errorf("entry %q has an empty ApproachDetail/StatusDetail", e.ID)
		}
	}
}
