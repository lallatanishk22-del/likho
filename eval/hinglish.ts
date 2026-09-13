// Can a real Indian seller type the way they actually speak?
//
//   npm run eval:hinglish
//
// Likho's whole promise is "send me the order, I'll make the bill". A
// tiffin seller in Pune does not write "2 paneer tikka 180". They write
// "Suresh bhaiya ko do plate paneer tikka bhej do". If that fails, the
// product fails — not partially, completely, because the seller goes back
// to their notebook and never comes back.
//
// Every case here is a SHAPE, not a phrasing. The fix must never be a
// list of Hindi words; it must be a rule that also works for the Marathi
// and Gujarati and Tamil versions of the same sentence.
//
// Needs the live model and the price store, so it cannot run in npm test.
import { handleIncoming } from "../src/messageHandler.js";

const business = {
  platform: "telegram" as const,
  platformUserId: `eval-hinglish-${Date.now()}`,
  displayName: "Hinglish Eval",
};

const PRICE_LIST =
  "/add paneer tikka 180\nbutter naan 40\ncoke 40\nchai 15\nsamosa 20\n" +
  "dal fry 90\nthali 150\nrice 80\npaneer roll 120\nlassi 20";

interface Case {
  // What KIND of Hinglish this is. Grouped so the report says which shape
  // is broken, not merely how many strings failed.
  kind: string;
  message: string;
  expect: Record<string, number>;
}

const CASES: Case[] = [
  // --- 1. A unit word wrapped around a real product --------------------
  // "plate", "dabba", "glass", "packet" are containers, not dishes. The
  // product is INSIDE the phrase the model reports.
  { kind: "unit-word", message: "2 plate paneer tikka", expect: { "Paneer Tikka": 2 } },
  { kind: "unit-word", message: "3 glass lassi", expect: { Lassi: 3 } },
  { kind: "unit-word", message: "2 plate samosa aur 1 glass chai", expect: { Samosa: 2, Chai: 1 } },
  { kind: "unit-word", message: "1 dabba dal fry", expect: { "Dal Fry": 1 } },

  // --- 2. An adjective wrapped around a real product -------------------
  { kind: "adjective", message: "2 garam butter naan", expect: { "Butter Naan": 2 } },
  { kind: "adjective", message: "1 thanda coke", expect: { Coke: 1 } },
  { kind: "adjective", message: "2 extra spicy paneer tikka", expect: { "Paneer Tikka": 2 } },

  // --- 3. A Hindi verb or filler word that is not a product ------------
  // "chahiye" (need), "bhejna" (send), "bana do" (make) became PRODUCTS.
  { kind: "verb-filler", message: "2 paneer tikka chahiye", expect: { "Paneer Tikka": 2 } },
  { kind: "verb-filler", message: "3 chai bhej do", expect: { Chai: 3 } },
  { kind: "verb-filler", message: "2 samosa bana do", expect: { Samosa: 2 } },
  { kind: "verb-filler", message: "table 4 ko 2 paneer tikka de dena", expect: { "Paneer Tikka": 2 } },

  // --- 4. Hindi numerals ------------------------------------------------
  // A numeral system is a closed set and a fact about the language, unlike
  // filler, which is open-ended and must never be listed.
  { kind: "hindi-numeral", message: "do chai", expect: { Chai: 2 } },
  { kind: "hindi-numeral", message: "teen samosa", expect: { Samosa: 3 } },
  { kind: "hindi-numeral", message: "ek paneer tikka aur do butter naan", expect: { "Paneer Tikka": 1, "Butter Naan": 2 } },
  { kind: "hindi-numeral", message: "char coke", expect: { Coke: 4 } },

  // --- 5. Customer named the Indian way ---------------------------------
  { kind: "customer", message: "Suresh ke liye 2 paneer tikka", expect: { "Paneer Tikka": 2 } },
  { kind: "customer", message: "Rahul ka bill bana 3 chai", expect: { Chai: 3 } },
  { kind: "customer", message: "Ramesh bhaiya ko 2 thali", expect: { Thali: 2 } },

  // --- 6. Full sentences, the way a person actually types ---------------
  { kind: "sentence", message: "bhaiya 2 lassi bana do 40 rupaye ka", expect: { Lassi: 2 } },
  { kind: "sentence", message: "Suresh bhaiya ko do plate paneer tikka bhej do", expect: { "Paneer Tikka": 2 } },
  { kind: "sentence", message: "aaj ke liye 2 thali aur 4 butter naan pack kar do", expect: { Thali: 2, "Butter Naan": 4 } },
  { kind: "sentence", message: "kal Ramesh ne 3 samosa liye the wo bhi add kar do", expect: { Samosa: 3 } },

  // --- 7. Distractor numbers that are NOT quantities --------------------
  { kind: "distractor", message: "table 7 ke liye 2 paneer tikka", expect: { "Paneer Tikka": 2 } },
  { kind: "distractor", message: "room 12 me 3 chai bhejna", expect: { Chai: 3 } },

  // --- 8. Plain English, which must not regress -------------------------
  { kind: "control", message: "2 paneer tikka 3 butter naan", expect: { "Paneer Tikka": 2, "Butter Naan": 3 } },
  { kind: "control", message: "ravi 2 chai 3 samosa", expect: { Chai: 2, Samosa: 3 } },
];

async function run(): Promise<void> {
  await handleIncoming({ ...business, text: PRICE_LIST });

  const byKind = new Map<string, { pass: number; total: number }>();
  let passed = 0;

  for (const c of CASES) {
    const reply = await handleIncoming({ ...business, text: c.message });
    const lines = reply.text.split("\n");
    const missing: string[] = [];
    for (const [name, quantity] of Object.entries(c.expect)) {
      if (!lines.some((l) => l.trim().startsWith(`${name} × ${quantity}`))) {
        missing.push(`${name} × ${quantity}`);
      }
    }

    const stat = byKind.get(c.kind) ?? { pass: 0, total: 0 };
    stat.total++;

    if (missing.length === 0) {
      passed++;
      stat.pass++;
      console.log(`PASS  [${c.kind}] ${JSON.stringify(c.message)}`);
    } else {
      console.log(`FAIL  [${c.kind}] ${JSON.stringify(c.message)}`);
      console.log(`        missing: ${missing.join(", ")}`);
      console.log(`        got: ${reply.text.split("\n").join(" | ").slice(0, 150)}`);
    }
    byKind.set(c.kind, stat);

    // Each message leaves an open draft; clear it so the next case starts
    // from nothing rather than adding to the previous bill.
    await handleIncoming({ ...business, text: "cancel" });
  }

  console.log(`\n=== by shape ===`);
  for (const [kind, s] of [...byKind.entries()].sort((a, b) => a[1].pass / a[1].total - b[1].pass / b[1].total)) {
    console.log(`  ${String(s.pass).padStart(2)}/${s.total}  ${kind}`);
  }
  console.log(`\n${passed}/${CASES.length} passed`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
