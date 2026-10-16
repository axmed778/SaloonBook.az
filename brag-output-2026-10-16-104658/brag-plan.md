# Brag Plan: SalonBook.az

> Run 2 (2026-10-16). The first brag (`brag-output/`, 2026-09-28) was a vertical, chaotic
> comparative ad against all-in-one POS suites. This run is deliberately a different film:
> landscape, calm, and built around the **dashboard calendar** — material that did not exist
> on screen in run 1 and is the strongest new thing in the repo.

## What is this app?
Online booking for Azerbaijani salons, barbershops and clinics: the salon puts one link in its
Instagram bio, clients pick a service, a master and a free slot themselves 24/7, an automatic
WhatsApp confirmation goes out, and the owner wakes up to a week view that is already filled —
no calls, no manual back-and-forth, no commission per booking.

## The angle
**The night shift.** The entire video is one unattended night in the life of a salon.

It opens at 23:41 with the salon closed and nobody there to answer anything — and a booking
arrives anyway. We follow that single booking all the way through: the client picks it herself on
her phone, the confirmation sends itself, and then the clock jumps to 09:00 and the owner's
**Təqvim** week view fills in front of us. The product is never described; it is simply caught
working while the business sleeps.

This is specific to SalonBook because it is the product's own headline sentence —
`"Müştərilər özləri qeydiyyatdan keçsin — 24/7."` — filmed literally. The payoff line is lifted
from the product's own feature subtitle (`masanı dolduran` — "fills the chair"), not invented.

Where run 1 shouted at a competitor, run 2 shows the thing. No opponent, no jargon, no claims the
screen doesn't demonstrate.

## Hook (first 2-3 seconds)
A mono clock reading **23:41** on near-black, with a dim grey **"Bağlıdır"** pill under it —
the salon's own closed-state badge. The clock ticks to **23:42**, and on that tick a violet
booking notification row slides in from the right edge: **"Yeni görüş · Saç kəsimi · 14:30"**.

The hook is the contradiction, not a claim: the salon is shut, and it just took a booking.
Any owner reads that in under two seconds.

## Key moments (the middle)
- **The client books it herself** — the real public booking widget, rebuilt from
  `src/app/[locale]/[slug]/booking-widget.tsx`, driven by a simulated finger through the product's
  actual step list: `Kim üçün?` → `Xidmət seçin` → `Mütəxəssis seçin` → `Vaxt seçin` →
  `Qeydiyyatı təsdiqlə`. Each finished row collapses to a summary with the violet **"Dəyiş"** link,
  exactly as the component renders it. The gender step (`Kim üçün?`) is new since run 1.
- **It confirms itself** — the success state, then the project's own approved
  `booking_confirmation` template body arriving as a WhatsApp-style bubble with the real
  **"Dəyiş / Ləğv et"** button chip. The clock in the corner still reads 23:42: nobody did this.
- **Morning: the week fills** — the clock flips to **09:00** and the dashboard **Təqvim** week view
  is recreated from `week-grid.tsx` (56px/hour rows, 14px time gutter, 7 day columns). Booking
  blocks land one by one in a fast stagger while a violet counter counts up. The 14:30 block from
  the night lands last and carries the real source tag **"Onlayn qeydiyyat"**.

## Outro / punchline
Two lines on black: **"Siz yatırsınız."** / **"Masa dolur."** — the second in violet. Then the end
card: the real feature title `24/7 ONLAYN QEYDİYYAT` as an eyebrow, the product's own two trial
chips, and the CTA **salonbook.az/demostudio** as the largest thing on screen.

## User flow worth showing
Entry → key action → result, exactly as a real client and a real owner experience it:
1. **Entry** — the salon's public page from the bio link (`/[slug]`): "Demo Beauty Studio",
   green **"Açıqdır"** pill, violet-dotted eyebrow **"ONLAYN QEYDİYYAT"**.
2. **Key action** — the client picks `Qadın` → `Saç kəsimi · 20 ₼ · 45 dəq` → `Ayan` → `14:30`
   from the live slot grid, then `Qeydiyyatı təsdiqlə`.
3. **Result (client)** — `"Qeydiyyat təsdiqləndi!"` plus the automatic WhatsApp confirmation.
4. **Result (owner)** — the next morning's **Təqvim / Həftə** view, already full.

Scenes 2-4 are 13.1s of the video's 21.3s. The owner-side result (step 4) is the half run 1 never
showed and is the reason this film exists.

## Tone
- Preset: `default` (playful, clean, postable — 5 scenes, comfortable pacing)
- Creative direction: a quiet night-shift film — the salon sleeps, the booking doesn't.
- Interpretation: calm and confident, the opposite of run 1. Energy comes from the *story* (night →
  morning) rather than from cuts, so transitions are clean rather than hard, holds are long enough
  to actually read, and the only two "loud" moments are the 09:00 reveal and the final payoff.
  Motion is physical and settled: slide-in, then stop. Nothing is yanked off screen.

## Format: landscape — 1920x1080 (16:9, 30fps)
## Duration: 21.3s

## Visual identity (from the project)
Run 1 invented an ad palette (ink + off-white). Run 2 stays **inside the product's own dark theme**
for the whole film, so every frame is the real thing. All values verbatim from
`src/app/globals.css` `:root`:
- Background: `#09090b`  ·  Card: `#18181b`  ·  Muted: `#0e0e11`
- Border: `#27272a`  ·  Border-strong: `#3f3f46`
- Text: `#fafafa`  ·  Muted text: `#a1a1aa`  ·  Faint text: `#71717a`
- Accent: `#8b5cf6` (violet-500)  ·  Accent hover: `#a78bfa`  ·  Success: `#34d399` (emerald-400)
- Grid line: `rgba(255,255,255,0.05)`  ·  Glow: `#8b5cf6`
- Frame shadow: `0 24px 50px -12px rgba(0,0,0,0.7)`
- Display/body font: the product ships **Geist Sans** (`geist/font/sans`), but the on-screen
  language is Azerbaijani, so the face MUST render `ə ş ğ ı ö ü ç`. Use **Inter** (covers them)
  with fallback `"Segoe UI", Arial`. Verify the glyphs in the check frames.
- Clock font: a mono stack standing in for the product's **Geist Mono**.
- Strongest visual element: the **Təqvim week grid** — 56px per hour, 14px time gutter, 48px day
  headers, `min-w-[120px]` columns, booking blocks as `rounded-md` cards with an 11px semibold
  service name over a 10px customer name at 80% opacity.

## Share copy (draft)
Salonunuz saat 23:41-də bağlıdır — qeydiyyat isə işləyir. SalonBook.az: müştəri özü yer ayırır,
WhatsApp təsdiqi avtomatik gedir, səhər təqvim artıq doludur. 14 gün pulsuz, kart tələb olunmur.

## Audio direction
- Role: a quiet night bed that opens into morning. The arc carries the story — sparse and low under
  the night half, then genuinely brighter and fuller from the 09:00 cut onward.
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` — 109.96 BPM. Chosen because its
  strong cues cluster in the **back half** of the planning window (17.47s, 18.56s, 22.37s, 22.93s),
  which is exactly where this film needs its lift. The other four bundled tracks either peak early
  or stay flat.
- Music treatment: in at t=0 with a 0.6s fade, held ~5 dB under the night scenes so the room feels
  empty, opened to full on the 09:00 cut. Hard-out on the last frame with a 0.3s fade.
- Music cue guidance: preset read from
  `assets/music/cues/happy-beats-business-moves-vol-12-...music-cues.md`. Tempo 109.96 BPM →
  beat grid every ~0.546s. Music is offset `data-media-start="1.09"` so video t=0 lands on a beat.
  **Three strong-cue locks:** the 09:00 morning reveal at video **12.02** (music 13.11),
  `"Siz yatırsınız."` at **16.38** (music 17.47), `"Masa dolur."` at **17.47** (music 18.56).
  The final cut at **21.28** also lands on a strong cue (music 22.37).
  Sequential reveals: the booking-flow taps land every **2 beats ≈ 1.09s**; the calendar blocks are
  a fast decorative stagger (~0.1s apart), NOT beat-locked; the two payoff lines land **2 beats**
  apart and then hold together.
- Audio-reactive treatment: **none.** Run 1 drove a violet bloom per frame from the track's bass
  band; the unsmoothed band values read as flicker on playback and were removed on request. Use a
  static glow only. (This deliberately skips /brag's optional audio-reactive checklist item.)
- SFX posture: moderate and strictly motion-matched. Night half is near-empty — one soft
  notification, then precise UI clicks. Morning half gets one bright swell and light block pops.
- Audio-coupled moments: the clock tick to 23:42; the notification row sliding in; one soft click
  per simulated tap; a light chip rush across the slot grid; a button press on confirm; a quiet
  success tone on the check; one neutral pop for the WhatsApp bubble; a bright swell on the 09:00
  cut; a light pop per calendar block landing; two soft impacts on the payoff lines; one clean
  accent on the CTA.
- Restraint rule: no comedy sounds, no riser into every cut, never the WhatsApp trademark sound,
  nothing at all under the message body text, and no sound on a cut that has no physical motion
  behind it.

## Storyboard

### Scene 1 — 23:41, closed — 3.30s
Background `#09090b` with the product's own grid lines at `rgba(255,255,255,0.05)`. Centred, a
large mono clock **23:41** in `#fafafa` with a soft violet glow behind it; beneath it a small pill
with a grey dot and faint-foreground text **"Bağlıdır"** (the product's real closed badge). Both
settle by ~0.6s and hold.
At ~1.9s the clock ticks to **23:42** with a 1-frame flicker, and on that tick a card
(`#18181b`, border `#27272a`) slides in from the right edge: a violet dot, **"Yeni görüş"** in
11px uppercase tracking, then **"Saç kəsimi · 14:30"**. It settles by 2.3s and holds ~1.0s.
Sequential/interaction: yes — clock settles, ticks once, then one notification row arrives. Each
element holds ≥0.8s settled; the clock holds ~1.9s before anything else moves.
Audio intent: an empty room at night. The notification should feel like the only sound in it.
Audio-coupled idea: a dry low tick on the minute change; one soft neutral notification on the row.
Music: low, ~5 dB under, sparse.
Transition mood: clean → Scene 2

### Scene 2 — She books it herself — 5.44s  ← CENTERPIECE
Clean cut. The clock shrinks to a small mono badge in the top-right corner (**23:42**, faint) and
stays there for the rest of the night half. Centre-left, a phone frame (ink bezel, soft
`shadow-frame`) holds the **real booking widget**; centre-right, dim and secondary, the salon
header: "DB" avatar tile, **Demo Beauty Studio**, green **"Açıqdır"** pill, and the violet-dotted
eyebrow **"ONLAYN QEYDİYYAT"**.
A simulated finger (soft circle with a violet ring) drives the product's real step list, one tap
every ~1.09s:
1. `Kim üçün?` → taps **Qadın** → row collapses to "Qadın" with the violet **"Dəyiş"** link
2. `Xidmət seçin` → taps **Saç kəsimi** → collapses to **"Saç kəsimi · 20 ₼"** (sub-line "45 dəq")
3. `Mütəxəssis seçin` → taps **Ayan** → collapses to "Ayan"
4. `Vaxt seçin` opens the 4-column slot grid (13:00 … 18:00) with a 0.06s stagger, finger taps
   **14:30** → that chip fills violet `#8b5cf6`
5. taps the violet **"Qeydiyyatı təsdiqlə"** button → it compresses 2%
Every label is real product copy. Each active-step heading holds ≥0.8s before its row collapses,
and the collapsed summaries stay on screen, so the stack is readable as a growing receipt rather
than five separate reads.
Sequential/interaction: yes — five simulated taps plus one fast staggered grid reveal.
Audio intent: precise, quiet, competent. The product should sound *easy*.
Audio-coupled idea: one soft UI click per tap; a light chip rush across the slot grid; a button
press on confirm.
Music: still held under; SFX sit on top without adding density.
Transition mood: clean → Scene 3

### Scene 3 — It confirms itself — 3.28s
Same phone, same position; the corner clock still reads **23:42**. The screen swaps to the
product's real success state: an emerald `#34d399` check in a soft circle, **"Qeydiyyat
təsdiqləndi!"**, and under it "Saç kəsimi · Ayan · 16 oktyabr, 14:30". Holds ~0.9s.
Then a WhatsApp-style bubble rises over the lower third carrying the project's own approved
`booking_confirmation` body: *"Salam! Demo Beauty Studio salonunda Saç kəsimi xidməti üçün
qeydiyyatınız təsdiqləndi. 📅 16 oktyabr, 14:30. Sizi gözləyirik!"* with the real button chip
**"Dəyiş / Ləğv et"**. A violet label stamps into the top-left of the phone: **"Avtomatik."**
**Reading rule:** the only required reads are **"Qeydiyyat təsdiqləndi!"** and **"Avtomatik."**
The message body is texture — set it small and authentic, highlight only the phrase
"qeydiyyatınız təsdiqləndi", and do not pace the scene around reading it.
Sequential/interaction: yes — success state, then the message arrives by itself.
Audio intent: a quiet win, then one notification. Nothing else.
Audio-coupled idea: soft success tone on the check; one neutral pop on the bubble.
Music: still under, beginning to open.
Transition mood: clean → Scene 4 (the one cut in the film that should feel like a sunrise)

### Scene 4 — 09:00, the week is already full — 4.36s  ← THE PAYOFF, NEW MATERIAL
On a strong cue, the frame lifts: the background stays `#09090b` but a wide violet bloom rises from
the bottom edge and the corner clock flips **23:42 → 09:00** with a quick roll. A small faint label
reads **"Səhər"**.
The dashboard **Təqvim** week view fills the frame, recreated from `week-grid.tsx`: a 14px time
gutter with hour labels 09:00-18:00, a 48px day-header row (`B.e 13` … `B 19`, today's column
accented), 7 columns at `min-w-[120px]`, hour rules at 56px spacing, all on `#18181b` inside a
`rounded-xl` `#27272a` border. The view toggle shows **Gün / Həftə** with **Həftə** active, and
**"Bu həftə"** beside it.
Then 8 booking blocks land in a fast ~0.1s stagger — `rounded-md` cards, 11px semibold service name
over a 10px customer name at 80% opacity, violet-tinted. A violet counter in the header counts
**0 → 8** as they land. The **14:30 Tuesday** block lands last, pulses once, and carries the real
source tag **"Onlayn qeydiyyat"**.
Sequential/interaction: yes — clock roll, then 8 blocks in a decorative stagger (texture, NOT
required reading), then one highlighted block. The required reads are **"Həftə"**, the counter's
final value, and the **"Onlayn qeydiyyat"** tag, which holds ≥0.8s settled at the end.
Audio intent: morning. The one genuinely uplifting moment in the film.
Audio-coupled idea: a bright swell on the cut; a light pop per block; one soft accent on the
highlighted block.
Music: full level, opened up.
Transition mood: clean → Scene 5

### Scene 5 — Payoff and end card — 4.90s
The calendar recedes and darkens to ~8% behind a `#09090b` wash. Two display lines arrive two beats
apart, each settling with a small physical stop:
**"Siz yatırsınız."** (`#fafafa`) at 16.38, then **"Masa dolur."** (violet `#8b5cf6`) at 17.47.
Both hold together to ~18.5s.
Then the end card assembles on the same background: the real feature title **"24/7 ONLAYN
QEYDİYYAT"** as a small uppercase violet-dotted eyebrow, a violet rule wiping out from the centre
in 0.2s, two chips snapping in ~0.25s apart — **"14 günlük pulsuz sınaq"** · **"Kart tələb
olunmur"** (the product's own hero checks) — and finally the CTA, the largest element on the card:
**salonbook.az** in `#fafafa` with **/demostudio** in violet. The CTA arrives at 19.66 and holds
1.6s fully settled as the last thing on screen. Nothing moves under it — this is the frame people
screenshot.
Sequential/interaction: yes — two payoff lines, then eyebrow → rule → chips → URL.
Audio intent: two soft confident impacts, one clean accent on the URL, then a short musical stop.
Audio-coupled idea: a soft impact per payoff line; one accent on the CTA arrival.
Music: full, then hard out with a 0.3s fade on the last frame.
Transition mood: end.

**Scene timing summary (snapped to the 109.96 BPM grid at music offset 1.09):**

| # | Scene | In → Out | Length |
|---|-------|----------|--------|
| 1 | 23:41, closed | 0.00 → 3.30 | 3.30s |
| 2 | She books it herself | 3.30 → 8.74 | 5.44s |
| 3 | It confirms itself | 8.74 → 12.02 | 3.28s |
| 4 | 09:00, the week is already full | 12.02 → 16.38 | 4.36s |
| 5 | Payoff and end card | 16.38 → 21.28 | 4.90s |

Total **21.28s**.

**Music mood for this video:** upbeat-but-restrained (109.96 BPM), deliberately held under for the
first 12s so the 09:00 cut can actually lift.
**Audio summary:** an empty room at night takes one quiet notification, five precise taps and a
single confirm tone — then the morning cut opens the track to full, light pops land eight bookings
on the calendar, and two soft impacts and one accent close it out on a hard musical stop.

## Accuracy and safety notes
- Every on-screen string is the product's own copy, pulled from `messages/az.json`
  (`Landing.heroTitle`, `Landing.features.items.booking.title`, `Landing.heroChecks`,
  `Booking.steps.*`, `Booking.change`, `Booking.submit`, `SalonPage.open`, `SalonPage.closed`,
  `Calendar.viewWeek`, `Calendar.thisWeek`, `Calendar.source.PUBLIC`, `Calendar.newBooking`) or
  from `docs/whatsapp-templates.md` (`booking_confirmation` body and its `Dəyiş / Ləğv et` button).
  Nothing is invented marketing language.
- All salon/service/master data on screen is the product's **public demo** content, taken from
  `prisma/seed.ts`: salon "Demo Beauty Studio" (`/demostudio`), masters **Ayan** and **Leyla**,
  services **Saç kəsimi** (45 dəq, 20 ₼) and **Manikür** (60 dəq, 25 ₼). No real customer names,
  no phone numbers, no PII. The only invented datum in the whole film is the pre-filled client
  name "Ayşən" in the contact step, with the phone masked as `+994 50 ••• •• ••`.
- No competitor is named or implied anywhere.
- The CTA `salonbook.az/demostudio` was verified live (HTTP 200) on 2026-10-16 before it went on
  the end card.
- Claims used: "14 günlük pulsuz sınaq" and "Kart tələb olunmur" are the product's own published
  trial terms; "24/7 ONLAYN QEYDİYYAT" is its own feature title; "Siz yatırsınız. / Masa dolur."
  describes exactly what the preceding 16 seconds demonstrate on screen.
- The `salonbook-logo.png` lockup is **not** used: it is a light-background rose/black serif mark
  that renders as a white rectangle on the product's dark palette (established in run 1). The CTA
  set in the film's own face carries the wordmark instead.

---

## As shipped (final cut)

Delivered as `brag.mp4` — 1920x1080, 30fps, **21.3s**, 639 frames, H.264 + AAC stereo, 1.6 MB.

| # | Clip | In → Out | Length |
|---|------|----------|--------|
| 1 | 23:41, closed | 0.00 → 3.30 | 3.30s |
| — | *shell* (phone + salon identity, spans scenes 2-3) | 3.30 → 12.02 | 8.72s |
| 2 | She books it herself | 3.30 → 9.28 | 5.98s |
| 3 | It confirms itself | 9.28 → 12.02 | 2.74s |
| 4 | 09:00, the week is already full | 12.02 → 16.38 | 4.36s |
| 5a | Payoff | 16.38 → 18.57 | 2.19s |
| 5b | End card | 18.57 → 21.28 | 2.71s |

Every boundary sits on the 109.96 BPM beat grid at music offset `data-media-start="1.09"`.
**Strong-cue locks (3):** the 09:00 sunrise cut at 12.02 (music 13.11), `"Siz yatırsınız."` at
16.38 (music 17.47), `"Masa dolur."` at 17.47 (music 18.56). The final cut at 21.28 also lands on
a strong cue (music 22.37) but is marked beat-grid, not a lock.

**Deviations from the plan, and why:**

- **Scene 2 grew 5.44s → 5.98s and scene 3 shrank 3.28s → 2.74s.** Five simulated taps would not
  fit in 5.44s without dropping below ~0.95s per step, which outruns the 0.8s reading floor on the
  step titles. The time was taken from scene 3, which only has three events and still clears every
  floor (`Avtomatik.` holds 1.09s). Both new boundaries are still on the beat grid.
- **The outro is two clips, not one.** The payoff lines and the end card would otherwise
  cross-fade through each other in the same clip; splitting at 18.57 keeps the layout audit clean
  and makes the cut deliberate.
- **The contact step was kept as the fifth tap.** The storyboard went time → confirm, but the real
  widget requires `Adınız` + `Telefon` before `Qeydiyyatı təsdiqlə`. Skipping it would have
  misrepresented the flow, so the card appears pre-filled and the fifth tap lands on the button.
- **Scenes 2 and 3 share a background clip.** The phone shell, corner clock and salon identity live
  in one `#shell` clip spanning 3.30 → 12.02, so there is no cut at 9.28 at all — only the screen
  content swaps. That is the calmest possible version of that transition.
- **Calendar blocks carry the master's name, not the customer's.** `week-grid.tsx` renders
  `{HH:MM} {service}` over `{employeeName}`, so the film does too. A happy side effect: no invented
  customer names appear anywhere in the calendar.
- **Selected options use the widget's own `optionCls(true)`** — `border-accent bg-accent/10` — not a
  solid violet fill. More faithful, and a solid fill would have put 20px `#fafafa` on `#8b5cf6`
  at 4.10:1, under the 4.5:1 AA floor for normal-size text.
- **The booking counter is one element** whose `textContent` is set on the timeline (seek-safe),
  rather than nine stacked spans that would have overlapped in the layout audit.
- **The mono stack is `ui-monospace, Consolas, monospace`.** "Cascadia Mono" and "Segoe UI Mono"
  are not in the renderer's auto-resolved font list and raised a `font_family_without_font_face`
  **error**. The compiler resolved `ui-monospace` to JetBrains Mono deterministically.
- **No audio-reactive element**, as planned — see the audio direction above. This knowingly leaves
  /brag's optional audio-reactive checklist item unmet; it is a deliberate trade against the
  flicker run 1 shipped and then had to remove.

**Gate result:** `npx hyperframes check` — **0 errors**, 0 runtime errors, **0 layout issues across
9 samples**, **84/84 text checks pass WCAG AA**, 0 motion findings. 8 warnings remain, all
structural style advice (`nested_structure_needs_subcomposition` ×7 + `composition_file_too_large`):
Hyperframes prefers one sub-composition file per scene for Studio ergonomics and diffing. This is a
single 497-line `index.html` instead. Splitting it would also mean one registered timeline per
sub-composition, since a sub-comp timeline cannot animate host-root elements — a real restructure
for a readability benefit, not a render-correctness one. Same call run 1 made.

**Poster:** pulled at **15.2s** — the week view fully settled, counter at `8 görüş`, the night's
booking highlighted and tagged `Onlayn qeydiyyat`. It is the most "show the thing" frame in the
film and reads as a genuine product screenshot on its own. Baked as frame 0 of `brag.mp4` so every
platform's thumbnail grabber lands on it; `brag.jpg` is kept alongside for platforms that accept a
custom thumbnail upload.

**Audio note:** the mixer lowered the master by 0.8 dB to stay under −1 dBTP. Nothing clipped.
