# Releasing the commit customers actually receive

On 5 September 2026, commit `41afd694f0de141ea4ecb990678d079d2b6a6868` passed CI and its Vercel deployment was `READY`, but the deployment remained `STAGED`. The default project and branch URLs served it while `www.bazaar.kg` still served a 1 September deployment. Consequently `/baam` returned 404 on the real domain. The original continuation verification covered Vercel URLs and did **not** establish the state of the customer domain.

Promoting `dpl_G66F1Bf6HTrDgxCp8GY2QcJ6gcoj` corrected that mismatch. The canonical alias was checked through Vercel and all four supplied roles were checked in real browser sessions at `https://www.bazaar.kg`. Unauthenticated `/baam` then redirected to login. Evidence is under `artifacts/bazaar-reliability/20260905/`.

## Rollback and automatic assignment

A Vercel rollback disables automatic production-domain assignment. An explicit promotion ends that rollback state and re-enables automatic assignment for subsequent production builds. After the initial G66 promotion, follow-up main builds therefore reached the custom domain automatically. When a real-model scope defect was found, the verified G66 deployment was restored with `vercel rollback` before the correction was pushed. Do not assume that a later production build remains staged just because an earlier one did.

During a rollback, keep it active until the exact replacement passes CI and feature verification, then promote that deployment. Before the required check below was configured, subsequent Git-triggered builds could publish before GitHub CI finished. Rollback remains a recovery control, while the required deployment check governs normal releases. [Vercel rollback documentation](https://vercel.com/docs/cli/rollback) and [Instant Rollback](https://vercel.com/docs/instant-rollback) describe the rollback behavior.

## Required GitHub deployment check

On 5 September 2026, the existing `bazaar` project was configured with Vercel check `chk_ae63c4fc-3066-4ff7-818b-1c29e85b02b1`. Its GitHub source requires the job named exactly `release-gate`, applies to `production`, and blocks `deployment-alias`. The timeout is 7,200 seconds. Production automatic domain assignment remains enabled, and the production branch remains `main`.

Vercel reads the GitHub check for the deployment's commit and waits before assigning production domains. An older commit's green CI does not release a new commit. Keep the `release-gate` job name unique across workflows; renaming it requires updating the Vercel check. Do not use Force Promote to work around a pending or failed check: Vercel documents that action as a bypass. [Vercel Deployment Checks](https://vercel.com/docs/deployment-checks).

The aggregate CI job uses `if: always()` and rejects any prerequisite result other than `success` before checkout, installation, or its release build. This covers failures, cancellations, and skipped prerequisites. Its existing six dependencies and build checks remain in place. Without this guard, GitHub can report a skipped aggregate job as successful for required checks. [GitHub job conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions).

The create response and an independent read confirmed this setting, with the existing live domain still serving `8d13fe40b56a83a3f6ab87760645181ae103b9d8` / `dpl_B13DEY5ioRhTzGWpBuNAbaDZ8rmq`. This configuration proof is separate from observing a new build held while its CI is pending. Evidence is under `artifacts/baam-professional/20260905/release-gate/`: `before.json`, `required-check-request.json`, `create-check-result.json`, `configured.json`, and the 42-case execution of the actual prerequisite step in `workflow-contract-test.json`.

The read-only `capture-release-state.py` in that evidence directory records the project check, both domain aliases, deployment Git metadata, deployment check runs, and GitHub check runs for an explicit SHA. It uses existing CLI authentication and writes only selected release metadata. Run it after the next build becomes ready while CI is still pending, and again after successful CI and automatic assignment:

```sh
python3 artifacts/baam-professional/20260905/release-gate/capture-release-state.py \
  --label pending --sha FULL_COMMIT_SHA --deployment DEPLOYMENT_ID
```

The pending snapshot must show that deployment's Git SHA, a pending required check, and the customer domain still pointing to the previous verified deployment. The final snapshot must show the same SHA's successful `release-gate` and the customer domain pointing to that deployment. If the build finishes after CI, that release cannot demonstrate the pending hold; record this limitation instead of claiming it was observed.

## Automatic public-domain smoke

`.github/workflows/production-smoke.yml` runs the repository's public smoke script after a successful GitHub deployment status whose environment is `Production`, daily at 03:17 UTC, or on manual dispatch. It checks out trusted `main`, uses no application credentials, and uploads sanitized JSON evidence for 14 days. Deployment-triggered runs wait up to 28 minutes for the exact deployment SHA to reach the canonical domain, within a 35-minute job limit. Scheduled/manual runs check the currently served release with a three-minute wait limit.

```sh
SMOKE_EXPECTED_SHA=FULL_COMMIT_SHA SMOKE_REQUIRE_EXPECTED_SHA=1 \
  node scripts/deployment/public-smoke.mjs
```

The script sends only anonymous GET requests to the hardcoded `bazaar.kg` and `www.bazaar.kg` hosts and never follows redirects. It checks the apex BAAM redirect, login HTML response, anonymous BAAM/analytics login redirects, public health's minimal `{status: "ok"}` response, and the uncached `/api/version` SHA before and after the probes. The default evidence file is `artifacts/production-smoke/public-smoke.json`. Event-provided URLs are not fetched.

This smoke detects public routing and release-identity failures after assignment. It does not test authenticated workflows, browser hydration, database/Redis availability, or model/email/payment providers. The required Vercel check above remains responsible for preventing assignment before CI succeeds. A post-deployment public smoke failure requires investigation and, when appropriate, rollback; the smoke itself makes no release changes.

## Required release evidence

1. Record the exact pushed `main` SHA. Check the GitHub Actions run for that SHA, including the release gate. A green older run is insufficient.
2. Find the Vercel deployment whose Git metadata matches that SHA. Require `READY`; inspect `readySubstate` and aliases. A production target can still be staged.
3. For ordinary releases, wait for the required GitHub check and Vercel's automatic assignment. If rollback remains active, promote only the exact tested deployment after its required checks pass. Never bypass pending or failed checks to resolve a staged deployment.
4. Verify `/v4/aliases/www.bazaar.kg` points to the expected deployment ID. Verify `bazaar.kg` redirects to `www.bazaar.kg`, and the canonical login/page routes have their expected statuses.
5. Run authorized browser smoke checks on **`https://www.bazaar.kg`**. Verify authenticated access, denied-role behavior, and the changed feature. A working Vercel preview URL or a successful login redirect alone does not prove the feature works.
6. Save sanitized evidence with SHA, CI run, deployment ID, aliases, actual domain, and results. State separately which provider behavior used mocks and which was exercised live.

The owner has authorized pushes, migration application, CI checks and Vercel releases. Existing guarded prebuild remains responsible for approved database migrations. No production credentials need to be downloaded. Local tests remain on disposable resources. Rollback means promoting a previously verified compatible deployment; it does not reverse already applied schema changes.

The excluded POS and Inventory scope still applies to manual smoke checks. This release procedure does not expand assessment coverage.
