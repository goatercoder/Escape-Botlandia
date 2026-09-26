/* scene.js — the animated Botlandia city drawn on the full-page background canvas (global `Scene`). */
(function (root) {
  'use strict';
  const Sprites = root.Sprites; const Data = root.Data;

  // ---------------------------------------------------------------------------
  // How it works
  // ---------------------------------------------------------------------------
  // Everything is drawn 1:1 into a small offscreen "logical" buffer (one pixel per sprite
  // pixel) and blown up onto the real canvas at an integer device scale with smoothing off,
  // so every sprite pixel is a crisp S×S block. The buffer is built from:
  //   sky (banded + dithered gradient, sun/moon, stars, clouds, sky-yacht)
  //   far skyline  (hazed silhouettes, Core Tower + scanning eye, neon, BOTLANDIA sign, treadmill billboard)
  //   mid skyline  (lighter-hazed silhouettes)
  //   ground       (sidewalk, road, curb — palette colours)
  //   world layer  (alley, lots, buildings, bots, avatar, vehicles, lamps; darkened at night,
  //                 then lights/windows/neon drawn on top undarkened)
  //   foreground   (rain, fireflies, confetti, sparkles, the Golden Bot, lightning flash)
  //   post         (glitch tear, chapter wipe, death desaturation)
  // Camera x is measured in district-plane pixels; other planes scroll by their factor
  // relative to the district plane (spec: far 0.1 · district 0.5 · street 0.7 · fore 1.0).
  const F_FAR = 0.2, F_MID = 0.5, F_STREET = 1.4, F_FORE = 2;
  const LEVEL_AT = [1, 10, 25, 50, 100];
  const FALLBACK_IDS = ['battery', 'vending', 'laundro', 'truck', 'carlot', 'podtower', 'datafarm', 'drones', 'repair', 'solar', 'casino', 'signal', 'foundry', 'orbital'];
  const MAX_P = 200;
  const LOT_W = 28, GAP = 5, ALLEY_W = 60, GATE_W = 48;
  const PAN_SPEED = 8;
  const PKEYS = ['skyTop', 'skyBottom', 'far', 'mid', 'road', 'sidewalk', 'accent'];
  // Building overlay animations that are lights (drawn after the night darkening).
  const EMIT_KINDS = { blink: 1, glow: 1, spin: 1, scroll: 1, beacon: 1, sparks: 1, chase: 1, rings: 1 };
  // Sprite chars that glow at night (lit glass, neon, LEDs, bulbs).
  const GLOW_CH = { l: 1, c: 1, i: 1, n: 1, r: 1, y: 1, a: 1 };
  // Customer traffic weights per business and which ones are served at a counter.
  const CUSTOMER_W = { battery: 3, vending: 4, laundro: 4, truck: 4, carlot: 1, podtower: 2, datafarm: 1, drones: 1, repair: 3, solar: 0, casino: 3, signal: 0, foundry: 0, orbital: 0 };
  const COUNTER = { battery: 1, vending: 1, truck: 1, carlot: 1 };
  const CONFETTI = ['#ff3b3b', '#ffd166', '#39d4ff', '#4ade80', '#ff7ab6'];
  const SPARKLE = ['#ffd166', '#ffffff', '#ffb020', '#fff3b0'];
  const EMPTY = {};
  const SHUDDERS = [0.8, 1.8, 2.8];   // the Exit Gate grinds open in three shudders

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function mod(a, m) { return ((a % m) + m) % m; }
  function levelIndex(owned) { let i = -1; for (let k = 0; k < 5; k++) if (owned >= LEVEL_AT[k]) i = k; return i; }
  function hash01(n) {
    let h = (n | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  const rgbMemo = {};
  function rgb(hex) {
    let c = rgbMemo[hex];
    if (!c) {
      const h = String(hex).replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16) || 0;
      c = rgbMemo[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return c;
  }
  function mix(out, a, b, t) { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; }
  function css(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
  function fmtShort(v) {
    v = Math.max(0, v);
    if (v < 1000) return '$' + Math.floor(v);
    const u = ['K', 'M', 'B', 'T']; let i = -1;
    while (v >= 1000 && i < 3) { v /= 1000; i++; }
    return '$' + (v < 10 ? v.toFixed(1) : Math.floor(v)) + u[i];
  }

  function create(canvas) {
    const SP = root.Sprites || Sprites;
    if (!SP || !SP.CITY) throw new Error('Scene.create needs sprites.js and sprites-city.js loaded first');
    const DATA = root.Data || Data;
    const CITY = SP.CITY, PR = CITY.props, VH = CITY.vehicles, BL = CITY.buildings, BOTS = SP.BOTS, AV = SP.AVATARS;
    const U = SP.util, KIT = CITY.kit, COL = CITY.COLORS, PALS = CITY.palettes, CP = CITY.palette;
    const IDS = DATA && DATA.BUSINESSES ? DATA.BUSINESSES.map((b) => b.id) : FALLBACK_IDS.slice();
    const DAY_S = (DATA && DATA.CONST && DATA.CONST.DAY_NIGHT_CYCLE_S) || 90;
    const IDLE_SLEEP_S = (DATA && DATA.CONST && DATA.CONST.IDLE_SLEEP_S) || 20;
    const SLOWMO = (DATA && DATA.CONST && DATA.CONST.DEATH_SLOWMO) || 0.2;
    const doc = root.document;
    const ctx = canvas.getContext('2d');

    function mk(w, h) { const c = doc.createElement('canvas'); c.width = w || 1; c.height = h || 1; return c; }
    const buf = mk(), bc = buf.getContext('2d');     // the logical frame
    const wl = mk(), wc = wl.getContext('2d');       // world layer (district + street planes)
    const hl = mk(), hc = hl.getContext('2d');       // haze layer (far / mid skylines)
    let gA = null, gB = null, gC = null;             // glitch-tear scratch canvases (lazy)
    const skyCv = mk(2, 1), skyX = skyCv.getContext('2d');
    let skyKey = '', skyPat = null;

    // ---------------------------------------------------------------------------
    // Sprite caches (all keyed by sprite identity, filled once)
    // ---------------------------------------------------------------------------
    const cache0 = new WeakMap(), cacheF = new WeakMap();
    function img(sp, flip) {
      const m = flip ? cacheF : cache0;
      let c = m.get(sp);
      if (!c) { c = SP.render(sp, 1, flip ? { flip: true } : {}); m.set(sp, c); }
      return c;
    }
    function at(sp, tSec) { return sp.frames ? SP.frame(sp, tSec * 1000) : sp; }
    function nth(sp, i) {
      if (!sp.frames) return sp;
      const n = sp.frames.length;
      return SP.frame(sp, (mod(i, n) + 0.5) * 1000 / (sp.fps || 2));
    }
    function blit(c, sp, x, y, flip) { c.drawImage(img(sp, flip), Math.round(x), Math.round(y)); }
    const varMap = new WeakMap();
    function variant(sp, key, over) {
      let m = varMap.get(sp);
      if (!m) { m = new Map(); varMap.set(sp, m); }
      let v = m.get(key);
      if (!v) { v = SP.withPalette(sp, over); m.set(key, v); }
      return v;
    }
    const tintMap = new Map();
    function tinted(sp, key, tint) {
      let c = tintMap.get(key);
      if (!c) { c = SP.render(sp, 1, { tint: tint }); tintMap.set(key, c); }
      return c;
    }
    // Night lights of a building: lit glass ('L' → 'l', ~2/3 of the panes by connected
    // region so whole windows switch together) plus the neon/LED chars.
    const emisMap = new WeakMap();
    function emissive(sp, all) {
      let e = emisMap.get(sp);
      if (!e) { e = buildEmissive(sp); emisMap.set(sp, e); }
      return all ? e.all : e.some;
    }
    function buildEmissive(sp) {
      const rows = sp.rows, h = rows.length, w = rows[0].length;
      const comp = new Int32Array(w * h).fill(-1);
      let nComp = 0; const stack = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (rows[y][x] !== 'L' || comp[y * w + x] >= 0) continue;
          stack.push(y * w + x); comp[y * w + x] = nComp;
          while (stack.length) {
            const q = stack.pop(); const qx = q % w, qy = (q / w) | 0;
            const nb = [[qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]];
            for (const p of nb) {
              if (p[0] < 0 || p[1] < 0 || p[0] >= w || p[1] >= h) continue;
              const k = p[1] * w + p[0];
              if (comp[k] < 0 && rows[p[1]][p[0]] === 'L') { comp[k] = nComp; stack.push(k); }
            }
          }
          nComp++;
        }
      }
      const some = [], all = [];
      let seed = w * 31 + h * 17;
      for (let y = 0; y < h; y++) {
        let a = '', b = '';
        for (let x = 0; x < w; x++) {
          const ch = rows[y][x];
          if (ch === 'L') { b += 'l'; a += hash01(comp[y * w + x] * 13 + seed) < 0.66 ? 'l' : '.'; }
          else if (GLOW_CH[ch]) { a += ch; b += ch; }
          else { a += '.'; b += '.'; }
        }
        some.push(a); all.push(b);
      }
      return { some: U.sprite(sp.palette, some), all: U.sprite(sp.palette, all) };
    }
    // Last run's buildings: cyan-tinted silhouette cut to the ghost scanline tile.
    const ghostMap = new WeakMap();
    function ghostImg(sp) {
      let g = ghostMap.get(sp);
      if (!g) {
        const src = SP.render(sp, 1, { tint: { color: '#39d4ff', amount: 0.72 } });
        const w = src.width, h = src.height;
        g = mk(w, h);
        const gx = g.getContext('2d');
        // faint body
        gx.globalAlpha = 0.35;
        gx.drawImage(src, 0, 0);
        gx.globalAlpha = 1;
        // bright scanlines cut with the ghost overlay tile
        const lines = mk(w, h), lx = lines.getContext('2d');
        lx.drawImage(SP.render(sp, 1, { tint: { color: '#9ff0ff', amount: 0.8 } }), 0, 0);
        lx.globalCompositeOperation = 'destination-in';
        lx.fillStyle = lx.createPattern(img(PR.ghost), 'repeat');
        lx.fillRect(0, 0, w, h);
        gx.drawImage(lines, 0, 0);
        // a crisp cyan rim around the silhouette
        const rim = mk(w + 2, h + 2), rx = rim.getContext('2d');
        const sil = SP.render(sp, 1, { tint: '#39d4ff' });
        rx.drawImage(sil, 0, 1); rx.drawImage(sil, 2, 1); rx.drawImage(sil, 1, 0); rx.drawImage(sil, 1, 2);
        rx.globalCompositeOperation = 'destination-out';
        rx.drawImage(sil, 1, 1);
        gx.drawImage(rim, -1, -1);
        ghostMap.set(sp, g);
      }
      return g;
    }
    const mastMemo = {};
    function craneMast(h) { return mastMemo[h] || (mastMemo[h] = U.sprite(CP, KIT.lattice(4, Math.max(2, h), 'y', 'Y'))); }
    const podMemo = {};
    function podSprite(floors, crane) {
      const k = floors * 2 + (crane ? 1 : 0);
      return podMemo[k] || (podMemo[k] = BL.podtower.build(floors, crane));
    }
    function bizSprite(id, owned, crane) {
      if (id === 'podtower') return podSprite(Math.min(12, 1 + Math.floor(owned / 10)), crane);
      const def = BL[id];
      return def ? def.levels[Math.max(0, levelIndex(owned))] : null;
    }

    // ---------------------------------------------------------------------------
    // Composite props built once from the kit (FOR SALE lots, the alley, banners …)
    // ---------------------------------------------------------------------------
    function buildLot(withSign, variantN) {
      const Wd = LOT_W, Hh = 26;
      let g = U.blank(Wd, Hh);
      if (withSign) {
        g = U.stamp(g, KIT.solid(1, 11, 'G'), 7, 15);
        g = U.stamp(g, KIT.solid(1, 11, 'G'), 20, 15);
        let board = KIT.rect(19, 15, 'w');
        board = U.stamp(board, CITY.text('FOR', 'r'), 4, 2);
        board = U.stamp(board, CITY.text('SALE', 'r'), 2, 8);
        if (variantN) board = U.patch(board, [[14, 15, '...'], [13, 17, '..']]); // a torn corner
        g = U.stamp(g, board, 4, 0);
      } else {
        // rubble and a traffic cone
        g = U.stamp(g, ['..kk..', '.kGGk.', 'kGgGGk'], 5, Hh - 11);
        g = U.stamp(g, ['.k.', 'kok', 'kwk', 'kok'], 18, Hh - 12);
      }
      g = U.stamp(g, KIT.fence(Wd, 8), 0, Hh - 8);
      g = U.patch(g, [[Hh - 1, 2, 'N.n'], [Hh - 2, 3, 'n'], [Hh - 1, 23, 'nN'], [Hh - 2, 24, 'N']]);
      return U.sprite(CP, g);
    }
    const LOTS = [buildLot(true, 0), buildLot(true, 1), buildLot(false, 0)];
    const alleySp = (function () {
      const Wd = ALLEY_W, Hh = 44;
      let g = KIT.rect(Wd, Hh, 'x');
      for (let y = 4; y < Hh - 1; y += 4) g = U.patch(g, [[y, 1, 'X'.repeat(Wd - 2)]]);
      for (let y = 1; y < Hh - 1; y++) {
        if (y % 4 === 0) continue;
        const off = (Math.floor(y / 4) % 2) ? 3 : 7; const edits = [];
        for (let x = off; x < Wd - 1; x += 8) edits.push([y, x, 'X']);
        g = U.patch(g, edits);
      }
      g = U.stamp(g, KIT.pane(12, 10), 40, 6);
      g = U.patch(g, [[8, 41, 'TTTTTTTTTT'], [12, 41, 'TTTTTTTTTT']]);           // boarded window
      g = U.stamp(g, KIT.signBox('WORK', 'R', 'd'), 6, 8);                         // faded Bot-Corp poster
      g = U.stamp(g, KIT.signBox('OBEY', 'R', 'd'), 12, 20);
      g = U.patch(g, [[31, 45, 'c.c'], [33, 44, 'c...c'], [34, 45, 'ccc']]);     // Glitch's cyan smiley
      g = U.patch(g, [[0, 0, '.'], [0, Wd - 1, '.']]);
      return U.sprite(CP, g);
    })();
    const sunFace = U.sprite(PR.sun.palette, U.patch(PR.sun.rows, [[3, 2, 'A'], [3, 5, 'A'], [5, 2, 'A'], [5, 5, 'A'], [6, 3, 'AA']]));
    const runnerStand = U.sprite(PR.treadmill_runner.palette, ['.kk...', '.ss...', 'kbbk..', 'kbbk..', '.bb...', '.kk...', '.kk...', '......']);
    const bannerMemo = new Map();
    function banner(txt) {
      let b = bannerMemo.get(txt);
      if (!b) { b = U.sprite(CP, KIT.signBox(txt, 'y', 'r')); bannerMemo.set(txt, b); }
      return b;
    }
    const ledMemo = new Map();
    function ledSprite(txt) {
      let b = ledMemo.get(txt);
      if (!b) { if (ledMemo.size > 64) ledMemo.clear(); b = U.sprite(CP, KIT.signBox(txt, 'r', 'v')); ledMemo.set(txt, b); }
      return b;
    }
    const CUST = [
      BOTS.customer,
      variant(BOTS.customer, 'o', { b: '#ff9a3c', B: '#b45a1b' }),
      variant(BOTS.customer, 'g', { b: '#4ade80', B: '#1f8a4c' }),
      variant(BOTS.customer, 'p', { b: '#ff7ab6', B: '#a31d1d' })
    ];
    const SILS = PR.tower_silhouettes;
    const silDay = SILS.map((s) => variant(s, 'day', { l: COL.SILHOUETTE }));

    // Far / mid skyline layout (seeded, repeats every period).
    const FAR_P = 380, MID_P = 300;
    const farItems = [], midItems = [];
    (function () {
      const r = mulberry32(4471);
      const signs = ['obey', 'work', 'buy'];
      let x = 0, k = 0;
      while (x < FAR_P - 16) {
        const si = Math.floor(r() * SILS.length);
        farItems.push({ si: si, x: x, sink: Math.floor(r() * 16), lift: Math.floor(r() * r() * 44), flip: r() < 0.5, sign: (k % 3 === 1) ? signs[Math.floor(k / 3) % 3] : null, ph: r() * 5 });
        x += SILS[si].w + 1 + Math.floor(r() * 14); k++;
      }
      x = 0;
      while (x < MID_P - 16) {
        const si = Math.floor(r() * SILS.length);
        midItems.push({ si: si, x: x, sink: 4 + Math.floor(r() * 22), lift: Math.floor(r() * 18), flip: r() < 0.5 });
        x += SILS[si].w + 4 + Math.floor(r() * 26);
      }
    })();
    const stars = [];
    for (let i = 0; i < 52; i++) stars.push({ x: hash01(i * 3 + 1), y: hash01(i * 3 + 2), p: hash01(i * 3 + 3) * 20, big: i % 9 === 0 });
    const clouds = [];
    for (let i = 0; i < 6; i++) clouds.push({ x: hash01(i + 90) * 1.2, y: hash01(i + 70), v: 1.2 + hash01(i + 50) * 2.4, s: i % 2 });
    const rainClouds = [];
    for (let i = 0; i < 12; i++) rainClouds.push({ x: i / 12 + hash01(i + 300) * 0.05, y: hash01(i + 310), v: 2 + hash01(i + 320) * 2, s: (i + 1) % 2 });
    const flies = [];
    for (let i = 0; i < 12; i++) flies.push({ x: hash01(i + 500), y: hash01(i + 510), p: hash01(i + 520) * 20 });

    // ---------------------------------------------------------------------------
    // Mutable scene state
    // ---------------------------------------------------------------------------
    let st = null, dv = null, inited = false, runId = null;
    let W = 1, H = 1, D = 1, dpr = 1, S = 4, cssW = 1, cssH = 1;
    const safeCss = { left: 0, right: 0, top: 0, bottom: 0 };
    let sL = 0, sR = 1, sT = 0, sB = 1, safeW = 1;
    let gTop = 0, side = 10, road = 20, curb = 6, roadTop = 0, roadBot = 0;
    let backFeet = 0, midFeet = 0, frontFeet = 0;
    let running = false, raf = 0, lastTs = 0;
    let t = 0, real = 0, dtNow = 0;
    let reduce = false;
    let dayClock = DAY_S * 0.62;          // start at night: the gutter is darkest first
    let n = 0;                            // night amount 0..1
    let palName = null, targetPal = null, wipeT = -1;
    let stormAmt = 0, rainAmt = 0;
    let escapeT = -1, escBlend = 0, deathT = -1, deathRun = null;
    let lastActivity = -999, lastClicks = -1;   // start idle: 4471 is asleep in the gutter until the first click
    let chapter = 1, debt = 0, doodads = EMPTY, ghostCounts = null, flags = EMPTY, ending = null, stage = 'vagrant';
    let freedom = 0, age = 18, health = 60, burnedOut = false;
    const dbg = { phase: null, cam: null };

    const cur = {}, curCss = {}, dayCss = {};
    PKEYS.forEach((k) => { cur[k] = [0, 0, 0]; });
    const tmpC = [0, 0, 0];

    // camera
    let camX = 0, camDir = 1, camPause = 0, camReady = false, camMid = 0, camMidS = 0, camMin = 0, camMax = 0;
    let holdUntil = 0, focusUntil = -1, focusX = 0;
    let shakeUntil = 0, shakeAmp = 0;

    // plots
    const plots = IDS.map((id, i) => ({ id: id, i: i, x: 0, w: 0, bw: 0, owned: 0, prev: -1, lvl: -1, sp: null, stalls: 1, ghost: null, gw: 0, bornAt: -99, buyAt: -99, puffAt: -99, puff: false, hash: hash01(i * 7 + 3), lot: LOTS[i % 3], nb: 0 }));
    const byId = {}; plots.forEach((p) => { byId[p.id] = p; });
    let firstOwned = -1, lastOwned = -1, ownedN = 0, worldEnd = 0;
    const gate = { on: false, x: 0 };

    // actors
    const av = { x: 38, dir: 1, walking: false, timer: 2, alpha: 1, react: null, reactUntil: 0, coughAt: 6, mode: 'home' };
    const butler = { x: 20, dir: 1, moving: false };
    const tiger = { x: 56, dir: 1, moving: false };
    const repo = { x: 0, dir: -1, pause: 0, on: false, mode: null };
    const workers = { x0: 0, ready: false };
    const customers = [];
    for (let i = 0; i < 8; i++) customers.push({ on: false, x: 0, dir: 1, st: 0, timer: 0, plot: null, sp: null, alpha: 1, can: false, v: 12 });
    const marchers = [];
    for (let i = 0; i < 10; i++) marchers.push({ on: false, x: 0, v: 11, sp: null, lane: 0 });
    const parade = { on: false, x0: 0, n: 6, icon: null, texts: ['YAY'] };
    const vehicles = [];
    for (let i = 0; i < 16; i++) vehicles.push({ on: false, kind: 'car', sp: null, x: 0, lane: 0, v: 30, flip: false, grey: false, w: 16, h: 8 });
    const drones = [];
    for (let i = 0; i < 6; i++) drones.push({ on: false, x: 0, y: 0, v: 20, box: true, ph: 0 });
    const pods = [];
    for (let i = 0; i < 4; i++) pods.push({ on: false, x: 0, y: 0, x0: 0, target: 0, ph: 0 });
    const timers = { car: 1, amb: 4, truck: 6, bus: 12, cust: 1, foundry: 3, fixed: 4, pod: 3, rev: 5, revUntil: 0, drone: 1, bolt: 0, boltUntil: 0, flash: 0, splash: 0, steam: 0, spark: 0 };
    const gl = { phase: 0, t0: 0, x: 0, y: 0, dir: 1, seenActive: false, until: 0 };
    const crash = { on: false, t0: 0 };
    let yachtX = -1e9, runnerPhase = 0, runnerOffAt = -99, ratSeen = false, ratInit = false;
    const BLACK = [0, 0, 0], WHITE = [255, 255, 255];
    let burnUntil = 0;

    // particles: kind 0 pixel · 1 sprite anim · 2 confetti · 3 sparkle; plane 0 screen · 1 world (darkened) · 2 world lights
    const parts = [];
    for (let i = 0; i < MAX_P; i++) parts.push({ on: false, pl: 0, k: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, col: '#fff', sp: null, w: 1, h: 1 });
    let pIdx = 0;
    function spawn(pl, k, x, y, vx, vy, g, max, col, sp) {
      for (let j = 0; j < MAX_P; j++) {
        const p = parts[pIdx]; pIdx = (pIdx + 1) % MAX_P;
        if (p.on) continue;
        p.on = true; p.pl = pl; p.k = k; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.g = g; p.life = 0; p.max = max; p.col = col || '#fff'; p.sp = sp || null; p.w = 1; p.h = 1;
        return p;
      }
      return null;
    }
    function confetti(count, x0, x1, y0) {
      const nC = reduce ? Math.ceil(count / 3) : count;
      for (let i = 0; i < nC; i++) {
        spawn(0, 2, rand(x0, x1), y0 - rand(0, 24), rand(-10, 10), rand(14, 40), 10, rand(2.5, 4), CONFETTI[i % CONFETTI.length]);
      }
    }
    function sparkles(pl, x, y, count, spread) {
      const nC = reduce ? Math.ceil(count / 2) : count;
      for (let i = 0; i < nC; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(6, 26) * (spread || 1);
        spawn(pl, 3, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 6, 18, rand(0.4, 0.9), SPARKLE[i % 4]);
      }
    }
    function dustPuff(x, y) {
      spawn(1, 1, x - 10, y - 8, -4, -2, 0, 0.38, null, PR.dust);
      spawn(1, 1, x + 2, y - 8, 4, -2, 0, 0.38, null, PR.dust);
      if (!reduce) for (let i = 0; i < 6; i++) spawn(1, 0, x + rand(-8, 8), y - rand(0, 3), rand(-20, 20), rand(-18, -6), 40, rand(0.3, 0.6), '#b8bfd8');
    }

    // ---------------------------------------------------------------------------
    // Geometry
    // ---------------------------------------------------------------------------
    function computeScale() {
      const sh = Math.max(60, cssH - safeCss.top - safeCss.bottom);
      S = clamp(Math.floor(sh / 190), 2, 6);
      D = Math.max(1, Math.round(S * dpr));
    }
    function computeSafe() {
      const k = dpr / D;
      sL = clamp(Math.ceil(safeCss.left * k), 0, Math.max(0, W - 24));
      sR = clamp(Math.floor(W - safeCss.right * k), sL + 24, W);
      sT = clamp(Math.ceil(safeCss.top * k), 0, Math.max(0, H - 48));
      sB = clamp(Math.floor(H - safeCss.bottom * k), sT + 48, H);
      safeW = sR - sL;
      if (sB - sT < 150) { side = 8; road = 14; curb = 3; } else { side = 10; road = 20; curb = 6; }
      gTop = sB - side - road - curb;
      roadTop = gTop + side; roadBot = roadTop + road;
      backFeet = gTop + 3; midFeet = gTop + side - 3; frontFeet = gTop + side;
      skyKey = '';
    }
    function resize() {
      dpr = root.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      cssW = Math.max(1, (r && r.width) || canvas.clientWidth || root.innerWidth || 800);
      cssH = Math.max(1, (r && r.height) || canvas.clientHeight || root.innerHeight || 600);
      computeScale();
      const pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      W = Math.ceil(pw / D); H = Math.ceil(ph / D);
      for (const c of [buf, wl, hl]) { if (c.width !== W) c.width = W; if (c.height !== H) c.height = H; }
      gA = gB = gC = null;
      computeSafe();
    }

    // ---------------------------------------------------------------------------
    // State intake
    // ---------------------------------------------------------------------------
    function stageFor(ch) { return ['vagrant', 'wageslave', 'hustler', 'hustler', 'owner', 'investor', 'tycoon', 'tycoon'][clamp(ch, 1, 8) - 1]; }
    function readState() {
      const s = st || EMPTY, d = dv || EMPTY;
      chapter = d.chapter || s.chapter || 1;
      debt = s.debt || 0;
      doodads = s.doodads || EMPTY;
      ghostCounts = s.ghost || null;
      flags = s.flags || EMPTY;
      ending = s.ending || d.ending || null;
      stage = d.avatarStage || (ending === 'escaped' ? 'escapee' : stageFor(chapter));
      if (!AV[stage]) stage = 'vagrant';
      freedom = typeof d.freedomRatio === 'number' && isFinite(d.freedomRatio) ? d.freedomRatio : 0;
      age = s.age || 18; health = s.health === undefined ? 60 : s.health;
      burnedOut = !!d.burnedOut;
      targetPal = d.palette || (DATA && DATA.CHAPTERS && DATA.CHAPTERS[clamp(chapter, 1, 8) - 1].palette) || 'gutter';
      if (!PALS[targetPal] || targetPal === 'storm') targetPal = palName || 'gutter';
      const clicks = s.stats && s.stats.lifetimeClicks;
      if (typeof clicks === 'number') { if (clicks !== lastClicks && lastClicks >= 0) lastActivity = real; lastClicks = clicks; }
    }
    function initFromState() {
      inited = true;
      runId = st ? st.run : null;
      for (const p of plots) {
        const e = st && st.businesses && st.businesses[p.id];
        p.prev = e ? (e.owned | 0) : 0; p.bornAt = -99; p.buyAt = -99;
      }
      palName = targetPal; wipeT = -1;
      escapeT = -1; escBlend = 0; deathT = -1; av.escInit = false; av.alpha = 1;
      if (ending === 'escaped') { escapeT = t - 100; escBlend = 1; }
      else if (ending) { deathT = real - 10; deathRun = runId; }
      camReady = false; av.placed = false;
      repo.on = false; workers.ready = false;
      ratSeen = !!flags.ratRaceExit; ratInit = true;
    }

    // ---------------------------------------------------------------------------
    // Layout of the district row
    // ---------------------------------------------------------------------------
    function layout() {
      let x = ALLEY_W + 8;
      firstOwned = -1; lastOwned = -1; ownedN = 0;
      const bz = st && st.businesses;
      for (let i = 0; i < plots.length; i++) {
        const p = plots[i];
        const e = bz && bz[p.id];
        const owned = e ? (e.owned | 0) : 0;
        if (p.prev >= 0 && owned > p.prev) grew(p, owned);
        p.prev = owned; p.owned = owned;
        if (owned > 0 && BL[p.id]) {
          p.lvl = levelIndex(owned);
          p.sp = bizSprite(p.id, owned, t - p.buyAt < 3);
          p.stalls = p.id === 'battery' ? Math.min(4, 1 + Math.floor(owned / 5)) : 1;
          p.bw = p.id === 'podtower' ? 24 : p.sp.w;
          p.w = p.bw + (p.stalls - 1) * 18;
          p.ghost = null;
          if (firstOwned < 0) firstOwned = i;
          lastOwned = i; ownedN++;
        } else {
          p.lvl = -1; p.sp = null; p.stalls = 1;
          const gcount = ghostCounts ? (ghostCounts[p.id] | 0) : 0;
          p.ghost = gcount > 0 && BL[p.id] ? bizSprite(p.id, gcount, false) : null;
          p.gw = p.ghost ? (p.id === 'podtower' ? 24 : p.ghost.w) : 0;
          p.w = Math.max(LOT_W, p.gw);
        }
        p.x = x; x += p.w + GAP;
      }
      gate.on = chapter >= 8 || ending === 'escaped' || escapeT >= 0;
      gate.x = x + 10;
      worldEnd = gate.on ? gate.x + GATE_W : x;
    }
    function grew(p, owned) {
      const prevLvl = levelIndex(p.prev), newLvl = levelIndex(owned);
      const podGrow = p.id === 'podtower' && Math.floor(owned / 10) !== Math.floor(p.prev / 10);
      const stallGrow = p.id === 'battery' && Math.min(4, 1 + Math.floor(owned / 5)) !== Math.min(4, 1 + Math.floor(p.prev / 5));
      p.buyAt = t;
      if (p.prev === 0 || newLvl !== prevLvl || podGrow || stallGrow) p.bornAt = t;
      if (t - p.puffAt > 0.35) { p.puffAt = t; p.puff = true; }
      lastActivity = real;
    }

    // ---------------------------------------------------------------------------
    // Camera
    // ---------------------------------------------------------------------------
    function clampCam(x) { return clamp(x, 16 - sR, Math.max(16 - sR, worldEnd - 16 - sL)); }
    function updateCamera(dt) {
      let fL, fR;
      if (ownedN > 0) { fL = plots[firstOwned].x - 10; fR = plots[lastOwned].x + plots[lastOwned].w + 10; }
      if (ownedN === 0 || chapter <= 3) { fL = fL === undefined ? -6 : Math.min(fL, -6); fR = Math.max(fR === undefined ? 0 : fR, ALLEY_W + 8 + (LOT_W + GAP) * 3); }
      if (gate.on) fR = Math.max(fR, gate.x + GATE_W + 8);
      const span = fR - fL;
      let target = null;
      const escaping = escapeT >= 0 && t - escapeT < 14;
      if (escaping) target = gate.x + GATE_W / 2 - (sL + sR) / 2;
      else if (span <= safeW - 6) target = (fL + fR) / 2 - (sL + sR) / 2;
      camMin = span <= safeW - 6 ? (fL + fR) / 2 - (sL + sR) / 2 : fL - sL;
      camMax = span <= safeW - 6 ? camMin : fR - sR;
      camMid = (camMin + camMax) / 2;
      if (!camReady) {
        camX = target !== null ? target : camMax;   // open on the newest buildings, then pan back
        camDir = -1; camPause = 3;
        camMidS = camMid; camReady = true;
      }
      camMidS += (camMid - camMidS) * Math.min(1, dt * 0.8);
      if (dbg.cam !== null) { camX = dbg.cam; return; }
      if (drag && drag.moved) return;
      if (real < holdUntil) return;
      if (focusUntil > t) { camX += (focusX - camX) * Math.min(1, dt * (reduce ? 60 : 2.5)); return; }
      if (target !== null) { camX += (target - camX) * Math.min(1, dt * (reduce ? 60 : (escaping ? 1.2 : 2))); return; }
      if (reduce) { // no auto pan: hold still inside the range
        camX = clamp(camX, camMin, camMax);
        return;
      }
      if (camX < camMin - 1 || camX > camMax + 1) { // range changed under us: glide back in
        const tgt = clamp(camX, camMin, camMax);
        const step = Math.max(PAN_SPEED * 3, Math.abs(tgt - camX) * 1.5) * dt;
        camX = Math.abs(tgt - camX) <= step ? tgt : camX + Math.sign(tgt - camX) * step;
        return;
      }
      if (camPause > 0) { camPause -= dt; return; }
      camX += camDir * PAN_SPEED * dt;
      if (camX >= camMax) { camX = camMax; camDir = -1; camPause = 2.5; }
      else if (camX <= camMin) { camX = camMin; camDir = 1; camPause = 2.5; }
    }
    function focusPlot(p) {
      if (!p || !camReady) return;
      const left = p.x - camX, right = p.x + p.w - camX;
      if (left >= sL + 4 && right <= sR - 4) return;
      focusX = clampCam(p.x + p.w / 2 - (sL + sR) / 2);
      focusUntil = t + 3.5;
      holdUntil = 0;
      camDir = focusX > camX ? 1 : -1;
    }

    // ---------------------------------------------------------------------------
    // Palette / sky
    // ---------------------------------------------------------------------------
    function nightFor(p) {
      if (p < 0.42) return 0;
      if (p < 0.52) return smooth((p - 0.42) / 0.1);
      if (p < 0.9) return 1;
      return 1 - smooth((p - 0.9) / 0.1);
    }
    function computePalette() {
      const set = PALS[palName] || PALS.gutter;
      const day = set.day || set, night = set.night || set;
      const escaped = escapeT >= 0;
      let u = 0;
      if (escaped) u = smooth((t - escapeT) / 6);
      for (let i = 0; i < PKEYS.length; i++) {
        const k = PKEYS[i];
        mix(cur[k], rgb(day[k]), rgb(night[k]), n);
        if (escaped) {
          mix(tmpC, rgb(PALS.sunrise.night[k]), rgb(PALS.sunrise.day[k]), u);
          mix(cur[k], cur[k], tmpC, escBlend);
        }
        if (stormAmt > 0) mix(cur[k], cur[k], rgb(PALS.storm[k]), stormAmt);
        curCss[k] = css(cur[k]);
        dayCss[k] = day[k];
      }
    }
    function drawSky() {
      const top = cur.skyTop, bot = cur.skyBottom;
      const key = (top[0] | 0) + ',' + (top[1] | 0) + ',' + (top[2] | 0) + '|' + (bot[0] | 0) + ',' + (bot[1] | 0) + ',' + (bot[2] | 0) + '|' + gTop;
      if (key !== skyKey) {
        skyKey = key;
        const h = Math.max(2, gTop + 2);
        skyCv.width = 2; skyCv.height = h;
        const im = skyX.createImageData(2, h), d = im.data;
        const BANDS = 11, bay = [0.2, 0.7, 0.95, 0.45];
        const y0 = Math.min(sT, gTop - 40) * 0.5, span = Math.max(8, gTop - 6 - y0);
        for (let y = 0; y < h; y++) {
          const f = clamp((y - y0) / span, 0, 1) * BANDS;
          const base = Math.floor(f), frac = f - base;
          for (let x = 0; x < 2; x++) {
            const b = Math.min(BANDS, base + (frac > bay[(y & 1) * 2 + x] ? 1 : 0));
            const tt = b / BANDS, o = (y * 2 + x) * 4;
            d[o] = top[0] + (bot[0] - top[0]) * tt; d[o + 1] = top[1] + (bot[1] - top[1]) * tt; d[o + 2] = top[2] + (bot[2] - top[2]) * tt; d[o + 3] = 255;
          }
        }
        skyX.putImageData(im, 0, 0);
        skyPat = bc.createPattern(skyCv, 'repeat-x');
      }
      bc.fillStyle = skyPat;
      bc.fillRect(0, 0, W, gTop + 2);
    }
    function skyBody(u, yLow) { // position along a low arc across the safe area
      const x = sL + 10 + (safeW - 28) * u;
      const top = sT + 8, low = Math.max(top + 10, yLow);
      return [Math.round(x), Math.round(low - (low - top) * Math.sin(Math.PI * clamp(u, 0, 1)))];
    }
    function drawSkyBodies(p) {
      const yLow = gTop - 70;
      // stars
      const sa = clamp((n - 0.25) / 0.6, 0, 1) * (1 - rainAmt * 0.7);
      if (sa > 0.02) {
        bc.globalAlpha = sa;
        const h = Math.max(20, gTop - 60);
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          const x = Math.floor(s.x * W), y = Math.floor(sT * 0.4 + s.y * h);
          const tw = Math.sin(t * 1.7 + s.p);
          if (s.big) { blit(bc, nth(PR.star, tw > 0 ? 0 : 1), x - 1, y - 1); continue; }
          bc.fillStyle = tw > -0.5 ? '#f4f6ff' : '#5d6488';
          bc.fillRect(x, y, 1, 1);
        }
        bc.globalAlpha = 1;
      }
      // sun (day) and moon (night) with bot faces
      if (escapeT >= 0) {
        const te = t - escapeT;
        const gx = gate.x + GATE_W / 2 - Math.round(camX) - 4;
        const y = Math.round(lerp(gTop - 20, Math.max(sT + 10, gTop - 110), smooth((te - 1) / 10)));
        drawSun(clamp(gx, sL + 4, sR - 12), y, 1);
      } else {
        if (p < 0.54) { const q = skyBody(p / 0.54, yLow); drawSun(q[0], q[1], (1 - rainAmt * 0.55) * (1 - stormAmt * 0.85)); }
        if (p > 0.46) {
          const q = skyBody((p - 0.46) / 0.54, yLow);
          const a = clamp((p - 0.46) / 0.05, 0, 1) * clamp((1 - p) / 0.04, 0, 1);
          bc.globalAlpha = a * (1 - rainAmt * 0.4);
          glowDisc(q[0] + 4, q[1] + 4, '#b8bfd8', 0.12);
          blit(bc, PR.moon, q[0], q[1]);
          if (doodads.moonplot) blit(bc, PR.flag, q[0] + 4, q[1] - 7);
          bc.globalAlpha = 1;
        }
      }
    }
    function glowDisc(cx, cy, col, a) {
      bc.fillStyle = col;
      const ga = bc.globalAlpha;
      bc.globalAlpha = ga * a;
      bc.fillRect(cx - 8, cy - 5, 16, 10); bc.fillRect(cx - 5, cy - 8, 10, 16); bc.fillRect(cx - 7, cy - 7, 14, 14);
      bc.globalAlpha = ga * a * 1.4;
      bc.fillRect(cx - 6, cy - 4, 12, 8); bc.fillRect(cx - 4, cy - 6, 8, 12);
      bc.globalAlpha = ga;
    }
    function drawSun(x, y, a) {
      bc.globalAlpha = a;
      glowDisc(x + 4, y + 4, '#ffd166', 0.16);
      blit(bc, sunFace, x, y);
      bc.globalAlpha = 1;
    }
    function drawClouds(dt) {
      const set = PALS[palName] || PALS.gutter;
      const dayTint = (set.day || set).skyBottom, nightTint = (set.night || set).skyTop;
      const cw = W + 60;
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        c.x += c.v * dt / cw;
        if (c.x > 1) c.x -= 1.05;
        const sp = PR.cloud[c.s];
        const x = Math.round(c.x * cw - 40), y = Math.round(sT + 6 + c.y * Math.max(10, gTop - sT - 110));
        bc.globalAlpha = (1 - n) * 0.85 * (1 - rainAmt * 0.5);
        if (bc.globalAlpha > 0.02) bc.drawImage(tinted(sp, 'cd' + c.s + dayTint, { color: dayTint, amount: 0.3 }), x, y);
        bc.globalAlpha = n * 0.6;
        if (bc.globalAlpha > 0.02) bc.drawImage(tinted(sp, 'cn' + c.s + nightTint, { color: nightTint, amount: 0.8 }), x, y);
      }
      if (rainAmt > 0.02) { // heavy overcast band
        const dark = stormAmt > 0.3 ? '#0a1a12' : '#1c1f31';
        for (let i = 0; i < rainClouds.length; i++) {
          const c = rainClouds[i];
          c.x += c.v * dt / cw;
          if (c.x > 1) c.x -= 1.05;
          const x = Math.round(c.x * cw - 40), y = Math.round(sT - 3 + c.y * 9);
          bc.globalAlpha = rainAmt * 0.85;
          bc.drawImage(tinted(PR.cloud[c.s], 'rc' + c.s + dark, { color: dark, amount: 0.78 }), x, y);
        }
      }
      bc.globalAlpha = 1;
      if (doodads.yacht) {
        if (yachtX < -1e8) yachtX = sL + Math.random() * Math.max(10, safeW - 40);
        yachtX += 5 * dt;
        if (yachtX > W + 40) yachtX = -40;
        blit(bc, at(VH.yacht, t), Math.round(yachtX), Math.round(sT + 16 + Math.sin(t * 0.8) * 2));
      }
    }

    // ---------------------------------------------------------------------------
    // Far + mid skylines
    // ---------------------------------------------------------------------------
    const land = { coreX: 0, coreY: 0, signX: 0, signY: 0, billX: 0, billY: 0, towerX: 0, sigX: 0 };
    function column(c, sp, x, y, bottom, flip, rowIdx) {
      const im = img(sp, flip);
      c.drawImage(im, Math.round(x), Math.round(y));
      const endY = Math.round(y) + im.height;
      if (endY < bottom) c.drawImage(im, 0, rowIdx, im.width, 1, Math.round(x), endY, im.width, bottom - endY);
    }
    // A skyline tower: the silhouette on top, its lower 12 rows (windows and all) repeated down to `bottom`.
    function tower(c, sp, x, y, bottom, flip) {
      const im = img(sp, flip), h = im.height, w = im.width;
      x = Math.round(x); y = Math.round(y);
      c.drawImage(im, x, y);
      let yy = y + h;
      const blk = 12, src = h - blk;
      while (yy < bottom) { const hh = Math.min(blk, bottom - yy); c.drawImage(im, 0, src, w, hh, x, yy, w, hh); yy += hh; }
    }
    function drawSkylines() {
      const farBase = gTop - 6;
      const so = Math.round((camX - camMidS) * F_FAR);
      const cx = Math.round((sL + sR) / 2);
      hc.clearRect(0, 0, W, H);
      // repeating far towers
      const r0 = Math.floor((so - 60) / FAR_P), r1 = Math.floor((so + W) / FAR_P);
      for (let rep = r0; rep <= r1; rep++) {
        for (let i = 0; i < farItems.length; i++) {
          const it = farItems[i], sp = SILS[it.si];
          const x = rep * FAR_P + it.x - so;
          if (x > W || x + sp.w < 0) continue;
          const y = farBase - 10 + it.sink - sp.h - it.lift;
          tower(hc, silDay[it.si], x, y, farBase, it.flip);
          if (n > 0.02) { hc.globalAlpha = n; tower(hc, sp, x, y, farBase, it.flip); hc.globalAlpha = 1; }
        }
      }
      // landmarks
      land.coreX = cx - Math.round(safeW * 0.3) - 12 - so;
      land.coreY = Math.max(sT + 4, gTop - 122);
      land.towerX = cx + Math.round(safeW * 0.2) + 8 - so;
      land.billX = land.towerX - 8;
      land.billY = Math.max(sT + 2, gTop - 100);
      land.sigX = cx - 6 - so;
      const sig = SILS[4];
      const sigY = Math.max(land.billY + 30, gTop - 62);
      land.signX = land.sigX - 5; land.signY = sigY - 13;
      tower(hc, silDay[4], land.sigX, sigY, farBase, false);
      if (n > 0.02) { hc.globalAlpha = n; tower(hc, sig, land.sigX, sigY, farBase, false); hc.globalAlpha = 1; }
      hc.fillStyle = COL.SILHOUETTE_LIGHT;
      hc.fillRect(land.signX + 8, land.signY + 10, 1, sigY - land.signY - 9);
      hc.fillRect(land.signX + 32, land.signY + 10, 1, sigY - land.signY - 9);
      const tw = SILS[3];
      tower(hc, silDay[3], land.towerX, land.billY + 23, farBase, false);
      if (n > 0.02) { hc.globalAlpha = n; tower(hc, tw, land.towerX, land.billY + 23, farBase, false); hc.globalAlpha = 1; }
      // haze toward the palette's far tint
      hazeOut(lerp(0.62, 0.42, n), curCss.far);
      // THE MAINFRAME's Core Tower: same plane, lighter haze so it dominates the skyline
      hc.clearRect(0, 0, W, H);
      column(hc, PR.core_tower, land.coreX, land.coreY, farBase + 2, false, 61);
      hazeOut(lerp(0.3, 0.18, n), curCss.far);
      // lights on the far skyline (not hazed)
      const neonA = lerp(0.72, 1, n);
      for (let rep = r0; rep <= r1; rep++) {
        for (let i = 0; i < farItems.length; i++) {
          const it = farItems[i];
          if (!it.sign) continue;
          const sp = SILS[it.si];
          const x = rep * FAR_P + it.x - so;
          const sg = PR.sign_neon[it.sign];
          const sx = Math.round(x + (sp.w - sg.w) / 2);
          if (sx > W || sx + sg.w < 0) continue;
          if (sx + sg.w > land.coreX - 2 && sx < land.coreX + 26) continue;
          if (sx + sg.w > land.billX - 2 && sx < land.billX + 42) continue;
          if (sx + sg.w > land.signX - 2 && sx < land.signX + 43) continue;
          const y = farBase - 10 + it.sink - sp.h - it.lift - sg.h;
          const on = Math.sin(t * 2.3 + it.ph) > -0.35 && !(crash.on && Math.random() < 0.3);
          bc.globalAlpha = neonA;
          blit(bc, nth(sg, on ? 0 : 1), sx, y);
          if (on) { bc.globalCompositeOperation = 'lighter'; bc.globalAlpha = 0.12 * neonA; bc.fillStyle = '#ff3b3b'; bc.fillRect(sx - 2, y - 2, sg.w + 4, sg.h + 4); bc.globalCompositeOperation = 'source-over'; }
          bc.globalAlpha = 1;
        }
      }
      // BOTLANDIA sign with the flickering L
      const bs = PR.sign_botlandia;
      bc.globalAlpha = lerp(0.8, 1, n);
      blit(bc, bs, land.signX, land.signY);
      const flick = Math.sin(t * 11.3) * Math.sin(t * 2.9 + 1) > 0.55 || (crash.on && Math.random() < 0.5) || (Math.random() < 0.02);
      if (!flick) blit(bc, bs.flicker, land.signX + bs.at[0], land.signY + bs.at[1]);
      bc.globalCompositeOperation = 'lighter';
      bc.globalAlpha = 0.1 * lerp(0.6, 1, n);
      bc.fillStyle = '#ff7ab6';
      bc.fillRect(land.signX - 2, land.signY - 2, bs.w + 4, bs.h + 4);
      bc.globalCompositeOperation = 'source-over';
      bc.globalAlpha = 1;
      // the Core Tower's scanning eye
      const ct = PR.core_tower;
      blit(bc, at(PR.core_eye, t * (crash.on ? 3 : 1)), land.coreX + ct.eyeAt[0], land.coreY + ct.eyeAt[1]);
      bc.globalCompositeOperation = 'lighter';
      bc.globalAlpha = crash.on ? 0.35 : 0.14 + 0.06 * Math.sin(t * 3);
      bc.fillStyle = '#ff3b3b';
      bc.fillRect(land.coreX + ct.eyeAt[0] - 2, land.coreY + ct.eyeAt[1] - 1, 12, 10);
      bc.globalCompositeOperation = 'source-over';
      bc.globalAlpha = 1;
      // treadmill billboard (chapter 4+)
      if (chapter >= 4) drawBillboard();
      // lightning strikes the Core Tower
      if (timers.boltUntil > t) drawBolt(land.coreX + 11, land.coreY);
      // mid skyline
      hc.clearRect(0, 0, W, H);
      const mo = Math.round(camX * F_MID);
      const m0 = Math.floor((mo - 60) / MID_P), m1 = Math.floor((mo + W) / MID_P);
      for (let rep = m0; rep <= m1; rep++) {
        for (let i = 0; i < midItems.length; i++) {
          const it = midItems[i], sp = SILS[it.si];
          const x = rep * MID_P + it.x - mo;
          if (x > W || x + sp.w < 0) continue;
          const y = gTop + it.sink - sp.h - it.lift;
          tower(hc, silDay[it.si], x, y, gTop + 2, it.flip);
          if (n > 0.02) { hc.globalAlpha = n; tower(hc, sp, x, y, gTop + 2, it.flip); hc.globalAlpha = 1; }
        }
      }
      hazeOut(lerp(0.5, 0.3, n), curCss.mid);
    }
    function hazeOut(alpha, color) {
      hc.globalCompositeOperation = 'source-atop';
      hc.globalAlpha = alpha;
      hc.fillStyle = color;
      hc.fillRect(0, 0, W, H);
      hc.globalAlpha = 1;
      hc.globalCompositeOperation = 'source-over';
      bc.drawImage(hl, 0, 0);
    }
    function drawBillboard() {
      const bb = PR.treadmill_billboard, x = land.billX, y = land.billY;
      blit(bc, bb, x, y);
      const esc = escapeT >= 0 && t - escapeT > 0.6;
      if (esc) { // shorted out
        bc.fillStyle = '#05060f'; bc.globalAlpha = 0.88; bc.fillRect(x + 2, y + 2, 36, 18); bc.globalAlpha = 1;
        if (Math.random() < 0.25) { bc.fillStyle = Math.random() < 0.5 ? '#ffd166' : '#39d4ff'; bc.fillRect(x + 2 + Math.floor(Math.random() * 36), y + 2 + Math.floor(Math.random() * 18), 1, 1); }
        return;
      }
      const off = !!flags.ratRaceExit;
      const fps = clamp(4 / Math.max(0.05, freedom), 2, 30);
      runnerPhase += dtNow * fps;
      const sl = bb.slot;
      // the belt keeps scrolling either way
      bc.fillStyle = '#dfe6f5';
      const bo = Math.floor(runnerPhase * 1.5);
      for (let i = 0; i < 8; i++) bc.fillRect(x + 5 + mod(i * 4 - bo, 30), y + 17, 1, 1);
      if (!off) {
        blit(bc, nth(PR.treadmill_runner, Math.floor(runnerPhase)), x + sl.x, y + sl.y);
      } else {
        // stepped off: stands on top of the billboard, looking pleased
        const hop = t - runnerOffAt < 1 ? -Math.round(Math.abs(Math.sin((t - runnerOffAt) * 9)) * 2) : 0;
        blit(bc, runnerStand, x + 31, y - 8 + hop);
      }
      bc.globalCompositeOperation = 'lighter';
      bc.globalAlpha = 0.07 + 0.08 * n;
      bc.fillStyle = '#ff3b3b';
      bc.fillRect(x - 2, y - 2, bb.w + 4, bb.h);
      bc.globalCompositeOperation = 'source-over';
      bc.globalAlpha = 1;
    }
    function drawBolt(tx, ty) {
      const L = PR.lightning, f = at(L, t);
      let x = tx, y = ty - 20, k = 0;
      while (y > sT - 30 && k < 12) {
        if (k % 2 === 0) blit(bc, f, x, y); else blit(bc, f, x - 8, y, true);
        y -= 20; k++;
      }
      bc.globalCompositeOperation = 'lighter';
      bc.globalAlpha = 0.4;
      bc.fillStyle = '#b8f0ff';
      bc.fillRect(tx - 6, ty - 4, 14, 8);
      bc.globalCompositeOperation = 'source-over';
      bc.globalAlpha = 1;
    }

    // ---------------------------------------------------------------------------
    // Ground (sidewalk, road, curb) straight into the buffer in palette colours
    // ---------------------------------------------------------------------------
    function drawGround() {
      const camI = Math.round(camX);
      bc.fillStyle = curCss.sidewalk;
      bc.fillRect(0, gTop, W, side);
      mix(tmpC, cur.sidewalk, BLACK, 0.3);
      bc.fillStyle = css(tmpC);
      bc.fillRect(0, gTop, W, 1);
      bc.fillRect(0, gTop + (side >> 1), W, 1);
      const o = mod(camI, 8);
      for (let x = -o + 7; x < W; x += 8) bc.fillRect(x, gTop + 1, 1, side - 2);
      mix(tmpC, cur.sidewalk, WHITE, 0.18);
      bc.fillStyle = css(tmpC);
      bc.fillRect(0, roadTop - 1, W, 1);
      // road
      bc.fillStyle = curCss.road;
      bc.fillRect(0, roadTop, W, road);
      mix(tmpC, cur.road, BLACK, 0.35);
      bc.fillStyle = css(tmpC);
      bc.fillRect(0, roadTop, W, 1);
      mix(tmpC, rgb(COL.LANE), cur.road, 0.25 + n * 0.35);
      bc.fillStyle = css(tmpC);
      const so = mod(Math.round(camX * F_STREET), 16);
      const ly = roadTop + (road >> 1);
      for (let x = -so; x < W; x += 16) bc.fillRect(x, ly, 8, 1);
      // wet road sheen in the rain
      if (rainAmt > 0.05) {
        bc.globalAlpha = 0.18 * rainAmt;
        bc.fillStyle = '#8fb4ff';
        const ro = mod(Math.round(camX * F_STREET), 23);
        for (let x = -ro; x < W; x += 23) bc.fillRect(x, roadTop + road - 3, 5, 1);
        bc.globalAlpha = 1;
      }
      // near curb (foreground plane)
      mix(tmpC, cur.sidewalk, BLACK, 0.18);
      bc.fillStyle = css(tmpC);
      bc.fillRect(0, roadBot, W, curb);
      mix(tmpC, cur.sidewalk, WHITE, 0.14);
      bc.fillStyle = css(tmpC);
      bc.fillRect(0, roadBot, W, 1);
      mix(tmpC, cur.sidewalk, BLACK, 0.4);
      bc.fillStyle = css(tmpC);
      const fo = mod(Math.round(camX * F_FORE), 12);
      for (let x = -fo + 11; x < W; x += 12) bc.fillRect(x, roadBot + 1, 1, curb - 1);
      if (roadBot + curb < H) { bc.fillStyle = '#07080f'; bc.fillRect(0, roadBot + curb, W, H - roadBot - curb); }
    }

    // ---------------------------------------------------------------------------
    // The world layer
    // ---------------------------------------------------------------------------
    function plotDy(p) {
      const e = (t - p.bornAt) / 0.32;
      if (e >= 1 || e < 0) return 0;
      return -Math.round(18 * (1 - e) * (1 - e));
    }
    function drawBuildings(camI) {
      // the alley: where 4471 sleeps
      const ax = -camI;
      if (ax + ALLEY_W > -4 && ax < W) {
        blit(wc, alleySp, ax, gTop - alleySp.h);
        blit(wc, PR.dumpster, ax + 4, gTop - 8);
        blit(wc, PR.cardboard_box, ax + 24, gTop - 3);
      }
      for (let i = 0; i < plots.length; i++) {
        const p = plots[i];
        const x = p.x - camI;
        if (x > W + 4 || x + p.w + 40 < 0) continue;
        if (!p.sp) {
          const lot = p.lot;
          blit(wc, lot, x + Math.floor((p.w - LOT_W) / 2), gTop - lot.h);
          continue;
        }
        const dy = plotDy(p);
        const y = gTop - p.sp.h + dy;
        if (p.id === 'podtower' && p.sp.w > 24) { // the crane's mast reaches down to the street
          const top = y + 28;
          if (top < gTop) blit(wc, craneMast(gTop - top), x + 26, top);
        }
        blit(wc, p.sp, x, y);
        for (let s = 1; s < p.stalls; s++) blit(wc, BL.battery.levels[0], x + p.bw + 2 + (s - 1) * 18, gTop - BL.battery.levels[0].h + dy);
        const def = BL[p.id];
        const an = def.anim;
        if (an && !EMIT_KINDS[an.kind] && p.id !== 'podtower') {
          if (an.kind === 'glint' && n > 0.5) continue;
          const pts = an.at && an.at[p.lvl];
          if (pts) {
            const f = at(an, t + p.i * 0.37);
            for (let k = 0; k < pts.length; k++) blit(wc, f, x + pts[k][0], y + pts[k][1]);
          }
        }
      }
      // the Exit Gate
      if (gate.on) {
        const gx = gate.x - camI;
        if (gx < W && gx + GATE_W > 0) blit(wc, gateSprite(), gx + gateShakeX(), gTop - 40);
      }
      // parked doodads
      if (doodads.hoverbike) {
        const p = firstOwned >= 0 ? plots[firstOwned] : null;
        const bx = p ? p.x + p.w - 4 : ALLEY_W - 14;
        blit(wc, VH.hoverbike, bx - camI, backFeet - 8 + Math.round(Math.sin(t * 2.2)));
      }
      if (doodads.lambo) {
        const p = lastOwned >= 0 ? plots[lastOwned] : null;
        const lx = p ? p.x + Math.max(0, p.w - 22) : ALLEY_W - 26;
        const rev = timers.revUntil > t;
        const jit = rev && !reduce ? (Math.floor(t * 30) % 2) : 0;
        blit(wc, rev ? nth(VH.lambo, 1) : nth(VH.lambo, 0), lx - camI + jit, backFeet + 2 - 9);
      }
    }
    function gateFrame() {
      if (escapeT < 0) return -1;
      const te = t - escapeT;
      if (te < 0.8) return 0;
      if (te < 1.8) return 1;
      if (te < 2.8) return 2;
      return 3;
    }
    function gateSprite() { const f = gateFrame(); return f < 0 ? PR.exit_gate.closed : nth(PR.exit_gate, f); }
    function gateShakeX() {
      if (reduce || escapeT < 0) return 0;
      const te = t - escapeT;
      for (let i = 0; i < SHUDDERS.length; i++) { const k = SHUDDERS[i]; if (te >= k && te < k + 0.28) return (Math.floor(te * 40) % 2) ? 1 : -1; }
      return 0;
    }
    function avatarSprite() {
      let base = AV[stage] || AV.vagrant;
      const grey = age >= 60, gold = !!doodads.exosuit;
      if (grey || gold) {
        const over = {};
        if (grey) over.h = '#b8bfd8';
        if (gold) over.k = '#c9971e';
        base = variant(base, (grey ? 'g' : '') + (gold ? 'x' : ''), over);
      }
      return base;
    }
    function avatarPose(base) {
      const R = base.reactions || EMPTY;
      if (deathT >= 0 || burnUntil > t || burnedOut || (crash.on && stormAmt > 0.3)) return R.sit || nth(base, 0);
      if (av.react && av.reactUntil > t && R[av.react]) return R[av.react];
      if (health < 30 && t % 7 < 0.9 && R.cough) return R.cough;
      if (!av.walking && n > 0.7 && real - lastActivity > IDLE_SLEEP_S && R.sleep && escapeT < 0) return R.sleep;
      if (av.walking) return nth(base, Math.floor(t * 4));
      return at(base, t);
    }
    function drawWalkers(camI) {
      // back lane: customers, the repair queue, casino gamblers
      for (let i = 0; i < plots.length; i++) {
        const p = plots[i];
        if (!p.sp) continue;
        const x = p.x - camI;
        if (x > W + 30 || x + p.w + 30 < 0) continue;
        if (p.id === 'repair') {
          const q = Math.min(3, 1 + p.lvl);
          const br = BL.repair.actors.broken;
          for (let k = 0; k < q; k++) blit(wc, at(br, t + k * 0.4), x - 11 - k * 11, backFeet - 16 + 1);
        } else if (p.id === 'casino') {
          const gm = BL.casino.actors.gambler, d = BL.casino.door[p.lvl];
          blit(wc, at(gm, t * 0.5), x + d - 20, backFeet - 16 + 1);
          blit(wc, at(gm, t * 0.5 + 0.3), x + d + 9, backFeet - 16 + 1, true);
        }
      }
      for (let i = 0; i < customers.length; i++) {
        const c = customers[i];
        if (!c.on || c.st === 3) continue;
        wc.globalAlpha = c.alpha;
        const moving = c.st === 0 || c.st === 5;
        const f = moving ? at(c.sp, t + i * 0.13) : nth(c.sp, 0);
        const lift = c.st === 2 ? Math.round((1 - c.alpha) * 3) : (c.st === 4 ? Math.round((1 - c.alpha) * 3) : 0);
        blit(wc, f, c.x - camI, backFeet - 16 - lift, c.dir < 0);
        if (c.can) blit(wc, BL.vending.actors.can, c.x - camI + (c.dir < 0 ? -1 : 10), backFeet - 9);
        wc.globalAlpha = 1;
      }
      // mid lane: butler, the avatar, the tiger-bot, Repo-Tron
      const base = avatarSprite();
      const pose = avatarPose(base);
      const ax = av.x - camI;
      const bob = av.walking && pose !== base.reactions.sit && Math.floor(t * 4) % 2 ? -1 : 0;
      if (doodads.butler) blit(wc, at(BOTS.butler, butler.moving ? t : 0), butler.x - camI, midFeet - 14 - 1, butler.dir < 0);
      wc.globalAlpha = av.alpha;
      blit(wc, pose, ax, midFeet - 24 + bob, av.dir < 0 && av.walking);
      wc.globalAlpha = 1;
      if (doodads.tiger) blit(wc, at(BOTS.tiger, tiger.moving ? t : 0), tiger.x - camI, midFeet - 12 + 1, tiger.dir > 0);
      if (repo.on) blit(wc, at(BOTS.repo, repo.pause > 0 ? 0 : t), repo.x - camI, midFeet - 20 + 1, repo.dir < 0);
      // front lane: the lockstep workers, foundry bots, fixed bots, the parade
      const nW = workerCount();
      const wf = at(BOTS.worker, crash.on ? t * 3 : t);
      for (let k = 0; k < nW; k++) blit(wc, wf, workers.x0 - k * 14 - camI, frontFeet - 16);
      for (let i = 0; i < marchers.length; i++) {
        const m = marchers[i];
        if (!m.on) continue;
        blit(wc, at(m.sp, t + i * 0.1), m.x - camI, (m.lane ? frontFeet : backFeet + 1) - 16);
      }
      if (parade.on) drawParade(camI);
    }
    function workerCount() { return clamp(9 - chapter, 3, 8); }
    function drawParade(camI) {
      const wf = Math.floor(t * 5) % 2;
      for (let k = 0; k < parade.n; k++) {
        const x = Math.round(parade.x0 - k * 17 - camI);
        if (x > W + 20 || x < -30) continue;
        const bot = k % 2 ? CUST[(k >> 1) % 4] : BOTS.worker;
        const fy = frontFeet;
        blit(wc, nth(bot, wf + k), x, fy - 16);
        const lift = (wf + k) % 2;
        wc.fillStyle = '#101226';
        wc.fillRect(x + 10, fy - 24 - lift, 1, 15);
        if (k === 0 && parade.icon) blit(wc, parade.icon, x + 3, fy - 40 - lift);
        else {
          const b = banner(parade.texts[k % parade.texts.length]);
          blit(wc, b, x + 11 - Math.floor(b.w / 2), fy - 33 - lift);
        }
      }
    }
    function drawSkyActors(camI) {
      // drones with boxes
      for (let i = 0; i < drones.length; i++) {
        const d = drones[i];
        if (!d.on) continue;
        blit(wc, at(d.box ? VH.drone_box : VH.drone, t), d.x - camI, d.y + Math.round(Math.sin(t * 3 + d.ph)), d.v < 0);
      }
      // the orbital mine's asteroid + parachuting cargo pods
      const op = byId.orbital;
      if (op && op.sp) {
        const ax = op.x + Math.floor(op.w / 2) - 12 - camI;
        const ay = asteroidY();
        blit(wc, at(BL.orbital.actors.asteroid, t), ax, ay);
      }
      for (let i = 0; i < pods.length; i++) {
        const p = pods[i];
        if (!p.on) continue;
        blit(wc, at(VH.cargoPod, t + p.ph), p.x - camI, p.y);
      }
    }
    function asteroidY() { return Math.max(sT + 6, gTop - 150) + Math.round(Math.sin(t * 0.5) * 2); }
    function drawStreet() {
      const so = Math.round(camX * F_STREET);
      // lampposts on the curb
      const lp = 88, l0 = Math.floor((so - 20) / lp), l1 = Math.floor((so + W + 10) / lp);
      const lit = n > 0.45 || stormAmt > 0.5;
      for (let k = l0; k <= l1; k++) blit(wc, lit ? PR.lamp.lit : PR.lamp.unlit, k * lp + 30 - so, roadTop + 1 - 20);
      // vehicles: back lane then front lane
      for (let lane = 0; lane < 2; lane++) {
        for (let i = 0; i < vehicles.length; i++) {
          const v = vehicles[i];
          if (!v.on || v.lane !== lane) continue;
          const x = Math.round(v.x - so);
          if (x > W || x + v.w < 0) continue;
          const f = at(v.sp, t + i * 0.21);
          const y = laneFeet(lane) - v.h;
          if (v.grey) wc.drawImage(tinted(f, 'grey' + (f === nth(v.sp, 0) ? 0 : 1), { color: '#8b93a7', amount: 0.62 }), x, y);
          else blit(wc, f, x, y, v.flip);
        }
      }
    }
    function laneFeet(lane) { return lane === 0 ? roadTop + Math.round(road * 0.48) : roadBot - 1; }
    function drawWorldParticles(camI, plane) {
      for (let i = 0; i < MAX_P; i++) {
        const p = parts[i];
        if (!p.on || p.pl !== plane) continue;
        drawParticle(wc, p, -camI);
      }
    }
    function drawParticle(c, p, ox) {
      const x = Math.round(p.x + ox), y = Math.round(p.y);
      const f = p.life / p.max;
      if (p.k === 1) {
        const nF = p.sp.frames ? p.sp.frames.length : 1;
        blit(c, nth(p.sp, Math.min(nF - 1, Math.floor(f * nF))), x, y);
      } else if (p.k === 2) {
        c.fillStyle = p.col;
        const flip = Math.floor(p.life * 8 + p.max * 10) % 2;
        c.fillRect(x, y + flip, 2, flip ? 1 : 2);
      } else if (p.k === 3) {
        c.fillStyle = Math.floor(p.life * 14) % 2 ? '#ffffff' : p.col;
        c.fillRect(x, y, 1, 1);
        if (f < 0.5) { c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3); }
      } else {
        c.globalAlpha = f > 0.6 ? (1 - f) / 0.4 : 1;
        c.fillStyle = p.col;
        c.fillRect(x, y, p.w, p.h);
        c.globalAlpha = 1;
      }
    }
    function drawLights(camI) {
      // building windows / neon at night (or forced on during the escape)
      const escaped = escapeT >= 0;
      for (let i = 0; i < plots.length; i++) {
        const p = plots[i];
        const x = p.x - camI;
        if (x > W + 4 || x + p.w + 40 < 0) continue;
        if (!p.sp) {
          if (p.ghost) {
            const gx = x + Math.floor((p.w - p.gw) / 2) + (Math.random() < 0.03 && !reduce ? 1 : 0);
            wc.globalAlpha = 0.5 + 0.12 * Math.sin(t * 2.6 + p.i);
            wc.drawImage(ghostImg(p.ghost), gx, gTop - p.ghost.h);
            wc.globalAlpha = 1;
          }
          continue;
        }
        const dy = plotDy(p);
        const y = gTop - p.sp.h + dy;
        const nb = escaped ? 1 : clamp(n * 1.7 - p.hash * 0.7, 0, 1);
        if (nb > 0.02) {
          wc.globalAlpha = nb;
          blit(wc, emissive(p.sp, escaped), x, y);
          for (let s = 1; s < p.stalls; s++) blit(wc, emissive(BL.battery.levels[0], escaped), x + p.bw + 2 + (s - 1) * 18, gTop - BL.battery.levels[0].h + dy);
          wc.globalAlpha = 1;
        }
        const def = BL[p.id], an = def.anim;
        if (an && EMIT_KINDS[an.kind] && p.id !== 'podtower') {
          if (an.kind === 'sparks' && mod(t * 0.8 + p.i, 2.2) > 1.3) { /* welder resting */ } else {
            const pts = an.at && an.at[p.lvl];
            if (pts) {
              const f = at(an, t + p.i * 0.37);
              for (let k = 0; k < pts.length; k++) blit(wc, f, x + pts[k][0], y + pts[k][1]);
              if (p.id === 'battery') for (let s = 1; s < p.stalls; s++) { const p0 = an.at[0][0]; blit(wc, at(an, t + s * 0.5), x + p.bw + 2 + (s - 1) * 18 + p0[0], gTop - BL.battery.levels[0].h + dy + p0[1]); }
            }
          }
        }
        if (p.id === 'signal' && def.billboard && def.billboard[p.lvl]) {
          const sl = def.billboard[p.lvl];
          const face = img(nth(avatarSprite(), 0));
          wc.drawImage(face, 0, 2, 16, 16, x + sl.x + 3, y + sl.y, 16, 16);
          if (Math.floor(t * 2) % 3 === 0) { wc.globalAlpha = 0.25; wc.fillStyle = '#39d4ff'; wc.fillRect(x + sl.x, y + sl.y + (Math.floor(t * 20) % sl.h), sl.w, 1); wc.globalAlpha = 1; }
        }
        if (p.id === 'datafarm' && n > 0.3) {
          wc.globalCompositeOperation = 'lighter';
          wc.globalAlpha = 0.22 * n;
          wc.fillStyle = '#39d4ff';
          wc.fillRect(x - 2, gTop, p.w + 4, 3);
          wc.fillRect(x - 1, y - 1, p.w + 2, 2);
          wc.globalCompositeOperation = 'source-over';
          wc.globalAlpha = 1;
        }
      }
      // lamp heads and light pools
      if (n > 0.45 || stormAmt > 0.5) {
        const a = Math.max(clamp((n - 0.45) / 0.3, 0, 1), stormAmt);
        const so = Math.round(camX * F_STREET), lp = 88;
        const l0 = Math.floor((so - 20) / lp), l1 = Math.floor((so + W + 10) / lp);
        wc.globalCompositeOperation = 'lighter';
        wc.fillStyle = '#ffd98a';
        for (let k = l0; k <= l1; k++) {
          const lx = k * lp + 30 - so + 3, ly = roadTop + 1 - 20 + 3;
          for (let r = 0; r < roadTop - ly; r++) {
            const hw = 1 + Math.floor(r * 0.45);
            wc.globalAlpha = a * (0.075 - r * 0.0018);
            wc.fillRect(lx - hw, ly + r, hw * 2, 1);
          }
          wc.globalAlpha = a * 0.07;
          wc.fillRect(lx - 9, gTop + 2, 18, side - 2);
          wc.fillRect(lx - 13, gTop + 4, 26, side - 6);
        }
        wc.globalCompositeOperation = 'source-over';
        wc.globalAlpha = 1;
      }
      // headlights
      if (n > 0.3 || stormAmt > 0.5) {
        const so = Math.round(camX * F_STREET);
        wc.globalCompositeOperation = 'lighter';
        for (let i = 0; i < vehicles.length; i++) {
          const v = vehicles[i];
          if (!v.on) continue;
          const x = Math.round(v.x - so), y = laneFeet(v.lane) - v.h;
          const dir = v.lane === 0 ? 1 : -1;
          const fx = dir > 0 ? x + v.w : x - 1;
          wc.globalAlpha = 0.9 * Math.max(n, stormAmt);
          wc.fillStyle = '#ffd98a';
          wc.fillRect(fx, y + v.h - 4, 1, 1);
          wc.globalAlpha = 0.16 * Math.max(n, stormAmt);
          for (let r = 0; r < 12; r++) wc.fillRect(dir > 0 ? fx + 1 + r : fx - 1 - r, y + v.h - 5 - (r >> 2), 1, 3 + (r >> 1));
        }
        wc.globalCompositeOperation = 'source-over';
        wc.globalAlpha = 1;
      }
      // Repo-Tron's red LED balance
      if (repo.on) {
        const led = ledSprite(repo.mode === 'esc' ? (t - escapeT < 5 ? '$0.00' : 'SHRUG') : fmtShort(debt));
        const lx = Math.round(repo.x - camI + 9 - led.w / 2), ly = midFeet - 20 - 11 + (Math.floor(t * 2) % 2);
        blit(wc, led, lx, ly);
        wc.fillStyle = '#101226';
        wc.fillRect(lx + (led.w >> 1), ly + 9, 1, 2);
      }
      // the gate: EXIT sign and the light behind the doors
      if (gate.on) {
        const gx = gate.x - camI + gateShakeX();
        const f = gateFrame();
        wc.globalCompositeOperation = 'lighter';
        wc.globalAlpha = 0.18 + 0.08 * Math.sin(t * 3);
        wc.fillStyle = '#4ade80';
        wc.fillRect(gx + 12, gTop - 42, 24, 11);
        if (f > 0) {
          const open = [0, 5, 10, 16][f];
          wc.globalAlpha = 0.5;
          wc.fillStyle = '#ffd98a';
          wc.fillRect(gx + 24 - open, gTop - 28, open * 2, 28);
          wc.globalAlpha = 0.18;
          wc.fillRect(gx + 24 - open - 6, gTop - 32, open * 2 + 12, 32 + side);
          wc.globalAlpha = 0.1;
          wc.fillRect(gx - 20, gTop - 44, GATE_W + 40, 44 + side + road);
        }
        wc.globalCompositeOperation = 'source-over';
        wc.globalAlpha = 1;
      }
    }
    function drawWorld() {
      const camI = Math.round(camX);
      wc.clearRect(0, 0, W, H);
      drawSkyActors(camI);
      drawBuildings(camI);
      drawWalkers(camI);
      drawWorldParticles(camI, 1);
      drawStreet();
      // night: darken everything drawn so far, then add the lights
      const dark = Math.max(n * 0.5, stormAmt * 0.3) * (escapeT >= 0 ? (1 - escBlend * 0.8) : 1);
      if (dark > 0.01) {
        wc.globalCompositeOperation = 'source-atop';
        wc.globalAlpha = dark;
        wc.fillStyle = stormAmt > 0.5 ? '#04120a' : '#060818';
        wc.fillRect(0, 0, W, H);
        wc.globalAlpha = 1;
        wc.globalCompositeOperation = 'source-over';
      }
      drawLights(camI);
      drawWorldParticles(camI, 2);
      bc.drawImage(wl, 0, 0);
    }

    // ---------------------------------------------------------------------------
    // Foreground + post effects
    // ---------------------------------------------------------------------------
    // Rain: the drops of the rain tile scattered thin over a big repeating cell and smeared
    // into short streaks (back layer: 2 px dim, front layer: 3 px brighter and faster).
    let rainPats = null;
    const RAIN = [{ size: 96, drops: 30, streak: 2, speed: 110, drift: 22, a: 0.34 },
                  { size: 128, drops: 20, streak: 3, speed: 175, drift: 40, a: 0.55 }];
    function drawRain() {
      if (rainAmt < 0.02) return;
      if (!rainPats) {
        const r = mulberry32(99);
        rainPats = RAIN.map((L, li) => {
          const c = mk(L.size, L.size), x = c.getContext('2d');
          const src = SP.render(nth(PR.rain, li), 1, { tint: { color: '#cfe6ff', amount: li ? 0.6 : 0.35 } });
          const drops = [];
          const rows = PR.rain.frames[li];
          for (let y = 0; y < rows.length; y++) for (let xx = 0; xx < rows[y].length; xx++) if (rows[y][xx] !== '.') drops.push([xx, y]);
          for (let i = 0; i < L.drops; i++) {
            const d = drops[i % drops.length];
            const px = Math.floor(r() * L.size), py = Math.floor(r() * L.size);
            for (let k = 0; k < L.streak; k++) x.drawImage(src, d[0], d[1], 1, 1, px, (py + k) % L.size, 1, 1);
          }
          return bc.createPattern(c, 'repeat');
        });
      }
      const layers = reduce ? 1 : 2;
      for (let l = 0; l < layers; l++) {
        const L = RAIN[l];
        const ox = mod(Math.floor(t * L.drift), L.size), oy = mod(Math.floor(t * L.speed), L.size);
        bc.save();
        bc.globalAlpha = rainAmt * L.a;
        bc.translate(ox, oy);
        bc.fillStyle = rainPats[l];
        bc.fillRect(-ox, -oy, W, sB);
        bc.restore();
      }
    }
    function drawFireflies() {
      if (n < 0.6 || rainAmt > 0.2 || escapeT >= 0) return;
      const a = clamp((n - 0.6) / 0.3, 0, 1);
      bc.globalCompositeOperation = 'lighter';
      for (let i = 0; i < flies.length; i++) {
        const f = flies[i];
        const x = Math.round(sL + f.x * safeW + Math.sin(t * 0.6 + f.p) * 9);
        const y = Math.round(gTop - 34 + f.y * 34 + Math.sin(t * 1.1 + f.p * 2) * 4);
        if (Math.sin(t * 2.4 + f.p * 5) < 0.1) continue;
        bc.globalAlpha = 0.25 * a; bc.fillStyle = '#4ade80'; bc.fillRect(x - 1, y - 1, 3, 3);
        bc.globalAlpha = a; bc.fillStyle = '#b8ffcf'; bc.fillRect(x, y, 1, 1);
      }
      bc.globalCompositeOperation = 'source-over';
      bc.globalAlpha = 1;
    }
    function drawGolden() {
      if (gl.phase !== 2) return;
      const x = Math.round(gl.x), y = Math.round(gl.y);
      bc.globalCompositeOperation = 'lighter';
      const pulse = 0.2 + 0.1 * Math.sin(real * 8);
      bc.globalAlpha = pulse; bc.fillStyle = '#ffd166';
      bc.fillRect(x - 3, y - 1, 18, 18); bc.fillRect(x - 1, y - 3, 14, 22);
      bc.globalAlpha = pulse * 0.6;
      bc.fillRect(x - 6, y + 2, 24, 12); bc.fillRect(x + 1, y - 6, 10, 28);
      bc.globalCompositeOperation = 'source-over';
      bc.globalAlpha = 1;
      blit(bc, at(BOTS.golden, real * 1.5), x, y, gl.dir < 0);
    }
    function drawScreenParticles() {
      for (let i = 0; i < MAX_P; i++) {
        const p = parts[i];
        if (p.on && p.pl === 0) drawParticle(bc, p, 0);
      }
    }
    function ensureGlitchCanvases() {
      if (gA && gA.width === W && gA.height === H) return;
      gA = mk(W, H); gB = mk(W, H); gC = mk(W, H);
    }
    function glitchTear(e) {
      ensureGlitchCanvases();
      const ax = gA.getContext('2d'), bxx = gB.getContext('2d'), cxx = gC.getContext('2d');
      ax.clearRect(0, 0, W, H); ax.drawImage(buf, 0, 0);
      bxx.globalCompositeOperation = 'source-over'; bxx.clearRect(0, 0, W, H); bxx.drawImage(buf, 0, 0);
      bxx.globalCompositeOperation = 'multiply'; bxx.fillStyle = '#ff0000'; bxx.fillRect(0, 0, W, H);
      cxx.globalCompositeOperation = 'source-over'; cxx.clearRect(0, 0, W, H); cxx.drawImage(buf, 0, 0);
      cxx.globalCompositeOperation = 'multiply'; cxx.fillStyle = '#00ffff'; cxx.fillRect(0, 0, W, H);
      const off = Math.max(1, Math.round(3 * Math.sin(Math.PI * e)));
      bc.fillStyle = '#000'; bc.fillRect(0, 0, W, H);
      bc.globalCompositeOperation = 'lighter';
      bc.drawImage(gB, -off, 0);
      bc.drawImage(gC, off, 0);
      bc.globalCompositeOperation = 'source-over';
      const r = mulberry32(Math.floor(real * 30) + 7);
      const bands = 4 + Math.floor(r() * 5);
      for (let i = 0; i < bands; i++) {
        const y = Math.floor(r() * H), h = 1 + Math.floor(r() * 8), dx = Math.round((r() - 0.5) * 24);
        bc.drawImage(gA, 0, y, W, h, dx, y, W, h);
        if (r() < 0.4) { bc.globalAlpha = 0.35; bc.fillStyle = r() < 0.5 ? '#39d4ff' : '#ff00ff'; bc.fillRect(0, y, W, 1); bc.globalAlpha = 1; }
      }
      bc.globalAlpha = 0.28; bc.fillStyle = '#000';
      for (let y = 0; y < H; y += 2) bc.fillRect(0, y, W, 1);
      bc.globalAlpha = 1;
    }
    function drawWipe() {
      if (wipeT < 0) return;
      const w = real - wipeT;
      const slope = 0.7, total = W + H * slope + 4;
      for (let y = 0; y < H; y++) {
        let x0, x1;
        if (w < 0.3) { x0 = 0; x1 = Math.round(total * smooth(w / 0.3) - y * slope); }
        else { x0 = Math.round(total * smooth((w - 0.3) / 0.3) - y * slope); x1 = W; }
        if (x1 <= x0) continue;
        bc.fillStyle = (y & 1) ? '#161a3a' : '#0b0f2b';
        bc.fillRect(x0, y, x1 - x0, 1);
        bc.fillStyle = '#39d4ff';
        if (w < 0.3) bc.fillRect(x1 - 1, y, 1, 1); else bc.fillRect(x0, y, 1, 1);
      }
    }
    function drawDeath() {
      if (deathT < 0) return;
      const a = clamp((real - deathT) / 1.4, 0, 1);
      bc.globalCompositeOperation = 'saturation';
      bc.globalAlpha = a;
      bc.fillStyle = '#808080';
      bc.fillRect(0, 0, W, H);
      bc.globalCompositeOperation = 'source-over';
      bc.globalAlpha = 0.22 * a;
      bc.fillStyle = '#10121c';
      bc.fillRect(0, 0, W, H);
      bc.globalAlpha = 1;
    }

    // ---------------------------------------------------------------------------
    // Simulation
    // ---------------------------------------------------------------------------
    function updateAvatar(dt) {
      const lo = camX + sL + 10, hi = camX + sR - 26;
      if (!av.placed && camReady) {
        av.placed = true;
        if (!(stage === 'vagrant' && ownedN === 0)) { av.x = Math.round(lo + (hi - lo) * rand(0.3, 0.6)); av.timer = rand(0.5, 2); }
      }
      if (escapeT >= 0 && t - escapeT < 12) {
        const te = t - escapeT;
        const goal = gate.x + GATE_W / 2 - 8;
        if (!av.escInit) { av.escInit = true; if (goal - av.x > 90 || av.x > goal - 40) av.x = goal - 70; }
        if (te > 2.4 && av.x < goal) { av.walking = true; av.dir = 1; av.x = Math.min(goal, av.x + 15 * dt); }
        else av.walking = false;
        av.alpha = av.x >= goal - 0.5 ? clamp(1 - (te - 7) / 1.5, 0, 1) : 1;
        if (av.x >= goal - 0.5 && av.alpha <= 0) av.alpha = 0;
        return;
      }
      if (escapeT >= 0 && av.alpha < 1) { av.alpha = Math.min(1, av.alpha + dt); av.x = gate.x - 20; }
      const sitting = deathT >= 0 || burnUntil > t || burnedOut || (crash.on && stormAmt > 0.3);
      if (stage === 'vagrant' && ownedN === 0 && deathT < 0) { // sleeps by the dumpster
        av.walking = false; av.x += (38 - av.x) * Math.min(1, dt * 2);
        return;
      }
      if (sitting) { av.walking = false; return; }
      if (av.x < lo - 80 || av.x > hi + 80) { av.x = av.x < lo ? lo - 18 : hi + 18; av.walking = true; av.dir = av.x < lo ? 1 : -1; av.timer = 4; }
      av.timer -= dt;
      if (av.walking) {
        const away = av.x < lo - 4 || av.x > hi + 4;   // hurry back into view after a camera jump
        av.x += av.dir * (away ? 34 : 13) * dt;
        if (av.x < lo) { av.dir = 1; if (av.x < lo - 20) av.timer = Math.max(av.timer, 1); }
        if (av.x > hi) { av.dir = -1; if (av.x > hi + 20) av.timer = Math.max(av.timer, 1); }
        if (av.timer <= 0) { av.walking = false; av.timer = rand(2, 5); }
      } else if (av.timer <= 0) {
        av.walking = true; av.timer = rand(3, 7);
        const mid = (lo + hi) / 2;
        av.dir = av.x < mid - 30 ? 1 : (av.x > mid + 30 ? -1 : (Math.random() < 0.5 ? -1 : 1));
      }
      if (doodads.implants && Math.random() < dt * 0.8) spawn(2, 3, av.x + rand(3, 13), midFeet - rand(16, 24), 0, -6, 0, 0.5, '#dfe6f5');
    }
    function follow(o, target, dt, speed) {
      const d = target - o.x;
      o.moving = Math.abs(d) > 2;
      if (o.moving) { o.dir = d > 0 ? 1 : -1; o.x += clamp(d, -speed * dt, speed * dt); }
    }
    function updateActors(dt) {
      const vL = camX - 20, vR = camX + W + 20;
      updateAvatar(dt);
      if (doodads.butler) { if (Math.abs(butler.x - av.x) > 120) butler.x = av.x - 14; follow(butler, av.x - (av.dir > 0 ? 13 : -15), dt, 16); }
      if (doodads.tiger) { if (Math.abs(tiger.x - av.x) > 120) tiger.x = av.x + 18; follow(tiger, av.x + (av.dir > 0 ? 17 : -19), dt, 16); }
      // Repo-Tron patrols the visible sidewalk while there is bad debt
      const te = escapeT >= 0 ? t - escapeT : -1;
      if (te >= 0.5 && te < 14) { // the ending: Repo-Tron rolls up to the gate, balance $0.00, then shrugs
        if (!repo.on || repo.mode !== 'esc') { repo.on = true; repo.mode = 'esc'; repo.x = gate.x - 70; repo.dir = 1; repo.pause = 0; }
        const goal = gate.x - 34;
        if (repo.x < goal) { repo.x = Math.min(goal, repo.x + 6 * dt); repo.pause = 0; } else repo.pause = 1;
      } else if (debt > 0.005 && escapeT < 0) {
        repo.mode = 'debt';
        const lo = camX + sL + 4, hi = camX + sR - 24;
        if (!repo.on) { repo.on = true; repo.x = hi; repo.dir = -1; }
        if (repo.x < lo - 60 || repo.x > hi + 60) repo.x = repo.x < lo ? lo - 20 : hi + 20;
        if (repo.pause > 0) repo.pause -= dt;
        else {
          repo.x += repo.dir * (crash.on ? 3 : 7) * dt;
          if (repo.x <= lo && repo.dir < 0) { repo.dir = 1; repo.pause = 1.2; }
          if (repo.x >= hi && repo.dir > 0) { repo.dir = -1; repo.pause = 1.2; }
        }
      } else { repo.on = false; repo.mode = null; }
      // workers shuffle to their shifts in lockstep
      const nW = workerCount();
      if (!workers.ready || workers.x0 < vL - 400 || workers.x0 - nW * 14 > vR + 400) { workers.x0 = workers.ready ? vL : camX + sL + 12; workers.ready = true; }
      workers.x0 += (crash.on ? 30 : 8) * dt;
      if (workers.x0 - nW * 14 > vR) workers.x0 = vL;
      // customers
      timers.cust -= dt;
      const want = Math.min(customers.length, ownedN === 0 ? 0 : 2 + Math.min(5, ownedN));
      let active = 0;
      for (let i = 0; i < customers.length; i++) if (customers[i].on) active++;
      if (timers.cust <= 0 && active < want && !crash.on && deathT < 0) { spawnCustomer(); timers.cust = rand(1.5, 4); }
      for (let i = 0; i < customers.length; i++) updateCustomer(customers[i], dt, vL, vR);
      // foundry bots march off the line, repaired bots leave smiling
      const fp = byId.foundry, rp = byId.repair;
      if (fp && fp.sp) { timers.foundry -= dt; if (timers.foundry <= 0) { spawnMarcher(fp.x + BL.foundry.door[fp.lvl], BL.foundry.actors.bot, 1); timers.foundry = rand(4, 8); } }
      if (rp && rp.sp) { timers.fixed -= dt; if (timers.fixed <= 0) { spawnMarcher(rp.x + BL.repair.door[rp.lvl] + 4, BL.repair.actors.fixed, 0); timers.fixed = rand(5, 9); } }
      for (let i = 0; i < marchers.length; i++) {
        const m = marchers[i];
        if (!m.on) continue;
        m.x += m.v * (crash.on ? 2.5 : 1) * dt;
        if (m.x > vR + 40) m.on = false;
      }
      if (parade.on) { parade.x0 += 16 * dt; if (parade.x0 - parade.n * 17 > camX + W + 10) parade.on = false; }
      // lambo revs now and then
      if (doodads.lambo) {
        timers.rev -= dt;
        if (timers.rev <= 0) {
          timers.rev = rand(5, 9); timers.revUntil = t + 0.8;
          const p = lastOwned >= 0 ? plots[lastOwned] : null;
          const lx = p ? p.x + Math.max(0, p.w - 22) : ALLEY_W - 26;
          for (let k = 0; k < (reduce ? 1 : 3); k++) spawn(1, 1, lx - 8 - k * 3, backFeet - 12, -10 - k * 4, -4, 0, 0.6, null, PR.smoke);
        }
      }
      // burnout steam
      if (burnUntil > t || burnedOut) {
        timers.steam -= dt;
        if (timers.steam <= 0) { timers.steam = reduce ? 0.4 : 0.18; spawn(1, 1, av.x + rand(2, 8), midFeet - 30, rand(-4, 4), -12, 0, 0.7, null, PR.smoke); }
      }
    }
    function spawnCustomer() {
      let total = 0;
      const lo = camX + sL - 40, hi = camX + sR + 40;
      for (let pass = 0; pass < 2 && total === 0; pass++) {
        for (let i = 0; i < plots.length; i++) {
          const p = plots[i];
          p.nb = 0;
          if (!p.sp) continue;
          const dx = p.x + (BL[p.id].door[p.lvl] || 0);
          if (pass === 0 && (dx < lo || dx > hi)) continue;
          p.nb = CUSTOMER_W[p.id] || 0; total += p.nb;
        }
      }
      if (total <= 0) return;
      let r = Math.random() * total, target = null;
      for (let i = 0; i < plots.length; i++) { r -= plots[i].nb; if (r <= 0 && plots[i].nb > 0) { target = plots[i]; break; } }
      if (!target) return;
      for (let i = 0; i < customers.length; i++) {
        const c = customers[i];
        if (c.on) continue;
        const door = target.x + (BL[target.id].door[target.lvl] || 0) - 6;
        const fromLeft = door - camX > (sL + sR) / 2 ? Math.random() < 0.3 : Math.random() < 0.7;
        c.on = true; c.plot = target; c.st = 0; c.alpha = 1; c.can = false;
        c.x = fromLeft ? camX + sL - 16 : camX + sR + 4;
        if (fromLeft && door < c.x) c.x = door - 30;
        if (!fromLeft && door > c.x) c.x = door + 30;
        c.dir = door > c.x ? 1 : -1;
        c.sp = CUST[Math.floor(Math.random() * CUST.length)];
        c.v = rand(10, 14);
        return;
      }
    }
    function updateCustomer(c, dt, vL, vR) {
      if (!c.on) return;
      const p = c.plot;
      if (!p || !p.sp) { if (c.st < 5) { c.st = 5; c.alpha = 1; } }
      const door = p && p.sp ? p.x + (BL[p.id].door[p.lvl] || 0) - 6 : c.x;
      switch (c.st) {
        case 0: // walk to the door
          c.dir = door > c.x ? 1 : -1;
          c.x += c.dir * c.v * dt;
          if (crash.on) { c.st = 5; c.v *= 3; break; }
          if (Math.abs(door - c.x) < 1) { c.x = door; c.st = COUNTER[p.id] ? 1 : 2; c.timer = COUNTER[p.id] ? rand(1.2, 2.2) : 0.4; }
          break;
        case 1: // served at the counter
          c.timer -= dt;
          if (c.timer <= 0) {
            c.st = 5; c.dir = Math.random() < 0.5 ? -1 : 1;
            if (p.id === 'vending') c.can = true;
            if (!reduce) sparkles(2, c.x + 6, backFeet - 18, 3, 0.4);
          }
          break;
        case 2: // walk in (fade)
          c.alpha -= dt / 0.4;
          if (c.alpha <= 0) { c.alpha = 0; c.st = 3; c.timer = rand(3, 7); }
          break;
        case 3: // inside
          c.timer -= dt;
          if (c.timer <= 0) { c.st = 4; c.alpha = 0; }
          break;
        case 4: // come back out
          c.alpha += dt / 0.4;
          if (c.alpha >= 1) { c.alpha = 1; c.st = 5; c.dir = Math.random() < 0.5 ? -1 : 1; }
          break;
        default: // leave
          c.x += c.dir * c.v * (crash.on ? 3 : 1) * dt;
          if (c.x < vL - 20 || c.x > vR + 20) { c.on = false; c.can = false; }
      }
    }
    function spawnMarcher(x, sp, lane) {
      for (let i = 0; i < marchers.length; i++) {
        const m = marchers[i];
        if (m.on) continue;
        m.on = true; m.x = x; m.sp = sp; m.v = rand(10, 12); m.lane = lane;
        return;
      }
    }
    function spawnVehicle(kind, colour) {
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        if (v.on) continue;
        v.on = true; v.kind = kind; v.grey = false; v.lane = Math.random() < 0.5 ? 0 : 1;
        const dir = v.lane === 0 ? 1 : -1;
        if (kind === 'car' || kind === 'amb') { v.sp = VH.hovercar[colour % 3]; v.v = rand(30, 46); v.flip = false; v.grey = kind === 'amb'; }
        else if (kind === 'truck') { v.sp = VH.truck; v.v = rand(22, 28); v.flip = dir > 0; }
        else { v.sp = VH.bus; v.v = rand(18, 22); v.flip = dir < 0; }
        v.w = v.sp.w; v.h = v.sp.h;
        const so = camX * F_STREET;
        v.x = dir > 0 ? so - v.w - rand(2, 30) : so + W + rand(2, 30);
        v.v *= dir;
        return;
      }
    }
    function updateTraffic(dt) {
      const so = camX * F_STREET;
      let cars = 0, trucks = 0;
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        if (!v.on) continue;
        v.x += v.v * (crash.on ? 1.6 : 1) * dt;
        if ((v.v > 0 && v.x > so + W + 40) || (v.v < 0 && v.x + v.w < so - 40)) { v.on = false; continue; }
        if (v.kind === 'car') cars++;
        if (v.kind === 'truck') trucks++;
      }
      const carlot = byId.carlot ? byId.carlot.owned : 0, truckN = byId.truck ? byId.truck.owned : 0;
      const wantCars = Math.min(8, Math.floor(carlot / 5));
      timers.car -= dt;
      if (cars < wantCars && timers.car <= 0) { spawnVehicle('car', Math.floor(Math.random() * 3)); timers.car = rand(0.6, 2.5); }
      timers.amb -= dt;
      if (timers.amb <= 0) { if (wantCars < 2) spawnVehicle('amb', 0); timers.amb = rand(9, 18); }
      if (truckN >= 10) {
        timers.truck -= dt;
        if (timers.truck <= 0 && trucks < (truckN >= 50 ? 2 : 1)) { spawnVehicle('truck', 0); timers.truck = truckN >= 50 ? rand(4, 9) : rand(9, 16); }
      }
      timers.bus -= dt;
      if (timers.bus <= 0) { spawnVehicle('bus', 0); timers.bus = rand(24, 42); }
      // drones
      const want = Math.min(6, Math.floor((byId.drones ? byId.drones.owned : 0) / 10));
      let dn = 0;
      for (let i = 0; i < drones.length; i++) {
        const d = drones[i];
        if (!d.on) continue;
        d.x += d.v * dt;
        if ((d.v > 0 && d.x > camX + W + 20) || (d.v < 0 && d.x < camX - 30)) d.on = false; else dn++;
      }
      timers.drone -= dt;
      if (dn < want && timers.drone <= 0) {
        timers.drone = rand(0.8, 3);
        for (let i = 0; i < drones.length; i++) {
          const d = drones[i];
          if (d.on) continue;
          const dir = Math.random() < 0.5 ? 1 : -1;
          d.on = true; d.v = dir * rand(16, 26); d.box = Math.random() < 0.75; d.ph = Math.random() * 6;
          d.x = dir > 0 ? camX - 14 : camX + W + 2;
          d.y = Math.round(clamp(sT + 10 + Math.random() * (gTop - sT - 100), sT + 6, gTop - 60));
          break;
        }
      }
      // cargo pods from the orbital mine
      const op = byId.orbital;
      if (op && op.sp) {
        timers.pod -= dt;
        if (timers.pod <= 0) {
          timers.pod = rand(5, 9);
          for (let i = 0; i < pods.length; i++) {
            const p = pods[i];
            if (p.on) continue;
            p.on = true; p.x0 = op.x + Math.floor(op.w / 2) - 5; p.x = p.x0; p.y = asteroidY() + 12; p.ph = Math.random() * 3;
            p.target = gTop - 20;
            break;
          }
        }
      }
      for (let i = 0; i < pods.length; i++) {
        const p = pods[i];
        if (!p.on) continue;
        p.y += 13 * dt;
        p.x = p.x0 + Math.round(Math.sin(t * 1.3 + p.ph) * 4);
        if (p.y >= p.target) { p.on = false; dustPuff(p.x + 5, gTop); }
      }
    }
    function updateParticles(dt) {
      for (let i = 0; i < MAX_P; i++) {
        const p = parts[i];
        if (!p.on) continue;
        p.life += dt;
        if (p.life >= p.max) { p.on = false; continue; }
        p.vy += p.g * dt;
        if (p.k === 2) { p.vx *= (1 - 0.8 * dt); p.x += Math.sin(p.life * 5 + p.max * 7) * 6 * dt; }
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      // rain splashes
      if (rainAmt > 0.2) {
        timers.splash -= dt;
        while (timers.splash <= 0) {
          timers.splash += reduce ? 0.12 : 0.045;
          const y = Math.random() < 0.5 ? gTop + 1 + Math.floor(Math.random() * (side - 1)) : roadTop + 1 + Math.floor(Math.random() * (road - 2));
          const p = spawn(0, 0, Math.floor(Math.random() * W), y, 0, 0, 0, 0.14, '#b8e8ff');
          if (p) { p.w = 2; p.h = 1; }
        }
      }
    }
    function startGlitch() { if (gl.phase === 0) { gl.phase = 1; gl.t0 = real; gl.until = real + 12; } }
    function endGlitch() {
      if (gl.phase === 2) sparkles(0, gl.x + 6, gl.y + 8, 26, 1.4);
      gl.phase = 0;
    }
    function updateGlitch(dt) {
      const active = dv ? !!dv.glitchActive : false;
      if (active && !gl.seenActive) startGlitch();
      gl.seenActive = active;
      if (gl.phase === 1 && real - gl.t0 >= 0.3) {
        gl.phase = 2; gl.dir = Math.random() < 0.5 ? 1 : -1;
        gl.x = gl.dir > 0 ? sL + 4 : sR - 16;
      }
      if (gl.phase === 2) {
        const alive = active || (!dv && real < gl.until) || real - gl.t0 < 1.2;
        if (!alive) { endGlitch(); return; }
        gl.x += gl.dir * 18 * dt;
        if (gl.x < sL + 3) { gl.x = sL + 3; gl.dir = 1; }
        if (gl.x > sR - 15) { gl.x = sR - 15; gl.dir = -1; }
        gl.y = frontFeet - 16 - Math.round(Math.abs(Math.sin(real * 5)) * 3);
        timers.spark -= dt;
        if (timers.spark <= 0) { timers.spark = reduce ? 0.25 : 0.07; spawn(0, 3, gl.x + rand(-2, 14), gl.y + rand(-2, 14), rand(-6, 6), rand(-14, -4), 4, rand(0.4, 0.8), SPARKLE[Math.floor(Math.random() * 4)]); }
      }
    }
    function updateCrash(dt) {
      const active = dv ? !!dv.crashActive : false;
      if (active && !crash.on) startCrash();
      if (crash.on && !active && t - crash.t0 > 1.5 && dv) crash.on = false;
      stormAmt = clamp(stormAmt + (crash.on ? dt : -dt * 0.6), 0, 1);
      if (crash.on) {
        timers.bolt -= dt;
        if (timers.bolt <= 0) {
          timers.bolt = rand(2.5, 5);
          timers.boltUntil = t + 0.32;
          if (!reduce) { timers.flash = 1; shakeUntil = real + 0.3; shakeAmp = 1; }
        }
      }
      timers.flash = Math.max(0, timers.flash - dt * 4);
    }
    function startCrash() { if (!crash.on) { crash.on = true; crash.t0 = t; timers.bolt = 0.25; } }
    function startDeath() { if (deathT < 0) { deathT = real; deathRun = st ? st.run : null; } }
    function startEscape() {
      if (escapeT >= 0) return;
      escapeT = t; escBlend = 0;
      if (!reduce) confetti(40, sL, sR, sT);
    }
    function startWipe() { if (wipeT < 0) wipeT = real; }
    function startParade(bizId, count, mult) {
      parade.on = true;
      parade.x0 = (focusUntil > t ? focusX : camX) + sL - 12;
      parade.n = reduce ? 4 : 6;
      parade.icon = bizId && SP.ICONS && SP.ICONS[bizId] ? SP.ICONS[bizId] : null;
      let mtxt = mult ? 'X' + mult : null;
      if (!mtxt && count) { const M = (DATA && DATA.MILESTONES) || [[10, 1.5], [25, 1.5], [50, 2], [100, 2], [200, 3]]; for (const m of M) if (m[0] === count) mtxt = 'X' + m[1]; }
      parade.texts = mtxt ? [mtxt, '$$$', 'YAY', mtxt, 'WOW'] : ['YAY', '$$$', 'WOW'];
    }
    function update(dt) {
      if (!st && !dv) return;
      readState();
      if (!inited || (st && st.run !== runId)) initFromState();
      if (deathT >= 0 && !ending && st && st.run !== deathRun) deathT = -1;
      if (escapeT >= 0 && ending !== 'escaped' && st && st.run !== runId) escapeT = -1;
      if (ending && ending !== 'escaped') startDeath();
      if (ending === 'escaped') startEscape();
      if (escapeT >= 0) escBlend = Math.min(1, escBlend + dt / 1.5);
      // palette: swap under a chapter wipe
      if (palName === null) palName = targetPal;
      if (targetPal !== palName && wipeT < 0) startWipe();
      if (wipeT >= 0) {
        const w = real - wipeT;
        if (w >= 0.3) palName = targetPal;
        if (w >= 0.6) wipeT = -1;
      }
      dayClock += dt;
      const p = dbg.phase !== null ? dbg.phase : mod(dayClock / DAY_S, 1);
      n = nightFor(p);
      if (escapeT >= 0) n = lerp(n, 0.45 * (1 - smooth((t - escapeT) / 6)), escBlend);
      updateCrash(dt);
      const raining = palName === 'gutter' || crash.on;
      rainAmt = clamp(rainAmt + (raining ? dt * 0.8 : -dt * 0.5), 0, 1);
      if (!inited) return;
      layout();
      updateCamera(dt);
      for (let i = 0; i < plots.length; i++) {
        const pl = plots[i];
        if (pl.puff) { pl.puff = false; dustPuff(pl.x + Math.min(pl.w, 40) / 2, gTop); if (pl.w > 44) dustPuff(pl.x + pl.w - 12, gTop); }
      }
      const rr = !!flags.ratRaceExit;
      if (rr && !ratSeen && ratInit) runnerOffAt = t;
      ratSeen = rr; ratInit = true;
      updateActors(dt);
      updateTraffic(dt);
      updateGlitch(dt);
      updateParticles(dt);
      computePalette();
    }

    // ---------------------------------------------------------------------------
    // Frame
    // ---------------------------------------------------------------------------
    function render() {
      bc.imageSmoothingEnabled = false; wc.imageSmoothingEnabled = false; hc.imageSmoothingEnabled = false;
      if (!inited) { bc.fillStyle = '#0a0c18'; bc.fillRect(0, 0, W, H); blitOut(); return; }
      const p = dbg.phase !== null ? dbg.phase : mod(dayClock / DAY_S, 1);
      drawSky();
      drawSkyBodies(p);
      drawClouds(dtNow);
      drawSkylines();
      drawGround();
      drawWorld();
      drawRain();
      drawFireflies();
      drawScreenParticles();
      drawGolden();
      if (timers.flash > 0.01 && !reduce) { bc.globalAlpha = 0.55 * timers.flash; bc.fillStyle = '#e8fff0'; bc.fillRect(0, 0, W, H); bc.globalAlpha = 1; }
      if (gl.phase === 1) glitchTear(clamp((real - gl.t0) / 0.3, 0, 1));
      drawDeath();
      drawWipe();
      blitOut();
    }
    function blitOut() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      let ox = 0, oy = 0;
      if (!reduce) {
        if (shakeUntil > real) { ox = (Math.random() < 0.5 ? -1 : 1) * shakeAmp * D; oy = (Math.random() < 0.5 ? -1 : 1) * shakeAmp * D; }
        const gs = gateShakeX(); if (gs) ox = gs * D;
      }
      if (ox || oy) { ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(buf, 0, 0, W, H, ox, oy, W * D, H * D);
    }
    function loop(ts) {
      if (!running) return;
      raf = root.requestAnimationFrame(loop);
      let dt = lastTs ? (ts - lastTs) / 1000 : 0.016;
      lastTs = ts;
      dt = clamp(dt, 0, 0.05);
      real += dt;
      if (deathT >= 0 && real - deathT < 2) dt *= SLOWMO;
      dtNow = dt;
      t += dt;
      const p0 = root.performance ? root.performance.now() : 0;
      try { update(dt); render(); } catch (err) { if (root.console && errCount++ < 5) root.console.error('Scene error', err); }
      if (p0) perfMs += ((root.performance.now() - p0) - perfMs) * 0.05;
    }

    // ---------------------------------------------------------------------------
    // Pointer: drag to pan; plain clicks fall through to hitTest
    // ---------------------------------------------------------------------------
    let drag = null, suppressClick = false, perfMs = 0, errCount = 0;
    function toLogical(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const k = dpr / D;
      return [(clientX - r.left) * k, (clientY - r.top) * k];
    }
    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      suppressClick = false;
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cam0: camX, moved: false };
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) {
        if (e.pointerType === 'mouse') canvas.style.cursor = hitTest(e.clientX, e.clientY) ? 'pointer' : '';
        return;
      }
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(e.clientY - drag.y0) * 0.7) {
        drag.moved = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { drag.moved = true; }
      }
      if (drag.moved) {
        camX = clampCam(drag.cam0 - dx * dpr / D);
        holdUntil = real + 4; focusUntil = -1;
        camDir = dx > 0 ? -1 : 1;
      }
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved) { suppressClick = true; holdUntil = real + 4; }
      drag = null;
    }
    function onClickCapture(e) {
      if (suppressClick) { suppressClick = false; e.stopImmediatePropagation(); e.preventDefault(); }
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('click', onClickCapture, true);
    if (canvas.style) { canvas.style.touchAction = 'pan-y'; canvas.style.imageRendering = 'pixelated'; }
    if (root.addEventListener) root.addEventListener('resize', resize);

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    function hitTest(clientX, clientY) {
      if (gl.phase !== 2) return null;
      const q = toLogical(clientX, clientY);
      const m = 10 * dpr / D;
      if (q[0] >= gl.x - m && q[0] <= gl.x + 12 + m && q[1] >= gl.y - m && q[1] <= gl.y + 16 + m) return 'goldenbot';
      return null;
    }
    function event(type, p) {
      p = p || EMPTY;
      lastActivity = real;
      switch (type) {
        case 'purchase': {
          if (p.doodad) { doodadPoof(p.doodad); break; }
          const pl = byId[p.businessId];
          if (!pl) break;
          if (p.upgrade || !p.count) { sparkles(2, pl.x + pl.w / 2, gTop - 20, 14, 1); break; }
          av.react = 'jump'; av.reactUntil = t + 0.45;
          focusPlot(pl);
          break;
        }
        case 'milestone': { const pl = byId[p.businessId]; if (pl) focusPlot(pl); startParade(p.businessId, p.count, p.mult); confetti(60, sL, sR, sT); break; }
        case 'parade': startParade(p.businessId || null, p.count || 0, p.mult); confetti(40, sL, sR, sT); break;
        case 'glitch': startGlitch(); break;
        case 'glitchGone': endGlitch(); break;
        case 'crash': startCrash(); break;
        case 'crashOver': if (!dv || !dv.crashActive) crash.on = false; break;
        case 'chapter': startWipe(); confetti(50, sL, sR, sT); break;
        case 'ratRaceExit':
          runnerOffAt = t;
          if (chapter >= 4) confetti(24, land.billX, land.billX + 40, land.billY);
          break;
        case 'death': startDeath(); break;
        case 'escape': startEscape(); break;
        case 'burnout': burnUntil = t + 2; break;
        case 'doodad': doodadPoof(p.id || p.doodad); break;
        case 'crit': av.react = 'arms_up'; av.reactUntil = t + 0.6; break;
        default: break;
      }
    }
    function doodadPoof(id) {
      const camI = Math.round(camX);
      let x = av.x + 8 - camI, y = midFeet - 12;
      if (id === 'hoverbike') { const p = firstOwned >= 0 ? plots[firstOwned] : null; x = (p ? p.x + p.w + 2 : ALLEY_W - 8) - camI; y = backFeet - 4; }
      else if (id === 'lambo') { const p = lastOwned >= 0 ? plots[lastOwned] : null; x = (p ? p.x + Math.max(0, p.w - 22) + 10 : ALLEY_W - 16) - camI; y = backFeet - 4; }
      else if (id === 'yacht') { x = yachtX + 14; y = sT + 20; }
      else if (id === 'moonplot') { x = (sL + sR) / 2; y = sT + 16; }
      sparkles(0, x, y, 24, 1.2);
      av.react = 'jump'; av.reactUntil = t + 0.45;
    }
    function setState(state, derived) { st = state || null; dv = derived || null; }
    function setSafeArea(a) {
      a = a || EMPTY;
      safeCss.left = Math.max(0, +a.left || 0); safeCss.right = Math.max(0, +a.right || 0);
      safeCss.top = Math.max(0, +a.top || 0); safeCss.bottom = Math.max(0, +a.bottom || 0);
      const oldD = D;
      computeScale();
      if (D !== oldD) resize(); else computeSafe();
    }
    function start() {
      if (running) return;
      running = true; lastTs = 0;
      raf = root.requestAnimationFrame(loop);
    }
    function stop() { running = false; if (raf) root.cancelAnimationFrame(raf); raf = 0; }
    function getAvatarScreenPos() {
      if (!inited || av.alpha < 0.5) return null;
      const k = D / dpr;
      const x = av.x + 8 - Math.round(camX), y = midFeet - 26;
      if (x < 0 || x > W) return null;
      return { x: x * k, y: y * k };
    }

    resize();
    return {
      setState: setState,
      setSafeArea: setSafeArea,
      event: event,
      hitTest: hitTest,
      start: start,
      stop: stop,
      resize: resize,
      setReduceMotion: function (b) { reduce = !!b; },
      getAvatarScreenPos: getAvatarScreenPos,
      // Test/screenshot hooks (not part of the game contract): { phase: 0..1|null (0 noon, 0.7 midnight), cam: x|null }
      debug: function (o) {
        o = o || EMPTY;
        if ('phase' in o) dbg.phase = o.phase === null ? null : +o.phase;
        if ('cam' in o) dbg.cam = o.cam === null ? null : +o.cam;
        let np = 0; for (let i = 0; i < MAX_P; i++) if (parts[i].on) np++;
        return { W: W, H: H, S: S, D: D, camX: Math.round(camX), sL: sL, sR: sR, sT: sT, sB: sB, gTop: gTop, worldEnd: worldEnd, t: Math.round(t * 100) / 100, frameMs: Math.round(perfMs * 100) / 100, particles: np, plots: o.plots ? plots.map((q) => [q.id, q.x, q.w, q.owned]) : undefined };
      }
    };
  }

  root.Scene = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Scene;
})(typeof globalThis !== 'undefined' ? globalThis : this);
