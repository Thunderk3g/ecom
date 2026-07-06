# OKRs — Mahaveer Stationery and Sports (online platform)

Objectives & Key Results for taking the Mahaveer storefront from "built" to "trading online",
and for keeping the underlying platform honest while it grows.

**How to use this file**
- Grade each KR 0.0–1.0 at quarter end; 0.7 is a healthy score (1.0s mean the target was sandbagged).
- Check in weekly: update the *Now* column, not the target.
- One owner per objective. KRs are measures, not task lists — tasks live in issues/plans.
- Baselines marked `—` are unmeasured today; the first job of that KR is to instrument it.

**Horizon:** Q2 FY26–27 (Jul–Sep 2026), with a look-ahead to Q3 (Oct–Dec: festive + exam season).

---

## O1 — Launch: Mahaveer is publicly trading online

*Owner: ___ · The store exists, is reachable on its own domain, and takes real paid orders.*

| # | Key Result | Baseline | Now | Target |
|---|------------|----------|-----|--------|
| KR1.1 | Production deploy live on the shop's own domain (Vercel + Supabase), `/healthz` green 30 consecutive days | dev-only | | 100% of days |
| KR1.2 | Razorpay live-mode payments enabled; ≥ 50 paid orders completed end-to-end (order → payment → fulfilment → delivered) | 0 | | 50 orders |
| KR1.3 | Catalog fully merchandised: every active product has a real photo (45-asset library in `docs/asset-prompts/` executed), price, stock level | 12/41 imaged | | 100% |
| KR1.4 | COD flow (≤ ₹5,000) live with < 20% COD refusal/return rate | not live | | live, < 20% |
| KR1.5 | Zero P0 incidents (site down > 30 min, payment double-charge, oversell) in launch quarter | — | | 0 |

## O2 — Experience: the storefront feels world-class on a Raipur phone

*Owner: ___ · Awards-level design must survive real devices and real networks.*

| # | Key Result | Baseline | Now | Target |
|---|------------|----------|-----|--------|
| KR2.1 | Lighthouse (mobile, throttled): Performance ≥ 85, Accessibility ≥ 95 on home, PLP, PDP | — | | 85 / 95 |
| KR2.2 | p75 LCP ≤ 2.5s and CLS ≤ 0.1 on 4G for home and PDP (field data once traffic exists) | — | | met |
| KR2.3 | Add-to-cart → order conversion ≥ 25%; cart-drawer engagement (open rate after add) ≥ 90% | — | | 25% / 90% |
| KR2.4 | 100% of animation surfaces pass `prefers-reduced-motion` audit; keyboard-only walkthrough of home → checkout completes without traps | partial audit | | 100% |
| KR2.5 | Search self-service: ≥ 70% of searches return ≥ 1 result; zero-result queries reviewed weekly and fed back into product naming/synonyms | — | | 70% |

## O3 — Local demand: become the default school & sports stop in the catchment

*Owner: ___ · Chhattisgarh-first growth; seasons drive this shop (school reopen, cricket season, festive gifting).*

| # | Key Result | Baseline | Now | Target |
|---|------------|----------|-----|--------|
| KR3.1 | 500 unique visitors/month from Chhattisgarh by quarter end (GA/analytics by region) | 0 | | 500/mo |
| KR3.2 | 100 customer accounts; ≥ 30% repeat-purchase rate among first 50 buyers | 0 | | 100 / 30% |
| KR3.3 | Average order value ≥ ₹750, lifted by bundles (back-to-school, cricket starter) and the ₹999 free-shipping threshold | — | | ₹750 |
| KR3.4 | Newsletter list ≥ 300 subscribers; 2 seasonal campaigns shipped (school reopen, festive gifting) with ≥ 20% open rate | 0 | | 300 / 2 |
| KR3.5 | 20 five-star reviews collected across products (reviews schema already in DB) | 0 | | 20 |

## O4 — Operations: the counter runs itself

*Owner: ___ · Admin, inventory, and fulfilment discipline so one person can run the store part-time.*

| # | Key Result | Baseline | Now | Target |
|---|------------|----------|-----|--------|
| KR4.1 | Order dispatch SLA: ≥ 95% of orders dispatched within 48h (matches published shipping policy) | — | | 95% |
| KR4.2 | Zero oversells: reservation TTL sweeps green in pg_cron all quarter; stock accuracy spot-check ≥ 98% monthly | — | | 0 / 98% |
| KR4.3 | Reorder discipline: 100% of below-threshold SKUs actioned within 7 days (thresholds seeded; alerts wired to admin) | — | | 100% |
| KR4.4 | Full catalog managed through the admin (no direct-DB edits after launch); CSV import used for ≥ 1 bulk price/stock update | direct-DB | | 100% |
| KR4.5 | Refund/return turnaround ≤ 7 working days, 100% within published returns policy | — | | 100% |

## O5 — Platform: the codebase stays multi-store honest

*Owner: ___ · Engineering health for the platform this shop runs on — one codebase, many storefronts later.*

| # | Key Result | Baseline | Now | Target |
|---|------------|----------|-----|--------|
| KR5.1 | Tenancy proof: a second demo store (different theme + catalog) runs from the same deployment with zero code forks | 1 store | | 2 stores |
| KR5.2 | CI green on every merge to main: typecheck, tests (local-DB guard now enforced), production build | partial | | 100% |
| KR5.3 | Test coverage on money paths: cart pricing, promotions, checkout idempotency, refunds each have integration tests | partial | | 4/4 paths |
| KR5.4 | All storefront images served as optimized derivatives (imgproxy or Cloudflare Images per spec §16) instead of raw PNGs | raw PNGs | | 100% |
| KR5.5 | Soft-404s resolved deliberately: `/c/*`, `/p/*` unknown slugs return real 404s (or documented noindex decision) | 200 + noindex | | decided & shipped |

---

## Q3 FY26–27 look-ahead (Oct–Dec 2026 — sketch, re-plan at quarter boundary)

- **Festive gifting push**: Diwali hampers, corporate stationery gifting; gifting AOV ≥ ₹1,200.
- **Exam season**: school-supplies subscription/bundle repeat orders.
- **Second storefront onboarded** (platform proof from KR5.1 becomes revenue).
- **WhatsApp commerce channel** (order updates + reorders) — biggest local-channel lever in this market.

## Anti-goals (explicitly not this quarter)

- No marketplace listings (Amazon/Flipkart) — margins and brand first.
- No paid ads until organic + local word-of-mouth conversion is measured (KR2.3).
- No new platform modules (SP-scope) beyond what launch demands.
