import { describe, expect, it } from 'vitest'
import {
  CAPTURE_EXCLUDE_ATTRIBUTE,
  CAPTURE_LABEL_ATTRIBUTE,
  CAPTURE_PLACEHOLDER_ATTRIBUTE,
  IMAGE_EXPORT_PADDING,
  capturePlaceholderLabel,
  edgeIDsWithin,
  firstOpaqueColor,
  imageFilename,
  copiedNoticeKey,
  padBounds,
  shouldCapture,
  type CaptureCandidate,
  type CaptureScope,
} from './atlasImageExport'

function element(classes: string[], id: string | null = null, tagName = 'DIV'): CaptureCandidate {
  return {
    tagName,
    classList: { contains: (name: string) => classes.includes(name) },
    getAttribute: (name: string) => (name === 'data-id' ? id : null),
  }
}

const wholeBoard: CaptureScope = { nodeIDs: null, edgeIDs: null }

describe('shouldCapture (goal 0201)', () => {
  it('drops every piece of drag chrome, so an exported image never shows a handle or a resize frame', () => {
    for (const className of ['react-flow__handle', 'react-flow__resize-control', 'react-flow__nodesselection']) {
      expect(shouldCapture(element([className]), wholeBoard), className).toBe(false)
    }
  })

  it('drops chrome even inside a node that IS in scope', () => {
    const scope: CaptureScope = { nodeIDs: new Set(['a']), edgeIDs: new Set() }
    expect(shouldCapture(element(['react-flow__node'], 'a'), scope)).toBe(true)
    expect(shouldCapture(element(['react-flow__resize-control']), scope)).toBe(false)
  })

  it('drops an iframe, whose second document the rasterizer cannot reproduce', () => {
    expect(shouldCapture(element([], null, 'IFRAME'), wholeBoard)).toBe(false)
  })

  it('keeps every node and edge when nothing is selected', () => {
    expect(shouldCapture(element(['react-flow__node'], 'a'), wholeBoard)).toBe(true)
    expect(shouldCapture(element(['react-flow__edge'], 'a-b'), wholeBoard)).toBe(true)
  })

  it('keeps only the selected nodes and the edges between them', () => {
    const scope: CaptureScope = { nodeIDs: new Set(['a', 'b']), edgeIDs: new Set(['a-b']) }
    expect(shouldCapture(element(['react-flow__node'], 'a'), scope)).toBe(true)
    expect(shouldCapture(element(['react-flow__node'], 'c'), scope)).toBe(false)
    expect(shouldCapture(element(['react-flow__edge'], 'a-b'), scope)).toBe(true)
    expect(shouldCapture(element(['react-flow__edge'], 'b-c'), scope)).toBe(false)
  })

  it('keeps an ordinary element that is neither a node nor chrome', () => {
    expect(shouldCapture(element(['someCardClass']), { nodeIDs: new Set(['a']), edgeIDs: new Set() })).toBe(true)
  })

  it('drops a node with no id rather than guessing it is in scope', () => {
    expect(shouldCapture(element(['react-flow__node']), { nodeIDs: new Set(['a']), edgeIDs: new Set() })).toBe(false)
  })
})

describe('edgeIDsWithin', () => {
  const edges = [
    { id: 'a-b', source: 'a', target: 'b' },
    { id: 'b-c', source: 'b', target: 'c' },
    { id: 'c-a', source: 'c', target: 'a' },
  ]

  it('keeps only edges with BOTH ends selected, so no line runs off to nothing', () => {
    expect([...edgeIDsWithin(edges, new Set(['a', 'b']))]).toEqual(['a-b'])
  })

  it('is empty when the selection shares no edge', () => {
    expect(edgeIDsWithin(edges, new Set(['a'])).size).toBe(0)
  })
})

describe('padBounds', () => {
  it('grows the box by the fixed padding on every side', () => {
    expect(padBounds({ x: 100, y: 50, width: 400, height: 200 })).toEqual({
      x: 100 - IMAGE_EXPORT_PADDING,
      y: 50 - IMAGE_EXPORT_PADDING,
      width: 400 + IMAGE_EXPORT_PADDING * 2,
      height: 200 + IMAGE_EXPORT_PADDING * 2,
    })
  })
})

describe('firstOpaqueColor', () => {
  it('walks past transparent ancestors to the first painted one', () => {
    expect(firstOpaqueColor(['rgba(0, 0, 0, 0)', 'transparent', 'rgb(13, 17, 23)'], '#ffffff')).toBe('rgb(13, 17, 23)')
  })

  it('falls back when nothing in the ancestry paints', () => {
    expect(firstOpaqueColor(['transparent', ''], '#0d1117')).toBe('#0d1117')
  })
})

describe('imageFilename', () => {
  it('names the file after the board', () => {
    expect(imageFilename('Product map')).toBe('Product map.png')
  })

  it('folds path separators a filesystem would reject', () => {
    expect(imageFilename('Q3/Q4: plans')).toBe('Q3 Q4 plans.png')
  })
})

describe('copiedNoticeKey', () => {
  it('names WHAT was copied, and on a remote device WHERE it landed', () => {
    expect(copiedNoticeKey(true, false)).toBe('imageExport.copiedSelection')
    expect(copiedNoticeKey(false, false)).toBe('imageExport.copiedBoard')
    expect(copiedNoticeKey(true, true)).toBe('imageExport.copiedSelectionRemote')
    expect(copiedNoticeKey(false, true)).toBe('imageExport.copiedBoardRemote')
  })
})

// The naming contract AtlasBoard.module.css's own generic rules key
// off (goal 0201 follow-up): pinned here so a rename on this side is
// caught, since CSS can't import these constants to catch it itself.
describe('capture attribute names', () => {
  it('names the universal exclusion and placeholder attributes', () => {
    expect(CAPTURE_EXCLUDE_ATTRIBUTE).toBe('data-capture-exclude')
    expect(CAPTURE_PLACEHOLDER_ATTRIBUTE).toBe('data-capture-placeholder')
    expect(CAPTURE_LABEL_ATTRIBUTE).toBe('data-capture-label')
  })
})

describe('capturePlaceholderLabel', () => {
  it('joins a frame-backed noun\'s own title beside its kind', () => {
    expect(capturePlaceholderLabel('Quarterly report', 'PDF')).toBe('Quarterly report · PDF')
  })
})
