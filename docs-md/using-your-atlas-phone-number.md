# Using your Atlas phone number

Last updated: 2026-07-04

When your AI receptionist is set up, you get a dedicated **Atlas phone number**. This guide explains the ways you can route calls to and from it, with step-by-step setup for each scenario.

## TL;DR

There are two common ways to use your Atlas number:

1. **Atlas answers everything** — publish your Atlas number (or forward your main line to it) so the AI receptionist picks up every call.
2. **You answer first, Atlas backs you up** — let your own phone ring first, and forward *unanswered* calls to Atlas.

Atlas can also **transfer or escalate** a live call to another number (you, a manager, or a specific department) based on rules you set in your portal.

---

## The three routing options

| Option | Who answers first | Best for |
|---|---|---|
| **A. Atlas is your main line** | Atlas (the AI) | New numbers, or making Atlas the front door for all calls |
| **B. Overflow / no-answer** | You, then Atlas | Keeping your existing number and using Atlas as backup |
| **C. Atlas forwards to you** | Atlas, then a human | Escalating urgent or complex calls to a person |

You can combine **C** with either **A** or **B** — Atlas always follows your escalation rules once it's on the call.

---

## Option A — Make Atlas your main line

Use this when you want the AI receptionist to answer **every** call.

You have two ways to do it:

### A1. Give out your Atlas number directly

1. Use your Atlas number on your website, Google Business Profile, business cards, and ads.
2. Every caller reaches Atlas first.
3. Atlas answers, qualifies the caller, books appointments, and escalates to you when your rules say so.

No phone settings to change — just publish the number.

### A2. Forward your existing number to Atlas (unconditional)

Keep advertising your current business number, but send **all** calls to Atlas:

1. Find your Atlas number in **E.164** format, e.g. `+131****0123`.
2. On your business line, set up **unconditional call forwarding** to your Atlas number.
3. Make a test call to your business number — Atlas should answer.

**Example (most carriers):** dial `*72` + your Atlas number to enable, `*73` to cancel. Codes vary by carrier — check your carrier portal if unsure.

---

## Option B — You answer first, Atlas catches the rest

Use this when you want to keep answering your own calls but never miss one. Your phone rings first; if you don't pick up, the call rolls to Atlas.

1. Get your Atlas number in E.164 format, e.g. `+131****0123`.
2. On your phone or carrier portal, set up **conditional forwarding** for **No answer** (and optionally **Busy** / **Unreachable**).
3. Set the ring time before forwarding to **15–30 seconds** (about 20 is a good default).
4. Point the forward destination at your Atlas number.
5. Make 3 test calls from different phones and let each ring through.

### Setup by device / provider

**iPhone** — iPhone settings only support *unconditional* forwarding. For **No answer** forwarding, use your carrier portal or carrier support.

**Android** — Open **Phone → Settings → Call forwarding → Forward when unanswered**, then enter your Atlas number.

**AT&T** — **MyAT&T → Manage devices → Call forwarding settings** → add a **No answer** rule pointing to your Atlas number.

**Verizon** — **My Verizon → Devices → your phone → Call forwarding** → add **No Answer** forwarding to your Atlas number.

**Google Voice / Google Fi** — Add your Atlas number as a forwarding destination; check screening and voicemail settings, then test.

**VoIP / PBX / business phone system** — Look for **Call Handling**, **Call Routing**, or **No answer forwarding**. Ring the extension first, then route **NOANSWER** to your Atlas number. Start with a 20-second timeout.

> **TIP** Set your ring time a little shorter than your voicemail pickup time, so Atlas grabs the call *before* voicemail does.

---

## Option C — Have Atlas forward calls to another number

Atlas can hand a live call off to a real person — you, a manager, or a specific line — when a caller needs it. This is controlled entirely from your **client portal**, no phone settings required.

### How to set it up

1. Log in to your **Auzora client portal**.
2. Open **Agent Settings**.
3. Set the **Escalation phone number** — the number Atlas should transfer to (E.164 format, e.g. `+131****0199`).
4. Add **Escalation rules** in plain English describing *when* Atlas should transfer. For example:
   - "Transfer to me if the caller is an existing customer with an urgent issue."
   - "If someone asks to speak to a person, connect them to (817) 555‑0199."
   - "Forward billing questions to the office manager."
5. Save. Changes take effect on the next call.

### What the caller experiences

1. Atlas answers and talks with the caller as usual.
2. When a rule is met, Atlas says something like *"Let me connect you with the team directly,"* and transfers the call to your escalation number.
3. If the transfer number doesn't answer, Atlas can take a message or offer to book a callback.

> **NOTE** Escalation rules are guidance for the AI, written in plain language — the more specific you are about *who* and *when*, the more reliably Atlas routes the call.

---

## Putting it together — example setups

**A solo owner who wants full coverage**
Option **B** (ring my cell first, forward no-answer to Atlas) + Option **C** (Atlas escalates urgent existing-customer calls back to my cell). You catch the calls you can; Atlas covers the rest and only interrupts you for the important ones.

**A business making Atlas the front desk**
Option **A2** (forward the main business line to Atlas) + Option **C** (Atlas transfers to the right department based on escalation rules). Every call is answered instantly, and humans only get the calls that truly need them.

**A brand-new number**
Option **A1** (advertise the Atlas number directly). Simplest possible setup — nothing to forward.

---

## Test checklist

Before you rely on any setup, run these tests:

1. Call from your own phone.
2. Call from a second cell phone.
3. Call from a landline if possible.
4. For Option B, let it ring until forwarding kicks in.
5. Confirm each time:
   - Atlas answers (or the human does, for escalations)
   - Caller ID looks right
   - The call shows up in your portal call log

---

## Troubleshooting

- **Atlas never answers** → double-check the Atlas number and that forwarding is enabled.
- **Calls forward too fast** → increase the ring time before forwarding.
- **Escalation doesn't transfer** → confirm the escalation phone number is saved in your portal and your rules describe the situation clearly.
- **Caller ID changes** → some carriers rewrite caller ID on forwarded calls; this is normal.
- **Looping calls** → make sure you're only forwarding your line *to* Atlas, not Atlas back to a line that forwards to Atlas.

---

## Need help?

Not sure which option fits your business? We'll help you pick and set it up.

- Reach out through your **client portal**, or
- Contact the Auzora team and we'll walk you through it.

We can also test any setup with you after you make the change.
