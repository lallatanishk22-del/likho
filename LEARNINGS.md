# LEARNINGS.md

Engineering learnings from building and stress-testing Likho's AI order-parsing
pipeline (Experiments #1–6). This is a working record, not polished docs —
kept so future work doesn't re-litigate settled findings or re-introduce
already-fixed bugs.

---

## Architecture as built

```
message → router (local Ollama first, escalate to Fireworks cloud on failure)
        → shape validation (per-item: valid types, evidence grounded in the real message)
        → trust layer (cross-item relationships: reused price + unexplained numbers,
                        duplicate evidence, item-completeness/coverage)
        → deterministic calculator (never the AI)
```

Both providers share one prompt contract (`src/orderExtractionPrompt.ts`) and are
judged by the identical validation/trust code — no double standard between
local and cloud.

---

## What we actually did, in order

**1. Eval harness bugs (4 fixes)**
- `namesMatch` only did exact/substring matching — added Levenshtein tolerance
  so typo-preserving correct answers (e.g. "panner tikka" vs "paneer tikka")
  stopped being misgraded as wrong.
- Error classification conflated infra failures (Ollama down, bad JSON) with
  legitimate model clarifications — added `isInfraError` + a separate
  `INFRA_ERROR` bucket excluded from reliability scoring.
- `itemsMatch` compared items positionally — nothing in the schema requires
  order, and the calculator sums regardless of order, so rewrote it as
  order-independent multiset matching.
- Dataset cases #18 and #19 had wrong ground truth (contradicted the trust
  layer's own duplicate-evidence rule; mislabeled an unambiguous typo case as
  "should fail") — fixed the dataset, not the code.

**2. Experiment #1 — Baseline with full diagnostics**
Built `parseOrderWithLocalAIDiagnosed` to separate MODEL_RESULT /
VALIDATOR_RESULT / FINAL_RESULT. Result: model was confident on 19/20
messages; **our own validator overturned 10 of those 19 (53%)** — proving the
bottleneck was our code, not the model.

**3. Experiment #2 — Grounding scope fix**
Root cause: quantity and price had to appear in the *same* short evidence
quote. Fixed to ground each independently against the whole message.
Validator override rate: **53% → 21%**.

**4. Experiment #3 — Spelled-out quantities**
Added recognition for "one/two/ek/do/..." (1–10, English + Hinglish) —
scoped deliberately to quantities only, not prices, after explicitly checking
that wouldn't violate the "explicit quantity required" rule. Override rate:
**21% → 5%**. Final valid: 9/20 → 18/20.

**5. Experiment #4 — Generalization stress test (new 20-message set)**
Found the first **SILENTLY_WRONG** case: a confidently-produced bill that
silently dropped an entire ordered item ("3 coke" vanished). Also found:
forbidden total→unit-price division attempts, a model output that garbled
numbers so badly it swapped quantity/price roles.

**6. Experiment #5 — Trust-layer stress test (another new 20-message set)**
Confirmed the item-omission bug wasn't a fluke — it recurred **twice more**,
under two different message structures. Zero success (0/3) resolving
"actually X" correction language across both this and Exp4. Overall
accuracy: 65%.

**7. Experiment #6 — Item-completeness fix**
Designed and implemented a new trust-layer signal: extract "quantity +
product" mentions from the raw message, multiset-compare against the model's
actual item quantities, flag leftovers. Directly targeted at (and fixed) all
3 known omission cases. Along the way, **found and fixed a real bug in the
fix itself** — "do" (Hinglish for "make it") was being misread as the
quantity word "two," causing a new false rejection — caught by rerunning the
regression suite, not by luck.

**8. Full regression proof, before/after**
- Unit tests: 19 → 35, all passing
- Original 20-case eval: 18/20 (90%) — unchanged, zero regression
- Exp4's omission case: SILENTLY_WRONG → correctly clarified
- Exp5: 2 SILENTLY_WRONG → **0**, no new false rejections introduced

**9. Froze `structuredOrder.ts` and `trustLayer.ts`** deliberately, to stop
before it became an endless patch loop.

---

## Key technical findings

1. **Existence checks aren't relationship checks.** Early validation confirmed
   a number appeared *somewhere*, but couldn't catch "20 40 60" being wrongly
   assigned across 3 items. This is why validation is split into shape
   validation (per-item) and the trust layer (cross-item).
2. **Overly strict grounding was the real bug, not the model.** Requiring
   quantity+price in one evidence quote caused a 53% false-refusal rate — the
   model was right 95% of the time; our own validator was throwing away
   correct answers.
3. **Spelled-out quantities ("one", "ek", "do") are explicit, not missing** —
   recognizing them (English + common Hinglish, values 1–10) dropped the
   false-refusal rate further. Deliberately scoped to quantities only —
   prices are never spelled out in this domain.
4. **Item omission is the most dangerous failure mode found**: the model can
   silently drop an entire ordered item from its output instead of including
   it with a null price. Nothing that checks *existing* items can catch an
   *absent* one — fixed via a dedicated completeness signal.
5. **Value-based Set comparison hides repeated occurrences.** A number
   appearing twice in the message was only checked as "does it exist," not
   "does it exist twice" — precisely how a dropped second occurrence slipped
   past undetected. The completeness signal uses multisets to close this gap.
6. **Correction language ("actually 6", "actually 8 samosa") has a 0%
   resolution rate** (0/3 across all experiments) — the model consistently
   retreats to asking a clarifying question rather than resolving it. Safe,
   but unaddressed — no code anywhere attempts to handle this.
7. **The local model is not perfectly deterministic** even with
   `temperature: 0, seed: 42` pinned — expect some run-to-run variance in
   edge cases when comparing eval numbers.
8. **Latency, not accuracy, is now the largest unresolved cost**: ~8–13s per
   local call. Nothing has addressed this yet.

---

## Current status of each pipeline "chunk"

| Chunk | File(s) | Status |
|---|---|---|
| Schema contract | `orderExtractionPrompt.ts` | reviewed, untouched |
| Local provider | `localAiParser.ts` | reviewed; latency bottleneck noted |
| Cloud provider | `cloudAiParser.ts` | reviewed; model choice inherited from an unrelated project, unevaluated |
| Shape validation | `structuredOrder.ts` | fixed (grounding scope, spelled quantities) — **frozen** |
| Trust layer | `trustLayer.ts` | fixed (item-completeness signal) — **frozen** |
| Router | `router.ts` | built, not yet stress-tested |
| Calculator | `calculator.ts` | untouched, no known issues |
| Formatter | `formatter.ts` | untouched, no known issues |
| CLI entrypoints | `index.ts`, `indexAi.ts` | untouched, no known issues |
| Eval harness | `eval/*` | fixed (name matching, error classification, item matching, dataset ground-truth corrections) |
| **Correction handling** | *(no owning file yet)* | **known gap, 0% success rate, unaddressed** |

`structuredOrder.ts` and `trustLayer.ts` are intentionally frozen — both were
stress-tested across 5 experiments with a locked regression suite (unit tests
+ a 20-case baseline + two disjoint 20-message generalization sets). Further
heuristic additions to these two files should only happen in response to a
new, reproducible failure found via that same regression discipline — not
speculative hardening.

---

## Regression discipline established

Any change to the parsing/validation/trust pipeline should be checked against:
1. `npm test` (unit tests)
2. `npm run eval:ollama` (original 20-case baseline)
3. The Experiment #4 and #5 message sets (generalization stress tests,
   disjoint from the baseline) — found in `eval/experiments/`

This is what caught a real bug (a Hinglish verb form misread as a quantity
word) before it shipped — treat "run all four" as the standard bar for any
future change here, not optional.

---

## How the decisions got made (the process, not just the findings)

1. **Separated "the model was wrong" from "our own code rejected a correct
   answer"** before assuming either. Built diagnostic instrumentation
   instead of guessing which layer was at fault.
2. **Ground truth was written down before running each experiment**, never
   after — made "the model got this wrong" a falsifiable claim, not a
   post-hoc excuse.
3. **One variable changed per experiment.** Prompt, model, validator, and
   trust layer were never modified in the same step.
4. **Danger was weighted above raw accuracy.** SILENTLY_WRONG was always
   treated as categorically worse than an unnecessary clarifying question.
5. **Scope questions were asked, not assumed**, when a fix touched an
   established safety rule (e.g. explicitly confirming that an unstated
   quantity should never default to 1).
6. **Existing helpers were reused, not re-implemented** — the
   item-completeness signal reused the exact same quantity-word list as
   shape validation instead of writing a second, potentially-inconsistent
   copy.
7. **The full regression suite ran before anything was declared done** —
   this is what caught a real bug in the completeness signal the same day
   it was written.
8. **Under-detection was chosen over over-rejection** whenever the two
   traded off — a false rejection costs something on every occurrence; a
   missed detection only costs something on the rare message that hits it.
9. **Work stopped, deliberately, once two files were stress-tested enough**
   — frozen rather than continuing to bolt on heuristics indefinitely.
