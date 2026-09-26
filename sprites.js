/* sprites.js — pixel art for the avatar, the Machine, portraits, street bots and UI icons (global `Sprites`). */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Grid format
  // ---------------------------------------------------------------------------
  // A sprite is { palette: { char: '#hex' }, rows: ['....', ...] } or, when animated,
  // { palette, frames: [rows, rows, ...], fps }. Rows are equal-length strings; '.' is
  // transparent. Everything below is plain data built at load time with a few small
  // compositing helpers (no DOM, no timers) so Node can require() this file for tests.
  // render() is the only function that touches `document`, and only when it is called.

  // Shared colour constants. Sprites pick from these so the whole cast reads as one
  // world (dark navy outlines, warm skin, Bot-Corp blue, cardboard tan, glitch cyan).
  const PALETTES = {
    OUTLINE: '#101226',
    NAVY: '#0b0f2b',
    WHITE: '#f4f6ff',
    LIGHT: '#b8bfd8',
    GREY: '#8b93a7',
    DARK_GREY: '#4b5268',
    SKIN: '#f2c9a0',
    SKIN_SHADOW: '#c98d63',
    HAIR: '#5a3a22',
    HAIR_GREY: '#b8bfd8',
    GOLD: '#ffd166',
    GOLD_DARK: '#c9971e',
    AMBER: '#ffb020',
    AMBER_DARK: '#8a5a00',
    RED: '#ff3b3b',
    RED_DARK: '#a31d1d',
    BLUE: '#2b5fd9',
    BLUE_DARK: '#1b3a8a',
    CYAN: '#39d4ff',
    CYAN_DARK: '#1a7fa3',
    GREEN: '#4ade80',
    GREEN_DARK: '#1f8a4c',
    ORANGE: '#ff9a3c',
    ORANGE_DARK: '#b45a1b',
    CARDBOARD: '#c9a06a',
    CARDBOARD_DARK: '#8f6b3d',
    BEIGE: '#d9c9a3',
    BEIGE_DARK: '#a89a72',
    PURPLE: '#3a2a5a',
    PURPLE_LIGHT: '#5b3f8a',
    OLIVE: '#4f6b3a',
    OLIVE_DARK: '#2f4423',
    CHROME: '#dfe6f5',
    CHROME_DARK: '#8f9bb8',
    PINK: '#ff7ab6',
    MAGENTA: '#ff00ff' // the "unmapped char" colour; never used on purpose
  };

  // The character → colour vocabulary most sprites share. Each sprite palette starts from
  // this and overrides what it needs, so 'k' is always the outline, 's' always skin, etc.
  const BASE = {
    k: PALETTES.OUTLINE,
    w: PALETTES.WHITE,
    W: PALETTES.LIGHT,
    g: PALETTES.GREY,
    G: PALETTES.DARK_GREY,
    s: PALETTES.SKIN,
    S: PALETTES.SKIN_SHADOW,
    e: PALETTES.OUTLINE,
    h: PALETTES.HAIR,
    y: PALETTES.GOLD,
    Y: PALETTES.GOLD_DARK,
    a: PALETTES.AMBER,
    A: PALETTES.AMBER_DARK,
    r: PALETTES.RED,
    R: PALETTES.RED_DARK,
    b: PALETTES.BLUE,
    B: PALETTES.BLUE_DARK,
    c: PALETTES.CYAN,
    C: PALETTES.CYAN_DARK,
    n: PALETTES.GREEN,
    N: PALETTES.GREEN_DARK,
    o: PALETTES.ORANGE,
    O: PALETTES.ORANGE_DARK,
    t: PALETTES.CARDBOARD,
    T: PALETTES.CARDBOARD_DARK,
    d: PALETTES.BEIGE,
    D: PALETTES.BEIGE_DARK,
    p: PALETTES.PURPLE,
    P: PALETTES.PURPLE_LIGHT,
    m: PALETTES.CHROME,
    M: PALETTES.CHROME_DARK,
    i: PALETTES.PINK,
    v: PALETTES.NAVY
  };

  function pal(overrides) { return Object.assign({}, BASE, overrides || {}); }

  // ---------------------------------------------------------------------------
  // Grid helpers (pure)
  // ---------------------------------------------------------------------------
  function blank(w, h) {
    const rows = [];
    for (let y = 0; y < h; y++) rows.push('.'.repeat(w));
    return rows;
  }

  // Paint `layer` (array of strings, '.' = skip) onto a copy of `grid` at (x, y).
  function stamp(grid, layer, x, y) {
    const out = grid.slice();
    for (let j = 0; j < layer.length; j++) {
      const gy = y + j;
      if (gy < 0 || gy >= out.length) continue;
      const row = out[gy].split('');
      const line = layer[j];
      for (let i = 0; i < line.length; i++) {
        const gx = x + i;
        const ch = line[i];
        if (ch === '.' || gx < 0 || gx >= row.length) continue;
        row[gx] = ch;
      }
      out[gy] = row.join('');
    }
    return out;
  }

  // Overwrite cells, including making them transparent. edits: [[y, x, 'chars'], ...]
  // where '.' erases and ' ' (space) leaves the existing pixel alone.
  function patch(grid, edits) {
    const out = grid.slice();
    for (const e of edits) {
      const y = e[0]; const x = e[1]; const str = e[2];
      if (y < 0 || y >= out.length) continue;
      const row = out[y].split('');
      for (let i = 0; i < str.length; i++) {
        const gx = x + i;
        if (gx < 0 || gx >= row.length || str[i] === ' ') continue;
        row[gx] = str[i];
      }
      out[y] = row.join('');
    }
    return out;
  }

  // Move the whole grid by (dx, dy); pixels pushed off the edge are lost.
  function shift(grid, dx, dy) {
    const w = grid[0].length; const h = grid.length;
    return stamp(blank(w, h), grid, dx, dy);
  }

  // Shift only rows y0..y1 (inclusive) horizontally — used for wobbles and shears.
  function shiftRows(grid, y0, y1, dx) {
    const w = grid[0].length;
    return grid.map((row, y) => {
      if (y < y0 || y > y1) return row;
      const moved = blank(w, 1);
      return stamp(moved, [row], dx, 0)[0];
    });
  }

  function flipH(grid) { return grid.map((r) => r.split('').reverse().join('')); }

  // Replace characters across the grid ({ from: to }), e.g. closing eyes ('e' → 'S').
  function swapChars(grid, map) {
    return grid.map((row) => row.split('').map((ch) => (map[ch] !== undefined ? map[ch] : ch)).join(''));
  }

  function sprite(palette, rows, extra) {
    return Object.assign({ palette: palette, rows: rows, w: rows[0].length, h: rows.length }, extra || {});
  }

  function anim(palette, frames, fps, extra) {
    return Object.assign({ palette: palette, frames: frames, fps: fps, w: frames[0][0].length, h: frames[0].length }, extra || {});
  }

  // ---------------------------------------------------------------------------
  // AVATARS — 16×24, seven stages. Each stage is composed from a hand-drawn body
  // (head + torso + legs, no arms) plus generated arm layers and small props, so the
  // reaction poses (jump / arms_up / sit / cough / sleep) can be derived for every
  // stage from one template instead of being drawn 35 times.
  // Layout: head cols 4–11 rows 2–9, neck row 10, torso rows 11–18, legs rows 19–23,
  // left arm cols 1–3, right arm cols 12–14, hands at row 16.
  // ---------------------------------------------------------------------------
  const AV_W = 16; const AV_H = 24;

  // Arm layers. `sleeve` is the sleeve char, `sleeveRows` how many of the 4 forearm rows
  // are covered (2 = rolled sleeves). Returned layers are placed at x=1 (left) / x=12 (right).
  function armDown(sleeve, sleeveRows) {
    const n = sleeveRows === undefined ? 4 : sleeveRows;
    const rows = ['.kk'];
    for (let i = 0; i < 4; i++) rows.push(i < n ? 'k' + sleeve + sleeve : 'kss');
    rows.push('kss', '.kk');
    return rows; // 7 rows, y = 11..17
  }
  function armUp(sleeve, sleeveRows) {
    const n = sleeveRows === undefined ? 4 : sleeveRows;
    const rows = ['.kk', 'kss', 'kss'];
    for (let i = 0; i < 5; i++) rows.push(i >= 5 - n ? 'k' + sleeve + sleeve : 'kss');
    rows.push('.kk');
    return rows; // 9 rows, y = 4..12
  }

  // Compose one full-size frame from the body plus ordered layers [{x, y, rows}].
  function composeAvatar(body, layers) {
    let g = body;
    for (const l of layers) g = stamp(g, l.rows, l.x, l.y);
    return g;
  }

  function buildAvatar(cfg) {
    const body = cfg.body;
    const sleeve = cfg.sleeve; const sr = cfg.sleeveRows;
    const L = { x: 1, y: 11, rows: armDown(sleeve, sr) };
    const Rt = { x: 12, y: 11, rows: flipH(armDown(sleeve, sr)) };
    const LU = { x: 1, y: 4, rows: armUp(sleeve, sr) };
    const RU = { x: 12, y: 4, rows: flipH(armUp(sleeve, sr)) };
    const ground = cfg.ground || [];
    const behind = cfg.behind || [];
    const props1 = cfg.props || [];
    const props2 = cfg.props2 || props1;
    const armsA = cfg.arms || [L, Rt];
    const armsB = cfg.arms2 || armsA;
    const withGround = (g) => composeAvatar(g, ground);

    // The figure (no ground props) in its three arm poses; `jitter` nudges frame 2
    // sideways for the vagrant's shiver.
    const fig = composeAvatar(body, [].concat(behind, armsA, props1));
    let fig2 = composeAvatar(cfg.body2 || body, [].concat(behind, armsB, props2));
    if (cfg.jitter) fig2 = shift(fig2, cfg.jitter, 0);
    const figUp = composeAvatar(body, [].concat(behind, [LU, RU], cfg.propsUp || []));
    const idle1 = withGround(fig);
    const idle2 = withGround(fig2);

    // jump: figure lifted 2 px with the shins folded away (rows 20–21 dropped), arms up.
    const jumpRows = [].concat(figUp.slice(2, 20), figUp.slice(22, 24), blank(AV_W, 4));
    // sit: torso dropped 4 px onto the ground, legs tucked (rows 18–21 dropped).
    const sitRows = [].concat(blank(AV_W, 4), fig.slice(0, 18), fig.slice(22, 24));
    // cough: eyes shut, hand at the mouth, three puffs.
    const cough = stamp(swapChars(fig, { e: 'S' }), ['...W.', '..W.W', 'sskW.', '.kk..'], 10, 6);
    // sleep: sitting, eyes shut, a pale Z floating up to the right.
    const sleep = stamp(swapChars(sitRows, { e: 'S' }), ['WWWW', '..W.', '.W..', 'WWWW'], 11, 1);

    return anim(cfg.palette, [idle1, idle2], 2, {
      reactions: {
        jump: sprite(cfg.palette, withGround(jumpRows)),
        arms_up: sprite(cfg.palette, withGround(figUp)),
        sit: sprite(cfg.palette, withGround(sitRows)),
        cough: sprite(cfg.palette, withGround(cough)),
        sleep: sprite(cfg.palette, withGround(sleep))
      }
    });
  }

  const AVATARS = {};

  // 1. vagrant — olive hoodie, stubble, one sock, cardboard box, shivers.
  AVATARS.vagrant = buildAvatar({
    palette: pal({ H: PALETTES.OLIVE, I: PALETTES.OLIVE_DARK }),
    sleeve: 'H',
    body: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kHHHHHHk....',
      '...kHHHHHHHHk...',
      '...kHssssssHk...',
      '...kHsessesHk...',
      '...kHsSssSsHk...',
      '...kHsSSSSsHk...',
      '....kHSSSSHk....',
      '.....kkssk......',
      '..kkkHHHHHHkkk..',
      '....kHHHHHHk....',
      '....kHHIIHHk....',
      '....kHIkkIHk....',
      '....kHHHHHHk....',
      '....kHIIIIHk....',
      '....kHHHHHHk....',
      '....kkkkkkkk....',
      '....kGGkkGGk....',
      '....kGGkkGGk....',
      '....kGGkkGGk....',
      '....kwwkkSSk....',
      '....kkkkkkkk....'
    ],
    ground: [{ x: 12, y: 17, rows: ['kkkk', 'kttk', 'ktTk', 'kTTk', 'kttk', 'kttk', 'kkkk'] }],
    jitter: 1
  });

  // 2. wageslave — blue Bot-Corp jumpsuit, name tag, eye bags, coffee. Frame 2 sips.
  const wsBody = [
    '................',
    '................',
    '.....kkkkkk.....',
    '....khhhhhhk....',
    '....khhhhhhk....',
    '....kshsshsk....',
    '....ksessesk....',
    '....kSsssSsk....',
    '....kssssssk....',
    '.....kSssSk.....',
    '......kssk......',
    '..kkkbbbbbbkkk..',
    '....kbbbBbbk....',
    '....kwwbBbbk....',
    '....kwrbBbbk....',
    '....kbbbBbbk....',
    '....kbbbBbbk....',
    '....kbbbBbbk....',
    '....kkkkkkkk....',
    '....kbbkkbbk....',
    '....kbbkkbbk....',
    '....kbbkkbbk....',
    '....kGGkkGGk....',
    '....kkkkkkkk....'
  ];
  AVATARS.wageslave = buildAvatar({
    palette: pal({}),
    sleeve: 'b',
    body: wsBody,
    // frame 1: cup held low in the right hand; frame 2: cup raised to the mouth.
    props: [{ x: 12, y: 13, rows: ['kkkk', 'kwwk', 'kwwk', 'kkkk'] }],
    arms2: [
      { x: 1, y: 11, rows: armDown('b') },
      { x: 12, y: 11, rows: ['ssk', 'bbk', 'bbk', 'bbk', 'bbk', 'kk.', '...'] }
    ],
    props2: [{ x: 11, y: 6, rows: ['.W..', 'kkkk', 'kwwk', 'kwwk', 'kkkk'] }]
  });

  // 3. hustler — jumpsuit half unzipped over a white tee, cap backwards, phone.
  AVATARS.hustler = buildAvatar({
    palette: pal({}),
    sleeve: 'b',
    body: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....krrrrrrk....',
      '.kkkkrrrrrrk....',
      '.krrkRRRRRRk....',
      '..kkkssssssk....',
      '....ksessesk....',
      '....kssssSsk....',
      '.....kSssSk.....',
      '......kssk......',
      '..kkkbwwwwbkkk..',
      '....kbbwwbbk....',
      '....kbbwwbbk....',
      '....kbbkkbbk....',
      '....kbbbbbbk....',
      '....kbbbbbbk....',
      '....kbbbbbbk....',
      '....kkkkkkkk....',
      '....kbbkkbbk....',
      '....kbbkkbbk....',
      '....kbbkkbbk....',
      '....kwwkkwwk....',
      '....kkkkkkkk....'
    ],
    props: [{ x: 1, y: 12, rows: ['kkk', 'kck', 'kck', 'kkk'] }],
    props2: [{ x: 1, y: 12, rows: ['kkk', 'kwk', 'kck', 'kkk'] }]
  });

  // 4. owner — white shirt, rolled sleeves, key ring on the belt, clipboard. Frame 2 flips a page.
  AVATARS.owner = buildAvatar({
    palette: pal({}),
    sleeve: 'w',
    sleeveRows: 2,
    body: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....khhhhhhk....',
      '....khhhhhhk....',
      '....kshhhssk....',
      '....ksessesk....',
      '....kssssssk....',
      '....kssSSssk....',
      '.....kSssSk.....',
      '......kssk......',
      '..kkkwwsswwkkk..',
      '....kwwwwwwk....',
      '....kwwwWwwk....',
      '....kwwwWwwk....',
      '....kwwwWwwk....',
      '....kwwwWwwk....',
      '....kwwwwwwk....',
      '....kkkkkkyk....',
      '....kGGkkGGk....',
      '....kGGkkGGk....',
      '....kGGkkGGk....',
      '....kTTkkTTk....',
      '....kkkkkkkk....'
    ],
    props: [{ x: 0, y: 12, rows: ['.kk.', 'kkkk', 'ktwk', 'kwWk', 'kwwk', 'kkkk'] }],
    props2: [{ x: 0, y: 12, rows: ['.kk.', 'kkkk', 'kwwk', 'kWwk', 'kwwk', 'kkkk'] }]
  });

  // 5. investor — navy blazer, red tie, tablet with a green chart. Frame 2 scrolls the chart.
  AVATARS.investor = buildAvatar({
    palette: pal({}),
    sleeve: 'B',
    body: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....khhhhhhk....',
      '....khhhhhhk....',
      '....khsssshk....',
      '....ksessesk....',
      '....kssssssk....',
      '....kssSSssk....',
      '.....kSssSk.....',
      '......kssk......',
      '..kkkBBwwBBkkk..',
      '....kBwrrwBk....',
      '....kBwrrwBk....',
      '....kBwrrwBk....',
      '....kBBrrBBk....',
      '....kBBBBBBk....',
      '....kBBBBBBk....',
      '....kkkkkkkk....',
      '....kBBkkBBk....',
      '....kBBkkBBk....',
      '....kBBkkBBk....',
      '....kGGkkGGk....',
      '....kkkkkkkk....'
    ],
    props: [{ x: 12, y: 12, rows: ['kkkk', 'kGnk', 'knGk', 'kGnk', 'kGGk', 'kkkk'] }],
    props2: [{ x: 12, y: 12, rows: ['kkkk', 'kGGk', 'kGnk', 'knGk', 'kGnk', 'kkkk'] }]
  });

  // 6. tycoon — long purple coat with gold trim, gold shades, cane with a bot-head knob.
  AVATARS.tycoon = buildAvatar({
    palette: pal({}),
    sleeve: 'p',
    body: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....khhhhhhk....',
      '....khhhhhhk....',
      '....kyyyyyyk....',
      '....keekkeek....',
      '....kssssssk....',
      '....kssSSssk....',
      '.....kSssSk.....',
      '......kssk......',
      '..kkkpywwypkkk..',
      '....kpywwypk....',
      '....kpyrrypk....',
      '....kppyyppk....',
      '....kppppppk....',
      '....kppyyppk....',
      '....kppppppk....',
      '....kppppppk....',
      '....kppppppk....',
      '....kppppppk....',
      '....kkkkkkkk....',
      '....kGGkkGGk....',
      '....kkkkkkkk....'
    ],
    props: [{ x: 14, y: 14, rows: ['kk', 'gg', '.y', '.y', '.y', '.y', '.y', '.y', '.y', '.k'] }],
    props2: [{ x: 14, y: 13, rows: ['kk', 'gg', 'y.', 'y.', 'y.', 'y.', 'y.', 'y.', 'y.', 'k.'] }]
  });

  // 7. escapee — orange hoodie, hood down, backpack straps and a pack peeking over the
  // shoulder, a smile. Frame 2 blinks while the wind lifts the hair.
  const escBody = [
    '................',
    '................',
    '.....kkkkkk.....',
    '....khhhhhhk....',
    '....khhhhhhk....',
    '....kshsshsk....',
    '....ksessesk....',
    '....ksSssSsk....',
    '....kssSSssk....',
    '.....kSssSk.....',
    '......kssk......',
    '..kkkoTooTokkk..',
    '....koTooTok....',
    '....koTooTok....',
    '....koTooTok....',
    '....kooOOook....',
    '....koOkkOok....',
    '....kooooook....',
    '....kkkkkkkk....',
    '....kGGkkGGk....',
    '....kGGkkGGk....',
    '....kGGkkGGk....',
    '....kTTkkTTk....',
    '....kkkkkkkk....'
  ];
  AVATARS.escapee = buildAvatar({
    palette: pal({}),
    sleeve: 'o',
    body: escBody,
    body2: patch(escBody, [[5, 4, 'kshssshk'], [6, 4, 'ksSssSsk']]),
    behind: [{ x: 11, y: 9, rows: ['.kkk', 'kTTk', 'kTtk'] }]
  });

  // ---------------------------------------------------------------------------
  // MACHINES — 24×24 click objects. Two idle frames + two 'hit' frames each.
  // ---------------------------------------------------------------------------
  const MACHINES = {};

  // A 3×5 micro font (rows of '#'/'.') for signs and LCDs. Exported via util.text().
  const FONT = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], N: ['###', '#.#', '#.#', '#.#', '#.#'], Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
    H: ['#.#', '#.#', '###', '#.#', '#.#'], E: ['###', '#..', '##.', '#..', '###'], L: ['#..', '#..', '#..', '#..', '###'],
    P: ['###', '#.#', '###', '#..', '#..'], S: ['###', '#..', '###', '..#', '###'], $: ['.##', '##.', '.#.', '.##', '##.'],
    O: ['###', '#.#', '#.#', '#.#', '###'], U: ['#.#', '#.#', '#.#', '#.#', '###'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
    I: ['###', '.#.', '.#.', '.#.', '###'], D: ['##.', '#.#', '#.#', '#.#', '##.'], 0: ['###', '#.#', '#.#', '#.#', '###'],
    1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'], 3: ['###', '..#', '###', '..#', '###'],
    4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'], 6: ['###', '#..', '###', '#.#', '###'],
    7: ['###', '..#', '..#', '..#', '..#'], 8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '###'],
    ':': ['...', '.#.', '...', '.#.', '...'], '-': ['...', '...', '###', '...', '...'], ' ': ['..', '..', '..', '..', '..']
  };
  // text('ANY $', 'T') → a 5-row layer with letters drawn in `ch`, 1 px apart.
  function text(str, ch) {
    const rows = ['', '', '', '', ''];
    for (let i = 0; i < str.length; i++) {
      const g = FONT[str[i]] || FONT[' '];
      for (let r = 0; r < 5; r++) rows[r] += (i ? '.' : '') + g[r].replace(/#/g, ch);
    }
    return rows;
  }

  // sign: cardboard "ANY $ HELPS" on a stick over a donation box (the full slogan does
  // not fit 24 px; the two lines keep the joke and stay readable at 5×).
  const signPal = pal({});
  const signBoard = [
    '..kkkkkkkkkkkkkkkkkkkk..',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '.kttttttttttttttttttttk.',
    '..kkkkkkkkkkkkkkkkkkkk..',
    '...........kTk..........',
    '...........kTk..........',
    '...........kTk..........',
    '......kkkkkkkkkkkk......',
    '.....ktkkkkkkkkkktk.....',
    '.....kttttttttttttk.....',
    '.....kttTTtTTtTTttk.....',
    '.....kttttttttttttk.....',
    '.....kkkkkkkkkkkkkk.....'
  ];
  const signIdle = stamp(stamp(signBoard, text('ANY $', 'T'), 4, 2), text('HELPS', 'T'), 3, 8);
  MACHINES.sign = anim(signPal, [signIdle, shiftRows(signIdle, 0, 14, 1)], 2, {
    hit: [
      // knocked left, coin arcing in
      stamp(shiftRows(signIdle, 0, 14, -1), ['kyyk', 'kyYk'], 14, 15),
      // swung right, coin dropping into the slot
      stamp(shiftRows(signIdle, 0, 14, 2), ['kyyk', 'kyYk'], 12, 17)
    ]
  });

  // clock: grimy Bot-Corp punch clock, amber LCD reading 9:25, red eye logo, card slot.
  const clockPal = pal({ a: PALETTES.AMBER_DARK, A: PALETTES.AMBER });
  const clockIdle = [
    '....kkkkkkkkkkkkkkkk....',
    '...kGGGGGGGGGGGGGGGGk...',
    '..kGGggggggggggggggGGk..',
    '..kGgggggkrrrrkgggggGk..',
    '..kGggggkrrkkrrkggggGk..',
    '..kGggggkrrkkrrkggggGk..',
    '..kGgggggkrrrrkgggggGk..',
    '..kGGggggggggggggggGGk..',
    '..kGkkkkkkkkkkkkkkkkGk..',
    '..kGkAAAaaaAAAaAAAakGk..',
    '..kGkAaAaAaaaAaAaaakGk..',
    '..kGkAAAaaaAAAaAAAakGk..',
    '..kGkaaAaAaAaaaaaAakGk..',
    '..kGkAAAaaaAAAaAAAakGk..',
    '..kGkkkkkkkkkkkkkkkkGk..',
    '..kGGggggggggggggggGGk..',
    '..kGgggkkkkkkkkkkgggGk..',
    '..kGgggkkkkkkkkkkgggGk..',
    '..kGggggggggggggggggGk..',
    '..kGggGgggggGgggggGgGk..',
    '..kGGggggggggggggggGGk..',
    '...kGGGGGGGGGGGGGGGGk...',
    '....kkkkkkkkkkkkkkkk....',
    '......kk........kk......'
  ];
  // frame 2: colon blinks off, eye pupil glances right.
  const clockIdle2 = patch(clockIdle, [[10, 9, 'a'], [12, 9, 'a'], [4, 9, 'rkkr'], [5, 9, 'rkkr'], [4, 10, 'kkr'], [5, 10, 'kkr']]);
  MACHINES.clock = anim(clockPal, [clockIdle, clockIdle2], 2, {
    hit: [
      // card slammed in: white card in the slot, LCD flashes bright
      stamp(patch(clockIdle, [[9, 5, 'AAAAAAAAAAAAAA'], [11, 5, 'AAAAAAAAAAAAAA'], [13, 5, 'AAAAAAAAAAAAAA']]), ['kwwwwk', 'kwwwwk', 'kwwwwk'], 9, 15),
      // paycheck pops out the top, eye goes wide (white)
      stamp(patch(clockIdle, [[3, 9, 'kwwwwk'], [4, 8, 'kwwkkwwk'], [5, 8, 'kwwkkwwk'], [6, 9, 'kwwwwk']]), ['kkkkkk', 'kwnnwk', 'kwwwwk'], 9, 0)
    ]
  });

  // register: beige cash register, green display, keys, a gold bell, drawer.
  const regPal = pal({});
  const regIdle = [
    '..........kkkk..........',
    '.........kyyyyk.........',
    '........kyyYYyyk........',
    '........kkkkkkkk........',
    '......kkkkkkkkkkkk......',
    '.....kddddddddddddk.....',
    '....kdkkkkkkkkkkkkdk....',
    '....kdkNNNNNNNNNNkdk....',
    '....kdkNnnNnnNnnNkdk....',
    '....kdkNNNNNNNNNNkdk....',
    '....kdkkkkkkkkkkkkdk....',
    '...kddddddddddddddddk...',
    '..kddwwkwwkwwkwwkwwddk..',
    '..kddwwkwwkwwkwwkwwddk..',
    '..kddddddddddddddddddk..',
    '..kddwwkwwkrrkwwkwwddk..',
    '..kddwwkwwkrrkwwkwwddk..',
    '..kddddddddddddddddddk..',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '.kDDDDDDDDDDDDDDDDDDDDk.',
    '.kDDDDDDDDDkGGkDDDDDDDk.',
    '.kDDDDDDDDDDDDDDDDDDDDk.',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '..kk................kk..'
  ];
  const regIdle2 = patch(regIdle, [[8, 7, 'nNnNnnNnnn']]); // display digits tick over
  const regOpen = patch(regIdle, [
    [19, 1, 'kknnnkyykknnnkyykknnnk'],
    [20, 1, 'kknnnkyykknnnkyykknnnk'],
    [21, 1, 'kDDDDDDDDDkGGkDDDDDDDk'],
    [22, 1, 'kDDDDDDDDDDDDDDDDDDDDk'],
    [23, 1, 'kkkkkkkkkkkkkkkkkkkkkk']
  ]);
  MACHINES.register = anim(regPal, [regIdle, regIdle2], 2, {
    hit: [
      // CHA-CHING: drawer slams open showing bills and coins, display flashes
      patch(regOpen, [[8, 7, 'nnnnnnnnnn'], [7, 7, 'NnNnNnNnNn'], [9, 7, 'NnNnNnNnNn']]),
      // bell rings (nudged up, white ping)
      stamp(patch(regOpen, [[0, 10, 'kkkk'], [1, 9, 'kyyyyk'], [2, 8, 'kyyYYyyk'], [3, 8, 'kkkkkkkk']]), ['w.w', '.w.'], 15, 0)
    ]
  });

  // vault: round steel door with a spoked wheel and gold rivets.
  const vaultPal = pal({});
  const vaultIdle = [
    '..........kkkk..........',
    '.......kkkkGGkkkk.......',
    '.....kkGGGGGGGGGGkk.....',
    '....kkGGyggggggyGGkk....',
    '...kkGGgyyggggyygGGkk...',
    '..kkGgggggkkkkgggggGkk..',
    '..kGGgggkkWWWWkkgggGGk..',
    '.kGGgggkWWkkkkWWkgggGGk.',
    '.kGyygkWkkgWWgkkWkgyyGk.',
    '.kGgygkWkggWWggkWkgygGk.',
    'kkGggkWkgggWWgggkWkggGkk',
    'kGGggkWkWWWWWWWWkWkggGGk',
    'kGGggkWkWWWWWWWWkWkggGGk',
    'kkGggkWkgggWWgggkWkggGkk',
    '.kGgygkWkggWWggkWkgygGk.',
    '.kGyygkWkkgWWgkkWkgyyGk.',
    '.kGGgggkWWkkkkWWkgggGGk.',
    '..kGGgggkkWWWWkkgggGGk..',
    '..kkGgggggkkkkgggggGkk..',
    '...kkGGgyyggggyygGGkk...',
    '....kkGGyggggggyGGkk....',
    '.....kkGGGGGGGGGGkk.....',
    '.......kkkkGGkkkk.......',
    '..........kkkk..........'
  ];
  // wheel rotated 45°: spokes on the diagonals instead of the axes.
  const vaultTurn = patch(vaultIdle, [
    [8, 8, 'kWggggWk'], [9, 8, 'kgWggWgk'], [10, 8, 'kggWWggk'], [11, 8, 'kggWWggk'],
    [12, 8, 'kggWWggk'], [13, 8, 'kggWWggk'], [14, 8, 'kgWggWgk'], [15, 8, 'kWggggWk'],
    [10, 11, 'WW'], [11, 10, 'WWWW'], [12, 10, 'WWWW'], [13, 11, 'WW']
  ]);
  MACHINES.vault = anim(vaultPal, [vaultIdle, patch(vaultIdle, [[11, 11, 'kk'], [12, 11, 'kk']])], 2, {
    hit: [
      // wheel spins
      vaultTurn,
      // door cracks open: a dark gap on the left, coins spill from it
      stamp(shiftRows(vaultTurn, 0, 23, 1), ['k', 'kk', 'kky', 'kkyy', 'kkky', 'kky', 'kkyy', 'kky', 'kk', 'k'], 1, 7)
    ]
  });

  // core: a pulsing gold orb in a steel cage, cyan tubes feeding out to the city.
  // 'o' is the dim halo; frame 2 swaps it for the brighter 'O' so the orb breathes.
  const corePal = pal({ o: '#7a4a10', O: '#b8791c' });
  const coreIdle = [
    '..kkkkkkkkkkkkkkkkkkkk..',
    '.kGGGGGGGGGGGGGGGGGGGGk.',
    '.kGkkkkkkkkkkkkkkkkkkGk.',
    '.kGk.......oo.......kGk.',
    '.kGk....oooooooo....kGk.',
    '.kGk..oookkkkkkooo..kGk.',
    '.kGk.ookkyyyyyYkkoo.kGk.',
    '.kGk.okkywwyyyYYkko.kGk.',
    '.kGkookywwyyyyYYYkookGk.',
    '.kGkokyyywyyyyYYYYkokGk.',
    '.kGkokyyyyyyyyYYYYkokGk.',
    '.kGGokyyyyyyyyYYYYkoGGk.',
    '.kGGokyyyyyyyyYYYYkoGGk.',
    '.kGkokyyyyyyyyYYYYkokGk.',
    '.kGkokyyyyyyyyYYYYkokGk.',
    '.kGkookYYYYYYYYYYkookGk.',
    '.kGk.okkYYYYYYYYkko.kGk.',
    '.kGk.ookkYYYYYYkkoo.kGk.',
    '.kGk..oookkkkkkooo..kGk.',
    '.kGk....oooooooo....kGk.',
    '.kGk.......oo.......kGk.',
    '.kGkkkkkkkkkkkkkkkkkkGk.',
    '.kGGGGGGGGGGGGGGGGGGGGk.',
    'cckkkkkkkkkkkkkkkkkkkkcc'
  ];
  MACHINES.core = anim(corePal, [coreIdle, swapChars(coreIdle, { o: 'O' })], 2, {
    hit: [
      // flash: the orb goes white-hot, halo blazes
      swapChars(coreIdle, { y: 'w', Y: 'y', w: 'w', o: 'a' }),
      // afterglow
      swapChars(coreIdle, { y: 'w', o: 'O' })
    ]
  });

  // lever: a giant gate lever on a riveted base with a red (idle) / green (pulled) lamp.
  const leverPal = pal({});
  const leverBase = [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '..kkkkkkkkkkkkkkkkkkkk..',
    '.kGGGGGGkkkkkkkkkkGGGGk.',
    '.kGGGGGGGGGGGGGGGGGGGGk.',
    '.kGkrrkGGGGGGGGGGGGGGGk.',
    '.kGkrrkGGGGGGGGGGGGGGGk.',
    '.kGGGGGGGGGGGGGGGGGGGGk.',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '..kk................kk..'
  ];
  // The arm leans to the right when idle: knob top-right, shaft stepping down to the hub.
  const leverArmRight = [
    '................kkkk....',
    '...............krrrrk...',
    '...............krrRRk...',
    '...............kRRRRk...',
    '................kkkk....',
    '...............kggk.....',
    '...............kggk.....',
    '..............kggk......',
    '..............kggk......',
    '.............kggk.......',
    '.............kggk.......',
    '............kggk........',
    '............kggk........',
    '...........kggk.........',
    '...........kggk.........',
    '..........kkggkk........',
    '..........kWggWk........'
  ];
  const leverArmUp = [
    '..........kkkk..........',
    '.........krrrrk.........',
    '.........krrRRk.........',
    '.........kRRRRk.........',
    '..........kkkk..........',
    '..........kggk..........',
    '..........kggk..........',
    '..........kggk..........',
    '..........kggk..........',
    '..........kggk..........',
    '..........kggk..........',
    '..........kggk..........',
    '..........kggk..........',
    '..........kggk..........',
    '..........kggk..........',
    '..........kkggkk........',
    '..........kWggWk........'
  ];
  const leverIdle = stamp(leverBase, leverArmRight, 0, 0);
  const leverIdle2 = patch(leverIdle, [[19, 4, 'RR'], [20, 4, 'RR']]); // lamp blinks
  const leverPulled = patch(stamp(leverBase, flipH(leverArmRight), 0, 0), [[19, 4, 'nn'], [20, 4, 'nn']]);
  MACHINES.lever = anim(leverPal, [leverIdle, leverIdle2], 2, {
    hit: [
      stamp(leverBase, leverArmUp, 0, 0),
      leverPulled
    ],
    // extra: the fully-pulled pose for the moment the toll is paid.
    pulled: sprite(leverPal, leverPulled)
  });

  // ---------------------------------------------------------------------------
  // PORTRAITS — 16×16 dialogue faces for the nine characters plus 'you'.
  // ---------------------------------------------------------------------------
  const PORTRAITS = {};

  // THE MAINFRAME: a CRT with one red scanning eye and two lines of status text.
  PORTRAITS.mainframe = sprite(pal({}), [
    'kkkkkkkkkkkkkkkk',
    'kGGGGGGGGGGGGGGk',
    'kGkkkkkkkkkkkkGk',
    'kGkvvvvvvvvvvkGk',
    'kGkvvvvvvvvvvkGk',
    'kGkvvrrrrrrvvkGk',
    'kGkvrrrkkrrrvkGk',
    'kGkvvrrrrrrvvkGk',
    'kGkvvvvvvvvvvkGk',
    'kGkvnnvnnnvnvkGk',
    'kGkvvvvvvvvvvkGk',
    'kGkvnvnnvnnvvkGk',
    'kGkkkkkkkkkkkkGk',
    'kGGGrGGGGGGGnGGk',
    'kGGGGGGGGGGGGGGk',
    'kkkkkkkkkkkkkkkk'
  ]);

  // Glitch: grey bezel, dark screen, cyan smiley, a pale crack running down the middle.
  PORTRAITS.glitch = sprite(pal({}), [
    '.......kk.......',
    '......kcck......',
    '.......kk.......',
    '..kkkkkkkkkkkk..',
    '.kggggggggggggk.',
    '.kgkkkkkkkkkkgk.',
    '.kgkvvvvWvvvkgk.',
    '.kgkvcvvWvcvkgk.',
    '.kgkvvvWvvvvkgk.',
    '.kgkvcvWvvcvkgk.',
    '.kgkvvccccvvkgk.',
    '.kgkkkkkkkkkkgk.',
    '.kggggggggggggk.',
    '..kkkkkkkkkkkk..',
    '....kGGkkGGk....',
    '...kGGGGGGGGGGk.'
  ]);

  // Supervisor 9-2-5: beige box, square kind eyes, a tie painted straight onto the chassis.
  PORTRAITS.supe = sprite(pal({}), [
    '..kkkkkkkkkkkk..',
    '.kddddddddddddk.',
    '.kddddddddddddk.',
    '.kdkkkkddkkkkdk.',
    '.kdkwwkddkwwkdk.',
    '.kdkwekddkwekdk.',
    '.kdkkkkddkkkkdk.',
    '.kddddddddddddk.',
    '.kddkddddddkddk.',
    '.kdddkkkkkkdddk.',
    '.kddddddddddddk.',
    '..kkkkkkkkkkkk..',
    'kkkkkkkkkkkkkkkk',
    'kdwwddkrrkdddddk',
    'kdddddkrrkdddddk',
    'kddddddkkddddddk'
  ]);

  // Repo-Tron 3000: red slit eyes in a visor, an LED counter, treads, and a claw.
  PORTRAITS.repo = sprite(pal({}), [
    '..kkkkkkkkk.....',
    '.kgggggggggk....',
    '.kgkkkkkkkgk....',
    '.kgkrrkrrkgk....',
    '.kgkkkkkkkgk....',
    '.kgggggggggk.kkk',
    '.kgkkkkkkkgkkGGk',
    '.kgkrvrvrkgGGGk.',
    '.kgkvrvrvkgkkGGk',
    '.kgkkkkkkkgk.kkk',
    '.kgggggggggk....',
    '.kkkkkkkkkkk....',
    'kkkkkkkkkkkkk...',
    'kGkGkGkGkGkGk...',
    'kkGkGkGkGkGkk...',
    'kkkkkkkkkkkkk...'
  ]);

  // Doodad Dan v2.0: chrome head, purple top hat with a gold band, gold eyes, all teeth.
  PORTRAITS.dan = sprite(pal({}), [
    '....kkkkkkkk....',
    '....kppppppk....',
    '....kppppppk....',
    '....kyyyyyyk....',
    '..kkkkkkkkkkkk..',
    '.kmmmmmmmmmmmmk.',
    '.kmkkkkmmkkkkmk.',
    '.kmkyykmmkyykmk.',
    '.kmkkkkmmkkkkmk.',
    '.kmmmmmmmmmmmmk.',
    '.kmkkkkkkkkkkmk.',
    '.kmkwkwkwkwkwmk.',
    '.kmkkkkkkkkkkmk.',
    '.kmmmmmmmmmmmmk.',
    '..kkkkkkkkkkkk..',
    '.kMMMMkrrkMMMMk.'
  ]);

  // Doc Module: a white vending machine with a red cross and a cyan-eyed display.
  PORTRAITS.doc = sprite(pal({}), [
    '..kkkkkkkkkkkk..',
    '.kwwwwwwwwwwwwk.',
    '.kwkkkkkkkkkkwk.',
    '.kwkvvvvvvvvkwk.',
    '.kwkvcvvvvcvkwk.',
    '.kwkvvvvvvvvkwk.',
    '.kwkkkkkkkkkkwk.',
    '.kwwwwwrrwwwwwk.',
    '.kwwwwwrrwwwwwk.',
    '.kwwwrrrrrrwwwk.',
    '.kwwwrrrrrrwwwk.',
    '.kwwwwwrrwwwwwk.',
    '.kwwwwwrrwwwwwk.',
    '.kwwkkkwwwwkkwk.',
    '.kwwwwwwwwwwwwk.',
    '..kkkkkkkkkkkk..'
  ]);

  // R.E.S. TaxBot: navy chassis, green side stripes, red scanner bar, a nozzle with a coin in it.
  PORTRAITS.res = sprite(pal({}), [
    '...kkkkkkkkkk...',
    '..kvvvvvvvvvvk..',
    '.kvvvvvvvvvvvvk.',
    '.kvkkkkkkkkkkvk.',
    '.kvkrrrrrrrrkvk.',
    '.kvkkkkkkkkkkvk.',
    '.knvvvvvvvvvvnk.',
    '.knvvkkkkkkvvnk.',
    '.knvkGGGGGGkvnk.',
    '.knvkGkkkkGkvnk.',
    '.knvkGkyykGkvnk.',
    '.knvkGkkkkGkvnk.',
    '.knvkGGGGGGkvnk.',
    '.knvvkkkkkkvvnk.',
    '.kvvvvvvvvvvvvk.',
    '..kkkkkkkkkkkk..'
  ]);

  // Landlord Unit L-0RD: a brick building with lit windows for eyes and a door for a mouth.
  PORTRAITS.landlord = sprite(pal({}), [
    '..kkkkkkkkkkkk..',
    '.kRrRrRrRrRrRrk.',
    '.kRkkRRRRRRkkRk.',
    '.kRkkkkRRkkkkRk.',
    '.kRkyykRRkyykRk.',
    '.kRkyykRRkyykRk.',
    '.kRkkkkRRkkkkRk.',
    '.kRRRRRRRRRRRRk.',
    '.kRRRkkkkkkRRRk.',
    '.kRRRkTTTTkRRRk.',
    '.kRRRkTTTTkRRRk.',
    '.kRRRkTTyTkRRRk.',
    '.kRRRkTTTTkRRRk.',
    '.kRRRkTTTTkRRRk.',
    '.kRRRRRRRRRRRRk.',
    '..kkkkkkkkkkkk..'
  ]);

  // Maya (Unit 2201): long dark hair, calm smile, an orange sweater — the only warm face.
  PORTRAITS.maya = sprite(pal({ H: '#2a1a3a' }), [
    '....kkkkkkkk....',
    '...kHHHHHHHHk...',
    '..kHHHHHHHHHHk..',
    '..kHHssssssHHk..',
    '..kHssssssssHk..',
    '..kHssessessHk..',
    '..kHssssssssHk..',
    '..kHssSSSSssHk..',
    '..kHHssssssHHk..',
    '..kHHksssskHHk..',
    '..kHHkkkkkkHHk..',
    '..kHkooooookHk..',
    '.kkkooooooookkk.',
    'kooooooooooooook',
    'kooooooooooooook',
    'kkkkkkkkkkkkkkkk'
  ]);

  // you: Labor Unit 4471, hood up.
  PORTRAITS.you = sprite(pal({ H: PALETTES.OLIVE }), [
    '....kkkkkkkk....',
    '..kkHHHHHHHHkk..',
    '.kHHHHHHHHHHHHk.',
    '.kHHkkkkkkkkHHk.',
    '.kHHksssssskHHk.',
    '.kHHksesseskHHk.',
    '.kHHksssssskHHk.',
    '.kHHkssSSsskHHk.',
    '.kHHkSssssSkHHk.',
    '..kHHkkkkkkHHk..',
    '..kHHHHHHHHHHk..',
    '...kkHHHHHHkk...',
    '.kkkHHHHHHHHkkk.',
    '.kHHHHHHHHHHHHk.',
    'kHHHHHHHHHHHHHHk',
    'kkkkkkkkkkkkkkkk'
  ]);

  // ---------------------------------------------------------------------------
  // BOTS — the street cast. Two-frame walks where the spec asks for them.
  // ---------------------------------------------------------------------------
  const BOTS = {};

  const workerA = [
    '.....kk.....',
    '.....kck....',
    '...kkkkkk...',
    '..kggggggk..',
    '..kgkkkkgk..',
    '..kgkcckgk..',
    '..kggggggk..',
    '...kkkkkk...',
    '..kkGGGGkk..',
    '.kGkGGGGkGk.',
    '.kGkGGGGkGk.',
    '.kGkGGGGkGk.',
    '..kkkkkkkk..',
    '...kGkkGk...',
    '...kGkkGk...',
    '...kkkkkk...'
  ];
  const workerB = patch(workerA, [
    [13, 2, 'kGk..kGk'], [14, 2, 'kGk..kGk'], [15, 2, 'kkk..kkk'],
    [9, 1, 'kk'], [9, 9, 'kk'], [11, 1, 'kG'], [11, 9, 'Gk']
  ]);
  BOTS.worker = anim(pal({}), [workerA, workerB], 4);

  const customerA = [
    '....kkkk....',
    '...kbbbbk...',
    '..kbbbbbbk..',
    '..kbkbbkbk..',
    '..kbbbbbbk..',
    '..kbbkkbbk..',
    '...kbbbbk...',
    '..kkkkkkkk..',
    '.kbkbbbbkbk.',
    'kyykbbbbkbk.',
    'kyykbbbbkbk.',
    '.kkkbbbbkk..',
    '...kkkkkk...',
    '...kBkkBk...',
    '...kBkkBk...',
    '...kkkkkk...'
  ];
  const customerB = patch(customerA, [[13, 2, 'kBk..kBk'], [14, 2, 'kBk..kBk'], [15, 2, 'kkk..kkk']]);
  BOTS.customer = anim(pal({}), [customerA, customerB], 4);

  // golden: the worker chassis in gold with roaming sparkles.
  const goldenA = stamp(swapChars(workerA, { g: 'y', G: 'Y', c: 'w' }), ['w'], 0, 3);
  const goldenB = stamp(stamp(swapChars(workerB, { g: 'y', G: 'Y', c: 'w' }), ['w'], 11, 7), ['w'], 1, 12);
  BOTS.golden = anim(pal({}), [stamp(goldenA, ['w'], 10, 1), goldenB], 4);

  // Repo-Tron 3000: 20×20, treads, LED balance counter, claw on the right.
  const repoA = [
    '...kkkkkkkkkkkk.....',
    '...kggggggggggk.....',
    '...kgkkkkkkkkgk.....',
    '...kgkrrkkrrkgk.....',
    '...kgkkkkkkkkgk..kkk',
    '...kggggggggggk.kGGk',
    '...kgkkkkkkkkgkkGGk.',
    '...kgkvrvrvrkgGGGk..',
    '...kgkrvrvrvkgkkGGk.',
    '...kgkkkkkkkkgk.kGGk',
    '...kggggggggggk..kkk',
    '...kggggggggggk.....',
    '...kgggggkkgggk.....',
    '..kkkkkkkkkkkkkk....',
    '.kkkkkkkkkkkkkkkk...',
    'kkGkGkGkGkGkGkGkkk..',
    'kGkGkGkGkGkGkGkGkk..',
    'kkGkGkGkGkGkGkGkkk..',
    '.kkkkkkkkkkkkkkkk...',
    '..kkkkkkkkkkkkkk....'
  ];
  const repoB = patch(repoA, [
    [15, 0, 'kGkGkGkGkGkGkGkGkk'], [16, 0, 'kkGkGkGkGkGkGkGkkk'], [17, 0, 'kGkGkGkGkGkGkGkGkk'],
    [7, 6, 'rvrvrv'], [8, 6, 'vrvrvr'],
    [4, 17, '...'], [5, 16, 'kkkk'], [6, 15, 'kkGGk'], [8, 15, 'kkGGk'], [9, 16, 'kkkk'], [10, 17, '...']
  ]);
  BOTS.repo = anim(pal({}), [repoA, repoB], 3);

  // Supervisor 9-2-5 on the street: beige box on two little wheels, painted tie.
  const supeA = [
    '...kkkkkkkkkk...',
    '..kddddddddddk..',
    '..kdkkkddkkkdk..',
    '..kdkwkddkwkdk..',
    '..kdkkkddkkkdk..',
    '..kdddkkkkdddk..',
    '..kddddddddddk..',
    '...kkkkkkkkkk...',
    '.kkkkkkkkkkkkkk.',
    'kdkdddkrrkdddkdk',
    'kdkdddkrrkdddkdk',
    'kdkddddkkddddkdk',
    'kkkddddddddddkkk',
    '..kkkkkkkkkkkk..',
    '...kGGk..kGGk...',
    '...kkkk..kkkk...'
  ];
  BOTS.supe = anim(pal({}), [supeA, patch(supeA, [[3, 5, 'd'], [3, 10, 'd'], [14, 4, 'Gk..kG']])], 2);

  // Doodad Dan v2.0: chrome, purple top hat that rotates, gold eyes, tablet in hand.
  const danA = [
    '....kkkkkkk.....',
    '....kpppppk.....',
    '....kpppppk.....',
    '....kyyyyyk.....',
    '..kkkkkkkkkkk...',
    '..kmmmmmmmmmmk..',
    '..kmkykmmkykmk..',
    '..kmmmmmmmmmmk..',
    '..kmkwkwkwkwmk..',
    '..kmmmmmmmmmmk..',
    '...kkkkkkkkkk...',
    'kMMMMMkrrkMMMMMk',
    'kMkMMMMMMMMMMkMk',
    'kckMMMMMMMMMMkMk',
    'kkkMMMMMMMMMMkkk',
    '..kkkkkkkkkkkk..'
  ];
  const danB = patch(danA, [[0, 4, '.kkkkkkk'], [1, 4, '.kpppppk'], [2, 4, '.kpppppk'], [3, 4, '.kyyyyyk'], [4, 2, 'kkkkkkkkkkkk.'], [4, 3, '.kkkkkkkkkkk']]);
  BOTS.dan = anim(pal({}), [danA, danB], 2);

  // Doc Module: the portrait chassis on wheels; the display blinks.
  const docA = [
    '..kkkkkkkkkkkk..',
    '.kwwwwwwwwwwwwk.',
    '.kwkkkkkkkkkkwk.',
    '.kwkvcvvvvcvkwk.',
    '.kwkvvvvvvvvkwk.',
    '.kwkkkkkkkkkkwk.',
    '.kwwwwwrrwwwwwk.',
    '.kwwwrrrrrrwwwk.',
    '.kwwwrrrrrrwwwk.',
    '.kwwwwwrrwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwwkkkwwwwkkwk.',
    '.kwwwwwwwwwwwwk.',
    '..kkkkkkkkkkkk..',
    '...kGGk..kGGk...',
    '...kkkk..kkkk...'
  ];
  BOTS.doc = anim(pal({}), [docA, patch(docA, [[3, 5, 'v'], [3, 10, 'v'], [4, 5, 'c'], [4, 10, 'c']])], 2);

  // Glitch: the cracked-screen mentor with a wrench, on two wheels.
  const glitchA = [
    '.......kk.......',
    '......kcck......',
    '..kkkkkkkkkkkk..',
    '.kgkkkkkkkkkkgk.',
    '.kgkvvvvWvvvkgk.',
    '.kgkvcvvWvcvkgk.',
    '.kgkvvvWvvvvkgk.',
    '.kgkvcvWvvcvkgk.',
    '.kgkvvccccvvkgk.',
    '.kgkkkkkkkkkkgk.',
    '..kkkkkkkkkkkk..',
    '..kkggggggggkk..',
    '.kWkggggggggkGk.',
    '.kWkggggggggkGk.',
    '..kkkkkkkkkkkk..',
    '...kGGk..kGGk...'
  ];
  BOTS.glitch = anim(pal({}), [glitchA, patch(glitchA, [[1, 6, 'kwwk'], [0, 7, 'ww'], [12, 1, 'kWk'], [13, 1, 'kkk'], [11, 1, 'kW']])], 2);

  // Bot Butler: 10×14, bow tie, tray held out to the left.
  BOTS.butler = anim(pal({}), [[
    '...kkkk...',
    '..kmmmmk..',
    '..kmkmkmk.',
    '..kmmmmmk.',
    '...kkkkk..',
    '..kkrkrkk.',
    '.kGkGGGkGk',
    'kwwkGGGkGk',
    '.kkkGGGkGk',
    '..kkGGGkk.',
    '...kGGGk..',
    '...kkkkk..',
    '...kGkGk..',
    '...kkkkk..'
  ], [
    '...kkkk...',
    '..kmmmmk..',
    '..kmkmkmk.',
    '..kmmmmmk.',
    '...kkkkk..',
    '..kkrkrkk.',
    '.kGkGGGkGk',
    'kwwkGGGkGk',
    '.kkkGGGkGk',
    '..kkGGGkk.',
    '...kGGGk..',
    '...kkkkk..',
    '..kGk.kGk.',
    '..kkk.kkk.'
  ]], 4);

  // Pet Tiger-Bot: 16×12, orange with black stripes, facing left, two-frame trot.
  const tigerA = [
    '.kk...........kk',
    'kookkkkkkkkkkkok',
    'kowookoookoookok',
    'kooookooookooook',
    'kooookoookoookk.',
    'kkkookoookoook..',
    '..kooooooooook..',
    '..kkkkkkkkkkkk..',
    '.kokkok..kokkok.',
    '.kokkok..kokkok.',
    '.kokkok..kokkok.',
    '.kkkkkk..kkkkkk.'
  ];
  const tigerB = patch(tigerA, [[8, 0, 'kok..kokkok..kok'], [9, 0, 'kok..kokkok..kok'], [10, 0, 'kok..kokkok..kok'], [11, 0, 'kkk..kkkkkk..kkk']]);
  BOTS.tiger = anim(pal({}), [tigerA, tigerB], 4);

  // ---------------------------------------------------------------------------
  // ICONS — 16×16 unless noted (coin 8×8, bill 12×6). Keyed by the spec's ids.
  // ---------------------------------------------------------------------------
  const ICONS = {};
  const I = (rows, overrides) => sprite(pal(overrides), rows);

  ICONS.coin = I([
    '..kkkk..',
    '.kyyyyk.',
    'kyywyyyk',
    'kyYyyyYk',
    'kyYyyyYk',
    'kyyYYyyk',
    '.kyyyyk.',
    '..kkkk..'
  ]);
  ICONS.bill = I([
    'kkkkkkkkkkkk',
    'knnnnnnnnnnk',
    'knNnnyynnNnk',
    'knNnnyynnNnk',
    'knnnnnnnnnnk',
    'kkkkkkkkkkkk'
  ]);
  ICONS.heart = I([
    '................',
    '..kkkk....kkkk..',
    '.krrrrk..krrrrk.',
    'krrwwrrkkrrrrrrk',
    'krwrrrrrrrrrrrrk',
    'krrrrrrrrrrrRrrk',
    'krrrrrrrrrrRRrrk',
    '.krrrrrrrrrRRrk.',
    '..krrrrrrrrRRk..',
    '...krrrrrrRRk...',
    '....krrrrRRk....',
    '.....krrRRk.....',
    '......kRRk......',
    '.......kk.......',
    '................',
    '................'
  ]);
  ICONS.skull = I([
    '................',
    '.....kkkkkk.....',
    '...kkwwwwwwkk...',
    '..kwwwwwwwwwwk..',
    '.kwwwwwwwwwwwwk.',
    '.kwwkkkwwkkkwwk.',
    '.kwkkkkwwkkkkwk.',
    '.kwkkkkwwkkkkwk.',
    '.kwwkkwwwwkkwwk.',
    '.kwwwwwkkwwwwwk.',
    '..kwwwwwwwwwwk..',
    '...kwkwkwkwkk...',
    '....kkkkkkkk....',
    '................',
    '................',
    '................'
  ]);
  ICONS.lock = I([
    '................',
    '.....kkkkkk.....',
    '....kkggggkk....',
    '...kkgkkkkgkk...',
    '...kgk....kgk...',
    '...kgk....kgk...',
    '..kkkkkkkkkkkk..',
    '..kyyyyyyyyyyk..',
    '..kyyyyyyyyyyk..',
    '..kyyyykkyyyyk..',
    '..kyyyykkyyyyk..',
    '..kyyyyykyyyyk..',
    '..kyyyyyyyyyyk..',
    '..kYYYYYYYYYYk..',
    '..kkkkkkkkkkkk..',
    '................'
  ]);
  ICONS.star = I([
    '.......kk.......',
    '......kyyk......',
    '......kyyk......',
    '.....kyyyyk.....',
    'kkkkkkyyyykkkkkk',
    'kyyyyyyyyyyyyyyk',
    '.kkyyyyyyyyyykk.',
    '...kyyyyyyyyk...',
    '...kyyyyyyyyk...',
    '..kyyyyyyyyyyk..',
    '..kyyyykkyyyyk..',
    '.kyyykk..kkyyyk.',
    '.kyykk....kkyyk.',
    'kkkk........kkkk',
    '................',
    '................'
  ]);
  ICONS.envelope = I([
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kwwwwwwwwwwwwk.',
    '.kwkwwwwwwwwkwk.',
    '.kwwkwwwwwwkwwk.',
    '.kwwwkwwwwkwwwk.',
    '.kwwwwkwwkwwwwk.',
    '.kwwwkwkkwkwwwk.',
    '.kwwkwwrrwwkwwk.',
    '.kwkwwwrrwwwkwk.',
    '.kkwwwwwwwwwwkk.',
    '.kwwwwwwwwwwwwk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................'
  ]);
  ICONS.question = I([
    '................',
    '.....kkkkkk.....',
    '....kccccccck...',
    '...kcckkkkkcck..',
    '...kckk...kcck..',
    '...kkk....kcck..',
    '.........kcck...',
    '........kcck....',
    '.......kcck.....',
    '......kcck......',
    '......kcck......',
    '......kkkk......',
    '......kcck......',
    '......kcck......',
    '......kkkk......',
    '................'
  ]);

  // Tab icons
  ICONS.tab_work = I([ // briefcase with a punch card
    '................',
    '.....kkkkkk.....',
    '.....kTTTTk.....',
    '.kkkkkkkkkkkkkk.',
    '.kTTTTTTTTTTTTk.',
    '.kTtttttttttttk.',
    '.kTttttttttttTk.',
    '.kkkkkkkkkkkkkk.',
    '.kTttttkkkttttTk',
    '.kTttttkykttttTk',
    '.kTttttkkkttttTk',
    '.kTtttttttttttk.',
    '.kTTTTTTTTTTTTk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................'
  ]);
  ICONS.tab_biz = I([ // storefront with a striped awning
    '................',
    '.kkkkkkkkkkkkkk.',
    '.krwrwrwrwrwrwk.',
    '.krwrwrwrwrwrwk.',
    '.kkkkkkkkkkkkkk.',
    '..kddddddddddk..',
    '..kdkkkkddkkdk..',
    '..kdkcckddkTdk..',
    '..kdkcckddkTdk..',
    '..kdkkkkddkTdk..',
    '..kddddddddydk..',
    '..kddddddddTdk..',
    '..kddddddddTdk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................'
  ]);
  ICONS.tab_invest = I([ // rising chart with an arrow
    '................',
    '...........kkkk.',
    '...........knnk.',
    '..........knnnk.',
    '.........knnnnk.',
    '........knnkkkk.',
    '.......knnk.....',
    '......knnk......',
    '..kk.knnk.......',
    '.knnknnk........',
    '.knnnnnk........',
    '.knnnnk.........',
    '.kknnk..........',
    '.kkkkkkkkkkkkkk.',
    '.kkkkkkkkkkkkkk.',
    '................'
  ]);
  ICONS.tab_upgrades = I([ // gear
    '......kkkk......',
    '..kk.kggggk.kk..',
    '.kggkkggggkkggk.',
    '.kggggggggggggk.',
    '..kgggkkkkgggk..',
    '.kgggkkvvkkgggk.',
    'kgggkkvvvvkkgggk',
    'kgggkvvvvvvkgggk',
    'kgggkvvvvvvkgggk',
    'kgggkkvvvvkkgggk',
    '.kgggkkvvkkgggk.',
    '..kgggkkkkgggk..',
    '.kggggggggggggk.',
    '.kggkkggggkkggk.',
    '..kk.kggggk.kk..',
    '......kkkk......'
  ]);
  ICONS.tab_life = I([ // heart with a pulse line
    '................',
    '..kkkk....kkkk..',
    '.krrrrk..krrrrk.',
    'krrrrrrkkrrrrrrk',
    'krrrrrrrrrrrrrrk',
    'krrrrrrrrrrrrrrk',
    'kwwwrrwrrrrwwwwk',
    '.krrwrwrwrwrrrk.',
    '..krrwrrrwrrrk..',
    '...krrrrrrrrk...',
    '....krrrrrrk....',
    '.....krrrrk.....',
    '......krrk......',
    '.......kk.......',
    '................',
    '................'
  ]);
  ICONS.tab_ledger = I([ // Glitch's ledger: a purple book with a cyan bookmark
    '................',
    '..kkkkkkkkkkkk..',
    '.kPPPPPPPkccPPk.',
    '.kPkkkkkkkcckPk.',
    '.kPkwwwwwkcckPk.',
    '.kPkwkkkwkcckPk.',
    '.kPkwwwwwkkkkPk.',
    '.kPkwkkwwwwwkPk.',
    '.kPkwwwwwwwwkPk.',
    '.kPkwkkkkwwwkPk.',
    '.kPkwwwwwwwwkPk.',
    '.kPkkkkkkkkkkPk.',
    '.kPPPPPPPPPPPPk.',
    '..kkkkkkkkkkkk..',
    '................',
    '................'
  ]);

  // Businesses (14)
  ICONS.battery = I([
    '................',
    '......kkkk......',
    '.....kkGGkk.....',
    '....kNNNNNNk....',
    '....kNnnnnNk....',
    '....kNnnkkNk....',
    '....kNnkknNk....',
    '....kNkkkkNk....',
    '....kNkkkkNk....',
    '....kNnkknNk....',
    '....kNnnkkNk....',
    '....kNnnnnNk....',
    '....kNnnnnNk....',
    '....kNNNNNNk....',
    '....kkkkkkkk....',
    '................'
  ]);
  ICONS.vending = I([
    '...kkkkkkkkkk...',
    '..kbbbbbbbbbbk..',
    '..kbkkkkkkkbbk..',
    '..kbkwwwwwkbkk..',
    '..kbkoyrnckbkk..',
    '..kbkwwwwwkbkk..',
    '..kbkcornykbkk..',
    '..kbkwwwwwkbkk..',
    '..kbknyrockbkk..',
    '..kbkwwwwwkbkk..',
    '..kbkkkkkkkbbk..',
    '..kbbbbbbbbbbk..',
    '..kbbkkkkkkbbk..',
    '..kbbbbbbbbbbk..',
    '..kkkkkkkkkkkk..',
    '................'
  ]);
  ICONS.laundro = I([
    '..kkkkkkkkkkkk..',
    '.kwwwwwwwwwwwwk.',
    '.kwkkwwwwwwkkwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwkkkkwwwwk.',
    '.kwwwkccccckwwk.',
    '.kwwkccbbbcckwk.',
    '.kwwkcbwwbbckwk.',
    '.kwwkcbwbbbckwk.',
    '.kwwkccbbbcckwk.',
    '.kwwwkccccckwwk.',
    '.kwwwwkkkkwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kWWWWWWWWWWWWk.',
    '..kkkkkkkkkkkk..',
    '................'
  ]);
  ICONS.truck = I([
    '................',
    '.......W.W......',
    '......W.W.......',
    '.kkkkkkkkkkkk...',
    '.koooooooooookk.',
    '.kokkkkkkkkookk.',
    '.kokwwwwwwkooook',
    '.kokwwwwwwkookck',
    '.kokkkkkkkkookck',
    '.koooooooooookkk',
    '.kOOOOOOOOOOOOOk',
    'kkkkkkkkkkkkkkkk',
    '..kGGk.....kGGk.',
    '.kGkkGk...kGkkGk',
    '.kGkkGk...kGkkGk',
    '..kkkk.....kkkk.'
  ]);
  ICONS.carlot = I([
    '................',
    '................',
    '.....kkkkkk.....',
    '....krrrrrrk....',
    '...krkcccckrk...',
    '..krrkcccckrrk..',
    '.krrrkkkkkkrrrk.',
    'krrrrrrrrrrrrrrk',
    'krrrrrrrrrrrrrrk',
    'kRRRRRRRRRRRRRRk',
    'kkkkkkkkkkkkkkkk',
    '..kGGk....kGGk..',
    '..kkkk....kkkk..',
    '...cc..cc..cc...',
    '.cc..cc..cc..cc.',
    '................'
  ]);
  ICONS.podtower = I([
    '....kkkkkkkk....',
    '...kggggggggk...',
    '...kgkykykygk...',
    '...kgkkkkkkgk...',
    '...kgkykykygk...',
    '...kgkkkkkkgk...',
    '...kgkykykygk...',
    '...kgkkkkkkgk...',
    '...kgkykykygk...',
    '...kgkkkkkkgk...',
    '...kgkykykygk...',
    '...kgkkkkkkgk...',
    '...kggggkkggk...',
    '...kggggkkggk...',
    '...kkkkkkkkkk...',
    '................'
  ]);
  ICONS.datafarm = I([
    '..kkkkkkkkkkkk..',
    '.kGGGGGGGGGGGGk.',
    '.kGnGnGnGkkkkGk.',
    '.kGGGGGGGGGGGGk.',
    '.kkkkkkkkkkkkkk.',
    '.kGGGGGGGGGGGGk.',
    '.kGnGnGnGkkkkGk.',
    '.kGGGGGGGGGGGGk.',
    '.kkkkkkkkkkkkkk.',
    '.kGGGGGGGGGGGGk.',
    '.kGnGnGnGkkkkGk.',
    '.kGGGGGGGGGGGGk.',
    '.kkkkkkkkkkkkkk.',
    '.kGGGGGGGGGGGGk.',
    '.kGnGcGnGkkkkGk.',
    '.kkkkkkkkkkkkkk.'
  ]);
  ICONS.drones = I([
    '.kkkk......kkkk.',
    'kggggk....kggggk',
    '.kkkkk....kkkkk.',
    '...kkkkkkkkkk...',
    '...kGGGGGGGGk...',
    '...kGGkccGGGk...',
    '...kGGkkkGGGk...',
    '...kkkkkkkkkk...',
    '......kkkk......',
    '.....kttttk.....',
    '.....ktTTtk.....',
    '.....ktTTtk.....',
    '.....kttttk.....',
    '.....kkkkkk.....',
    '................',
    '................'
  ]);
  ICONS.repair = I([
    '..........kkkk..',
    '.........kggggk.',
    '........kgkkkkgk',
    '.......kggk..kk.',
    '......kggggk....',
    '.....kggggk.....',
    '....kggggk......',
    '...kggggk.......',
    '..kggggk........',
    '.kggggk.........',
    'kgggkk..........',
    'kggk..oo........',
    'kkk..ooooo......',
    '....oo...oo.....',
    '......o.o.......',
    '................'
  ]);
  ICONS.solar = I([
    '............kkk.',
    '...........kyyyk',
    '...........kyyyk',
    '............kkk.',
    '.kkkkkkkkkkkkk..',
    '.kbkbkbkbkbkbk..',
    '.kkkkkkkkkkkkk..',
    '.kbkbkbkbkbkbk..',
    '.kkkkkkkkkkkkk..',
    '.kbkbkbkbkbkbk..',
    '.kkkkkkkkkkkkk..',
    '......kGGk......',
    '......kGGk......',
    '....kkkkkkkk....',
    '....kGGGGGGk....',
    '....kkkkkkkk....'
  ]);
  ICONS.casino = I([
    '................',
    '..kkkkkkkkkkkk..',
    '.kiiiiiiiiiiiik.',
    '.kikkkkkkkkkkik.',
    '.kikyykkkkkyyik.',
    '.kikyykkkkkyyik.',
    '.kikkkkyykkkkik.',
    '.kikkkkyykkkkik.',
    '.kikyykkkkkyyik.',
    '.kikyykkkkkyyik.',
    '.kikkkkkkkkkkik.',
    '.kiiiiiiiiiiiik.',
    '..kkkkkkkkkkkk..',
    '..i.i.i.i.i.i...',
    '.i.i.i.i.i.i.i..',
    '................'
  ]);
  ICONS.signal = I([
    '.......kk.......',
    '......kcck......',
    '.....kc..ck.....',
    '....kc.kk.ck....',
    '...kc.kGGk.ck...',
    '......kGGk......',
    '.....kGGGGk.....',
    '.....kGkkGk.....',
    '....kGGGGGGk....',
    '....kGkkkkGk....',
    '...kGGkkkkGGk...',
    '...kGkkkkkkGk...',
    '..kGGkkkkkkGGk..',
    '..kGkkkkkkkkGk..',
    '.kkkkkkkkkkkkkk.',
    '................'
  ]);
  ICONS.foundry = I([
    '..kk...kk.......',
    '.kGGk.kGGk..WW..',
    '.kGGk.kGGk.W....',
    '.kGGk.kGGk......',
    '.kGGk.kGGk......',
    'kkkkkkkkkkkkkkkk',
    'kRRRRRRRRRRRRRRk',
    'kRkkRkkRkkRkkRRk',
    'kRkoRkoRkoRkoRRk',
    'kRkkRkkRkkRkkRRk',
    'kRRRRRRRRRRRRRRk',
    'kRRRRRkkkkRRRRRk',
    'kRRRRRkTTkRRRRRk',
    'kRRRRRkTTkRRRRRk',
    'kkkkkkkkkkkkkkkk',
    '................'
  ]);
  ICONS.orbital = I([
    '................',
    '.....kkkkk......',
    '...kkGGGGGkk....',
    '..kGGGgGGGGGk...',
    '.kGGGGGGGgGGGk..',
    '.kGgGGGGGGGGGGk.',
    '.kGGGGGGgGGGGGk.',
    '.kGGGGGGGGGGGGk.',
    '..kGGGGgGGGGGk..',
    '...kkGGGGGGkk...',
    '.....kkkkkk.....',
    '.......kk.......',
    '......kyyk......',
    '......kyyk......',
    '......kkkk......',
    '................'
  ]);

  // Investments (5)
  ICONS.b500 = I([
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kvvvvvvvvvvvvk.',
    '.kvvvvvvvvvvnvk.',
    '.kvvvvvvvvvnnvk.',
    '.kvvvvvvvvnnvvk.',
    '.kvvvvvvvnnvvvk.',
    '.kvvnnvvnnvvvvk.',
    '.kvnvvnnnvvvvvk.',
    '.kvnvvvnvvvvvvk.',
    '.kvvvvvvvvvvvvk.',
    '.kvkkkkkkkkkkvk.',
    '.kvvvvvvvvvvvvk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................'
  ]);
  ICONS.mcu = I([
    '................',
    '........kkk.....',
    '.......kyyk.....',
    '......kyyyk.....',
    '.....kyyyk......',
    '....kyyyk.......',
    '...kyyyykkkk....',
    '..kyyyyyyyyk....',
    '..kkkkkyyyyk....',
    '......kyyyk.....',
    '.....kyyyk......',
    '.....kyyk.......',
    '....kyyk........',
    '....kyk.........',
    '....kk..........',
    '................'
  ]);
  ICONS.bond = I([
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kddddddddddddk.',
    '.kdkkkkkkkkkkdk.',
    '.kddddddddddddk.',
    '.kdkkkkkddkkkdk.',
    '.kddddddddddddk.',
    '.kdkkkkkkkkkkdk.',
    '.kddddddddddddk.',
    '.kdkkkkkddkkkdk.',
    '.kddddddddkkddk.',
    '.kddddddddkrrdk.',
    '.kdddddddddkkdk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................'
  ]);
  ICONS.reit = I([
    '....kkkkkkkk....',
    '...kggggggggk...',
    '...kgkykykygk...',
    '...kgkkkkkkgk...',
    '...kgkykykygk...',
    '...kgkkkkkkgk...',
    '...kgkykykygk...',
    '...kgggggggkkkk.',
    '...kgggggggkyyk.',
    '...kggggggkyyyyk',
    '...kggggggkywyyk',
    '...kggggggkyYyyk',
    '...kggggggkyyyyk',
    '...kkkkkkkkkyyk.',
    '............kkk.',
    '................'
  ]);
  ICONS.bitbot = I([
    '.....kkkkkk.....',
    '...kkyyyyyykk...',
    '..kyyyyyyyyyyk..',
    '.kyyykkkkkkyyyk.',
    '.kyykYYYYYYkyyk.',
    'kyyykYkkkkYkyyyk',
    'kyyykYkyykYkyyyk',
    'kyyykYYYYYYkyyyk',
    'kyyykYkkkkYkyyyk',
    'kyyykYkyykYkyyyk',
    '.kyykYYYYYYkyyk.',
    '.kyyykkkkkkyyyk.',
    '..kyyyyyyyyyyk..',
    '...kkyyyyyykk...',
    '.....kkkkkk.....',
    '................'
  ]);

  // Health items (8)
  ICONS.gym = I([
    '................',
    '................',
    '.kk..........kk.',
    'kGGk........kGGk',
    'kGGkkkkkkkkkkGGk',
    'kGGkGGGGGGGGkGGk',
    'kGGkGGGGGGGGkGGk',
    'kGGkkkkkkkkkkGGk',
    'kGGk........kGGk',
    '.kk..........kk.',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................'
  ]);
  ICONS.insurance = I([
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kbbbbbbbbbbbbk.',
    '.kbbbbbwwbbbbbk.',
    '.kbbbbbwwbbbbbk.',
    '.kbbbwwwwwwbbbk.',
    '.kbbbwwwwwwbbbk.',
    '.kbbbbbwwbbbbbk.',
    '..kbbbbwwbbbbk..',
    '..kbbbbbbbbbbk..',
    '...kbbbbbbbbk...',
    '....kbbbbbbk....',
    '.....kbbbbk.....',
    '......kbbk......',
    '.......kk.......',
    '................'
  ]);
  ICONS.checkups = I([
    '................',
    '...kk......kk...',
    '..kGGk....kGGk..',
    '..kGGk....kGGk..',
    '..kGGk....kGGk..',
    '..kGGk....kGGk..',
    '...kGGk..kGGk...',
    '....kGGkkGGk....',
    '.....kGGGGk.....',
    '......kGGk......',
    '......kGGk......',
    '......kGGkkkk...',
    '......kGGkrrk...',
    '.......kkkrrk...',
    '.........kkk....',
    '................'
  ]);
  ICONS.organs = I([
    '................',
    '..kkkk...kkkk...',
    '.kiirikkkriiik..',
    '.kirrrrrrrrrik..',
    '.kirrrrRRrrrik..',
    '..kirrrRRRrrk...',
    '..kirrrrrRrik...',
    '...kirrrrrrk....',
    '....kirrrik.....',
    '.....kiik.......',
    '......kk........',
    '.kkkkkkkkkkkkk..',
    '.kcccccccccccck.',
    '.kckckckckckcck.',
    '.kkkkkkkkkkkkkk.',
    '................'
  ]);
  ICONS.nanobots = I([
    '.......kk.......',
    '......kcck......',
    '.....kccccck....',
    '....kcccccck....',
    '...kcccccccck...',
    '...kcckkkkcck...',
    '..kcckwwwwkcck..',
    '..kcckwkkwkcck..',
    '..kcckwwwwkcck..',
    '..kccckkkkccck..',
    '..kcccccccccck..',
    '...kcccccccck...',
    '...kcccccccck...',
    '....kccccccck...',
    '.....kkkkkk.....',
    '................'
  ]);
  ICONS.genes = I([
    '..kkk.....kkk...',
    '..kcck...kcck...',
    '...kcckkkcck....',
    '....kcccccck....',
    '.....kcccck.....',
    '......kcck......',
    '.....kicck......',
    '....kiiccik.....',
    '...kiikkkiik....',
    '..kiik...kiik...',
    '..kiik...kiik...',
    '...kiikkkiik....',
    '....kiiiiik.....',
    '.....kiiik......',
    '......kkk.......',
    '................'
  ]);
  ICONS.cryo = I([
    '.......kk.......',
    '......kcck......',
    '..kk..kcck..kk..',
    '.kcck.kcck.kcck.',
    '..kcckkcckkcck..',
    '...kccccccck....',
    '....kcccccck....',
    '.kkkkccwwcckkkk.',
    'kcccccwwwwccccck',
    '.kkkkccwwcckkkk.',
    '....kcccccck....',
    '...kccccccck....',
    '..kcckkcckkcck..',
    '.kcck.kcck.kcck.',
    '..kk..kcck..kk..',
    '......kkkk......'
  ]);
  ICONS.chip = I([ // the Miracle Chip: a die with a '?' burned into it
    '..k..k..k..k....',
    '.kkkkkkkkkkkkk..',
    'kkGGGGGGGGGGGkk.',
    '.kGkkkkkkkkkGk..',
    'kkGkiiiiiiikGkk.',
    '.kGkikiiikikGk..',
    'kkGkikikikikGkk.',
    '.kGkikkkikikGk..',
    'kkGkikkikkikGkk.',
    '.kGkikkikkikGk..',
    'kkGkiiiiiiikGkk.',
    '.kGkkkkkkkkkGk..',
    'kkGGGGGGGGGGGkk.',
    '.kkkkkkkkkkkkk..',
    '..k..k..k..k....',
    '................'
  ]);

  // Power-ups (5)
  ICONS.overclock = I([
    '.....kkkkkk.....',
    '...kkggggggkk...',
    '..kggggkkkgggk..',
    '.kgggggkykggggk.',
    '.kgggggkykggggk.',
    'kggggggkykggggGk',
    'kgggggkyykgggggk',
    'kgggggkyykkkgggk',
    'kggggkyyyykgggkk',
    'kgggkkkkyykgggkk',
    '.kggggggkykgggk.',
    '.kgggggkkkgggGk.',
    '..kgggggggggGk..',
    '...kkGGGGGGkk...',
    '.....kkkkkk.....',
    '................'
  ]);
  ICONS.strike = I([
    '................',
    '.....kkkkkk.....',
    '....kggggggk....',
    '...kggkkkkggk...',
    '...kgkccccgk....',
    '...kgkccccgkk...',
    '...kkkkkkkkkkk..',
    '....kkkkkkkkk...',
    '....kGGGGGGGk...',
    '..kkkkkkkkkkkkk.',
    '.krrrrrrrrrrrrrk',
    '.krwwwrrrrrrwwrk',
    '.krrrrrrrrrrrrrk',
    '.kRRRRRRRRRRRRRk',
    '.kkkkkkkkkkkkkkk',
    '................'
  ]);
  ICONS.taxholiday = I([
    '................',
    '.kkkkkkkkkkkkk..',
    '.knnnnnnnnnnnnk.',
    '.knkkkkknkkkknk.',
    '.knnkknnnnkknnk.',
    '.knnkknnnnkknnk.',
    '.knnkknnnnkknnk.',
    '.knnkknnkknknnk.',
    '.knnkknnnkkknnk.',
    '.knnnnnnnnnnnnk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '.kkkk.kkk.kkkk..',
    '.kryk.krk.kryk..',
    '.kkkk.kkk.kkkk..',
    '................'
  ]);
  ICONS.coffee = I([
    '......W..W......',
    '.....W..W.......',
    '......W..W......',
    '................',
    '..kkkkkkkkkk....',
    '..kwwwwwwwwkkk..',
    '..kwkkkkkkwkwwk.',
    '..kwkOOOOkwkwwk.',
    '..kwkOOOOkwkwwk.',
    '..kwkOOOOkwkkk..',
    '..kwkkkkkkwk....',
    '..kwwwwwwwwk....',
    '...kwwwwwwk.....',
    '..kkkkkkkkkk....',
    '..kGGGGGGGGk....',
    '..kkkkkkkkkk....'
  ]);
  ICONS.energy = I([
    '.....kkkkkk.....',
    '.....kWWWWk.....',
    '....kkkkkkkk....',
    '....knnnnnnk....',
    '....knnnkknk....',
    '....knnkynnk....',
    '....knkyynnk....',
    '....kkyyykkk....',
    '....knkkyynk....',
    '....knnnkynk....',
    '....knnnnknk....',
    '....knnnnnnk....',
    '....kNNNNNNk....',
    '....kkkkkkkk....',
    '................',
    '................'
  ]);

  // Doodads (8)
  ICONS.hoverbike = I([
    '................',
    '..........kkk...',
    '.........kkGk...',
    '..kkk...kGGk....',
    '.krrrkkkGGk.....',
    '.krrrrrrrGk.....',
    'kkrrrrrrrGGk....',
    'krrrrrrrrrrrk...',
    'kRRRRRRRRRRRRk..',
    '.kkkkkkkkkkkkk..',
    '..kGGk....kGGk..',
    '..kkkk....kkkk..',
    '...cc..cc..cc...',
    '.cc..cc..cc.....',
    '................',
    '................'
  ]);
  ICONS.implants = I([
    '................',
    '....kkkkkk......',
    '...kmmmmmmk.....',
    '..kmmkmmkmmk....',
    '..kmmkmmkmmk....',
    '..kmmmmmmmmk....',
    '..kmmkkkkmmk....',
    '...kmmmmmmk.....',
    '....kkkkkk......',
    '..kkkkkkkkkkkk..',
    '.kmmmmmkkmmmmmk.',
    '.kmmmmkcckmmmmk.',
    '.kmmmmkcckmmmmk.',
    '.kmmmmmkkmmmmmk.',
    '.kkkkkkkkkkkkkk.',
    '................'
  ]);
  ICONS.butler = I([
    '.....kkkkkk.....',
    '....kmmmmmmk....',
    '....kmkmmkmk....',
    '....kmmmmmmk....',
    '....kmmkkmmk....',
    '.....kkkkkk.....',
    '....kkkrkrkkk...',
    '...kGGkkkkkGGk..',
    '..kGGGGGGGGGGGk.',
    '.kkkkGGGGGGGGGk.',
    'kwwwwkGGGGGGGGk.',
    '.kkkkkGGGGGGGGk.',
    '..kGGGGGGGGGGGk.',
    '..kkkkkkkkkkkkk.',
    '................',
    '................'
  ]);
  ICONS.exosuit = I([
    '......kkkk......',
    '.....kyyyyk.....',
    '.....kykkyk.....',
    '......kkkk......',
    '..kkkkkkkkkkkk..',
    '.kyyykGGGGkyyyk.',
    '.kykkkGGyyGkkkyk',
    '.kykkGGGGGGGkkyk',
    '.kykkGGGyyGGkkyk',
    '.kkkkGGGGGGGkkkk',
    '....kGGGyyGGk...',
    '....kGGGGGGGk...',
    '....kkkkkkkkk...',
    '....kyyk.kyyk...',
    '....kyyk.kyyk...',
    '....kkkk.kkkk...'
  ]);
  ICONS.lambo = I([
    '................',
    '................',
    '................',
    '......kkkkkk....',
    '.....krkkkkrk...',
    '....krrkccckrk..',
    '...krrrkkkkkrrk.',
    '..krrrrrrrrrrrrk',
    '.krrrrrrrrrrrrrk',
    'kyrrrrrrrrrrrrrk',
    'kRRRRRRRRRRRRRRk',
    'kkkkkkkkkkkkkkkk',
    '..kGGk....kGGk..',
    '..kkkk....kkkk..',
    '................',
    '................'
  ]);
  ICONS.yacht = I([
    '................',
    '........kk......',
    '.......kwwk.....',
    '.......kwwwk....',
    '.......kwwwwk...',
    '....kkkkwwwwwk..',
    '...kwwwwwwwwwwk.',
    '...kwkkkkwwwwwk.',
    '..kkkkkkkkkkkkkk',
    '.kwwkbkbkbkbwwwk',
    '.kwwwwwwwwwwwwwk',
    '..kwwwwwwwwwwwk.',
    '...kkkkkkkkkkk..',
    '..cc..cc..cc..cc',
    'cc..cc..cc..cc..',
    '................'
  ]);
  ICONS.tiger = I([
    '................',
    '.kk..........kk.',
    'kookkkkkkkkkkook',
    'kooooooooooooook',
    'kokooookooookook',
    'kokoowookwookook',
    'kooooooooooooook',
    'kooookoookkooook',
    'kooookoookkooook',
    '.koooookkkkoook.',
    '..kooookkkkook..',
    '...kooooooooook.',
    '....kkoooooookk.',
    '......kkkkkkk...',
    '................',
    '................'
  ]);
  ICONS.moonplot = I([
    '.....kkkkkk.....',
    '...kkWWWWWWkk...',
    '..kWWWWWWWWWWk..',
    '.kWWWgWWWWWkkkk.',
    '.kWWWWWWWWWkrrk.',
    'kWWWWWWWWWWkrrk.',
    'kWWWWgWWWWWkrrk.',
    'kWWWWWWWWWWkkkk.',
    'kWWWWWWWWWWkWWWk',
    'kWWgWWWWWWWkWWWk',
    '.kWWWWWWgWWkWWk.',
    '.kWWWWWWWWWkWWk.',
    '..kWWWWWWWWkWk..',
    '...kkWWWWWWkk...',
    '.....kkkkkk.....',
    '................'
  ]);

  // Achievement badge: a gold medal with a star; six frames sweep a shine across it.
  const badgeBase = [
    '.....kkkkkk.....',
    '....krrrrrrk....',
    '....krrrrrrk....',
    '...kkkrrrrkkk...',
    '..kyyykkkkyyyk..',
    '.kyyyyyyyyyyyyk.',
    '.kyyyyyyyyyyyyk.',
    'kyyyyyywwyyyyyyk',
    'kyyyyywwwwyyyyyk',
    'kyyyywwwwwwyyyyk',
    'kyyyyyywwyyyyyyk',
    'kyyyyywwwwyyyyyk',
    '.kyyywwyywwyyyk.',
    '.kYYYYYYYYYYYYk.',
    '..kYYYYYYYYYYk..',
    '...kkkkkkkkkk...'
  ];
  const badgeFrames = [];
  for (let f = 0; f < 6; f++) {
    // a diagonal white-gold streak that moves from left to right across the medal
    let g = badgeBase;
    if (f > 0) {
      const edits = [];
      for (let y = 4; y < 15; y++) {
        const x = f * 3 - 4 + (14 - y);
        edits.push([y, x, ' ']);
        const row = g[y];
        if (x >= 0 && x < 16 && row[x] === 'y') edits.push([y, x, 'W']);
        if (x + 1 >= 0 && x + 1 < 16 && row[x + 1] === 'y') edits.push([y, x + 1, 'W']);
      }
      g = patch(g, edits);
    }
    badgeFrames.push(g);
  }
  ICONS.badge = anim(pal({}), badgeFrames, 8);

  // ---------------------------------------------------------------------------
  // Validation (runs once at load; a bad grid is a bug, so fail loudly in tests)
  // ---------------------------------------------------------------------------
  function gridsOf(sp) {
    const out = [];
    if (sp.rows) out.push(sp.rows);
    if (sp.frames) sp.frames.forEach((f) => out.push(f));
    if (sp.hit) sp.hit.forEach((f) => out.push(f));
    return out;
  }
  function validate(path, sp) {
    for (const rows of gridsOf(sp)) {
      const w = rows[0].length;
      rows.forEach((row, y) => {
        if (row.length !== w) throw new Error('Sprites: ' + path + ' row ' + y + ' has length ' + row.length + ', expected ' + w);
        for (const ch of row) {
          if (ch !== '.' && !sp.palette[ch]) throw new Error('Sprites: ' + path + ' row ' + y + ' uses unmapped char "' + ch + '"');
        }
      });
    }
  }

  // Every sprite key path (for contact sheets / tests), e.g. 'AVATARS.vagrant',
  // 'AVATARS.vagrant.reactions.jump', 'MACHINES.sign', 'ICONS.coin'.
  const GROUPS = { AVATARS: AVATARS, MACHINES: MACHINES, PORTRAITS: PORTRAITS, BOTS: BOTS, ICONS: ICONS };
  function list() {
    const out = [];
    for (const g in GROUPS) {
      for (const id in GROUPS[g]) {
        out.push(g + '.' + id);
        const sp = GROUPS[g][id];
        if (sp.reactions) for (const r in sp.reactions) out.push(g + '.' + id + '.reactions.' + r);
        if (sp.pulled) out.push(g + '.' + id + '.pulled');
      }
    }
    return out;
  }
  function get(path) {
    const parts = path.split('.');
    let cur = GROUPS;
    for (const p of parts) { if (cur == null) return null; cur = cur[p]; }
    return cur || null;
  }
  list().forEach((p) => validate(p, get(p)));

  // ---------------------------------------------------------------------------
  // Animation + rendering
  // ---------------------------------------------------------------------------
  // Sub-sprites for animation frames are memoised on the parent so render() can use
  // object identity as its cache key.
  function frameSprite(sp, i) {
    if (!sp._frameSprites) sp._frameSprites = sp.frames.map((rows) => sprite(sp.palette, rows, { parent: sp }));
    return sp._frameSprites[i];
  }
  function hitSprite(sp, i) {
    if (!sp._hitSprites) sp._hitSprites = sp.hit.map((rows) => sprite(sp.palette, rows, { parent: sp, hit: true }));
    return sp._hitSprites[i];
  }

  // The static sub-sprite to show at time tMs. Static sprites come back unchanged.
  // opts.hit = true picks from a Machine's click frames (tMs then indexes from the click).
  function frame(sp, tMs, opts) {
    if (!sp) return null;
    if (opts && opts.hit && sp.hit) {
      const fps = opts.fps || 12;
      const i = Math.min(sp.hit.length - 1, Math.floor(Math.max(0, tMs || 0) / 1000 * fps));
      return hitSprite(sp, i);
    }
    if (!sp.frames) return sp;
    const fps = sp.fps || 2;
    const i = Math.floor(Math.max(0, tMs || 0) / 1000 * fps) % sp.frames.length;
    return frameSprite(sp, i);
  }

  // A copy of a sprite with some palette entries replaced (hair greying, ghosting),
  // memoised per sprite + override set so render() caching still works.
  function withPalette(sp, overrides) {
    const key = JSON.stringify(overrides);
    if (!sp._variants) sp._variants = {};
    if (sp._variants[key]) return sp._variants[key];
    const palette = Object.assign({}, sp.palette, overrides);
    let v;
    if (sp.frames) {
      v = anim(palette, sp.frames, sp.fps);
      if (sp.hit) v.hit = sp.hit;
      if (sp.reactions) {
        v.reactions = {};
        for (const r in sp.reactions) v.reactions[r] = sprite(palette, sp.reactions[r].rows);
      }
    } else {
      v = sprite(palette, sp.rows);
    }
    sp._variants[key] = v;
    return v;
  }

  // Render cache: WeakMap(sprite object) → Map(optionKey → canvas).
  const cache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  let cacheCount = 0;

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Draw a static sprite to a fresh canvas at integer `scale`. tint: '#hex' recolours every
  // opaque pixel (silhouettes, white flashes); { color, amount } blends instead.
  function paint(sp, scale, opts) {
    const doc = root.document;
    if (!doc || !doc.createElement) throw new Error('Sprites.render needs a DOM (call it in the browser, not at load time)');
    const rows = sp.rows;
    const w = rows[0].length; const h = rows.length;
    const canvas = doc.createElement('canvas');
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w * scale, h * scale);
    const data = img.data;
    const flip = !!opts.flip;
    const alpha = opts.alpha === undefined ? 1 : Math.max(0, Math.min(1, opts.alpha));
    let tintRgb = null; let tintAmt = 0;
    if (typeof opts.tint === 'string') { tintRgb = hexToRgb(opts.tint); tintAmt = 1; }
    else if (opts.tint && opts.tint.color) { tintRgb = hexToRgb(opts.tint.color); tintAmt = opts.tint.amount === undefined ? 0.5 : opts.tint.amount; }
    const rgbCache = {};
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = row[flip ? w - 1 - x : x];
        if (ch === '.') continue;
        let rgb = rgbCache[ch];
        if (!rgb) {
          rgb = hexToRgb(sp.palette[ch] || PALETTES.MAGENTA);
          if (tintRgb) rgb = rgb.map((c, i) => Math.round(c + (tintRgb[i] - c) * tintAmt));
          rgbCache[ch] = rgb;
        }
        const a = Math.round(alpha * 255);
        for (let sy = 0; sy < scale; sy++) {
          let idx = (((y * scale + sy) * w * scale) + x * scale) * 4;
          for (let sx = 0; sx < scale; sx++) {
            data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = a;
            idx += 4;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // render(sprite, scale, { flip, tint, frame, alpha, hit }) → cached canvas.
  // `frame` picks an animation frame index (or a hit frame with hit: true); for a
  // static sprite it is ignored. Canvases are cached per sprite identity + options.
  function render(sp, scale, opts) {
    opts = opts || {};
    scale = Math.max(1, Math.round(scale || 1));
    let target = sp;
    if (sp.frames || sp.hit) {
      if (opts.hit && sp.hit) target = hitSprite(sp, Math.min(sp.hit.length - 1, opts.frame || 0));
      else if (sp.frames) target = frameSprite(sp, (opts.frame || 0) % sp.frames.length);
    }
    const key = scale + '|' + (opts.flip ? 1 : 0) + '|' + (opts.tint ? JSON.stringify(opts.tint) : '') + '|' + (opts.alpha === undefined ? 1 : opts.alpha);
    let bucket = cache ? cache.get(target) : null;
    if (!bucket) { bucket = new Map(); if (cache) cache.set(target, bucket); }
    let canvas = bucket.get(key);
    if (!canvas) {
      canvas = paint(target, scale, opts);
      bucket.set(key, canvas);
      cacheCount++;
    }
    return canvas;
  }

  // draw(ctx, sprite, x, y, scale, opts): opts.t (ms) picks the animation frame when
  // opts.frame is not given; otherwise same options as render().
  function draw(ctx, sp, x, y, scale, opts) {
    opts = opts || {};
    let target = sp;
    if (opts.frame === undefined && opts.t !== undefined) target = frame(sp, opts.t, opts);
    const canvas = render(target, scale, opts);
    ctx.drawImage(canvas, Math.round(x), Math.round(y));
    return canvas;
  }

  const API = {
    PALETTES: PALETTES,
    BASE_CHARS: BASE,
    AVATARS: AVATARS,
    MACHINES: MACHINES,
    PORTRAITS: PORTRAITS,
    BOTS: BOTS,
    ICONS: ICONS,
    render: render,
    frame: frame,
    draw: draw,
    list: list,
    get: get,
    withPalette: withPalette,
    // grid helpers, exported so sprites-city.js / tests can reuse them
    util: { blank: blank, stamp: stamp, patch: patch, shift: shift, shiftRows: shiftRows, flipH: flipH, swapChars: swapChars, sprite: sprite, anim: anim, pal: pal, text: text, FONT: FONT },
    cacheSize: function () { return cacheCount; }
  };
  root.Sprites = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
