import { describe, expect, it } from 'vitest'
import { ingestionClaimMismatch } from './ingestionClaims'
import type { CanvasObjectContribution } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

const claim = (partial: Partial<CanvasObjectContribution>): CanvasObjectContribution =>
  ({ kind: 'bookmark', fileExtensions: null, pastesURLs: false, ...partial }) as CanvasObjectContribution

describe('ingestionClaimMismatch (goal 0251)', () => {
  it('accepts an object with no contribution at all', () => {
    expect(ingestionClaimMismatch(undefined, 'board-local')).toBeNull()
  })

  it('accepts matched pairings', () => {
    expect(ingestionClaimMismatch(claim({ fileExtensions: ['.webloc'] }), 'file')).toBeNull()
    expect(ingestionClaimMismatch(claim({ pastesURLs: true }), 'url')).toBeNull()
    expect(ingestionClaimMismatch(claim({}), 'board-local')).toBeNull()
  })

  it('rejects a file-extension claim on a non-file source, naming the kind', () => {
    const err = ingestionClaimMismatch(claim({ fileExtensions: ['.webloc'] }), 'url')
    expect(err).toContain('bookmark')
    expect(err).toContain('"file"')
  })

  it('rejects a pasted-links claim on a non-url source, naming the kind', () => {
    const err = ingestionClaimMismatch(claim({ pastesURLs: true }), 'board-local')
    expect(err).toContain('bookmark')
    expect(err).toContain('"url"')
  })
})
