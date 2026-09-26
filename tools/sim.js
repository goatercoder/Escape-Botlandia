/* tools/sim.js — headless balance simulation: plays the real Engine with scripted policies.
 *   node tools/sim.js            prints the pacing table for greedy / grinder / idle
 *   require('./tools/sim.js').run('greedy', { seed, maxMinutes, tickMs })
 * Policies (docs/SPEC.md §15):
 *   greedy  — clicks 3/s while heat < 88, takes promotions, buys the best-payback thing it can,
 *             pays debt when that is the best payback, buys health when time runs short, escapes ASAP.
 *   grinder — clicks and takes every promotion, buys health and Medbay, never buys a business.
 *   idle    — plays like greedy for 5 minutes, then never clicks again (still buys).
 */
'use strict';
const path = require('path');
const Data = require(path.join(__dirname, '..', 'data.js'));
const Engine = require(path.join(__dirname, '..', 'engine.js'));

const LEGIT_HEALTH = Data.HEALTH_ITEMS.filter((h) => !h.scam);

function chooseOption(s, d, policy) {
  const pe = d.pendingEvent;
  if (!pe) return null;
  const ev = Data.byId['event:' + pe.id];
  const visible = pe.options.filter((o) => o.visible);
  if (pe.id === 'promotion') {
    const neg = visible.find((o) => ev.options[o.index].best);
    return neg ? neg.index : 0; // greedy and grinder take promotions
  }
  const best = visible.find((o) => ev.options[o.index].best);
  if (best) {
    // Doc's Nano-Kale needs $5k; the "best" flag already respects requires via `visible`.
    return best.index;
  }
  return visible.length ? visible[0].index : 0;
}

function candidates(s, d, policy) {
  const out = [];
  if (policy !== 'grinder') {
    for (const b of d.businesses) {
      if (!b.unlocked || b.fastTrackLocked) continue;
      const q = Engine.quote(s, b.id, 1);
      if (q.incomeGain > 0) out.push({ kind: 'biz', id: b.id, price: q.total, payback: q.total / q.incomeGain });
      const B = Data.byId['business:' + b.id];
      for (const U of B.upgrades) {
        if (b.level === U.level - 1 && b.owned >= U.requires && b.netPerSec > 0) {
          out.push({ kind: 'upg', id: U.id, price: U.cost, payback: U.cost / (b.netPerSec * 0.5) });
        }
      }
    }
    for (const U of Data.UPGRADES) {
      if (s.upgrades[U.id] || (U.requires && !s.upgrades[U.requires])) continue;
      const price = Engine.upgradePrice(s, U.id);
      let gain = 0;
      if (U.effect.autoClicksPerSec) gain = (U.effect.autoClicksPerSec - s.mods.autoClicks) * d.clickValue;
      else if (U.effect.critChance) gain = (U.effect.critChance - s.mods.critChance) * (s.mods.critMult - 1) * d.clickValue * 1.5;
      else if (U.effect.critMult) gain = s.mods.critChance * (U.effect.critMult - s.mods.critMult) * d.clickValue * 1.5;
      else if (U.effect.taxPoints) gain = 0.03 * d.bizGrossPerSec;
      else if (U.effect.bizDiscount) gain = 0.03 * d.bizNetPerSec; // rough: cheaper future buys
      if (gain > 0) out.push({ kind: 'sys', id: U.id, price, payback: price / gain });
    }
    if (s.debt > 0 && s.mods) {
      const perSec = s.debtApr / 12 / Data.CONST.SEC_PER_MONTH;
      out.push({ kind: 'debt', id: 'debt', price: Math.min(s.debt, Math.max(1, s.cash)), payback: 1 / perSec * (d.freedomRatio > 0.8 ? 0.2 : 1) });
    }
  }
  out.sort((a, b) => a.payback - b.payback);
  return out;
}

function run(policy, opts) {
  opts = opts || {};
  const tickMs = opts.tickMs || 250;
  const maxMin = opts.maxMinutes || 240;
  const cps = opts.cps || 3;
  const s = opts.state || Engine.newState(0, { seed: opts.seed || 12345, wisdom: opts.wisdom || 0, run: opts.run || 1 });
  const log = { policy, firstBuy: {}, chapters: {}, events: [], ratRaceExitMin: null, escapeMin: null, deathMin: null, deathAge: null, ending: null };
  let clickAcc = 0;
  let t = 0;
  const maxMs = maxMin * 60000;
  while (t < maxMs) {
    t += tickMs;
    const minutes = t / 60000;
    Engine.tick(s, tickMs, t);
    // drain the UI queue (the sim has no UI)
    for (const ev of s.queue) {
      if (ev.type === 'chapter') log.chapters[ev.chapter] = +minutes.toFixed(1);
      if (ev.type === 'ratRaceExit') log.ratRaceExitMin = +minutes.toFixed(1);
    }
    s.queue.length = 0;
    if (s.ending === 'wageslave' || s.ending === 'free') { log.deathMin = +minutes.toFixed(1); log.deathAge = +s.age.toFixed(1); log.ending = s.ending; break; }

    let d = Engine.derive(s);
    if (opts.timeline && t % 60000 === 0) {
      (log.timeline = log.timeline || []).push({ min: Math.round(minutes), job: s.job.id, housing: s.housing, cash: d.cash, nw: d.netWorth,
        click: d.clickValue, passive: d.passivePerSec, exp: d.expensesPerSec, free: +d.freedomRatio.toFixed(2), ch: s.chapter, age: +s.age.toFixed(1), health: Math.round(s.health), owned: Engine._internal.ownedTotal(s) });
    }
    // lessons
    for (const L of Data.LESSONS) if (s.lessons[L.id] === 'new') Engine.readLesson(s, L.id);
    // tabs (tutorial / lesson triggers)
    for (const tab of d.tabsUnlocked) if (!s.flags.tabsOpened[tab]) Engine.openTab(s, tab);
    // events
    if (d.pendingEvent) {
      const idx = chooseOption(s, d, policy);
      const r = Engine.answerEvent(s, d.pendingEvent.id, idx, t);
      log.events.push(d.pendingEvent.id + ':' + idx + (r.ok ? '' : '!'));
      if (!r.ok) s.events.pending = null;
      d = Engine.derive(s);
    }
    // job
    if (!s.job.id && s.chapter >= 2 && !s.flags.quitDone) Engine.takeJob(s, 'scrap');
    // clicking
    const clicking = policy !== 'idle' || minutes < 5;
    if (clicking && !(s.flags.ratRaceExit && policy === 'greedy' && s.flags.quitDone)) {
      clickAcc += cps * tickMs / 1000;
      while (clickAcc >= 1) {
        clickAcc -= 1;
        if (s.heat < 88 && d.burnoutUntil <= s.gameSeconds) Engine.click(s, t);
      }
    }
    // health
    if (d.health < 30 && s.cash >= d.medbayCost) Engine.medbay(s);
    const needYears = policy === 'grinder' ? d.yearsLeft < 20 : d.yearsLeft < 25;
    for (const H of LEGIT_HEALTH) {
      if (s.healthItems[H.id]) continue;
      if (s.chapter < 4) break;
      if ((needYears && s.cash >= H.cost) || s.cash >= H.cost * 20) Engine.buyHealth(s, H.id);
      break; // in order
    }
    // escape
    if (policy !== 'grinder') {
      const ce = Engine.canEscape(s);
      if (ce.ok) { Engine.escape(s, t); log.escapeMin = +minutes.toFixed(1); log.ending = 'escaped'; log.escapeAge = +s.age.toFixed(1); break; }
      if (s.flags.ratRaceExit && s.job.id && d.passivePerSec > 50 * d.clickValue) { Engine.quitJob(s); s.flags.quitDone = true; }
    }
    // buying (greedy: save up for the best payback; keep 5 s of expenses)
    let guard = 30;
    while (guard-- > 0) {
      d = Engine.derive(s);
      const cands = candidates(s, d, policy);
      if (!cands.length) break;
      const best = cands[0];
      const reserve = d.expensesPerSec * 5;
      if (s.cash - reserve < best.price) break;
      let r;
      if (best.kind === 'biz') { r = Engine.buy(s, best.id, 1); if (r.ok && log.firstBuy[best.id] === undefined) log.firstBuy[best.id] = +minutes.toFixed(1); }
      else if (best.kind === 'upg' || best.kind === 'sys') r = Engine.buyUpgrade(s, best.id);
      else if (best.kind === 'debt') r = Engine.payDebt(s, Math.min(s.debt, s.cash - reserve));
      if (!r || !r.ok) break;
    }
    // pay off debt before trying to exit the rat race
    if (policy !== 'grinder' && s.debt > 0 && d.freedomRatio >= 1 && s.cash > 0) Engine.payDebt(s, s.cash);
  }
  const d = Engine.derive(s);
  log.minutes = +(t / 60000).toFixed(1);
  log.age = +s.age.toFixed(1);
  log.lifespan = +s.lifespan.toFixed(1);
  log.netWorth = d.netWorth;
  log.passivePerSec = d.passivePerSec;
  log.lifetimeEarned = s.stats.lifetimeEarned;
  log.health = +s.health.toFixed(0);
  log.job = s.job.id;
  log.housing = s.housing;
  log.chapter = s.chapter;
  log.freedom = +d.freedomRatio.toFixed(2);
  log.wisdom = s.pendingWisdom || 0;
  log.toll = d.exitToll;
  log.lessonsRead = d.lessonsRead;
  log.achievements = d.achievementsUnlocked;
  log.state = s;
  return log;
}

function report(log) {
  const f = Engine.fmtMoney;
  const lines = [];
  lines.push(`== ${log.policy.toUpperCase()} == ending: ${log.ending || 'none'} at ${log.escapeMin || log.deathMin || log.minutes} min, age ${log.escapeAge || log.deathAge || log.age} (lifespan ${log.lifespan})`);
  lines.push(`   net worth ${f(log.netWorth)}  passive ${f(log.passivePerSec)}/s  earned ${f(log.lifetimeEarned)}  toll ${f(log.toll)}  health ${log.health}  job ${log.job}  housing ${log.housing}  freedom ${log.freedom}`);
  lines.push(`   chapters ${JSON.stringify(log.chapters)}  rat race exit ${log.ratRaceExitMin} min  wisdom +${log.wisdom}  pages ${log.lessonsRead}  achievements ${log.achievements}`);
  lines.push(`   first buys ${JSON.stringify(log.firstBuy)}`);
  const evc = {}; log.events.forEach((e) => { const k = e.split(':')[0]; evc[k] = (evc[k] || 0) + 1; });
  lines.push(`   events ${JSON.stringify(evc)}`);
  return lines.join('\n');
}

module.exports = { run, report };

if (require.main === module) {
  const seeds = (process.argv[2] || '12345').split(',').map(Number);
  for (const seed of seeds) {
    for (const p of ['greedy', 'grinder', 'idle']) {
      const t0 = Date.now();
      const log = run(p, { seed });
      console.log(report(log) + `\n   (seed ${seed}, ${Date.now() - t0} ms)`);
    }
  }
}
