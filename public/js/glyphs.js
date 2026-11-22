// Hand-drawn sigil shapes. Each world maps its 6 sigils (and 5 relics) onto a
// deterministic subset of these, so both players always see identical shapes.
const SHAPES = [
  '<circle cx="20" cy="20" r="13"/><circle cx="20" cy="20" r="3" class="fill"/>',
  '<path d="M20 6 L34 32 H6 Z"/><path d="M12 24 H28"/>',
  '<path d="M26 6 A14 14 0 1 0 26 34 A10 14 0 1 1 26 6 Z"/>',
  '<path d="M20 5 L35 20 L20 35 L5 20 Z"/><path d="M20 12 V28 M12 20 H28"/>',
  '<path d="M20 20 m-3 0 a3 3 0 1 1 6 0 a7 7 0 1 1 -14 0 a11 11 0 1 1 22 0 a15 15 0 1 1 -30 0"/>',
  '<path d="M5 12 q5 -5 10 0 t10 0 t10 0 M5 20 q5 -5 10 0 t10 0 t10 0 M5 28 q5 -5 10 0 t10 0 t10 0"/>',
  '<path d="M20 4 L24 16 L36 20 L24 24 L20 36 L16 24 L4 20 L16 16 Z"/>',
  '<path d="M4 20 Q20 4 36 20 Q20 36 4 20 Z"/><circle cx="20" cy="20" r="5" class="fill"/>',
  '<path d="M9 6 H31 L20 20 L31 34 H9 L20 20 Z"/>',
  '<path d="M20 36 V8 M10 8 V16 Q10 22 20 22 Q30 22 30 16 V8"/>',
  '<rect x="9" y="9" width="22" height="22" transform="rotate(45 20 20)"/><circle cx="20" cy="20" r="6"/>',
  '<path d="M23 4 L10 22 H20 L16 36 L31 16 H21 Z"/>',
];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function seededOrder(seed) {
  const idx = SHAPES.map((_, i) => i);
  let a = hash(seed);
  for (let i = idx.length - 1; i > 0; i--) {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    const j = a % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

export function sigilSvg(worldId, index, cls = '') {
  const shape = SHAPES[seededOrder(worldId)[index]];
  return `<svg viewBox="0 0 40 40" class="sigil ${cls}" aria-hidden="true">${shape}</svg>`;
}

export function relicSvg(worldId, index, cls = '') {
  const shape = SHAPES[seededOrder(worldId)[6 + index]];
  return `<svg viewBox="0 0 40 40" class="sigil relic-icon ${cls}" aria-hidden="true">${shape}</svg>`;
}
