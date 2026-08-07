package schedule

import (
	"testing"
	"time"
)

// @every is netresearch/go-cron's own duration-based spec syntax
// (documented directly on the package, not a standard 5-field cron
// expression) -- used here purely so the test doesn't have to wait a
// full real minute for a standard cron field to fire. 1s is the
// library's own enforced minimum for @every (confirmed by running this
// test against "20ms" first and reading the resulting error, not
// assumed), hence the generous 5s timeout below.
func TestAdd_FiresAndRemove(t *testing.T) {
	fired := make(chan struct{}, 1)
	b, err := Add("@every 1s", func() {
		select {
		case fired <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("Add() error: %v", err)
	}

	select {
	case <-fired:
	case <-time.After(5 * time.Second):
		t.Fatal("scheduled func never fired")
	}

	b.Remove()

	// Drain any in-flight fire, then wait longer than one full interval
	// to actually prove Remove() stopped it -- a shorter wait wouldn't
	// have caught another fire anyway and would prove nothing.
	select {
	case <-fired:
	default:
	}
	select {
	case <-fired:
		t.Fatal("scheduled func fired again after Remove()")
	case <-time.After(1500 * time.Millisecond):
	}
}

func TestAdd_InvalidExpression(t *testing.T) {
	if _, err := Add("not a cron expression", func() {}); err == nil {
		t.Fatal("Add() with an invalid expression: want error, got nil")
	}
}
