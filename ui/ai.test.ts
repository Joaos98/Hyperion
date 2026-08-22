import { describe, expect, it, vi } from 'vitest'
import { AiError, askAi } from './ai.js'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('askAi', () => {
  it('posts an OpenAI-compatible chat-completions body to <baseUrl>/chat/completions', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'Draft.' } }] }))
    await askAi('https://api.anthropic.com/v1', 'sk-ant-test', 'claude-sonnet-5', 'the prompt', send)
    const [url, init] = send.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/chat/completions')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer sk-ant-test',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'the prompt' }],
    })
  })

  it('sends the Anthropic browser header to Anthropic only', async () => {
    // Google's preflight allows exactly content-type and authorization, so asking for a
    // third header 403s and the browser reports a bare NetworkError.
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'Draft.' } }] }))
    await askAi('https://generativelanguage.googleapis.com/v1beta/openai', 'key', 'gemini', 'the prompt', send)
    const [, init] = send.mock.calls[0] as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('anthropic-dangerous-direct-browser-access')
    expect(init.headers).toMatchObject({ authorization: 'Bearer key' })
  })

  it('sends no Anthropic header to a custom endpoint either', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'Draft.' } }] }))
    await askAi('http://localhost:11434/v1', 'key', 'llama', 'the prompt', send)
    const [, init] = send.mock.calls[0] as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('anthropic-dangerous-direct-browser-access')
  })

  it('strips a trailing slash from the base URL before appending the path', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'Draft.' } }] }))
    await askAi('https://api.example.com/v1/', 'key', 'model', 'prompt', send)
    const [url] = send.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
  })

  it('returns the message content from the response', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'Here is the draft.' } }] }))
    const text = await askAi('https://api.example.com/v1', 'key', 'model', 'prompt', send)
    expect(text).toBe('Here is the draft.')
  })

  it('turns a non-2xx response into an AiError carrying the provider’s own message', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: 'invalid api key' } }))
    await expect(askAi('https://api.example.com/v1', 'bad-key', 'model', 'prompt', send)).rejects.toThrow('invalid api key')
  })

  it('turns a network failure into an AiError rather than throwing raw', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(askAi('https://api.example.com/v1', 'key', 'model', 'prompt', send)).rejects.toThrow(AiError)
  })

  it('refuses a response with no message content', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [] }))
    await expect(askAi('https://api.example.com/v1', 'key', 'model', 'prompt', send)).rejects.toThrow(AiError)
  })
})
