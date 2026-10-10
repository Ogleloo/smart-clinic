/**
 * Client-side checks for a profile photo before it is ever sent anywhere.
 * Mirrors what the server must re-check (a browser check is a convenience,
 * never the boundary): JPEG or PNG only, 5 MB at most, and the file's actual
 * leading bytes must match — a renamed .exe or .svg with an image MIME type
 * is rejected, not trusted.
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
export const AVATAR_ACCEPT = 'image/jpeg,image/png'

export type AvatarCheck = { ok: true; type: 'image/jpeg' | 'image/png' } | { ok: false; error: string }

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((b, i) => bytes[i] === b)
}

export async function checkAvatarFile(file: { name: string; size: number; type: string; slice: (s: number, e: number) => { arrayBuffer: () => Promise<ArrayBuffer> } }): Promise<AvatarCheck> {
  if (file.size === 0) return { ok: false, error: 'That file is empty.' }
  if (file.size > AVATAR_MAX_BYTES) return { ok: false, error: 'That photo is larger than 5 MB.' }
  if (!/\.(jpe?g|png)$/i.test(file.name) || !['image/jpeg', 'image/png'].includes(file.type)) {
    return { ok: false, error: 'Choose a JPG or PNG photo.' }
  }
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const detected = startsWith(head, PNG) ? 'image/png' : startsWith(head, JPEG) ? 'image/jpeg' : null
  if (!detected) return { ok: false, error: 'That file isn’t a real JPG or PNG image.' }
  if (detected !== file.type) return { ok: false, error: 'That file’s type doesn’t match its contents.' }
  return { ok: true, type: detected }
}
