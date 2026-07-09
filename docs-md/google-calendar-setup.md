# Google Calendar Setup for Atlas AI

Last updated: 2026-07-08

## TL;DR

1. Share your Google Calendar with the Auzora service account.
2. Set your working hours so Atlas knows when you are available.
3. Add your holiday calendar so Atlas respects days off.
4. Test by booking a call and confirming the event appears.

## What you need

- A Google account (personal Gmail or Google Workspace)
- Your Google Calendar ID (found in calendar settings)
- Access to the Auzora client portal to paste the Calendar ID

## Step 1 — Share your calendar with Auzora

Atlas AI writes appointments to your calendar using a service account. You must give it permission first.

1. Open [Google Calendar](https://calendar.google.com).
2. In the left sidebar, find the calendar you want Atlas to use. Hover over it and click the **three-dot menu** → **Settings and sharing**.
3. Scroll to **Share with specific people or groups**.
4. Click **Add people** and enter:

   `auzora-automation@fifth-base-474500-i3.iam.gserviceaccount.com`

5. Set the permission to **Make changes to events**.
6. Click **Send**.

> **Note:** You do not need to accept an invite — service account shares are granted immediately.

## Step 2 — Find your Calendar ID

1. In **Settings and sharing** for the same calendar, scroll to **Integrate calendar**.
2. Copy the **Calendar ID**. It looks like one of these:
   - Your primary calendar: `yourname@gmail.com`
   - A secondary calendar: `abc123xyz@group.calendar.google.com`
3. Paste this ID into the **Google Calendar ID** field in your [Auzora portal](https://auzora.io/portal).

## Step 3 — Set your working hours

Atlas AI uses your working hours to tell callers when appointments are available. Set these in Google Calendar so they stay in sync.

1. Open [Google Calendar](https://calendar.google.com) → **Settings** (gear icon, top right).
2. Click **General** → **Working hours & location**.
3. Toggle **Use working hours** on.
4. Check the days you work and set your start and end times for each day.
5. Click **Save**.

**Recommended settings:**

| Day | Typical hours |
|---|---|
| Monday – Friday | 9:00 AM – 5:00 PM |
| Saturday | Off or custom |
| Sunday | Off |

> Atlas AI reads your availability when scheduling. Keeping working hours accurate prevents appointments from being booked outside business hours.

## Step 4 — Set up free/busy status

When Atlas checks if you are available, it reads whether time slots are marked **Free** or **Busy**.

- **Busy** blocks are respected — Atlas will not schedule over them.
- **Free** blocks are ignored — Atlas treats those slots as open.

To mark an event as Busy:
1. Open any existing event.
2. Click **Edit**.
3. Find the **Status** dropdown (may be labeled **Free / Busy**).
4. Select **Busy** and save.

For recurring blocks (lunch, team standups, personal time) set them to **Busy** so Atlas never books over them.

## Step 5 — Add a holiday calendar

Google provides pre-built holiday calendars for every country. Adding one ensures Atlas does not schedule appointments on public holidays.

1. In Google Calendar, click **Other calendars** (+) in the left sidebar.
2. Select **Browse calendars of interest**.
3. Click **Holidays** and choose your country (e.g. **Holidays in United States**).
4. Click **Subscribe**. The calendar will appear in your sidebar.

Holiday events are automatically marked **Busy** — Atlas will treat those days as unavailable.

> **Tip:** If you observe holidays that differ from the standard list, block those days manually and mark them **Busy**.

## Step 6 — Verify the connection

1. Log in to your [Auzora portal](https://auzora.io/portal).
2. Go to **Settings** → **Google Calendar**.
3. Click **Verify Connection**. You should see a green checkmark.
4. Make a test booking by calling your Atlas number.
5. Confirm the event appears on your Google Calendar.

## Troubleshooting

| Problem | Fix |
|---|---|
| Event not appearing | Re-check that the service account email is shared with **Make changes to events** permission |
| Wrong calendar | Confirm the Calendar ID in the portal matches the calendar you shared |
| Atlas booking outside business hours | Set working hours in Google Calendar (Step 3) and save |
| Holidays not blocked | Subscribe to the holiday calendar (Step 5) and verify events show as Busy |
| Verify connection fails | Double-check the Calendar ID — it is case-sensitive |

## Need help?

If you get stuck, reach out:

- Email: [support@auzora.io](mailto:support@auzora.io)
- Or use the chat on [auzora.io](https://auzora.io)
