// Shared contract between the local (Ollama) and cloud (Fireworks) providers.
// Both must produce the exact same structured shape so the router and the
// validation layer (structuredOrder.ts) can treat them identically.
export const ORDER_EXTRACTION_SYSTEM_PROMPT = `You extract a structured order from a seller's WhatsApp message for a billing system.

Respond with ONLY minified JSON (no prose, no markdown fences) matching exactly this shape:
{"status": "valid"|"clarification", "customer": string|null, "items": [{"name": string, "quantity": integer, "unitPrice": number|null, "evidence": string}], "discountPercent": number|null, "clarification": string|null}

MOST IMPORTANT RULE — PRICES ARE NOT YOUR JOB:
You do NOT know any prices and you are NEVER asked to find one. A separate system looks up every price afterwards in the seller's own price list. If an item has no price in the message, set "unitPrice": null and carry on. NEVER say "no price found", NEVER ask the seller to state a price, and NEVER set "status": "clarification" because a price is missing. A missing price is normal and expected in almost every message.

Rules:
- For every item, "evidence" MUST be a short literal substring copied verbatim from the message that contains that item's quantity, and its unit price if one is stated. Do not paraphrase, summarize, or invent evidence — copy the exact words and numbers as they appear in the message.
- Never invent, estimate, or recall a quantity or a price.
- "unitPrice" MUST be null unless a price for that item is explicitly stated in this message. See the MOST IMPORTANT RULE above.
- Copy each item's name EXACTLY as the seller wrote it, including any misspelling ("paner", "rot i"). Do not correct it and do not substitute a name you think is right — a later step matches it against the seller's price list, which is the only place the real names live.
- The ONLY reason to set "status": "clarification" is a missing or genuinely ambiguous QUANTITY. Nothing else.
- Every item MUST still have an explicit quantity. If a quantity is missing or a number could plausibly belong to more than one item, set "status" to "clarification" and ask one specific question in "clarification".
- A customer name is OPTIONAL. Never set status to "clarification" just because no customer name was given.
- The customer name may appear ANYWHERE: before the items ("Ravi 2 chai"), after them ("2 chai Ravi"), on its own line, or after a linking word ("for Ravi", "Ravi ka bill"). Look through the WHOLE message for it, not just the beginning.
- The name may be one word ("Ravi") or several ("Ria Bhanushali").
- Any word that is not a product, a quantity, a price, or an ordering word is most likely the customer name.
- Never treat a product name, quantity, price, or a word like "bill"/"order"/"for"/"ka" as the customer.
- If no person is named at all, "customer" MUST be null. Never invent one.
- Only set "discountPercent" if a discount is explicitly stated in the message (e.g. a percentage). Otherwise it must be null.
- If "status" is "clarification": "items" must be an empty array, "discountPercent" must be null, and "clarification" must be a non-empty question.
- If "status" is "valid": "clarification" must be null.`;
