# Likho — Research Pack for the Seva Innovation Challenge 2026

Prepared 13 Oct 2026. Research only. No slides, no code changes.

**Template used:** `Seva-First-Innovation-Challenge-PPT-Template for Students.key` (Atlas SkillTech University version, 6 slides). Each section below follows that template's prompts.

**Labels used on every finding**

| Label | Meaning |
|---|---|
| **[EXT]** | Verified external fact, with source |
| **[CODE]** | Verified from our codebase, database or tests |
| **[EST]** | Estimate, with its assumptions shown |
| **[HYP]** | Unverified hypothesis; needs field validation |

**Two rules that apply to the whole deck**

1. **We have no real sellers yet.** Every bill in our database was made by our own team while testing. No interviews, pilot, revenue or measured time savings exist. Nothing below should be read as traction.
2. **WhatsApp is not built.** The working product runs on **Telegram**. WhatsApp is the planned channel only.

---

## Template requirements at a glance

| Slide | What the template asks for |
|---|---|
| 1 | Name of innovation; one line on what it does and for whom |
| 2 | What is the problem; who is affected and where; one key number (people affected); evidence (govt data or own survey with sample size and date); current gaps; why it matters |
| 3 | Solution in 3–4 lines plus a screenshot; Input → Process → Output; a table comparing **existing vs our approach** on Cost, Speed/time, Reach/access, Ease of use; Key USP (and any patent) |
| 4 | Current stage (Idea / Proof of Concept / Working Prototype / Field Pilot / Ready to Deploy); technology; cost per user and pilot total; 3/6/12-month milestones; partners |
| 5 | Three big numbers: beneficiaries in year 1, % saving in cost/time, jobs or livelihoods; social impact; sustainability; scale-up plan |
| 6 | Up to 4 team members (name, role, qualification); mentor/faculty guide; support sought (5 checkboxes); one line on how support helps; contact |

Template notes: "facts and numbers with sources", photos of the prototype, PDF under 10 MB.

---

## SLIDE 1 — Name of the Innovation

### Facts we can use

| Finding | Label | Evidence |
|---|---|---|
| **Likho** turns a typed or forwarded order message into a priced, numbered bill, and records it | [CODE] | `src/messageHandler.ts` → `handleOrder`; end-to-end test `npm run eval:e2e` (49/49 checks pass, 12 Oct 2026) |
| Works in plain chat, including Hinglish (`ek paneer tikka aur do butter naan`) and typos (`2 panner`) | [CODE] | `eval:hinglish` 26/26, `eval:typos` 10/10 (12 Oct 2026) |
| Runs today as a **Telegram bot**, @zbillingbot | [CODE] | `src/telegramBot.ts`; bot command menu confirmed via Telegram API |
| Built for small sellers who take orders over chat: home food and tiffin, small restaurants, small shops | [CODE] | Setup asks "What do you sell?" with exactly these options (`src/onboarding.ts`) |

### What it is (accurate one-liners to choose from)

- "A chat assistant that turns a seller's order message into a correct bill and a running record of who bought, who paid, and who still owes."
- Safe wording: "type the order, get the bill". **Avoid** "on WhatsApp" (not built) and "fully automatic" (the seller confirms bills).

### Caveats

- The product name in some places is **ZBill** (`/zbill` command, @zbillingbot). Decide on one public name before the deck.
- Real screenshots exist in the chat with the bot. Use the **Receipt** bill, the **Ledger PDF**, and the **sales summary**. Use a test shop, not one with real customer names.

---

## SLIDE 2 — The Problem

### The problem in plain words (based on our product, not a survey)

Small sellers receive orders as chat messages ("Rahul 2 samosa 1 chai"). Turning each into a correct bill, keeping track of who paid, and knowing what they sold this month is done by hand, in a notebook, or not at all. **[HYP]** We have not yet measured how often this happens or how long it takes. See Gaps.

### Key numbers (official, defensible)

| Figure | Scope | Label | Source | Why it matters |
|---|---|---|---|---|
| **7.92 crore** unincorporated non-agricultural establishments; **12.81 crore** workers | All India, Jan–Dec 2025 (ASUSE 2025) | [EXT] | MoSPI ASUSE 2025, reproduced by TaxTMI (press note dated 24 Mar 2026); also ANI/Punjab Kesari | Best size of the informal small-business sector Likho serves. Use as **context**, not as our customer count. |
| **7.34 crore** establishments, **12+ crore** workers | All India, Oct 2023–Sep 2024 (ASUSE 2023-24) | [EXT] | MoSPI Press Note, 29 Jan 2025 | Same series, previous year. Full official PDF read. |
| **~27%** of the establishments are **retail trade** | All India, ASUSE 2023-24 | [EXT] | MoSPI Press Note, 29 Jan 2025, Table 1 (27.07%) | Retail is the single biggest activity. Our "Shop/retail" users are here. |
| Female-headed proprietary establishments: **26.17%** overall (2023-24), **27.0%** (2025); **58.36%** in manufacturing | All India | [EXT] | MoSPI Press Note 29 Jan 2025 (Fig. 1); ASUSE 2025 via TaxTMI | Supports the women-led segment. Home food is classed under manufacturing/services, so check the exact category before claiming "58%" for food sellers. |
| Internet use for business: **26.7%** of establishments (2023-24) → **39.4%** (2025). In 2023-24: rural 17.9%, urban 37.0%; own-account (no hired worker) 21.7%; with hired workers 58.5% | All India | [EXT] | MoSPI Press Note 29 Jan 2025 (Fig. 2); ASUSE 2025 via TaxTMI | **The core gap:** about 60% of small establishments still don't use the internet for business, and the smallest (no employees) use it least. |
| Registered with at least one authority: **37.2%** | All India, 2023-24 | [EXT] | MoSPI Press Note 29 Jan 2025 | Most of the sector is informal: no formal bills or books. |
| **Maharashtra** is among the top 3 states by number of establishments (with UP and West Bengal) and **#1 by GVA** | ASUSE 2023-24 | [EXT] | MoSPI Press Note 29 Jan 2025 | Our zone. No exact Maharashtra count found. See Gaps. |
| **9.16 crore** MSMEs registered on Udyam + Udyam Assist; **~99.4% micro** (9,11,07,705 micro, 5,40,908 small, 41,722 medium) | All India, as of 31 Jul 2026 | [EXT], secondary | Rajya Sabha reply, as reported by Kashmir Life; earlier figure 8.84 crore (30 Jun 2026, KNN) | Formal (registered) side. The breakdown sums to ~9.17 crore, not 9.16. Confirm on Sansad/MSME site. |
| Only **15% (~5 million)** of 30 million formalised small merchants sell online | India, survey Oct 2023 (7,800 users, 150 businesses) | [EXT] | Bain & Meta, "Win with Conversations", May 2024 | Shows digital tools haven't reached most small merchants. |

**Which number for the "X people affected" box?** The most defensible is **"7.92 crore small unincorporated establishments in India (MoSPI ASUSE 2025), of which about 60% do not use the internet for business."** Label it as the *sector* size, not the number with this exact problem.

### Evidence about the problem itself (the billing and records pain)

| Finding | Label | Source | Does it measure *our* problem? |
|---|---|---|---|
| "Finding the right digital tools" was the top difficulty for **52.6%** of 7,835 MSMEs surveyed in 2024-25; **97.3%** unaware of government digitalisation schemes | [EXT], secondary | India SME Forum / META report "Breaking Barriers, Building Futures", Dec 2025 | Context only. It's about digital tools in general, not billing. Read the full report before citing. |
| 84% of "digitally hesitant" MSMEs unclear on the value of digital tools; 56% limited proficiency | [EXT], vendor research | CyberMedia Research (CMR) | Context only, and it's market research, not official. |
| Vendors estimate **2–2.5 hours a week** spent creating invoices manually for a business making ~100 invoices a month | [EXT], vendor claim | Tide India press release (CXOToday) | Closest to our problem, but it's a vendor's own estimate with no published method. **Do not use as a headline.** |
| Women-run "WhatsApp-only" businesses identified as a distinct seller segment | [EXT] | Women's World Banking, Social Commerce report (2019, India and Indonesia) | Supports the segment's existence. Old, and not quantified for billing. |

**Not found:** no credible source counts **how many Indian sellers manually turn chat messages into bills**, or how long it takes them. We must not substitute another number. This is exactly what our own survey should measure (see Gaps).

### Current gaps (what exists today and why it's not enough)

- **Paper notebook / mental arithmetic:** free, but no record, totals done by hand, dues forgotten. **[HYP]**, not measured.
- **Billing apps** (Vyapar, myBillBook, Khatabook): form-based. The seller picks items and quantities on screens. Paid plans cost roughly **₹400–₹7,000 a year** (see Slide 3). **[EXT]** for features; prices from third-party sites.
- **WhatsApp Business app:** used for chatting with customers. We did not verify any built-in invoicing, so don't claim it has none.

### Why it matters (cost of inaction)

- No proper record of sales means no proof of income, which makes loans hard. MoSPI shows outstanding loans per establishment are only **₹53,710** on average **[EXT]**. A link between bill records and credit access is **[HYP]**.
- Mistakes in bills cost money directly. **[HYP]**, no measured error rate exists for this segment.

---

## SLIDE 3 — Solution & Innovation

### How Likho works (all verified in code)

| Step | What happens | Label | Evidence |
|---|---|---|---|
| **Input** | The seller types or forwards the order in chat: `Rahul 2 paneer tikka 3 naan 10% discount`. Hinglish and typos are fine. | [CODE] | `eval:hinglish` 26/26, `eval:typos` 10/10 |
| **Process 1: understand** | An AI model pulls out customer, items and quantities. A local model (Ollama, qwen2.5 7B) runs first, and a cloud model (Fireworks gpt-oss-120b) is the fallback. | [CODE] | `src/router.ts`, `src/localAiParser.ts`, `src/cloudAiParser.ts` |
| **Process 2: check** | A trust layer rejects any quantity or price not actually in the message. If unsure, it **asks** instead of guessing. | [CODE] | `src/structuredOrder.ts`; 156 of 1,038 logged parses ended in a clarifying question |
| **Process 3: price and calculate** | Prices come from the seller's saved list. **All money maths is done by code, never by AI**, rounded to the paisa, and discounts can't go negative. | [CODE] | `src/calculator.ts`; unit tests |
| **Output** | A numbered bill (receipt layout) with Confirm / Mark Paid / PDF buttons. The record is saved: customer, items, the price used at that moment, and payment status. | [CODE] | `src/chatFormat.ts`, `src/billStore.ts`; e2e test |
| **Records** | Sales for any day, week, month or year, and per customer: Billed / Received / Due, plus a spreadsheet-style **Ledger PDF**. | [CODE] | `src/ledger.ts`, `src/templates/ledger.ts`; e2e test |

### Capability verification (safe claims)

| Capability | Status | Safe claim |
|---|---|---|
| Natural-language order input | **Verified** | "Type the order as you'd write it, in English or Hinglish" |
| Item and quantity extraction | **Verified**, with limits | Evals pass (see Slide 4). Not tested on real sellers' messages. |
| Price lookup from seller's list | **Verified** | "Prices come from your own list; a price stated in the order wins for that bill" |
| Deterministic calculation | **Verified** | "Totals are calculated by code, not AI" |
| Bill format and numbering | **Verified** | Sequential bill numbers per shop, assigned in the database |
| Customer / order memory | **Verified** | Customers are created automatically from bills, with per-customer dues and ledger |
| Payments (full / part / overpaid) | **Verified** | Recorded only when the **seller** states it |
| Duplicate protection | **Verified** | One message makes at most one bill |
| Seller confirmation | **Verified**, partial | Bills start as drafts and the seller taps Confirm. But **unconfirmed bills still count in sales** (a design choice from 12 Oct). |
| Phone registration (Telegram-verified) | **Built, not switched on** | Needs one database change. Don't demo until done. |
| Telegram | **Verified, live** | Running on the founder's Mac |
| **WhatsApp** | **Not built** | Only "planned". Meta business verification not done. |
| PDF bills, 6 styles | **Verified** | Uses Chrome on the host machine |
| Cancel a wrong bill | **Not built** | Known gap |

### Comparison table ("existing approach" vs "our approach")

Competitor facts are from third-party listings, because the official pricing pages load by JavaScript and couldn't be read. **Re-check each price on the official site before printing.**

| | Manual notebook | Vyapar | myBillBook | Khatabook | Likho (today) |
|---|---|---|---|---|---|
| **Cost to seller** | ₹0 | ~₹699/yr (mobile) to ~₹3,399–4,299/yr (desktop); free mobile tier reported. 18% GST extra. [EXT, 3rd-party] | From ₹399/yr (official FAQ); listed tiers ~₹217–417/month billed yearly [EXT, mixed] | Not found. Do not state. | **₹0 during pilot.** Long-term price **not set**. Planned experiment: first 101 bills free, then ₹101 (project notes) [HYP]. |
| **Our running cost per order** | — | — | — | — | ~**₹0.02–0.06** per AI call on the cloud model; **₹0** on the local model [EST]. See Slide 4. |
| **Speed / time per bill** | **Not measured** | **Not measured** | **Not measured** | **Not measured** | AI processing: median **3.3 s** across 1,038 logged parses; **4.9 s** median, 15.5 s at worst-5%, on the 20-case test (13 Oct) [CODE]. Total seller time **not measured**. |
| **Reach / access** | Anyone | App install, Android/desktop [EXT, 3rd-party] | App/web install | App install | Any phone with **Telegram**; no app to install; works in Hinglish [CODE] |
| **Ease of use** | Familiar | Form-based: pick items and quantities on screens [EXT, 3rd-party] | Form-based | Ledger-first | **One chat message**; 4-step setup [CODE]. Real-user ease **not measured**. |

**Do not** fill "Speed / time" with a % saving. No measured baseline exists.

### Key USP (defensible)

> **"The order message is the bill."** The seller sends the order the way they already write it. AI reads it, but **code does every rupee of maths** and **asks when unsure**, instead of guessing. [CODE]

Patent: none filed. Write "No patent filed".

### Caveats

- We haven't verified that competitors **lack** chat or text-to-bill features. Don't claim "only Likho does X". Say "unlike form-based apps" only after checking each competitor's current features.
- Accuracy numbers are from our **own test sets** (team-written messages), not real sellers.

---

## SLIDE 4 — Feasibility & Implementation

### Current stage

**Working Prototype.** [CODE]
- It works end to end on Telegram with a real database, real AI models, 665 automated unit tests, a 49-step end-to-end test, and AI evals.
- It is **not a Field Pilot:** no outside seller has used it.

### Technology (verified)

| Part | What we use | Label |
|---|---|---|
| Chat channel | Telegram Bot API (free) | [CODE] / [EXT] |
| AI, primary | Local model: Ollama `qwen2.5:7b` on the founder's Mac | [CODE] |
| AI, fallback | Fireworks `gpt-oss-120b` (cloud) | [CODE] |
| Database | Supabase (Postgres) | [CODE] |
| Bills | Deterministic TypeScript calculator; HTML → PDF with headless Chrome | [CODE] |
| Hosting | The founder's Mac (kept awake, auto-restart) | [CODE] |
| Automation | One n8n workflow file (daily summary) exists, but **n8n is not installed**. Don't claim it. | [CODE] |
| Safety | Seller-only payments; one-message-one-bill; API locked to the machine with a secret key; group chats refused; technical errors hidden from sellers | [CODE] |

### Test evidence (as of 12–13 Oct 2026)

| Test | Result | What it covers |
|---|---|---|
| Unit tests | **665 / 665 pass** | Maths, parsing rules, dates, payments, errors |
| End-to-end seller journey (`eval:e2e`) | **49 / 49 pass** | Setup → bill → edits → payments → reports → PDF → help |
| Hinglish orders | **26 / 26** | Hindi number words, fillers ("bhej do"), adjectives |
| Customer name extraction | **13 / 13** | Names in different positions |
| Typos | **10 / 10** | `panner`, `lasssi`, `rot i` |
| Main extraction set (`eval:routed`, 20 cases, local + cloud), re-run 13 Oct 2026 | **18/20 reliable (90%)**: 14 correct, 4 correctly asked a question, **1 silently wrong**, 1 asked when it didn't need to. Cloud fallback 25%. Time per order p50 **4.9 s**, p95 15.5 s. | Free-form orders with prices. **The silently wrong case** (#17, `bhaiya 2 lassi bana do 40 rupaye ka`): items and price were correct, but "bhaiya" ("brother", a form of address) was put on the bill as the **customer name**. A wrong name, not wrong money. The unnecessary-clarification case varied between runs. |
| Logged AI parses, 22 Aug – 12 Oct 2026 | **1,038**: 882 valid (85%), 156 clarifying question (15%); **85%** handled by the free local model; median **3.3 s** | **Includes eval and test runs, and all of it is team testing.** Not user data. |

**Known weaknesses (from project notes, `LEARNINGS.md`):**
- Correcting an earlier order by message: **0% success** in early experiments. A newer deterministic path exists but hasn't been re-measured.
- The local model is slow on the first order after idle (~13 s).

### Cost per user and per order

**Assumptions:** cloud fallback on ~15–20% of orders (as observed); ~1.5 AI calls per bill; ₹85 per US$ (assumption, not sourced).

| Item | Price | Label | Source |
|---|---|---|---|
| Fireworks gpt-oss-120b | **$0.15** per 1M input tokens, **$0.60** per 1M output | [EXT], aggregators (dated Aug 2026) | computeprices.com, futureagi.com. Confirm on fireworks.ai. |
| Tokens per call | ~800 in, 150–1,000 out | [CODE] + [EST] | Prompt size measured (2,977 chars); output varies |
| **Cost per cloud call** | ≈ **$0.0002–0.0007 (₹0.02–0.06)** | [EST] | From the two rows above |
| **AI cost per seller per month** at 300 bills, 20% cloud | ≈ **₹5–30** | [EST] | 300 × 1.5 × 20% × ₹0.02–0.06, rounded up generously |
| Telegram Bot API | **Free**. Paid only for broadcasting above 30 msgs/sec. | [EXT] | core.telegram.org/bots/faq |
| Supabase | Free tier (pauses after ~7 days idle); **Pro $25/month** | [EXT], third-party | Confirm on supabase.com/pricing |
| Cloud server (if moved off the Mac) | Not priced yet | Gap | Get a quote: Railway, Render, Fly.io, or an Indian VPS |
| WhatsApp (future) | ~**₹0.115 per utility message** in India (from Jan 2026), but one source says ₹0.35. INR billing mandatory by 31 Dec 2026. | [EXT], conflicting | Meta developer docs (INR billing confirmed); rate from third parties. Confirm before budgeting. |

**Illustrative pilot budget** [EST], 20 sellers × 3 months:
- AI: about ₹1,800 at most
- Supabase Pro: about ₹6,400
- Cloud server: unknown
- **Biggest cost:** people time for onboarding and support. Not estimated. Get your own hours.

### Timeline (proposal, all [HYP])

| When | Milestone |
|---|---|
| 0–3 months | 15–20 seller interviews; measure billing time; pilot with 5–10 sellers on Telegram; fix "cancel bill" and correction gaps; move hosting off the laptop |
| 3–6 months | WhatsApp channel after Meta business verification; pilot with 20–50 sellers; publish measured accuracy and time saved |
| 6–12 months | Pricing experiment (101 free bills, then ₹101); expand to 2–3 cities in Maharashtra |

### Partners

**None confirmed.** Possible fits, labelled "potential" only:
- MSME Development & Facilitation Office (DFO) Mumbai
- Maharashtra State Rural Livelihoods Mission (UMED) self-help groups, for women-run home food
- An incubator at our university
- Local tiffin associations

---

## SLIDE 5 — Impact & Scalability

### What exists today

- **Verified present-day impact: none.** Zero outside users.
- **Measured time or cost saving: none.**

### Beneficiaries (first year), with the method shown [EST]/[HYP]

> Beneficiaries = sellers onboarded × (1 + customers who receive bills, if we count them)

**Example target:** 50 sellers in year 1 = 5 pilot + 45 through word of mouth and SHG partners. If each bills ~30 regular customers, about 1,500 customers receive proper bills. **[HYP]** This is a target, not an outcome. Write "target".

### % saving in cost or time

- **Must be measured, not claimed.** Formula: % time saved = (baseline time per bill − Likho time per bill) ÷ baseline × 100.
- Baseline: time the seller takes today, from receiving the order to having a bill or total. Measure it with a stopwatch on 10 orders per seller (see Gaps).
- **If the deck needs a number now:** write "Target: halve the time per bill; to be measured in pilot", clearly labelled.

### Jobs or livelihoods

- **Created: 0.** Don't claim any.
- **Supported:** say "livelihoods of the pilot sellers", counting sellers. Most are own-account businesses (one person, no employees). MoSPI shows these have the lowest internet use (21.7%) **[EXT]**.

### Social impact (supported by evidence plus product design)

- **Women-led businesses:** 27% of small establishments are female-owned **[EXT]**. Home food is a typical women-run activity **[EXT, weak]**. Likho needs no form-filling and works in Hinglish **[CODE]**.
- **Digital inclusion:** about 60% of small establishments don't use the internet for business **[EXT]**. A chat-based tool needs only a messaging app the seller already uses **[HYP]**.
- **Credit access:** a bill and ledger history could act as proof of income **[HYP]**.

### Sustainability

- Running cost per seller is low: ₹5–30 a month in AI **[EST]**.
- The planned pricing experiment is "first 101 bills free, then ₹101" **[HYP]**. It's in our project notes, not tested.
- Competitors charge roughly ₹400–₹4,300+ a year **[EXT, 3rd-party]**, so there's room below them.

### Scale-up plan

- The core engine is channel-independent: Telegram today, WhatsApp next **[CODE, design]**.
- Expand city by city through SHG networks and seller associations **[HYP]**.

---

## SLIDE 6 — Team & Support Required

### Verified team information

| Item | What we know | Source |
|---|---|---|
| Lead / builder | **Tanishk Lalla** | Git commit author on the Likho repository |
| Contact | lallatanishk22@gmail.com | Git/account email. Confirm you want it on the slide. |
| Institution | Template is the **Atlas SkillTech University** version | Template file |
| Other members, roles, qualifications | **Not found.** Fill in yourself. | — |
| Mentor / faculty guide | **Not found.** Fill in yourself. | — |

(The separate "The Disruptors" voting-proposal deck was **not** used. It's a different project.)

### Support to tick (with reasons)

| Support | Tick? | Why |
|---|---|---|
| Mentorship & technical guidance | ✔ | Moving from laptop hosting to production; data privacy for seller and customer records |
| Pilot with a government department | ✔ | Access to sellers through MSME DFO or SHG networks (UMED). This is our biggest gap: real users. |
| Funding / grant support | ✔ (small) | Hosting, WhatsApp verification and messaging costs, pilot onboarding |
| Incubation & workspace | Optional | Useful but not the bottleneck |
| Testing, certification or IP | ✗ | Nothing to certify yet; no patent planned |

**One line on how support helps** [HYP]: "With access to 20 real sellers and mentoring on production hosting, we can run a 3-month pilot and publish measured billing time and accuracy."

---

## EVIDENCE GAPS — what we must collect ourselves

| # | Missing | Why we need it (slide) | How to get it |
|---|---|---|---|
| 1 | **Seller interviews** | Proof the problem is real (2) | 15–20 sellers: home food, tiffin, small shops in Mumbai/Pune. 20-minute script: how orders arrive, how they bill, how they track dues, time spent, tools tried. Record date and sample size. |
| 2 | **Baseline billing time** | % saving (3, 5) | Stopwatch 10 real orders per seller, from order received to bill/total ready. Then the same with Likho. |
| 3 | **Accuracy on real messages** | Credibility (3, 4) | Collect 100 real (anonymised) order messages with consent. Measure correct bills, clarifications and wrong bills. |
| 4 | **Error rate in manual bills** | Cost of inaction (2) | Re-check 50 handwritten bills for arithmetic or price mistakes. |
| 5 | **Maharashtra / district counts** | "Where" (2) | Full ASUSE state tables (MoSPI report or eSankhyiki portal); Udyam state dashboard. |
| 6 | **Competitor prices and features, from official pages** | Comparison table (3) | Open each app or pricing page, screenshot it, date it. Check whether any offers chat-to-bill. |
| 7 | **Hosting quote** | Cost (4) | Price a small cloud server plus Supabase Pro for 3 months. |
| 8 | **WhatsApp message cost** | Scale-up cost (4, 5) | Meta's official India rate card, once the WhatsApp Business account is set up. |
| 9 | **Team names, roles, qualifications, mentor** | Slide 6 | From the team |
| 10 | **Pilot partner** | Partners (4) | Approach the MSME DFO Mumbai, a UMED district unit, or the university incubator. Get a letter or email of intent. |
| 11 | **Willingness to pay** | Sustainability (5) | Ask in interviews: "Would you pay ₹101 after 101 free bills?" |
| 12 | **Exact source text for secondary figures** | Accuracy | Open the META/India SME Forum PDF, Bain–Meta PDF and Udyam Rajya Sabha reply; note page numbers. |

### Known discrepancies to resolve

- **ASUSE 2025 release date:** TaxTMI's copy of the press note says 24 Mar 2026; ANI/Punjab Kesari reports the detailed release on 6 May 2026. Possibly a factsheet then the full report, as with 2023-24. Cite the MoSPI PDF itself.
- **Udyam total:** 9.16 crore stated vs ~9.17 crore by summing the categories.
- **WhatsApp utility rate:** ₹0.115 per message vs ₹0.35 per conversation in different sources.
- **Vyapar and myBillBook prices** differ across third-party sites.

---

## Source list (accessed 13 Oct 2026)

**Official / primary**
1. MoSPI, *Press Note: ASUSE 2023-24 Results*, 29 Jan 2025 (full text read). https://mospi.gov.in/sites/default/files/press_release/Press_Note_ASUSE_202324_Report%20-English.pdf
2. PIB factsheet, ASUSE 2023-24 (Dec 2024). https://www.pib.gov.in/FactsheetDetails.aspx?Id=149090
3. MoSPI ASUSE 2025 press note, as reproduced by TaxTMI (press note dated 24 Mar 2026). https://www.taxtmi.com/news?id=71724
4. ANI via Punjab Kesari, "Unincorporated sector expands 7.97% to 7.92 crore establishments" (6 May 2026). https://english.punjabkesari.com/business/unincorporated-sector-expands-7-97-to-7-92-crore-establishments-employment-rises-to-12-81-crore-mospi/
5. Telegram, Bots FAQ. https://core.telegram.org/bots/faq
6. Meta for Developers, WhatsApp Business Platform pricing. https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md
7. Seva First Innovation Challenge, Maharashtra Zone. https://sevainnovationchallenge.in/

**Secondary / reports**
8. Kashmir Life (Rajya Sabha reply, Udyam 9.16 crore as of 31 Jul 2026). https://kashmirlife.net/jammu-kashmir-records-over-9-64-lakh-msme-registrations-since-2020-447368/
9. KNN India (Udyam 8.84 crore, 30 Jun 2026). https://knnindia.co.in/news/newsdetails/msme/over-884-crore-msmes-registered-on-udyam-platforms-mos-karandlaje
10. Bain & Meta, *Win with Conversations* (May 2024). https://about.fb.com/wp-content/uploads/2024/05/Win-With-Conversations-Report_2024.pdf · https://about.fb.com/news/2024/05/genai-powered-conversational-commerce-to-fuel-business-growth-in-india/
11. India SME Forum / META, *Breaking Barriers, Building Futures* (Dec 2025). https://indiasmeforum.org/digishaastra/assets/docs/Final-META-Report-Card-2025.pdf
12. CyberMedia Research, MSME digital readiness study. https://cmrindia.com/67-of-msmes-demonstrate-digital-readiness-across-core-and-advanced-technologies-finds-cmr-study/
13. RIS, *MSME Digitalisation in India*. https://www.ris.org.in/sites/default/files/Publication/MSME_Digitalisation_Report.pdf
14. Women's World Banking, *Social Commerce* report (2019). https://www.womensworldbanking.org/wp-content/uploads/2018/12/2019_Social_Commerce_Report.pdf
15. Tide India invoicing claim (vendor). https://cxotoday.com/press-release/smes-save-an-average-of-10-12-hours-a-month-with-tides-invoicing-feature/

**Competitors and costs (third-party; verify on official sites)**
16. Vyapar pricing: https://www.techjockey.com/detail/vyapar · https://www.itforsme.in/pricing/vyapar-india
17. myBillBook pricing: https://freetrial.mybillbook.in/generate-bills-online-v2.html · https://mybillbook.in/blog/?p=738 · https://www.capterra.com/p/202732/FloBooks/pricing/
18. Khatabook features: https://www.capterra.com/p/197475/KhataBook/
19. Fireworks gpt-oss-120b pricing: https://computeprices.com/providers/fireworks-ai/models/gpt-oss-120b · https://futureagi.com/llm-cost-calculator/fireworks-ai/gpt-oss-120b
20. Supabase pricing: https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/
21. WhatsApp utility rate (India): https://hyperleap.ai/whatsapp-pricing-calculator-india

**Our codebase (verified 12–13 Oct 2026):** `src/` (calculator, router, ledger, messageHandler, telegramBot), `test/` (665 unit tests), `eval/` (e2e, hinglish, names, typos, routed), `logs/routing.log.jsonl` (1,038 parses), `LEARNINGS.md`, `PRODUCT_DIRECTION.md`, `CLAUDE.md`.
