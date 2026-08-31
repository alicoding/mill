//go:build darwin && !server

#ifndef MILL_FILEPROMISE_DARWIN_H
#define MILL_FILEPROMISE_DARWIN_H

// Installs the file-promise drop view on the given NSWindow* -- must
// run on the AppKit main thread (the Go caller marshals through
// runMainThreadAction). Implementation and design reasoning live in
// filepromise_darwin.m.
void millAttachPromiseView(void *nsWindowPtr);

#endif
