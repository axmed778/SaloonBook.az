# Hyperframes Composition Brief: SalonBook.az

## Objective
Create a short launch-style brag video for SalonBook.az — "the night shift": one unattended night
in which the salon is closed, a booking arrives and completes itself, and the owner's calendar is
already full by morning.

## Output
- Composition directory: `brag-output-2026-10-16-104658/composition/`
- Rendered video: `brag-output-2026-10-16-104658/brag.mp4`
- Format: landscape — 1920x1080, 30fps
- Duration: 21.28s

## Source Material
- Project root: `C:\Users\User\Desktop\SaloonBook.az` (read in the `brag-video` worktree)
- Primary files read:
  - `README.md` — positioning ("a booking tool, not a CRM/SaaS platform")
  - `src/app/globals.css` — the full `:root` dark-theme token set
  - `src/app/[locale]/layout.tsx` — Geist Sans / Geist Mono
  - `messages/az.json` — every on-screen string
  - `src/app/[locale]/[slug]/booking-widget.tsx` — the public booking flow and its step list
  - `src/app/[locale]/dashboard/_components/week-grid.tsx` — the week calendar geometry
  - `src/app/[locale]/dashboard/_components/calendar-shared.ts` — calendar window + block shape
  - `src/app/[locale]/dashboard/calendar/page.tsx` — how day/weekday labels are formatted
  - `docs/whatsapp-templates.md` — the approved `booking_confirmation` body and button
- Product name: **SalonBook.az**
- Tagline / strongest claim: `Müştərilər özləri qeydiyyatdan keçsin — 24/7.` (`Landing.heroTitle`)
- Key UI to recreate, in priority order:
  1. The **dashboard Təqvim week view** — the payoff, and the thing run 1 never showed.
     Geometry from `week-grid.tsx`: `ROW_H = 56` px per hour, `w-14` time gutter, `h-12` day-header
     row, `min-w-[120px]` day columns, `rounded-xl border border-border bg-card` panel, blocks as
     `rounded-md` cards with an 11px semibold title over a 10px subtitle at 80% opacity.
     Scale these proportionally to the 1920x1080 canvas; keep the *relationships*, not the literal px.
  2. The **public booking widget** — the real step list and the collapsed-summary pattern with the
     violet `Dəyiş` link on the right (`booking-widget.tsx`).
  3. The **WhatsApp confirmation** carrying the project's own approved template body.
- Copy that must appear verbatim (all from the project):
  - `Bağlıdır` · `Açıqdır` (`SalonPage.closed` / `SalonPage.open`)
  - `Yeni görüş` (`Calendar.newBooking`)
  - `Onlayn qeydiyyat` (`Booking.eyebrow`, and `Calendar.source.PUBLIC`)
  - `Kim üçün?` · `Xidmət seçin` · `Mütəxəssis seçin` · `Vaxt seçin` · `Əlaqə məlumatları`
    (`Booking.steps.*`)
  - `Qadın` (`Audience.FEMALE`) · `Dəyiş` (`Booking.change`) · `Adınız` · `Telefon`
  - `Qeydiyyatı təsdiqlə` (`Booking.submit`)
  - `Təqvim` · `Gün` · `Həftə` · `Bu həftə` (`Calendar.*`)
  - `24/7 onlayn qeydiyyat` (`Landing.features.items.booking.title`)
  - `14 günlük pulsuz sınaq` · `Kart tələb olunmur` (`Landing.heroChecks`)
  - WhatsApp body: `Salam! Demo Beauty Studio salonunda Saç kəsimi xidməti üçün qeydiyyatınız
    təsdiqləndi. 📅 16 oktyabr 2026, 14:30. Sizi gözləyirik!` + button `Dəyiş / Ləğv et`
- Label formats taken from the code, not guessed:
  - Weekday short labels are `Intl.DateTimeFormat("az", { weekday: "short" })` →
    **B.E. / Ç.A. / Ç. / C.A. / C. / Ş. / B.** (the type in `calendar-shared.ts` documents `"B.e"`).
  - Day labels are `{ day: "numeric", month: "short" }` → **12 okt … 18 okt**.
  - The film's week is Mon 12 – Sun 18 October 2026; "today" is **C. 16** (Friday). The night is
    15 October 23:41 and the morning is 16 October 09:00, so a 23:41 booking for 14:30 the next
    day is chronologically coherent.

## Creative Direction
- Tone preset: `default`
- Creative direction: a quiet night-shift film — the salon sleeps, the booking doesn't.
- Interpretation: calm and confident. Energy comes from the story (night → morning), not from cut
  frequency, so transitions are clean rather than hard, every required read gets its floor, and the
  only two "loud" beats are the 09:00 reveal and the final payoff. Motion is physical and settled:
  slide in, then stop. Nothing is yanked off screen.
- Angle: The night shift. The salon is shut at 23:41 and takes a booking anyway. We follow that one
  booking end to end — the client picks it herself, the confirmation sends itself — then the clock
  jumps to 09:00 and the owner's week view fills in front of us. The product is never described,
  only caught working while the business sleeps. This is the product's own headline sentence filmed
  literally.
- Hook: a mono clock at **23:41** with the salon's real grey **"Bağlıdır"** badge under it; the
  clock ticks to **23:42** and a violet **"Yeni görüş · Saç kəsimi · 14:30"** card slides in.
- Outro / punchline: **"Siz yatırsınız." / "Masa dolur."**, then the CTA `salonbook.az/demostudio`.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign — the film stays inside the product's own dark theme
  - Naming or implying any competitor (run 1 already did the comparative ad; this is not that)
  - The `public/icons/salonbook-logo.png` lockup: it is a light-background rose/black serif mark and
    renders as a white rectangle on this palette

## Visual Identity
Verbatim from `src/app/globals.css` `:root` (the product's dark theme — the film never leaves it):
- Background: `#09090b`
- Card: `#18181b`  ·  Muted surface: `#0e0e11`
- Border: `#27272a`  ·  Border-strong: `#3f3f46`
- Text: `#fafafa`  ·  Muted text: `#a1a1aa`  ·  Faint text: `#71717a`
- Accent: `#8b5cf6`  ·  Accent hover: `#a78bfa`  ·  Success: `#34d399`
- Grid line: `rgba(255,255,255,0.05)`  ·  Glow: `#8b5cf6`
- Frame shadow: `0 24px 50px -12px rgba(0,0,0,0.7)`
- Display/body font: **Inter**, self-hosted from `assets/fonts/inter-latin.woff2` +
  `inter-latin-ext.woff2`. The product ships Geist Sans, but the on-screen language is Azerbaijani
  and the face must render `ə ş ğ ı İ ö ü ç` and `₼` — the latin-ext file carries them. Declare both
  `@font-face` blocks with their `unicode-range`s so `font_family_without_font_face` stays clear.
- Clock font: a mono stack standing in for the product's Geist Mono.
- **Contrast note for the check gate:** `#71717a` (the product's `--faint-foreground`) only reaches
  ~3.7:1 on `#18181b`, so it fails WCAG AA for normal-size text. Use `#a1a1aa` (~6.8:1) for every
  secondary *string*, and keep `#71717a` for non-text decoration or genuinely large type only.

## Storyboard
Use the storyboard in `brag-output-2026-10-16-104658/brag-plan.md` as the creative contract.

Scene summary (6 clips, 5 creative scenes — the outro is split so the payoff lines and the end card
never co-occupy the frame):
1. **23:41, closed** — 0.00 → 3.30 (3.30s) — read: `23:41`, `Bağlıdır`, `Yeni görüş`,
   `Saç kəsimi · 14:30`
2. **She books it herself** — 3.30 → 9.28 (5.98s) — read: the five real step titles and their
   collapsed summaries; five simulated taps at ~1.1s apart
3. **It confirms itself** — 9.28 → 12.02 (2.74s) — read: `Qeydiyyat təsdiqləndi!` and `Avtomatik.`
   The WhatsApp body is texture, not a required read
4. **09:00, the week is already full** — 12.02 → 16.38 (4.36s) — read: `Təqvim`, `Həftə`,
   the `8 görüş` counter, and the `Onlayn qeydiyyat` tag on the highlighted 14:30 block
5a. **Payoff** — 16.38 → 18.57 (2.19s) — read: `Siz yatırsınız.` / `Masa dolur.`
5b. **End card** — 18.57 → 21.28 (2.71s) — read: `24/7 ONLAYN QEYDİYYAT`, both trial chips, and
   `salonbook.az/demostudio` held 1.6s settled as the final frame

## Audio
- Audio role: a quiet night bed that opens into morning — sparse and ducked for the first 12s, full
  from the 09:00 cut.
- Audio arc: empty room → one notification → five precise clicks → one confirm tone → a single
  warm swell at sunrise → eight light pops as the week fills → two soft impacts and one accent.
- Music: `assets/music/bgm.mp3` (`happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`), 109.96 BPM.
- Music treatment: `data-media-start="1.09"` so video t=0 lands on a beat. 0.6s fade in, held under
  the night half, full from 12.02, 0.3s fade out on the last frame.
- Music cue guidance: bundled preset
  `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.md`.
  Beat grid ≈ every 0.546s. **Strong-cue locks (3):** 09:00 reveal at video 12.02 (music 13.11),
  `Siz yatırsınız.` at 16.38 (music 17.47), `Masa dolur.` at 17.47 (music 18.56). The final cut at
  21.28 also lands on a strong cue (music 22.37). Every scene boundary sits on the beat grid.
  Sequential: the five taps land ~2 beats apart; the slot-chip and calendar-block staggers are
  deliberately NOT beat-locked (they are fast decorative texture).
- Audio-reactive treatment: **none, deliberately.** Run 1 drove the violet bloom from the track's
  bass band per frame; unsmoothed the values flickered visibly and the user asked for it to go.
  Static glow only. This knowingly skips /brag's optional audio-reactive checklist item — document
  it rather than reintroducing the defect.
- Audio-coupled moments:
  - clock tick to 23:42 — dry low tick (`assets/sfx/tick.ogg`)
  - notification card slides in — soft warm notification (`notify.ogg`)
  - phone lands — soft land (`land.ogg`)
  - each of the five taps — short low-HF click (`tap.ogg`, `tap-firm.ogg` on the time chip,
    `tick.ogg` on the confirm press)
  - slot grid appears — three light staggered pops (`soft-pop.ogg`, descending volume)
  - success check — one short warm hit (`land.ogg`), deliberately NOT a 1.5s bell: it would ring
    over the message body
  - WhatsApp bubble — one neutral pop (`notify.ogg`), never the WhatsApp trademark sound
  - 09:00 cut — one warm swell (`swell.ogg`)
  - eight calendar blocks — `soft-pop.ogg` at 0.2–0.3 volume, landing with each block
  - payoff lines — `pay-a.ogg` / `pay-b.ogg`
  - CTA — `accent.ogg`
- SFX selection guidance: everything chosen from the **low high-frequency-risk** entries in
  `sfx-analysis.md`, because the film is calm and several cues repeat (five taps, eight pops).
  No sound fires on a cut that has no physical motion behind it, and nothing plays under the
  message body text.
- SFX analysis guidance: `C:\Users\User\.claude\skills\brag\assets\sfx\sfx-analysis.md`
- Audio files: already copied into `composition/assets/music/` and `composition/assets/sfx/`.

## Hyperframes Instructions
Built with the `hyperframes-core` contract (verified against 0.8.163) and `hyperframes-cli` for the
gate. /brag owns the angle, copy, source material, storyboard, tone, format and audio selection;
Hyperframes owns structure, exact tween mechanics, and the render workflow.

Requirements honoured:
- Shows real UI and real copy from the project in four of the six clips.
- Every required read holds at or above the reading floor (short label ≥0.8s, sentence ≥0.3s/word).
- 21.28s — inside the 15-25s law.
- Music + 24 SFX cues; no audio disabled.
- 3 strong-cue locks (the guidance caps it at 1-3), every boundary on the beat grid.
- `npx hyperframes check` is the single pre-render gate; fix every error, including WCAG findings.
- Lint rules watched for while authoring: no CSS `transform` paired with a GSAP tween on the same
  property (use `fromTo`), no `crossorigin` on media, every `<audio>` has an `id`, no tween of
  `visibility`/`autoAlpha`/`display` on a `.clip`, no `<br>` in body text, `#root` sized by
  `data-width`/`data-height` rather than hardcoded px, unique ids throughout, and an in-file
  `@font-face` for the named family.
