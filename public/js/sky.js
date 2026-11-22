// Ambient observatory sky: slow-drifting stars and luminous motes on a canvas.
export function startSky(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w, h, dpr, stars = [], motes = [];
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.width = innerWidth * dpr; h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    const n = Math.round((innerWidth * innerHeight) / 5200);
    stars = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.1 + 0.2) * dpr, p: Math.random() * 6.28, s: 0.3 + Math.random() * 1.2 }));
    motes = Array.from({ length: 22 }, () => ({ x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 2 + 1) * dpr, vx: (Math.random() - 0.5) * 0.08 * dpr, vy: -(0.05 + Math.random() * 0.12) * dpr, p: Math.random() * 6.28 }));
  }
  resize();
  addEventListener('resize', resize);
  let t = 0;
  function frame() {
    t += 0.016;
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = 0.35 + 0.45 * Math.sin(t * s.s + s.p);
      ctx.fillStyle = `rgba(239,228,200,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
    }
    for (const m of motes) {
      m.x += m.vx; m.y += m.vy;
      if (m.y < -10) { m.y = h + 10; m.x = Math.random() * w; }
      const a = 0.25 + 0.25 * Math.sin(t * 0.8 + m.p);
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 5);
      g.addColorStop(0, `rgba(159,227,196,${a})`); g.addColorStop(1, 'rgba(159,227,196,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 5, 0, 6.283); ctx.fill();
    }
    if (!reduce && !document.hidden) requestAnimationFrame(frame);
    else if (!reduce) setTimeout(() => requestAnimationFrame(frame), 500);
  }
  frame();
}
