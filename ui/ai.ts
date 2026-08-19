/** Raised when the AI layer cannot answer — a bad key, a network failure, a refusal. */
export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5'

interface MessagesResponse {
  content?: { type: string; text?: string }[]
  error?: { message?: string }
}

/**
 * Sends a self-assessment prompt straight from the browser to Anthropic, using the
 * User's own key. Direct rather than proxied through the server: the key already lives
 * only in this User's own record (`ui/store.ts`'s `saveUser`), so routing the call
 * through the server would mean sending it over the wire a second time for no benefit —
 * and it keeps the demo build (no server at all) and the self-hosted build behaving
 * identically, the same reason the domain engine itself runs in the browser in both.
 *
 * `anthropic-dangerous-direct-browser-access` is Anthropic's own supported header for
 * exactly this shape of app: a personal tool, on hardware the User controls, calling out
 * with a key only they hold. The name is a warning about the general case — a public web
 * app exposing a shared key to every visitor — which does not describe Hyperion.
 */
export async function generateSelfAssessment(
  apiKey: string,
  prompt: string,
  send: typeof fetch = fetch,
): Promise<string> {
  let response: Response
  try {
    response = await send(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (cause) {
    throw new AiError(`Could not reach Anthropic: ${String(cause instanceof Error ? cause.message : cause)}`)
  }

  const body = (await readJson(response)) as MessagesResponse | undefined
  if (!response.ok) {
    throw new AiError(body?.error?.message ?? `Anthropic answered ${response.status}`)
  }

  const text = body?.content?.find((block) => block.type === 'text')?.text
  if (!text) throw new AiError('Anthropic returned no text to draft from')
  return text
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}
