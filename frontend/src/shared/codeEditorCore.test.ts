import { describe, expect, it } from 'vitest'
import { buildExtensions, languageExtension } from './codeEditorCore'
import type { CodeEditorLanguage } from './codeEditorCore'

describe('languageExtension', () => {
  const languages: CodeEditorLanguage[] = ['shell', 'json', 'html', 'markdown']

  it.each(languages)('returns a defined extension for %s', (language) => {
    expect(languageExtension(language)).toBeDefined()
  })
})

describe('buildExtensions', () => {
  it('includes the editing keymap/history/bracket extensions only when editable', () => {
    const editable = buildExtensions({ language: 'json', editable: true, minHeightRows: 6 })
    const readonly = buildExtensions({ language: 'json', editable: false, minHeightRows: 6 })
    expect(editable.length).toBeGreaterThan(readonly.length)
  })

  it('adds a placeholder extension only when placeholderText is given', () => {
    const withPlaceholder = buildExtensions({ language: 'json', editable: true, minHeightRows: 6, placeholderText: 'e.g. {}' })
    const withoutPlaceholder = buildExtensions({ language: 'json', editable: true, minHeightRows: 6 })
    expect(withPlaceholder.length).toBe(withoutPlaceholder.length + 1)
  })

  it('adds an update listener only when onDocChange is given', () => {
    const withListener = buildExtensions({ language: 'json', editable: true, minHeightRows: 6, onDocChange: () => {} })
    const withoutListener = buildExtensions({ language: 'json', editable: true, minHeightRows: 6 })
    expect(withListener.length).toBe(withoutListener.length + 1)
  })
})
