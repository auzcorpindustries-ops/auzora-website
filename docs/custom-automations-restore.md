# Custom Automations Restore Runbook

**Ticket:** zeus_1789412400763_7d74c455 (REV-3)
**Related:** REV-1 (zeus_1789412400465_aa6b3521)
**Date:** 2026-09-14

## What Was Reverted

Two PRs were reverted on 2026-09-14 via PR #349 (commit `b73e65b`):

| PR | Commit SHA | Date | Scope |
|----|------------|------|-------|
| #346 | `624b5f1` | Sat Sep 12 05:09:46 2026 -0500 | AUT-6 visual automation builder |
| #348 | `292d952` | Mon Sep 14 12:16:48 2026 -0500 | AUT-7 portal + admin approval UI |

### PR #346 (624b5f1) — AUT-6 Visual Automation Builder

**Files changed:**
- `js/automations-builder.js` — 984 lines (new file)
- `portal.html` — 23 insertions, 16 deletions
- `test/automations-builder.test.js` — 409 lines (47 unit tests)

**What it added:**
- One "Your Automations" section (Call/SMS/Hybrid) replacing two hardcoded preset lists
- Guided builder with n8n-inspired vertical rail UI
- Step cards: SMS (960 char cap with merge-field chips), Call (600 char cap), Wait intervals
- Live node graph strip (START → steps with arrows)
- Client-side validation matching AUT-1 server validator
- Save paths: POST/PUT `/portal/automations`, legacy preset migration

### PR #348 (292d952) — AUT-7 Approval Workflow UI

**Files changed:**
- `admin.html` — 152 lines
- `portal.html` — 8 insertions, 4 deletions

**What it added:**
- Admin pending-automations section with IR timeline
- `definition_hash` short-form display, `hash_changed` badge
- Portal test modal routed to `/automations/:id/test` for automation IDs

### Revert Impact (PR #349, b73e65b)

The revert removed:
- `js/automations-builder.js` (deleted, 984 lines)
- `test/automations-builder.test.js` (deleted, 409 lines)
- Portal.html builder section (restored preset lists)
- Admin.html pending-automations approval section (removed, -152 lines)
- Test modal routing (back to `/portal/workflows/:id/test` only)

Total: 1,556 lines removed, 20 lines restored.

## What Was KEPT

The backend automation stack on `auzcorpindustries-ops/atlas-ai` remains in place and was **not** reverted:

- AUT-1: IR representation and validator
- AUT-2: Compiler (IR → execution plan)
- AUT-3: Store (DynamoDB persistence)
- AUT-4: Dispatcher (Twilio integration)
- AUT-5: Legacy preset migration

**Atlas-ai PRs:**
- #542: Backend automation stack (AUT-1..5)
- #546: AUT-7 backend endpoints (approval workflow)

These endpoints remain unused by the current portal (portal no longer calls them), but the code is still deployed.

## How to Restore

### Prerequisites

1. **Branch:** Start from current `auzora-website/develop` tip
2. **Access:** Write access to `auzcorpindustries-ops/auzora-website`
3. **Tests:** Full `npx jest` must pass (baseline: 184 tests → 231 tests with builder)

### Restoration Method

The full implementation exists at commit `292d952` (PR #348), which includes all changes from both #346 and #348.

#### Option A: Cherry-Pick (Recommended)

```bash
cd /Users/auz/Projects/auzora-website
git checkout develop
git pull origin develop
git checkout -b restore/custom-automations

# Cherry-pick both commits in order
git cherry-pick 624b5f1  # PR #346 (builder)
git cherry-pick 292d952  # PR #348 (approval UI)

# Resolve conflicts if any (see below)
git push origin restore/custom-automations
```

#### Option B: Branch Merge

```bash
cd /Users/auz/Projects/auzora-website
git checkout develop
git pull origin develop
git checkout -b restore/custom-automations

# Create a temporary branch at the pre-revert state
git checkout -b temp/pre-revert 292d952
git checkout restore/custom-automations
git merge temp/pre-revert --no-ff -m "Restore custom automations frontend (REV-3)"

# Delete temp branch
git branch -D temp/pre-revert

# Resolve conflicts if any
git push origin restore/custom-automations
```

### Expected Conflicts

**Portal.html:** The revert restored the two hardcoded preset lists. The builder PR replaced these with a single "Your Automations" section. Expect conflicts in:

- The automations section of `portal.html`
- Preset list references (`#ob-workflow-list`, `#sms-workflow-list`)
- Workflow ID constants (`WORKFLOW_META`, `OB_WORKFLOW_IDS`, `SMS_WORKFLOW_IDS`)

**Resolution:** Accept the builder version of the automations section. The preset lists will still exist in the codebase (they were not deleted, just not used by the builder).

### Post-Restore Steps

1. **Run full test suite:**
   ```bash
   cd /Users/auz/Projects/auzora-website
   npx jest
   ```
   Expected: 231 tests pass (184 baseline + 47 new automations-builder tests)

2. **Verify admin allowlist:**
   - Check that admin.html includes the `AUT-7` pending-automations approval section
   - Ensure admin users can see pending automation requests

3. **Verify portal routing:**
   - Test modal should route to `/automations/:id/test` (not `/portal/workflows/:id/test`)

4. **Screenshots:** Capture the following for verification:
   - Portal "Your Automations" section with builder open
   - Admin pending-automations approval timeline
   - Step cards (SMS, Call, Wait)
   - Node graph strip (START → steps)

5. **Create PR:** Open PR to `develop` (NEVER `main`)

## Decision Log

### Why Reverted (2026-09-14)

**Product decision:** Auzi made a product call to revert to preset-first UX.

**Rationale:**
- The custom automation builder offered flexibility but increased complexity
- Preset workflows provide a simpler, opinionated experience for most users
- Unclear demand for full custom workflows at this stage

**Ticket:** zeus_1789412400465_aa6b3521 (REV-1)
**Revert PR:** #349 (commit `b73e65b`)
**Auto-merge status:** CI passed (Jest 184/184), merged 2026-09-14T19:02:50Z

### Why Preserved

**Rationale:**
- The backend stack (AUT-1..5, AUT-7) represents significant engineering investment
- Code is still functional and deployed on atlas-ai
- Likely to revisit custom automations in the future; preservation avoids re-engineering
- Portal simply stopped calling the endpoints; no backend deletion required

**Trade-off:**
- Atlas-ai serves unused endpoints (minimal cost, DynamoDB tables idle)
- Keeps restoration path simple (frontend only)

### Archive Status

**Note:** The revert commit message references `archive/custom-automations-frontend`, but this branch was never actually pushed to the remote. The full implementation is still available at commit `292d952` and can be restored via cherry-pick or branch merge (see above).

## Verification Checklist

When restoring, verify:

- [ ] `js/automations-builder.js` restored (984 lines)
- [ ] `test/automations-builder.test.js` restored (409 lines, 47 tests)
- [ ] Portal "Your Automations" section replaces preset lists
- [ ] Admin pending-automations section restored (152 lines)
- [ ] Test modal routes to `/automations/:id/test`
- [ ] Jest: 231/231 tests pass
- [ ] No merge conflicts beyond expected portal.html swap
- [ ] Screenshot verification complete

## References

- **Revert PR:** https://github.com/auzcorpindustries-ops/auzora-website/pull/349
- **PR #346:** https://github.com/auzcorpindustries-ops/auzora-website/pull/346
- **PR #348:** https://github.com/auzcorpindustries-ops/auzora-website/pull/348
- **Atlas-ai PR #542:** Backend stack (AUT-1..5)
- **Atlas-ai PR #546:** AUT-7 backend endpoints
- **REV-1 ticket:** zeus_1789412400465_aa6b3521
- **REV-3 ticket:** zeus_1789412400763_7d74c455