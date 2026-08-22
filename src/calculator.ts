import type { Bill, OrderItem } from "./types.js";

export function calculateBill(items: OrderItem[], discountPercent = 0): Bill {
  const lines = items.map((item) => ({
    ...item,
    lineTotal: item.quantity * item.unitPrice,
  }));

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discountAmount = Math.round((subtotal * discountPercent) / 100);
  const total = subtotal - discountAmount;

  return { lines, subtotal, discountPercent, discountAmount, total };
}
