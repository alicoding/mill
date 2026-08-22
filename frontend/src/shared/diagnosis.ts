import { SettingsService } from './bindings'

// The one payload composer behind every copyable failure surface (goal
// 0127 slice 4) -- error text, then `key: value` context lines, then
// the app's own version/channel/proxy/OS diagnostics block. A context
// key shaped like an argument, environment value, or auth-bearing
// field never reaches the returned text, even if a caller passes one
// by mistake -- the same rule UpdateDiagnostics/AppDiagnostics already
// enforces for the proxy URL, generalized to every consumer here.
const SECRET_KEY_PATTERN = /arg|env|auth|secret|credential|password|token/i

export type DiagnosisContext = Record<string, string | number | null | undefined>

// Fetched once per page session and reused by every caller -- the
// block never changes within one running app, so refetching it per
// copy click would just be a wasted round trip.
let cachedAppDiagnosis: Promise<string> | null = null

function appDiagnosisLine(): Promise<string> {
  if (!cachedAppDiagnosis) cachedAppDiagnosis = SettingsService.AppDiagnostics()
  return cachedAppDiagnosis
}

export async function composeDiagnosis({ error, context }: { error: string; context?: DiagnosisContext }): Promise<string> {
  const blocks = [error]
  const contextLines = Object.entries(context ?? {})
    .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${value}`)
  if (contextLines.length > 0) blocks.push(contextLines.join('\n'))
  blocks.push(await appDiagnosisLine())
  return blocks.join('\n\n')
}
