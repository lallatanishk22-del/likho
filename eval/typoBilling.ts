// Does a messy, misspelled, real-world order still produce a bill?
//
//   npm run eval:typos
//
// Exists because of a specific failure: "/zbill 3 paner , 1 chai , rot i"
// came back as "No price found for 'paner'. Please state the price."
//
// That text was the MODEL's, not Likho's. The model had decided it could
// not price the item and returned a clarification — so applyCatalog never
// ran, and "paner" never got its chance to near-match "paneer". Pricing is
// not the model's job; it does not know a single price. One prompt rule
// being ignored silently disabled a whole layer downstream of it.
//
// Like eval/nameExtraction.ts this needs the live model and the price
// store, so it cannot run in `npm test`. Run it after any prompt change.
import { handleIncoming } from "../src/messageHandler.js";

const business = {
  platform: "telegram" as const,
  platformUserId: "eval-typo-billing",
  displayName: "Typo Billing Eval",
};

const PRICE_LIST = "/add paneer 100 chai 15 roti 10 paneer roll 120 lassi 20";

interface Case {
  message: string;
  // Item name -> quantity that must appear on the resulting bill.
  expect: Record<string, number>;
}

const CASES: Case[] = [
  // The reported failure, verbatim.
  { message: "/zbill 3 paner , 1 chai , rot i", expect: { Paneer: 3, Chai: 1, Roti: 1 } },

  // Misspellings that must resolve through the price list.
  { message: "3 paner 1 chai", expect: { Paneer: 3, Chai: 1 } },
  { message: "2 lasssi", expect: { Lassi: 2 } },
  { message: "2 panner", expect: { Paneer: 2 } },

  // Spacing typos.
  { message: "2 rot i", expect: { Roti: 2 } },
  { message: "1 paneerroll", expect: { "Paneer Roll": 1 } },

  // Separators and shapes.
  { message: "ravi 2 chai, 3 roti", expect: { Chai: 2, Roti: 3 } },
  { message: "2 chai\n3 roti", expect: { Chai: 2, Roti: 3 } },
  { message: "2 chai + 3 roti", expect: { Chai: 2, Roti: 3 } },

  // Correct spelling must obviously still work.
  { message: "3 paneer 2 chai", expect: { Paneer: 3, Chai: 2 } },
];

async function run(): Promise<void> {
  await handleIncoming({ ...business, text: PRICE_LIST });

  let passed = 0;
  for (const testCase of CASES) {
    const reply = await handleIncoming({ ...business, text: testCase.message });

    const lines = reply.text.split("\n");
    const missing: string[] = [];
    for (const [name, quantity] of Object.entries(testCase.expect)) {
      const found = lines.some((l) => l.startsWith(`${name} × ${quantity}`));
      if (!found) missing.push(`${name} × ${quantity}`);
    }

    if (missing.length === 0) {
      passed++;
      console.log(`PASS  ${JSON.stringify(testCase.message)}`);
    } else {
      console.log(`FAIL  ${JSON.stringify(testCase.message)}`);
      console.log(`        missing: ${missing.join(", ")}`);
      console.log(`        got: ${reply.text.split("\n").join(" | ").slice(0, 160)}`);
    }
  }

  console.log(`\n${passed}/${CASES.length} passed`);
  if (passed < CASES.length) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
