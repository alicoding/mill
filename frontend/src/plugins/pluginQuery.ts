import type { ContentEntry as WireEntry } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import type { ContentEntry } from './sdk'

// contentEntryFromWire -- the bound ListContents envelope (Go field
// casing, nullable size/payload) restated as the SDK's ContentEntry
// (docs/goals/0278). The SDK keeps its own camelCase shape so a
// plugin never depends on the generated binding's spelling.
export function contentEntryFromWire(e: WireEntry): ContentEntry {
	const payload: Record<string, string> = {}
	for (const [k, v] of Object.entries(e.Payload ?? {})) if (v !== undefined) payload[k] = v
	return {
		id: e.ID,
		kind: e.Kind,
		subkind: e.Subkind || undefined,
		title: e.Title,
		parentId: e.ParentID || undefined,
		position: { x: e.Position.X, y: e.Position.Y },
		size: e.Size ? { w: e.Size.W, h: e.Size.H } : undefined,
		payload,
	}
}
