# Brickwake

A browser multiplayer naval combat game with brick-built ships, in the spirit of
Blackwake. Free-for-all and team deathmatch, bots included. Built with Three.js,
Effect and Bun.

## Run

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev        # game server + Vite dev server
```

Open the URL Vite prints. `lab.html` is the ship lab; `sound.html` is the audio test page.

## Develop

```sh
bun test           # unit and simulation tests
bun run typecheck
bun run shot       # Playwright screenshots into .shots/ (bunx playwright install chromium first)
```

Design and architecture: [docs/game-design.md](docs/game-design.md).

## License

MIT. LEGO is a trademark of the LEGO Group, which does not sponsor or endorse this project.
