# Style Guide — Mahaveer Stationery and Sports asset prompts

The reusable pieces, verbatim. Every prompt in this library already embeds these inline
(prompts are self-contained), but this file is the single source of truth when writing
new prompts or regenerating a failed image.

---

## 1. Global style suffix (append verbatim to every prompt)

> Photorealistic warm editorial product photography, soft natural window light from camera-left, rustic wooden tabletop with a textured warm-neutral backdrop, shallow depth of field with soft true shadows, muted warm paper-and-clay palette, gentle film-like grain, crisp focus on the product, no visible brand names or lettering, no people, no hands.

Do not paraphrase it. Two different models given the same suffix converge on the same
look; two paraphrases do not.

## 2. Global negative prompt (use verbatim)

> text, lettering, typography, watermark, logo, brand name, signage, sticker labels, people, person, hands, fingers, face, cartoon, illustration, anime, 3D render, CGI, plastic-looking, oversaturated colours, neon colours, harsh on-camera flash, pure-white studio background, cluttered scene, duplicated objects, warped or deformed objects, extra objects, low resolution, blurry subject, JPEG artifacts, frame, border

**Text-bearing product exception.** A few products cannot exist without printed marks
(scientific calculator keys, playing-card pips and indices, protractor degree marks).
For those blocks only, drop the leading `text, lettering, typography,` terms and use:

> watermark, logo, brand name, signage, readable brand text, sticker labels, people, person, hands, fingers, face, cartoon, illustration, anime, 3D render, CGI, plastic-looking, oversaturated colours, neon colours, harsh on-camera flash, pure-white studio background, cluttered scene, duplicated objects, warped or deformed objects, extra objects, low resolution, blurry subject, JPEG artifacts, frame, border

The affected blocks in `products.md` already carry the correct variant.

## 3. Lighting recipe

- **Source:** one large soft daylight source — a window at **camera-left**, roughly 45° to the subject, slightly above table height.
- **Quality:** diffused morning light (sheer curtain feel), warm but muted — think 8–10 am, not golden-hour orange.
- **Shadows:** soft-edged, falling to the **right** of the subject, never pitch black; ambient bounce lifts them to a warm grey.
- **No** fill flash, no rim light, no coloured gels, no dramatic low-key looks.
- **Monsoon variant** (used sparingly, where a prompt says so): the same window light, slightly cooler and softer, as through an overcast monsoon sky — still warm-neutral overall.

## 4. Surface & prop palette

**Surfaces (pick one per shot):**
- Weathered sal-wood planks, honey-brown, visible grain (default product surface).
- Rustic teak-toned tabletop (matches existing `hero.png` / `fountain-pen-starter.png`).
- Dark slate tile (accent, used in the existing fountain-pen shot — reserve for premium items).
- Handmade kraft/khadi paper sheet laid on wood (craft and paper products).
- Terracotta-toned lime-plaster wall as backdrop (sports lean-against shots).

**Neutral props (max 2 per image, always secondary to the product):**
- Unglazed terracotta bowl, cup, or small pot.
- Small brass tumbler or brass bowl (aged, not polished mirror-bright).
- Jute twine, jute sacking cloth, unbleached cotton cloth.
- Cream handmade-paper notebook or loose sheets.
- Wooden pencil, chalk stick, chalk dust.

**Chhattisgarh prop list (the differentiator — one, at most two, cues per image, kept quiet):**
- **Bastar dhokra figurine** — small bell-metal lost-wax brass figure (elephant, horse, standing musician), aged golden-brown patina. Use in soft focus, background.
- **Kosa / tussar silk** — a folded or loosely draped strip in natural gold-beige with slubbed texture. Backdrop accent or under-cloth, never wrapping the product.
- **Terracotta and sal-wood textures** — as surfaces (above).
- **Chowkpurna hint** — white rice-paste dot-and-line floor motif, geometric, only ever partially visible and in soft focus at a frame edge. Lifestyle bands only, never product shots.
- **Brass diya** — small oil lamp, unlit by default, in background bokeh.
- **Monsoon-light warmth** — the lighting variant above.
- **Indian school/sport specificity** — tin geometry box, exam pad, gully-cricket red tennis balls, carrom powder tin, kanchas (glass marbles), chalk-drawn stumps on a wall.

**Colour palette:** paper cream, clay/terracotta, honey wood, muted sage, deep navy accents, brass gold. Avoid saturated primaries except where the product itself is bright (tennis balls, origami paper, clay bars) — then keep the *environment* muted so the product carries the colour.

## 5. Per-aspect guidance

| Aspect | Used for | Composition rules |
|---|---|---|
| **1:1** | All product images, all category tiles | Product centred or on a right-third diagonal; occupies 55–75% of frame; breathing room on all sides (storefront cards crop nothing, but padding reads premium); horizon/table edge in the lower third. |
| **4:5** | Hero, tall CMS bands | Vertical still life; stack or lean objects to use the height; key subject in the middle band; top fifth kept quiet (UI text overlays land there). |
| **16:9 / 21:9** | Wide seasonal banners | Objects arranged along a left-to-right line on one continuous surface; left ~40% of frame kept visually quiet (headline overlay zone); no critical detail in the outer 5% (responsive crop). |

## 6. Consistency rules (batch discipline)

1. **Same light direction across a batch** — window camera-left, shadows right. Never mirror an image after generation.
2. **Same table height** — camera at a shallow 15–30° elevation for product shots (as in the existing fountain-pen image); overhead 90° only where a prompt explicitly says "overhead flat-lay".
3. **Same lens feel** — 85 mm short-telephoto look, f/2.8-equivalent depth of field; background softly defocused, product front edge sharp.
4. **One surface family per department batch** — e.g. all cricket items on sal-wood/terracotta; all gifting on teak + kosa silk; keeps category pages coherent.
5. **Repeat the exact suffix and negative** from this file for regenerations — do not "improve" wording mid-batch.
6. **No text anywhere**, including incidental packaging copy. If a model insists on printing lettering on packaging, re-roll; do not accept and crop.
7. **Colour drift check** — after each batch of 5, view thumbnails side by side with `public/images/products/fountain-pen-starter.png`; if any image reads cooler/bluer than the reference, re-roll it.
8. **Square exports** at 1024×1024 minimum, PNG, filename exactly `<slug>.png`.
