import { describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { UnitExporter } from './unitRegistry'
import { buildExportMenuChoice, runCardExport } from './atlasCardExportMenu'

vi.mock('../shared/downloadBlob', () => ({ downloadBlob: vi.fn() }))
vi.mock('../shared/bindings', () => ({ AtlasService: { MirrorRawBytes: vi.fn().mockResolvedValue('YQ==') } }))

const t = ((key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)) as TFunction<'atlas'>

function card(overrides: Partial<Card> = {}): Card {
  return { ID: 'c1', Source: '', MirrorPath: '', Title: 'Untitled', ...overrides } as Card
}

describe('buildExportMenuChoice (ADR-0043 §3 Decision 3: one shape, both surfaces)', () => {
  it('returns null for a card with nothing exportable', () => {
    const choice = buildExportMenuChoice({ card: card(), t, onDownload: vi.fn(), onOpenFormats: vi.fn() })
    expect(choice).toBeNull()
  })

  it('returns a single "Export as <Label>" item that downloads directly when exactly one format applies', () => {
    const onDownload = vi.fn()
    const choice = buildExportMenuChoice({ card: card({ MirrorPath: '/reports/summary.docx' }), t, onDownload, onOpenFormats: vi.fn() })
    expect(choice?.id).toBe('export-as')
    expect(choice?.label).toContain('export.singleLabel')
    choice?.run()
    expect(onDownload).toHaveBeenCalledTimes(1)
    expect(onDownload.mock.calls[0][0].format).toBe('original')
  })

  it('returns an "Export as..." item that hands the caller every format when more than one applies', () => {
    const onOpenFormats = vi.fn()
    const choice = buildExportMenuChoice({ card: card({ MirrorPath: '/diagrams/flow.drawio' }), t, onDownload: vi.fn(), onOpenFormats })
    expect(choice?.label).toBe('export.menuLabel')
    choice?.run()
    expect(onOpenFormats).toHaveBeenCalledTimes(1)
    const formats = (onOpenFormats.mock.calls[0][0] as UnitExporter[]).map((e) => e.format)
    expect(formats).toEqual(['original', 'drawio'])
  })
})

describe('runCardExport', () => {
  it('serializes the exporter and downloads its bytes', async () => {
    const { downloadBlob } = await import('../shared/downloadBlob')
    const exporter: UnitExporter = { format: 'mmd', label: 'Mermaid source (.mmd)', serialize: async () => ({ bytes: 'graph TD', filename: 'flow.mmd' }) }
    await runCardExport(card(), exporter, vi.fn())
    expect(downloadBlob).toHaveBeenCalledWith('flow.mmd', expect.any(Blob))
  })

  it('reports a serializer failure through onError instead of throwing', async () => {
    const exporter: UnitExporter = { format: 'mmd', label: 'Mermaid source (.mmd)', serialize: async () => { throw new Error('source file vanished') } }
    const onError = vi.fn()
    await runCardExport(card(), exporter, onError)
    expect(onError).toHaveBeenCalledWith('Error: source file vanished')
  })
})
