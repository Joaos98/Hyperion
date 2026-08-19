/**
 * A minimal ZIP writer — stored (uncompressed) entries only, no external dependency. The
 * whole-app export (hyperion-plan.md § The application record) is career-record JSON plus
 * a handful of résumé-sized files; implementing DEFLATE for that is not worth a dependency
 * the rest of this codebase otherwise carries none of (package.json's own restraint).
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
