import type { Bill, BillCharge, OrderItem } from "./types.js";

// Money is rounded to 2 decimals (paise) at every step. JS numbers are
// binary floats, so 0.1 + 0.2 === 0.30000000000000004 — without rounding,
// that drift reaches the seller's bill. Rounding each computed amount keeps
// every figure an exact paise value.
function toPaise(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function calculateBill(
  items: OrderItem[],
  discountPercent = 0,
  charges: BillCharge[] = [],
): Bill {
  const lines = items.map((item) => ({
    ...item,
    lineTotal: toPaise(item.quantity * item.unitPrice),
  }));

  const subtotal = toPaise(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  // A negative discount would silently INCREASE the bill, and a discount
  // over 100% would produce a negative total — a nonsensical bill either
  // way. Clamp to [0, subtotal] so the total can never leave [0, subtotal].
  const safePercent = Math.max(0, discountPercent);
  const discountAmount = Math.min(subtotal, toPaise((subtotal * safePercent) / 100));
  // Charges are added AFTER the discount. A discount applies to what was
  // sold, not to the cost of delivering it — and a negative charge would
  // be a discount wearing a different label, so they are clamped at zero.
  const safeCharges = charges.map((c) => ({
    label: c.label,
    amount: toPaise(Math.max(0, c.amount)),
  }));
  const chargesTotal = toPaise(safeCharges.reduce((sum, c) => sum + c.amount, 0));

  const total = toPaise(subtotal - discountAmount + chargesTotal);

  return {
    lines,
    subtotal,
    discountPercent: safePercent,
    discountAmount,
    charges: safeCharges,
    chargesTotal,
    total,
  };
}
