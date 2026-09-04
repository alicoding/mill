// Package filetrash moves a directory or file out of the way
// RECOVERABLY -- the platform's own Trash where there is one, a
// sibling `.trash` folder where there is not.
//
// Hand-written rather than adopted: Wails3's own API surface was
// enumerated for this domain first (architecture.md's "read the
// dependency's whole API" rule) -- pkg/application offers windows,
// dialogs, menus, the browser and dock, and nothing that reaches
// NSFileManager's trash verb, so there is no toolkit call to compose
// here. The macOS half is NSFileManager's own trashItemAtURL:, the one
// documented API that produces a Finder-restorable item.
//
// Removal is not journalled anywhere in Mill -- the Trash IS the undo
// (goal 0321).
package filetrash

import "errors"

// ErrEmptyPath guards the caller that passes "" -- trashing the
// current directory is never what that meant.
var ErrEmptyPath = errors.New("filetrash: empty path")

// trashImpl is the platform seam, swapped in tests.
var trashImpl = trash

// Trash moves path out of the way and returns where it landed, so the
// caller can tell the user exactly where to look for it.
func Trash(path string) (string, error) {
	if path == "" {
		return "", ErrEmptyPath
	}
	return trashImpl(path)
}
