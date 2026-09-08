package sheet

import "testing"

func TestParseAddress_ValidAndInvalid(t *testing.T) {
	cases := []struct {
		in      string
		want    Address
		wantErr bool
	}{
		{"A1", Address{Col: 0, Row: 0}, false},
		{"b2", Address{Col: 1, Row: 1}, false},
		{"Z1", Address{Col: 25, Row: 0}, false},
		{"AA1", Address{Col: 26, Row: 0}, false},
		{"AB10", Address{Col: 27, Row: 9}, false},
		{"", Address{}, true},
		{"A", Address{}, true},
		{"1", Address{}, true},
		{"A0", Address{}, true},
		{"A-1", Address{}, true},
	}
	for _, c := range cases {
		got, err := ParseAddress(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("ParseAddress(%q): want error, got %+v", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseAddress(%q): %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("ParseAddress(%q) = %+v, want %+v", c.in, got, c.want)
		}
	}
}

func TestAddress_StringRoundTrips(t *testing.T) {
	for _, s := range []string{"A1", "B2", "Z1", "AA1", "AB10"} {
		a, err := ParseAddress(s)
		if err != nil {
			t.Fatalf("ParseAddress(%q): %v", s, err)
		}
		if got := a.String(); got != s {
			t.Errorf("%+v.String() = %q, want %q", a, got, s)
		}
	}
}

func TestParseRange_SingleCellAndSpan(t *testing.T) {
	single, err := ParseRange("B2")
	if err != nil {
		t.Fatalf("ParseRange(B2): %v", err)
	}
	if single.Start != single.End || single.Start != (Address{Col: 1, Row: 1}) {
		t.Errorf("single-cell range = %+v", single)
	}

	span, err := ParseRange("B2:D5")
	if err != nil {
		t.Fatalf("ParseRange(B2:D5): %v", err)
	}
	want := Range{Start: Address{Col: 1, Row: 1}, End: Address{Col: 3, Row: 4}}
	if span != want {
		t.Errorf("ParseRange(B2:D5) = %+v, want %+v", span, want)
	}
}

// A reversed span ("D5:B2") addresses the same rectangle as "B2:D5" --
// the corners normalize regardless of the order given.
func TestParseRange_NormalizesReversedCorners(t *testing.T) {
	forward, err := ParseRange("B2:D5")
	if err != nil {
		t.Fatalf("ParseRange(B2:D5): %v", err)
	}
	reversed, err := ParseRange("D5:B2")
	if err != nil {
		t.Fatalf("ParseRange(D5:B2): %v", err)
	}
	if forward != reversed {
		t.Errorf("forward = %+v, reversed = %+v, want equal", forward, reversed)
	}
}

func TestRange_StringRendersSingleCellBare(t *testing.T) {
	single, _ := ParseRange("C3")
	if got := single.String(); got != "C3" {
		t.Errorf("single.String() = %q, want C3", got)
	}
	span, _ := ParseRange("B2:D5")
	if got := span.String(); got != "B2:D5" {
		t.Errorf("span.String() = %q, want B2:D5", got)
	}
}

func TestParseRange_InvalidCorner(t *testing.T) {
	if _, err := ParseRange("B2:nope"); err == nil {
		t.Error("want an error for an unparseable second corner")
	}
	if _, err := ParseRange("nope"); err == nil {
		t.Error("want an error for an unparseable single cell")
	}
}
