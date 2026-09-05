//go:build darwin && !server

#import <AppKit/AppKit.h>
#include "locktriggers_darwin.h"

// The Go-side receiver (locktriggers_darwin.go's //export).
extern void millLockTriggerFired(int code);

// Registration happens once; a second call is a no-op, so re-wiring
// can never stack duplicate observers that would fire the same
// trigger twice.
static BOOL millLockTriggersStarted = NO;

// millStartLockTriggers observes the two "the person is no longer at
// this Mac" moments macOS publishes that the toolkit does not surface:
//
//   - com.apple.screenIsLocked, on the DISTRIBUTED notification centre.
//     Screen lock is a system-wide event posted by loginwindow, not an
//     app or workspace one; NSWorkspace's own centre never carries it.
//     It is not declared in any public header, which is why the name is
//     spelled here as a literal.
//   - NSWorkspaceSessionDidResignActiveNotification, on NSWorkspace's
//     own centre: this login session stopped being the console session
//     because another user was switched to.
//
// Both are registered with queue:[NSOperationQueue mainQueue], so
// delivery is on the main thread no matter which thread registered --
// the block therefore does the least possible work and hands the code
// straight to Go, which hops onto a goroutine before doing anything
// that could block AppKit.
void millStartLockTriggers(void) {
	if (millLockTriggersStarted) {
		return;
	}
	millLockTriggersStarted = YES;
	@autoreleasepool {
		[[NSDistributedNotificationCenter defaultCenter]
		    addObserverForName:@"com.apple.screenIsLocked"
		                object:nil
		                 queue:[NSOperationQueue mainQueue]
		            usingBlock:^(NSNotification *note) {
			millLockTriggerFired(MILL_LOCK_TRIGGER_SCREEN_LOCK);
		}];
		[[[NSWorkspace sharedWorkspace] notificationCenter]
		    addObserverForName:NSWorkspaceSessionDidResignActiveNotification
		                object:nil
		                 queue:[NSOperationQueue mainQueue]
		            usingBlock:^(NSNotification *note) {
			millLockTriggerFired(MILL_LOCK_TRIGGER_USER_SWITCH);
		}];
	}
}
