// "Rahul Bhai" and "Rahul" are the same person.
//
// Reported: "rahul bhai ko 2 paneer roll dena" billed RAHUL BHAI. That is
// a second customer record — his history splits in two, his outstanding is
// wrong in both, and "how much does Rahul owe" answers with half the
// truth. The seller never sees the cause, because both names look right.
//
// Honorifics are a CLOSED set and they are not names: bhai, ji, sir,
// didi. Unlike filler, this list does not grow with phrasing — it is a
// fixed feature of how people are addressed.
//
// Applied wherever a customer name is settled, so it does not matter
// whether the model found the name or position did.

const HONORIFICS = new Set([
  "bhai", "bhaiya", "bhaiyya", "bhaisaab", "bhaisahab",
  "ji", "jee", "sir", "madam", "maam", "ma'am",
  "sahab", "saab", "saheb", "shri", "smt",
  "didi", "dida", "behen", "bahen", "bhabhi", "bhabi",
  "uncle", "aunty", "auntie", "anna", "akka", "dada", "tai", "kaka", "kaki",
  "mr", "mrs", "ms", "dr",
]);

// Strips honorifics from either end. Never returns empty: a customer
// genuinely saved as "Bhaiya" keeps that name rather than losing it — an
// odd name is recoverable, a nameless bill is not.
export function stripHonorifics(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return name;

  const clean = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "");
  let start = 0;
  let end = words.length;
  while (start < end && HONORIFICS.has(clean(words[start]!))) start++;
  while (end > start && HONORIFICS.has(clean(words[end - 1]!))) end--;

  const kept = words.slice(start, end);
  return kept.length > 0 ? kept.join(" ") : name.trim();
}
