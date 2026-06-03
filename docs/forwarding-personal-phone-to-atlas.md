---
title: Forwarding your personal phone to Atlas (call failover)
last_updated: 2026-06-01
---

# Forwarding your personal phone to Atlas (call failover)

TL;DR

1. Let your personal phone ring first. If you don’t answer, forward the call to your Atlas number.
2. Use conditional forwarding for “no answer” (and optionally “busy”/“unreachable”).
3. Test from multiple numbers and confirm Caller ID and ring time.

## Prerequisites

- Your Atlas (Twilio) phone number in E.164 format (e.g. +1 312 555 0123).
- Access to your phone’s carrier portal or phone settings to add conditional forwarding.
- (Optional) Admin access to your PBX or Twilio console if you control those systems.

## How it works (simple)

1. Caller dials your personal number.
2. Phone rings for N seconds (you answer if available).
3. If no answer → carrier forwards call to Atlas number.
4. Atlas handles the call (IVR/AI/voicemail) and logs the lead.

## Recommended settings

- Ring time (no-answer): 15–30 seconds (≈3–6 rings). Long enough for you to pick up, short enough to avoid poor caller experience.
- Forwarding conditions: at minimum “No Answer.” Add “Busy” and “Unreachable” only if you want more aggressive failover.
- Caller ID: forward the original caller when possible (test this — carriers differ).
- Always use E.164 format for forwarded numbers: +[country][number], e.g. +13125550123.

## Quick checklist (one‑minute setup)

1. Find your Atlas number (E.164).
2. In your phone/carrier portal: add conditional forward for “No Answer” → enter Atlas number.
3. Set ring time to ~15–30s.
4. Make 3 test calls from different phones and confirm Atlas answers and caller ID.

## Setup by platform (short guides)

### iPhone (iOS)

- iOS device-level forwarding is only unconditional. To forward on “No Answer” use your carrier’s conditional forwarding codes or carrier portal.
- If your carrier supports GSM conditional codes, use them (or contact carrier).


![iPhone Call Forwarding](/assets/images/iphone-call-forwarding.svg){: .screenshot }

### Android

- Settings → Calls → Call forwarding → No answer → enter Atlas number.
- If not visible, use carrier portal or GSM USSD codes.

### AT&T (US)

1. Sign in to MyAT&T → Manage devices → Call forwarding.
2. Add forwarding rule: Condition = No answer → Target = +[Atlas].
3. Save and test.


![AT&T Call Forwarding](/assets/images/att-call-forwarding.svg){: .screenshot }

### Verizon (US)

1. My Verizon → Devices → Call forwarding settings.
2. Add or edit “No answer” forwarding → set Atlas number → test.

### T-Mobile (US)

1. Account portal → voice settings → call forwarding.
2. Configure No Answer forward → set ring timeout → enter Atlas number.

### Google Voice / Google Fi

- Google Voice: add Atlas as a forwarding destination or use carrier-level forwarding. Test Caller ID behavior.
- Google Fi: use Fi app or web console → call forwarding settings → add Atlas for No Answer.

### Hosted PBX / VoIP (RingCentral, Nextiva, 8x8, etc.)

- Add a routing rule: If user does not answer (after N seconds) → Forward to number → enter Atlas number.
- Check hunt group / voicemail priorities so the “No Answer” condition triggers the forward.


![FreePBX Dialplan Example](/assets/images/freepbx-call-forwarding.svg){: .screenshot }

### Twilio (if you control a Twilio number)

- Option A (Studio/Flow): Add a Wait/Timeout and on timeout <Dial> to Atlas.
- Option B (Webhook): Implement logic in your voice webhook to call Atlas on no-answer.
- Keep track of caller CID; Twilio can pass original Caller ID.

### SIP/PBX (Asterisk, FreePBX, 3CX)

- Set dial timeout and on NOANSWER route to Atlas (+E.164).
- Avoid loops: never forward Atlas back to personal number.

## Testing checklist

1. Call your personal number from at least two different numbers.
2. Let it ring until it forwards; confirm Atlas answers.
3. Verify caller ID that arrives at Atlas (is it the original caller or forwarded-from number?).
4. Verify ring time and caller experience (voicemail, IVR).
5. Test “busy” and “unreachable” if enabled.
6. Confirm logs/lead capture in Atlas for each test.

## Troubleshooting

- Atlas never receives the call:
  - Confirm forwarding number is exactly the Atlas number (E.164).
  - Confirm conditional forward rule is active.
  - Check carrier portal or contact carrier support.
- Caller ID changed:
  - Some carriers replace original CID with the forwarding number. If your workflows depend on original CID, test and document which carriers preserve it.
- Forwarding loops:
  - Never forward the Atlas number back to your personal number. That causes a loop.
- PBX not forwarding:
  - Verify the PBX timeout/hunt group order — voicemail or other rules may intercept the call before failover.

## Snippets

- E.164 example: +1 312 555 0123 → +13125550123
- TwiML (if hosting MP3): `<Response><Play>https://your-server.example.com/media/answer.mp3</Play></Response>`

---

_Last updated: 2026-06-01 — Contact support@auzora.io for help._
