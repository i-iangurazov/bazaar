# Releasing the commit customers actually receive

On 5 September 2026, commit `41afd694f0de141ea4ecb990678d079d2b6a6868` passed CI and its Vercel deployment was `READY`, but the deployment remained `STAGED`. The default project and branch URLs served it while `www.bazaar.kg` still served a 1 September deployment. Consequently `/baam` returned 404 on the real domain. The original continuation verification covered Vercel URLs and did **not** establish the state of the customer domain.

Promoting `dpl_G66F1Bf6HTrDgxCp8GY2QcJ6gcoj` corrected that mismatch. The canonical alias was checked through Vercel and all four supplied roles were checked in real browser sessions at `https://www.bazaar.kg`. Unauthenticated `/baam` then redirected to login. Evidence is under `artifacts/bazaar-reliability/20260905/`.

## Rollback and automatic assignment

A Vercel rollback disables automatic production-domain assignment. An explicit promotion ends that rollback state and re-enables automatic assignment for subsequent production builds. After the initial G66 promotion, follow-up main builds therefore reached the custom domain automatically. When a real-model scope defect was found, the verified G66 deployment was restored with `vercel rollback` before the correction was pushed. Do not assume that a later production build remains staged just because an earlier one did.

During a rollback, keep it active until the exact replacement passes CI and feature verification, then promote that deployment. After promotion, ordinary Git-triggered production builds can again publish before GitHub CI finishes; this procedure is a manual verification workflow, not a permanent enforced CI deployment gate. [Vercel rollback documentation](https://vercel.com/docs/cli/rollback) and [Instant Rollback](https://vercel.com/docs/instant-rollback) describe this behavior.

## Required release evidence

1. Record the exact pushed `main` SHA. Check the GitHub Actions run for that SHA, including the release gate. A green older run is insufficient.
2. Find the Vercel deployment whose Git metadata matches that SHA. Require `READY`; inspect `readySubstate` and aliases. A production target can still be staged.
3. Promote that exact tested deployment using the existing project and scope. Do not change DNS or project ownership to resolve a staged deployment.
4. Verify `/v4/aliases/www.bazaar.kg` points to the expected deployment ID. Verify `bazaar.kg` redirects to `www.bazaar.kg`, and the canonical login/page routes have their expected statuses.
5. Run authorized browser smoke checks on **`https://www.bazaar.kg`**. Verify authenticated access, denied-role behavior, and the changed feature. A working Vercel preview URL or a successful login redirect alone does not prove the feature works.
6. Save sanitized evidence with SHA, CI run, deployment ID, aliases, actual domain, and results. State separately which provider behavior used mocks and which was exercised live.

The owner has authorized pushes, migration application, CI checks and Vercel releases. Existing guarded prebuild remains responsible for approved database migrations. No production credentials need to be downloaded. Local tests remain on disposable resources. Rollback means promoting a previously verified compatible deployment; it does not reverse already applied schema changes.

The excluded POS and Inventory scope still applies to manual smoke checks. This release procedure does not expand assessment coverage.
