# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Type-check the entire project (frontend + server share one tsconfig)
npm run lint           # tsc --noEmit

# Development — both processes must run simultaneously
npm run dev            # Vite frontend on port 3000
npm run api:dev        # Express API on port 4000 (tsx watch)

# Full stack via Docker (recommended — also starts PostgreSQL and n8n)
docker compose up --build

# Production build
npm run build
```

There are no automated tests in this project.

## Architecture

### Two-process design

The project runs as two separate Node processes served on different ports:

- **Frontend** (`npm run dev`) — Vite dev server on port 3000. All pages are React SPA.
- **API** (`npm run api:dev`) — Express on port 4000. All business logic and DB queries live in the single file `src/server.ts`.

In Docker, Vite proxies `/api/*` requests to the API container via `VITE_API_PROXY_TARGET=http://api:4000`. Without that env variable, `vite.config.ts` embeds a mini Vite middleware that handles a subset of the same routes directly — this is the "local without Docker" mode. When adding a new API route to `src/server.ts`, you **must also mirror it** in the `vite.config.ts` middleware to keep both modes in sync.

### Database

PostgreSQL accessed via raw `pg` Pool — Prisma is used only for migrations (`prisma/schema.prisma`), not for queries. The server connects using `DATABASE_URL` env var or individual `APP_DB_*` vars.

Key tables: `politicos`, `votacoes`, `votos_deputados`, `despesas`, `avaliacoes`, `noticias_politicos`.

The `avaliacoes` table stores `cpf_hash` (SHA-256 of the raw CPF), never the CPF itself. The unique constraint `(politico_id, cpf_hash)` enforces one vote per CPF per politician.

### Dark mode

Tailwind CSS v4 is used with the `@variant dark (&:where(.dark, .dark *))` directive in `src/index.css`. Dark mode is class-based (`.dark` on `<html>`). `ThemeContext` (`src/context/ThemeContext.tsx`) is the single source of truth — it reads `localStorage`, falls back to `prefers-color-scheme`, and exposes `{ theme, toggleTheme }` via `useTheme()`. The toggle button lives in `src/components/Layout.tsx`.

### Frontend data flow

Pages fetch directly from `/api/*` using `fetch()` inside `useEffect` hooks — no client-side data-fetching library. Pagination uses `limit`/`offset` query params. All pages handle their own loading/error states locally. The `PoliticoProfile` page manages several independent `useEffect` chains (politico detail, available years for both votações/despesas, paginated votações, paginated despesas, chart data).

### Styling conventions

- `cn()` from `src/lib/utils.ts` (`clsx` + `tailwind-merge`) is used for conditional class composition.
- Badge colors for politician status are centralised in `src/lib/politicoStatus.ts` — update there to fix across all pages at once.
- Color mapping for dark mode: `bg-white` → `dark:bg-slate-900`, `bg-slate-50` (page) → `dark:bg-slate-950`, `bg-slate-50` (card) → `dark:bg-slate-800`, `border-slate-200` → `dark:border-slate-700`.
