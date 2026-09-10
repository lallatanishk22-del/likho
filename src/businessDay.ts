// What "today" means for a business.
//
// getTodaysSales computed midnight from the SERVER's local clock. That
// happens to be correct on a laptop in India and silently wrong the moment
// this runs on a UTC host: UTC midnight is 5:30am IST, so every bill from
// the first five and a half hours of the day would fall into "yesterday"
// and vanish from the seller's daily total.
//
// A seller's day is a fact about their business, not about where the
// process happens to be running.

const BUSINESS_TIMEZONE = process.env["LIKHO_TIMEZONE"] ?? "Asia/Kolkata";

// How far a wall-clock reading in `tz` sits from UTC at this instant.
// Derived from Intl rather than a hardcoded +5:30 so the same code is
// correct for a timezone that observes DST.
function timezoneOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .filter((p) => p.type !== "literal");

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asIfUtc - at.getTime();
}

// The instant the business's current day began.
export function startOfBusinessDay(now: Date = new Date(), tz: string = BUSINESS_TIMEZONE): Date {
  const offset = timezoneOffsetMs(now, tz);
  const shifted = new Date(now.getTime() + offset);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offset);
}

// True when `at` falls on the same business day as `now`.
export function isSameBusinessDay(
  at: Date,
  now: Date = new Date(),
  tz: string = BUSINESS_TIMEZONE,
): boolean {
  return at.getTime() >= startOfBusinessDay(now, tz).getTime();
}
