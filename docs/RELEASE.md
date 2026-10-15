# Release runbook — auzora.io production (PROD-4)

This is the documented, repeatable path from `develop` to the live site at
**https://auzora.io**. It replaces the previous tribal-knowledge release step.

## Branch model

| Branch | Purpose | Ships to production? |
| --- | --- | --- |
| `develop` | All feature work lands here via PR, auto-merged by `.github/workflows/auto-merge.yml` | No — Netlify serves `develop` at `develop--auzora.netlify.app` |
| `main` | **Production.** Only release PRs land here. | Yes — Netlify auto-deploys every push to `main` to auzora.io |

`main` is never pushed to directly and is never fast-forwarded by hand. It
moves **only** by merging a `develop → main` release pull request.

## Why a PR and not a direct fast-forward

A release PR is the release gate:

- The PR body records *why* main is moving and shows the exact commit range.
- It gives a second pair of eyes on what is going to production — including any
  change to `linksEnabled` (see the activation-flip rule below).
- It leaves a durable, queryable history of every production release in the
  repo, which is what `git log origin/main` failed to give us before.

`main` never gets commits `develop` doesn't have. The workflow fails closed if
that invariant is violated.

## Releasing

1. **Confirm develop is green.** Every PR merged into `develop` has already
   passed its own CI. There is no separate staging gate — the Netlify
   `develop` deploy (`https://develop--auzora.netlify.app`) is the visual
   check; use it for copy/layout review.

2. **Open the release PR.** Either:
   - GitHub Actions → *Release to Production* → **Run workflow** (add a note),
     or
   - `gh pr create --base main --head develop --title "Release: develop -> main"`

   The workflow is idempotent — if a release PR is already open it just prints
   the link instead of opening a second one.

3. **Review the diff before merging.** Pay attention to:
   - `index.html` — `PLANS.linksEnabled` and `SMS_ADDONS.linksEnabled` must
     still be `true` (2026-10-14 activation); disabled CTAs on prod fail
     verify-prod.
   - `netlify.toml` / `netlify/plugins/` — `[build.environment] STRIPE_LINK_MODE`
     must stay `"live"` (only the `develop` and `deploy-preview` contexts
     override it to `"test"`). Never remove that scoping; it is what stops a
     test payment link reaching production.
   - New/changed files under `legal/` (pretty-URL rewrites, see below).

4. **Merge.** Merging publishes. Netlify's auto-deploy picks up the new `main`
   commit; there is no separate deploy step and nothing to run on a server.

5. **Verify.** The same workflow's `verify-prod` job runs automatically on the
   push to `main` and checks, against the live site:
   - `/`, `/portal`, `/checkout`, `/payment-success` all return 200
   - the 3-plan catalog and the shared "Every plan includes" panel are present
   - purchase links ENABLED on production (`linksEnabled: true`; see activation-flip rule)
   - `window.STRIPE_LINK_MODE` was injected and reads `live` (not `test`)
   - live `index.html` matches `main` (normalized — see below)

   Watch it in Actions, or re-run any time with **Run workflow** on the
   workflow itself, which skips the release-PR step and only verifies.

## Activation-flip rule (pricing)

`PLANS.linksEnabled` and `SMS_ADDONS.linksEnabled` in `index.html` control
whether purchase CTAs are clickable or render in the disabled/"Coming Soon"
state.

- **2026-10-14 (Auzi): the activation flip SHIPPED.** All 6 PROD Stripe
  Payment Links (3 plans + 3 SMS add-ons) were activated in Stripe live mode
  via `stripeProvision.js --activate`, and both flags ship as `true`.
  Purchase CTAs are live on production.
- `verify-prod` now **fails the build** if production is ever found with the
  links disabled again (`linksEnabled` missing or mode-gated to test) — that
  is a regression to the pre-launch gate, not a normal release state.
- Rollback path: set both flags back to `false` (or the mode-gated form) in a
  dedicated PR, release it, and additionally deactivate the Stripe Payment
  Links (`stripeProvision.js` without `--activate` re-reconciles links to
  inactive in live mode). Re-enabling afterwards is this flip again.
- Test-mode scoping is unchanged: develop/PR-preview deploys still swap every
  link for its ACTIVE test-mode URL (`buy.stripe.com/test_...`), and
  production must never serve test links (verify-prod still enforces that).

## Known normalization: Netlify pretty URLs

Netlify's pretty-URL post-processing rewrites same-directory HTML links in the
pages it serves: a `href="/legal/privacy.html"` in the repo is served as
`href='/legal/privacy'`, and attribute quotes can be normalized. This is
Netlify behaviour, not drift. The `verify-prod` byte-comparison normalizes both
before diffing so it only fires on **real** content drift.

Do not "fix" the `/legal/*.html` links in the source to chase the diff — they
are correct as authored and resolve correctly in production.

## Rollback

The static site is immutable per commit, and every release is a merge commit on
`main`, so rollback is a new revert PR on `main`:

1. Identify the bad commit: `git log origin/main --oneline -20`.
2. Open `main ← revert/<sha>` PR (or `develop ← revert/<sha>` and then release,
   if the fix should stick).
3. Merge. Netlify redeploys from the reverted tree.

There is no database or migration to unwind, so a revert is always safe.

## Why not a deploy workflow that pushes to main?

An automated `develop → main` merge was rejected deliberately. Releases here are
infrequent and high-consequence (they change what real customers see and can
change what real payment links are live). A human clicking merge on a PR whose
diff they have read is worth more than the marginal convenience of automation,
and the `verify-prod` gate already gives us the machine checking that actually
mattered here — proof that what shipped is what `main` said it would be.