import { useEffect, useRef, useState } from 'react'

// An offer with a button earns a longer read-and-decide window.
const ACTION_TOAST_DURATION_MS = 8000
const TOAST_DURATION_MS = 3_000

// A one-line, no-button toast for a membership add/remove ("Added to
// {name}"/"Removed from {name}") or a perspective-service refusal
// message -- quieter than useAtlasUndoToast.ts's own delete guard
// (no undo action to offer, so it clears itself sooner). One message
// at a time: a later show() replaces whatever was still showing.
export function useAtlasQuietToast() {
  const [message, setMessage] = useState<string | null>(null)
  // An optional one-shot action rendered as the toast's button (the
  // multi-purpose-surface rule: the clipboard's "also copy the items
  // inside" offer is its first consumer, goal 0153).
  const [action, setAction] = useState<{ label: string; run: () => void } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (text: string, withAction?: { label: string; run: () => void }) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setMessage(text)
    setAction(withAction ? { ...withAction, run: () => { setMessage(null); setAction(null); withAction.run() } } : null)
    timerRef.current = setTimeout(() => { setMessage(null); setAction(null) }, withAction ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS)
  }

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  return { message, action, show }
}
