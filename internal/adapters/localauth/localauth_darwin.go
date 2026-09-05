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

// millLocalAuthCapability answers the three prompt-free
// canEvaluatePolicy reads Describe maps, packed into a bitmask so one
// cgo call covers all of them: bit 0 the device-owner policy Mill
// actually evaluates, bit 1 Touch ID, bit 2 a paired Apple Watch.
//
// biometryType is documented as meaningful only after
// canEvaluatePolicy has been called on that context (LAContext.h), so
// it is read from the same context, after the biometrics evaluation,
// never from a fresh one. Only LABiometryTypeTouchID counts as Touch
// ID here: no Mac ships any other biometry, and an unrecognised future
// type falls back to the password wording, which under-promises rather
// than naming hardware this Mac may not have.
static int millLocalAuthCapability(void) {
	@autoreleasepool {
		int mask = 0;
		NSError *err = nil;
		LAContext *ctx = [[LAContext alloc] init];
		if ([ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&err]) {
			mask |= 1;
		}
		err = nil;
		if ([ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&err]
		    && ctx.biometryType == LABiometryTypeTouchID) {
			mask |= 2;
		}
		err = nil;
		if ([ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithWatch error:&err]) {
			mask |= 4;
		}
		[ctx release];
		return mask;
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
	capabilityImpl = cgoCapability
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

// cgoCapability unpacks millLocalAuthCapability's bitmask into the
// port's own Capability values.
func cgoCapability() Capability {
	mask := int(C.millLocalAuthCapability())
	return capabilityFor(mask&1 != 0, mask&2 != 0, mask&4 != 0)
}
