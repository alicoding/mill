// The binary branch (goal 0326): bytes are not text and are never
// rendered as if they were. A picture, a sound or a video the browser
// can play is played; anything else states what it is -- name, type,
// size -- and offers to save it. Split from OutputMediaView.tsx (goal
// 0419 S1b): binaryFrom is OutputViewer.tsx's own conversion door, not
// a component, so it broke react-refresh/only-export-components
// sitting beside OutputMediaView.

export interface BinaryOutput {
  // A data: or blob: URL. Output never carries a remote address here:
  // the viewer paints what the producer already handed over, it does
  // not fetch.
  src?: string
  name?: string
  mime?: string
  size?: number
}

export function binaryFrom(value: unknown, mime?: string): BinaryOutput {
  if (typeof value === 'string') return { src: value.startsWith('data:') || value.startsWith('blob:') ? value : undefined, mime }
  if (typeof value === 'object' && value !== null) {
    const v = value as BinaryOutput
    return { src: v.src, name: v.name, mime: v.mime ?? mime, size: v.size }
  }
  return { mime }
}
