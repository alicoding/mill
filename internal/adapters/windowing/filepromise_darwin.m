//go:build darwin && !server

#import <AppKit/AppKit.h>
#include <stdlib.h>
#include <string.h>
#include "filepromise_darwin.h"

// The Go-side receiver (filepromise_darwin.go's //export).
extern void millFilePromiseDropped(char** paths, int count, int x, int y);

// MillFilePromiseDropView receives FILE-PROMISE drags (the macOS
// post-screenshot floating thumbnail, a browser image drag) that the
// toolkit's own drag view structurally refuses -- it registers only
// NSFilenamesPboardType, so a promise-only pasteboard never matches it
// (docs/goals/0256). Registration here is promise-types-only, and the
// view is inserted BELOW every existing subview: AppKit targets the
// frontmost registered candidate under the pointer, so any drag that
// carries real filenames keeps matching the toolkit's own topmost view
// exactly as before -- existing drops are untouched by construction.
@interface MillFilePromiseDropView : NSView
@end

@implementation MillFilePromiseDropView

// Mouse events pass through to the webview underneath -- drag delivery
// uses registerForDraggedTypes, not hitTest (same contract as the
// toolkit's own drag view).
- (NSView *)hitTest:(NSPoint)point {
    return nil;
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
    return NSDragOperationCopy;
}

- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
    return NSDragOperationCopy;
}

- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    NSPasteboard *pb = [sender draggingPasteboard];
    NSArray<NSFilePromiseReceiver *> *receivers =
        [pb readObjectsForClasses:@[[NSFilePromiseReceiver class]] options:@{}];
    if (receivers.count == 0) {
        return NO;
    }

    NSString *destDir = [NSTemporaryDirectory() stringByAppendingPathComponent:
        [NSString stringWithFormat:@"mill-promise-drop-%@", [[NSUUID UUID] UUIDString]]];
    if (![[NSFileManager defaultManager] createDirectoryAtPath:destDir
                                   withIntermediateDirectories:YES
                                                    attributes:nil
                                                         error:nil]) {
        return NO;
    }
    NSURL *destURL = [NSURL fileURLWithPath:destDir isDirectory:YES];

    // Same top-left coordinate math as the toolkit's own drag view --
    // the frontend hit-tests these against document.elementFromPoint.
    NSPoint pWin = [sender draggingLocation];
    NSPoint pView = [self convertPoint:pWin fromView:nil];
    CGFloat contentHeight = self.window.contentView.frame.size.height;
    int x = (int)pView.x;
    int y = (int)(contentHeight - pView.y);

    // Receipt is asynchronous BY the API's own contract (the promise
    // source writes the file on its own schedule); the reader blocks
    // run on this background queue, never the main thread, and the
    // dispatch group fires the one Go callback once every promised
    // file has either landed or errored.
    NSOperationQueue *queue = [NSOperationQueue new];
    dispatch_group_t group = dispatch_group_create();
    NSMutableArray<NSString *> *landed = [NSMutableArray array];
    NSLock *lock = [NSLock new];
    for (NSFilePromiseReceiver *receiver in receivers) {
        dispatch_group_enter(group);
        [receiver receivePromisedFilesAtDestination:destURL
                                            options:@{}
                                     operationQueue:queue
                                             reader:^(NSURL *fileURL, NSError *error) {
            if (error == nil && fileURL != nil) {
                [lock lock];
                [landed addObject:fileURL.path];
                [lock unlock];
            }
            dispatch_group_leave(group);
        }];
    }
    dispatch_group_notify(group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSUInteger count = landed.count;
        if (count == 0) {
            return;
        }
        char **cArr = (char **)malloc(sizeof(char *) * count);
        for (NSUInteger i = 0; i < count; i++) {
            cArr[i] = strdup([landed[i] UTF8String]);
        }
        millFilePromiseDropped(cArr, (int)count, x, y);
        for (NSUInteger i = 0; i < count; i++) {
            free(cArr[i]);
        }
        free(cArr);
    });
    return YES;
}

@end

void millAttachPromiseView(void *nsWindowPtr) {
    // Fail-safe, never fail-crash: a missing window/contentView means
    // no promise support this launch, not an abort at startup.
    if (nsWindowPtr == NULL) {
        return;
    }
    NSWindow *win = (__bridge NSWindow *)nsWindowPtr;
    NSView *content = win.contentView;
    if (content == nil) {
        return;
    }
    MillFilePromiseDropView *v = [[MillFilePromiseDropView alloc] initWithFrame:content.bounds];
    v.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [v registerForDraggedTypes:[NSFilePromiseReceiver readableDraggedTypes]];
    [content addSubview:v positioned:NSWindowBelow relativeTo:nil];
}
