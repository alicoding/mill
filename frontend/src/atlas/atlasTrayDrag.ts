// The drag payload's own MIME key (goal 0081 slice A1) -- shared by the
// dock button's onDragStart and AtlasBoard's own onDrop handler so a
// drag-from-dock placement and a click-to-arm placement land through
// the exact same "what tool, what point" contract. Area (slice A2) arms
// via click/bare-key like Card/Note, but its own placement is a
// drag-drawn rectangle, not a single drop point -- it carries no
// ATLAS_TOOL_DRAG_MIME payload of its own.
//
// Its own module (goal 0355) so the button that SETS it and the tray
// that renders that button don't have to import each other.
export const ATLAS_TOOL_DRAG_MIME = 'application/x-mill-atlas-tool'
