# Brick damage in the sim and network

Type: task
Status: open
Blocked by: 12, 13

## Question

Build C6's damage half: the removed-brick set in sim state (from the 12 rules, hit
point in ship-local space), reset on respawn, sent in the join snapshot; clients
derive the detached set from the same graph and render it. Hull hits, upper works and
sail holes differ as the spec says. Decide whether below-waterline holes (listing,
flooding) fit now; record the call. Spec: Damage, Damage structure.

## Done when

- A late-joiner Playwright test sees the same damaged ships.
- Sim tests: same hits → same removed set; per-hit cost within the tick budget.

