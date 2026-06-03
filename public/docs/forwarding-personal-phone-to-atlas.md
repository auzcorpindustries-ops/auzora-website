# How to Use Your Personal Phone with Atlas (Call Forwarding / Failover)

Last updated: 2026-06-01

Overview

If you want callers to ring your personal phone first and have Atlas pick up only when you don't answer, the simplest and most reliable approach is to add a conditional call forwarding rule at the phone or carrier level that forwards the call to your Atlas phone number (the Twilio/Atlas-assigned number) when the call is not answered, busy, or unreachable.

This document explains the concept, recommended settings, testing steps, and step-by-step guidance for common phone setups (mobile device settings, major carriers, Google Voice, and typical VoIP/PBX/hosted PBX providers).

Prerequisites

- Your Atlas-assigned phone number (the number we gave you to forward calls to). Replace `+1-555-555-1212` in examples with your actual Atlas number.
- Access to your mobile phone settings and/or your carrier's account portal (MyAT&T, Verizon, T-Mobile, RingCentral admin portal, etc.).
- Permission from the phone account owner to change forwarding rules (if the client does not control the account, work with the account admin).

How it works (short)

1. Caller dials your personal number.
2. Your phone rings for N seconds (configurable). If you answer, normal call handling proceeds  Atlas is not involved.
3. If you do not answer within N seconds, the carrier forwards the incoming call to your Atlas number.
4. Atlas answers the forwarded call and handles it with the client's AI agent.

Recommended settings

- No-answer ring time: 15	60 seconds (3	66 rings). This gives the person a reasonable chance to pick up before failover.
- Forwarding conditions: forward on "no answer" and optionally on "busy" or "unreachable" if you want stronger failover.
- Caller ID: Some carriers forward the original caller CID, some show the forwarded-from number. Verify expected Caller ID with a test call so Atlas receives the caller number if needed.
- Testing: Make several test calls from different numbers to verify the forwarded call reaches Atlas, that the caller ID is preserved (if required), and that the ring time is acceptable.

Important notes

- Forwarding is configured and enforced by the carrier or the phone's account settings  Atlas cannot configure forwarding on the customer's behalf.
- If you use a work PBX or hosted PBX (RingCentral, 8x8, Nextiva, etc.), the forwarding rule is usually set in the admin portal under user or call handling rules.
- If you use Google Voice, you can add your Atlas number as a forwarding destination but beware of screening and voicemail settings.
- Always test after making changes.

Steps by setup

A. iPhone (iOS)
1. Open Settings  Phone  Call Forwarding.
2. Toggle Call Forwarding ON.
3. Tap "Forward To" and enter your Atlas number (e.g. +1-555-555-1212).
4. Note: iOS only supports unconditional forwarding at the device level. To forward only on "no answer," use your carrier account portal or contact your carrier  or use the phone's native carrier conditional forwarding codes if supported.

B. Android (stock / common OEMs)
1. Open Phone app  Settings  Calling accounts (or Calls)  Additional settings  Call forwarding.
2. Select the appropriate SIM or account.
3. Set "Forward when unanswered" (or "Forward on no answer") and enter your Atlas number.
4. Choose timeout/ring time if available (some phones let you set seconds before forwarding).

C. AT&T (US)
1. Use MyAT&T (web or app) or dial customer service if needed.
2. In MyAT&T: Manage devices  choose the line  Call forwarding settings  Add forwarding for "No answer" and enter your Atlas number.
3. Alternatively, contact AT&T support and request conditional forwarding on "no answer" to your Atlas number with a 20-second ring time.
4. Test: Call your number, do not answer, verify Atlas answers.

D. Verizon (US)
1. Use My Verizon  Devices  Your phone  Call forwarding (or Call Forwarding & Calls) settings.
2. Add a rule to forward on "No Answer" to your Atlas number and set timeout/rings (if available).
3. Alternatively, call Verizon support for assistance.

E. TMobile (US)
1. Use the TMobile app or account.TMobile.com  Profile & device settings  Call forwarding.
2. Set forwarding for "No answer" to your Atlas number and configure ring time if available.

F. Google Voice
1. Open voice.google.com or the Google Voice app  Settings  Linked numbers.
2. Add your Atlas number as a forwarding destination if you want calls forwarded to Atlas. Be aware Google Voice sometimes screens calls before forwarding.
3. Configure call handling rules in Google Voice to control when forwarding happens (depends on account features). Test to ensure correct behavior.

G. Google Fi
1. Google Fi uses conditional forwarding controlled in the Fi app or web portal.
2. Open the Google Fi app  Account  Settings  Call forwarding / Calls  configure forwarding for no-answer to Atlas.
3. Contact Fi support if the option is not visible.

H. VoIP / Hosted PBX / Business Phone Systems (RingCentral, Nextiva, 8x8, Vonage, Ooma, Grasshopper, etc.)
1. Login to the admin portal.
2. Go to Users / Extensions  select the user or DID you want to edit.
3. Find Call Handling, Call Routing, or Forwarding rules.
4. Add a rule: If User Does Not Answer (No Answer)  Forward to number  Enter Atlas number.
5. Set timeout (rings/seconds) to 1530s and enable Busy/Unavailable forwarding if desired.
6. Save and test.

I. Twilio (if the client controls an existing Twilio number)
If the customer already uses Twilio and wants to failover to Atlas, they can add logic in their Twilio webhook or Studio Flow to forward on no-answer.

1. Option A  Twilio Console (Phone Numbers)
  - Console  Phone Numbers  Active Numbers  choose the number.
  - Configure Voice & Fax: set Webhook for incoming call to your application endpoint that implements the failover logic.
  - Implement your app so that if the call is unanswered or rings X seconds, it dials the Atlas number (or returns TwiML <Dial><Number>+1-555-555-1212</Number></Dial>).

2. Option B  Twilio Studio
  - Create or edit a Studio Flow for the number.
  - Add a Split or Redirect widget after the initial dial attempt that checks for CallStatus == 'no-answer' or handles the <Dial> timeout, then connect to a new <Dial> to the Atlas number.
  - Twilio debugging logs show if forwarding happened and why.

J. Generic SIP/PBX (Asterisk, FreePBX, 3CX, FusionPBX)
1. Open the extension settings for the user.
2. Locate Followme / Call Forwarding / Ring Strategy settings.
3. Configure a conditional forward on no-answer to the Atlas number and set ring time.
4. Reload the dialplan and test.

Testing checklist

1. Verify you know the Atlas number to forward to.
2. Configure forwarding for "No answer" (1530s) to the Atlas number.
3. From another phone, call your personal number and let it ring without answering.
4. Confirm Atlas picks up and treats the call as expected (call recording, lead capture, caller ID passed through).
5. Check call logs in the Atlas portal (or admin) to verify the call record appears and shows the original caller number (if required).
6. Repeat with different carrier networks (cell, landline) to verify behavior in edge cases.

Troubleshooting

- Atlas never receives the forwarded call: verify the forwarding number is exactly the Atlas number (E.164 format +country code), check that conditional forwarding is active, and call your number while watching carrier settings. If the carrier shows an active forward but the call doesn't arrive, contact the carrier.
- Caller ID lost or changed: Many carriers preserve the original caller ID; some show the forwarded-from number. If call routing relies on original caller ID (e.g., whitelist), test and note what arrives at Atlas.
- Forwarding loops: Do not forward the Atlas number back to the personal number. That can create an infinite loop. Always forward only personal  Atlas.
- VoIP PBX routing priority: If the PBX has ring groups or simultaneous ring policies, ensure the no-answer condition is the one that triggers the forward. Some systems attempt voicemail or hunt groups first  set the timeout appropriately.

Support text for clients to send to their carrier/admin

"Hello  I need to add a conditional call forward so calls to my personal number will forward to +1-555-555-1212 only if I don't answer. Please add a 'forward on no answer' rule with a ring timeout of about 20 seconds. Can you confirm how caller ID is forwarded and whether the setting will forward when my phone is out of service?"

What Atlas needs from you (to help)

- Confirm your Atlas-assigned phone number (we'll provide it).
- Preferred no-answer timeout (recommended 20 seconds).
- Whether you want Atlas to pick up on busy/unreachable as well as no-answer.

Want us to help?

We cannot change your carrier settings for you, but we can:
- Provide the Atlas number and exact E.164 format to paste into your carrier or PBX admin portal.
- Provide a short step-by-step or support text to share with your carrier or PBX admin.
- Test call-handling once you've made the change  give us a test number to call from and we'll verify it arrives at Atlas.

If you'd like, we can add a short "Forwarding to Atlas" checklist to your onboarding packet to streamline setup for new clients.

---

Last updated: 2026-06-01  Contact support@auzora.io for help.
