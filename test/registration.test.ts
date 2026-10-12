import { test } from "node:test";
import assert from "node:assert/strict";
import { registerContact, normalizePhone, SHARE_PHONE_LABEL } from "../src/registration.js";

// These paths return before touching the database.
test("someone else's forwarded contact does not register you", async () => {
  const reply = await registerContact("111", "Asha", { phone_number: "919820041122", user_id: 222 }, 111);
  assert.equal(reply.requestContact, SHARE_PHONE_LABEL, "asks again for the seller's own number");
  assert.ok(!reply.removeKeyboard);
});

test("a contact card with no Telegram account behind it does not register you", async () => {
  const reply = await registerContact("111", "Asha", { phone_number: "9820041122" }, 111);
  assert.equal(reply.requestContact, SHARE_PHONE_LABEL);
});

test("every way Telegram writes a number is stored the same", () => {
  assert.equal(normalizePhone("919820041122"), "+919820041122");
  assert.equal(normalizePhone("+91 98200 41122"), "+919820041122");
  assert.equal(normalizePhone("+91-98200-41122"), "+919820041122");
});
