# Stationery Ecommerce Platform

Multi-tenant ecommerce platform. See `docs/superpowers/specs/` for the architecture charter and `docs/superpowers/plans/` for per-sub-project plans. Claude sessions: read `CLAUDE.md` first.

## Local dev

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```
