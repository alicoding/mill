import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'

// Subscribes to the live mirror-changed signal (goal 0194's live
// round-trip slice): fires onChange whenever id's own diagram/mermaid
// mirror file changes on disk -- an external edit, or a "Choose file"
// re-pick -- so a rendered diagram host refetches without polling. A
// no-op subscription while id is empty (nothing to watch yet).
export function useAtlasMirrorChanged(id: string, onChange: () => void): void {
  useEffect(() => {
    if (!id) return undefined
    return Events.On('atlas-mirror-changed', (evt) => {
      if (evt.data.id === id) onChange()
    })
  }, [id, onChange])
}
