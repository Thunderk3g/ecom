# Hero & banner prompts — brand shots

The big set-piece images. The hero replaces `public/images/hero.png` (the current one
carries visible "WILDER & CO." brand text — it must go). Banners and CMS band images are
**new paths** under `public/images/banners/` — they are wired through CMS content blocks,
not `storefront-assets.ts`, so path is flexible; the paths below are the recommended
convention. Every block is self-contained. Style and batch rules: `style-guide.md`.

Aspect note: `nano_banana_pro` supports 1:1 and 4:5 — generate wide banners as 4:5 master
then extend with `outpaint_image` to 16:9/21:9 (see README, "Wide formats").

---

## 1. Storefront hero (replacement)

### hero
**Filename:** `public/images/hero.png` — **4:5 portrait** (1024×1280 minimum)

**Prompt:**
> A tall still life uniting a stationery and sports shop in one frame: on a sal-wood desk, a stack of three clothbound notebooks in cream, deep navy and terracotta with a matte black fountain pen resting diagonally on the top cover, beside the stack a bright red tennis-cricket ball and a single white nylon shuttlecock leaning against it, a loosely draped strip of golden kosa tussar silk running from under the notebooks toward the frame edge, gentle morning window light raking across the wood grain, the top fifth of the frame quiet wall space in soft focus. Photorealistic warm editorial product photography, soft natural window light from camera-left, rustic wooden tabletop with a textured warm-neutral backdrop, shallow depth of field with soft true shadows, muted warm paper-and-clay palette, gentle film-like grain, crisp focus on the product, no visible brand names or lettering, no people, no hands.

**Negative prompt:**
> text, lettering, typography, watermark, logo, brand name, signage, sticker labels, people, person, hands, fingers, face, cartoon, illustration, anime, 3D render, CGI, plastic-looking, oversaturated colours, neon colours, harsh on-camera flash, pure-white studio background, cluttered scene, duplicated objects, warped or deformed objects, extra objects, low resolution, blurry subject, JPEG artifacts, frame, border

**Alt text:** Notebook stack with fountain pen, red cricket ball and shuttlecock on a sal-wood desk in morning light.

---

## 2. Wide seasonal banner

### season-back-to-school-cricket
**Filename:** `public/images/banners/season-back-to-school-cricket.png` — **21:9** (16:9 acceptable; 1920px wide minimum). Generate a 4:5 master of the right-hand cluster, then outpaint leftward along the same shelf.

**Prompt:**
> A long single wooden shelf scene blending back-to-school season with cricket season, objects arranged left to right on continuous weathered sal-wood: the left 40% of the shelf nearly empty with only soft raking light and faint chalk dust, then a deep blue school backpack standing upright, a stack of cream and navy notebooks with a powder-blue tin geometry box on top, a brass cup of sharpened pencils, and at the right end a pale willow tennis cricket bat leaning into frame with two bright red tennis-cricket balls at its toe, terracotta lime-plaster wall behind everything, early-morning first-day-of-term light. Photorealistic warm editorial product photography, soft natural window light from camera-left, rustic wooden tabletop with a textured warm-neutral backdrop, shallow depth of field with soft true shadows, muted warm paper-and-clay palette, gentle film-like grain, crisp focus on the product, no visible brand names or lettering, no people, no hands.

**Negative prompt:**
> text, lettering, typography, watermark, logo, brand name, signage, sticker labels, people, person, hands, fingers, face, cartoon, illustration, anime, 3D render, CGI, plastic-looking, oversaturated colours, neon colours, harsh on-camera flash, pure-white studio background, cluttered scene, duplicated objects, warped or deformed objects, extra objects, low resolution, blurry subject, JPEG artifacts, frame, border

**Alt text:** Wide shelf with backpack, notebooks, geometry box, pencils and cricket bat with red balls.

---

## 3. Lifestyle / texture shots for CMS bands

### band-dhokra-desk
**Filename:** `public/images/banners/band-dhokra-desk.png` — 1:1 (4:5 variant acceptable)

**Prompt:**
> An intimate desk vignette from a Chhattisgarh study: a small Bastar dhokra bell-metal figurine of a standing musician, its lost-wax spiral texture catching the light with an aged golden-brown patina, placed beside an unglazed terracotta cup holding wooden pencils and one brass-trimmed fountain pen, on a rustic teak desk with the corner of a cream handmade-paper notebook in the foreground, the figurine and pen cup sharing sharp focus, everything else falling away softly. Photorealistic warm editorial product photography, soft natural window light from camera-left, rustic wooden tabletop with a textured warm-neutral backdrop, shallow depth of field with soft true shadows, muted warm paper-and-clay palette, gentle film-like grain, crisp focus on the product, no visible brand names or lettering, no people, no hands.

**Negative prompt:**
> text, lettering, typography, watermark, logo, brand name, signage, sticker labels, people, person, hands, fingers, face, cartoon, illustration, anime, 3D render, CGI, plastic-looking, oversaturated colours, neon colours, harsh on-camera flash, pure-white studio background, cluttered scene, duplicated objects, warped or deformed objects, extra objects, low resolution, blurry subject, JPEG artifacts, frame, border

**Alt text:** Dhokra brass figurine beside a terracotta cup of pencils and a fountain pen on a teak desk.

---

### band-chowkpurna-corner
**Filename:** `public/images/banners/band-chowkpurna-corner.png` — 1:1 (4:5 variant acceptable)

**Prompt:**
> A quiet floor-corner vignette from a Chhattisgarhi home: the edge of a chowkpurna floor decoration — white rice-paste dots and fine geometric lines — partially visible on a smooth clay-toned floor at the lower left, deliberately soft focus, a small unlit brass diya resting beside the motif, and the sharp foreground corner of a terracotta clothbound notebook with a wooden pencil laid across it, warm shafts of morning light, most of the frame calm negative space. Photorealistic warm editorial product photography, soft natural window light from camera-left, rustic wooden tabletop with a textured warm-neutral backdrop, shallow depth of field with soft true shadows, muted warm paper-and-clay palette, gentle film-like grain, crisp focus on the product, no visible brand names or lettering, no people, no hands.

**Negative prompt:**
> text, lettering, typography, watermark, logo, brand name, signage, sticker labels, people, person, hands, fingers, face, cartoon, illustration, anime, 3D render, CGI, plastic-looking, oversaturated colours, neon colours, harsh on-camera flash, pure-white studio background, cluttered scene, duplicated objects, warped or deformed objects, extra objects, low resolution, blurry subject, JPEG artifacts, frame, border

**Alt text:** Chowkpurna dot-and-line floor motif with brass diya and a terracotta notebook corner.

---

### band-kosa-paper-texture
**Filename:** `public/images/banners/band-kosa-paper-texture.png` — 1:1 (4:5 variant acceptable)

**Prompt:**
> A close texture study for a background band: a generous drape of golden kosa tussar silk with its natural slubs and irregular sheen flowing diagonally across the frame, meeting a small stack of deckle-edged handmade paper sheets in warm cream, a heavy little brass paperweight resting on the top sheet, extreme shallow focus with only the silk slubs and paper deckle at centre sharp, edges dissolving into warm blur. Photorealistic warm editorial product photography, soft natural window light from camera-left, rustic wooden tabletop with a textured warm-neutral backdrop, shallow depth of field with soft true shadows, muted warm paper-and-clay palette, gentle film-like grain, crisp focus on the product, no visible brand names or lettering, no people, no hands.

**Negative prompt:**
> text, lettering, typography, watermark, logo, brand name, signage, sticker labels, people, person, hands, fingers, face, cartoon, illustration, anime, 3D render, CGI, plastic-looking, oversaturated colours, neon colours, harsh on-camera flash, pure-white studio background, cluttered scene, duplicated objects, warped or deformed objects, extra objects, low resolution, blurry subject, JPEG artifacts, frame, border

**Alt text:** Golden kosa silk draped beside deckle-edged handmade paper with a brass paperweight.
