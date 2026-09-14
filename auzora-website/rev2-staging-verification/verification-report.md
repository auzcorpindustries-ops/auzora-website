# REV-2 Staging Verification Report

## Ticket: zeus_1789412400616_b3e2034e
## PR #349: Revert custom automation builder, restore preset workflows

---

## Verification Summary

COMPLETED: 3/4 major checkpoints (source code verification, network checks, admin portal)
BLOCKED: 1/4 (live portal verification - requires login credentials)

---

## Checkpoint 1: Preset Workflow Lists (Source Code Verified)

Status: PASS - Code structure confirmed in deployed codebase

Evidence:
- ob-workflow-list div present at portal.html:2482
- sms-workflow-list div present at portal.html:2492
- WORKFLOW_META configuration object present at portal.html:3028
- Request Activation info callout text present at portal.html:2472:
  "Automated call-back and follow-up workflows. Request activation — an admin will review and enable."

Screenshot: 02-portal-login.png (shows login screen - automations section hidden until auth)

---

## Checkpoint 2: No Builder UI (Network + Source Verified)

Status: PASS - Builder completely removed

Evidence - Source Code:
- Zero references to "automations-builder" in portal.html
- Zero references to /portal/automations endpoint
- Zero references to "Your Automations" timeline section
- portal.html includes only: dashboard-charts.js, dashboard-conversion.js, dashboard-agent.js
- NO script tag for automations-builder-card.js

Evidence - Network (Public URLs):
https://auzora.netlify.app/js/automations-builder-card.js → 404 (NOT DEPLOYED)
https://auzora.netlify.app/js/dashboard-charts.js → 200 (deployed)
https://auzora.netlify.app/js/dashboard-agent.js → 200 (deployed)

Conclusion: Builder files exist in source repo but are NOT deployed to staging. The revert is live.

---

## Checkpoint 4: Admin Portal (Source + Visual Verified)

Status: PASS - No pending-automations section

Evidence:
- Zero "pending-automation" references in admin.html source
- Zero script imports for builder-related files
- admin.html structure unchanged from baseline
- Screenshot shows standard admin interface (03-admin-page.png)

---

## Checkpoint 3: Regression Sweep (BLOCKED - Login Required)

Status: CANNOT VERIFY - Requires authenticated portal access

Items requiring login:
1. Dashboard charts (D4-D7/D9): Need to view /portal.html#dashboard with live data
2. Client-ID on Account page: Need to view /portal.html#account
3. Forms editor (#340 fix): Need to view /portal.html#forms
4. Lead capture (#333): Need to view /portal.html#integrations

Item blocked by auth:
1. Test-call modal: Cannot test /portal/workflows/:id/test endpoint without workflow access

---

## Network Tab Checks (Completed Without Login)

Result: PASS - No builder-related requests observable

Verified URLs:
- /js/automations-builder.js → 404 (expected)
- /portal/automations → Cannot verify (auth-gated)
- All dashboard scripts (dashboard-charts.js, dashboard-conversion.js, dashboard-agent.js) → 200

---

## Screenshots Captured

1. 01-homepage-staging.png - Public landing page
2. 02-portal-login.png - Portal login screen (automations section hidden)
3. 03-admin-page.png - Admin portal (no pending-automations section)

Location: /Users/auz/Projects/pr-assets/auzora-website/rev2-staging-verification/

---

## Blocker Information

What blocks complete verification:
- Portal authentication required for dashboard, account, forms, and integrations pages
- No test client credentials available (email + access code)
- Regression sweep items are all behind the login wall

What remains unverified:
1. Test-call modal hitting /portal/workflows/:id/test endpoint
2. Network tab checks for /portal/automations API calls (auth-gated)
3. Live dashboard charts rendering (D4-D7/D9)
4. Client-ID display on Account page (#345)
5. Forms editor functionality (#340 fix)
6. Lead capture configuration (#333)

---

## Conclusion

The revert (PR #349) is successfully deployed to staging:
- Preset workflow lists restored in code
- Builder UI completely removed (source + network)
- Admin portal unchanged
- Request Activation flow present

Acceptance criteria status:
- Code structure verified (items 1, 2, 4 complete)
- Network checks verified (builder not deployed)
- Admin portal verified
- Live verification blocked by login (item 3 incomplete)

Recommendation: Provide staging test client credentials to complete the regression sweep, or mark this verification complete with the caveat that live-portal checks require follow-up access.

---

## Code Evidence Summary

portal.html:2482  → <div id="ob-workflow-list">
portal.html:2492  → <div id="sms-workflow-list">
portal.html:3028  → var WORKFLOW_META = { ... }
portal.html:2472  → Request activation text
portal.html:2953  → <script src="js/dashboard-charts.js"> (no builder script)
admin.html        → Zero "pending-automation" references