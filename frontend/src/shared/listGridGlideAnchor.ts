// Screen rectangle -> host-relative CSS px (the board's zoom scales
// the host, the grid reports unscaled screen px). Shared by
// ListGridGlideMenus.tsx's own anchored menus and ListGridGlide.tsx
// (goal 0419 S1b: a non-component export next to ListGridGlideMenus.tsx's
// components broke react-refresh/only-export-components).
export interface Anchor { x: number; y: number; width: number; height: number }

export function anchorFromBounds(host: HTMLElement | null, bounds: Anchor): Anchor {
  const rect = host?.getBoundingClientRect()
  const scale = host && rect ? rect.width / host.offsetWidth || 1 : 1
  return {
    x: (bounds.x - (rect?.left ?? 0)) / scale,
    y: (bounds.y - (rect?.top ?? 0)) / scale,
    width: bounds.width / scale,
    height: bounds.height / scale,
  }
}
