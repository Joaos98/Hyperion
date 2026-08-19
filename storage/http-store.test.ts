import { describe, expect, it, vi } from 'vitest'
import { StorageError } from './port.js'
import { httpStore } from './http-store.js'

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('httpStore', () => {
  it('loads the record from GET /record', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { record: { user: { id: 'local' } } }))
    const store = httpStore('http://hyperion.local', send)
    const record = await store.loadUserRecord('local')
    expect(send).toHaveBeenCalledWith('http://hyperion.local/record', { method: 'GET' })
    expect(record).toEqual({ user: { id: 'local' } })
  })

  it('sends a Position as PUT with its id in the path', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(204))
    const store = httpStore('http://hyperion.local', send)
    const position = { id: 'pos-1', userId: 'local', company: 'Kestrel' }
    await store.writePosition(position as never)
    expect(send).toHaveBeenCalledWith(
      'http://hyperion.local/positions/pos-1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ position }) }),
    )
  })

  it('turns a non-2xx response into a StorageError carrying the server’s own message', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(409, { error: 'no Position "pos-1" is stored' }))
    const store = httpStore('http://hyperion.local', send)
    await expect(store.deletePayment('local', 'pay-1')).rejects.toThrow('no Position "pos-1" is stored')
  })

  it('turns a network failure into a StorageError rather than throwing raw', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const store = httpStore('http://hyperion.local', send)
    await expect(store.writeUser({ id: 'local' } as never)).rejects.toThrow(StorageError)
  })

  it('refuses to create a User — that is build order step 4', async () => {
    const store = httpStore('http://hyperion.local', vi.fn())
    await expect(store.createUser({ id: 'local' } as never)).rejects.toThrow(StorageError)
  })
})
