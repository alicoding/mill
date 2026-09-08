// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { editorUrlFor } from './editorUrlFor'

function xmlWithPages(count: number): string {
  const diagrams = Array.from({ length: count }, (_, i) => `<diagram id="p${i}" name="Page-${i + 1}"><mxGraphModel/></diagram>`).join('')
  return `<mxfile host="test">${diagrams}</mxfile>`
}

describe('editorUrlFor', () => {
  it('omits pages=1 for a file with no diagram element', () => {
    expect(editorUrlFor(xmlWithPages(0))).toBe('/vendor/drawio/editor/index.html?embed=1&proto=json&spin=1')
  })

  it('omits pages=1 for a single-page file, leaving the engine\'s own toggle in charge', () => {
    expect(editorUrlFor(xmlWithPages(1))).toBe('/vendor/drawio/editor/index.html?embed=1&proto=json&spin=1')
  })

  it('adds pages=1 for a multi-page file, telling PreConfig.js to correct a hidden strip', () => {
    expect(editorUrlFor(xmlWithPages(2))).toBe('/vendor/drawio/editor/index.html?embed=1&proto=json&spin=1&pages=1')
  })

  it('adds pages=1 for a file with more than two pages', () => {
    expect(editorUrlFor(xmlWithPages(5))).toBe('/vendor/drawio/editor/index.html?embed=1&proto=json&spin=1&pages=1')
  })
})
