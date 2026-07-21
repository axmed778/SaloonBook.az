# Own WhatsApp number (PRO "send from your own number")

By default every salon's WhatsApp messages (confirmations, reminders, owner
alerts) go out from the **shared platform number** (`WHATSAPP_TOKEN` /
`WHATSAPP_PHONE_NUMBER_ID`). A **PRO** salon can be switched to send from **its
own Meta number**. This document is the operator checklist for doing that.

The architecture is already in place — flipping a salon to its own number is a
data change (fill in credentials + activate), **not** a code change. There is no
Embedded Signup yet; onboarding is done by hand once, then the admin panel does
the rest.

## How it works (code map)

- **`prisma` → `WhatsAppSender`** — one row per salon (`salonId` PK). Holds
  `phoneNumberId`, `wabaId`, the **encrypted** `accessTokenEnc`, display fields,
  and `status` (`PLATFORM_DEFAULT | PENDING | ACTIVE | DISABLED`).
- **`src/lib/crypto.ts`** — AES-256-GCM. Encrypts the access token at rest. Key:
  `WHATSAPP_ENCRYPTION_KEY` (see below).
- **`src/lib/whatsapp-sender.ts`** — `resolveWhatsAppSender(salonId)` is the one
  decision point: PRO + `ACTIVE` + credentials → salon's own number; otherwise
  the platform number. `decideSender()` is the pure, unit-tested core.
- **`worker/processors/notifications.ts`** — resolves the sender per message and
  stamps `Notification.phoneNumberId` (used for webhook routing).
- **`src/app/api/webhooks/whatsapp/route.ts`** — routes delivery-status callbacks
  by `phone_number_id → salon` (wamid still uniquely identifies the row).
- **Admin action** `setWhatsAppSender` / `disableWhatsAppSender` in
  `src/app/[locale]/dashboard/admin/actions.ts`, surfaced by the **WhatsApp**
  button per account in the admin panel.
- **Billing page** shows the owner their sender status (PRO only), never any
  secret.

## One-time platform setup

1. Set **`WHATSAPP_ENCRYPTION_KEY`** in the environment (Railway).
   `openssl rand -base64 48`. Without it, activation refuses cleanly.
   ⚠️ Rotating this key makes already-stored salon tokens undecryptable — they'd
   have to be re-entered.
2. Point Meta's webhook for the salon's WABA at the **same** endpoint
   (`/api/webhooks/whatsapp`). Routing by `phone_number_id` handles multiple
   numbers on one endpoint.

## Per-salon checklist (~1 day, mostly Meta's review)

Prerequisite: the salon is on the **PRO** plan (otherwise the number is stored
but never used — the plan gate always wins).

1. **Meta side (salon does this, or you help):**
   - The salon adds its number to a WhatsApp Business Account (WABA) in Meta
     Business Manager and completes business verification. The number must not be
     active in the consumer WhatsApp app.
   - Get: `phone_number_id`, `waba_id`, and a **System User access token** with
     `whatsapp_business_messaging` permission on that WABA.
   - Re-create the message templates (see `docs/whatsapp-templates.md`) on the
     salon's WABA — templates are per-WABA and must match exactly.
2. **Admin panel (you):** open the account → **WhatsApp** → paste
   `phone_number_id`, the access token, and (optional) `waba_id` → **Save &
   validate**.
   - We call Meta to validate the credentials. Success → status **ACTIVE**, the
     salon now sends from its own number. Failure → **PENDING** with the error;
     fix and re-save.
3. **Verify:** trigger a test booking; the confirmation should arrive from the
   salon's number. The owner's billing page shows **Connected** + the verified
   name and masked number.

To revert: **WhatsApp → Disable** (status `DISABLED`) — the salon falls back to
the shared platform number immediately.

## Quotas / billing

The marketed `waRemindersPerMonth` numbers (Start 150 / Salon 600 / Pro 1500)
are **platform** allowances — they exist because the platform pays Meta for
those conversations. There is **no per-message counter enforced today**
(`UsageCounter` tracks *bookings*, not messages).

When a salon is on its **own** number it pays Meta directly, so those sends must
be **unlimited on our side**. The hook is already wired:
`resolveWhatsAppSender()` returns `ownNumber: true` for own-number sends. If/when
a per-message WhatsApp quota is ever added, it MUST skip counting when
`ownNumber === true` — branch on that flag, do not re-derive it.

## Security notes

- The access token is **only** ever stored encrypted (`accessTokenEnc`); it is
  never logged, never written to `AuditLog`, and never sent to the client (the
  admin token field is write-only; the billing page selects only status +
  display fields).
- `WhatsAppSender` is deliberately excluded from the tenant RLS list — it is
  admin/worker-managed and accessed outside `withTenantScope`; its secret is
  protected by encryption, not RLS.

---

## Appendix: collecting the credentials from a salon

Onboarding is **admin-driven** (no self-serve in the UI). To activate a salon
you paste three values into the admin panel → **WhatsApp**:

| Admin field | What it is | Required |
| --- | --- | --- |
| `phone_number_id` | the number's **numeric ID** in Meta (NOT the phone number) | yes |
| `accessToken` | a **permanent** token with `whatsapp_business_messaging` | yes |
| `wabaId` | the salon's WhatsApp Business Account ID | optional (recommended) |

### Where each value comes from (Meta Business side)

Prerequisites the salon must finish first, or the values won't exist:
1. **Meta Business Manager** created + **Business Verification** passed (1–3 days).
2. The salon's number added to a **WABA**; the number must NOT be signed in to the
   consumer WhatsApp app.
3. Message **templates re-created** on the salon's WABA (they are per-WABA — see
   `docs/whatsapp-templates.md`), or sends fail with a component mismatch.

Getting the IDs: **Meta Business Suite → WhatsApp → API Setup** shows
`phone_number_id` and `waba_id` directly.

### ⚠️ The token — the one real gotcha

The token shown on **API Setup is temporary (24 hours)**. If a salon sends that,
sending breaks the next day. You need a **permanent System User token**:

1. **Business Settings → Users → System Users → Add** — create a System User
   (role: Admin or Employee).
2. **Assign assets** → add the salon's **WABA** with **full control**.
3. **Generate new token** → pick the Meta app → set expiry **Never** → tick the
   scopes **`whatsapp_business_messaging`** and **`whatsapp_business_management`**.
4. Copy the token (shown once) → this is the `accessToken` you paste.

> ⚠️ Rotating/regenerating this token later makes the stored one stop working —
> re-paste the new one in the admin panel (status will go back to ACTIVE on save).

### Easiest path for a non-technical salon

Rather than walking a salon owner through System Users, have them **add you as an
Admin/Partner to their Meta Business Manager**. Then you pull `phone_number_id`
yourself and generate the System User token yourself — from them you only need the
Business Manager invite.

### Ready-to-send message (forward to the salon)

**Azərbaycanca:**

> Öz WhatsApp nömrənizdən mesaj göndərmək üçün bunları göndərin:
> 1. **Phone number ID** (Meta Business Suite → WhatsApp → API Setup)
> 2. **WABA ID** (eyni səhifə)
> 3. **Daimi access token** (System User, icazə: `whatsapp_business_messaging`) —
>    API Setup-dakı 24 saatlıq token YOX.
>
> Ən asan yol: məni Meta Business Manager-inizə **Admin** kimi əlavə edin — qalanını
> özüm quraram. Qeyd: nömrəniz adi WhatsApp tətbiqinə daxil olmamalıdır və biznes
> təsdiqi (Business Verification) tamamlanmalıdır.

**По-русски:**

> Чтобы отправлять с вашего номера WhatsApp, пришлите:
> 1. **Phone number ID** (Meta Business Suite → WhatsApp → API Setup)
> 2. **WABA ID** (там же)
> 3. **Постоянный access token** (System User, право `whatsapp_business_messaging`) —
>    НЕ 24-часовой из API Setup.
>
> Проще всего — добавьте меня **администратором** в ваш Meta Business Manager, и я
> всё настрою сам. Важно: номер не должен быть залогинен в обычном WhatsApp, и
> должна быть пройдена Business Verification.
