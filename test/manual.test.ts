import { test } from "node:test";
import assert from "node:assert/strict";
import { manualHome, manualTopic, manualTopicTexts, MANUAL_TOPIC_IDS, MANUAL_PREFIX } from "../src/manual.js";

const ALLOWED = new Set(["b", "i", "u", "s", "code", "pre", "blockquote"]);

// Telegram rejects the whole message on any unknown or unbalanced tag.
function assertTelegramHtml(text: string): void {
  const stack: string[] = [];
  for (const m of text.matchAll(/<(\/?)([a-z]+)[^>]*>/g)) {
    const [, closing, tag] = m;
    assert.ok(ALLOWED.has(tag!), `tag <${tag}> is not allowed`);
    if (closing) assert.equal(stack.pop(), tag, `unbalanced </${tag}>`);
    else stack.push(tag!);
  }
  assert.deepEqual(stack, [], "unclosed tags");
  assert.ok(!/&(?!amp;|lt;|gt;)/.test(text), "bare & must be &amp;");
  assert.ok(text.length < 4096, "longer than one Telegram message");
}

test("every manual page is valid Telegram HTML and fits one message", () => {
  assertTelegramHtml(manualHome().text);
  for (const text of manualTopicTexts()) assertTelegramHtml(text);
});

test("every topic button opens its page, with a way back", () => {
  for (const action of manualHome().actions!.map((a) => a.action)) {
    const page = manualTopic(action);
    assert.ok(page && page.actions?.some((a) => a.action === `${MANUAL_PREFIX}home`), action);
  }
  assert.equal(manualHome().actions!.length, MANUAL_TOPIC_IDS.length);
});

test("an unknown topic falls back to the menu, other actions are not taken", () => {
  assert.equal(manualTopic(`${MANUAL_PREFIX}nope`)!.text, manualHome().text);
  assert.equal(manualTopic("confirm:1042"), null);
});

test("the manual never teaches the two price traps", () => {
  const all = manualTopicTexts().join("\n");
  assert.ok(!/change \w+ to \d/.test(all), "'change X to N' changes quantity, not price");
  assert.ok(all.includes("/add chai 20"), "price changes must be taught as /add");
});
