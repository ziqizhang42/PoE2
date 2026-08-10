# Frontend

The frontend is a React single-page application. This document records the boundaries that are easy to violate; component behavior belongs in the code and tests.

## Entry points

- [`main.tsx`](../frontend/src/main.tsx) boots the browser application.
- [`app/app.tsx`](../frontend/src/app/app.tsx) owns the route tree.
- [`app/providers.tsx`](../frontend/src/app/providers.tsx) installs application providers.
- [`runtime/create-runtime.ts`](../frontend/src/runtime/create-runtime.ts) constructs the replaceable HTTP, WebSocket, clock, motion, and query services.

Keep module initialization free of browser side effects. Tests create a runtime with fakes and pass it through the same providers used in production.

## Routes

| Route               | Access    | Purpose                                              |
| ------------------- | --------- | ---------------------------------------------------- |
| `/`                 | Public    | Landing page and game demonstration                  |
| `/signin`           | Public    | Registration and sign-in                             |
| `/player/:username` | Public    | Profile and finished-game history                    |
| `/replay/:gameId`   | Public    | Finished-game replay                                 |
| `/lobby`            | Signed in | Lobby discovery and creation                         |
| `/game/:gameId`     | Signed in | Waiting, ready-check, active, and finished live game |

`RequireSession` preserves a same-origin return path while redirecting to sign in. Never accept a protocol-relative or external return URL. Deliberate sign-out is tracked separately from session expiry so an expired session can return to the route the player was using.

## State ownership

| Data | Owner | Rule |
| --- | --- | --- |
| Session | TanStack Query in `auth/` | The session endpoint alone decides whether the browser is signed in. |
| Player directory, public profiles, and archives | TanStack Query in `players/` and `games/` | Cache keys contain only resource identity and pagination inputs. |
| Presence, activity, lobby, and open games | Zustand store in `live/` | Store complete server replacements without re-running game rules. |
| View-only board annotations | `@poe2/rules` selectors | Derive from the current snapshot; do not persist them as authority. |
| UI preferences and transient controls | Component or provider state | Keep these out of server-backed stores. |

Do not optimistically mutate authoritative game state. A successful command ack means the transaction committed; the following snapshot is the state to render. If a connection is lost before an ack, the result is unknown until reconnect replays server state.

Public profile, history, and replay responses are viewer-independent. Do not put the current session in their query keys. The directory is authenticated but its contents are still viewer-independent, so it also has one shared key. Finishing a game invalidates player queries because a rated result can change rating data and every ranked player's percentile; `players.changed` invalidates the directory specifically after registration or rated results.

## Live connection

[`live/client.ts`](../frontend/src/live/client.ts) owns one socket and [`live/store.ts`](../frontend/src/live/store.ts) contains its snapshots. The connection is usable only after the exact-version `session.ready` handshake and the final `session.synced` frame. An opening replay replaces old socket state, including `players.status`; absence before `session.synced` is not evidence that a game or player status disappeared. A server frame outside the shared schema closes the connection permanently for that page load and asks for a reload rather than retrying an incompatible build.

The session user ID and live-store user ID must match before a screen renders live state. This prevents snapshots retained during a user switch from leaking into the next session. A policy close or refused upgrade causes a session recheck; the WebSocket client does not independently sign the user out.

Commands carry request IDs and settle on `command.accepted`, `command.rejected`, timeout, or connection loss. UI code should use the shared command runner so double submission and failure copy remain consistent.

Ready checks are watched from the application shell, not only the game route, so the earliest unconfirmed deadline is visible anywhere in the signed-in app. Use the snapshot receipt time stored by the live client when displaying a deadline; revealing a queued check later must not restart its countdown.

See [the protocol guide](./protocol.md) for message ordering and authority.

## Boards, clocks, and replays

`frontend/src/board/` contains shared presentation and deterministic board derivations. It must not depend on player routing or live-game commands; screens provide linked names or actions as nodes. `features/game/` adds interaction to authoritative live snapshots. `features/replay/` and the landing demonstration rebuild positions locally from canonical move records with [`board/replay-script.ts`](../frontend/src/board/replay-script.ts).

During a waiting game, `players.playerOne` is the owner record even when `creatorSeat` says that owner will play second. Map the physical seat through `creatorSeat` until a second player joins.

PostgreSQL decides elapsed time and timeout. The browser stores when each clock snapshot arrived and subtracts monotonic elapsed time only for display. It must never finish a game locally or reset the clock anchor when a screen mounts. Finished replays use the persisted final clock balances, including zero-move outcomes.

## UI and accessibility

Global tokens and responsive layout live in [`index.css`](../frontend/src/index.css); reusable controls live in `ui/`. Feature-specific composition stays with its feature. Prefer an existing token or primitive before adding a one-off style.

Interactive behavior must remain usable without a pointer:

- use native buttons, links, inputs, and ranges where their semantics fit;
- keep one board cell in the tab order and move focus with arrow keys;
- expose unavailable board cells with `aria-disabled` rather than removing focus from the board;
- keep replay boards read-only and label the playback range;
- trap focus in modals, restore it on close, and support Escape and backdrop dismissal where the action is safe;
- do not communicate turn, result, or connection state through color alone; and
- honor reduced-motion preferences in animation and clock refresh behavior.

Theme selection is owned by `theme/`. The inline bootstrap in [`index.html`](../frontend/index.html) applies the stored or system theme before React paints; keep it behaviorally aligned with the provider when changing theme storage.

The lobby keeps the signed-in **You** card and places the complete **Players** directory beneath it. Its native-radio Online/Overall control defaults to Online. Online filters the HTTP order by socket presence; Overall renders every row and does not add a separate presence marker. Each row links the canonical username, colors that link from `colorPercentile`, and prints the numeric rating. The list has no ranks, pagination, fixed-height scroller, or special current-player row, and owns explicit pending, empty, failure, and retry states.

## Tests

Tests are colocated with source. [`test/render.tsx`](../frontend/src/test/render.tsx) renders the real route and provider tree, while [`test/fakes.ts`](../frontend/src/test/fakes.ts) supplies injected clients, clocks, motion preferences, and protocol-valid fixtures. Generate board facts through `@poe2/rules` where possible instead of duplicating rule logic in a fixture.

JSDOM does not verify layout, native range keyboard behavior, focus-ring appearance, or actual animation timing. Check those behaviors in a browser when changing shared controls or responsive board layout. The normal commands are in [the developer guide](./dev.md#quality-and-tests).
