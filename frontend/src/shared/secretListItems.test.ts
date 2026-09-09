import { describe, expect, it } from 'vitest'
import { providerSecretRows, vaultUnresolvedInfo } from './secretListItems'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import type { Source as SecretSource } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import type { SecretSummary } from './bindings'

function source(id: string, label: string, kind: Kind = Kind.KindEnv): SecretSource {
  return { ID: id, Label: label, Kind: kind, Path: '/tmp/.env', BuiltIn: false, Seed: { SeedRevision: 0, Modified: false }, CreatedAt: '', UpdatedAt: '2026-01-01T00:00:00Z' }
}

function summary(id: string, title: string): SecretSummary {
  return { ID: id, Title: title, Username: '', URL: '', Tags: [], FieldNames: [], Kind: 'text', SourceRef: '', Origin: '', UpdatedAt: '2026-01-01T00:00:00Z' } as unknown as SecretSummary
}

describe('providerSecretRows', () => {
  it('parses a qualified reference id into its key and joins the source label/kind', () => {
    const sources = [source('src-1', 'Project .env')]
    const provider = [summary('env:src-1/API_TOKEN', 'API_TOKEN — Project .env')]
    expect(providerSecretRows(provider, sources)).toEqual([
      { id: 'env:src-1/API_TOKEN', key: 'API_TOKEN', sourceID: 'src-1', sourceLabel: 'Project .env', sourceKind: Kind.KindEnv, updatedAt: '2026-01-01T00:00:00Z' },
    ])
  })

  it('drops a row whose source has since been removed', () => {
    const provider = [summary('env:gone-source/KEY', 'KEY — Gone')]
    expect(providerSecretRows(provider, [])).toEqual([])
  })

  it('drops a row whose id is not a qualified reference', () => {
    const sources = [source('src-1', 'Project .env')]
    const provider = [summary('not-a-reference', 'x')]
    expect(providerSecretRows(provider, sources)).toEqual([])
  })
})

describe('vaultUnresolvedInfo', () => {
  const sources = [source('src-1', 'Project .env')]
  const providerIDs = new Set(['env:src-1/PRESENT'])

  it('is null for a vault entry with no SourceRef', () => {
    expect(vaultUnresolvedInfo('', providerIDs, sources)).toBeNull()
  })

  it('is null when the referenced key is still listed', () => {
    expect(vaultUnresolvedInfo('env:src-1/PRESENT', providerIDs, sources)).toBeNull()
  })

  it('names the key and source when the key has vanished from the source', () => {
    expect(vaultUnresolvedInfo('env:src-1/GONE', providerIDs, sources)).toEqual({ key: 'GONE', sourceLabel: 'Project .env' })
  })

  it('is null (a different state) when the SOURCE itself no longer exists', () => {
    expect(vaultUnresolvedInfo('env:deleted-source/KEY', providerIDs, sources)).toBeNull()
  })
})
