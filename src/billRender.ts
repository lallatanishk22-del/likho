import type { StoredBill } from "./billStore.js";
import type { BillData, BillBusiness } from "./billData.js";
import { formatBusinessDate, formatBusinessDateTime } from "./businessDay.js";

// Maps STORED bill state onto the presentation view model.
//
// Every money figure is COPIED from the stored row. calculator.ts computed
// it, billStore.ts persisted it, and this function moves it across
// unchanged. There is deliberately no arithmetic here beyond Number()
// parsing of Postgres numerics — a bill is a record of what was charged,
// not something to be recomputed at display time.

export interface BusinessProfile extends BillBusiness {
  id: string;
  billTemplate: string;
}

// Product names are stored lowercase so lookups are case-insensitive. That
// is a storage decision and it must not reach a customer's bill — "paneer
// roll x 2" reads as a database row, not as something you were served.
// Presentation only; the stored snapshot is untouched.
function displayName(name: string): string {
  return name.replace(/\b[\p{Ll}]/gu, (c) => c.toUpperCase());
}

function timeOnly(iso: string): string {
  const full = formatBusinessDateTime(new Date(iso));
  const parts = full.split(", ");
  return parts.length > 1 ? parts.slice(1).join(", ") : full;
}

export function toBillData(stored: StoredBill, business: BusinessProfile): BillData {
  const { session, items } = stored;
  const stamp = session.finalized_at ?? session.created_at;

  return {
    business: {
      name: business.name,
      phone: business.phone ?? null,
      address: business.address ?? null,
      gstin: business.gstin ?? null,
      upiId: business.upiId ?? null,
      logoUrl: business.logoUrl ?? null,
      footerNote: business.footerNote ?? null,
    },
    customer: session.customer_ref ? { name: displayName(session.customer_ref) } : null,
    billNo: session.bill_no,
    dateLabel: formatBusinessDate(new Date(stamp)),
    timeLabel: timeOnly(stamp),
    items: items.map((item) => ({
      name: displayName(item.name_snapshot),
      quantity: item.quantity,
      unitPrice: Number(item.unit_price),
      lineTotal: Number(item.line_total),
    })),
    subtotal: Number(session.subtotal),
    discountPercent: Number(session.discount_percent),
    discountAmount: Number(session.discount_amount),
    // The engine does not calculate tax today. The field exists so the GST
    // section in every template is written and tested now, rather than
    // being bolted on later when it would touch six files at once.
    taxes: [],
    total: Number(session.total),
    amountPaid: Number(session.amount_paid),
    paymentStatus: session.payment_status,
    paymentMethod: null,
    notes: null,
  };
}
