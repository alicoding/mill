//go:build darwin && !server

package presencekey

// framework-api-audit: wails/v3@v3.0.0-beta.12 lacks any macOS Security-framework/keychain API -- SecureSet/SecureGet/SecureDelete (pkg/application/mobile_features_ios.go) are gated `//go:build ios` only, no desktop equivalent exists.

/*
#cgo CFLAGS: -mmacosx-version-min=10.15 -x objective-c -Wno-unguarded-availability-new
#cgo LDFLAGS: -framework Foundation -framework Security

#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <string.h>
#import <stdlib.h>

// Every query below pins kSecUseDataProtectionKeychain to NO: an
// access-control-protected item created against macOS's newer unified
// "data protection keychain" (the default once ANY entitlement is
// present) fails with errSecMissingEntitlement (-34018) for a process
// without a keychain-access-groups entitlement -- confirmed empirically
// against this package's own real keychain (goal 0204). Pinning to the
// legacy per-user login keychain on Add/Read/Delete alike needs no
// entitlement and is what credential.Store's go-keyring already targets
// for every other secret, so this stays consistent with it.

// millDeleteItem removes service/account's item by attribute match only
// -- it never requests kSecReturnData, so it never touches the
// protected value and never prompts, even for a presence-gated item.
static OSStatus millDeleteItem(const char *service, const char *account) {
	@autoreleasepool {
		NSDictionary *query = @{
			(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
			(__bridge id)kSecAttrService: [NSString stringWithUTF8String:service],
			(__bridge id)kSecAttrAccount: [NSString stringWithUTF8String:account],
			(__bridge id)kSecUseDataProtectionKeychain: @NO,
		};
		return SecItemDelete((__bridge CFDictionaryRef)query);
	}
}

// millReadPresenceItem BLOCKS the calling thread through the system
// authentication prompt when service/account's item carries
// kSecAttrAccessControl -- SecItemCopyMatching's own documented
// contract (goal 0204's DoR gate, sourced from Apple's own
// documentation: the calling thread carries no documented restriction,
// but the call itself blocks synchronously through the prompt, so
// Apple directs calling it off the main thread). Go's Read() wraps this
// call in its own fresh goroutine so it never runs on a thread the app
// needs back promptly. prompt is shown in the system sheet via
// kSecUseOperationPrompt.
static OSStatus millReadPresenceItem(const char *service, const char *account, const char *prompt, void **outData, int *outLen) {
	@autoreleasepool {
		NSMutableDictionary *query = [NSMutableDictionary dictionaryWithDictionary:@{
			(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
			(__bridge id)kSecAttrService: [NSString stringWithUTF8String:service],
			(__bridge id)kSecAttrAccount: [NSString stringWithUTF8String:account],
			(__bridge id)kSecReturnData: @YES,
			(__bridge id)kSecUseDataProtectionKeychain: @NO,
		}];
		if (prompt != NULL) {
			query[(__bridge id)kSecUseOperationPrompt] = [NSString stringWithUTF8String:prompt];
		}
		CFTypeRef result = NULL;
		OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
		if (status != errSecSuccess) {
			return status;
		}
		NSData *data = (__bridge NSData *)result;
		void *buf = data.length > 0 ? malloc(data.length) : NULL;
		if (buf != NULL) {
			memcpy(buf, data.bytes, data.length);
		}
		*outData = buf;
		*outLen = (int)data.length;
		CFRelease(result);
		return errSecSuccess;
	}
}

// millErrorMessage renders status as a human-readable string via
// Apple's own SecCopyErrorMessageString, returned as a strdup'd C
// string so the Go side can free it with C.free without any cgo/ARC
// bridging (returning an NSString/CFStringRef directly across cgo isn't
// safe to release from Go).
static char *millErrorMessage(OSStatus status) {
	@autoreleasepool {
		CFStringRef msg = SecCopyErrorMessageString(status, NULL);
		const char *utf8 = msg ? [(__bridge NSString *)msg UTF8String] : NULL;
		char *result = strdup(utf8 ? utf8 : "unknown keychain error");
		if (msg) CFRelease(msg);
		return result;
	}
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

func init() {
	readImpl = cgoRead
	removeImpl = cgoRemove
}

// cgoRemove deletes service/account's item; a not-found result is not
// an error (Remove's own documented idempotent contract).
func cgoRemove(service, account string) error {
	cService := C.CString(service)
	defer C.free(unsafe.Pointer(cService))
	cAccount := C.CString(account)
	defer C.free(unsafe.Pointer(cAccount))

	status := C.millDeleteItem(cService, cAccount)
	if status == C.errSecItemNotFound {
		return nil
	}
	return statusToErr(status)
}

// cgoRead performs the actual blocking SecItemCopyMatching call --
// Read() in presencekey.go is what wraps this in a fresh goroutine, so
// this function itself carries no goroutine/thread logic of its own.
func cgoRead(service, account, prompt string) ([]byte, error) {
	cService := C.CString(service)
	defer C.free(unsafe.Pointer(cService))
	cAccount := C.CString(account)
	defer C.free(unsafe.Pointer(cAccount))
	cPrompt := C.CString(prompt)
	defer C.free(unsafe.Pointer(cPrompt))

	var outData unsafe.Pointer
	var outLen C.int
	status := C.millReadPresenceItem(cService, cAccount, cPrompt, &outData, &outLen) //nolint:gocritic // cgo call-site false positive: gocritic's dupSubExpr misreads the two distinct out-param pointers as an identical LHS/RHS pair; there is no == on this line
	if status != C.errSecSuccess {
		return nil, statusToErr(status)
	}
	if outLen == 0 {
		return []byte{}, nil
	}
	defer C.free(outData)
	return C.GoBytes(outData, outLen), nil
}

func statusToErr(status C.OSStatus) error {
	switch status {
	case C.errSecSuccess:
		return nil
	case C.errSecItemNotFound:
		return ErrNotFound
	}
	cMsg := C.millErrorMessage(status)
	defer C.free(unsafe.Pointer(cMsg))
	return fmt.Errorf("presencekey: %s (status %d)", C.GoString(cMsg), int(status))
}
