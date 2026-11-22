import { rng, hashString } from './puzzles.js';

export const TERRAINS = ['mountains', 'dunes', 'spires', 'waves', 'forest', 'crystals', 'islands'];
export const CELESTIALS = ['moon', 'rings', 'twin-suns', 'aurora', 'eclipse'];
export const PARTICLES = ['motes', 'embers', 'snow', 'bubbles', 'petals', 'sparks'];

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 600) : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);

// Coerce any (AI or authored) world into the exact shape the game needs.
// Missing pieces are filled from a fallback world so the game is always playable.
export function normalizeWorld(raw, fallback, meta = {}) {
  const f = fallback;
  const a = raw.atmosphere || {};
  const fa = f.atmosphere;
  const fill = (list, fb, n, mapFn) => {
    const out = arr(list).slice(0, n).map(mapFn).filter(Boolean);
    let i = 0;
    while (out.length < n) out.push(fb[i++ % fb.length]);
    return out;
  };
  const uniqNames = (list) => {
    const seen = new Set();
    return list.map((n, i) => {
      let name = n;
      while (seen.has(name.toLowerCase())) name = `${n} ${['II', 'III', 'IV', 'V', 'VI'][i % 5]}`;
      seen.add(name.toLowerCase());
      return name;
    });
  };
  const world = {
    id: meta.id,
    source: meta.source || 'ai',
    objectName: str(raw.objectName, f.objectName),
    observations: str(raw.observations, f.observations),
    name: str(raw.name, f.name),
    tagline: str(raw.tagline, f.tagline),
    description: str(raw.description, f.description),
    origin: str(raw.origin, f.origin),
    lore: fill(raw.lore, f.lore, 3, (s) => str(s) || null),
    theme: str(raw.theme, f.theme),
    atmosphere: {
      skyTop: HEX.test(a.skyTop) ? a.skyTop : fa.skyTop,
      skyBottom: HEX.test(a.skyBottom) ? a.skyBottom : fa.skyBottom,
      ground: HEX.test(a.ground) ? a.ground : fa.ground,
      accent: HEX.test(a.accent) ? a.accent : fa.accent,
      glow: HEX.test(a.glow) ? a.glow : fa.glow,
      terrain: TERRAINS.includes(a.terrain) ? a.terrain : fa.terrain,
      celestial: CELESTIALS.includes(a.celestial) ? a.celestial : fa.celestial,
      particles: PARTICLES.includes(a.particles) ? a.particles : fa.particles,
      mood: str(a.mood, fa.mood),
    },
    inhabitants: fill(raw.inhabitants, f.inhabitants, 3, (x) => x && str(x.name) ? { name: str(x.name), kind: str(x.kind, 'inhabitant'), description: str(x.description) } : null),
    locations: fill(raw.locations, f.locations, 3, (x) => x && str(x.name) ? { name: str(x.name), description: str(x.description), hazard: str(x.hazard) } : null),
    objective: str(raw.objective, f.objective),
    hazards: fill(raw.hazards, f.hazards, 3, (s) => str(s) || null),
    mechanics: fill(raw.mechanics, f.mechanics, 3, (x) => x && str(x.name) ? { name: str(x.name), description: str(x.description) } : null),
    roles: fill(raw.roles, f.roles, 2, (x) => x && str(x.title) ? { title: str(x.title).slice(0, 40), ability: str(x.ability) } : null),
    sigils: uniqNames(fill(raw.sigils, f.sigils, 6, (s) => str(s).slice(0, 28) || null)),
    relics: uniqNames(fill(raw.relics, f.relics, 5, (s) => str(s).slice(0, 32) || null)),
    crossingHazard: str(raw.crossingHazard, f.crossingHazard).slice(0, 40),
    missions: fill(raw.missions, f.missions, 3, (x) => x && str(x.title) ? {
      title: str(x.title), briefing: str(x.briefing), objective: str(x.objective),
      success: str(x.success, 'The way opens.'), failure: str(x.failure, 'The world shudders and resets.'),
    } : null),
    duel: {
      title: str(raw.duel?.title, f.duel.title),
      premise: str(raw.duel?.premise, f.duel.premise),
      victory: str(raw.duel?.victory, f.duel.victory),
    },
    createdAt: Date.now(),
  };
  return world;
}

// ---------------- Hand-authored sample worlds ----------------
export const SAMPLE_WORLDS = {
  headphones: {
    objectName: 'Headphones',
    observations: 'Two padded cups joined by an arched band; a coiled cable; worn foam at the edges where they have listened for years.',
    name: 'The Echo Realm',
    tagline: 'A universe where sound has physical form, and silence is spreading.',
    description: 'Beneath the arch of a great listening band lies a realm where every note ever played still lives — as weather, as stone, as light. Melodies grow like vines; basslines carve canyons. But a creeping Silence is eating the edges of the world.',
    origin: 'The realm was born when the First Melody was played into the cushioned dark of the twin cups. It echoed so long that it became land.',
    lore: [
      'The Resonants measure age in choruses, not years.',
      'Silence is not empty here — it is a hungry, colourless fog.',
      'The First Melody shattered into sigils; whoever plays them in order can mend the world.',
    ],
    theme: 'Sound as matter; harmony as survival',
    atmosphere: { skyTop: '#0d1f1a', skyBottom: '#2f5a4a', ground: '#132820', accent: '#d9a441', glow: '#9fe3c4', terrain: 'waves', celestial: 'rings', particles: 'motes', mood: 'humming, nocturnal, reverberant' },
    inhabitants: [
      { name: 'The Resonants', kind: 'people', description: 'Tall, tuning-fork beings who sing to keep their bodies solid.' },
      { name: 'Hushmoths', kind: 'creatures', description: 'Pale moths that eat stray notes and leave silence behind.' },
      { name: 'Conductor Vell', kind: 'guide', description: 'An ancient metronome who remembers the First Melody.' },
    ],
    locations: [
      { name: 'Bass Caverns', description: 'Caves carved by low frequencies, walls throbbing with a slow pulse.', hazard: 'Rockfalls when the rhythm breaks' },
      { name: 'Whispering Forest', description: 'Trees made of reeds that repeat every secret spoken near them.', hazard: 'Pockets of Silence that swallow travellers' },
      { name: 'Frequency Tower', description: 'A spiralling spire where the realm\'s pitch is set each dawn.', hazard: 'Dissonant feedback from misaligned relics' },
    ],
    objective: 'Recover the shards of the First Melody and restore the realm before it falls silent.',
    hazards: ['Silence pockets', 'Feedback storms', 'Hushmoth swarms'],
    mechanics: [
      { name: 'Split Hearing', description: 'One traveller hears the sigil code; the other alone can play it.' },
      { name: 'Silent Ground', description: 'Silence pockets are invisible to whoever walks — only the scout can see them.' },
      { name: 'Harmonic Alignment', description: 'Relics must stand in the one order that makes them resonate.' },
    ],
    roles: [
      { title: 'The Listener', ability: 'Hears hidden sigil codes in the hum of the world.' },
      { title: 'The Frequency Keeper', ability: 'Sees the shape of silence and the paths around it.' },
    ],
    sigils: ['Low Hum', 'Bright Chime', 'Rest', 'Crescendo', 'Echo', 'Drone'],
    relics: ['Tuning Fork', 'Brass Bell', 'Reed Flute', 'Drum of Vell', 'Glass Harp'],
    crossingHazard: 'Silence pockets',
    missions: [
      { title: 'The Pulse Gate', briefing: 'The Bass Caverns are sealed by a gate that only opens to the right rhythm of sigils.', objective: 'Play the five-sigil rhythm into the gate.', success: 'The gate thunders open. The first shard of the Melody glows in the dark.', failure: 'The rhythm collapses — the caverns shake and the gate re-tunes itself.' },
      { title: 'Through the Whispering Forest', briefing: 'Silence pockets have bloomed between the reed trees. The Keeper can see them; the Listener must walk.', objective: 'Guide the Listener across the forest without touching silence.', success: 'You emerge humming. The second shard rings in your pocket.', failure: 'The silence closes in, and the forest forgets you were there.' },
      { title: 'Retuning the Tower', briefing: 'At the top of the Frequency Tower, five relics must stand in perfect order to resound the First Melody.', objective: 'Combine your clues and align the five relics.', success: 'The Melody pours across the realm. Colour floods back into every echo.', failure: 'Feedback screams through the tower; the relics topple.' },
    ],
    duel: { title: 'The Battle of the Bands', premise: 'Two rival conductors race to claim the Melody shards for their own orchestra.', victory: 'The realm now dances to your tune.' },
  },
  teacup: {
    objectName: 'Teacup',
    observations: 'A thin porcelain cup with a gilt rim, a chip near the handle, and a faint ring of tea staining the inside.',
    name: 'The Steeping Isles',
    tagline: 'An archipelago floating on an endless, cooling sea of tea.',
    description: 'Inside the porcelain horizon, islands of sugar and leaf drift on a warm amber ocean. Steam is weather, and the gilded rim is the edge of the known world. But the sea is cooling — and when it goes cold, the isles will sink.',
    origin: 'A traveller once forgot their cup on a windowsill at dusk. The last warmth in it dreamed itself a world.',
    lore: [
      'The Steepfolk read the future in leaves that settle on the sea floor.',
      'The chip in the rim is called the Breach — cold drafts blow through it.',
      'Five vessels once kept the sea warm. They were scattered by the Great Stir.',
    ],
    theme: 'Warmth, ritual and patience against a slow cold',
    atmosphere: { skyTop: '#1b1a12', skyBottom: '#6b4b2a', ground: '#2a2116', accent: '#e2b25c', glow: '#ffd9a0', terrain: 'islands', celestial: 'moon', particles: 'bubbles', mood: 'warm, drowsy, golden-hour' },
    inhabitants: [
      { name: 'The Steepfolk', kind: 'people', description: 'Small, leaf-cloaked sailors who navigate by the smell of bergamot.' },
      { name: 'Sugar Wyrms', kind: 'creatures', description: 'Crystalline serpents that dissolve if they swim too long.' },
      { name: 'Grandmother Infuser', kind: 'guide', description: 'A perforated silver sphere who hums old steeping songs.' },
    ],
    locations: [
      { name: 'The Gilded Rim', description: 'A golden cliff ringing the world, carved with steeping glyphs.', hazard: 'Cold drafts through the Breach' },
      { name: 'Leafdrift Shallows', description: 'A maze of sunken tea leaves just below the surface.', hazard: 'Cold currents that drag sailors under' },
      { name: 'The Saucer Observatory', description: 'A porcelain dome where the five warming vessels once stood.', hazard: 'Steam bursts when vessels are misplaced' },
    ],
    objective: 'Relight the five warming vessels before the sea goes cold.',
    hazards: ['Cold currents', 'Steam bursts', 'The Breach draft'],
    mechanics: [
      { name: 'Leaf Reading', description: 'One sailor can read the steeping glyphs; the other alone can press them.' },
      { name: 'Cold Currents', description: 'Only the lookout can see the cold beneath the surface.' },
      { name: 'Vessel Order', description: 'The warming vessels only work in their ancestral order.' },
    ],
    roles: [
      { title: 'The Leaf Reader', ability: 'Sees glyphs and omens written in the settling leaves.' },
      { title: 'The Lookout', ability: 'Feels the cold currents and sees where they run.' },
    ],
    sigils: ['Spiral Steam', 'Sugar Star', 'Bergamot', 'Half Moon', 'Kettle Mark', 'Lemon Wheel'],
    relics: ['Silver Infuser', 'Clay Kettle', 'Honey Pot', 'Milk Jug', 'Porcelain Lamp'],
    crossingHazard: 'Cold currents',
    missions: [
      { title: 'The Rim Lock', briefing: 'The way down from the Gilded Rim is sealed by a glyph-lock warmed by an ancient ritual.', objective: 'Press the five steeping glyphs in the right order.', success: 'The glyphs glow amber and a stair of sugar unfolds into the sea.', failure: 'A cold draft howls through the Breach. The lock frosts over and resets.' },
      { title: 'Crossing the Leafdrift', briefing: 'The Lookout can feel the cold currents in the shallows. The Leaf Reader must row blind.', objective: 'Steer the boat across the shallows without hitting cold water.', success: 'Your boat bumps gently against the saucer\'s edge.', failure: 'The cold takes the boat. You wash back to the rim, shivering.' },
      { title: 'The Five Vessels', briefing: 'In the Saucer Observatory, the warming vessels wait to be returned to their ancestral order.', objective: 'Combine your clues and place the five vessels correctly.', success: 'Warmth floods the sea. Steam rises like applause.', failure: 'A burst of scalding steam scatters the vessels.' },
    ],
    duel: { title: 'The Great Stir', premise: 'Two rival captains race to claim the warming vessels for their own island.', victory: 'Your island will be warm for a thousand steepings.' },
  },
  key: {
    objectName: 'Brass Key',
    observations: 'An old brass key with a looped bow, three uneven teeth, and green patina in its grooves.',
    name: 'The Keyhold',
    tagline: 'A city of a thousand doors, and only one key that opens the sky.',
    description: 'The Keyhold is a vertical city of brass and verdigris, built entirely of locks. Every street is a corridor of doors; every door leads somewhere impossible. The Master Lock at the summit has begun to seize, and the city is locking itself shut forever.',
    origin: 'A locksmith dropped a key down a well and wished, absurdly, that it might open something wonderful.',
    lore: [
      'Citizens are named after the doors they were born behind.',
      'Patina is sacred — it is the city remembering itself.',
      'Three teeth, three tiers: the key\'s shape is the city\'s map.',
    ],
    theme: 'Thresholds, secrets and the courage to open things',
    atmosphere: { skyTop: '#0e1712', skyBottom: '#3c5a3a', ground: '#1a2418', accent: '#c8963e', glow: '#7fd1a8', terrain: 'spires', celestial: 'eclipse', particles: 'sparks', mood: 'clockwork, secretive, verdigris' },
    inhabitants: [
      { name: 'The Wardens', kind: 'people', description: 'Lock-faced guardians who speak only in clicks and riddles.' },
      { name: 'Tumblers', kind: 'creatures', description: 'Small brass pins that hop about, falling into place at random.' },
      { name: 'The Locksmith\'s Echo', kind: 'guide', description: 'A ghostly apron that remembers how every lock was made.' },
    ],
    locations: [
      { name: 'The Bow Gate', description: 'A looping brass archway at the city\'s base, covered in sigils.', hazard: 'Jammed mechanisms that snap shut' },
      { name: 'The Patina Stairs', description: 'Green-crusted stairwells where some steps are traps.', hazard: 'Corroded steps that collapse' },
      { name: 'The Master Lock', description: 'The great seized lock at the summit, with five empty keyholes.', hazard: 'Seizing gears when keys are misplaced' },
    ],
    objective: 'Climb the Keyhold and free the Master Lock before the city locks itself forever.',
    hazards: ['Corroded steps', 'Snap-shut doors', 'Seizing gears'],
    mechanics: [
      { name: 'Warden Sight', description: 'One climber can read the sigil codes; the other alone can turn the dials.' },
      { name: 'Rotten Steps', description: 'Corroded steps look solid to the climber — only the guide sees the rot.' },
      { name: 'The Five Keyholes', description: 'Five lesser keys must turn in exactly one order.' },
    ],
    roles: [
      { title: 'The Cipher', ability: 'Reads the secret sigils engraved inside every lock.' },
      { title: 'The Patina Guide', ability: 'Sees corrosion and hidden traps in the brass.' },
    ],
    sigils: ['Loop', 'Notch', 'Ward', 'Pin', 'Bolt', 'Hinge'],
    relics: ['Iron Skeleton Key', 'Glass Key', 'Bone Key', 'Copper Key', 'Silver Key'],
    crossingHazard: 'Corroded steps',
    missions: [
      { title: 'Opening the Bow Gate', briefing: 'The Bow Gate\'s dial-lock responds only to the five-sigil sequence.', objective: 'Enter the sigil sequence to open the gate.', success: 'Tumblers click home, and the gate swings open with a sigh of old brass.', failure: 'The gate snaps shut and its sigils scramble.' },
      { title: 'The Patina Stairs', briefing: 'Half the steps are rotten through. The Guide can see them; the Cipher must climb.', objective: 'Lead the Cipher up the stairs without stepping on corrosion.', success: 'You reach the summit landing, covered in green dust and grinning.', failure: 'A step gives way and you tumble back to the base.' },
      { title: 'Freeing the Master Lock', briefing: 'Five lesser keys must turn in their one true order.', objective: 'Combine your clues and place the five keys.', success: 'The Master Lock turns. Every door in the city swings open at once.', failure: 'The gears seize and spit the keys back out.' },
    ],
    duel: { title: 'The Locksmith\'s Trial', premise: 'Two apprentices race to prove who deserves to inherit the Master Key.', victory: 'The city hands you its master key.' },
  },
};

// ---------------- Offline Atlas (used only when AI is not configured) ----------------
const ARCHETYPES = [
  {
    match: /phone|screen|laptop|tablet|computer|remote|controller|camera|watch|clock|battery|cable|charger|mouse|keyboard/i,
    theme: 'Signals, circuits and lost time', terrain: 'spires', celestial: 'aurora', particles: 'sparks',
    palette: ['#0c1a17', '#24493f', '#11221d', '#d0a24a', '#8ef0d0'],
    place: ['Circuit Wilds', 'The Signal Spire', 'Static Marsh', 'The Charging Vault', 'Pixel Falls'],
    folk: ['Sparklings', 'The Archivists', 'Glitch Foxes'], danger: 'Static storms',
    sigils: ['Pulse', 'Node', 'Arc', 'Loop', 'Glitch', 'Beacon'],
    relics: ['Copper Coil', 'Glass Lens', 'Quartz Heart', 'Silver Switch', 'Old Battery'],
  },
  {
    match: /plant|leaf|flower|seed|tree|fruit|apple|banana|orange|lemon|vegetable|stone|rock|shell|pinecone|feather/i,
    theme: 'Growth, seasons and the patience of roots', terrain: 'forest', celestial: 'twin-suns', particles: 'petals',
    palette: ['#0f1d14', '#3f6b3e', '#15261a', '#d6a84c', '#b9f0a0'],
    place: ['The Root Halls', 'Canopy Bridges', 'The Seedvault', 'Dewdrop Hollow', 'The Elder Stump'],
    folk: ['The Mossfolk', 'Pollen Sprites', 'Thornback Beetles'], danger: 'Blight patches',
    sigils: ['Sprout', 'Thorn', 'Bloom', 'Root', 'Dew', 'Spore'],
    relics: ['Acorn Crown', 'Amber Drop', 'Willow Staff', 'Moss Lantern', 'Petal Horn'],
  },
  {
    match: /cup|mug|bottle|glass|bowl|kettle|jar|spoon|fork|plate|pan|pot|can/i,
    theme: 'Warmth, ritual and things that hold other things', terrain: 'islands', celestial: 'moon', particles: 'bubbles',
    palette: ['#1a1810', '#62482b', '#271f15', '#e0b05a', '#ffd79a'],
    place: ['The Brim Cliffs', 'Swirling Shallows', 'The Ladle Lighthouse', 'Crumb Harbour', 'The Deep Basin'],
    folk: ['Brimfolk', 'Sugar Wyrms', 'Steam Spirits'], danger: 'Scalding currents',
    sigils: ['Swirl', 'Drop', 'Steam', 'Crescent', 'Grain', 'Ripple'],
    relics: ['Silver Ladle', 'Clay Bowl', 'Honey Jar', 'Copper Kettle', 'Salt Cellar'],
  },
  {
    match: /book|paper|pen|pencil|notebook|letter|map|card|envelope|ticket|crayon|marker|brush/i,
    theme: 'Stories, ink and words that refuse to stay on the page', terrain: 'mountains', celestial: 'rings', particles: 'snow',
    palette: ['#13140f', '#4a4632', '#1d1c14', '#cf9f4a', '#f3e2b0'],
    place: ['The Margin Wastes', 'Inkwell Lake', 'The Spine Mountains', 'The Footnote Caves', 'The Final Chapter'],
    folk: ['The Scribes', 'Inkblots', 'Paper Cranes'], danger: 'Erasure fog',
    sigils: ['Quill', 'Blot', 'Serif', 'Margin', 'Fold', 'Seal'],
    relics: ['Golden Nib', 'Wax Seal', 'First Page', 'Bone Bookmark', 'Ink Crystal'],
  },
  {
    match: /shoe|sock|hat|glove|bag|ball|toy|lego|block|dice|coin|button|ring|key|lock|scissors|toolbox|hammer/i,
    theme: 'Play, chance and forgotten treasure', terrain: 'crystals', celestial: 'eclipse', particles: 'embers',
    palette: ['#10170f', '#3b5236', '#182315', '#cc9a40', '#8fe0b4'],
    place: ['The Lost-and-Found Expanse', 'Tumbling Heights', 'The Treasure Under-Couch', 'Gearstone Ridge', 'The Hollow Drawer'],
    folk: ['Pocketkin', 'Dust Bunnies', 'Brass Beetles'], danger: 'Crumbling ledges',
    sigils: ['Star', 'Bolt', 'Knot', 'Eye', 'Crown', 'Gear'],
    relics: ['Lucky Coin', 'Glass Marble', 'Tin Soldier', 'Silk Ribbon', 'Brass Thimble'],
  },
];
const GENERIC = {
  theme: 'Hidden wonder in ordinary things', terrain: 'dunes', celestial: 'rings', particles: 'motes',
  palette: ['#0d1a15', '#2f5444', '#13241d', '#d4a245', '#a6ecd0'],
  place: ['The Outer Shell', 'The Shimmering Seam', 'The Hidden Core', 'The Whispering Ridge', 'The Quiet Basin'],
  folk: ['The Smallfolk', 'Glimmer Moths', 'The Cartographer'], danger: 'Unstable ground',
  sigils: ['Spiral', 'Eye', 'Wave', 'Star', 'Seed', 'Gate'],
  relics: ['Brass Compass', 'Glass Orb', 'Silver Bell', 'Stone Idol', 'Lantern Heart'],
};

const titleCase = (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

export function offlineWorld(objectNameRaw) {
  const objectName = titleCase(str(objectNameRaw, 'Curious Object').slice(0, 40));
  const arch = ARCHETYPES.find((a) => a.match.test(objectName)) || GENERIC;
  const r = rng(hashString(objectName.toLowerCase()));
  const places = r.shuffle(arch.place).slice(0, 3);
  const realmWord = r.pick(['Realm', 'Kingdom', 'Expanse', 'Dominion', 'Reaches', 'Atlas']);
  const name = `The ${objectName} ${realmWord}`;
  const [skyTop, skyBottom, ground, accent, glow] = arch.palette;
  const sigils = r.shuffle(arch.sigils);
  const relics = r.shuffle(arch.relics);
  return {
    objectName,
    observations: `Catalogued by name only: “${objectName}”. (The Observatory's AI lens is offline, so the image itself was not examined.)`,
    name,
    tagline: `Hidden inside every ${objectName.toLowerCase()} is a world that is quietly coming undone.`,
    description: `Shrink down far enough and the ${objectName.toLowerCase()} becomes a landscape: ${places[0]}, ${places[1]} and, at its heart, ${places[2]}. Its people have lived here unseen for ages — but ${arch.danger.toLowerCase()} now spread across the land.`,
    origin: `The ${realmWord.toLowerCase()} formed the moment someone first held a ${objectName.toLowerCase()} and wondered about it.`,
    lore: [
      `${arch.folk[0]} believe the world ends where your fingertips once touched it.`,
      `${arch.danger} are said to come from forgetting.`,
      `Five relics once kept the ${realmWord.toLowerCase()} whole.`,
    ],
    theme: arch.theme,
    atmosphere: { skyTop, skyBottom, ground, accent, glow, terrain: arch.terrain, celestial: arch.celestial, particles: arch.particles, mood: 'curious, hushed, luminous' },
    inhabitants: [
      { name: arch.folk[0], kind: 'people', description: `The tiny keepers of the ${objectName.toLowerCase()}.` },
      { name: arch.folk[1], kind: 'creatures', description: 'Restless creatures drawn to anything that glows.' },
      { name: arch.folk[2], kind: 'guide', description: 'An old wanderer who has mapped most of this world.' },
    ],
    locations: places.map((p, i) => ({ name: p, description: ['Where every journey here begins.', 'A treacherous crossing few have survived.', 'The heart of the world, where the relics once stood.'][i], hazard: arch.danger })),
    objective: `Cross the ${realmWord.toLowerCase()} and restore its five relics before ${arch.danger.toLowerCase()} consume it.`,
    hazards: [arch.danger, 'Sealed passages', 'Misaligned relics'],
    mechanics: [
      { name: 'Split Sight', description: 'One traveller reads the sigil code; the other enters it.' },
      { name: 'Hidden Danger', description: 'Only the scout can see the hazards; the walker moves blind.' },
      { name: 'Relic Order', description: 'The relics only awaken in one order.' },
    ],
    roles: [
      { title: 'The Reader', ability: 'Perceives sigil codes hidden in the world.' },
      { title: 'The Scout', ability: `Sees ${arch.danger.toLowerCase()} before they strike.` },
    ],
    sigils: sigils.slice(0, 6),
    relics: relics.slice(0, 5),
    crossingHazard: arch.danger,
    missions: [
      { title: `The Seal of ${places[0]}`, briefing: `A sigil-sealed door bars the way out of ${places[0]}.`, objective: 'Enter the five-sigil sequence.', success: 'The seal dissolves into light.', failure: 'The seal flares and scrambles its sigils.' },
      { title: `Crossing ${places[1]}`, briefing: `${arch.danger} hide across ${places[1]}. Only the Scout can see them.`, objective: 'Guide the Reader safely across.', success: 'You make it across, breathless.', failure: 'The ground gives way and you are thrown back to the start.' },
      { title: `The Heart of ${places[2]}`, briefing: `Five relics wait in ${places[2]} to be set in their true order.`, objective: 'Combine your clues and align the relics.', success: `The ${realmWord.toLowerCase()} breathes again.`, failure: 'The relics reject the order and scatter.' },
    ],
    duel: { title: `The ${objectName} Gambit`, premise: `Two rival explorers race to claim the ${realmWord.toLowerCase()}'s relics.`, victory: `The ${realmWord.toLowerCase()} names you its keeper.` },
  };
}
