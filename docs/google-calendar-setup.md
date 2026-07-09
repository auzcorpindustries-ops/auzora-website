# Connect Google Calendar to Auzora

Last updated: 2026-07-09

## TL;DR

1. Go to your Auzora portal → **Settings**.
2. Paste your Google Calendar ID.
3. Grant **Make changes to events** access to `ahoward@auzora.io` on your calendar.
4. Save and test with a live call.

## What you need

- A Google account with Google Calendar
- Access to your Auzora portal
- About 5 minutes

## How it works

Auzora uses a Google Workspace service account with Domain-Wide Delegation to create calendar events on your behalf. You share your calendar with our Workspace user (`ahoward@auzora.io`) once — Auzora handles everything from there. When a caller books an appointment, Auzora adds it directly to your calendar.

## Step 1 — Find your Calendar ID

1. Open [Google Calendar](https://calendar.google.com).
2. In the left sidebar, hover over the calendar you want to use and click the **three-dot menu (⋮)**.
3. Click **Settings and sharing**.
4. Scroll down to **Integrate calendar**.
5. Copy the **Calendar ID**. It looks like `you@gmail.com` or `abc123@group.calendar.google.com`.

## Step 2 — Share your calendar with Auzora

On the same **Settings and sharing** page:

1. Scroll to **Share with specific people or groups**.
2. Click **+ Add people and groups**.
3. Enter our team email:

   `ahoward@auzora.io`

4. Set the permission to **Make changes to events**.
5. Click **Send**.

## Step 3 — Add your Calendar ID to the Auzora portal

1. Log in to your [Auzora portal](https://atlas.6845165.xyz/portal.html).
2. Go to **Settings**.
3. Find the **Google Calendar ID** field.
4. Paste the Calendar ID you copied in Step 1.
5. Click **Save**.

## Step 4 — Test it

Call your Auzora number and book a test appointment. After the call ends, check your Google Calendar — the appointment should appear within a few seconds.

You can also click **🧪 Send Test Event** in the portal to create a test event without making a call.

## Troubleshooting

| Problem | Fix |
|---|---|
| Appointment booked but not in calendar | Confirm the Calendar ID is saved in the portal and `ahoward@auzora.io` has **Make changes to events** permission |
| Wrong calendar receiving events | Double-check the Calendar ID — it must match exactly |
| "Access denied" when connecting | Make sure you shared the calendar with `ahoward@auzora.io` and set permission to **Make changes to events** |
| Events showing wrong time zone | Make sure your Google Calendar time zone matches your business hours time zone in the portal |

## Need help?

Contact us at [auzora.io/#contact](https://auzora.io/#contact) and we will help you verify the setup.
