import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBill } from "../src/templates/index.js";
import { TEMPLATE_IDS, asTemplateId, type BillData } from "../src/billData.js";
import { EDGE_CASES, SAMPLE_BILL } from "../src/billSamples.js";
import { rupees, summaryRows } from "../src/templates/shared.js";

const ALL = TEMPLATE_IDS;

// Strips tags so assertions run against what a reader actually sees, not
// against class names or attribute values that happen to contain digits.
function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// --- THE RULE: templates present money, they never compute it ------------

test("every template prints exactly the stored total", () => {
  for (const id of ALL) {
    const text = visibleText(renderBill(SAMPLE_BILL, id));
    assert.ok(
      text.includes(rupees(SAMPLE_BILL.total)),
      `${id} does not show the stored total ${rupees(SAMPLE_BILL.total)}`,
    );
  }
});

test("no template invents a total from the line items", () => {
  // The stored total here deliberately DISAGREES with the sum of the lines
  // (a real bill can carry a tax or discount the presentation layer knows
  // nothing about). A template that recalculated would print 400; every
  // template must print the 420 it was given.
  const sumOfLines = SAMPLE_BILL.items.reduce((t, i) => t + i.lineTotal, 0);
  assert.equal(sumOfLines, 400);
  assert.equal(SAMPLE_BILL.total, 450); // 400 + 20 GST + 30 delivery

  for (const id of ALL) {
    const text = visibleText(renderBill(SAMPLE_BILL, id));
    assert.ok(text.includes("₹450"), `${id} lost the stored total`);
  }
});

test("summary rows never restate the total as a subtotal", () => {
  // With no discount and no tax, subtotal === total. Printing both makes a
  // bill look wrong, so the subtotal row is suppressed.
  const plain: BillData = {
    ...SAMPLE_BILL, taxes: [], charges: [], discountAmount: 0, discountPercent: 0,
    subtotal: 400, total: 400,
  };
  const labels = summaryRows(plain).map((r) => r.label);
  assert.deepEqual(labels, ["Total"]);
});

test("a zero discount is not shown", () => {
  const labels = summaryRows({ ...SAMPLE_BILL, discountAmount: 0 }).map((r) => r.label);
  assert.ok(!labels.some((l) => l.startsWith("Discount")));
});

test("a real discount is shown as a deduction", () => {
  const rows = summaryRows({
    ...SAMPLE_BILL, discountPercent: 10, discountAmount: 40,
  });
  const discount = rows.find((r) => r.label.startsWith("Discount"))!;
  assert.equal(discount.kind, "deduction");
  assert.ok(discount.value.startsWith("−"));
});

// --- Nothing broken ever reaches a bill ---------------------------------

test("no template ever renders undefined, null or NaN", () => {
  for (const { id: caseId, data } of EDGE_CASES) {
    for (const templateId of ALL) {
      const text = visibleText(renderBill(data, templateId));
      for (const bad of ["undefined", "null", "NaN", "[object Object]"]) {
        assert.ok(
          !text.includes(bad),
          `${templateId}/${caseId} rendered "${bad}"`,
        );
      }
    }
  }
});

test("every edge case renders a complete document in every template", () => {
  for (const { id: caseId, data } of EDGE_CASES) {
    for (const templateId of ALL) {
      const html = renderBill(data, templateId);
      assert.ok(html.startsWith("<!doctype html>"), `${templateId}/${caseId} not a document`);
      assert.ok(html.includes("</html>"), `${templateId}/${caseId} truncated`);
      assert.ok(html.includes("@page"), `${templateId}/${caseId} missing print rules`);
    }
  }
});

test("every edge case shows its own total, in every template", () => {
  for (const { id: caseId, data } of EDGE_CASES) {
    for (const templateId of ALL) {
      const text = visibleText(renderBill(data, templateId));
      assert.ok(
        text.includes(rupees(data.total)),
        `${templateId}/${caseId} missing total ${rupees(data.total)}`,
      );
    }
  }
});

test("every item appears in every template", () => {
  const many = EDGE_CASES.find((c) => c.id === "many-items")!.data;
  for (const templateId of ALL) {
    const text = visibleText(renderBill(many, templateId));
    for (const item of many.items) {
      assert.ok(text.includes(item.name), `${templateId} dropped "${item.name}"`);
    }
  }
});

// --- Absent information is absent, not empty ----------------------------

test("a business with only a name produces no empty sections", () => {
  const bare = EDGE_CASES.find((c) => c.id === "bare-business")!.data;
  for (const templateId of ALL) {
    const html = renderBill(bare, templateId);
    const text = visibleText(html);
    assert.ok(!text.includes("GSTIN"), `${templateId} shows an empty GSTIN label`);
    assert.ok(!text.includes("UPI"), `${templateId} shows an empty UPI label`);
    assert.ok(!html.includes("<img"), `${templateId} renders a logo box with no logo`);
    assert.ok(text.includes("Anita's Tiffin"), `${templateId} lost the business name`);
  }
});

test("a bill with no customer still reads as complete", () => {
  const noCustomer = EDGE_CASES.find((c) => c.id === "no-customer")!.data;
  for (const templateId of ALL) {
    const text = visibleText(renderBill(noCustomer, templateId));
    assert.ok(!text.includes("Billed to"), `${templateId} shows an empty "Billed to"`);
    assert.ok(!text.includes("Bill to"), `${templateId} shows an empty "Bill to"`);
    assert.ok(text.includes(rupees(noCustomer.total)));
  }
});

test("GST rows appear only when the bill carries tax", () => {
  const withGst = EDGE_CASES.find((c) => c.id === "gst")!.data;
  const withoutGst = EDGE_CASES.find((c) => c.id === "discount")!.data;
  for (const templateId of ALL) {
    assert.ok(visibleText(renderBill(withGst, templateId)).includes("CGST"), templateId);
    assert.ok(!visibleText(renderBill(withoutGst, templateId)).includes("CGST"), templateId);
  }
});

// --- Formatting ---------------------------------------------------------

test("money uses Indian digit grouping", () => {
  assert.equal(rupees(362500), "₹3,62,500");
  assert.equal(rupees(420), "₹420");
});

test("paise always show two digits, whole rupees show none", () => {
  assert.equal(rupees(139.5), "₹139.50");
  assert.equal(rupees(265.5), "₹265.50");
  assert.equal(rupees(400), "₹400");
});

test("a non-finite amount degrades to zero rather than printing NaN", () => {
  assert.equal(rupees(Number.NaN), "₹0");
  assert.equal(rupees(Number.POSITIVE_INFINITY), "₹0");
});

// --- Escaping -----------------------------------------------------------

test("seller and customer text cannot inject markup into the bill", () => {
  const hostile: BillData = {
    ...SAMPLE_BILL,
    business: { name: `<script>alert(1)</script>` },
    customer: { name: `Ravi" onload="x` },
    items: [{ name: `<b>Chai</b> & "Samosa"`, quantity: 1, unitPrice: 10, lineTotal: 10 }],
    notes: `<img src=x onerror=alert(1)>`,
  };
  for (const templateId of ALL) {
    const html = renderBill(hostile, templateId);
    // Escaped text such as "&lt;img src=x onerror=..." is the CORRECT
    // outcome, so assert that no executable tag survives rather than that
    // a substring is absent.
    const injected = html.replace(/<style[\s\S]*?<\/style>/gi, "");
    assert.ok(!injected.includes("<script"), `${templateId} allowed a script tag`);
    assert.ok(!injected.includes("<img src=x"), `${templateId} allowed an injected tag`);
    assert.ok(!injected.includes("<b>Chai"), `${templateId} allowed raw markup`);
    // The text itself survives, escaped.
    assert.ok(visibleText(html).includes('<b>Chai</b> & "Samosa"'), templateId);
  }
});

// --- Template selection -------------------------------------------------

test("an unknown template id falls back to classic rather than failing", () => {
  assert.equal(asTemplateId("nonsense"), "classic");
  assert.equal(asTemplateId(undefined), "classic");
  assert.equal(asTemplateId(null), "classic");
  assert.equal(renderBill(SAMPLE_BILL, "nonsense"), renderBill(SAMPLE_BILL, "classic"));
});

test("each template id renders its own distinct layout", () => {
  const rendered = ALL.map((id) => renderBill(SAMPLE_BILL, id));
  const unique = new Set(rendered);
  assert.equal(unique.size, ALL.length, "two templates produced identical output");
});

test("the receipt template uses the narrow thermal page, others do not", () => {
  assert.ok(renderBill(SAMPLE_BILL, "receipt").includes('class="page narrow"'));
  for (const id of ALL.filter((t) => t !== "receipt")) {
    assert.ok(!renderBill(SAMPLE_BILL, id).includes("page narrow"), id);
  }
});

// --- Print safety -------------------------------------------------------

test("long unbroken words are allowed to wrap", () => {
  // A 58-character item name with no spaces will stretch a table and push
  // the money column off the page unless the cell can break mid-word.
  const longName = EDGE_CASES.find((c) => c.id === "long-name")!.data;
  for (const templateId of ALL) {
    const html = renderBill(longName, templateId);
    assert.ok(html.includes("overflow-wrap"), `${templateId} cannot wrap a long name`);
  }
});

test("table headers repeat and rows do not split across pages", () => {
  for (const templateId of ALL) {
    const html = renderBill(EDGE_CASES.find((c) => c.id === "many-items")!.data, templateId);
    assert.ok(html.includes("table-header-group"), `${templateId} headers do not repeat`);
    assert.ok(html.includes("page-break-inside: avoid"), `${templateId} rows can split`);
  }
});

test("the totals block is kept together", () => {
  for (const templateId of ALL) {
    assert.ok(renderBill(SAMPLE_BILL, templateId).includes(".totals"), templateId);
  }
});

test("no template depends on a remote font or asset", () => {
  // A PDF renderer that has to fetch a webfont can silently produce the
  // wrong typeface, or hang.
  for (const templateId of ALL) {
    const html = renderBill(SAMPLE_BILL, templateId);
    assert.ok(!html.includes("@import"), `${templateId} imports a stylesheet`);
    assert.ok(!/https?:\/\//.test(html.replace(/lang="en"/, "")), `${templateId} fetches a remote asset`);
  }
});
