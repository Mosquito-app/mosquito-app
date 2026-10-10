# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- Football uses Three.js/React Three Fiber in the existing web app, not Flutter/Flame. Original articulated 3D models use procedural numbered club-colour jersey textures; these are not licensed club assets. The browser sends only camera-mapped directions/actions; Node owns all 22 players, their animation states, ball elevation/velocity, match time, goals, and results.
- Football's product target is a DLS/eFootball-inspired mobile landscape match, not a 2D dot radar. The active match fills the viewport with a close chase camera and touch-control overlays. Allow either landscape direction; attempt fullscreen/orientation lock after a tap and explain browser restrictions. Portrait blocks local controls, not the shared server clock.
- Football has a PostgreSQL-leased simulation owner with snapshot/input notification relay between processes, so participants may connect to different server workers.
- Football waiting rooms do not reserve funds. This follows the requested match-start deduction and avoids locking money in abandoned waiting rooms. Joining atomically rechecks both balances, locks both stakes, and starts the match. Preserve the separate existing Ludo funding behavior.
- Both games use the same Mosquito Wallet and commission wallet. Football has its own room/ledger tables; never place football IDs in the Ludo-specific wallet room foreign key.
- Unity Football uses a separate escrow/session ledger and the same Mosquito Wallet. The user chose a private trusted Unity game server as score authority: clients may poll with a match JWT but may not start or settle wagers. Keep the server credential out of Unity builds. Draws retain escrow for Golden Goal, never an automatic random winner. Integration contract and configuration: `docs/unity-football-bridge.md`.

## Product

Mosquito App offers Ludo Duel and mobile-first 11v11 Football Duel with local accounts and Paystack test-only Mosquito Wallet deposits/withdrawals. Wagered matches settle 90% to the winner and 10% to the platform.

Ludo retains its two-dice Uncle Joe board, timeout ranking, and sudden-death draw break. New Football matches use two 3-minute halves (six minutes total), no added time or halftime break, with ends switched at three minutes. Tied full-time matches continue until the first golden goal. Existing funded Football games retain the clock both players accepted, including the previous 10:40 schedule; never reset or extend a funded room on hydration. Whot, Draft, and 8-Ball Pool remain coming soon.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Do not introduce real-money payment keys or bypass test-only payment safeguards.
- Keep the football page free of transform-based entry animations: transformed ancestors change the containing block for its fixed mobile controls.
- Financial QA uses disposable PostgreSQL schemas and clearly labelled synthetic balances, not public wallet seeding or a substitute for Paystack payment verification.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Football server: `artifacts/api-server/src/lib/football-{physics,manager,finance}.ts`; REST routes: `src/routes/football.ts`; shared WebSocket transport: `src/lib/ludo-realtime.ts`.
- Football schema: `lib/db/src/schema/football.ts`; contract: `lib/api-spec/openapi.yaml`; WebGL renderer and mobile controls: `artifacts/ludo-stake-game/src/components/football-pitch.tsx`, `src/components/football-3d/`, and `src/pages/football.tsx`.
- Football checks: API-server `test tests/football-physics.test.ts` and `test tests/football-routes.test.ts`. Build the web artifact before `test tests/football-browser-server.test.ts`, which exercises two actual browser sessions against an isolated API/database.
