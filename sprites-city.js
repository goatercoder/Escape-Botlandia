/* sprites-city.js — Botlandia city art: business buildings, vehicles, street props and chapter palettes (extends `Sprites` with Sprites.CITY). */
(function (root) {
  'use strict';

  const Sprites = root.Sprites || (typeof require === 'function' ? require('./sprites.js') : null);
  if (!Sprites) throw new Error('sprites-city.js needs sprites.js loaded first');

  const U = Sprites.util;
  const P = Sprites.PALETTES;
  const blank = U.blank; const stamp = U.stamp; const patch = U.patch; const shift = U.shift;
  const flipH = U.flipH; const swapChars = U.swapChars; const sprite = U.sprite; const anim = U.anim;

  // ---------------------------------------------------------------------------
  // City colour vocabulary. Everything in sprites.js's BASE chars keeps its meaning
  // ('k' outline, 'b' blue, 'y' gold …); the city adds walls, glass, road and hill
  // chars so a building, a road tile and a far tower all read as one world.
  // 'L' is unlit window glass and 'l' is lit glass: the scene turns a building's
  // windows on at dusk with Sprites.withPalette(sprite, { L: CITY.COLORS.GLASS_LIT }).
  // ---------------------------------------------------------------------------
  const COLORS = {
    BRICK: '#a3543f', BRICK_DARK: '#6b3328',
    GLASS: '#1f2e5c', GLASS_LIT: '#ffd98a',
    ASPHALT: '#23273f', LANE: '#d8d3a0',
    SIDEWALK: '#5d6488', SIDEWALK_DARK: '#3e4566',
    RUST: '#b8683f', RUST_DARK: '#7a4127',
    STEEL: '#7481ab', STEEL_DARK: '#3d4a8a',
    HILL: '#4d8a3f', HILL_DARK: '#2d5a2c',
    SILHOUETTE: '#1a1f4d', SILHOUETTE_LIGHT: '#2a3170'
  };
  const CITY_CHARS = {
    x: COLORS.BRICK, X: COLORS.BRICK_DARK,
    L: COLORS.GLASS, l: COLORS.GLASS_LIT,
    q: COLORS.ASPHALT, Q: COLORS.LANE,
    j: COLORS.SIDEWALK, J: COLORS.SIDEWALK_DARK,
    u: COLORS.RUST, U: COLORS.RUST_DARK,
    f: COLORS.STEEL, F: COLORS.STEEL_DARK,
    H: COLORS.HILL, I: COLORS.HILL_DARK,
    z: COLORS.SILHOUETTE, Z: COLORS.SILHOUETTE_LIGHT
  };
  function cpal(over) { return U.pal(Object.assign({}, CITY_CHARS, over || {})); }
  // One shared palette object for most of the city, so variants made with
  // withPalette() memoise well and render() caches stay small.
  const CP = cpal();

  // ---------------------------------------------------------------------------
  // Text: sprites.js's 3×5 font covers the Machine's words; the city needs the rest
  // of the alphabet for shop signs.
  // ---------------------------------------------------------------------------
  const FONT = Object.assign({}, U.FONT, {
    B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['###', '#..', '#..', '#..', '###'],
    F: ['###', '#..', '##.', '#..', '#..'], G: ['###', '#..', '#.#', '#.#', '###'],
    K: ['#.#', '#.#', '##.', '#.#', '#.#'], M: ['#.#', '###', '#.#', '#.#', '#.#'],
    R: ['##.', '#.#', '##.', '#.#', '#.#'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
    W: ['#.#', '#.#', '#.#', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    Z: ['###', '..#', '.#.', '#..', '###'], J: ['###', '..#', '..#', '#.#', '###'],
    '.': ['...', '...', '...', '...', '.#.'], '!': ['.#.', '.#.', '.#.', '...', '.#.']
  });
  function text(str, ch) {
    const rows = ['', '', '', '', ''];
    for (let i = 0; i < str.length; i++) {
      const g = FONT[str[i]] || FONT[' '];
      for (let r = 0; r < 5; r++) rows[r] += (i ? '.' : '') + g[r].replace(/#/g, ch);
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Building kit (pure grid generators). Buildings are composed from these so the
  // five growth levels of each business share one vocabulary of walls, windows,
  // doors and signs instead of 70 hand-drawn grids.
  // ---------------------------------------------------------------------------
  function solid(w, h, ch) { const row = ch.repeat(w); const rows = []; for (let y = 0; y < h; y++) rows.push(row); return rows; }
  function rect(w, h, fill, edge) {
    edge = edge || 'k';
    const rows = [];
    for (let y = 0; y < h; y++) rows.push((y === 0 || y === h - 1) ? edge.repeat(w) : edge + fill.repeat(Math.max(0, w - 2)) + edge);
    return rows;
  }
  function stampAll(grid, layer, positions) { let g = grid; for (const p of positions) g = stamp(g, layer, p[0], p[1]); return g; }
  function pane(w, h, glass) { return rect(w, h, glass || 'L'); }
  function windowRow(grid, x0, y, n, ww, wh, gap, glass) {
    const pos = []; for (let i = 0; i < n; i++) pos.push([x0 + i * (ww + gap), y]);
    return stampAll(grid, pane(ww, wh, glass), pos);
  }
  // A door: outlined, dark, small pane at the top, gold knob.
  function doorGrid(w, h, fill) {
    let d = rect(w, h, fill || 'G');
    d = stamp(d, pane(w - 4, 3), 2, 2);
    return patch(d, [[Math.floor(h / 2) + 1, w - 3, 'y']]);
  }
  // Text in an outlined box: signBox('WASH', 'c', 'v') → 9 rows.
  function signBox(str, ch, bg, edge) {
    const t = text(str, ch); const w = t[0].length + 4;
    return stamp(rect(w, 9, bg, edge || 'k'), t, 2, 2);
  }
  // Striped awning with a scalloped hem (4 rows).
  function awning(w, a, b) {
    let s = ''; for (let i = 0; i < w; i++) s += (Math.floor(i / 2) % 2 ? b : a);
    s = 'k' + s.slice(1, -1) + 'k';
    let hem = ''; for (let i = 0; i < w; i++) hem += (i % 2 ? '.' : 'k');
    return ['k'.repeat(w), s, s, hem];
  }
  // Chain-link fence with a rail on top and a post every 8 px.
  function fence(w, h) {
    const rows = ['k'.repeat(w)];
    for (let y = 1; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) s += (x % 8 === 0 || x === w - 1) ? 'G' : (((x + y) % 2) ? 'g' : '.');
      rows.push(s);
    }
    return rows;
  }
  // Sawtooth factory roof: n teeth, each 8 wide, 4 rows.
  function sawtooth(n, fill, glass) {
    const rows = ['', '', '', ''];
    for (let i = 0; i < n; i++) {
      rows[0] += '......kk';
      rows[1] += '....kk' + glass + 'k';
      rows[2] += '..kk' + fill + fill + glass + 'k';
      rows[3] += 'kk' + fill + fill + fill + fill + glass + 'k';
    }
    return rows;
  }
  // Rounded hill mound, w×h, green with a darker shadow band at the bottom right.
  function hill(w, h) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      const t = 1 - y / (h - 1);                       // 1 at the top, 0 at the base
      const half = Math.round((w / 2 - 1) * Math.sqrt(1 - t * t)) + 1;
      const cx = w / 2;
      let s = '';
      for (let x = 0; x < w; x++) {
        const inside = Math.abs(x + 0.5 - cx) <= half;
        if (!inside) { s += '.'; continue; }
        const edge = Math.abs(x + 0.5 - cx) > half - 1 || y === 0;
        s += edge ? 'k' : (y > h * 0.6 && x > cx ? 'I' : 'H');
      }
      rows.push(s);
    }
    rows[h - 1] = rows[h - 1].replace(/[HI]/g, 'k');
    return rows;
  }
  // Steel lattice mast (w wide, h tall) in chrome, with an X brace every 4 rows.
  function lattice(w, h, ch, edge) {
    ch = ch || 'm'; edge = edge || 'M';
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const post = x === 0 || x === w - 1;
        const phase = y % 4;
        const inner = w - 2;
        const d = Math.round((phase / 3) * (inner - 1));
        const brace = (x - 1 === d) || (x - 1 === inner - 1 - d);
        s += post ? edge : (brace ? ch : '.');
      }
      rows.push(s);
    }
    rows[h - 1] = edge.repeat(w);
    return rows;
  }
  // A smokestack column (4 wide) with a red hazard band near the top.
  function stack(h) {
    let g = rect(4, h, 'G');
    return patch(g, [[1, 1, 'rr'], [2, 1, 'rr']]);
  }
  function levelsOf(fn) { const out = []; for (let i = 0; i < 5; i++) out.push(sprite(CP, fn(i))); return out; }
  function mkAnim(kind, frames, fps, at, extra) { return Object.assign(anim(CP, frames, fps), { kind: kind, at: at }, extra || {}); }

  // ---------------------------------------------------------------------------
  // VEHICLES (also used as building actors)
  // ---------------------------------------------------------------------------
  const VEHICLES = {};

  // hovercar 16×8: sleek body, tinted canopy, two thruster glows. Frame 2 bobs up a
  // pixel and the thrusters flare. Three colour variants via char swaps on 'b'/'B'.
  const hovercarA = [
    '.....kkkkkk.....',
    '....kLLLLLLk....',
    '..kkbLLLLLLbkk..',
    '.kbbbbbbbbbbbbk.',
    'kbbBBBBBBBBBBbbk',
    'kkkkkkkkkkkkkkkk',
    '..kck......kck..',
    '...c........c...'
  ];
  const hovercarB = [
    '....kkkkkk......',
    '...kLLLLLLk.....',
    '.kkbLLLLLLbkk...',
    'kbbbbbbbbbbbbk..',
    'kbBBBBBBBBBBbbk.',
    'kkkkkkkkkkkkkkk.',
    '.kcck.....kcck..',
    '..cc.......cc...'
  ];
  const hoverBlue = [hovercarA, shift(hovercarB, 1, 0)];
  VEHICLES.hovercar = [
    anim(CP, hoverBlue, 6),
    anim(CP, hoverBlue.map((g) => swapChars(g, { b: 'r', B: 'R' })), 6),
    anim(CP, hoverBlue.map((g) => swapChars(g, { b: 'y', B: 'Y' })), 6)
  ];

  // truck 24×12: orange box body with a serving hatch, a cab, two wheels (2 frames).
  const wheelA = ['.kk.', 'kGwk', 'kwGk', '.kk.'];
  const wheelB = ['.kk.', 'kwGk', 'kGwk', '.kk.'];
  const truckBody = [
    '.......kkkkkkkkkkkkkkkkk',
    '.......koooooooooooooook',
    '.......kokkkkkkkkkkkkkok',
    '.kkkkkkkokwwwwwwwwwwwkok',
    'kLLLLLLkokwyyywwwwwwwkok',
    'kLLLLLLkokwwwwwwwwwwwkok',
    'kggggggkokkkkkkkkkkkkkok',
    'kggggggkoooooooooooooook',
    'kggggggkOOOOOOOOOOOOOOOk',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    '........................',
    '........................'
  ];
  const truckA = stampAll(truckBody, wheelA, [[2, 8], [17, 8]]);
  const truckB = stampAll(truckBody, wheelB, [[2, 8], [17, 8]]);
  VEHICLES.truck = anim(CP, [truckA, truckB], 8);

  // bus 32×14: amber BOT-TRANSIT bus, glass strip, 'TRANSIT' on the flank
  // ("BOT-TRANSIT" in the 3×5 font is 43 px, wider than the bus; the label
  // property carries the full name).
  function busGrid(wheel) {
    let g = rect(32, 11, 'a');
    g = patch(g, [[1, 1, 'A'.repeat(30)]]);
    g = windowRow(g, 2, 2, 6, 4, 4, 1);
    g = stamp(g, text('TRANSIT', 'k'), 3, 6);
    g = stamp(g, pane(4, 4), 26, 2);
    g = patch(g, [[8, 28, 'r'], [8, 1, 'w']]);
    let full = blank(32, 14);
    full = stamp(full, g, 0, 0);
    full = stampAll(full, wheel, [[4, 10], [24, 10]]);
    return full;
  }
  VEHICLES.bus = Object.assign(anim(CP, [busGrid(wheelA), busGrid(wheelB)], 8), { label: 'BOT-TRANSIT' });

  // lambo 20×9: low red wedge, black glass, gold wheels. Frame 2 puffs exhaust.
  const lamboA = [
    '........kkkkkkk.....',
    '......kkLLLLLLLkk...',
    '....kkrrkkkkkkkrrkk.',
    '..kkrrrrrrrrrrrrrrrk',
    'kkrrrrrrrrrrrrrrrrrk',
    'krrrRRRRRRRRRRRRRRRk',
    'kkkkkkkkkkkkkkkkkkkk',
    '..kyyk........kyyk..',
    '...kk..........kk...'
  ];
  const lamboB = patch(lamboA, [[5, 0, 'W'], [6, 0, 'W']]);
  VEHICLES.lambo = anim(CP, [lamboA, lamboB], 4);

  // drone 12×8: two rotors on a grey body with a red eye; rotors alternate blur.
  const droneA = [
    'kWWk....kWWk',
    '.kk......kk.',
    '..kkkkkkkk..',
    '..kggggggk..',
    '..kgkrrkgk..',
    '..kggggggk..',
    '...kkkkkk...',
    '....k..k....'
  ];
  const droneB = patch(droneA, [[0, 0, '.kk......kk.'], [1, 0, 'kWWk....kWWk']]);
  VEHICLES.drone = anim(CP, [droneA, droneB], 12);
  // drone carrying a cardboard box (12×12).
  const boxSmall = ['kkkkkk', 'kttttk', 'ktTTtk', 'kkkkkk'];
  VEHICLES.drone_box = anim(CP, [droneA, droneB].map((g) => stamp(stamp(blank(12, 12), g, 0, 0), boxSmall, 3, 8)), 12);

  // cargoPod 10×14: orange/white parachute over a grey pod; the canopy sways.
  const chute = [
    '..kkkkkk..',
    '.kowowowk.',
    'kowowowowk',
    'kkkkkkkkkk',
    '.k......k.',
    '..k....k..',
    '...k..k...'
  ];
  const pod = [
    '..kkkkkk..',
    '.kggggggk.',
    '.kgyyyygk.',
    '.kggggggk.',
    '.kgggggk..',
    '..kkkkk...',
    '....kk....'
  ];
  const podA = stamp(stamp(blank(10, 14), chute, 0, 0), pod, 0, 7);
  const podB = stamp(stamp(blank(10, 14), shift(chute, 1, 0), 0, 0), pod, 0, 7);
  VEHICLES.cargoPod = anim(CP, [podA, podB], 2);

  // yacht 28×12: white hull with a blue stripe, cabin, mast flag, cyan hover glow.
  const yachtA = [
    '............k...............',
    '............krrk............',
    '............krrk............',
    '............k...............',
    '.......kkkkkkkkkkk..........',
    '.......kwwLLLLLwwk..........',
    'kkkkkkkkwwwwwwwwwkkkkkkkkkk.',
    'kwwwwwwwwwwwwwwwwwwwwwwwwwwk',
    'kbbbbbbbbbbbbbbbbbbbbbbbbbbk',
    '.kwwwwwwwwwwwwwwwwwwwwwwwwk.',
    '..kkkkkkkkkkkkkkkkkkkkkkkk..',
    '....c.....c.....c.....c.....'
  ];
  const yachtB = patch(shift(yachtA, 0, 1), [[11, 0, '.....c.....c.....c.....c....'], [0, 12, 'k']]);
  VEHICLES.yacht = anim(CP, [yachtA, yachtB], 2);

  // hoverbike 12×8: chrome bike with a red seat and a cyan skid underneath.
  VEHICLES.hoverbike = sprite(CP, [
    '.......kkk..',
    '..kkk.kmmk..',
    '.krrrkkmmk..',
    'kmmmmmmmmmk.',
    'kmMMMMMMMMmk',
    '.kkkkkkkkkk.',
    '..kck..kck..',
    '...c....c...'
  ]);

  // ---------------------------------------------------------------------------
  // PROPS shared by buildings (defined early so buildings can reuse them)
  // ---------------------------------------------------------------------------
  const PROPS = {};

  // smoke 8×10, 3 frames: a puff rising and spreading.
  PROPS.smoke = anim(CP, [
    ['........', '........', '........', '........', '........', '...kk...', '..kggk..', '..kggk..', '...kk...', '........'],
    ['........', '........', '...kk...', '..kWWk..', '.kWggWk.', '.kgggWk.', '..kggk..', '...kk...', '........', '........'],
    ['..kkk...', '.kWWWk..', 'kWWggWk.', 'kWgggWk.', '.kgggk..', '..kkk...', '........', '........', '........', '........']
  ], 4);
  // spark 4×4, 2 frames.
  PROPS.spark = anim(CP, [
    ['.y..', 'yw.y', '.ywy', '..y.'],
    ['y..w', '.yy.', '.wy.', 'y..y']
  ], 12);
  // dust puff 12×8, 3 frames (appears when a building lands on its plot).
  PROPS.dust = anim(CP, [
    ['............', '............', '............', '............', '....WW.WW...', '...WWWWWWW..', '..WWWWWWWWW.', '............'],
    ['............', '............', '..WW....WW..', '.WWWW..WWWW.', 'WWWWW..WWWWW', 'WWW......WWW', '.W........W.', '............'],
    ['.W........W.', 'WW........WW', 'W..........W', '............', '............', '............', '............', '............']
  ], 8);
  // crane 20×28 (yellow tower crane, sits on a Pod Tower roof or beside a plot).
  const craneRows = (function () {
    let g = blank(20, 28);
    g = stamp(g, lattice(4, 26, 'y', 'Y'), 14, 2);           // mast
    g = stamp(g, ['kkkkkkkkkkkkkkkkkkkk', 'kyyyyyyyyyyyyyyyyyyk', 'kkkkkkkkkkkkkkkkkkkk'], 0, 0); // jib + counter-jib
    g = stamp(g, ['kkkk', 'kGGk', 'kkkk'], 15, 3);           // cab
    g = stamp(g, solid(1, 9, 'k'), 4, 3);                     // cable
    g = stamp(g, ['.k.', 'kkk', 'k.k'], 3, 12);               // hook
    g = stamp(g, ['kkkkkk', 'kGGGGk', 'kkkkkk'], 13, 25);     // base plate
    return g;
  })();
  PROPS.crane = sprite(CP, craneRows);

  // solar panel tile 8×6 (also the Solar Farm's panel).
  const panelTile = ['kkkkkkkk', 'kbBbBbBk', 'kBbBbBbk', 'kbBbBbBk', 'kkkkkkkk', '.k....k.'];
  PROPS.solar_panel = sprite(CP, panelTile);

  // ---------------------------------------------------------------------------
  // BUILDINGS — CITY.buildings[businessId] = { levels[5], anim, actors, door[5] }
  // levels[i] is the sprite at 1 / 10 / 25 / 50 / 100 owned. Every building stands
  // on its bottom row; `door[i]` is the x of the entrance for customer bots.
  // `anim` is an animated overlay sprite (works with Sprites.frame/draw) with
  // `at[i]` = list of [x, y] offsets, relative to the level's top-left, to draw it at.
  // ---------------------------------------------------------------------------
  const BUILDINGS = {};

  // 1. battery — Bootleg Battery Stand: cardboard counter under a gold/white awning,
  // battery cells on the counter, a hanging sign whose battery icon blinks. Grows a
  // header sign, a second counter, neon and a solar roof.
  const cell = ['.kk.', 'knnk', 'kNNk', 'kkkk'];
  const battIconOn = ['.kk.', 'kkkk', 'knnk', 'knnk', 'kkkk'];
  const battIconOff = ['.kk.', 'kkkk', 'kGGk', 'kGGk', 'kkkk'];
  const battAt = [];
  function batteryGrid(i) {
    const W = [16, 20, 26, 32, 40][i]; const H = [14, 22, 24, 28, 34][i];
    let g = blank(W, H);
    let y = 0;
    if (i >= 4) { g = stampAll(g, panelTile, [[4, 0], [12, 0], [20, 0], [28, 0]]); y = 6; }
    if (i >= 1) {
      const sb = i >= 3 ? signBox('BATT', 'i', 'v') : signBox('BATT', 'k', 'w');
      g = stamp(g, sb, Math.floor((W - sb[0].length) / 2), y);
      y += 8;
    }
    g = stamp(g, awning(W, 'y', 'w'), 0, y);
    const poleTop = y + 4; const tableY = H - 6;
    g = stamp(g, solid(2, tableY - poleTop, 'T'), 1, poleTop);
    g = stamp(g, solid(2, tableY - poleTop, 'T'), W - 3, poleTop);
    g = stamp(g, rect(W - 2, 6, 't'), 1, tableY);
    g = patch(g, [[tableY + 3, 2, 'T'.repeat(W - 4)]]);
    // battery cells on the counter, more per level
    const n = [2, 3, 4, 5, 7][i];
    for (let c = 0; c < n; c++) g = stamp(g, cell, 5 + c * 5, tableY - 4);
    // the hanging sign with the blinking icon
    const sx = Math.floor(W / 2) - 3;
    g = stamp(g, rect(6, 7, 'w'), sx, poleTop);
    battAt.push([[sx + 1, poleTop + 1]]);
    if (i >= 2) g = patch(g, [[poleTop, 4, 'k.k.k.k'], [poleTop, W - 11, 'k.k.k.k']]); // string lights hooks
    if (i >= 3) g = patch(g, [[poleTop + 1, 4, 'y.y.y.y'], [poleTop + 1, W - 11, 'y.y.y.y']]);
    return g;
  }
  BUILDINGS.battery = {
    levels: levelsOf(batteryGrid),
    anim: mkAnim('blink', [battIconOn, battIconOff], 2, battAt),
    actors: { customer: Sprites.BOTS.customer },
    door: [8, 10, 13, 16, 20]
  };

  // 2. vending — Vending Bot: blue machines with lit product panels under a canopy;
  // the panel glows. Grows into a brick kiosk and a two-storey VEND-O store.
  const vendingMachine = [
    'kkkkkkkkkk',
    'kbbbbbbbbk',
    'kbkkkkkkbk',
    'kbkLLLLkbk',
    'kbkrLyLkbk',
    'kbkLLLLkbk',
    'kbknLrLkbk',
    'kbkLLLLkbk',
    'kbkkkkkkbk',
    'kbbbkykbbk',
    'kbbbbbbbbk',
    'kbkkkkkkbk',
    'kbkGGGGkbk',
    'kbkkkkkkbk',
    'kbbbbbbbbk',
    'kkkkkkkkkk'
  ];
  const vendPanelDim = ['LLLL', 'rLyL', 'LLLL', 'nLrL', 'LLLL'];
  const vendPanelLit = ['llll', 'rlyl', 'llll', 'nlrl', 'llll'];
  const vendAt = [];
  function vendingGrid(i) {
    const W = [14, 24, 36, 48, 60][i]; const H = [20, 20, 28, 34, 54][i]; // level 4 is tall enough for its VEND-O sign
    const n = [1, 2, 3, 4, 5][i];
    let g = blank(W, H);
    const at = [];
    if (i <= 2) {
      let y = 0;
      if (i === 2) { const sb = signBox('VEND', 'c', 'v'); g = stamp(g, sb, Math.floor((W - sb[0].length) / 2), 0); y = 8; }
      g = stamp(g, ['k'.repeat(W), 'k' + 'b'.repeat(W - 2) + 'k', 'k'.repeat(W)], 0, y);
      g = stamp(g, solid(1, H - y - 3, 'k'), 0, y + 3);
      g = stamp(g, solid(1, H - y - 3, 'k'), W - 1, y + 3);
      for (let m = 0; m < n; m++) {
        const x = 2 + m * 11; g = stamp(g, vendingMachine, x, H - 16); at.push([x + 3, H - 13]);
      }
    } else {
      // a kiosk building with the machines set into the front wall
      const storeys = i === 3 ? 1 : 2;
      const wallH = 20 * storeys + 4;
      g = stamp(g, rect(W, wallH, 'x'), 0, H - wallH);
      g = patch(g, [[H - wallH + 1, 1, 'X'.repeat(W - 2)]]);
      if (storeys === 2) g = windowRow(g, 4, H - wallH + 4, Math.floor((W - 6) / 10), 6, 8, 4);
      const sb = signBox(i === 4 ? 'VEND-O' : 'VEND', 'c', 'v', 'i');
      g = stamp(g, sb, Math.floor((W - sb[0].length) / 2), H - wallH - 8);
      g = stamp(g, ['k'.repeat(W), 'k' + 'c'.repeat(W - 2) + 'k', 'k'.repeat(W)], 0, H - 20);
      for (let m = 0; m < n; m++) {
        const x = 3 + m * 11; g = stamp(g, vendingMachine, x, H - 16); at.push([x + 3, H - 13]);
      }
      if (i === 4) g = stamp(g, ['..kk..', '.kccK.', 'kc..ck', 'kkkkkk'].map((r) => r.replace('K', 'k')), W - 10, 0);
    }
    vendAt.push(at);
    return g;
  }
  BUILDINGS.vending = {
    levels: levelsOf(vendingGrid),
    anim: mkAnim('glow', [vendPanelDim, vendPanelLit], 2, vendAt),
    actors: {
      customer: Sprites.BOTS.customer,
      can: sprite(CP, ['kkk', 'krk', 'kRk', 'kkk'])
    },
    door: [7, 7, 7, 8, 8]
  };

  // 3. laundro — Wash-o-Tron Laundromat: beige storefront with chrome porthole
  // drums that spin, a cyan WASH sign, more storeys and portholes as it grows.
  const porthole = [
    '..kkkk..',
    '.kmmmmk.',
    'kmLLLLmk',
    'kmLLLLmk',
    'kmLLLLmk',
    'kmLLLLmk',
    '.kmmmmk.',
    '..kkkk..'
  ];
  const drumFrames = [
    ['LwwL', 'LwwL', 'LwwL', 'LwwL'],
    ['LLLw', 'LLwL', 'LwLL', 'wLLL'],
    ['LLLL', 'wwww', 'wwww', 'LLLL'],
    ['wLLL', 'LwLL', 'LLwL', 'LLLw']
  ].map((f) => patch(f, [[0, 0, 'c']]));
  const laundroAt = [];
  function laundroGrid(i) {
    const W = [24, 32, 40, 44, 52][i]; const H = [22, 24, 26, 38, 50][i];
    const storeys = [1, 1, 1, 2, 3][i];
    const holes = [1, 2, 3, 3, 4][i];
    let g = blank(W, H);
    const wallH = 14 + 12 * (storeys - 1) + 2;
    const top = H - wallH;
    g = stamp(g, rect(W, wallH, 'd'), 0, top);
    g = patch(g, [[H - 2, 1, 'D'.repeat(W - 2)], [top + 1, 1, 'D'.repeat(W - 2)]]);
    for (let s = 1; s < storeys; s++) {
      g = windowRow(g, 3, top + 3 + (s - 1) * 12, Math.floor((W - 4) / 9), 6, 7, 3);
      g = patch(g, [[top + 11 + (s - 1) * 12, 1, 'D'.repeat(W - 2)]]);
    }
    const gy = H - 13;                                     // ground floor top
    const at = [];
    for (let h = 0; h < holes; h++) { const x = 2 + h * 9; g = stamp(g, porthole, x, gy); at.push([x + 2, gy + 2]); }
    laundroAt.push(at);
    g = stamp(g, doorGrid(8, 12, 'G'), W - 10, H - 13);
    const sb = signBox('WASH', 'c', 'v');
    g = stamp(g, sb, Math.floor((W - sb[0].length) / 2), top - 8);
    if (i >= 2) g = stamp(g, awning(W - 2, 'c', 'w'), 1, top + 2 + 12 * (storeys - 1) - (storeys > 1 ? 1 : 0));
    if (i >= 4) g = stamp(g, ['.kk.', 'kggk', 'kggk', 'kkkk'], W - 8, top - 4); // rooftop vent
    return g;
  }
  BUILDINGS.laundro = {
    levels: levelsOf(laundroGrid),
    anim: mkAnim('spin', drumFrames, 6, laundroAt),
    actors: { customer: Sprites.BOTS.customer },
    door: [18, 26, 34, 38, 46]
  };

  // 4. truck — Paste Truck: the food truck with a serving awning and a menu; grows
  // stools, string lights, a second truck and finally a paste depot behind.
  const stool = ['.kk.', 'kyyk', '.kk.', '.GG.', '.GG.'];
  const truckAt = [];
  function truckGrid(i) {
    const W = [26, 34, 40, 52, 60][i]; const H = [16, 18, 22, 22, 34][i];
    let g = blank(W, H);
    const at = [];
    if (i === 4) {
      g = stamp(g, rect(W - 4, 20, 'x'), 2, 0);
      g = patch(g, [[1, 3, 'X'.repeat(W - 6)]]);
      g = windowRow(g, 5, 4, Math.floor((W - 8) / 9), 6, 6, 3);
      const sb = signBox('PASTE', 'y', 'v');
      g = stamp(g, sb, Math.floor((W - sb[0].length) / 2), 11);
      g = stampAll(g, stack(8), [[W - 10, -2]]);
    } else if (i >= 2) {
      const sb = signBox('PASTE', 'y', 'v');
      g = stamp(g, sb, 1, 0);
      g = patch(g, [[8, 26, 'k.k.k.k.k.k'], [9, 26, 'y.y.y.y.y.y']]);
    }
    const ty = H - 12;
    g = stamp(g, awning(14, 'r', 'w'), 8, ty - 3);
    g = stamp(g, truckA, 0, ty); at.push([12, ty - 6]);
    if (i >= 1) g = stampAll(g, stool, [[25, H - 5], [30, H - 5]]);
    if (i >= 3) { g = stamp(g, awning(14, 'r', 'w'), W - 18, ty - 3); g = stamp(g, truckA, W - 26, ty); at.push([W - 14, ty - 6]); }
    truckAt.push(at);
    return g;
  }
  BUILDINGS.truck = {
    levels: levelsOf(truckGrid),
    anim: mkAnim('steam', PROPS.smoke.frames, 4, truckAt),
    actors: { truck: VEHICLES.truck, customer: Sprites.BOTS.customer },
    door: [14, 14, 14, 14, 14]
  };

  // 5. carlot — Hover-Car Lot: chain-link fence, pennant string, parked hover-cars,
  // a sales booth, a pole sign and finally a glass showroom.
  const pennantsA = ['r.y.b.r.', 'r.y.b.r.', '........'];
  const pennantsB = ['........', 'r.y.b.r.', 'r.y.b.r.'];
  const carlotAt = [];
  function carlotGrid(i) {
    const W = [28, 40, 52, 60, 72][i]; const H = [16, 22, 26, 30, 40][i];
    const cars = [1, 2, 3, 4, 4][i];
    let g = blank(W, H);
    const at = [];
    if (i === 4) {
      g = stamp(g, rect(28, 26, 'f'), W - 30, H - 26);
      g = stamp(g, pane(24, 10), W - 28, H - 24);
      g = stamp(g, hovercarA, W - 24, H - 20);
      g = stamp(g, doorGrid(8, 12, 'L'), W - 12, H - 13);
      const sb = signBox('HOVER', 'c', 'v');
      g = stamp(g, sb, W - 30 + Math.floor((28 - sb[0].length) / 2), H - 36);
    } else if (i >= 2) {
      const sb = signBox('HOVER', 'c', 'v');
      g = stamp(g, sb, W - 26, 0);
      g = stamp(g, solid(2, H - 9 - 1, 'G'), W - 16, 9);
    }
    const fenceW = i === 4 ? W - 32 : W;
    if (i >= 1) {
      g = stamp(g, ['k'.repeat(fenceW)], 0, H - 15);
      for (let x = 0; x + 8 <= fenceW; x += 8) at.push([x, H - 14]);
    }
    g = stamp(g, fence(fenceW, 8), 0, H - 12);
    if (i >= 2) g = stamp(g, stamp(rect(10, 10, 'd'), pane(6, 4), 2, 2), fenceW - 12, H - 14);
    for (let c = 0; c < cars; c++) g = stamp(g, hovercarA, 2 + c * 14, H - 9);
    carlotAt.push(at);
    return g;
  }
  BUILDINGS.carlot = {
    levels: levelsOf(carlotGrid),
    anim: mkAnim('flap', [pennantsA, pennantsB], 3, carlotAt),
    actors: { hovercar: VEHICLES.hovercar },
    door: [26, 34, 46, 54, 64]
  };

  // 6. podtower — Pod Tower: built from parts (base, floor, roof, crane). Each floor
  // is three identical pods with porthole windows; the crane rides the roof.
  const podBase = [
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kffffffffffffffffffffffk',
    'kfkkkkkkffkkkkkkffkkkkfk',
    'kfkLLLLkffkLLLLkffkLLkfk',
    'kfkLLLLkffkLLLLkffkLLkfk',
    'kfkLLLLkffkLkkLkffkLLkfk',
    'kfkLLLLkffkLLLLkffkLLkfk',
    'kfkkkkkkffkLLLLkffkkkkfk',
    'kfnnnnnfffkLLLLkfffnnnnk',
    'kfnNNNnfffkLLLLkfffnNNnk',
    'kfkkkkkfffkkkkkkfffkkkkk',
    'kkkkkkkkkkkkkkkkkkkkkkkk'
  ];
  const podFloor = [
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kffffffkkffffffkkffffffk',
    'kfkLLLkffkLLLkffkLLLkffk',
    'kfkLLLkffkLLLkffkLLLkffk',
    'kfkkkkkffkkkkkffkkkkkffk',
    'kFFFFFFkkFFFFFFkkFFFFFFk'
  ];
  const podRoof = [
    '.....kk.........kkkk....',
    '.....kk.........kggk....',
    'kkkkkkkkkkkkkkkkkggkkkkk',
    'kfffffffffffffffkkkkffFk',
    'kfnnnnnnnfffffffffffffFk',
    'kkkkkkkkkkkkkkkkkkkkkkkk'
  ];
  const podParts = {
    base: sprite(CP, podBase), floor: sprite(CP, podFloor), roof: sprite(CP, podRoof), crane: PROPS.crane
  };
  const podCache = {};
  // podTower(floors, withCrane) → grid; memoised so scene code can call it per frame.
  function podTowerGrid(floors, withCrane) {
    const key = floors + ':' + (withCrane ? 1 : 0);
    if (podCache[key]) return podCache[key];
    const towerH = podBase.length + podFloor.length * floors + podRoof.length;
    const craneH = withCrane ? craneRows.length - 2 : 0;
    const W = withCrane ? 32 : 24;
    let g = blank(W, towerH + craneH);
    g = stamp(g, podRoof, 0, craneH);
    for (let i = 0; i < floors; i++) g = stamp(g, podFloor, 0, craneH + podRoof.length + i * podFloor.length);
    g = stamp(g, podBase, 0, craneH + towerH - podBase.length);
    if (withCrane) g = stamp(g, craneRows, 12, 0);
    podCache[key] = g;
    return g;
  }
  const podFloors = [1, 2, 3, 5, 10];
  const podAt = podFloors.map((n, i) => {
    const withCrane = i >= 2;
    const craneH = withCrane ? craneRows.length - 2 : 0;
    const out = [];
    for (let f = 0; f < n; f++) {
      const y = craneH + podRoof.length + f * podFloor.length + 2;
      out.push([3, y], [10, y], [17, y]);
    }
    return out;
  });
  const podWindowDim = ['LLL', 'LLL'];
  const podWindowLit = ['lll', 'lll'];
  BUILDINGS.podtower = {
    levels: podFloors.map((n, i) => sprite(CP, podTowerGrid(n, i >= 2))),
    parts: podParts,
    build: function (floors, withCrane) { return sprite(CP, podTowerGrid(Math.max(1, Math.min(12, floors | 0)), !!withCrane)); },
    anim: mkAnim('windows', [podWindowDim, podWindowLit], 0.5, podAt),
    actors: {},
    door: [12, 12, 12, 12, 12]
  };

  // 7. datafarm — Data Farm: dark server block with rack windows whose LED rows
  // scroll; cyan trim glows at night. Adds storeys, cooling fans and a dish.
  const rack = ['kkkkkkkk', 'kvvvvvvk', 'kvvvvvvk', 'kvvvvvvk', 'kvvvvvvk', 'kkkkkkkk'];
  const ledFrames = [
    ['n.n.n.', '.n.n.n', 'n.n.n.', 'N.N.N.'],
    ['.n.n.n', 'n.n.n.', 'N.N.N.', 'n.n.n.'],
    ['n.n.n.', 'N.N.N.', 'n.n.n.', '.n.n.n'],
    ['N.N.N.', 'n.n.n.', '.n.n.n', 'n.n.n.']
  ];
  const fan = ['kkkkkk', 'kgkkgk', 'kkGGkk', 'kkGGkk', 'kgkkgk', 'kkkkkk'];
  const dataAt = [];
  function datafarmGrid(i) {
    const W = [28, 36, 44, 52, 60][i]; const H = [20, 24, 34, 46, 58][i];
    const storeys = [1, 1, 2, 3, 4][i];
    let g = blank(W, H);
    const wallH = 4 + storeys * 10 + 4;
    const top = H - wallH;
    g = stamp(g, rect(W, wallH, 'G'), 0, top);
    g = patch(g, [[top + 1, 1, 'c'.repeat(W - 2)], [H - 2, 1, 'c'.repeat(W - 2)]]);
    const at = [];
    const perRow = Math.floor((W - 6) / 10);
    for (let s = 0; s < storeys; s++) {
      const y = top + 4 + s * 10;
      for (let r = 0; r < perRow; r++) { const x = 4 + r * 10; g = stamp(g, rack, x, y); at.push([x + 1, y + 1]); }
    }
    dataAt.push(at);
    g = stamp(g, doorGrid(8, 10, 'G'), W - 12, H - 11);
    if (i >= 3) g = stampAll(g, fan, [[4, top - 6], [12, top - 6]]);
    if (i >= 4) g = stamp(g, ['....kkkk', '..kkwwwwk', '.kwwwwwwk', '.kkkkkkk.', '....kk...', '....kk...'].map((r) => r.padEnd(9, '.')), W - 14, top - 6);
    if (i >= 1) { const sb = signBox('DATA', 'n', 'v'); g = stamp(g, sb, 2, top - 8 - (i >= 3 ? 0 : 0)); }
    return g;
  }
  BUILDINGS.datafarm = {
    levels: levelsOf(datafarmGrid),
    anim: mkAnim('scroll', ledFrames, 6, dataAt),
    actors: {},
    door: [20, 28, 36, 44, 52]
  };

  // 8. drones — Drone Fleet Logistics: steel hub with landing pads on the roof (an
  // 'H' on a grey disc and a blinking red beacon); drones lift off carrying boxes.
  const padTile = [
    '...kkkkkkkk...',
    '.kkggggggggkk.',
    'kggygggggygggk',
    'kggyyyyyyygggk',
    'kggygggggygggk',
    '.kkggggggggkk.',
    '...kkkkkkkk...'
  ];
  const beaconOn = ['.k.', 'krk', 'kkk'];
  const beaconOff = ['.k.', 'kRk', 'kkk'];
  const dronesAt = [];
  function dronesGrid(i) {
    const W = [28, 36, 44, 52, 64][i]; const H = [18, 24, 30, 40, 48][i];
    const pads = [1, 2, 2, 3, 4][i];
    const storeys = [1, 1, 2, 3, 3][i];
    let g = blank(W, H);
    const wallH = 4 + storeys * 8;
    const top = H - wallH;
    g = stamp(g, rect(W, wallH, 'f'), 0, top);
    g = patch(g, [[top + 1, 1, 'F'.repeat(W - 2)]]);
    for (let s = 1; s < storeys; s++) g = windowRow(g, 3, top + 3 + (s - 1) * 8, Math.floor((W - 4) / 8), 5, 4, 3);
    g = stamp(g, ['kkkkkkkkkkkk', 'kGGGGGGGGGGk', 'kGgGgGgGgGGk', 'kGGGGGGGGGGk', 'kGgGgGgGgGGk', 'kGGGGGGGGGGk', 'kkkkkkkkkkkk'], 2, H - 8); // roll door
    const at = [];
    for (let p = 0; p < pads; p++) {
      const x = 2 + p * 15;
      g = stamp(g, padTile, x, top - 3);
      at.push([x + 12, top - 5]);
    }
    if (i >= 3) { g = stamp(g, lattice(4, 12, 'm', 'M'), W - 6, top - 12); at.push([W - 5, top - 15]); }
    if (i >= 1) { const sb = signBox('DRONE', 'y', 'v'); g = stamp(g, sb, W - sb[0].length - 1, H - 20); }
    dronesAt.push(at);
    return g;
  }
  BUILDINGS.drones = {
    levels: levelsOf(dronesGrid),
    anim: mkAnim('beacon', [beaconOn, beaconOff], 2, dronesAt),
    actors: { drone: VEHICLES.drone, drone_box: VEHICLES.drone_box },
    door: [8, 8, 8, 8, 8]
  };

  // 9. repair — Bot Repair Franchise: brick garage with ribbed roll-up doors, a
  // wrench sign and welding sparks at the open bay; broken bots queue outside.
  const rollDoor = (function () {
    let d = rect(12, 12, 'g');
    for (let y = 2; y < 11; y += 2) d = patch(d, [[y, 1, 'G'.repeat(10)]]);
    return patch(d, [[9, 1, 'kkkkkkkkkk'], [10, 1, 'vvvvvvvvvv']]); // last panel raised: dark bay inside
  })();
  const wrench = ['k.k', 'kkk', '.k.', '.k.', '.k.'];
  const repairAt = [];
  function repairGrid(i) {
    const W = [28, 40, 52, 60, 68][i]; const H = [28, 30, 32, 32, 44][i]; // room above the roof for the FIX sign
    const bays = [1, 2, 2, 3, 3][i];
    const storeys = [1, 1, 1, 1, 2][i];
    let g = blank(W, H);
    const wallH = 16 + (storeys - 1) * 12;
    const top = H - wallH;
    g = stamp(g, rect(W, wallH, 'x'), 0, top);
    g = patch(g, [[top + 1, 1, 'X'.repeat(W - 2)]]);
    if (storeys > 1) g = windowRow(g, 3, top + 3, Math.floor((W - 4) / 9), 6, 7, 3);
    const at = [];
    for (let b = 0; b < bays; b++) { const x = 2 + b * 14; g = stamp(g, rollDoor, x, H - 13); at.push([x + 3, H - 6]); }
    repairAt.push(at);
    if (i >= 2) { g = stamp(g, pane(8, 6), W - 12, H - 12); g = stamp(g, doorGrid(6, 8, 'G'), W - 20, H - 9); }
    const sb = i >= 3 ? signBox('FIX-IT', 'o', 'v') : signBox('FIX', 'o', 'v');
    g = stamp(g, sb, Math.floor((W - sb[0].length) / 2), top - 8);
    g = stamp(g, swapChars(wrench, { k: 'm' }), W - 5, top - 6);
    return g;
  }
  const brokenA = patch(swapChars(Sprites.BOTS.worker.frames[0], { c: 'r' }), [[0, 5, '..'], [1, 5, 'k.'], [4, 6, 'kk'], [5, 5, 'kr'], [10, 4, 'kkkkGk']]);
  const brokenB = patch(swapChars(Sprites.BOTS.worker.frames[1], { c: 'r' }), [[0, 5, '..'], [1, 5, 'k.'], [4, 6, 'kk'], [5, 5, 'kr'], [10, 4, 'kkkkGk']]);
  const fixedFrames = Sprites.BOTS.worker.frames.map((f) => patch(f, [[5, 4, 'nkkn'], [6, 4, 'knnk']]));
  BUILDINGS.repair = {
    levels: levelsOf(repairGrid),
    anim: mkAnim('sparks', PROPS.spark.frames, 12, repairAt),
    actors: {
      spark: PROPS.spark,
      broken: anim(CP, [brokenA, brokenB], 3),
      fixed: anim(CP, fixedFrames, 4)
    },
    door: [8, 8, 8, 8, 8]
  };

  // 10. solar — Solar Farm: blue panel rows on a green hill; a white glint sweeps
  // across the panels by day. Adds rows, an inverter shed and a pylon.
  const glintFrames = [
    ['w.......', '.w......', '........', '........', '........', '........'],
    ['..w.....', '...w....', '....w...', '........', '........', '........'],
    ['........', '.....w..', '......w.', '.......w', '........', '........'],
    ['........', '........', '........', '........', '........', '........']
  ];
  const solarAt = [];
  function solarGrid(i) {
    const W = [32, 40, 52, 60, 72][i]; const H = [16, 18, 22, 28, 36][i];
    const rowsN = [1, 1, 2, 3, 3][i]; const perRow = [2, 4, 4, 5, 6][i];
    let g = blank(W, H);
    g = stamp(g, hill(W, Math.min(H, 8 + rowsN * 4)), 0, H - Math.min(H, 8 + rowsN * 4));
    const at = [];
    for (let r = 0; r < rowsN; r++) {
      const y = H - 8 - r * 5 - 2;
      const n = perRow - r;
      const x0 = Math.floor((W - n * 10) / 2) + r * 2;
      for (let c = 0; c < n; c++) { const x = x0 + c * 10; g = stamp(g, panelTile, x, y); at.push([x, y]); }
    }
    solarAt.push(at);
    if (i >= 3) g = stamp(g, stamp(rect(8, 7, 'g'), ['kk', 'yk', 'kk'], 3, 2), W - 10, H - 8);
    if (i >= 4) g = stamp(g, lattice(6, 20, 'm', 'M'), 2, H - 22);
    if (i >= 1) { const sb = signBox('SOLAR', 'y', 'v'); g = stamp(g, sb, 0, 0); }
    return g;
  }
  BUILDINGS.solar = {
    levels: levelsOf(solarGrid),
    anim: mkAnim('glint', glintFrames, 3, solarAt),
    actors: {},
    door: [16, 20, 26, 30, 36]
  };

  // 11. casino — Neon Vault Casino: purple hall, gold VAULT sign, a marquee of
  // chasing bulbs, double doors and gambling-bot silhouettes; grows a tower + dome.
  const bulbFrames = [
    ['yYYyYY', 'kkkkkk'],
    ['YyYYyY', 'kkkkkk'],
    ['YYyYYy', 'kkkkkk']
  ];
  const dice = ['kkkkk', 'kwkwk', 'kwwwk', 'kwkwk', 'kkkkk'];
  const casinoAt = [];
  function casinoGrid(i) {
    const W = [32, 40, 48, 56, 64][i]; const H = [22, 28, 38, 50, 64][i];
    const storeys = [1, 1, 2, 3, 3][i];
    let g = blank(W, H);
    const wallH = 16 + (storeys - 1) * 10;
    const top = H - wallH;
    if (i >= 3) {
      const tw = 20; const th = H - wallH + 4;
      g = stamp(g, rect(tw, th, 'p'), Math.floor((W - tw) / 2), 0);
      g = windowRow(g, Math.floor((W - tw) / 2) + 3, 8, 2, 6, 8, 2);
      g = stamp(g, ['....kkkk....', '..kkyyyykk..', '.kyyyyyyyyk.', 'kyyyyyyyyyyk', 'kkkkkkkkkkkk'], Math.floor((W - 12) / 2), 0);
      if (i === 4) g = patch(g, [[0, 0, 'w'], [1, 1, 'w'], [2, 2, 'w'], [0, W - 1, 'w'], [1, W - 2, 'w'], [2, W - 3, 'w']]);
    }
    g = stamp(g, rect(W, wallH, 'p'), 0, top);
    g = patch(g, [[top + 1, 1, 'P'.repeat(W - 2)]]);
    for (let s = 1; s < storeys; s++) g = windowRow(g, 3, top + 3 + (s - 1) * 10, Math.floor((W - 4) / 8), 5, 6, 3);
    const sb = signBox('VAULT', 'y', 'v', 'i');
    const sx = Math.floor((W - sb[0].length) / 2);
    g = stamp(g, sb, sx, H - 15 - 8);
    // marquee: a lit strip above the doors
    const my = H - 15;
    const at = [];
    for (let x = 0; x + 6 <= W; x += 6) at.push([x, my]);
    casinoAt.push(at);
    g = stamp(g, ['k'.repeat(W), 'k'.repeat(W)], 0, my);
    g = stamp(g, doorGrid(6, 12, 'L'), Math.floor(W / 2) - 6, H - 13);
    g = stamp(g, doorGrid(6, 12, 'L'), Math.floor(W / 2), H - 13);
    g = stamp(g, dice, 3, H - 8);
    g = stamp(g, dice, W - 8, H - 8);
    return g;
  }
  BUILDINGS.casino = {
    levels: levelsOf(casinoGrid),
    anim: mkAnim('chase', bulbFrames, 8, casinoAt),
    actors: { gambler: anim(CP, Sprites.BOTS.worker.frames.map((f) => swapChars(f, { g: 'z', G: 'z', c: 'i', k: 'z' })), 4) },
    door: [16, 20, 24, 28, 32]
  };

  // 12. signal — Signal Network: chrome lattice broadcast tower with pulsing rings,
  // an equipment shed, a dish and a billboard (the scene draws the avatar in its slot).
  const ringFrames = [
    ['............', '............', '.....kk.....', '....k..k....', '.....kk.....'].map((r) => r.replace(/k/g, 'c')),
    ['............', '...cc..cc...', '..c......c..', '..c......c..', '...cc..cc...'],
    ['.cc......cc.', 'c..........c', 'c..........c', 'c..........c', '.cc......cc.']
  ];
  const dish = ['kkkkk', 'kwwwk', 'kwwwk', 'kkkkk', '..k..'];
  const signalSlots = [];
  const signalAt = [];
  function signalGrid(i) {
    const W = [16, 20, 32, 44, 56][i]; const H = [32, 40, 48, 56, 64][i];
    const mastH = [26, 34, 40, 46, 54][i];
    let g = blank(W, H);
    const mx = i >= 3 ? 4 : Math.floor((W - 8) / 2);
    g = stamp(g, lattice(8, mastH, 'm', 'M'), mx, H - mastH);
    g = stamp(g, ['.k.', 'krk', '.k.'], mx + 3, H - mastH - 2);
    signalAt.push([[mx - 2, H - mastH - 6]]);
    if (i >= 1) g = stamp(g, rect(10, 8, 'G'), mx + 8, H - 8);
    if (i >= 2) g = stamp(g, dish, mx + 9, H - mastH + 6);
    if (i >= 3) {
      const bx = mx + 14; const by = H - 34;
      g = stamp(g, rect(28, 22, 'y'), bx, by);
      g = stamp(g, rect(24, 18, 'v'), bx + 2, by + 2);
      g = stamp(g, solid(2, 12, 'G'), bx + 6, by + 22);
      g = stamp(g, solid(2, 12, 'G'), bx + 20, by + 22);
      signalSlots[i] = { x: bx + 3, y: by + 3, w: 22, h: 16 };
    } else signalSlots[i] = null;
    if (i >= 4) g = stamp(g, lattice(6, 24, 'm', 'M'), W - 8, H - 24);
    return g;
  }
  BUILDINGS.signal = {
    levels: levelsOf(signalGrid),
    anim: mkAnim('rings', ringFrames, 4, signalAt),
    billboard: signalSlots,
    actors: {},
    door: [8, 12, 18, 12, 12]
  };

  // 13. foundry — Bot Foundry: brick works with sawtooth roof, red-banded
  // smokestacks (smoke overlay), a furnace glow and a conveyor door where new bots
  // march out. Grows more stacks, a tank and a gantry.
  const furnace = ['kkkkkkkk', 'koaaaaok', 'kaayyaak', 'koaaaaok', 'kkkkkkkk'];
  const foundryAt = [];
  function foundryGrid(i) {
    const W = [32, 44, 52, 64, 72][i]; const H = [24, 30, 36, 44, 56][i];
    const stacks = [1, 2, 3, 3, 4][i];
    let g = blank(W, H);
    const wallH = [14, 16, 18, 22, 26][i];
    const top = H - wallH;
    g = stamp(g, rect(W, wallH, 'x'), 0, top);
    g = patch(g, [[top + 1, 1, 'X'.repeat(W - 2)]]);
    const teeth = Math.floor(W / 8);
    g = stamp(g, sawtooth(teeth, 'x', 'L'), 0, top - 3);
    const at = [];
    for (let s = 0; s < stacks; s++) {
      const x = 4 + s * 10;
      const sh = top + 2 + (s % 2) * 3;
      g = stamp(g, stack(sh + 1), x, 0 + (top + 2 - sh) + 4);
      at.push([x - 2, (top + 2 - sh) + 4 - 9]);
    }
    foundryAt.push(at);
    g = stamp(g, furnace, W - 12, H - 12);
    g = stamp(g, rollDoor, 4, H - 13);
    if (i >= 3) g = stamp(g, stamp(rect(10, 12, 'g'), ['rr'], 4, 3), W - 24, top - 12);
    if (i >= 4) g = stamp(g, ['kkkkkkkkkkkkkkkkkkkk', 'k..................k', 'k..................k'], W - 34, top - 15);
    const sb = signBox('FOUNDRY', 'o', 'v');
    if (i >= 1) g = stamp(g, sb, Math.floor((W - sb[0].length) / 2), top + 2);
    return g;
  }
  BUILDINGS.foundry = {
    levels: levelsOf(foundryGrid),
    anim: mkAnim('smoke', PROPS.smoke.frames, 4, foundryAt),
    actors: { bot: anim(CP, Sprites.BOTS.worker.frames.map((f) => swapChars(f, { g: 'o', G: 'O', c: 'y' })), 4) },
    door: [10, 10, 10, 10, 10]
  };

  // 14. orbital — Orbital Mine: concrete launch pad with a rust gantry, fuel sphere
  // and a rocket; blinking pad lights. The asteroid hangs in the sky as an actor and
  // cargo pods parachute down.
  const rocket = [
    '...kk...',
    '..kwwk..',
    '.kwwwwk.',
    '.kwrrwk.',
    '.kwwwwk.',
    '.kwwwwk.',
    '.kwLLwk.',
    '.kwwwwk.',
    '.krrrrk.',
    'kkwwwwkk',
    'kkkkkkkk',
    '.kaook..'
  ];
  const tankSphere = ['..kkkk..', '.kmmmmk.', 'kmmwwmmk', 'kmmmmmmk', 'kMMMMMMk', '.kMMMMk.', '..kkkk..', '..k..k..'];
  const orbitalAt = [];
  function orbitalGrid(i) {
    const W = [32, 40, 48, 56, 64][i]; const H = [24, 30, 40, 52, 64][i];
    let g = blank(W, H);
    // pad
    g = stamp(g, rect(W, 6, 'g'), 0, H - 6);
    g = patch(g, [[H - 4, 2, 'Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q.Q'.slice(0, W - 4)]]);
    // gantry
    const gh = H - 8;
    g = stamp(g, lattice(6, gh, 'u', 'U'), 4, H - 6 - gh);
    const at = [[6, H - 6 - gh - 3]];
    if (i >= 1) g = stamp(g, tankSphere, W - 12, H - 14);
    if (i >= 2) { g = stamp(g, rocket, 12, H - 6 - 12); g = patch(g, [[H - 12, 10, 'kkk']]); }
    if (i >= 3) { g = stamp(g, lattice(6, gh - 8, 'u', 'U'), 22, H - 6 - (gh - 8)); at.push([24, H - 6 - (gh - 8) - 3]); g = stamp(g, ['..kkkk..', '.kmmmmk.', 'kmmLLmmk', 'kkkkkkkk'], W - 22, H - 10); }
    if (i >= 4) {
      // mass-driver rail rising to the right
      for (let s = 0; s < 6; s++) g = stamp(g, ['kkkkkkkk', 'kuuuuuuk', 'kkkkkkkk'], W - 24 + s * 4, H - 20 - s * 6);
    }
    if (i >= 1) { const sb = signBox('MINE', 'c', 'v'); g = stamp(g, sb, W - sb[0].length - 1, 0); }
    orbitalAt.push(at);
    return g;
  }
  const asteroidA = [
    '.......kkkkkkk..........',
    '.....kkGGGGGGGkk........',
    '...kkGGGgGGGGGGGkk......',
    '..kGGGGGgGGGGkGGGGk.....',
    '.kGGGGGGGGGGkkGGGGGkk...',
    'kGGGkGGGGGGGGGGGGGGGGk..',
    'kGGkkGGGGGGGGGGGgGGGGGk.',
    'kGGGGGGGGGGgGGGGGGGGGGGk',
    'kGGGGGGGGGGGGGGGGGkGGGGk',
    '.kGGGGGGkGGGGGGGGGGGGGk.',
    '.kGGGGGkkGGGGGGGGGGGGk..',
    '..kGGGGGGGGGGGGGGGGGk...',
    '...kkGGGGGGGGGGGGGkk....',
    '.....kkGGGGGGGGGkk......',
    '.......kkkkkkkkk........',
    '........................'
  ];
  const asteroidB = patch(asteroidA, [[3, 8, 'G'], [3, 15, 'g'], [6, 16, 'G'], [6, 5, 'g'], [15, 3, 'y'], [15, 20, 'y']]);
  BUILDINGS.orbital = {
    levels: levelsOf(orbitalGrid),
    anim: mkAnim('beacon', [beaconOn, beaconOff], 2, orbitalAt),
    actors: { asteroid: anim(CP, [asteroidA, asteroidB], 2), cargoPod: VEHICLES.cargoPod },
    door: [16, 20, 24, 28, 32]
  };

  // ---------------------------------------------------------------------------
  // PROPS (the rest)
  // ---------------------------------------------------------------------------
  // lamp post 6×20: lit and unlit heads.
  const lampRows = (function () {
    let g = blank(6, 20);
    g = stamp(g, solid(2, 17, 'G'), 2, 3);
    g = stamp(g, ['kkkkkk', 'kLLLLk', '.kLLk.', '..kk..'], 0, 0);
    g = stamp(g, ['kkkk', 'kGGk'], 1, 18);
    return g;
  })();
  PROPS.lamp = {
    unlit: sprite(CP, lampRows),
    lit: sprite(CP, swapChars(lampRows, { L: 'l' }))
  };
  // dumpster 14×10: green with a lid and wheels.
  PROPS.dumpster = sprite(CP, [
    'kkkkkkkkkkkkkk',
    'kNNNNNNNNNNNNk',
    'kkkkkkkkkkkkkk',
    'knnnnnnnnnnnnk',
    'knnkkknnnnnnnk',
    'knnnnnnnnnnnnk',
    'kNNNNNNNNNNNNk',
    'kkkkkkkkkkkkkk',
    '.kk........kk.',
    '.kk........kk.'
  ]);
  PROPS.cardboard_box = sprite(CP, ['kkkkkkkk', 'kttttttk', 'ktTTTTtk', 'kttttttk', 'kTTTTTTk', 'kkkkkkkk']);
  // sun 8×8 and moon 8×8 (with a bot face).
  PROPS.sun = sprite(CP, ['..yyyy..', '.yyaayy.', 'yyaaaayy', 'yaaaaaay', 'yaaaaaay', 'yyaaaayy', '.yyaayy.', '..yyyy..']);
  PROPS.moon = sprite(CP, ['..WWWW..', '.WWWWWW.', 'WWkWWkWW', 'WWkWWkWW', 'WWWWWWWW', 'WkkkkkkW', '.WWWWWW.', '..WWWW..']);
  PROPS.star = anim(CP, [['.w.', 'www', '.w.'], ['...', '.W.', '...']], 1);
  PROPS.cloud = [
    sprite(CP, ['.....wwww.......', '..wwwwwwwww.....', '.wwwwwwwwwwwww..', 'wwwwwwwwwwwwwww.', 'wWWWWWWWWWWWWWWw', '.WWWWWWWWWWWWWW.']),
    sprite(CP, ['.......wwwww............', '....wwwwwwwwww..........', '..wwwwwwwwwwwwwww.......', '.wwwwwwwwwwwwwwwwwwww...', 'wwwwwwwwwwwwwwwwwwwwwww.', 'wwwwwwwwwwwwwwwwwwwwwwww', 'wWWWWWWWWWWWWWWWWWWWWWWw', '.WWWWWWWWWWWWWWWWWWWWWW.'])
  ];
  // sign_botlandia: neon BOTLANDIA in pink; the L is a separate flicker layer so the
  // scene can drop it in and out. base = everything but the L; flicker = the L alone.
  const botlandiaText = text('BOTLANDIA', 'i');
  const signW = botlandiaText[0].length + 6;
  const signBase = (function () {
    let g = rect(signW, 11, 'v');
    g = patch(g, [[1, 1, 'G'.repeat(signW - 2)], [9, 1, 'G'.repeat(signW - 2)]]);
    const noL = botlandiaText.map((r) => r.slice(0, 12) + '...' + r.slice(15));
    g = stamp(g, noL, 3, 3);
    // a dead tube on the last A and a crack in the frame
    g = patch(g, [[3, 35, 'P'], [4, 35, 'P'], [0, 20, '.'], [1, 20, 'k']]);
    return g;
  })();
  PROPS.sign_botlandia = Object.assign(sprite(CP, signBase), {
    flicker: sprite(CP, botlandiaText.map((r) => r.slice(12, 15))),
    at: [15, 3]
  });
  // sign_neon: OBEY / WORK / BUY, 2 frames (on / off) in red.
  function neonSign(word) {
    const on = signBox(word, 'r', 'v');
    return anim(CP, [on, swapChars(on, { r: 'R' })], 1.5);
  }
  PROPS.sign_neon = { obey: neonSign('OBEY'), work: neonSign('WORK'), buy: neonSign('BUY') };
  // core_tower 24×64: THE MAINFRAME's tower, a stepped black monolith with sparse
  // lit windows and an eye socket at (8,6); core_eye is the 8×8 scanning red eye.
  const coreRows = (function () {
    let g = blank(24, 64);
    g = stamp(g, rect(24, 44, 'z'), 0, 20);
    g = stamp(g, rect(16, 14, 'z'), 4, 8);
    g = stamp(g, rect(8, 6, 'z'), 8, 2);
    g = stamp(g, ['.k.', 'krk', '.k.'], 10, 0);
    // erase the internal seams so it reads as one silhouette
    g = patch(g, [[20, 5, 'z'.repeat(14)], [8, 9, 'z'.repeat(6)]]);
    g = stamp(g, ['kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk'], 8, 6);
    for (let y = 24; y < 60; y += 4) {
      for (let x = 3; x < 21; x += 3) if (((x * 7 + y * 3) % 5) === 0) g = patch(g, [[y, x, 'l']]);
    }
    g = patch(g, [[22, 2, 'Z'.repeat(20)], [46, 2, 'Z'.repeat(20)]]);
    return g;
  })();
  PROPS.core_tower = Object.assign(sprite(CP, coreRows), { eyeAt: [8, 6] });
  PROPS.core_eye = anim(CP, [
    ['kkkkkkkk', 'kkkkkkkk', 'kkrrkkkk', 'krrrrkkk', 'krrrrkkk', 'kkrrkkkk', 'kkkkkkkk', 'kkkkkkkk'],
    ['kkkkkkkk', 'kkkkkkkk', 'kkkrrkkk', 'kkrrrrkk', 'kkrrrrkk', 'kkkrrkkk', 'kkkkkkkk', 'kkkkkkkk'],
    ['kkkkkkkk', 'kkkkkkkk', 'kkkkrrkk', 'kkkrrrrk', 'kkkrrrrk', 'kkkkrrkk', 'kkkkkkkk', 'kkkkkkkk'],
    ['kkkkkkkk', 'kkkkkkkk', 'kkkrrkkk', 'kkrrrrkk', 'kkrrrrkk', 'kkkrrkkk', 'kkkkkkkk', 'kkkkkkkk']
  ], 2);
  // tower_silhouettes: five far-skyline shapes built from a column profile
  // (heights across the width), navy with a lighter rim and a few lit windows.
  function silhouette(profile, h) {
    const w = profile.length;
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const top = h - profile[x];
        if (y < top) { s += '.'; continue; }
        const rim = y === top || x === 0 || x === w - 1 || (x > 0 && h - profile[x - 1] > y) || (x < w - 1 && h - profile[x + 1] > y);
        const lit = !rim && y > top + 2 && (y % 4 === 1) && (x % 3 === 1) && ((x * 5 + y * 3) % 4 === 0);
        s += rim ? 'Z' : (lit ? 'l' : 'z');
      }
      rows.push(s);
    }
    return rows;
  }
  function prof(parts) { const out = []; parts.forEach((p) => { for (let i = 0; i < p[0]; i++) out.push(p[1]); }); return out; }
  PROPS.tower_silhouettes = [
    sprite(CP, silhouette(prof([[6, 34], [4, 40], [6, 34]]), 40)),
    sprite(CP, silhouette(prof([[4, 20], [4, 30], [8, 48], [4, 30]]), 48)),
    sprite(CP, silhouette(prof([[12, 28]]), 28)),
    sprite(CP, silhouette(prof([[2, 40], [20, 56], [2, 40]]), 56)),
    sprite(CP, silhouette(prof([[6, 24], [6, 36], [6, 44], [6, 36], [6, 24]]), 44))
  ];
  // treadmill_billboard 40×24: a lit billboard with a running belt; the tiny human
  // runner is a separate 6×8 4-frame sprite the scene draws at `slot`.
  PROPS.treadmill_billboard = Object.assign(sprite(CP, (function () {
    let g = rect(40, 24, 'G');
    g = stamp(g, rect(36, 18, 'v'), 2, 2);
    g = stamp(g, text('RUN', 'r'), 6, 5);
    g = stamp(g, text('4471', 'W'), 22, 5);
    g = stamp(g, ['kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk', 'kgGgGgGgGgGgGgGgGgGgGgGgGgGgGgGk', 'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk'], 4, 16);
    g = patch(g, [[22, 4, 'kk'], [23, 4, 'kk'], [22, 34, 'kk'], [23, 34, 'kk']]);
    return g;
  })()), { slot: { x: 17, y: 8, w: 6, h: 8 } });
  PROPS.treadmill_runner = anim(CP, [
    ['.kk...', '.ss...', 'kbbk..', '.bb.k.', '.bb...', 'kbbk..', 'k..k..', '......'],
    ['.kk...', '.ss...', '.bbk..', 'kbb...', '.bbk..', '.bb.k.', '.k....', '......'],
    ['.kk...', '.ss...', 'kbb...', '.bbk..', '.bb...', 'kbbk..', '..k.k.', '......'],
    ['.kk...', '.ss...', '.bbk..', 'kbb...', '.bb...', '.bbk..', '.k.k..', '......']
  ], 8);
  // exit_gate 48×40: closed + 3 opening frames; sunrise light behind the doors.
  function gateGrid(open) {
    let g = blank(48, 40);
    g = stamp(g, rect(48, 34, 'f'), 0, 6);
    g = patch(g, [[7, 1, 'F'.repeat(46)]]);
    g = stamp(g, rect(8, 34, 'F'), 0, 6);
    g = stamp(g, rect(8, 34, 'F'), 40, 6);
    // the opening: light pours in as the doors part
    g = stamp(g, rect(32, 26, 'a'), 8, 12);
    g = patch(g, [[13, 9, 'l'.repeat(30)], [14, 9, 'l'.repeat(30)]]);
    const doorW = [16, 11, 6, 0][open];
    if (doorW > 2) {
      const dl = rect(doorW, 26, 'F'); const dr = rect(doorW, 26, 'F');
      g = stamp(g, dl, 8, 12);
      g = stamp(g, dr, 40 - doorW, 12);
      for (let y = 15; y < 36; y += 4) g = patch(g, [[y, 9, 'f'.repeat(doorW - 2)], [y, 41 - doorW, 'f'.repeat(doorW - 2)]]);
    }
    const sb = signBox('EXIT', 'n', 'v');
    g = stamp(g, sb, Math.floor((48 - sb[0].length) / 2), 0);
    g = stamp(g, ['.k.', 'krk', '.k.'], 3, 2);
    g = stamp(g, ['.k.', 'krk', '.k.'], 42, 2);
    return g;
  }
  PROPS.exit_gate = Object.assign(anim(CP, [gateGrid(0), gateGrid(1), gateGrid(2), gateGrid(3)], 3), { closed: sprite(CP, gateGrid(0)) });
  // rain 8×8 tile, 2 frames.
  PROPS.rain = anim(CP, [
    ['c.......', '.c...c..', '......c.', '...c....', '....c...', 'c.......', '.c....c.', '.......c'],
    ['...c....', '....c...', 'c.......', '.c....c.', '.......c', '...c....', '....c...', 'c.......']
  ], 10);
  PROPS.confetti = ['r', 'y', 'c', 'n'].map((ch) => anim(CP, [[ch + ch, ch + ch], ['..', ch + ch]], 8));
  PROPS.lightning = anim(CP, [
    ['.......ww.......', '......ww........', '......ww........', '.....ww.........', '.....www........', '......ww........', '......ww........', '.....ww.........', '....ww..........', '...www..........', '....ww..........', '.....w..........', '....ww..........', '...ww...........', '..ww............', '.ww.............', '..w.............', '..w.............', '.w..............', 'w...............'].map((r) => r.padEnd(16, '.')),
    ['.......cc.......', '......cw........', '......wc........', '.....cw.........', '.....cww........', '......wc........', '......cw........', '.....wc.........', '....cw..........', '...cww..........', '....wc..........', '.....c..........', '....cw..........', '...wc...........', '..cw............', '.wc.............', '..c.............', '..w.............', '.c..............', 'c...............'].map((r) => r.padEnd(16, '.'))
  ], 12);
  PROPS.fireflies = anim(CP, [
    ['..n.............', '.........n......', '................', '....n...........', '..............n.', '................', '.......n........', '................'],
    ['................', '..n.............', '.........N......', '................', '....N...........', '..............N.', '................', '.......N........']
  ], 2);
  PROPS.sidewalk = sprite(CP, ['jjjjjjjJ', 'jjjjjjjJ', 'jjjjjjjJ', 'JJJJJJJJ', 'jjjjjjjJ', 'jjjjjjjJ', 'jjjjjjjJ', 'JJJJJJJJ']);
  PROPS.road = sprite(CP, ['qqqqqqqqqqqqqqqq', 'qqqqqqqqqqqqqqqq', 'qqqqqqqqqqqqqqqq', 'QQQQQQQQqqqqqqqq', 'qqqqqqqqqqqqqqqq', 'qqqqqqqqqqqqqqqq', 'qqqqqqqqqqqqqqqq', 'qqqqqqqqqqqqqqqq']);
  PROPS.hill = sprite(CP, hill(32, 12));
  PROPS.window = { unlit: sprite(CP, pane(4, 4, 'L')), lit: sprite(CP, pane(4, 4, 'l')) };
  PROPS.flag = sprite(CP, ['kkkkk.', 'krrrrk', 'krwrrk', 'krrrrk', 'kkkkk.', 'k.....', 'k.....', 'k.....']);
  // ghost overlay 8×4: alternating scanline tile; draw it over last run's buildings
  // (with alpha) for the New Game+ "scanline ghost".
  PROPS.ghost = sprite(CP, ['cccccccc', '........', 'cccccccc', '........']);

  // ---------------------------------------------------------------------------
  // PALETTES — per chapter, day and night, plus the crash storm. Each set gives the
  // sky gradient, far/mid skyline tints, road, sidewalk and an accent for signs.
  // Sunrise is the only warm one (the ending); storm is the crash's sick green.
  // ---------------------------------------------------------------------------
  function ps(skyTop, skyBottom, far, mid, road, sidewalk, accent) {
    return { skyTop: skyTop, skyBottom: skyBottom, far: far, mid: mid, road: road, sidewalk: sidewalk, accent: accent };
  }
  const PALETTES = {
    gutter: { day: ps('#3b4256', '#6b6f7e', '#2a2f44', '#3e4358', '#23273f', '#4a4f66', '#8b93a7'), night: ps('#0a0c18', '#1c1f31', '#12152a', '#1d2138', '#15182a', '#2a2e44', '#5d6488') },
    block: { day: ps('#2f4f8f', '#7aa0d8', '#243a6b', '#3d4a8a', '#23273f', '#5d6488', '#39d4ff'), night: ps('#080c24', '#1b2350', '#0f1538', '#1f2858', '#161a30', '#2f3556', '#2b5fd9') },
    alley: { day: ps('#4a3a6a', '#a07ab0', '#2f2450', '#4a3a70', '#2a2540', '#5a4f78', '#ff7ab6'), night: ps('#0d0a20', '#2a1c48', '#160f30', '#2a1e4e', '#18142a', '#332a50', '#ff00ff') },
    treadmill: { day: ps('#1f5a6a', '#6ab8c8', '#1a3a4a', '#2a5a6a', '#23273f', '#4f6a78', '#ffb020'), night: ps('#06141c', '#123040', '#0b2030', '#153444', '#141a26', '#26384a', '#ff9a3c') },
    ledger: { day: ps('#1e3a5a', '#5a8ab8', '#183050', '#2a4a70', '#23273f', '#4e5c7a', '#4ade80'), night: ps('#050c1a', '#0f2440', '#0a1a30', '#142a4a', '#12182a', '#243248', '#1f8a4c') },
    skyline: { day: ps('#2a5fb8', '#8ec3f0', '#1f3f80', '#3560a8', '#262a44', '#5d6488', '#ffd166'), night: ps('#050818', '#101a3e', '#0b1230', '#151f4a', '#161a30', '#2f3556', '#facc15') },
    heights: { day: ps('#4a2a7a', '#c08ad0', '#301c58', '#4d2f88', '#2a2545', '#5b4f7c', '#ffd166'), night: ps('#0c0620', '#28144a', '#170c34', '#2c1858', '#1a142c', '#352a54', '#c9971e') },
    gate: { day: ps('#1a1a4a', '#6a5a9a', '#14143a', '#2a2560', '#23273f', '#4a4a6e', '#ff9a3c'), night: ps('#050518', '#1a1440', '#0b0a2c', '#1c1650', '#14142a', '#2a2a48', '#ff3b3b') },
    sunrise: { day: ps('#ff9a3c', '#ffd98a', '#8a4a6a', '#c07a5a', '#4a3a4a', '#a08070', '#ffffff'), night: ps('#3a1a5a', '#ff7a5a', '#4a2a5a', '#8a4a5a', '#3a2a3a', '#705060', '#ffd166') },
    storm: ps('#0a1a12', '#1e4a2a', '#0e2a1c', '#1a3a2a', '#141c18', '#2a3a30', '#4ade80')
  };

  // ---------------------------------------------------------------------------
  // Validation (same rules as sprites.js: equal row lengths, every char mapped)
  // ---------------------------------------------------------------------------
  function gridsOf(sp) {
    const out = [];
    if (sp.rows) out.push(sp.rows);
    if (sp.frames) sp.frames.forEach((f) => out.push(f));
    return out;
  }
  function validate(path, sp) {
    for (const rows of gridsOf(sp)) {
      const w = rows[0].length;
      rows.forEach((row, y) => {
        if (row.length !== w) throw new Error('Sprites.CITY: ' + path + ' row ' + y + ' has length ' + row.length + ', expected ' + w);
        for (const ch of row) {
          if (ch !== '.' && !sp.palette[ch]) throw new Error('Sprites.CITY: ' + path + ' row ' + y + ' uses unmapped char "' + ch + '"');
        }
      });
    }
  }
  function isSprite(o) { return o && typeof o === 'object' && (o.rows || o.frames) && o.palette; }
  // Walk the CITY tree and return every sprite path (e.g. 'buildings.laundro.levels.2',
  // 'vehicles.hovercar.1', 'props.lamp.lit'), for contact sheets and tests.
  function walk(obj, prefix, out, depth) {
    if (depth > 4 || !obj || typeof obj !== 'object') return out;
    for (const k in obj) {
      const v = obj[k];
      const path = prefix ? prefix + '.' + k : k;
      if (isSprite(v)) out.push(path);
      else if (v && typeof v === 'object' && k !== 'palette' && k !== 'slot' && k !== 'at' && k !== 'billboard') walk(v, path, out, depth + 1);
    }
    return out;
  }
  function list() { return walk({ buildings: BUILDINGS, vehicles: VEHICLES, props: PROPS }, '', [], 0); }
  function get(path) {
    const parts = path.split('.');
    let cur = { buildings: BUILDINGS, vehicles: VEHICLES, props: PROPS };
    for (const p of parts) { if (cur == null) return null; cur = cur[p]; }
    return cur || null;
  }
  list().forEach((p) => validate(p, get(p)));

  const CITY = {
    COLORS: COLORS,
    CHARS: CITY_CHARS,
    palette: CP,
    buildings: BUILDINGS,
    vehicles: VEHICLES,
    props: PROPS,
    palettes: PALETTES,
    list: list,
    get: get,
    text: text,
    kit: { rect: rect, solid: solid, pane: pane, signBox: signBox, awning: awning, fence: fence, hill: hill, lattice: lattice, sawtooth: sawtooth, stampAll: stampAll, cpal: cpal }
  };
  Sprites.CITY = CITY;
  root.Sprites = Sprites;
  if (typeof module !== 'undefined' && module.exports) module.exports = CITY;
})(typeof globalThis !== 'undefined' ? globalThis : this);
