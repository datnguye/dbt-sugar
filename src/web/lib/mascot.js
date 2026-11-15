const PALETTE = { O: '#0d3b1f', G: '#4ade80', D: '#16a34a', C: '#d9f99d', K: '#0a0a0a', W: '#ffffff', P: '#ff7aa8', Y: '#ffcf4a', B: '#8fd3ff', M: '#a9adb4', A: '#ff694b', F: '#c4452c' };
const SIZE = 24;
const HEADROOM = 10;

const HEAD = [
  '',
  '...........OOOOOOO',
  '..........OGGGGGGGOO',
  '.........OGGGGGGGGGGO',
  '........DOGGGGGGGGGGGO',
  '.......DDOGGGGGGGGGGGGO',
  '........DOGGGGGGGGGGGGO',
  '........OGGGGGGGGGGGGGO',
  '........OGGGGGPPGGGGGGO',
  '........OGGGGGGGGGGGGO',
  '.......DOGGGGGGGGGGOO',
  '......DDOGGGGGGGGOO'
];
const BODY = [
  '.....DDOGGGGGGGGGO',
  'OO..DDOGGGGCCCCGGO',
  'OGOOOOGGGGCCCCCCGO',
  '.OGGGGGGGGCCCCCCGO',
  '..OOGGGGGGCCCCCCGO',
  '....OOGGGGGCCCCGGO',
  '.....OGGGGGGGGGGO',
  '......OOGGGGGGOO'
];
const LEGS = {
  stand: ['.......OGGO..OGGO', '.......OGGO..OGGO', '......OOOOO.OOOOO'],
  stepA: ['......OGGO...OGGO', '.....OOOO....OGGO', '.............OOOOO'],
  stepB: ['........OGGO.OGGO', '........OGGO..OOOO', '........OOOOO'],
  tuck: ['........OGGOOGGO', '........OOOOOOOO'],
  splay: ['.....OGGO.....OGGO', '.....OOOO.....OOOO']
};
const ARMS = {
  down: [16, 14, ['OGO', '..O']],
  mid: [16, 13, ['OGGGO']],
  up: [17, 10, ['..O', '.OG', 'OGO']],
  face: [17, 9, ['OGGO']]
};
const EYES = {
  normal: ['KKW', 'KKK', 'KKK'],
  blink: ['GGG', 'KKK', 'GGG'],
  happy: ['.K.', 'K.K', '...'],
  sleep: ['...', 'K.K', '.K.'],
  wide: ['KKK', 'KWK', 'KKK'],
  dead: ['K.K', '.K.', 'K.K'],
  half: ['GGG', 'KKK', 'KKW'],
  up: ['KKW', 'KKW', 'KKK']
};
const SHADES = ['KKKKKKKKK', '...KWKKK.', '....KKK'];
const MOUTHS = {
  smile: ['K..K', '.KK.'],
  open: ['.KK.', 'KPPK'],
  chew: ['....', 'KKKK'],
  grin: ['KKKK', '.PP.'],
  wobble: ['K.K.', '.K.K'],
  o: ['.KK.', 'K..K', '.KK.'],
  sad: ['.KK.', 'K..K'],
  sleep: ['....', '.K..'],
  chomp: ['KKKK', 'KPPK', 'KKKK']
};
const BROWS = { worried: [['K..', '.KK'], 15, 2], raised: [['KKK'], 16, 2] };
const SPRITES = {
  logo: ['...A...', '..AAA..', '.AWAWA.', 'AAAWAAA', '.AWAWA.', '..AFA..', '...F...'],
  held: ['..A..', '.AWA.', 'AAWAA', '.AFA.', '..F..'],
  warn: ['..Y..', '.YKY.', '.YKY.', 'YYYYY'],
  zzz: ['MMM', '..M', '.M.', 'MMM'],
  sweat: ['.B', 'BB', 'BB'],
  bang: ['Y', 'Y', 'Y', '.', 'Y'],
  question: ['BBB', '..B', '.BB', '...', '.B.'],
  heart: ['P.P', 'PPP', '.P.'],
  sparkle: ['.Y.', 'YWY', '.Y.'],
  crumb: ['A'],
  speed: ['MMM']
};
const GROUND = new Set(['logo', 'speed']);

const SPEC = {
  waiting: { ms: 520, base: { eyes: 'sleep', mouth: 'sleep', armR: 'down' }, frames: [{ props: [['logo', 15, -8], ['zzz', 21, 0]] }, { props: [['logo', 15, -9], ['zzz', 21, 0]] }, { dy: 1, props: [['logo', 15, -9], ['zzz', 21, -2]] }, { dy: 1, props: [['logo', 15, -8], ['zzz', 21, -2]] }] },
  running: { ms: 150, base: { eyes: 'up', mouth: 'open' }, frames: [{ legs: 'stepA', armR: 'up', props: [['logo', 17, -8]] }, { dy: -1, armR: 'mid', mouth: 'smile', props: [['logo', 17, -9]] }, { legs: 'stepB', armR: 'up', props: [['logo', 17, -8]] }, { dy: -1, armR: 'mid', mouth: 'smile', props: [['logo', 17, -7]] }] },
  worried: { ms: 240, base: { eyes: 'up', mouth: 'wobble', brows: 'worried', armR: 'mid' }, frames: [{ props: [['logo', 16, -8], ['sweat', 13, 2], ['warn', 3, 2]] }, { dx: 1, armR: 'down', props: [['logo', 16, -9], ['sweat', 13, 3], ['warn', 3, 1]] }, { props: [['logo', 15, -10], ['sweat', 13, 4], ['warn', 3, 2]] }, { dx: -1, props: [['logo', 15, -9], ['sweat', 13, 5], ['warn', 3, 1]] }] },
  alarmed: { ms: 100, base: { eyes: 'wide', mouth: 'o' }, frames: [{ dx: -1, legs: 'stepA', armR: 'up', props: [['bang', 22, -1], ['speed', 0, 6], ['logo', 2, -9]] }, { dx: 1, legs: 'stepB', armR: 'down', props: [['speed', 1, 9], ['logo', 0, -10]] }] },
  success: { ms: 180, base: { eyes: 'shades', mouth: 'grin', armR: 'up' }, frames: [{ props: [['held', 19, 6], ['sparkle', 0, 2], ['heart', 21, -3]] }, { dy: -3, legs: 'tuck', armR: 'mid', props: [['held', 19, 6], ['sparkle', 21, -6], ['heart', 21, -6]] }, { dy: -4, legs: 'tuck', props: [['held', 19, 6], ['sparkle', 0, 12], ['heart', 0, -2]] }, { dy: -1, armR: 'mid', props: [['held', 19, 6], ['sparkle', 21, 14], ['heart', 0, -5]] }] },
  failed: { ms: 700, base: { eyes: 'dead', mouth: 'sad', armR: 'down', legs: 'splay', dy: 2, props: [['logo', 17, 17]] }, frames: [{}, { dy: 3 }] },
  peek: { ms: 220, base: { eyes: 'up', mouth: 'smile', armR: 'mid', props: [['logo', 15, -8]] }, frames: [{ dy: 12 }, { dy: 6 }, { armR: 'up' }, { eyes: 'blink' }] },
  bite: { ms: 200, base: { eyes: 'happy', armR: 'up' }, frames: [{ mouth: 'chomp', props: [['held', 20, 3]] }, { mouth: 'chew', dy: 1, props: [['held', 20, 5], ['crumb', 19, 12], ['crumb', 22, 14]] }] },
  cheer: { ms: 200, base: { eyes: 'happy', mouth: 'grin' }, frames: [{ armR: 'up', dy: -2, legs: 'tuck', props: [['logo', 16, -9], ['heart', 0, 0]] }, { armR: 'mid', props: [['logo', 16, -7], ['heart', 0, -2]] }] },
  gasp: { ms: 160, base: { eyes: 'wide', mouth: 'o', armR: 'face', legs: 'tuck', dx: -2 }, frames: [{ dy: -2, props: [['logo', 17, -6]] }, { dy: -1, props: [['logo', 17, -2]] }] },
  shrug: { ms: 420, base: { eyes: 'half', mouth: 'wobble', brows: 'raised', props: [['logo', 1, -9]] }, frames: [{ armR: 'down', props: [['question', 21, -3]] }, { armR: 'mid', props: [['question', 21, -4]] }] },
  rush: { ms: 120, base: { eyes: 'shades', mouth: 'grin', armR: 'up', legs: 'tuck', props: [['held', 19, 6], ['speed', 0, 8], ['speed', 0, 14]] }, frames: [{ dy: -3, flip: true, props: [['sparkle', 0, 2]] }, { dy: -4, props: [['sparkle', 21, 4]] }, { dy: -2, flip: true, props: [['sparkle', 0, 14]] }, { legs: 'stand', props: [['sparkle', 21, 16]] }] }
};

export const MASCOT_MOODS = ['waiting', 'running', 'worried', 'alarmed', 'success', 'failed'];
export const MASCOT_ACTIONS = ['peek', 'bite', 'cheer', 'gasp', 'shrug', 'rush'];
const ROAM = { running: 'roam', alarmed: 'roam-fast' };

export const LINES = {
  waiting: 'napping under the dbt logo while dbt parses.',
  running: 'chasing the dbt logo, one model per step.',
  worried: 'a warning showed up. The logo drifts away.',
  alarmed: 'something errored. The logo is getting away!',
  success: 'caught it! All green. Too cool for this build.',
  failed: 'face-planted. The logo fell. Fix the error to try again.',
  peek: 'a new dbt run just started.',
  bite: 'chomp, a model finished.',
  cheer: 'a test passed! Almost got it.',
  gasp: 'gasp, a node errored and the logo dropped.',
  shrug: 'a node was skipped. Shrug.',
  rush: 'every node done, zero errors. Victory spin!'
};

function paint(grid, rows, x, y) {
  rows.forEach((row, r) => {
    [...row].forEach((c, i) => {
      const gx = x + i;
      const gy = y + r + HEADROOM;
      if (c !== '.' && gy >= 0 && gy < grid.length && gx >= 0 && gx < SIZE) grid[gy][gx] = c;
    });
  });
}

function blank() {
  return Array.from({ length: SIZE + HEADROOM }, () => Array(SIZE).fill(null));
}

function rects(grid) {
  const out = [];
  grid.forEach((row, y) => {
    for (let x = 0; x < SIZE; ) {
      const c = row[x];
      let end = x + 1;
      while (end < SIZE && row[end] === c) end += 1;
      if (c) out.push(`<rect x="${x}" y="${y - HEADROOM}" width="${end - x}" height="1" fill="${PALETTE[c]}"/>`);
      x = end;
    }
  });
  return out.join('');
}

export function mascotSpec(name) {
  return SPEC[name] ?? SPEC.waiting;
}

export function frameOf(spec, index) {
  const f = { legs: 'stand', dx: 0, dy: 0, ...spec.base, ...spec.frames[index] };
  const props = [...(spec.base.props ?? []), ...(spec.frames[index].props ?? [])];
  const body = blank();
  const ground = blank();
  const [ax, ay, arm] = ARMS[f.armR];
  paint(body, LEGS[f.legs], 0, 20);
  paint(body, BODY, 0, 12);
  paint(body, HEAD, 0, 0);
  if (f.eyes === 'shades') paint(body, SHADES, 12, 4);
  else paint(body, EYES[f.eyes], 16, 4);
  paint(body, MOUTHS[f.mouth], 18, 8);
  if (f.brows) paint(body, ...BROWS[f.brows]);
  paint(body, arm, ax, ay);
  for (const [name, x, y] of props) paint(GROUND.has(name) ? ground : body, SPRITES[name], x, y);
  return { body, ground, dx: f.dx, dy: f.dy, flip: Boolean(f.flip) };
}

export function mascotSvg(name) {
  const spec = mascotSpec(name);
  const count = spec.frames.length;
  const frames = spec.frames.map((_, i) => {
    const f = frameOf(spec, i);
    const move = `translate(${f.dx} ${f.dy})${f.flip ? ` translate(${SIZE} 0) scale(-1 1)` : ''}`;
    return `<g class="pf" style="animation:pf${count} ${count * spec.ms}ms infinite;animation-delay:-${i * spec.ms}ms">${rects(f.ground)}<g transform="${move}">${rects(f.body)}</g></g>`;
  });
  return `<svg class="mascot" viewBox="0 -${HEADROOM} ${SIZE} ${SIZE + HEADROOM}" shape-rendering="crispEdges" role="img" aria-label="Pixel dinosaur mascot, ${name}">${frames.join('')}</svg>`;
}

export function roamOf(name) {
  return ROAM[name] ?? '';
}
