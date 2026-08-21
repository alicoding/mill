import { describe, expect, it } from 'vitest'
import { markdownSnippet } from './markdownSnippet'

describe('markdownSnippet', () => {
  it('strips block and inline syntax to plain text', () => {
    expect(markdownSnippet('# Hello world\n\n## test')).toBe('Hello world test')
    expect(markdownSnippet('- **Acme**: ok\n> next')).toBe('Acme: ok next')
    expect(markdownSnippet('a [link](https://x) and `code`')).toBe('a link and code')
  })
  it('leaves plain text untouched', () => {
    expect(markdownSnippet('just a note')).toBe('just a note')
  })
})
