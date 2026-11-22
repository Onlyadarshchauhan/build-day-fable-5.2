import Anthropic from '@anthropic-ai/sdk';
import { TERRAINS, CELESTIALS, PARTICLES } from './worlds.js';

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.AI_EFFORT || 'low'; // low keeps world reveal fast for live demos

let client = null;
export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  if (!client) client = new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return client;
}

const S = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items) => ({ type: 'array', items });

const WORLD_SCHEMA = obj({
  isObject: { type: 'boolean' },
  objectName: S,
  observations: S,
  name: S,
  tagline: S,
  description: S,
  origin: S,
  lore: list(S),
  theme: S,
  atmosphere: obj({
    skyTop: S, skyBottom: S, ground: S, accent: S, glow: S,
    terrain: { type: 'string', enum: TERRAINS },
    celestial: { type: 'string', enum: CELESTIALS },
    particles: { type: 'string', enum: PARTICLES },
    mood: S,
  }),
  inhabitants: list(obj({ name: S, kind: S, description: S })),
  locations: list(obj({ name: S, description: S, hazard: S })),
  objective: S,
  hazards: list(S),
  mechanics: list(obj({ name: S, description: S })),
  roles: list(obj({ title: S, ability: S })),
  sigils: list(S),
  relics: list(S),
  crossingHazard: S,
  missions: list(obj({ title: S, briefing: S, objective: S, success: S, failure: S })),
  duel: obj({ title: S, premise: S, victory: S }),
});

const SYSTEM = `You are the World-Maker of the Tiny Things Observatory, a two-player puzzle adventure game.
A player shows you a photograph of an everyday object. You examine it closely and imagine the miniature universe hidden inside it, then write that universe as a structured game specification.

The game engine builds the puzzle mechanics itself, so your job is the world and the flavour that sits on top of three fixed mission types. Write content that fits these mechanics exactly:

Mission 1 (at locations[0]) — SIGIL LOCK: a lock that opens to a sequence of 5 sigils chosen from the 6 "sigils" you name. Role 1 perceives the code; Role 2 alone can enter it.
Mission 2 (at locations[1]) — HAZARD CROSSING: a 7x7 crossing strewn with an invisible danger named "crossingHazard". Role 2 can see the danger and guides; Role 1 walks blind.
Mission 3 (at locations[2]) — RELIC ALIGNMENT: the 5 "relics" you name must be placed on 5 pedestals in one correct order, deduced by combining clues split between the players.
Duel mode reuses the same three challenges as a race between rival players.

Rules:
- Ground everything in what you actually see: the object's materials, shape, colours, wear, text, purpose. Mention specific details in "observations". The world's geography, people and dangers should be clearly derived from the object (e.g. headphones -> a realm where sound is matter; a teacup -> islands on a cooling sea of tea).
- Be imaginative, warm and a little whimsical; avoid generic fantasy and avoid copying existing franchises.
- Exactly: 3 lore lines, 3 inhabitants, 3 locations, 3 hazards, 3 mechanics, 2 roles, 6 sigils, 5 relics, 3 missions.
- roles[0] is the one who perceives hidden codes/sigils; roles[1] is the one who perceives hidden dangers. Give them evocative titles (2-4 words).
- Sigil names: 1-2 words each, all distinct. Relic names: 1-3 words each, all distinct, each must read naturally in a sentence like "X sits immediately to the left of Y".
- Mission text must not contain puzzle solutions or specific codes; describe situation and stakes. "success" and "failure" are 1-2 sentences shown after the mission resolves.
- Colours are hex #RRGGBB. Prefer deep, atmospheric skies (night greens, dusks, deep teals or warm ambers fitting the object) with one luminous glow colour and one warm metallic accent.
- Keep each text field concise: descriptions 1-3 sentences.
- If the photo shows no identifiable physical object, set isObject=false but still generate a world from whatever is visible.`;

export async function generateWorldFromImage({ imageBase64, mediaType, hint }) {
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    { type: 'text', text: hint ? `The player says this object is: "${hint.slice(0, 80)}". Examine the photo and create its universe.` : 'Examine the photo and create the universe hidden inside this object.' },
  ];
  return callModel(content);
}

export async function generateWorldFromName(name) {
  return callModel([{ type: 'text', text: `The player has no photo but describes their object as: "${name.slice(0, 80)}". Imagine a typical, specific example of it and create its universe.` }]);
}

async function callModel(content) {
  const base = {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: WORLD_SCHEMA } },
  };
  let response;
  try {
    // Server-side refusal fallback: if the model declines, the API reroutes automatically.
    response = await getClient().beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
      response = await getClient().messages.create(base);
    } else {
      throw err;
    }
  }
  if (response.stop_reason === 'refusal') {
    const e = new Error('The Observatory could not interpret this image. Try a different object.');
    e.userFacing = true;
    throw e;
  }
  if (response.stop_reason === 'max_tokens') throw new Error('World generation was cut short (max_tokens).');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

export function describeAiError(err) {
  if (err?.userFacing) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return 'The AI key was rejected. Check ANTHROPIC_API_KEY on the server.';
  if (err instanceof Anthropic.RateLimitError) return 'The Observatory is overloaded (rate limited). Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'World generation timed out. Please try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'The server could not reach the AI service. Check its network connection.';
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status ?? 'unknown'}). Please try again.`;
  if (err instanceof SyntaxError) return 'The AI returned an unreadable world. Please try again.';
  return 'World generation failed unexpectedly. Please try again.';
}
