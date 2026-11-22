import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { aiAvailable, generateWorldFromImage, generateWorldFromName, describeAiError } from './ai.js';
import { normalizeWorld, offlineWorld, SAMPLE_WORLDS } from './worlds.js';
import { createGame, applyAction, viewFor, GameError } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 2;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// ------------------------------------------------------------------ worlds
const worlds = new Map();
function storeWorld(world) {
  worlds.set(world.id, world);
  if (worlds.size > 500) worlds.delete(worlds.keys().next().value);
  return world;
}
const newId = (n = 10) => crypto.randomBytes(n).toString('base64url').slice(0, n);

function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    list.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return list;
}

app.get('/api/config', (_req, res) => {
  res.json({ ai: aiAvailable(), iceServers: iceServers(), turn: Boolean(process.env.TURN_URL), samples: Object.keys(SAMPLE_WORLDS) });
});

app.post('/api/generate', async (req, res) => {
  const { image, hint, sample } = req.body || {};
  const cleanHint = typeof hint === 'string' ? hint.trim().slice(0, 80) : '';
  try {
    if (sample) {
      const src = SAMPLE_WORLDS[sample];
      if (!src) return res.status(404).json({ error: 'Unknown sample specimen.' });
      return res.json({ world: storeWorld(normalizeWorld(src, src, { id: newId(), source: 'sample' })) });
    }
    let parsedImage = null;
    if (image) {
      const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(image);
      if (!m) return res.status(400).json({ error: 'That file does not look like a supported image (JPEG, PNG, WebP or GIF).' });
      if (m[2].length > 7_000_000) return res.status(413).json({ error: 'That image is too large. Try a smaller photo.' });
      parsedImage = { mediaType: m[1], imageBase64: m[2] };
    }
    if (!parsedImage && !cleanHint) return res.status(400).json({ error: 'Show the Observatory an object: upload a photo or name it.' });

    if (!aiAvailable() || req.body.offline) {
      if (!cleanHint) {
        return res.status(422).json({ code: 'NEED_NAME', error: 'The AI lens is not configured on this server, so it cannot see photos. Name your object to use the Offline Atlas.' });
      }
      const w = offlineWorld(cleanHint);
      return res.json({ world: storeWorld(normalizeWorld(w, w, { id: newId(), source: 'offline' })) });
    }

    const started = Date.now();
    const raw = parsedImage
      ? await generateWorldFromImage({ ...parsedImage, hint: cleanHint })
      : await generateWorldFromName(cleanHint);
    const fallback = offlineWorld(raw.objectName || cleanHint || 'object');
    const world = storeWorld(normalizeWorld(raw, fallback, { id: newId(), source: 'ai' }));
    console.log(`[ai] generated "${world.name}" from ${world.objectName} in ${Date.now() - started}ms`);
    return res.json({ world });
  } catch (err) {
    console.error('[generate] failed:', err?.status || '', err?.message || err);
    return res.status(502).json({ error: describeAiError(err), offlineAvailable: true });
  }
});

app.get('/api/world/:id', (req, res) => {
  const w = worlds.get(req.params.id);
  if (!w) return res.status(404).json({ error: 'That world has drifted out of range (server restarted?).' });
  res.json({ world: w });
});

app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  if (!room) return res.status(404).json({ error: 'No room with that code is open.' });
  res.json({ code: room.code, mode: room.mode, players: room.players.size, full: room.players.size >= MAX_PLAYERS, worldName: room.world.name });
});

// ------------------------------------------------------------------ rooms
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRoomCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function makeTimers(room) {
  const t = new Map();
  return {
    set(name, ms, fn) {
      if (t.has(name)) clearTimeout(t.get(name));
      t.set(name, setTimeout(() => {
        t.delete(name);
        try { fn(); } catch (e) { console.error('[timer]', name, e); }
        broadcastState(room);
      }, Math.max(0, ms)));
    },
    clear(name) { if (t.has(name)) { clearTimeout(t.get(name)); t.delete(name); } },
    clearAll() { for (const h of t.values()) clearTimeout(h); t.clear(); },
  };
}

function createRoom(world, mode, host) {
  const room = {
    code: newRoomCode(), world, mode, hostId: host.id,
    players: new Map(), phase: 'lobby', game: null, chat: [], createdAt: Date.now(), emptySince: null,
  };
  room.timers = makeTimers(room);
  rooms.set(room.code, room);
  return room;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function roomSnapshot(room) {
  return {
    code: room.code, mode: room.mode, hostId: room.hostId, phase: room.phase, worldId: room.world.id,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, connected: p.connected, ready: p.ready, inVoice: p.inVoice, muted: p.muted,
      role: room.game && room.mode === 'coop' ? room.game.roles?.[p.id] ?? null : null,
    })),
  };
}

function broadcastState(room) {
  const snap = roomSnapshot(room);
  for (const p of room.players.values()) {
    send(p.ws, { t: 'state', room: snap, game: room.game ? viewFor(room.game, p.id) : null });
  }
}

function pushChat(room, msg) {
  const full = { id: newId(8), ts: Date.now(), ...msg };
  room.chat.push(full);
  if (room.chat.length > 150) room.chat.shift();
  for (const p of room.players.values()) send(p.ws, { t: 'chat', msg: full });
}
const system = (room, text, tone = 'info') => pushChat(room, { kind: 'system', tone, text });

function joinRoom(ws, room) {
  const pid = ws.pid;
  let p = room.players.get(pid);
  if (!p) {
    if (room.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', code: 'ROOM_FULL', message: 'That room already has two explorers.' });
    p = { id: pid, name: ws.name, connected: true, ready: pid === room.hostId, inVoice: false, muted: false, ws };
    room.players.set(pid, p);
    system(room, `${p.name} entered the observatory.`, 'join');
  } else {
    const wasDisconnected = !p.connected;
    if (p.ws && p.ws !== ws) { try { p.ws.close(4000, 'replaced'); } catch {} }
    p.ws = ws; p.connected = true; p.name = ws.name || p.name;
    if (wasDisconnected) system(room, `${p.name} reconnected.`, 'join');
  }
  if (ws.roomCode && ws.roomCode !== room.code) leaveRoom(ws);
  ws.roomCode = room.code;
  room.emptySince = null;
  send(ws, { t: 'joined', code: room.code, world: room.world, chat: room.chat.slice(-80) });
  broadcastState(room);
}

function leaveRoom(ws) {
  const room = rooms.get(ws.roomCode);
  ws.roomCode = null;
  if (!room) return;
  const p = room.players.get(ws.pid);
  if (!p) return;
  room.players.delete(ws.pid);
  if (p.inVoice) for (const o of room.players.values()) send(o.ws, { t: 'voice_left', id: p.id });
  system(room, `${p.name} left the observatory.`, 'leave');
  if (room.game) {
    room.timers.clearAll();
    room.game = null;
    room.phase = 'lobby';
    system(room, 'The adventure was interrupted. Waiting in the lobby.', 'warn');
  }
  if (room.hostId === p.id) {
    const next = room.players.keys().next().value;
    if (next) { room.hostId = next; room.players.get(next).ready = true; system(room, `${room.players.get(next).name} is now the host.`); }
  }
  if (room.players.size === 0) { room.timers.clearAll(); rooms.delete(room.code); return; }
  broadcastState(room);
}

function requireRoom(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room || !room.players.has(ws.pid)) throw new GameError('You are not in a room.');
  return room;
}

// ------------------------------------------------------------------ socket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

const cleanName = (n) => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, 20) : '') || 'Explorer';

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.chatTimes = [];
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    try { handle(ws, msg); } catch (err) {
      if (err instanceof GameError) send(ws, { t: 'action_error', message: err.message });
      else { console.error('[ws]', err); send(ws, { t: 'action_error', message: 'Something went wrong on the server. Try again.' }); }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const p = room.players.get(ws.pid);
    if (!p || p.ws !== ws) return;
    p.connected = false;
    p.ws = null;
    if (p.inVoice) {
      p.inVoice = false;
      for (const o of room.players.values()) send(o.ws, { t: 'voice_left', id: p.id });
    }
    system(room, `${p.name} lost connection. Their seat is held for them.`, 'leave');
    if ([...room.players.values()].every((x) => !x.connected)) room.emptySince = Date.now();
    broadcastState(room);
  });
});

function handle(ws, msg) {
  if (msg.t === 'hello') {
    ws.pid = typeof msg.playerId === 'string' && /^[\w-]{8,40}$/.test(msg.playerId) ? msg.playerId : newId(16);
    ws.name = cleanName(msg.name);
    send(ws, { t: 'welcome', playerId: ws.pid });
    if (msg.room) {
      const room = rooms.get(String(msg.room).toUpperCase());
      if (room && room.players.has(ws.pid)) joinRoom(ws, room);
    }
    return;
  }
  if (!ws.pid) return send(ws, { t: 'error', code: 'NO_HELLO', message: 'Handshake missing.' });

  switch (msg.t) {
    case 'set_name': {
      ws.name = cleanName(msg.name);
      const room = rooms.get(ws.roomCode);
      const p = room?.players.get(ws.pid);
      if (p) { p.name = ws.name; broadcastState(room); }
      return;
    }
    case 'create_room': {
      const world = worlds.get(msg.worldId);
      if (!world) return send(ws, { t: 'error', code: 'NO_WORLD', message: 'That world is no longer in the observatory (the server may have restarted). Please discover it again.' });
      const mode = msg.mode === 'duel' ? 'duel' : 'coop';
      if (ws.roomCode) leaveRoom(ws);
      const room = createRoom(world, mode, { id: ws.pid });
      system(room, `Room ${room.code} opened for ${world.name} — ${mode === 'coop' ? 'Co-op Adventure' : 'Duel'}.`, 'discovery');
      return joinRoom(ws, room);
    }
    case 'join_room': {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return send(ws, { t: 'error', code: 'NO_ROOM', message: 'No room with that code is open. Check the code with your friend.' });
      return joinRoom(ws, room);
    }
    case 'leave_room': return leaveRoom(ws);
    case 'set_mode': {
      const room = requireRoom(ws);
      if (room.hostId !== ws.pid) throw new GameError('Only the host can change the mode.');
      if (room.phase !== 'lobby') throw new GameError('The game has already started.');
      room.mode = msg.mode === 'duel' ? 'duel' : 'coop';
      for (const p of room.players.values()) if (p.id !== room.hostId) p.ready = false;
      system(room, `Mode set to ${room.mode === 'coop' ? 'Co-op Adventure' : 'Duel'}.`);
      return broadcastState(room);
    }
    case 'set_ready': {
      const room = requireRoom(ws);
      room.players.get(ws.pid).ready = Boolean(msg.ready);
      return broadcastState(room);
    }
    case 'start_game': {
      const room = requireRoom(ws);
      if (room.hostId !== ws.pid) throw new GameError('Only the host can start the adventure.');
      if (room.phase === 'playing') throw new GameError('Already playing.');
      const players = [...room.players.values()];
      if (players.length < 2) throw new GameError('Waiting for a second explorer to join.');
      if (!players.every((p) => p.ready)) throw new GameError('Everyone needs to be ready.');
      if (!players.every((p) => p.connected)) throw new GameError('A player is disconnected.');
      room.timers.clearAll();
      room.phase = 'playing';
      room.game = createGame({
        world: room.world, mode: room.mode, playerIds: [room.hostId, ...players.map((p) => p.id).filter((id) => id !== room.hostId)],
        timers: room.timers,
        emit: {
          system: (text, tone) => system(room, text, tone),
          update: () => broadcastState(room),
          nameOf: (id) => room.players.get(id)?.name || 'Someone',
        },
      });
      const w = room.world;
      if (room.mode === 'coop') {
        const [a, b] = room.game.playerIds;
        system(room, `The adventure begins. ${room.players.get(a).name} is ${w.roles[0].title}; ${room.players.get(b).name} is ${w.roles[1].title}.`, 'discovery');
        system(room, `Mission 1: ${w.missions[0].title} at ${w.locations[0].name}.`, 'discovery');
      } else {
        system(room, `${w.duel.title} begins. Three rounds — highest score wins.`, 'discovery');
      }
      return broadcastState(room);
    }
    case 'back_to_lobby': {
      const room = requireRoom(ws);
      if (room.hostId !== ws.pid) throw new GameError('Only the host can return to the lobby.');
      room.timers.clearAll();
      room.game = null; room.phase = 'lobby';
      for (const p of room.players.values()) p.ready = p.id === room.hostId;
      system(room, 'Returned to the lobby.');
      return broadcastState(room);
    }
    case 'action': {
      const room = requireRoom(ws);
      if (!room.game) throw new GameError('The game has not started.');
      applyAction(room.game, ws.pid, msg.action);
      return broadcastState(room);
    }
    case 'chat': case 'share_clue': {
      const room = requireRoom(ws);
      const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, msg.t === 'chat' ? 300 : 200) : '';
      if (!text) return;
      const now = Date.now();
      ws.chatTimes = ws.chatTimes.filter((t) => now - t < 5000);
      if (ws.chatTimes.length >= 8) throw new GameError('Slow down — the transmitter is overheating.');
      ws.chatTimes.push(now);
      const p = room.players.get(ws.pid);
      return pushChat(room, { kind: msg.t === 'chat' ? 'player' : 'hint', from: p.id, name: p.name, text });
    }
    // ---- voice signaling (WebRTC peer-to-peer; the server only relays SDP/ICE) ----
    case 'voice_join': {
      const room = requireRoom(ws);
      const p = room.players.get(ws.pid);
      p.inVoice = true; p.muted = Boolean(msg.muted);
      const peers = [...room.players.values()].filter((o) => o.id !== p.id && o.inVoice && o.connected).map((o) => o.id);
      send(ws, { t: 'voice_peers', peers });
      return broadcastState(room);
    }
    case 'voice_leave': {
      const room = requireRoom(ws);
      const p = room.players.get(ws.pid);
      p.inVoice = false;
      for (const o of room.players.values()) if (o.id !== p.id) send(o.ws, { t: 'voice_left', id: p.id });
      return broadcastState(room);
    }
    case 'voice_mute': {
      const room = requireRoom(ws);
      room.players.get(ws.pid).muted = Boolean(msg.muted);
      return broadcastState(room);
    }
    case 'signal': {
      const room = requireRoom(ws);
      const target = room.players.get(msg.to);
      if (!target || !target.inVoice) return;
      return send(target.ws, { t: 'signal', from: ws.pid, data: msg.data });
    }
    case 'ping': return send(ws, { t: 'pong', ts: msg.ts });
    default: return;
  }
}

// Heartbeat + room cleanup
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.emptySince && now - room.emptySince > 15 * 60_000) { room.timers.clearAll(); rooms.delete(room.code); }
  }
}, 25_000);

server.listen(PORT, () => {
  console.log(`\n  Tiny Things Observatory is open at http://localhost:${PORT}`);
  console.log(`  AI world generation: ${aiAvailable() ? 'ENABLED (Claude)' : 'NOT CONFIGURED — set ANTHROPIC_API_KEY. Samples + Offline Atlas still work.'}`);
  console.log(`  Voice: WebRTC peer-to-peer (STUN${process.env.TURN_URL ? ' + TURN' : ' only — set TURN_URL for strict NATs'})\n`);
});
