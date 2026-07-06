# Storefront motion & chrome — public API

This is the contract for page-building agents. Everything documented here is
stable; import from the barrels:

```ts
import { Reveal, Stagger, Marquee, AnimatedNumber, Parallax, usePrefersReducedMotion } from '@/components/storefront/motion';
import { useToast, toast, useChrome, formatMinor } from '@/components/storefront/overlays';
import { useCart, type VariantMeta } from '@/components/storefront/cart-context';
```

CSS lives in `src/styles/motion.css` (primitives + utilities) and
`src/styles/chrome.css` (header/overlay/footer chrome), imported globally in
`src/app/layout.tsx` — never import them yourself. Every effect respects
`prefers-reduced-motion: reduce` automatically. All motion primitives are
client components — a server component may render them directly (children are
passed through as server-rendered markup).

---

## Motion primitives (`@/components/storefront/motion`)

### `<Reveal>`

Scroll-reveal wrapper: fades + rises its content when it enters the viewport.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `as` | `ElementType` | `'div'` | Rendered element tag (`'section'`, `'li'`, …) |
| `delay` | `number` (ms) | `0` | Transition delay |
| `y` | `number` (px) | `24` | Rise distance |
| `once` | `boolean` | `true` | `false` re-animates on every re-entry |
| `className` / `style` / `children` | — | — | Merged onto the element |

```tsx
<Reveal as="section" className="section" delay={100} y={32}>
  <h2 className="h-lg">Best sellers</h2>
</Reveal>
```

No-JS / reduced-motion users always see content (the hidden state only applies
under `(prefers-reduced-motion: no-preference) and (scripting: enabled)`).

### `<Stagger>`

Container whose **direct children** reveal one-by-one when it scrolls into view.
Children need no wrapper/class. Do **not** put a `<Reveal>` directly inside a
`<Stagger>` (double animation). Delays are CSS nth-child driven, capped at 12
children (13+ share the max delay).

| Prop | Type | Default |
|---|---|---|
| `as` | `ElementType` | `'div'` |
| `interval` | `number` (ms between children) | `80` |
| `y` | `number` (px) | `20` |
| `once` | `boolean` | `true` |
| `className` / `style` / `children` | — | — |

```tsx
<Stagger className="pgrid" interval={90}>
  {products.map(p => <ProductCard key={p.id} product={p} />)}
</Stagger>
```

### `<Marquee>`

Seamless infinite horizontal loop (content auto-measured and duplicated;
clones are `aria-hidden`). Pauses on hover. Static under reduced motion.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `speed` | `number` (px/second) | `60` | Constant velocity at any width |
| `pauseOnHover` | `boolean` | `true` | |
| `aria-label` | `string` | — | Label the strip |
| `className` / `style` / `children` | — | — | Children = ONE copy of the loop content |

Item gap is `--marquee-gap` (default `44px`) — override via `style`.

```tsx
<Marquee speed={50} aria-label="Our brands" style={{ '--marquee-gap': '64px' } as React.CSSProperties}>
  <span>Camlin</span><span>Faber-Castell</span><span>Yonex</span>
</Marquee>
```

### `<AnimatedNumber>`

Counts up to `value` when scrolled into view (once, ease-out). SSR renders the
final value; reduced motion shows it immediately. Tabular numerals via `.m-num`.

| Prop | Type | Default |
|---|---|---|
| `value` | `number` (required) | — |
| `duration` | `number` (ms) | `1400` |
| `formatter` | `(n: number) => string` | round + `toLocaleString('en-IN')` |
| `prefix` / `suffix` | `string` | — |
| `className` | `string` | — |

```tsx
<AnimatedNumber value={12000} suffix="+" />   {/* → 12,000+ */}
<AnimatedNumber value={4.8} formatter={n => n.toFixed(1)} />
```

### `<Parallax>`

Gentle counter-scroll drift for imagery. Outer element is measured; the inner
`.m-parallax-inner` is transformed (rAF + passive scroll, active only while
intersecting). Disabled under reduced motion.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `as` | `ElementType` | `'div'` | Outer wrapper tag |
| `speed` | `number` | `0.12` | Drift factor; keep ≤ 0.3 |
| `maxOffset` | `number` (px) | `48` | Clamp |
| `className` / `style` / `children` | — | — | Sizing/overflow go on the outer element |

```tsx
<Parallax speed={0.15} className="hero-art">
  <img src="/images/hero.png" alt="" />
</Parallax>
```

### `usePrefersReducedMotion(): boolean`

Reactive media-query hook for custom client-side motion. `false` on
server/first render.

---

## Reusable CSS classes

### From `motion.css`

| Class | Use |
|---|---|
| `.m-reveal` / `.is-inview` | Set by `<Reveal>` — don't hand-apply |
| `.m-stagger` | Set by `<Stagger>` |
| `.m-marquee`, `.m-marquee-track`, `.m-marquee-group` | Set by `<Marquee>` |
| `.m-parallax`, `.m-parallax-inner` | Set by `<Parallax>` |
| `.m-num` | Tabular numerals (set by `<AnimatedNumber>`) |
| `.page-enter` | Route-change fade+rise (used by `(storefront)/template.tsx`) |
| `.hover-lift` | **Hand-apply** to any card/tile: −4px lift + `--shadow-card` on hover |
| `.underline-slide` | **Hand-apply** to inline links: underline grows left→right on hover/focus |

Easing/duration tokens (use in your own CSS): `--ease-out-soft`
(`cubic-bezier(0.22,1,0.36,1)`), `--ease-out-quick`, `--ease-spring`,
`--dur-reveal` (0.7s), `--dur-quick` (0.24s).

### From `chrome.css` (chrome-owned — reuse only where noted)

| Class | Use |
|---|---|
| `.annbar`, `.annbar-item`, `.annbar-sep` | Announcement topbar strip |
| `.site-header.is-stuck` | Condensed sticky header state (StickyHeader toggles) |
| `.hdr-left` | Left header cell (hamburger + search field) |
| `.mm-item/.mm-trigger/.mm-panel/.mm-list/.mm-viewall/.mm-chevron` | Mega-menu |
| `.cart-count.pop` | Badge pop keyframe (CartButton toggles) |
| `.so-trigger`, `.so-kbd`, `.so-icon-mobile` | Search triggers |
| `.so-panel/.so-inner/.so-bar/.so-input/.so-suggest/.so-section/.so-chips/.so-empty/.so-clear` | Search overlay |
| `.overlay-scrim` (+ `.open`) | **Reusable** fixed scrim w/ fade (z-92) |
| `.cart-thumb`, `.cart-line-main/-name/-axes/-total/-rmv`, `.stepper-sm` | Cart drawer lines |
| `.fs-strip` (+ `.done`), `.fs-label`, `.fs-track`, `.fs-bar` | Free-shipping progress |
| `.cart-empty`, `.cart-empty-art`, `.cart-foot-links` | Drawer empty state / footer links |
| `.mnav-*` (trigger/drawer/head/list/link/acc-trigger/acc-body/sub/viewall/foot) | Mobile menu |
| `.tst-stack`, `.tst` (+ `.leaving`), `.tst-title/-desc/-row/-body/-action/-x/-progress` | Toasts |
| `.foot-watermark` | Oversized decorative footer wordmark |
| `.news-status` | Newsletter success pill |

z-index map: header 60 · mega panel 65 · cart scrim/drawer 90/91 ·
overlay-scrim 92 · mobile drawer 93 · search panel 96 · toasts 120.

---

## Overlays & chrome (`@/components/storefront/overlays`)

Already mounted by `AppShell` — pages should NOT mount `CartDrawer`,
`SearchOverlay`, `MobileMenu`, `Toaster`, or `ChromeProvider` again. What pages
*use*:

### `useChrome()` (client)

```ts
const { searchOpen, mobileOpen, openSearch, closeSearch, openMobileMenu, closeMobileMenu } = useChrome();
```

Ctrl/Cmd+K already toggles the search overlay globally.

### Toasts

```ts
import { toast, useToast } from '@/components/storefront/overlays';

toast({ title: 'Removed from cart' });                       // plain function, any client module
toast({ title: 'Saved', description: 'We’ll email you.', duration: 6000,
        action: { label: 'Undo', onClick: () => { … } } });  // returns id
const { toast, dismiss } = useToast();                       // hook ergonomics; dismiss(id)
```

Slide-in bottom-right, progress bar, auto-dismiss 4s, hover pauses, max 4
visible. Toasts are for **secondary** feedback (e.g. removal); the cart drawer
opening is the primary add-to-cart confirmation.

### `formatMinor(cents, currencyCode?)`

Client-side money formatting for overlay/island UI (`Intl.NumberFormat`,
defaults to `INR`). Server components keep using
`src/app/(storefront)/_lib/money.ts`.

### `useOverlay({ open, onClose, panelRef, initialFocusRef? })`

Shared dialog behaviour (scroll lock w/ scrollbar compensation, Escape, Tab
focus trap, focus return). Pair with `inert={!open}` on the panel. Reuse if
you build a new overlay; do not re-implement.

---

## Cart context additions (`@/components/storefront/cart-context`)

Everything pre-existing is unchanged. New, all additive:

```ts
type VariantMeta = {
  name: string;                              // product display name
  slug?: string;                             // → drawer thumbnail via getProductImage(slug)
  axes?: Record<string, string | number>;    // e.g. { color: 'Blue', size: 'A5' }
  image?: string;                            // explicit URL, wins over slug
};

const {
  // existing: cart, totals, count, loading, error, ready, refresh,
  //           updateItem, removeItem, applyCoupon, removeCoupon,
  addItem,             // (variantId, qty = 1, meta?: VariantMeta) => Promise<boolean>
  isDrawerOpen,        // boolean
  openDrawer,          // () => void
  closeDrawer,         // () => void
  lastAddedAt,         // number | null — bumps on every successful add
  variantMeta,         // Record<variantId, VariantMeta>
  registerVariantMeta, // (variantId, meta) => void — prime from a PDP on mount
} = useCart();
```

**`addItem` now opens the cart drawer automatically on success** (that IS the
add-to-cart confirmation — do not add a success toast on top). **Always pass
`meta`** so the drawer can show real names/axes/thumbnails:

```ts
await addItem(variant.id, qty, {
  name: product.name,
  slug: product.slug,
  axes: variant.axes,
});
```

The registry persists in localStorage (cap 60) so lines render correctly after
reload. Unknown variants degrade to "Item ab12cd34" + a striped placeholder.

### Search suggestions hook (`@/components/storefront/SearchBox`)

```ts
const { suggestions, loading } = useSearchSuggestions(query, { minLength: 2, delay: 200 });
// Suggestion = { term: string; productId: string; name: string }
```

---

## Header / nav data contract

`AppShell` receives `headerNav: NavItem[]` (`{ label, href?, children? }` from
`@/modules/cms/navigation`):

- item **with `children`** → mega-menu dropdown (hover + click/focus,
  Escape/outside-click closes, `aria-expanded`/`aria-controls`, closed panel is
  `inert`); the panel lists the children and appends "View all {label} →" when
  the parent has an `href`.
- item with only `href` → plain link; neither → inert label.
- The same `headerNav` feeds the mobile drawer (children become accordions).

## Integration checklist for page agents

1. Wrap page sections in `<Reveal>` (stagger section delays ~80–120ms apart);
   use `<Stagger>` for grids/rails of cards.
2. Add-to-cart: `addItem(variantId, qty, meta)` — drawer opens itself; no
   success toast. Use `toast({ title: … })` only for secondary events.
3. Stats/counters: `<AnimatedNumber>`; hero/split imagery: `<Parallax>`;
   brand/announcement rails: `<Marquee>`.
4. Cards/tiles get `.hover-lift`; inline links get `.underline-slide`.
5. Don't hardcode the brand name — it arrives via `config.brand.*`.
6. Never animate `width/height/top/left`; transform + opacity only, using the
   easing tokens above.
