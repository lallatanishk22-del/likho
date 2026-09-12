import type { Reply, ReplyAction } from "./reply.js";
import {
  findCustomer, findCustomerInMessage, loadCustomerHistory, listOutstanding,
  listCustomers, settleAllForCustomer, pendingSettlement, rememberCustomer,
} from "./customerStore.js";
import { loadBusinessProfile } from "./businessProfile.js";
import { toStatementData } from "./billRender.js";
import { renderStatement } from "./templates/statement.js";
import { htmlToPdf, PdfUnavailableError } from "./billPdf.js";
import { parseDateRange, stripDateExpressions } from "./businessDay.js";
import { formatRupees, titleCase, historyRow, alignedBlock } from "./chatFormat.js";
import { escapeHtml } from "./billText.js";
import { encodeMerge } from "./actionCodes.js";

// Everything about a PERSON rather than a bill: their history, what they
// owe, their statement, and settling their account.
//
// Split out of messageHandler.ts because it changes for its own reasons —
// a new way to ask "what does Ravi owe" has nothing to do with how an
// order is parsed, and they were sharing a 2,367-line file.
//
// One rule holds across all of it: READING HISTORY NEVER WRITES. Nothing
// here can create a customer, open a draft, or change a total. That is
// what makes a bare name safe to type.

export async function handleCustomerHistory(
  businessId: string,
  name: string,
  range?: { label: string; from: Date; to: Date } | null,
): Promise<Reply> {
  const customer = await findCustomer(businessId, name);
  if (!customer) {
    return {
      text:
        `I don't have anyone called "${name}" yet.\n\n` +
        `They'll appear here after their first bill. Send one like:\n  ${name} 2 chai`,
    };
  }

  await rememberCustomer(businessId, customer.id);

  const history = await loadCustomerHistory(businessId, customer, range);
  if (history.bills.length === 0) {
    return {
      text: range
        ? `${titleCase(customer.name)} has no bills ${range.label.toLowerCase() === "today" || range.label.toLowerCase() === "yesterday" ? range.label.toLowerCase() : `in ${range.label.toLowerCase()}`}.`
        : `${titleCase(customer.name)} has no bills yet.`,
    };
  }

  const rows = history.bills.map(historyRow);

  // Drafts are counted SEPARATELY and always shown. Previously the whole
  // summary was skipped when nothing was confirmed, so a customer with two
  // draft bills saw no total at all — the money was simply invisible.
  const draftBills = history.allBills.filter((b) => b.status !== "finalized");
  const draftTotal =
    Math.round(draftBills.reduce((sum, b) => sum + Number(b.total), 0) * 100) / 100;

  const billRows = rows.map((r) => ({ left: r.no, amount: r.amount, right: r.when + (r.mark ? `  ${r.mark}` : "") }));

  const summaryRows: { left: string; amount: string; right?: string }[] = [];
  if (history.billCount > 0) {
    summaryRows.push({
      left: `${history.billCount} bill${history.billCount === 1 ? "" : "s"}`,
      amount: formatRupees(history.lifetimeTotal),
    });
    if (history.outstanding > 0) {
      summaryRows.push({ left: "unpaid", amount: formatRupees(history.outstanding) });
    } else {
      summaryRows.push({ left: "all paid", amount: "" });
    }
  }
  if (draftBills.length > 0) {
    summaryRows.push({
      left: `${draftBills.length} draft${draftBills.length === 1 ? "" : "s"}`,
      amount: formatRupees(draftTotal),
      right: "not counted",
    });
  }

  // The bills align among themselves. The summary is right-aligned to the
  // block edge instead of sharing their columns: forcing "4 drafts" into
  // the bill-number column padded every row out and left a gully down the
  // middle of the list.
  const bills = alignedBlock(billRows);
  const width = Math.max(
    bills.width,
    ...summaryRows.map((r) => `${r.left}  ${r.amount}${r.right ? `  ${r.right}` : ""}`.length),
  );
  const summaryLines = summaryRows.map((r) => {
    const tail = r.right ? `  ${r.right}` : "";
    const pad = Math.max(1, width - r.left.length - r.amount.length - tail.length);
    return `${r.left}${" ".repeat(pad)}${r.amount}${tail}`;
  });

  const heading = range
    ? `${titleCase(customer.name).toUpperCase()}\n${range.label}`
    : titleCase(customer.name).toUpperCase();

  const block = [
    heading,
    "",
    ...bills.lines,
    "\u2500".repeat(Math.min(width, 34)),
    ...summaryLines.map((l) => l.trimEnd()),
  ].join("\n");

  const more = history.allBills.length > history.bills.length;

  return {
    text:
      `<pre>${escapeHtml(block)}</pre>` +
      (more ? `\nShowing the latest ${history.bills.length} of ${history.allBills.length}.` : ""),
    parseMode: "HTML" as const,
    // The most recent few, tappable — scrolling a chat to find a number and
    // then typing it back is work the buttons can do.
    actions: [
      ...history.bills.slice(0, 3).map((b) => ({
        label: `#${b.bill_no} · ${formatRupees(Number(b.total))}`,
        action: `open:${b.bill_no}`,
      })),
      { label: "📄 Statement PDF", action: `stmt:${customer.id}` },
    ],
  };
}

export async function handleOutstanding(businessId: string): Promise<Reply> {
  const owing = await listOutstanding(businessId);
  if (owing.length === 0) {
    return { text: "Nobody owes you anything. Every confirmed bill is paid." };
  }
  const total = owing.reduce((sum, o) => sum + o.outstanding, 0);
  const lines = owing
    .slice(0, 15)
    .map((o) => `${titleCase(o.name)}\n   ${formatRupees(o.outstanding)} · ${o.billCount} bill${o.billCount === 1 ? "" : "s"}`);
  return {
    text:
      `${formatRupees(Math.round(total * 100) / 100)} owed across ${owing.length} customer${owing.length === 1 ? "" : "s"}\n\n` +
      lines.join("\n") +
      (owing.length > 15 ? `\n\nShowing the top 15.` : ""),
  };
}

// Does this message name something the seller actually sells? Used to tell
// an unfinished order ("ravi paneer" — worth asking the quantity) from a
// message that was never an order at all ("dude bill of ria whole time").

// A customer's whole account as one PDF. Asked for as "lifetime bill of
// ria", "tanishk monthly", "ravi weekly statement".
//
// Every figure comes from stored bills — the same numbers the chat shows,
// because both read the same rows. A statement that disagreed with the
// bills it lists would be worse than no statement.
export async function handleStatement(
  businessId: string,
  name: string,
  range: { label: string; from: Date; to: Date } | null,
  onSlowWork?: () => Promise<void>,
): Promise<Reply> {
  await onSlowWork?.();

  const customer = await findCustomer(businessId, name);
  if (!customer) return { text: `I don't have anyone called "${name}" yet.` };

  await rememberCustomer(businessId, customer.id);

  const history = await loadCustomerHistory(businessId, customer, range, 1000);
  if (history.allBills.length === 0) {
    return {
      text: `${titleCase(customer.name)} has no bills${range ? ` in ${range.label.toLowerCase()}` : ""}.`,
    };
  }

  const business = await loadBusinessProfile(businessId);
  const data = await toStatementData(history, business, history.allBills);

  try {
    const path = await htmlToPdf(renderStatement(data), `statement-${customer.name}`);
    return {
      text: "",
      document: {
        path,
        caption:
          `${titleCase(customer.name)} · ${data.periodLabel}\n` +
          (data.billCount > 0
            ? `${data.billCount} bill(s) · ${formatRupees(data.grandTotal)} billed · ` +
              `${formatRupees(data.outstanding)} outstanding`
            : "No confirmed bills") +
          (data.draftCount > 0
            ? `\n${data.draftCount} draft(s) · ${formatRupees(data.draftTotal)} — not counted`
            : ""),
      },
    };
  } catch (err) {
    if (err instanceof PdfUnavailableError) {
      return { text: "I can't make PDFs on this machine — no Chrome found." };
    }
    throw err;
  }
}

// Settling a whole account. Money changing across several bills at once
// gets a tap first — the seller sees exactly which bills and how much
// before anything is written, the same as a price change or a merge.

export async function handleSettle(businessId: string, text: string): Promise<Reply> {
  const named = await findCustomerInMessage(businessId, stripDateExpressions(text));
  if (named === "ambiguous") {
    return { text: "That names more than one customer. Which one did you mean?" };
  }
  if (!named) {
    return {
      text:
        "Whose bills are settled?\n\nSay it with the name:\n  tanishk cleared all his dues",
    };
  }

  await rememberCustomer(businessId, named.id);

  const pending = await pendingSettlement(businessId, named);
  if (pending.billNos.length === 0) {
    // A draft cannot be paid, because it is not yet a transaction. Saying
    // only "nothing outstanding" reads as "there is nothing here" while
    // the seller is looking at unconfirmed bills worth real money.
    const history = await loadCustomerHistory(businessId, named, null, 1000);
    const drafts = history.allBills.filter((b) => b.status !== "finalized");
    if (drafts.length > 0) {
      const draftTotal =
        Math.round(drafts.reduce((t, b) => t + Number(b.total), 0) * 100) / 100;
      return {
        text:
          `${titleCase(named.name)} has nothing to settle — but ${drafts.length} bill` +
          `${drafts.length === 1 ? " is" : "s are"} still unconfirmed ` +
          `(${drafts.map((b) => `#${b.bill_no}`).join(", ")}, ${formatRupees(draftTotal)}).\n\n` +
          `A draft isn't a transaction yet, so it can't be paid. Confirm ` +
          `${drafts.length === 1 ? "it" : "them"} first, then mark ${drafts.length === 1 ? "it" : "them"} paid.`,
        actions: drafts.slice(0, 3).map((b) => ({
          label: `✅ Confirm #${b.bill_no}`,
          action: `confirm:${b.bill_no}`,
        })),
      };
    }
    return { text: `${titleCase(named.name)} has nothing outstanding — every confirmed bill is paid.` };
  }

  return {
    text:
      `${titleCase(named.name)} has ${pending.billNos.length} unpaid bill` +
      `${pending.billNos.length === 1 ? "" : "s"}: ` +
      `${pending.billNos.map((n) => `#${n}`).join(", ")}\n\n` +
      `Mark all of them paid? That records ${formatRupees(pending.amount)} received.`,
    actions: [{ label: `✅ Mark ${formatRupees(pending.amount)} paid`, action: `settle:${named.id}` }],
  };
}

// The price list, plus anything wrong with it.
//
// These checks only ever ran at /add time, so a list built up over weeks —
// a typo here, a bad parse there, the same item entered twice — was never
// looked at again. The problems just sat there printing onto customers'
// bills. Showing the list is the natural moment to surface them.
// "keep only cake", typed rather than tapped.
//
// The bot asked which of two names to keep, then could not understand the
// answer in words — "keep only cake" went to the ORDER parser and came
// back "Quantity for cake (1) isn't clearly supported". Asking a question
// you cannot hear the answer to is worse than not asking.
