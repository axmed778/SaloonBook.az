# SalonBook.az

Online booking for Azerbaijan salons, barbershops, and clinics.

> **Positioning:** _"Let clients book themselves 24/7."_ — _"Stop answering booking
> requests manually in WhatsApp."_ This is a booking tool, not a CRM/SaaS platform.

## Architecture

- **Next.js (App Router) monolith** — public booking pages + owner/admin dashboard + API routes.
- **Worker service** (`worker/`) — WhatsApp sending, reminders, background jobs. Runs as a
  separate process; **booking creation never waits on it.**
- **PostgreSQL + Prisma** — shared DB, shared schema, `salonId` tenant discriminator.
- **Redis + BullMQ** — job queue, caching, slot locks.
- **Clerk** — auth (OWNER / STAFF roles; platform admins via `User.isPlatformAdmin`).
- **Cloudflare R2** — file storage. **Railway** — hosting.

Tenancy: an **`Account`** is the paying business and owns the `Subscription`. In MVP an
account has exactly one `Salon`; multiple salons (= branches) is a future Pro feature.

Time: all timestamps stored **UTC**, rendered **Asia/Baku** (UTC+4, no DST).

## Prerequisites

- Node 20+ and pnpm
- A PostgreSQL database and a Redis instance (local Docker or Railway)

## Setup

```bash
pnpm install                 # installs deps + runs `prisma generate`
cp .env.example .env         # fill in DATABASE_URL and REDIS_URL at minimum

# Create tables, then the things Prisma's schema can't express:
pnpm db:migrate              # create/apply Prisma migrations
pnpm db:constraints          # btree_gist + the no-overlap booking constraint (REQUIRED)
pnpm db:rls                  # (optional) row-level-security tenant policies
pnpm db:rls-grants           # (optional) grants + strict switch for salonbook_app
pnpm db:seed                 # demo account/salon for local testing
```

## Run

```bash
pnpm dev                     # Next.js app on http://localhost:3000
pnpm worker                  # background worker (separate terminal)
```

Health check: `GET /api/health`. Public booking page: `/{salon-slug}` (e.g. `/demostudio`).

## The booking safety net

Double-booking is prevented by a Postgres exclusion constraint
(`prisma/constraints.sql`) — two confirmed appointments for the same employee can never
overlap, even under a race or a logic bug. **Apply it on every environment** via
`pnpm db:constraints`. See `src/lib/` for the availability/queue/plan helpers.

## Security & tenant isolation (production)

Tenant isolation has two layers:

1. **Application** — every operational query is scoped by `salonId`. This is what
   actually protects almost all of the product today.
2. **Database (RLS)** — a defense-in-depth net so a missing `where: { salonId }`
   becomes "zero rows" instead of a cross-tenant leak. It covers a small,
   explicitly listed set of paths.

### What is actually enforced (read this before trusting `pg_policies`)

Policies exist on 10 tables and `FORCE ROW LEVEL SECURITY` is on. They are
**enforced only for queries routed through `withTenantScope` on the `prismaRls`
client** — today that is three call sites:

- `src/lib/booking.ts` (public + dashboard booking)
- `src/app/api/dashboard/export/clients/route.ts`
- `src/app/api/dashboard/export/appointments/route.ts`

Everything else — roughly 136 dashboard queries, every other route under
`src/app/api/**`, the whole `worker/` tree and the admin panel — uses the owner
connection on `DATABASE_URL` and has **no database-level tenant enforcement**.
"RLS is enabled" and "the database enforces tenancy" are three call sites apart.
Anyone reading the `pg_policies` output and concluding otherwise is wrong.

### Why this is safe to apply to a live database

Deny-when-unset is keyed to the **role**, not to the policy. Only a role carrying
`app.rls_strict = 'on'` (set at the role level by `prisma/security/rls-grants.sql`
— i.e. `salonbook_app` and nothing else) is denied rows when `app.current_salon`
is unset. For the owner role both policy branches are permissive, so `pnpm db:rls`
is a **no-op** for it, with or without `BYPASSRLS`. `DATABASE_URL` never moves,
so `prisma migrate deploy`, `scripts/apply-sql.ts`, the worker and the admin panel
are structurally untouched.

### Activating it

```sql
-- In SQL, NEVER via the Neon console/API/CLI: console-created Neon roles get
-- neon_superuser, which carries BYPASSRLS — you would enforce nothing while
-- every check below still looks correct.
CREATE ROLE salonbook_app LOGIN PASSWORD '<generated>'
  NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Both must be false, and the second must be false too:
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'salonbook_app';
SELECT pg_has_role('salonbook_app', 'neon_superuser', 'member');
```

Then `pnpm db:rls && pnpm db:rls-grants`, and set `RLS_DATABASE_URL` on the **web
service only** (never the worker), with `?connection_limit=5&pool_timeout=10`
appended — it is a second pool against the same database. Smoke a real public
booking first, then both CSV exports.

**Rollback is deleting `RLS_DATABASE_URL` and restarting**: `withTenantScope` then
falls back to the owner client, which is exactly today's behaviour. Removing the
policies themselves is `prisma/security/rls-disable.sql`.

With `RLS_DATABASE_URL` unset — local dev, CI, and production before activation —
`withTenantScope` is a harmless wrapper around a normal transaction.

### Proving it

`src/lib/tenant.rls.test.ts` seeds two tenants and asserts that an **unfiltered**
`findMany` inside a scope returns only one of them, against a role that genuinely
lacks `BYPASSRLS`. It is opt-in (`pnpm test:rls`, gated on two env vars) and runs
in CI against a real Postgres — see the `rls` job in `.github/workflows/ci.yml`.
It also fails if a new `salonId`-carrying table is added without a policy.

The path from here to strict, table-by-table, is documented in
`prisma/security/rls-strict.sql`. Read its header before making any table strict —
`Appointment` in particular fails **open** (an empty overlap result reads as "slot
free"), so making it strict before threading `salonId` through
`getAvailableSlots`/`isSlotBookable` would cause double bookings.

Other production must-haves (the app refuses to boot otherwise — see
`src/lib/env.ts`): a strong unique `WHATSAPP_VERIFY_TOKEN` (never the
placeholder) and configured Clerk keys. `WHATSAPP_APP_SECRET` is required to
signature-verify incoming WhatsApp webhooks.

## Deploy (Railway)

Two services from this repo:

| Service | Start command | Notes |
|---|---|---|
| `web` | `pnpm build && pnpm start` | release step runs `pnpm db:setup` |
| `worker` | `pnpm worker:start` | long-lived; processes the queue |

Plus managed Postgres (`btree_gist` enabled) and Redis.

## Plans (marketing tiers in `MARKETING_PLANS`, limits in `PLAN_LIMITS` — `src/lib/plans.ts`)

| Plan | Employees | Bookings/mo | Branches | WhatsApp reminders/mo | Price | Annual |
|---|---|---|---|---|---|---|
| Start | 2 | unlimited | 1 | 150 | 15 AZN/mo | 150 AZN |
| Salon (popular) | 8 | unlimited | 1 | 600 | 35 AZN/mo | 350 AZN |
| Pro | unlimited | unlimited | 3 | 1500 | 70 AZN/mo | 700 AZN |

Every account starts with a **14-day free trial** (no card). There is no free tier;
`Plan.FREE` is the internal zero-entitlement floor an account falls to when the trial
lapses or a payment is missed. Billing is **manual** in MVP: owner pays out-of-band, a
platform admin activates the plan. `Subscription`/`Payment` tables are ready for a
future payment provider.
