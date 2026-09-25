import { renderSoundBank } from "./sound-bank.ts"

// Rendering the bank takes ~0.5 s of CPU; here it runs off the main thread and the samples move back without a copy.
addEventListener("message", (event: MessageEvent<unknown>) => {
  const sampleRate = event.data
  if (typeof sampleRate !== "number" || !(sampleRate > 0)) throw new Error(`sound bank worker got no sample rate: ${String(sampleRate)}`)
  const bank = renderSoundBank(sampleRate)
  const transfer = [...Object.values(bank.oneShots).flat(), ...Object.values(bank.loops), ...bank.reverb].map((samples) => samples.buffer)
  postMessage(bank, { transfer })
})
