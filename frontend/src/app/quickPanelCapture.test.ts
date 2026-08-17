import { describe, expect, it } from 'vitest'
import { cascadeNotePosition, resolveNoteParentID, SEEDED_SCRATCHPAD_CARD_ID } from './quickPanelCapture'
import type { Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// Minimal-but-valid Card/Note fixtures -- every field the interface
// declares, only the fields each test actually varies. Local to this
// test file, same reasoning workflowFrecency.test.ts's own header
// comment gives (no existing fixture builder for these to reuse).
function makeCard(id: string, parentID = ''): Card {
  return {
    ID: id, KindID: 'atlas-kind-topic', Title: id, Note: '', Fields: null,
    ParentID: parentID, Position: null, ViewMode: ViewMode.$zero, Source: '', MirrorPath: '',
    RefreshWorkflowID: '', ActionWorkflowIDs: null, LastSyncedAt: '', ReceiptRunID: '',
    CreatedAt: '', UpdatedAt: '', BuiltIn: false, Seed: { SeedRevision: 0, Modified: false },
  }
}

function makeNote(id: string, parentID: string): Note {
  return { ID: id, Text: id, Position: { X: 0, Y: 0 }, ParentID: parentID, CreatedAt: '', UpdatedAt: '' }
}

describe('resolveNoteParentID', () => {
  it('targets the seeded Scratchpad card when it exists', () => {
    const cards = [makeCard('atlas-card-my-space'), makeCard(SEEDED_SCRATCHPAD_CARD_ID, 'atlas-card-my-space')]
    expect(resolveNoteParentID(cards)).toBe(SEEDED_SCRATCHPAD_CARD_ID)
  })

  it('falls back to root when the Scratchpad seed has been deleted', () => {
    const cards = [makeCard('atlas-card-my-space')]
    expect(resolveNoteParentID(cards)).toBe('')
  })

  it('falls back to root for a null/undefined card list', () => {
    expect(resolveNoteParentID(null)).toBe('')
    expect(resolveNoteParentID(undefined)).toBe('')
  })
})

describe('cascadeNotePosition', () => {
  it('starts at the base offset when the target has no notes yet', () => {
    expect(cascadeNotePosition([], 'atlas-card-scratchpad')).toEqual({ X: 80, Y: 80 })
  })

  it('steps diagonally per existing note in the SAME parent, never landing on the same spot twice in a row', () => {
    const notes = [makeNote('n1', 'atlas-card-scratchpad'), makeNote('n2', 'atlas-card-scratchpad')]
    expect(cascadeNotePosition(notes, 'atlas-card-scratchpad')).toEqual({ X: 112, Y: 112 })
  })

  it('ignores notes filed under a DIFFERENT parent', () => {
    const notes = [makeNote('n1', 'some-other-card'), makeNote('n2', 'some-other-card')]
    expect(cascadeNotePosition(notes, 'atlas-card-scratchpad')).toEqual({ X: 80, Y: 80 })
  })

  it('wraps back to the base offset once the cascade would walk off the board', () => {
    const notes = Array.from({ length: 10 }, (_, i) => makeNote(`n${i}`, 'atlas-card-scratchpad'))
    expect(cascadeNotePosition(notes, 'atlas-card-scratchpad')).toEqual({ X: 80, Y: 80 })
  })
})
