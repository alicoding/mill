import { Banner } from '@primer/react'

interface ExternalChangeBannerProps {
  onReload: () => void
  onKeep: () => void
}

// Shown when an external MCP write (docs/adr/0025's authoring loop)
// changes the open workflow's definition while the canvas has unsaved
// local edits (useCanvasLiveSync.ts's GAP B) -- mirrors
// WorkTabShell.tsx's own hot-exit "Unsaved changes restored" Banner in
// shape, one level down (per-canvas, not per-tab). Deliberately never
// applies the external change while dirty: Reload discards the local
// draft and loads the fresh definition; Keep my draft dismisses and
// leaves local edits in place -- the caption names the real
// consequence of that choice (Save still overwrites the external edit,
// the existing last-write-wins behavior, not new here).
export function ExternalChangeBanner({ onReload, onKeep }: ExternalChangeBannerProps) {
  return (
    <Banner
      variant="warning"
      title="This workflow was changed outside this editor"
      description="An MCP client updated this workflow's definition while you had unsaved edits open. Keeping your draft means saving here later will overwrite that external change (last write wins)."
      primaryAction={<Banner.PrimaryAction onClick={onReload}>Reload</Banner.PrimaryAction>}
      secondaryAction={<Banner.SecondaryAction onClick={onKeep}>Keep my draft</Banner.SecondaryAction>}
      onDismiss={onKeep}
      data-testid="external-change-banner"
    />
  )
}
