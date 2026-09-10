# CLAUDE.md

> **Read [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) first.** It is the
> current product direction and takes precedence wherever it conflicts with
> this file — most importantly: ZBill is chat-first, natural language is the
> primary interface, and slash commands are optional shortcuts, not the
> product.

This file provides guidance to Claude Code when working on the Likho codebase.

# Likho — Product Vision

## What is Likho?

Likho is a **WhatsApp-native business operating system**, starting with one extremely simple wedge:

> **The business owner types an order. Likho turns it into a correct, professional bill and records the transaction automatically.**

The long-term vision is to become an **AI business assistant / business memory layer** for small businesses.

The owner should not have to learn complicated software. They should be able to communicate with Likho naturally through WhatsApp.

### Initial Customer Segment

V1 should focus on **WhatsApp-first small businesses that currently bill manually or semi-manually**, especially:

- Home-food / tiffin businesses
- Small restaurants
- Small food sellers
- Other businesses receiving orders through WhatsApp without a fully automated billing/POS system

Likho is **not initially trying to replace businesses that already have highly automated billing systems**.

The first validation question is:

> **Will a WhatsApp-first business repeatedly use Likho to turn real orders into real bills?**

---

# The V1 Product — WhatsApp Billing

V1 has ONE primary job:

> **Seller types an order → Likho understands it → Likho calculates the bill → Likho shows a preview → Seller confirms → Likho formats and sends the bill → Likho records the transaction.**

The seller should not need to learn a complicated interface.

### Primary Trigger

The explicit billing shortcut can be:

> `zbill Ramesh 5 dabba ₹180 each`

`zbill` means: **create a bill from this message.**

Over time, if Likho detects a high-confidence order without `zbill`, it may surface a lightweight suggestion such as:

> **✨ Create bill with Likho**

This should never silently create a financial record. The seller must explicitly confirm.

### Adaptive Bill Output

Do **not** generate a PDF for every transaction.

Default output should be the simplest useful format:

- Small/simple bill → clean formatted WhatsApp message/card
- Visual business template → formatted image
- Formal/large bill → PDF
- PDF can always be optionally requested

The goal is:

> **Make the bill feel native to the workflow, not like file-management software.**

Example seller message:

> Rahul 2 paneer tikka 3 naan 2 coke 10% discount

Likho should understand:

- Customer: Rahul
- Paneer Tikka × 2
- Naan × 3
- Coke × 2
- Discount: 10%

Likho looks up the current prices from the business database.

Example:

- Paneer Tikka × 2 = ₹560
- Naan × 3 = ₹120
- Coke × 2 = ₹80
- Subtotal = ₹760
- Discount = ₹76
- Total = ₹684

Then return a clean bill:

```
RAHUL

Paneer Tikka × 2 — ₹560
Naan × 3 — ₹120
Coke × 2 — ₹80

Subtotal — ₹760
Discount — −₹76

TOTAL — ₹684

Bill #1047
```

The transaction is then stored in the database.

---

# Critical Architecture Principle

The LLM must NOT be responsible for financial calculations.

The LLM's job is:

> Understand messy human language and convert it into structured order data.

Our code's job is:

> Look up prices, validate data, calculate money, create the bill and save the transaction.

Architecture:

```
Seller message
→ AI extraction
→ structured order
→ validation
→ database price lookup
→ deterministic calculation
→ bill generation
→ database transaction
→ WhatsApp response
```

Money calculations must always be deterministic.

---

# Example Input Variations

The seller may type naturally:

- "Rahul 2 paneer tikka 3 naan 2 coke"
- "Rahul - 2 paneer, 3 naan, 2 coke"
- "rahul 2 paneer tikka + 3 naan + 2 coke, 10% discount"
- "Rahul ka bill bana 2 paneer 3 naan"
- "2 paneer tikka\n3 naan\n2 coke\nRahul"

The system should handle normal messy seller input.

However:

## Never guess when the ambiguity could cause a financial error.

If the system isn't confident, ask for clarification.

Example:

> I understood:
> Paneer Tikka × 2
> Naan × 3
> Coke × 2
>
> Please confirm before I create the bill.

The system should fail safely rather than silently creating an incorrect bill.

---

# Pricing and Financial Correctness

Prices can change frequently, especially for home-food businesses and small restaurants.

Likho must distinguish between:

- The business's current default product price
- A price explicitly stated in the current order
- A customer-specific or order-specific price

When a bill is created, the **actual unit price used for that bill must be stored as a snapshot**.

The final bill must never change retrospectively just because the business later changes its product price.

Example:

> Current Dosa price = ₹80

If today's order explicitly says:

> `Ramesh 5 dosa ₹70 each`

the bill uses ₹70 and stores ₹70 as the transaction price.

---

# Bill Template System

V1 should support a simple, reliable bill format.

Longer-term, a business can provide an existing bill/template and Likho can preserve its structure while replacing only the relevant fields.

The preferred architecture is:

> **AI understands the order → structured data → deterministic template renderer → final bill**

Do NOT use image generation as the financial source of truth.

The template system should eventually support:

- Business logo
- Business name
- GST/tax details
- Bill number
- Customer name
- Date
- Items
- Quantities
- Unit prices
- Discounts
- Taxes
- Total
- Payment status
- Optional UPI/payment information

The goal is **template fidelity**, not generating a new design every time.

---

# Database

Use Supabase/Postgres.

Minimum entities:

## businesses

Stores each business using Likho.

- business_id
- business_name
- owner/contact information
- WhatsApp identity
- tax/GST configuration
- bill configuration
- created_at

## products

Each business has its own products.

- product_id
- business_id
- name
- price
- tax rate if applicable
- active/inactive
- created_at
- updated_at

## customers

Customer records associated with a business.

## orders

One order submitted by a seller.

- order_id
- business_id
- customer
- original message
- parsed order
- status
- timestamps

## order_items

Individual items within an order.

- product
- quantity
- unit price
- line total

## bills

The final financial record.

- bill number
- order_id
- subtotal
- discount
- tax
- total
- payment status
- timestamps

## messages

Store incoming/outgoing WhatsApp messages and their IDs.

This is important for debugging and preventing duplicate processing.

---

# Payment State

Payments are not required for the first V1 workflow, but the data model should support them from the beginning.

A bill can have:

- Pending
- Partially paid
- Paid
- Payment disputed/needs confirmation

Future UX:

If a customer says:

> "Paid ₹450"

Likho can surface to the seller:

> **Did you receive ₹450 from Ramesh?**
> **YES / NO**

The seller's confirmation updates the payment record.

Do not attempt to infer a successful payment from a customer's message alone.

Automatic UPI/bank reconciliation can be explored later.

---

# Reliability

Likho is a billing product, so correctness is more important than AI cleverness.

Every order should move through a traceable pipeline:

```
RECEIVED
→ PARSED
→ VALIDATED
→ CALCULATED
→ BILL_CREATED
→ SENT
```

If something fails, we should know exactly where.

Examples:

- AI parsing failed
- product not found
- ambiguous quantity
- price missing
- database error
- WhatsApp delivery failure

Never silently fail.

Never silently create a potentially incorrect financial record.

---

# Duplicate Protection

WhatsApp/webhooks can potentially deliver the same event more than once.

Use the WhatsApp message/event ID to make processing idempotent.

If the same message is received twice:

Do NOT create two bills.

The system should recognize that it has already processed that message.

---

# Failure Handling

If AI fails:

> "I couldn't understand this order. Please send the items and quantities again."

If a product is unknown:

> "I couldn't find 'Paneer Special' in your menu. Please check the product name."

If a quantity is ambiguous:

> "Did you mean Paneer Tikka × 2?"

If the database is temporarily unavailable:

Do not create a fake bill.

Save the incoming message if possible and retry processing.

If WhatsApp sending fails:

The bill should still exist in the database and be marked as unsent/failed so it can be retried.

---

# Business Onboarding

For V1, onboarding should be extremely simple.

The business should be able to provide:

- Business name
- Owner/contact
- Products
- Prices
- WhatsApp connection
- Optional existing bill/template

The owner should not have to manually build a complicated CRM.

The system should gradually create the business data layer from real usage.

---

# CRM / Master Data Philosophy

The CRM website is primarily the **data and control system**, not the daily user interface.

WhatsApp is the **action layer**.

The underlying system automatically accumulates:

> Customer → Order → Bill → Payment → Transaction history

The business can later open the web dashboard to inspect:

- Customers
- Bills
- Payments
- Outstanding balances
- Orders
- Products
- Sales

The goal is:

> **The CRM builds itself from normal business activity.**

Do not make the owner maintain a CRM manually.

Long-term philosophy:

> Don't make small businesses learn software. Let them talk to it.

---

# Two-Chat Concept — Future

Eventually Likho can have two distinct interactions.

## 1. Billing Chat

This chat is ONLY for transactions.

Seller sends:

> Rahul 2 paneer 3 naan coke 2

Likho creates the bill.

No business configuration should happen here. This keeps billing extremely predictable.

## 2. Master Assistant

A separate Likho conversation becomes the business's AI assistant.

The owner could say:

> Add paneer tikka ₹280.
> Change coke to ₹40.
> Add masala dosa ₹120.
> What's today's sales?
> Show unpaid bills.
> How much does Rahul owe?
> Change my GST setting.

The Master Assistant can eventually use tools to modify the business database.

**IMPORTANT: This is NOT part of V1. The V1 priority is billing.**

---

# Long-Term Vision

Likho eventually becomes:

> **An AI assistant that lets a small business operate itself through conversation.**

The business owner shouldn't need to navigate ten different dashboards. They should be able to ask Likho:

"How much did I sell today?" · "Who hasn't paid?" · "Add this product." · "Change this price." · "Create a bill." · "How much did we spend this month?" · "Which product sells the most?" · "How much money should I collect today?"

Likho uses the underlying business database as the business's memory/source of truth.

---

# Long-Term Data Model

```
Business
→ Products
→ Orders
→ Bills
→ Customers
→ Payments
→ Ledger
→ Inventory
→ Expenses
→ Suppliers
→ Analytics
```

The billing system is the first source of structured business data. That is strategically important.

A bill creates a transaction. A transaction creates financial history. Financial history creates a ledger. The ledger becomes the business's memory. The AI assistant can then reason over that business data and take actions through tools.

---

# Future Channels

The core business engine should eventually be channel-independent.

Potential interfaces: WhatsApp, Instagram, Slack, Web dashboard, Voice.

But all of them should eventually interact with the SAME underlying business system.

```
                LIKHO CORE
                   |
    +--------------+--------------+
    |              |              |
 WhatsApp      Instagram       Slack
    |              |              |
    +--------------+--------------+
                   |
            Business Database
                   |
    Products / Orders / Bills / Ledger
```

Do NOT build these additional channels in V1.

---

# RAG

RAG is NOT required for V1.

The first system primarily needs: LLM, structured outputs, tool calling, Supabase/Postgres, deterministic business logic.

RAG can be added later for unstructured business knowledge such as old menus, policies, documents, historical information, supplier information, business knowledge.

Do not add RAG just because this is an AI product.

---

# AI Tooling

The eventual Master Assistant can have tools such as:

- add_product()
- update_product_price()
- remove_product()
- get_product()
- create_bill()
- get_sales()
- get_customer()
- get_outstanding_payments()
- update_business_settings()

Actions involving money or important business data must have validation and appropriate confirmation/permissions.

---

# Product Philosophy

The most important principle:

> **AI interprets. Software executes.**

The LLM should understand what the seller means. The application should determine what actually happens.

For example:

LLM: "2 Paneer Tikka"

Application:
```
product_id = 123
quantity = 2
unit_price = ₹280
line_total = ₹560
```

The application calculates: subtotal → discount → tax → total

Never trust an LLM-generated total as the financial source of truth.

---

# Ganpati Launch Goal

The first real launch is intended around Ganesh Chaturthi 2026.

The goal is NOT to launch a huge SaaS platform. The goal is:

> **Get real businesses using Likho for real transactions.**

Initial target: 5–20 businesses.
Stretch target: 50–100 businesses if the product proves stable and distribution works.

The most important metrics:

- number of activated businesses
- number of real bills
- bills per business
- parsing success rate
- bill correction rate
- failed transactions
- repeat usage
- businesses that continue using Likho without being reminded
- willingness to pay

---

# Launch Pricing Experiment

The initial Ganpati pilot can use a symbolic low-friction offer.

Potential concept:

> First 101 transactions → free
> Then ₹101 to continue

The purpose is not immediate revenue. The purpose is to determine:

> Will a real business repeatedly use Likho for real transactions?

If businesses reach 101 transactions and want to continue, that is strong product validation.

Pricing can be changed after the pilot based on actual usage and value.

---

# V1 Scope — STRICT

For the first version, ONLY build:

1. WhatsApp message receiving
2. Explicit `zbill` trigger
3. Seller order parsing
4. Product lookup
5. Deterministic price calculation
6. Discount calculation
7. Price snapshotting
8. Bill preview + explicit seller confirmation
9. Simple formatted bill output
10. Bill storage
11. Transaction storage
12. Basic business/product setup
13. Basic template configuration
14. Basic error handling
15. Logging/debugging
16. Duplicate protection

A lightweight high-confidence `zbill` suggestion can be added after the explicit-trigger flow is stable.

DO NOT build yet:

- Instagram
- Slack
- Voice calling
- RAG
- Multi-agent architecture
- Advanced analytics
- Complex CRM workflows
- Inventory management
- Large dashboard
- Fancy UI
- Automatic payment integrations
- Marketing/ads
- Full restaurant menu/order system
- Complex Canva integration
- Huge automation system

Those are future possibilities.

---

# Validation Principle

The first goal is not to build a large SaaS platform.

The first goal is:

> **Get 5–20 real businesses to use Likho for real transactions.**

The most important early metrics are:

- Activated businesses
- Real bills generated
- Bills per business
- Repeat usage
- Parsing success rate
- Bill correction rate
- Failed transactions
- Time saved per bill
- Businesses that continue using Likho without reminders
- Willingness to pay

The product should be tested with businesses that currently rely on WhatsApp plus manual/semi-manual billing.

---

# Development Principle

Build vertically, one working piece at a time.

- Phase 1: Receive a text message.
- Phase 2: Parse the order.
- Phase 3: Look up products/prices.
- Phase 4: Calculate the bill.
- Phase 5: Format the bill.
- Phase 6: Store the transaction.
- Phase 7: Send the result back through WhatsApp.
- Phase 8: Add reliability, retries, duplicate protection and monitoring.

After each phase: run tests, verify behavior, commit working code.

Do not build the entire system in one giant step.

---

# The Core Product in One Sentence

> **Likho lets a business owner type an order naturally on WhatsApp, and automatically turns it into a correct bill and permanent transaction record.**

That is the V1.

The larger vision is:

> **Likho becomes the conversational operating layer and financial memory of a small business.**
