/* engine.js — pure game rules for ESCAPE BOTLANDIA (global `Engine`): tick, click, buy, invest, events, chapters, death, prestige, save/load. */
/*
 * Notes for downstream modules (ui.js / main.js / tools):
 *  - Every timer the engine keeps (burnoutUntil, powerups[id].until/cooldownUntil, frenzyUntil,
 *    glitch.nextAt/activeUntil, crash.until/dipUntil, doodadOfferAt, events.lastAt, lastLessonAt,
 *    whatIfs[].at, businesses[id].boostUntil ...) is expressed in `state.gameSeconds`, not wall-clock
 *    ms. `now` (ms) is only used for created/lastSeen/playMs and the RNG seed. Compare with
 *    derived.gameSeconds. This keeps saves, offline time and the headless sim deterministic.
 *  - Lesson status: 'queued' (trigger met, waiting for the 3-minute gate) -> 'new' (envelope on the
 *    HUD, Engine.readLesson accepts it) -> 'read'. L01–L04 (the tutorial pages) bypass the gate.
 *  - state.events.pending = { id, since, doodadId?, jobId? } is the open choice modal; the UI must
 *    call Engine.answerEvent(state, pending.id, optionIndex, now). derived.pendingEvent carries the
 *    substituted {name}/{price}/{upkeep}/{toll} values and the visible options.
 *  - Extra state fields beyond SPEC §12.3 (all documented here): businesses[id].spent (book value),
 *    businesses[id].boostUntil (milestone x2), businesses[id].auto (Auto-Buy toggle),
 *    job.mandatedHousing, job.shiftsThisYear, job.snoozeUntil, market[id].preCrash /
 *    heldSinceCrash / cutUntil, events.nextAt, crash.nextAt / crash.count, whatIfs[], calendar,
 *    split (income split buckets), mods (cached permanent modifiers, rebuilt on load), ghost
 *    (previous run's owned counts), taxDiscountUntil, clickLossUntil, clickMultUntil.
 *  - All randomness goes through Engine.rng(state) (mulberry32 keyed by seed + rngCalls). Tests can
 *    stub it by assigning Engine.rng = fn; every internal call looks it up at call time.
 */
(function (root) {
  'use strict';

  const Data = root.Data || (typeof require === 'function' ? require('./data.js') : null);
  if (!Data) throw new Error('engine.js requires data.js to be loaded first');
  const C = Data.CONST;
  const BIZ = Data.BUSINESSES;
  const INV = Data.INVESTMENTS;
  const NEG_INF = -1e12; // JSON-safe stand-in for "never happened" timestamps

  const API = {};

  // ---------------------------------------------------------------------------------------------
  // RNG — mulberry32. The stream is addressed by (seed, rngCalls) so a save resumes exactly.
  // ---------------------------------------------------------------------------------------------
  function rng(state) {
    state.rngCalls = (state.rngCalls | 0) + 1;
    let t = (state.seed + Math.imul(state.rngCalls, 0x6D2B79F5)) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rand(state, a, b) { return a + API.rng(state) * (b - a); }
  // Box–Muller: one standard normal per two uniforms (the second normal is discarded on purpose so
  // the number of rng calls per price step is fixed and the stream stays easy to reason about).
  function gaussian(state) {
    let u1 = API.rng(state);
    const u2 = API.rng(state);
    if (u1 < 1e-12) u1 = 1e-12;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // ---------------------------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------------------------
  const SUFFIX = [[1e33, 'Dc'], [1e30, 'No'], [1e27, 'Oc'], [1e24, 'Sp'], [1e21, 'Sx'], [1e18, 'Qi'], [1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M']];
  function group(intString) { return intString.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function sig3(v) { return v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0); }
  function fmtAbs(a) {
    if (a < 100) return a.toFixed(2);
    if (a < 1e6) return group(String(Math.round(a)));
    if (a >= 1e36) return a.toExponential(2).replace('e+', 'e');
    for (let i = 0; i < SUFFIX.length; i++) {
      if (a >= SUFFIX[i][0]) {
        let s = sig3(a / SUFFIX[i][0]);
        // 999.6M rounds to "1000M": bump to the next unit instead.
        if (Number(s) >= 1000 && i > 0) s = sig3(a / SUFFIX[i - 1][0]), i = i - 1;
        return s + SUFFIX[i][1];
      }
    }
    return String(a);
  }
  function fmt(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '0.00';
    if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
    const s = fmtAbs(Math.abs(n));
    return (n < 0 && s !== '0.00' ? '-' : '') + s;
  }
  function fmtMoney(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '$0.00';
    if (!Number.isFinite(n)) return n > 0 ? '$∞' : '-$∞';
    const s = fmtAbs(Math.abs(n));
    return (n < 0 && s !== '0.00' ? '-$' : '$') + s;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ' + pad2(sec % 60) + 's';
    return Math.floor(sec / 3600) + 'h ' + pad2(Math.floor((sec % 3600) / 60)) + 'm';
  }
  function fmtPct(x) { return Math.round((x || 0) * 100) + '%'; }
  function subst(text, tokens) {
    if (!text || !tokens) return text;
    return text.replace(/\{(\w+)\}/g, function (m, k) { return k in tokens ? String(tokens[k]) : m; });
  }

  // ---------------------------------------------------------------------------------------------
  // Pure business formulas (§4)
  // ---------------------------------------------------------------------------------------------
  function cost(b, owned) { return b.baseCost * Math.pow(b.costMult, owned); }
  function bulkCost(b, owned, qty) {
    if (qty <= 0) return 0;
    return b.baseCost * Math.pow(b.costMult, owned) * (Math.pow(b.costMult, qty) - 1) / (b.costMult - 1);
  }
  function maxAffordable(b, owned, cash) {
    if (cash <= 0) return 0;
    const n = Math.floor(Math.log(cash * (b.costMult - 1) / (b.baseCost * Math.pow(b.costMult, owned)) + 1) / Math.log(b.costMult));
    // Guard against floating-point rounding right at a boundary.
    let k = Math.max(0, n);
    if (k > 0 && bulkCost(b, owned, k) > cash + 1e-6) k--;
    if (bulkCost(b, owned, k + 1) <= cash + 1e-6) k++;
    return k;
  }
  function milestoneMult(owned) {
    let m = 1;
    for (let i = 0; i < Data.MILESTONES.length; i++) if (owned >= Data.MILESTONES[i][0]) m *= Data.MILESTONES[i][1];
    return m;
  }
  function nextMilestoneCount(owned) {
    for (let i = 0; i < Data.MILESTONES.length; i++) if (owned < Data.MILESTONES[i][0]) return Data.MILESTONES[i][0];
    return null;
  }
  function upgradeMult(levels) { return Math.pow(C.UPGRADE_MULT, levels || 0); }

  // ---------------------------------------------------------------------------------------------
  // Small lookups
  // ---------------------------------------------------------------------------------------------
  function jobOf(state) { return state.job.id ? Data.byId['job:' + state.job.id] : null; }
  function jobTier(state) { const j = jobOf(state); return j ? j.tier : 0; }
  function nextJobOf(state) {
    const j = jobOf(state);
    if (!j) return Data.JOBS[0];
    return j.tier < Data.JOBS.length ? Data.JOBS[j.tier] : null;
  }
  function housingOf(state) { return Data.byId['housing:' + state.housing] || Data.HOUSING[0]; }
  function housingTier(id) { for (let i = 0; i < Data.HOUSING.length; i++) if (Data.HOUSING[i].id === id) return i; return 0; }
  function ownedTotal(state) {
    let n = 0;
    for (let i = 0; i < BIZ.length; i++) n += state.businesses[BIZ[i].id].owned;
    return n;
  }
  function lessonsRead(state) {
    let n = 0;
    for (let i = 0; i < Data.LESSONS.length; i++) if (state.lessons[Data.LESSONS[i].id] === 'read') n++;
    return n;
  }
  function achievementCount(state) {
    let n = 0;
    for (const k in state.achievements) if (state.achievements[k]) n++;
    return n;
  }
  function heatTierOf(heat) {
    const T = Data.HEAT_TIERS;
    let t = T[0];
    for (let i = 0; i < T.length; i++) if (heat >= T[i].min) t = T[i];
    return t;
  }
  function push(state, ev) { state.queue.push(ev); }
  function toast(state, text, kind) { push(state, { type: 'toast', text: text, kind: kind || 'info' }); }
  function say(state, who, text, ttlMs) { push(state, { type: 'say', who: who, text: text, ttlMs: ttlMs || 4000 }); }
  function special(who, key) {
    const ch = Data.CHARACTERS[who];
    return ch && ch.special ? ch.special[key] : undefined;
  }
  function yearBoundaryAfter(gs) { return (Math.floor(gs / C.SEC_PER_YEAR) + 1) * C.SEC_PER_YEAR; }

  // ---------------------------------------------------------------------------------------------
  // mods: permanent modifiers cached from lessons / upgrades / items / doodads / achievements /
  // wisdom perks, so derive() stays O(businesses + investments). Rebuilt by recompute(state).
  // ---------------------------------------------------------------------------------------------
  function recompute(state) {
    const m = {
      bizLessonMult: 1, podtowerMult: 1, taxBiz: C.TAX_BIZ, taxGain: C.TAX_GAIN, crashSofter: 1, danGapMult: 1,
      exitTollMult: 1, inflation: C.INFLATION, doodadResale: C.DOODAD_RESALE, futureMe: false, dripUnlocked: false,
      loanUnlocked: false, achCount: 0, fullyBooted: false, critChance: C.CRIT_CHANCE, critMult: C.CRIT_MULT,
      bizDiscount: 0, taxPoints: 0, autoClicks: 0, offlineEff: C.OFFLINE_EFF, offlineCapH: C.OFFLINE_CAP_H,
      offlineBizEff: C.OFFLINE_EFF, autoTaxSeason: false, autobuy: false, healthDriftItems: 0, noAgeDrift: false,
      medbayMult: 1, fluCostMult: 1, fluChanceMult: 1, healthUpkeep: 0, doodadUpkeep: 0, status: 0,
      upgradeCostMult: 1, milestonePerk: 1, fastTrackPerk: false,
    };
    for (let i = 0; i < Data.LESSONS.length; i++) {
      const L = Data.LESSONS[i];
      if (state.lessons[L.id] !== 'read') continue;
      const r = L.reward;
      if (r.bizMult || r.type === 'bizMult') m.bizLessonMult *= r.bizMult || r.value;
      switch (r.type) {
        case 'bizIdMult': m.podtowerMult *= r.value; break;
        case 'gainTax': m.taxGain = r.value; break;
        case 'bizTax': m.taxBiz = r.value; break;
        case 'crashSofter': m.crashSofter = r.value; break;
        case 'danLess': m.danGapMult = r.gapMult; break;
        case 'exitTollMult': m.exitTollMult = r.value; break;
        case 'inflation': m.inflation = r.value; break;
        case 'doodadResale': m.doodadResale = r.value; break;
        case 'futureMe': m.futureMe = true; break;
        case 'drip': m.dripUnlocked = true; break;
        case 'unlockLoan': m.loanUnlocked = true; break;
        default: break;
      }
    }
    for (let i = 0; i < Data.UPGRADES.length; i++) {
      const U = Data.UPGRADES[i];
      if (!state.upgrades[U.id]) continue;
      const e = U.effect;
      if (e.autoClicksPerSec) m.autoClicks = Math.max(m.autoClicks, e.autoClicksPerSec);
      if (e.critChance) m.critChance = Math.max(m.critChance, e.critChance);
      if (e.critMult) m.critMult = Math.max(m.critMult, e.critMult);
      if (e.bizDiscount) m.bizDiscount += e.bizDiscount;
      if (e.taxPoints) m.taxPoints += e.taxPoints;
      if (e.autoTaxSeason) m.autoTaxSeason = true;
      if (e.offlineBizEff) m.offlineBizEff = Math.max(m.offlineBizEff, e.offlineBizEff);
      if (e.offlineEff) m.offlineEff = Math.max(m.offlineEff, e.offlineEff);
      if (e.offlineCapH) m.offlineCapH = Math.max(m.offlineCapH, e.offlineCapH);
      if (e.autobuy) m.autobuy = true;
    }
    for (let i = 0; i < Data.HEALTH_ITEMS.length; i++) {
      const H = Data.HEALTH_ITEMS[i];
      if (!state.healthItems[H.id]) continue;
      m.healthUpkeep += H.upkeep || 0;
      const e = H.effect || {};
      if (e.healthDrift) m.healthDriftItems += e.healthDrift;
      if (e.noAgeDrift) m.noAgeDrift = true;
      if (e.medbayMult) m.medbayMult *= e.medbayMult;
      if (e.fluCostMult) m.fluCostMult *= e.fluCostMult;
      if (e.fluChanceMult) m.fluChanceMult *= e.fluChanceMult;
    }
    for (let i = 0; i < Data.DOODADS.length; i++) {
      const D = Data.DOODADS[i];
      if (!state.doodads[D.id]) continue;
      m.doodadUpkeep += D.upkeep;
      m.status += D.status;
    }
    m.achCount = achievementCount(state);
    m.fullyBooted = !!state.achievements.fully_booted;
    for (let i = 0; i < Data.WISDOM_PERKS.length; i++) {
      const P = Data.WISDOM_PERKS[i];
      if (state.wisdom < P.at) continue;
      const e = P.effect;
      if (e.offlineEff) m.offlineEff = Math.max(m.offlineEff, e.offlineEff);
      if (e.offlineCapH) m.offlineCapH = Math.max(m.offlineCapH, e.offlineCapH);
      if (e.milestoneMult) m.milestonePerk = e.milestoneMult;
      if (e.upgradeCostMult) m.upgradeCostMult = e.upgradeCostMult;
      if (e.fastTrack) m.fastTrackPerk = true;
    }
    // Businesses that never ran offline before Manager Bots still earn at the plain offline rate.
    if (!state.upgrades.managers) m.offlineBizEff = m.offlineEff;
    state.mods = m;
    return m;
  }

  // ---------------------------------------------------------------------------------------------
  // State creation (§12.3). `now` is wall-clock ms from the caller; the seed derives from it (and
  // opts.seed for tests) so the engine itself never touches Date or Math.random.
  // ---------------------------------------------------------------------------------------------
  function newState(now, opts) {
    opts = opts || {};
    now = typeof now === 'number' ? now : 0;
    const run = opts.run || 1;
    const wisdom = opts.wisdom || 0;
    const s = {
      v: 1, run: run, name: opts.name || '4471', wisdom: wisdom,
      seed: (typeof opts.seed === 'number' ? opts.seed : ((now ^ Math.imul(run, 2654435761)) >>> 0)) >>> 0,
      rngCalls: 0, created: now, lastSeen: now, playMs: 0, gameSeconds: 0,
      cash: C.START_CASH, debt: C.START_DEBT, loan: 0,
      debtApr: run > 1 ? C.RUN2_DEBT_APR : C.DEBT_APR, loanApr: C.LOAN_APR,
      age: C.START_AGE, lifespan: C.BASE_LIFESPAN, health: C.START_HEALTH, heat: 0, burnoutUntil: 0, luckyClicks: 0,
      job: { id: null, shifts: 0, totalShifts: 0, promotionsTaken: 0, mandatedHousing: null, shiftsThisYear: 0, snoozeUntil: 0 },
      housing: 'cardboard', inflationMult: 1,
      businesses: {}, upgrades: {}, healthItems: {}, doodads: {}, extraUpkeep: [],
      investments: {}, market: {}, drip: false,
      powerups: {}, frenzyUntil: 0, frenzyMult: 1,
      chapter: 1, lessons: {}, lessonQueue: [], lastLessonAt: NEG_INF,
      events: { fired: {}, lastAt: NEG_INF, pending: null, nextAt: 0, lastFiredAt: {}, yearFired: {}, crashFired: {} },
      achievements: {},
      glitch: { nextAt: 0, activeUntil: 0 },
      crash: { until: 0, dipUntil: 0, nextAt: 0, count: 0, active: false },
      doodadOfferAt: 0,
      flags: {
        ratRaceExit: false, ratRaceMonths: 0, tutorialStep: 0, seen: {}, tabsOpened: {},
        everEmployed: false, firstClickAt: NEG_INF, heatTier1: false, burnouts: 0, crits: 0, overdrafts: 0,
        overdraftThisMonth: 0, negMonths: 0, botFlus: 0, doodadOffers: 0, b500Bought: false, bitbotVisible: false,
        passiveBeatClicks: false, idleCashSince: NEG_INF, debtEver: C.START_DEBT > 0, debtFree: false,
        quitEarlyAt: NEG_INF, iQuit: false, iQuitTooEarly: false, boughtDip: false, paperHands: false,
        diamondHands: false, bitbotMoon: false, bitbotCrater: false, ratRaceExitAt: NEG_INF, loanUnlocked: false,
        lastResult: '', lastHeldValue: 0, nextBizDiscount: 0, tenYearsWarned: false, lookUpWarned: false,
        deathAt: NEG_INF, escapedAt: NEG_INF, divThisMonth: 0, chapterAt: NEG_INF, nextAmbientAt: 30, criticalWarned: false,
        deathCause: null, rank: null,
      },
      stats: {
        lifetimeEarned: 0, lifetimeClicks: 0, signClicks: 0, shifts: 0, interestPaid: 0, interestEarned: 0, taxesPaid: 0,
        doodadsBought: 0, doodadsDeclined: 0, glitches: 0, crashesSurvived: 0, peakNetWorth: -C.START_DEBT, dividendPayouts: 0,
        bestEventChoices: 0, offlineEarned: 0, clickEarned: 0, bizEarned: 0, divEarned: 0, upkeepPaid: 0,
      },
      queue: [], ending: null, ghost: opts.ghost || null,
      whatIfs: [], calendar: { month: 0, year: 0 },
      split: { since: 0, clicks: 0, business: 0, dividends: 0, lastClicks: 0, lastBusiness: 0, lastDividends: 0 },
      taxDiscountUntil: 0, clickLossUntil: 0, clickMultUntil: 0, mods: null,
      autoAcc: 0, pendingWisdom: 0, attempt: 1, hall: [],
      settings: { sound: true, music: true, reduceMotion: false, volume: 0.7 },
    };
    for (let i = 0; i < BIZ.length; i++) s.businesses[BIZ[i].id] = { owned: 0, level: 0, spent: 0, boostUntil: 0, auto: false };
    for (let i = 0; i < INV.length; i++) {
      s.investments[INV[i].id] = { units: 0, basis: 0 };
      s.market[INV[i].id] = { price: INV[i].start, history: [INV[i].start], drift: 0, recoverUntil: 0, preCrash: 0, heldSinceCrash: false, cutUntil: 0 };
    }
    for (let i = 0; i < Data.POWERUPS.length; i++) s.powerups[Data.POWERUPS[i].id] = { until: 0, cooldownUntil: 0 };
    s.glitch.nextAt = C.GLITCH_MIN_S + rand(s, 0, C.GLITCH_MAX_S - C.GLITCH_MIN_S);
    s.events.nextAt = 120 + rand(s, 0, 60);
    // Wisdom perks (§11) applied at birth.
    for (let i = 0; i < Data.WISDOM_PERKS.length; i++) {
      const P = Data.WISDOM_PERKS[i];
      if (wisdom < P.at) continue;
      const e = P.effect;
      if (e.startDebt !== undefined) { s.debt = e.startDebt; s.flags.debtEver = s.debt > 0; }
      if (e.startBusinesses) {
        for (const id in e.startBusinesses) {
          const b = Data.byId['business:' + id];
          if (!b) continue;
          s.businesses[id].owned = e.startBusinesses[id];
          s.businesses[id].spent = bulkCost(b, 0, e.startBusinesses[id]);
        }
      }
      if (e.startJob) {
        const j = Data.byId['job:' + e.startJob];
        if (j) {
          s.job.id = j.id; s.job.mandatedHousing = j.housing; s.flags.everEmployed = true;
          if (housingTier(s.housing) < housingTier(j.housing)) s.housing = j.housing;
        }
      }
      if (e.lifespan) s.lifespan = Math.min(C.MAX_AGE, s.lifespan + e.lifespan);
      if (e.preRead) for (let k = 0; k < e.preRead.length; k++) { s.lessons[e.preRead[k]] = 'new'; }
    }
    recompute(s);
    if (wisdom >= 150) for (const id in s.lessons) if (s.lessons[id] === 'new') readLesson(s, id);
    s.stats.peakNetWorth = s.cash - s.debt;
    if (run > 1) say(s, 'glitch', special('glitch', 'newRun'), 6000);
    return s;
  }

  // ---------------------------------------------------------------------------------------------
  // Condition DSL (see data.js header). `d` is a core-computation object (netWorth, freedomRatio,
  // clickValue, passivePerSec ...). Custom checks live in CUSTOM.
  // ---------------------------------------------------------------------------------------------
  function investValueOf(state, id) { return state.investments[id].units * state.market[id].price; }
  function investTabUnlocked(state) { return state.chapter >= 5; }
  function assetsCanAfford(state, d, doodad) {
    if (!doodad) return false;
    return d.passiveMonthly >= d.expensesMonthly + doodad.upkeep * state.inflationMult && state.cash >= doodad.price;
  }
  function cheapestAffordableCost(state, d) {
    let best = Infinity;
    for (let i = 0; i < BIZ.length; i++) {
      const b = BIZ[i];
      if (fastTrackLocked(state, b)) continue;
      const p = unitPrice(state, b, state.businesses[b.id].owned, 0);
      if (p <= state.cash && p < best) best = p;
    }
    return best;
  }
  const CUSTOM = {
    exitGateReady: function (s, d) { return d.outOfRatRaceNow && s.cash >= C.EXIT_CHAPTER_CASH_RATIO * d.exitToll; },
    firstClickPlus10s: function (s) { return s.flags.firstClickAt > NEG_INF && s.gameSeconds - s.flags.firstClickAt >= C.LESSON_L01_DELAY_S; },
    firstPaidShift: function (s) { return s.stats.shifts >= 1; },
    firstDoodadOffer: function (s) { return s.flags.doodadOffers >= 1; },
    firstB500Buy: function (s) { return s.flags.b500Bought; },
    bitbotVisible: function (s) { return s.flags.bitbotVisible; },
    threeAssetClasses: function (s) {
      let units = 0;
      for (let i = 0; i < INV.length; i++) units += s.investments[INV[i].id].units;
      return ownedTotal(s) >= 1 && units > 0 && (s.businesses.podtower.owned >= 1 || s.investments.reit.units > 0);
    },
    firstCrash: function (s) { return s.crash.count >= 1; },
    investmentAboveBasis: function (s) {
      for (let i = 0; i < INV.length; i++) {
        const h = s.investments[INV[i].id];
        if (h.basis > 0 && h.units * s.market[INV[i].id].price > h.basis) return true;
      }
      return false;
    },
    passiveBeatsClicks: function (s, d) { return s.flags.passiveBeatClicks || (ownedTotal(s) > 0 && d.passivePerSec > d.clickValue * 3); },
    firstOverdraft: function (s) { return s.flags.overdrafts >= 1; },
    firstBotFlu: function (s) { return s.flags.botFlus >= 1; },
    idleCash20x: function (s) { return s.flags.idleCashSince > NEG_INF && s.gameSeconds - s.flags.idleCashSince >= 60; },
    firstHealthItem: function (s) { for (const k in s.healthItems) if (s.healthItems[k]) return true; return false; },
    lamboAnswered: function (s) { return (s.events.fired.lambo || 0) >= 1; },
    promotionReady: function (s, d) { return !!(d.job && d.job.canPromote); },
    assetsCanAffordOffer: function (s, d) {
      const p = s.events.pending;
      return !!(p && p.doodadId && assetsCanAfford(s, d, Data.byId['doodad:' + p.doodadId]));
    },
    assetsCanAffordLambo: function (s, d) { return assetsCanAfford(s, d, Data.byId['doodad:lambo']); },
    inCrash: function (s) { return s.crash.until > s.gameSeconds; },
    employed: function (s) { return s.job.id !== null; },
    burnoutRisk: function (s) { return s.job.promotionsTaken >= 2 && s.job.shiftsThisYear >= 200; },
    heatTier1: function (s) { return s.flags.heatTier1; },
    firstBurnout: function (s) { return s.flags.burnouts >= 1; },
    firstCrit: function (s) { return s.flags.crits >= 1; },
    rule_of_72: function (s) { const h = s.investments.b500; return h.basis > 0 && h.units * s.market.b500.price >= 2 * h.basis; },
    diamond_hands: function (s) { return s.flags.diamondHands; },
    paper_hands: function (s) { return s.flags.paperHands; },
    bitbot_moon: function (s) { return s.flags.bitbotMoon; },
    bitbot_crater: function (s) { return s.flags.bitbotCrater; },
    good_debt: function (s, d) { return s.loan >= 1e6 && d.netPerSec > 0; },
    debt_free: function (s) { return s.flags.debtFree; },
    i_quit: function (s) { return s.flags.iQuit; },
    i_quit_too_early: function (s) { return s.flags.iQuitTooEarly; },
    bought_the_dip: function (s) { return s.flags.boughtDip; },
    all_legit_health: function (s) {
      for (let i = 0; i < Data.HEALTH_ITEMS.length; i++) {
        const H = Data.HEALTH_ITEMS[i];
        if (!H.scam && !s.healthItems[H.id]) return false;
      }
      return true;
    },
    escaped_before_42: function (s) { return s.ending === 'escaped' && s.age < 42; },
    escaped_under_2h: function (s) { return s.ending === 'escaped' && s.playMs < 2 * 3600 * 1000; },
    sign500_before_job: function (s) { return !s.flags.everEmployed && s.stats.signClicks >= 500; },
    escaped_under_2000_clicks: function (s) { return s.ending === 'escaped' && s.stats.lifetimeClicks < 2000; },
  };

  function evalCond(state, d, c) {
    if (!c) return true;
    if (c.all) { for (let i = 0; i < c.all.length; i++) if (!evalCond(state, d, c.all[i])) return false; return true; }
    if (c.any) { for (let i = 0; i < c.any.length; i++) if (evalCond(state, d, c.any[i])) return true; return false; }
    if (c.not) return !evalCond(state, d, c.not);
    if (c.custom) { const f = CUSTOM[c.custom]; return f ? !!f(state, d) : false; }
    if (c.stat !== undefined) {
      const v = state.stats[c.stat] || 0;
      if (c.gte !== undefined && !(v >= c.gte)) return false;
      if (c.lte !== undefined && !(v <= c.lte)) return false;
      return true;
    }
    if (c.owned !== undefined) return state.businesses[c.owned] ? state.businesses[c.owned].owned >= (c.gte === undefined ? 1 : c.gte) : false;
    if (c.ownedTotal !== undefined) return ownedTotal(state) >= c.ownedTotal;
    if (c.flag !== undefined) return !!state.flags[c.flag];
    if (c.chapter !== undefined) return state.chapter >= c.chapter;
    if (c.netWorth !== undefined) return d.netWorth >= c.netWorth;
    if (c.cash !== undefined) return state.cash >= c.cash;
    if (c.age !== undefined) return state.age >= c.age;
    if (c.lifespan !== undefined) return state.lifespan >= c.lifespan;
    if (c.lesson !== undefined) return state.lessons[c.lesson] === 'read';
    if (c.lessonsRead !== undefined) return lessonsRead(state) >= c.lessonsRead;
    if (c.jobTier !== undefined) return jobTier(state) >= c.jobTier;
    if (c.tabOpened !== undefined) return !!state.flags.tabsOpened[c.tabOpened];
    if (c.seen !== undefined) return !!state.flags.seen[c.seen];
    if (c.upgrade !== undefined) return !!state.upgrades[c.upgrade];
    if (c.healthItem !== undefined) return !!state.healthItems[c.healthItem];
    if (c.doodad !== undefined) return !!state.doodads[c.doodad];
    if (c.debtGt !== undefined) return state.debt > c.debtGt;
    if (c.freedomRatio !== undefined) return d.freedomRatio >= c.freedomRatio;
    if (c.investValue !== undefined) return investValueOf(state, c.investValue.id) >= c.investValue.gte;
    if (c.ending !== undefined) return state.ending === c.ending;
    if (c.granted !== undefined) return false;
    return false;
  }

  // ---------------------------------------------------------------------------------------------
  // Core numbers shared by derive() and tick(). O(businesses + investments), writes into `o`.
  // ---------------------------------------------------------------------------------------------
  function fastTrackLocked(state, b) {
    return !!b.fastTrack && !state.flags.ratRaceExit && !(state.wisdom >= C.FAST_TRACK_WISDOM || (state.mods && state.mods.fastTrackPerk));
  }
  function priceDiscount(state) { return 1 - Math.min(0.09, state.mods.bizDiscount); }
  // Price of the unit at index `owned` (+k). The L04 half-price applies to a single unit.
  function unitPrice(state, b, owned, k) {
    let p = cost(b, owned + k) * priceDiscount(state);
    if (k === 0 && state.flags.nextBizDiscount) p *= state.flags.nextBizDiscount;
    return p;
  }
  function bulkPrice(state, b, owned, qty) {
    let p = bulkCost(b, owned, qty) * priceDiscount(state);
    if (qty > 0 && state.flags.nextBizDiscount) p -= cost(b, owned) * priceDiscount(state) * (1 - state.flags.nextBizDiscount);
    return p;
  }
  function powerupActive(state, id) { return state.powerups[id].until > state.gameSeconds; }
  function exitTollOf(state) { return C.EXIT_TOLL_BASE * Math.pow(C.EXIT_TOLL_RUN_MULT, state.run - 1) * state.mods.exitTollMult; }
  function investYield(state, inv) {
    if (inv.dividendCut && state.market[inv.id].cutUntil > state.gameSeconds) return inv.dividendCut.yield;
    return inv.yield;
  }
  function healthDriftPerYear(state) {
    let dr = C.HEALTH_DRIFT_BASE;
    if (!state.mods.noAgeDrift) {
      if (state.age > 50) dr += C.HEALTH_DRIFT_AFTER_50;
      if (state.age > 70) dr += C.HEALTH_DRIFT_AFTER_70;
    }
    return dr + housingOf(state).healthDrift + state.mods.healthDriftItems;
  }
  function bizGross(state, b, entry, global) {
    if (entry.owned <= 0) return 0;
    let mm = milestoneMult(entry.owned);
    if (mm > 1) mm *= state.mods.milestonePerk;
    let g = b.baseIncome * entry.owned * mm * upgradeMult(entry.level) * global;
    if (b.id === 'podtower') g *= state.mods.podtowerMult;
    if (entry.boostUntil > state.gameSeconds) g *= C.MILESTONE_BOOST_MULT;
    return g;
  }

  function core(state, o) {
    const m = state.mods || recompute(state);
    const gs = state.gameSeconds;
    const job = jobOf(state);
    const housing = housingOf(state);
    // multipliers (§2 order): lessons -> wisdom -> achievements -> power-ups -> events
    const lessons = m.bizLessonMult;
    const wisdomMult = 1 + C.WISDOM_INCOME_PER_POINT * state.wisdom;
    const achMult = 1 + C.ACHIEVEMENT_INCOME_PER_POINT * m.achCount + (m.fullyBooted ? C.FULLY_BOOTED_BONUS : 0);
    const strike = powerupActive(state, 'strike') ? Data.byId['powerup:strike'].effect.bizMult : 1;
    let puClick = 1;
    if (powerupActive(state, 'overclock')) puClick *= Data.byId['powerup:overclock'].effect.clickMult;
    if (powerupActive(state, 'energy')) puClick *= Data.byId['powerup:energy'].effect.clickMult;
    const events = state.frenzyUntil > gs ? state.frenzyMult : 1;
    const global = lessons * wisdomMult * achMult * strike * events;
    // taxes
    const holiday = powerupActive(state, 'taxholiday');
    const disc = state.taxDiscountUntil > gs ? 0.85 : 1;
    const tx = function (rate) { return holiday ? 0 : Math.max(0, rate + m.taxPoints) * disc; };
    const taxJob = tx(C.TAX_JOB), taxBiz = tx(m.taxBiz), taxDiv = tx(C.TAX_DIV), taxGain = tx(m.taxGain);
    // businesses
    let bookValue = 0, gross = 0;
    for (let i = 0; i < BIZ.length; i++) {
      const e = state.businesses[BIZ[i].id];
      bookValue += e.spent;
      gross += bizGross(state, BIZ[i], e, global);
    }
    const bizNet = gross * (1 - taxBiz);
    // investments + dividends (monthly, charged smoothly)
    let investValue = 0, divMonthlyGross = 0;
    for (let i = 0; i < INV.length; i++) {
      const inv = INV[i];
      const h = state.investments[inv.id];
      if (h.units <= 0) continue;
      const v = h.units * state.market[inv.id].price;
      investValue += v;
      const y = investYield(state, inv);
      if (y > 0) divMonthlyGross += v * y / 12;
    }
    const divNetPerSec = divMonthlyGross * (1 - taxDiv) / C.SEC_PER_MONTH * events;
    const divGrossPerSec = divMonthlyGross / C.SEC_PER_MONTH * events;
    // expenses
    let extra = 0;
    for (let i = 0; i < state.extraUpkeep.length; i++) extra += state.extraUpkeep[i].monthly;
    // Rent starts once you have a job or reach chapter 2 (a vagrant sleeps under the overpass for free).
    const rent = (state.chapter >= 2 || state.job.id) ? housing.rent : 0;
    const livingMonthly = (rent + m.doodadUpkeep + m.healthUpkeep + extra + C.EXISTENCE_TAX) * state.inflationMult;
    const interestMonthly = state.debt * state.debtApr / 12 + state.loan * state.loanApr / 12;
    const expensesMonthly = livingMonthly + interestMonthly;
    const passiveMonthly = (bizNet + divNetPerSec) * C.SEC_PER_MONTH;
    const netWorth = state.cash + bookValue + investValue - state.debt - state.loan;
    const freedomRatio = expensesMonthly > 0 ? passiveMonthly / expensesMonthly : (passiveMonthly > 0 ? 1e9 : 0);
    // click value at the current heat (no crit)
    const heatTier = heatTierOf(state.heat);
    const status = m.status + housing.status;
    let clickValue;
    const lucky = state.luckyClicks > 0 ? Data.byId['glitchOutcome:lucky'].effect.luckyMult : 1;
    if (job) {
      clickValue = job.gross * (1 - taxJob) * heatTier.mult * (1 + C.STATUS_CLICK_BONUS * status) * housing.clickMult *
        wisdomMult * puClick * (state.clickMultUntil > gs ? 1.25 : 1) * achMult;
    } else {
      clickValue = Math.max(C.HANDS_ON_MIN, C.HANDS_ON_PCT * (gross + divGrossPerSec)) * heatTier.mult * puClick;
    }
    clickValue *= lucky * events;
    if (state.clickLossUntil > gs) clickValue = 0;
    // job
    let shiftsToPromote = 0, canPromote = false;
    const next = nextJobOf(state);
    if (job && next) {
      shiftsToPromote = Math.ceil(job.shiftsToNext * (1 - Math.min(C.STATUS_MAX_DISCOUNT, C.STATUS_SHIFT_DISCOUNT * status)));
      canPromote = state.job.shifts >= shiftsToPromote && state.cash >= next.certCost;
    }
    const outOfRatRaceNow = state.flags.ratRaceExit && state.debt === 0 && freedomRatio >= 1.0;
    const exitToll = exitTollOf(state);

    o.cash = state.cash; o.debt = state.debt; o.loan = state.loan;
    o.netWorth = netWorth; o.bookValue = bookValue; o.investValue = investValue;
    o.clickValue = clickValue; o.heat = state.heat; o.heatTier = heatTier.tier; o.heatLabel = heatTier.label; o.heatMult = heatTier.mult;
    o.burnoutUntil = state.burnoutUntil;
    o.grossPassivePerSec = gross + divGrossPerSec; o.bizGrossPerSec = gross; o.bizNetPerSec = bizNet; o.dividendPerSec = divNetPerSec;
    o.passivePerSec = bizNet + divNetPerSec;
    o.expensesPerSec = expensesMonthly / C.SEC_PER_MONTH; o.livingPerSec = livingMonthly / C.SEC_PER_MONTH;
    o.netPerSec = o.passivePerSec - o.expensesPerSec;
    o.passiveMonthly = passiveMonthly; o.expensesMonthly = expensesMonthly; o.freedomRatio = freedomRatio;
    o.ratRaceMonths = state.flags.ratRaceMonths; o.outOfRatRaceNow = outOfRatRaceNow;
    o.age = state.age; o.yearsLeft = Math.max(0, state.lifespan - state.age); o.lifespan = state.lifespan; o.health = state.health;
    o.healthDriftPerYear = healthDriftPerYear(state); o.critical = state.health < C.CRITICAL_HEALTH;
    o.taxJob = taxJob; o.taxBiz = taxBiz; o.taxDiv = taxDiv; o.taxGain = taxGain;
    o.multLessons = lessons; o.multWisdom = wisdomMult; o.multAch = achMult; o.multPowerups = strike; o.multEvents = events; o.global = global;
    o.puClick = puClick; o.status = status; o.exitToll = exitToll;
    o.job = null;
    if (job) {
      o.job = { id: job.id, name: job.name, gross: job.gross, shifts: state.job.shifts, shiftsToPromote: shiftsToPromote,
        canPromote: canPromote, nextJob: next ? next.id : null, mandatedHousing: state.job.mandatedHousing, tier: job.tier,
        certCost: next ? next.certCost : 0 };
    }
    return o;
  }
  const SCRATCH = {};

  // ---------------------------------------------------------------------------------------------
  // derive(state) — everything the UI shows (§12.2). Called every frame: O(businesses+investments).
  // ---------------------------------------------------------------------------------------------
  function tabsUnlocked(state) {
    const t = [];
    if (state.chapter >= 2) t.push('work');
    if (state.chapter >= 3 || state.cash >= 40 || ownedTotal(state) > 0) t.push('biz');
    if (state.chapter >= 5) t.push('invest');
    if (state.chapter >= 4) t.push('upgrades');
    if (state.chapter >= 4) t.push('life');
    if (state.chapter >= 3 || state.lessonQueue.length > 0 || state.lessons.L01) t.push('ledger');
    return t;
  }
  function derive(state) {
    const o = core(state, {});
    const gs = state.gameSeconds;
    const ch = Data.CHAPTERS[Math.max(0, Math.min(7, state.chapter - 1))];
    o.gameSeconds = gs;
    o.chapter = state.chapter; o.chapterTitle = ch.title; o.chapterId = ch.id; o.machineForm = ch.machine;
    o.avatarStage = state.ending === 'escaped' ? 'escapee' : ch.avatar; o.statusLabel = ch.statusLabel; o.palette = ch.palette;
    o.taxes = { job: o.taxJob, biz: o.taxBiz, div: o.taxDiv, gain: o.taxGain };
    o.multipliers = { lessons: o.multLessons, wisdom: o.multWisdom, achievements: o.multAch, powerups: o.multPowerups, events: o.multEvents };
    // businesses
    const list = new Array(BIZ.length);
    for (let i = 0; i < BIZ.length; i++) {
      const b = BIZ[i];
      const e = state.businesses[b.id];
      const g = bizGross(state, b, e, o.global);
      const net = g * (1 - o.taxBiz);
      const price = unitPrice(state, b, e.owned, 0);
      const prev = i > 0 ? state.businesses[BIZ[i - 1].id].owned : 1;
      const unlocked = i === 0 || e.owned > 0 || prev >= 1 || state.cash >= C.BIZ_VISIBLE_CASH_PCT * price;
      // payback: price of one more unit / the net income it adds (milestone jumps included)
      const e2 = { owned: e.owned + 1, level: e.level, boostUntil: 0 };
      const gain = (bizGross(state, b, e2, o.global) - (e.boostUntil > gs ? g / C.MILESTONE_BOOST_MULT : g)) * (1 - o.taxBiz);
      list[i] = {
        id: b.id, name: b.name, tier: b.tier, owned: e.owned, level: e.level, cost: price, nextCost: unitPrice(state, b, e.owned, 1),
        grossPerSec: g, netPerSec: net, milestoneMult: milestoneMult(e.owned), nextMilestone: nextMilestoneCount(e.owned),
        unlocked: unlocked, fastTrackLocked: fastTrackLocked(state, b), payback: gain > 0 ? price / gain : Infinity,
        spent: e.spent, boosted: e.boostUntil > gs, auto: e.auto, baseIncome: b.baseIncome, costMult: b.costMult,
      };
    }
    o.businesses = list;
    // investments
    const il = new Array(INV.length);
    for (let i = 0; i < INV.length; i++) {
      const inv = INV[i];
      const h = state.investments[inv.id];
      const mk = state.market[inv.id];
      const value = h.units * mk.price;
      il[i] = {
        id: inv.id, ticker: inv.ticker, name: inv.name, price: mk.price, units: h.units, value: value, basis: h.basis, gain: value - h.basis,
        yieldPerMonth: value * investYield(state, inv) / 12 * (1 - o.taxDiv), history: mk.history,
        unlocked: investTabUnlocked(state) && evalCond(state, o, inv.unlock),
        dipPrice: inv.id === 'b500' && state.crash.dipUntil > gs ? mk.price * (1 - C.DIP_DISCOUNT) : mk.price,
      };
    }
    o.investments = il;
    o.loanUnlocked = state.mods.loanUnlocked;
    o.loanCapacity = Math.max(0, C.LOAN_CAPACITY_RATIO * o.bookValue - state.loan);
    o.loanRoi = o.bookValue > 0 ? o.bizNetPerSec * C.SEC_PER_YEAR / o.bookValue : 0;
    o.canEscape = o.outOfRatRaceNow && state.cash >= o.exitToll && !state.ending;
    // power-ups
    const pl = new Array(Data.POWERUPS.length);
    for (let i = 0; i < Data.POWERUPS.length; i++) {
      const P = Data.POWERUPS[i];
      const p = state.powerups[P.id];
      pl[i] = { id: P.id, until: p.until, cooldownUntil: p.cooldownUntil, active: p.until > gs, ready: p.cooldownUntil <= gs, cost: powerupCost(state, P, o) };
    }
    o.activePowerups = pl;
    o.tabsUnlocked = tabsUnlocked(state);
    o.lessonsRead = lessonsRead(state); o.lessonsTotal = Data.LESSONS.length;
    o.achievementsUnlocked = state.mods.achCount; o.achievementsTotal = Data.ACHIEVEMENTS.length;
    const sp = state.split;
    const tot = sp.clicks + sp.business + sp.dividends + sp.lastClicks + sp.lastBusiness + sp.lastDividends;
    o.incomeSplit = tot > 0
      ? { clicks: (sp.clicks + sp.lastClicks) / tot, business: (sp.business + sp.lastBusiness) / tot, dividends: (sp.dividends + sp.lastDividends) / tot }
      : { clicks: 0, business: 0, dividends: 0 };
    // extras for the UI
    o.medbayCost = medbayCost(state, o);
    o.glitchActive = state.glitch.activeUntil > gs;
    o.crashActive = state.crash.until > gs; o.dipActive = state.crash.dipUntil > gs;
    o.frenzyActive = state.frenzyUntil > gs; o.luckyClicks = state.luckyClicks;
    o.burnedOut = state.burnoutUntil > gs;
    o.pendingEvent = pendingEventView(state, o);
    o.doodadResale = state.mods.doodadResale; o.dripUnlocked = state.mods.dripUnlocked; o.futureMe = state.mods.futureMe;
    o.ending = state.ending; o.wisdom = state.wisdom; o.run = state.run;
    return o;
  }
  function powerupCost(state, P, o) {
    if (P.costPerJobTier) return Math.max(P.minCost, P.costPerJobTier * jobTier(state));
    return Math.max(P.minCost, P.costSeconds * o.grossPassivePerSec);
  }
  function medbayCost(state, o) { return Math.max(C.MEDBAY_MIN, C.MEDBAY_NET_WORTH_PCT * Math.max(0, o.netWorth)) * state.mods.medbayMult; }
  function pendingEventView(state, d) {
    const p = state.events.pending;
    if (!p) return null;
    const ev = Data.byId['event:' + p.id];
    if (!ev) return null;
    const tokens = { name: '', price: '', upkeep: '', toll: fmtMoney(d.exitToll) };
    if (p.doodadId) {
      const dd = Data.byId['doodad:' + p.doodadId];
      tokens.name = dd.name; tokens.price = fmtMoney(dd.price); tokens.upkeep = fmtMoney(dd.upkeep);
    } else if (p.id === 'lambo') {
      const dd = Data.byId['doodad:lambo'];
      tokens.name = dd.name; tokens.price = fmtMoney(dd.price); tokens.upkeep = fmtMoney(dd.upkeep);
    } else if (p.id === 'promotion' && d.job) {
      tokens.name = d.job.nextJob ? Data.byId['job:' + d.job.nextJob].name : ''; tokens.price = fmtMoney(d.job.certCost);
    }
    const options = [];
    for (let i = 0; i < ev.options.length; i++) {
      const op = ev.options[i];
      options.push({ index: i, label: subst(op.label, tokens), visible: !op.requires || evalCond(state, d, op.requires) });
    }
    return { id: ev.id, who: ev.who, title: ev.title, text: subst(ev.text, tokens), options: options, doodadId: p.doodadId || null, since: p.since };
  }

  // ---------------------------------------------------------------------------------------------
  // Chapters (§9.3): the highest chapter whose unlock holds. tick() promotes monotonically.
  // ---------------------------------------------------------------------------------------------
  // Sequential: chapter N+1 needs chapter N's condition too, so the story never skips a beat
  // (e.g. a player who exits the rat race early still sees PAPER ASSETS and BRICKS first).
  function chapterFor(state) {
    const d = core(state, SCRATCH);
    let c = 1;
    for (let i = 1; i < Data.CHAPTERS.length; i++) {
      if (evalCond(state, d, Data.CHAPTERS[i].unlock)) c = i + 1;
      else break;
    }
    return c;
  }

  // ---------------------------------------------------------------------------------------------
  // Achievements (§10.3)
  // ---------------------------------------------------------------------------------------------
  function grant(state, id) {
    if (state.achievements[id]) return false;
    const A = Data.byId['achievement:' + id];
    if (!A) return false;
    state.achievements[id] = true;
    state.mods.achCount += 1;
    if (id === 'fully_booted') state.mods.fullyBooted = true;
    push(state, { type: 'achievement', id: id });
    return true;
  }
  function checkAchievements(state, d) {
    for (let i = 0; i < Data.ACHIEVEMENTS.length; i++) {
      const A = Data.ACHIEVEMENTS[i];
      if (state.achievements[A.id] || A.when.granted) continue;
      if (evalCond(state, d, A.when)) grant(state, A.id);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Lessons (§10.1): triggers -> queue -> (<= 1 per 3 min) -> 'new' envelope -> readLesson.
  // ---------------------------------------------------------------------------------------------
  const TUTORIAL_PAGES = { L01: true, L02: true, L03: true, L04: true };
  function queueLesson(state, id) {
    if (state.lessons[id]) return false;
    state.lessons[id] = 'queued';
    state.lessonQueue.push(id);
    return true;
  }
  function deliverLessons(state) {
    const gs = state.gameSeconds;
    while (state.lessonQueue.length) {
      const id = state.lessonQueue[0];
      const gated = !TUTORIAL_PAGES[id] && gs - state.lastLessonAt < C.LESSON_GAP_S;
      if (gated) break;
      state.lessonQueue.shift();
      if (state.lessons[id] === 'read') continue;
      state.lessons[id] = 'new';
      state.lastLessonAt = gs;
      push(state, { type: 'lesson', lessonId: id });
      if (!TUTORIAL_PAGES[id]) break; // one non-tutorial page per delivery window
    }
  }
  function checkLessons(state, d) {
    for (let i = 0; i < Data.LESSONS.length; i++) {
      const L = Data.LESSONS[i];
      if (state.lessons[L.id]) continue;
      if (evalCond(state, d, L.when)) queueLesson(state, L.id);
    }
    deliverLessons(state);
  }
  function applyReward(state, r) {
    const d = core(state, SCRATCH);
    switch (r.type) {
      case 'debtApr': state.debtApr = Math.min(state.debtApr, r.value); break;
      case 'clickMultTimed': state.clickMultUntil = state.gameSeconds + r.seconds; break;
      case 'cash': state.cash += r.value; break;
      case 'nextBizDiscount': state.flags.nextBizDiscount = r.value; break;
      case 'b500Growth': state.investments.b500.units *= Math.pow(1 + INV[0].mu, r.value); break;
      case 'cashPassiveSeconds': state.cash += Math.max(r.min, d.passivePerSec * r.value); break;
      case 'unlockLoan': state.loanApr = Math.min(state.loanApr, r.apr); state.flags.loanUnlocked = true; break;
      case 'cashExpensesMonths': state.cash += d.expensesMonthly * r.value; break;
      case 'years': state.lifespan = Math.min(C.MAX_AGE, state.lifespan + r.value); break;
      default: break; // bizMult, danLess, gainTax, bizTax, bizIdMult, crashSofter, futureMe, drip, exitTollMult, inflation, doodadResale live in mods
    }
  }
  function readLesson(state, lessonId) {
    const L = Data.byId['lesson:' + lessonId];
    if (!L) return { ok: false, reason: 'unknown' };
    const st = state.lessons[lessonId];
    if (st === 'read') return { ok: false, reason: 'already read' };
    if (st !== 'new') return { ok: false, reason: 'not delivered' };
    state.lessons[lessonId] = 'read';
    recompute(state);
    applyReward(state, L.reward);
    return { ok: true, rewardText: L.rewardText };
  }

  // ---------------------------------------------------------------------------------------------
  // Overdraft: negative cash becomes Repo-Tron debt (§2, §5). Called at the end of every mutation
  // that can push cash below zero and at the end of every tick.
  // ---------------------------------------------------------------------------------------------
  function settleOverdraft(state) {
    if (state.cash >= 0) return 0;
    const amt = -state.cash;
    state.cash = 0;
    state.debt += amt;
    const firstThisMonth = state.flags.overdraftThisMonth <= 0;
    state.flags.overdrafts += 1;
    state.flags.overdraftThisMonth += amt;
    state.flags.debtEver = true;
    state.flags.debtFree = false;
    if (state.flags.overdrafts === 1) say(state, 'repo', special('repo', 'overdraft'));
    // One toast per month at most: bills paid by overdraft happen every tick while you're broke.
    if (firstThisMonth && amt >= 1) toast(state, 'OVERDRAFT: Repo-Tron paid your bills (+' + fmtMoney(amt) + ' debt)', 'warn');
    return amt;
  }
  function creditIncome(state, kind, net, gross) {
    state.cash += net;
    state.stats.lifetimeEarned += net;
    state.stats.taxesPaid += Math.max(0, gross - net);
    if (kind === 'clicks') { state.split.clicks += net; state.stats.clickEarned += net; }
    else if (kind === 'business') { state.split.business += net; state.stats.bizEarned += net; }
    else { state.split.dividends += net; state.stats.divEarned += net; }
    if (state.stats.peakNetWorth < state.cash) state.stats.peakNetWorth = state.cash; // refined in tick
  }

  // ---------------------------------------------------------------------------------------------
  // Clicking and the Hustle Meter (§3.3)
  // ---------------------------------------------------------------------------------------------
  function click(state, now) {
    const gs = state.gameSeconds;
    const res = { earned: 0, crit: false, heat: state.heat, tier: heatTierOf(state.heat).tier, burnout: false, locked: false };
    if (state.ending && state.ending !== 'escaped') return res;
    if (state.burnoutUntil > gs) { res.locked = true; return res; }
    const d = core(state, SCRATCH);
    const job = jobOf(state);
    let value = d.clickValue;
    let crit = false;
    if (API.rng(state) < state.mods.critChance) { crit = true; value *= state.mods.critMult; state.flags.crits += 1; }
    const gross = job ? value / Math.max(1e-9, 1 - d.taxJob) : value;
    if (state.luckyClicks > 0) state.luckyClicks -= 1;
    creditIncome(state, 'clicks', value, job ? gross : value);
    state.stats.lifetimeClicks += 1;
    if (state.flags.firstClickAt === NEG_INF) state.flags.firstClickAt = gs;
    if (job) {
      state.job.shifts += 1; state.job.totalShifts += 1; state.job.shiftsThisYear += 1; state.stats.shifts += 1;
      if (job.tier >= C.GRIND_FATIGUE_JOB_TIER && state.job.totalShifts % C.GRIND_FATIGUE_SHIFTS === 0) {
        state.health = Math.max(0, state.health - 1);
        toast(state, 'GRIND FATIGUE −1 health', 'warn');
      }
    } else if (!state.flags.everEmployed) {
      state.stats.signClicks += 1;
    }
    // heat
    if (!powerupActive(state, 'coffee')) {
      state.heat += C.HEAT_PER_CLICK;
      if (state.heat >= 25) state.flags.heatTier1 = true;
      if (state.heat >= 100) {
        state.heat = 0;
        state.health = Math.max(0, state.health - C.BURNOUT_HEALTH);
        state.burnoutUntil = gs + C.BURNOUT_LOCK_MS / 1000;
        state.flags.burnouts += 1;
        push(state, { type: 'burnout' });
        if (state.flags.burnouts === 1) say(state, 'glitch', special('glitch', 'burnout'), 5000);
        res.burnout = true;
      }
    }
    res.earned = value; res.crit = crit; res.heat = state.heat; res.tier = heatTierOf(state.heat).tier;
    if (crit) push(state, { type: 'sfx', name: 'crit' });
    return res;
  }

  // ---------------------------------------------------------------------------------------------
  // Jobs and housing (§3.1, §3.2)
  // ---------------------------------------------------------------------------------------------
  function applyMandate(state, job, waived) {
    if (waived) return;
    state.job.mandatedHousing = job.housing;
    if (housingTier(state.housing) < housingTier(job.housing)) {
      state.housing = job.housing;
      say(state, 'landlord', special('landlord', 'upgrade'));
    }
  }
  function takeJob(state, jobId, opts) {
    opts = opts || {};
    const J = Data.byId['job:' + jobId];
    if (!J) return { ok: false, reason: 'unknown job' };
    if (state.ending && state.ending !== 'escaped') return { ok: false, reason: 'game over' };
    const cur = jobOf(state);
    if (!cur) {
      if (J.tier !== 1) return { ok: false, reason: 'start with Scrap Sorter' };
      state.job.id = J.id; state.job.shifts = 0; state.flags.everEmployed = true;
      applyMandate(state, J, false);
      push(state, { type: 'promotion', jobId: J.id });
      return { ok: true };
    }
    if (J.tier !== cur.tier + 1) return { ok: false, reason: 'jobs unlock in order' };
    const d = core(state, SCRATCH);
    if (!opts.force && !d.job.canPromote) return { ok: false, reason: state.job.shifts < d.job.shiftsToPromote ? 'more shifts needed' : 'cannot afford certificate' };
    state.cash -= J.certCost;
    state.job.id = J.id; state.job.shifts = 0; state.job.promotionsTaken += 1;
    applyMandate(state, J, !!opts.waiveMandate);
    push(state, { type: 'promotion', jobId: J.id });
    settleOverdraft(state);
    return { ok: true };
  }
  function quitJob(state) {
    if (!state.job.id) return { ok: false, reason: 'no job' };
    const d = core(state, SCRATCH);
    state.job.id = null; state.job.shifts = 0; state.job.mandatedHousing = null;
    if (d.passiveMonthly >= d.expensesMonthly) state.flags.iQuit = true;
    else state.flags.quitEarlyAt = state.gameSeconds;
    say(state, 'supe', special('supe', 'quit'), 5000);
    return { ok: true };
  }
  function setHousing(state, housingId) {
    const H = Data.byId['housing:' + housingId];
    if (!H) return { ok: false, reason: 'unknown housing' };
    if (H.id === state.housing) return { ok: false, reason: 'already there' };
    if (state.job.id && state.job.mandatedHousing && housingTier(H.id) < housingTier(state.job.mandatedHousing)) {
      return { ok: false, reason: 'your job mandates ' + Data.byId['housing:' + state.job.mandatedHousing].name };
    }
    state.housing = H.id;
    say(state, 'landlord', special('landlord', 'upgrade'));
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------
  // Businesses (§4)
  // ---------------------------------------------------------------------------------------------
  function resolveQty(state, b, e, qty) {
    if (qty === 'max') {
      // fold the flat discount into the closed form: price = disc * cost, so cash' = cash / disc
      let cashEff = state.cash / priceDiscount(state);
      if (state.flags.nextBizDiscount) cashEff += cost(b, e.owned) * (1 - state.flags.nextBizDiscount);
      return maxAffordable(b, e.owned, cashEff);
    }
    const n = parseInt(qty, 10);
    return n > 0 ? n : 1;
  }
  function quote(state, businessId, qty) {
    const b = Data.byId['business:' + businessId];
    if (!b) return { count: 0, total: 0, incomeGain: 0 };
    const e = state.businesses[b.id];
    const count = resolveQty(state, b, e, qty);
    const d = core(state, SCRATCH);
    const total = bulkPrice(state, b, e.owned, count);
    const before = bizGross(state, b, { owned: e.owned, level: e.level, boostUntil: 0 }, d.global);
    const after = bizGross(state, b, { owned: e.owned + count, level: e.level, boostUntil: 0 }, d.global);
    return { count: count, total: total, incomeGain: (after - before) * (1 - d.taxBiz) };
  }
  function buy(state, businessId, qty) {
    const b = Data.byId['business:' + businessId];
    if (!b) return { ok: false, bought: 0, spent: 0, reason: 'unknown business' };
    if (state.ending && state.ending !== 'escaped') return { ok: false, bought: 0, spent: 0, reason: 'game over' };
    if (fastTrackLocked(state, b)) return { ok: false, bought: 0, spent: 0, reason: 'FAST TRACK: get out of the rat race first' };
    const e = state.businesses[b.id];
    const count = resolveQty(state, b, e, qty);
    if (count <= 0) return { ok: false, bought: 0, spent: 0, reason: 'cannot afford' };
    const total = bulkPrice(state, b, e.owned, count);
    if (total > state.cash + 1e-6) return { ok: false, bought: 0, spent: 0, reason: 'cannot afford' };
    state.cash -= total;
    if (state.cash < 0 && state.cash > -1e-6) state.cash = 0;
    if (state.flags.nextBizDiscount) state.flags.nextBizDiscount = 0;
    const before = e.owned;
    e.owned += count;
    e.spent += total;
    state.flags.idleCashSince = NEG_INF;
    for (let i = 0; i < Data.MILESTONES.length; i++) {
      const M = Data.MILESTONES[i];
      if (before < M[0] && e.owned >= M[0]) {
        e.boostUntil = state.gameSeconds + C.MILESTONE_BOOST_S;
        push(state, { type: 'milestone', businessId: b.id, count: M[0], mult: M[1] });
      }
    }
    push(state, { type: 'purchase', businessId: b.id, count: count });
    return { ok: true, bought: count, spent: total };
  }
  function setAutobuy(state, businessId, on) {
    const e = state.businesses[businessId];
    if (!e || !state.upgrades.autobuy) return { ok: false, reason: 'Auto-Buy Bot required' };
    e.auto = !!on;
    return { ok: true };
  }
  function buyUpgrade(state, upgradeId) {
    if (state.ending && state.ending !== 'escaped') return { ok: false, reason: 'game over' };
    const BU = Data.byId['bizUpgrade:' + upgradeId];
    if (BU) {
      const e = state.businesses[BU.bizId];
      if (e.level !== BU.level - 1) return { ok: false, reason: e.level >= BU.level ? 'already owned' : 'previous level first' };
      if (e.owned < BU.requires) return { ok: false, reason: 'requires ' + BU.requires + ' owned' };
      if (state.cash < BU.cost) return { ok: false, reason: 'cannot afford' };
      state.cash -= BU.cost;
      e.level = BU.level;
      push(state, { type: 'purchase', businessId: BU.bizId, count: 0, upgrade: BU.id });
      return { ok: true, cost: BU.cost };
    }
    const U = Data.byId['upgrade:' + upgradeId];
    if (!U) return { ok: false, reason: 'unknown upgrade' };
    if (state.upgrades[U.id]) return { ok: false, reason: 'already owned' };
    if (U.requires && !state.upgrades[U.requires]) return { ok: false, reason: 'requires ' + Data.byId['upgrade:' + U.requires].name };
    const price = U.cost * state.mods.upgradeCostMult;
    if (state.cash < price) return { ok: false, reason: 'cannot afford' };
    state.cash -= price;
    state.upgrades[U.id] = true;
    recompute(state);
    push(state, { type: 'purchase', upgrade: U.id, count: 0 });
    return { ok: true, cost: price };
  }
  function upgradePrice(state, U) { return U.cost * state.mods.upgradeCostMult; }

  // ---------------------------------------------------------------------------------------------
  // Health (§7)
  // ---------------------------------------------------------------------------------------------
  function buyHealth(state, itemId) {
    const H = Data.byId['healthItem:' + itemId];
    if (!H) return { ok: false, reason: 'unknown item' };
    if (state.ending && state.ending !== 'escaped') return { ok: false, reason: 'game over' };
    if (state.healthItems[H.id]) return { ok: false, reason: 'already owned' };
    if (state.cash < H.cost) return { ok: false, reason: 'cannot afford' };
    state.cash -= H.cost;
    state.healthItems[H.id] = true;
    if (H.years) state.lifespan = Math.min(C.MAX_AGE, state.lifespan + H.years);
    const e = H.effect || {};
    if (e.healthMin) state.health = Math.max(state.health, e.healthMin);
    recompute(state);
    if (H.scam) {
      grant(state, 'miracle_chump');
      say(state, 'glitch', special('glitch', 'miracle'), 6000);
      toast(state, 'RESULTS MAY VARY. NO REFUNDS.', 'warn');
    } else {
      push(state, { type: 'heal' });
      toast(state, H.name + ': +' + H.years + ' years', 'gold');
    }
    return { ok: true, cost: H.cost };
  }
  function medbay(state) {
    const d = core(state, SCRATCH);
    const c = medbayCost(state, d);
    if (state.ending && state.ending !== 'escaped') return { ok: false, cost: c, reason: 'game over' };
    if (state.health >= C.MEDBAY_HEALTH) return { ok: false, cost: c, reason: 'health already ' + Math.round(state.health) };
    if (state.cash < c) return { ok: false, cost: c, reason: 'cannot afford' };
    state.cash -= c;
    state.health = C.MEDBAY_HEALTH;
    push(state, { type: 'heal' });
    return { ok: true, cost: c };
  }

  // ---------------------------------------------------------------------------------------------
  // Power-ups (§8)
  // ---------------------------------------------------------------------------------------------
  function activatePowerup(state, powerupId, now) {
    const P = Data.byId['powerup:' + powerupId];
    if (!P) return { ok: false, reason: 'unknown power-up', cost: 0 };
    const gs = state.gameSeconds;
    const p = state.powerups[P.id];
    const d = core(state, SCRATCH);
    const c = powerupCost(state, P, d);
    if (state.ending && state.ending !== 'escaped') return { ok: false, reason: 'game over', cost: c };
    if (p.cooldownUntil > gs) return { ok: false, reason: 'cooling down', cost: c };
    if (state.cash < c) return { ok: false, reason: 'cannot afford', cost: c };
    state.cash -= c;
    p.until = gs + P.durationS;
    p.cooldownUntil = gs + P.cooldownS;
    if (P.effect.heatReset) state.heat = 0;
    if (P.lifeCost) state.lifespan -= P.lifeCost;
    if (P.effect.taxZero) say(state, 'res', special('res', 'taxHoliday'));
    push(state, { type: 'sfx', name: 'whoosh' });
    return { ok: true, cost: c };
  }

  // ---------------------------------------------------------------------------------------------
  // Investments (§5)
  // ---------------------------------------------------------------------------------------------
  function investUnlocked(state, inv, d) { return investTabUnlocked(state) && evalCond(state, d || core(state, SCRATCH), inv.unlock); }
  function buyUnitsInternal(state, inv, cashAmount) {
    const mk = state.market[inv.id];
    const gs = state.gameSeconds;
    const dip = inv.id === 'b500' && state.crash.dipUntil > gs;
    const price = dip ? mk.price * (1 - C.DIP_DISCOUNT) : mk.price;
    const units = cashAmount / price;
    const h = state.investments[inv.id];
    h.units += units; h.basis += cashAmount;
    state.cash -= cashAmount;
    if (inv.id === 'b500') state.flags.b500Bought = true;
    if (dip && inv.id === 'b500') state.flags.boughtDip = true;
    return units;
  }
  function investBuy(state, assetId, cashAmount) {
    const inv = Data.byId['investment:' + assetId];
    if (!inv) return { ok: false, units: 0, proceeds: 0, tax: 0, reason: 'unknown asset' };
    if (state.ending && state.ending !== 'escaped') return { ok: false, units: 0, proceeds: 0, tax: 0, reason: 'game over' };
    if (!investUnlocked(state, inv)) return { ok: false, units: 0, proceeds: 0, tax: 0, reason: 'locked: ' + inv.unlockText };
    cashAmount = Math.min(Number(cashAmount) || 0, state.cash);
    if (cashAmount <= 0) return { ok: false, units: 0, proceeds: 0, tax: 0, reason: 'nothing to invest' };
    const units = buyUnitsInternal(state, inv, cashAmount);
    push(state, { type: 'sfx', name: 'chaching' });
    return { ok: true, units: units, proceeds: -cashAmount, tax: 0 };
  }
  function sellUnitsInternal(state, inv, fraction, d) {
    const h = state.investments[inv.id];
    const mk = state.market[inv.id];
    fraction = Math.max(0, Math.min(1, fraction));
    const units = h.units * fraction;
    if (units <= 0) return { units: 0, proceeds: 0, tax: 0, gain: 0 };
    const proceeds = units * mk.price;
    const basisSold = h.basis * fraction;
    const gain = proceeds - basisSold;
    const tax = gain > 0 ? gain * d.taxGain : 0;
    h.units -= units; h.basis -= basisSold;
    if (h.units < 1e-9) { h.units = 0; h.basis = 0; }
    state.cash += proceeds - tax;
    state.stats.taxesPaid += tax;
    if (gain > 0) state.stats.interestEarned += gain;
    if (state.crash.until > state.gameSeconds && !inv.immuneToCrash) {
      state.flags.paperHands = true;
      state.flags.lastHeldValue += units * (mk.preCrash || mk.price);
    }
    mk.heldSinceCrash = false;
    return { units: units, proceeds: proceeds, tax: tax, gain: gain };
  }
  function investSell(state, assetId, fraction) {
    const inv = Data.byId['investment:' + assetId];
    if (!inv) return { ok: false, units: 0, proceeds: 0, tax: 0, reason: 'unknown asset' };
    if (state.ending && state.ending !== 'escaped') return { ok: false, units: 0, proceeds: 0, tax: 0, reason: 'game over' };
    const d = core(state, SCRATCH);
    state.flags.lastHeldValue = 0;
    const r = sellUnitsInternal(state, inv, Number(fraction) || 0, d);
    if (r.units <= 0) return { ok: false, units: 0, proceeds: 0, tax: 0, reason: 'nothing to sell' };
    return { ok: true, units: r.units, proceeds: r.proceeds, tax: r.tax, gain: r.gain };
  }
  function setDrip(state, on) {
    if (!state.mods.dripUnlocked) return { ok: false, reason: 'read L09 first' };
    state.drip = !!on;
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------
  // Debt and loans (§5)
  // ---------------------------------------------------------------------------------------------
  function payDebt(state, amount) {
    if (state.debt <= 0) return { ok: false, reason: 'no debt' };
    amount = Math.min(Number(amount) || 0, state.cash, state.debt);
    if (amount <= 0) return { ok: false, reason: 'nothing to pay' };
    state.cash -= amount; state.debt -= amount;
    if (state.debt < 1e-6) {
      state.debt = 0;
      state.flags.debtFree = true;
      push(state, { type: 'debtPaid' });
      say(state, 'repo', special('repo', 'paidOff'), 6000);
    }
    return { ok: true, paid: amount };
  }
  function takeLoan(state, amount) {
    if (!state.mods.loanUnlocked) return { ok: false, reason: 'read L11 to unlock Bot-Bank' };
    if (state.ending && state.ending !== 'escaped') return { ok: false, reason: 'game over' };
    const d = core(state, SCRATCH);
    const cap = Math.max(0, C.LOAN_CAPACITY_RATIO * d.bookValue - state.loan);
    amount = Math.min(Number(amount) || 0, cap);
    if (amount <= 0) return { ok: false, reason: 'no capacity: buy businesses first' };
    state.loan += amount; state.cash += amount;
    return { ok: true, amount: amount };
  }
  function repayLoan(state, amount) {
    if (state.loan <= 0) return { ok: false, reason: 'no loan' };
    amount = Math.min(Number(amount) || 0, state.cash, state.loan);
    if (amount <= 0) return { ok: false, reason: 'nothing to repay' };
    state.cash -= amount; state.loan -= amount;
    if (state.loan < 1e-6) state.loan = 0;
    return { ok: true, paid: amount };
  }

  // ---------------------------------------------------------------------------------------------
  // Doodads (§6)
  // ---------------------------------------------------------------------------------------------
  function buyDoodadInternal(state, D, allowOverdraft) {
    if (state.doodads[D.id]) return { ok: false, reason: 'already owned' };
    if (!allowOverdraft && state.cash < D.price) return { ok: false, reason: 'cannot afford' };
    state.cash -= D.price;
    state.doodads[D.id] = true;
    state.stats.doodadsBought += 1;
    if (D.healthOnce) state.health = Math.min(100, state.health + D.healthOnce);
    recompute(state);
    push(state, { type: 'purchase', doodad: D.id, count: 0 });
    settleOverdraft(state);
    return { ok: true };
  }
  function buyDoodad(state, doodadId) {
    const D = Data.byId['doodad:' + doodadId];
    if (!D) return { ok: false, reason: 'unknown doodad' };
    if (state.ending && state.ending !== 'escaped') return { ok: false, reason: 'game over' };
    return buyDoodadInternal(state, D, false);
  }
  function sellDoodad(state, doodadId) {
    const D = Data.byId['doodad:' + doodadId];
    if (!D) return { ok: false, reason: 'unknown doodad' };
    if (!state.doodads[D.id]) return { ok: false, reason: 'not owned' };
    const proceeds = D.price * state.mods.doodadResale;
    delete state.doodads[D.id];
    state.cash += proceeds;
    recompute(state);
    return { ok: true, proceeds: proceeds };
  }

  // ---------------------------------------------------------------------------------------------
  // Golden Bot (§8), tabs and tutorial bookkeeping
  // ---------------------------------------------------------------------------------------------
  function collectGlitch(state, now) {
    const gs = state.gameSeconds;
    if (state.glitch.activeUntil <= gs) return { kind: null, text: 'no glitch on screen' };
    state.glitch.activeUntil = 0;
    state.stats.glitches += 1;
    const d = core(state, SCRATCH);
    let r = API.rng(state);
    let G = Data.GLITCH_OUTCOMES[0];
    for (let i = 0; i < Data.GLITCH_OUTCOMES.length; i++) {
      G = Data.GLITCH_OUTCOMES[i];
      if (r < G.p) break;
      r -= G.p;
    }
    const e = G.effect;
    let text = G.text;
    if (e.frenzyMult) { state.frenzyUntil = gs + e.seconds; state.frenzyMult = e.frenzyMult; }
    if (e.lumpPct) {
      const amt = Math.max(e.min, e.lumpPct * d.passivePerSec * e.lumpPassiveSeconds);
      state.cash += amt; state.stats.lifetimeEarned += amt;
      text += ' +' + fmtMoney(amt);
    }
    if (e.luckyClicks) state.luckyClicks = e.luckyClicks;
    if (e.wisdom) state.wisdom += e.wisdom;
    push(state, { type: 'toast', text: text, kind: 'gold' });
    push(state, { type: 'sfx', name: 'glitch' });
    return { kind: G.id, text: text };
  }
  function markSeen(state, key) { state.flags.seen[key] = true; return { ok: true }; }
  function openTab(state, tabId) {
    if (!state.flags.tabsOpened[tabId]) state.flags.tabsOpened[tabId] = true;
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------
  // Choice events — "INCOMING TRANSMISSION" (§10.2). One pending modal at a time; the UI answers
  // with Engine.answerEvent. Outcomes follow the DSL documented at the top of data.js.
  // ---------------------------------------------------------------------------------------------
  const REPEAT_GAP_S = 480; // the same repeatable deck event never returns within 8 minutes
  function openEvent(state, id, extra) {
    const gs = state.gameSeconds;
    state.events.pending = Object.assign({ id: id, since: gs }, extra || {});
    state.events.fired[id] = (state.events.fired[id] || 0) + 1;
    state.events.lastFiredAt[id] = gs;
    state.events.lastAt = gs;
    const ev = Data.byId['event:' + id];
    if (ev && ev.when.every === 'year') state.events.yearFired[id] = state.calendar.year;
    if (ev && ev.when.oncePerCrash) state.events.crashFired[id] = state.crash.count;
    push(state, { type: 'event', eventId: id });
    // Auto-answer (Accountant Bot handles Tax Season) without bothering the player.
    if (ev && ev.autoWith && state.upgrades[ev.autoWith]) {
      answerEvent(state, id, ev.autoOption, 0, { auto: true });
      toast(state, ev.title + ': handled by ' + Data.byId['upgrade:' + ev.autoWith].name, 'info');
    }
  }
  function deckEligible(state, d, ev) {
    const w = ev.when;
    const gs = state.gameSeconds;
    if (w.system) return false;
    if (state.chapter < (w.chapterMin || 1)) return false;
    if (w.chapterMax && state.chapter > w.chapterMax) return false;
    const fired = state.events.fired[ev.id] || 0;
    if (w.once && fired > 0) return false;
    if (w.every === 'year' && state.events.yearFired[ev.id] === state.calendar.year) return false;
    if (w.oncePerCrash && state.events.crashFired[ev.id] === state.crash.count) return false;
    if (w.repeatable && fired > 0 && gs - (state.events.lastFiredAt[ev.id] || NEG_INF) < REPEAT_GAP_S) return false;
    if (w.condition && !evalCond(state, d, w.condition)) return false;
    return true;
  }
  function pickDoodadOffer(state, d) {
    const cands = [];
    const cap = Math.max(3000, d.netWorth * 0.6);
    for (let i = 0; i < Data.DOODADS.length; i++) {
      const D = Data.DOODADS[i];
      if (!state.doodads[D.id] && D.price <= cap) cands.push(D);
    }
    if (!cands.length) return null;
    // Dan pitches one of the two priciest things you can almost afford. Of course he does.
    const top = cands.slice(-2);
    return top[Math.floor(API.rng(state) * top.length) % top.length];
  }
  function scheduleEvents(state, d) {
    const gs = state.gameSeconds;
    const E = state.events;
    if (E.pending) {
      // A promotion offer that no longer applies (promoted via the WORK tab, or the cash is gone) closes itself.
      if (E.pending.id === 'promotion' && !(d.job && d.job.canPromote)) E.pending = null;
      return;
    }
    if (state.ending) return;
    // 1) Crash choice: right when a crash starts.
    if (state.crash.until > gs && state.chapter >= 5 && state.events.crashFired.crash_choice !== state.crash.count && ownedInvestments(state)) {
      openEvent(state, 'crash_choice');
      return;
    }
    // 2) Promotion: as soon as it is ready (Supe never waits).
    if (d.job && d.job.canPromote && gs >= state.job.snoozeUntil && gs - E.lastAt >= 5) {
      openEvent(state, 'promotion', { jobId: d.job.nextJob });
      return;
    }
    if (gs - E.lastAt < C.EVENT_MIN_GAP_S) return;
    // 3) Doodad Dan, from chapter 4.
    if (state.chapter >= 4 && gs >= state.doodadOfferAt) {
      if (state.doodadOfferAt === 0) { state.doodadOfferAt = gs + 45; return; }
      const D = pickDoodadOffer(state, d);
      state.doodadOfferAt = gs + C.DOODAD_OFFER_GAP_S * state.mods.danGapMult;
      if (D) {
        state.flags.doodadOffers += 1;
        openEvent(state, 'doodad_offer', { doodadId: D.id });
        return;
      }
    }
    // 4) The random deck.
    if (gs < E.nextAt) return;
    const pool = [];
    for (let i = 0; i < Data.EVENTS.length; i++) if (deckEligible(state, d, Data.EVENTS[i])) pool.push(Data.EVENTS[i]);
    if (!pool.length) { E.nextAt = gs + 20; return; }
    const ev = pool[Math.floor(API.rng(state) * pool.length) % pool.length];
    E.nextAt = gs + C.EVENT_MIN_GAP_S + rand(state, 0, 90);
    openEvent(state, ev.id);
  }
  function ownedInvestments(state) {
    for (let i = 0; i < INV.length; i++) if (state.investments[INV[i].id].units > 0) return true;
    return false;
  }
  function rollResultText(mult) {
    return mult >= 1 ? 'MOONED +' + Math.round((mult - 1) * 100) + '%' : 'RUGGED -' + Math.round((1 - mult) * 100) + '%';
  }
  function applyOutcome(state, ev, op, pending, d) {
    const o = op.outcome || {};
    const gs = state.gameSeconds;
    const r = { failed: false, result: '', accepted: false };
    if (o.chance !== undefined && API.rng(state) >= o.chance) { r.failed = true; return r; }
    if (o.cash) state.cash += o.cash;
    if (o.cashPct) state.cash += o.cashPct * Math.max(0, d.netWorth);
    if (o.upkeep) state.extraUpkeep.push({ label: o.label || 'Subscription', monthly: o.upkeep });
    if (o.debtApr) state.debtApr = o.debtApr;
    if (o.taxDiscount) state.taxDiscountUntil = yearBoundaryAfter(gs);
    if (o.penaltyChance) {
      if (API.rng(state) < o.penaltyChance) {
        const pen = Math.max(50, state.cash * o.penaltyPct);
        state.cash -= pen;
        toast(state, 'R.E.S. PENALTY −' + fmtMoney(pen), 'warn');
      } else toast(state, 'R.E.S.: NO ERRORS FOUND. SUSPICIOUS.', 'info');
    }
    if (o.clickIncomeLoss) state.clickLossUntil = gs + o.clickIncomeLoss * C.SEC_PER_MONTH;
    if (o.lottery) {
      const L = o.lottery;
      state.cash -= L.tickets * L.price;
      let won = 0;
      for (let i = 0; i < L.tickets; i++) if (API.rng(state) < 1 / L.odds) won += L.prize;
      if (won > 0) { state.cash += won; toast(state, 'BOT-LOTTO WINNER! +' + fmtMoney(won), 'gold'); r.result = 'WON'; }
      else { toast(state, 'Bot-Lotto: not a winner. (1 in ' + group(String(L.odds)) + ')', 'info'); r.result = 'LOST'; }
    }
    if (o.invest) {
      const I = o.invest;
      const inv = Data.byId['investment:' + I.id];
      let stake = I.amount !== undefined ? I.amount : (I.pct || 0) * Math.max(0, d.netWorth);
      stake = Math.max(0, Math.min(stake, state.cash));
      if (I.roll) {
        let x = API.rng(state), pick = I.roll[I.roll.length - 1];
        for (let i = 0; i < I.roll.length; i++) { if (x < I.roll[i].p) { pick = I.roll[i]; break; } x -= I.roll[i].p; }
        r.result = rollResultText(pick.mult);
        if (stake > 0) {
          const delta = stake * (pick.mult - 1);
          state.cash += delta;
          if (delta > 0) state.stats.lifetimeEarned += delta;
          toast(state, 'MOONCOIN ' + r.result + ' (' + (delta >= 0 ? '+' : '') + fmtMoney(delta) + ')', delta >= 0 ? 'money' : 'warn');
        }
      } else if (inv && stake > 0) {
        buyUnitsInternal(state, inv, stake);
      }
    }
    if (o.sellInvestments) {
      state.flags.lastHeldValue = 0;
      for (let i = 0; i < INV.length; i++) sellUnitsInternal(state, INV[i], 1, d);
    }
    if (o.buyDip) {
      if (state.cash > 0) buyUnitsInternal(state, Data.byId['investment:b500'], state.cash);
    }
    if (o.sellBusinessHalf) {
      const b = Data.byId['business:' + o.sellBusinessHalf];
      const e = state.businesses[b.id];
      const n = Math.floor(e.owned / 2);
      if (n > 0) {
        const before = bizGross(state, b, { owned: e.owned, level: e.level, boostUntil: 0 }, d.global);
        const after = bizGross(state, b, { owned: e.owned - n, level: e.level, boostUntil: 0 }, d.global);
        const monthly = (before - after) * (1 - d.taxBiz) * C.SEC_PER_MONTH;
        const cash = monthly * o.cashMonths;
        e.spent *= (e.owned - n) / e.owned;
        e.owned -= n;
        state.cash += cash;
        state.stats.lifetimeEarned += cash;
        toast(state, 'Sold ' + n + ' ' + b.name + ' for ' + fmtMoney(cash), 'money');
      }
    }
    if (o.years) state.lifespan = Math.min(C.MAX_AGE, state.lifespan + o.years);
    if (o.health) state.health = Math.max(0, Math.min(100, state.health + o.health));
    if (o.job === 'next') {
      const next = nextJobOf(state);
      let waive = false;
      if (o.negotiate) { waive = API.rng(state) < o.negotiate.p; if (!waive) r.failed = true; }
      if (next) {
        const res = takeJob(state, next.id, { waiveMandate: waive });
        r.accepted = !!res.ok;
        if (!res.ok) toast(state, 'Promotion failed: ' + res.reason, 'warn');
      }
    }
    if (o.doodad) {
      const id = o.doodad === 'offer' ? pending.doodadId : o.doodad;
      const D = Data.byId['doodad:' + id];
      if (D) buyDoodadInternal(state, D, true); // "0% down!": Dan happily puts you into overdraft
    }
    if (o.doodadDeclined) state.stats.doodadsDeclined += 1;
    if (o.quit) quitJob(state);
    if (o.achievement) grant(state, o.achievement);
    if (o.lesson) queueLesson(state, o.lesson);
    settleOverdraft(state);
    return r;
  }
  function answerEvent(state, eventId, optionIndex, now, opts) {
    const p = state.events.pending;
    if (!p || p.id !== eventId) return { ok: false, reason: 'no such event open' };
    const ev = Data.byId['event:' + eventId];
    const op = ev && ev.options[optionIndex];
    if (!op) return { ok: false, reason: 'no such option' };
    const d = core(state, {});
    if (op.requires && !evalCond(state, d, op.requires)) return { ok: false, reason: 'option not available' };
    state.events.pending = null;
    const r = applyOutcome(state, ev, op, p, d);
    if (op.best) state.stats.bestEventChoices += 1;
    if (eventId === 'promotion' && !r.accepted) state.job.snoozeUntil = state.gameSeconds + 150;
    const response = r.failed && op.failResponse ? op.failResponse : op.response;
    if (response && !(opts && opts.auto)) say(state, response.who, response.text, 5000);
    let whatIf = null;
    if (op.whatIf && !(r.failed && op.outcome && op.outcome.chance !== undefined)) {
      const text = subst(op.whatIf.text, {
        result: r.result || '', heldValue: fmtMoney(state.flags.lastHeldValue || 0),
        upkeep: p.doodadId ? fmtMoney(Data.byId['doodad:' + p.doodadId].upkeep) : '',
      });
      whatIf = { delayS: op.whatIf.delayS, text: text };
      state.whatIfs.push({ at: state.gameSeconds + op.whatIf.delayS, text: text });
    }
    return { ok: true, response: response || null, whatIf: whatIf, openTab: (op.outcome && op.outcome.openTab) || null, failed: r.failed, result: r.result };
  }

  // ---------------------------------------------------------------------------------------------
  // Markets (§5): weekly GBM steps, BitBot rug/moon, bond floor, dividend cuts, crashes + recovery.
  // ---------------------------------------------------------------------------------------------
  function marketWeek(state) {
    const gs = state.gameSeconds;
    const dt = 1 / 52;
    for (let i = 0; i < INV.length; i++) {
      const inv = INV[i];
      const mk = state.market[inv.id];
      const h = state.investments[inv.id];
      const mu = inv.mu + (mk.recoverUntil > gs ? C.CRASH_RECOVER_DRIFT : 0);
      const z = gaussian(state);
      mk.price *= Math.exp((mu - inv.sigma * inv.sigma / 2) * dt + inv.sigma * Math.sqrt(dt) * z);
      if (inv.rugPull) {
        const x = API.rng(state);
        if (x < inv.rugPull.chancePerWeek) {
          mk.price *= inv.rugPull.factor;
          if (h.units > 0) { state.flags.bitbotCrater = true; toast(state, 'BITBOT RUG PULL −' + Math.round((1 - inv.rugPull.factor) * 100) + '%', 'warn'); }
        } else if (x < inv.rugPull.chancePerWeek + inv.moon.chancePerWeek) {
          mk.price *= inv.moon.factor;
          if (h.units > 0) { state.flags.bitbotMoon = true; toast(state, 'BITBOT TO THE MOON +' + Math.round((inv.moon.factor - 1) * 100) + '%', 'money'); }
        }
      }
      if (inv.floor) mk.price = Math.max(mk.price, inv.start * inv.floor);
      if (inv.dividendCut && API.rng(state) < inv.dividendCut.chancePerYear / 52 && mk.cutUntil <= gs) {
        mk.cutUntil = gs + inv.dividendCut.years * C.SEC_PER_YEAR;
        if (h.units > 0) toast(state, inv.ticker + ' CUTS ITS DIVIDEND TO ' + (inv.dividendCut.yield * 100) + '% FOR A YEAR', 'warn');
      }
      mk.history.push(mk.price);
      if (mk.history.length > 52) mk.history.shift();
      if (mk.heldSinceCrash && mk.preCrash > 0 && mk.price >= mk.preCrash) {
        mk.heldSinceCrash = false;
        if (h.units > 0) state.flags.diamondHands = true;
      }
    }
  }
  function startCrash(state) {
    const gs = state.gameSeconds;
    const soft = state.mods.crashSofter;
    state.crash.count += 1;
    state.crash.until = gs + 60;
    state.crash.dipUntil = gs + C.DIP_WINDOW_S;
    state.crash.nextAt = gs + rand(state, C.CRASH_MIN_S, C.CRASH_MAX_S);
    state.crash.active = true;
    for (let i = 0; i < INV.length; i++) {
      const inv = INV[i];
      if (inv.immuneToCrash) continue;
      const mk = state.market[inv.id];
      mk.preCrash = mk.price;
      mk.price *= 1 - inv.crash * soft;
      mk.recoverUntil = gs + C.CRASH_RECOVER_YEARS * C.SEC_PER_YEAR;
      mk.heldSinceCrash = state.investments[inv.id].units > 0;
      mk.history.push(mk.price);
      if (mk.history.length > 52) mk.history.shift();
    }
    push(state, { type: 'crash', factor: INV[0].crash * soft });
    push(state, { type: 'dipWindow', until: state.crash.dipUntil });
    toast(state, 'MARKET CRASH! B500 −' + Math.round(INV[0].crash * soft * 100) + '%. BONDS UNTOUCHED. BUY THE DIP: 20 s', 'warn');
  }

  // ---------------------------------------------------------------------------------------------
  // Month and year ends (§2, §5, §7): inflation, the rat-race meter, dividends paid, health rolls,
  // repossession, yearly bookkeeping.
  // ---------------------------------------------------------------------------------------------
  function monthEnd(state, offline) {
    const gs = state.gameSeconds;
    const m = state.mods;
    state.calendar.month += 1;
    state.inflationMult *= Math.pow(1 + m.inflation, 1 / 12);
    const d = core(state, {});
    // The rat race (Cashflow board game): passive >= 1.25 x expenses for 3 months, no bad debt.
    if (!state.flags.ratRaceExit && state.chapter >= C.RAT_RACE_FROM_CHAPTER) {
      if (state.debt <= 0 && d.freedomRatio >= C.RAT_RACE_RATIO) state.flags.ratRaceMonths += 1;
      else state.flags.ratRaceMonths = 0;
      if (state.flags.ratRaceMonths >= C.RAT_RACE_MONTHS) {
        state.flags.ratRaceExit = true;
        state.flags.ratRaceExitAt = gs;
        push(state, { type: 'ratRaceExit' });
        say(state, 'mainframe', special('mainframe', 'ratRaceExit'), 6000);
        toast(state, "YOU'RE OUT OF THE RAT RACE! FAST TRACK UNLOCKED.", 'gold');
      }
    }
    if (state.flags.divThisMonth > 0) { state.stats.dividendPayouts += 1; state.flags.divThisMonth = 0; }
    // Repossession: a Bot-Bank loan plus overdrafts at 3 consecutive month-ends.
    if (state.loan > 0 && state.flags.overdraftThisMonth > 0) {
      state.flags.negMonths += 1;
      if (state.flags.negMonths >= C.REPO_MONTHS) { repossess(state, state.flags.overdraftThisMonth * C.REPO_SELL_MULT); state.flags.negMonths = 0; }
    } else state.flags.negMonths = 0;
    state.flags.overdraftThisMonth = 0;
    // Health rolls (never while away, never after the ending).
    if (!offline && !state.ending) {
      const fluP = (C.BOTFLU_BASE + C.BOTFLU_HEALTH_SCALE * (1 - state.health / 100)) * m.fluChanceMult;
      if (API.rng(state) < fluP) {
        const costFlu = C.BOTFLU_EXPENSE_MONTHS * d.expensesMonthly * m.fluCostMult;
        state.cash -= costFlu;
        state.health = Math.max(0, state.health + C.BOTFLU_HEALTH);
        state.flags.botFlus += 1;
        say(state, 'doc', special('doc', 'flu'), 5000);
        toast(state, 'BOT-FLU: −' + fmtMoney(costFlu) + ', −5 health', 'warn');
      }
      if (API.rng(state) < C.SECONDWIND_CHANCE * state.health / 100) {
        state.lifespan = Math.min(C.MAX_AGE, state.lifespan + 1);
        say(state, 'doc', special('doc', 'secondWind'), 5000);
        toast(state, 'SECOND WIND: +1 year', 'gold');
      }
      if (state.health < C.CRITICAL_HEALTH && API.rng(state) < C.SHUTDOWN_CHANCE_MONTH) die(state, 'shutdown');
    }
    if (state.flags.quitEarlyAt > NEG_INF && !state.flags.iQuitTooEarly && gs - state.flags.quitEarlyAt >= 12 * C.SEC_PER_MONTH) state.flags.iQuitTooEarly = true;
    // Year end.
    if (state.calendar.month % 12 === 0) {
      state.calendar.year += 1;
      state.job.shiftsThisYear = 0;
      if (state.chapter >= 4 && !offline) say(state, 'landlord', special('landlord', 'rentUp'), 3500);
    }
    push(state, { type: 'monthEnd', summary: { passive: d.passiveMonthly, expenses: d.expensesMonthly, net: d.passiveMonthly - d.expensesMonthly, month: state.calendar.month } });
  }
  function repossess(state, shortfall) {
    let raised = 0;
    for (let i = BIZ.length - 1; i >= 0 && raised < shortfall; i--) {
      const b = BIZ[i];
      const e = state.businesses[b.id];
      while (e.owned > 0 && raised < shortfall) {
        const unitBook = e.spent / e.owned;
        e.owned -= 1; e.spent -= unitBook;
        raised += unitBook;
      }
    }
    state.loan = Math.max(0, state.loan - raised);
    push(state, { type: 'toast', text: 'REPOSSESSION: Bot-Bank sold ' + fmtMoney(raised) + ' of your businesses', kind: 'warn' });
    say(state, 'repo', special('repo', 'forklift'), 5000);
  }

  // ---------------------------------------------------------------------------------------------
  // Death, escape and prestige (§11)
  // ---------------------------------------------------------------------------------------------
  function wisdomForRun(state, ending) {
    const base = Math.floor(4 * Math.log10(1 + Math.max(0, state.stats.lifetimeEarned) / 1000));
    const mult = ending === 'escaped' ? C.WISDOM_MULT_ESCAPED : ending === 'free' ? C.WISDOM_MULT_DIED_FREE : C.WISDOM_MULT_WAGESLAVE;
    return Math.floor(base * mult) + (ending === 'escaped' ? C.ESCAPE_WISDOM_BONUS : 0);
  }
  function die(state, cause) {
    if (state.ending) return;
    state.ending = state.flags.ratRaceExit ? 'free' : 'wageslave';
    state.flags.deathAt = state.gameSeconds;
    state.flags.deathCause = cause;
    state.pendingWisdom = wisdomForRun(state, state.ending);
    state.events.pending = null;
    if (state.ending === 'wageslave') grant(state, 'died_a_wage_slave');
    push(state, { type: 'death', ending: state.ending, cause: cause });
  }
  function rankFor(age) {
    const ranks = Data.ENDINGS.escaped.ranks;
    for (let i = 0; i < ranks.length; i++) if (age < ranks[i].maxAge) return ranks[i];
    return ranks[ranks.length - 1];
  }
  function canEscape(state) {
    const d = core(state, SCRATCH);
    if (state.ending) return { ok: false, toll: d.exitToll, reason: state.ending === 'escaped' ? 'already escaped' : 'game over' };
    if (!state.flags.ratRaceExit) return { ok: false, toll: d.exitToll, reason: 'get out of the rat race first' };
    if (!d.outOfRatRaceNow) return { ok: false, toll: d.exitToll, reason: 'passive income must cover expenses (and no bad debt)' };
    if (state.cash < d.exitToll) return { ok: false, toll: d.exitToll, reason: 'need ' + fmtMoney(d.exitToll - state.cash) + ' more' };
    return { ok: true, toll: d.exitToll, reason: '' };
  }
  function escape(state, now) {
    const c = canEscape(state);
    if (!c.ok) return c;
    state.cash -= c.toll;
    state.ending = 'escaped';
    state.flags.escapedAt = state.gameSeconds;
    state.events.pending = null;
    state.pendingWisdom = wisdomForRun(state, 'escaped');
    const d = core(state, {});
    checkAchievements(state, d);
    const rank = rankFor(state.age);
    state.flags.rank = rank.name;
    push(state, { type: 'escape', rank: rank.name, age: state.age });
    return { ok: true, toll: c.toll, wisdom: state.pendingWisdom, rank: rank.name, age: state.age };
  }
  // Start the next life. Wisdom, achievements, settings and the hall of runs carry over; an
  // escape raises the loop (toll x3, Repo-Tron 15%), a death does not.
  function rebirth(state, now) {
    const wisdom = (state.wisdom || 0) + (state.pendingWisdom || 0);
    const ghost = {};
    let anyGhost = false;
    for (let i = 0; i < BIZ.length; i++) { const n = state.businesses[BIZ[i].id].owned; if (n > 0) { ghost[BIZ[i].id] = n; anyGhost = true; } }
    const run = state.ending === 'escaped' ? state.run + 1 : state.run;
    const seed = (Math.imul(state.seed >>> 0, 1664525) + 1013904223 + (state.attempt || 1)) >>> 0;
    const s = newState(now, { run: run, wisdom: wisdom, name: state.name, ghost: anyGhost ? ghost : null, seed: seed });
    s.attempt = (state.attempt || 1) + 1;
    s.achievements = Object.assign({}, state.achievements);
    s.settings = Object.assign({}, state.settings || {});
    s.hall = (state.hall || []).concat([{
      attempt: state.attempt || 1, run: state.run, ending: state.ending || 'abandoned', age: Math.floor(state.age),
      peakNetWorth: state.stats.peakNetWorth, wisdom: state.pendingWisdom || 0, rank: state.flags.rank || null,
    }]).slice(-12);
    recompute(s);
    return s;
  }
  function dieAndRestart(state, now) {
    if (!state.ending) die(state, 'restart');
    return rebirth(state, now);
  }

  // ---------------------------------------------------------------------------------------------
  // tick(state, dtMs, now) — the simulation step. Timers are in game seconds (see header).
  // ---------------------------------------------------------------------------------------------
  const TICKD = {};
  const AMBIENT_BY_CHAPTER = [
    ['repo', 'mainframe', 'glitch'],
    ['supe', 'res', 'glitch', 'mainframe'],
    ['glitch', 'supe', 'res', 'repo'],
    ['dan', 'landlord', 'glitch', 'doc', 'supe'],
    ['glitch', 'res', 'dan', 'doc', 'supe'],
    ['glitch', 'landlord', 'dan', 'doc', 'res'],
    ['glitch', 'mainframe', 'dan', 'doc', 'res'],
    ['maya', 'glitch', 'mainframe', 'doc'],
  ];
  function autoClick(state, d) {
    const v = d.clickValue;
    if (v <= 0) return;
    const job = jobOf(state);
    creditIncome(state, 'clicks', v, job ? v / Math.max(1e-9, 1 - d.taxJob) : v);
    if (job) { state.job.shifts += 1; state.job.totalShifts += 1; state.job.shiftsThisYear += 1; state.stats.shifts += 1; }
  }
  function autobuyStep(state, d) {
    if (!state.mods.autobuy) return;
    const cushion = C.AUTOBUY_CUSHION_S * Math.max(0, d.passivePerSec);
    for (let i = 0; i < BIZ.length; i++) {
      const b = BIZ[i];
      const e = state.businesses[b.id];
      if (!e.auto || fastTrackLocked(state, b)) continue;
      const budget = state.cash - cushion;
      if (budget <= 0) return;
      const n = maxAffordable(b, e.owned, budget / priceDiscount(state));
      if (n > 0) buy(state, b.id, n);
    }
  }
  function tick(state, dtMs, now) {
    if (!state || state.ending === 'wageslave' || state.ending === 'free') return;
    if (!state.mods) recompute(state);
    dtMs = Math.max(0, Number(dtMs) || 0);
    if (dtMs <= 0) return;
    const dt = dtMs / 1000;
    state.playMs += dtMs;
    if (typeof now === 'number') state.lastSeen = now;
    advance(state, dt, false);
  }
  // advance: shared by tick() and applyOffline(). `offline` skips income (credited separately),
  // random world events, the event deck and death rolls.
  function advance(state, dt, offline) {
    const m = state.mods;
    const gs0 = state.gameSeconds;
    state.gameSeconds += dt;
    const gs = state.gameSeconds;
    if (state.ending !== 'escaped') state.age += dt / C.SEC_PER_YEAR;
    state.heat = Math.max(0, state.heat - C.HEAT_DECAY_PER_SEC * dt);
    // health drifts continuously (smog, age, housing, gym ...); the month end rolls the dice on it
    if (!state.ending) state.health = Math.max(0, Math.min(100, state.health + healthDriftPerYear(state) * dt / C.SEC_PER_YEAR));
    let d = core(state, TICKD);

    // income
    if (!offline) {
      if (m.autoClicks > 0 && state.burnoutUntil <= gs && state.clickLossUntil <= gs) {
        state.autoAcc = (state.autoAcc || 0) + m.autoClicks * dt;
        let guard = 64;
        while (state.autoAcc >= 1 && guard-- > 0) { state.autoAcc -= 1; autoClick(state, d); }
      }
      if (d.bizNetPerSec > 0) creditIncome(state, 'business', d.bizNetPerSec * dt, d.bizGrossPerSec * dt);
      if (d.dividendPerSec > 0) {
        const amt = d.dividendPerSec * dt;
        state.flags.divThisMonth += amt;
        if (state.drip) dripReinvest(state, amt);
        else creditIncome(state, 'dividends', amt, amt / Math.max(1e-9, 1 - d.taxDiv));
      }
    }
    // expenses (rent, upkeep, existence tax, interest) drain per tick; the month end only summarises
    const interestPerSec = (state.debt * state.debtApr + state.loan * state.loanApr) / 12 / C.SEC_PER_MONTH;
    state.cash -= d.expensesPerSec * dt;
    state.stats.interestPaid += interestPerSec * dt;
    state.stats.upkeepPaid += d.livingPerSec * dt;
    settleOverdraft(state);

    // calendar: weeks (markets) and months
    const w0 = Math.floor(gs0 / C.SEC_PER_WEEK), w1 = Math.floor(gs / C.SEC_PER_WEEK);
    for (let w = w0; w < w1; w++) marketWeek(state);
    const m0 = Math.floor(gs0 / C.SEC_PER_MONTH), m1 = Math.floor(gs / C.SEC_PER_MONTH);
    for (let k = m0; k < m1; k++) monthEnd(state, offline);
    if (state.ending === 'wageslave' || state.ending === 'free') return;

    d = core(state, TICKD);
    if (!offline) {
      // Golden Bot
      if (state.glitch.activeUntil > 0 && gs >= state.glitch.activeUntil) { state.glitch.activeUntil = 0; push(state, { type: 'glitchGone' }); }
      if (state.chapter >= 2 && gs >= state.glitch.nextAt && state.glitch.activeUntil <= gs && !state.ending) {
        state.glitch.activeUntil = gs + C.GLITCH_DURATION_S;
        state.glitch.nextAt = gs + rand(state, C.GLITCH_MIN_S, C.GLITCH_MAX_S);
        push(state, { type: 'glitch', activeUntil: state.glitch.activeUntil });
      }
      // Market crashes, once you own paper assets
      if (ownedInvestments(state) && state.crash.nextAt === 0) state.crash.nextAt = gs + rand(state, C.CRASH_MIN_S, C.CRASH_MAX_S);
      if (state.crash.nextAt > 0 && gs >= state.crash.nextAt && state.crash.until <= gs) startCrash(state);
      if (state.crash.active && state.crash.until <= gs) {
        state.crash.active = false;
        state.stats.crashesSurvived += 1;
        push(state, { type: 'crashOver' });
      }
      // what-if follow-ups
      for (let i = state.whatIfs.length - 1; i >= 0; i--) {
        if (gs >= state.whatIfs[i].at) { push(state, { type: 'whatif', text: state.whatIfs[i].text }); state.whatIfs.splice(i, 1); }
      }
      // choice events
      scheduleEvents(state, d);
      // autobuy once a second
      if (Math.floor(gs) !== Math.floor(gs0)) autobuyStep(state, d);
    }

    // flags feeding lessons / achievements
    const f = state.flags;
    if (!f.bitbotVisible && investTabUnlocked(state) && evalCond(state, d, Data.byId['investment:bitbot'].unlock)) f.bitbotVisible = true;
    if (!f.passiveBeatClicks && state.job.id && ownedTotal(state) > 0 && d.passivePerSec > d.clickValue * 3) f.passiveBeatClicks = true;
    if (f.debtEver && state.debt === 0 && !f.debtFree) {
      f.debtFree = true;
      push(state, { type: 'debtPaid' });
      say(state, 'repo', special('repo', 'paidOff'), 6000);
    }
    if (state.chapter >= 3 && !offline) {
      const cheap = cheapestAffordableCost(state, d);
      if (cheap < Infinity && state.cash >= 20 * cheap) { if (f.idleCashSince === NEG_INF) f.idleCashSince = gs; }
      else f.idleCashSince = NEG_INF;
    }
    if (d.netWorth > state.stats.peakNetWorth) state.stats.peakNetWorth = d.netWorth;

    // chapters: one step at a time, at least 15 s apart so each scene lands
    if (!state.ending && gs - (f.chapterAt || 0) >= 15 && state.chapter < Data.CHAPTERS.length) {
      const next = Data.CHAPTERS[state.chapter];
      if (evalCond(state, d, next.unlock)) {
        state.chapter += 1;
        f.chapterAt = gs;
        push(state, { type: 'chapter', chapter: state.chapter });
      }
    }
    checkLessons(state, d);
    checkAchievements(state, d);

    // warnings and ambient chatter
    if (!state.ending && !offline) {
      const yl = state.lifespan - state.age;
      if (yl <= 10 && !f.tenYearsWarned) { f.tenYearsWarned = true; say(state, 'doc', special('doc', 'tenYears'), 6000); }
      if (yl <= 1 && !f.lookUpWarned) { f.lookUpWarned = true; say(state, 'glitch', special('glitch', 'lookUp'), 6000); }
      if (state.health < C.CRITICAL_HEALTH) {
        if (!f.criticalWarned) { f.criticalWarned = true; say(state, 'doc', special('doc', 'critical'), 6000); toast(state, 'HEALTH CRITICAL: visit the Medbay (LIFE tab)', 'warn'); }
      } else f.criticalWarned = false;
      if (gs >= (f.nextAmbientAt || 30)) {
        f.nextAmbientAt = gs + rand(state, 40, 75);
        const cast = AMBIENT_BY_CHAPTER[Math.min(7, state.chapter - 1)];
        let who = cast[Math.floor(API.rng(state) * cast.length) % cast.length];
        if (who === 'repo' && state.debt <= 0) who = 'glitch';
        const lines = Data.CHARACTERS[who].lines;
        say(state, who, lines[Math.floor(API.rng(state) * lines.length) % lines.length], 4500);
      }
      // rolling 30 s income split (for the LEDGER bar)
      if (gs - state.split.since >= 30) {
        const sp = state.split;
        sp.lastClicks = sp.clicks; sp.lastBusiness = sp.business; sp.lastDividends = sp.dividends;
        sp.clicks = 0; sp.business = 0; sp.dividends = 0; sp.since = gs;
      }
    }
    if (!state.ending && state.age >= state.lifespan) die(state, 'age');
  }
  function dripReinvest(state, amt) {
    // Reinvest into the assets that paid, pro rata to their dividend.
    let tot = 0;
    for (let i = 0; i < INV.length; i++) { const inv = INV[i]; const h = state.investments[inv.id]; if (h.units > 0) tot += h.units * state.market[inv.id].price * investYield(state, inv); }
    if (tot <= 0) return;
    for (let i = 0; i < INV.length; i++) {
      const inv = INV[i]; const h = state.investments[inv.id];
      if (h.units <= 0) continue;
      const share = h.units * state.market[inv.id].price * investYield(state, inv) / tot;
      if (share <= 0) continue;
      const cashPart = amt * share;
      h.units += cashPart / state.market[inv.id].price; h.basis += cashPart;
    }
    state.stats.lifetimeEarned += amt; state.stats.divEarned += amt; state.split.dividends += amt;
  }

  // ---------------------------------------------------------------------------------------------
  // Offline progress (§7). Businesses earn at the offline rate for up to the cap; you age at a
  // quarter of the normal rate, at most 2 years and never into your last year.
  // ---------------------------------------------------------------------------------------------
  const OFFLINE_AGE_CAP_YEARS = 2;
  function applyOffline(state, now) {
    if (!state || typeof now !== 'number' || typeof state.lastSeen !== 'number') return null;
    if (!state.mods) recompute(state);
    const elapsed = (now - state.lastSeen) / 1000;
    state.lastSeen = now;
    if (!(elapsed >= 60) || (state.ending && state.ending !== 'escaped')) return null;
    const m = state.mods;
    const secs = Math.min(elapsed, m.offlineCapH * 3600);
    const d = core(state, {});
    const cashBefore = state.cash - state.debt;
    const earnedBiz = Math.max(0, d.bizNetPerSec) * secs * m.offlineBizEff;
    const earnedDiv = Math.max(0, d.dividendPerSec) * secs * m.offlineEff;
    const earned = earnedBiz + earnedDiv;
    if (earnedBiz > 0) creditIncome(state, 'business', earnedBiz, earnedBiz / Math.max(1e-9, 1 - d.taxBiz));
    if (earnedDiv > 0) creditIncome(state, 'dividends', earnedDiv, earnedDiv / Math.max(1e-9, 1 - d.taxDiv));
    state.stats.offlineEarned += earned;
    // game time that passes while away (drives aging, rent and markets)
    const room = state.ending === 'escaped' ? OFFLINE_AGE_CAP_YEARS : Math.max(0, state.lifespan - 1 - state.age);
    const G = Math.min(secs * C.OFFLINE_AGE_RATE, OFFLINE_AGE_CAP_YEARS * C.SEC_PER_YEAR, room * C.SEC_PER_YEAR);
    const ageBefore = state.age;
    let left = G;
    while (left > 1e-9) { const step = Math.min(1, left); advance(state, step, true); left -= step; }
    const spent = Math.max(0, cashBefore + earned - (state.cash - state.debt));
    const res = { seconds: secs, elapsed: elapsed, earned: earned, spent: spent, yearsAged: state.age - ageBefore, gameSeconds: G };
    push(state, { type: 'offline', summary: res });
    return res;
  }

  // ---------------------------------------------------------------------------------------------
  // Save / load (§12.3). JSON, versioned; missing fields are filled from a fresh state so older
  // saves keep working, and garbage is rejected.
  // ---------------------------------------------------------------------------------------------
  function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function deepFill(target, template) {
    for (const k in template) {
      if (!Object.prototype.hasOwnProperty.call(template, k)) continue;
      const tv = template[k];
      if (target[k] === undefined || (typeof tv === 'number' && typeof target[k] === 'number' && !Number.isFinite(target[k]))) {
        target[k] = isPlainObject(tv) || Array.isArray(tv) ? JSON.parse(JSON.stringify(tv)) : tv;
      } else if (isPlainObject(tv) && isPlainObject(target[k])) {
        deepFill(target[k], tv);
      }
    }
    return target;
  }
  function save(state) {
    const q = state.queue, mods = state.mods;
    state.queue = []; state.mods = null;
    let s;
    try { s = JSON.stringify(state); } finally { state.queue = q; state.mods = mods; }
    return s;
  }
  function load(str, now) {
    let o;
    try { o = typeof str === 'string' ? JSON.parse(str) : null; } catch (e) { return null; }
    if (!isPlainObject(o) || o.v !== 1 || typeof o.cash !== 'number' || !Number.isFinite(o.cash) || !isPlainObject(o.businesses) || !isPlainObject(o.stats)) return null;
    const template = newState(typeof now === 'number' ? now : 0, { seed: typeof o.seed === 'number' ? o.seed : 1, run: o.run || 1 });
    template.queue = [];
    deepFill(o, template);
    o.queue = [];
    o.mods = null;
    if (!Data.byId['housing:' + o.housing]) o.housing = 'cardboard';
    if (o.job.id && !Data.byId['job:' + o.job.id]) o.job.id = null;
    o.chapter = Math.max(1, Math.min(Data.CHAPTERS.length, o.chapter | 0));
    recompute(o);
    return o;
  }

  // ---------------------------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------------------------
  Object.assign(API, {
    rng: rng,
    newState: newState, tick: tick, derive: derive, click: click,
    takeJob: takeJob, quitJob: quitJob, setHousing: setHousing,
    buy: buy, quote: quote, setAutobuy: setAutobuy, buyUpgrade: buyUpgrade, upgradePrice: function (state, id) { const U = Data.byId['upgrade:' + id]; return U ? upgradePrice(state, U) : Infinity; },
    buyHealth: buyHealth, medbay: medbay, activatePowerup: activatePowerup,
    investBuy: investBuy, investSell: investSell, setDrip: setDrip,
    payDebt: payDebt, takeLoan: takeLoan, repayLoan: repayLoan,
    buyDoodad: buyDoodad, sellDoodad: sellDoodad,
    answerEvent: answerEvent, readLesson: readLesson, collectGlitch: collectGlitch,
    markSeen: markSeen, openTab: openTab,
    canEscape: canEscape, escape: escape, rebirth: rebirth, dieAndRestart: dieAndRestart, newGamePlus: rebirth,
    applyOffline: applyOffline, save: save, load: load,
    chapterFor: chapterFor, evalCond: function (state, c) { return evalCond(state, core(state, {}), c); },
    wisdomForRun: wisdomForRun, rankFor: rankFor,
    fmt: fmt, fmtMoney: fmtMoney, fmtTime: fmtTime, fmtPct: fmtPct, subst: subst,
    cost: cost, bulkCost: bulkCost, maxAffordable: maxAffordable, milestoneMult: milestoneMult, nextMilestoneCount: nextMilestoneCount,
    recompute: recompute,
    _internal: { core: core, monthEnd: monthEnd, marketWeek: marketWeek, startCrash: startCrash, die: die, advance: advance, heatTierOf: heatTierOf, ownedTotal: ownedTotal },
  });
  root.Engine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
