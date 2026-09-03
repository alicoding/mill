package conversionprofile

import (
	"reflect"
	"testing"
)

func TestValidate_NormalizesRuleSets(t *testing.T) {
	p := Profile{Label: "x", RuleSets: []string{"office", " confluence", "office", ""}}
	if err := Validate(&p); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(p.RuleSets, []string{"confluence", "office"}) {
		t.Fatalf("rule sets = %v", p.RuleSets)
	}
	if err := Validate(&Profile{}); err == nil {
		t.Fatal("empty label accepted")
	}
}

func TestBuiltIn_ThreeSeedsWithStableIDs(t *testing.T) {
	seeds := BuiltIn()
	if len(seeds) != 3 || seeds[0].ID != DefaultID || seeds[1].ID != PlainID || seeds[2].ID != ConfluenceID {
		t.Fatalf("seeds = %+v", seeds)
	}
	for _, s := range seeds {
		if !s.BuiltIn || s.Seed.SeedRevision == 0 {
			t.Fatalf("seed %s is not marked built-in with a revision", s.ID)
		}
	}
}
