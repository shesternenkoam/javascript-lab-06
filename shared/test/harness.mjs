// In-process network simulator for tests and for the README numbers.
// Virtual clock (1 ms resolution), seeded randomness -> repeatable. Uses the REAL shared sim,
// the REAL codec (so quantization shows up) and the REAL client Predictor/Interpolator.
// The server part mirrors server/match.js (one input per tick, starved ticks skip the ship).

import {
  TICK_MS, createWorld, addShip, stepWorld, sanitizeInput, binaryCodec, jsonCodec, decodeMessage,
  patchSnapshotAck, mulberry32, MAX_PENDING_INPUTS,
} from '../src/index.ts';
import { Predictor } from '../../client/src/net/predictor.ts';

export function runSession({
  seconds = 20, lat = 100, jitter = 0, drop = 0, players = 2, seed = 42,
  predict = true, codec = 'binary',
} = {}) {
  const rnd = mulberry32(seed);
  const world = createWorld(seed);
  const wire = codec === 'json' ? jsonCodec : binaryCodec;
  const clients = [];
  for (let i = 0; i < players; i++) {
    const ship = addShip(world);
    clients.push({
      id: ship.id,
      predictor: Object.assign(new Predictor({ enabled: predict }), { myId: ship.id }),
      queue: [], lastSeq: 0, ack: 0, lastTick: 0,
      nextStep: i * 7, // clients are not phase-aligned with the server
      bot: mulberry32(1000 + i),
      turn: 0,
      corrections: [],
    });
  }
  const packets = []; // { at, to: 'server' | clientIndex, data }
  const send = (to, data) => {
    if (rnd() < drop) return;
    packets.push({ at: now + Math.max(0, lat / 2 + (rnd() - 0.5) * jitter), to, data });
  };
  let now = 0;
  let nextTick = TICK_MS;
  let starved = 0;
  let inBytes = 0, outBytes = 0;

  const total = seconds * 1000;
  for (now = 0; now < total; now++) {
    // deliver due packets
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      if (p.at > now) continue;
      packets.splice(i, 1);
      if (p.to === 'server') {
        const msg = decodeMessage(p.data.bytes);
        const input = sanitizeInput(msg);
        const c = clients[p.data.player.index];
        if (!input || input.seq <= c.lastSeq) continue;
        c.lastSeq = input.seq;
        c.queue.push(input);
        while (c.queue.length > MAX_PENDING_INPUTS) c.queue.shift();
      } else {
        const c = clients[p.to];
        const snap = decodeMessage(p.data);
        if (snap.tick <= c.lastTick) continue;
        c.lastTick = snap.tick;
        c.predictor.onSnapshot(snap);
        c.corrections.push(c.predictor.correction);
      }
    }

    if (now >= nextTick) {
      nextTick += TICK_MS;
      const inputs = {};
      for (const c of clients) {
        const input = c.queue.shift();
        if (input) { inputs[c.id] = input; c.ack = input.seq; } else starved++;
      }
      stepWorld(world, inputs);
      const base = wire.encodeSnapshot(world, 0);
      clients.forEach((c, i) => {
        const data = codec === 'json' ? wire.encodeSnapshot(world, c.ack) : patchSnapshotAck(base, c.ack);
        inBytes += typeof data === 'string' ? data.length : data.byteLength;
        send(i, data);
      });
    }

    clients.forEach((c, i) => {
      if (now < c.nextStep) return;
      c.nextStep += TICK_MS;
      if (c.bot() < 0.05) c.turn = Math.floor(c.bot() * 3) - 1;
      const input = c.predictor.nextInput({ thrust: c.bot() < 0.8 ? 1 : 0, turn: c.turn, fire: c.bot() < 0.15 ? 1 : 0 });
      c.predictor.applyLocal(input);
      const bytes = wire.encodeInput(input);
      outBytes += typeof bytes === 'string' ? bytes.length : bytes.byteLength;
      send('server', { player: { index: i }, bytes });
    });
  }

  const all = clients[0].corrections.slice(5); // skip warm-up
  const sorted = [...all].sort((a, b) => a - b);
  return {
    snapshots: all.length,
    meanCorrection: all.reduce((s, v) => s + v, 0) / (all.length || 1),
    p95Correction: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    maxCorrection: sorted[sorted.length - 1] ?? 0,
    starved,
    downBytesPerSecPerClient: inBytes / players / seconds,
    upBytesPerSecPerClient: outBytes / players / seconds,
  };
}
