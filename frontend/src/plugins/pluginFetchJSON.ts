import type { PluginFetchInit, PluginFetchJSONResult, PluginFetchResult } from './sdk'

/** api.fetchJSON's implementation, built as pure sugar over an
 * already-guarded fetch door -- takes the door itself so it works
 * identically over hostApi.ts's real fetch and an activation frame's
 * own call('fetch', ...) wrapper, without a second door name to
 * whitelist anywhere. Never throws: a denied request, a non-2xx
 * status and an unparsable body are each their own ok:false answer,
 * matching PluginFetchResult's own non-throwing contract rather than
 * throwing on a non-2xx response the way some other extension
 * platforms do. */
export function buildFetchJSON(fetchDoor: (url: string, init?: PluginFetchInit) => Promise<PluginFetchResult>) {
  return async function fetchJSON<T = unknown>(url: string, init?: PluginFetchInit): Promise<PluginFetchJSONResult<T>> {
    const r = await fetchDoor(url, init)
    // errorText is a plugin-facing diagnostic like PluginFetchResult's
    // own ruleLabel, not copy any Mill surface renders -- a plugin
    // author's own UI decides whether and how to show it.
    if (!r.approved) {
      // eslint-disable-next-line i18next/no-literal-string -- plugin-facing diagnostic, not Mill UI copy
      return { ok: false, status: r.status, errorText: r.ruleLabel || 'Not allowed.' }
    }
    if (r.status < 200 || r.status >= 300) {
      // eslint-disable-next-line i18next/no-literal-string -- plugin-facing diagnostic, not Mill UI copy
      return { ok: false, status: r.status, errorText: r.body ? r.body.slice(0, 500) : `The server answered ${r.status}.` }
    }
    try {
      return { ok: true, status: r.status, data: JSON.parse(r.body) as T }
    } catch {
      // eslint-disable-next-line i18next/no-literal-string -- plugin-facing diagnostic, not Mill UI copy
      return { ok: false, status: r.status, errorText: 'The response was not valid JSON.' }
    }
  }
}
