import { describe, expect, it } from 'vitest'
import { buildZip, crc32, readZip, type ZipEntry } from './zip.js'

const encoder = new TextEncoder()

describe('crc32', () => {
  it('matches the standard reference vector', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926)
  })

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('buildZip', () => {
  it('writes local file headers a reader can walk independently of the central directory', () => {
    const entries = [
      { name: 'data.json', data: encoder.encode('{"hello":"world"}') },
      { name: 'documents/résumé.pdf', data: Uint8Array.from([1, 2, 3, 4, 5]) },
    ]
    const zip = buildZip(entries)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)

    let offset = 0
    for (const entry of entries) {
      expect(view.getUint32(offset, true)).toBe(0x04034b50)
      const compression = view.getUint16(offset + 8, true)
      expect(compression).toBe(0)
      const crc = view.getUint32(offset + 14, true)
      expect(crc).toBe(crc32(entry.data))
      const size = view.getUint32(offset + 18, true)
      expect(size).toBe(entry.data.length)
      const nameLength = view.getUint16(offset + 26, true)
      const nameBytes = zip.slice(offset + 30, offset + 30 + nameLength)
      expect(new TextDecoder().decode(nameBytes)).toBe(entry.name)
      const dataStart = offset + 30 + nameLength
      expect(zip.slice(dataStart, dataStart + entry.data.length)).toEqual(entry.data)
      offset = dataStart + entry.data.length
    }

    // End of central directory: fixed-size trailer at the very end, no comment written.
    const eocdOffset = zip.length - 22
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50)
    expect(view.getUint16(eocdOffset + 10, true)).toBe(entries.length)
    const centralDirectorySize = view.getUint32(eocdOffset + 12, true)
    const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)
    expect(centralDirectoryOffset).toBe(offset)
    expect(centralDirectoryOffset + centralDirectorySize).toBe(eocdOffset)

    // Central directory's first entry points back at its local header, offset 0.
    expect(view.getUint32(centralDirectoryOffset, true)).toBe(0x02014b50)
    expect(view.getUint32(centralDirectoryOffset + 42, true)).toBe(0)
  })

  it('writes a valid, empty archive for no entries', () => {
    const zip = buildZip([])
    expect(zip.length).toBe(22)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(view.getUint32(0, true)).toBe(0x06054b50)
    expect(view.getUint16(10, true)).toBe(0)
  })
})

describe('readZip', () => {
  it('round-trips exactly what buildZip wrote (stored)', async () => {
    const entries: ZipEntry[] = [
      { name: 'data.json', data: encoder.encode('{"hello":"world"}') },
      { name: 'documents/résumé.pdf', data: Uint8Array.from([1, 2, 3, 4, 5]) },
      { name: 'empty.txt', data: new Uint8Array() },
    ]
    const read = await readZip(buildZip(entries))
    expect(read).toEqual(entries)
  })

  it('reads an empty archive as no entries', async () => {
    expect(await readZip(buildZip([]))).toEqual([])
  })

  it('decompresses a DEFLATE-compressed entry via the platform Compression Streams API', async () => {
    const original = encoder.encode('a'.repeat(500)) // repetitive, so it actually compresses
    const compressed = await deflate(original)
    const zip = buildZip([{ name: 'data.json', data: compressed }])
    // buildZip only ever writes stored (method 0) entries — flip the compression-method byte
    // to 8 (DEFLATE) in both the local header (fixed offset 8) and its mirror in the central
    // directory (found by its own signature, offset 10 within it), fabricating what a real
    // DEFLATE-saved zip looks like without hand-deriving byte offsets through the format.
    zip[8] = 8
    zip[findSignature(zip, 0x01, 0x02) + 10] = 8

    const read = await readZip(zip)
    expect(read).toEqual([{ name: 'data.json', data: original }])
  })
})

/** The offset of the local-file-header-style signature `50 4b <b3> <b4>` (little-endian PK\x03\x04 family). */
function findSignature(bytes: Uint8Array, b3: number, b4: number): number {
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === b3 && bytes[i + 3] === b4) return i
  }
  throw new Error('signature not found')
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  void writer.write(bytes as BufferSource).then(() => writer.close())
  const chunks: Uint8Array[] = []
  const reader = stream.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
