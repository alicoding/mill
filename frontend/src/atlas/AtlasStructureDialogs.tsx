import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasTableFromListDialog } from './AtlasTableFromListDialog'
import { AtlasNewSpaceDialog } from './AtlasNewSpaceDialog'

// Goal 0139's two surviving dialogs, split out of AtlasView.tsx at
// the 500-line convention: the from-a-List projection (reached from
// the tray picker's footer) and New space (the one create with no
// canvas to point at).
export function AtlasStructureDialogs({ kinds, tableFromListOpen, onCloseTableFromList, newSpaceOpen, onCloseNewSpace, onCreateTable, onCreateSpace }: {
  kinds: Kind[]
  tableFromListOpen: boolean
  onCloseTableFromList: () => void
  newSpaceOpen: boolean
  onCloseNewSpace: () => void
  onCreateTable: (listID: string) => Promise<void>
  onCreateSpace: (kindID: string, title: string) => Promise<void>
}) {
  return (
    <>
      {tableFromListOpen && (
        <AtlasTableFromListDialog onCreate={onCreateTable} onClose={onCloseTableFromList} />
      )}
      {newSpaceOpen && (
        <AtlasNewSpaceDialog kinds={kinds} onCreate={onCreateSpace} onClose={onCloseNewSpace} />
      )}
    </>
  )
}
