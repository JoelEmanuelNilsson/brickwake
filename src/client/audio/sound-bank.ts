import {
  synthBell,
  synthCannonBoom,
  synthCreak,
  synthDistantBoom,
  synthFuse,
  synthHullCrack,
  synthHullThud,
  synthHullWashLoop,
  synthOceanLoop,
  synthOpenSeaReverb,
  synthPlunge,
  synthRiggingLoop,
  synthSailLoop,
  synthSinkingGroan,
  synthSplash,
  synthSplinters,
  synthWhistle,
  synthWindLoop,
} from "./sound-recipes.ts"

/** Every one-shot sound, each with a few takes so repeats never sound identical. */
export interface OneShotSounds {
  readonly cannonBoom: ReadonlyArray<Float32Array>
  readonly distantBoom: ReadonlyArray<Float32Array>
  readonly splash: ReadonlyArray<Float32Array>
  readonly hullCrack: ReadonlyArray<Float32Array>
  readonly splinters: ReadonlyArray<Float32Array>
  readonly hullThud: ReadonlyArray<Float32Array>
  readonly whistle: ReadonlyArray<Float32Array>
  readonly creak: ReadonlyArray<Float32Array>
  readonly sinkingGroan: ReadonlyArray<Float32Array>
  readonly plunge: ReadonlyArray<Float32Array>
  readonly fuse: ReadonlyArray<Float32Array>
  readonly bell: ReadonlyArray<Float32Array>
}

/** Names of the one-shot sounds in a `SoundBank`. */
export type OneShotName = keyof OneShotSounds

/** Seamless mono ambience loops; each plays as two offset sources for a wide stereo bed. */
export interface AmbienceLoops {
  readonly ocean: Float32Array
  readonly wind: Float32Array
  readonly rigging: Float32Array
  readonly hullWash: Float32Array
  readonly sails: Float32Array
}

/** Names of the ambience loops in a `SoundBank`. */
export type AmbienceLoopName = keyof AmbienceLoops

/** All game sound, rendered once at load from code (no asset files) as raw samples at `sampleRate`. */
export interface SoundBank {
  readonly sampleRate: number
  readonly oneShots: OneShotSounds
  readonly loops: AmbienceLoops
  /** Left and right impulse responses of the open-sea reverb. */
  readonly reverb: readonly [Float32Array, Float32Array]
}

const takes = (count: number, seed: number, synth: (sampleRate: number, seed: number) => Float32Array, sampleRate: number) =>
  Array.from({ length: count }, (_, i) => synth(sampleRate, seed + i * 7919))

/** Synthesizes the whole sound bank at `sampleRate`: about 20 MB of samples, a few hundred ms of CPU. */
export const renderSoundBank = (sampleRate: number): SoundBank => ({
  sampleRate,
  oneShots: {
    cannonBoom: takes(4, 11, synthCannonBoom, sampleRate),
    distantBoom: takes(3, 23, synthDistantBoom, sampleRate),
    splash: takes(4, 37, synthSplash, sampleRate),
    hullCrack: takes(4, 41, synthHullCrack, sampleRate),
    splinters: takes(3, 53, synthSplinters, sampleRate),
    hullThud: takes(2, 67, synthHullThud, sampleRate),
    whistle: takes(2, 71, synthWhistle, sampleRate),
    creak: takes(6, 83, synthCreak, sampleRate),
    sinkingGroan: takes(2, 97, synthSinkingGroan, sampleRate),
    plunge: takes(2, 101, synthPlunge, sampleRate),
    fuse: takes(2, 113, synthFuse, sampleRate),
    bell: takes(1, 127, synthBell, sampleRate),
  },
  loops: {
    ocean: synthOceanLoop(sampleRate, 131),
    wind: synthWindLoop(sampleRate, 137),
    rigging: synthRiggingLoop(sampleRate, 139),
    hullWash: synthHullWashLoop(sampleRate, 149),
    sails: synthSailLoop(sampleRate, 151),
  },
  reverb: synthOpenSeaReverb(sampleRate, 157),
})
