//go:build production

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// singleInstanceOptions guards the INSTALLED app against Mill's real
// data-corruption hazard (docs/SPEC.md §3.7): two live instances writing
// the same settings.json / execution.db, and both independently arming
// the same schedule/clipboard-watch/filesystem-watch triggers. Wails3's
// own SingleInstance (v3/pkg/application/single_instance.go): a flock on
// a temp-dir lock file keyed by UniqueID -- a second launch never opens
// a window, it serializes its argv/cwd to the FIRST instance via
// NSDistributedNotificationCenter and exits, and the first instance's
// OnSecondInstanceLaunch fires (here: restore+focus the existing
// window, the standard "you already have Mill open" behaviour).
//
// Gated behind the `production` build tag ON PURPOSE (the no-op
// !production variant is in singleinstance_dev.go): the guard's
// "second launch defers to the first" semantics are exactly WRONG for
// `wails3 dev`, whose rebuild-relaunch would make a fresh build defer to
// a stale window instead of replacing it. `task dev` builds without
// -tags production, so it gets the no-op; only the installed .app
// (build:native applies -tags production) gets the real guard. The
// dev-orphan problem is a separate, tooling-level fix (Taskfile's
// orphan sweep) -- SingleInstance is deliberately not it.
func singleInstanceOptions(getWindow func() *application.WebviewWindow) *application.SingleInstanceOptions {
	return &application.SingleInstanceOptions{
		UniqueID: "com.alicoding.mill",
		OnSecondInstanceLaunch: func(application.SecondInstanceData) {
			if w := getWindow(); w != nil {
				w.Restore()
				w.Focus()
			}
		},
	}
}
