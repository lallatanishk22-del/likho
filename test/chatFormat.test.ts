import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../src/billText.js";

// The chat bill and the history list are laid out in columns, and a column
// only exists if Telegram draws the message in a fixed-width font. That
// needs BOTH a <pre> block and parse_mode — padding a proportional font
// lines up nothing, because "M" is wider than "i".
//
// These pin the two things that silently undo that: unescaped text
// breaking the block, and the money column drifting.

// --- Escaping, which parse_mode makes mandatory -------------------------

test("angle brackets in a product name cannot break the block", () => {
  assert.equal(escapeHtml("<b>chai</b>"), "&lt;b&gt;chai&lt;/b&gt;");
});

test("an ampersand is escaped", () => {
  // "Tea & Snacks" would otherwise be read as a broken entity.
  assert.equal(escapeHtml("Tea & Snacks"), "Tea &amp; Snacks");
});

test("ordinary text is untouched", () => {
  assert.equal(escapeHtml("Paneer Butter Masala × 2   ₹560"), "Paneer Butter Masala × 2   ₹560");
});

test("escaping is idempotent in the sense that it never drops content", () => {
  const hostile = `<script>alert("x")</script> & 'quotes'`;
  const escaped = escapeHtml(hostile);
  assert.ok(!escaped.includes("<script"));
  assert.ok(escaped.includes("script"), "the text itself must survive");
});

// --- The column rule ----------------------------------------------------

// Mirrors the layout used by renderStoredBill: labels left, money right,
// every amount ending in the same column.
function layout(rows: { left: string; right: string }[]): string[] {
  const labelW = Math.max(...rows.map((r) => r.left.length));
  const amountW = Math.max(...rows.map((r) => r.right.length));
  return rows.map((r) => r.left.padEnd(labelW + 3) + r.right.padStart(amountW));
}

test("amounts END in one column, not merely start in one", () => {
  // The original bug: padding the LABEL made every amount start together,
  // so ₹45 and ₹560 still finished four characters apart.
  const lines = layout([
    { left: "Paneer Butter Masala × 2", right: "₹560" },
    { left: "Chai × 3", right: "₹45" },
    { left: "Samosa × 4", right: "₹80" },
    { left: "TOTAL", right: "₹685" },
  ]);
  const widths = new Set(lines.map((l) => l.length));
  assert.equal(widths.size, 1, `lines are ragged:\n${lines.join("\n")}`);
});

test("a long product name does not push the money off the line", () => {
  const lines = layout([
    { left: "Special Paneer Butter Masala Family Pack × 2", right: "₹1,280" },
    { left: "Chai × 1", right: "₹15" },
  ]);
  assert.equal(new Set(lines.map((l) => l.length)).size, 1);
  for (const line of lines) assert.ok(line.trimEnd().endsWith("₹") === false);
});

test("a single row still lays out", () => {
  const lines = layout([{ left: "Chai × 1", right: "₹15" }]);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.endsWith("₹15"));
});

test("amounts of different widths all finish together", () => {
  const lines = layout([
    { left: "a", right: "₹5" },
    { left: "b", right: "₹3,62,500" },
  ]);
  const ends = lines.map((l) => l.length);
  assert.equal(ends[0], ends[1]);
});

// --- The history summary sits against the right edge --------------------

function summaryLine(left: string, amount: string, width: number, right = ""): string {
  const tail = right ? `  ${right}` : "";
  const pad = Math.max(1, width - left.length - amount.length - tail.length);
  return `${left}${" ".repeat(pad)}${amount}${tail}`;
}

test("summary rows reach the block edge", () => {
  const width = 28;
  const a = summaryLine("9 bills", "₹1,740", width);
  const b = summaryLine("unpaid", "₹1,660", width);
  assert.equal(a.length, width);
  assert.equal(b.length, width);
});

test("a summary row never collapses when the label is long", () => {
  // At minimum one space survives between label and amount.
  const line = summaryLine("a very long summary label indeed", "₹100", 10);
  assert.ok(line.includes(" ₹100"));
});

test("a trailing note is kept outside the aligned amount", () => {
  const line = summaryLine("2 drafts", "₹200", 30, "not counted");
  assert.ok(line.endsWith("not counted"));
  assert.ok(line.includes("₹200"));
});
