export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 32 * 1024
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk))
  }
  return btoa(binary)
}
