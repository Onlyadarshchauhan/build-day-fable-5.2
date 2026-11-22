# Tiny Things Observatory

**Pick up anything. Create a universe. Play with anyone.**

Photograph an everyday object. Claude examines it and writes the miniature universe hidden inside it (lore, inhabitants, locations, roles, missions). Then you invite a friend anywhere in the world and play through it together in **Co-op** or against each other in a **Duel**, with text chat and live voice.

## Run it

```bash
npm install
# optional but recommended: lets the AI see photos and write the worlds
export ANTHROPIC_API_KEY=sk-ant-...        # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
npm start                                   # http://localhost:3000
npm test                                    # engine self-tests (puzzle solvability, full games)
```

To try multiplayer on one machine, open two browser tabs (each tab is its own player).

### Playing with someone in another city

Your friend has to be able to reach the server, and browsers only allow the microphone on **HTTPS** pages (or localhost). Either:

- **Tunnel** your local server: `npx cloudflared tunnel --url http://localhost:3000` (or `ngrok http 3000`) and share the https URL, or
- **Deploy** it to any Node host that supports WebSockets (Render, Railway, Fly.io…). It's one process with no database. Set `PORT` if the host needs it.

## Configuration

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on AI world generation from photos (Claude Opus 5.5, vision + structured outputs). Without it, the three sample specimens and the name-based **Offline Atlas** still work, and the UI clearly shows "AI lens · offline". |
| `AI_MODEL` / `AI_EFFORT` | Defaults: `claude-opus-5-5` / `low`. Low effort keeps the reveal quick for live demos; use `medium` for richer worlds. |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Optional TURN relay for voice. Voice is peer-to-peer WebRTC using public STUN, which works on most home and mobile networks. Strict corporate or university NATs need a TURN server (for example Twilio, Metered or your own coturn). If the peer link fails, the voice panel says so. |
| `PORT` | Defaults to 3000. |

## What's real

| Feature | Status |
|---|---|
| Object analysis + world generation | Real Claude call: photo + JSON-schema structured output. The output is validated and repaired so the game is always playable. Refusals are rerouted with server-side fallback, and failures show a clear message with a retry or Offline Atlas option. |
| Multiplayer rooms | Real WebSocket rooms: 5-character code, invite link `/?room=CODE`, lobby with ready states, host start, mode switching. If you disconnect, your seat is held and you rejoin automatically. |
| Game state | The server is authoritative and validates every action. In co-op, each player is sent **only their own information**, so one player can't read the other's clues from devtools. |
| Puzzles | Built by the server, not the AI, so they're always solvable. The relic logic puzzle is brute-force checked to have exactly one solution, and **neither player's clues alone are enough**. Hazard fields are path-checked. |
| Duel winner | Decided by score from actual game state: completion, speed, finishing first and missteps. The score formula is shown on screen. |
| Text chat | Real-time, timestamped, with system/mission events and a "share clue" button. |
| Voice | Real WebRTC audio between browsers: join, leave, mute, speaking indicators, peer connection state. The server only relays signaling. |
| World artwork | Procedural SVG drawn from the AI-chosen palette, terrain, sky and particles. No image-generation model is called. |

## How a game plays

**Co-op** has three connected missions at the world's three locations, with a shared stability meter: each mistake costs 1 point, and at 0 the mission resets with a new layout.
1. **Sigil Lock.** One player sees the 5-sigil code but can't touch the lock. The other holds the keypad but can't see the code. Describe shapes to each other.
2. **Hazard Crossing.** One player sees the invisible danger on a 7×7 grid with coordinates. The other walks blind using arrows, WASD, the d-pad or by tapping tiles.
3. **Relic Alignment.** Each player holds half the logic clues. Combine them (or share clues to chat) and place five relics in the one correct order.

**Duel** uses the same three challenges as timed races: memorise a code, cross from memory, and solve the logic puzzle.

## Layout

```
server/index.js    HTTP API, WebSocket rooms, chat, voice signaling
server/ai.js       Claude prompt + JSON schema
server/worlds.js   world normalizer, sample worlds, Offline Atlas
server/puzzles.js  seeded puzzle generators + solvability checks
server/game.js     co-op / duel state machines, per-player views
server/selftest.js engine tests
public/            client (vanilla ES modules, no build step)
```
