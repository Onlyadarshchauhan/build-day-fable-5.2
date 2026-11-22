// Authoritative game state. Clients send intents; the server validates and
// sends each player a personalised view (co-op roles see different information).
import {
  rng, generateSigilSequence, generateHazards, generateAlignment, clueText,
  GRID, START, GOAL, isHazard,
} from './puzzles.js';

const STABILITY = 5;
const DUEL_ROUND_MS = 90_000;
const DUEL_COUNTDOWN_MS = 3_500;
const SIGIL_REVEAL_MS = 6_000;
const HAZARD_REVEAL_MS = 4_500;
const MISSION_KINDS = ['sigil', 'crossing', 'alignment'];

export class GameError extends Error {}

export function createGame({ world, mode, playerIds, emit, timers }) {
  const seed = `${world.id}:${Date.now()}:${Math.random()}`;
  const g = {
    mode, world, playerIds: playerIds.slice(), seed, emit, timers,
    status: 'active', stage: 0, startedAt: Date.now(),
  };
  if (mode === 'coop') {
    g.stability = STABILITY;
    g.roles = { [playerIds[0]]: 0, [playerIds[1]]: 1 };
    g.continueVotes = new Set();
    g.stats = { mistakes: 0, startedAt: Date.now() };
    g.mission = buildCoopMission(g, 0);
  } else {
    g.scores = Object.fromEntries(playerIds.map((id) => [id, { total: 0, rounds: [] }]));
    startDuelRound(g, 0);
  }
  return g;
}

// ------------------------------------------------------------- CO-OP
function buildCoopMission(g, stage, salt = '') {
  const r = rng(`${g.seed}:coop:${stage}:${salt}`);
  const kind = MISSION_KINDS[stage];
  const base = { kind, stage, startedAt: Date.now(), attempts: 0 };
  if (kind === 'sigil') {
    return { ...base, sequence: generateSigilSequence(r), keypad: r.shuffle([0, 1, 2, 3, 4, 5]), input: [], lastResult: null };
  }
  if (kind === 'crossing') {
    return { ...base, hazards: generateHazards(r), pos: { ...START }, trail: [{ ...START }], revealed: [] };
  }
  const { solution, clues } = generateAlignment(r, 5, { split: true });
  return { ...base, solution, clues, slots: [null, null, null, null, null], lastResult: null };
}

function coopRoleFor(g, pid) { return g.roles[pid]; }

function damage(g, text) {
  g.stability -= 1;
  g.stats.mistakes += 1;
  if (g.stability <= 0) {
    g.status = 'failed';
    g.emit.system(`${g.world.missions[g.stage].failure} Stability lost.`, 'danger');
  } else if (text) {
    g.emit.system(text, 'warn');
  }
}

function coopAction(g, pid, a) {
  if (a.kind === 'continue') {
    if (g.status !== 'mission_complete') throw new GameError('Nothing to continue yet.');
    g.continueVotes.add(pid);
    if (g.continueVotes.size >= g.playerIds.length) {
      g.continueVotes.clear();
      g.stage += 1;
      g.status = 'active';
      g.mission = buildCoopMission(g, g.stage);
      g.emit.system(`${g.world.locations[g.stage].name} unlocked. Mission ${g.stage + 1}: ${g.world.missions[g.stage].title}.`, 'discovery');
    }
    return;
  }
  if (a.kind === 'retry') {
    if (g.status !== 'failed') throw new GameError('The mission is not failed.');
    g.stability = 3;
    g.status = 'active';
    g.mission = buildCoopMission(g, g.stage, `retry${Date.now()}`);
    g.emit.system('The world re-forms around you. Stability partially restored.', 'info');
    return;
  }
  if (g.status !== 'active') throw new GameError('The mission is not active.');
  const m = g.mission;
  const role = coopRoleFor(g, pid);
  const name = g.emit.nameOf(pid);

  if (m.kind === 'sigil') {
    if (role !== 1) throw new GameError('Only the one who can touch the lock may enter sigils. Describe what you see instead.');
    if (a.kind === 'sigil_press') {
      const s = Number(a.sigil);
      if (!Number.isInteger(s) || s < 0 || s > 5) throw new GameError('Unknown sigil.');
      if (m.input.length >= m.sequence.length) throw new GameError('The lock is full. Submit or clear it.');
      m.input.push(s);
    } else if (a.kind === 'sigil_undo') {
      m.input.pop();
    } else if (a.kind === 'sigil_clear') {
      m.input = [];
    } else if (a.kind === 'sigil_submit') {
      if (m.input.length !== m.sequence.length) throw new GameError(`Enter all ${m.sequence.length} sigils first.`);
      m.attempts += 1;
      const correct = m.input.filter((s, i) => s === m.sequence[i]).length;
      if (correct === m.sequence.length) return coopMissionSuccess(g);
      m.lastResult = { correct, total: m.sequence.length, at: Date.now() };
      m.input = [];
      damage(g, `${name} tried the lock: ${correct} of ${m.sequence.length} sigils resonated.`);
    } else throw new GameError('Invalid action.');
    return;
  }

  if (m.kind === 'crossing') {
    if (role !== 0) throw new GameError('You are the guide here — your partner does the walking.');
    if (a.kind !== 'move') throw new GameError('Invalid action.');
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[a.dir];
    if (!d) throw new GameError('Invalid direction.');
    const x = m.pos.x + d[0], y = m.pos.y + d[1];
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) throw new GameError('The edge of the world. You cannot go further that way.');
    if (isHazard(m.hazards, x, y)) {
      const k = y * GRID + x;
      if (!m.revealed.includes(k)) m.revealed.push(k);
      m.pos = { ...START };
      m.trail = [{ ...START }];
      m.lastHit = { x, y, at: Date.now() };
      damage(g, `${name} stumbled into ${g.world.crossingHazard.toLowerCase()} and was thrown back to the start.`);
      return;
    }
    m.pos = { x, y };
    m.trail.push({ x, y });
    if (x === GOAL.x && y === GOAL.y) coopMissionSuccess(g);
    return;
  }

  if (m.kind === 'alignment') {
    if (a.kind === 'place') {
      const slot = Number(a.slot), relic = a.relic === null ? null : Number(a.relic);
      if (!Number.isInteger(slot) || slot < 0 || slot > 4) throw new GameError('Invalid pedestal.');
      if (relic !== null && (!Number.isInteger(relic) || relic < 0 || relic > 4)) throw new GameError('Invalid relic.');
      if (relic !== null) {
        const prev = m.slots.indexOf(relic);
        if (prev >= 0) m.slots[prev] = m.slots[slot]; // swap
      }
      m.slots[slot] = relic;
    } else if (a.kind === 'align') {
      if (m.slots.some((s) => s === null)) throw new GameError('Every pedestal needs a relic first.');
      m.attempts += 1;
      const correct = m.slots.filter((s, i) => s === m.solution[i]).length;
      if (correct === 5) return coopMissionSuccess(g);
      m.lastResult = { correct, total: 5, at: Date.now() };
      damage(g, `${name} attempted the alignment: ${correct} of 5 relics hum in place.`);
    } else throw new GameError('Invalid action.');
  }
}

function coopMissionSuccess(g) {
  const mission = g.world.missions[g.stage];
  g.emit.system(`Mission completed: ${mission.title}. ${mission.success}`, 'success');
  if (g.stage >= 2) {
    g.status = 'complete';
    g.finishedAt = Date.now();
    g.emit.system(`${g.world.name} is restored.`, 'success');
  } else {
    g.status = 'mission_complete';
  }
}

function coopView(g, pid) {
  const role = coopRoleFor(g, pid);
  const m = g.mission;
  const partnerId = g.playerIds.find((id) => id !== pid);
  const v = {
    mode: 'coop', status: g.status, stage: g.stage, stability: g.stability, maxStability: STABILITY,
    myRole: role, partnerRole: role === 0 ? 1 : 0, partnerId,
    continueVotes: [...g.continueVotes],
    mission: { kind: m.kind, attempts: m.attempts, lastResult: m.lastResult || null },
  };
  if (m.kind === 'sigil') {
    v.mission.canSee = role === 0;
    v.mission.canAct = role === 1;
    v.mission.length = m.sequence.length;
    v.mission.inputCount = m.input.length;
    if (role === 0) v.mission.sequence = m.sequence;
    if (role === 1) { v.mission.keypad = m.keypad; v.mission.input = m.input; }
  } else if (m.kind === 'crossing') {
    v.mission.canSee = role === 1;
    v.mission.canAct = role === 0;
    v.mission.grid = GRID; v.mission.start = START; v.mission.goal = GOAL;
    v.mission.pos = m.pos; v.mission.trail = m.trail; v.mission.revealed = m.revealed;
    v.mission.lastHit = m.lastHit || null;
    if (role === 1) v.mission.hazards = m.hazards;
  } else {
    v.mission.slots = m.slots;
    v.mission.clues = m.clues[role].map((c) => clueText(c, g.world.relics));
    v.mission.partnerClueCount = m.clues[role === 0 ? 1 : 0].length;
  }
  if (g.status === 'complete') {
    v.summary = { durationMs: g.finishedAt - g.stats.startedAt, mistakes: g.stats.mistakes, stability: g.stability };
  }
  return v;
}

// ------------------------------------------------------------- DUEL
function startDuelRound(g, round) {
  const r = rng(`${g.seed}:duel:${round}`);
  const kind = MISSION_KINDS[round];
  const now = Date.now();
  const shared = { kind };
  if (kind === 'sigil') { shared.sequence = generateSigilSequence(r); shared.keypad = r.shuffle([0, 1, 2, 3, 4, 5]); }
  if (kind === 'crossing') shared.hazards = generateHazards(r, 0.3);
  if (kind === 'alignment') { const a = generateAlignment(r, 5, { split: false }); shared.solution = a.solution; shared.clues = a.clues[0]; }
  g.round = {
    index: round, ...shared,
    startsAt: now + DUEL_COUNTDOWN_MS,
    endsAt: now + DUEL_COUNTDOWN_MS + DUEL_ROUND_MS,
    revealUntil: now + DUEL_COUNTDOWN_MS + (kind === 'sigil' ? SIGIL_REVEAL_MS : kind === 'crossing' ? HAZARD_REVEAL_MS : 0),
    players: Object.fromEntries(g.playerIds.map((id) => [id, {
      input: [], pos: { ...START }, best: 0, revealed: [], slots: [null, null, null, null, null],
      penalty: 0, mistakes: 0, finishedAt: null, points: 0, lastResult: null,
    }])),
  };
  g.status = 'countdown';
  g.continueVotes = new Set();
  g.timers.set('countdown', DUEL_COUNTDOWN_MS, () => { g.status = 'active'; g.emit.update(); });
  if (g.round.revealUntil > g.round.startsAt) {
    g.timers.set('reveal', g.round.revealUntil - now, () => g.emit.update());
  }
  g.timers.set('round', g.round.endsAt - now, () => endDuelRound(g, 'time'));
}

function duelFinish(g, pid) {
  const rd = g.round, p = rd.players[pid];
  p.finishedAt = Date.now();
  const elapsed = p.finishedAt - rd.startsAt;
  const speed = Math.max(0, Math.round(100 * (1 - elapsed / DUEL_ROUND_MS)));
  p.points = Math.max(0, 100 + speed - p.penalty);
  const others = g.playerIds.filter((id) => id !== pid);
  const first = others.every((id) => !rd.players[id].finishedAt);
  if (first) { p.points += 25; p.firstBonus = true; }
  g.emit.system(`${g.emit.nameOf(pid)} completed ${g.world.missions[rd.index].title} in ${(elapsed / 1000).toFixed(1)}s${first ? ' — first to finish' : ''}.`, 'success');
  if (g.playerIds.every((id) => rd.players[id].finishedAt)) endDuelRound(g, 'all');
}

function endDuelRound(g, reason) {
  if (g.status === 'round_end' || g.status === 'complete') return;
  g.timers.clear('round'); g.timers.clear('reveal'); g.timers.clear('countdown');
  const rd = g.round;
  for (const id of g.playerIds) {
    const p = rd.players[id];
    if (!p.finishedAt) p.points = 0;
    g.scores[id].rounds.push({ points: p.points, mistakes: p.mistakes, timeMs: p.finishedAt ? p.finishedAt - rd.startsAt : null });
    g.scores[id].total += p.points;
  }
  if (reason === 'time') g.emit.system('Time is up for this round.', 'warn');
  if (rd.index >= 2) {
    g.status = 'complete';
    const [a, b] = g.playerIds;
    const sa = g.scores[a].total, sb = g.scores[b].total;
    g.winner = sa === sb ? null : sa > sb ? a : b;
    g.emit.system(g.winner ? `${g.emit.nameOf(g.winner)} wins the duel, ${Math.max(sa, sb)} to ${Math.min(sa, sb)}.` : `The duel ends in a perfect tie at ${sa}.`, 'success');
  } else {
    g.status = 'round_end';
    g.timers.set('next', 12_000, () => advanceDuel(g));
  }
  g.emit.update();
}

function advanceDuel(g) {
  if (g.status !== 'round_end') return;
  g.timers.clear('next');
  startDuelRound(g, g.round.index + 1);
  g.emit.system(`Round ${g.round.index + 1}: ${g.world.missions[g.round.index].title} at ${g.world.locations[g.round.index].name}.`, 'discovery');
  g.emit.update();
}

function duelAction(g, pid, a) {
  if (a.kind === 'continue') {
    if (g.status !== 'round_end') throw new GameError('Nothing to continue.');
    g.continueVotes.add(pid);
    if (g.continueVotes.size >= g.playerIds.length) advanceDuel(g);
    return;
  }
  if (g.status !== 'active') throw new GameError(g.status === 'countdown' ? 'Wait for the countdown.' : 'The round is not active.');
  const rd = g.round, p = rd.players[pid];
  if (p.finishedAt) throw new GameError('You already finished this round.');
  const now = Date.now();

  if (rd.kind === 'sigil') {
    if (now < rd.revealUntil) throw new GameError('Memorise the sequence first.');
    if (a.kind === 'sigil_press') {
      const s = Number(a.sigil);
      if (!Number.isInteger(s) || s < 0 || s > 5) throw new GameError('Unknown sigil.');
      if (p.input.length >= rd.sequence.length) throw new GameError('Full — submit or clear.');
      p.input.push(s);
    } else if (a.kind === 'sigil_undo') p.input.pop();
    else if (a.kind === 'sigil_clear') p.input = [];
    else if (a.kind === 'sigil_submit') {
      if (p.input.length !== rd.sequence.length) throw new GameError(`Enter all ${rd.sequence.length} sigils.`);
      const correct = p.input.filter((s, i) => s === rd.sequence[i]).length;
      if (correct === rd.sequence.length) return duelFinish(g, pid);
      p.penalty += 10; p.mistakes += 1; p.input = [];
      p.lastResult = { correct, total: rd.sequence.length, at: now };
    } else throw new GameError('Invalid action.');
    return;
  }
  if (rd.kind === 'crossing') {
    if (now < rd.revealUntil) throw new GameError('Memorise the hazards first.');
    if (a.kind !== 'move') throw new GameError('Invalid action.');
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[a.dir];
    if (!d) throw new GameError('Invalid direction.');
    const x = p.pos.x + d[0], y = p.pos.y + d[1];
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) throw new GameError('Edge of the world.');
    if (isHazard(rd.hazards, x, y)) {
      const k = y * GRID + x;
      if (!p.revealed.includes(k)) p.revealed.push(k);
      p.pos = { ...START }; p.penalty += 10; p.mistakes += 1;
      p.lastHit = { x, y, at: now };
      return;
    }
    p.pos = { x, y };
    const progress = (x - START.x) + (START.y - y);
    p.best = Math.max(p.best, progress);
    if (x === GOAL.x && y === GOAL.y) duelFinish(g, pid);
    return;
  }
  if (rd.kind === 'alignment') {
    if (a.kind === 'place') {
      const slot = Number(a.slot), relic = a.relic === null ? null : Number(a.relic);
      if (!Number.isInteger(slot) || slot < 0 || slot > 4) throw new GameError('Invalid pedestal.');
      if (relic !== null && (!Number.isInteger(relic) || relic < 0 || relic > 4)) throw new GameError('Invalid relic.');
      if (relic !== null) { const prev = p.slots.indexOf(relic); if (prev >= 0) p.slots[prev] = p.slots[slot]; }
      p.slots[slot] = relic;
    } else if (a.kind === 'align') {
      if (p.slots.some((s) => s === null)) throw new GameError('Fill every pedestal first.');
      const correct = p.slots.filter((s, i) => s === rd.solution[i]).length;
      if (correct === 5) return duelFinish(g, pid);
      p.penalty += 15; p.mistakes += 1;
      p.lastResult = { correct, total: 5, at: now };
    } else throw new GameError('Invalid action.');
  }
}

function duelProgress(rd, p) {
  if (p.finishedAt) return 1;
  if (rd.kind === 'sigil') return p.input.length / rd.sequence.length * 0.9;
  if (rd.kind === 'crossing') return p.best / ((GOAL.x - START.x) + (START.y - GOAL.y)) * 0.95;
  return p.slots.filter((s) => s !== null).length / 5 * 0.8;
}

function duelView(g, pid) {
  const rd = g.round, me = rd.players[pid];
  const now = Date.now();
  const revealing = g.status === 'active' && now < rd.revealUntil;
  const v = {
    mode: 'duel', status: g.status, round: rd.index, kind: rd.kind,
    startsAt: rd.startsAt, endsAt: rd.endsAt, revealUntil: rd.revealUntil, serverNow: now,
    continueVotes: [...g.continueVotes],
    scores: g.scores,
    players: Object.fromEntries(g.playerIds.map((id) => {
      const p = rd.players[id];
      return [id, { progress: duelProgress(rd, p), finished: Boolean(p.finishedAt), mistakes: p.mistakes, points: p.finishedAt || g.status !== 'active' ? p.points : null, timeMs: p.finishedAt ? p.finishedAt - rd.startsAt : null, firstBonus: Boolean(p.firstBonus) }];
    })),
    me: { finished: Boolean(me.finishedAt), lastResult: me.lastResult, penalty: me.penalty },
  };
  if (rd.kind === 'sigil') {
    v.me.length = rd.sequence.length; v.me.keypad = rd.keypad; v.me.input = me.input;
    if (revealing || g.status === 'round_end' || g.status === 'complete') v.me.sequence = rd.sequence;
  } else if (rd.kind === 'crossing') {
    Object.assign(v.me, { grid: GRID, start: START, goal: GOAL, pos: me.pos, revealed: me.revealed, lastHit: me.lastHit || null });
    if (revealing || g.status === 'round_end' || g.status === 'complete') v.me.hazards = rd.hazards;
  } else {
    v.me.slots = me.slots;
    v.me.clues = rd.clues.map((c) => clueText(c, g.world.relics));
  }
  if (g.status === 'complete') v.winner = g.winner;
  return v;
}

// ------------------------------------------------------------- API
export function applyAction(g, pid, action) {
  if (!g.playerIds.includes(pid)) throw new GameError('You are spectating this game.');
  if (!action || typeof action.kind !== 'string') throw new GameError('Invalid action.');
  if (g.mode === 'coop') coopAction(g, pid, action);
  else duelAction(g, pid, action);
}

export function viewFor(g, pid) {
  if (!g.playerIds.includes(pid)) return null;
  return g.mode === 'coop' ? coopView(g, pid) : duelView(g, pid);
}
