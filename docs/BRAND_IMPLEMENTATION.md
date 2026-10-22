# Brand implementation

How Arthakram Brand Kit v2.0 is applied in the product. The kit itself is a local-only reference and is
**not** stored in this repository; this file records the decisions the code must follow. It summarises —
it does not reproduce — the kit. When this file is updated, update `apps/web/src/styles/tokens.css` in
the same commit.

## 1. Principle

One identity across all four interfaces (Core Admin, Participant, Judge, Helping Staff): same shell, same
tokens, same components. Expressive brand devices appear on landing pages, event introductions, empty
states and section headers; tables, judging forms and dashboards stay clean. Orange is rationed — Paper
does the work.

## 2. Colour tokens

| Token | Value | Role |
|---|---|---|
| `--ak-paper` | `#FFF3ED` | Default page background (≈48% of surface) |
| `--ak-white` | `#FFFFFF` | Card/panel surface sitting **on** Paper; never the page background |
| `--ak-ember` | `#FC6912` | Principal accent — fills, primary buttons, badges, rules, section accents, selected state |
| `--ak-graphite` | `#443D39` | Body text, thin counter-arcs, borders of text weight |
| `--ak-ink` | `#000000` | Headlines and text on Ember |
| `--ak-blush` | `#FFE6D8` | Calm supporting panels, card footers |
| `--ak-peach` | `#FFD4BA` | Marker highlights, quote marks, photo frames |
| `--ak-sunrise` | `#FF9557` | Light end of the gradient only; never a flat fill |
| `--ak-gradient` | `linear-gradient(180deg, #FC6F1C, #FF9557)` | Top-to-bottom only; never sideways or reversed |
| `--ak-quill` | `#FC6E1A` | **Logo artwork only.** Not used by UI components (lint rule / grep check) |

Do not use `#D9D9D9` (design-tool placeholder grey). Neutrals for borders/dividers are derived from
Graphite at reduced opacity so they stay warm.

**Semantic status tokens (DECISIONS D-10)** — additive, never replacing the palette, always shown with an
icon and text: `--status-success`, `--status-warning`, `--status-error`, `--status-info`, each with a
background tint and a text colour verified ≥ 4.5:1 on its background. Values are chosen warm-compatible
(no blue/purple theme); the info status uses Graphite rather than a new hue.

## 3. Contrast rules (from the kit's measured table)

| Pairing | Allowed for text |
|---|---|
| Ink on Paper (19.30) / Graphite on Paper (9.78) | Yes, any size |
| Ink on Blush (17.56) / Graphite on Blush (8.90) / Ink on Peach (15.38) | Yes |
| **Ink on Ember (7.17)** | Yes — **button and badge text is Ink** |
| White on Ink (21.00), Paper on Graphite (9.78), Ember on Ink (7.17) | Yes (dark panels, footers) |
| Graphite on Ember (3.63) | Large text only (≥ 24 px, or ≥ 19 px bold) |
| **Ember on Paper (2.69), Ember on Blush (2.45), Ember on White (2.93)** | **No ordinary text.** Decorative rules, fills and large display accents only |
| **White on Ember (2.93), Paper on Ember (2.69), White on Sunrise (2.17)** | **Never** |

* Ordinary text ≥ 4.5:1, large text ≥ 3:1 (project target, PRD §11.5).
* The one sanctioned use of Ember as a text colour: the short, uppercase, wide-tracked **eyebrow label**
  on Paper/Ink. Where an eyebrow sits on Ember (pill badge), it is Ink.
* Status and validation are never colour-only (icon + text; `aria-invalid`, `aria-describedby`).
* Focus indicator: 3 px outline in Ink with a 2 px Paper offset ring (visible on Paper, White, Ember);
  never removed.

## 4. Typography

| Role | Family | Weight | Notes |
|---|---|---|---|
| Display / H1 | Bricolage Grotesque | 800 | line-height ≈ 1.02, letter-spacing ≈ −0.026em |
| Section headings (H2–H3) | Bricolage Grotesque | 700–800 | letter-spacing ≈ −0.02em |
| Body, lede, UI, buttons, tables, forms | Instrument Sans | 400 body · 500/600/700 labels | body line-height ≈ 1.6; body measure max `65ch` |
| Eyebrow | Instrument Sans | 700 | uppercase, tracking `0.19em`, Ember (on Paper/Ink) or Ink (on Ember), short |
| Caption | Instrument Sans | 400 | ~80% opacity of Graphite, never smaller than 12 px in product UI |
| Annotation | Caveat | 400–600 | Ember; one or two lines, a handful per page at most; never headings, captions or body |

Rules: sentence case for headings; uppercase only for eyebrows and badges; **bold is the only inline
emphasis** (no italics; no underlines except links); no Poppins/Montserrat.
Product-UI sizes are scaled for screens (body ≥ 16 px for participant/judge/staff screens); the kit's
print point sizes are references for ratios, not literal pixel values.
Fonts are self-hosted from npm (`@fontsource-variable/bricolage-grotesque`,
`@fontsource/instrument-sans`, `@fontsource/caveat`) so the CSP can stay `self` and the app works offline
on a venue network; fallbacks: `system-ui, sans-serif` (cursive for Caveat).

## 5. Other tokens

`--ak-radius-card: 8px` · `--ak-radius-pill: 7px` · `--ak-measure: 65ch` · `--ak-track-eyebrow: .19em`
· spacing scale on a 4 px base · layout widths (content 72rem, reading 65ch, form 36rem) · shadows kept
minimal and warm (Graphite-tinted, low alpha) · Tailwind theme is generated *from* these variables, so
raw hex values never appear in feature code (enforced by a lint/grep check in CI).

## 6. Logo

* The Arthakram lockup (Quill Orange feather + Ink wordmark) is **custom lettering, not a font**. It may
  only be used as supplied artwork: never re-typed, recoloured (quill orange or white only), shadowed,
  stretched, rotated or placed on photographs.
* Approved backgrounds only: Paper (default), White, Ember (wordmark and quill both white), Ink (white
  wordmark, orange quill). Clear space = height of the feather head on all sides. Minimum 120 px wide;
  below that use the **feather mark alone** (avatars, favicon, compact nav).
* **Internal product → Arthakram mark alone.** The Rishihood University shield is for external
  co-branded material and is not used in the application UI (the kit says co-branded lockups are for
  external audiences). If a public event landing page is later deemed "external", the shield would be
  supplied artwork on a White panel, never redrawn.
* Source: vector extracted from the local kit PDF and committed as static SVGs in `apps/web/src/assets/logo/` (DECISIONS D-09). The `Logo` component only renders these files, derives height from the aspect ratio, and switches to the feather mark below 120 px.

## 7. Visual devices and where they go

| Device | Use | Do not |
|---|---|---|
| Cropped arc (large circle bled off an edge) | Landing page, event hero, auth screens, empty states | Behind tables/forms; more than one or two per screen |
| Thin Graphite counter-arc (unfilled) | Beside an orange mass on hero areas | Fill it |
| Ember pill badge (≈7 px radius, **Ink text**, uppercase) | Event type/year, status labels, round/track tags | White text on Ember |
| Peach marker highlight + thin Ember underline | One or two words in a headline | Body text |
| Soft card: White, ≈8 px radius, Blush footer strip with label | Cards throughout | Heavy shadows |
| Feather mark | Compact nav, favicon, avatars, certificate stamp | Distort or recolour |
| Quote mark (oversized Peach glyph) | Testimonial/feedback quotes | Put text over it that must be read |
| Sketch doodles (outline, Ember or Graphite) | Empty states / onboarding; ≤ 2 per page; never over text | Fill; use if asset licensing unresolved (kit open item 3) |

Doodles are raster PNGs shipped only inside the kit; they stay out of the repo until the licensing item is
resolved and the user approves (empty states use arcs + feather in the meantime).

## 8. Component conventions (`apps/web/src/ui`)

* **Button** — primary: Ember fill, Ink text, bold; secondary: White/Paper with Graphite border;
  tertiary/link: Ink, underlined; destructive: Ink on a deep warm red with icon + label (still ≥ 4.5:1).
  Min 44 px touch height; visible focus; disabled state is explained, not just dimmed.
* **Input / Select / Textarea / Checkbox / Radio** — White on Paper, Graphite border, labels always
  visible above the field, helper text below, error message with icon in the field's `aria-describedby`;
  form-level error summary links to fields.
* **Card** — White, 8 px radius, optional Blush footer strip with eyebrow label.
* **Badge** — Ember pill with Ink text for brand labels; status badges use status tokens + icon.
* **Table** — White card on Paper, sticky header, Graphite text, zebra via Blush at low opacity, row
  hover, density suited to admin lists; responsive: becomes stacked cards below 640 px for staff/participant.
* **Dialog** — focus-trapped, Escape to close, destructive actions state their consequence (PRD §11.6).
* **Navigation** — left rail on desktop, bottom/drawer nav on mobile; active item marked with an Ember rule
  and bold weight (not colour alone).
* **Alert, Empty state, Loading skeleton, Toast, Countdown** — same tokens; empty states can carry one
  brand device.

## 9. Checks that keep us honest

1. `npm run lint:brand` (script in Phase 0): fails on raw hex/rgb outside `tokens.css`, on `#FC6E1A`
   outside logo assets, on `Poppins|Montserrat`, and on `text-white` over Ember classes.
2. A component gallery route (`/_design`, dev only) renders every component and colour/contrast pair.
3. Playwright visual-QA script captures the gallery plus each role's key screens at 1440 and 390 px;
   screenshots are reviewed by viewing them, and findings fixed in code (plan §1).
4. Automated contrast assertion for every token pair used for text (unit test using relative luminance).

## 10. Justified deviations (none yet)

Record any deviation here with the reason and commit reference.
