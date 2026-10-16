# Hyperframes Composition Brief: SalonBook.az

## Objective
Create a 19.5s vertical comparative launch ad for SalonBook.az — an aggressive, hard-cut,
kinetic-type piece in Azerbaijani that sets "all-in-one" salon software clutter (kassa, anbar,
maaş) against one link in the bio, a 30-second self-booking, and an automatic WhatsApp
confirmation. No competitor is named or implied.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: vertical — 1080x1920, 30fps
- Duration: 19.5s (hard ceiling 20s)

## Source Material
- Project root: `C:\Users\User\Desktop\SaloonBook.az\.claude\worktrees\brag-video`
- Primary files read:
  - `messages/az.json` — all on-screen Azerbaijani copy (Landing, Booking, SalonPage)
  - `public/hero/booking-dark.png` — a real screenshot of the booking page; **the fidelity
    reference for the phone mock**
  - `src/app/[locale]/[slug]/booking-widget.tsx` — the booking UI's real structure and classes
  - `src/app/globals.css` — the product's real color tokens
  - `docs/whatsapp-templates.md` — the approved `booking_confirmation` template body
  - `public/icons/salonbook-logo.png` — logo mark for the end card
- Product name: SalonBook.az
- Tagline / strongest claim: "Müştərilər özləri qeydiyyatdan keçsin — 24/7."
- Key UI moment to recreate: the public booking widget — collapsed step rows each with a violet
  "Dəyiş" link on the right, then the open "Vaxt seçin" card with its 4-column time-slot grid
- Copy that must appear verbatim:
  - `KASSA` / `ANBAR` / `MAAŞ` (hook, one per slam)
  - `Bunlar müştəri gətirmir.`
  - `Bir link kifayətdir.`
  - `Demo Beauty Studio` · `Açıqdır` · `Nümunə salon — test üçün.` · `ONLAYN QEYDİYYAT`
  - `Xidmət seçin` → `Saç kəsimi · 20 ₼`
  - `Mütəxəssis seçin` → `Ayan`
  - `Vaxt seçin` → slot grid `13:00 13:15 13:30 13:45 / 14:00 14:15 14:30 14:45 / …` (select `14:30`)
  - `Dəyiş` (the violet change-link on each collapsed row)
  - `Qeydiyyatı təsdiqlə`
  - `Qeydiyyat təsdiqləndi!`
  - `Salam! Demo Beauty Studio salonunda Saç kəsimi xidməti üçün qeydiyyatınız təsdiqləndi.
    📅 10 iyl, 14:30. Sizi gözləyirik!` (texture, not required reading) + button chip
    `Dəyiş / Ləğv et`
  - `Avtomatik.`
  - `30 saniyə.` / `Sıfır zəng.`
  - `14 gün pulsuz` · `Kart yox` · `salonbook.az/demostudio`
  - `SalonBook.az ilə gücləndirilib` (small, in the phone footer)

## Creative Direction
- Tone preset: `chaotic` (pacing + transition vocabulary only)
- Creative direction: aggressive comparative ad against all-in-one booking+cashier+inventory
  systems, no brand named; huge kinetic type, hard cuts, slam SFX, Azerbaijani on-screen text
- Interpretation: **every** transition is a hard cut — zero crossfades in this video. Type is the
  primary visual: display weight, uppercase where it reads better, tight tracking, full-bleed.
  Energy comes from slam-in (0.10–0.14s) plus a real hold, never from pulling text early. The
  first half is loud and dense; the product half is deliberately calm and precise — that drop in
  noise is the argument, so do not decorate scenes 4–5.
- Angle: those suites hand a salon owner a cash register, a warehouse and a payroll module before
  one client can book a haircut. The ad weaponises their own vocabulary, buries the frame in it,
  stops dead on "these don't bring you clients", then shows the opposite: one link, 30 seconds,
  an automatic WhatsApp confirmation.
- Hook: **KASSA.** → **ANBAR.** → **MAAŞ.** slamming into an ink frame on strong beats.
- Outro / punchline: "30 saniyə." / "Sıfır zəng." → end card with the CTA URL.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals, particles, waveform bars, strobing
  - Any competitor name, logo, or recognisable product silhouette
  - Redesigning the product UI — it must match `booking-dark.png`

## Visual Identity
- Background (ad frames): ink `#16161A`
- Inverted background (scenes 3–5): off-white `#F7F3EE`
- Text: `#F7F3EE` on ink, `#16161A` on off-white
- Accent: violet `#6C4DF6`
- Inside the phone mock use the product's REAL tokens: bg `#09090b`, card `#18181b`,
  muted `#0e0e11`, border `#27272a`, foreground `#fafafa`, muted-fg `#a1a1aa`,
  accent `#8b5cf6`, success `#34d399`
- Display font: Inter 900 (fallback `"Segoe UI", Arial`). **Hard requirement:** the on-screen
  language is Azerbaijani — `ə ş ğ ı ö ü ç İ Ə` must all render. Verify in snapshot frames before
  render; if any glyph falls back or tofus, switch the whole composition to `"Segoe UI"`.
  (Note: a named `font-family` needs an in-file `@font-face` to a shipped local file or lint fires
  `font_family_without_font_face` — so either ship the font file into `assets/fonts/` or use only
  generic/system families.)
- Body/UI font inside the phone: same family at 400/600 (stands in for the product's Geist Sans)
- Visual references from the project: the collapsed step row (label + value + violet "Dəyiş"),
  the 4-column slot grid, the "DB" avatar tile, the green "Açıqdır" pill, the emerald success check

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. **Clutter** — 3.2s — KASSA/ANBAR/MAAŞ slam in one per ~1.05s, then 8 jargon words flood the
   frame. Must read: the three big words. Flood = texture.
2. **Kill line** — 1.6s — clutter freezes to 12%, violet bar wipes, "Bunlar müştəri gətirmir."
   holds ≥1.2s. Audio gates to near-silence.
3. **Turn** — 1.5s — hard cut to off-white, "Bir link kifayətdir." with "link" in violet, ≥1.2s.
4. **The 30-second booking** — 5.0s — phone mock with the real widget; four simulated taps
   (service → master → slot → confirm) ~1.05s apart, slot grid pops in on a fast stagger, violet
   00:00→00:30 counter runs in the corner.
5. **It confirms itself** — 3.3s — success state "Qeydiyyat təsdiqləndi!" holds ~0.9s, then the
   real WhatsApp template bubble slides up with the label "Avtomatik.".
6. **Payoff** — 2.2s — hard cut to ink; "30 saniyə." then "Sıfır zəng." (violet), ~0.8s each.
7. **End card** — 2.7s — logo, violet rule wipe, chips "14 gün pulsuz" · "Kart yox", then
   **salonbook.az/demostudio** held ≥1.2s as the final still.

## Audio
- Audio role: dense rhythmic layer for scenes 1–2, then sparse motion-matched precision for 3–5,
  two hard slams to close.
- Audio arc: three chest-hits and a suffocating jargon rush → one beat of near-silence → clean,
  quiet, competent product sounds → two slams and a hard musical stop on the CTA.
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (114.84 BPM)
- Music treatment: in at full from t=0, aligned so a strong cue lands on the first slam; duck
  ~6 dB across the Scene 2 hold so the gated silence reads, back to full from Scene 3; hard out on
  the final frame with a ~0.25s fade. Implement the duck and the out with a `data-automation`
  volume lane on the `<audio>` element (`data-volume` is only the static baseline).
- Music cue guidance: bundled preset at
  `~/.claude/skills/brag/assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.md`
  (and the matching `.json` for `strongCues` + `beats`). Beat grid ≈ every 0.525s. Strong cues in
  music time: **1.60, 3.70, 5.80, 6.34, 8.96, 9.50, 12.65, 17.91, 22.65, 24.23**. Lock 1–3 major
  moments only — first recommended locks: the **KASSA** slam, the **Scene 3 invert**, and the
  **CTA arrival**. Sequential text (three hook words; two payoff lines) must sit on **every 4th
  beat ≈ 2.1s**, never adjacent beats. Booking taps sit on **every 2nd beat ≈ 1.05s**. The
  slot-chip stagger is free-running (0.06s), NOT beat-locked.
- Audio-reactive treatment: subtle — bass/RMS may drive a slight violet bloom on the accent bar and
  a ≤2% scale breath on the big display type. Nothing else. No visualisers, no particles.
- Audio-coupled moments:
  - Scene 1, each of KASSA/ANBAR/MAAŞ — heavy impact, landing with the slam
  - Scene 1, jargon flood — fast rising dry ticks, density increasing
  - Scene 2, bar wipe — one deep hit, then gate the bed down
  - Scene 3, palette invert — one bright switch/whoosh
  - Scene 4, each simulated tap — one soft UI click, exactly on contact
  - Scene 4, slot grid — a light chip rush across the stagger
  - Scene 4, confirm button — button press
  - Scene 5, success check — quiet success tone
  - Scene 5, WhatsApp bubble — a neutral notification pop (**never** a WhatsApp-trademark sound)
  - Scene 6, both lines and Scene 7 CTA — slams
- SFX selection guidance: pick after the animation exists, and match the physicality of the motion
  — heavy plate/punch for the type slams, `ui/` and `interface/` clicks for taps, a light switch
  for the invert. Silence during the WhatsApp body. Never place a sound on a cut with no motion.
- SFX analysis guidance: `~/.claude/skills/brag/assets/sfx/sfx-analysis.md` (+ `.json`). Prefer
  low high-frequency-risk files for the repeated tap sounds so the product half stays polished.
- Exact SFX choice: Hyperframes picks filenames, timestamps, density and volume.
- Audio files: copy the chosen music and every selected SFX into
  `brag-output/composition/assets/`.

## Hyperframes Instructions
Load the composition-building domain skills — `hyperframes-core` (composition contract + `data-*`
timing), `hyperframes-animation` (motion), `hyperframes-creative` (design spec, beats,
audio-reactive), `hyperframes-keyframes` (seek-safe keyframes) and `hyperframes-cli`
(lint/check/render). **This is /brag's own workflow — do not enter the `hyperframes` entry-point
intent interview and do not route into the generic promo / product-launch-video workflow.** Prefer
native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show real UI from the project: the booking widget is mandatory and must match
  `public/hero/booking-dark.png`.
- Every line the viewer must read stays fully settled for its floor: short label ≥0.8s, sentence
  ≥0.3s/word (min 1.2s). The three hook words, the two kill/turn lines, the payoff lines and the
  CTA are all required reads. The jargon flood and the WhatsApp body are NOT.
- Total duration 19.5s, hard ceiling 20s.
- Include the music and SFX layer.
- Treat the audio notes as guidance, not a fixed cue sheet; choose SFX after the animation exists.
- Treat cue metadata as optional timing hints; ignore any cue that hurts readability or pacing.
- Major reveals may shift ≤0.15s onto a strong cue; small entrances ≤0.10s onto a beat. Use only
  1–3 strong-cue locks.
- Honor the ducking and the hard-out via the volume automation lane.
- Wire at least one subtle audio-reactive element; if extraction is unavailable, document it and
  render anyway.
- Use local assets only.
- `npx hyperframes check` must pass with zero findings before render — it is brag's single gate.
