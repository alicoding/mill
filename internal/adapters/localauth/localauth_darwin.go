//go:build darwin && !server

package localauth

// framework-api-audit: wails/v3@v3.0.0-beta.15 lacks any macOS LocalAuthentication/LAContext API -- its only authentication surface, MobileManager.BiometricAuthenticate, is a desktop no-op stub (pkg/application/mobile_stub.go) that returns no result.

/*
#cgo CFLAGS: -mmacosx-version-min=10.15 -x objective-c -Wno-unguarded-availability-new
#cgo LDFLAGS: -framework Foundation -framework LocalAuthentication

#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

// millForeignErrorDomain is returned when the reply block hands back a
// failure that is not an LAError -- a positive value, so it can never
// collide with an LAError code (every one of them is negative).
static const int millForeignErrorDomain = 1;

// millLocalAuthAvailable answers canEvaluatePolicy for
// LAPolicyDeviceOwnerAuthentication: biometry OR the device password,
// which is the policy Mill gates the vault on -- a Mac with no Touch
// ID hardware still authenticates by password, so the narrower
// biometrics-only policy would refuse machines this feature works
// perfectly well on. Never prompts.
static int millLocalAuthAvailable(void) {
	@autoreleasepool {
		LAContext *ctx = [[LAContext alloc] init];
		NSError *err = nil;
		BOOL ok = [ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&err];
		[ctx release];
		return ok ? 1 : 0;
	}
}

// millLocalAuthEvaluate raises the system authentication sheet and
// waits for its verdict. evaluatePolicy returns immediately and calls
// its reply block on a private framework queue in an unspecified
// threading context (LAContext.h), so a semaphore -- not any assumed
// queue -- joins the answer back to this thread. Blocking here is the
// point: the Go caller's goroutine is the one that must wait, and it
// is never the thread the application's event loop runs on.
//
// The context is retained for the whole evaluation and released only
// after the wait returns: Apple's own warning is that releasing a
// context mid-evaluation cancels it.
//
// Returns 0 on success, otherwise the LAError code, or
// millForeignErrorDomain for a failure from another error domain.
static int millLocalAuthEvaluate(const char *reason) {
	@autoreleasepool {
		LAContext *ctx = [[LAContext alloc] init];
		NSString *why = [NSString stringWithUTF8String:reason];
		dispatch_semaphore_t sem = dispatch_semaphore_create(0);
		__block int result = 0;
		[ctx evaluatePolicy:LAPolicyDeviceOwnerAuthentication
		    localizedReason:why
		              reply:^(BOOL success, NSError *error) {
			if (!success) {
				if (error != nil && [error.domain isEqualToString:LAErrorDomain] && error.code != 0) {
					result = (int)error.code;
				} else {
					result = millForeignErrorDomain;
				}
			}
			dispatch_semaphore_signal(sem);
		}];
		dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
		dispatch_release(sem);
		[ctx release];
		return result;
	}
}
*/
import "C"

import (
	"unsafe"
)

// init swaps the portable ErrUnsupported defaults for the real
// framework calls on the one build that has them.
func init() {
	availableImpl = cgoAvailable
	authenticateImpl = cgoAuthenticate
}

func cgoAvailable() bool {
	return C.millLocalAuthAvailable() == 1
}

// cgoAuthenticate blocks until the sheet is answered. An empty reason
// is refused before it reaches the framework: evaluatePolicy raises
// NSInvalidArgumentException -- an Objective-C exception, which would
// terminate the process rather than surface as a Go error -- when
// localizedReason is nil or empty (LAContext.h).
func cgoAuthenticate(reason string) error {
	if reason == "" {
		return ErrInvalidContext
	}
	cReason := C.CString(reason)
	defer C.free(unsafe.Pointer(cReason))
	code := int(C.millLocalAuthEvaluate(cReason))
	if code == 0 {
		return nil
	}
	return errorForCode(code)
}
