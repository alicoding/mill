// modalSurfaceOpen reports whether a modal dialog currently owns the
// screen -- a card page, the command palette, a confirm dialog (Primer
// Dialog renders role="dialog"; its alert variant role="alertdialog").
// Window-level clipboard doors on a canvas stand down while one is
// open: a paste reaching the COVERED canvas lands entities invisibly
// behind the modal, and a copy silently overwrites the clipboard with
// a hidden canvas selection. Anchored popovers (the image popover,
// pickers) render role="none" and deliberately do not engage this
// gate -- the canvas stays the foreground surface under them.
export function modalSurfaceOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}
