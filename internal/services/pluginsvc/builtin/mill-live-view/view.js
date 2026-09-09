// The Live view (goal 0374): a window onto an external tracked-items
// tool's items, rendered as an Atlas board-switcher pane in its own
// sandboxed frame. Reads (search, list transitions) run through
// callIntegration -- a Configure Integration entity the user picked in
// this plugin's own settings, never a host the plugin itself knows.
// Writes (reply, change status) run through performGuardedAction alone:
// the host's own evaluate-then-confirm dance (PluginFrame.tsx) and its
// "ask" outcome's confirmation banner both live OUTSIDE this frame, so
// this page never renders a confirm dialog of its own -- it only ever
// sees the final GuardedActionResult.
//
// window.acquireMillApi() is the only door back, the same shape every
// other builtin view already uses.
//
// The write state machine below is a hand copy of stateMachine.js in
// this same folder (COMPOSING/SENDING/SENT/ERROR, retry/cancel), minus
// the 'undo' case that file also carries: undo here is just another
// transition (applyTransition dispatches 'send', never 'undo' -- Undo
// is which STATUS it moves to, not a distinct write-flow transition).
// A plain script tag has no bundler to import stateMachine.js through,
// so the Vitest-exercised copy at
// frontend/src/plugins/liveViewStateMachine.test.ts pins the transitions
// this file actually uses. Keep both in sync on any change.

const mill = window.acquireMillApi()
const pane = document.getElementById('pane')

const WRITE_STATES = Object.freeze({ COMPOSING: 'composing', SENDING: 'sending', SENT: 'sent', ERROR: 'error' })
function createWriteState() { return { status: WRITE_STATES.COMPOSING, canUndo: false, error: '' } }
function nextWriteState(state, event) {
  switch (event.type) {
    case 'send':
      if (state.status === WRITE_STATES.SENDING) return state
      return { status: WRITE_STATES.SENDING, canUndo: false, error: '' }
    case 'sent':
      if (state.status !== WRITE_STATES.SENDING) return state
      return { status: WRITE_STATES.SENT, canUndo: !!event.canUndo, error: '' }
    case 'error':
      if (state.status !== WRITE_STATES.SENDING) return state
      return { status: WRITE_STATES.ERROR, canUndo: false, error: event.message || '' }
    case 'retry':
      if (state.status !== WRITE_STATES.ERROR) return state
      return createWriteState()
    case 'cancel':
      if (state.status !== WRITE_STATES.SENDING) return state
      return createWriteState()
    case 'reset':
      return createWriteState()
    default:
      return state
  }
}

const SEARCH_PATH = '/search'
const TRANSITIONS_PATH = '/items/{itemKey}/transitions'
const COMMENT_KIND = 'external.comment'
const TRANSITION_KIND = 'external.transition'

/** @type {{filterText: string, rows: Array<object>, selectedKey: string|null, detail: {current:string, allowed:string[]}|null, previousStatus: string|null, commentDraft: string, commentWrite: object, transitionWrite: object, loadError: string}} */
let state = {
  filterText: '',
  rows: [],
  selectedKey: null,
  detail: null,
  previousStatus: null,
  commentDraft: '',
  commentWrite: createWriteState(),
  transitionWrite: createWriteState(),
  loadError: '',
}

function integrationId() {
  return mill.call('settings.get', 'integrationId')
}

function timeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function refresh() {
  const id = await integrationId()
  if (!id) { state.loadError = 'noIntegration'; render(); return }
  try {
    const body = await mill.call('callIntegration', id, SEARCH_PATH, 'GET', { q: state.filterText })
    const parsed = JSON.parse(body || '{}')
    state.rows = Array.isArray(parsed.items) ? parsed.items : []
    state.loadError = ''
  } catch (err) {
    state.loadError = String((err && err.message) || err)
  }
  render()
}

async function selectRow(key) {
  state.selectedKey = key
  state.detail = null
  state.commentDraft = ''
  state.commentWrite = createWriteState()
  state.transitionWrite = createWriteState()
  render()
  await loadTransitions(key)
}

async function loadTransitions(key) {
  const id = await integrationId()
  if (!id) return
  try {
    const body = await mill.call('callIntegration', id, TRANSITIONS_PATH, 'GET', { itemKey: key })
    const parsed = JSON.parse(body || '{}')
    state.detail = { current: parsed.current || '', allowed: Array.isArray(parsed.allowed) ? parsed.allowed : [] }
  } catch (err) {
    state.detail = { current: '', allowed: [] }
  }
  render()
}

async function postComment() {
  const id = await integrationId()
  const key = state.selectedKey
  if (!id || !key || !state.commentDraft.trim()) return
  state.commentWrite = nextWriteState(state.commentWrite, { type: 'send' })
  render()
  try {
    const result = await mill.call('performGuardedAction', COMMENT_KIND, { integrationId: id, itemKey: key, body: state.commentDraft }, 'Post')
    if (result && result.performed) {
      state.commentWrite = nextWriteState(state.commentWrite, { type: 'sent', canUndo: false })
      state.commentDraft = ''
    } else {
      // A deny or a Cancel on the host's own banner -- neither is a
      // failure, so the draft stays and the composer just reopens
      // (goal 0374's "never a fake error for a deliberate non-send").
      state.commentWrite = nextWriteState(state.commentWrite, { type: 'cancel' })
    }
  } catch (err) {
    state.commentWrite = nextWriteState(state.commentWrite, { type: 'error', message: "Couldn't send. Try again." })
  }
  render()
}

function retryComment() {
  state.commentWrite = nextWriteState(state.commentWrite, { type: 'retry' })
  render()
}

async function applyTransition(toStatus, isUndo) {
  const id = await integrationId()
  const key = state.selectedKey
  if (!id || !key || !state.detail) return
  const fromStatus = state.detail.current
  state.transitionWrite = nextWriteState(state.transitionWrite, { type: 'send' })
  render()
  try {
    const description = 'Move to ' + toStatus
    const result = await mill.call('performGuardedAction', TRANSITION_KIND, { integrationId: id, itemKey: key, toStatus }, description)
    if (result && result.performed) {
      state.previousStatus = isUndo ? null : fromStatus
      state.detail = { current: toStatus, allowed: state.detail.allowed }
      // Re-read the allowed transitions from the NEW status so Undo is
      // offered only when the reverse transition is genuinely allowed
      // from here -- never a fake undo.
      await loadTransitions(key)
      const canUndo = !isUndo && state.detail.allowed.indexOf(fromStatus) !== -1
      state.transitionWrite = nextWriteState(state.transitionWrite, { type: 'sent', canUndo })
    } else {
      state.transitionWrite = nextWriteState(state.transitionWrite, { type: 'cancel' })
    }
  } catch (err) {
    state.transitionWrite = nextWriteState(state.transitionWrite, { type: 'error', message: "Couldn't send. Try again." })
  }
  render()
}

function retryTransition() {
  state.transitionWrite = nextWriteState(state.transitionWrite, { type: 'retry' })
  render()
}

function openInTool(url) {
  if (!url) return
  void mill.call('requestGuardedAction', 'open-url', { url }, 'Open in the tool')
}

// ---- rendering (plain DOM construction, never innerHTML, so an
// item's own title/status/assignee text can never be read as markup) ----

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function render() {
  pane.replaceChildren()

  const toolbar = el('div', 'toolbar')
  const filterInput = el('input', 'filterInput')
  filterInput.type = 'text'
  filterInput.placeholder = 'Filter'
  filterInput.value = state.filterText
  filterInput.addEventListener('change', (e) => { state.filterText = e.target.value; void refresh() })
  const refreshBtn = el('button', '', 'Refresh')
  refreshBtn.addEventListener('click', () => void refresh())
  toolbar.append(filterInput, refreshBtn)
  pane.append(toolbar)

  if (state.loadError === 'noIntegration') {
    pane.append(el('div', 'emptyState', 'Set an Integration in this view’s settings to see items here.'))
    return
  }
  if (state.loadError) {
    pane.append(el('div', 'errorState', "Couldn't load items. " + state.loadError))
    return
  }
  if (state.rows.length === 0) {
    pane.append(el('div', 'emptyState', 'No items yet. Try Refresh, or change the filter.'))
    return
  }

  const rowsEl = el('div', 'rows')
  for (const row of state.rows) {
    const rowEl = el('div', 'row' + (row.key === state.selectedKey ? ' selected' : ''))
    const rowStatus = el('span', 'chip', row.status || '')
    rowStatus.setAttribute('data-testid', 'live-view-row-status')
    rowEl.append(
      el('span', 'rowKey', row.key || ''),
      rowStatus,
      el('span', 'rowTitle', row.title || ''),
      el('span', 'rowAssignee', row.assignee || ''),
      el('span', 'rowUpdated', timeLabel(row.updated)),
    )
    rowEl.addEventListener('click', () => void selectRow(row.key))
    rowsEl.append(rowEl)
  }
  pane.append(rowsEl)

  if (state.selectedKey) {
    pane.append(renderDetail(state.rows.find((r) => r.key === state.selectedKey)))
  }
}

function renderDetail(row) {
  const detail = el('div', 'detail')
  if (!row) return detail

  const header = el('div', 'detailHeader')
  header.append(el('span', '', row.title || row.key))
  const openBtn = el('button', '', 'Open in the tool')
  openBtn.addEventListener('click', () => openInTool(row.url))
  header.append(openBtn)
  detail.append(header)

  detail.append(renderTransitionSection())
  detail.append(renderComposer())
  return detail
}

function renderTransitionSection() {
  const section = el('div', '')
  if (!state.detail) { section.append(el('div', 'status', 'Loading…')); return section }

  const current = el('span', 'chip', state.detail.current || '')
  current.setAttribute('data-testid', 'live-view-current-status')
  section.append(current)

  const tw = state.transitionWrite
  if (tw.status === WRITE_STATES.SENT && tw.canUndo && state.previousStatus) {
    const undoBtn = el('button', '', 'Undo — move back to ' + state.previousStatus)
    undoBtn.addEventListener('click', () => void applyTransition(state.previousStatus, true))
    section.append(undoBtn)
    return section
  }
  if (tw.status === WRITE_STATES.ERROR) {
    section.append(el('span', 'status error', tw.error))
    const retryBtn = el('button', '', 'Retry')
    retryBtn.addEventListener('click', retryTransition)
    section.append(retryBtn)
    return section
  }
  if (tw.status === WRITE_STATES.SENDING) {
    section.append(el('span', 'status', 'Sending…'))
    return section
  }
  if (tw.status === WRITE_STATES.SENT) {
    section.append(el('span', 'status', 'Sent · ' + timeLabel(new Date().toISOString())))
    return section
  }
  if (state.detail.allowed.length === 0) return section
  section.append(el('span', 'status', 'Change status'))
  const picker = el('div', 'transitions')
  for (const next of state.detail.allowed) {
    const btn = el('button', '', 'Move to ' + next)
    btn.addEventListener('click', () => void applyTransition(next, false))
    picker.append(btn)
  }
  section.append(picker)
  return section
}

function renderComposer() {
  const composer = el('div', 'composer')
  const cw = state.commentWrite

  // A sent reply's own receipt renders ABOVE a fresh, empty composer
  // (never in its place): "Open in the tool" is the honest answer for
  // editing/deleting what was sent, but nothing stops the next reply.
  if (cw.status === WRITE_STATES.SENT) {
    const receipt = el('div', 'composerActions')
    const sentStatus = el('span', 'status', 'Sent · ' + timeLabel(new Date().toISOString()))
    sentStatus.setAttribute('data-testid', 'live-view-comment-sent')
    receipt.append(sentStatus)
    const openBtn = el('button', '', 'Open in the tool')
    const row = state.rows.find((r) => r.key === state.selectedKey)
    openBtn.addEventListener('click', () => openInTool(row && row.url))
    receipt.append(openBtn)
    composer.append(receipt)
  }

  const textarea = document.createElement('textarea')
  textarea.placeholder = 'Reply'
  textarea.value = state.commentDraft
  textarea.disabled = cw.status === WRITE_STATES.SENDING
  composer.append(textarea)

  const actions = el('div', 'composerActions')
  if (cw.status === WRITE_STATES.ERROR) {
    actions.append(el('span', 'status error', cw.error))
    const retryBtn = el('button', 'primary', 'Retry')
    retryBtn.addEventListener('click', retryComment)
    actions.append(retryBtn)
  } else if (cw.status === WRITE_STATES.SENDING) {
    actions.append(el('span', 'status', 'Sending…'))
  } else {
    const postBtn = el('button', 'primary', 'Post')
    // Surgical update, not a full render() on every keystroke: a
    // rebuilt pane would drop the textarea's own focus and cursor
    // position mid-type. Only this one button's disabled state (and
    // the draft the reducer reads) needs to track each keystroke.
    postBtn.disabled = !state.commentDraft.trim()
    textarea.addEventListener('input', (e) => {
      state.commentDraft = e.target.value
      postBtn.disabled = !state.commentDraft.trim()
    })
    postBtn.addEventListener('click', () => void postComment())
    actions.append(postBtn)
  }
  composer.append(actions)
  return composer
}

render()
void refresh()
