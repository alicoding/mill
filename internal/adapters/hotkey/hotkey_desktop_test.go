//go:build !server

package hotkey

import (
	"testing"

	gohotkey "golang.design/x/hotkey"
)

// Pins keyByName's punctuation entries to the exact kVK_ANSI_* Carbon
// keycode each name maps to -- a wrong keycode here would silently
// register the wrong physical key at Bind time, which no e2e coverage
// can catch (real global-hotkey registration needs Accessibility and a
// live desktop session). Values checked against the vendored
// golang.design/x/hotkey v0.6.1 source's own referenced header
// (hotkey_darwin.go: ".../HIToolbox.framework/.../Events.h").
func TestKeyByName_Punctuation(t *testing.T) {
	cases := []struct {
		name string
		want gohotkey.Key
	}{
		{",", gohotkey.Key(0x2B)}, // kVK_ANSI_Comma
		{"/", gohotkey.Key(0x2C)}, // kVK_ANSI_Slash
		{"[", gohotkey.Key(0x21)}, // kVK_ANSI_LeftBracket
		{"]", gohotkey.Key(0x1E)}, // kVK_ANSI_RightBracket
		{"-", gohotkey.Key(0x1B)}, // kVK_ANSI_Minus
		{"+", gohotkey.Key(0x18)}, // kVK_ANSI_Equal
	}
	for _, c := range cases {
		got, ok := keyByName[c.name]
		if !ok {
			t.Errorf("keyByName[%q]: missing entry", c.name)
			continue
		}
		if got != c.want {
			t.Errorf("keyByName[%q] = %#x, want %#x", c.name, uint32(got), uint32(c.want))
		}
	}
}
