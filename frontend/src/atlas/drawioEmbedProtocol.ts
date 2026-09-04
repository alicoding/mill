// The pure, engine-agnostic side of draw.io's own documented embed-mode
// postMessage protocol (embed=1&proto=json --
// https://www.drawio.com/doc/faq/embed-mode; goal 0237 S0/S1). No DOM,
// no iframe, no fetch: given one inbound protocol message and the
// diagram's current XML, returns the actions Mill's host side takes.
// This is the seam a fake-engine contract test drives directly
// (drawioEmbedProtocol.test.ts) -- the test that outlives an engine
// upgrade, since it never touches the real vendored editor and would
// keep passing against any engine that still speaks this exact JSON
// contract. DrawioEditorMount.tsx is the one real caller, translating
// these actions into an actual postMessage/RPC/close.
//
// Every field below is named EXACTLY as draw.io's own protocol
// documentation states it -- no reverse-engineered internals, only the
// documented event/action vocabulary (no-catch-up-tax rule 3,
// docs/goals/0237-embedded-editor-engines.md).
export interface DrawioEmbedMessage {
  event?: string
  xml?: string
  modified?: boolean
  exit?: boolean
  [key: string]: unknown
}

export type DrawioEmbedAction =
  | { type: 'sendToEditor'; message: Record<string, unknown> }
  | { type: 'writeMirror'; xml: string }
  | { type: 'close' }

// nextDrawioActions maps one inbound protocol event to the actions Mill
// takes:
//   - 'init' (editor ready) -> reply with the documented 'load' action,
//     carrying the mirror's current XML and autosave:1 -- every
//     subsequent edit arrives as its own 'autosave' event rather than
//     requiring a manual Save, so the mirror file never trails an
//     in-progress edit by more than one autosave round trip.
//   - 'autosave'/'save' (the editor reports a change) -> write the
//     carried xml to the SAME mirror file the board's existing
//     fsnotify watch already observes (goal 0194) -- Mill never emits
//     its own change signal, the watch does that on its own debounce.
//     'save' additionally closes when the editor's own payload sets
//     exit: true (its documented "Save and Exit" shape).
//   - 'exit' (the user closed the editor's own UI) -> close. No
//     defensive re-write here: autosave:1 above means every prior edit
//     already landed on disk before 'exit' could ever fire.
// externalChangeActions maps a change Mill observed on the mirror FILE
// (the fsnotify watch, goal 0194 -- never a protocol message) onto the
// documented 'merge' action: draw.io merges the incoming file into the
// open diagram, keeping the editor's own in-progress state, where
// 'load' would replace the whole document and discard it. A change
// whose bytes are the ones this editor itself last autosaved is the
// watch observing our own write -- merging it back would fight the
// person's typing, so it produces no action at all.
export function externalChangeActions(xml: string, lastWrittenXML: string): DrawioEmbedAction[] {
  if (xml === '' || xml === lastWrittenXML) return []
  return [{ type: 'sendToEditor', message: { action: 'merge', xml } }]
}

export function nextDrawioActions(message: DrawioEmbedMessage, initialXML: string): DrawioEmbedAction[] {
  switch (message.event) {
    case 'init':
      return [{ type: 'sendToEditor', message: { action: 'load', xml: initialXML, autosave: 1 } }]
    case 'autosave':
    case 'save': {
      const actions: DrawioEmbedAction[] = []
      if (typeof message.xml === 'string') actions.push({ type: 'writeMirror', xml: message.xml })
      if (message.exit) actions.push({ type: 'close' })
      return actions
    }
    case 'exit':
      return [{ type: 'close' }]
    default:
      return []
  }
}
