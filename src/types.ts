// One line of the input order, after parsing, before any money math.
export interface OrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

// One line of the final bill, after money math has been applied.
export interface BillLine extends OrderItem {
  lineTotal: number;
}

export interface Bill {
  lines: BillLine[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
}
