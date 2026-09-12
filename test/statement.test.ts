import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatement } from "../src/templates/statement.js";
import { parseDateRange } from "../src/businessDay.js";
import type { StatementData } from "../src/statementData.js";

const IST = "Asia/Kolkata";
const NOW = new Date("2026-09-12T09:30:00Z");

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

const STATEMENT: StatementData = {
  business: { name: "Shree Snacks", upiId: "shree@okaxis" },
  customerName: "Ria Bhanushali",
  periodLabel: "All time",
  generatedLabel: "12 Sept 2026, 3:45 pm",
  lines: [
    { billNo: 1003, dateLabel: "12 Sept 2026", timeLabel: "3:44 pm", total: 45,
      amountPaid: 0, paymentStatus: "pending", confirmed: true, itemSummary: "chai × 3" },
    { billNo: 1002, dateLabel: "12 Sept 2026", timeLabel: "3:44 pm", total: 80,
      amountPaid: 80, paymentStatus: "paid", confirmed: true, itemSummary: "samosa × 4" },
    { billNo: 1001, dateLabel: "12 Sept 2026", timeLabel: "3:44 pm", total: 455,
      amountPaid: 0, paymentStatus: "pending", confirmed: true, itemSummary: "paneer × 2" },
    // A draft: shown for completeness, excluded from every figure.
    { billNo: 1000, dateLabel: "11 Sept 2026", timeLabel: "7:02 pm", total: 260,
      amountPaid: 0, paymentStatus: "pending", confirmed: false, itemSummary: "paneer × 1" },
  ],
  billCount: 3,
  draftCount: 1,
  draftTotal: 260,
  grandTotal: 580,
  paidTotal: 80,
  outstanding: 500,
};

// --- A statement must agree with the bills it lists ---------------------
// This is the document a seller shows a customer during a disagreement
// about money, so every figure is copied from stored bills and none is
// derived on the page.

test("the totals are the ones supplied, not recomputed from the rows", () => {
  const text = visibleText(renderStatement(STATEMENT));
  assert.ok(text.includes("₹580"), "billed total missing");
  assert.ok(text.includes("₹80"), "received total missing");
  assert.ok(text.includes("₹500"), "outstanding missing");
});

test("a draft is listed but never counted", () => {
  const text = visibleText(renderStatement(STATEMENT));
  // The row is visible...
  assert.ok(text.includes("#1000"), "draft row is missing");
  assert.ok(text.includes("Draft"), "draft is not labelled");
  // ...and the sum that INCLUDES it never appears.
  assert.ok(!text.includes("₹840"), "a draft was counted into the total");
  assert.ok(text.includes("3 confirmed bills"), "draft was counted in the bill count");
});

test("outstanding is stated plainly, since it is why the page exists", () => {
  const text = visibleText(renderStatement(STATEMENT));
  assert.ok(text.includes("Outstanding"));
  assert.ok(text.includes("₹500"));
});

test("every bill on the account appears", () => {
  const text = visibleText(renderStatement(STATEMENT));
  for (const line of STATEMENT.lines) {
    assert.ok(text.includes(`#${line.billNo}`), `bill ${line.billNo} missing`);
  }
});

test("the period is stated, so the page cannot be misread as all-time", () => {
  const monthly = visibleText(renderStatement({ ...STATEMENT, periodLabel: "This month" }));
  assert.ok(monthly.includes("This month"));
});

test("payment state is legible per row", () => {
  const text = visibleText(renderStatement(STATEMENT));
  assert.ok(text.includes("Paid"));
  assert.ok(text.includes("Unpaid"));
});

test("nothing broken reaches the page", () => {
  for (const data of [
    STATEMENT,
    { ...STATEMENT, lines: [], billCount: 0, draftCount: 0, draftTotal: 0,
      grandTotal: 0, paidTotal: 0, outstanding: 0 },
    { ...STATEMENT, business: { name: "Anita's Tiffin" } },
  ] as StatementData[]) {
    const text = visibleText(renderStatement(data));
    for (const bad of ["undefined", "null", "NaN", "[object Object]"]) {
      assert.ok(!text.includes(bad), `rendered "${bad}"`);
    }
  }
});

test("a business with only a name shows no empty UPI or GSTIN", () => {
  const text = visibleText(renderStatement({
    ...STATEMENT, business: { name: "Anita's Tiffin" },
  }));
  assert.ok(!text.includes("UPI"));
  assert.ok(!text.includes("GSTIN"));
  assert.ok(text.includes("Anita's Tiffin"));
});

test("customer text cannot inject markup", () => {
  const html = renderStatement({
    ...STATEMENT,
    customerName: `<script>alert(1)</script>`,
    lines: [{ ...STATEMENT.lines[0]!, itemSummary: `<b>chai</b>` }],
  });
  assert.ok(!html.replace(/<style[\s\S]*?<\/style>/gi, "").includes("<script"));
  assert.ok(!html.replace(/<style[\s\S]*?<\/style>/gi, "").includes("<b>chai"));
});

test("it is a complete, printable document", () => {
  const html = renderStatement(STATEMENT);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("@page"));
  assert.ok(html.includes("table-header-group"), "headers must repeat across pages");
});

// --- Asking for a period -------------------------------------------------

test("'monthly' and 'weekly' resolve, not just 'this month'", () => {
  // "ria monthly bill" produced a statement labelled "All time" before.
  assert.equal(parseDateRange("ria monthly bill", NOW, IST)?.label, "This month");
  assert.equal(parseDateRange("ria weekly bill", NOW, IST)?.label, "Last 7 days");
});

test("'lifetime' means no period at all", () => {
  assert.equal(parseDateRange("ria lifetime bill", NOW, IST), null);
});


// --- A statement of nothing but drafts must not read as "Rs 0" ----------
// Reported: two draft bills worth Rs 1,730 listed above a Total of Rs 0.
// Correct, and it looks broken.

test("drafts are reported even when nothing is confirmed", () => {
  const draftsOnly: StatementData = {
    ...STATEMENT,
    lines: [
      { billNo: 1009, dateLabel: "10 Sept 2026", timeLabel: "3:26 pm", total: 400,
        amountPaid: 0, paymentStatus: "pending", confirmed: false, itemSummary: "panner × 2" },
      { billNo: 1008, dateLabel: "10 Sept 2026", timeLabel: "3:18 pm", total: 1330,
        amountPaid: 0, paymentStatus: "pending", confirmed: false, itemSummary: "mudpie × 3" },
    ],
    billCount: 0, draftCount: 2, draftTotal: 1730,
    grandTotal: 0, paidTotal: 0, outstanding: 0,
  };
  const text = visibleText(renderStatement(draftsOnly));
  assert.ok(text.includes("2 drafts"), "the draft count is not stated");
  assert.ok(text.includes("₹1,730"), "the draft total is not stated anywhere");
  assert.ok(text.includes("not a transaction"), "it does not explain why they are excluded");
  // ...and they are still excluded from the counted totals.
  assert.ok(text.includes("0 confirmed bills"));
});

test("a statement with no drafts says so plainly", () => {
  const clean: StatementData = {
    ...STATEMENT,
    lines: STATEMENT.lines.filter((l) => l.confirmed),
    draftCount: 0, draftTotal: 0,
  };
  const text = visibleText(renderStatement(clean));
  assert.ok(text.includes("Every bill above is confirmed"));
  assert.ok(!text.includes("not counted"));
});
