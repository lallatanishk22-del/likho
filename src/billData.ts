// The presentation-independent view of a bill.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: every money figure here is COPIED
// from what calculator.ts computed and billStore.ts persisted. Nothing in
// this file or in any template does arithmetic on money. A template can
// only decide where a number goes on the page, never what the number is.
//
// That is why templates receive BillData and never a StoredBill: there is
// nothing in here to recompute from.

export interface BillBusiness {
  name: string;
  phone?: string | null;
  address?: string | null;
  gstin?: string | null;
  upiId?: string | null;
  logoUrl?: string | null;
  footerNote?: string | null;
}

export interface BillCustomer {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface BillLineView {
  name: string;
  code?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  lineTotal: number;
  note?: string | null;
}

// A named tax row, already computed. The engine does not calculate tax
// today, so this is empty on live bills — the structure exists so a
// template's GST section is written and tested now rather than bolted on
// later, and so previews can demonstrate it.
export interface BillTaxView {
  label: string;
  rate?: number | null;
  amount: number;
}

export type BillPaymentStatus = "pending" | "partial" | "paid";

export interface BillData {
  business: BillBusiness;
  customer?: BillCustomer | null;
  billNo: number | string;
  dateLabel: string;
  timeLabel?: string | null;
  dueDateLabel?: string | null;
  items: BillLineView[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  taxes: BillTaxView[];
  // Charges that are not items — delivery, packing. Applied AFTER the
  // discount, so a discount never quietly reduces a delivery fee.
  charges: { label: string; amount: number }[];
  total: number;
  amountPaid: number;
  paymentStatus: BillPaymentStatus;
  paymentMethod?: string | null;
  notes?: string | null;
}

export const TEMPLATE_IDS = [
  "classic",
  "modern",
  "retail",
  "food",
  "professional",
  "receipt",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TEMPLATE_LABELS: Record<TemplateId, { name: string; forWho: string }> = {
  classic: { name: "Classic", forWho: "Any small shop" },
  modern: { name: "Modern", forWho: "Cafes, cloud kitchens, boutiques" },
  retail: { name: "Retail", forWho: "Grocery and general stores" },
  food: { name: "Food", forWho: "Restaurants, tiffin, bakeries" },
  professional: { name: "Professional", forWho: "Freelancers, agencies, B2B" },
  receipt: { name: "Receipt", forWho: "Fast counter sales" },
};

// Unknown or missing values fall back to the safest style rather than
// failing to render a bill.
export function asTemplateId(value: unknown): TemplateId {
  return TEMPLATE_IDS.includes(value as TemplateId) ? (value as TemplateId) : "classic";
}
