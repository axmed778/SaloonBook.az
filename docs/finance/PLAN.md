# Finance module — the plan

The canonical plan for the SalonBook.az finance module: what the code does today,
the data model, the permission matrix, the phase order, and every decision that
has been answered. **Start here.** A session that needs context should be able to
read this file and nothing else.

Source: the Phase 0 exploration (main at `ea699c3`, 13 September 2026), written up
as a private page at
<https://claude.ai/code/artifact/6a80bf49-89a0-4bda-9163-c6307a5809fc>. That page
is the original; this file is the living copy and wins where the two differ.

**Keep it updated at the end of every phase** — the status table, and an entry
under "As built" for anything the code settled differently.

---

## Status

| Phase | What | State |
|---|---|---|
| 1a | Permission engine, no visible change | **Merged** — PR #41 |
| 1b | ADMIN and FINANCE roles | **Merged** — PR #42 |
| 2 | Payments on bookings | **Shipped** — PR on `feat/finance-2-payments`, not merged |
| 3 | Shift close | Not started |
| 4a | Payout schemes and calculations | Not started |
| 4b | Statements | Not started |
| 5 | Expenses | Not started |
| 6 | Reports and exports | Not started |

Checks after 2: 596 tests pass, 11 skipped · lint 0 errors (the same 4
pre-existing warnings) · typecheck clean · locales in sync at 1,397 keys each
(+45 this phase, none removed).

Earlier: 453 tests after 1b, 430 after 1a, 303 at Phase 0.

> **Run `pnpm db:rls` by hand on Railway and Neon after merging phase 2.**
> `AppointmentPayment` is a new salon table and its policy is in `rls.sql`, which
> deploy deliberately does not apply.

### Leftovers from 1b — closed by `fix/1b-leftovers`

- `session-state.test.ts` asserted that the owner and finance keep working when
  **their own** home branch is suspended. Neither can: the owner's home branch is
  the primary, which `setBranchStatus` refuses to suspend (`primaryLocked`), and a
  finance membership is created with `salonId: null`. Rewritten around the two
  reachable cases — a *non-home* branch is suspended under them, and the switcher
  cookie still names a branch that has since been suspended (it falls back to an
  active one).
- **The notification worker did not skip suspended salons.** `processNotification`
  re-checked the appointment and the recipient's consent but never the salon, so a
  suspended branch kept sending T-24h reminders — queued in Redis for up to weeks
  — telling customers to come to a salon that is shut. Fixed with a pure
  `salonMaySend()` (`src/lib/notification-gate.ts`), read per send. Cancellation
  notices stay exempt, on the rule the manage route already draws: a suspended
  salon takes no new commitments, but cancelling stays allowed.

### Open question — lapsed-plan salons keep sending

Found while fixing the above, **left alone deliberately**: nothing in the worker
or in `booking.ts` gates WhatsApp reminders on the plan. A salon that lapses to
FREE goes on sending reminders indefinitely, and the per-tier
`waRemindersPerMonth` in `MARKETING_PLANS` is not enforced anywhere. That is a
billing-behaviour decision, not a bug, so it needs an answer before anything
changes. Related, smaller: `push-sync.ts` re-checks the appointment but not the
salon either — those pushes go to the salon's own staff devices, whose logins 1b
already closes, so it is a much narrower gap.

---

## Working rules

- One phase = one branch = one PR. After each phase: typecheck, lint, tests, and
  a short report.
- **Stop and ask when the code contradicts the plan.** Do not invent business
  rules.
- Authorization is server-side in every action, route and page, and only through
  `requirePermission` / `requirePagePermission` / `requirePageAccess` /
  `accessRefusal`. No plan check outside `permissions.ts` —
  `guard-coverage.test.ts` enforces this.
- Money in integer qəpik. Percentages in basis points. Business dates as
  `"YYYY-MM-DD"` in Baku time, through the helpers in `src/lib/time.ts`.
- Migrations additive, reversible and re-runnable, each with a rollback note in
  its header.
- Every new salon table gets an RLS policy in `prisma/security/rls.sql` and joins
  the RLS test fixture in the same PR.
- Every new string in az, ru and en, with key counts in sync.

> **A step only the owner can do:** after each phase that adds tables, run
> `pnpm db:rls` by hand on **both Railway and Neon**. It is deliberately not part
> of deploy.

---

## Where the brief and the code disagreed

Seven contradictions found in Phase 0. None blocked the work; each changed
something in the plan.

| Brief assumed | The code has | What the plan does |
|---|---|---|
| Clerk handles auth | Local email + password (scrypt) and an HMAC-signed session cookie; user and membership re-read from Postgres every request (`src/lib/auth/session.ts`). No `@clerk/*` package; `User.clerkId` is an unused reserved column | Build on the existing guards (**D1**); README fixed |
| Roles are salon admin and master | `Membership.role` is `OWNER \| STAFF`. The salon "admin" is the account OWNER; masters are STAFF. "Admin" in code means the *platform* admin | Existing admins are already OWNER, so no data migration. The booking serializer's `"ADMIN"` viewer was renamed so it cannot collide with the new ADMIN role |
| Tiers Start / Salon / Pro | `Plan` is `START`, `BASIC` (sold as "Salon"), `PRO`, plus `FREE` — the floor a lapsed trial falls to. Trials run 14 days on BASIC | Gates map to START / BASIC / PRO. A salon on trial gets Salon-tier finance, not FINANCE logins |
| Payouts are new | A Pro-only payroll module exists: `Employee.baseSalaryMinor` and `commissionPct`, a `Payout` ledger, `/dashboard/payroll` | Schemes and statements replace it; statements move down to Salon (**D13**) |
| A Booking model; "payment" is a free name | The booking model is `Appointment` (`CONFIRMED · COMPLETED · CANCELLED · NO_SHOW`); **`Payment` is taken by SaaS subscription billing**. A worker marks CONFIRMED bookings COMPLETED 48 h after they end (`autoCompleted`) | A new `AppointmentPayment` table, mirroring `AppointmentAddon`. "Completed" includes auto-completed bookings |
| Day close is new | The calendar already has **Günü bağla / Закрыть день** (`ReconcileBar`): it marks past bookings completed or no-show, and has nothing to do with cash | The cash close gets its own name — **Növbəni bağla / Закрыть смену** (**D12**) |
| Reuse the daily digest | There is none. The one daily job is the subscription sweep: BullMQ at 23:30 UTC (03:30 Baku), plus a run on worker boot | Recurring expenses ride that scheduler as a second job name in phase 5. No new timers, so nothing new keeps Neon awake |

---

## Findings

### Roles and salon scoping

- Roles live only in Postgres: `Membership { userId, accountId, role, salonId?, employeeId? }`,
  one per user and account, plus `User.isPlatformAdmin`. No external metadata.
- `getSession()` derives everything per request: effective plan, role, and whether
  the login is blocked. A blocked login gets no `salonId`, so every guard fails
  closed. Roles that span the account switch branch through a cookie validated
  against their account; pinned roles stay on theirs.
- Tenant isolation: every query filters `salonId`. RLS policies exist on 16 tables
  but bind only on the three `withTenantScope` paths (booking creation and the two
  CSV exports). `prisma/security/rls.sql` is applied by hand, never on deploy, and
  a CI job fails if any table with a `salonId`, `employeeId`, `serviceId` or
  `customerId` column lacks a policy.
- Deploy runs `pnpm db:setup` as the web service's pre-deploy step: migrate
  deploy, then constraints, indexes, checks and RLS grants.

### Plan limits

- Entitlements come from `PLAN_FEATURES` and `PLAN_LIMITS` (`src/lib/plans.ts`)
  through `effectivePlan()` (`src/lib/subscription.ts`). Actions re-read the
  subscription rather than trusting the session.
- `consumeBookingQuota` was already safe: it increments first and checks after,
  under the row lock.

### Salon, staff, service, booking

- `Salon.timezone` exists (default `Asia/Baku`) but nothing reads it;
  `src/lib/time.ts` hardcodes UTC+4. Finance uses the same Baku helpers, so a
  business day matches the calendar's.
- `Employee` is a bookable master — calendar column, working hours, services.
  Logins attach through `Membership.employeeId`.
- Services carry a category, but it is the fixed discovery-map enum
  (`HAIR, NAILS, BROWS_LASHES, MAKEUP, SPA, BARBER, OTHER`) the owner picks per
  service. There are no salon-defined categories.
- `Appointment` stores `priceMinor` (service plus add-ons, snapshotted at
  booking), `status`, `autoCompleted` and `source`. One service per booking;
  add-ons are itemised in `AppointmentAddon`. No payment fields.
- `setAppointmentStatus` allows COMPLETED and NO_SHOW once the booking has
  started, CANCELLED at any time, and corrections between them.
- `AuditLog` exists (`accountId`, `actorUserId`, `action`, `target`, JSON `meta`)
  and records plan activations and branch deletes. It has **no `salonId` column**.
- Money is integer qəpik everywhere, with CHECK floors in `prisma/checks.sql` or
  inline in each new table's migration.
- "Revenue" today means booking value, summed two ways across five screens:
  completed `priceMinor` (analytics revenue card, payroll), and confirmed +
  completed (top services, client spend and LTV, clients export).

### Translations, tests, jobs

- next-intl 4.13 with `messages/az.json`, `ru.json`, `en.json` in sync, one
  namespace per screen; Azerbaijani URLs are unprefixed.
- Vitest 4, tests next to their subject and pure. The RLS test is DB-backed and
  opt-in (a CI job on Postgres 16); Playwright smoke tests are a soft gate.
  Nothing runs server actions against a database.
- BullMQ 6 queues: `notifications`, `push`, `subscriptions` (daily), `instagram`
  (monthly). In-process timers: notification sweep every 10 min, reconcile hourly.

### Fixed during Phase 1a

- `updateSlug` (`settings/actions.ts`) had **no role check**: a master's login
  could rewrite the salon's public booking link by posting the action. Now needs
  `settings.write`.
- `assertEmployeeSeatAvailable` counted active employees and then the caller
  wrote, with no lock, so two concurrent saves could put a salon one master over
  its plan. Now locks the `Salon` row first (`FOR NO KEY UPDATE`, which does not
  block booking inserts).
- `createBranch` had the same shape without even a transaction. Now counts and
  creates in one transaction under a lock on the `Account` row.

---

## (a) Data model

Everything additive. Each block lands in the phase named above it.

- Every new table carries `salonId` and joins `rls.sql` and the RLS test fixture
  in the same PR.
- Money is `Int` qəpik with CHECKs in the creating migration. Percentages are
  basis points: `3750` is 37,5 %.
- Business days are `"YYYY-MM-DD"` strings on Baku time, like the existing
  `periodYm`; instants are `timestamptz`.
- **People are stored as a user-id scalar plus a name snapshot, with no foreign
  key**: revoking a master's login deletes their `User` row, and a foreign key
  would make revoke fail.
- New enum values use `ADD VALUE IF NOT EXISTS`, as `add_start_plan` did. Each
  migration carries its rollback SQL in the header; enum values cannot be
  dropped, but unused ones are inert.

### Phase 1 · roles — shipped

```prisma
enum Role {
  OWNER
  STAFF    // the stored value for MASTER — kept as-is (D3)
  ADMIN    // reception
  FINANCE
}
```

Permissions live in code (`src/lib/auth/permissions.ts`), not in tables. A custom
role later is one row holding a permission list, resolved by the same function;
nothing is scaffolded now.

### Phase 2 · payments

```prisma
enum PaymentKind   { PAYMENT REFUND }
enum PaymentMethod { CASH CARD TERMINAL TRANSFER }

model AppointmentPayment {
  id               String        @id @default(uuid())
  salonId          String
  appointmentId    String        // FK, onDelete: Restrict
  kind             PaymentKind   @default(PAYMENT)
  method           PaymentMethod
  amountMinor      Int           // > 0 — a REFUND subtracts
  discountMinor    Int           @default(0)  // 0 on a REFUND
  tipMinor         Int           @default(0)  // 0 on a REFUND
  businessDate     String        // Baku day of paidAt — the shift key
  paidAt           DateTime      @db.Timestamptz(6)
  receivedByUserId String?
  receivedByName   String?
  note             String?
  createdByUserId  String
  voidedAt         DateTime?     @db.Timestamptz(6)  // "delete" = void
  voidedByUserId   String?
  voidReason       String?       // D3 answer: the reason belongs in the UI and
                                 // in later exports, not only the audit log
  createdAt        DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime      @updatedAt @db.Timestamptz(3)

  @@index([salonId, businessDate])
  @@index([appointmentId])
}
```

Audit uses the existing `AuditLog` unchanged: `action` is `payment.create`,
`payment.update` or `payment.void`; `target` is the payment id; `meta` holds
`{ salonId, appointmentId, before, after, closedShift }`.

**Revenue, in one function** (`src/lib/finance/revenue.ts`): net payments —
payments minus refunds, voids excluded — on bookings that are COMPLETED,
CANCELLED or NO_SHOW. A cancelled or no-show booking without a payment
contributes zero, so this is exactly "completed bookings plus kept prepayments".
CONFIRMED bookings never count. **Payment status is derived, never stored** (D6).

### Phase 3 · shift

```prisma
enum ShiftStatus { OPEN CLOSED }

model Shift {
  id                       String      @id @default(uuid())
  salonId                  String
  businessDate             String      // one shift per salon day (D10)
  status                   ShiftStatus @default(OPEN)
  openedAt                 DateTime    @default(now()) @db.Timestamptz(6)
  openedByUserId           String?
  closedAt                 DateTime?   @db.Timestamptz(6)
  closedByUserId           String?
  closedByName             String?
  expectedCashMinor        Int?        // computed from payments at close
  expectedCardMinor        Int?
  expectedTerminalMinor    Int?
  expectedTransferMinor    Int?
  countedCashMinor         Int?        // entered by whoever closes
  countedCardMinor         Int?        // optional
  countedTerminalMinor     Int?        // optional
  discrepancyCashMinor     Int?        // counted − expected
  discrepancyCardMinor     Int?
  discrepancyTerminalMinor Int?
  comment                  String?
  reopenedAt               DateTime?   @db.Timestamptz(6)
  reopenedByUserId         String?

  @@unique([salonId, businessDate])
}
```

Payments join their shift by salon and business day, so there is **no `shiftId`
column** while it is one shift per day. Closing is
`UPDATE … WHERE status = 'OPEN'`: zero rows updated means it was already closed,
and the user is told so instead of closing twice.

### Phase 4 · payouts

```prisma
enum PayoutSchemeType      { PERCENT PERCENT_MINUS_MATERIALS FIXED_PLUS_PERCENT CHAIR_RENT }
enum PayoutAdjustmentType  { ADVANCE DEDUCTION BONUS }
enum PayoutStatementStatus { CONFIRMED PAID }  // a draft is computed live, never stored
enum PayoutPeriod          { WEEK HALF_MONTH MONTH }

model PayoutScheme {
  id              String           @id @default(uuid())
  salonId         String
  employeeId      String
  type            PayoutSchemeType
  percentBp       Int?             // 0..10000
  fixedMinor      Int?             // the fixed part, or the chair rent
  categoryRatesBp Json?            // { "HAIR": 4000 } — ServiceCategory → bp
  validFrom       String           // never edited: a change is a new row
  createdByUserId String
  createdAt       DateTime         @default(now()) @db.Timestamptz(3)

  @@unique([employeeId, validFrom])
}

model PayoutAdjustment {
  id              String               @id @default(uuid())
  salonId         String
  employeeId      String
  type            PayoutAdjustmentType
  amountMinor     Int                  // > 0 — the type gives the sign
  businessDate    String               // decides which period it lands in
  note            String?
  createdByUserId String
  voidedAt        DateTime?            @db.Timestamptz(6)  // only while unconfirmed
  createdAt       DateTime             @default(now()) @db.Timestamptz(3)

  @@index([employeeId, businessDate])
}

model PayoutStatement {
  id                String                @id @default(uuid())
  salonId           String
  employeeId        String
  periodStart       String
  periodEnd         String                // inclusive
  status            PayoutStatementStatus
  revenueMinor      Int
  materialsMinor    Int
  commissionMinor   Int
  fixedMinor        Int
  rentMinor         Int
  adjustmentsMinor  Int
  totalMinor        Int                   // negative = the master owes the salon
  schemeSnapshot    Json
  confirmedAt       DateTime              @db.Timestamptz(6)
  confirmedByUserId String
  paidAt            DateTime?             @db.Timestamptz(6)
  paidMethod        PaymentMethod?
  paidByUserId      String?
  lines             PayoutStatementLine[]

  @@unique([employeeId, periodStart])
}

model PayoutStatementLine {
  id             String  @id @default(uuid())
  salonId        String
  statementId    String
  appointmentId  String? // plain id; the fields below are the snapshot
  adjustmentId   String?
  businessDate   String
  label          String  // service + add-ons, or the adjustment note
  revenueMinor   Int
  materialsMinor Int
  percentBp      Int?
}

// Added to existing models — all defaulted or nullable
Service.materialCostMinor                   Int  @default(0)
ServiceAddon.materialCostMinor              Int  @default(0)
Appointment.materialCostOverrideMinor       Int? // per-line override
AppointmentAddon.materialCostOverrideMinor  Int?
Salon.payoutPeriod                          PayoutPeriod @default(MONTH)
Salon.financeCanEditPayoutSchemes           Boolean      @default(false)
```

A draft is the live calculation, so it cannot go stale; confirming writes the row
and every number it used. **Material defaults are read when a statement is
computed**, rather than copied at booking time, so `src/lib/booking.ts` and its
slot validation stay untouched.

### Phase 5 · expenses

```prisma
enum ExpenseCategoryKey { RENT UTILITIES SUPPLIES SALARY_OTHER MARKETING OTHER }
enum ExpenseStatus      { RECORDED EXPECTED }

model ExpenseCategory {
  id         String              @id @default(uuid())
  salonId    String
  systemKey  ExpenseCategoryKey? // built-ins, created on first use
  name       String?             // null = the translated built-in label
  isArchived Boolean             @default(false)
  sortOrder  Int                 @default(0)

  @@unique([salonId, systemKey])
}

model Expense {
  id              String        @id @default(uuid())
  salonId         String
  categoryId      String
  amountMinor     Int           // > 0
  businessDate    String        // paid on — or due on, while EXPECTED
  status          ExpenseStatus @default(RECORDED)
  note            String?
  recurringRuleId String?
  periodYm        String?       // with recurringRuleId: generated once per month
  createdByUserId String
  createdByName   String?
  voidedAt        DateTime?     @db.Timestamptz(6)
  createdAt       DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime      @updatedAt @db.Timestamptz(3)

  @@unique([recurringRuleId, periodYm])
  @@index([salonId, businessDate])
}

model RecurringExpenseRule {
  id              String   @id @default(uuid())
  salonId         String
  categoryId      String
  amountMinor     Int
  dueDay          Int      // 1..31, clamped to the month's last day
  note            String?
  startsOn        String
  isActive        Boolean  @default(true)
  createdByUserId String
  createdAt       DateTime @default(now()) @db.Timestamptz(3)
}
```

Phase 6 adds no tables; reports query the ones above.

---

## (b) Permission matrix

Checks name a permission, never a role. Every server action, route handler and
page calls `requirePermission("…")`. Masters stay narrowed to their own rows by
`appointmentScope()`.

Legend: ✓ allowed · `own` own rows only · **T** owner toggle, off by default ·
— not allowed · \* not in the original brief, proposed and accepted under D2.

| Permission | OWNER | ADMIN | FINANCE | MASTER | Plan |
|---|:--:|:--:|:--:|:--:|---|
| `bookings.read` | ✓ | ✓ | ✓ | own | all |
| `bookings.write` | ✓ | ✓ | — | own | all |
| `clients.read` (incl. phone) | ✓ | ✓ | ✓ | — | all |
| `clients.write` | ✓ | ✓ | — | — | all |
| `clients.delete` | ✓ | —\* | — | — | all |
| `schedule.read` | ✓ | ✓ | ✓ | — | all |
| `schedule.write` | ✓ | ✓ | — | — | all |
| `services.write` | ✓ | — | — | — | all |
| `staff.manage` | ✓ | —\* | — | — | all |
| `roles.assign` | ✓ | — | — | — | all |
| `settings.write` | ✓ | — | — | — | all |
| `billing.manage` | ✓ | — | — | — | all |
| `analytics.view` | ✓ | —\* | ✓ | — | all |
| `exports.data` | ✓ | —\* | ✓\* | — | PRO |
| `payments.read` | ✓ | ✓ | ✓ | —\* | START |
| `payments.write` | ✓ | ✓ | —\* | —\* | START |
| `payments.edit_closed` | ✓ | — | — | — | BASIC |
| `shift.view_current` | ✓ | ✓ | ✓ | — | BASIC |
| `shift.close` | ✓ | ✓ | — | — | BASIC |
| `shift.reopen` | ✓ | — | — | — | BASIC |
| `shift.view_history` | ✓ | — | ✓ | — | BASIC |
| `payouts.view_own` | ✓ | own | own\* | own | BASIC |
| `payouts.view_all` | ✓ | — | ✓ | — | BASIC |
| `payouts.configure` | ✓ | — | **T** | — | BASIC |
| `payouts.adjust` | ✓ | — | ✓\* | — | BASIC |
| `payouts.confirm` | ✓ | — | ✓ | — | BASIC |
| `payouts.mark_paid` | ✓ | — | ✓\* | — | BASIC |
| `expenses.read` / `expenses.write` | ✓ | — | ✓ | — | D19 |
| `reports.finance` / `exports.finance` | ✓ | — | ✓ | — | D19 |
| `finance.settings` | ✓ | — | — | — | BASIC |

- **Logins:** MASTER from START (as today), ADMIN from any paid plan (D5),
  FINANCE from PRO. Only the OWNER creates them.
- **Enforcement:** role names appear only in `permissions.ts`.

### As built — where 1a/1b refined this

These are deliberate. Do not "fix" the code back to the table above.

1. **Reads are not plan-gated.** The Plan column applies to the write/action
   permission in each pair. `payments.read`, `shift.view_current`,
   `shift.view_history`, `payouts.view_own`, `payouts.view_all` and
   `expenses.read` carry no plan feature, so a salon that downgrades keeps its
   finance history readable — it just cannot add to it. `PERMISSION_PLAN_FEATURE`
   in `permissions.ts` is the exact list.
2. **`staff.manage` is ungated** too, so an account that has lapsed to FREE can
   still take access away.
3. **Two plan gates, both in `permissions.ts`**, written at the top of the file:
   `roleOnPlan(role, plan)` is the *login* gate (`ROLE_PLAN_FEATURE`);
   `accessRefusal()` / `can()` is the *permission* gate, asking the role first and
   the plan second, and returning which of the two refused so a page can send the
   owner to Billing and everyone else to the plan-required screen. No third plan
   check is allowed anywhere.
4. **A fourth block reason, `branch`.** A login pinned to a branch (reception, a
   master) is closed when that branch is not ACTIVE. Ordered after `plan` and
   before `inactive`. Owner and finance span the account and are unaffected.
5. **`exports.data` alone is not enough for the clients CSV** — it also needs
   `clients.read`.
6. **`ROLE_TRAITS`** carries reach separately from rights: `rows` (`salon` |
   `own`), `branches` (`account` | `branch`), `employeeLogin`. Ask it through
   `seesOnlyOwnRows()`, `spansAllBranches()`, `isEmployeeLogin()`.
7. **`appRoleOf()` takes a `string`, not `Role`**, so a stored value this build
   does not know fails the login closed instead of reaching a permission table
   with a hole in it.

### As built — phase 2

8. **A comped booking is a row, not a missing one.** `amountMinor >= 0` with a
   CHECK that `amountMinor + discountMinor > 0`, so a 100 % discount records as
   amount 0 / discount = price. It settles the booking and earns zero revenue.
   The tip is outside that floor: a tip alone is not a payment.
9. **Two CHECKs beyond the plan.** A REFUND carries no discount and no tip; a
   void is all-or-nothing (`voidedAt` and `voidedByUserId` are set together).
10. **The overpay rule is on the SETTLED total and excludes the tip.** 50 ₼ for a
    45 ₼ service is a 45 ₼ payment plus a 5 ₼ tip, never a 50 ₼ payment — letting
    the amount absorb it would inflate revenue and every payout built on it.
11. **Payment visibility is its own permission.** `canSeePayments()`
    (`serializers/booking.ts`) is keyed on `payments.read`, NOT folded into
    `BookingViewer`, which is keyed on `clients.read`. They coincide today; a
    role added later must not inherit one by holding the other. The discipline is
    the phone number's: a viewer without it gets a query that does not select the
    payment rows and a serialized booking with **no `payments` key at all**, so a
    master's RSC payload carries no money to read out of View Source.
12. **`CLIENT_NAMESPACES` in `app/[locale]/layout.tsx` is an allowlist**, and a
    client component asking for a namespace missing from it renders raw keys to
    the user. Nothing in the unit suite noticed, because every test mocks
    next-intl — only opening the page did. `client-namespaces.test.ts` now checks
    it statically. It found `TimeOff` missing since 1b: `/dashboard/time-off` had
    been showing "TimeOff.title" to every role.
13. **The Today totals strip is keyed on the PAYMENT day** (`businessDate`), not
    the booking day, because it answers "what is in the drawer". Revenue and
    payouts still follow the booking day (D7). Tips sit on their own line, never
    inside a method total. It is not the shift card — phase 3 replaces it.

### As built — phase 2 review fixes

14. **A void can be refused.** `refuseVoid()` blocks voiding an entry that would
    leave refunds standing against money no longer recorded — take 100, refund
    100, void the payment, and the net is −100, which no later total can mean
    anything by. The refunds come off first, and the message says so.
15. **`deleteCustomer` is aligned with the FK, which knows nothing about
    voiding.** Live payments refuse with `deletePaid`; a customer whose payments
    were ALL voided is still deletable, and those rows are swept inside the
    transaction — only the voided ones, so a live payment arriving after the
    count still hits the FK and rolls back rather than being erased. The void
    itself remains in the audit log.
16. **D8 is about identifiers too, not only labels.** `revenueMinor` is now
    `bookedValueMinor` in analytics and payroll. The payroll one feeds the
    commission calculation, so a name that said revenue and meant booked value
    was exactly the confusion D8 exists to prevent.
17. **`dayTotalsByMethod` delegates to `netReceivedMinor`/`tipsMinor`** instead
    of re-deriving that a REFUND subtracts, and applies the voided filter itself
    rather than trusting the caller's query. Phase 3's shift close reads the same
    function over the same rows; two places signing money independently is how a
    close comes to disagree with the strip above it.
18. **Constraints go on with their own `ADD CONSTRAINT` blocks.** Inside
    `CREATE TABLE IF NOT EXISTS` they would never reach a database where the
    table already exists. Verified by dropping the six CHECKs and re-running: 0
    back to 6.
19. **A surface cannot hardcode `payments: true`.** `guard-coverage.test.ts`
    checks the real call sites take the flag from `canSeePayments(session)`, so a
    new booking screen cannot hand every role the money — the serializer tests
    supply their own flag and would not notice. `client-namespaces.test.ts`
    likewise now fails on a `useTranslations(variable)` call it cannot read,
    instead of skipping it.

**Known, deliberately not fixed (backlog):** the check-then-write race on both
ceilings; RLS keying only on the row's own `salonId` with no parent-tenant check
(matches `AppointmentAddon`; app level covers it); `PAYMENT_KEYS` not covering
the `DayTotals` strip.

---

## (c) Phase order

Sizes include tests and the three language files: S < 300 lines, M 300–900,
L 900–2,000.

| # | Phase | Size | Needs |
|---|---|---|---|
| 1a | Permission engine with no visible change: `permissions.ts` and tests for every role × permission × plan; convert every guard and role check; fix `updateSlug`; lock rows in the employee-seat and branch checks | M–L | D1–D2 |
| 1b | ADMIN and FINANCE roles: new enum values, logins managed by the OWNER, plan gating per role, revoke and branch-delete paths; start the demo seed | M | D3–D5 |
| 2 | Payments, audit log, revenue rule, payment status; UI in the appointment popup and Today row | L | D6–D9 |
| 3 | Shift close (closing twice does nothing), reopen by OWNER only, editing payments in a closed shift, a shift card for ADMIN | M | D10–D12 |
| 4a | Payout schemes, material costs, adjustments, payout calculations with a test case per scheme type | L | D13–D17 |
| 4b | Statements (draft → confirmed → paid) and the master's "Mənim hesabım / Мой расчёт" screen | L | D18 |
| 5 | Expenses, recurring expenses, in-app reminder banner | M | D19 |
| 6 | Reports, P&L with a "closed shifts only" toggle, CSV and XLSX export | L | D19–D21 |

---

## (d) Decisions — all answered

**All recommendations accepted, except D11 and D21, which the owner answered
differently. The answer column is binding.**

### Before 1a

| # | Question | Answer |
|---|---|---|
| D1 | Build on the existing login system instead of Clerk? | **Yes**, and fix the README |
| D2 | Accept the \* cells in the matrix? | **Yes** |

### Before 1b

| # | Question | Answer |
|---|---|---|
| D3 | Keep `STAFF` as the stored value for MASTER, or rename it? | **Keep** — no data rewrite, and masters do not get errors during a deploy |
| D4 | Shape of ADMIN/FINANCE logins | **All of:** no calendar column; the OWNER creates them in İşçilər; optionally linked to an employee; on Pro, ADMIN is tied to one branch and FINANCE sees the whole account; they do not use up employee seats |
| D5 | Lowest plan for ADMIN logins? | **All paid plans** |

### Before 2

| # | Question | Answer |
|---|---|---|
| D6 | Payment fields | **As proposed:** `amount` = money received for the service, after the discount; `discount` = the price reduction; `tip` = extra on top, **not revenue and not part of any payout**; status is `paid` when payments + discounts − refunds ≥ price, `partial` when above zero. Status is derived, never stored |
| D7 | Does revenue belong to the period of the booking day or the payment day? | **Booking day** for revenue and payouts; **payment day** for shifts |
| D8 | Existing booked-price numbers (analytics, client LTV, export, old payroll): keep or switch to payments? | **Keep**, relabelled "booked value" |
| D9 | Does a full payment mark the booking completed? | **No** |

### Before 3

| # | Question | Answer |
|---|---|---|
| D10 | One shift per salon day, or several? | **One** |
| D11 | A payment after today's shift is closed | **Owner's answer, not the recommendation:** it goes into the **next open shift**, flagged **"late payment for {booking date}"**. Revenue and payouts still follow the booking day (D7) |
| D12 | Must "Günü bağla" be finished before closing the shift? | **Warn, do not block** |

### Before 4

| # | Question | Answer |
|---|---|---|
| D13 | The old payroll module | **All of:** convert it to `FIXED_PLUS_PERCENT` schemes; keep `Payout` and `/dashboard/payroll` as read-only history; move payouts from Pro down to Salon, including the marketing copy |
| D14 | Is fixed salary / chair rent per statement period, or monthly and prorated? | **A monthly amount, prorated by days**, including when a scheme changes mid-period |
| D15 | Do add-ons carry material cost? Can the payout base go below zero? Materials only on completed bookings? | **Yes; floor at zero; yes** |
| D16 | Chair rent | **Clients pay through the salon's till**, so the statement is revenue − rent and can go negative. The salon's **P&L counts only the rent**, not that revenue |
| D17 | Do kept prepayments count toward a master's percentage? | **No** |
| D18 | Who adds adjustments and marks statements paid? Do masters see live drafts? | **OWNER + FINANCE**; masters see **confirmed statements only** |

### Before 5–6

| # | Question | Answer |
|---|---|---|
| D19 | Lowest plan for expenses, reports and finance exports? History after a downgrade? | **Expenses on Salon; reports and exports on Pro; history stays readable** |
| D20 | Do P&L payouts count confirmed/paid statements ending in the range, with drafts only under "including open"? | **Yes** |
| D21 | XLSX writer | **Owner's answer, not the recommendation:** use **exceljs, server-side**. No hand-rolled writer |

---

## Defaults

Accepted as proposed.

- Category rates use the existing `ServiceCategory`, and the whole booking takes
  its **main service's** category.
- **Rounding:** half away from zero, done **once per statement**. 50 % of 43,21 ₼
  is 21,605 ₼, which becomes 21,61 ₼.
- **Deleting a payment marks it void**: it stays in the audit log and in exports.
- **Hard deletes:** customers and branches with payments cannot be hard-deleted.
- **Checkout:** no price edits, only discounts.
- **Periods:** a week runs Monday–Sunday; a half-month is the 1st–15th and the
  16th–end of month.
- **Recurring expenses:** due days 29–31 clamp to the month end. Expected
  expenses count in the P&L only once paid.
- **Refunds after a statement is confirmed** show up as a suggested deduction in
  the next period.
- **Start plan:** ADMIN sees today's payment totals instead of a shift card.
- **Reminders are in-app only.**
