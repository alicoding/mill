//go:build !server

package hotkey

import (
	"fmt"
	"strings"

	gohotkey "golang.design/x/hotkey"
)

var keyByName = map[string]gohotkey.Key{
	"A": gohotkey.KeyA, "B": gohotkey.KeyB, "C": gohotkey.KeyC, "D": gohotkey.KeyD,
	"E": gohotkey.KeyE, "F": gohotkey.KeyF, "G": gohotkey.KeyG, "H": gohotkey.KeyH,
	"I": gohotkey.KeyI, "J": gohotkey.KeyJ, "K": gohotkey.KeyK, "L": gohotkey.KeyL,
	"M": gohotkey.KeyM, "N": gohotkey.KeyN, "O": gohotkey.KeyO, "P": gohotkey.KeyP,
	"Q": gohotkey.KeyQ, "R": gohotkey.KeyR, "S": gohotkey.KeyS, "T": gohotkey.KeyT,
	"U": gohotkey.KeyU, "V": gohotkey.KeyV, "W": gohotkey.KeyW, "X": gohotkey.KeyX,
	"Y": gohotkey.KeyY, "Z": gohotkey.KeyZ,
	"0": gohotkey.Key0, "1": gohotkey.Key1, "2": gohotkey.Key2, "3": gohotkey.Key3,
	"4": gohotkey.Key4, "5": gohotkey.Key5, "6": gohotkey.Key6, "7": gohotkey.Key7,
	"8": gohotkey.Key8, "9": gohotkey.Key9,
	"SPACE": gohotkey.KeySpace,
}

var modByName = map[string]gohotkey.Modifier{
	"CMD":    gohotkey.ModCmd,
	"CTRL":   gohotkey.ModCtrl,
	"SHIFT":  gohotkey.ModShift,
	"OPTION": gohotkey.ModOption,
	"ALT":    gohotkey.ModOption,
}

// Binding is a live, registered global hotkey.
type Binding struct {
	hk     *gohotkey.Hotkey
	events chan struct{}
}

// Bind registers a global hotkey for the given modifier/key names (e.g.
// []string{"cmd", "shift"}, "M").
func Bind(mods []string, key string) (*Binding, error) {
	k, ok := keyByName[strings.ToUpper(key)]
	if !ok {
		return nil, fmt.Errorf("unsupported key: %s", key)
	}

	hkMods := make([]gohotkey.Modifier, 0, len(mods))
	for _, m := range mods {
		mod, ok := modByName[strings.ToUpper(m)]
		if !ok {
			return nil, fmt.Errorf("unsupported modifier: %s", m)
		}
		hkMods = append(hkMods, mod)
	}

	hk := gohotkey.New(hkMods, k)
	if err := hk.Register(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrRegisterFailed, err)
	}

	b := &Binding{hk: hk, events: make(chan struct{})}
	// Forwards the library's own event type into an opaque signal channel,
	// so swapping the underlying hotkey library later never changes this
	// method's signature. Exits on its own once Unbind() closes hk's
	// channel.
	go func() {
		defer close(b.events)
		for range hk.Keydown() {
			b.events <- struct{}{}
		}
	}()
	return b, nil
}

// Unbind unregisters the hotkey.
func (b *Binding) Unbind() error {
	return b.hk.Unregister()
}

// Keydown fires each time the bound combo is pressed.
func (b *Binding) Keydown() <-chan struct{} {
	return b.events
}
