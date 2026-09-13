---
name: audit-before-moving-on
description: Run a bias-free self-audit after a batch of changes, before treating work as done. Use after several features, fixes or decisions have landed in one session — especially when each change passed its own tests. Finds the class of bug where a good rule is reused outside the conditions that made it good.
---

# Audit before moving on

## Why this exists

On 13 Sept 2026, eight changes shipped in one session. Every one had tests.
Every one passed. **Five were wrong.**

```
"mango juice 60"          -> billed as Mango Shake
"kitchen 2 thali"         -> billed ONE thali, not two
"butter naan"             -> became a note, left the order
button "Record Rs 970"    -> recorded Rs 450
"150 panner 20 lassi 80"  -> every price shifted one place
```

Four of the five had the same cause:

> **A good rule reused outside the conditions that made it good.**

Containment matching was built for the branch where NO price was stated and
the alternative was refusing the order. It was then reused where a price WAS
stated — and there, "shares one word with a catalog entry" is not enough
evidence to rename a thing.

The tar pit is not writing a bad rule. It is a correct rule, correctly
tested, invoked from a second place whose preconditions are different.

## When to run this

- After 3+ features or fixes in one session
- Before saying a batch of work is done
- When a fix was made to a fix
- Immediately after any change that touches a shared helper

Do NOT wait to be asked. The user should not have to be the regression suite.

## The procedure

### 1. List every rule added or changed, and every call site

For each new function or loosened condition:

```
rule            -> where it is called -> what that call site assumes
```

A rule called from exactly one place is low risk. A rule called from two
places is the whole audit. Write the assumption out; if two call sites
assume different things, one of them is wrong.

### 2. Test the NEIGHBOURS, not the feature

Tests written alongside a feature test the feature. They do not test what
the feature sits next to. For each change, construct the input that is
one step to the side:

| built for | test instead |
|---|---|
| a reference resolving to a catalog item | a genuinely NEW item with a stated price |
| stripping a table number | a quantity in the same position |
| capturing an instruction | a product name that reads like one |
| a word list that categorises | a real product containing one of those words |

### 3. Ask the silence question

For anything that parses, removes or classifies text:

> **Can this make something disappear without saying so?**

A wrong answer gets argued about and corrected. A quiet one gets sent to a
customer. Every number and every item in the input must end up somewhere
visible, or be refused out loud.

### 4. Run everything, and read it

- the full unit suite
- every live eval (they exercise the real model; unit tests do not)
- the exact message the user reported, end to end

An eval that drops by one case is a finding, not noise. Chase it.

### 5. Report honestly

State what was found as defects, not as progress. If a bug was shipped
earlier in the same session, say that plainly — "this morning's own fix"
is the most useful sentence in the report, because it tells the user which
direction the work is drifting.

Pin each finding with a test named after the BEHAVIOUR that broke, not the
code that caused it. The code will move; the behaviour must not.

## Rules of thumb earned the hard way

- **Two loose signals beat one.** If a match shares only a word, require a
  second independent signal (an exact price, a position) before acting on it.
- **A guess in a word list costs a quantity.** Every speculative entry
  ("kitchen", "counter", "floor") eventually eats real data. Put in what is
  observed, not what is imagined.
- **Ground truth over vocabulary.** The user's own data — their price list,
  their customers — decides what a thing is. A word list is acceptable only
  where a miss is cosmetic.
- **The reassuring half must not lead.** If a message carries both "you are
  fine" and "check this", the check leads.
- **A label must state what will actually happen.** Not what was typed.
