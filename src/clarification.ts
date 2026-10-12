// Folds a seller's short answer back into the order it answers.
//
// Models could not read "order\n(question answer)" — they echoed the
// question back. So code places the answer deterministically: a number
// answering a quantity question goes directly in front of the item the
// question named ("pizza rohan 55" + "44" -> "44 pizza rohan 55"). Any
// other answer is appended, the way the seller would have typed it.

const QUANTITY_QUESTION = /\b(quantity|how many|qty)\b/i;

export function applyClarification(order: string, question: string, answer: string): string {
  const num = answer.match(/\d+(?:\.\d+)?/)?.[0];
  const rest = answer.replace(/\d+(?:\.\d+)?/, "").trim().split(/\s+/).filter(Boolean);

  if (num && rest.length <= 1 && QUANTITY_QUESTION.test(question)) {
    const q = question.toLowerCase();
    const item = order
      .split(/\s+/)
      .find((w) => /^[a-zऀ-ॿ]{3,}$/i.test(w) && new RegExp(`\\b${w.toLowerCase()}\\b`).test(q));
    if (item) {
      const at = new RegExp(`(?:\\d+(?:\\.\\d+)?\\s+)?\\b${item}\\b`, "i");
      return order.replace(at, `${num} ${item}`);
    }
  }
  return `${order} ${answer}`.trim();
}
