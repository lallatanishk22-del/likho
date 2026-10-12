// Which number in a payment message is the bill and which is the money.
//
// "1003 paid 100" — bill numbers are often typed without "#". Read naively,
// 1003 became the amount and the newest bill was marked paid in full. The
// only thing that can tell a bill number from an amount is whether that
// bill exists, so the caller looks it up and passes the answer in here.
//
//   - "#1003" or a named customer already identifies the bill: unchanged.
//   - A number marked as money (₹, rs, rupees) is never a bill number.
//   - The first unmarked number is the bill if that bill exists; another
//     number in the message is then the amount.
//   - A lone number that is also a real bill number is a question, not a
//     guess: "1003 paid" could be bill #1003 or ₹1003 received.

export interface PaymentNumber {
  value: number;
  money: boolean;
}

export type PaymentDecision = { billNo: number | null; amount: number | null } | { ask: string };

export function firstBareNumber(numbers: PaymentNumber[]): number | null {
  return numbers.find((n) => !n.money)?.value ?? null;
}

export function decidePayment(
  billNo: number | null,
  amount: number | null,
  customer: string | null,
  numbers: PaymentNumber[],
  firstBareIsBill: boolean,
): PaymentDecision {
  if (billNo !== null || customer || !firstBareIsBill) return { billNo, amount };

  const bareIndex = numbers.findIndex((n) => !n.money);
  const bill = numbers[bareIndex]!.value;
  const other = numbers.find((_, i) => i !== bareIndex);
  if (other) return { billNo: bill, amount: other.value };

  return {
    ask:
      `Is ${bill} the bill number or the amount?\n\n` +
      `  #${bill} paid      bill #${bill} paid in full\n` +
      `  paid ₹${bill}      ₹${bill} received`,
  };
}
