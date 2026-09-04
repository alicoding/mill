// Plugin-contributed color themes (goal 0342). A theme is DATA: a CSS
// file of nothing but custom-property declarations, drawn from the
// vocabulary userdocs/reference/plugin-theming.md publishes. The host
// validates it, layers it over the family's built-in palette and
// injects the result; plugin code never touches the document, so a
// theme cannot reach past the sandbox with a selector or a URL.
//
// The rules here are the same ones Go's ValidateThemeCSS enforces for
// the author (internal/services/pluginsvc/themes.go). Two copies is
// deliberate: the author's check must run without a browser, and the
// injector must never trust a file it did not check itself.

import type { ResolvedMode } from './appearance'

// THEME_VARIABLES is the documented vocabulary, in the same order the
// theming reference lists it. A declaration of anything else is
// refused: nothing outside this list is promised to exist in every
// scheme, so a theme built on one would paint differently per family.
export const THEME_VARIABLES: readonly string[] = [
	'--mill-accent-emphasis',
	'--mill-accent-fg',
	'--mill-accent-muted',
	'--mill-accent-border-muted',
	'--mill-kind-trigger',
	'--mill-kind-capture',
	'--mill-kind-process',
	'--mill-kind-apply',
	'--mill-kind-decision',
	'--mill-kind-terminal',
	'--mill-mono',
	'--fgColor-default',
	'--fgColor-muted',
	'--bgColor-default',
	'--bgColor-muted',
	'--borderColor-default',
	'--fgColor-accent',
	'--bgColor-accent-emphasis',
	'--fgColor-onEmphasis',
	'--borderColor-accent-emphasis',
	'--fgColor-danger',
	'--fgColor-attention',
	'--fgColor-success',
]

const DOCUMENTED = new Set(THEME_VARIABLES)

export interface ThemeCssRefusal {
	line: number
	problem: string
}

const DECL = /^(--[A-Za-z0-9_-]+)\s*:\s*(\S.*)$/
const BANNED = /\b(url|expression|image-set)\s*\(/i

// validateThemeCss returns the first line the host refuses, or null
// when the whole file is declarations of documented tokens.
export function validateThemeCss(src: string): ThemeCssRefusal | null {
	const stripped = stripComments(src)
	if (stripped === null) return { line: unclosedCommentLine(src), problem: 'a comment is never closed' }
	let line = 1
	let start = 1
	let segment = ''
	const judge = (): ThemeCssRefusal | null => {
		const text = segment.trim()
		segment = ''
		if (text === '') return null
		const problem = declarationProblem(text)
		return problem === null ? null : { line: start, problem }
	}
	for (const ch of stripped) {
		const structural = structuralProblem(ch)
		if (structural !== null) return { line, problem: structural }
		if (ch === '\n') {
			line += 1
			segment += ' '
		} else if (ch === ';') {
			const refusal = judge()
			if (refusal) return refusal
			start = line
		} else {
			if (segment.trim() === '' && ch !== ' ' && ch !== '\t') start = line
			segment += ch
		}
	}
	return judge()
}

// structuralProblem names the characters a theme file may not contain
// at all: a block would carry a selector, and an at-rule would carry
// an import.
function structuralProblem(ch: string): string | null {
	if (ch === '{' || ch === '}') return 'a theme file holds declarations only, never a selector or a block'
	if (ch === '@') return 'a theme file holds declarations only, never an at-rule'
	return null
}

function declarationProblem(text: string): string | null {
	const m = DECL.exec(text)
	if (m === null) return 'only "--token: value" declarations belong here'
	if (!DOCUMENTED.has(m[1])) return `${m[1]} is not a documented theme variable`
	if (BANNED.test(m[2])) return 'a theme value may not load anything from outside the file'
	return null
}

// stripComments blanks /* */ comments while preserving newlines, so a
// refusal further down still reports the author's own line number.
function stripComments(src: string): string | null {
	let out = ''
	let inComment = false
	for (let i = 0; i < src.length; i += 1) {
		const ch = src[i]
		if (ch === '\n') {
			out += '\n'
			continue
		}
		if (inComment) {
			if (ch === '*' && src[i + 1] === '/') {
				inComment = false
				i += 1
			}
			continue
		}
		if (ch === '/' && src[i + 1] === '*') {
			inComment = true
			i += 1
			continue
		}
		out += ch
	}
	return inComment ? null : out
}

function unclosedCommentLine(src: string): number {
	let line = 1
	let inComment = false
	let openedAt = 1
	for (let i = 0; i < src.length; i += 1) {
		if (src[i] === '\n') line += 1
		else if (inComment) {
			if (src[i] === '*' && src[i + 1] === '/') {
				inComment = false
				i += 1
			}
		} else if (src[i] === '/' && src[i + 1] === '*') {
			inComment = true
			openedAt = line
			i += 1
		}
	}
	return openedAt
}

// themeSelector is the pair mill-tokens.css already proved wins: two
// attributes, matching Primer's own specificity, settled by loading
// later. It is written on the document root by applyAppearance AND on
// the BaseStyles element by AppearanceProvider, so it reaches both the
// page chrome and everything inside Primer's own theme wrapper, whose
// rules would otherwise be declared directly on a nearer ancestor.
export function themeSelector(family: ResolvedMode, schemeId: string): string {
	return `[data-mill-theme="${family}"][data-mill-scheme="${schemeId}"]`
}

// Primer scopes every built-in palette to a data-color-mode +
// data-<family>-theme pair, once at the top of the file and once
// inside a prefers-color-scheme block. A contributed theme defines
// only the documented tokens, so it needs the family's whole palette
// underneath it; rewriting those selectors onto Mill's resolved pair
// is what supplies it without copying a single color value by hand.
const PRIMER_SELECTOR = /\[data-color-mode(?:="[a-z]+")?\](?:\[data-color-mode="auto"\])?\[data-(?:light|dark)-theme="BASE"\]/g

function primerSelectorPattern(base: string): RegExp {
	return new RegExp(PRIMER_SELECTOR.source.replace('BASE', base), 'g')
}

// rebaseThemeCss rewrites one of Primer's own functional theme files
// so its declarations apply under a contributed theme's scheme id.
export function rebaseThemeCss(baseCss: string, base: 'light' | 'dark', family: ResolvedMode, schemeId: string): string {
	return baseCss.replace(primerSelectorPattern(base), themeSelector(family, schemeId))
}

// buildThemeCss is the whole stylesheet the host injects for one
// contributed theme: the family's built-in palette rebased onto the
// theme's own scheme id, then the theme's declarations after it, so a
// token the author names wins and every token they left alone keeps
// the built-in value.
export function buildThemeCss(baseCss: string, family: ResolvedMode, schemeId: string, declarations: string): string {
	const base = family === 'dark' ? 'dark' : 'light'
	const rebased = rebaseThemeCss(baseCss, base, family, schemeId)
	return `${rebased}\n${themeSelector(family, schemeId)} {\n${declarations.trim()}\n}\n`
}

// PluginThemeEntry is one accepted theme, as the picker lists it.
export interface PluginThemeEntry {
	schemeId: string
	pluginId: string
	pluginName: string
	label: string
	family: ResolvedMode
}

// PluginThemeRejection is one theme the host refused, as the picker
// reports it: the reason names the line so an author can fix the file.
export interface PluginThemeRejection {
	schemeId: string
	pluginName: string
	label: string
	line: number
}

const accepted = new Map<string, PluginThemeEntry>()
const rejected = new Map<string, PluginThemeRejection>()
const listeners = new Set<() => void>()
let snapshot: PluginThemeEntry[] = []
let rejectionSnapshot: PluginThemeRejection[] = []

export function pluginThemeSchemeId(pluginId: string, themeId: string): string {
	return `${pluginId}.${themeId}`
}

// isPluginScheme distinguishes a contributed scheme id from one of
// Primer's own, which never contain a dot.
export function isPluginScheme(schemeId: string): boolean {
	return schemeId.includes('.')
}

export function acceptPluginTheme(entry: PluginThemeEntry): void {
	accepted.set(entry.schemeId, entry)
	rejected.delete(entry.schemeId)
	publish()
}

export function rejectPluginTheme(rejection: PluginThemeRejection): void {
	rejected.set(rejection.schemeId, rejection)
	accepted.delete(rejection.schemeId)
	publish()
}

// forgetPluginThemes drops one plugin's themes ahead of its reload,
// and whenever it stops running at all.
export function forgetPluginThemes(pluginId: string): void {
	for (const [id, entry] of accepted) if (entry.pluginId === pluginId) accepted.delete(id)
	for (const id of rejected.keys()) if (id.startsWith(`${pluginId}.`)) rejected.delete(id)
	publish()
}

// Both snapshots are rebuilt once per change and handed out by
// identity: useSyncExternalStore compares them that way, and a fresh
// array per read would re-render forever.
function publish(): void {
	snapshot = [...accepted.values()]
	rejectionSnapshot = [...rejected.values()]
	for (const l of listeners) l()
}

export function pluginThemes(): PluginThemeEntry[] {
	return snapshot
}

export function pluginThemeRejections(): PluginThemeRejection[] {
	return rejectionSnapshot
}

export function subscribePluginThemes(onChange: () => void): () => void {
	listeners.add(onChange)
	return () => listeners.delete(onChange)
}

// pluginThemesFor lists one family's contributed themes, the order the
// picker appends them after the built-in schemes.
export function pluginThemesFor(family: ResolvedMode): PluginThemeEntry[] {
	return snapshot.filter((t) => t.family === family)
}

// isKnownScheme answers whether a stored scheme id still has a
// stylesheet behind it. A contributed theme whose plugin was turned
// off or removed does not, which is what sends the family back to its
// built-in default.
export function isKnownScheme(schemeId: string, builtIn: readonly string[]): boolean {
	return builtIn.includes(schemeId) || accepted.has(schemeId)
}
