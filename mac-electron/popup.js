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

function renderParsed(parsed) {
  const lines = [];
  if (parsed.customer) {
    lines.push(parsed.customer.toUpperCase());
    lines.push("");
  }
  for (const item of parsed.items) {
    lines.push(`${item.name} × ${item.quantity} — ₹${item.unitPrice}`);
  }
  if (parsed.discountPercent) {
    lines.push("");
    lines.push(`Discount: ${parsed.discountPercent}%`);
  }
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
    result.textContent = renderParsed(response.parsed);
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
