// node shared/test/bench.mjs  - JSON vs binary for the README table (4 players, 30 Hz).
import {
  createWorld, addShip, stepWorld, binaryCodec, jsonCodec, decodeMessage, mulberry32, TICK_RATE,
} from '../src/index.ts';

const world = createWorld(99);
for (let i = 0; i < 4; i++) addShip(world);
const rnd = mulberry32(5);
for (let i = 0; i < 300; i++) {
  const inputs = {};
  for (const s of world.ships) inputs[s.id] = { seq: i + 1, thrust: rnd() < 0.7 ? 1 : 0, turn: Math.floor(rnd() * 3) - 1, fire: rnd() < 0.2 ? 1 : 0 };
  stepWorld(world, inputs);
}
const input = { seq: 123456, thrust: 1, turn: -1, fire: 1 };
const N = 20000;

function time(fn) {
  for (let i = 0; i < 2000; i++) fn(); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < N; i++) fn();
  return ((performance.now() - t0) * 1000) / N; // µs per call
}

const rows = [jsonCodec, binaryCodec].map((codec) => {
  const snap = codec.encodeSnapshot(world, 1);
  const inp = codec.encodeInput(input);
  const snapBytes = typeof snap === 'string' ? new TextEncoder().encode(snap).length : snap.byteLength;
  const inBytes = typeof inp === 'string' ? new TextEncoder().encode(inp).length : inp.byteLength;
  const us = time(() => decodeMessage(codec.encodeSnapshot(world, 1)));
  return {
    codec: codec.name,
    entities: `${world.ships.length} ships, ${world.bullets.length} bullets, ${world.asteroids.length} asteroids`,
    snapshotBytes: snapBytes,
    downKBps: +((snapBytes * TICK_RATE) / 1024).toFixed(2),
    inputBytes: inBytes,
    upKBps: +((inBytes * TICK_RATE) / 1024).toFixed(2),
    encodeDecodeUs: +us.toFixed(1),
  };
});
console.table(rows);

