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

## Deploy (Railway)

Two services from this repo:

| Service | Start command | Notes |
|---|---|---|
| `web` | `pnpm build && pnpm start` | release step runs `pnpm db:setup` |
| `worker` | `pnpm worker:start` | long-lived; processes the queue |

Plus managed Postgres (`btree_gist` enabled) and Redis.

## Plans (limits enforced in `src/lib/plans.ts`)

| Plan | Employees | Bookings/mo | Branches | Price |
|---|---|---|---|---|
| Free | 2 | 50 | 1 | 0 |
| Basic | 10 | unlimited | 1 | 15 AZN/mo |
| Pro | unlimited | unlimited | many | 30–40 AZN/mo |

Basic is free for 3 months (invite-gated). Billing is **manual** in MVP: owner pays
out-of-band, a platform admin activates the plan. `Subscription`/`Payment` tables are
ready for a future payment provider.
