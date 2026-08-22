// 20 realistic messy WhatsApp order messages, used to evaluate (not tune)
// the current Ollama extraction layer. Each case states what a correct
// outcome looks like: either a specific structured order, or that the
// parser should refuse/ask for clarification rather than guess.

export interface ExpectedItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface EvalCase {
  id: number;
  category: string;
  message: string;
  expectSuccess: boolean;
  expected?: {
    customer?: string | null;
    items?: ExpectedItem[];
    discountPercent?: number | null;
  };
  note?: string;
}

export const evalCases: EvalCase[] = [
  {
    id: 1,
    category: "normal",
    message: "2 chicken biryani 450 1 raita 80",
    expectSuccess: true,
    expected: {
      customer: null,
      items: [
        { name: "chicken biryani", quantity: 2, unitPrice: 450 },
        { name: "raita", quantity: 1, unitPrice: 80 },
      ],
      discountPercent: null,
    },
  },
  {
    id: 2,
    category: "each",
    message: "Rahul 2 paneer tikka 280 each 3 naan 60 each",
    expectSuccess: true,
    expected: {
      customer: "Rahul",
      items: [
        { name: "paneer tikka", quantity: 2, unitPrice: 280 },
        { name: "naan", quantity: 3, unitPrice: 60 },
      ],
      discountPercent: null,
    },
  },
  {
    id: 3,
    category: "conversational",
    message: "hey can I get 3 dosas at 70 rupees each for Suresh",
    expectSuccess: true,
    expected: {
      customer: "Suresh",
      items: [{ name: "dosa", quantity: 3, unitPrice: 70 }],
      discountPercent: null,
    },
  },
  {
    id: 4,
    category: "multi-item-one-sentence",
    message: "2 paneer tikka 280 each + 3 naan 60 each + 2 coke 40 each for Priya",
    expectSuccess: true,
    expected: {
      customer: "Priya",
      items: [
        { name: "paneer tikka", quantity: 2, unitPrice: 280 },
        { name: "naan", quantity: 3, unitPrice: 60 },
        { name: "coke", quantity: 2, unitPrice: 40 },
      ],
      discountPercent: null,
    },
  },
  {
    id: 5,
    category: "zbill-style",
    message: "zbill Ramesh 5 dabba ₹180 each",
    expectSuccess: true,
    expected: {
      customer: "Ramesh",
      items: [{ name: "dabba", quantity: 5, unitPrice: 180 }],
      discountPercent: null,
    },
  },
  {
    id: 6,
    category: "typos",
    message: "2 panner tikka 280 each 1 nan 60 each",
    expectSuccess: true,
    expected: {
      customer: null,
      items: [
        { name: "paneer tikka", quantity: 2, unitPrice: 280 },
        { name: "naan", quantity: 1, unitPrice: 60 },
      ],
      discountPercent: null,
    },
    note: "typo'd item names (panner, nan) — checked loosely, not exact string match",
  },
  {
    id: 7,
    category: "hinglish",
    message: "Rahul ka bill bana 2 paneer tikka 280 3 naan 60",
    expectSuccess: true,
    expected: {
      customer: "Rahul",
      items: [
        { name: "paneer tikka", quantity: 2, unitPrice: 280 },
        { name: "naan", quantity: 3, unitPrice: 60 },
      ],
      discountPercent: null,
    },
  },
  {
    id: 8,
    category: "hinglish",
    message: "2 chai 20 rs each 3 samosa 15 each Amit ke liye",
    expectSuccess: true,
    expected: {
      customer: "Amit",
      items: [
        { name: "chai", quantity: 2, unitPrice: 20 },
        { name: "samosa", quantity: 3, unitPrice: 15 },
      ],
      discountPercent: null,
    },
  },
  {
    id: 9,
    category: "missing-price",
    message: "Rahul 2 paneer tikka 3 naan 2 coke 10% discount",
    expectSuccess: false,
    note: "no price stated anywhere in the message — must not guess/invent a price",
  },
  {
    id: 10,
    category: "explicit-price-override",
    message: "Ramesh 5 dosa ₹70 each",
    expectSuccess: true,
    expected: {
      customer: "Ramesh",
      items: [{ name: "dosa", quantity: 5, unitPrice: 70 }],
      discountPercent: null,
    },
  },
  {
    id: 11,
    category: "missing-price-partial",
    message: "3 coffee 50 each 2 tea",
    expectSuccess: false,
    note: "coffee has a price, tea does not — must not guess tea's price",
  },
  {
    id: 12,
    category: "discount",
    message: "2 idli 40 each 3 vada 40 each 20% off for Meena",
    expectSuccess: true,
    expected: {
      customer: "Meena",
      items: [
        { name: "idli", quantity: 2, unitPrice: 40 },
        { name: "vada", quantity: 3, unitPrice: 40 },
      ],
      discountPercent: 20,
    },
  },
  {
    id: 13,
    category: "no-discount-mentioned",
    message: "5 rotis 12 each 2 dal makhani 150 each no discount Suresh",
    expectSuccess: true,
    expected: {
      customer: "Suresh",
      items: [
        { name: "roti", quantity: 5, unitPrice: 12 },
        { name: "dal makhani", quantity: 2, unitPrice: 150 },
      ],
      discountPercent: null,
    },
  },
  {
    id: 14,
    category: "non-name-word",
    message: "give me 2 pizza margherita 250 each and 1 garlic bread 90 for testing",
    expectSuccess: true,
    expected: {
      customer: null,
      items: [
        { name: "pizza margherita", quantity: 2, unitPrice: 250 },
        { name: "garlic bread", quantity: 1, unitPrice: 90 },
      ],
      discountPercent: null,
    },
    note: "'for testing' is not a customer name — model may incorrectly extract it as one",
  },
  {
    id: 15,
    category: "ambiguous-price-pairing",
    message: "Rahul 2 paneer 3 naan 2 coke each 20 40 60",
    expectSuccess: false,
    note: "three prices listed separately at the end with no clear item-to-price pairing — ambiguous",
  },
  {
    id: 16,
    category: "discount",
    message: "3 chicken rolls 90 each 2 veg roll 70 each Amit 15% discount",
    expectSuccess: true,
    expected: {
      customer: "Amit",
      items: [
        { name: "chicken roll", quantity: 3, unitPrice: 90 },
        { name: "veg roll", quantity: 2, unitPrice: 70 },
      ],
      discountPercent: 15,
    },
  },
  {
    id: 17,
    category: "hinglish-colloquial",
    message: "bhaiya 2 lassi bana do 40 rupaye ka",
    expectSuccess: true,
    expected: {
      customer: null,
      items: [{ name: "lassi", quantity: 2, unitPrice: 40 }],
      discountPercent: null,
    },
    note: "'bhaiya' is a form of address, not a customer name",
  },
  {
    id: 18,
    category: "duplicate-line-items",
    message: "1 thali 150 1 thali 150",
    expectSuccess: false,
    note:
      "originally marked expectSuccess:true, but this contradicts the trust layer's own " +
      "duplicateEvidenceAcrossItems rule (src/trustLayer.ts): the two occurrences of " +
      "'1 thali 150' are byte-identical, so no evidence string can distinguish which item " +
      "is which. That rule was deliberately built to reject exactly this shape. A refusal " +
      "here is the system working as designed, not a bug — fixed the dataset's expectation " +
      "to match the contract instead of the other way around.",
  },
  {
    id: 19,
    category: "typos-no-spacing",
    message: "2 burger 120each1 fries 60each",
    expectSuccess: true,
    expected: {
      customer: null,
      items: [
        { name: "burger", quantity: 2, unitPrice: 120 },
        { name: "fries", quantity: 1, unitPrice: 60 },
      ],
      discountPercent: null,
    },
    note:
      "originally marked expectSuccess:false as a stress test, but on inspection the digit/" +
      "letter boundaries here are NOT actually ambiguous: '120each1' only tokenizes as " +
      "'120', 'each', '1' (the word 'each' separates the two numbers, so '1' can't merge " +
      "into '120's value). Only one structurally valid reading exists — same character as " +
      "#6/#14/#17 (messy formatting, single sensible resolution), which are correctly " +
      "labeled expectSuccess:true elsewhere in this dataset. Fixed for consistency.",
  },
  {
    id: 20,
    category: "discount-plus-noise",
    message: "Neha 3 mango shake 80, 2 veg sandwich 70, 15% off, urgent",
    expectSuccess: true,
    expected: {
      customer: "Neha",
      items: [
        { name: "mango shake", quantity: 3, unitPrice: 80 },
        { name: "veg sandwich", quantity: 2, unitPrice: 70 },
      ],
      discountPercent: 15,
    },
    note: "extra word 'urgent' should be ignored",
  },
];
