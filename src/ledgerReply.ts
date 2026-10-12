import type { Reply } from "./reply.js";
import { getLedger, type Ledger } from "./ledger.js";
import { renderLedger } from "./templates/ledger.js";
import { htmlToPdf, PdfUnavailableError } from "./billPdf.js";
import { loadBusinessProfile } from "./businessProfile.js";
import { parseDateRange, type DateRange } from "./businessDay.js";
import { formatRupees, titleCase } from "./chatFormat.js";
import { escapeHtml } from "./billText.js";

// The chat summary and the PDF are built from the SAME ledger, so the two
// can never show different figures for the same period.

export const LEDGER_PREFIX = "ledger:";

// Button data carries the period by its label ("September 2026", "This
// week"), which parseDateRange reads back; "c:<id>:" scopes it to one
// customer. Telegram caps this at 64 bytes, which a uuid plus any label fits.
export function ledgerAction(range: DateRange | null, customerId: string | null = null): string {
  return `${LEDGER_PREFIX}${customerId ? `c:${customerId}:` : ""}${range?.label ?? "All time"}`;
}

export function decodeLedgerAction(action: string): { range: DateRange | null; customerId: string | null } | null {
  if (!action.startsWith(LEDGER_PREFIX)) return null;
  let rest = action.slice(LEDGER_PREFIX.length);
  let customerId: string | null = null;
  const scoped = rest.match(/^c:([0-9a-f-]{36}):(.*)$/i);
  if (scoped) {
    customerId = scoped[1]!;
    rest = scoped[2]!;
  }
  return { range: rest === "All time" ? null : parseDateRange(rest), customerId };
}

export function summaryText(ledger: Ledger, who: string | null): string {
  const n = ledger.rows.length;
  const width = Math.max(...[ledger.billed, ledger.received, ledger.due].map((v) => formatRupees(v).length));
  const line = (label: string, v: number) => `${label.padEnd(9)}${formatRupees(v).padStart(width)}`;
  return (
    `<b>${escapeHtml(who ? `${who} · ${ledger.label}` : ledger.label)}</b> · ${n} bill${n === 1 ? "" : "s"}\n` +
    `<pre>${escapeHtml([line("Billed", ledger.billed), line("Received", ledger.received), line("Due", ledger.due)].join("\n"))}</pre>` +
    (ledger.unconfirmedCount > 0
      ? `\n${ledger.unconfirmedCount} not confirmed yet — marked “draft” in the ledger.`
      : "")
  );
}

export async function ledgerPdfReply(
  businessId: string,
  range: DateRange | null,
  customer: { id: string; name: string } | null = null,
): Promise<Reply> {
  const ledger = await getLedger(businessId, range, customer?.id ?? null);
  const who = customer ? titleCase(customer.name) : null;
  if (ledger.rows.length === 0) {
    return { text: `${who ? `${who} has` : "There are"} no bills${range ? ` in ${range.label.toLowerCase()}` : ""}.` };
  }
  const business = await loadBusinessProfile(businessId);
  try {
    const stem = `ledger-${who ?? "sales"}-${ledger.label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const path = await htmlToPdf(renderLedger(ledger, business.name, who), stem);
    return {
      text: "",
      document: {
        path,
        caption:
          `${who ? `${who} · ` : ""}${ledger.label} · ${ledger.rows.length} bill(s)\n` +
          `Billed ${formatRupees(ledger.billed)} · Received ${formatRupees(ledger.received)} · Due ${formatRupees(ledger.due)}`,
      },
    };
  } catch (err) {
    if (err instanceof PdfUnavailableError) {
      return { text: "I can't make the PDF on this machine right now. The summary above has the same figures." };
    }
    throw err;
  }
}
