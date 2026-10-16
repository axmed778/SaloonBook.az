# Brag Plan: SalonBook.az

## What is this app?
Online booking for Azerbaijani salons, barbershops and clinics: the salon puts one link in its
Instagram bio, clients pick a service, a master and a free slot themselves 24/7, and an automatic
WhatsApp confirmation goes out — no calls, no manual back-and-forth, no commission per booking.

## The angle
A hard comparative ad against "all-in-one" salon systems — **without naming a single brand**.
Those suites hand a salon owner a cash register, a warehouse and a payroll module before a single
client can book a haircut. The ad weaponises their own vocabulary: **KASSA. ANBAR. MAAŞ.** slams on
screen, the frame fills with POS jargon until it suffocates, and then everything stops for one line:
*these don't bring you clients.* Cut to the opposite — one link, a 30-second self-booking, an
automatic WhatsApp confirmation. The whole video is the contrast between **clutter you operate** and
**a link that works while you cut hair.**

This is specific to SalonBook because the product's own positioning is literally "a booking tool,
not a CRM/SaaS platform" — the ad is that sentence, shouted.

## Hook (first 2-3 seconds)
One word, enormous, slamming into an ink-black frame: **KASSA.** Then **ANBAR.** Then **MAAŞ.** —
each one a physical hit on a strong beat. Any salon owner who has been demoed an all-in-one system
recognises the pain in under two seconds. The hook is recognition, not a claim.

## Key moments (the middle)
- The jargon flood: 8 more POS words (İNVENTAR, QALIQ, HESABAT, SMENA, BARKOD, TƏCHİZATÇI, VERGİ,
  ANBAR QALIĞI) rain in over the three big words at random tilts until the frame is genuinely hard
  to look at. The clutter is *felt*, not described.
- The kill line on a violet bar, with the noise gated to silence: **"Bunlar müştəri gətirmir."**
- The palette inverts to off-white — physical relief — for **"Bir link kifayətdir."**
- The real booking widget, rebuilt pixel-close from `public/hero/booking-dark.png` and
  `src/app/[locale]/[slug]/booking-widget.tsx`, driven by a simulated finger: service → master →
  slot grid → confirm, with a violet 30-second timer running in the corner.
- The real approved WhatsApp template text arriving by itself, labelled **"Avtomatik."**

## Outro / punchline
Back to ink. Two lines, two slams: **"30 saniyə."** / **"Sıfır zəng."** Then the end card:
14 gün pulsuz · Kart yox · **salonbook.az/demostudio**

## User flow worth showing
Entry → key action → result, exactly as a real client experiences it:
1. **Entry** — the salon's public page opens from the bio link (`/[slug]`): "Demo Beauty Studio",
   "Açıqdır" badge, "ONLAYN QEYDİYYAT" eyebrow.
2. **Key action** — the client picks: `Xidmət seçin → Saç kəsimi · 20 ₼`, `Mütəxəssis seçin → Ayan`,
   `Vaxt seçin → 14:30` from the live slot grid, then `Qeydiyyatı təsdiqlə`.
3. **Result** — success state "Qeydiyyat təsdiqləndi!" and the automatic WhatsApp confirmation.

This flow is the centerpiece: scenes 4 and 5 are 8.3s of the video's 19.5s.

## Tone
- Preset: `chaotic` (for pacing and transition vocabulary — hard cuts, 7 scenes, sub-2s scenes)
- Creative direction: aggressive comparative ad against all-in-one booking+cashier+inventory
  systems, no brand named. Huge kinetic type, hard cuts, slam SFX, Azerbaijani on-screen text.
- Interpretation: every cut is hard — no crossfades anywhere. Display weight, uppercase, tight
  tracking, full-bleed. Energy comes from slam-in + hold, never from yanking text
  away early. The clutter half is loud and dense; the product half is clean, quiet and fast — the
  restraint after the noise is what sells the product, so the booking scene must feel *calm*.
  Type is the primary visual throughout.

## Format: vertical — 1080x1920 (9:16, 30fps)
## Duration: 19.5s (hard ceiling 20s per the brief)

## Visual identity (from the project)
- Background (ad): ink `#16161A` — user-specified; sits one notch warmer than the product's own
  `--background: #09090b`
- Inverted background (turn + product scenes): off-white `#F7F3EE` (user-specified)
- Accent: violet `#6C4DF6` (user-specified) — effectively the product's own `--accent: #8b5cf6`,
  slightly deeper and more saturated
- Text: off-white `#F7F3EE` on ink; ink `#16161A` on off-white
- Inside the phone mock, use the product's REAL dark tokens so the UI is authentic:
  bg `#09090b`, card `#18181b`, muted `#0e0e11`, border `#27272a`, foreground `#fafafa`,
  muted-foreground `#a1a1aa`, accent `#8b5cf6`, success `#34d399`
- Display font: Inter 900 (uppercase, tracking ~-0.03em). **Requirement:** the product ships Geist
  Sans, but the on-screen language is Azerbaijani — the face MUST render `ə ş ğ ı ö ü ç`. Inter
  covers them; verify in the check frames. Fallback stack: `"Segoe UI", Arial` (both cover AZ).
- Body/UI font: Inter 400/600 inside the phone mock (stands in for Geist Sans)
- Strongest visual element: the real booking widget — collapsed step rows with the violet "Dəyiş"
  link on the right, and the 4-column time-slot grid

## Share copy (draft)
Sizə kassa, anbar və maaş modulu lazım deyil — müştəri lazımdır. SalonBook.az: bio-da bir link,
30 saniyəyə qeydiyyat, avtomatik WhatsApp təsdiqi. 14 gün pulsuz, kart tələb olunmur.

## Audio direction
- Role: dense rhythmic layer in the clutter half, then sharp motion-matched restraint in the
  product half. The video's best audio moment is the **silence** when the clutter freezes.
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` — 114.84 BPM, driving, cues
  land early and stay dense across the whole 0-25s window (best fit of the five bundled tracks
  for cuts every ~2s).
- Music treatment: in hard at t=0 aligned so a strong cue lands on the first slam. Duck ~6 dB
  under the freeze in Scene 2 so the gated silence reads. Full level from Scene 3 on. Hard-out on
  the last frame with a 0.25s fade — no long tail.
- Music cue guidance: preset read from
  `assets/music/cues/happy-beats-business-moves-vol-11-...music-cues.md`. Tempo 114.84 BPM →
  beat grid every ~0.525s. Strong cues to target for the slams: **1.60s, 3.70s, 5.80s, 8.96s,
  12.65s, 17.91s** (music time). Sequential reveals (the three hook words, the two payoff lines)
  land every **4 beats ≈ 2.1s**; the booking-flow taps land every **2 beats ≈ 1.05s**; the slot-chip
  pop-in is a fast stagger, NOT beat-locked.
- Audio-reactive treatment: subtle — let bass energy drive a slight violet bloom on the accent bar
  and a 1-2% scale breath on the big type. No waveform bars, no visualisers.
- SFX posture: dense in Scenes 1-2 (heavy slams + a rising clutter rush), then sparse and precise
  in Scenes 4-5 (one soft click per simulated tap, one confirm tone, one message pop), two final
  slams in Scenes 6-7.
- Audio-coupled moments: the three hook words (heavy impact each); the clutter flood (fast rising
  ticks); the freeze (gate to near-silence); the palette invert (bright switch/whoosh); each
  simulated tap (UI click); the slot grid (light chip rush); confirm (button press + success tone);
  the WhatsApp bubble (neutral notification pop — **not** a WhatsApp-trademark sound); the two
  payoff lines and the end card (slams).
- Restraint rule: no comedy sounds, no risers into every cut, nothing during the WhatsApp message
  body, and never a sound on a cut that has no physical motion behind it.

## Storyboard

### Scene 1 — Clutter — 3.2s
Ink `#16161A`, a barely-visible violet grid (the product's `--grid-line` idea) at ~4% opacity.
**KASSA** slams in centred, full-bleed huge, off-white, scale 1.25→1.00 in 0.12s with a hard stop
and a 1px violet underline that snaps in with it. It holds; at ~1.05s **ANBAR** slams in below it
(slightly larger, ~2° tilt); at ~2.10s **MAAŞ** slams in below that. From ~2.6s, eight small
jargon words (İNVENTAR, QALIQ, HESABAT, SMENA, BARKOD, TƏCHİZATÇI, VERGİ, ANBAR QALIĞI) rain in
fast at random rotations and 20-28% opacity, overlapping the three big words until the frame is
dense and genuinely uncomfortable. A 1-2px camera shake on the last two arrivals.
Sequential/interaction: yes — three big words one by one on strong cues (each holds ≥0.8s settled),
then a rapid 8-word clutter flood over ~0.6s (decorative texture, NOT required reading).
Audio intent: three physical hits that land in the chest, then rising density that starts to hurt.
Audio-coupled idea: heavy plate/punch impact per big word; fast dry ticks for the flood.
Music: driving, full level.
Transition mood: hard cut → Scene 2

### Scene 2 — The kill line — 1.6s
Everything from Scene 1 freezes and drops to ~12% opacity behind. A violet `#6C4DF6` bar wipes
horizontally across the middle third in 0.18s, and on it, off-white, display weight:
**"Bunlar müştəri gətirmir."** Holds ≥1.2s fully settled.
Sequential/interaction: none — one line, one hold. The stillness is the point.
Audio intent: one deep slam, then the clutter noise gates to near-silence. The sudden quiet is the
strongest audio moment in the video.
Audio-coupled idea: sub drop on the bar wipe; music ducked ~6 dB under the hold.
Music: ducked.
Transition mood: hard cut → Scene 3

### Scene 3 — The turn — 1.5s
Hard cut to inverted palette: off-white `#F7F3EE` fills the frame — physical relief after the ink.
Ink `#16161A` display type, centred: **"Bir link kifayətdir."** with the word **"link"** in violet
`#6C4DF6`. Holds ≥1.2s.
Sequential/interaction: none.
Audio intent: a bright, clean switch — the sound of a room going quiet.
Audio-coupled idea: one crisp switch/whoosh on the invert; music returns to full.
Music: full level, opened up.
Transition mood: hard cut → Scene 4

### Scene 4 — The 30-second booking — 5.0s  ← CENTERPIECE
Off-white background. A phone frame (ink bezel, ~44px corner radius, soft shadow) centred, holding
the **real booking widget** rebuilt from `public/hero/booking-dark.png` — the product's dark UI
inside the phone reads beautifully against the off-white scene. A thin violet progress bar along
the phone's top edge plus a small mono counter **00:00 → 00:30** running the whole scene.
Content, exactly as the product renders it: "DB" avatar tile, **Demo Beauty Studio**, green
**"Açıqdır"** pill, muted "Nümunə salon — test üçün.", violet-dotted eyebrow **"ONLAYN QEYDİYYAT"**.
A simulated finger (soft ink circle with a violet ring) drives the flow, one tap every ~1.05s:
1. tap `Xidmət seçin` → row collapses to **"Saç kəsimi · 20 ₼"** with the violet "Dəyiş" link
2. tap `Mütəxəssis seçin` → collapses to **"Ayan"**
3. `Vaxt seçin` card opens — the 4-column slot grid (13:00 … 18:00) pops in with a fast 0.06s
   stagger, then the finger taps **14:30** → that chip fills violet `#8b5cf6`
4. tap the violet **"Qeydiyyatı təsdiqlə"** button → it compresses 2%
Hold the finished state ~0.5s.
Sequential/interaction: yes — four simulated taps plus a fast staggered grid reveal. Every label is
real product copy; every row label holds ≥0.8s before its row collapses.
Audio intent: precise, quiet, competent — the opposite of Scene 1. The product sounds *easy*.
Audio-coupled idea: one soft UI click per tap; a light chip rush across the slot grid; a button
press on confirm.
Music: full, but SFX sit on top — no added density.
Transition mood: hard cut → Scene 5

### Scene 5 — It confirms itself — 3.3s
Same phone, same position. The screen swaps to the product's real success state: emerald `#34d399`
check in a soft circle, **"Qeydiyyat təsdiqləndi!"**, beneath it "Saç kəsimi · Ayan / 10 iyl, 14:30".
Hold ~0.9s. Then a WhatsApp-style bubble slides up over the lower third carrying the **real approved
template text**: *"Salam! Demo Beauty Studio salonunda Saç kəsimi xidməti üçün qeydiyyatınız
təsdiqləndi. 📅 10 iyl, 14:30. Sizi gözləyirik!"* with the button chip **"Dəyiş / Ləğv et"**.
A violet label stamps over the top corner: **"Avtomatik."**
Sequential/interaction: yes — success state, then the message arrives by itself.
**Reading rule for this scene:** the only text the viewer must READ is the label "Avtomatik." and
the heading "Qeydiyyat təsdiqləndi!". The WhatsApp body is texture — set it small and authentic,
highlight only the phrase "qeydiyyatınız təsdiqləndi", and do not pace the scene around reading it.
Audio intent: a quiet success tone, then one notification pop. Nothing else.
Audio-coupled idea: soft success tone on the check; neutral pop on the bubble (never a
WhatsApp-trademark sound).
Music: full.
Transition mood: hard cut → Scene 6

### Scene 6 — Payoff — 2.2s
Hard cut back to ink `#16161A`. Two display lines slam in, one per ~0.8s:
**"30 saniyə."** (off-white), then **"Sıfır zəng."** (violet `#6C4DF6`). Both hold together ~0.6s.
Sequential/interaction: yes — two sequential slams, each held to the readable floor.
Audio intent: two hits, harder than Scene 1's — this is the win.
Audio-coupled idea: heavy impact per line.
Music: full, driving to the end.
Transition mood: hard cut → Scene 7

### Scene 7 — End card — 2.7s
Ink `#16161A`. The SalonBook logo mark (`public/icons/salonbook-logo.png`) sits small and centred
above a violet rule that wipes out from the centre in 0.2s. Below it, two chips snap in fast
(~0.25s apart): **"14 gün pulsuz"** · **"Kart yox"**. Then the CTA, largest element on the card,
off-white with `/demostudio` in violet: **salonbook.az/demostudio** — holds ≥1.2s, fully settled,
last thing on screen. This is the frame people screenshot, so nothing moves under it.
Sequential/interaction: yes — rule wipe, two chips, then the URL.
Audio intent: one final slam on the URL, then the music cuts with a 0.25s fade.
Audio-coupled idea: impact on the URL arrival.
Music: hard out.
Transition mood: end.

**Music mood for this video:** chaotic-driving (114.84 BPM), gated to near-silence once in Scene 2
for contrast.
**Audio summary:** three chest-hits and a suffocating jargon rush collapse into a single beat of
silence, then the product half plays clean and precise — soft taps, one confirm tone, one message
pop — before two final slams and a hard musical stop on the CTA.

## Accuracy and safety notes
- **No brand is named or implied** anywhere on screen. The "opponent" is generic POS/ERP vocabulary
  (kassa, anbar, maaş, inventar…), which is category language, not any company's mark.
- All salon/service/master data on screen is the product's own **public demo** content
  (Demo Beauty Studio, Ayan, Saç kəsimi · 20 ₼) — no real customer names, phone numbers or PII.
- The CTA `salonbook.az/demostudio` was verified live (HTTP 200) before it went on the end card.
- The WhatsApp line is the project's own approved `booking_confirmation` template body from
  `docs/whatsapp-templates.md`, not invented copy.
- Claims used: "14 gün pulsuz", "kart yox", "30 saniyə", "sıfır zəng" — the first two are the
  product's own published trial terms; the last two describe the self-booking flow shown on screen.

---

## As shipped (final cut)

Scene boundaries were snapped to the track's beat grid (114.84 BPM, ~0.525s/beat) during
composition, so the delivered timings differ slightly from the planned ones above. Final cut:

| # | Scene | In → Out | Length |
|---|-------|----------|--------|
| 1 | Clutter | 0.00 → 4.20 | 4.20s |
| 2 | Kill line | 4.20 → 5.78 | 1.58s |
| 3 | The turn | 5.78 → 7.36 | 1.58s |
| 4 | The 30-second booking | 7.36 → 12.62 | 5.26s |
| 5 | It confirms itself | 12.62 → 15.26 | 2.64s |
| 6 | Payoff | 15.26 → 17.36 | 2.10s |
| 7 | End card | 17.36 → 19.47 | 2.11s |

Total **19.47s**. Music is offset `data-media-start="1.6"` so video t=0 lands on a strong cue.

**Strong-cue locks (3):** the KASSA slam at 0.00 (music 1.60), the kill-line bar wipe at 4.20
(music 5.80), and the phone landing at 7.36 (music 8.96). "Sıfır zəng." at 16.31 also lands on
music 17.91 but is marked beat-grid, not a lock.

**Deviations from the plan, and why:**
- **The logo was dropped from the end card.** `public/icons/salonbook-logo.png` is a
  light-background serif lockup (rose/black on white). At end-card size on ink it rendered as a
  white rectangle with illegible artwork and fought the ad's palette. The CTA URL, set in the
  ad's own display face, carries the wordmark instead.
- **An eyebrow was added to the end card** — `24/7 ONLAYN QEYDİYYAT`, verbatim from the product's
  own feature list in `messages/az.json`. Without the logo the card was too sparse.
- **The WhatsApp bubble was anchored to the bottom of the phone screen** rather than flowing after
  the success card. Flowed, it left ~575px of dead black at the bottom of the phone; anchored, it
  reads like a real notification arriving at the bottom edge.
- **Scene 5 runs 2.64s, not the planned 3.3s** — the beat grid put the cut there, and the scene's
  only required reads ("Qeydiyyat təsdiqləndi!" and "Avtomatik.") both clear their floor.

**Gate result:** `npx hyperframes check` — 0 errors, 0 layout issues across 9 samples,
54/54 text checks pass WCAG AA, 0 motion findings. 8 warnings remain, all structural style advice
(`nested_structure_needs_subcomposition` ×7 + `composition_file_too_large`): Hyperframes prefers
one sub-composition file per scene for Studio ergonomics and diffing. The composition is a single
491-line `index.html` instead. That is a readability trade-off, not a render-correctness one.

**Revision — audio-reactive bloom removed (on request).** The violet bloom behind the big type was
originally driven per frame from the track's bass band (`assets/audio-data.js` + a `tl.call()` loop).
The raw band values jump frame to frame with no smoothing, so on playback the background read as
flicker. The bloom is now a fixed `opacity: 0.2` in CSS and the end-card rule keeps a static glow;
the extracted audio data and the per-frame loop are deleted.

Measured after the change: frame-to-frame luma delta during the KASSA and MAAŞ holds is
0.0001–0.0007 on a 0–255 scale (codec noise only, i.e. a genuinely static background). The
renderer's static-frame dedup — previously disabled because the `tl.call()` loop was flagged as a
non-seek-safe side effect — now reports 228/230 frames reusable, and the delivered file dropped
from 2.1 MB to 1.5 MB at the same CRF.

This means the composition no longer satisfies /brag's optional "at least one audio-reactive
element" checklist item. That was a deliberate trade, made because the user asked for the flicker
to go; beat-locking and the music-driven edit are untouched.

**Revision — phone mock rebuilt as an iPhone 18 Pro Max (on request).** The earlier mock was a
generic rounded slab at 1.86:1, which is not an iPhone proportion. Rebuilt to the published panel
spec: 6.9" / 2868×1320 → **2.1727:1**, realised as a 708×1538 canvas (2.1723:1) inside a 754×1584
body. Titanium rail 12px with a directional gradient, black bezel 11px, corner radii 112/100/89,
iOS status bar (time, signal bars, battery), and a home indicator.

The Dynamic Island is the **18 Pro's narrower one** — reported 35% less wide than the 17 Pro's
(20.7mm → 13.5mm), i.e. ~18.5% of display width rather than ~28%: 132×58 on this canvas.

Because the screen got taller and narrower, the in-phone UI was rescaled (rows 112, slot chips 74,
CTA 96, 4-column grid at 11px gaps) and every simulated tap target was recomputed against the new
canvas origin (214, 319): rows at y 557 / 685 / 813, the 14:30 chip at (617, 1097), the confirm
button at (540, 1483). Verified frame by frame at 8.45s, 10.65s and 11.6s. The timer badge moved to
y 96 to clear the taller device.

Caveat carried into delivery: these are the panel and Dynamic Island figures reported for the
18 Pro Max, not measurements taken from a device in hand.
