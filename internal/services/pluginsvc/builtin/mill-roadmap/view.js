// The Roadmap view, as an entry page Mill mounts in its own sandboxed
// frame (goal 0357 S1): rows are the viewed space's own card kinds,
// columns are the horizon tag family (Now/Next/Then) plus a trailing
// Unscheduled catch-all. Card placement writes one typed field on the
// card through Mill's guarded content.setCardFields door -- the kind's
// Horizon field is auto-declared by Mill the first time one of its
// cards is placed, announced with a quiet toast.
//
// window.acquireMillApi() is the only door back: call() reaches Mill's
// guarded doors (query, kinds, open, content.setCardFields) and on()
// subscribes to contents:changed and the pane's own context (which
// space is being viewed). Every write is a guarded action, so Mill's
// rules can allow, park, or deny it; the page states the outcome.

const mill = window.acquireMillApi()
const pane = document.getElementById('pane')

const HORIZON_FIELD_KEY = 'horizon'
// Bucket keys are the page's own vocabulary; tagValue is what a
// placement writes into the card's typed horizon field.
const HORIZON_BUCKETS = [
  { key: 'now', tagValue: 'Now' },
  { key: 'next', tagValue: 'Next' },
  { key: 'then', tagValue: 'Then' },
]
const UNSCHEDULED_BUCKET_KEY = 'unscheduled'
const BUCKET_KEYS = [...HORIZON_BUCKETS.map((b) => b.key), UNSCHEDULED_BUCKET_KEY]
const BUCKET_NAMES = { now: 'Now', next: 'Next', then: 'Then', unscheduled: 'Unscheduled' }

// A card kind's ambient dot color comes from a stable hash of its own
// id -- the same kind always renders the same color without the page
// knowing what a kind is called. The buckets map onto the documented
// frame tokens only (the palette a theme is allowed to promise).
const LABEL_COLORS = ['accent', 'success', 'attention', 'severe', 'done', 'sponsors', 'secondary']
const DOT_TOKENS = {
  accent: '--mill-accent-emphasis',
  success: '--fgColor-success',
  attention: '--fgColor-attention',
  severe: '--mill-kind-decision',
  done: '--mill-kind-terminal',
  sponsors: '--mill-kind-apply',
  secondary: '--fgColor-muted',
}

function kindDotToken(kindId) {
  let hash = 0
  for (let i = 0; i < kindId.length; i++) hash = (hash * 31 + kindId.charCodeAt(i)) >>> 0
  return DOT_TOKENS[LABEL_COLORS[hash % LABEL_COLORS.length]]
}

// effectiveBucketKeyForCard resolves the one bucket a card sits in --
// a horizon bucket, or Unscheduled for an absent/unrecognized tag,
// never an error. The single source of truth the lane builder, the
// picker's candidate list, and the drop target all read.
function effectiveBucketKeyForCard(card) {
  const tag = (card.fields || {})[HORIZON_FIELD_KEY] || ''
  const bucket = HORIZON_BUCKETS.find((b) => b.tagValue === tag)
  return bucket ? bucket.key : UNSCHEDULED_BUCKET_KEY
}

// tagValueForBucketKey maps a column back to the field value a
// placement writes -- the bucket's own tag value, or '' (clearing the
// field) for Unscheduled and any unrecognized key.
function tagValueForBucketKey(bucketKey) {
  const bucket = HORIZON_BUCKETS.find((b) => b.key === bucketKey)
  return bucket ? bucket.tagValue : ''
}

// cardsEligibleForBucket is the "+ Place cards" picker's candidate
// list: every card NOT already sitting in that column.
function cardsEligibleForBucket(allCards, bucketKey) {
  return allCards.filter((c) => effectiveBucketKeyForCard(c) !== bucketKey)
}

// buildRoadmapLanes pivots the viewed space's cards into one lane per
// kind that has any card in view, against the horizon columns plus the
// trailing Unscheduled catch-all. anyTagged tells the all-untagged
// empty state apart from a single empty cell.
function buildRoadmapLanes(allCards, allKinds) {
  const kindById = new Map(allKinds.map((k) => [k.id, k]))
  const laneOrder = []
  const laneNames = new Map()
  const cellsByLane = new Map()
  let anyTagged = false
  for (const card of allCards) {
    const kindId = card.kindId || ''
    const kind = kindById.get(card.kindId)
    if (!cellsByLane.has(kindId)) {
      cellsByLane.set(kindId, BUCKET_KEYS.map(() => []))
      laneNames.set(kindId, kind ? (kind.icon ? kind.icon + ' ' + kind.label : kind.label) : kindId)
      laneOrder.push(kindId)
    }
    const bucketKey = effectiveBucketKeyForCard(card)
    if (bucketKey !== UNSCHEDULED_BUCKET_KEY) anyTagged = true
    cellsByLane.get(kindId)[BUCKET_KEYS.indexOf(bucketKey)].push(card)
  }
  return {
    bucketKeys: BUCKET_KEYS,
    lanes: laneOrder.map((key) => ({ laneKey: key, laneName: laneNames.get(key), cells: cellsByLane.get(key) })),
    anyTagged,
  }
}

// setColumnHighlight paints the drag-over column marker across every
// lane's matching cell directly -- a full redraw mid-drag would swap
// the element the gesture is holding, so the cells keep their nodes.
function setColumnHighlight(bucketKey) {
  dragOverBucketKey = bucketKey
  for (const el of pane.querySelectorAll('[data-testid="atlas-roadmap-cell"]')) {
    el.classList.toggle('cellDragOver', el.getAttribute('data-bucket-key') === bucketKey)
  }
}

let cards = []
let kinds = []
let pickerOpenFor = null
let dragOverBucketKey = null

// The viewed space arrives in the pane's own context (spaceCardId);
// '' is the root space. The page scopes its query the way the board
// does: a space's own direct children.
function spaceId() {
  const value = mill.context ? mill.context.spaceCardId : undefined
  return typeof value === 'string' ? value : ''
}

// The quiet toast: one line, one at a time, self-clearing after 3s --
// the same surface the board uses for small confirmations, kept in
// normal flow so it lands at the pane's own bottom.
let toastMessage = null
let toastTimer = null
function showToast(message) {
  toastMessage = message
  if (toastTimer !== null) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMessage = null; toastTimer = null; draw() }, 3000)
  draw()
}

// placeCard writes the card's horizon field through Mill's one guarded
// field door: Mill merges it onto the card's other fields, declares
// the Horizon field on the kind first when the kind has not yet (the
// kind grammar lives server-side), and journals the write so undo
// works. A same-column call is a no-op. The toast announcing the
// auto-declare reads the kind the page last listed, since the write
// itself is Mill's.
async function placeCard(card, targetBucketKey) {
  if (effectiveBucketKeyForCard(card) === targetBucketKey) return
  const targetValue = tagValueForBucketKey(targetBucketKey)
  const kind = kinds.find((k) => k.id === card.kindId)
  const hadField = kind ? kind.fields.some((f) => f.key === HORIZON_FIELD_KEY) : false
  let result
  try {
    result = await mill.call('content.setCardFields', card.id, { horizon: targetValue })
  } catch (err) {
    console.error(err)
    void mill.call('notify', { level: 'error', text: "Couldn't save the placement." })
    showToast("Couldn't save the placement.")
    return
  }
  if (result && result.approved === false) {
    showToast("Couldn't save the placement" + (result.ruleLabel ? ' (' + result.ruleLabel + ')' : '') + '.')
    return
  }
  if (kind && !hadField) showToast('Added a Horizon field to ' + kind.label)
  await refresh()
}

function chipEl(card) {
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = 'chip'
  chip.setAttribute('data-testid', 'atlas-roadmap-chip')
  chip.draggable = true
  chip.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', card.id)
  })
  chip.addEventListener('click', () => {
    void mill.call('open', card.id).catch((err) => {
      console.error(err)
      void mill.call('notify', { level: 'error', text: 'The card could not be opened.' })
    })
  })
  const dot = document.createElement('span')
  dot.className = 'chipDot'
  dot.style.background = 'var(' + kindDotToken(card.kindId || '') + ')'
  const title = document.createElement('span')
  title.className = 'chipTitle'
  title.textContent = card.title
  chip.append(dot, title)
  return chip
}

function pickerEl(header, bucketKey) {
  if (pickerOpenFor !== bucketKey) return null
  const picker = document.createElement('div')
  picker.className = 'picker'
  const eligible = cardsEligibleForBucket(cards, bucketKey)
  if (eligible.length === 0) {
    const none = document.createElement('button')
    none.type = 'button'
    none.className = 'pickerItem'
    none.disabled = true
    none.setAttribute('data-testid', 'atlas-roadmap-picker-empty')
    none.textContent = 'No other cards to place here.'
    picker.append(none)
    return picker
  }
  for (const card of eligible) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'pickerItem'
    item.setAttribute('data-testid', 'atlas-roadmap-picker-item')
    item.textContent = card.title
    item.addEventListener('click', () => {
      pickerOpenFor = null
      draw()
      void placeCard(card, bucketKey)
    })
    picker.append(item)
  }
  return picker
}

const PLUS_PATH = 'M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z'

function headerCellEl(bucketKey) {
  const header = document.createElement('div')
  header.className = 'headerCell'
  header.setAttribute('data-testid', 'atlas-roadmap-column-header-cell')
  const name = document.createElement('span')
  name.setAttribute('data-testid', 'atlas-roadmap-column-header')
  name.textContent = BUCKET_NAMES[bucketKey]
  header.append(name)
  if (HORIZON_BUCKETS.some((b) => b.key === bucketKey)) {
    const place = document.createElement('button')
    place.type = 'button'
    place.className = 'placeCards'
    place.setAttribute('data-testid', 'atlas-roadmap-place-cards-' + bucketKey)
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('viewBox', '0 0 16 16')
    icon.setAttribute('width', '12')
    icon.setAttribute('height', '12')
    icon.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', PLUS_PATH)
    path.setAttribute('fill', 'currentColor')
    icon.append(path)
    const text = document.createElement('span')
    text.textContent = 'Place cards'
    place.append(icon, text)
    place.addEventListener('click', (e) => {
      e.stopPropagation()
      pickerOpenFor = pickerOpenFor === bucketKey ? null : bucketKey
      draw()
    })
    header.append(place)
    const picker = pickerEl(header, bucketKey)
    if (picker) header.append(picker)
  }
  return header
}

function laneRowEls(lane, bucketKeys) {
  const els = []
  const labelEl = document.createElement('div')
  labelEl.className = 'laneLabel'
  labelEl.setAttribute('data-testid', 'atlas-roadmap-lane-label')
  labelEl.textContent = lane.laneName
  els.push(labelEl)
  lane.cells.forEach((cell, i) => {
    const bucketKey = bucketKeys[i]
    const cellEl = document.createElement('div')
    cellEl.className = 'cell' + (dragOverBucketKey === bucketKey ? ' cellDragOver' : '')
    cellEl.setAttribute('data-testid', 'atlas-roadmap-cell')
    cellEl.setAttribute('data-lane-key', lane.laneKey)
    cellEl.setAttribute('data-bucket-key', bucketKey)
    cellEl.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (dragOverBucketKey !== bucketKey) setColumnHighlight(bucketKey)
    })
    cellEl.addEventListener('dragleave', () => {
      if (dragOverBucketKey !== null) setColumnHighlight(null)
    })
    cellEl.addEventListener('drop', (e) => {
      e.preventDefault()
      const cardID = e.dataTransfer.getData('text/plain')
      setColumnHighlight(null)
      const card = cards.find((c) => c.id === cardID)
      if (card) void placeCard(card, bucketKey)
    })
    if (cell.length === 0) {
      const empty = document.createElement('span')
      empty.className = 'emptyCell'
      empty.setAttribute('data-testid', 'atlas-roadmap-empty-cell')
      empty.textContent = '—'
      cellEl.append(empty)
    } else {
      for (const card of cell) cellEl.append(chipEl(card))
    }
    els.push(cellEl)
  })
  return els
}

// A single blank row while the viewed space has no cards at all -- the
// skeleton's own shape still teaches itself with nothing to place yet.
function ghostLane(bucketKeys) {
  return { laneKey: '__ghost', laneName: '', cells: bucketKeys.map(() => []) }
}

function draw() {
  pane.replaceChildren()
  const board = buildRoadmapLanes(cards, kinds)
  if (!board.anyTagged) {
    const empty = document.createElement('p')
    empty.className = 'emptyState'
    empty.setAttribute('data-testid', 'atlas-roadmap-empty')
    empty.textContent = 'Place a card in Now, Next, or Then to start your roadmap.'
    pane.append(empty)
  }
  const grid = document.createElement('div')
  grid.className = 'grid'
  grid.style.gridTemplateColumns = 'minmax(140px, auto) repeat(' + board.bucketKeys.length + ', minmax(160px, 1fr))'
  grid.setAttribute('data-testid', 'atlas-roadmap-grid')
  const corner = document.createElement('div')
  corner.className = 'headerCell'
  grid.append(corner)
  for (const key of board.bucketKeys) grid.append(headerCellEl(key))
  const lanesToRender = board.lanes.length > 0 ? board.lanes : [ghostLane(board.bucketKeys)]
  for (const lane of lanesToRender) for (const el of laneRowEls(lane, board.bucketKeys)) grid.append(el)
  pane.append(grid)
  if (toastMessage !== null) {
    const toast = document.createElement('div')
    toast.className = 'toastBanner'
    toast.setAttribute('data-testid', 'atlas-quiet-toast')
    toast.setAttribute('role', 'status')
    toast.textContent = toastMessage
    pane.append(toast)
  }
}

async function refresh() {
  try {
    const [entries, kindList] = await Promise.all([mill.call('query', { kind: 'card' }), mill.call('kinds')])
    const scope = spaceId()
    cards = entries.filter((e) => (e.parentId || '') === scope)
    kinds = kindList
    draw()
  } catch (err) {
    console.error(err)
    void mill.call('notify', { level: 'error', text: 'The roadmap could not be drawn.' })
  }
}

// A click anywhere outside an open picker closes it; the button stops
// its own propagation so it toggles instead.
document.addEventListener('click', (e) => {
  if (pickerOpenFor === null) return
  if (e.target instanceof Element && e.target.closest('.picker')) return
  pickerOpenFor = null
  draw()
})

// The pane contract every Atlas projection keeps -- "Escape swaps back
// to the Board" -- is the page's own job inside a sandboxed frame: a
// keydown never reaches Mill's document, so the page closes its picker
// first and otherwise asks Mill to show the board again through the
// registry command the switcher's Board segment owns.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (pickerOpenFor !== null) {
    pickerOpenFor = null
    draw()
    return
  }
  void mill.call('runCommand', 'atlas.board.home').catch(() => {})
})

// Redraw on board changes that can move a lane or a column (a card or
// a kind); everything else is noise for this page.
mill.on('contents:changed', (payload) => {
  const kind = payload && payload.kind
  if (!kind || kind === 'card' || kind === 'kind') void refresh()
})

// The pane's own context arrives on mount and again on every change --
// navigating into a space re-scopes the view the way the board does.
mill.on('ctx', () => { void refresh() })

void refresh()
