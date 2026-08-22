import { beforeEach, describe, expect, it, vi } from 'vitest'

// composeDiagnosis fetches AppDiagnostics through shared/bindings.ts --
// mocked per test via vi.doMock + a fresh dynamic import, so the
// module-level cache (diagnosis.ts's own appDiagnosisLine) never leaks
// a stale mock between tests.
async function loadWithMockedDiagnostics(diag: string) {
  const appDiagnosticsMock = vi.fn().mockResolvedValue(diag)
  vi.doMock('./bindings', () => ({ SettingsService: { AppDiagnostics: appDiagnosticsMock } }))
  const mod = await import('./diagnosis')
  return { composeDiagnosis: mod.composeDiagnosis, appDiagnosticsMock }
}

describe('composeDiagnosis', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('joins error, context lines, then the app diagnostics block', async () => {
    const { composeDiagnosis } = await loadWithMockedDiagnostics('Mill 1.2.3 · channel stable · proxy off (direct) · darwin/arm64')
    const got = await composeDiagnosis({
      error: 'save MCP server: an MCP server needs a command',
      context: { 'Server label': 'Local files', Command: '' },
    })
    expect(got).toBe(
      'save MCP server: an MCP server needs a command\n\nServer label: Local files\n\nMill 1.2.3 · channel stable · proxy off (direct) · darwin/arm64',
    )
  })

  it('omits context keys shaped like args/env/authorization', async () => {
    const { composeDiagnosis } = await loadWithMockedDiagnostics('Mill 1.2.3 · channel stable · proxy off (direct) · darwin/arm64')
    const got = await composeDiagnosis({
      error: 'list tools: exit status 1',
      context: {
        'Server label': 'Local files',
        Args: '--secret-key abc123',
        env: 'API_TOKEN=abc123',
        Authorization: 'Bearer abc123',
        commandArgs: ['--verbose'].join(' '),
      },
    })
    expect(got).not.toContain('abc123')
    expect(got).not.toContain('Args')
    expect(got).not.toContain('env')
    expect(got).not.toContain('Authorization')
    expect(got).toContain('Server label: Local files')
  })

  it('drops empty/nullish context values without an empty line', async () => {
    const { composeDiagnosis } = await loadWithMockedDiagnostics('diag-block')
    const got = await composeDiagnosis({
      error: 'boom',
      context: { Workflow: 'Onboarding', 'Run ID': undefined, Status: null, Started: '' },
    })
    expect(got).toBe('boom\n\nWorkflow: Onboarding\n\ndiag-block')
  })

  it('skips the context block entirely when no context is passed', async () => {
    const { composeDiagnosis } = await loadWithMockedDiagnostics('diag-block')
    const got = await composeDiagnosis({ error: 'boom' })
    expect(got).toBe('boom\n\ndiag-block')
  })

  it('fetches AppDiagnostics once and reuses it across calls', async () => {
    const { composeDiagnosis, appDiagnosticsMock } = await loadWithMockedDiagnostics('diag-block')
    await composeDiagnosis({ error: 'first' })
    await composeDiagnosis({ error: 'second' })
    expect(appDiagnosticsMock).toHaveBeenCalledTimes(1)
  })
})
