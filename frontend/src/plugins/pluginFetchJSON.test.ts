import { describe, expect, it } from 'vitest'
import { buildFetchJSON } from './pluginFetchJSON'
import type { PluginFetchResult } from './sdk'

function doorAnswering(result: Partial<PluginFetchResult>) {
  return async () => ({ approved: true, effect: 'allow', ruleLabel: '', status: 200, headers: {}, body: '', ...result }) as PluginFetchResult
}

describe('buildFetchJSON', () => {
  it('parses a 2xx JSON body', async () => {
    const fetchJSON = buildFetchJSON(doorAnswering({ status: 200, body: '{"pong":true}' }))
    await expect(fetchJSON('https://example.com')).resolves.toEqual({ ok: true, status: 200, data: { pong: true } })
  })

  it('answers ok:false, naming the rule, for a denied request', async () => {
    const fetchJSON = buildFetchJSON(async () => ({ approved: false, effect: 'deny', ruleLabel: 'blocked host', status: 0, headers: {}, body: '' }))
    await expect(fetchJSON('https://example.com')).resolves.toEqual({ ok: false, status: 0, errorText: 'blocked host' })
  })

  it('answers ok:false for a non-2xx status, never throwing', async () => {
    const fetchJSON = buildFetchJSON(doorAnswering({ status: 404, body: 'not found' }))
    await expect(fetchJSON('https://example.com')).resolves.toEqual({ ok: false, status: 404, errorText: 'not found' })
  })

  it('answers ok:false for a body that is not JSON', async () => {
    const fetchJSON = buildFetchJSON(doorAnswering({ status: 200, body: 'not json' }))
    await expect(fetchJSON('https://example.com')).resolves.toEqual({ ok: false, status: 200, errorText: 'The response was not valid JSON.' })
  })
})
