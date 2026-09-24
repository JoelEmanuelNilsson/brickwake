# Server: room, tick loop and protocol

Type: task
Status: resolved
Blocked by: 01

## Question

Build C1's network half: Effect Schema messages in `src/protocol/` (join/leave,
setHelm, setSail, snapshot, events with ticks), a Bun + Effect v4 WebSocket room
running `stepMatch` at 30 Hz with an accumulator, quick-play join, full snapshots each
tick, and the latency/jitter injection flag. Spec: Networking, Server.

## Done when

- Server tests over real WebSocket clients: join, receive snapshots at 30 Hz, helm and
  sail inputs change the ship, invalid messages are rejected without harm.
- `bun dev` starts and stops cleanly.


## Answer

Built the authoritative room server and the wire protocol (`bun test src` 45 pass incl. 6 real-WebSocket server tests; typecheck green).
- Entry points: `src/protocol/messages.ts` (`ClientMessage`, `ServerMessage`, `ServerEvent`, `ShipSnapshot` as `Schema.TaggedUnion`s;
  `ClientMessageJson`/`ServerMessageJson` = JSON text frames; `shipSnapshot`, `windSnapshot`); `src/server/rooms.ts` (Rooms service:
  quick play, per-room 30 Hz accumulator loop, `Seat`); `src/server/server.ts` (`/ws` connection: decode, reject, seat lifecycle);
  `src/server/lag.ts` (order-preserving latency/jitter link); sim: `removeShip`, `spawnPoint`, `tuning.match` (`match.ts`, `tuning.ts`).
- Wire (all `_tag`-discriminated JSON text): client → `join {mode:"ffa", scenario?}`, `leave`, `setHelm {rudder:-1|0|1}`, `setSail {level:0|1|2}`.
  Server → `welcome {shipId, simHz, tick, sea, wind, ships}` once per join; `snapshot {tick, wind{toward,speed}, ships, events}` every tick;
  `rejected {reason}` for any bad or out-of-state message (connection stays open). Events: `shipJoined`/`shipLeft {tick, shipId}`.
- Ship on the wire: `position [x,y,z]` mm, `orientation [x,y,z,w]` 1e-5, `velocity` cm/s, `rudder`, `sail`, `rudderAngle`, `sailSet`; axes as `ShipState`.
- Measured: 30.00 Hz snapshots, consecutive ticks, no gaps; 181 B per ship, so 12 ships ≈ 65 KB/s per client (over the spec's ~45 KB/s
  estimate; Bun `perMessageDeflate` is the one-line fix if it ever matters). `bun dev` stops in 70 ms on Ctrl-C with a client connected
  (exit 130 = SIGINT), no listeners left; through the Vite proxy with 50 ms lag the welcome arrives in ~120 ms.
- Facts for later tickets:
  - 03: connect to `/ws`, send `join`, decode every frame with `ServerMessageJson`; build the ocean from `welcome.sea` (plain `SeaState`).
    `join {scenario:"beam-sea"}` gives a private room seeded from `scenarios`, ship id `player`, tick 0 — use it for Playwright.
    Snapshot `tick` is the sim tick after stepping; sim time = `tick / simHz`. Events carry the tick they happened at (≤ the snapshot's).
  - Latency flag: `NET_LATENCY_MS` (one-way, each direction) and `NET_JITTER_MS` env vars on the server (`bun dev` passes them through).
  - 04/05: add `fireBroadside` to `ClientMessage`, `cannonFired`/hits/splashes to `ServerEvent`, and map `stepMatch`'s events into
    `room.events` in `stepRoom` (rooms.ts drops them today because `MatchEvent` is `never`). Removed-brick sets go on `ShipSnapshot`
    or `welcome` only (join snapshot) plus events.
  - 06/07: rooms close when their last member leaves; bots will need a room to stay open while it holds only bots or be removed with it.
    Quick play fills a room to `tuning.match.maxShips` (12), spawns on a 260 m ring in the free slot farthest from others, bow across the wind.
- Known gaps: no rate limit on client messages (each is O(1)); frames over 16 KiB close the connection (Bun `maxPayloadLength`);
  disposing the server while sockets are open reports an interrupt exit (platform behaviour, also at C0; tests tolerate interrupt-only exits).
