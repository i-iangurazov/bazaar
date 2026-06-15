# Infrastructure Debt

## Vercel Environment Pull Does Not Produce a Direct Production `DATABASE_URL`

Status: open

Observed during the POS state machine release on 2026-06-14.

### Context

Release:

- Commit: `9573325059b87bfa3c92d0a2458ddab03c1efb79`
- Deployment: `dpl_5kxgARuUqjd6dGnvrUFVjjSEmuCp`
- Migration: `20260614143000_pos_active_draft_held_scope`
- Production URL: `https://www.bazaar.kg`

During production migration preparation, `vercel env pull` did not provide a directly usable URL-style Prisma `DATABASE_URL` locally. Production runtime and build checks still had the expected database configuration, and production health after deploy reported:

- `ok`
- `db up`
- `migrations ok`
- `redis up`

The migration was applied only after verifying production Postgres connectivity and constructing the Prisma `DATABASE_URL` from verified PG environment pieces.

### Risk

This creates operational friction during urgent migrations:

- local migration commands may fail before connecting to production
- operators may need to reconstruct `DATABASE_URL` manually from PG pieces
- incident response can slow down if the expected env pull workflow is unreliable

### Required Follow-Up

- Audit Vercel production env vars for `DATABASE_URL` and related PG variables.
- Confirm whether `DATABASE_URL` is configured as a direct Vercel env var, integration-provided env var, or derived runtime variable.
- Make `vercel env pull --environment=production` produce a directly usable local migration environment.
- Document the canonical production migration command once the env behavior is fixed.

### Guardrails

- Continue using `prisma migrate deploy` for production migrations.
- Do not use `db push` in production.
- Do not run seed scripts in production.
- Do not run cleanup scripts in production.
- Do not run destructive database commands to investigate this issue.

