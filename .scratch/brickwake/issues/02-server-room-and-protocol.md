# Server: room, tick loop and protocol

Type: task
Status: open
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

