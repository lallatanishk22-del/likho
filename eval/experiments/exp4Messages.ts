// Experiment #4: Validator Generalization Stress Test — 20 NEW messages,
// disjoint from eval/experiments/baselineMessages.ts (Experiment #1-#3).
// Harness-only addition (registers a new dataset for the existing diagnosed
// runner pattern) — no production logic touched.
export const exp4Messages: { id: number; message: string }[] = [
  { id: 1, message: "bhai 2 paneer rolls 120 ke aur ek coke 50" },
  { id: 2, message: "3 samose @20 aur 2 kachori bees ki" },
  { id: 3, message: "send 4 burger 180 each, fries 90 and 2 coke 50" },
  { id: 4, message: "2 biryani 280 wali + 1 raita 40 ka + 3 coke" },
  { id: 5, message: "bhai ek paneer tikka 250 aur do naan 40 each" },
  { id: 6, message: "5 sandwich total 600, aur 2 coffee 100" },
  { id: 7, message: "2 chicken roll 150, one veg roll 120" },
  { id: 8, message: "3 pizza 450 each and 2 garlic bread 180 pls" },
  { id: 9, message: "bhai 2 thali 200 ki, kal 3 lassi 70 wali bhi add kar dena" },
  { id: 10, message: "4 dosa @80, 2 idli @40. total 400" },
  { id: 11, message: "2 paneer wrap 160 + paneer wrap 160" },
  { id: 12, message: "bhai 3 coke 50 each, 1 burger 200, coke ka ek aur kar dena" },
  { id: 13, message: "order 6 samosa, 15 rs each. delivery 50 extra" },
  { id: 14, message: "do rajma chawal 150 aur 3 kadhi chawal 140, discount 50" },
  { id: 15, message: "bhai 2 biryani 280 aur 280 ka ek aur" },
  { id: 16, message: "4 burger 180 2 fries 90 3 coke 50 - bhai jaldi bhej" },
  { id: 17, message: "need one cake 750, 3 pastry 120, and 2 coffee" },
  { id: 18, message: "bhai 2 pnr tikka 220 wale, 2 naan 40 aur ek dal 180" },
  { id: 19, message: "5 sandwiches @90. actually 6 kar do" },
  { id: 20, message: "bhai 2 pizza 450 each, 3 coke 60, 1 fries 100. jo total aaye bata dena" },
];
