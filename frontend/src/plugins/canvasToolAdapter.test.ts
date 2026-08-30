import { describe, expect, it } from 'vitest'
import { adaptStyleFields, canvasToolDeclError, styleFieldDefault } from './canvasToolAdapter'
import type { CanvasObjectDecl } from './sdk'

const base: CanvasObjectDecl = {
  kind: 'thing', label: 'Thing', icon: '⭐', source: 'board-local', editRoute: 'none',
  renderFace: () => {},
}

describe('canvasToolDeclError', () => {
  it('accepts the plain click declaration unchanged', () => {
    expect(canvasToolDeclError(base)).toBeNull()
  })

  it('requires a gesture with onEnd for a drag interaction', () => {
    expect(canvasToolDeclError({ ...base, interaction: 'drag-to-draw' })).toMatch(/requires a gesture/)
    expect(canvasToolDeclError({ ...base, interaction: 'drag-to-draw', gesture: { onEnd: () => {} } })).toBeNull()
  })

  it('forbids a gesture on arm-then-click', () => {
    expect(canvasToolDeclError({ ...base, gesture: { onEnd: () => {} } })).toMatch(/only legal on a drag/)
  })

  it('lets an ephemeral tool omit renderFace, but no other interaction', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring away renderFace is the point of the case
    const { renderFace: _rf, ...faceless } = base
    expect(canvasToolDeclError({ ...faceless, interaction: 'ephemeral-drag', gesture: { onEnd: () => {} } })).toBeNull()
    expect(canvasToolDeclError({ ...faceless })).toMatch(/renderFace/)
  })

  it('rejects unknown interaction and style field shapes', () => {
    expect(canvasToolDeclError({ ...base, interaction: 'hover' as never })).toMatch(/unknown interaction/)
    expect(canvasToolDeclError({ ...base, styleFields: [{ type: 'font' as never, key: 'f', options: ['a'], default: 'a' }] })).toMatch(/unknown style field type/)
    expect(canvasToolDeclError({ ...base, styleFields: [{ type: 'color', key: 'c', options: [], default: '#000' }] })).toMatch(/non-empty options/)
    expect(canvasToolDeclError({ ...base, styleFields: [{ type: 'color', key: 'no spaces!', options: ['#000'], default: '#000' }] })).toMatch(/alphanumeric/)
  })
})

describe('adaptStyleFields', () => {
  it('fills the panel plumbing: kind-derived testids, verbatim group labels, real interpolated width labels', () => {
    const fields = adaptStyleFields('scribble', 'Scribble', [
      { type: 'color', key: 'color', options: ['#111', '#222'], default: '#111' },
      { type: 'stroke-width', key: 'size', options: [2, 4], default: 2 },
      { type: 'stroke-width', key: 'width', render: 'line', options: [1, 2], default: 1 },
      { type: 'color-or-none', key: 'fill', options: ['#333'] },
    ])
    expect(fields[0]).toMatchObject({ type: 'color', testidPrefix: 'atlas-scribble-color', groupLabelKey: 'Scribble color', default: '#111' })
    expect(fields[1]).toMatchObject({ type: 'stroke-width', render: 'dot', optionLabelKey: 'pencilStyle.sizeOption' })
    expect(fields[2]).toMatchObject({ render: 'line', optionLabelKey: 'shapeStyle.widthOption' })
    expect(fields[3]).toMatchObject({ type: 'color-or-none', default: 'none' })
  })
})

describe('styleFieldDefault', () => {
  it('pins color-or-none to none and passes explicit defaults through', () => {
    expect(styleFieldDefault({ type: 'color-or-none', key: 'fill', options: ['#333'] })).toBe('none')
    expect(styleFieldDefault({ type: 'stroke-width', key: 'size', options: [2, 4], default: 4 })).toBe(4)
  })
})
