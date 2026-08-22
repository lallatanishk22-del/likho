import type { Bill } from "./types.js";

function titleCase(name: string): string {
  return name
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function formatBill(bill: Bill, customer?: string | null): string {
  const rows = bill.lines.map((line) => ({
    left: `${titleCase(line.name)} × ${line.quantity}`,
    right: formatRupees(line.lineTotal),
  }));

  const summaryRows = [{ left: "Total", right: formatRupees(bill.total) }];
  if (bill.discountPercent > 0) {
    summaryRows.unshift(
      { left: "Subtotal", right: formatRupees(bill.subtotal) },
      { left: `Discount (${bill.discountPercent}%)`, right: `−${formatRupees(bill.discountAmount)}` },
    );
  }

  const allLabels = [...rows, ...summaryRows].map((r) => r.left);
  const width = Math.max(...allLabels.map((l) => l.length)) + 4;
  const line = (row: { left: string; right: string }) =>
    row.left.padEnd(width) + row.right;

  const separator = "-".repeat(width + 6);
  const heading = customer ? [customer.toUpperCase(), ""] : [];

  return [
    ...heading,
    ...rows.map(line),
    separator,
    "",
    ...summaryRows.map(line),
  ].join("\n");
}
