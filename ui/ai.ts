/** Raised when the AI layer cannot answer — a bad key, a network failure, a refusal. */
export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

/**
 * A named base URL to fill in when the User picks it — not a closed list `askAi` itself
 * knows about, just a convenience so most people never have to go find their provider's
 * endpoint by hand. `custom` leaves the base URL for the User to type themselves, the same
 * mechanism that reaches anything else speaking this wire shape (a local model server, a
 * provider not listed here).
 */
export interface AiPreset {
  id: string
  label: string
  baseUrl: string
}

export const AI_PRESETS: readonly AiPreset[] = [
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'custom', label: 'Custom', baseUrl: '' },
]

interface ChatCompletionsResponse {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

/**
 * The provider's own account of what went wrong, which is almost always more use than the
 * status code — "The model is overloaded", "Please pass a valid API key".
 *
 * Google wraps its error object in an array (`[{ error: … }]`) where everyone else returns
 * it bare, so reading `body.error` alone found nothing and every failure against Gemini
 * reported only its status. Both shapes are unwrapped here rather than in the caller,
 * since the caller has no reason to know which provider it is talking to.
 */
function providerMessage(body: unknown): string | undefined {
  const first = Array.isArray(body) ? body[0] : body
  const message = (first as ChatCompletionsResponse | undefined)?.error?.message
  return typeof message === 'string' && message.trim() ? message : undefined
}

/**
 * Sends a prompt straight from the browser to any OpenAI-compatible chat-completions
 * endpoint, using the User's own key — every AI feature's shared sender, whichever domain
 * module built the prompt (a self-assessment draft, résumé bullets, or whatever joins them
 * later). Anthropic, Google Gemini and most other providers now speak this same request
 * shape (CONTEXT.md § AI Setup), so one function reaches any of them; only `baseUrl`,
 * `apiKey` and `model` actually vary.
 *
 * Direct rather than proxied through a server: the key already lives only in this User's
 * own record (`ui/store.ts`'s `saveUser`), so routing the call through Hyperion's own
 * server would mean sending it over the wire a second time for no benefit — and it keeps
 * the demo build (no server at all) and the self-hosted build behaving identically, the
 * same reason the domain engine itself runs in the browser in both.
 *
 * Note this rules out OpenAI itself as a base URL: its API sends no CORS headers at all,
 * so no browser can call it directly regardless of request shape — not something this
 * function can work around, since the constraint is on OpenAI's own servers, not the
 * request.
 *
 * `anthropic-dangerous-direct-browser-access` goes only to Anthropic, which requires it for
 * a browser-origin request to pass CORS at all. It used to be sent to everyone, on the
 * reasoning that a provider ignores a header it does not recognise — true of a server
 * reading the request, and false of the preflight that decides whether the request is ever
 * made. Google's `access-control-allow-headers` lists exactly `content-type` and
 * `authorization`, so asking for a third header returned 403 and the browser reported only
 * a NetworkError, naming nothing.
 */
function isAnthropic(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith('anthropic.com')
  } catch {
    return false
  }
}

export async function askAi(baseUrl: string, apiKey: string, model: string, prompt: string, send: typeof fetch = fetch): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  let response: Response
  try {
    response = await send(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...(isAnthropic(baseUrl) ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (cause) {
    throw new AiError(`Could not reach ${baseUrl}: ${String(cause instanceof Error ? cause.message : cause)}`)
  }

  const body = await readJson(response)
  if (!response.ok) {
    const said = providerMessage(body)
    // 503 from these endpoints is nearly always a busy model rather than anything the User
    // has set wrong, and it is worth saying so — otherwise the obvious move is to go and
    // re-check a key that was never the problem.
    const hint = response.status === 503 ? ' The endpoint is busy — worth trying again shortly.' : ''
    throw new AiError(said ? `${said}${hint}` : `${baseUrl} answered ${response.status}.${hint}`)
  }

  const text = (body as ChatCompletionsResponse | undefined)?.choices?.[0]?.message?.content
  if (!text) throw new AiError(`${baseUrl} returned no text to draft from`)
  return text
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}
