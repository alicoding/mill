// @ts-check
/// <reference path="../../../frontend/plugin-sdk/index.d.ts" />

// Board Audit -- a generated plugin changed only at its public edges:
// its manifest, this entry point, and the adjacent README. The command
// reads through Mill's query and links doors; it needs no capability.

/** @param {number} count @param {string} singular */
function countLabel(count, singular) {
	return `${count} ${singular}${count === 1 ? '' : 's'}`
}

/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	api.registerCommand({
		id: 'board-audit.summarize',
		label: 'Audit this board',
		run: () => {
			void summarize(api)
		},
	})
}

/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
async function summarize(api) {
	try {
		const [entries, links] = await Promise.all([api.query({}), api.links({})])
		const ids = new Set(entries.map((entry) => entry.id))
		const cards = entries.filter((entry) => entry.kind === 'card').length
		const notes = entries.filter((entry) => entry.kind === 'note').length
		const others = entries.length - cards - notes
		const missing = links.filter((link) => !ids.has(link.source) || !ids.has(link.target)).length

		api.notify({
			level: missing === 0 ? 'success' : 'warning',
			text: `Board audit: ${countLabel(cards, 'card')}, ${countLabel(notes, 'note')}, ${countLabel(others, 'other object')}, ${countLabel(links.length, 'link')}; ${countLabel(missing, 'link')} with a missing endpoint.`,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		api.notify({ level: 'error', text: `Board audit could not read this board: ${message}` })
	}
}
