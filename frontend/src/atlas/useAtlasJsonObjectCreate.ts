import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { titleFromFilename } from './atlasCreateHelpers'

// The JSON/YAML file drop's own placement door (goal 0269): a native OS
// drop (or a pasted file path) of a .json/.yaml/.yml lands as a "json"
// BoardObject -- mirror-only, never a card, the same landing shape the
// diagram, sheet and pdf doors established. The claim test itself lives
// in ./jsonTree.ts beside the parser that reads the same extensions.
export function useAtlasJsonObjectCreate() {
  const land = async (path: string, parentID: string, pos: { X: number; Y: number }) => {
    await AtlasService.CreateBoardObject('json', { mirrorPath: path, title: titleFromFilename(path) }, pos, parentID)
    await refreshAtlas()
  }

  return { land }
}
