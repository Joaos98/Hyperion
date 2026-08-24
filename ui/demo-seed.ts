import { mintId, type Currency, type Position, type StandingTerms, type UserId } from '../domain/index.js'
import type { HyperionStore } from '../storage/port.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }
const USD: Currency = { code: 'USD', symbol: '$', decimals: 2 }

/**
 * A fictional career in a foreign currency, deliberately not the real user's own — the demo
 * is a fictional persona in a foreign market. `contract` stands
 * in for Employment Type throughout — `clt`/`pj` are Brazil-specific and would read as a
 * visible error next to a European company (CONTEXT.md § Employment Type).
 *
 * The career **crosses a currency** on purpose: the first Position pays in USD and every
 * one after it in EUR. Without a crossing somewhere, currency conversion is invisible in
 * the published demo, and it is the least ordinary thing the
 * app does. One crossing out of two job changes is what puts every state of that feature
 * on screen at once: the average Switch Premium still computes, from the EUR→EUR change,
 * and says how many switches it had to leave out; the USD→EUR change below it carries the
 * prompt asking for the rate that would let it be answered.
 *
 * No Recorded Rate is seeded, and that is the point rather than an omission. Hyperion
 * fetches no rates and invents none, and seeding one would have Hyperion invent a rate on
 * a fictional person's behalf — the same act the app refuses on a real one's. A visitor
 * types one in and watches the figure resolve, which demonstrates the design better than
 * arriving at a finished number would.
 *
 * Written through the same `store.write*`/`createUser` calls any real use of the app
 * already makes, so the seed can never drift from what the app actually accepts.
 */
export async function seedDemo(store: HyperionStore, userId: UserId): Promise<void> {
  await store.createUser({
    id: userId,
    displayName: 'John Doe',
    isAdmin: true,
    foldThresholdDays: 90,
    stallThresholdDays: 21,
    aiBaseUrl: null,
    aiApiKey: null,
    aiModel: null,
    compensationDisplay: 'annual',
    displayCurrency: null,
  })

  const fenwickId = mintId()
  const fenwick: Position = {
    id: fenwickId,
    userId,
    company: 'Fenwick Digital',
    currency: USD,
    startDate: '2016-06-01',
    // The reason a reader will want years later is exactly the one that explains why every
    // figure below this line is in a different currency (CONTEXT.md § Departure).
    departure: { date: '2018-05-31', reason: 'resigned — relocating to Europe' },
  }
  await store.writePosition(fenwick)
  await writeTerms(store, fenwickId, '2016-06-01', 'Junior Backend Engineer', 45_000_00, 0)

  const nordwerkId = mintId()
  const nordwerk: Position = {
    id: nordwerkId,
    userId,
    company: 'Nordwerk',
    currency: EUR,
    startDate: '2018-08-01',
    departure: { date: '2021-03-31', reason: 'resigned' },
  }
  await store.writePosition(nordwerk)
  await writeTerms(store, nordwerkId, '2018-08-01', 'Backend Engineer', 52_000_00, 0)
  await writeTerms(store, nordwerkId, '2020-01-01', 'Backend Engineer', 58_000_00, 0)

  await store.writeAchievement({
    id: mintId(),
    userId,
    positionId: nordwerkId,
    date: '2019-11-10',
    text: 'Rebuilt the nightly settlement job after it started missing its window — down from 90 minutes to under 6.',
    impact: 'Nightly run: 90min → 6min',
  })

  const kestrelId = mintId()
  const kestrel: Position = {
    id: kestrelId,
    userId,
    company: 'Kestrel Systems',
    currency: EUR,
    startDate: '2021-07-01',
    departure: null,
  }
  await store.writePosition(kestrel)
  await writeTerms(store, kestrelId, '2021-07-01', 'Backend Engineer', 71_000_00, 0)
  await writeTerms(store, kestrelId, '2023-05-01', 'Senior Backend Engineer', 82_000_00, 6_000_00)
  await writeTerms(store, kestrelId, '2025-06-01', 'Senior Backend Engineer', 91_500_00, 9_000_00)

  await store.writePayment({
    id: mintId(),
    positionId: kestrelId,
    date: '2021-07-01',
    amountMinor: 3_000_00,
    label: 'Signing bonus',
  })

  await store.writeAchievement({
    id: mintId(),
    userId,
    positionId: kestrelId,
    date: '2022-02-14',
    text: 'Led the migration off the old queue system onto Kafka, with zero downtime during cutover.',
    impact: null,
  })
  await store.writeAchievement({
    id: mintId(),
    userId,
    positionId: kestrelId,
    date: '2023-09-01',
    text: 'Mentored two new hires through their first two quarters — both are shipping independently now.',
    impact: null,
  })
  await store.writeAchievement({
    id: mintId(),
    userId,
    positionId: kestrelId,
    date: '2025-11-20',
    text: 'Traced and fixed a connection-pool bottleneck nobody had found before, cutting p99 API latency by a third.',
    impact: 'p99 latency: -33%',
  })

  const applicationId = mintId()
  await store.writeApplication({
    id: applicationId,
    userId,
    company: 'Anchor Labs',
    title: 'Staff Backend Engineer',
    source: 'Referral',
    postingUrl: null,
    advertisedRange: null,
    offeredTerms: null,
    documentId: null,
    priorApplicationId: null,
  })
  await store.writeApplicationEvent({ id: mintId(), applicationId, stage: 'saved', date: '2026-07-10', note: null })
  await store.writeApplicationEvent({ id: mintId(), applicationId, stage: 'applied', date: '2026-07-14', note: null })
  await store.writeApplicationEvent({ id: mintId(), applicationId, stage: 'interview', date: '2026-08-05', note: null })

  /**
   * One Application that has gone quiet, so Stall detection is actually visible: with only
   * the Anchor Labs one above — answered within the last three weeks — "Needs attention" on
   * the Applications page never appears, and the feature is invisible in the published demo
   * for the same reason currency conversion was before the career crossed a border.
   *
   * Silence is the ordinary case in a job search rather than a failure, which is why it
   * reaches an Open Stage and simply stops rather than being Rejected.
   */
  const quietId = mintId()
  await store.writeApplication({
    id: quietId,
    userId,
    company: 'Halden Systems',
    title: 'Senior Backend Engineer',
    source: 'Job board',
    postingUrl: null,
    advertisedRange: null,
    offeredTerms: null,
    documentId: null,
    priorApplicationId: null,
  })
  await store.writeApplicationEvent({ id: mintId(), applicationId: quietId, stage: 'saved', date: '2026-06-02', note: null })
  await store.writeApplicationEvent({ id: mintId(), applicationId: quietId, stage: 'applied', date: '2026-06-08', note: null })
  await store.writeApplicationEvent({
    id: mintId(),
    applicationId: quietId,
    stage: 'screen',
    date: '2026-06-19',
    note: 'Recruiter call, said they would come back with next steps.',
  })
}

function writeTerms(
  store: HyperionStore,
  positionId: string,
  effectiveDate: string,
  title: string,
  baseSalaryMinor: number,
  targetBonusMinor: number,
): Promise<void> {
  const terms: StandingTerms = {
    id: mintId(),
    positionId,
    effectiveDate,
    title,
    employmentType: 'contract',
    baseSalaryMinor,
    targetBonusMinor,
  }
  return store.writeStandingTerms(terms)
}
