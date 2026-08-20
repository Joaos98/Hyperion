import { documentEntryName, type ExportedRecord } from './export.js'
import {
  currentUserId,
  record,
  restoreDocument,
  saveAchievement,
  saveApplication,
  saveApplicationEvent,
  savePayment,
  savePosition,
  saveRecordedRate,
  saveRound,
  saveStandingTerms,
  saveUser,
} from './record.js'
import { readZip } from './zip.js'

export interface ImportSummary {
  positions: number
  standingTerms: number
  payments: number
  achievements: number
  applications: number
  applicationEvents: number
  rounds: number
  recordedRates: number
  documents: number
}

/**
 * Restores everything a `buildExport()` zip holds, through the ordinary write path
 * (`record.ts`'s own save* actions) so a restore can never write anything the app itself
 * wouldn't accept. Additive: every row writes by id (an upsert, matching `saveApplication`
 * and the rest), so importing onto existing data merges rather than replacing it, and
 * nothing is deleted — re-running the same import twice is harmless.
 *
 * Every row's ownership is rewritten to the signed-in User's own id rather than trusted from
 * the archive: an export usually gets imported into a *different* account than the one that
 * made it (a fresh self-hosted install, a new browser), and writing Position/Achievement/
 * Application/Document rows with someone else's userId is refused outright by the server's
 * own write-ownership check (server/server.ts). Positions keep their own id, though, so
 * Standing Terms and Payments — which reference a Position by id, not by owner — still
 * resolve correctly once the Position they belong to has been re-owned and written.
 */
export async function applyImport(bytes: Uint8Array): Promise<ImportSummary> {
  if (!record.user) throw new Error('Nothing to import into before signing in')

  const entries = await readZip(bytes)
  const dataEntry = entries.find((entry) => entry.name === 'data.json')
  if (!dataEntry) throw new Error('This zip has no data.json — is it a Hyperion export?')

  let data: ExportedRecord
  try {
    data = JSON.parse(new TextDecoder().decode(dataEntry.data)) as ExportedRecord
  } catch (cause) {
    throw new Error(`data.json in this zip could not be read: ${String(cause)}`)
  }

  const userId = currentUserId()
  const bytesByEntryName = new Map(entries.map((entry) => [entry.name, entry.data]))

  await saveUser({
    ...record.user,
    displayName: data.user.displayName,
    foldThresholdDays: data.user.foldThresholdDays,
    stallThresholdDays: data.user.stallThresholdDays,
    aiBaseUrl: data.user.aiBaseUrl,
    aiApiKey: data.user.aiApiKey,
    aiModel: data.user.aiModel,
    compensationDisplay: data.user.compensationDisplay,
    // An export written before Display Currency existed has no such field; `?? null` keeps
    // it derived rather than restoring `undefined` into a column that must hold a value.
    displayCurrency: data.user.displayCurrency ?? null,
  })

  for (const position of data.positions) await savePosition({ ...position, userId })
  for (const terms of data.standingTerms) await saveStandingTerms(terms)
  for (const payment of data.payments) await savePayment(payment)
  for (const document of data.documents) {
    const documentBytes = bytesByEntryName.get(documentEntryName(document.id, document.filename))
    if (documentBytes) await restoreDocument({ ...document, userId }, documentBytes)
  }
  for (const achievement of data.achievements) await saveAchievement({ ...achievement, userId })
  for (const application of data.applications) await saveApplication({ ...application, userId })
  for (const event of data.applicationEvents) await saveApplicationEvent(event)
  for (const round of data.rounds) await saveRound(round)
  // Exports written before Recorded Rates existed simply have no such key — an older
  // archive restores as the record it was, rather than failing on a field it predates.
  for (const rate of data.recordedRates ?? []) await saveRecordedRate({ ...rate, userId })

  return {
    positions: data.positions.length,
    standingTerms: data.standingTerms.length,
    payments: data.payments.length,
    achievements: data.achievements.length,
    applications: data.applications.length,
    applicationEvents: data.applicationEvents.length,
    rounds: data.rounds.length,
    recordedRates: (data.recordedRates ?? []).length,
    documents: data.documents.length,
  }
}
