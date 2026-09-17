# Auzora Third-Party Integrations Documentation

**Last Updated:** 2025-09-12  
**Purpose:** Comprehensive audit of all external third-party integrations across Auzora's system (auzora-website marketing site + atlas-ai backend service). This document traces each integration end-to-end based on actual code and configuration.

---

## Table of Contents

1. [Twilio](#twilio) - Phone & SMS
2. [OpenAI](#openai) - AI Conversation & TTS
3. [ElevenLabs](#elevenlabs) - Text-to-Speech — **DISABLED September 2026 (ELE plan)**
4. [Google](#google) - Calendar & OAuth
5. [Square](#square) - Payments & Calendar
6. [Stripe](#stripe) - Billing
7. [AWS](#aws) - Cloud Infrastructure
8. [Resend](#resend) - Email
9. [n8n](#n8n) - Automation Workflows
10. [Microsoft Azure](#microsoft-azure) - Outlook Calendar
11. [Netlify](#netlify) - Website Hosting

---

## Twilio

### Purpose & Related Features
- **Inbound/Outbound Voice:** Core phone infrastructure for AI receptionist. Handles all call routing, recording, and real-time audio streaming.
- **SMS/MMS:** Transactional SMS (booking confirmations, appointment reminders) and outbound campaigns. Supports media attachments.
- **Number Provisioning:** Dynamic purchase and configuration of phone numbers for new clients.
- **Status Webhooks:** Real-time call status updates (queued, ringing, in-progress, completed, failed).

### Where Integrated
- **Backend:** `atlas-ai/src/services/twilioProvision.js`, `src/services/smsService.js`, `src/index.js` (call webhooks)
- **Frontend:** Marketing site (contact form - simulated submit only, no real Twilio integration)

### How It Works

#### Voice Calls
1. Inbound call arrives to Twilio phone number → Twilio POSTs to `/call/inbound` (voice URL configured via `provisionTwilioNumber`)
2. Server responds with TwiML directing to OpenAI Realtime WebSocket endpoint
3. Twilio streams audio bidirectionally: caller audio → OpenAI RT API, TTS response → Twilio MP3 stream
4. Call status updates fire to `/call/status` webhook
5. Call recorded in DynamoDB (`atlas-calls` table) with Twilio SID, duration, outcome

#### SMS/MMS
- Uses Twilio REST API via `sendSms()` in `smsService.js`\- Supports both text-only SMS and MMS with media URLs (images, PDFs)
- Metered per-client monthly usage (tier-based caps)
- Transactional sends (booking confirmations, reminders) never blocked by caps
- Marketing/campaign sends gated at tier limits

#### Number Provisioning
- `provisionTwilioNumber()` searches available numbers in requested area code → falls back to any US number
- Purchases number via Twilio API
- Configures voice webhooks: `/call/inbound` (voice URL) and `/call/status` (status callback)
- Numbers stored in client record (`twilio_number` field)

### Auth & Configuration
- **Environment Variables:**
  - `TWILIO_ACCOUNT_SID` (Secrets Manager: `auzora/atlas-ai/env`)
  - `TWILIO_AUTH_TOKEN` (Secrets Manager: `auzora/atlas-ai/env`)
- **Configuration:** Webhook URLs derived from `PUBLIC_BASE_URL` or `SERVER_URL` (defaults to `https://atlas.6845165.xyz`)

### Dependencies Within Auzora
- **DynamoDB:** Client records store `twilio_number`, calls stored by Twilio SID
- **OpenAI Realtime:** TTS audio served to Twilio
- **Usage Service:** SMS metering per client (tier-based limits)

### Paid vs Free
- **Paid:** Pay-as-you-go for voice minutes, SMS/MMS messages, phone numbers
- **Pricing:** Not documented here (varies by volume)

### Environments
- **All Environments:** staging, prod (Twilio account shared; different subaccounts or number pools used)
- **Test:** Uses `nock` for HTTP mocking; `IS_TEST` flag skips real Twilio calls

### Key Files & Workflows
- `src/services/twilioProvision.js` - Number purchase & webhook config
- `src/services/smsService.js` - SMS/MMS sending with metering
- `src/index.js` - `/call/inbound`, `/call/status` webhooks
- `test/voice/` - Voice E2E tests with Twilio mocking

### Notes
- **Rate Limits:** Twilio enforces API rate limits; handled via automatic retries in SDK
- **Failure Handling:** Failed sends logged with error details; SMS metering failures never block sends
- **Webhook Idempotency:** Status callbacks processed idempotently via DynamoDB `call_sid` key
- **A2P 10DLC:** Carrier registration in progress (11 queue numbers for onboarding pool)

---

## OpenAI

### Purpose & Related Features
- **AI Conversation:** GPT-4o models via Realtime API for natural phone conversations (lead capture, booking, FAQ)
- **Text-to-Speech:** Fallback TTS (gpt-4o-mini-tts) when ElevenLabs unavailable
- **Speech-to-Text:** Native in Realtime API; no separate STT provider
- **Usage Billing:** Token/audio usage metered per client; feeds tier-based limits

### Where Integrated
- **Backend:** `src/services/openaiRealtime.js` (Realtime WebSocket handler), `src/services/elevenlabs.js` (TTS fallback)

### How It Works

#### Realtime API (Voice)
1. Twilio forwards caller audio to `/call/inbound`
2. Server creates WebSocket connection to OpenAI Realtime (`wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`)
3. Server acts as proxy: Twilio Media Streams ↔ OpenAI RT WebSocket
4. OpenAI returns TTS audio chunks → Server streams to Twilio via MP3
5. Server tracks token/audio usage via `providerUsageService.recordProviderUsage()`

#### TTS Fallback
- Configured in `elevenlabs.js`: `OPENAI_TTS_MODEL = 'gpt-4o-mini-tts'`
- Fallback trigger: ElevenLabs API errors, missing API key, or missing voice ID
- Usage tracked separately under `openai_tts_fallback` provider (not mixed with ElevenLabs billing)
- SNS alert sent on each fallback via `sendFallbackAlert()`

### Auth & Configuration
- **Environment Variables:**
  - `OPENAI_API_KEY` (Secrets Manager: `auzora/atlas-ai/env`)
- **Models:** `gpt-4o-realtime-preview-2024-12-17` (voice), `gpt-4o-mini-tts` (TTS fallback)

### Dependencies Within Auzora
- **Twilio:** Audio streaming to/from callers
- **DynamoDB:** Call records store `provider_usage.openai` fields
- **AWS SNS:** Fallback alerts to ops team
- **Metrics Service:** Usage feeds Prometheus counters (`#502`)

### Paid vs Free
- **Paid:** Token usage (Realtime API), TTS character usage
- **Pricing:** Not documented here (varies by model/usage)

### Environments
- **All Environments:** staging, prod (same OpenAI org; separate API keys per env)
- **Test:** Mocked via test fixtures; no real API calls

### Key Files & Workflows
- `src/services/openaiRealtime.js` - WebSocket handler, usage capture
- `src/services/elevenlabs.js` - TTS fallback logic
- `src/services/providerUsageService.js` - Usage metering
- `test/voice/` - E2E voice tests with OpenAI mocking

### Notes
- **TCPA Compliance:** System prompt prepended with AI disclosure (non-bypassable)
- **Rate Limits:** OpenAI enforces RPM/TPM limits; handled gracefully with retries
- **Failure Handling:** If ElevenLabs fails, OpenAI TTS fallback used; if both fail, call ends gracefully
- **Billing:** Usage captured per call via response headers and passed to `providerUsageService`

---

## ElevenLabs

> **DISABLED September 2026 (ELE plan) — retained in codebase for future removal (atlas-ai ELE-6).** The ElevenLabs kill-switch (`ELEVENLABS_DISABLED=true`, ELE-1) is active in atlas-ai `elevenlabs.js`: no api.elevenlabs.io call is attempted and no ElevenLabs usage is metered. The historical integration reference below is quoted as-is and no longer describes live behavior.

<details>
<summary>Historical reference — ElevenLabs integration as documented before the September 2026 disable (click to expand)</summary>

### Purpose & Related Features
- **Primary TTS:** High-quality text-to-speech for AI voice (default for all clients)
- **Voice Catalog:** Multiple voice options (e.g., 'uMM5TEnpKKgD758knVJO' - default)
- **Client Custom Voices:** Per-client voice selection via `voice_id` field

### Where Integrated
- **Backend:** `src/services/elevenlabs.js`

### How It Works
1. `synthesize()` called with text + optional voice ID
2. If `provider === 'openai'` (client opt-in), routes to OpenAI TTS immediately
3. Otherwise, fetches ElevenLabs voice ID (client `voice_id` or `ELEVENLABS_VOICE_ID` env var)
4. POST to `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}?output_format=mp3_22050_32`
5. Settings: `model_id: 'eleven_turbo_v2_5'`, stability 0.65, similarity_boost 0.70, style 0.0, speaker_boost true
6. Extracts usage from `xi-character-count` response header
7. Records usage via `providerUsageService.recordProviderUsage()` under `elevenlabs` provider
8. On any error, falls back to OpenAI TTS + sends SNS alert

### Auth & Configuration
- **Environment Variables:**
  - `ELEVENLABS_API_KEY` (Secrets Manager: `auzora/atlas-ai/env`)
  - `ELEVENLABS_VOICE_ID` (fallback default voice)
  - `OPENAI_TTS_FALLBACK_VOICE` (fallback voice if ElevenLabs fails; defaults to 'alloy')
- **Model:** `eleven_turbo_v2_5` (fast, optimized for telephony)

### Dependencies Within Auzora
- **OpenAI:** TTS fallback
- **AWS SNS:** Fallback alerts
- **DynamoDB:** Call records store `provider_usage.elevenlabs`
- **Metrics Service:** Usage feeds Prometheus counters

### Paid vs Free
- **Paid:** Character-based billing (30K-200K characters/month depending on tier)
- **Pricing:** Not documented here

### Environments
- **All Environments:** staging, prod (same ElevenLabs account; API key rotates)
- **Test:** Mocked via test fixtures

### Key Files & Workflows
- `src/services/elevenlabs.js` - TTS synthesis + fallback
- `src/services/voiceCatalog.js` - Voice definitions + client voice normalization
- `src/services/providerUsageService.js` - Usage extraction & metering

### Notes
- **Output Format:** `mp3_22050_32` optimized for Twilio's 8kHz downsample
- **Rate Limits:** ElevenLabs enforces RPM; handled with retries
- **Failure Handling:** Graceful fallback to OpenAI TTS on any error
- **Billing:** Usage captured from response header (empirically verified 2026-08-30)

</details>

---

## Google

### Purpose & Related Features
- **Calendar Sync:** Two paths for booking appointments:
  1. **OAuth 2.0** (preferred): Client signs in with Google → per-user OAuth tokens → personal calendar
  2. **Domain-Wide Delegation (DWD)**: Shared service account + manual calendar sharing
- **Calendar Features:** Free/busy checks, event creation, participant invites, rescheduling, cancellation
- **User Info:** OAuth fetches user's email/name for account linking

### Where Integrated
- **Backend:** `src/services/googleCalendar.js`, `src/services/googleOAuth.js`
- **Frontend:** Marketing site (no direct integration)

### How It Works

#### OAuth 2.0 Path (New)
1. Portal redirects to Google auth URL (`buildAuthorizationUrl`)
2. User grants consent (scopes: calendar, userinfo.email, userinfo.profile)
3. Google redirects back with auth code → `exchangeCodeForTokens()` gets access + refresh tokens
4. Tokens encrypted via AES-256-GCM, stored in client record
5. `getOAuthCalendarClient()` provides per-client Calendar client
6. Access tokens auto-refresh before expiry (60s buffer)
7. Calendar operations use client's OAuth context

#### Domain-Wide Delegation Path (Legacy)
1. Google Service Account key file at `config/google-sa-key.json` (dropped via tempkeys protocol)
2. Service account authenticates with `https://www.googleapis.com/auth/calendar`
3. Optionally impersonates real Workspace user (`GOOGLE_IMPERSONATE_EMAIL`) for invite sending
4. Client manually shares calendar with service account email
5. Calendar operations use DWD client

### Auth & Configuration
- **OAuth Env Vars:**
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_REDIRECT_URI` (e.g., `https://atlas.6845165.xyz/auth/google/callback`)
  - `TOKEN_ENCRYPTION_KEY` or `SQUARE_TOKEN_ENCRYPTION_KEY` (32-byte AES-256-GCM key)
- **DWD Env Vars:**
  - `GOOGLE_IMPERSONATE_EMAIL` (optional, for invite sending)
- **Service Account Key:** `config/google-sa-key.json` (not in repo; dropped via tempkeys)

### Dependencies Within Auzora
- **DynamoDB:** Client records store OAuth tokens (encrypted), `google_calendar_id`
- **calendarProvider.js:** Pluggable calendar interface
- **bookingOrchestrator.js:** Uses calendar for bookings

### Paid vs Free
- **Free:** Google Calendar API (within Google's quotas)
- **Pricing:** Not applicable (included with Google Workspace)

### Environments
- **All Environments:** staging, prod (separate OAuth apps, separate service accounts)
- **Test:** Mocked via nock

### Key Files & Workflows
- `src/services/googleCalendar.js` - FreeBusy, event CRUD, participant management
- `src/services/googleOAuth.js` - OAuth flow, token encryption/refresh
- `src/services/calendarProvider.js` - Calendar interface abstraction
- `docs/google-calendar-setup.md` - Client setup guide

### Notes
- **Scopes:** `https://www.googleapis.com/auth/calendar`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile`
- **Rate Limits:** Google Calendar API enforces quotas; logged at WARN on failure
- **Failure Handling:** FreeBusy failures fail open (booking allowed without conflict check)
- **Encryption:** AES-256-GCM for OAuth tokens at rest
- **DWD Prereqs:** Admin Console → Security → Domain-Wide Delegation (client ID: 105806815243905421278)

---

## Square

### Purpose & Related Features
- **Calendar Provider (Optional):** Alternative to Google/Outlook for appointment bookings
- **Appointment Management:** Create, update, cancel bookings via Square Appointments API
- **OAuth 2.0:** Per-merchant authorization

### Where Integrated
- **Backend:** `src/services/squareAuth.js`, `src/services/providers/squareCalendarProvider.js`

### How It Works
1. Portal redirects to Square OAuth (`buildAuthorizationUrl`)
2. Merchant grants consent (scopes: APPOINTMENTS_READ, APPOINTMENTS_WRITE, etc.)
3. Square redirects back with auth code → `exchangeCodeForTokens()` gets access + refresh tokens
4. Tokens encrypted via AES-256-GCM, stored in client record
5. `getValidAccessToken()` returns access token, auto-refreshing before expiry (24h buffer)
6. Calendar operations use Square Appointments API

### Auth & Configuration
- **Environment Variables:**
  - `SQUARE_APPLICATION_ID`
  - `SQUARE_APPLICATION_SECRET`
  - `SQUARE_TOKEN_ENCRYPTION_KEY` (32-byte AES-256-GCM key)
  - `SQUARE_ENV` (`'sandbox'` or `'production'`, defaults to production)
- **Endpoints:**
  - OAuth: `https://connect.squareup.com/oauth2/authorize`
  - Token: `https://connect.squareup.com/oauth2/token`
  - Revoke: `https://connect.squareup.com/oauth2/revoke`

### Dependencies Within Auzora
- **DynamoDB:** Client records store encrypted tokens, `square_merchant_id`, `square_location_id`
- **calendarProvider.js:** Pluggable calendar interface

### Paid vs Free
- **Free:** Square API (within Square's quotas)
- **Pricing:** Not applicable (included with Square account)

### Environments
- **All Environments:** staging, prod (separate Square apps; sandbox for testing)
- **Test:** Mocked via nock

### Key Files & Workflows
- `src/services/squareAuth.js` - OAuth flow, token encryption/refresh
- `src/services/providers/squareCalendarProvider.js` - Calendar interface implementation

### Notes
- **Scopes:** APPOINTMENTS_READ, APPOINTMENTS_WRITE, APPOINTMENTS_ALL_WRITE, MERCHANT_PROFILE_READ, TEAM_READ, CUSTOMERS_READ, CUSTOMERS_WRITE, CATALOG_READ
- **Token Expiry:** Access tokens expire in 30 days; refresh tokens are multi-use
- **Encryption:** AES-256-GCM for tokens at rest
- **Fallback:** On disconnect, `calendar_provider` resets to 'google'

---

## Stripe

### Purpose & Related Features
- **Billing & Payments:** Subscription payments, invoice management, payment failures
- **Webhooks:** subscription.updated, subscription.deleted, payment_intent.succeeded, payment_intent.payment_failed
- **Customer Mapping:** Stripe customer ID → Auzora client ID (via `stripe_customer_id` field)

### Where Integrated
- **Backend:** `src/index.js` (Stripe webhooks), `src/services/billingAlerts.js`
- **Frontend:** Marketing site checkout.html (Stripe.js client-side)

### How It Works
1. User completes signup via marketing site → Stripe Checkout Session
2. Payment succeeds → Stripe sends `checkout.session.completed` webhook
3. Server creates Auzora client record + links `stripe_customer_id`
4. `sendSetupEmail()` sends onboarding link
5. Future Stripe webhooks update client status (subscription changes, payment failures)
6. Billing alerts sent via AWS SNS (`sendBillingAlert`)

### Auth & Configuration
- **Environment Variables:**
  - `STRIPE_SECRET_KEY` (Secrets Manager: `auzora/atlas-ai/env`)
  - `STRIPE_WEBHOOK_SECRET` (for webhook signature verification)
- **Frontend:** Stripe.js loaded from `https://js.stripe.com/v3/`

### Dependencies Within Auzora
- **DynamoDB:** Client records store `stripe_customer_id`; query via `StripeCustomerIndex` GSI
- **Email:** `sendSetupEmail` for onboarding
- **AWS SNS:** Billing alerts

### Paid vs Free
- **Paid:** Transaction fees (2.9% + 30¢ per payment)
- **Pricing:** Not documented here

### Environments
- **All Environments:** staging (test mode keys), prod (live mode keys)
- **Test:** Mocked via Stripe test fixtures

### Key Files & Workflows
- `src/index.js` - Webhook handlers (`/stripe/webhook`)
- `src/services/billingAlerts.js` - SNS alerts for billing events
- `auzora-website/checkout.html` - Stripe Checkout integration

### Notes
- **Webhook Verification:** Signature verified via `STRIPE_WEBHOOK_SECRET`
- **Customer Lookup:** `getClientByStripeCustomerId()` for webhook routing
- **Failure Handling:** Webhook failures logged; Stripe auto-retries
- **Billing Alerts:** SNS topic `SNS_ALERTS_TOPIC_ARN` for ops team

---

## AWS

### Purpose & Related Features
- **DynamoDB:** Primary database (clients, calls, leads, campaigns, forms)
- **Secrets Manager:** Secure storage for API keys (Twilio, OpenAI, ElevenLabs, Stripe, n8n)
- **SNS:** Ops alerts (TTS fallback, billing events)
- **SQS:** (Referenced in package.json but not actively used in current codebase)
- **Cost Explorer:** (Referenced in package.json for cost tracking)
- **Cloud Infrastructure:** EC2 hosting (staging i-0740b6b8d596caa4e, prod i-01c663996c496996b, infra i-06f40a36a754c7bd7)

### Where Integrated
- **Backend:** `src/services/dynamo.js`, `src/services/secretLoader.js`, `src/services/billingAlerts.js`, `src/services/elevenlabs.js`

### How It Works

#### DynamoDB
- Tables: `atlas-clients`, `atlas-calls`, `atlas-leads`, `atlas-campaigns`, `atlas-forms`
- GSIs: `TwilioNumberIndex`, `StripeCustomerIndex`, `client_id-index`
- Operations: Put, Get, Update, Query, Scan, Delete
- Conditional writes: `updateCallUnlessBooked()` prevents outcome downgrades

#### Secrets Manager
- `aws secretsmanager get-secret-value --secret-id auzora/atlas-ai/env` (via tempkeys protocol)
- Secret keys: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `STRIPE_SECRET_KEY`, `N8N_API_KEY`, etc.
- Not loaded in test environment (uses fixtures instead)

#### SNS
- Topic: `SNS_ALERTS_TOPIC_ARN`
- Alerts: TTS fallback (ElevenLabs → OpenAI), billing events (subscription changes, payment failures)

### Auth & Configuration
- **Environment Variables:**
  - `AWS_REGION` (defaults to us-east-2)
  - `AWS_PROFILE` (auzora-ops for local dev)
- **Secrets Path:** `auzora/atlas-ai/env` (Secrets Manager)

### Dependencies Within Auzora
- **All Services:** DynamoDB as primary data store
- **All APIs:** Secrets Manager for credentials
- **Monitoring:** SNS for ops alerts

### Paid vs Free
- **Paid:** DynamoDB read/write units, Secrets Manager API calls, SNS publishes, EC2 compute
- **Pricing:** Not documented here

### Environments
- **All Environments:** staging, prod (separate AWS accounts or separate tables via prefixes)
- **Test:** DynamoDB Local (docker) for integration tests (`DYNAMODB_ENDPOINT` env var)

### Key Files & Workflows
- `src/services/dynamo.js` - All DynamoDB operations
- `src/services/secretLoader.js` - Secrets Manager loading
- `src/services/billingAlerts.js` - SNS billing alerts
- `src/services/elevenlabs.js` - SNS TTS fallback alerts

### Notes
- **Region:** us-east-2 (Ohio)
- **Profile:** auzora-ops (local dev via AWS CLI)
- **Local Testing:** DynamoDB Local via docker; `test/helpers/localDynamo.js`
- **Secrets Loading:** tempkeys protocol (Auzi drops secret file, server loads on startup)

---

## Resend

### Purpose & Related Features
- **Transactional Email:** Welcome emails, setup emails, approval emails, access code changes, account deletions
- **From Address:** `Auzora <noreply@auzora.io>`

### Where Integrated
- **Backend:** `src/services/email.js`
- **Frontend:** None (marketing site contact form is simulated only)

### How It Works
1. `sendEmail()` called with to, subject, html
2. POST to `https://api.resend.com/emails`
3. Authorization header: `Bearer RESEND_API_KEY`
4. Returns email ID on success
5. Test sandbox: Under `NODE_ENV=test`, emails captured to in-memory outbox (no real sends)

### Auth & Configuration
- **Environment Variables:**
  - `RESEND_API_KEY` (Secrets Manager: `auzora/atlas-ai/env`)

### Dependencies Within Auzora
- **Stripe:** Triggers `sendSetupEmail` on payment success
- **Calendar:** Triggers `sendApprovalEmail` on booking (for Google Workspace without Business plan)
- **Auth:** Triggers access code change/deletion emails

### Paid vs Free
- **Paid:** Per-email sending (3,000 emails/month free on Starter tier)
- **Pricing:** Not documented here

### Environments
- **All Environments:** staging, prod (same Resend account; API key rotates)
- **Test:** In-memory outbox (see `email.js _internal` helpers)

### Key Files & Workflows
- `src/services/email.js` - All email templates + sending logic
- `test/helpers/` - Outbox inspection in tests

### Notes
- **Templates:** Inline HTML with Gmail-safe table-based buttons
- **Fallback:** If `RESEND_API_KEY` not set, emails skipped with WARN log
- **Test Mode:** `NODE_ENV=test` forces sandbox (never hits Resend API)

---

## n8n

### Purpose & Related Features
- **Automation Workflows:** Client-triggered workflows for lead follow-up, campaigns, missed calls
- **Workflow Templates:** Pre-built templates cloned per client:
  1. Inbound Lead Follow-Up
  2. After Hours Lead Follow-Up
  3. Unresponsive Leads
  4. Outreach Campaign Follow Up
  5. Missed Call Auto SMS
  6. Missed Call Auto Callback

### Where Integrated
- **Backend:** `src/services/n8nService.js`, `src/services/webhookDispatcher.js`
- **Frontend:** None

### How It Works
1. `cloneTemplate(clientId, templateNumber)` called when client enables automation
2. Fetches template workflow from n8n via API
3. Renames workflow: `auzora_<clientId>_<N>-<slug>`
4. Updates webhook paths: `<clientId>/<eventPath>`
5. Injects `client_id` into HTTP request node bodies
6. Creates workflow (inactive) → activates via API
7. Events (calls, leads, campaigns) trigger webhooks via `getWebhookUrl()`
8. `webhookDispatcher` fires to n8n webhook URLs

### Auth & Configuration
- **Environment Variables:**
  - `N8N_API_URL` (e.g., `http://localhost:5678/api/v1`)
  - `N8N_API_KEY` (Secrets Manager: `auzora/atlas-ai/env`)
  - `N8N_WEBHOOK_URL` (defaults to `https://automation.6845165.xyz`)
- **Template IDs:** Hardcoded in `TEMPLATES` object (must match n8n instance)

### Dependencies Within Auzora
- **DynamoDB:** Client records store `n8n_workflow_ids` mapping
- **webhookDispatcher:** Event routing to n8n

### Paid vs Free
- **Self-Hosted:** Free (n8n Community Edition, self-hosted on EC2)
- **Pricing:** Not applicable (self-hosted)

### Environments
- **All Environments:** staging, prod (separate n8n instances; template IDs may differ)
- **Test:** Mocked via nock

### Key Files & Workflows
- `src/services/n8nService.js` - Template cloning, activation, deletion
- `src/services/webhookDispatcher.js` - Event routing to n8n

### Notes
- **Naming:** Workflows named `auzora_<clientId>_<N>-<slug>`
- **Webhook Paths:** `<clientId>/<eventPath>` for per-client isolation
- **Activation:** POST `/workflows/:id/activate` (must create inactive first)
- **Cleanup:** On activation failure, created workflow deleted before retry

---

## Microsoft Azure

### Purpose & Related Features
- **Outlook Calendar:** Optional calendar provider for clients using Microsoft 365
- **Microsoft Graph API:** Free/busy checks, event CRUD, participant management

### Where Integrated
- **Backend:** `src/services/providers/outlookCalendarProvider.js`
- **Frontend:** None

### How It Works

#### Authentication
1. Uses Entra ID (Azure AD) app registration with client-credentials flow
2. App must have `Calendars.ReadWrite` application permission (admin consent)
3. Token acquired via `https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token`
4. Token cached for 1 hour; refreshed at 50 min

#### Calendar Operations
- **Free/Busy:** `getSchedule` API checks availability
- **Create Event:** POST to `/users/{email}/calendar/events`
- **Add Participant:** PATCH event to add attendees
- **Cancel Event:** DELETE event
- **Verify Access:** GET calendar to validate permissions

### Auth & Configuration
- **Environment Variables:**
  - `AZURE_TENANT_ID`
  - `AZURE_CLIENT_ID`
  - `AZURE_CLIENT_SECRET`
  - `OUTLOOK_AUTOMATION_EMAIL` (defaults to `automation@auzora.io`)

### Dependencies Within Auzora
- **DynamoDB:** Client records store `outlook_calendar_id` (email or calendar ID)
- **calendarProvider.js:** Pluggable calendar interface

### Paid vs Free
- **Free:** Microsoft Graph API (within Microsoft 365 quotas)
- **Pricing:** Not applicable (included with Microsoft 365)

### Environments
- **All Environments:** staging, prod (separate Entra ID apps)
- **Test:** Mocked via nock

### Key Files & Workflows
- `src/services/providers/outlookCalendarProvider.js` - Full Graph API integration

### Notes
- **Scopes:** `https://graph.microsoft.com/.default`
- **Token Expiry:** 1 hour (refreshed at 50 min)
- **Calendar ID:** Client provides either email (userPrincipalName → default calendar) or specific calendar ID
- **Fail Open:** Graph API failures logged but don't block bookings

---

## Netlify

### Purpose & Related Features
- **Website Hosting:** Hosts auzora-website marketing site (static site)
- **CDN:** Global edge network for fast content delivery
- **Redirects/Rewrites:** Configured via `_redirects` file
- **Headers:** Configured via `_headers` file

### Where Integrated
- **Frontend:** Entire auzora-website repo (static HTML/CSS/JS)
- **Backend:** None (marketing site has no backend; forms are simulated)

### How It Works
1. Git push to GitHub → Netlify auto-deploys on push to `main` branch
2. Static assets (HTML, CSS, JS, images) served from CDN
3. Custom domain: `auzora.io` configured in Netlify DNS
4. Redirects: `/portal` → `https://atlas.6845165.xyz/portal`
5. Build: No build step (static site; `package.json` only for Jest tests)

### Auth & Configuration
- **Git Integration:** Netlify connected to `auzcorpindustries-ops/auzora-website` repo
- **Deploy Branch:** `main` (live production)
- **Custom Domain:** `auzora.io` via Netlify DNS
- **Configuration Files:** `_redirects`, `_headers`, `.netlify/` directory

### Dependencies Within Auzora
- **GitHub:** Source control & deployment trigger
- **atlas-ai:** Portal redirect (not a direct dependency)

### Paid vs Free
- **Paid:** Netlify Pro tier (for custom domain, advanced features)
- **Pricing:** Not documented here

### Environments
- **Production:** `auzora.io` (from `main` branch)
- **Staging:** Deploy previews on PRs

### Key Files & Workflows
- `_redirects` - URL redirects (portal, legacy routes)
- `_headers` - Custom HTTP headers
- `.netlify/` - Netlify configuration
- `package.json` - Jest tests only (no runtime dependencies)

### Notes
- **Static Site:** No build process; pure HTML/CSS/JS
- **Test Only:** `package.json` has Jest for E2E tests, no runtime deps
- **Redirects:** `/portal` → `https://atlas.6845165.xyz/portal` (portal lives on atlas-ai)
- **Forms:** Contact form simulates submit only (no real backend integration)

---

## Summary by Category

| Category | Integrations | Criticality |
|----------|--------------|-------------|
| Voice/Phone | Twilio, OpenAI Realtime, ElevenLabs | **Critical** (core product) |
| AI/ML | OpenAI (Chat + TTS), ElevenLabs | **Critical** (core product) |
| Calendar | Google (OAuth + DWD), Square, Microsoft Azure (Outlook) | High (booking feature) |
| Billing | Stripe | High (revenue) |
| Database | AWS DynamoDB | **Critical** (data persistence) |
| Secrets | AWS Secrets Manager | **Critical** (credential security) |
| Email | Resend | Medium (transactional) |
| Automation | n8n | Medium (lead nurturing) |
| Alerts | AWS SNS | Medium (ops visibility) |
| Hosting | Netlify | Low (marketing site only) |

---

## Audit Notes

### Scope & Methodology
- Audited actual code in `atlas-ai/src/` and `auzora-website/` repos
- Traced integrations end-to-end: auth flow, data flow, configuration, error handling
- Verified environment variable usage and Secrets Manager paths
- Cross-referenced with package.json dependencies

### Key Findings
1. **OAuth Providers:** Google, Square, Microsoft Azure all use OAuth 2.0 with token encryption (AES-256-GCM)
2. **Fallback Patterns:** ElevenLabs → OpenAI TTS (graceful degradation with alerts)
3. **Fail-Open Policies:** Google/Outlook FreeBusy failures allow bookings (logs at WARN/ERROR)
4. **Token Management:** Auto-refresh before expiry (Google: 60s buffer, Square: 24h buffer, Azure: 10m buffer)
5. **Usage Metering:** OpenAI, ElevenLabs metered per call; SMS metered per client
6. **Test Isolation:** All integrations mocked in tests (nock, DynamoDB Local, in-memory outbox)

### Security Considerations
- All API credentials stored in AWS Secrets Manager (`auzora/atlas-ai/env`)
- OAuth tokens encrypted at rest (AES-256-GCM)
- Webhook signature verification (Stripe)
- CSRF protection via OAuth state parameters (Google, Square)
- Tempkeys protocol for secret loading (Auzi drops secret file on EC2)

### Rate Limiting & Failures
- **Twilio:** SDK handles retries; rate limits logged
- **OpenAI:** Realtime API enforces RPM/TPM; handled gracefully
- **ElevenLabs:** RPM limits; handled with retries + fallback
- **Google Calendar:** Quotas; failures fail open
- **Stripe:** Webhook auto-retries on 5xx

### Missing/Deprecated Integrations
- **AWS SQS:** Referenced in package.json but not used in current codebase
- **AWS Cost Explorer:** Referenced in package.json but usage unclear
- **Marketing Site Forms:** Contact form simulated only (no real integration)

---

## Next Steps for Maintenance

1. **Secret Rotation:** Document process for rotating API keys (Twilio, OpenAI, ElevenLabs, Stripe, n8n)
2. **OAuth Token Audits:** Regular review of encrypted OAuth tokens in DynamoDB
3. **Quota Monitoring:** Set up alerts for Google Calendar, AWS service quotas
4. **Fallback Testing:** Regularly test ElevenLabs → OpenAI TTS fallback path
5. **Template Sync:** Ensure n8n template IDs match production instance after any template changes

---

**Document Owner:** Auzora Engineering Team  
**Review Cycle:** Quarterly or on integration change  
**Related Docs:** `docs/google-calendar-setup.md`, `docs/forwarding-personal-phone-to-atlas.md`, `docs/using-your-atlas-phone-number.md`