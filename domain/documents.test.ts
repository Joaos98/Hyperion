import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, documentsNewestFirst, formatBytes } from './documents.js'
import type { DocumentMeta } from './types.js'

function doc(id: string, createdAt: string): DocumentMeta {
  return { id, userId: 'user-1', label: id, filename: `${id}.pdf`, mimeType: 'application/pdf', sizeBytes: 1000, createdAt }
}

describe('documentsNewestFirst', () => {
  it('orders newest first', () => {
    const ordered = documentsNewestFirst([doc('a', '2026-01-01'), doc('b', '2026-06-01'), doc('c', '2026-03-01')])
    expect(ordered.map((d) => d.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('formatBytes', () => {
  it('renders bytes under a KB plainly', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('renders KB with one decimal below 10', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('renders KB rounded to a whole number at 10 and above', () => {
    expect(formatBytes(244 * 1024)).toBe('244 KB')
  })

  it('renders MB with one decimal', () => {
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4 MB')
  })
})

describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips arbitrary bytes, including zero and high values', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255, 42, 0, 255])
    expect(base64ToBytes(bytesToBase64(original))).toEqual(original)
  })

  it('round-trips an empty file', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array()))).toEqual(new Uint8Array())
  })
})
