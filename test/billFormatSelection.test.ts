import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeTemplate, decodeTemplate } from "../src/messageHandler.js";
import { classifyIntent } from "../src/intent.js";
import { TEMPLATE_IDS, TEMPLATE_LABELS, asTemplateId } from "../src/billData.js";

// --- Choosing a style ----------------------------------------------------

test("every template id round-trips through a button", () => {
  for (const id of TEMPLATE_IDS) {
    assert.equal(decodeTemplate(encodeTemplate(id)), id);
  }
});

test("an unknown template id is refused, never applied", () => {
  assert.equal(decodeTemplate("tpl:nonsense"), null);
  assert.equal(decodeTemplate("tpl:"), null);
});

test("other actions are not decoded as a template choice", () => {
  assert.equal(decodeTemplate("confirm:1042"), null);
  assert.equal(decodeTemplate("merge:panner"), null);
  assert.equal(decodeTemplate("fix:ab"), null);
});

test("every template has a name and an audience", () => {
  for (const id of TEMPLATE_IDS) {
    assert.ok(TEMPLATE_LABELS[id].name.length > 0, id);
    assert.ok(TEMPLATE_LABELS[id].forWho.length > 0, id);
  }
});

test("a business that has never chosen falls back to classic", () => {
  assert.equal(asTemplateId(null), "classic");
  assert.equal(asTemplateId(""), "classic");
});

// --- Asking for it in chat ----------------------------------------------

test("'bill format' opens the style picker", () => {
  assert.equal(classifyIntent("bill format").name, "bill_format");
});

test("the other words a seller might use all work", () => {
  for (const phrase of ["format", "bill template", "bill style", "change bill design", "templates"]) {
    assert.equal(classifyIntent(phrase).name, "bill_format", phrase);
  }
});

test("'bill format' is not read as a request to export a PDF", () => {
  // "invoice"/"print"/"pdf" route to export; the style picker must win when
  // the seller is asking how the bill LOOKS.
  assert.equal(classifyIntent("invoice format").name, "bill_format");
  assert.equal(classifyIntent("make pdf").name, "pdf");
});

test("'bill format' is not read as an order", () => {
  assert.notEqual(classifyIntent("bill format").name, "order");
});

test("shop details open the business info screen", () => {
  assert.equal(classifyIntent("shop").name, "business_info");
  const withField = classifyIntent("shop phone 9820041122");
  assert.equal(withField.name, "business_info");
  assert.equal(withField.text, "phone 9820041122");
});

test("an order that merely mentions a shop is still an order", () => {
  assert.equal(classifyIntent("2 paneer 3 samosa").name, "order");
});
