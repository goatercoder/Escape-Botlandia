// Rules tests for engine.js. Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../data.js');
const E = require('../engine.js');
const C = Data.CONST;

const realRng = E.rng;
function fresh(opts) { E.rng = realRng; return E.newState(1000, Object.assign({ seed: 7 }, opts || {})); }
function withRng(values, fn) {
  let i = 0;
  E.rng = (s) => { s.rngCalls++; return values[Math.min(i++, values.length - 1)]; };
  try { return fn(); } finally { E.rng = realRng; }
}
function advance(s, seconds, stepMs) { const st = stepMs || 100; for (let t = 0; t < seconds * 1000; t += st) E.tick(s, st, 0); }
const biz = (id) => Data.byId['business:' + id];
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-6) * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

// ---------------------------------------------------------------- formulas
test('cost and bulkCost follow the geometric series', () => {
  const b = biz('battery');
  near(E.cost(b, 0), 60);
  near(E.cost(b, 1), 69);
  let sum = 0; for (let k = 0; k < 10; k++) sum += E.cost(b, 5 + k);
  near(E.bulkCost(b, 5, 10), sum);
  assert.equal(E.bulkCost(b, 3, 0), 0);
});

test('maxAffordable is the largest count whose bulk cost fits', () => {
  const b = biz('vending');
  for (const cash of [0, 349, 350, 1000, 12345, 1e6]) {
    const n = E.maxAffordable(b, 4, cash);
    assert.ok(E.bulkCost(b, 4, n) <= cash + 1e-6);
    assert.ok(E.bulkCost(b, 4, n + 1) > cash);
  }
});

test('milestones multiply at 10/25/50/100/200 owned', () => {
  assert.equal(E.milestoneMult(9), 1);
  assert.equal(E.milestoneMult(10), 1.5);
  assert.equal(E.milestoneMult(25), 2.25);
  assert.equal(E.milestoneMult(200), 27);
  assert.equal(E.nextMilestoneCount(10), 25);
  assert.equal(E.nextMilestoneCount(250), null);
});

test('formatting covers cents, thousands, suffixes, negatives and time', () => {
  assert.equal(E.fmtMoney(0.4), '$0.40');
  assert.equal(E.fmtMoney(-2000), '-$2,000');
  assert.equal(E.fmtMoney(123456), '$123,456');
  assert.equal(E.fmtMoney(1.234e6), '$1.23M');
  assert.equal(E.fmtMoney(45.6e9), '$45.6B');
  assert.equal(E.fmtMoney(7.89e12), '$7.89T');
  assert.equal(E.fmtMoney(999.9e6), '$1.00B');
  assert.equal(E.fmt(1.5e15), '1.50Qa');
  assert.match(E.fmtMoney(1.23e40), /e40/);
  assert.equal(E.fmtTime(12), '12s');
  assert.equal(E.fmtTime(260), '4m 20s');
  assert.equal(E.fmtTime(3900), '1h 05m');
  assert.equal(E.fmtPct(0.834), '83%');
});

// ---------------------------------------------------------------- new game
test('a new game starts homeless, 18, in debt, with no job', () => {
  const s = fresh();
  const d = E.derive(s);
  assert.equal(s.cash, 0);
  assert.equal(s.debt, C.START_DEBT);
  assert.equal(d.netWorth, -C.START_DEBT);
  assert.equal(s.age, 18);
  assert.equal(s.lifespan, C.BASE_LIFESPAN);
  assert.equal(s.job.id, null);
  assert.equal(d.chapter, 1);
  assert.equal(d.machineForm, 'sign');
  assert.equal(d.avatarStage, 'vagrant');
  assert.deepEqual(d.tabsUnlocked, []);
});

test('the RNG is deterministic for a seed', () => {
  const a = fresh({ seed: 99 }), b = fresh({ seed: 99 });
  const xa = [E.rng(a), E.rng(a), E.rng(a)], xb = [E.rng(b), E.rng(b), E.rng(b)];
  assert.deepEqual(xa, xb);
  assert.ok(xa.every((x) => x >= 0 && x < 1));
});

// ---------------------------------------------------------------- clicking
test('sign clicks pay $1 and unlock chapter 2 after 15 clicks', () => {
  const s = fresh();
  withRng([0.99], () => { for (let i = 0; i < 15; i++) E.click(s, 0); });
  assert.equal(s.stats.signClicks, 15);
  near(s.cash, 13 + 2 * 1.5, 1e-9); // heat is +2 per click: clicks 14 and 15 are already HUSTLIN' (x1.5)
  advance(s, 1);
  assert.equal(s.chapter, 2);
  assert.ok(E.derive(s).tabsUnlocked.includes('work'));
});

test('a paid shift is taxed 35% (earned income)', () => {
  const s = fresh();
  E.takeJob(s, 'scrap');
  const r = withRng([0.99], () => E.click(s, 0));
  near(r.earned, 5 * (1 - C.TAX_JOB));
  assert.equal(s.stats.shifts, 1);
  near(s.stats.taxesPaid, 5 * C.TAX_JOB);
});

test('heat climbs through the tiers and burns out at 100', () => {
  const s = fresh();
  E.takeJob(s, 'scrap');
  withRng([0.99], () => {
    for (let i = 0; i < 13; i++) E.click(s, 0);
    assert.equal(E.derive(s).heatTier, 1);
    for (let i = 0; i < 13; i++) E.click(s, 0);
    assert.equal(E.derive(s).heatTier, 2);
    for (let i = 0; i < 13; i++) E.click(s, 0);
    assert.equal(E.derive(s).heatLabel, 'OVERTIME');
    const h0 = s.health;
    let burned = false;
    for (let i = 0; i < 20 && !burned; i++) burned = E.click(s, 0).burnout;
    assert.ok(burned);
    assert.equal(s.heat, 0);
    assert.equal(s.health, h0 - C.BURNOUT_HEALTH);
    assert.ok(E.click(s, 0).locked);
  });
  assert.ok(s.queue.some((q) => q.type === 'burnout'));
});

test('heat decays over time', () => {
  const s = fresh();
  s.heat = 60;
  advance(s, 2);
  near(s.heat, 60 - 2 * C.HEAT_DECAY_PER_SEC, 1e-6);
});

test('a crit pays x10', () => {
  const s = fresh();
  E.takeJob(s, 'scrap');
  const r = withRng([0.0], () => E.click(s, 0));
  assert.ok(r.crit);
  near(r.earned, 5 * (1 - C.TAX_JOB) * C.CRIT_MULT);
});

// ---------------------------------------------------------------- jobs and housing
test('promotion needs shifts and the certificate, and mandates housing', () => {
  const s = fresh();
  E.takeJob(s, 'scrap');
  assert.equal(E.takeJob(s, 'captcha').ok, false);
  s.job.shifts = Data.byId['job:scrap'].shiftsToNext;
  s.cash = 10000;
  const r = E.takeJob(s, 'captcha');
  assert.ok(r.ok);
  assert.equal(s.job.id, 'captcha');
  assert.equal(s.housing, 'sleeping');
  near(s.cash, 10000 - Data.byId['job:captcha'].certCost);
  assert.equal(E.setHousing(s, 'cardboard').ok, false, 'cannot go below the mandate');
  assert.ok(E.setHousing(s, 'micro').ok);
});

test('quitting lifts the mandate and turns clicks into Hands-On Owner', () => {
  const s = fresh();
  E.takeJob(s, 'scrap');
  E.quitJob(s);
  assert.equal(s.job.id, null);
  const d = E.derive(s);
  assert.equal(d.clickValue, C.HANDS_ON_MIN);
  assert.ok(E.setHousing(s, 'cardboard').ok === false); // already there
});

test('rent only starts once you are employed or in chapter 2', () => {
  const s = fresh();
  const before = E.derive(s).expensesMonthly;
  E.takeJob(s, 'scrap');
  const after = E.derive(s).expensesMonthly;
  near(after - before, Data.byId['housing:cardboard'].rent);
});

// ---------------------------------------------------------------- businesses
test('buying a business spends cash, adds income and emits events', () => {
  const s = fresh();
  s.cash = 1000;
  const r = E.buy(s, 'battery', 1);
  assert.ok(r.ok);
  near(s.cash, 1000 - 60);
  const d = E.derive(s);
  near(d.bizGrossPerSec, 0.4);
  near(d.bizNetPerSec, 0.4 * (1 - C.TAX_BIZ));
  assert.ok(s.queue.some((q) => q.type === 'purchase' && q.businessId === 'battery'));
});

test('buy max uses exactly the affordable count', () => {
  const s = fresh();
  s.cash = 5000;
  const q = E.quote(s, 'battery', 'max');
  const r = E.buy(s, 'battery', 'max');
  assert.equal(r.bought, q.count);
  assert.ok(s.cash >= 0 && s.cash < E.cost(biz('battery'), q.count));
});

test('crossing 10 owned fires a milestone and a temporary x2 boost', () => {
  const s = fresh();
  s.cash = 1e6;
  E.buy(s, 'battery', 10);
  assert.ok(s.queue.some((q) => q.type === 'milestone' && q.count === 10));
  const d = E.derive(s);
  near(d.bizGrossPerSec, 0.4 * 10 * 1.5 * C.MILESTONE_BOOST_MULT);
});

test('business upgrades need the owned count and multiply income x1.5', () => {
  const s = fresh();
  s.cash = 1e6;
  E.buy(s, 'battery', 4);
  assert.equal(E.buyUpgrade(s, 'battery_u1').ok, false);
  E.buy(s, 'battery', 1);
  assert.ok(E.buyUpgrade(s, 'battery_u1').ok);
  near(E.derive(s).bizGrossPerSec, 0.4 * 5 * 1.5);
});

test('Fast Track businesses are locked until you leave the rat race', () => {
  const s = fresh();
  s.cash = 1e9;
  assert.equal(E.buy(s, 'drones', 1).ok, false);
  s.flags.ratRaceExit = true;
  assert.ok(E.buy(s, 'drones', 1).ok);
});

test('the L04 page makes the next business half price', () => {
  const s = fresh();
  s.lessons.L04 = 'new';
  E.readLesson(s, 'L04');
  s.cash = 100;
  const q = E.quote(s, 'battery', 1);
  near(q.total, 30);
  E.buy(s, 'battery', 1);
  near(s.cash, 70);
  near(E.quote(s, 'battery', 1).total, 69);
});

// ---------------------------------------------------------------- money flow
test('expenses drain per tick and overdrafts become Repo-Tron debt', () => {
  const s = fresh();
  const d0 = s.debt;
  advance(s, C.SEC_PER_MONTH);
  assert.equal(s.cash, 0);
  assert.ok(s.debt > d0);
  assert.ok(s.flags.overdrafts >= 1);
});

test('debt interest is part of expenses and grows with the balance', () => {
  const s = fresh();
  const e1 = E.derive(s).expensesMonthly;
  s.debt *= 2;
  const e2 = E.derive(s).expensesMonthly;
  near(e2 - e1, C.START_DEBT * C.DEBT_APR / 12);
});

test('paying off debt fires debtPaid and the debt_free achievement', () => {
  const s = fresh();
  s.cash = 5000;
  E.payDebt(s, 5000);
  assert.equal(s.debt, 0);
  assert.ok(s.queue.some((q) => q.type === 'debtPaid'));
  advance(s, 0.2);
  assert.ok(s.achievements.debt_free);
});

test('Bot-Bank loans need L11 and are capped at half the book value', () => {
  const s = fresh();
  s.cash = 100000;
  E.buy(s, 'laundro', 10);
  assert.equal(E.takeLoan(s, 1000).ok, false);
  s.lessons.L11 = 'new'; E.readLesson(s, 'L11');
  const book = E.derive(s).bookValue;
  const r = E.takeLoan(s, 1e12);
  assert.ok(r.ok);
  near(r.amount, book * C.LOAN_CAPACITY_RATIO);
  assert.equal(s.loanApr, 0.07);
});

// ---------------------------------------------------------------- investments
test('investment prices follow a deterministic seeded walk', () => {
  const a = fresh({ seed: 5 }), b = fresh({ seed: 5 });
  for (let i = 0; i < 20; i++) { E._internal.marketWeek(a); E._internal.marketWeek(b); }
  assert.equal(a.market.b500.price, b.market.b500.price);
  assert.equal(a.market.b500.history.length, 21);
  assert.ok(a.market.bond.price >= 1000 * 0.95);
});

test('dividends count as passive income; price gains do not', () => {
  const s = fresh();
  s.chapter = 5;
  s.cash = 10000;
  E.investBuy(s, 'mcu', 10000);
  const d = E.derive(s);
  near(d.dividendPerSec, 10000 * 0.05 / 12 * (1 - C.TAX_DIV) / C.SEC_PER_MONTH);
  near(d.passivePerSec, d.dividendPerSec);
  s.market.mcu.price *= 2;
  near(E.derive(s).dividendPerSec, 2 * d.dividendPerSec); // yield on value
  assert.equal(E.derive(s).bizNetPerSec, 0);
});

test('selling realizes the gain and pays capital-gains tax on the profit only', () => {
  const s = fresh();
  s.chapter = 5;
  s.cash = 1000;
  E.investBuy(s, 'b500', 1000);
  s.market.b500.price *= 1.5;
  const r = E.investSell(s, 'b500', 1);
  assert.ok(r.ok);
  near(r.proceeds, 1500);
  near(r.tax, 500 * C.TAX_GAIN);
  near(s.cash, 1500 - 500 * C.TAX_GAIN);
});

test('investing is locked before the INVEST tab', () => {
  const s = fresh();
  s.cash = 100;
  assert.equal(E.investBuy(s, 'b500', 100).ok, false);
});

test('a crash drops everything but bonds and opens the dip window', () => {
  const s = fresh();
  s.chapter = 5;
  s.cash = 2000;
  E.investBuy(s, 'b500', 1000);
  E.investBuy(s, 'bond', 1000);
  const p = s.market.b500.price, pb = s.market.bond.price;
  E._internal.startCrash(s);
  near(s.market.b500.price, p * (1 - 0.25));
  assert.equal(s.market.bond.price, pb);
  assert.ok(E.derive(s).dipActive);
  near(E.derive(s).investments[0].dipPrice, s.market.b500.price * (1 - C.DIP_DISCOUNT));
});

// ---------------------------------------------------------------- doodads and power-ups
test('doodads add upkeep forever and Status; resale is 30%', () => {
  const s = fresh();
  s.cash = 10000;
  const e0 = E.derive(s).expensesMonthly;
  assert.ok(E.buyDoodad(s, 'hoverbike').ok);
  const d = E.derive(s);
  near(d.expensesMonthly - e0, 100);
  assert.equal(d.status, 1);
  const r = E.sellDoodad(s, 'hoverbike');
  near(r.proceeds, 3000 * 0.3);
});

test('power-ups cost seconds of income, run for their duration and cool down', () => {
  const s = fresh();
  s.cash = 1000;
  const r = E.activatePowerup(s, 'overclock', 0);
  assert.ok(r.ok);
  assert.equal(r.cost, 50); // min cost with no passive income
  assert.equal(E.activatePowerup(s, 'overclock', 0).ok, false);
  E.takeJob(s, 'scrap');
  assert.equal(E.derive(s).puClick, 5);
  advance(s, 31);
  assert.equal(E.derive(s).puClick, 1);
});

test('the Energy Drink costs 0.1 years of life', () => {
  const s = fresh();
  s.cash = 100;
  const ls = s.lifespan;
  E.activatePowerup(s, 'energy', 0);
  near(s.lifespan, ls - 0.1);
});

test('golden bot outcomes: frenzy, lump sum, lucky shift, wisdom', () => {
  const s = fresh();
  s.glitch.activeUntil = s.gameSeconds + 10;
  const r = withRng([0.1], () => E.collectGlitch(s, 0));
  assert.equal(r.kind, 'frenzy');
  assert.ok(E.derive(s).frenzyActive);
  s.glitch.activeUntil = s.gameSeconds + 10;
  assert.equal(withRng([0.6], () => E.collectGlitch(s, 0)).kind, 'lump');
  s.glitch.activeUntil = s.gameSeconds + 10;
  assert.equal(withRng([0.9], () => E.collectGlitch(s, 0)).kind, 'lucky');
  assert.equal(s.luckyClicks, 20);
  s.glitch.activeUntil = s.gameSeconds + 10;
  const w = s.wisdom;
  assert.equal(withRng([0.99], () => E.collectGlitch(s, 0)).kind, 'code');
  assert.equal(s.wisdom, w + 1);
  assert.equal(E.collectGlitch(s, 0).kind, null);
});

// ---------------------------------------------------------------- chapters
test('chapters unlock in order and never skip a beat', () => {
  const s = fresh();
  assert.equal(E.chapterFor(s), 1);
  s.stats.lifetimeClicks = 15;
  assert.equal(E.chapterFor(s), 2);
  s.cash = 1e9; s.debt = 0; // huge net worth but no business yet
  assert.equal(E.chapterFor(s), 2);
  E.buy(s, 'battery', 1);
  assert.equal(E.chapterFor(s), 6); // net worth >= $1M
  s.flags.ratRaceExit = true;
  assert.equal(E.chapterFor(s), 7);
});

test('tick promotes one chapter at a time with a pause between scenes', () => {
  const s = fresh();
  s.stats.lifetimeClicks = 15;
  s.cash = 1e7; s.debt = 0;
  E.buy(s, 'battery', 1);
  advance(s, 1);
  assert.equal(s.chapter, 2);
  advance(s, 16);
  assert.equal(s.chapter, 3);
});

// ---------------------------------------------------------------- lessons
test('lesson pages queue, arrive as envelopes and grant their reward once', () => {
  const s = fresh();
  withRng([0.99], () => E.click(s, 0));
  advance(s, C.LESSON_L01_DELAY_S + 1);
  assert.equal(s.lessons.L01, 'new');
  assert.ok(s.queue.some((q) => q.type === 'lesson' && q.lessonId === 'L01'));
  const r = E.readLesson(s, 'L01');
  assert.ok(r.ok);
  assert.equal(s.debtApr, 0.10);
  assert.equal(E.readLesson(s, 'L01').ok, false);
});

test('non-tutorial pages are spaced at least 3 minutes apart', () => {
  const s = fresh();
  s.lastLessonAt = s.gameSeconds;
  s.lessons.L05 = 'queued'; s.lessonQueue.push('L05');
  s.lessons.L07 = 'queued'; s.lessonQueue.push('L07');
  advance(s, 1);
  assert.equal(s.lessons.L05, 'queued');
  s.lastLessonAt = s.gameSeconds - C.LESSON_GAP_S;
  advance(s, 1);
  assert.equal(s.lessons.L05, 'new');
  assert.equal(s.lessons.L07, 'queued');
});

test('lesson income rewards stack into business income', () => {
  const s = fresh();
  s.cash = 1000; E.buy(s, 'battery', 1);
  const g0 = E.derive(s).bizGrossPerSec;
  s.lessons.L05 = 'new'; E.readLesson(s, 'L05');
  near(E.derive(s).bizGrossPerSec, g0 * Data.byId['lesson:L05'].reward.value);
});

// ---------------------------------------------------------------- events
test('the Bot-Lambo can be bought on credit and shows a what-if', () => {
  const s = fresh();
  s.events.pending = { id: 'lambo', since: 0 };
  const r = E.answerEvent(s, 'lambo', 0, 0);
  assert.ok(r.ok);
  assert.ok(s.doodads.lambo);
  assert.ok(s.debt > C.START_DEBT, '0% down means Repo-Tron paid');
  assert.ok(r.whatIf && r.whatIf.delayS > 0);
  assert.equal(s.lessons.L22, 'queued');
  advance(s, r.whatIf.delayS + 1);
  assert.ok(s.queue.some((q) => q.type === 'whatif'));
});

test('consolidation raises the debt APR to 29%', () => {
  const s = fresh();
  s.events.pending = { id: 'consolidation', since: 0 };
  E.answerEvent(s, 'consolidation', 0, 0);
  assert.equal(s.debtApr, 0.29);
});

test('the prince report pays $50 and grants the achievement', () => {
  const s = fresh();
  s.events.pending = { id: 'prince', since: 0 };
  E.answerEvent(s, 'prince', 2, 0);
  assert.equal(s.cash, 50);
  assert.ok(s.achievements.not_today_prince);
  assert.equal(s.stats.bestEventChoices, 1);
});

test('lottery tickets cost money and almost never win', () => {
  const s = fresh();
  s.cash = 200;
  s.events.pending = { id: 'lottery', since: 0 };
  withRng([0.5], () => E.answerEvent(s, 'lottery', 1, 0));
  assert.equal(s.cash, 0);
});

test('MoonCoin all-in settles instantly with the rolled multiplier', () => {
  const s = fresh();
  s.debt = 0; s.cash = 1000;
  s.events.pending = { id: 'mooncoin', since: 0 };
  const r = withRng([0.1], () => E.answerEvent(s, 'mooncoin', 0, 0)); // p 0.3 -> x3
  near(s.cash, 1000 + 500 * 2);
  assert.match(r.result, /MOONED/);
});

test('Doc Module: the Miracle Chip adds zero years', () => {
  const s = fresh();
  s.cash = 1000;
  const ls = s.lifespan;
  s.events.pending = { id: 'doc_offers', since: 0 };
  E.answerEvent(s, 'doc_offers', 1, 0);
  assert.equal(s.lifespan, ls);
  assert.ok(s.achievements.miracle_chump);
});

test('options with unmet requirements are rejected', () => {
  const s = fresh();
  s.events.pending = { id: 'doc_offers', since: 0 };
  assert.equal(E.answerEvent(s, 'doc_offers', 0, 0).ok, false);
});

test('a promotion offer opens when ready and accepting applies the mandate', () => {
  const s = fresh();
  E.takeJob(s, 'scrap');
  s.chapter = 2;
  s.job.shifts = 1000; s.cash = 1e6; s.debt = 0;
  s.events.lastAt = -1e9;
  advance(s, 0.2);
  assert.equal(s.events.pending && s.events.pending.id, 'promotion');
  E.answerEvent(s, 'promotion', 0, 0);
  assert.equal(s.job.id, 'captcha');
  assert.equal(s.housing, 'sleeping');
});

// ---------------------------------------------------------------- achievements
test('achievements unlock from conditions and add +1% income each', () => {
  const s = fresh();
  s.cash = 1e6;
  E.buy(s, 'battery', 1);
  const g0 = E.derive(s).bizGrossPerSec;
  advance(s, 0.2);
  assert.ok(s.achievements.ka_chunk);
  const n = E.derive(s).achievementsUnlocked;
  near(E.derive(s).bizGrossPerSec, 0.4 * (1 + 0.01 * n), 1e-3);
  assert.ok(g0 > 0);
});

// ---------------------------------------------------------------- health, death, escape
test('health drifts down and the Medbay resets it to 70', () => {
  const s = fresh();
  const h0 = s.health;
  advance(s, C.SEC_PER_YEAR, 500);
  assert.ok(s.health < h0);
  s.health = 10; s.cash = 1000;
  const r = E.medbay(s);
  assert.ok(r.ok);
  assert.equal(r.cost, C.MEDBAY_MIN);
  assert.equal(s.health, C.MEDBAY_HEALTH);
});

test('Doc Module items add years; the chip is a scam', () => {
  const s = fresh();
  s.cash = 5000;
  E.buyHealth(s, 'gym');
  assert.equal(s.lifespan, C.BASE_LIFESPAN + 2);
  E.buyHealth(s, 'chip');
  assert.equal(s.lifespan, C.BASE_LIFESPAN + 2);
  assert.ok(s.achievements.miracle_chump);
});

test('critical health can trigger a sudden shutdown at a month end', () => {
  const s = fresh();
  s.health = 5;
  withRng([0.99, 0.99, 0.0], () => E._internal.monthEnd(s, false));
  assert.equal(s.ending, 'wageslave');
  assert.ok(s.queue.some((q) => q.type === 'death'));
});

test('reaching your lifespan on the treadmill ends as a wage slave', () => {
  const s = fresh();
  s.age = s.lifespan - 0.001;
  advance(s, 1);
  assert.equal(s.ending, 'wageslave');
  assert.ok(s.achievements.died_a_wage_slave);
  assert.ok(s.pendingWisdom >= 0);
  const before = s.gameSeconds;
  E.tick(s, 1000, 0);
  assert.equal(s.gameSeconds, before, 'a dead run does not tick');
});

test('dying after leaving the rat race is "free, but gone"', () => {
  const s = fresh();
  s.flags.ratRaceExit = true;
  s.age = s.lifespan;
  advance(s, 0.2);
  assert.equal(s.ending, 'free');
});

test('the rat race exit needs 3 good month-ends from chapter 6 with no bad debt', () => {
  const s = fresh();
  s.chapter = 6; s.debt = 0; s.cash = 1e7;
  E.buy(s, 'truck', 20);
  for (let i = 0; i < 2; i++) E._internal.monthEnd(s, true);
  assert.equal(s.flags.ratRaceExit, false);
  E._internal.monthEnd(s, true);
  assert.equal(s.flags.ratRaceExit, true);
  const t = fresh(); t.chapter = 6; t.cash = 1e7; E.buy(t, 'truck', 20);
  for (let i = 0; i < 5; i++) E._internal.monthEnd(t, true);
  assert.equal(t.flags.ratRaceExit, false, 'bad debt blocks it');
});

test('escaping pays the toll, ranks you by age and the next run carries Wisdom', () => {
  const s = fresh();
  s.flags.ratRaceExit = true; s.chapter = 8; s.debt = 0;
  s.cash = 1e7; E.buy(s, 'truck', 20);
  const toll = E.derive(s).exitToll;
  assert.equal(E.canEscape(s).ok, false);
  s.cash = toll + 5;
  s.stats.lifetimeEarned = 1e12;
  const r = E.escape(s, 0);
  assert.ok(r.ok);
  assert.equal(s.ending, 'escaped');
  assert.equal(r.rank, 'GHOST IN THE MACHINE');
  assert.equal(r.wisdom, Math.floor(4 * Math.log10(1 + 1e12 / 1000)) + C.ESCAPE_WISDOM_BONUS);
  const n = E.rebirth(s, 5000);
  assert.equal(n.run, 2);
  assert.equal(n.wisdom, r.wisdom);
  assert.equal(n.debtApr, C.RUN2_DEBT_APR);
  near(E.derive(n).exitToll, C.EXIT_TOLL_BASE * C.EXIT_TOLL_RUN_MULT);
  assert.ok(n.ghost && n.ghost.truck === 20);
  assert.ok(n.achievements.escaped);
  assert.equal(n.hall.length, 1);
});

test('Wisdom perks apply at birth', () => {
  const s = E.newState(0, { seed: 1, wisdom: 12 });
  assert.equal(s.debt, 0);
  assert.equal(s.businesses.battery.owned, 5);
  assert.equal(s.job.id, 'captcha');
});

// ---------------------------------------------------------------- offline, save/load
test('offline progress is capped, runs at 50% and ages you at most 2 years', () => {
  const s = fresh();
  s.debt = 0; s.cash = 1e6; E.buy(s, 'truck', 10);
  s.cash = 0;
  const bizNet = E.derive(s).bizNetBasePerSec; // steady state: the milestone x2 does not run offline
  s.lastSeen = 0;
  const age0 = s.age;
  const r = E.applyOffline(s, 24 * 3600 * 1000);
  assert.equal(r.seconds, C.OFFLINE_CAP_H * 3600);
  near(r.earned, bizNet * C.OFFLINE_CAP_H * 3600 * C.OFFLINE_EFF, 1e-6);
  assert.ok(s.age - age0 <= 2 + 1e-9);
  assert.ok(s.age < s.lifespan - 1 + 1e-9);
  assert.equal(E.applyOffline(s, 24 * 3600 * 1000 + 1000), null, 'short gaps are ignored');
});

test('save/load round-trips and rejects garbage', () => {
  const s = fresh();
  s.cash = 1234; E.buy(s, 'battery', 3);
  const str = E.save(s);
  const t = E.load(str, 5000);
  assert.equal(t.cash, s.cash);
  assert.equal(t.businesses.battery.owned, 3);
  assert.deepEqual(E.derive(t).netWorth, E.derive(s).netWorth);
  assert.equal(E.load('nope', 0), null);
  assert.equal(E.load('{"v":2}', 0), null);
  assert.equal(E.load(JSON.stringify({ v: 1, cash: 'x' }), 0), null);
  const old = JSON.parse(str); delete old.settings; delete old.hall; old.flags = { ratRaceExit: false };
  const u = E.load(JSON.stringify(old), 0);
  assert.ok(u.settings && Array.isArray(u.hall) && u.flags.seen, 'missing fields are filled');
});

test('derive() exposes everything the UI needs', () => {
  const d = E.derive(fresh());
  for (const k of ['cash', 'netWorth', 'clickValue', 'heatTier', 'passivePerSec', 'expensesPerSec', 'freedomRatio', 'age', 'yearsLeft',
    'health', 'chapter', 'machineForm', 'avatarStage', 'statusLabel', 'businesses', 'investments', 'exitToll', 'tabsUnlocked',
    'lessonsRead', 'achievementsUnlocked', 'incomeSplit', 'medbayCost', 'activePowerups', 'pendingEvent']) {
    assert.ok(k in d, k);
  }
  assert.equal(d.businesses.length, 14);
  assert.equal(d.investments.length, 5);
});

// ---------------------------------------------------------------- review fixes
test('temporary boosts do not count toward the rat-race audit', () => {
  const s = fresh();
  s.chapter = 6; s.debt = 0; s.cash = 1e6;
  E.buy(s, 'battery', 20);
  s.cash = 1e6;
  const real = E.derive(s).freedomRatio;
  s.frenzyUntil = s.gameSeconds + 100; s.frenzyMult = 7;
  s.powerups.strike.until = s.gameSeconds + 100;
  assert.equal(E.derive(s).freedomRatio, real, 'freedom uses steady-state passive income');
  assert.ok(E.derive(s).passivePerSec > 0);
  if (real < C.RAT_RACE_RATIO) {
    for (let i = 0; i < 4; i++) E._internal.monthEnd(s, true);
    assert.equal(s.flags.ratRaceExit, false);
  }
});

test('unpaid bills (overdraft) are repaid automatically as money comes in', () => {
  const s = fresh();
  advance(s, 5);
  const od = s.overdraftDebt;
  assert.ok(od > 0 && s.debt > C.START_DEBT);
  s.cash = 1000;
  advance(s, 0.1);
  assert.ok(s.overdraftDebt < 1e-9, 'overdraft swept');
  assert.ok(Math.abs(s.debt - C.START_DEBT) < 1, 'the original fine stays until you pay it');
  assert.ok(s.cash < 1000 && s.cash > 1000 - od - 5);
});

test('"let the assets buy it" buys a business that covers the upkeep, so freedom holds', () => {
  const s = fresh();
  s.chapter = 4; s.debt = 0; s.cash = 1e6;
  E.buy(s, 'battery', 10); E.buy(s, 'vending', 5);
  s.cash = 5e5;
  const plan = E.coverPlan(s, 'hoverbike');
  assert.ok(plan && plan.count > 0 && plan.gain >= 100 - 1e-6);
  const before = E.derive(s);
  s.events.pending = { id: 'doodad_offer', since: 0, doodadId: 'hoverbike' };
  const view = E.derive(s).pendingEvent;
  assert.ok(view.options[2].visible, 'option offered');
  assert.match(view.options[2].label, /to pay its upkeep/);
  E.answerEvent(s, 'doodad_offer', 2, 0);
  const after = E.derive(s);
  assert.ok(s.doodads.hoverbike);
  assert.ok(after.passiveMonthly - after.expensesMonthly >= before.passiveMonthly - before.expensesMonthly - 1e-6, 'cash flow is not worse');
  assert.ok(s.achievements.assets_bought_toy);
});

test('holding an investment keeps its card unlocked', () => {
  const s = fresh();
  s.chapter = 5; s.cash = 1e5; s.debt = 0;
  s.businesses.drone = undefined; delete s.businesses.drone;
  s.job.id = 'drone';
  assert.ok(E.investBuy(s, 'bitbot', 1000).ok);
  s.job.id = null; s.cash = 0;
  const v = E.derive(s).investments.find((x) => x.id === 'bitbot');
  assert.ok(v.unlocked);
  assert.ok(E.investSell(s, 'bitbot', 1).ok);
});

test('the lottery "invest the $20" keeps the money before the INVEST tab exists', () => {
  const s = fresh();
  s.cash = 100;
  s.events.pending = { id: 'lottery', since: 0 };
  E.answerEvent(s, 'lottery', 2, 0);
  assert.equal(s.investments.b500.units, 0);
  assert.equal(s.cash, 100);
});

test('tutorial pages are spaced 40 s apart and jump ahead of gated pages', () => {
  const s = fresh();
  s.lessons.L08 = 'queued'; s.lessons.L01 = 'queued';
  s.lessonQueue = ['L08', 'L01'];
  s.lastLessonAt = s.gameSeconds - C.LESSON_GAP_TUTORIAL_S;
  advance(s, 0.2);
  assert.equal(s.lessons.L01, 'new');
  assert.equal(s.lessons.L08, 'queued');
});

test('loading a save with a broken pending event drops the event', () => {
  const s = fresh();
  s.events.pending = { id: 'doodad_offer', since: 0, doodadId: 'nope' };
  const t = E.load(E.save(s), 0);
  assert.equal(t.events.pending, null);
  E.derive(t);
});

test('the Side Hustle perk starts you employed without pricey housing', () => {
  const s = E.newState(0, { seed: 1, wisdom: 12 });
  assert.equal(s.job.id, 'captcha');
  assert.equal(s.housing, 'cardboard');
});

test('LUCKY SHIFT is used up by auto-clicks too', () => {
  const s = fresh();
  E.takeJob(s, 'scrap');
  s.upgrades.clone3 = true; E.recompute(s);
  s.luckyClicks = 20;
  advance(s, 5);
  assert.equal(s.luckyClicks, 0);
});
