// Procedural world illustration: layered SVG landscapes driven by the
// AI-chosen palette, terrain, celestial body and particle type.

function rng(seedStr) {
  let a = 0;
  for (let i = 0; i < seedStr.length; i++) a = (Math.imul(a, 31) + seedStr.charCodeAt(i)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(c1, c2, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1), b = p(c2);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const W = 1200, H = 640;

function ridge(r, baseY, amp, step, jag) {
  let d = `M0 ${H} L0 ${baseY}`;
  for (let x = 0; x <= W + step; x += step) {
    const y = baseY - r() * amp * (jag ? 1 : 0.6) - Math.sin(x / 180 + r()) * amp * 0.3;
    d += jag ? ` L${x} ${y.toFixed(1)}` : ` Q${x - step / 2} ${(y - amp * 0.4).toFixed(1)} ${x} ${y.toFixed(1)}`;
  }
  return d + ` L${W} ${H} Z`;
}

function terrainLayer(kind, r, depth, color) {
  const baseY = 360 + depth * 85;
  const amp = 140 - depth * 30;
  let out = '';
  switch (kind) {
    case 'mountains':
      out = `<path d="${ridge(r, baseY, amp * 1.4, 70 + depth * 20, true)}" fill="${color}"/>`;
      break;
    case 'dunes':
      out = `<path d="${ridge(r, baseY, amp * 0.6, 220, false)}" fill="${color}"/>`;
      break;
    case 'waves': {
      let d = `M0 ${H} L0 ${baseY}`;
      const f = 0.008 + depth * 0.004, ph = r() * 6;
      for (let x = 0; x <= W; x += 10) d += ` L${x} ${(baseY - Math.sin(x * f + ph) * amp * 0.35 - Math.sin(x * f * 2.3 + ph) * amp * 0.15).toFixed(1)}`;
      out = `<path d="${d} L${W} ${H} Z" fill="${color}"/>`;
      break;
    }
    case 'spires': {
      out = `<path d="${ridge(r, baseY + 30, amp * 0.3, 160, false)}" fill="${color}"/>`;
      const n = 7 - depth * 2;
      for (let i = 0; i < n; i++) {
        const x = r() * W, w = 14 + r() * 26 - depth * 4, h = 120 + r() * 220 - depth * 50;
        out += `<path d="M${x - w} ${baseY + 40} L${x - w * 0.6} ${baseY - h * 0.7} L${x} ${baseY - h} L${x + w * 0.6} ${baseY - h * 0.7} L${x + w} ${baseY + 40} Z" fill="${color}"/>`;
        out += `<circle cx="${x}" cy="${baseY - h * 0.75}" r="${2.5 - depth * 0.5}" class="window" />`;
      }
      break;
    }
    case 'forest': {
      out = `<path d="${ridge(r, baseY + 20, amp * 0.5, 200, false)}" fill="${color}"/>`;
      const n = 34 - depth * 8;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * W + r() * 30, h = 50 + r() * 70 - depth * 10, w = h * 0.32;
        const y = baseY + 10 - Math.sin(x / 200) * 20;
        out += `<path d="M${x} ${y - h} L${x + w} ${y} L${x - w} ${y} Z" fill="${color}"/>`;
      }
      break;
    }
    case 'crystals': {
      out = `<path d="${ridge(r, baseY + 30, amp * 0.4, 120, true)}" fill="${color}"/>`;
      const n = 12 - depth * 3;
      for (let i = 0; i < n; i++) {
        const x = r() * W, h = 60 + r() * 140 - depth * 20, w = 12 + r() * 18, tilt = (r() - 0.5) * 30;
        out += `<path d="M${x - w} ${baseY + 40} L${x + tilt - w * 0.3} ${baseY - h} L${x + tilt + w * 0.3} ${baseY - h - 18} L${x + w} ${baseY + 40} Z" fill="${color}" class="crystal"/>`;
      }
      break;
    }
    case 'islands': {
      if (depth === 2) {
        out = `<rect x="0" y="${baseY + 20}" width="${W}" height="${H}" fill="${color}"/>`;
        for (let i = 0; i < 20; i++) out += `<path d="M${r() * W} ${baseY + 40 + r() * 80} h${30 + r() * 80}" class="glint"/>`;
      } else {
        const n = 3 - depth;
        for (let i = 0; i < n; i++) {
          const x = 150 + r() * (W - 300), y = 260 + depth * 90 + r() * 40, w = 90 + r() * 120 - depth * 30;
          out += `<path d="M${x - w} ${y} Q${x} ${y - 70 - r() * 50} ${x + w} ${y} Q${x + w * 0.4} ${y + 90} ${x} ${y + 120} Q${x - w * 0.4} ${y + 90} ${x - w} ${y} Z" fill="${color}"/>`;
          out += `<path d="M${x - w * 0.3} ${y - 30} q${w * 0.15} -30 ${w * 0.3} 0" fill="none" stroke="${color}" stroke-width="10"/>`;
        }
      }
      break;
    }
    default:
      out = `<path d="${ridge(r, baseY, amp, 120, false)}" fill="${color}"/>`;
  }
  return out;
}

function celestialSvg(kind, a, r, u) {
  const cx = 820 + r() * 200, cy = 130 + r() * 50;
  switch (kind) {
    case 'moon':
      return `<circle cx="${cx}" cy="${cy}" r="120" fill="url(#halo-${u})"/><circle cx="${cx}" cy="${cy}" r="46" fill="${mix(a.glow, '#ffffff', 0.5)}"/><circle cx="${cx - 14}" cy="${cy - 8}" r="9" fill="${mix(a.glow, a.skyTop, 0.25)}" opacity=".5"/><circle cx="${cx + 16}" cy="${cy + 14}" r="6" fill="${mix(a.glow, a.skyTop, 0.25)}" opacity=".5"/>`;
    case 'rings':
      return `<circle cx="${cx}" cy="${cy}" r="140" fill="url(#halo-${u})"/><circle cx="${cx}" cy="${cy}" r="44" fill="${mix(a.accent, a.skyTop, 0.2)}"/><ellipse cx="${cx}" cy="${cy}" rx="96" ry="18" fill="none" stroke="${a.glow}" stroke-width="3" opacity=".75" transform="rotate(-14 ${cx} ${cy})"/><ellipse cx="${cx}" cy="${cy}" rx="78" ry="13" fill="none" stroke="${a.accent}" stroke-width="1.5" opacity=".7" transform="rotate(-14 ${cx} ${cy})"/>`;
    case 'twin-suns':
      return `<circle cx="${cx}" cy="${cy}" r="150" fill="url(#halo-${u})"/><circle cx="${cx - 40}" cy="${cy + 10}" r="34" fill="${mix(a.accent, '#fff2c8', 0.4)}"/><circle cx="${cx + 42}" cy="${cy - 20}" r="20" fill="${mix(a.glow, '#ffffff', 0.4)}"/>`;
    case 'aurora': {
      let s = '';
      for (let i = 0; i < 3; i++) {
        const y = 90 + i * 40;
        s += `<path d="M-50 ${y} C 250 ${y - 80}, 450 ${y + 90}, 700 ${y} S 1100 ${y - 70}, 1300 ${y + 20}" fill="none" stroke="url(#aurora-${u})" stroke-width="${36 - i * 8}" opacity="${0.35 - i * 0.07}" class="aurora-band"/>`;
      }
      return s;
    }
    case 'eclipse':
      return `<circle cx="${cx}" cy="${cy}" r="150" fill="url(#halo-${u})"/><circle cx="${cx}" cy="${cy}" r="52" fill="none" stroke="${a.glow}" stroke-width="5" opacity=".9" filter="url(#blur-${u})"/><circle cx="${cx}" cy="${cy}" r="49" fill="${a.skyTop}"/>`;
    default: return '';
  }
}

let artCounter = 0;
export function worldArt(world, { beacons = true, particles = true, cls = '' } = {}) {
  const u = `${world.id}-${++artCounter}`;
  const a = world.atmosphere;
  const r = rng(world.id + world.name);
  let stars = '';
  for (let i = 0; i < 90; i++) {
    stars += `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * 340).toFixed(0)}" r="${(r() * 1.4 + 0.3).toFixed(2)}" class="star" style="animation-delay:${(r() * 6).toFixed(2)}s"/>`;
  }
  const layers = [0, 1, 2].map((d) => terrainLayer(a.terrain, r, d, mix(a.skyBottom, a.ground, 0.35 + d * 0.32))).join('');
  let pins = '';
  if (beacons) {
    const xs = [230, 600, 960];
    xs.forEach((x, i) => {
      const y = 430 + (i % 2 ? -40 : 10) + r() * 20;
      pins += `<g class="beacon" style="animation-delay:${i * 0.4}s"><circle cx="${x}" cy="${y}" r="34" fill="url(#beacon-${u})"/><circle cx="${x}" cy="${y}" r="5" fill="${a.glow}"/><text x="${x}" y="${y - 18}" text-anchor="middle">${['I', 'II', 'III'][i]}</text></g>`;
    });
  }
  let motes = '';
  if (particles) {
    for (let i = 0; i < 26; i++) {
      motes += `<circle cx="${(r() * W).toFixed(0)}" cy="${(250 + r() * 380).toFixed(0)}" r="${(1 + r() * 2.5).toFixed(1)}" class="mote mote-${a.particles}" style="animation-delay:-${(r() * 12).toFixed(1)}s;animation-duration:${(9 + r() * 9).toFixed(1)}s"/>`;
    }
  }
  return `<svg class="world-art ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration of ${world.name.replace(/"/g, '')}" style="--glow:${a.glow};--accent:${a.accent}">
    <defs>
      <linearGradient id="sky-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a.skyTop}"/><stop offset="1" stop-color="${a.skyBottom}"/></linearGradient>
      <radialGradient id="halo-${u}"><stop offset="0" stop-color="${a.glow}" stop-opacity=".45"/><stop offset="1" stop-color="${a.glow}" stop-opacity="0"/></radialGradient>
      <radialGradient id="beacon-${u}"><stop offset="0" stop-color="${a.glow}" stop-opacity=".7"/><stop offset="1" stop-color="${a.glow}" stop-opacity="0"/></radialGradient>
      <linearGradient id="aurora-${u}" x1="0" x2="1"><stop offset="0" stop-color="${a.glow}"/><stop offset=".5" stop-color="${a.accent}"/><stop offset="1" stop-color="${a.glow}"/></linearGradient>
      <linearGradient id="mist-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a.ground}" stop-opacity="0"/><stop offset="1" stop-color="${a.ground}" stop-opacity=".95"/></linearGradient>
      <filter id="blur-${u}"><feGaussianBlur stdDeviation="4"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky-${u})"/>
    <g class="stars">${stars}</g>
    ${celestialSvg(a.celestial, a, r, u)}
    ${layers}
    ${pins}
    <rect y="${H - 200}" width="${W}" height="200" fill="url(#mist-${u})"/>
    <g class="motes">${motes}</g>
  </svg>`;
}
