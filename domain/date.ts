/** An ISO calendar date, `YYYY-MM-DD`, and the only date shape the domain uses. */
export type IsoDate = string

/** Whole days between two ISO dates, positive when `to` is after `from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** `from` and `to` as full calendar years and whole months, the way tenure is spoken. */
export function elapsed(from: IsoDate, to: IsoDate): { years: number; months: number } {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]

  let months = (ty - fy) * 12 + (tm - fm)
  if (td < fd) months -= 1
  if (months < 0) months = 0

  return { years: Math.floor(months / 12), months: months % 12 }
}

/** True when `date` falls within `[start, end)` — `end` exclusive, absent meaning open. */
export function within(date: IsoDate, start: IsoDate, end: IsoDate | undefined): boolean {
  if (date < start) return false
  return end === undefined || date < end
}

/** The calendar year an ISO date falls in, as a number. */
export function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4))
}
