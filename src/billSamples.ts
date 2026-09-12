import type { BillData } from "./billData.js";

// Realistic sample bills, used for template previews and for the edge-case
// suite. Kept in src/ rather than test/ because the preview page and the
// tests must show the SAME data — a preview that flatters a template with
// data the tests never exercise is how layout bugs reach a real bill.

export const SAMPLE_BILL: BillData = {
  business: {
    name: "Shree Snacks",
    address: "Shop 14, Lokhandwala, Andheri West, Mumbai 400053",
    phone: "+91 98200 41122",
    gstin: "27AABCS1429B1ZX",
    upiId: "shreesnacks@okaxis",
    footerNote: "Thank you for your order!",
  },
  customer: { name: "Ravi Bhanushali", phone: "+91 99301 88240" },
  billNo: 1042,
  dateLabel: "10 Sept 2026",
  timeLabel: "2:35 pm",
  items: [
    { name: "Paneer Roll", code: "SNK-014", quantity: 2, unitPrice: 120, lineTotal: 240 },
    { name: "Masala Chai", code: "BEV-002", quantity: 2, unitPrice: 40, lineTotal: 80 },
    { name: "Samosa", code: "SNK-001", quantity: 4, unitPrice: 20, lineTotal: 80, note: "Less spicy" },
  ],
  subtotal: 400,
  discountPercent: 0,
  discountAmount: 0,
  charges: [{ label: "Delivery", amount: 30 }],
  taxes: [
    { label: "CGST", rate: 2.5, amount: 10 },
    { label: "SGST", rate: 2.5, amount: 10 },
  ],
  total: 450,
  amountPaid: 450,
  paymentStatus: "paid",
  paymentMethod: "UPI",
  notes: null,
};

// --- Edge cases -----------------------------------------------------------
// Each is a shape that has broken a bill layout somewhere before: a lone
// item, an overflowing table, a name with no spaces to wrap on, a business
// that has given nothing but its name.

function withItems(count: number): BillData["items"] {
  const menu: [string, number][] = [
    ["Paneer Butter Masala", 280], ["Dal Makhani", 220], ["Jeera Rice", 160],
    ["Butter Naan", 60], ["Tandoori Roti", 25], ["Masala Papad", 45],
    ["Boondi Raita", 70], ["Green Salad", 90], ["Gulab Jamun", 80],
    ["Masala Chai", 40], ["Fresh Lime Soda", 70], ["Mineral Water", 20],
  ];
  return Array.from({ length: count }, (_, i) => {
    const [name, price] = menu[i % menu.length]!;
    const quantity = (i % 4) + 1;
    return {
      name: count > menu.length ? `${name} ${Math.floor(i / menu.length) + 1}` : name,
      code: `ITM-${String(i + 1).padStart(3, "0")}`,
      quantity,
      unitPrice: price,
      lineTotal: quantity * price,
    };
  });
}

function sum(items: BillData["items"]): number {
  return Math.round(items.reduce((t, i) => t + i.lineTotal, 0) * 100) / 100;
}

function bill(overrides: Partial<BillData>): BillData {
  const items = overrides.items ?? SAMPLE_BILL.items;
  const subtotal = overrides.subtotal ?? sum(items);
  return {
    ...SAMPLE_BILL,
    items,
    subtotal,
    discountPercent: 0,
    discountAmount: 0,
    charges: [],
    taxes: [],
    total: subtotal,
    amountPaid: subtotal,
    ...overrides,
  };
}

export const EDGE_CASES: { id: string; label: string; data: BillData }[] = [
  { id: "typical", label: "Typical bill", data: SAMPLE_BILL },

  { id: "one-item", label: "One item", data: bill({
      items: [{ name: "Masala Chai", quantity: 1, unitPrice: 15, lineTotal: 15 }],
    }) },

  { id: "many-items", label: "24 items (page break)", data: bill({ items: withItems(24) }) },

  { id: "long-name", label: "Very long item name", data: bill({
      items: [
        { name: "Special Paneer Butter Masala With Extra Cashew Gravy And Two Butter Naan Family Pack",
          quantity: 2, unitPrice: 640, lineTotal: 1280 },
        { name: "Supercalifragilisticexpialidociousbiryanispecialnospaceshere",
          quantity: 1, unitPrice: 320, lineTotal: 320 },
      ],
    }) },

  { id: "no-customer", label: "No customer", data: bill({ customer: null }) },

  { id: "bare-business", label: "Name only, nothing else", data: bill({
      business: { name: "Anita's Tiffin" },
      customer: null,
      paymentStatus: "pending",
      amountPaid: 0,
      paymentMethod: null,
      notes: null,
    }) },

  { id: "gst", label: "GST bill", data: SAMPLE_BILL },

  { id: "no-gst", label: "Non-GST bill", data: bill({
      business: { ...SAMPLE_BILL.business, gstin: null },
    }) },

  { id: "discount", label: "With discount", data: (() => {
      const items = SAMPLE_BILL.items;
      const subtotal = sum(items);
      const discountAmount = Math.round(subtotal * 0.1 * 100) / 100;
      return bill({
        items, subtotal,
        discountPercent: 10, discountAmount,
        total: Math.round((subtotal - discountAmount) * 100) / 100,
        amountPaid: 0, paymentStatus: "pending",
      });
    })() },

  { id: "partial", label: "Partly paid", data: bill({
      amountPaid: 200, paymentStatus: "partial",
    }) },

  { id: "cash", label: "Cash payment", data: bill({ paymentMethod: "Cash" }) },

  { id: "large-total", label: "Large total", data: bill({
      items: [
        { name: "Wedding Catering — 250 guests", quantity: 250, unitPrice: 1450, lineTotal: 362500 },
        { name: "Live Chaat Counter", quantity: 2, unitPrice: 18000, lineTotal: 36000 },
      ],
      paymentStatus: "pending", amountPaid: 0,
    }) },

  { id: "decimals", label: "Decimal prices", data: bill({
      items: [
        { name: "Loose Sugar", quantity: 3, unit: "kg", unitPrice: 46.5, lineTotal: 139.5 },
        { name: "Toor Dal", quantity: 2, unit: "kg", unitPrice: 132.75, lineTotal: 265.5 },
      ],
    }) },

  { id: "long-business", label: "Long business name", data: bill({
      business: {
        ...SAMPLE_BILL.business,
        name: "Shree Siddhivinayak Pure Vegetarian Family Restaurant & Caterers",
      },
    }) },

  { id: "long-notes", label: "Long note", data: bill({
      notes:
        "Order placed for delivery between 7:30pm and 8:00pm. Please call on arrival, " +
        "the building gate closes at 8. Two packets are for the neighbours on the third " +
        "floor and should be handed over separately. No onion or garlic in the dal.",
    }) },

  { id: "invoice-due", label: "Invoice with due date", data: bill({
      dueDateLabel: "25 Sept 2026",
      paymentStatus: "pending", amountPaid: 0,
      items: [
        { name: "Brand identity design", quantity: 1, unitPrice: 45000, lineTotal: 45000,
          note: "Logo, colour system, type scale" },
        { name: "Packaging artwork", quantity: 3, unitPrice: 8000, lineTotal: 24000 },
      ],
    }) },
];
