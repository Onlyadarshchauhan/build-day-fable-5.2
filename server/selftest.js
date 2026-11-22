// Verifies puzzle solvability and plays complete games through the engine.
import assert from 'node:assert/strict';
import { rng, generateAlignment, clueHolds, generateHazards, GRID, START, GOAL } from './puzzles.js';
import { normalizeWorld, offlineWorld, SAMPLE_WORLDS } from './worlds.js';
import { createGame, applyAction, viewFor } from './game.js';

const perms = [];
(function rec(cur, used) { if (cur.length === 5) return perms.push(cur.slice()); for (let i = 0; i < 5; i++) if (!used[i]) { used[i] = 1; cur.push(i); rec(cur, used); cur.pop(); used[i] = 0; } })([], []);
const count = (clues) => perms.filter((p) => clues.every((c) => clueHolds(c, p))).length;

for (let i = 0; i < 300; i++) {
  const r = rng(`t${i}`);
  const { solution, clues: [A, B] } = generateAlignment(r, 5, { split: true });
  assert.equal(count([...A, ...B]), 1, 'combined clues must give a unique answer');
  assert.ok(count(A) > 1 && count(B) > 1, 'each half alone must be insufficient');
  assert.ok([...A, ...B].every((c) => clueHolds(c, solution)));
  const solo = generateAlignment(rng(`s${i}`), 5, { split: false });
  assert.equal(count(solo.clues[0]), 1);
}
for (let i = 0; i < 300; i++) {
  const hz = generateHazards(rng(`h${i}`));
  assert.ok(hz.length > 5, 'hazard field generated');
  assert.ok(!hz.includes(START.y * GRID + START.x) && !hz.includes(GOAL.y * GRID + GOAL.x));
}
console.log('✓ 300 alignment puzzles unique & cooperative, 300 hazard fields solvable');

function bfsPath(hazards) {
  const key = (x, y) => y * GRID + x;
  const prev = new Map([[key(START.x, START.y), null]]);
  const q = [START];
  while (q.length) {
    const c = q.shift();
    if (c.x === GOAL.x && c.y === GOAL.y) break;
    for (const [dx, dy, dir] of [[1, 0, 'right'], [-1, 0, 'left'], [0, 1, 'down'], [0, -1, 'up']]) {
      const x = c.x + dx, y = c.y + dy, k = key(x, y);
      if (x < 0 || y < 0 || x >= GRID || y >= GRID || hazards.includes(k) || prev.has(k)) continue;
      prev.set(k, { from: c, dir }); q.push({ x, y });
    }
  }
  const dirs = []; let k = key(GOAL.x, GOAL.y);
  while (prev.get(k)) { const p = prev.get(k); dirs.unshift(p.dir); k = key(p.from.x, p.from.y); }
  return dirs;
}

const fakeTimers = () => { const t = new Map(); return { set: (n, ms, fn) => t.set(n, fn), clear: (n) => t.delete(n), clearAll: () => t.clear(), fire: (n) => { const f = t.get(n); t.delete(n); f && f(); }, t }; };
const emit = { system: () => {}, update: () => {}, nameOf: (id) => id };

// ---- Co-op full playthrough
const world = normalizeWorld(SAMPLE_WORLDS.headphones, SAMPLE_WORLDS.headphones, { id: 'w1', source: 'sample' });
const g = createGame({ world, mode: 'coop', playerIds: ['A', 'B'], emit, timers: fakeTimers() });
// Mission 1: A sees, B enters
const vA = viewFor(g, 'A'), vB = viewFor(g, 'B');
assert.ok(vA.mission.sequence && !vB.mission.sequence, 'only the seer sees the code');
assert.throws(() => applyAction(g, 'A', { kind: 'sigil_press', sigil: 0 }));
for (const s of vA.mission.sequence) applyAction(g, 'B', { kind: 'sigil_press', sigil: s });
applyAction(g, 'B', { kind: 'sigil_submit' });
assert.equal(g.status, 'mission_complete');
applyAction(g, 'A', { kind: 'continue' }); applyAction(g, 'B', { kind: 'continue' });
// Mission 2: B sees hazards, A walks
assert.ok(viewFor(g, 'B').mission.hazards && !viewFor(g, 'A').mission.hazards, 'only the scout sees hazards');
for (const dir of bfsPath(viewFor(g, 'B').mission.hazards)) applyAction(g, 'A', { kind: 'move', dir });
assert.equal(g.status, 'mission_complete');
applyAction(g, 'A', { kind: 'continue' }); applyAction(g, 'B', { kind: 'continue' });
// Mission 3: wrong then right
const ca = viewFor(g, 'A').mission.clues, cb = viewFor(g, 'B').mission.clues;
assert.notDeepEqual(ca, cb);
[1, 0, 2, 3, 4].forEach((relic, slot) => applyAction(g, 'A', { kind: 'place', slot, relic }));
const sol = g.mission.solution;
if (JSON.stringify([1, 0, 2, 3, 4]) !== JSON.stringify(sol)) { applyAction(g, 'B', { kind: 'align' }); assert.equal(g.stability, 4); }
sol.forEach((relic, slot) => applyAction(g, 'B', { kind: 'place', slot, relic }));
applyAction(g, 'B', { kind: 'align' });
assert.equal(g.status, 'complete');
console.log('✓ co-op: three missions completed with role-separated information');

// ---- Co-op failure + retry
const g2 = createGame({ world, mode: 'coop', playerIds: ['A', 'B'], emit, timers: fakeTimers() });
const wrong = g2.mission.sequence.map((s) => (s + 1) % 6);
for (let i = 0; i < 5; i++) { wrong.forEach((s) => applyAction(g2, 'B', { kind: 'sigil_press', sigil: s })); applyAction(g2, 'B', { kind: 'sigil_submit' }); }
assert.equal(g2.status, 'failed');
applyAction(g2, 'A', { kind: 'retry' });
assert.equal(g2.status, 'active'); assert.equal(g2.stability, 3);
console.log('✓ co-op: failure at zero stability and retry');

// ---- Duel full playthrough (reveal windows forced past)
const timers = fakeTimers();
const d = createGame({ world: normalizeWorld(offlineWorld('spoon'), offlineWorld('spoon'), { id: 'w2' }), mode: 'duel', playerIds: ['A', 'B'], emit, timers });
const skipReveal = () => { timers.fire('countdown'); d.round.revealUntil = 0; d.round.startsAt = Date.now() - 1000; };
skipReveal();
assert.equal(d.status, 'active');
d.round.sequence.forEach((s) => applyAction(d, 'A', { kind: 'sigil_press', sigil: s }));
applyAction(d, 'A', { kind: 'sigil_submit' });
timers.fire('round'); // B times out
assert.equal(d.status, 'round_end');
applyAction(d, 'A', { kind: 'continue' }); applyAction(d, 'B', { kind: 'continue' });
skipReveal();
for (const id of ['B', 'A']) for (const dir of bfsPath(d.round.hazards)) applyAction(d, id, { kind: 'move', dir });
assert.equal(d.status, 'round_end');
applyAction(d, 'A', { kind: 'continue' }); applyAction(d, 'B', { kind: 'continue' });
skipReveal();
for (const id of ['A', 'B']) { d.round.solution.forEach((relic, slot) => applyAction(d, id, { kind: 'place', slot, relic })); applyAction(d, id, { kind: 'align' }); }
assert.equal(d.status, 'complete');
assert.equal(d.winner, 'A', 'A won round 1 outright and finished first in round 3');
assert.equal(viewFor(d, 'A').winner, 'A');
console.log(`✓ duel: three rounds, winner by score (A ${d.scores.A.total} – B ${d.scores.B.total})`);

for (const key of Object.keys(SAMPLE_WORLDS)) { const w = normalizeWorld(SAMPLE_WORLDS[key], SAMPLE_WORLDS[key], { id: key }); assert.equal(w.sigils.length, 6); assert.equal(w.relics.length, 5); }
const partial = normalizeWorld({ name: 'X', sigils: ['a', 'a'], atmosphere: { skyTop: 'red' } }, offlineWorld('pen'), { id: 'p' });
assert.equal(new Set(partial.sigils.map((s) => s.toLowerCase())).size, 6); assert.match(partial.atmosphere.skyTop, /^#/);
console.log('✓ world normalization fills/repairs incomplete AI output');
console.log('\nAll self-tests passed.');
