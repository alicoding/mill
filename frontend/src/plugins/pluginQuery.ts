import type { ContentEntry as WireEntry } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import type { ContentEntry } from './sdk'

// contentEntryFromWire -- the bound ListContents envelope (Go field
// casing, nullable size/payload) restated as the SDK's ContentEntry
// (docs/goals/0278). The SDK keeps its own camelCase shape so a
// plugin never depends on the generated binding's spelling.
export function contentEntryFromWire(e: WireEntry): ContentEntry {
	const payload: Record<string, string> = {}
	for (const [k, v] of Object.entries(e.Payload ?? {})) if (v !== undefined) payload[k] = v
	// fields/kindId/mirrorPath ride the card entries only (goal 0357) —
	// absent on notes and objects, never an empty-but-meaningful value.
	const fields = e.Fields === undefined || e.Fields === null ? undefined : mapStrings(e.Fields)
	return {
		id: e.ID,
		kind: e.Kind,
		subkind: e.Subkind || undefined,
		title: e.Title,
		parentId: e.ParentID || undefined,
		position: { x: e.Position.X, y: e.Position.Y },
		size: e.Size ? { w: e.Size.W, h: e.Size.H } : undefined,
		fields,
		kindId: e.KindID || undefined,
		mirrorPath: e.MirrorPath || undefined,
		payload,
	}
}

function mapStrings(source: Record<string, string | undefined>): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(source)) if (v !== undefined) out[k] = v
	return out
}
