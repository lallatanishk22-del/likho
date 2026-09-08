import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { routeParseOrder } from "./router.js";
import { calculateBill } from "./calculator.js";
import { formatBill } from "./formatter.js";

// Thin HTTP adapter exposing the EXISTING Likho pipeline over one endpoint,
// for n8n (or anything else) to call. Same three calls telegramBot.ts
// already makes, in the same order — no parsing/validation/trust/pricing
// logic lives here, only request/response plumbing.
const PORT = Number(process.env["PORT"] ?? 3000);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function handleOrder(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "Failed to read request body." });
    return;
  }

  let body: unknown;
  try {
    body = raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { ok: false, error: "Malformed JSON in request body." });
    return;
  }

  const text = (body as Record<string, unknown> | null)?.["text"];
  if (typeof text !== "string" || text.trim().length === 0) {
    sendJson(res, 400, { ok: false, error: 'Request body must include a non-empty "text" string.' });
    return;
  }

  // Stage 1: the existing order-processing pipeline. Anything it throws
  // (missing price, ambiguous items, both providers failing, etc.) is a
  // clarification-needed outcome, not a server error — 422.
  let parsed: Awaited<ReturnType<typeof routeParseOrder>>["parsed"];
  try {
    ({ parsed } = await routeParseOrder(text));
  } catch (err) {
    sendJson(res, 422, { ok: false, error: (err as Error).message });
    return;
  }

  // Stage 2: deterministic math/formatting on already-validated data.
  // A throw here would be a genuine bug, not a clarification case — 500.
  try {
    const bill = calculateBill(parsed.items, parsed.discountPercent ?? 0);
    const formatted = formatBill(bill, parsed.customer);
    sendJson(res, 200, {
      ok: true,
      customer: parsed.customer,
      items: bill.lines,
      subtotal: bill.subtotal,
      discountPercent: bill.discountPercent,
      discountAmount: bill.discountAmount,
      total: bill.total,
      formatted,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: `Unexpected server error: ${(err as Error).message}` });
  }
}

const server = createServer((req, res) => {
  if (req.url !== "/api/order") {
    sendJson(res, 404, { ok: false, error: "Not found. Use POST /api/order." });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed. Use POST." });
    return;
  }

  handleOrder(req, res).catch((err) => {
    sendJson(res, 500, { ok: false, error: `Unexpected server error: ${(err as Error).message}` });
  });
});

server.listen(PORT, () => {
  console.log(`Likho API listening on http://localhost:${PORT}  (POST /api/order)`);
});
