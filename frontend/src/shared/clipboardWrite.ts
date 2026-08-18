import copy from 'copy-to-clipboard'

// The one clipboard-write door for every copy action. navigator.clipboard
// exists only in secure contexts (https or localhost) -- a Mill server
// reached over plain http on another device (the Tailscale instance) has
// no navigator.clipboard at all, and the old direct writeText calls
// silently did nothing there. Fallback is the execCommand path via the
// vetted copy-to-clipboard package rather than a hand-rolled textarea
// dance. Throws when both doors fail so a caller's existing error
// feedback fires instead of reporting a copy that never happened.
export async function writeClipboardText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Permission denied or transiently unavailable -- fall through.
    }
  }
  if (!copy(text)) {
    throw new Error('Copy failed: the browser blocked clipboard access')
  }
}
