---
title: SMS campaigns & AI callbacks
last_updated: 2026-07-22
---

# SMS campaigns & AI callbacks

Your AI agent can reach out as well as answer — bulk SMS campaigns, automatic follow-up on new leads, missed-call callbacks, and bulk or one-off outbound calls.

Every outbound **call** respects the business hours set on your **Scheduling** tab. **SMS** sends regardless of business hours.

## TL;DR

| Capability | Where | Needs enabling? |
|---|---|---|
| SMS campaigns | SMS Services tab | No |
| Inbound lead → auto call | Automatic with Lead Intake | No |
| Missed call → auto callback | Automatic | Yes — contact support |
| Bulk call campaigns | Outbound tab | No |
| Manual single call | Outbound tab → Quick Call | No |

---

## Send an SMS campaign

1. **Open the SMS Services tab** in your portal sidebar.
2. **Name your campaign** — e.g. "Spring follow-up".
3. **Set the throttle** — messages per minute (default 30). Lower this if your carrier requires it.
4. **Write your message template** — use \`{{name}}\` and \`{{business_phone}}\` for personalization.
   Example: \`Hi {{name}}! We have a 10% spring special. Reply to book or call us at {{business_phone}}.\`
5. **Upload your lead list** — one per line: \`phone, name\`. Phone is required, name optional. Max 200 leads per campaign.
6. **Click "Create SMS Campaign"** — sending begins immediately within your throttle limit.
7. **Monitor progress** — click any campaign to see per-lead delivery status (pending, sent, delivered, failed, opted-out).

> **OPT-OUTS** Leads who reply STOP, UNSUBSCRIBE, CANCEL or END are excluded from all future campaigns. They can opt back in by replying START.

---

## The four callback flows

### A. Inbound lead → auto call

1. A lead submits your web form (Lead Intake endpoint).
2. The AI sends a follow-up SMS instantly — no business-hours check.
3. Within calling hours, the AI also places an outbound call.
4. Outside calling hours the call is skipped — the lead still gets the SMS.

Configured automatically when you set up Lead Intake on the **Integrations** tab. No extra toggle needed.

### B. Missed call → auto callback

1. A caller dials your Auzora number and the call is missed (no-answer, busy or failed).
2. The AI sends a follow-up SMS to the caller immediately.
3. If **auto-callback is enabled**, the AI waits a short delay (default 2 min), then calls back — within business hours only.
4. Outside business hours the callback is rescheduled for the next hour and retried.

Contact support to enable auto-callback. Rate-limited to one callback per caller per hour.

### C. Bulk call campaigns

1. **Open the Outbound tab** in your portal sidebar.
2. **Name your campaign** — e.g. "March re-engagement".
3. **Add script context** (optional) — e.g. "Mention 10% spring discount for new customers". The AI weaves this into its natural conversation.
4. **Set retries** — max attempts after the first call (default 2 = 3 total per lead).
5. **Set retry delay** — minutes between attempts (default 60, minimum 15).
6. **Upload your lead list** — one per line: \`phone, name, service, notes\`. Phone required, rest optional. Max 200 leads.
7. **Click "Create Campaign"** — the AI starts dialing within your business hours.
8. **Monitor progress** — click any campaign to see per-lead outcomes (reached, no-answer, voicemail, opted-out).

Leads who say "stop calling" or "don't call" are opted out automatically.

### D. Manual single call

1. **Open the Outbound tab.**
2. **Enter a phone number** in the **Quick Call** box at the top.
3. **Click "Place Call"** — the AI dials immediately (within business hours).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Campaign created but nothing sent | Check the throttle isn't set to 0 and that your lead list parsed — open the campaign for per-lead status |
| Calls not going out | Outbound calls only run inside your business hours (Scheduling tab) |
| A lead never gets contacted | They may have opted out previously — opted-out leads are skipped in every campaign |
| Personalization shows literally | Use the exact tokens \`{{name}}\` / \`{{business_phone}}\` |

---

## Need help?

Contact [support@auzora.io](mailto:support@auzora.io) for configuration changes, enabling auto-callback, or any questions.
