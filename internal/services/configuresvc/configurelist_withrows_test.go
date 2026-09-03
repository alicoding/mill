package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestCreateListWithRows_RowsLandOnTheCreatedList(t *testing.T) {
	store := servicetest.NewFakeStore()
	svc := NewConfigureService(store, compositionsvc.NewCompositionService(store), servicetest.FakeCredentialStore{})
	cols := []typedfield.Field{{Key: "vendor", Label: "Vendor", Type: typedfield.TypeText}, {Key: "tier", Label: "Tier", Type: typedfield.TypeText}}
	l, err := svc.CreateListWithRows("Vendors", "", cols, []map[string]string{{"vendor": "Acme", "tier": "gold"}, {}})
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Rows) != 2 || l.Rows[0].Values["vendor"] != "Acme" || len(l.Columns) != 2 {
		t.Fatalf("list = %+v", l)
	}
}
