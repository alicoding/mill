// Package schedule wraps netresearch/go-cron behind Mill's own names, per
// CLAUDE.md's ports/adapters rule for commodity libraries. Callers never
// import the underlying cron package directly. netresearch/go-cron was
// picked over robfig/cron (unmaintained since 2020, real panic/DST bugs)
// and go-co-op/gocron (still wraps robfig/cron/v3 underneath, doesn't
// escape the problem) -- see docs/SPEC.md §3.4.
package schedule

import (
	"fmt"
	"sync"

	cron "github.com/netresearch/go-cron"
)

// One shared scheduler goroutine for the whole app, not one per binding
// -- same reasoning as internal/adapters/hotkey registering each binding
// against one shared OS-level hotkey subsystem underneath.
var (
	once     sync.Once
	instance *cron.Cron
)

func scheduler() *cron.Cron {
	once.Do(func() {
		instance = cron.New()
		instance.Start()
	})
	return instance
}

// Binding is a live, registered cron schedule.
type Binding struct {
	id cron.EntryID
}

// Add registers fn to run on the given 5-field cron expression (e.g.
// "30 * * * *"). fn runs in its own goroutine, per netresearch/go-cron's
// own documented behavior.
func Add(spec string, fn func()) (*Binding, error) {
	id, err := scheduler().AddFunc(spec, fn)
	if err != nil {
		return nil, fmt.Errorf("invalid cron expression %q: %w", spec, err)
	}
	return &Binding{id: id}, nil
}

// Remove unregisters the schedule.
func (b *Binding) Remove() {
	scheduler().Remove(b.id)
}
