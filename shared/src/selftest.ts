import { createWorld, addShip, stepWorld, hashWorld } from './sim.ts';
import { mulberry32 } from './rng.ts';
import { asSeq, type BinaryFlag, type TurnDirection } from './types.ts';

const toTurn = (val: number): TurnDirection => (val === -1 ? -1 : val === 1 ? 1 : 0);
const toBin = (val: boolean): BinaryFlag => (val ? 1 : 0);

export function simSelfTest(steps: number = 1000, seed: number = 12345): number {
  const world = createWorld(seed);
  const a = addShip(world).id;
  const b = addShip(world).id;
  const script = mulberry32(777);
  for (let i = 0; i < steps; i++) {
    const r1 = script();
    const r2 = script();
    stepWorld(world, {
      [a]: {
        seq: asSeq(i + 1),
        thrust: toBin(r1 < 0.6),
        turn: toTurn((Math.floor(r1 * 3 * 1000) % 3) - 1),
        fire: toBin(r2 < 0.2),
      },
      [b]: {
        seq: asSeq(i + 1),
        thrust: toBin(r2 < 0.5),
        turn: toTurn((Math.floor(r2 * 3 * 1000) % 3) - 1),
        fire: toBin(r1 < 0.2),
      },
    });
  }
  return hashWorld(world);
}

