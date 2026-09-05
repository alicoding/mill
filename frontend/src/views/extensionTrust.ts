import type { InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// Trust tiers and permissions as PRESENTATION (docs/goals/0349). The
// backend answers facts -- which tier, which capabilities, which hosts;
// this module turns them into the label keys and the ordered
// permission list every surface that shows them reads from. Pure, so
// the mapping is unit-tested without a DOM and can never differ
// between the install prompt and the Verification tab.

export type TrustTier = 'verified' | 'hash-pinned' | 'unverified' | 'dev' | ''

// The badge's Primer variant per tier. "Verified" is the only success
// state; a dev folder is neutral because nothing is wrong with it, it
// simply was not checked.
const TIER_VARIANT: Record<string, 'success' | 'attention' | 'secondary' | 'default'> = {
  verified: 'success',
  'hash-pinned': 'secondary',
  unverified: 'attention',
  dev: 'default',
}

export function tierVariant(tier: string): 'success' | 'attention' | 'secondary' | 'default' {
  return TIER_VARIANT[tier] ?? 'default'
}

// The badge's label key. An unknown or empty tier has no badge at all
// -- a built-in is not "unverified", it is not installed.
export function tierLabelKey(tier: string): string | null {
  return TIER_VARIANT[tier] ? `extensions.tier.${tier}` : null
}

// The Verification tab's sentence: what actually checked these bytes.
export function verificationKey(tier: string, changed: boolean): string {
  if (changed) return 'extensions.verification.changed'
  switch (tier) {
    case 'verified': return 'extensions.verification.signed'
    case 'hash-pinned': return 'extensions.verification.hashMatches'
    case 'dev': return 'extensions.verification.folder'
    default: return 'extensions.verification.unchecked'
  }
}

// One line of the "This extension can" list: a locale key plus the
// values it interpolates.
export interface PermissionLine {
  key: string
  params?: Record<string, string>
}

// The capability vocabulary, in the order a reader should meet it:
// reach first (what leaves this Mac), then what it writes, then what
// it does only after an approval.
const CAPABILITY_LINE: Record<string, string> = {
  'write-content': 'extensions.can.writeContent',
  'list-files': 'extensions.can.listFiles',
  'open-url': 'extensions.can.openUrl',
  'open-app': 'extensions.can.openApp',
  'erase-board-items': 'extensions.can.eraseBoardItems',
}

const CAPABILITY_ORDER = ['write-content', 'list-files', 'open-url', 'open-app', 'erase-board-items']

// permissionLines is what the install prompt and the Verification tab
// both render: everything the manifest declares, in one order, with
// nothing inferred. An extension declaring nothing gets one honest
// line rather than an empty list.
export function permissionLines(preview: InstallPreview | null): PermissionLine[] {
  if (!preview) return []
  const lines: PermissionLine[] = []
  if (preview.AnyHost) {
    lines.push({ key: 'extensions.can.reachAnyHost' })
  } else if ((preview.NetworkHosts ?? []).length > 0) {
    lines.push({ key: 'extensions.can.reachHosts', params: { list: (preview.NetworkHosts ?? []).join(', ') } })
  }
  const declared = new Set(preview.Capabilities ?? [])
  for (const capability of CAPABILITY_ORDER) {
    if (declared.has(capability)) lines.push({ key: CAPABILITY_LINE[capability] })
  }
  if (preview.UsesSecrets) lines.push({ key: 'extensions.can.useSecrets' })
  for (const kind of preview.Kinds ?? []) {
    lines.push({ key: 'extensions.can.adds', params: { kind } })
  }
  if (lines.length === 0) lines.push({ key: 'extensions.can.nothing' })
  return lines
}

// kindLabelKey names a contribution family in the user's words. The
// vocabulary is the manifest's own json tags, so an unmapped family
// falls back to its raw name rather than disappearing from the chips.
const KIND_LABEL: Record<string, string> = {
  canvasObjects: 'extensions.kind.canvasObjects',
  steps: 'extensions.kind.steps',
  captures: 'extensions.kind.captures',
  settings: 'extensions.kind.settings',
  network: 'extensions.kind.network',
  views: 'extensions.kind.views',
  commands: 'extensions.kind.commands',
  themes: 'extensions.kind.themes',
  tools: 'extensions.kind.tools',
}

export function kindLabelKey(kind: string): string | null {
  return KIND_LABEL[kind] ?? null
}
