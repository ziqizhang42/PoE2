# Frontend

The frontend is a React single-page application. This document records cross-cutting boundaries and correctness rules; component behavior belongs in the code and tests.

## Architecture

[`app/app.tsx`](../frontend/src/app/app.tsx) owns routing, [`app/providers.tsx`](../frontend/src/app/providers.tsx) installs application providers, and [`runtime/create-runtime.ts`](../frontend/src/runtime/create-runtime.ts) constructs replaceable browser services. Keep module initialization free of browser side effects so tests can inject fakes through the production provider tree.

| Data | Owner | Rule |
| --- | --- | --- |
| Session and HTTP resources | TanStack Query | The server response is authoritative; query keys contain resource identity, not viewer state unless the response is viewer-specific. |
| Live snapshots | Zustand in `live/` | Store complete server replacements without re-running game rules. |
| Board annotations | `@poe2/rules` selectors | Derive them from the current snapshot. |
| Analysis line | `features/analysis/` state and URL | Store legal move history and derive the position through `@poe2/rules`. |
| Replay engine results | `features/replay/use-game-analysis.ts` | Index completed results by ply and retain them across cancellation or failure. |
| UI preferences | Component or provider state | Keep them out of server-backed stores. |

Do not optimistically mutate authoritative game state. A command acknowledgement means its transaction committed; render the following snapshot. If the connection is lost before acknowledgement, the result remains unknown until synchronization.

## Routes

| Route               | Access    | Purpose                  |
| ------------------- | --------- | ------------------------ |
| `/`                 | Public    | Landing page             |
| `/signin`           | Public    | Registration and sign-in |
| `/analysis`         | Public    | Local analysis board     |
| `/player/:username` | Public    | Profile and game history |
| `/replay/:gameId`   | Public    | Finished-game replay     |
| `/lobby`            | Signed in | Lobby                    |
| `/game/:gameId`     | Signed in | Live game                |

Authentication redirects may preserve only a same-origin return path. Track deliberate sign-out separately from session expiry.

## Live connection

[`live/client.ts`](../frontend/src/live/client.ts) owns one socket and [`live/store.ts`](../frontend/src/live/store.ts) owns its snapshots. Live state is usable only after the exact-version `session.ready` handshake and final `session.synced` frame. An opening replay replaces retained socket state; absence before synchronization is not evidence that data disappeared.

The session user ID and live-store user ID must match before rendering live state. Invalid protocol frames permanently close the connection for that page load. Policy closes and refused upgrades trigger a session recheck rather than signing the user out locally.

Use the shared command runner for request IDs, acknowledgements, timeouts, and connection loss. Ready checks belong in the application shell so deadlines remain visible away from the game route.

See [the protocol guide](./protocol.md) for message ordering and authority.

## Boards and analysis

`frontend/src/board/` contains shared board presentation and deterministic derivations. It must not depend on player routing or live-game commands. Live games render authoritative snapshots; replays and analysis rebuild positions locally from canonical moves with `@poe2/rules`.

Treat `/analysis?moves=...` as untrusted input: validate every coordinate by replaying the complete history. Analysis has one linear continuation; playing from an earlier ply replaces the abandoned future rather than creating a variation tree.

Engine access is isolated behind [`browser-engine-client.ts`](../frontend/src/features/analysis/browser-engine-client.ts). WASM search runs in one module Worker so the main thread remains responsive and the engine transposition table survives completed searches. Cancel synchronous work by terminating the Worker, and reject stale messages with request IDs.

Engine evaluations are normalized to Player 1. Preserve the engine's candidate order rather than sorting the numeric values for the side to move, and treat the first line's equivalent placements as the same ranked choice. Once a streamed or completed search result exists, the board automatically shows the engine-evaluation timeline and candidate markers; board score remains the fallback before that. A replay's full-board position uses its exact final margin instead of starting a search with no legal move.

Completed results use a bounded, tab-local cache keyed by move history and candidate count. A longer time budget must still search, and a lower-node result must not replace a stronger cached result. Streamed depths may update the active readout, but only a finished search becomes a completed replay timeline point.

The frontend installs `@poe2/engine-wasm` through the named `engine` catalog in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml). The catalog value is an opaque, exact package spec: use the artifact spec published by an engine release rather than constructing a URL from its version. `frontend/package.json` must keep using `catalog:engine` so the source remains centralized.

The engine is a build dependency: Vite emits the Worker and WASM asset for browsers to download from the application origin. To upgrade it:

1. replace only the `catalogs.engine` package spec with the release-provided spec;
2. run `pnpm install` to resolve the artifact and update `pnpm-lock.yaml`;
3. inspect the installed package's version, exports, and TypeScript contract instead of assuming they match the previous release; and
4. run the frontend typecheck, analysis tests, and production bundle.

Engine and API versions shown in the UI come from each engine response; application models must not encode a particular release version. UI-supported time budgets and Multi-PV values live once in `analysis-settings.ts`, and cached reports from different engine or API versions are never compared as interchangeable search results. Serve emitted `.wasm` files as `application/wasm` in production.

## Clocks

PostgreSQL decides elapsed time and timeout. The browser subtracts monotonic time from the latest snapshot only for display; it must never finish a game locally or reset the clock anchor when a screen mounts. Finished replays use persisted final balances.

## UI and accessibility

Global tokens and responsive layout live in [`index.css`](../frontend/src/index.css); reusable controls live in `ui/`. Prefer existing tokens and primitives, and make selected controls distinguishable without relying on a subtle shadow or color alone.

Interactive behavior must remain usable without a pointer:

- use native controls where their semantics fit;
- keep one interactive board cell in the tab order and support spatial keyboard movement;
- expose unavailable cells with `aria-disabled`;
- label read-only boards and playback controls;
- manage modal focus and safe dismissal; and
- honor reduced-motion preferences.

Theme bootstrap in [`index.html`](../frontend/index.html) must remain behaviorally aligned with the React theme provider.

## Tests

Tests are colocated with source. [`test/render.tsx`](../frontend/src/test/render.tsx) renders the real route and provider tree, while [`test/fakes.ts`](../frontend/src/test/fakes.ts) supplies injected services and protocol-valid fixtures. Generate game facts through `@poe2/rules` instead of duplicating rule logic.

JSDOM does not verify layout, native range behavior, focus-ring appearance, or animation timing. Check those behaviors in a browser when changing shared controls or responsive board layout. Commands are listed in [the developer guide](./dev.md#quality-and-tests).
