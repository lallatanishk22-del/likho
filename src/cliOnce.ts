import { routeParseOrder } from "./router.js";

// Thin bridge for external callers (e.g. the macOS app) that need a single
// request/response round trip instead of the interactive CLI experience in
// index.ts/indexAi.ts. Reads the whole order text from stdin, calls the
// EXISTING routeParseOrder() entry point unchanged, and writes one JSON
// object to stdout: {ok:true, parsed} on success, {ok:false, error} on
// failure. Exit code is non-zero on failure. No parsing/validation/trust
// logic lives here — this file only bridges stdin/stdout to the router.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  const input = await readStdin();

  if (input.trim().length === 0) {
    const message = "No input received on stdin.";
    console.error(message);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
    process.exit(1);
  }

  // router.ts logs its routing decisions via console.log (stdout) by
  // design, for CLI/terminal use — that's correct for index.ts/indexAi.ts,
  // but this bridge promises callers ONE clean JSON object on stdout and
  // nothing else. Redirecting console.log to stderr for the duration of
  // this call keeps that contract without editing router.ts itself.
  const originalConsoleLog = console.log;
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };

  try {
    const { parsed } = await routeParseOrder(input);
    console.log = originalConsoleLog;
    process.stdout.write(JSON.stringify({ ok: true, parsed }));
  } catch (err) {
    console.log = originalConsoleLog;
    const message = (err as Error).message;
    console.error(message);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  }
}

main();
