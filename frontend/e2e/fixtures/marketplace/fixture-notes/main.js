export function activate(api) {
	api.registerCommand({ id: 'hello', label: 'Say hello from the fixture', run: () => { api.notify({ level: 'info', text: 'Hello from the fixture.' }) } })
}
