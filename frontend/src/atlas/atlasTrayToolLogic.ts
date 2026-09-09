import type { AtlasArmableTool, AtlasToolShape } from './atlasTools'
import type { AtlasTrayToolHandlers } from './AtlasTrayToolButton'

// armTool -- the ONE door that arms a tool by id, whichever surface
// asked (a dock button, a flyout entry, a More panel row). Routing off
// the tool's own declared interaction rather than its id means a plugin
// tool arms through the same call a built-in does.
export function armTool(tool: AtlasToolShape, handlers: AtlasTrayToolHandlers, armed: boolean): void {
  if (tool.interaction === 'pick-then-place') {
    handlers.onTableToggle(!armed)
    return
  }
  if (tool.interaction === 'paste-or-drop') {
    handlers.onImageToggle(!armed)
    return
  }
  handlers.onToggle(tool.id as AtlasArmableTool)
}
