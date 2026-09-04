//go:build darwin && !server

package filetrash

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation

#import <Foundation/Foundation.h>
#import <string.h>
#import <stdlib.h>

// millTrashItem moves path to the user's Trash through NSFileManager's
// own trashItemAtURL:resultingItemURL:error: and returns the resulting
// Trash path, or NULL with *errOut set to the localized failure.
//
// NSFileManager carries no main-thread affinity for this call (unlike
// the AppKit calls Mill hops for explicitly) -- the documented
// constraint is only that ONE NSFileManager instance not be shared
// across threads, which +defaultManager satisfies per call site.
// Both returned strings are strdup'd for the Go side to free.
static char *millTrashItem(const char *path, char **errOut) {
	@autoreleasepool {
		NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
		NSURL *resulting = nil;
		NSError *error = nil;
		if (![[NSFileManager defaultManager] trashItemAtURL:url resultingItemURL:&resulting error:&error]) {
			*errOut = strdup([[error localizedDescription] UTF8String]);
			return NULL;
		}
		if (resulting == nil) {
			return strdup("");
		}
		return strdup([[resulting path] UTF8String]);
	}
}
*/
import "C"

import (
	"errors"
	"unsafe"
)

func trash(path string) (string, error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	var cErr *C.char
	cDest := C.millTrashItem(cPath, &cErr)
	if cDest == nil {
		msg := "the system refused to move it to the Trash"
		if cErr != nil {
			msg = C.GoString(cErr)
			C.free(unsafe.Pointer(cErr))
		}
		return "", errors.New(msg)
	}
	defer C.free(unsafe.Pointer(cDest))
	return C.GoString(cDest), nil
}
