// The clipboard-read door's own secure-context awareness (goal 0169
// slice 2, clipboardWrite.ts's read-side sibling): navigator.clipboard.
// read() IS secure-context-gated (dead over plain http, exactly Mill's
// remote posture), but a real paste gesture's own PasteEvent.
// clipboardData is NOT -- it fires from a real user keypress with no
// permission prompt and no context restriction. So this helper never
// touches navigator.clipboard at all; it reads the DataTransfer a
// `paste` event (or a React onPaste handler) already carries, which
// works identically whether Mill is reached over http or https.

// ClipboardImageSource is the structural slice of DataTransfer this
// module actually reads -- a real PasteEvent.clipboardData satisfies it
// unchanged, while a unit test builds a plain object literal instead of
// constructing a real (jsdom-unsupported) DataTransfer.
export interface ClipboardImageSource {
  items: Iterable<{ kind: string; type: string; getAsFile(): File | null }>
  files: Iterable<File>
}

// readClipboardImageFile returns the first image file a paste's own
// DataTransfer carries, or null when the clipboard held no image (plain
// text, a copied Finder file with no image type, or nothing at all) --
// a caller checks null to fall through to its own default paste
// handling rather than swallowing the event.
export function readClipboardImageFile(data: ClipboardImageSource): File | null {
  for (const item of data.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile()
    }
  }
  for (const file of data.files) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}
