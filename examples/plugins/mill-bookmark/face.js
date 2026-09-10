// Bookmark's own face (docs/goals/0380 S2): the entry page Mill mounts
// in a sandboxed frame as the object's body. It draws from the
// object's data (mill.context.object) and writes back only through
// the object door -- it never reaches Mill's document, cookies or
// storage.
//
// Activation (goal 0354's drawio/sheet convention, extended to a
// framed face): a single click selects the object and hands this page
// real input; a double click marks it EDITING (object.setEditing) and
// the host answers with face:activate, the one signal this sandboxed
// page has for "the user just asked to work in here" -- used here only
// to mark the body, since the input is already reachable once
// selected. Escape and losing window focus (a click elsewhere on the
// board) leave editing again.

const mill = window.acquireMillApi()

const title = document.querySelector('[data-testid="bookmark-title"]')
const input = document.querySelector('[data-testid="bookmark-url-input"]')
const openButton = document.querySelector('[data-testid="bookmark-open"]')
const status = document.querySelector('[data-testid="bookmark-status"]')

function withScheme(url) {
	if (!url) return url
	return /^https?:\/\//.test(url) ? url : 'https://' + url
}

let titleStyle = 'hostname'
let placeholderTitle = 'Bookmark'

async function loadSettings() {
	titleStyle = await mill.call('settings.get', 'titleStyle')
	placeholderTitle = await mill.call('settings.get', 'placeholderTitle')
}

function titleFor(url) {
	if (!url) return placeholderTitle
	return titleStyle === 'address' ? withScheme(url) : new URL(withScheme(url)).hostname
}

function render() {
	const url = (mill.context.object && mill.context.object.Payload.url) || ''
	title.textContent = titleFor(url.trim())
	// Never stomp the input while it has focus: a payload echo mid-type
	// would rebuild the value under the caret.
	if (document.activeElement !== input) input.value = url
}

function commit() {
	const next = input.value.trim()
	const current = (mill.context.object && mill.context.object.Payload.url) || ''
	if (next === current) return
	void mill.call('object.updatePayload', { url: next, title: next ? new URL(withScheme(next)).hostname : '' }).catch(() => {
		void mill.call('notify', { level: 'error', text: 'Could not save the bookmark address.' })
	})
}

input.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') { e.preventDefault(); commit() }
	if (e.key === 'Escape') void mill.call('object.setEditing', false)
	e.stopPropagation() // board shortcuts stay out of typing
})
input.addEventListener('blur', commit)

async function openGuarded() {
	const url = withScheme(((mill.context.object && mill.context.object.Payload.url) || '').trim())
	if (!url) { status.textContent = 'Enter an address first.'; return }
	status.textContent = 'Asking…'
	try {
		const result = await mill.call('requestGuardedAction', 'open-url', { url }, `Open ${url} in the browser`)
		status.textContent = result.approved ? 'Opened.' : 'Not allowed' + (result.ruleLabel ? ` (${result.ruleLabel}).` : '.')
	} catch (err) {
		status.textContent = String(err && err.message ? err.message : err)
	}
}
openButton.addEventListener('click', () => { void openGuarded() })

// The double-click-to-edit gesture (goal 0354's convention): the host
// already handed this page real input the moment it was selected, so
// nothing here is otherwise gated on 'editing' -- this call is what
// tells the host to answer with face:activate, the signal below reacts
// to.
document.body.addEventListener('dblclick', () => { void mill.call('object.setEditing', true) })
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') void mill.call('object.setEditing', false)
})
// Losing window focus is a click elsewhere on the board: the same
// "leave editing" the host's own click-outside handling reaches for a
// same-DOM face.
window.addEventListener('blur', () => { void mill.call('object.setEditing', false) })

mill.on('face:activate', () => { document.body.dataset.active = 'true' })
mill.on('face:deactivate', () => { document.body.dataset.active = 'false' })
document.body.dataset.active = 'false'

mill.on('ctx', render)
mill.on('settings:changed', () => { void loadSettings().then(render) })
void loadSettings().then(render)
