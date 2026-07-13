# WhatsApp message templates (Meta Business Manager)

These are the exact templates to create in **Meta Business Manager → WhatsApp
Manager → Message templates** once Business Verification is approved. The
worker (`worker/processors/notifications.ts`) fills the `{{n}}` variables and
the URL-button suffixes in this exact order — **create the templates exactly as
written here (including the buttons), or every send will fail with a component
mismatch.**

Shared settings for all six templates:

- **Category:** Utility
- **Language:** Azerbaijani (`az`)
- Template **names** must match exactly (they are referenced by name in code).

The URL buttons use the production domain. If `APP_URL` ever changes, the
buttons must be updated (which means re-submitting the templates for review).

---

## 1. `booking_confirmation` — to the customer, right after booking

**Body**

```
Salam! {{1}} salonunda {{2}} xidməti üçün qeydiyyatınız təsdiqləndi. 📅 {{3}}. Sizi gözləyirik!
```

| Var | Meaning | Sample value |
| --- | --- | --- |
| {{1}} | salon name | Gözəllik Salonu |
| {{2}} | service name | Saç kəsimi |
| {{3}} | date & time (Baku) | 15 iyul 2026, 14:00 |

**Button** — type *Call to action → Visit website → Dynamic*

- Button text: `Dəyiş / Ləğv et`
- URL: `https://saloonbook.az/a/{{1}}`
- Sample suffix: `1f2a3b4c-5d6e-7f80-91a2-b3c4d5e6f708`

The suffix is the appointment's `manageToken`; the page lets the customer view,
cancel or reschedule without an account.

---

## 2. `appointment_reminder` — to the customer, ~24h before the visit

**Body**

```
Xatırlatma: {{1}} salonunda {{2}} xidməti üçün görüşünüz yaxınlaşır. 📅 {{3}}. Gələ bilməyəcəksinizsə, aşağıdakı düymə ilə vaxtı dəyişə və ya ləğv edə bilərsiniz.
```

Variables: same as `booking_confirmation` ({{1}} salon, {{2}} service, {{3}} when).

**Button** — same dynamic URL button as `booking_confirmation`:

- Button text: `Dəyiş / Ləğv et`
- URL: `https://saloonbook.az/a/{{1}}`

---

## 3. `appointment_cancelled` — to the customer, when the **salon** cancels

**Body**

```
Təəssüf ki, {{1}} salonunda {{2}} xidməti üçün {{3}} tarixli görüşünüz ləğv edildi. Yeni vaxt seçmək üçün aşağıdakı düymədən istifadə edə bilərsiniz.
```

Variables: {{1}} salon, {{2}} service, {{3}} when.

**Button** — type *Call to action → Visit website → Dynamic*

- Button text: `Yenidən yazıl`
- URL: `https://saloonbook.az/{{1}}`
- Sample suffix: `gozellik-salonu`

The suffix is the salon's public slug — the button reopens the salon's booking
page so the customer can rebook.

---

## 4. `new_booking_alert` — to the salon owner, on every new booking

**Body**

```
Yeni qeydiyyat: {{1}} — {{2}}, {{3}}.
```

| Var | Meaning | Sample value |
| --- | --- | --- |
| {{1}} | customer name | Aysel Məmmədova |
| {{2}} | service name | Manikür |
| {{3}} | date & time (Baku) | 15 iyul 2026, 14:00 |

No buttons.

---

## 5. `booking_cancelled_alert` — to the salon owner, when the **customer** cancels

**Body**

```
Ləğv edildi: {{1}} — {{2}}, {{3}} tarixli görüşünü ləğv etdi.
```

Variables: {{1}} customer, {{2}} service, {{3}} when (same order as
`new_booking_alert`).

No buttons.

---

## 6. `appointment_rescheduled_alert` — to the salon owner, when the **customer** reschedules

**Body**

```
Vaxt dəyişdi: {{1}} — {{2}} görüşünü yeni vaxta keçirdi: {{3}}.
```

| Var | Meaning | Sample value |
| --- | --- | --- |
| {{1}} | customer name | Aysel Məmmədova |
| {{2}} | service name | Manikür |
| {{3}} | new date & time (Baku) | 16 iyul 2026, 11:00 |

Variables: same order as `new_booking_alert` ({{1}} customer, {{2}} service,
{{3}} the NEW time). No buttons.

---

## Notes

- **Sandbox:** without `WHATSAPP_TOKEN` set, the worker logs sends instead of
  calling Meta, so all of this is testable locally before approval.
- **Rejected variables:** template params must not contain newlines, tabs or
  4+ consecutive spaces — `sanitizeTemplateParam` in `src/lib/whatsapp.ts`
  enforces this at the boundary for client-supplied strings.
- **Order matters:** the `{{n}}` order above mirrors `buildComponents` in
  `worker/processors/notifications.ts`. Change one → change both.
- After approval, set `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` in the
  worker environment and sends go live — no code change needed.
