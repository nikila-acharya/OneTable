# OneTable

Family meal planning and grocery autopilot for busy households. Product
requirements: see [`docs/PRD.md`](docs/PRD.md) (the repo builds from its
Section 12 delivery plan).

Stack (PRD 10.1): Next.js App Router + TypeScript (strict), Tailwind CSS,
ESLint + Prettier, Vitest (+ fast-check property tests), Playwright (e2e).

## Getting started (Windows 11 / PowerShell)

```powershell
npm install
npx playwright install chromium   # once, for e2e tests
npm run dev                        # http://localhost:3000
```

Docker Compose (Postgres) and `.env.example` arrive with WP-0.2 / WP-0.4.
All task scripts are plain `npm run` entries so they work identically in
PowerShell, cmd and GitHub Actions.

## Scripts

| Command                 | What it does                                     |
| ----------------------- | ------------------------------------------------ |
| `npm run dev`           | Next.js dev server                               |
| `npm run build`         | Production build                                 |
| `npm run start`         | Serve the production build                       |
| `npm run lint`          | ESLint (`eslint .`)                              |
| `npm run format`        | Prettier write (Tailwind class sorting plugin)   |
| `npm run format:check`  | Prettier check (what CI runs)                    |
| `npm run typecheck`     | `tsc --noEmit`                                   |
| `npm test`              | Vitest unit tests (`src/**/*.test.ts`, `tests/`) |
| `npm run test:coverage` | Vitest with V8 coverage                          |
| `npm run e2e`           | Playwright; starts `next dev` on port 3100       |
| `npm run check`         | lint + typecheck + unit tests                    |

## Layout

- `src/app/` — App Router entry (layout, pages, API routes later)
- `src/lib/` — typed server-side functions and shared utilities
- `e2e/` — Playwright specs
- `docs/` — PRD and work-package notes (not linted/formatted)
