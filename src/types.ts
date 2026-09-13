// One line of the input order, after parsing, before any money math.
export interface OrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
  // Where the price came from. Carried all the way through to the stored
  // bill so provenance is auditable after the fact. Optional so existing
  // callers (CLI, tests) are unaffected; absent means "stated".
  priceSource?: "stated" | "catalog" | "manual";
}

// One line of the final bill, after money math has been applied.
export interface BillLine extends OrderItem {
  lineTotal: number;
}

// A charge that is not an item: delivery, packing, a service fee.
//
// Kept separate from items on purpose. A discount applies to what was
// SOLD, not to the cost of getting it there — folding delivery in as an
// item would silently discount it, and on a GST bill the two are taxed
// differently. Order of operations: subtotal -> discount -> charges.
export interface BillCharge {
  label: string;
  amount: number;
}

export interface Bill {
  lines: BillLine[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  charges: BillCharge[];
  chargesTotal: number;
  total: number;
}

// What the seller said that is not money: "less spicy", "deliver by 8pm",
// "no onion". A bill is the record of a transaction and these are part of
// that transaction, so they print on the document rather than being lost
// between the order message and the kitchen.
//
// The category chooses a heading only. Capture is structural (a line that
// names no product and states no money), so a missed category still shows
// the text — under "Note" — and nothing is lost.
export type NoteCategory = "prep" | "timing" | "packing" | "delivery" | "note";

export interface BillNote {
  category: NoteCategory;
  text: string;
}
