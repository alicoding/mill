// Coverage / ingestion targets (goal 0357 S2, carried over from
// docs/goals/0064/ADR-0038 whole): the viewed space's own honest
// "known, not mapped" counts -- cards missing a link of a chosen
// kind, and cards missing a mirror. Both are the same coverage-ratio
// shape, so one renderer below draws either.
//
// window.acquireMillApi() is the only door back: call() reaches
// Mill's read doors (query, links, linkKinds, open) and on()
// subscribes to contents:changed and the pane's own context (which
// space is being viewed).

const mill = window.acquireMillApi()
const pane = document.getElementById('pane')

let cards = []
let links = []
let linkKinds = []
let linkKindID = null
let showMissingLink = false
let showMissingMirror = false

function spaceId() {
  const value = mill.context ? mill.context.spaceCardId : undefined
  return typeof value === 'string' ? value : ''
}

// coverageMissingLink: among cards, which ones touch NO link (as
// either end) of linkKindID -- "known, not mapped" for a relation a
// space is expected to carry.
function coverageMissingLink() {
  const covered = new Set()
  for (const l of links) {
    if (l.kind !== linkKindID) continue
    covered.add(l.source)
    covered.add(l.target)
  }
  return { total: cards.length, missing: cards.filter((c) => !covered.has(c.id)) }
}

// coverageMissingMirror: among cards, which ones have no mirrorPath
// set yet -- "known, not mapped" for the mirror-content capability
// itself.
function coverageMissingMirror() {
  return { total: cards.length, missing: cards.filter((c) => !c.mirrorPath) }
}

function openCard(id) {
  void mill.call('open', id).catch((err) => {
    console.error(err)
    void mill.call('notify', { level: 'error', text: 'The card could not be opened.' })
  })
}

function missingListEl(testid, missing) {
  const list = document.createElement('div')
  list.setAttribute('data-testid', testid)
  list.className = 'missingList'
  for (const card of missing) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'missingItem'
    item.setAttribute('data-testid', 'atlas-coverage-missing-item')
    item.textContent = card.title
    item.addEventListener('click', () => openCard(card.id))
    list.append(item)
  }
  return list
}

// One stat row: "covered/total", plus a toggle revealing the missing
// cards one click away (each row opens that card's overlay).
function statEl(testid, labelText, result, showMissing, onToggle) {
  const stat = document.createElement('div')
  stat.className = 'stat'
  stat.setAttribute('data-testid', testid)

  const row = document.createElement('div')
  row.className = 'statRow'
  const value = document.createElement('span')
  value.setAttribute('data-testid', testid + '-value')
  value.textContent = labelText
  row.append(value)

  if (result.missing.length > 0) {
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'toggle'
    toggle.setAttribute('data-testid', testid + '-toggle')
    toggle.textContent = showMissing ? 'Hide missing' : 'View missing (' + result.missing.length + ')'
    toggle.addEventListener('click', onToggle)
    row.append(toggle)
  }
  stat.append(row)

  if (showMissing) stat.append(missingListEl(testid + '-missing-list', result.missing))
  return stat
}

function draw() {
  pane.replaceChildren()

  const field = document.createElement('div')
  field.className = 'field'
  const label = document.createElement('label')
  label.textContent = 'Link kind'
  field.append(label)
  const select = document.createElement('select')
  select.setAttribute('data-testid', 'atlas-coverage-link-kind')
  if (linkKinds.length === 0) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Any'
    select.append(opt)
  }
  for (const lk of linkKinds) {
    const opt = document.createElement('option')
    opt.value = lk.id
    opt.textContent = lk.label
    if (lk.id === linkKindID) opt.selected = true
    select.append(opt)
  }
  select.addEventListener('change', (e) => { linkKindID = e.target.value; draw() })
  field.append(select)
  pane.append(field)

  const linkSection = document.createElement('div')
  linkSection.className = 'section'
  if (linkKindID) {
    const result = coverageMissingLink()
    linkSection.append(statEl('atlas-coverage-link', (result.total - result.missing.length) + '/' + result.total + ' linked', result, showMissingLink, () => { showMissingLink = !showMissingLink; draw() }))
  } else {
    const empty = document.createElement('p')
    empty.className = 'emptyState'
    empty.textContent = 'No link kinds are declared yet.'
    linkSection.append(empty)
  }
  pane.append(linkSection)

  const mirrorSection = document.createElement('div')
  mirrorSection.className = 'section'
  const heading = document.createElement('p')
  heading.className = 'sectionHeading'
  heading.textContent = 'Mirrors'
  mirrorSection.append(heading)
  const mirrorResult = coverageMissingMirror()
  mirrorSection.append(statEl('atlas-coverage-mirror', (mirrorResult.total - mirrorResult.missing.length) + '/' + mirrorResult.total + ' mirrored', mirrorResult, showMissingMirror, () => { showMissingMirror = !showMissingMirror; draw() }))
  pane.append(mirrorSection)
}

async function refresh() {
  try {
    const [entries, linkList, linkKindList] = await Promise.all([
      mill.call('query', { kind: 'card' }),
      mill.call('links'),
      mill.call('linkKinds'),
    ])
    const scope = spaceId()
    cards = entries.filter((e) => (e.parentId || '') === scope)
    links = linkList
    linkKinds = linkKindList
    if (linkKindID === null || !linkKinds.some((lk) => lk.id === linkKindID)) linkKindID = linkKinds[0] ? linkKinds[0].id : ''
    draw()
  } catch (err) {
    console.error(err)
    void mill.call('notify', { level: 'error', text: 'Coverage could not be drawn.' })
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

// Redraw on board changes that can move a count: a card (added,
// removed, or mirrored), a link, or a link kind.
mill.on('contents:changed', (payload) => {
  const kind = payload && payload.kind
  if (!kind || kind === 'card' || kind === 'link' || kind === 'linkKind') void refresh()
})

// The pane's own context arrives on mount and again on every change --
// navigating into a space re-scopes the view the way the board does.
mill.on('ctx', () => { void refresh() })

void refresh()
