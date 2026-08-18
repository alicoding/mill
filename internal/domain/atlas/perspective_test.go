package atlas

import (
	"reflect"
	"testing"
)

// cardTree builds a small byID map for ancestry tests:
//
//	root
//	  child
//	    grandchild
//	  sibling
//	other (unrelated root-level card, not under "root")
func cardTree() map[string]Card {
	return map[string]Card{
		"root":       {ID: "root", ParentID: ""},
		"child":      {ID: "child", ParentID: "root"},
		"grandchild": {ID: "grandchild", ParentID: "child"},
		"sibling":    {ID: "sibling", ParentID: "root"},
		"other":      {ID: "other", ParentID: ""},
	}
}

func TestAncestorChain_ReturnsChainFromSpaceToCard(t *testing.T) {
	got := AncestorChain(cardTree(), "grandchild", "root")
	want := []string{"child", "grandchild"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("AncestorChain(grandchild, root) = %v, want %v", got, want)
	}
}

func TestAncestorChain_DirectChild(t *testing.T) {
	got := AncestorChain(cardTree(), "child", "root")
	want := []string{"child"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("AncestorChain(child, root) = %v, want %v", got, want)
	}
}

func TestAncestorChain_CardEqualsSpace_ReturnsEmptyNotNil(t *testing.T) {
	got := AncestorChain(cardTree(), "root", "root")
	if got == nil {
		t.Fatal("AncestorChain(root, root) = nil, want a non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("AncestorChain(root, root) = %v, want empty", got)
	}
}

func TestAncestorChain_CardOutsideSpace_ReturnsNil(t *testing.T) {
	if got := AncestorChain(cardTree(), "other", "root"); got != nil {
		t.Errorf("AncestorChain(other, root) = %v, want nil (other is not under root)", got)
	}
}

func TestAncestorChain_TrueRootSpace_ContainsEveryCard(t *testing.T) {
	got := AncestorChain(cardTree(), "grandchild", "")
	want := []string{"root", "child", "grandchild"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("AncestorChain(grandchild, \"\") = %v, want %v", got, want)
	}
}

func TestAncestorChain_UnknownCard_ReturnsNil(t *testing.T) {
	if got := AncestorChain(cardTree(), "does-not-exist", "root"); got != nil {
		t.Errorf("AncestorChain(does-not-exist, root) = %v, want nil", got)
	}
}

func TestAncestorChain_EmptyCardID_ReturnsNil(t *testing.T) {
	if got := AncestorChain(cardTree(), "", "root"); got != nil {
		t.Errorf("AncestorChain(\"\", root) = %v, want nil", got)
	}
}

func TestAncestorChain_Cycle_ReturnsNilRatherThanHanging(t *testing.T) {
	byID := map[string]Card{
		"a": {ID: "a", ParentID: "b"},
		"b": {ID: "b", ParentID: "a"},
	}
	if got := AncestorChain(byID, "a", "root-never-reached"); got != nil {
		t.Errorf("AncestorChain over a cycle = %v, want nil", got)
	}
}

func TestDescendantsAndSelf_ReturnsWholeSubtree(t *testing.T) {
	got := DescendantsAndSelf(cardTree(), "root")
	want := map[string]bool{"root": true, "child": true, "grandchild": true, "sibling": true}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DescendantsAndSelf(root) = %v, want %v", got, want)
	}
}

func TestDescendantsAndSelf_LeafReturnsOnlyItself(t *testing.T) {
	got := DescendantsAndSelf(cardTree(), "grandchild")
	want := map[string]bool{"grandchild": true}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DescendantsAndSelf(grandchild) = %v, want %v", got, want)
	}
}

func TestValidatePerspective_BlankName_Errors(t *testing.T) {
	if err := ValidatePerspective(Perspective{Name: "  "}, cardTree()); err == nil {
		t.Error("ValidatePerspective with a blank name = nil error, want an error")
	}
}

func TestValidatePerspective_MemberOutsideSpace_Errors(t *testing.T) {
	p := Perspective{Name: "Current", SpaceID: "root", MemberCardIDs: []string{"other"}}
	if err := ValidatePerspective(p, cardTree()); err == nil {
		t.Error("ValidatePerspective with a member outside its space = nil error, want an error")
	}
}

func TestValidatePerspective_MemberInsideSpace_Valid(t *testing.T) {
	p := Perspective{Name: "Current", SpaceID: "root", MemberCardIDs: []string{"child", "grandchild"}}
	if err := ValidatePerspective(p, cardTree()); err != nil {
		t.Errorf("ValidatePerspective with members inside its space = %v, want nil", err)
	}
}

func TestFilterByPerspective_MembershipAndLinkRule(t *testing.T) {
	cards := []Card{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	links := []Link{
		{ID: "l-ab", FromCardID: "a", ToCardID: "b"}, // both endpoints member, link member -> renders
		{ID: "l-bc", FromCardID: "b", ToCardID: "c"}, // c is not a member -> hidden despite link being a member
		{ID: "l-ba", FromCardID: "b", ToCardID: "a"}, // both endpoints member, but link itself NOT a member -> hidden
	}
	p := Perspective{
		MemberCardIDs: []string{"a", "b"},
		MemberLinkIDs: []string{"l-ab", "l-bc"},
	}
	gotCards, gotLinks := FilterByPerspective(cards, links, p)

	wantCardIDs := []string{"a", "b"}
	if gotIDs := cardIDs(gotCards); !reflect.DeepEqual(gotIDs, wantCardIDs) {
		t.Errorf("FilterByPerspective cards = %v, want %v", gotIDs, wantCardIDs)
	}
	wantLinkIDs := []string{"l-ab"}
	if gotIDs := linkIDs(gotLinks); !reflect.DeepEqual(gotIDs, wantLinkIDs) {
		t.Errorf("FilterByPerspective links = %v, want %v (link renders iff itself AND both endpoints are members)", gotIDs, wantLinkIDs)
	}
}

func TestFilterByPerspective_PreservesInputOrder(t *testing.T) {
	cards := []Card{{ID: "z"}, {ID: "a"}, {ID: "m"}}
	p := Perspective{MemberCardIDs: []string{"a", "m", "z"}}
	got, _ := FilterByPerspective(cards, nil, p)
	want := []string{"z", "a", "m"}
	if gotIDs := cardIDs(got); !reflect.DeepEqual(gotIDs, want) {
		t.Errorf("FilterByPerspective card order = %v, want input order %v", gotIDs, want)
	}
}

func TestDiffPerspectives_AddedAndRemoved_OrderStable(t *testing.T) {
	from := Perspective{MemberCardIDs: []string{"a", "b", "c"}, MemberLinkIDs: []string{"l1"}}
	to := Perspective{MemberCardIDs: []string{"b", "d", "e"}, MemberLinkIDs: []string{"l2"}}

	diff := DiffPerspectives(from, to)
	if want := []string{"d", "e"}; !reflect.DeepEqual(diff.AddedCardIDs, want) {
		t.Errorf("AddedCardIDs = %v, want %v", diff.AddedCardIDs, want)
	}
	if want := []string{"a", "c"}; !reflect.DeepEqual(diff.RemovedCardIDs, want) {
		t.Errorf("RemovedCardIDs = %v, want %v", diff.RemovedCardIDs, want)
	}
	if want := []string{"l2"}; !reflect.DeepEqual(diff.AddedLinkIDs, want) {
		t.Errorf("AddedLinkIDs = %v, want %v", diff.AddedLinkIDs, want)
	}
	if want := []string{"l1"}; !reflect.DeepEqual(diff.RemovedLinkIDs, want) {
		t.Errorf("RemovedLinkIDs = %v, want %v", diff.RemovedLinkIDs, want)
	}
}

func TestDiffPerspectives_IdenticalMembership_NoChange(t *testing.T) {
	p := Perspective{MemberCardIDs: []string{"a", "b"}, MemberLinkIDs: []string{"l1"}}
	diff := DiffPerspectives(p, p)
	if len(diff.AddedCardIDs) != 0 || len(diff.RemovedCardIDs) != 0 || len(diff.AddedLinkIDs) != 0 || len(diff.RemovedLinkIDs) != 0 {
		t.Errorf("DiffPerspectives(p, p) = %+v, want an all-empty diff", diff)
	}
}

func cardIDs(cards []Card) []string {
	out := make([]string, len(cards))
	for i, c := range cards {
		out[i] = c.ID
	}
	return out
}

func linkIDs(links []Link) []string {
	out := make([]string, len(links))
	for i, l := range links {
		out[i] = l.ID
	}
	return out
}
