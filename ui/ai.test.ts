import { describe, expect, it, vi } from 'vitest'
import { AiError, generateSelfAssessment } from './ai.js'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('generateSelfAssessment', () => {
  it('sends the prompt with the User’s key and the direct-browser-access header', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { content: [{ type: 'text', text: 'Draft.' }] }))
    await generateSelfAssessment('sk-ant-test', 'the prompt', send)
    const [url, init] = send.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
    expect(JSON.parse(init.body as string).messages).toEqual([{ role: 'user', content: 'the prompt' }])
  })

  it('returns the text block from the response', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { content: [{ type: 'text', text: 'Here is the draft.' }] }))
    const text = await generateSelfAssessment('sk-ant-test', 'prompt', send)
    expect(text).toBe('Here is the draft.')
  })

  it('turns a non-2xx response into an AiError carrying Anthropic’s own message', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: 'invalid x-api-key' } }))
    await expect(generateSelfAssessment('bad-key', 'prompt', send)).rejects.toThrow('invalid x-api-key')
  })

  it('turns a network failure into an AiError rather than throwing raw', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(generateSelfAssessment('sk-ant-test', 'prompt', send)).rejects.toThrow(AiError)
  })

  it('refuses a response with no text block', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { content: [] }))
    await expect(generateSelfAssessment('sk-ant-test', 'prompt', send)).rejects.toThrow(AiError)
  })
})
