const input = document.getElementById("input");
const hint = document.getElementById("hint");
const result = document.getElementById("result");

function reset() {
  input.value = "";
  input.disabled = false;
  hint.textContent = "";
  result.textContent = "";
  result.className = "";
  input.focus();
}

function renderParsed(parsed, bill) {
  const lines = [];
  if (parsed.customer) {
    lines.push(parsed.customer.toUpperCase());
    lines.push("");
  }
  for (const line of bill.lines) {
    lines.push(`${line.name} × ${line.quantity} — ₹${line.lineTotal}`);
  }
  lines.push("");
  if (bill.discountPercent > 0) {
    lines.push(`Subtotal — ₹${bill.subtotal}`);
    lines.push(`Discount (${bill.discountPercent}%) — −₹${bill.discountAmount}`);
    lines.push("");
  }
  lines.push(`Total — ₹${bill.total}`);
  return lines.join("\n");
}

async function runZbill() {
  input.disabled = true;
  hint.textContent = "Reading clipboard…";
  result.textContent = "";
  result.className = "";

  const response = await window.likho.runZbill();

  hint.textContent = "";
  if (response.ok) {
    result.className = "ok";
    result.textContent = renderParsed(response.parsed, response.bill);
  } else {
    result.className = "error";
    result.textContent = response.error;
  }
  input.disabled = false;
}

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const command = input.value.trim().toLowerCase();
    if (command === "zbill") {
      runZbill();
    } else {
      hint.textContent = "Unknown command. Type: zbill";
    }
  } else if (event.key === "Escape") {
    window.likho.hide();
  }
});

window.likho.onReset(reset);
