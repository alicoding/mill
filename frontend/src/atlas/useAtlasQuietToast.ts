import { useEffect, useRef, useState } from 'react'

const TOAST_DURATION_MS = 3_000

// A one-line, no-button toast for a membership add/remove ("Added to
// {name}"/"Removed from {name}") or a perspective-service refusal
// message -- quieter than useAtlasUndoToast.ts's own delete guard
// (no undo action to offer, so it clears itself sooner). One message
// at a time: a later show() replaces whatever was still showing.
export function useAtlasQuietToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (text: string) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setMessage(text)
    timerRef.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS)
  }

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  return { message, show }
}
