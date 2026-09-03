import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { thirdPartyNounForKind } from '../atlas/atlasNounRegistry'

// linkPasteClaimants lists every ENABLED, loadable plugin's claim on
// pasted links as (kind, label) in the plugin list's own id order --
// the same order the paste chain falls back to when no preference is
// set (wiring.orderPasteClaims). The label is the registered tool's
// (what the tray and the paste toast call it), the plugin's name when
// the plugin never registered (a failed activate).
export function linkPasteClaimants(plugins: PluginInfo[], disabledIds: string[], labelFor: (kind: string) => string | undefined = (kind) => thirdPartyNounForKind(kind)?.label): { kind: string; label: string }[] {
	const out: { kind: string; label: string }[] = []
	for (const p of plugins) {
		if (p.Error || disabledIds.includes(p.Manifest.id)) continue
		for (const c of p.Manifest.contributes?.canvasObjects ?? []) {
			if (!c.pastesURLs || out.some((o) => o.kind === c.kind)) continue
			out.push({ kind: c.kind, label: labelFor(c.kind) ?? p.Manifest.name ?? c.kind })
		}
	}
	return out
}

