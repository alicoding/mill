// Steps run inside Mill's workflow executor (docs/adr/0051 §5): plain
// script-mode JavaScript, one registerStep per step declared in the
// manifest. perform receives { payload, config, attributes } and
// returns the new payload (a string), or { payload, attributes }.
registerStep('text-case', {
	perform: function (input) {
		var text = input.payload || ''
		switch (input.config.mode || 'upper') {
			case 'lower':
				return text.toLowerCase()
			case 'title':
				return text.toLowerCase().replace(/(^|\s)(\S)/g, function (_, space, letter) { return space + letter.toUpperCase() })
			default:
				return text.toUpperCase()
		}
	},
})
