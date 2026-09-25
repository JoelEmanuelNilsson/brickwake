# Audio

Type: task
Status: resolved
Blocked by: 06

## Question

WebAudio-synthesized sound, no asset files: cannon boom with distance and ripple,
fuse sizzle, splash, hull crack, splinters, ocean and wind ambience, creaking hull,
positional panning, volume setting. Must sound heavy and real, not beeps.
Spec: Client (Audio), Player experience.

## Done when

- Every event in the spec's feedback list has a sound; a sound test page plays each.
- No audio allocation spikes during a broadside (measured).


## Answer

Built `src/client/audio/` (`bun run shot:audio` all checks pass; `bun test src` 93 pass; typecheck green; `bun run shot c2`, `c3` pass).
- `game-audio.ts` `GameAudio` (on `game.audio`): no AudioContext until `start()` in the play click (autoplay); a worker (`sound-bank-worker.ts`) renders
  the whole bank at load at 48 kHz (~0.6 s off the main thread; re-rendered at the device rate if it differs). 64 pooled voices (gain → air-absorption
  low-pass → equal-power panner + 0.3 unpanned share → reverb send); a play allocates one AudioBufferSourceNode; when full, the voice with the least sound
  left is faded out in 5 ms if quieter than the new sound, else the new one is dropped. Master → glue compressor → limiter (−3 dB) → soft clip (max 0.98).
  Distance: gain level/(1+d/reach), cutoff 16 kHz/(1+d/60), delay d/343 s, reverb send rises with d; booms past ~70–260 m switch to the rolling distant take.
- Sounds (`sound-recipes.ts`, pure, seeded, several takes each; `sound-bank.ts`): near/distant cannon boom, splash (sized by ball speed), hull crack +
  brick/splinter clatter, own-hull thud, near-miss whistle (Doppler, timed to the closest pass), fuse, hull creak (Poisson, rate from roll/pitch/rudder),
  sinking groan (breach), plunge, ship's bell (2 strikes at battle start, 4 at end). Ambience beds (12 s seamless loops, stereo by half-loop offset):
  sea, wind (level + low-pass follow wind), rigging (wind² × sail), hull wash (speed), canvas (sail × wind); retargeted at 10 Hz with 0.4 s glides.
- Wiring: `Gunnery` fired → `cannon(x,y,z, renderTime − firedAt)` (exact 50 ms ripple), flying → `ballFlying` (others' balls), ended → `splash`/`hullHit`;
  `SinkingShips` breach → `sinking`, plunge → `plunge`; `Game` frame → `audio.update(dt, camera, ownPose, windSpeed, phase)`. Debug hook `audio()` → stats.
- Sound test page: `bun run dev`, open `/sound.html` — a button per event, distance/bearing/volume, "At sea" ambience with wind/sail/speed/roll, 25 s battle, meter.
- Measured (`.shots/audio-report.json`, offline renders through the real mixer): near boom 82 % energy < 150 Hz, centroid ~360–440 Hz; at 300 m onset
  0.992 s (0.975 expected), centroid 210–250 Hz, peak −15 dB; 30 m left −12.5 dB right channel; whistle loudest within 60 ms of the pass; ambience
  calm −30 dB → gale −22 dB RMS. 12-ship battle (492 guns, 470 landings, 25 s): peak 0.88, 0 % samples > 0.95, RMS −15.8 dB; offline render 7× realtime.
  Worst frame (12 broadsides = 144 guns, then 144 landings): 0.9 ms main thread, 0 AudioBuffers, 100 source nodes, ~8–10 KB JS heap in total.
- For 19: `game.audio.volume` (0–1, persisted as `brickwake.volume`) and `ambienceVolume` are the settings; no menu slider yet. For 15: new debris or
  sinking moments call `game.audio.hullHit/sinking/plunge(x,y,z)`; own-hull hits add the thud via `hullHit(…, true)`.
- Also fixed: `Gunnery.fire()` now re-reads the reticle state at once; c2's "reload right after firing" check raced a frame and failed whenever an
  AudioContext was running (headless frame timing), even without this ticket's sounds.
- Known gaps: no Doppler on moving sources other than the whistle; creak/wash are the own ship only; audio-thread cost (~14 % of a core offline) unmeasured on a
  real device; mix judged by numbers only — Joel's ears decide levels in 19 (`mix` table in `game-audio.ts`).
