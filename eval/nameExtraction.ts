// Where does the customer name have to be for Likho to find it?
//
// Not a unit test: it needs the live model and the price store, so it
// cannot run in `npm test`. It exists because name extraction is the one
// part of the pipeline the MODEL owns, and model behaviour drifts silently
// when a prompt changes. Run it after any edit to the extraction prompt.
//
//   npm run eval:names
//
// The negative cases matter most: a bill that invents a customer is worse
// than one with no name on it.
import { handleIncoming } from "../src/messageHandler.js";

const business = {
  platform: "telegram" as const,
  platformUserId: "eval-name-extraction",
  displayName: "Name Extraction Eval",
};

interface Case {
  message: string;
  // Lowercase substring the extracted name must contain, or null meaning
  // "there is no customer here and none may be invented".
  expect: string | null;
}

const CASES: Case[] = [
  // The command can sit anywhere in the sentence.
  { message: "ria bhanushali /zbill 3 mudpie", expect: "ria" },
  { message: "/zbill ria bhanushali 3 mudpie", expect: "ria" },
  { message: "/zbill 3 mudpie ria bhanushali", expect: "ria" },

  // Position of the name relative to the items.
  { message: "3 mudpie ria bhanushali", expect: "ria" },
  { message: "ria 2 chai", expect: "ria" },
  { message: "2 chai ria", expect: "ria" },
  { message: "3 mudpie\nria bhanushali", expect: "ria" },

  // Linking words.
  { message: "3 mudpie for ria bhanushali", expect: "ria" },
  { message: "ria bhanushali ka bill 3 mudpie", expect: "ria" },
  { message: "bill for ria bhanushali 3 mudpie", expect: "ria" },

  // No customer named — none may be invented.
  { message: "3 mudpie", expect: null },
  { message: "2 chai 1 lassi", expect: null },
  { message: "/zbill 2 chai", expect: null },
];

async function run(): Promise<void> {
  await handleIncoming({ ...business, text: "/add mudpie 100 chai 15 lassi 20" });

  let passed = 0;
  const failures: string[] = [];

  for (const testCase of CASES) {
    const reply = await handleIncoming({ ...business, text: testCase.message });
    const match = reply.text.match(/\u{1f9fe} (.+?) — Bill/u);
    const found = match ? match[1]! : null;

    const ok =
      testCase.expect === null
        ? found === null
        : found !== null && found.toLowerCase().includes(testCase.expect);

    if (ok) {
      passed++;
    } else {
      failures.push(
        `  ${JSON.stringify(testCase.message)}\n` +
          `    expected ${testCase.expect === null ? "no name" : `a name containing "${testCase.expect}"`}` +
          `, got ${found === null ? "no name" : `"${found}"`}`,
      );
    }
    console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(testCase.message)} -> ${found ?? "(none)"}`);
  }

  console.log(`\n${passed}/${CASES.length} passed`);
  if (failures.length > 0) {
    console.log(`\nFailures:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
