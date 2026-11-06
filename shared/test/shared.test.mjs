import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createWorld, addShip, stepWorld, hashWorld, simSelfTest, sanitizeInput, integrate,
  binaryCodec, jsonCodec, decodeMessage, patchSnapshotAck, mulberry32,
  parseClientMessage, parseServerMessage,
} from '../src/index.ts';
import { runSession } from './harness.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('shared/src is pure: no DOM, no Node built-ins, no Math.random / Date.now', () => {
  const forbidden = [/Math\.random/, /Date\.now/, /\bdocument\b/, /\bwindow\b/, /\brequire\(/, /from ['"]node:/, /\bprocess\./, /\bBuffer\b/, /setTimeout|setInterval/, /performance\.now/];
  for (const file of readdirSync(srcDir)) {
    const text = readFileSync(path.join(srcDir, file), 'utf8').replace(/\/\/.*$/gm, '');
    for (const re of forbidden) assert.ok(!re.test(text), `${file} contains ${re}`);
  }
});

test('determinism: same seed + same inputs -> same hash, twice', () => {
  const h1 = simSelfTest(1000, 12345);
  const h2 = simSelfTest(1000, 12345);
  assert.equal(h1, h2);
  assert.notEqual(simSelfTest(1000, 54321), h1); // the seed really matters
  console.log(`      simSelfTest(1000) hash = ${h1}  (run window.simSelfTest() in the browser: must match)`);
});

test('input validation rejects cheats instead of clamping them', () => {
  assert.equal(sanitizeInput({ seq: 1, thrust: 0, turn: 1000, fire: 0 }), null);
  assert.equal(sanitizeInput({ seq: -1, thrust: 0, turn: 0, fire: 0 }), null);
  assert.equal(sanitizeInput({ seq: 1, thrust: 2, turn: 0, fire: 0 }), null);
  assert.deepEqual(sanitizeInput({ seq: 5, thrust: 1, turn: -1, fire: 0 }), { seq: 5, thrust: 1, turn: -1, fire: 0 });
});

test('integrate does not mutate its argument and ignores x/y from inputs', () => {
  const world = createWorld(1);
  const ship = addShip(world);
  const frozen = JSON.stringify(ship);
  const next = integrate(ship, { seq: 1, thrust: 1, turn: 0, fire: 0, x: 99999, y: 99999 });
  assert.equal(JSON.stringify(ship), frozen);
  assert.notEqual(next.x, 99999);
});

function sampleWorld() {
  const world = createWorld(7);
  for (let i = 0; i < 4; i++) addShip(world);
  const rnd = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const inputs = {};
    for (const s of world.ships) inputs[s.id] = { seq: i + 1, thrust: rnd() < 0.7 ? 1 : 0, turn: Math.floor(rnd() * 3) - 1, fire: rnd() < 0.3 ? 1 : 0 };
    stepWorld(world, inputs);
  }
  return world;
}

test('binary input: byte layout is little-endian and versioned', () => {
  const bytes = binaryCodec.encodeInput({ seq: 0x01020304, thrust: 1, turn: -1, fire: 1 });
  assert.deepEqual([...bytes], [1, 1, 0x04, 0x03, 0x02, 0x01, 0b11, 0xff]);
  assert.deepEqual(decodeMessage(bytes), { type: 'input', seq: 0x01020304, thrust: 1, fire: 1, turn: -1 });
});

test('binary snapshot round trip is exact up to float32 / angle quantization', () => {
  const world = sampleWorld();
  const snap = decodeMessage(patchSnapshotAck(binaryCodec.encodeSnapshot(world, 0), 77));
  assert.equal(snap.tick, world.tick);
  assert.equal(snap.ack, 77);
  assert.equal(snap.ships.length, world.ships.length);
  assert.equal(snap.bullets.length, world.bullets.length);
  assert.equal(snap.asteroids.length, world.asteroids.length);
  world.ships.forEach((s, i) => {
    const d = snap.ships[i];
    assert.equal(d.id, s.id);
    for (const k of ['x', 'y', 'vx', 'vy']) assert.ok(Math.abs(d[k] - s[k]) < 1e-3 * Math.max(1, Math.abs(s[k])), k);
    assert.ok(Math.abs(d.angle - s.angle) <= 0.00005 + 1e-9, 'angle within half a quantum');
    for (const k of ['hp', 'cooldown', 'respawn']) assert.equal(d[k], s[k]);
  });
  world.bullets.forEach((b, i) => assert.equal(snap.bullets[i].seq, b.seq));
});

test('json codec round trip', () => {
  const world = sampleWorld();
  const snap = decodeMessage(jsonCodec.encodeSnapshot(world, 5));
  assert.equal(snap.ack, 5);
  assert.deepEqual(snap.ships[0].x, world.ships[0].x);
});

test('broken binary frames throw', () => {
  const good = binaryCodec.encodeSnapshot(sampleWorld(), 0);
  assert.throws(() => decodeMessage(good.slice(0, good.length - 1)));
  assert.throws(() => decodeMessage(new Uint8Array([9, 1, 0, 0, 0, 0, 0, 0])));
  assert.throws(() => decodeMessage(new Uint8Array([1])));
});

test('prediction: perfect network -> corrections stay tiny', () => {
  const r = runSession({ lat: 0, seconds: 20 });
  assert.ok(r.meanCorrection < 0.05, JSON.stringify(r));
});

test('prediction: 100 ms RTT, jitter and drop -> corrections stay small', () => {
  const r = runSession({ lat: 100, jitter: 30, drop: 0.02, seconds: 30 });
  console.log('      ', JSON.stringify(r));
  assert.ok(r.meanCorrection < 3, JSON.stringify(r));
});

test('protocol zod parser: parses valid messages and never throws on corrupt input', () => {
  const validJoin = parseClientMessage(JSON.stringify({ type: 'join', room: 'lobby', name: 'Alice' }));
  assert.equal(validJoin.ok, true);
  if (validJoin.ok) {
    assert.equal(validJoin.value.type, 'join');
  }

  const brokenJson = parseClientMessage('{ invalid json');
  assert.equal(brokenJson.ok, false);

  const invalidPayload = parseClientMessage(JSON.stringify({ type: 'input', turn: 9999 }));
  assert.equal(invalidPayload.ok, false);

  const unknownType = parseClientMessage(JSON.stringify({ type: 'unknown_action' }));
  assert.equal(unknownType.ok, false);
});

