const children = [
  Bun.spawn(["bun", "--watch", "src/server/main.ts"], { stdio: ["inherit", "inherit", "inherit"] }),
  Bun.spawn(["bun", "x", "vite"], { stdio: ["inherit", "inherit", "inherit"] }),
]

const stop = (signal: NodeJS.Signals) => {
  for (const child of children) if (child.exitCode === null) child.kill(signal)
  setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL")
  }, 5000).unref()
}

// Ctrl-C reaches the children through the terminal's process group; forwarding also covers a signal sent to this process alone.
process.on("SIGINT", () => stop("SIGINT"))
process.on("SIGTERM", () => stop("SIGTERM"))

const firstExitCode = await Promise.race(children.map((child) => child.exited))
stop("SIGTERM")
await Promise.all(children.map((child) => child.exited))
process.exit(firstExitCode)
