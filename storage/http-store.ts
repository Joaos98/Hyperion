import {
  bytesToBase64,
  type Achievement,
  type AchievementId,
  type Application,
  type ApplicationEvent,
  type ApplicationEventId,
  type ApplicationId,
  type DocumentId,
  type DocumentMeta,
  type Payment,
  type PaymentId,
  type Position,
  type PositionId,
  type Round,
  type RoundId,
  type StandingTerms,
  type StandingTermsId,
  type User,
  type UserId,
} from '../domain/index.js'
import { StorageError, type HyperionStore, type UserRecord } from './port.js'

/**
 * Talks to the self-hosted server, which stores rows and knows nothing else. The port is
 * expressed in what a User does, not in HTTP, so this is the only place in Hyperion's
 * client where a request exists at all — the engine above it never learns there is a
 * server (storage/http-store.ts in Prometheus, the same shape).
 *
 * The server refuses in the port's own terms and this hands the refusal on unchanged, so
 * a User reads the same sentence whichever build they are on.
 */
export function httpStore(base: string, send: typeof fetch = fetch): HyperionStore {
  const at = (path: string): string => `${base.replace(/\/$/, '')}${path}`

  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const request: RequestInit = { method }
    if (body !== undefined) {
      request.headers = { 'content-type': 'application/json' }
      request.body = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await send(at(path), request)
    } catch (cause) {
      throw new StorageError(`Hyperion could not be reached: ${String(cause)}`)
    }
    const answer = response.status === 204 ? undefined : await readJson(response)
    if (!response.ok) throw new StorageError(refusalIn(answer, response))
    return answer
  }

  return {
    async loadUserRecord(userId: UserId): Promise<UserRecord | undefined> {
      const answer = (await call('GET', '/record')) as { record: UserRecord | null }
      // The server always answers as whoever the Session cookie resolves to, never as
      // whatever `userId` the caller asks for — identity lives at the boundary, and the
      // boundary trusts the cookie, not this argument.
      void userId
      return answer.record ?? undefined
    },

    async createUser(): Promise<void> {
      throw new StorageError('Hyperion creates Users through /api/setup and /api/register, not this port — see ui/auth.ts')
    },

    async writeUser(user: User): Promise<void> {
      await call('PUT', '/user', { user })
    },

    async writePosition(position: Position): Promise<void> {
      await call('PUT', `/positions/${encodeURIComponent(position.id)}`, { position })
    },

    async deletePosition(_userId: UserId, positionId: PositionId): Promise<void> {
      await call('DELETE', `/positions/${encodeURIComponent(positionId)}`)
    },

    async writeStandingTerms(standingTerms: StandingTerms): Promise<void> {
      await call('PUT', `/standing-terms/${encodeURIComponent(standingTerms.id)}`, { standingTerms })
    },

    async deleteStandingTerms(_userId: UserId, id: StandingTermsId): Promise<void> {
      await call('DELETE', `/standing-terms/${encodeURIComponent(id)}`)
    },

    async writePayment(payment: Payment): Promise<void> {
      await call('PUT', `/payments/${encodeURIComponent(payment.id)}`, { payment })
    },

    async deletePayment(_userId: UserId, id: PaymentId): Promise<void> {
      await call('DELETE', `/payments/${encodeURIComponent(id)}`)
    },

    async writeAchievement(achievement: Achievement): Promise<void> {
      await call('PUT', `/achievements/${encodeURIComponent(achievement.id)}`, { achievement })
    },

    async deleteAchievement(_userId: UserId, id: AchievementId): Promise<void> {
      await call('DELETE', `/achievements/${encodeURIComponent(id)}`)
    },

    async writeApplication(application: Application): Promise<void> {
      await call('PUT', `/applications/${encodeURIComponent(application.id)}`, { application })
    },

    async deleteApplication(_userId: UserId, id: ApplicationId): Promise<void> {
      await call('DELETE', `/applications/${encodeURIComponent(id)}`)
    },

    async writeApplicationEvent(event: ApplicationEvent): Promise<void> {
      await call('PUT', `/application-events/${encodeURIComponent(event.id)}`, { event })
    },

    async deleteApplicationEvent(_userId: UserId, id: ApplicationEventId): Promise<void> {
      await call('DELETE', `/application-events/${encodeURIComponent(id)}`)
    },

    async writeRound(round: Round): Promise<void> {
      await call('PUT', `/rounds/${encodeURIComponent(round.id)}`, { round })
    },

    async deleteRound(_userId: UserId, id: RoundId): Promise<void> {
      await call('DELETE', `/rounds/${encodeURIComponent(id)}`)
    },

    async writeDocument(meta: DocumentMeta, bytes: Uint8Array): Promise<void> {
      await call('PUT', `/documents/${encodeURIComponent(meta.id)}`, { document: meta, bytesBase64: bytesToBase64(bytes) })
    },

    // Raw bytes over the wire rather than JSON-and-base64: a Document can run to several
    // hundred KB, and there is no reason to pay base64's third-again size for a read when
    // the write path already carries the one-time cost of getting it into the database.
    async readDocumentBytes(_userId: UserId, id: DocumentId): Promise<Uint8Array | undefined> {
      let response: Response
      try {
        response = await send(at(`/documents/${encodeURIComponent(id)}/bytes`))
      } catch (cause) {
        throw new StorageError(`Hyperion could not be reached: ${String(cause)}`)
      }
      if (response.status === 404) return undefined
      if (!response.ok) throw new StorageError(refusalIn(await readJson(response), response))
      return new Uint8Array(await response.arrayBuffer())
    },

    async deleteDocument(_userId: UserId, id: DocumentId): Promise<void> {
      await call('DELETE', `/documents/${encodeURIComponent(id)}`)
    },
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function refusalIn(answer: unknown, response: Response): string {
  if (answer && typeof answer === 'object' && 'error' in answer) return String((answer as { error: unknown }).error)
  return `Hyperion answered ${response.status}`
}
