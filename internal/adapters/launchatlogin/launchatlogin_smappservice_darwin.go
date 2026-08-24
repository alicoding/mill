//go:build darwin && !server

package launchatlogin

/*
#cgo CFLAGS: -mmacosx-version-min=10.15 -x objective-c -Wno-unguarded-availability-new
#cgo LDFLAGS: -framework Foundation -framework ServiceManagement

#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>

// Reading SMAppService.status needs no Automation permission and has
// no side effects -- unlike registerAndReturnError/unregisterAndReturnError
// (left to Wails' own AutostartManager), this is a plain property read.
// Returns 1 when the registration is pending the user's approval in
// System Settings, 0 otherwise (including pre-macOS-13, where the
// SMAppService class doesn't exist at all).
static int millSMAppServiceRequiresApproval(void) {
	if (@available(macOS 13.0, *)) {
		@autoreleasepool {
			return [SMAppService mainAppService].status == SMAppServiceStatusRequiresApproval ? 1 : 0;
		}
	}
	return 0;
}
*/
import "C"

// smAppServiceRequiresApproval reports whether macOS is holding Mill's
// SMAppService registration pending the user's explicit approval --
// the one bit AutostartManager.Status() (Wails' public API) does not
// surface, per this package's doc comment.
func smAppServiceRequiresApproval() bool {
	return C.millSMAppServiceRequiresApproval() == 1
}
