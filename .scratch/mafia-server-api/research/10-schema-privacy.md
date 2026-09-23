# 10 — Schema privacy (research findings)

## Summary

- **`@visibility("owner")` does not exist** in `@colyseus/schema` 4.x or 5.x (verified from raw source). The colloquial "owner" pattern is built with the **`@view(tag)` field decorator** combined with **per-client `client.view.add(player, tag)`** in Colyseus 0.17.
- **API is stable**: `@view(tag)` + `StateView` is the same model in 4.x and 5.x. 5.x adds the new `schema() / t.*` field-builder style, but the decorator style (`@type` + `@view`) the project already uses is still fully supported.
- **Recommendation**: Use `@view(1)` on `role` / `team` fields and per-client `client.view.add(player, 1)` — this is the only approach that keeps secrets in the replicated state schema and works seamlessly with Colyseus's existing patch/full-state pipeline. `client.send()` and `onAuth` are complementary side-channels for one-shot reveals, not a substitute.
- **GAME_OVER reveal** is a runtime flip (add the tag bit to every client's view), **no schema swap**.
- **Critical version skew** in the project: `package.json` and `package-lock.json` declare `@colyseus/schema@^4.0.0` / locked 4.0.31, but `node_modules/@colyseus/schema/package.json` actually contains **5.0.33**. The runtime semantics for `@view` / `StateView` are compatible across both, so the existing code works, but the project should resolve the skew before adding new code.

## Evidence (Local files verified)

- `G:\Projects\web-pages\mafia-game\mafia-server\package.json:33` — declares `"@colyseus/schema": "^4.0.0"`, `"colyseus": "^0.17.6"`.
- `G:\Projects\web-pages\mafia-game\mafia-server\package-lock.json:200-201` — locked `"@colyseus/schema": "4.0.31"`.
- `G:\Projects\web-pages\mafia-game\mafia-server\node_modules\@colyseus\schema\package.json` — actually installed `version: "5.0.33"` (mtime `19.09.2026 23:21:00`).
- `G:\Projects\web-pages\mafia-game\mafia-server\node_modules\@colyseus\schema\build\annotations.d.ts:51` — `export declare const DEFAULT_VIEW_TAG = -1;`
- `G:\Projects\web-pages\mafia-game\mafia-server\node_modules\@colyseus\schema\build\annotations.d.ts:76` — `export declare function view<T>(tag?: number): (target: T, fieldName: string) => void;`
- `G:\Projects\web-pages\mafia-game\mafia-server\node_modules\@colyseus\schema\build\encoder\StateView.d.ts:111` — `add(obj: Ref, tag?: number, checkIncludeParent?: boolean): boolean;`
- `G:\Projects\web-pages\mafia-game\mafia-server\node_modules\@colyseus\schema\build\encoder\StateView.d.ts:106` — `addTag(tree: ChangeTree, tag: number): void;`
- `G:\Projects\web-pages\mafia-game\mafia-server\node_modules\@colyseus\schema\build\encoder\StateView.d.ts:95-104` — *"A field whose mask is `tag` is visible if the view was `add()`ed with any overlapping bit"*.
- `G:\Projects\web-pages\mafia-game\mafia-server\src\schema\PlayerState.ts:1-10` — existing schema has no `role`/`team` field yet.
- `G:\Projects\web-pages\mafia-game\mafia-server\src\schema\MafiaState.ts:20-28` — `players: MapSchema<Player>`.
- `G:\Projects\web-pages\mafia-game\mafia-server\src\modules\auth.ts:13-27` — `onAuth` already returns `{ name }` as `client.auth`.
- `G:\Projects\web-pages\mafia-game\mafia-server\src\rooms\MafiaRoom.ts:66-68` — delegates `onAuth` to `Auth.onAuth`.

## Evidence (Upstream source)

- https://raw.githubusercontent.com/colyseus/schema/4.0.31/src/index.ts — 4.x exports include `view`, `StateView`, `Encoder`, `Decoder`, but **no `visibility`** symbol.
- https://raw.githubusercontent.com/colyseus/schema/5.0.33/src/annotations.ts — `DEFAULT_VIEW_TAG = -1`; `view<T>(tag: number = DEFAULT_VIEW_TAG)` is the only field-visibility API.
- https://raw.githubusercontent.com/colyseus/schema/5.0.33/README.md — *"State Views: Per-client visibility. Decide which properties and instances each client receives"*; example uses `secret: t.string().view()` + `view.add(player)`.
- https://raw.githubusercontent.com/colyseus/colyseus/0.17/packages/core/src/Transport.ts — `interface Client { view?: StateView; ... send<K>(type, ...args): void; ... auth?: ExtractClientAuth<T>; }` — server-side `Client` has `.view`, `.send`, `.auth` directly.
- https://raw.githubusercontent.com/colyseus/colyseus/0.17/packages/core/src/Room.ts — `_onJoin` does `client.auth = await this.onAuth(...)` (stored on the client object, never broadcast). `broadcastPatch()` calls `_serializer.applyPatches(this.clients, this.state)` (per-client encoding via each client's `view`).

## 1. What `@visibility("owner")` actually is

It is **not** a real decorator in the schema package. It is a colloquial description that appears in older Colyseus blog posts / pre-0.15 docs. The real mechanism is the **`@view(tag)` field decorator** plus the **per-client `StateView`** that Colyseus 0.17 attaches to every client as `client.view`.

- 4.x reference: https://github.com/colyseus/schema/blob/4.0.31/README.md (search for `view` / `StateView`).
- 5.x reference: https://github.com/colyseus/schema/blob/5.0.33/README.md#stateview--view.
- `client.view` is documented on the server-side `Client` interface: https://github.com/colyseus/colyseus/blob/0.17/packages/core/src/Transport.ts (the comment says *"when using `@view()` decorator in your state properties, this will be the view instance for this client"*).

## 2. API stability (4.x vs 5.x)

The `@view(tag)` + `client.view.add(player, tag)` model is identical across 4.x and 5.x. 5.x additionally introduces the field-builder style (`schema({...})`, `t.string().view()`), but the legacy `@type`/`@view` decorator style the project already uses (`PlayerState.ts:1-10`) remains fully supported.

A subtle 5.x note: tags are **bitmasks**, and `@view()` (no arg) defaults to `DEFAULT_VIEW_TAG = -1` which is "visible to all views". To make a field visible only to a subset of clients, you must pass an explicit non-default tag such as `@view(1)`.

## 3. Concrete code example for the mafia schema

`src/schema/PlayerState.ts` — add the role/team fields with a private tag:

```typescript
import { Schema, type, view } from "@colyseus/schema";

export const OWNER_VIEW_TAG = 1; // bit 1 = "owner can read role/team"

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("boolean") isAlive: boolean = true;
  @type("boolean") isConnected: boolean = true;
  @type("boolean") isHost: boolean = false;
  @type("number") seatIndex: number = 0;

  // PRIVATE: only the owning client sees this.
  @type("string") @view(OWNER_VIEW_TAG) role: string = "";
  // Private: same tag so server-driven reveal (GAME_OVER) flips them together.
  @type("string") @view(OWNER_VIEW_TAG) team: string = "";
}
```

`src/logic/visibility.ts` (new) — attach views at role assignment and at GAME_OVER:

```typescript
import type { Client } from "@colyseus/core";
import type { Player } from "../schema/PlayerState.js";
import { OWNER_VIEW_TAG } from "../schema/PlayerState.js";

export function revealRoleToOwner(player: Player, ownerClient: Client) {
  // Owner can read role/team of self.
  ownerClient.view?.add(player, OWNER_VIEW_TAG);
}

export function revealAllRolesAtGameOver(players: Iterable<Player>, clients: Client[]) {
  for (const player of players) {
    for (const client of clients) {
      client.view?.add(player, OWNER_VIEW_TAG);
    }
  }
}
```

## 4. How night-action handlers read `state.players[i].role` without leaking

The `@view(tag)` decorator **never restricts server-side access** — the field is always present in the JavaScript instance. The tag only controls **what bytes the encoder emits per client**. So:

```typescript
// src/logic/nightActions.ts (example — pure server-side read)
function handleMafiaKill(mafiaClient: Client, targetId: string) {
  const mafia = this.state.players.get(mafiaClient.sessionId);
  const target = this.state.players.get(targetId);
  if (!mafia || !target) return;
  if (mafia.role !== "mafia" && mafia.role !== "don") return;  // server-only check
  target.isAlive = false;
  // ... game logic
}
```

No extra plumbing is required — the server reads `player.role` directly. The encoder filters per-client at the bytes-out stage via `Encoder.encodeView(view, sharedOffset, it)` (see `Room.ts` `_serializer.applyPatches(clients, state)`).

## 5. GAME_OVER reveal

It is a **runtime flip**, not a schema swap:

```typescript
// In MafiaRoom, when phase becomes ENDED
function revealAllRoles() {
  for (const player of this.state.players.values()) {
    for (const client of this.clients) {
      client.view?.add(player, OWNER_VIEW_TAG);
    }
  }
}
```

No new `class`, no migration, no client-side restart. The same `Player` instance keeps the same `role` field; only the per-view membership changes. The next `broadcastPatch()` automatically emits the `role` field bytes to every client because every view now carries tag bit `1`.

## 6. Recommendation (visibility decorator vs client.send vs onAuth)

| Approach | When to use | Trade-offs |
|---|---|---|
| **`@view(tag)` + `client.view.add(player, tag)`** | Default for game state the server wants to flip mid-game (e.g. role reveal at GAME_OVER). Single source of truth in the schema. | Requires every client to have the same `Player` instance — already true for `MapSchema<Player>`. Reveal is a per-view flip. |
| **`client.send("private", { role })`** at role assignment | One-shot, never-changing secret (e.g. initial role assignment). | Doesn't survive a reconnect cleanly (must re-send). Doesn't help if any other field depends on it. |
| **`onAuth` returning `{ role }`** | Not applicable for in-game role assignment — `onAuth` runs before roles are distributed (they depend on seat count, host status). | Bypasses schema sync entirely (good for password hashes, JWT claims). |

**Recommended primary mechanism**: `@view(1)` on `role` and `team`, plus `client.view.add(player, 1)` on the owning client after role assignment and on every client at GAME_OVER.

**Optional secondary mechanism**: also `client.send("yourRole", { role })` immediately after assignment so the client UI can show "You are: Mafia" before the first state patch (cosmetic UX, not security).

## 7. Inferences

- **The project will work on either 4.0.31 or 5.0.33 at runtime** — the `@view` decorator + `client.view.add(...)` pattern is unchanged between the two. The version skew is cosmetic for this ticket but is a real risk for the project going forward.
- **`onAuth` returning `{ role }` is not a workable primary solution** for mafia because roles are assigned *after* join (host triggers start, then roles are distributed by seat). The current `onAuth` returns only `{ name }`, which is exactly the right shape — extending it to include role would be wrong.
- **`client.send()` for the role reveal is a complement, not a substitute** — it does not survive reconnects without re-sending, and it doesn't address any other server-only fields (e.g. real `team`, `deathNight`, `lastDoctorHealTargetId`).
- **No schema swap at GAME_OVER is needed** — confirmed by the `view.addTag` and `view.add(player, tag)` runtime APIs in `StateView.d.ts:106,111`. The encoder rebuilds the per-client patch on the next tick.

## 8. Risks

- **Version skew (HIGH)**: `package.json` says `^4.0.0` (lockfile `4.0.31`), but `node_modules/@colyseus/schema` is `5.0.33`. The next `npm install` will either downgrade (if lockfile is honoured) or upgrade the source code. Decide intentionally and re-run install. The ticket's research is valid for both, but a `worker` implementing the change must check `node_modules` is what it expects.
- **Tag bit allocation convention**: I used `1` as `OWNER_VIEW_TAG`. If the project later adds other per-client filters (e.g. mafia-chat, sheriff-target), they will collide if they reuse `1`. Reserve a comment / constant block at the top of `schema/PlayerState.ts` listing the tag bits and their meaning.
- **Reconnection**: `client.view` is **transplanted** from the previous client to the new one inside `allowReconnection` (see `Room.ts` reconnection block: `newClient.view = previousClient.view`). This is fine for the "owner" pattern because the new client still owns the same `sessionId` — but if `player.sessionId` is reassigned (e.g. seat swap), the tag must be re-added.
- **`schema()` field-builder style (5.x)**: if the project ever migrates from decorators to the new builder style, `@view(1)` becomes `t.string().view(1)`. The semantics are the same.
- **Documentation drift**: the older Colyseus doc URL `docs.colyseus.io/colyseus/state/visibility/` (referenced in the ticket's question) returns 404 — Colyseus docs were migrated. Cite the GitHub README + `Transport.ts` instead.

## 9. Source URLs

- @colyseus/schema 4.x README (field decorators + StateView): https://github.com/colyseus/schema/blob/4.0.31/README.md
- @colyseus/schema 4.x exports (no `visibility` symbol): https://raw.githubusercontent.com/colyseus/schema/4.0.31/src/index.ts
- @colyseus/schema 5.x README (per-client visibility, `t.string().view()` + `view.add`): https://github.com/colyseus/schema/blob/5.0.33/README.md#stateview--view
- @colyseus/schema 5.x `view()` source (`DEFAULT_VIEW_TAG = -1`): https://raw.githubusercontent.com/colyseus/schema/5.0.33/src/annotations.ts
- Colyseus 0.17 server-side Client interface (`.view`, `.send`, `.auth`): https://raw.githubusercontent.com/colyseus/colyseus/0.17/packages/core/src/Transport.ts
- Colyseus 0.17 Room (`onAuth` → `client.auth`, `_serializer.applyPatches(clients, state)` per-view encoding): https://raw.githubusercontent.com/colyseus/colyseus/0.17/packages/core/src/Room.ts