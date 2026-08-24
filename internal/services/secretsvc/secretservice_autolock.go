package secretsvc

import (
	"time"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/idletime"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// idleTimeFn is idletime.Seconds's own swappable seam -- same shape
// settingssvc's own idleTimeFn already establishes, so a test can pin a
// specific idle reading instead of depending on this machine's real HID
// idle counter.
var idleTimeFn = idletime.Seconds

// startAutoLock polls idleTimeFn every pollInterval and locks the vault
// once it's unlocked AND idle has reached threshold -- the goal file's
// "unlock once per app session, hold the vault key in memory, auto-lock
// on idle." An idletime read error (server mode: no HID input stream
// regardless of platform, idletime.ErrUnsupportedInServerMode) is not a
// lock signal here, unlike settingssvc.IsAway's fail-toward-away
// posture: there is no idle-time concept to fail safe FROM in server
// mode, so auto-lock simply never fires there -- a locked-by-default
// posture for a headless deployment would make every scheduled run
// against the vault permanently fail, which is a worse failure mode
// than "no idle-based auto-lock in a mode with no idle concept at all."
// Returns a stop func for test cleanup (StopAutoLock) -- stop BLOCKS
// until the poll goroutine has actually exited, not merely signaled to,
// so a test can safely reassign idleTimeFn (a package var the goroutine
// reads) immediately after calling it without racing that goroutine.
func (s *SecretService) startAutoLock(threshold, pollInterval time.Duration) func() {
	done := make(chan struct{})
	exited := make(chan struct{})
	go func() {
		defer close(exited)
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.autoLockTick(threshold)
			case <-done:
				return
			}
		}
	}()
	return func() {
		close(done)
		<-exited
	}
}

// autoLockTick is startAutoLock's own per-tick check, split out to keep
// the poll goroutine's select loop itself simple (gocognit).
func (s *SecretService) autoLockTick(threshold time.Duration) {
	if !s.vault.Unlocked() {
		return
	}
	idle, err := idleTimeFn()
	if err != nil {
		return
	}
	if idle >= threshold {
		s.vault.Lock()
		dataevent.Emit("secret", "")
	}
}

// clipboardAutoClear is CopySecretToClipboard's own default (goal file:
// "KeePassXC's own shipped default is 10s") -- a var, not a const, so a
// test can shorten it instead of actually sleeping 10s.
var clipboardAutoClear = 10 * time.Second

// clipboardWriteFn/clipboardReadFn are clipboard.WriteText/ReadText's
// own swappable seams -- same test-pinning reasoning as idleTimeFn
// above; a test never wants to touch the real macOS pasteboard.
var (
	clipboardWriteFn = clipboard.WriteText
	clipboardReadFn  = clipboard.ReadText
)

// CopySecretToClipboard reveals id's password and writes it to the
// clipboard, then clears the clipboard after clipboardAutoClear --
// but ONLY if the clipboard still holds exactly that value at that
// point (the same "don't clobber something the user copied since"
// check KeePassXC's own auto-clear makes), never unconditionally.
func (s *SecretService) CopySecretToClipboard(id string) error {
	e, err := s.vault.Get(id)
	if err != nil {
		return err
	}
	if err := clipboardWriteFn(e.Password); err != nil {
		return err
	}
	password := e.Password
	time.AfterFunc(clipboardAutoClear, func() {
		current, err := clipboardReadFn()
		if err != nil || current != password {
			return
		}
		_ = clipboardWriteFn("")
	})
	return nil
}
