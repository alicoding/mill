import { describe, expect, it } from 'vitest'
import { externalChangeActions, nextDrawioActions } from './drawioEmbedProtocol'

// The fake-engine contract test (goal 0237 S1, no-catch-up-tax rule 3):
// every case below is a plain JS object shaped exactly like a message
// the REAL draw.io embed protocol would send, fed straight into the
// pure handler -- no iframe, no vendored asset, no real editor. This is
// what proves Mill's own load/save/autosave/exit handling is correct
// independent of which engine build is on disk; it must keep passing
// unmodified across an engine upgrade or swap, since it asserts only
// against the documented protocol shape, never an engine internal.
describe('nextDrawioActions', () => {
  it('replies to init with a load action carrying the current XML and autosave:1', () => {
    const actions = nextDrawioActions({ event: 'init' }, '<mxfile>seed</mxfile>')
    expect(actions).toEqual([
      { type: 'sendToEditor', message: { action: 'load', xml: '<mxfile>seed</mxfile>', autosave: 1 } },
    ])
  })

  it('writes the mirror on autosave without closing', () => {
    const actions = nextDrawioActions({ event: 'autosave', xml: '<mxfile>edited</mxfile>' }, '<mxfile>seed</mxfile>')
    expect(actions).toEqual([{ type: 'writeMirror', xml: '<mxfile>edited</mxfile>' }])
  })

  it('writes the mirror on a manual save without closing', () => {
    const actions = nextDrawioActions({ event: 'save', xml: '<mxfile>saved</mxfile>' }, '<mxfile>seed</mxfile>')
    expect(actions).toEqual([{ type: 'writeMirror', xml: '<mxfile>saved</mxfile>' }])
  })

  it('writes the mirror then closes on Save and Exit (save with exit:true)', () => {
    const actions = nextDrawioActions({ event: 'save', xml: '<mxfile>final</mxfile>', exit: true }, '<mxfile>seed</mxfile>')
    expect(actions).toEqual([
      { type: 'writeMirror', xml: '<mxfile>final</mxfile>' },
      { type: 'close' },
    ])
  })

  it('closes on exit, modified or not -- autosave already covers data safety', () => {
    expect(nextDrawioActions({ event: 'exit', modified: false }, '<mxfile>seed</mxfile>')).toEqual([{ type: 'close' }])
    expect(nextDrawioActions({ event: 'exit', modified: true }, '<mxfile>seed</mxfile>')).toEqual([{ type: 'close' }])
  })

  it('ignores an autosave/save event with no xml payload rather than writing an empty file', () => {
    expect(nextDrawioActions({ event: 'autosave' }, '<mxfile>seed</mxfile>')).toEqual([])
    expect(nextDrawioActions({ event: 'save' }, '<mxfile>seed</mxfile>')).toEqual([])
  })

  it('ignores every other documented event (load ack, openLink, export, ...) -- no action Mill needs yet', () => {
    expect(nextDrawioActions({ event: 'load' }, '<mxfile>seed</mxfile>')).toEqual([])
    expect(nextDrawioActions({ event: 'openLink', href: 'https://example.com' }, '<mxfile>seed</mxfile>')).toEqual([])
    expect(nextDrawioActions({ event: 'configure' }, '<mxfile>seed</mxfile>')).toEqual([])
  })

  it('ignores a message with no event field at all (a non-protocol postMessage sharing the window)', () => {
    expect(nextDrawioActions({}, '<mxfile>seed</mxfile>')).toEqual([])
  })
})

describe('externalChangeActions', () => {
  it('merges an external mirror change into the open editor, never reloads it', () => {
    expect(externalChangeActions('<mxfile>new</mxfile>', '<mxfile>old</mxfile>')).toEqual([
      { type: 'sendToEditor', message: { action: 'merge', xml: '<mxfile>new</mxfile>' } },
    ])
  })

  it('ignores the watch observing this editor\'s own autosave', () => {
    expect(externalChangeActions('<mxfile>same</mxfile>', '<mxfile>same</mxfile>')).toEqual([])
  })

  it('ignores an empty read', () => {
    expect(externalChangeActions('', '<mxfile>old</mxfile>')).toEqual([])
  })
})
