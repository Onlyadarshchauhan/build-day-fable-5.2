// Deterministic puzzle construction. The AI writes the flavour (names, lore);
// the server builds the mechanics so every puzzle is provably solvable.

export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0);
}

export function rng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
  };
}

// ---------- Mission 1: Sigil Lock ----------
export function generateSigilSequence(r, glyphCount = 6, length = 5) {
  const seq = [];
  while (seq.length < length) {
    const g = r.int(glyphCount);
    if (seq.filter((x) => x === g).length >= 2) continue;
    if (seq.length && seq[seq.length - 1] === g) continue;
    seq.push(g);
  }
  return seq;
}

// ---------- Mission 2: Hazard Crossing ----------
export const GRID = 7;
export const START = { x: 0, y: GRID - 1 };
export const GOAL = { x: GRID - 1, y: 0 };

function shortestPath(hazards) {
  const key = (x, y) => y * GRID + x;
  const dist = new Map([[key(START.x, START.y), 0]]);
  const q = [START];
  while (q.length) {
    const c = q.shift();
    const d = dist.get(key(c.x, c.y));
    if (c.x === GOAL.x && c.y === GOAL.y) return d;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
      const k = key(x, y);
      if (hazards.has(k) || dist.has(k)) continue;
      dist.set(k, d + 1);
      q.push({ x, y });
    }
  }
  return -1;
}

export function generateHazards(r, density = 0.34) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const hazards = new Set();
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if ((x === START.x && y === START.y) || (x === GOAL.x && y === GOAL.y)) continue;
        if (r.next() < density) hazards.add(y * GRID + x);
      }
    }
    const len = shortestPath(hazards);
    // Require a path that is not a straight run along the edge.
    if (len >= 14) return [...hazards];
  }
  return [];
}

export function isHazard(hazards, x, y) {
  return hazards.includes(y * GRID + x);
}

// ---------- Mission 3: Relic Alignment (logic deduction) ----------
function permutations(n) {
  const out = [];
  const rec = (cur, used) => {
    if (cur.length === n) return out.push(cur.slice());
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true; cur.push(i);
      rec(cur, used);
      cur.pop(); used[i] = false;
    }
  };
  rec([], []);
  return out;
}

// perm[slot] = relic
function posOf(perm) {
  const p = [];
  perm.forEach((relic, slot) => { p[relic] = slot; });
  return p;
}

export function clueHolds(clue, perm) {
  const p = posOf(perm);
  const n = perm.length;
  switch (clue.type) {
    case 'at': return p[clue.a] === clue.p;
    case 'notAt': return p[clue.a] !== clue.p;
    case 'leftOf': return p[clue.b] === p[clue.a] + 1;
    case 'before': return p[clue.a] < p[clue.b] - 1;
    case 'apart': return Math.abs(p[clue.a] - p[clue.b]) > 1;
    case 'end': return p[clue.a] === 0 || p[clue.a] === n - 1;
    default: return false;
  }
}

function candidates(clues, perms) {
  return perms.filter((perm) => clues.every((c) => clueHolds(c, perm)));
}

function allTrueClues(solution) {
  const n = solution.length;
  const p = posOf(solution);
  const clues = [];
  for (let a = 0; a < n; a++) {
    clues.push({ type: 'at', a, p: p[a] });
    for (let s = 0; s < n; s++) if (s !== p[a]) clues.push({ type: 'notAt', a, p: s });
    if (p[a] === 0 || p[a] === n - 1) clues.push({ type: 'end', a });
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      if (p[b] === p[a] + 1) clues.push({ type: 'leftOf', a, b });
      if (p[a] < p[b] && p[b] !== p[a] + 1) clues.push({ type: 'before', a, b });
      if (a < b && Math.abs(p[a] - p[b]) > 1) clues.push({ type: 'apart', a, b });
    }
  }
  return clues;
}

const CLUE_WEIGHT = { leftOf: 3, before: 3, apart: 2, end: 2, notAt: 2, at: 1 };

export function generateAlignment(r, n = 5, { split = true } = {}) {
  const perms = permutations(n);
  for (let attempt = 0; attempt < 400; attempt++) {
    const solution = r.shuffle([...Array(n).keys()]);
    // Weighted shuffle so relational clues dominate.
    const pool = r.shuffle(allTrueClues(solution))
      .map((c) => ({ c, k: r.next() * CLUE_WEIGHT[c.type] }))
      .sort((x, y) => y.k - x.k)
      .map((x) => x.c);
    const chosen = [];
    let remaining = perms;
    let ats = 0;
    for (const clue of pool) {
      if (clue.type === 'at' && ats >= 1) continue;
      const next = remaining.filter((perm) => clueHolds(clue, perm));
      if (next.length < remaining.length) {
        chosen.push(clue);
        if (clue.type === 'at') ats++;
        remaining = next;
        if (remaining.length === 1) break;
      }
    }
    if (remaining.length !== 1 || chosen.length < 4 || chosen.length > 8) continue;
    // Prune redundant clues.
    for (let i = chosen.length - 1; i >= 0; i--) {
      const without = chosen.filter((_, j) => j !== i);
      if (candidates(without, perms).length === 1) chosen.splice(i, 1);
    }
    if (chosen.length < 4) continue;
    if (!split) return { solution, clues: [chosen] };
    const order = r.shuffle(chosen);
    const A = order.filter((_, i) => i % 2 === 0);
    const B = order.filter((_, i) => i % 2 === 1);
    // Each half alone must be insufficient — cooperation is required.
    if (candidates(A, perms).length > 1 && candidates(B, perms).length > 1) {
      return { solution, clues: [A, B] };
    }
  }
  throw new Error('Could not construct alignment puzzle');
}

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

export function clueText(clue, names) {
  const A = names[clue.a], B = names[clue.b];
  switch (clue.type) {
    case 'at': return `${A} rests on the ${ORDINAL[clue.p]} pedestal.`;
    case 'notAt': return `${A} does not belong on the ${ORDINAL[clue.p]} pedestal.`;
    case 'leftOf': return `${A} sits immediately to the left of ${B}.`;
    case 'before': return `${A} is somewhere left of ${B}, but not beside it.`;
    case 'apart': return `${A} and ${B} must not be neighbours.`;
    case 'end': return `${A} stands at one of the two ends.`;
    default: return '';
  }
}
