// The board index as a page of its own: Mill mounts this file in a
// sandboxed frame, so every style, element and script here belongs to
// the plugin and nothing here can reach Mill's own document.
//
// window.acquireMillApi() is the only door back. call() reaches the
// plugin doors (query here), on() subscribes to what Mill pushes in,
// and getState/setState remember one choice across mounts.

const mill = window.acquireMillApi()

const list = document.getElementById('list')
const grouping = document.getElementById('grouping')

let byKind = mill.getState() !== false

const label = () => (byKind ? 'List by title' : 'Group by kind')

function draw(entries) {
  list.replaceChildren()
  grouping.textContent = label()
  if (entries.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'Nothing on the board yet.'
    list.append(empty)
    return
  }
  if (!byKind) {
    for (const entry of [...entries].sort((a, b) => a.title.localeCompare(b.title))) list.append(row(entry.title, entry.kind))
    return
  }
  const groups = new Map()
  for (const entry of entries) {
    if (!groups.has(entry.kind)) groups.set(entry.kind, [])
    groups.get(entry.kind).push(entry)
  }
  for (const [kind, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const heading = document.createElement('h2')
    heading.textContent = kind.charAt(0).toUpperCase() + kind.slice(1) + ' · ' + items.length
    heading.setAttribute('data-testid', 'index-kind-' + kind)
    list.append(heading)
    for (const entry of items) list.append(row(entry.title, kind))
  }
}

function row(title, kind) {
  const el = document.createElement('div')
  el.className = 'row'
  el.textContent = title
  el.setAttribute('data-testid', 'index-row')
  el.setAttribute('data-kind', kind)
  return el
}

async function refresh() {
  try {
    draw(await mill.call('query', {}))
  } catch (err) {
    list.replaceChildren()
    const failed = document.createElement('div')
    failed.className = 'empty'
    failed.textContent = 'Could not list the board.'
    list.append(failed)
    void mill.call('notify', { level: 'error', text: 'The board contents could not be listed.' })
    console.error(err)
  }
}

grouping.addEventListener('click', () => {
  byKind = !byKind
  mill.setState(byKind)
  void refresh()
})

mill.on('contents:changed', () => { void refresh() })
void refresh()
