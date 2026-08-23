// Decodes a base64 string (the shape AtlasService.MirrorContent returns
// for MirrorKindImage, and Backup/export payloads elsewhere) into a
// Blob of the given MIME type. Promoted here from views/
// DataStewardshipSection.tsx once a second bounded-context consumer
// (atlas/'s drawio exporter) needed the same conversion (frontend.md's
// shared/-promotion rule).
export function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}
