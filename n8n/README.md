# n8n workflows for Likho

## The rule

**n8n never touches the message stream.**

A Telegram *Trigger* node calls `setWebhook`, and a webhook and the bot's
`getUpdates` are mutually exclusive — activating one silently starves the
other, and messages vanish with no error anywhere. That cost a full evening
once already.

So n8n is only used for work that **starts somewhere else**: a schedule, a
spreadsheet, an email. Anything reading incoming Telegram messages belongs
to the bot, which is supervised by launchd and always running.

Telegram *sendMessage* from n8n is fine — sending never conflicts. Only
receiving does.

## daily-sales-summary.json

Every night at 9pm: asks the running API for today's sales and sends the
answer to the seller's own chat.

    Schedule (21:00) → POST /api/message {"text":"sales"} → Telegram sendMessage

Import: n8n → Workflows → Import from File.

Needs `npm run api` reachable at `host.docker.internal:3000`, which launchd
keeps running (`com.likho.api`).

The summary text comes from the SAME handler that answers "sales" in chat,
so the nightly number can never disagree with what the bot says when asked.
