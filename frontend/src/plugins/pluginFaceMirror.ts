import type { MirrorReadState } from '../atlas/useAtlasObjectMirrorRead'

// The mirror half of a file-backed face's ctx, shared by the legacy
// same-DOM face and the framed one (goal 0349 S6) so both hand a
// plugin the identical shape. Binary kinds arrive base64-encoded with
// a MIME type; a text kind (markdown source, json, csv, .env --
// ClassifyMirrorKind's text set) arrives as the raw text with no MIME
// type, and reaches the plugin as a text/plain data: URL so every file
// kind the mirror door reads is one a plugin face can decode.
export function mirrorDataUrlFor(mirrorContent: MirrorReadState | undefined): { dataUrl: string | null; failed: boolean } {
	const content = mirrorContent?.content
	const dataUrl = content?.MimeType && content?.Content
		? `data:${content.MimeType};base64,${content.Content}`
		: content?.Kind === 'text' && typeof content.Content === 'string'
			? `data:text/plain;charset=utf-8,${encodeURIComponent(content.Content)}`
			: null
	const failed = !!mirrorContent?.error || (!!content && !dataUrl)
	return { dataUrl, failed }
}
