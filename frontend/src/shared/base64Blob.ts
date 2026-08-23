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

// Reads file's raw bytes as a standard-encoding base64 string -- the
// wire shape every binary-upload binding (SaveImageBytes,
// ParseXlsxFile) expects, matching typedfield.Field's own repo-wide
// "every value is a plain string on the wire" convention. Chunked so a
// large file's byte array never blows the call stack
// String.fromCharCode(...bytes) would hit unchunked. Promoted here from
// atlas/atlasTools.ts once configure/'s xlsx import needed the same
// conversion (frontend.md's shared/-promotion rule).
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
