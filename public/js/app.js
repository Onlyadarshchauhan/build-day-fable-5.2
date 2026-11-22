import { Net } from './net.js';
import { Voice } from './voice.js';
import { worldArt } from './art.js';
import { sigilSvg, relicSvg } from './glyphs.js';
import { startSky } from './sky.js';

// ------------------------------------------------------------------ state
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const COLS = 'ABCDEFG';

function getPid() {
  let id = sessionStorage.getItem('tto:pid');
  if (!id) { id = crypto.getRandomValues(new Uint32Array(4)).reduce((s, n) => s + n.toString(36), 'p'); sessionStorage.setItem('tto:pid', id); }
  return id;
}

const S = {
  config: { ai: false, iceServers: [] },
  playerId: getPid(),
  name: localStorage.getItem('tto:name') || '',
  screen: 'landing',
  image: null,
  world: null,       // world being revealed locally
  roomWorld: null,   // world of the current room
  room: null,
  game: null,
  pendingMode: 'coop',
  abort: null,
  clockOffset: 0,
  selectedRelic: null,
  unread: 0,
  mobileTab: 'play',
  urlRoom: new URLSearchParams(location.search).get('room')?.toUpperCase() || null,
};

const net = new Net({ getHello: () => ({ playerId: S.playerId, name: S.name || 'Explorer', room: S.room?.code || S.urlRoom }) });
const voice = new Voice(net, () => S.config.iceServers, () => S.playerId);

// ------------------------------------------------------------------ utils
function show(screen) {
  S.screen = screen;
  $$('.screen').forEach((el) => el.classList.toggle('active', el.dataset.screen === screen));
  document.body.dataset.screen = screen;
  if (screen === 'lobby' || screen === 'game') mountComms(screen);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function toast(msg, tone = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), ms - 400);
  setTimeout(() => el.remove(), ms);
}

function initials(name) { return (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); }
function playerHue(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function avatar(p, extra = '') {
  return `<span class="avatar ${extra}" style="--h:${playerHue(p.id)}">${esc(initials(p.name))}</span>`;
}
function nameOf(id) { return S.room?.players.find((p) => p.id === id)?.name || 'Partner'; }
const fmtTime = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function setBackdrop(world) {
  const el = $('#world-backdrop');
  if (!world) { el.innerHTML = ''; el.classList.remove('on'); return; }
  if (el.dataset.world !== world.id) { el.innerHTML = worldArt(world, { beacons: false }); el.dataset.world = world.id; }
  el.classList.add('on');
}
function act(action) { net.send({ t: 'action', action }); }

// ------------------------------------------------------------------ boot
startSky($('#sky'));
fetch('/api/config').then((r) => r.json()).then((cfg) => {
  S.config = cfg;
  const el = $('#ai-status');
  el.textContent = cfg.ai ? 'AI lens · online' : 'AI lens · offline';
  el.classList.toggle('ok', cfg.ai);
  el.title = cfg.ai ? 'Claude examines your photo and writes a unique world.' : 'No ANTHROPIC_API_KEY on the server. Sample specimens and the name-based Offline Atlas still work.';
  if (!cfg.ai) $('#hint-label').innerHTML = 'Name your object <span class="muted">(required — the AI lens is offline, so it cannot see photos)</span>';
}).catch(() => toast('Could not reach the observatory server.', 'danger'));

net.addEventListener('status', (e) => {
  const el = $('#net-status');
  const map = { online: 'connected', connecting: 'connecting', reconnecting: 'reconnecting…', offline: 'connection lost — retrying', replaced: 'opened in another tab' };
  el.querySelector('span').textContent = map[e.detail] || e.detail;
  el.dataset.state = e.detail;
  if (S.room) renderRoom();
});

// ------------------------------------------------------------------ landing
const SAMPLE_ICONS = {
  headphones: '<path d="M10 30 V24 A14 14 0 0 1 38 24 V30"/><rect x="7" y="28" width="8" height="12" rx="3"/><rect x="33" y="28" width="8" height="12" rx="3"/>',
  teacup: '<path d="M9 18 H35 V26 A10 10 0 0 1 25 36 H19 A10 10 0 0 1 9 26 Z"/><path d="M35 21 H38 A4 4 0 0 1 38 29 H34"/><path d="M6 40 H38"/><path d="M18 8 q2 3 0 6 M24 6 q2 3 0 6"/>',
  key: '<circle cx="14" cy="24" r="8"/><circle cx="14" cy="24" r="3"/><path d="M22 24 H42 M34 24 V30 M39 24 V29"/>',
};
const SAMPLE_LABELS = { headphones: 'Headphones', teacup: 'Teacup', key: 'Brass key' };
$('#sample-row').innerHTML = Object.keys(SAMPLE_ICONS).map((k) => `
  <button class="sample" data-sample="${k}">
    <svg viewBox="0 0 48 48" aria-hidden="true">${SAMPLE_ICONS[k]}</svg>
    <span>${SAMPLE_LABELS[k]}</span>
  </button>`).join('');
$$('.sample').forEach((b) => b.addEventListener('click', () => generate({ sample: b.dataset.sample })));

$('#cta-discover').addEventListener('click', () => {
  $('#tray').classList.add('pulse');
  $('#tray').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('#tray').classList.remove('pulse'), 1400);
});
$('#cta-join').addEventListener('click', () => {
  const f = $('#join-form');
  f.hidden = !f.hidden;
  if (!f.hidden) $('#join-code').focus();
});
$('#join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#join-code').value.trim();
  $('#join-error').textContent = '';
  if (code.length !== 5) { $('#join-error').textContent = 'Room codes have five characters.'; return; }
  await openInvite(code);
});
$('#brand-home').addEventListener('click', () => {
  if (S.room && !confirm('Leave this room and return to the observatory?')) return;
  goHome();
});

function goHome() {
  if (S.room) { net.send({ t: 'leave_room' }); voice.leave(); }
  S.room = null; S.game = null; S.roomWorld = null; S.urlRoom = null;
  history.replaceState(null, '', '/');
  $('#chat-log') && ($('#chat-log').innerHTML = '');
  setBackdrop(null);
  show('landing');
}

// Upload handling
const dz = $('#dropzone');
dz.addEventListener('click', () => $('#file-input').click());
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file-input').click(); } });
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('drag')));
dz.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (S.screen === 'landing' && e.dataTransfer.files?.[0]) loadFile(e.dataTransfer.files[0]); });
document.addEventListener('paste', (e) => {
  if (S.screen !== 'landing') return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) loadFile(f);
});
$('#btn-upload').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f); });
$('#camera-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f); });

async function loadFile(file) {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) return toast('That file is not an image. Try a JPEG or PNG photo.', 'danger');
  if (file.size > 30 * 1024 * 1024) return toast('That image is over 30 MB. Try a smaller photo.', 'danger');
  try {
    S.image = await downscale(file);
    openDiscovery();
  } catch {
    toast('Your browser could not read that image (HEIC photos may need converting to JPEG).', 'danger', 6000);
  }
}

function downscale(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

// Camera
let camStream = null;
$('#btn-camera').addEventListener('click', async () => {
  const mobile = matchMedia('(pointer: coarse)').matches;
  if (mobile || !navigator.mediaDevices?.getUserMedia || !isSecureContext) return $('#camera-input').click();
  $('#camera-error').textContent = '';
  $('#camera-modal').hidden = false;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
    $('#camera-video').srcObject = camStream;
  } catch (err) {
    $('#camera-error').textContent = err.name === 'NotAllowedError' ? 'Camera permission was denied. You can upload a photo instead.' : 'No camera is available. You can upload a photo instead.';
  }
});
function closeCamera() { camStream?.getTracks().forEach((t) => t.stop()); camStream = null; $('#camera-modal').hidden = true; }
$('#camera-close').addEventListener('click', closeCamera);
$('#camera-snap').addEventListener('click', () => {
  const v = $('#camera-video');
  if (!v.videoWidth) return;
  const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = v.videoWidth * scale; c.height = v.videoHeight * scale;
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  S.image = c.toDataURL('image/jpeg', 0.86);
  closeCamera();
  openDiscovery();
});

// ------------------------------------------------------------------ discovery
const STEPS = ['Examining specimen…', 'Detecting hidden patterns…', 'Mapping unknown territories…', 'Discovering inhabitants…', 'Constructing your universe…'];

function openDiscovery() {
  $('#preview-img').src = S.image;
  $('#scan-stage').classList.remove('scanning');
  $('#discover-form').hidden = false;
  $('#discover-progress').hidden = true;
  $('#discover-error').textContent = '';
  $('#offline-row').hidden = true;
  $('#specimen-label').textContent = 'SPECIMEN · UNCLASSIFIED';
  show('discovery');
  if (!S.config.ai) $('#hint-input').focus();
}
$('#btn-retake').addEventListener('click', () => show('landing'));
$('#btn-generate').addEventListener('click', () => generate({ image: S.image, hint: $('#hint-input').value }));
$('#hint-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-generate').click(); });
$('#btn-offline').addEventListener('click', () => {
  const hint = $('#hint-input').value.trim();
  if (!hint) { $('#discover-error').textContent = 'Name your object first, then use the Offline Atlas.'; $('#hint-input').focus(); return; }
  generate({ image: S.image, hint, offline: true });
});
$('#btn-cancel').addEventListener('click', () => { S.abort?.abort(); });

async function generate(body) {
  if (body.sample) {
    S.image = null;
    $('#preview-img').removeAttribute('src');
    show('discovery');
  }
  if (!body.sample && !S.config.ai && !body.hint?.trim()) {
    $('#discover-error').textContent = 'The AI lens is offline on this server, so please name your object.';
    $('#hint-input').focus();
    return;
  }
  $('#scan-stage').classList.add('scanning');
  $('#scan-stage').classList.toggle('no-image', !S.image);
  $('#discover-form').hidden = true;
  $('#discover-progress').hidden = false;
  $('#specimen-label').textContent = body.sample ? `SPECIMEN · ${body.sample.toUpperCase()} · FROM THE COLLECTION` : 'SPECIMEN · UNDER EXAMINATION';
  const stepsEl = $('#progress-steps');
  stepsEl.innerHTML = '';
  let i = 0;
  const advance = () => {
    if (i >= STEPS.length - 1) return;
    $('#progress-msg').textContent = STEPS[i];
    stepsEl.insertAdjacentHTML('beforeend', `<li>${STEPS[i].replace('…', '')}</li>`);
    i++;
  };
  advance();
  const timer = setInterval(advance, body.sample ? 260 : 2600);
  S.abort = new AbortController();
  try {
    const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: S.abort.signal });
    const data = await res.json().catch(() => ({ error: 'The observatory sent back something unreadable.' }));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Generation failed.'), { data, status: res.status });
    clearInterval(timer);
    // Final beat so the reveal feels intentional — never padded beyond a moment.
    $('#progress-msg').textContent = STEPS[STEPS.length - 1];
    stepsEl.insertAdjacentHTML('beforeend', `<li class="done">Universe constructed</li>`);
    $('#specimen-label').textContent = `SPECIMEN · ${data.world.objectName.toUpperCase()}`;
    await new Promise((r) => setTimeout(r, 600));
    S.world = data.world;
    renderReveal();
  } catch (err) {
    clearInterval(timer);
    $('#scan-stage').classList.remove('scanning');
    $('#discover-form').hidden = false;
    $('#discover-progress').hidden = true;
    if (err.name === 'AbortError') { $('#discover-error').textContent = 'Examination cancelled.'; if (!S.image) show('landing'); return; }
    if (!S.image && !body.hint) { show('landing'); toast(err.message, 'danger', 6000); return; }
    $('#discover-error').textContent = err.message;
    $('#offline-row').hidden = !(err.data?.offlineAvailable);
    if (err.data?.code === 'NEED_NAME') $('#hint-input').focus();
  } finally {
    S.abort = null;
  }
}

// ------------------------------------------------------------------ reveal
function renderReveal() {
  const w = S.world;
  setBackdrop(null);
  const sourceNote = { ai: 'Generated by the AI lens from your photo', sample: 'From the observatory\'s specimen collection', offline: 'Offline Atlas — composed from the object\'s name (AI lens not configured)' }[w.source];
  $('#reveal').innerHTML = `
    <div class="reveal-hero">
      ${worldArt(w)}
      <div class="reveal-hero-copy">
        <p class="eyebrow mono reveal-in" style="--d:.1s">Specimen · ${esc(w.objectName)} — universe discovered</p>
        <h1 class="display world-title reveal-in" style="--d:.35s">${esc(w.name)}</h1>
        <p class="lede reveal-in" style="--d:.6s">${esc(w.tagline)}</p>
      </div>
    </div>
    <div class="reveal-body">
      <div class="reveal-col">
        <section class="reveal-in" style="--d:.8s">
          <p class="mono label">Specimen notes</p>
          <p class="observations">${esc(w.observations)}</p>
          <p class="mono source-note">${esc(sourceNote)}</p>
        </section>
        <section class="reveal-in" style="--d:.9s">
          <p class="mono label">The world</p>
          <p class="prose">${esc(w.description)}</p>
          <p class="prose muted-prose"><em>${esc(w.origin)}</em></p>
        </section>
        <section class="reveal-in" style="--d:1s">
          <p class="mono label">Lore fragments</p>
          <ul class="lore">${w.lore.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        </section>
        <section class="reveal-in" style="--d:1.1s">
          <p class="mono label">Inhabitants</p>
          <ul class="inhabitants">${w.inhabitants.map((x) => `<li><strong>${esc(x.name)}</strong> <span class="mono kind">${esc(x.kind)}</span><br/><span>${esc(x.description)}</span></li>`).join('')}</ul>
        </section>
      </div>
      <div class="reveal-col">
        <section class="mission-scroll reveal-in" style="--d:.9s">
          <p class="mono label">Primary objective</p>
          <p class="objective">${esc(w.objective)}</p>
        </section>
        <section class="reveal-in" style="--d:1s">
          <p class="mono label">Charted locations</p>
          <ol class="locations">${w.locations.map((l, i) => `
            <li><span class="loc-num mono">${ROMAN[i]}</span><div><strong>${esc(l.name)}</strong><p>${esc(l.description)}</p><p class="mono hazard">Hazard · ${esc(l.hazard)}</p><p class="mono mission-link">Mission ${i + 1} · ${esc(w.missions[i].title)}</p></div></li>`).join('')}
          </ol>
        </section>
        <section class="reveal-in" style="--d:1.15s">
          <p class="mono label">Laws of this universe</p>
          <ul class="mechanics">${w.mechanics.map((m) => `<li><strong>${esc(m.name)}.</strong> ${esc(m.description)}</li>`).join('')}</ul>
        </section>
      </div>
    </div>
    <div class="reveal-cta reveal-in" style="--d:1.3s">
      <button class="btn btn-brass btn-lg" id="btn-explore">Explore This Universe</button>
      <button class="btn btn-ghost" id="btn-another">Discover another</button>
    </div>`;
  $('#btn-explore').addEventListener('click', renderModeSelect);
  $('#btn-another').addEventListener('click', () => show('landing'));
  show('reveal');
}

// ------------------------------------------------------------------ mode select
function renderModeSelect() {
  const w = S.world;
  setBackdrop(w);
  $('#mode-wrap').innerHTML = `
    <p class="eyebrow mono">${esc(w.name)}</p>
    <h2 class="display-sm">How will you explore it?</h2>
    <div class="mode-cards">
      <button class="mode-card ${S.pendingMode === 'coop' ? 'selected' : ''}" data-mode="coop">
        <p class="mono label">Mode A</p>
        <h3>Co-op Adventure</h3>
        <p>Restore the world together across three connected missions. You'll each perceive different things — talk to survive.</p>
        <div class="roles">
          <div><span class="mono">I</span><strong>${esc(w.roles[0].title)}</strong><small>${esc(w.roles[0].ability)}</small></div>
          <div><span class="mono">II</span><strong>${esc(w.roles[1].title)}</strong><small>${esc(w.roles[1].ability)}</small></div>
        </div>
      </button>
      <button class="mode-card ${S.pendingMode === 'duel' ? 'selected' : ''}" data-mode="duel">
        <p class="mono label">Mode B</p>
        <h3>Duel · ${esc(w.duel.title)}</h3>
        <p>${esc(w.duel.premise)}</p>
        <p class="muted small">Three timed rounds — memory, nerve and logic. Points for speed and accuracy; the score decides the winner.</p>
      </button>
    </div>
    <div class="name-row">
      <label class="mono label" for="name-input">Your explorer name</label>
      <input id="name-input" class="input" maxlength="20" value="${esc(S.name)}" placeholder="e.g. Wren" />
    </div>
    <div class="cta-row">
      <button class="btn btn-brass btn-lg" id="btn-open-room">Open a room & invite a friend</button>
      <button class="btn btn-ghost" id="btn-back-reveal">Back to the world</button>
    </div>`;
  $$('.mode-card').forEach((c) => c.addEventListener('click', () => { S.pendingMode = c.dataset.mode; $$('.mode-card').forEach((x) => x.classList.toggle('selected', x === c)); }));
  $('#btn-back-reveal').addEventListener('click', renderReveal);
  $('#btn-open-room').addEventListener('click', () => {
    if (!saveName($('#name-input'))) return;
    $('#btn-open-room').disabled = true;
    $('#btn-open-room').textContent = 'Opening the observatory doors…';
    net.send({ t: 'create_room', worldId: w.id, mode: S.pendingMode });
    setTimeout(() => { const b = $('#btn-open-room'); if (b && S.screen === 'mode') { b.disabled = false; b.textContent = 'Open a room & invite a friend'; } }, 6000);
  });
  show('mode');
  if (!S.name) $('#name-input').focus();
}

function saveName(input) {
  const v = input.value.trim();
  if (!v) { input.focus(); input.classList.add('invalid'); toast('Choose an explorer name first.', 'warn'); return false; }
  S.name = v.slice(0, 20);
  localStorage.setItem('tto:name', S.name);
  net.send({ t: 'set_name', name: S.name });
  return true;
}

// ------------------------------------------------------------------ invite / join
async function openInvite(code) {
  try {
    const res = await fetch(`/api/room/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (data.full) throw new Error('That room already has two explorers.');
    S.urlRoom = code;
    $('#invite').innerHTML = `
      <p class="eyebrow mono">Invitation · Room ${esc(code)}</p>
      <h2 class="display-sm">You've been invited to<br/><span class="world-title">${esc(data.worldName)}</span></h2>
      <p class="lede">${data.mode === 'coop' ? 'A co-op adventure — you\'ll need each other.' : 'A duel — may the sharper explorer win.'}</p>
      <div class="name-row">
        <label class="mono label" for="invite-name">Your explorer name</label>
        <input id="invite-name" class="input" maxlength="20" value="${esc(S.name)}" placeholder="e.g. Ash" />
      </div>
      <p class="form-error" id="invite-error" role="alert"></p>
      <div class="cta-row">
        <button class="btn btn-brass btn-lg" id="btn-join-room">Enter the observatory</button>
        <button class="btn btn-ghost" id="btn-invite-home">Not now</button>
      </div>`;
    $('#btn-join-room').addEventListener('click', () => {
      if (!saveName($('#invite-name'))) return;
      net.send({ t: 'join_room', code });
    });
    $('#invite-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join-room').click(); });
    $('#btn-invite-home').addEventListener('click', goHome);
    show('invite');
    if (!S.name) $('#invite-name').focus();
  } catch (err) {
    if (S.screen === 'landing') { $('#join-form').hidden = false; $('#join-error').textContent = err.message || 'Could not find that room.'; }
    else { goHome(); toast(err.message || 'Could not find that room.', 'danger', 6000); }
  }
}

// ------------------------------------------------------------------ net events
net.addEventListener('welcome', () => {});
net.addEventListener('joined', (e) => {
  const { code, world, chat } = e.detail;
  S.roomWorld = world;
  S.urlRoom = code;
  history.replaceState(null, '', `/?room=${code}`);
  const log = ensureComms();
  log.innerHTML = '';
  chat.forEach(addChat);
  S.unread = 0; updateUnread();
  setBackdrop(world);
});
net.addEventListener('state', (e) => {
  const prevPhase = S.room?.phase;
  const prevKey = gameKey();
  S.room = e.detail.room;
  S.game = e.detail.game;
  if (S.game?.serverNow) S.clockOffset = S.game.serverNow - Date.now();
  if (gameKey() !== prevKey) S.selectedRelic = null;
  const target = S.room.phase === 'playing' && S.game ? 'game' : 'lobby';
  if (S.screen !== target) show(target);
  if (prevPhase && prevPhase !== S.room.phase && target === 'game') S.mobileTab = 'play';
  renderRoom();
});
net.addEventListener('chat', (e) => addChat(e.detail.msg, true));
net.addEventListener('error', (e) => {
  const { code, message } = e.detail;
  if (S.screen === 'invite' && $('#invite-error')) $('#invite-error').textContent = message;
  else if (S.screen === 'landing') { $('#join-form').hidden = false; $('#join-error').textContent = message; }
  else toast(message, 'danger', 6000);
  if (code === 'NO_WORLD' && S.screen === 'mode') renderModeSelect();
});
net.addEventListener('action_error', (e) => { console.warn('[action]', e.detail.message); toast(e.detail.message, 'warn'); });

function gameKey() {
  if (!S.game) return '';
  return S.game.mode === 'coop' ? `c${S.game.stage}-${S.game.status}` : `d${S.game.round}`;
}

// Initial screen, then deep link: ?room=CODE
show('landing');
if (S.urlRoom) openInvite(S.urlRoom);

// ------------------------------------------------------------------ comms
let commsEl = null;
function ensureComms() {
  if (!commsEl) {
    commsEl = $('#tpl-comms').content.firstElementChild.cloneNode(true);
    $('#chat-form', commsEl).addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chat-input', commsEl);
      const text = input.value.trim();
      if (!text) return;
      net.send({ t: 'chat', text });
      input.value = '';
    });
  }
  return $('#chat-log', commsEl);
}
function mountComms(screen) {
  ensureComms();
  const host = screen === 'lobby' ? $('#comms-lobby') : $('#comms-game');
  if (commsEl.parentElement !== host) host.appendChild(commsEl);
  renderVoice();
}

function addChat(m, live = false) {
  const log = ensureComms();
  const li = document.createElement('li');
  const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (m.kind === 'system') {
    li.className = `msg msg-system tone-${m.tone || 'info'}`;
    li.innerHTML = `<span class="msg-glyph" aria-hidden="true">◆</span><span class="msg-text">${esc(m.text)}</span><time class="mono">${time}</time>`;
  } else {
    const mine = m.from === S.playerId;
    li.className = `msg ${m.kind === 'hint' ? 'msg-hint' : 'msg-player'} ${mine ? 'mine' : ''}`;
    li.innerHTML = `<header><span class="msg-name" style="--h:${playerHue(m.from)}">${esc(m.name)}</span>${m.kind === 'hint' ? '<span class="mono hint-tag">shared clue</span>' : ''}<time class="mono">${time}</time></header><p>${esc(m.text)}</p>`;
  }
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.appendChild(li);
  if (nearBottom || m.from === S.playerId) log.scrollTop = log.scrollHeight;
  if (live && S.screen === 'game' && S.mobileTab !== 'comms' && matchMedia('(max-width: 900px)').matches && m.from !== S.playerId) {
    S.unread++; updateUnread();
  }
}
function updateUnread() {
  const b = $('#unread');
  b.textContent = S.unread;
  b.hidden = S.unread === 0;
}

$$('#mobile-tabs button').forEach((b) => b.addEventListener('click', () => {
  S.mobileTab = b.dataset.tab;
  if (S.mobileTab === 'comms') { S.unread = 0; updateUnread(); }
  applyMobileTab();
}));
function applyMobileTab() {
  $('#screen-game').classList.toggle('show-comms', S.mobileTab === 'comms');
  $$('#mobile-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.mobileTab));
  if (S.mobileTab === 'comms') { const log = $('#chat-log'); if (log) log.scrollTop = log.scrollHeight; }
}

function renderVoice() {
  if (!commsEl) return;
  const el = $('#voice-panel', commsEl);
  const players = S.room?.players || [];
  const me = players.find((p) => p.id === S.playerId);
  const roleTitle = (p) => (p.role !== null && p.role !== undefined && S.roomWorld ? S.roomWorld.roles[p.role]?.title : null);
  const voiceLabel = voice.joining ? 'Opening microphone…' : voice.active ? (voice.muted ? 'In voice · muted' : 'In voice · live') : 'Voice off';
  el.innerHTML = `
    <header class="chat-head mono"><span>Crew & voice</span><span class="voice-state ${voice.active ? 'on' : ''}">${voiceLabel}</span></header>
    <ul class="crew">
      ${players.map((p) => {
        const isMe = p.id === S.playerId;
        const speaking = voice.speaking.has(isMe ? 'me' : p.id);
        const peer = !isMe && voice.active && p.inVoice ? voice.peerState(p.id) : null;
        const vstate = !p.inVoice ? 'not in voice' : p.muted ? 'muted' : isMe ? 'live' : peer === 'connected' ? 'live' : peer ? `linking (${peer})` : voice.active ? 'linking…' : 'in voice';
        return `<li class="${speaking ? 'speaking' : ''}" data-pid="${isMe ? 'me' : esc(p.id)}">
          ${avatar(p, speaking ? 'ring' : '')}
          <div class="crew-meta"><strong>${esc(p.name)}${isMe ? ' <span class="muted">(you)</span>' : ''}${p.id === S.room.hostId ? ' <span class="mono tag">host</span>' : ''}</strong>
            <span class="mono small">${roleTitle(p) ? esc(roleTitle(p)) + ' · ' : ''}<i class="dot ${p.connected ? 'ok' : 'bad'}"></i>${p.connected ? 'connected' : 'disconnected'}</span></div>
          <span class="mic mono small ${p.inVoice && !p.muted ? 'live' : ''}" title="Voice: ${vstate}">${micIcon(p.inVoice, p.muted)} ${vstate}</span>
        </li>`;
      }).join('')}
    </ul>
    <div class="voice-actions">
      ${voice.active
        ? `<button class="btn btn-sm ${voice.muted ? 'btn-brass' : 'btn-ghost'}" id="v-mute">${voice.muted ? 'Unmute' : 'Mute'}</button><button class="btn btn-sm btn-ghost" id="v-leave">Leave voice</button>`
        : `<button class="btn btn-sm btn-brass" id="v-join" ${voice.joining ? 'disabled' : ''}>Join voice</button>`}
    </div>
    ${voice.error ? `<p class="form-error small">${esc(voice.error)}</p>` : ''}
    ${!voice.active && me && players.some((p) => p.inVoice && p.id !== S.playerId) ? `<p class="small muted">${esc(players.find((p) => p.inVoice && p.id !== S.playerId).name)} is waiting in voice.</p>` : ''}`;
  $('#v-join', el)?.addEventListener('click', () => voice.join());
  $('#v-leave', el)?.addEventListener('click', () => voice.leave());
  $('#v-mute', el)?.addEventListener('click', () => voice.toggleMute());
  $('#chat-room', commsEl).textContent = S.room ? `room ${S.room.code}` : '';
}
function micIcon(inVoice, muted) {
  if (!inVoice) return '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4" opacity=".4"/></svg>';
  if (muted) return '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M4 4l16 16"/></svg>';
  return '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4"/></svg>';
}
voice.addEventListener('change', renderVoice);
// Speaking indicators toggle classes only, so buttons are never re-created mid-click.
voice.addEventListener('speaking', () => {
  if (!commsEl) return;
  $$('.crew li', commsEl).forEach((li) => {
    const on = voice.speaking.has(li.dataset.pid);
    li.classList.toggle('speaking', on);
    li.querySelector('.avatar')?.classList.toggle('ring', on);
  });
});

// ------------------------------------------------------------------ room rendering
function renderRoom() {
  if (!S.room) return;
  renderVoice();
  if (S.screen === 'lobby') renderLobby();
  if (S.screen === 'game') renderGame();
}

function renderLobby() {
  const r = S.room, w = S.roomWorld;
  if (!w) return;
  const me = r.players.find((p) => p.id === S.playerId);
  const isHost = r.hostId === S.playerId;
  const link = `${location.origin}/?room=${r.code}`;
  const full = r.players.length >= 2;
  const allReady = full && r.players.every((p) => p.ready && p.connected);
  const slots = [0, 1].map((i) => r.players[i]);
  $('#lobby-main').innerHTML = `
    <div class="lobby">
      <div class="lobby-head">
        <div>
          <p class="eyebrow mono">Waiting lobby</p>
          <h2 class="display-sm">${esc(w.name)}</h2>
          <p class="muted">${esc(w.tagline)}</p>
        </div>
        <div class="room-code">
          <p class="mono label">Room code</p>
          <p class="code mono">${r.code}</p>
          <div class="code-actions">
            <button class="btn btn-sm btn-ghost" id="copy-code">Copy code</button>
            <button class="btn btn-sm btn-ghost" id="copy-link">Copy invite link</button>
            ${navigator.share ? '<button class="btn btn-sm btn-ghost" id="share-link">Share…</button>' : ''}
          </div>
          <p class="mono small muted link-text">${esc(link)}</p>
        </div>
      </div>

      <div class="lobby-grid">
        <div class="lobby-preview">${worldArt(w, { particles: false })}</div>
        <div class="lobby-side">
          <p class="mono label">Expedition mode</p>
          <div class="segmented" role="radiogroup">
            <button role="radio" aria-checked="${r.mode === 'coop'}" class="${r.mode === 'coop' ? 'on' : ''}" data-mode="coop" ${isHost ? '' : 'disabled'}>Co-op Adventure</button>
            <button role="radio" aria-checked="${r.mode === 'duel'}" class="${r.mode === 'duel' ? 'on' : ''}" data-mode="duel" ${isHost ? '' : 'disabled'}>Duel</button>
          </div>
          <p class="small muted mode-desc">${r.mode === 'coop'
            ? `Three missions: ${w.missions.map((m) => esc(m.title)).join(' → ')}. ${esc(w.roles[0].title)} and ${esc(w.roles[1].title)} see different things.`
            : `${esc(w.duel.premise)} Three timed rounds; highest score wins.`}</p>
          <p class="mono label">Explorers</p>
          <ul class="player-slots">
            ${slots.map((p, i) => p ? `
              <li class="slot filled ${p.connected ? '' : 'offline'}">
                ${avatar(p)}
                <div><strong>${esc(p.name)}${p.id === S.playerId ? ' <span class="muted">(you)</span>' : ''}</strong>
                  <span class="mono small">${p.id === r.hostId ? 'host · ' : ''}<i class="dot ${p.connected ? 'ok' : 'bad'}"></i>${p.connected ? 'connected' : 'disconnected'}${p.inVoice ? ' · in voice' : ''}</span></div>
                <span class="ready mono ${p.ready ? 'yes' : ''}">${p.ready ? 'Ready' : 'Not ready'}</span>
              </li>` : `
              <li class="slot empty">
                <span class="avatar ghost">?</span>
                <div><strong>Awaiting explorer ${i + 1}</strong><span class="mono small">Share the code or link above</span></div>
                <span class="waiting-dots"><i></i><i></i><i></i></span>
              </li>`).join('')}
          </ul>
          <div class="cta-row">
            ${isHost
              ? `<button class="btn btn-brass btn-lg" id="start-game" ${allReady ? '' : 'disabled'}>Begin the ${r.mode === 'coop' ? 'adventure' : 'duel'}</button>`
              : `<button class="btn ${me?.ready ? 'btn-ghost' : 'btn-brass'} btn-lg" id="toggle-ready">${me?.ready ? 'Not ready' : "I'm ready"}</button>`}
            <button class="btn btn-ghost" id="leave-room">Leave</button>
          </div>
          <p class="small muted">${!full ? 'The adventure needs two explorers. Your friend can join from anywhere.' : !allReady ? (isHost ? `Waiting for ${esc(r.players.find((p) => !p.ready || !p.connected)?.name || 'your partner')} to be ready.` : 'The host will begin once you are ready.') : isHost ? 'Everyone is ready.' : 'Waiting for the host to begin.'} Join voice on the right to talk while you play.</p>
        </div>
      </div>
    </div>`;
  const copy = (text, label) => navigator.clipboard?.writeText(text).then(() => toast(`${label} copied.`, 'success', 2200), () => toast(text, 'info', 8000));
  $('#copy-code').addEventListener('click', () => copy(r.code, 'Room code'));
  $('#copy-link').addEventListener('click', () => copy(link, 'Invite link'));
  $('#share-link')?.addEventListener('click', () => navigator.share({ title: 'Tiny Things Observatory', text: `Explore ${w.name} with me — room ${r.code}`, url: link }).catch(() => {}));
  $$('.segmented button').forEach((b) => b.addEventListener('click', () => net.send({ t: 'set_mode', mode: b.dataset.mode })));
  $('#start-game')?.addEventListener('click', () => net.send({ t: 'start_game' }));
  $('#toggle-ready')?.addEventListener('click', () => net.send({ t: 'set_ready', ready: !me?.ready }));
  $('#leave-room').addEventListener('click', goHome);
}

// ------------------------------------------------------------------ game rendering
function renderGame() {
  const g = S.game, w = S.roomWorld;
  if (!g || !w) return;
  applyMobileTab();
  const main = $('#game-main');
  const scroll = main.scrollTop;
  main.innerHTML = g.mode === 'coop' ? coopHtml(g, w) : duelHtml(g, w);
  bindGame(g);
  main.scrollTop = scroll;
  tick();
}

function stepper(w, current, doneUpTo) {
  return `<ol class="stepper">${w.locations.map((l, i) => `<li class="${i < doneUpTo ? 'done' : ''} ${i === current ? 'current' : ''}"><span class="mono">${ROMAN[i]}</span><em>${esc(l.name)}</em></li>`).join('')}</ol>`;
}

function disconnectedBanner() {
  const off = S.room.players.filter((p) => !p.connected);
  return off.length ? `<div class="banner warn">${off.map((p) => esc(p.name)).join(', ')} lost connection — their seat is held. Progress continues when they return.</div>` : '';
}

// ----- CO-OP
function coopHtml(g, w) {
  const m = g.mission;
  const mission = w.missions[g.stage];
  const loc = w.locations[g.stage];
  const myRole = w.roles[g.myRole];
  const partner = nameOf(g.partnerId);
  const pips = Array.from({ length: g.maxStability }, (_, i) => `<i class="${i < g.stability ? 'on' : ''}"></i>`).join('');
  let stage = '';
  if (m.kind === 'sigil') stage = sigilStage(g, w, partner);
  else if (m.kind === 'crossing') stage = crossingStage(g.mission, w, { canAct: m.canAct, canSee: m.canSee, partner, coop: true });
  else stage = alignmentStage(m, w, { coop: true, partner });
  return `
    ${disconnectedBanner()}
    <div class="game-head">
      <div class="where">
        <p class="eyebrow mono">${esc(w.name)} · Co-op</p>
        <h2 class="display-sm">${esc(loc.name)}</h2>
      </div>
      ${stepper(w, g.stage, g.status === 'complete' ? 3 : g.stage)}
      <div class="stability" title="World stability: mistakes cost one point. At zero the mission fails.">
        <span class="mono label">Stability</span><span class="pips">${pips}</span>
      </div>
    </div>
    <article class="mission-card">
      <div class="mission-text">
        <p class="mono label">Mission ${g.stage + 1} of 3</p>
        <h3>${esc(mission.title)}</h3>
        <p>${esc(mission.briefing)}</p>
        <p class="objective-line"><span class="mono">Objective</span> ${esc(mission.objective)}</p>
      </div>
      <div class="role-badge">
        <p class="mono label">You are</p>
        <strong>${esc(myRole.title)}</strong>
        <small>${esc(myRole.ability)}</small>
      </div>
    </article>
    <div class="stage">
      ${stage}
      ${coopOverlay(g, w)}
    </div>`;
}

function resultLine(lr, noun) {
  if (!lr || Date.now() - lr.at > 20000) return '';
  return `<p class="result-line mono">Last attempt: ${lr.correct} of ${lr.total} ${noun}.</p>`;
}

function sigilStage(g, w, partner) {
  const m = g.mission;
  const slots = Array.from({ length: m.length }, (_, i) => i);
  if (m.canSee) {
    return `
      <div class="perception">
        <p class="hint-line"><strong>Only you can perceive the code.</strong> Describe each sigil's <em>shape</em> to ${esc(partner)} — they can't see it, and you can't touch the lock.</p>
        <div class="sigil-sequence">
          ${m.sequence.map((s, i) => `<div class="seq-cell"><span class="mono">${i + 1}</span>${sigilSvg(w.id, s, 'big')}</div>`).join('')}
        </div>
        <div class="input-track">${slots.map((i) => `<i class="${i < m.inputCount ? 'on' : ''}"></i>`).join('')}<span class="mono small">${partner} has entered ${m.inputCount}/${m.length}</span></div>
        ${resultLine(m.lastResult, 'sigils resonated')}
      </div>`;
  }
  return `
    <div class="operation">
      <p class="hint-line"><strong>You hold the lock, but the code is invisible to you.</strong> Ask ${esc(partner)} to describe the five sigils, in order.</p>
      <div class="lock-slots">${slots.map((i) => `<div class="lock-slot ${m.input[i] !== undefined ? 'filled' : ''}">${m.input[i] !== undefined ? sigilSvg(w.id, m.input[i]) : `<span class="mono">${i + 1}</span>`}</div>`).join('')}</div>
      <div class="keypad">${m.keypad.map((s) => `<button class="key" data-sigil="${s}" ${m.input.length >= m.length ? 'disabled' : ''}>${sigilSvg(w.id, s)}<span>${esc(w.sigils[s])}</span></button>`).join('')}</div>
      <div class="cta-row center">
        <button class="btn btn-ghost btn-sm" data-act="sigil_undo" ${m.input.length ? '' : 'disabled'}>Undo</button>
        <button class="btn btn-ghost btn-sm" data-act="sigil_clear" ${m.input.length ? '' : 'disabled'}>Clear</button>
        <button class="btn btn-brass" data-act="sigil_submit" ${m.input.length === m.length ? '' : 'disabled'}>Turn the lock</button>
      </div>
      ${resultLine(m.lastResult, 'sigils resonated')}
    </div>`;
}

function crossingStage(m, w, { canAct, canSee, partner, coop }) {
  const hz = new Set(m.hazards || []);
  const rev = new Set(m.revealed || []);
  const trail = new Set((m.trail || []).map((p) => p.y * m.grid + p.x));
  const recentHit = m.lastHit && Date.now() - m.lastHit.at < 1500 ? m.lastHit.y * m.grid + m.lastHit.x : -1;
  let cells = '';
  for (let y = 0; y < m.grid; y++) {
    for (let x = 0; x < m.grid; x++) {
      const k = y * m.grid + x;
      const isPos = m.pos.x === x && m.pos.y === y;
      const isGoal = m.goal.x === x && m.goal.y === y;
      const isStart = m.start.x === x && m.start.y === y;
      const adj = Math.abs(m.pos.x - x) + Math.abs(m.pos.y - y) === 1;
      const cls = ['cell', hz.has(k) ? 'hazard' : '', rev.has(k) ? 'hazard revealed' : '', trail.has(k) ? 'trail' : '', isGoal ? 'goal' : '', isStart ? 'start' : '', adj && canAct ? 'adj' : '', k === recentHit ? 'hit' : ''].join(' ');
      cells += `<button class="${cls}" data-x="${x}" data-y="${y}" aria-label="${COLS[x]}${y + 1}${hz.has(k) || rev.has(k) ? ' hazard' : ''}" ${canAct && adj ? '' : 'tabindex="-1"'}>${isPos ? '<span class="token"></span>' : ''}${isGoal && !isPos ? '<span class="goal-mark"></span>' : ''}</button>`;
    }
  }
  const colLabels = `<div class="col-labels mono">${[...COLS.slice(0, m.grid)].map((c) => `<span>${c}</span>`).join('')}</div>`;
  const rowLabels = `<div class="row-labels mono">${Array.from({ length: m.grid }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>`;
  const hint = coop
    ? (canSee
      ? `<p class="hint-line"><strong>You can see the ${esc(w.crossingHazard.toLowerCase())}.</strong> Guide ${esc(partner)} from <span class="mono">${COLS[m.start.x]}${m.start.y + 1}</span> to the beacon at <span class="mono">${COLS[m.goal.x]}${m.goal.y + 1}</span>. Call out directions or coordinates.</p>`
      : `<p class="hint-line"><strong>You walk blind.</strong> The ${esc(w.crossingHazard.toLowerCase())} are invisible to you — follow ${esc(partner)}'s directions. Use arrow keys, WASD, the pad, or tap a neighbouring tile.</p>`)
    : '';
  return `
    <div class="crossing">
      ${hint}
      <div class="crossing-body">
        <div class="board-wrap">${colLabels}<div class="board-row">${rowLabels}<div class="board" style="--n:${m.grid}">${cells}</div></div></div>
        ${canAct ? `<div class="dpad">
          <button data-dir="up" aria-label="Up">▲</button><button data-dir="left" aria-label="Left">◀</button><span class="mono">${COLS[m.pos.x]}${m.pos.y + 1}</span><button data-dir="right" aria-label="Right">▶</button><button data-dir="down" aria-label="Down">▼</button>
        </div>` : `<div class="watch mono small">Walker at <strong>${COLS[m.pos.x]}${m.pos.y + 1}</strong></div>`}
      </div>
      <p class="legend mono small"><span class="lg lg-goal"></span> beacon <span class="lg lg-haz"></span> ${esc(w.crossingHazard.toLowerCase())}${coop && !canSee ? ' (revealed after a misstep)' : ''} <span class="lg lg-trail"></span> path</p>
    </div>`;
}

function alignmentStage(m, w, { coop, partner }) {
  const placed = new Set(m.slots.filter((s) => s !== null));
  const free = [0, 1, 2, 3, 4].filter((r) => !placed.has(r));
  return `
    <div class="alignment">
      <div class="clue-scroll">
        <p class="mono label">${coop ? 'Your clues' : 'The inscriptions'}</p>
        <ul class="clues">${m.clues.map((c) => `<li><span>${esc(c)}</span>${coop ? `<button class="btn btn-sm btn-ghost share" data-share="${esc(c)}" title="Post this clue to the transmissions log">Share</button>` : ''}</li>`).join('')}</ul>
        ${coop ? `<p class="small muted">${esc(partner)} holds ${m.partnerClueCount} other clue${m.partnerClueCount === 1 ? '' : 's'}. Neither set alone is enough — combine them.</p>` : ''}
      </div>
      <div class="altar">
        <div class="pedestals">${m.slots.map((r, i) => `
          <button class="pedestal ${r !== null ? 'filled' : ''} ${S.selectedRelic !== null ? 'targetable' : ''}" data-slot="${i}">
            <span class="mono ped-num">${ROMAN[i]}</span>
            ${r !== null ? `${relicSvg(w.id, r)}<span class="relic-name">${esc(w.relics[r])}</span>` : '<span class="empty-ped">empty</span>'}
          </button>`).join('')}
        </div>
        <div class="relic-tray">
          ${free.length ? free.map((r) => `<button class="relic ${S.selectedRelic === r ? 'selected' : ''}" data-relic="${r}">${relicSvg(w.id, r)}<span>${esc(w.relics[r])}</span></button>`).join('') : '<p class="small muted">All relics placed. Tap a pedestal to pick one up again.</p>'}
        </div>
        <p class="small muted center">${S.selectedRelic !== null ? `Placing <strong>${esc(w.relics[S.selectedRelic])}</strong> — choose a pedestal.` : 'Select a relic, then a pedestal. Tap a filled pedestal to pick its relic up.'}${coop ? ' Both of you can move relics.' : ''}</p>
        <div class="cta-row center"><button class="btn btn-brass" data-act="align" ${placed.size === 5 ? '' : 'disabled'}>Attempt the alignment</button></div>
        ${resultLine(m.lastResult, 'relics hummed in place')}
      </div>
    </div>`;
}

function coopOverlay(g, w) {
  const votes = g.continueVotes.length;
  const voted = g.continueVotes.includes(S.playerId);
  if (g.status === 'mission_complete') {
    const next = w.locations[g.stage + 1];
    return `<div class="overlay success"><div class="overlay-card portal-in">
      <p class="mono label">Mission complete</p><h3>${esc(w.missions[g.stage].title)}</h3><p>${esc(w.missions[g.stage].success)}</p>
      <p class="mono small">Next · ${esc(next.name)}</p>
      <button class="btn btn-brass" data-act="continue" ${voted ? 'disabled' : ''}>${voted ? `Waiting for ${esc(nameOf(g.partnerId))}… (${votes}/2)` : `Travel onward (${votes}/2 ready)`}</button>
    </div></div>`;
  }
  if (g.status === 'failed') {
    return `<div class="overlay danger"><div class="overlay-card portal-in">
      <p class="mono label">Stability lost</p><h3>The world shudders</h3><p>${esc(w.missions[g.stage].failure)}</p>
      <p class="small muted">The mission will re-form with a new configuration.</p>
      <button class="btn btn-brass" data-act="retry">Try again</button>
    </div></div>`;
  }
  if (g.status === 'complete') {
    const s = g.summary;
    const isHost = S.room.hostId === S.playerId;
    return `<div class="overlay success final"><div class="overlay-card portal-in">
      <p class="mono label">Universe restored</p><h3 class="display-sm">${esc(w.name)} lives on</h3>
      <p>${esc(w.missions[2].success)}</p>
      <dl class="stats mono"><div><dt>Time</dt><dd>${fmtTime(s.durationMs)}</dd></div><div><dt>Missteps</dt><dd>${s.mistakes}</dd></div><div><dt>Stability left</dt><dd>${s.stability}/${g.maxStability}</dd></div></dl>
      ${isHost ? '<button class="btn btn-brass" id="to-lobby">Return to lobby</button>' : '<p class="small muted">The host can return you both to the lobby to play again or try a Duel.</p>'}
    </div></div>`;
  }
  return '';
}

// ----- DUEL
function duelHtml(g, w) {
  const ids = S.room.players.map((p) => p.id).filter((id) => g.players[id]);
  const loc = w.locations[g.round];
  const board = `<div class="duel-board">${ids.map((id) => {
    const p = g.players[id], sc = g.scores[id];
    const isMe = id === S.playerId;
    return `<div class="duelist ${isMe ? 'me' : ''}">
      ${avatar({ id, name: nameOf(id) })}
      <div class="duelist-meta"><strong>${esc(nameOf(id))}${isMe ? ' <span class="muted">(you)</span>' : ''}</strong>
        <div class="progress"><i style="width:${Math.round(p.progress * 100)}%"></i></div>
        <span class="mono small">${p.finished ? `finished · ${(p.timeMs / 1000).toFixed(1)}s` : g.status === 'active' ? 'exploring…' : ''}${p.mistakes ? ` · ${p.mistakes} misstep${p.mistakes > 1 ? 's' : ''}` : ''}</span>
      </div>
      <span class="score mono">${sc.total}</span>
    </div>`;
  }).join('<span class="vs mono">vs</span>')}</div>`;
  let stage = '';
  const me = g.me;
  const revealing = g.status === 'active' && me.sequence && serverNow() < g.revealUntil && g.kind !== 'alignment';
  if (g.status === 'countdown' || g.status === 'active') {
    if (me.finished) stage = `<div class="finished-card"><p class="mono label">Round complete</p><h3>Well done.</h3><p>Waiting for your rival to finish… <span class="mono" data-countdown="end"></span></p></div>`;
    else if (g.kind === 'sigil') stage = duelSigil(g, w, revealing);
    else if (g.kind === 'crossing') stage = duelCrossing(g, w);
    else stage = alignmentStage({ ...me, lastResult: me.lastResult }, w, { coop: false });
  }
  return `
    ${disconnectedBanner()}
    <div class="game-head">
      <div class="where"><p class="eyebrow mono">${esc(w.name)} · ${esc(w.duel.title)}</p><h2 class="display-sm">${esc(loc.name)}</h2></div>
      ${stepper(w, g.round, g.status === 'complete' ? 3 : g.round)}
      <div class="timer ${g.status === 'active' ? '' : 'idle'}"><span class="mono label">Time</span><span class="mono time" data-countdown="end">1:30</span></div>
    </div>
    ${board}
    <article class="mission-card compact">
      <div class="mission-text">
        <p class="mono label">Round ${g.round + 1} of 3 · ${({ sigil: 'Memory', crossing: 'Nerve', alignment: 'Logic' })[g.kind]}</p>
        <h3>${esc(w.missions[g.round].title)}</h3>
        <p>${duelRules(g.kind, w)}</p>
      </div>
    </article>
    <div class="stage">
      ${stage}
      ${duelOverlay(g, w, ids)}
    </div>`;
}

function duelRules(kind, w) {
  if (kind === 'sigil') return 'The sigil code appears for six seconds. Memorise it, then enter it from memory. Wrong attempts cost 10 points.';
  if (kind === 'crossing') return `The ${esc(w.crossingHazard.toLowerCase())} glow for a few seconds, then vanish. Cross from memory; each misstep sends you back and costs 10 points.`;
  return 'Deduce the one true order of the relics from the inscriptions. Wrong alignments cost 15 points.';
}

function duelSigil(g, w, revealing) {
  const me = g.me;
  if (g.status === 'countdown' || revealing) {
    return `<div class="perception">
      <p class="hint-line"><strong>${revealing ? 'Memorise the code' : 'Get ready…'}</strong> ${revealing ? `— it fades in <span class="mono" data-countdown="reveal"></span>` : ''}</p>
      <div class="sigil-sequence ${revealing ? '' : 'veiled'}">${revealing ? me.sequence.map((s, i) => `<div class="seq-cell"><span class="mono">${i + 1}</span>${sigilSvg(w.id, s, 'big')}</div>`).join('') : Array.from({ length: me.length }, (_, i) => `<div class="seq-cell"><span class="mono">${i + 1}</span><span class="veil"></span></div>`).join('')}</div>
    </div>`;
  }
  const slots = Array.from({ length: me.length }, (_, i) => i);
  return `<div class="operation">
    <div class="lock-slots">${slots.map((i) => `<div class="lock-slot ${me.input[i] !== undefined ? 'filled' : ''}">${me.input[i] !== undefined ? sigilSvg(w.id, me.input[i]) : `<span class="mono">${i + 1}</span>`}</div>`).join('')}</div>
    <div class="keypad">${me.keypad.map((s) => `<button class="key" data-sigil="${s}" ${me.input.length >= me.length ? 'disabled' : ''}>${sigilSvg(w.id, s)}<span>${esc(w.sigils[s])}</span></button>`).join('')}</div>
    <div class="cta-row center">
      <button class="btn btn-ghost btn-sm" data-act="sigil_undo" ${me.input.length ? '' : 'disabled'}>Undo</button>
      <button class="btn btn-ghost btn-sm" data-act="sigil_clear" ${me.input.length ? '' : 'disabled'}>Clear</button>
      <button class="btn btn-brass" data-act="sigil_submit" ${me.input.length === me.length ? '' : 'disabled'}>Turn the lock</button>
    </div>
    ${resultLine(me.lastResult, 'sigils correct')}
  </div>`;
}

function duelCrossing(g, w) {
  const me = g.me;
  const revealing = g.status === 'active' && serverNow() < g.revealUntil;
  const canAct = g.status === 'active' && !revealing;
  const top = g.status === 'countdown' ? '<p class="hint-line"><strong>Get ready…</strong></p>'
    : revealing ? `<p class="hint-line"><strong>Memorise the ${esc(w.crossingHazard.toLowerCase())}</strong> — they vanish in <span class="mono" data-countdown="reveal"></span></p>`
    : `<p class="hint-line"><strong>Cross from memory.</strong> Arrow keys, WASD, the pad or tap a neighbouring tile.</p>`;
  const m = { ...me, hazards: revealing ? me.hazards : null, trail: [] };
  return top + crossingStage(m, w, { canAct, canSee: revealing, coop: false });
}

function duelOverlay(g, w, ids) {
  if (g.status === 'countdown') return `<div class="overlay countdown"><div class="count mono" data-countdown="start">3</div></div>`;
  if (g.status === 'round_end') {
    const voted = g.continueVotes.includes(S.playerId);
    return `<div class="overlay"><div class="overlay-card portal-in">
      <p class="mono label">Round ${g.round + 1} results</p><h3>${esc(w.missions[g.round].title)}</h3>
      <table class="results mono"><thead><tr><th></th><th>Time</th><th>Missteps</th><th>Points</th><th>Total</th></tr></thead><tbody>
      ${ids.map((id) => { const r = g.scores[id].rounds[g.round]; return `<tr><td>${esc(nameOf(id))}${g.players[id].firstBonus ? ' <span class="tag">first +25</span>' : ''}</td><td>${r.timeMs ? (r.timeMs / 1000).toFixed(1) + 's' : '—'}</td><td>${r.mistakes}</td><td>${r.points}</td><td>${g.scores[id].total}</td></tr>`; }).join('')}
      </tbody></table>
      <p class="small muted">Next · ${esc(w.locations[g.round + 1].name)} — ${esc(w.missions[g.round + 1].title)}</p>
      <button class="btn btn-brass" data-act="continue" ${voted ? 'disabled' : ''}>${voted ? `Waiting… (${g.continueVotes.length}/2)` : `Next round (${g.continueVotes.length}/2)`}</button>
    </div></div>`;
  }
  if (g.status === 'complete') {
    const isHost = S.room.hostId === S.playerId;
    const winner = g.winner;
    const iWon = winner === S.playerId;
    const title = winner ? (iWon ? 'Victory' : `${esc(nameOf(winner))} prevails`) : 'A perfect tie';
    return `<div class="overlay ${iWon ? 'success' : ''} final"><div class="overlay-card portal-in">
      <p class="mono label">${esc(w.duel.title)} · final</p>
      <h3 class="display-sm">${title}</h3>
      <p>${winner ? (iWon ? esc(w.duel.victory) : `${esc(nameOf(winner))} claims ${esc(w.name)}. ${esc(w.duel.victory)}`) : 'Neither explorer could be separated. The world keeps you both.'}</p>
      <table class="results mono"><thead><tr><th></th>${[0, 1, 2].map((i) => `<th>${ROMAN[i]}</th>`).join('')}<th>Total</th></tr></thead><tbody>
        ${ids.map((id) => `<tr class="${id === winner ? 'win' : ''}"><td>${esc(nameOf(id))}</td>${g.scores[id].rounds.map((r) => `<td>${r.points}</td>`).join('')}<td>${g.scores[id].total}</td></tr>`).join('')}
      </tbody></table>
      <p class="small muted">Score = 100 per completed round + speed bonus (up to 100) + 25 for finishing first − penalties for missteps.</p>
      ${isHost ? '<button class="btn btn-brass" id="to-lobby">Return to lobby</button>' : '<p class="small muted">The host can return you both to the lobby for a rematch.</p>'}
    </div></div>`;
  }
  return '';
}

// ----- bindings
function bindGame(g) {
  const main = $('#game-main');
  $$('[data-sigil]', main).forEach((b) => b.addEventListener('click', () => act({ kind: 'sigil_press', sigil: Number(b.dataset.sigil) })));
  $$('[data-act]', main).forEach((b) => b.addEventListener('click', () => { b.disabled = true; act({ kind: b.dataset.act }); }));
  $$('[data-dir]', main).forEach((b) => b.addEventListener('click', () => act({ kind: 'move', dir: b.dataset.dir })));
  $$('.cell.adj', main).forEach((c) => c.addEventListener('click', () => {
    const pos = g.mode === 'coop' ? g.mission.pos : g.me.pos;
    const dx = Number(c.dataset.x) - pos.x, dy = Number(c.dataset.y) - pos.y;
    act({ kind: 'move', dir: dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up' });
  }));
  $$('[data-relic]', main).forEach((b) => b.addEventListener('click', () => {
    const r = Number(b.dataset.relic);
    S.selectedRelic = S.selectedRelic === r ? null : r;
    renderGame();
  }));
  $$('[data-slot]', main).forEach((b) => b.addEventListener('click', () => {
    const slot = Number(b.dataset.slot);
    const slots = g.mode === 'coop' ? g.mission.slots : g.me.slots;
    if (S.selectedRelic !== null) {
      act({ kind: 'place', slot, relic: S.selectedRelic });
      S.selectedRelic = null;
    } else if (slots[slot] !== null) {
      S.selectedRelic = slots[slot];
      act({ kind: 'place', slot, relic: null });
    }
  }));
  $$('[data-share]', main).forEach((b) => b.addEventListener('click', () => { net.send({ t: 'share_clue', text: b.dataset.share }); b.textContent = 'Shared'; b.disabled = true; }));
  $('#to-lobby', main)?.addEventListener('click', () => net.send({ t: 'back_to_lobby' }));
}

document.addEventListener('keydown', (e) => {
  if (S.screen !== 'game' || !S.game) return;
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' }[e.key];
  if (!dir) return;
  const g = S.game;
  const canMove = g.mode === 'coop'
    ? g.status === 'active' && g.mission.kind === 'crossing' && g.mission.canAct
    : g.status === 'active' && g.kind === 'crossing' && !g.me.finished && serverNow() >= g.revealUntil;
  if (!canMove) return;
  e.preventDefault();
  act({ kind: 'move', dir });
});

// ----- timers
function serverNow() { return Date.now() + S.clockOffset; }
let revealWasActive = false;
function tick() {
  const g = S.game;
  if (!g || S.screen !== 'game' || g.mode !== 'duel') return;
  const now = serverNow();
  $$('[data-countdown]').forEach((el) => {
    const k = el.dataset.countdown;
    if (k === 'end') el.textContent = g.status === 'active' || g.status === 'countdown' ? fmtTime(g.endsAt - now) : '—';
    if (k === 'start') el.textContent = Math.max(1, Math.ceil((g.startsAt - now) / 1000));
    if (k === 'reveal') el.textContent = `${Math.max(0, Math.ceil((g.revealUntil - now) / 1000))}s`;
  });
  const timer = $('.timer');
  if (timer) timer.classList.toggle('urgent', g.status === 'active' && g.endsAt - now < 15000);
  const revealing = g.status === 'active' && now < g.revealUntil;
  if (revealWasActive && !revealing) { revealWasActive = false; renderGame(); return; }
  revealWasActive = revealing;
}
setInterval(tick, 200);

// Keep the comms panel fresh when connection status of others changes visually
window.addEventListener('resize', () => { if (S.screen === 'game') applyMobileTab(); });
