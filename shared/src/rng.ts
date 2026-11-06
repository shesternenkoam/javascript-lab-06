export function mulberry32Mix(state: number): number {
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    return mulberry32Mix(state);
  };
}

export function rand(world: { rng: number }): number {
  world.rng = (world.rng + 0x6d2b79f5) >>> 0;
  return mulberry32Mix(world.rng);
}

