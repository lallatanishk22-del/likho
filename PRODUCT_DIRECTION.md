# ZBill / Likho — Product Direction

**Status: current. This document takes precedence over any conflicting
detail in CLAUDE.md.** Where CLAUDE.md describes `zbill` as *the* trigger,
read this instead: natural language is the trigger, `/zbill` is a shortcut.

---

## The one rule

ZBill is a **chat-first billing assistant**. The seller talks to it.

**Do NOT:**
- redesign ZBill into a traditional billing app or dashboard
- make slash commands the primary interaction
- make sellers fill forms, pick products from lists, or move between screens
  for normal billing

Telegram is the **current channel** for the MVP. The core must stay
channel-independent so WhatsApp can be added later without rebuilding it.

---

## Primary interaction

```
Seller:  Ravi 2 paneer 1 lassi

ZBill:   Got it — Ravi's order:
         Paneer × 2
         Lassi × 1

         Total: ₹520

         [Confirm] [Edit]
```

The seller should not have to learn commands. These must all be understood
as natural language:

- `Ravi 2 paneer 1 chai`
- `Ravi ka bill bana`
- `Ravi paid 500`
- `show Ravi's bills`
- `Ravi owes me?`
- `make pdf for this`
- `actually paneer was 3`

Slash commands may exist as internal or power-user shortcuts. They must
never be **required** for normal usage.

---

## Forwarding is first-class

The seller should be able to **forward the customer's message** to ZBill
rather than retyping or copy-pasting it.

```
Customer:  2 paneer, 1 rasmalai and 3 pani puri
           ↓ (seller forwards to ZBill)
ZBill:     [bill]
```

Do not assume the seller will happily copy-paste between apps repeatedly.
Treat forwarding as a first-class input path wherever Telegram allows it.

---

## Customer identity

- Do **not** require importing the seller's contact list.
- ZBill keeps its **own** customer records (`Ravi` → `CUS-018`), accumulating
  orders, payments and outstanding balance.
- Unknown customer → lightweight association prompt:
  `Who is this customer?  [ Ravi ]  [ New customer ]`
- Customer memory emerges from usage. The seller never maintains a CRM.

## Order numbers

- Every bill has a **unique order number** (`Bill #1042`). It is the
  guaranteed identity of the transaction.
- Referable in conversation: `#1042 paid`, `show #1042`, `make PDF for #1042`.
- **Customer identity and order identity are separate.** Order #1042 belongs
  to Ravi. Never use the customer name as the transaction identifier.

---

## Natural language → structured data

```
"ravi 2 paneer 1 lassi"
  ↓
{ customer: "Ravi",
  items: [ {name:"paneer", quantity:2}, {name:"lassi", quantity:1} ] }
```

**The AI is never the source of truth for money.**

| AI does | Deterministic code does |
|---|---|
| understands intent | product prices |
| extracts customer | quantities → subtotals |
| extracts products & quantities | discounts, taxes, delivery |
| detects corrections | total |
| determines requested action | payments, outstanding balance |

Money calculations stay deterministic and tested.

---

## The bill is an artifact, not a paragraph

```
🧾 Ravi — Bill #1042

Paneer × 2      ₹440
Lassi  × 1       ₹80

TOTAL           ₹520

Payment: Pending

[Confirm] [Edit] [PDF] [Mark Paid]
```

Use Telegram-native buttons where appropriate. The seller should get from
**conversation → bill → action** without unnecessary typing.

---

## Corrections

Natural correction is a core requirement, not a nice-to-have.

```
Seller: Ravi 2 paneer 1 chai
ZBill:  Ravi — Bill #1042 · Total ₹250  [Confirm] [Edit]
Seller: actually paneer was 3
ZBill:  (updates #1042 — does NOT create a new unrelated order)
```

The system must understand conversational context.

## Payment

Conversational too: `Ravi paid 500`, `#1042 paid`, `Ravi paid cash`,
`mark #1042 paid`. Financial state changes get clear confirmation wherever
there is ambiguity.

## PDF

Optional action only. The normal flow must never require generating one.
`make pdf` or the `[PDF]` button.

---

## Architecture

```
Telegram
   ↓
Telegram adapter / webhook
   ↓
ZBill conversation layer
   ↓
Intent + entity extraction
   ↓
Structured business action
   ↓
Deterministic billing engine
   ↓
Supabase
   ↓
Telegram response / bill artifact
```

Conceptually:

```
Message Channel → Normalized Message → ZBill Core → Action → Response → Channel Adapter
```

**Core business logic must not depend on Telegram-specific code.** Telegram
is the interface now; WhatsApp may be later. Do not build WhatsApp
infrastructure now.

---

## MVP goal

The goal is **not** every billing feature. It is to get the bot LIVE in front
of real sellers.

The critical loop:

1. Seller opens the ZBill Telegram bot
2. Sends a natural-language order **or forwards** one
3. ZBill understands it
4. Structured order created
5. Deterministic engine calculates the bill
6. Clean bill artifact shown
7. Seller confirms / edits
8. Order gets a unique number
9. Optional: PDF, record payment

Optimize for: speed · reliability · low cognitive load · natural language ·
minimal steps · clear financial confirmation · recoverability when the AI
misunderstands.

Do NOT add dashboards, forms, CRM screens, or command-heavy UX.

We are validating whether sellers will actually use a conversational
billing assistant.
