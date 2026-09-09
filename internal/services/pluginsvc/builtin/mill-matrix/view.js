// The traceability matrix (goal 0357 S2, carried over from
// docs/goals/0064/ADR-0038 whole): rows are the viewed space's own
// cards of one chosen Kind, columns are link kinds (or one, when
// narrowed), cells are the OUTGOING target titles for that row/column
// pair -- an absent cell reads "None", never an ambiguous blank. View
// only: a cell's targets are click-to-open, nothing here edits a link.
//
// window.acquireMillApi() is the only door back: call() reaches Mill's
// read doors (query, kinds, links, linkKinds, open) and on()
// subscribes to contents:changed and the pane's own context (which
// space is being viewed).

const mill = window.acquireMillApi()
const pane = document.getElementById('pane')

let cards = []
let kinds = []
let links = []
let linkKinds = []
let rowKindID = null
let columnFilterID = ''

function spaceId() {
  const value = mill.context ? mill.context.spaceCardId : undefined
  return typeof value === 'string' ? value : ''
}

function kindLabel(kind) {
  return kind.icon ? kind.icon + ' ' + kind.label : kind.label
}

// Rows: the viewed space's own cards of the chosen Kind.
function rowCards() {
  return cards.filter((c) => c.kindId === rowKindID)
}

// Columns: every link kind, or just the one columnFilterID names.
function columns() {
  return columnFilterID ? linkKinds.filter((lk) => lk.id === columnFilterID) : linkKinds
}

// One row's cells, aligned by index with columns() -- an empty array
// is a genuinely absent cell (rendered explicitly, never an ambiguous
// blank).
function cellsForCard(card, cols) {
  return cols.map((col) => links
    .filter((l) => l.source === card.id && l.kind === col.id)
    .map((l) => ({ cardID: l.target, title: titleByID.get(l.target) || l.target })))
}

let titleByID = new Map()

function selectEl(testid, value, options, onChange) {
  const select = document.createElement('select')
  select.setAttribute('data-testid', testid)
  for (const opt of options) {
    const option = document.createElement('option')
    option.value = opt.value
    option.textContent = opt.label
    if (opt.value === value) option.selected = true
    select.append(option)
  }
  select.addEventListener('change', (e) => onChange(e.target.value))
  return select
}

function labeledField(labelText, control) {
  const field = document.createElement('div')
  field.className = 'field'
  const label = document.createElement('label')
  label.textContent = labelText
  field.append(label, control)
  return field
}

function targetButton(target) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'targetLink'
  button.setAttribute('data-testid', 'atlas-matrix-target')
  button.textContent = target.title
  button.addEventListener('click', () => {
    void mill.call('open', target.cardID).catch((err) => {
      console.error(err)
      void mill.call('notify', { level: 'error', text: 'The card could not be opened.' })
    })
  })
  return button
}

function cellEl(targets) {
  const cell = document.createElement('td')
  if (targets.length === 0) {
    const absent = document.createElement('span')
    absent.className = 'absentCell'
    absent.setAttribute('data-testid', 'atlas-matrix-absent-cell')
    absent.textContent = 'None'
    cell.append(absent)
    return cell
  }
  for (const target of targets) cell.append(targetButton(target))
  return cell
}

function draw() {
  pane.replaceChildren()

  const controls = document.createElement('div')
  controls.className = 'controls'
  controls.append(
    labeledField('Kind', selectEl('atlas-matrix-row-kind', rowKindID || '', kinds.map((k) => ({ value: k.id, label: kindLabel(k) })), (v) => { rowKindID = v; draw() })),
    labeledField('Link kind', selectEl('atlas-matrix-column-filter', columnFilterID, [{ value: '', label: 'Any' }, ...linkKinds.map((lk) => ({ value: lk.id, label: lk.label }))], (v) => { columnFilterID = v; draw() })),
  )
  pane.append(controls)

  const rows = rowCards()
  if (rows.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'emptyState'
    empty.textContent = 'No cards of this kind in this space yet.'
    pane.append(empty)
    return
  }

  const cols = columns()
  const table = document.createElement('table')
  table.setAttribute('data-testid', 'atlas-matrix-table')
  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  const cardHeader = document.createElement('th')
  cardHeader.textContent = 'Card'
  headRow.append(cardHeader)
  for (const col of cols) {
    const th = document.createElement('th')
    th.textContent = col.label
    headRow.append(th)
  }
  thead.append(headRow)
  table.append(thead)

  const tbody = document.createElement('tbody')
  for (const card of rows) {
    const tr = document.createElement('tr')
    const cardCell = document.createElement('th')
    cardCell.scope = 'row'
    cardCell.textContent = card.title
    tr.append(cardCell)
    for (const targets of cellsForCard(card, cols)) tr.append(cellEl(targets))
    tbody.append(tr)
  }
  table.append(tbody)
  pane.append(table)
}

async function refresh() {
  try {
    const [entries, kindList, linkList, linkKindList] = await Promise.all([
      mill.call('query', { kind: 'card' }),
      mill.call('kinds'),
      mill.call('links'),
      mill.call('linkKinds'),
    ])
    const scope = spaceId()
    cards = entries.filter((e) => (e.parentId || '') === scope)
    kinds = kindList
    links = linkList
    linkKinds = linkKindList
    titleByID = new Map(cards.map((c) => [c.id, c.title]))
    if (rowKindID === null || !kinds.some((k) => k.id === rowKindID)) rowKindID = kinds[0] ? kinds[0].id : ''
    if (columnFilterID && !linkKinds.some((lk) => lk.id === columnFilterID)) columnFilterID = ''
    draw()
  } catch (err) {
    console.error(err)
    void mill.call('notify', { level: 'error', text: 'The matrix could not be drawn.' })
  }
}

// The pane contract every Atlas projection keeps -- "Escape swaps back
// to the Board" -- is the page's own job inside a sandboxed frame: a
// keydown never reaches Mill's document, so the page asks Mill to show
// the board again through the registry command the switcher's Board
// segment owns.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  void mill.call('runCommand', 'atlas.board.home').catch(() => {})
})

// Redraw on board changes that can move a row, a column, or a cell: a
// card, a kind, a link, or a link kind.
mill.on('contents:changed', (payload) => {
  const kind = payload && payload.kind
  if (!kind || kind === 'card' || kind === 'kind' || kind === 'link' || kind === 'linkKind') void refresh()
})

// The pane's own context arrives on mount and again on every change --
// navigating into a space re-scopes the view the way the board does.
mill.on('ctx', () => { void refresh() })

void refresh()
