// markdownSnippet flattens markdown SOURCE into the plain one-line
// text a card face's preview shows (goal 0145): a snippet renders no
// block structure, so syntax marks are noise there -- the Notion/
// Obsidian preview convention is stripped text, full rendering on the
// page.
export function markdownSnippet(source: string): string {
  return source
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => a ?? b)
    .replace(/\*([^*]+)\*|_([^_]+)_/g, (_, a, b) => a ?? b)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
