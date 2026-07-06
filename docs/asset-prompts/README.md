# AI image-generation prompt library — Mahaveer Stationery and Sports

Ready-to-run prompts for every missing storefront image. **No images are generated yet**
(the image account has no credits); when credits are available, work through the
checklist below. Store: family-run stationery + sports shop, Chhattisgarh, India.
Visual identity: warm editorial, paper/clay palette, Playfair Display + Hanken Grotesk.

## Files in this library

| File | Contents |
|---|---|
| `style-guide.md` | The reusable pieces verbatim: global style suffix, global negative prompt, lighting recipe, surface/prop palette (incl. Chhattisgarh props), per-aspect guidance, batch consistency rules. |
| `products.md` | 30 product prompt blocks → `public/images/products/<slug>.png`, 1:1. |
| `categories.md` | 10 category tile prompt blocks → `public/images/categories/<slug>.png`, 1:1. |
| `hero-and-banners.md` | Hero replacement (4:5), wide seasonal banner (21:9), 3 lifestyle/texture CMS bands. |

Every prompt block is **self-contained** (subject + composition + full style suffix + full
negative prompt inline) — copy one block into the generator and run it, no other context needed.

## The global style suffix (appended verbatim inside every prompt)

> Photorealistic warm editorial product photography, soft natural window light from camera-left, rustic wooden tabletop with a textured warm-neutral backdrop, shallow depth of field with soft true shadows, muted warm paper-and-clay palette, gentle film-like grain, crisp focus on the product, no visible brand names or lettering, no people, no hands.

## The global negative prompt

> text, lettering, typography, watermark, logo, brand name, signage, sticker labels, people, person, hands, fingers, face, cartoon, illustration, anime, 3D render, CGI, plastic-looking, oversaturated colours, neon colours, harsh on-camera flash, pure-white studio background, cluttered scene, duplicated objects, warped or deformed objects, extra objects, low resolution, blurry subject, JPEG artifacts, frame, border

A relaxed variant (drops `text, lettering, typography`) exists for the few products that
legitimately carry printed marks (calculator keys, card pips, protractor degrees) — the
affected blocks already embed it. See `style-guide.md` §2.

## Model guidance

- **Primary: Higgsfield MCP → `generate_image` with model `nano_banana_pro`.**
  Cost **2 credits per image**; supports **1:1 and 4:5** aspect ratios — that covers all
  products, all category tiles, the hero and the CMS bands directly.
- **Wide formats (16:9 / 21:9 banner):** `nano_banana_pro` does not output these natively.
  Generate the right-hand object cluster as a 4:5 master, then use Higgsfield
  `outpaint_image` to extend the scene leftward along the same shelf/surface (the banner
  prompt in `hero-and-banners.md` is written for exactly this). Alternatively run
  `models_explore(action:'recommend')` for a model with native wide ratios.
- **Recraft V4.1** needs a paid plan — only an option if that plan is active; otherwise ignore.
- **Budget:** 45 images × 2 credits = **90 credits** minimum; plan ~1.5× (**≈135 credits**)
  for re-rolls (expect re-rolls whenever a model prints lettering — never accept-and-crop).
- Calibrate before a batch: view `public/images/products/fountain-pen-starter.png` and
  match its warmth, table height and shadow softness (rule set: `style-guide.md` §6).

## Aspect ratios & output targets

| Asset type | Aspect | Minimum size | Format |
|---|---|---|---|
| Product images | 1:1 | 1024×1024 | PNG |
| Category tiles | 1:1 | 1024×1024 | PNG |
| Hero | 4:5 | 1024×1280 | PNG |
| Seasonal banner | 21:9 (16:9 ok) | 1920 wide | PNG |
| CMS lifestyle bands | 1:1 (4:5 ok) | 1024×1024 | PNG |

## Filename rule (load-bearing)

`src/utils/storefront-assets.ts` maps `slug → /images/...` paths. **Filenames must match
slugs exactly** — `tennis-cricket-bat.png`, not `tennis_cricket_bat.png` or
`TennisCricketBat.png`. Workflow per asset:

1. Generate with the block's prompt + negative prompt at the stated aspect.
2. Save as PNG at the exact **target path** in the checklist.
3. Add the mapping entry in `src/utils/storefront-assets.ts`
   (`storefrontProducts` / `storefrontCategories`) — most slugs below are currently
   unmapped and fall back to the styled placeholder until mapped.
4. Tick the status column below.

Banner/CMS band paths (`public/images/banners/…`) are wired through CMS content blocks
instead of `storefront-assets.ts`; keep the same exact-filename discipline.

## Checklist

### Products (30) — prompts in `products.md`

| # | Asset | Target path | Aspect | Status |
|---|---|---|---|---|
| 1 | Tennis Cricket Bat | `public/images/products/tennis-cricket-bat.png` | 1:1 | ☐ pending |
| 2 | Cricket Tennis Balls (3pk) | `public/images/products/cricket-tennis-balls-3pk.png` | 1:1 | ☐ pending |
| 3 | Club Batting Gloves | `public/images/products/club-batting-gloves.png` | 1:1 | ☐ pending |
| 4 | ZR 100 Badminton Racquet | `public/images/products/badminton-racquet-zr100.png` | 1:1 | ☐ pending |
| 5 | Nylon Shuttlecocks (6pk) | `public/images/products/nylon-shuttlecocks-6pk.png` | 1:1 | ☐ pending |
| 6 | Towel Grip Tape | `public/images/products/badminton-grip-tape.png` | 1:1 | ☐ pending |
| 7 | Speed Skipping Rope | `public/images/products/speed-skipping-rope.png` | 1:1 | ☐ pending |
| 8 | Storm Football (Size 5) | `public/images/products/football-size-5.png` | 1:1 | ☐ pending |
| 9 | Sports Water Bottle 1L | `public/images/products/sports-bottle-1l.png` | 1:1 | ☐ pending |
| 10 | Club Carrom Board | `public/images/products/club-carrom-board.png` | 1:1 | ☐ pending |
| 11 | Carrom Coins & Striker Set | `public/images/products/carrom-coins-set.png` | 1:1 | ☐ pending |
| 12 | Classic Chess Set | `public/images/products/classic-chess-set.png` | 1:1 | ☐ pending |
| 13 | Playing Cards (2pk) | `public/images/products/playing-cards-2pk.png` | 1:1 | ☐ pending |
| 14 | Origami Paper Pack | `public/images/products/origami-paper-pack.png` | 1:1 | ☐ pending |
| 15 | Hot Glue Gun Kit | `public/images/products/glue-gun-kit.png` | 1:1 | ☐ pending |
| 16 | Craft Scissors Set | `public/images/products/craft-scissors-set.png` | 1:1 | ☐ pending |
| 17 | Clay Modelling Set | `public/images/products/clay-modelling-set.png` | 1:1 | ☐ pending |
| 18 | Acrylic Paint Set (12) | `public/images/products/acrylic-paint-set-12.png` | 1:1 | ☐ pending |
| 19 | Paint Brush Set (7) | `public/images/products/paint-brush-set-7.png` | 1:1 | ☐ pending |
| 20 | Premium Pen Gift Set | `public/images/products/pen-gift-set.png` | 1:1 | ☐ pending |
| 21 | Stationery Hamper | `public/images/products/stationery-hamper.png` | 1:1 | ☐ pending |
| 22 | Greeting Cards (10pk) | `public/images/products/greeting-cards-10pk.png` | 1:1 | ☐ pending |
| 23 | Gift Wrap Rolls (5pk) | `public/images/products/gift-wrap-rolls-5pk.png` | 1:1 | ☐ pending |
| 24 | Instruments Geometry Box | `public/images/products/geometry-box.png` | 1:1 | ☐ pending |
| 25 | FX-82 Scientific Calculator | `public/images/products/scientific-calculator-fx82.png` | 1:1 | ☐ pending |
| 26 | Sticky Tape Dispenser Set | `public/images/products/tape-dispenser-set.png` | 1:1 | ☐ pending |
| 27 | School Backpack 30L | `public/images/products/school-backpack-30l.png` | 1:1 | ☐ pending |
| 28 | Pencil Pouch | `public/images/products/pencil-pouch.png` | 1:1 | ☐ pending |
| 29 | Sticky Notes Mega Pack | `public/images/products/sticky-notes-pack.png` | 1:1 | ☐ pending |
| 30 | Cricket Starter Kit (bundle) | `public/images/products/cricket-starter-kit.png` | 1:1 | ☐ pending |

### Category tiles (10) — prompts in `categories.md`

| # | Asset | Target path | Aspect | Status |
|---|---|---|---|---|
| 31 | Sports (department) | `public/images/categories/sports.png` | 1:1 | ☐ pending |
| 32 | Cricket | `public/images/categories/cricket.png` | 1:1 | ☐ pending |
| 33 | Badminton | `public/images/categories/badminton.png` | 1:1 | ☐ pending |
| 34 | Fitness & Outdoor | `public/images/categories/fitness-outdoor.png` | 1:1 | ☐ pending |
| 35 | Indoor Games | `public/images/categories/indoor-games.png` | 1:1 | ☐ pending |
| 36 | Craft Materials | `public/images/categories/craft-materials.png` | 1:1 | ☐ pending |
| 37 | Gift Sets | `public/images/categories/gift-sets.png` | 1:1 | ☐ pending |
| 38 | Greeting Cards | `public/images/categories/greeting-cards.png` | 1:1 | ☐ pending |
| 39 | Daily Essentials | `public/images/categories/daily-essentials.png` | 1:1 | ☐ pending |
| 40 | Stationery (optional dedicated) | `public/images/categories/stationery.png` | 1:1 | ☐ pending |

### Hero & banners (5) — prompts in `hero-and-banners.md`

| # | Asset | Target path | Aspect | Status |
|---|---|---|---|---|
| 41 | Storefront hero (replacement) | `public/images/hero.png` | 4:5 | ☐ pending |
| 42 | Seasonal banner (back-to-school × cricket) | `public/images/banners/season-back-to-school-cricket.png` | 21:9 | ☐ pending |
| 43 | CMS band — dhokra desk vignette | `public/images/banners/band-dhokra-desk.png` | 1:1 | ☐ pending |
| 44 | CMS band — chowkpurna corner | `public/images/banners/band-chowkpurna-corner.png` | 1:1 | ☐ pending |
| 45 | CMS band — kosa silk & paper texture | `public/images/banners/band-kosa-paper-texture.png` | 1:1 | ☐ pending |

**Totals: 30 products + 10 category tiles + 5 hero/banner = 45 assets (≈90 credits at 2/image).**
