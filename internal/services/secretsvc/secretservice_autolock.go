package secretsvc

import (
	"time"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/idletime"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
)

// idleTimeFn is idletime.Seconds's own swappable seam -- same shape
// settingssvc's own idleTimeFn already establishes, so a test can pin a
// specific idle reading instead of depending on this machine's real HID
// idle counter.
var idleTimeFn = idletime.Seconds

// startAutoLock polls idleTimeFn every pollInterval and locks the vault
// once it's unlocked AND system idle has reached the lock policy's own
// timeout (secretservice_lockpolicy.go) -- the goal file's "unlock once
// per app session, hold the vault key in memory, auto-lock on idle."
// The timeout is re-read every tick, not captured at start, so changing
// it in the surface takes effect on the next tick rather than at the
// next launch.
//
// An idletime read error (server mode: no HID input stream regardless
// of platform, idletime.ErrUnsupportedInServerMode) is not a lock
// signal here, unlike settingssvc.IsAway's fail-toward-away posture:
// there is no idle-time concept to fail safe FROM in server mode, so
// auto-lock simply never fires there -- a locked-by-default posture for
// a headless deployment would make every scheduled run against the
// vault permanently fail, which is a worse failure mode than "no
// idle-based auto-lock in a mode with no idle concept at all."
//
// Returns a stop func for test cleanup (StopAutoLock) -- stop BLOCKS
// until the poll goroutine has actually exited, not merely signaled to,
// so a test can safely reassign idleTimeFn (a package var the goroutine
// reads) immediately after calling it without racing that goroutine.
func (s *SecretService) startAutoLock(pollInterval time.Duration) func() {
	done := make(chan struct{})
	exited := make(chan struct{})
	go func() {
		defer close(exited)
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.autoLockTick()
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
// the poll goroutine's select loop itself simple (gocognit). A zero
// threshold is the policy's "Never" and never locks -- distinct from a
// missing idle reading, which also never locks but for a different
// reason.
func (s *SecretService) autoLockTick() {
	if !s.vault.Unlocked() {
		return
	}
	threshold := s.lockAfterDuration()
	if threshold <= 0 {
		return
	}
	idle, err := idleTimeFn()
	if err != nil {
		return
	}
	if idle >= threshold {
		s.lockVaultNow()
	}
}

// clipboardAutoClear is CopySecretToClipboard's own default (goal file:
// "KeePassXC's own shipped default is 10s") -- a var, not a const, so a
// test can shorten it instead of actually sleeping 10s.
var clipboardAutoClear = 10 * time.Second

// clipboardWriteFn/clipboardReadFn are clipboard.Port.WriteText/
// ReadText's own swappable seams -- same test-pinning reasoning as
// idleTimeFn above. clipboard.New() resolves to the in-memory Port
// inside a go test binary (goal 0356) -- never the real pasteboard by
// default.
var (
	clipboardWriteFn = clipboard.New().WriteText
	clipboardReadFn  = clipboard.New().ReadText
)

// CopySecretToClipboard reveals id's password and writes it to the
// clipboard, then clears the clipboard after clipboardAutoClear --
// but ONLY if the clipboard still holds exactly that value at that
// point (the same "don't clobber something the user copied since"
// check KeePassXC's own auto-clear makes), never unconditionally.
// Records one ContextUICopy audit line (goal 0203 S3), same not-gated-
// but-visible posture as RevealSecret.
func (s *SecretService) CopySecretToClipboard(id string) error {
	e, err := s.vault.Get(id)
	actx := secretaudit.AccessContext{Context: secretaudit.ContextUICopy}
	if err != nil {
		s.recordAccess(id, "", actx, secretaudit.OutcomeError, err.Error())
		return err
	}
	s.recordAccess(id, e.Title, actx, secretaudit.OutcomeRead, "")
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
