import { describe, expect, it } from 'vitest'
import type { AtlasToolShape } from './atlasNounRegistry'
import {
  DOCK_OBJECT_TOOL_IDS, MAX_RECENT_TOOLS, dockSlotFor, matchesCategory, matchesToolQuery,
  placeDockTools, pushRecentTool,
} from './atlasToolPlacement'

// The dock's placement rule is data in, data out (goal 0355) -- these
// stand-ins carry only the fields placeDockTools reads, so the table
// stays readable and no registry mutation is needed to add a case.
function tool(id: string, group: AtlasToolShape['group']): AtlasToolShape {
  return { id, group } as unknown as AtlasToolShape
}

const CARD = tool('card', 'objects')
const NOTE = tool('note', 'objects')
const AREA = tool('area', 'objects')
const TABLE = tool('table', 'objects')
const IMAGE = tool('image', 'media')
const PENCIL = tool('pencil', 'annotate')
const SCRIBBLE = tool('scribble', 'embed')
const MINDMAP = tool('markmap', 'objects')
const BRUNO = tool('bruno', 'media')

describe('dockSlotFor', () => {
  it('gives the four named object tools their own dock slot', () => {
    for (const id of DOCK_OBJECT_TOOL_IDS) {
      expect(dockSlotFor({ id, group: 'objects' } as AtlasToolShape)).toBe('objects')
    }
  })

  it('routes a media tool to the Media flyout and an annotate tool to the Annotate flyout', () => {
    expect(dockSlotFor(IMAGE)).toBe('media')
    expect(dockSlotFor(BRUNO)).toBe('media')
    expect(dockSlotFor(PENCIL)).toBe('annotate')
  })

  it('keeps the four letter chips stable: a FIFTH objects tool is panel-only, never a fifth chip', () => {
    expect(dockSlotFor(MINDMAP)).toBe('panel')
  })

  it('puts an undeclared plugin face in the panel', () => {
    expect(dockSlotFor(SCRIBBLE)).toBe('panel')
  })
})

describe('placeDockTools', () => {
  const placement = placeDockTools([CARD, NOTE, AREA, TABLE, IMAGE, PENCIL, SCRIBBLE, MINDMAP, BRUNO])

  it('renders the object slots in the dock\'s fixed order, not the registry\'s', () => {
    expect(placement.objects.map((t) => t.id)).toEqual(['card', 'note', 'area', 'table'])
  })

  it('collects every media and annotate tool into its own flyout', () => {
    expect(placement.media.map((t) => t.id)).toEqual(['image', 'bruno'])
    expect(placement.annotate.map((t) => t.id)).toEqual(['pencil'])
  })

  it('lists every registered tool in the panel, dock-visible ones included', () => {
    expect(placement.panel.map((t) => t.id)).toContain('card')
    expect(placement.panel).toHaveLength(9)
  })

  it('drops a disabled tool from its slot rather than showing it dimmed', () => {
    const withoutArea = placeDockTools([CARD, NOTE, TABLE, IMAGE])
    expect(withoutArea.objects.map((t) => t.id)).toEqual(['card', 'note', 'table'])
  })

  it('renders no Annotate flyout when every annotate tool is gone', () => {
    expect(placeDockTools([CARD, IMAGE]).annotate).toEqual([])
  })
})

describe('matchesCategory', () => {
  it('matches everything under All and only its own group otherwise', () => {
    expect(matchesCategory(SCRIBBLE, 'all')).toBe(true)
    expect(matchesCategory(SCRIBBLE, 'embed')).toBe(true)
    expect(matchesCategory(SCRIBBLE, 'objects')).toBe(false)
    expect(matchesCategory(IMAGE, 'media')).toBe(true)
  })
})

describe('matchesToolQuery', () => {
  const scribble = { label: 'Scribble', nounName: 'Scribble', pluginId: 'mill-scribble' }

  it('returns every tool for an empty or whitespace query', () => {
    expect(matchesToolQuery(scribble, '')).toBe(true)
    expect(matchesToolQuery(scribble, '   ')).toBe(true)
  })

  it('matches case-insensitively on the name and on the plugin it came from', () => {
    expect(matchesToolQuery(scribble, 'scri')).toBe(true)
    expect(matchesToolQuery(scribble, 'SCRIBBLE')).toBe(true)
    expect(matchesToolQuery(scribble, 'mill-scribble')).toBe(true)
    expect(matchesToolQuery(scribble, 'roadmap')).toBe(false)
  })
})

describe('pushRecentTool', () => {
  it('puts the newest first', () => {
    expect(pushRecentTool(['note'], 'card')).toEqual(['card', 'note'])
  })

  it('re-uses an existing entry rather than repeating it', () => {
    expect(pushRecentTool(['note', 'card'], 'card')).toEqual(['card', 'note'])
  })

  it('never grows past the row it renders', () => {
    const full = ['a', 'b', 'c', 'd', 'e']
    expect(pushRecentTool(full, 'f')).toEqual(['f', 'a', 'b', 'c', 'd'])
    expect(pushRecentTool(full, 'f')).toHaveLength(MAX_RECENT_TOOLS)
  })
})
