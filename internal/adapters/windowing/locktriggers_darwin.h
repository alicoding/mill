//go:build darwin && !server

#ifndef MILL_LOCKTRIGGERS_DARWIN_H
#define MILL_LOCKTRIGGERS_DARWIN_H

// Codes millLockTriggerFired is called with -- kept in step with
// locktriggers_darwin.go's own switch.
#define MILL_LOCK_TRIGGER_SCREEN_LOCK 1
#define MILL_LOCK_TRIGGER_USER_SWITCH 2

// Installs the workspace and distributed notification observers for
// screen lock and fast user switching. Idempotent -- a second call
// installs nothing. Implementation and thread reasoning live in
// locktriggers_darwin.m.
void millStartLockTriggers(void);

#endif
