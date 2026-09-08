// @ts-check
/// <reference path="../../../frontend/plugin-sdk/index.d.ts" />

// Interop consumer -- half of the extension-interop reference pair
// (docs/goals/0364). Its manifest declares mill-interop-provider as a
// dependency, which is what makes api.extensions.get('mill-interop-
// provider') resolve here at all -- an id NOT in this manifest's own
// "dependencies" always resolves undefined, whoever is asking. The
// registered command runs the whole path: the loader activated the
// dependency first (activation ordering), the export crossed the
// bridge (both extensions run framed, docs/goals/0375 S1b), and the
// gate let the call through because the dependency is declared.

/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	api.registerCommand({
		id: 'greet-provider',
		label: 'Greet the interop provider',
		run: async () => {
			const provider = await api.extensions.get('mill-interop-provider')
			if (!provider) {
				api.notify({ level: 'warning', text: 'mill-interop-provider is not running.' })
				return
			}
			// api.extensions.get's return type is a plain object of
			// unknown-typed properties -- an exported method's own
			// signature is a contract between the two extensions, not
			// something the host SDK can know, so a caller casts it.
			const greet = /** @type {(name: string) => Promise<string>} */ (provider.greet)
			const greeting = await greet('Mill')
			api.notify({ level: 'success', text: greeting })
		},
	})
}
