/**
 * Where every identity in Hyperion comes from: a User's, a Position's, a row of any kind.
 * Nothing about an identity matters except that no two are ever the same, so this is a
 * UUID and the whole of what this module is for.
 *
 * `crypto.randomUUID` is the right answer and is used wherever it exists — but browsers
 * withhold it outside a secure context, which is precisely where Hyperion is expected to
 * run: a self-hosted deployment reached at `http://192.168.1.10:8080`, and a demo
 * published somewhere without a certificate. Left to reach for it directly, the app
 * throws on the first row anybody records, or before the demo's sample career has
 * rendered at all.
 *
 * `crypto.getRandomValues` is not gated that way, so the fallback is the same 122 random
 * bits laid out as a version 4 UUID by hand. It is the same identity by every measure
 * that matters here; the only difference is which function drew the bytes.
 */

/** A fresh identity, distinct from every other this deployment has ever minted. */
export function mintId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  /** Version 4, and the variant bits RFC 4122 requires; the other 122 bits are random. */
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
