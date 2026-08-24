import type { AtlasArmableTool, AtlasCreationTool, AtlasToolID } from './atlasTools'

// Type-only proof (goal 0180 S1): AtlasToolID/AtlasCreationTool/
// AtlasArmableTool must stay literal unions after the self-registration
// migration, never widen to `string` -- import.meta.glob's own
// Record<string, unknown> return type is exactly what would collapse
// them if any of the three derived from it instead of
// shared/atlasToolIdentity.ts's still-literal AtlasToolIdentity union
// (atlasTools.ts's own header comment has the full trap). `tsc`
// (frontend/package.json's `build`/`build:dev` scripts) fails this
// file if any `@ts-expect-error` below stops being a real type error --
// nothing here runs at runtime, and nothing imports this file.
function typeCheckOnly(): void {
  // A literal union rejects an arbitrary string; `string` would not.
  // @ts-expect-error -- not a real tool id, must not satisfy AtlasToolID
  const bogusToolID: AtlasToolID = 'not-a-real-tool'
  // @ts-expect-error -- not a real tool id, must not satisfy AtlasCreationTool
  const bogusCreationTool: AtlasCreationTool = 'not-a-real-tool'
  // @ts-expect-error -- not a real tool id, must not satisfy AtlasArmableTool
  const bogusArmableTool: AtlasArmableTool = 'not-a-real-tool'

  // A real id from the WRONG interaction class must also fail -- pins
  // that AtlasCreationTool/AtlasArmableTool truly exclude the tools
  // outside their own interaction set, not just reject nonsense strings.
  // @ts-expect-error -- 'table' is pick-then-place, excluded from AtlasCreationTool
  const tableNotCreationTool: AtlasCreationTool = 'table'
  // @ts-expect-error -- 'image' is paste-or-drop, excluded from AtlasArmableTool
  const imageNotArmableTool: AtlasArmableTool = 'image'

  void bogusToolID
  void bogusCreationTool
  void bogusArmableTool
  void tableNotCreationTool
  void imageNotArmableTool
}
void typeCheckOnly
