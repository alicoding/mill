package atlassvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// The cardref write gate (docs/goals/0152 slice 2): a cardref field
// value must name an existing card of the field's declared target
// kind -- wrong-kind and dangling targets are refused at every write
// door (create, update, merge); cleared values always pass.
func TestCardRefWriteGate(t *testing.T) {
	svc := newTestAtlasService(t)

	person, err := svc.CreateKind("Person", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind(Person): %v", err)
	}
	other, err := svc.CreateKind("Other", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind(Other): %v", err)
	}
	ticket, err := svc.CreateKind("Ticket", "", "", []typedfield.Field{
		{Key: "owner", Label: "Owner", Type: typedfield.TypeCardRef, RefKind: person.ID},
	})
	if err != nil {
		t.Fatalf("CreateKind(Ticket): %v", err)
	}
	ada, err := svc.CreateCard(person.ID, "Ada", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("create person card: %v", err)
	}
	misc, err := svc.CreateCard(other.ID, "Misc", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("create other card: %v", err)
	}

	created, err := svc.CreateCard(ticket.ID, "T-1", "", map[string]string{"owner": ada.ID}, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("create with a valid ref: %v", err)
	}
	if _, err := svc.CreateCard(ticket.ID, "T-2", "", map[string]string{"owner": misc.ID}, "", nil, "", "", "", ""); err == nil || !strings.Contains(err.Error(), "declared kind") {
		t.Fatalf("create with a wrong-kind ref: err=%v, want declared-kind refusal", err)
	}
	if _, err := svc.CreateCard(ticket.ID, "T-3", "", map[string]string{"owner": "no-such-card"}, "", nil, "", "", "", ""); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("create with a dangling ref: err=%v, want does-not-exist refusal", err)
	}

	if _, err := svc.UpdateCard(created.ID, "T-1", "", map[string]string{"owner": misc.ID}, "", "", ""); err == nil {
		t.Fatal("update to a wrong-kind ref must be refused")
	}
	if _, err := svc.MergeCardFields(created.ID, map[string]string{"owner": ""}, ""); err != nil {
		t.Fatalf("clearing the ref must pass: %v", err)
	}
}
