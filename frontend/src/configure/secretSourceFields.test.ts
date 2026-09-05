import { describe, expect, it } from 'vitest'
import type { SecretSourceKindInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { kindLabel, pathField, problemText } from './secretSourceFields'

const t = (key: string, values?: Record<string, string>) => (values ? `${key}:${Object.values(values).join(',')}` : key)

const netrc: SecretSourceKindInfo = {
  Kind: 'plugin:netrc-secrets/netrc', Label: 'Netrc file', PluginID: 'netrc-secrets', PluginName: 'Netrc file',
  PathKind: 'file', PathLabel: 'File', PathPlaceholder: '~/.netrc', PathDefault: '~/.netrc', CanDiscover: false, CanImport: false,
}
const pathless: SecretSourceKindInfo = { ...netrc, Kind: 'plugin:x/y', Label: 'Agent socket', PathKind: 'none', PathLabel: '', PathPlaceholder: '', PathDefault: '' }

describe('secret source kind fields', () => {
  it('names every built-in kind and falls back to the generic noun for a kind whose extension is gone', () => {
    expect(kindLabel('env', [], t)).toBe('configureSecretSources.kindDotenv')
    expect(kindLabel('bruno', [], t)).toBe('configureSecretSources.kindBruno')
    expect(kindLabel('op', [], t)).toBe('configureSecretSources.kindOnePassword')
    expect(kindLabel('bw', [], t)).toBe('configureSecretSources.kindBitwarden')
    expect(kindLabel('plugin:netrc-secrets/netrc', [netrc], t)).toBe('Netrc file')
    expect(kindLabel('plugin:gone/thing', [netrc], t)).toBe('configureSecretSources.kindExtension')
  })

  it('renders an extension kind path field from what its manifest declares, and hides it entirely for a pathless one', () => {
    expect(pathField('plugin:netrc-secrets/netrc', netrc, t)).toEqual({ shown: true, label: 'File', placeholder: '~/.netrc', caption: '' })
    expect(pathField('plugin:x/y', pathless, t).shown).toBe(false)
  })

  it('keeps every built-in kind wording', () => {
    expect(pathField('env', undefined, t).caption).toBe('configureSecretSources.pathCaption')
    expect(pathField('bw', undefined, t).label).toBe('configureSecretSources.filter')
    expect(pathField('unknown-kind', undefined, t).placeholder).toBe('configureSecretSources.pathPlaceholderDotenv')
  })

  it('states an extension problem code in words and passes any other problem through', () => {
    expect(problemText('plugin-not-installed', t)).toBe('configureSecretSources.problemPluginMissing')
    expect(problemText('plugin-turned-off', t)).toBe('configureSecretSources.problemPluginDisabled')
    expect(problemText('op is not installed', t)).toBe('op is not installed')
  })
})
