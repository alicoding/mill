// A secret source runs inside Mill, never in the page: one
// registerSource per source the manifest declares. list(ctx) returns
// the names it holds and resolve(ctx, key) returns one value; ctx.path
// is the file the user configured, and ctx.readFile() returns its
// bytes. Nothing else on the machine is reachable from here.
//
// A .netrc file is a sequence of "machine <host>" blocks (plus an
// optional "default" block), each with its own login and password
// token. Every block contributes "<host>/login" and "<host>/password".

function parseNetrc(text) {
	var tokens = String(text || '').split(/[\s\n\r\t]+/)
	var machines = {}
	var current = ''
	for (var i = 0; i < tokens.length; i++) {
		var token = tokens[i]
		if (token === 'machine') {
			current = tokens[i + 1] || ''
			i++
			if (current) machines[current] = machines[current] || {}
		} else if (token === 'default') {
			current = 'default'
			machines[current] = machines[current] || {}
		} else if ((token === 'login' || token === 'password' || token === 'account') && current) {
			machines[current][token] = tokens[i + 1] || ''
			i++
		}
	}
	return machines
}

registerSource('netrc', {
	list: function (ctx) {
		var machines = parseNetrc(ctx.readFile())
		var names = []
		for (var host in machines) {
			for (var field in machines[host]) {
				names.push(host + '/' + field)
			}
		}
		return names
	},
	resolve: function (ctx, key) {
		var machines = parseNetrc(ctx.readFile())
		var parts = String(key || '').split('/')
		var host = parts[0]
		var field = parts[1]
		if (!machines[host] || !machines[host][field]) return ''
		return machines[host][field]
	},
})
