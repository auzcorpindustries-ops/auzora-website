# Forward your personal phone to Atlas

Last updated: 2026-06-04

## TL;DR

1. Let your personal phone ring first.
2. If you do not answer, forward the call to your Atlas number.
3. Use **conditional forwarding** for **No answer**.
4. Test it from at least 3 different numbers.

## What you need

- Your Atlas phone number in **E.164** format, like `+131****0123`
- Access to your phone settings or carrier portal
- Admin access if you use a PBX / VoIP system

## Recommended settings

| Setting | Recommended |
|---|---|
| Ring time before forwarding | 15–30 seconds |
| Forward to | Your Atlas number |
| Conditions | No answer first; Busy / Unreachable optional |
| Test | 3 calls from different numbers |

## How it works

1. Someone calls your personal number.
2. Your phone rings normally.
3. If you do not answer in time, the call forwards to Atlas.
4. Atlas answers and handles the call.

## Quick setup checklist

1. Find your Atlas number.
2. Add a **No answer** forward rule.
3. Set ring time to about 20 seconds.
4. Make 3 test calls.
5. Confirm Atlas answers and logs the call.

## Setup by device or provider

### 1) iPhone

- iPhone only supports **unconditional** forwarding in the phone settings.
- For **No answer** forwarding, use your carrier portal or carrier support.

![iPhone call forwarding screenshot](/assets/images/iphone-call-forwarding.svg)

### 2) Android

- Open **Phone** → **Settings** → **Call forwarding**.
- Choose **Forward when unanswered** or **Forward on no answer**.
- Enter your Atlas number.

### 3) AT&T

1. Open **MyAT&T**.
2. Go to the line you want to edit.
3. Open **Call forwarding settings**.
4. Add a **No answer** rule and enter your Atlas number.

![AT&T call forwarding screenshot](/assets/images/att-call-forwarding.svg)

### 4) Verizon

1. Open **My Verizon**.
2. Go to **Devices** → your phone.
3. Open **Call forwarding**.
4. Add **No Answer** forwarding to your Atlas number.

### 5) Google Voice / Google Fi

- Add your Atlas number as a forwarding destination.
- Check screening and voicemail settings.
- Test carefully before relying on it.

### 6) VoIP / PBX / business phone systems

Use the admin portal and look for:

- **Call Handling**
- **Call Routing**
- **No answer forwarding**
- **Ring strategy**

Set the destination to your Atlas number and save.

![PBX / FreePBX call forwarding screenshot](/assets/images/freepbx-call-forwarding.svg)

### 7) Twilio

If you already use Twilio:

1. Open the phone number.
2. Point the voice webhook or Studio flow to your app.
3. Forward to Atlas after no-answer / timeout.

## Test checklist

1. Call from your own phone.
2. Call from a second cell phone.
3. Call from a landline if possible.
4. Let it ring until forwarding kicks in.
5. Confirm:
   - Atlas answers
   - Caller ID looks right
   - The call is logged

## Troubleshooting

- **Atlas never rings** → verify the Atlas number is correct.
- **It forwards too fast** → increase the ring time.
- **Caller ID changes** → some carriers rewrite caller ID.
- **Looping calls** → make sure you are forwarding only from personal → Atlas.

## Need help?

Send this to your carrier or admin:

> Please add a conditional forward so calls to my personal number go to `+131****0123` only if I do not answer. Please use a ring timeout of about 20 seconds.

If you want, we can also help test the setup once you make the change.
