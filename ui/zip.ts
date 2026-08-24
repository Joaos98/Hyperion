/**
 * A minimal ZIP reader and writer, no external dependency. `buildZip` writes stored
 * (uncompressed) entries only — the whole-app export is career-record JSON plus a handful of
 * résumé-sized files, not worth implementing DEFLATE for. `readZip` reads both: an archive re-saved by an ordinary zip tool (someone
 * extracting an export to look at it, then re-zipping it) is likely DEFLATE-compressed, and
 * the browser's own Compression Streams API decodes that without needing a hand-rolled
 * inflate — no dependency added, just a platform API this codebase hadn't reached for yet.
 */

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const encoder = new TextEncoder()

// The zip format's own epoch (1980-01-01 00:00, DOS date/time encoding) — an export's
// entries carry no meaningful per-file mtime, so every entry gets the same fixed stamp.
const DOS_TIME = 0x0000
const DOS_DATE = 0x0021

const CRC_TABLE = buildCrcTable()

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u16(n: number): Uint8Array {
  return Uint8Array.from([n & 0xff, (n >>> 8) & 0xff])
}

function u32(n: number): Uint8Array {
  return Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Builds a ZIP archive, stored (uncompressed), from `entries` — full byte content, ready to save. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)

    const localHeader = concat([
      u32(0x04034b50),
      u16(20), // version needed to extract
      u16(0x0800), // general purpose flag: UTF-8 file name
      u16(0), // compression method: stored
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(entry.data.length), // compressed size
      u32(entry.data.length), // uncompressed size
      u16(name.length),
      u16(0), // extra field length
    ])
    localParts.push(localHeader, name, entry.data)

    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed to extract
        u16(0x0800),
        u16(0),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0), // extra field length
        u16(0), // file comment length
        u16(0), // disk number start
        u16(0), // internal file attributes
        u32(0), // external file attributes
        u32(offset), // relative offset of local header
      ]),
      name,
    )

    offset += localHeader.length + name.length + entry.data.length
  }

  const centralDirectoryOffset = offset
  const centralDirectory = concat(centralParts)
  const endOfCentralDirectory = concat([
    u32(0x06054b50),
    u16(0), // this disk
    u16(0), // disk with start of central directory
    u16(entries.length), // entries on this disk
    u16(entries.length), // entries in total
    u32(centralDirectory.length),
    u32(centralDirectoryOffset),
    u16(0), // comment length
  ])

  return concat([...localParts, centralDirectory, endOfCentralDirectory])
}

const decoder = new TextDecoder()

/** Reads every entry out of a ZIP archive, decompressing stored or DEFLATE-compressed entries alike. */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(bytes, view)
  const entryCount = view.getUint16(eocdOffset + 10, true)
  let offset = view.getUint32(eocdOffset + 16, true) // central directory offset

  const entries: ZipEntry[] = []
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('This is not a readable zip: the central directory is malformed')
    }
    const compression = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength))

    const localNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.slice(dataStart, dataStart + compressedSize)

    entries.push({ name, data: await decompress(raw, compression) })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Zip files with no comment carry the record 22 bytes from the end; a comment pushes it earlier. */
function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const searchFloor = Math.max(0, bytes.length - 22 - 0xffff)
  for (let offset = bytes.length - 22; offset >= searchFloor; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset
  }
  throw new Error('This is not a readable zip: no end-of-central-directory record found')
}

async function decompress(bytes: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return bytes
  if (method !== 8) throw new Error(`This zip uses a compression method Hyperion cannot read (${method})`)
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  // Same ArrayBufferLike-vs-ArrayBuffer generic mismatch as Blob's BlobPart elsewhere in this codebase.
  void writer.write(bytes as BufferSource).then(() => writer.close())
  const chunks: Uint8Array[] = []
  const reader = stream.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return concat(chunks)
}
