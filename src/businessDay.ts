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

// --- Display -------------------------------------------------------------
// Every timestamp shown to a seller is rendered in the BUSINESS's timezone,
// never the server's. A bill that says "10 Sep, 9:03 am" must mean 9:03am
// where the shop is, regardless of where this process runs.

export function formatBusinessDateTime(at: Date, tz: string = BUSINESS_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}

export function formatBusinessDate(at: Date, tz: string = BUSINESS_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(at);
}

// --- Date ranges for reporting ------------------------------------------

export interface DateRange {
  label: string;
  from: Date;
  // Exclusive upper bound.
  to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function addDays(start: Date, days: number, tz: string): Date {
  // Re-derives the day boundary after shifting, so a DST transition inside
  // the range cannot slide the window by an hour.
  return startOfBusinessDay(new Date(start.getTime() + days * DAY_MS + DAY_MS / 2), tz);
}

function dayRange(start: Date, label: string, tz: string): DateRange {
  return { label, from: start, to: addDays(start, 1, tz) };
}

// Reads the reporting period out of a seller's own words. Returns null when
// no period is mentioned, so the caller can default to today.
export function parseDateRange(
  text: string,
  now: Date = new Date(),
  tz: string = BUSINESS_TIMEZONE,
): DateRange | null {
  const lower = text.toLowerCase();
  const todayStart = startOfBusinessDay(now, tz);

  if (/\b(yesterday|kal\b)/.test(lower)) {
    return dayRange(addDays(todayStart, -1, tz), "Yesterday", tz);
  }
  if (/\b(today|aaj)\b/.test(lower)) {
    return dayRange(todayStart, "Today", tz);
  }
  if (
    /\b(this|last|past|is|pichle)\s+(week|hafte|hafta)\b/.test(lower) ||
    /\bweekly\b/.test(lower) ||
    /\blast\s+7\s+days\b/.test(lower)
  ) {
    return { label: "Last 7 days", from: addDays(todayStart, -6, tz), to: addDays(todayStart, 1, tz) };
  }
  if (/\b(this|is)\s+(month|mahine|mahina)\b/.test(lower) || /\bmonthly\b/.test(lower)) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now).split("-");
    const dayOfMonth = Number(parts[2]);
    return {
      label: "This month",
      from: addDays(todayStart, -(dayOfMonth - 1), tz),
      to: addDays(todayStart, 1, tz),
    };
  }
  if (/\blast\s+month\b/.test(lower)) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now).split("-");
    const dayOfMonth = Number(parts[2]);
    const firstOfThisMonth = addDays(todayStart, -(dayOfMonth - 1), tz);
    // Step back one day to land inside the previous month, then to its first.
    const lastOfPrev = addDays(firstOfThisMonth, -1, tz);
    const prevParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(lastOfPrev).split("-");
    const firstOfPrev = addDays(lastOfPrev, -(Number(prevParts[2]) - 1), tz);
    return { label: "Last month", from: firstOfPrev, to: firstOfThisMonth };
  }

  // An explicit day: "8 sep", "sep 8", "8/9", "8-9-2026".
  const explicit =
    lower.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]{3,})\b/) ??
    lower.match(/\b([a-z]{3,})\s+(\d{1,2})\s*(?:st|nd|rd|th)?\b/);
  if (explicit) {
    const a = explicit[1]!;
    const b = explicit[2]!;
    const dayStr = /^\d+$/.test(a) ? a : b;
    const monthStr = /^\d+$/.test(a) ? b : a;
    const month = MONTHS.indexOf(monthStr.slice(0, 3));
    const day = Number(dayStr);
    if (month >= 0 && day >= 1 && day <= 31) {
      const year = Number(
        new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(now),
      );
      const start = startOfBusinessDay(new Date(Date.UTC(year, month, day, 12)), tz);
      // A date later in the year than today means the seller meant last year.
      const resolved = start.getTime() > now.getTime() ? startOfBusinessDay(new Date(Date.UTC(year - 1, month, day, 12)), tz) : start;
      return dayRange(resolved, formatBusinessDate(resolved, tz), tz);
    }
  }

  const numeric = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const rawYear = numeric[3] ? Number(numeric[3]) : null;
    const year = rawYear === null
      ? Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(now))
      : rawYear < 100 ? 2000 + rawYear : rawYear;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const start = startOfBusinessDay(new Date(Date.UTC(year, month, day, 12)), tz);
      return dayRange(start, formatBusinessDate(start, tz), tz);
    }
  }

  return null;
}

// Removes date expressions from a message, so the rest can be judged on its
// own. Needed because a date contains digits ("10 sept", "8/9") and a digit
// is otherwise the signal that a message is an ORDER carrying a quantity.
//
// Stripping the date first means "tanishk bills 10 sept" is understood as a
// name plus a date, while "ria 2 chai today" keeps its 2 and stays an order.
// The digit rule is not relaxed — the date simply stops counting as one.
export function stripDateExpressions(text: string): string {
  return text
    .replace(/\b\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*\d{2,4})?\b/gi, " ")
    .replace(
      /\b\d{1,2}\s*(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi,
      " ",
    )
    .replace(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\s*(?:st|nd|rd|th)?\b/gi,
      " ",
    )
    .replace(/\blast\s+\d+\s+days?\b/gi, " ")
    .replace(/\b(yesterday|today|tomorrow|kal|aaj)\b/gi, " ")
    .replace(/\b(this|last|past|pichle)\s+(week|month|year|hafte|hafta|mahine|mahina)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
