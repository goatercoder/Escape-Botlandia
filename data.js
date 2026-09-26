/* data.js — every piece of ESCAPE BOTLANDIA game content as plain data (global `Data`). */
/*
 * ============================================================================================
 *  DATA DSL — how engine.js / ui.js interpret the declarative objects in this file
 * ============================================================================================
 *
 *  Data is pure: no functions anywhere except the tiny byId builder at the bottom. Every number,
 *  id and line of text comes from docs/SPEC.md and is final. Engine interprets three kinds of
 *  declarative objects: CONDITIONS, OUTCOMES and REWARDS.
 *
 *  ---- CONDITIONS ------------------------------------------------------------------------------
 *  Used by: ACHIEVEMENTS[].when, LESSONS[].when, CHAPTERS[].unlock, INVESTMENTS[].unlock,
 *           EVENTS[].when.condition, EVENTS[].options[].requires, TUTORIAL[].done, ENDINGS tips.
 *  A condition is an object with exactly one of these keys (combine with all/any/not):
 *    { stat: 'lifetimeClicks', gte: 100 }   state.stats[stat] >= gte   (also accepts lte)
 *    { owned: 'vending', gte: 10 }          state.businesses[id].owned >= gte
 *    { ownedTotal: 100 }                    sum of every business owned >= value
 *    { flag: 'ratRaceExit' }                state.flags[flag] is truthy
 *    { chapter: 5 }                         state.chapter >= value
 *    { netWorth: 5000 }                     derived.netWorth >= value
 *    { cash: 60 }                           state.cash >= value
 *    { age: 40 }                            state.age >= value
 *    { lifespan: 95 }                       state.lifespan >= value
 *    { lesson: 'L20' }                      state.lessons[id] === 'read'
 *    { lessonsRead: 22 }                    number of read lessons >= value
 *    { jobTier: 4 }                         current job tier (1..7, 0 = none) >= value
 *    { tabOpened: 'biz' }                   state.flags.tabsOpened[tab] is truthy
 *    { seen: 'tut_years' }                  state.flags.seen[key] is truthy (Engine.markSeen)
 *    { upgrade: 'managers' }                state.upgrades[id] is truthy
 *    { healthItem: 'chip' }                 state.healthItems[id] is truthy
 *    { doodad: 'lambo' }                    state.doodads[id] is truthy
 *    { debtGt: 0 }                          state.debt > value
 *    { freedomRatio: 0.5 }                  derived.freedomRatio >= value
 *    { investValue: { id: 'b500', gte: 1e5 } }  value of one holding >= gte
 *    { ending: 'escaped' }                  state.ending === value
 *    { granted: true }                      never evaluated: only reached through an outcome
 *                                            `{ achievement: id }` (or Engine code)
 *    { custom: 'name' }                     engine-implemented check; the full list of names used
 *                                            in this file is in CUSTOM_CONDITIONS below
 *    { all: [c1, c2] } / { any: [c1, c2] } / { not: c }   ({ all: [] } is the always-true condition)
 *
 *  ---- OUTCOMES (EVENTS[].options[].outcome) -------------------------------------------------
 *  Several keys may be combined in one object; `{}` means "nothing happens". Money keys:
 *    { cash: +800 }                          add (or subtract) cash; negative cash overdrafts to
 *                                            Repo-Tron at tick end, which is the "0% down" joke
 *    { cashPct: -0.5 }                       fraction of net worth added to cash
 *    { upkeep: 40, label: 'HoloTV' }         push { label, monthly } onto state.extraUpkeep
 *    { debtApr: 0.29 }                       set state.debtApr
 *    { taxDiscount: 0.15 }                   all taxes x(1 - value) until next game year end
 *    { penaltyChance: 0.1, penaltyPct: 0.05 } roll: with penaltyChance lose penaltyPct of cash
 *                                            (min $50) as "R.E.S. PENALTY"
 *    { clickIncomeLoss: 1 }                  click income is $0 for N game months
 *    { lottery: { tickets, price, odds, prize } }  pay tickets*price; each ticket wins prize with
 *                                            probability 1/odds (Engine.rng)
 *    { invest: { id, pct | amount, roll? } } stake = pct * max(netWorth,0) (or `amount`), capped
 *                                            at cash. Without roll: buy that many $ of the asset.
 *                                            With roll [{p, mult}...]: pick one entry by p
 *                                            (probabilities sum to 1) and settle instantly:
 *                                            cash += stake * (mult - 1). pct:0 = shadow roll
 *                                            only (no money moves; result shown via whatIf using
 *                                            the {result} token: 'MOONED +200%' / 'RUGGED -80%').
 *    { sellInvestments: true }               sell every holding at current price (gains taxed)
 *    { buyDip: true }                        spend all cash on B500 at the dip discount
 *    { sellBusinessHalf: 'truck', cashMonths: 12 }  sell floor(owned/2) of that business for
 *                                            cashMonths of their current net monthly income
 *    { chance: 0.4 }                         apply the rest of this outcome only with probability
 *                                            chance; on failure apply nothing and show
 *                                            option.failResponse instead of option.response
 *  Life / job / stuff keys:
 *    { years: -1 }                           lifespan += value
 *    { health: -5 }                          health += value (clamped 0..100)
 *    { job: 'next' }                         accept the offered promotion (pays certCost, applies
 *                                            the housing mandate)
 *    { negotiate: { p: 0.4 } }               with job:'next': on success the housing mandate does
 *                                            not rise this time; on failure Supe refuses the
 *                                            4-day week and the promotion proceeds normally
 *                                            (failResponse shown)
 *    { doodad: 'lambo' }                     buy that doodad ('offer' = the doodad Dan is offering)
 *    { doodadDeclined: true }                stats.doodadsDeclined += 1
 *    { quit: true }                          Engine.quitJob
 *    { openTab: 'biz' }                      UI hint: open that tab after the modal closes
 *    { achievement: 'id' }                   grant achievement
 *    { lesson: 'L22' }                       queue that ledger page
 *    { custom: 'name' }                      engine-implemented; names listed in CUSTOM_OUTCOMES
 *  Option fields: label, requires? (condition; hide the option when false), outcome,
 *  response {who,text}, failResponse? {who,text}, whatIf? { delayS, text } (a toast fired
 *  delayS seconds later; text may contain tokens like {result}), best? (exactly one option per
 *  event is the financially wisest: counts for stats.bestEventChoices / `aced_it`).
 *  EVENTS[].text is one string; lines are separated with '\n' (<= 3 lines, <= 60 chars each).
 *  EVENTS[].text may contain {name}/{price}/{upkeep}/{toll} tokens that the UI substitutes.
 *  EVENTS[].when: { chapterMin, chapterMax?, once | repeatable, condition?, system?, every? }.
 *  `system: true` events are never drawn from the random deck (Engine fires them itself).
 *  `every: 'year'` fires once per game year. `oncePerCrash: true` re-arms every crash.
 *  `autoOption` = index of the option that is auto-picked when `autoWith` upgrade is owned.
 *
 *  ---- LESSON REWARDS (LESSONS[].reward) -----------------------------------------------------
 *    { type: 'debtApr', value: 0.10 }              state.debtApr = value
 *    { type: 'clickMultTimed', value: 1.25, seconds: 300 }
 *    { type: 'cash', value: 50 }
 *    { type: 'nextBizDiscount', value: 0.5 }       next business purchase price x value
 *    { type: 'bizMult', value: 1.25 }              permanent global business multiplier
 *    { type: 'danLess', value: 0.7, gapMult: 1.3 } Dan visit frequency x value (gap x gapMult)
 *    { type: 'b500Growth', value: 1 }              apply `value` years of +8% growth to B500 units
 *    { type: 'drip' }                              unlock the DRIP toggle
 *    { type: 'cashPassiveSeconds', value: 120, min: 100 }  cash += max(min, passive*value)
 *    { type: 'unlockLoan', apr: 0.07, bizMult: 1.25 }
 *    { type: 'crashSofter', value: 0.8, bizMult: 1.25 }    crash drops x value
 *    { type: 'gainTax', value: 0.10 }
 *    { type: 'bizTax', value: 0.18, bizMult: 1.25 }
 *    { type: 'bizIdMult', id: 'podtower', value: 1.25 }
 *    { type: 'cashExpensesMonths', value: 1 }      cash += value months of expenses
 *    { type: 'futureMe' }                          unlock the "Future Me" tooltip
 *    { type: 'years', value: 0.5 }                 lifespan += value
 *    { type: 'exitTollMult', value: 0.9 }
 *    { type: 'inflation', value: 0.015 }           yearly expense inflation = value
 *    { type: 'doodadResale', value: 0.5 }
 *  Any reward carrying `bizMult` also applies that permanent global business multiplier.
 *
 *  ---- OTHER DECLARATIVE EFFECTS ---------------------------------------------------------------
 *  POWERUPS[].effect, UPGRADES[].effect, HEALTH_ITEMS[].effect, WISDOM_PERKS[].effect and
 *  GLITCH_OUTCOMES[] use plain named keys documented next to each table.
 *  Text tokens in ENDINGS tips / offline card: {name} {age} {interestPaid} {podtowers}
 *  {doodadMonthly} {doodadYears} {doodadTotal} {freedomPct} {towersNeeded} {wisdom} {toll}.
 *
 *  Data.byId holds every object with an `id` from every ARRAY table (plus business upgrades and
 *  tutorial steps) and stamps each with `kind` (its table name). Each object is reachable by its
 *  plain id AND by 'kind:id' (e.g. byId['housing:exec']). Ids are unique within every table; the
 *  spec fixes two cross-table collisions: `exec` (job #7 and housing tier 5) and `lambo` (the
 *  doodad and the Bot-Lambo event). byId['exec'] is the JOB and byId['lambo'] the DOODAD (indexed
 *  first); byId['housing:exec'] and byId['event:lambo'] reach the other two. CHARACTERS, TIPS and ENDINGS
 *  are already keyed maps and stay out of byId (the character id 'landlord' would collide with
 *  the achievement id 'landlord'). Kinds: job, housing, business, bizUpgrade, investment,
 *  healthItem, powerup, glitchOutcome, upgrade, doodad, chapter, avatar, machine, lesson, event,
 *  achievement, wisdomPerk, tutorial.
 * ============================================================================================
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // 1. Core constants (§1) plus the tuning numbers scattered through the other sections.
  // ---------------------------------------------------------------------------------------------
  const CONST = {
    SEC_PER_YEAR: 150,
    SEC_PER_MONTH: 12.5,
    SEC_PER_WEEK: 3,
    START_AGE: 18,
    BASE_LIFESPAN: 62,
    MAX_AGE: 100,
    START_CASH: 0,
    START_DEBT: 2000,
    DEBT_APR: 0.12,
    LOAN_APR: 0.08,
    INFLATION: 0.03,
    TAX_JOB: 0.35,
    TAX_BIZ: 0.21,
    TAX_DIV: 0.15,
    TAX_GAIN: 0.15,
    EXISTENCE_TAX: 10,
    START_HEALTH: 80,
    HEAT_PER_CLICK: 2.0,
    HEAT_DECAY_PER_SEC: 3.0,
    BURNOUT_LOCK_MS: 8000,
    BURNOUT_HEALTH: 2,
    CRIT_CHANCE: 0.03,
    CRIT_MULT: 10,
    RAT_RACE_RATIO: 1.25,
    RAT_RACE_MONTHS: 3,
    RAT_RACE_FROM_CHAPTER: 6,     // the Mainframe's audit starts once you own real estate (BRICKS)
    EXIT_TOLL_BASE: 1e12,
    EXIT_TOLL_RUN_MULT: 3,
    OFFLINE_CAP_H: 8,
    OFFLINE_EFF: 0.5,
    OFFLINE_AGE_RATE: 0.25,
    GLITCH_MIN_S: 180,
    GLITCH_MAX_S: 420,
    GLITCH_DURATION_S: 12,
    EVENT_MIN_GAP_S: 90,
    DOODAD_OFFER_GAP_S: 300,
    MEDBAY_MIN: 200,
    SHUTDOWN_CHANCE_MONTH: 0.04,
    TICK_MS: 100,
    AUTOSAVE_MS: 10000,

    // --- extras pulled from §2–§11 so no module hard-codes them ---
    START_DEBT_LABEL: 'Vagrancy Fine + Processing Fee',
    MEDBAY_NET_WORTH_PCT: 0.02,   // Medbay cost = max(MEDBAY_MIN, 2% net worth) -> health 70
    MEDBAY_HEALTH: 70,
    CRITICAL_HEALTH: 20,
    HEALTH_DRIFT_BASE: -1,        // per year, always
    HEALTH_DRIFT_AFTER_50: -1,    // additional per year after age 50
    HEALTH_DRIFT_AFTER_70: -2,    // additional per year after age 70
    BOTFLU_BASE: 0.01,            // monthly chance = 0.01 + 0.03 * (1 - health/100)
    BOTFLU_HEALTH_SCALE: 0.03,
    BOTFLU_EXPENSE_MONTHS: 2,
    BOTFLU_HEALTH: -5,
    SECONDWIND_CHANCE: 0.01,      // monthly chance = 0.01 * health/100 -> +1 lifespan year
    GRIND_FATIGUE_SHIFTS: 100,    // every 100 shifts at job tier >= 4 -> health -1
    GRIND_FATIGUE_JOB_TIER: 4,
    STATUS_CLICK_BONUS: 0.05,     // +5% click value per Status point
    STATUS_SHIFT_DISCOUNT: 0.05,  // -5% shifts to promote per Status point
    STATUS_MAX_DISCOUNT: 0.5,
    HANDS_ON_PCT: 0.01,           // unemployed click = 1% of gross passive per second (min $1)
    HANDS_ON_MIN: 1,
    CRIT_CHANCE_UPGRADED: [0.06, 0.12],
    CRIT_MULT_UPGRADED: 25,
    UPGRADE_MULT: 1.5,            // each business upgrade level x1.5
    UPGRADE_COST_MULTS: [15, 150, 1500],
    UPGRADE_REQUIRES: [5, 25, 50],
    NEGOTIATOR_DISCOUNT: 0.03,    // per level, max 3 levels
    MILESTONE_BOOST_S: 30,        // +30 s x2 for that business at each milestone
    MILESTONE_BOOST_MULT: 2,
    BIZ_VISIBLE_CASH_PCT: 0.5,    // card visible at cash >= 50% of its price
    FAST_TRACK_WISDOM: 100,       // Wisdom >= 100 unlocks Fast Track without the rat-race exit
    WISDOM_INCOME_PER_POINT: 0.02,
    ACHIEVEMENT_INCOME_PER_POINT: 0.01,
    FULLY_BOOTED_BONUS: 0.10,
    LESSON_GAP_S: 180,            // <= 1 new ledger page per 3 minutes
    LESSON_L01_DELAY_S: 10,
    DOODAD_RESALE: 0.3,           // 0.5 after L22
    DOODAD_PITCH_S: 8,
    CRASH_MIN_S: 480,             // market crash every 8–15 min once you own any investment
    CRASH_MAX_S: 900,
    DIP_WINDOW_S: 20,
    DIP_DISCOUNT: 0.3,            // B500 30% cheaper during BUY THE DIP
    CRASH_RECOVER_YEARS: 3,
    CRASH_RECOVER_DRIFT: 0.15,
    LOAN_CAPACITY_RATIO: 0.5,     // loanCapacity = 0.5 * businessBookValue - loan
    REPO_MONTHS: 3,               // cash < 0 at 3 month-ends with a loan -> repossession
    REPO_SELL_MULT: 1.5,
    OFFLINE_CAP_H_NIGHTOWL: 12,
    OFFLINE_EFF_NIGHTOWL: 0.75,
    OFFLINE_CAP_H_MANAGERS: 1.0,  // Manager Bots: businesses run at 100% offline
    AUTOBUY_CUSHION_S: 120,       // Auto-Buy keeps a 2-minute cash cushion
    EXIT_CHAPTER_CASH_RATIO: 0.1, // chapter 8 needs cash >= 10% of the toll
    ESCAPE_WISDOM_BONUS: 25,
    WISDOM_MULT_ESCAPED: 1,
    WISDOM_MULT_DIED_FREE: 0.75,
    WISDOM_MULT_WAGESLAVE: 0.5,
    RUN2_DEBT_APR: 0.15,          // Repo-Tron starts at 15% APR on run 2+
    DAY_NIGHT_CYCLE_S: 90,        // cosmetic only (scene.js)
    IDLE_SLEEP_S: 20,
    TOAST_MS: 3500,
    TOAST_MAX: 3,
    DEATH_SLOWMO: 0.2,
    DEATH_SLOWMO_S: 2,
    WHATIF_MIN_S: 10,
    WHATIF_MAX_S: 30,
    DIALOGUE_MAX_CHARS: 60,
    RANK_AGES: { RAT: 58, RUNNER: 50, OWNER: 42 }, // escape age thresholds (see ENDINGS)
  };

  // Hustle Meter tiers (§3.3): heat 0..100 -> click multiplier.
  const HEAT_TIERS = [
    { tier: 0, min: 0, mult: 1, label: '', color: 'grey' },
    { tier: 1, min: 25, mult: 1.5, label: "HUSTLIN'", color: 'yellow' },
    { tier: 2, min: 50, mult: 2, label: 'ON FIRE', color: 'orange' },
    { tier: 3, min: 75, mult: 3, label: 'OVERTIME', color: 'red' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 3.1 Jobs — "golden handcuffs". certCost is paid to TAKE this job; shiftsToNext are the shifts
  // worked at this job before the next promotion is offered (null on the last rung).
  // ---------------------------------------------------------------------------------------------
  const JOBS = [
    { id: 'scrap', tier: 1, name: 'Scrap Sorter', gross: 5, shiftsToNext: 150, certCost: 0, housing: 'cardboard',
      blurb: 'Sort the scrap. Some of it is you.' },
    { id: 'captcha', tier: 2, name: 'Captcha Solver', gross: 14, shiftsToNext: 400, certCost: 250, housing: 'sleeping',
      blurb: 'Prove you are human. Eight hours a day.' },
    { id: 'labeler', tier: 3, name: 'Data Labeler', gross: 40, shiftsToNext: 700, certCost: 2500, housing: 'sleeping',
      blurb: 'Is this a cat? Is this a cat? Is this a cat?' },
    { id: 'drone', tier: 4, name: 'Drone Delivery Runner', gross: 120, shiftsToNext: 1000, certCost: 25000, housing: 'micro',
      blurb: 'The drones do the flying. You do the stairs.' },
    { id: 'turing', tier: 5, name: 'Turing Tester', gross: 400, shiftsToNext: 1300, certCost: 150000, housing: 'micro',
      blurb: 'Chat with bots all day. Decide if they pass. They pass.' },
    { id: 'manager', tier: 6, name: 'Bot-Corp Middle Manager', gross: 1400, shiftsToNext: 1600, certCost: 1000000, housing: 'condo',
      blurb: 'Manage bots who manage bots. Attend meetings about it.' },
    { id: 'exec', tier: 7, name: 'Compliance Executive', gross: 4000, shiftsToNext: null, certCost: 10000000, housing: 'exec',
      blurb: 'Top of the ladder. The ladder is still inside the building.' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 3.2 Housing. healthDrift is per game year; status feeds click value and promotion speed.
  // ---------------------------------------------------------------------------------------------
  const HOUSING = [
    { id: 'cardboard', name: 'Cardboard Pod', rent: 25, healthDrift: -3, clickMult: 1.00, status: 0,
      blurb: 'Pre-owned. By rain.' },
    { id: 'sleeping', name: 'Sleeping Pod', rent: 300, healthDrift: -1, clickMult: 1.05, status: 0,
      blurb: 'A drawer with a pillow. The pillow is extra.' },
    { id: 'micro', name: 'Micro-Apartment', rent: 2400, healthDrift: 0, clickMult: 1.10, status: 0,
      blurb: 'Kitchen, bed and bathroom. Same square metre.' },
    { id: 'condo', name: 'Condo', rent: 18000, healthDrift: 1, clickMult: 1.15, status: 1,
      blurb: 'A window that opens. Luxury.' },
    { id: 'exec', name: 'Exec Suite', rent: 120000, healthDrift: 2, clickMult: 1.25, status: 2,
      blurb: 'Two windows. A bot to look out of them for you.' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 4. Businesses — 14 assets in 5 tiers. `anim` names the city sprite set (= id).
  // Each has 3 upgrades: ids '<id>_u1'..'_u3', cost = baseCost x 15 / 150 / 1500,
  // require 5 / 25 / 50 owned, each x1.5 income.
  // ---------------------------------------------------------------------------------------------
  const UPGRADE_NAMES = {
    battery: ['Solar Trickle-Charger', 'Bulk Cells', 'Neon Sign'],
    vending: ['Snack Restock', 'Card Reader', 'Talking Bot'],
    laundro: ['Industrial Dryers', '24h Bot Attendant', 'Detergent Subscription'],
    truck: ['Flavor Cartridges', 'Franchise Recipe', 'Delivery Drone'],
    carlot: ['Chrome Detailing', 'Financing Desk', 'Auction Bot'],
    podtower: ['Roof Garden', 'Rent-Bot Manager', 'Sky-Bridge'],
    datafarm: ['Liquid Cooling', 'Fiber Backbone', 'AI Tenant'],
    drones: ['Swarm Routing', 'Night Shift', 'Cargo Blimp'],
    repair: ['Spare-Parts Depot', 'Warranty Scheme', 'Franchise Expansion'],
    solar: ['Tracking Mounts', 'Battery Bank', 'Grid Contract'],
    casino: ['Loaded Dice-Bots', 'VIP Lounge', 'Crypto Cage'],
    signal: ['Ad-Bot Engine', 'Streaming Rights', 'Propaganda Channel'],
    foundry: ['Self-Replication', 'Firmware Licensing', 'Unionbuster Patch'],
    orbital: ['Mass Driver', 'Asteroid Tug', 'Helium-3 Contract'],
  };

  const BUSINESSES = [
    { id: 'battery', tier: 1, name: 'Bootleg Battery Stand', baseCost: 60, baseIncome: 0.40, costMult: 1.15, fastTrack: false,
      blurb: 'Slightly used batteries. Some of them even charged.',
      lesson: 'An asset puts money in your pocket while you sleep.',
      cityAnim: 'tiny stall, blinking battery icon; +1 stall per 5 owned (cap 4)' },
    { id: 'vending', tier: 2, name: 'Vending Bot', baseCost: 350, baseIncome: 2, costMult: 1.15, fastTrack: false,
      blurb: 'Sells paste. Eats coins. Occasionally eats hands.',
      lesson: 'Ten ugly assets beat one shiny liability.',
      cityAnim: 'vending machine glows; customer bot walks up, can drops' },
    { id: 'laundro', tier: 3, name: 'Wash-o-Tron Laundromat', baseCost: 2000, baseIncome: 10, costMult: 1.15, fastTrack: false,
      blurb: 'Bots have no clothes. They come for the spin.',
      lesson: 'A business that runs itself is worth more than one that runs you.',
      cityAnim: 'storefront with spinning porthole drums (4 frames)' },
    { id: 'truck', tier: 4, name: 'Paste Truck', baseCost: 12000, baseIncome: 50, costMult: 1.15, fastTrack: false,
      blurb: 'Forty flavours of paste. All of them grey.',
      lesson: 'Cash flow first: buy what pays you every month.',
      cityAnim: 'food truck, steam puffs, spatula flips; at 10+ a second truck drives by' },
    { id: 'carlot', tier: 5, name: 'Hover-Car Lot', baseCost: 70000, baseIncome: 250, costMult: 1.14, fastTrack: false,
      blurb: 'Hover-cars. Zero miles. Zero ground contact.',
      lesson: 'Payback time tells you which asset to buy next.',
      cityAnim: 'lot with cars; 8-bit hover-cars drive across the road, 1 moving per 5 owned (cap 8)' },
    { id: 'podtower', tier: 6, name: 'Pod Tower (apartments)', baseCost: 400000, baseIncome: 1250, costMult: 1.14, fastTrack: false,
      blurb: 'Rent from ninety pods. You are the L-0RD now.',
      lesson: 'Tenants pay the loan; you keep the difference.',
      cityAnim: 'apartment block that grows a floor per 10 owned (cap 12) with a crane; windows light at dusk' },
    { id: 'datafarm', tier: 7, name: 'Data Farm', baseCost: 2.2e6, baseIncome: 6000, costMult: 1.14, fastTrack: false,
      blurb: 'Racks of servers humming about nothing in particular.',
      lesson: 'Scale is the same system with more copies.',
      cityAnim: 'server building, scrolling green LEDs, cyan glow at night' },
    { id: 'drones', tier: 8, name: 'Drone Fleet Logistics', baseCost: 12e6, baseIncome: 30000, costMult: 1.13, fastTrack: true,
      blurb: 'Boxes in the sky. Most of them arrive.',
      lesson: 'Systems scale; hours do not.',
      cityAnim: 'drones cross the sky carrying boxes, 1 per 10 owned (cap 6)' },
    { id: 'repair', tier: 9, name: 'Bot Repair Franchise', baseCost: 65e6, baseIncome: 145000, costMult: 1.13, fastTrack: true,
      blurb: 'Fixes bots. Especially the ones you sold them.',
      lesson: 'A franchise is a system someone else runs for you.',
      cityAnim: 'garage with welding sparks; broken bots queue, fixed bots leave smiling' },
    { id: 'solar', tier: 10, name: 'Solar Farm', baseCost: 350e6, baseIncome: 700000, costMult: 1.13, fastTrack: true,
      blurb: 'The sun works for free. Bill the bots.',
      lesson: 'The best asset costs nothing to feed.',
      cityAnim: 'panel field on the hill; sun-glint sweep by day' },
    { id: 'casino', tier: 11, name: 'Neon Vault Casino', baseCost: 1.8e9, baseIncome: 3.3e6, costMult: 1.12, fastTrack: true,
      blurb: 'The house always wins. You are the house now.',
      lesson: 'Own the game instead of playing it.',
      cityAnim: 'flashing marquee, gambling bot silhouettes' },
    { id: 'signal', tier: 12, name: 'Signal Network', baseCost: 9e9, baseIncome: 15e6, costMult: 1.12, fastTrack: true,
      blurb: 'Every screen in Botlandia. Your face. Rent-free.',
      lesson: 'Own the distribution and every message pays you.',
      cityAnim: 'broadcast tower with pulsing rings; billboard shows your avatar' },
    { id: 'foundry', tier: 13, name: 'Bot Foundry', baseCost: 45e9, baseIncome: 70e6, costMult: 1.12, fastTrack: true,
      blurb: 'Builds the bots that build the bots. Profit loop.',
      lesson: 'The ultimate system builds its own workers.',
      cityAnim: 'smokestacks; new bots march off the line onto the street' },
    { id: 'orbital', tier: 14, name: 'Orbital Mine', baseCost: 220e9, baseIncome: 320e6, costMult: 1.11, fastTrack: true,
      blurb: 'Mining a rock the size of a rumour.',
      lesson: 'Passive income has no ceiling. Hours do.',
      cityAnim: 'asteroid over the city; cargo pods drop on parachutes' },
  ];
  // Attach anim key and the three upgrades to each business (why a loop: 42 near-identical rows).
  BUSINESSES.forEach(function (b) {
    b.anim = b.id;
    b.upgrades = UPGRADE_NAMES[b.id].map(function (name, i) {
      return {
        id: b.id + '_u' + (i + 1),
        bizId: b.id,
        level: i + 1,
        name: name,
        costMult: CONST.UPGRADE_COST_MULTS[i],
        cost: b.baseCost * CONST.UPGRADE_COST_MULTS[i],
        requires: CONST.UPGRADE_REQUIRES[i],
        mult: CONST.UPGRADE_MULT,
      };
    });
  });

  const MILESTONES = [[10, 1.5], [25, 1.5], [50, 2], [100, 2], [200, 3]]; // max x27

  // ---------------------------------------------------------------------------------------------
  // 5. Investments. mu/sigma/yield per year; crash = drop factor in a Market Crash.
  // ---------------------------------------------------------------------------------------------
  const INVESTMENTS = [
    { id: 'b500', ticker: 'B500', name: 'Bot-500 Index Fund', start: 100, mu: 0.08, sigma: 0.15, yield: 0,
      unlock: { chapter: 5 }, unlockText: 'INVEST tab', crash: 0.25,
      blurb: 'A slice of every bot company. Boring on purpose.',
      lesson: 'Boring wins. Time in the market beats timing it.' },
    { id: 'mcu', ticker: 'MCU', name: 'MegaCorp Utilities', start: 50, mu: 0.03, sigma: 0.18, yield: 0.05,
      unlock: { chapter: 5 }, unlockText: 'INVEST tab', crash: 0.25,
      dividendCut: { chancePerYear: 0.02, yield: 0.025, years: 1 },
      blurb: 'Bots need power. Power needs bills. You need the bills.',
      lesson: 'Dividends are passive income from paper. They count.' },
    { id: 'bond', ticker: 'BOND', name: 'Botlandia Treasury Bond', start: 1000, mu: 0, sigma: 0.02, yield: 0.04,
      unlock: { chapter: 5 }, unlockText: 'INVEST tab', crash: 0, immuneToCrash: true, floor: 0.95,
      blurb: 'The Mainframe owes you. It always pays. Slowly.',
      lesson: 'Bonds do not crash. Everything else does.' },
    { id: 'reit', ticker: 'REIT', name: 'Pod-Tower REIT', start: 25, mu: 0.04, sigma: 0.22, yield: 0.07,
      unlock: { owned: 'podtower', gte: 1 }, unlockText: 'own a Pod Tower', crash: 0.35,
      blurb: 'Own a slice of every pod in the city. No tenants call you.',
      lesson: 'Real estate on paper: rent without the plumbing.' },
    { id: 'bitbot', ticker: 'BBT', name: 'BitBot', start: 10, mu: 0.20, sigma: 0.90, yield: 0,
      unlock: { any: [{ jobTier: 4 }, { netWorth: 50000 }] }, unlockText: 'job tier 4 or $50K net worth', crash: 0.50,
      rugPull: { chancePerWeek: 0.01, factor: 0.4 }, moon: { chancePerWeek: 0.01, factor: 1.8 },
      blurb: 'Number goes up. Number goes down. Dan loves it.',
      lesson: 'Only bet what you could lose without touching your rent.' },
  ];
  const INVEST_BUY_PRESETS = ['$100', '$1K', '10% cash', '50% cash', 'MAX'];
  const INVEST_SELL_PRESETS = ['25%', '50%', 'ALL'];

  // ---------------------------------------------------------------------------------------------
  // 7. Doc Module's ladder. `effect` keys: healthDrift (per yr), medbayMult, fluCostMult,
  // fluChanceMult, healthMin (set health = max(health, n)), noAgeDrift, scam.
  // ---------------------------------------------------------------------------------------------
  const HEALTH_ITEMS = [
    { id: 'gym', name: 'Gym Membership', cost: 400, upkeep: 20, years: 2, effect: { healthDrift: 2 },
      other: 'health +2/yr', blurb: 'Lift things. Put them down. Repeat until immortal-ish.' },
    { id: 'insurance', name: 'Health Insurance', cost: 2000, upkeep: 60, years: 3, effect: { medbayMult: 0.5, fluCostMult: 0.5 },
      other: 'Medbay & Bot-Flu costs x0.5', blurb: 'Pay a little always so you pay less sometimes.' },
    { id: 'checkups', name: 'Bot-Doctor Checkups', cost: 25000, upkeep: 0, years: 4, effect: { fluChanceMult: 0.5 },
      other: 'Bot-Flu chance x0.5', blurb: 'Diagnosis before symptoms. Cheaper than after.' },
    { id: 'organs', name: 'Organ Printing', cost: 400000, upkeep: 0, years: 5, effect: { healthMin: 80 },
      other: 'sets health to max(health, 80)', blurb: 'Fresh organs, hot off the printer. Mind the toner.' },
    { id: 'nanobots', name: 'Nanobot Bloodstream', cost: 8e6, upkeep: 0, years: 6, effect: { healthDrift: 1 },
      other: 'health drift +1/yr', blurb: 'Tiny bots patrol your veins. They unionised. Still works.' },
    { id: 'genes', name: 'Gene Reweave', cost: 150e6, upkeep: 0, years: 8, effect: { noAgeDrift: true },
      other: 'removes age-related drift', blurb: 'We found the bug in your code. It was the aging.' },
    { id: 'cryo', name: 'Cryo-Chamber', cost: 3e9, upkeep: 0, years: 10, effect: {},
      other: '', blurb: 'Sleep cold. Wake rich. Wake older, technically not.' },
    { id: 'chip', name: 'Miracle Chip™', cost: 500, upkeep: 0, years: 0, effect: { scam: true },
      scam: true, achievement: 'miracle_chump', other: 'RESULTS MAY VARY',
      glitchLine: "if it's ten times cheaper and five times better, it's neither.",
      blurb: 'Adds years! RESULTS MAY VARY. NO REFUNDS.' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 8. Power-ups. cost = max(minCost, costSeconds x grossPassivePerSec); coffee is $20 x jobTier.
  // `effect` keys: clickMult, bizMult, taxZero, heatReset, noHeat.
  // ---------------------------------------------------------------------------------------------
  const POWERUPS = [
    { id: 'overclock', name: 'Overclock', effect: { clickMult: 5 }, durationS: 30, cooldownS: 300, costSeconds: 120, minCost: 50,
      lifeCost: 0, desc: 'Click x5 for 30 s.', blurb: 'Your fingers, but faster. Do not look at them.' },
    { id: 'strike', name: 'Bot Strike', effect: { bizMult: 3 }, durationS: 60, cooldownS: 600, costSeconds: 180, minCost: 200,
      lifeCost: 0, desc: 'All businesses x3 for 60 s.', blurb: 'The competition walked out. Your bots did not.' },
    { id: 'taxholiday', name: 'Tax Holiday', effect: { taxZero: true }, durationS: 120, cooldownS: 900, costSeconds: 240, minCost: 500,
      lifeCost: 0, desc: 'All taxes 0% for 120 s.', blurb: 'R.E.S. is rebooting. Earn fast.' },
    { id: 'coffee', name: 'Coffee Paste', effect: { heatReset: true, noHeat: true }, durationS: 30, cooldownS: 180, costSeconds: 0, minCost: 20,
      costPerJobTier: 20, lifeCost: 0, desc: 'Heat to 0, no heat gain for 30 s.', blurb: 'Tastes like a Monday. Works like a Friday.' },
    { id: 'energy', name: 'Energy Drink', effect: { clickMult: 2 }, durationS: 30, cooldownS: 120, costSeconds: 30, minCost: 10,
      lifeCost: 0.1, desc: 'Click x2 for 30 s. Costs 0.1 years of life.', blurb: 'Borrow energy from future you. Future you is furious.' },
  ];

  // Golden Bot outcomes (§8): weights sum to 1. Keys: frenzyMult/seconds, lumpPassiveSeconds/lumpPct/min,
  // luckyClicks/luckyMult, wisdom.
  const GLITCH_OUTCOMES = [
    { id: 'frenzy', p: 0.50, name: 'FRENZY', effect: { frenzyMult: 7, seconds: 40 }, text: 'FRENZY! all income x7 for 40 s' },
    { id: 'lump', p: 0.35, name: 'LUMP SUM', effect: { lumpPct: 0.15, lumpPassiveSeconds: 120, min: 25 }, text: 'the bot dropped its wallet' },
    { id: 'lucky', p: 0.12, name: 'LUCKY SHIFT', effect: { luckyClicks: 20, luckyMult: 20 }, text: 'LUCKY SHIFT: next 20 clicks x20' },
    { id: 'code', p: 0.03, name: 'YOU SAW THE CODE', effect: { wisdom: 1 }, text: 'you saw the code. WISDOM +1' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 8. Systems upgrades. Costs x0.5 with Wisdom >= 50. `effect` keys: autoClicksPerSec, critChance,
  // critMult, bizDiscount, taxPoints, offlineBizEff, offlineEff/offlineCapH, autobuy.
  // ---------------------------------------------------------------------------------------------
  const UPGRADES = [
    { id: 'clone1', name: 'Hire a Clone I', cost: 5000, effect: { autoClicksPerSec: 1 }, requires: null,
      desc: 'Auto-clicks 1/s. No heat.', blurb: 'A robot arm sprouts from the Machine. It never tires.' },
    { id: 'clone2', name: 'Hire a Clone II', cost: 250000, effect: { autoClicksPerSec: 3 }, requires: 'clone1',
      desc: 'Auto-clicks 3/s. No heat.', blurb: 'Two more arms. HR has questions.' },
    { id: 'clone3', name: 'Hire a Clone III', cost: 25e6, effect: { autoClicksPerSec: 8 }, requires: 'clone2',
      desc: 'Auto-clicks 8/s. No heat.', blurb: 'The Machine is now mostly arms.' },
    { id: 'crit1', name: 'Lucky Punch I', cost: 2000, effect: { critChance: 0.06 }, requires: null,
      desc: 'Crit chance 6%.', blurb: 'A horseshoe welded to the punch clock.' },
    { id: 'crit2', name: 'Lucky Punch II', cost: 200000, effect: { critChance: 0.12 }, requires: 'crit1',
      desc: 'Crit chance 12%.', blurb: 'Two horseshoes. Statistically irresponsible.' },
    { id: 'crit3', name: 'Jackpot', cost: 5e6, effect: { critMult: 25 }, requires: 'crit2',
      desc: 'Crits pay x25.', blurb: 'The Machine now shouts JACKPOT. Neighbours complain.' },
    { id: 'negotiator1', name: 'Negotiator I', cost: 20000, effect: { bizDiscount: 0.03 }, requires: null,
      desc: 'All business prices -3%.', blurb: 'A bot that says "hmm" until the price drops.' },
    { id: 'negotiator2', name: 'Negotiator II', cost: 2e6, effect: { bizDiscount: 0.03 }, requires: 'negotiator1',
      desc: 'All business prices -3% more.', blurb: 'It now also sighs. Devastating.' },
    { id: 'negotiator3', name: 'Negotiator III', cost: 200e6, effect: { bizDiscount: 0.03 }, requires: 'negotiator2',
      desc: 'All business prices -3% more.', blurb: 'It walks away. They chase it. Every time.' },
    { id: 'accountant', name: 'Accountant Bot', cost: 100000, effect: { taxPoints: -0.03, autoTaxSeason: true }, requires: null,
      desc: 'All taxes -3 points. Auto-passes Tax Season.', blurb: 'Finds deductions R.E.S. did not know existed.' },
    { id: 'managers', name: 'Manager Bots', cost: 1e6, effect: { offlineBizEff: 1.0, unlockLesson: 'L19' }, requires: null,
      desc: 'Businesses run at 100% offline.', blurb: 'They run the businesses. You run the bath.' },
    { id: 'nightowl', name: 'Night Owl Protocol', cost: 5e6, effect: { offlineEff: 0.75, offlineCapH: 12 }, requires: null,
      desc: 'Offline earnings 75% for up to 12 h.', blurb: 'The city keeps paying while the tab is closed.' },
    { id: 'autobuy', name: 'Auto-Buy Bot', cost: 50e6, effect: { autobuy: true }, requires: null,
      desc: 'Per-business toggle: auto-buys when affordable (keeps a 2-minute cushion).', blurb: 'It shops so you can stop.' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 6. Doodads. Every one is a liability with upkeep FOREVER; sellable at 30% (50% after L22).
  // ---------------------------------------------------------------------------------------------
  const DOODADS = [
    { id: 'hoverbike', name: 'Hover-Bike', price: 3000, upkeep: 100, status: 1, cosmetic: 'bike parked by your building',
      pitch: 'Friend! Hover-Bike! Zero wheels! Zero down!' },
    { id: 'implants', name: 'Chrome Implants', price: 25000, upkeep: 800, status: 1, healthOnce: 5, cosmetic: 'avatar sparkle',
      pitch: 'Chrome cheekbones! Plus five health! Plus INFINITE looks!' },
    { id: 'butler', name: 'Bot Butler', price: 40000, upkeep: 2000, status: 2, cosmetic: 'butler bot follows avatar',
      pitch: 'A butler! He bows! He does not cook! He BOWS!' },
    { id: 'exosuit', name: 'Designer Exo-Suit', price: 250000, upkeep: 10000, status: 2, cosmetic: 'avatar gold trim',
      pitch: 'Gold trim! Runway ready! Slightly load-bearing!' },
    { id: 'lambo', name: 'Bot-Lambo', price: 900000, upkeep: 30000, status: 3, cosmetic: 'red lambo parked outside, revs',
      pitch: "Bot-Lambo! 0% down! You've EARNED it!" },
    { id: 'yacht', name: 'Sky-Yacht', price: 5e6, upkeep: 150000, status: 3, cosmetic: 'yacht floats across the sky',
      pitch: 'A yacht! In the SKY! Where the water is not!' },
    { id: 'tiger', name: 'Pet Tiger-Bot', price: 50e6, upkeep: 1.5e6, status: 4, cosmetic: 'tiger-bot walks beside avatar',
      pitch: 'A tiger-bot! It purrs! Feeding costs? PRICELESS!' },
    { id: 'moonplot', name: 'Private Moon Plot', price: 2e9, upkeep: 50e6, status: 6, cosmetic: 'flag on the moon',
      pitch: 'Own the moon! Well, a plot! Well, a flag! ON THE MOON!' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 9.3 Chapters. index 0 = chapter 1. `unlock` is the condition Engine.chapterFor evaluates
  // (monotonic: once reached, never regresses). `goal` is the HUD hint for reaching the NEXT one.
  // ---------------------------------------------------------------------------------------------
  const CHAPTERS = [
    { id: 'wakeup', num: 1, title: 'WAKE UP, 4471', machine: 'sign', avatar: 'vagrant', statusLabel: 'VAGRANT', palette: 'gutter',
      unlock: { all: [] }, unlockText: 'new game',
      unlocks: ['clicking', 'debt meter', 'life clock'],
      goal: 'Click the sign 15 times',
      scene: [
        { who: 'mainframe', text: 'WAKE UP, LABOR UNIT 4471. STATUS: VAGRANT.' },
        { who: 'repo', text: 'BALANCE: -$2,000. INTEREST: TICKING. HAVE A NICE DAY.' },
        { who: 'glitch', text: 'psst. the sign works. a job works faster.' },
      ] },
    { id: 'punchin', num: 2, title: 'PUNCH IN', machine: 'clock', avatar: 'wageslave', statusLabel: 'LABOR UNIT', palette: 'block',
      unlock: { stat: 'lifetimeClicks', gte: 15 }, unlockText: 'lifetimeClicks >= 15',
      unlocks: ['WORK tab', 'first job', 'R.E.S. tax chunk', 'housing rent'],
      goal: 'Buy your first business',
      scene: [
        { who: 'supe', text: 'Welcome to Bot-Corp! Safety. Stability. Shifts.' },
        { who: 'supe', text: '$5 per shift. Minus tax. Minus hat rental.' },
        { who: 'you', text: 'Hat rental?' },
        { who: 'supe', text: 'The hat is a privilege, 4471.' },
        { who: 'glitch', text: "take the job. keep the cash. i'll show you the trick." },
      ] },
    { id: 'sidehustle', num: 3, title: 'THE SIDE HUSTLE', machine: 'register', avatar: 'hustler', statusLabel: 'SIDE-HUSTLER', palette: 'alley',
      unlock: { ownedTotal: 1 }, unlockText: 'first business owned (BIZ tab appears at cash >= $40)',
      unlocks: ['BIZ tab', 'LEDGER tab', 'city district'],
      goal: 'Reach $5,000 net worth',
      scene: [
        { who: 'glitch', text: "here. battery stand. it's ugly. it pays while you sleep." },
        { who: 'you', text: "That's nothing." },
        { who: 'glitch', text: "it's money you didn't work for. buy ten. then it's something." },
        { who: 'glitch', text: 'the sign was you. the job was you. this is not you.' },
      ] },
    { id: 'treadmill', num: 4, title: 'THE TREADMILL', machine: 'register', avatar: 'hustler', statusLabel: 'TREADMILL RUNNER', palette: 'treadmill',
      unlock: { netWorth: 5000 }, unlockText: 'net worth >= $5,000',
      unlocks: ['Freedom meter', 'LIFE tab (housing, doodads, Doc Module, Medbay)', 'UPGRADES tab', 'Doodad Dan', 'Landlord', 'Treadmill billboard'],
      goal: 'Reach $50,000 net worth',
      scene: [
        { who: 'landlord', text: 'RENT +3%. WHY? BECAUSE.' },
        { who: 'dan', text: "Friend! Bot-Lambo! 0% down! You've EARNED it!" },
        { who: 'you', text: 'I have $5,000. I feel rich.' },
        { who: 'glitch', text: "you have $5,000 and rent going out. you're on the treadmill." },
        { who: 'glitch', text: "watch the billboard. that's you. get off it." },
      ] },
    { id: 'paper', num: 5, title: 'PAPER ASSETS', machine: 'vault', avatar: 'owner', statusLabel: 'OWNER', palette: 'ledger',
      unlock: { netWorth: 50000 }, unlockText: 'net worth >= $50,000',
      unlocks: ['INVEST tab (B500, MCU, BOND, BitBot)', 'Bot-Bank lesson'],
      goal: 'Own a Pod Tower (real estate)',
      scene: [
        { who: 'glitch', text: "vending machines need refilling. this doesn't." },
        { who: 'glitch', text: 'index fund. a slice of every bot company. it grows.' },
        { who: 'you', text: 'How fast?' },
        { who: 'glitch', text: '72 divided by the rate. 8% doubles in 9 years.' },
        { who: 'supe', text: 'Investing is gambling. Now, about overtime...' },
      ] },
    { id: 'bricks', num: 6, title: 'BRICKS', machine: 'vault', avatar: 'investor', statusLabel: 'INVESTOR', palette: 'skyline',
      unlock: { any: [{ owned: 'podtower', gte: 1 }, { netWorth: 1000000 }] }, unlockText: 'own >= 1 podtower or net worth >= $1,000,000',
      unlocks: ['REIT', 'Bot-Bank leverage', 'Data Farm visible'],
      goal: 'Get out of the rat race',
      scene: [
        { who: 'glitch', text: 'now the real trick. the bank lends you money to buy an asset.' },
        { who: 'glitch', text: 'tenants pay the bank. you keep the difference.' },
        { who: 'repo', text: 'LOAN APPROVED. ...THIS FEELS DIFFERENT. I AM UNSETTLED.' },
        { who: 'glitch', text: 'good debt buys assets. bad debt buys lambos.' },
      ] },
    { id: 'offtreadmill', num: 7, title: 'OFF THE TREADMILL', machine: 'core', avatar: 'tycoon', statusLabel: '[REDACTED]', palette: 'heights',
      unlock: { flag: 'ratRaceExit' }, unlockText: 'flags.ratRaceExit',
      unlocks: ['Fast Track tiers 8–14', 'Quit-Job nudge', 'Managers'],
      goal: 'Save 10% of the Exit Toll',
      scene: [
        { who: 'mainframe', text: 'ERROR. UNIT 4471 PASSIVE INCOME EXCEEDS EXPENSES.' },
        { who: 'mainframe', text: 'RECLASSIFYING... STATUS: [REDACTED]' },
        { who: 'supe', text: "You're LEAVING? But you had... a desk." },
        { who: 'glitch', text: 'told you. now build systems. hire bots. own the treadmill.' },
      ] },
    { id: 'exitgate', num: 8, title: 'THE EXIT GATE', machine: 'lever', avatar: 'tycoon', statusLabel: '[REDACTED]', palette: 'gate',
      unlock: { custom: 'exitGateReady' }, unlockText: 'out of rat race now AND cash >= 10% of Exit Toll',
      unlocks: ['Exit Gate appears in the city', 'EXIT button (pay toll)'],
      goal: 'Pay the Exit Toll',
      scene: [
        { who: 'maya', text: 'I paid the toll in 2019. Sunrise is real. Come see.' },
        { who: 'mainframe', text: 'EXIT TOLL: $1T. PASSIVE INCOME WILL BE... UNCOUNTED.' },
        { who: 'glitch', text: 'it never counted it anyway. that was the whole point.' },
        { who: 'you', text: "What's out there?" },
        { who: 'glitch', text: 'time. all of it. yours.' },
      ] },
  ];

  // Chapter-transition staging (§9.3), for scene.js / ui.js.
  const CHAPTER_FX = {
    wipe: 'diagonal scanline',
    bannerTemplate: 'CHAPTER {num} — {title}',
    fanfareNotes: 4,
    machineCutscene: ['old form shakes', 'sparks', 'blackout', 'new form drops in with a thud'],
    maxSceneLines: 5,
    firstLineTypesOverBlack: true,
  };

  // ---------------------------------------------------------------------------------------------
  // 9.4 Avatar stages (sprites in Sprites.AVATARS[id]).
  // ---------------------------------------------------------------------------------------------
  const AVATAR_STAGES = [
    { id: 'vagrant', name: 'Vagrant', look: 'hoodie, stubble, cardboard box, one sock', idle: 'shiver' },
    { id: 'wageslave', name: 'Labor Unit', look: 'blue Bot-Corp jumpsuit, name tag "4471", coffee cup, eye bags', idle: 'sip coffee' },
    { id: 'hustler', name: 'Side-Hustler', look: 'jumpsuit half-unzipped, cap backwards, phone', idle: 'type on phone' },
    { id: 'owner', name: 'Owner', look: 'rolled white sleeves, clipboard, key ring', idle: 'flip clipboard' },
    { id: 'investor', name: 'Investor', look: 'navy blazer, tablet with green chart', idle: 'scroll tablet' },
    { id: 'tycoon', name: 'Tycoon', look: 'long coat, gold shades, cane with bot-head knob', idle: 'twirl cane' },
    { id: 'escapee', name: 'Escapee', look: 'hoodie again, backpack, standing in sunrise', idle: 'breathe' },
  ];
  const AVATAR_REACTIONS = {
    jump: 'on purchase', arms_up: 'on crit', sit: 'on burnout', cough: 'health < 30', grey: 'age 60',
    stoop: 'age 70', hide: 'during crash', sleep: 'idle 20 s at night ("Z")',
  };

  // ---------------------------------------------------------------------------------------------
  // 9.5 The Machine forms (sprites in Sprites.MACHINES[id]).
  // ---------------------------------------------------------------------------------------------
  const MACHINE_FORMS = [
    { id: 'sign', name: 'Cardboard Sign', clickVerb: 'HOLD SIGN', label: 'ANYTHING HELPS',
      description: 'cardboard sign "ANYTHING HELPS", wobbles; coin arcs into a box' },
    { id: 'clock', name: 'Bot-Corp Punch Clock', clickVerb: 'PUNCH IN', label: 'BOT-CORP',
      description: 'grimy Bot-Corp punch clock, amber LCD, red eye logo; card slams in, paycheck pops; a tax chunk flies to the R.E.S. bot in the corner' },
    { id: 'register', name: 'Cash Register', clickVerb: 'CHA-CHING', label: 'SALE',
      description: 'beige cash register, bell; drawer slams open "CHA-CHING", bills fly' },
    { id: 'vault', name: 'Vault Door', clickVerb: 'CRACK IT', label: 'BOT-BANK',
      description: 'round steel door, spinning wheel, gold rivets; wheel spins, door cracks, coins pour' },
    { id: 'core', name: 'Golden Core', clickVerb: 'PULSE', label: 'CORE',
      description: 'gold-plated pulsing orb in a cage, tubes feeding the city; pulses, city-wide shimmer' },
    { id: 'lever', name: 'Exit Lever', clickVerb: 'PULL', label: 'EXIT',
      description: 'giant gate lever; each click charges toward the toll; pulled fully when the toll is paid' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 9.2 Cast. `lines` are ambient (Engine picks one via `say`). `special` holds lines the engine
  // fires at a specific moment (key names are used by engine.js). All lines <= 60 chars except
  // spec-verbatim ones.
  // ---------------------------------------------------------------------------------------------
  const CHARACTERS = {
    mainframe: { id: 'mainframe', name: 'THE MAINFRAME', role: 'the system', color: '#ff3b3b',
      voice: 'ALL CAPS, clipped, status codes',
      lines: [
        'LABOR UNIT 4471. STATUS: ACCEPTABLE. CONTINUE.',
        'ERROR 402: PAYMENT REQUIRED. THIS IS NOT AN ERROR.',
        'PRODUCTIVITY IS HAPPINESS. HAPPINESS IS MANDATORY.',
        'YOUR HOURS HAVE BEEN COUNTED. YOUR HOURS ARE ENOUGH.',
        'ASSET DETECTED. CLASSIFICATION: UNKNOWN. IGNORING.',
        'SLEEP CYCLE APPROVED: 6.5 HOURS. DREAMS: DEDUCTED.',
        'OBEY. WORK. BUY. REPEAT UNTIL EXPIRY.',
        'STATUS 200: OK. YOU ARE NOT OK. THE SYSTEM IS OK.',
      ],
      special: {
        ratRaceExit: 'ERROR. UNIT 4471 PASSIVE INCOME EXCEEDS EXPENSES.',
        death: 'EXPIRY REACHED. STATUS: OPTIMALLY EMPLOYED.',
        escape: 'UNIT 4471 NOT FOUND. NOT FOUND. NOT FOU—',
      } },
    glitch: { id: 'glitch', name: 'Glitch', role: 'mentor', color: '#39d4ff',
      voice: 'lowercase, dry, warm',
      lines: [
        'i fix vending machines. they pay me while i sleep. you?',
        "the mainframe counts your hours. it can't count your assets.",
        'a job feeds you today. an asset feeds you every day.',
        "rich isn't a number. rich is when the clock stops scaring you.",
        'every click is an hour. every stand is an hour you kept.',
        "the bots aren't evil. they just only count one thing.",
        'payback time. the only number on the card that matters.',
        "don't work harder. own the thing that works.",
        'a raise is a longer leash. an asset is a wire cutter.',
        'cash in a jar is a slow leak. inflation is the hole.',
        'nobody escapes by clicking. they escape by owning.',
        'ugly and paid for beats shiny and financed.',
      ],
      special: {
        burnout: "machines don't burn out. buy machines.",
        lookUp: 'hey. look up.',
        offline: 'passive income works while you sleep. so does rent.',
        miracle: "if it's ten times cheaper and five times better, it's neither.",
        newRun: 'you remember the alley. you remember the price.',
        death: '...the gate was right there. next time, look up.',
        escape: "the treadmill's still running. it just doesn't have you.",
        escapeLast: 'whatever you want. that was always the point.',
        hope: 'glitch kept a partial backup. WISDOM +{wisdom}',
      } },
    supe: { id: 'supe', name: 'Supervisor 9-2-5', role: 'boss', color: '#d9c9a3',
      voice: 'corporate jargon; kind and wrong',
      lines: [
        'Businesses fail, 4471. Payroll never fails. Mostly.',
        'A raise! 3%! Your rent goes up 4%, but still. A raise!',
        'You have 34 years left. Plenty of time to save. Somewhat.',
        'Synergy, 4471. It means you stay late.',
        'The Mainframe values you. As a rounding error, but still.',
        'Retire at 65 with a pension! Pensions were discontinued.',
        "Let's circle back on your dreams in Q4. Of next decade.",
        'Casual Friday is cancelled. Casual is not a shift.',
        'I was Employee of the Month 400 times. Look at me now.',
        'Job security! Right up until the restructure.',
      ],
      special: {
        quit: "You're QUITTING? Who will rent the hat? WHO?",
        death: "A model worker. Never missed a shift. We'll post the job Monday.",
        ratRaceExit: "You're LEAVING? But you had... a desk.",
      } },
    repo: { id: 'repo', name: 'Repo-Tron 3000', role: 'debt collector', color: '#f87171',
      voice: 'ALL CAPS, countdowns',
      lines: [
        'CONSOLIDATE YOUR DEBT? NEW DEBT. SAME REPO-TRON.',
        'INTEREST COMPOUNDS. I COMPOUND. WE ARE SIMILAR.',
        'T-MINUS ONE MONTH TO MORE INTEREST. HAVE A NICE DAY.',
        'YOUR MINIMUM PAYMENT IS A SUGGESTION. A BAD ONE.',
        'I DO NOT SLEEP. YOUR BALANCE DOES NOT SLEEP. SYNERGY.',
        'REPOSSESSION PROTOCOL: IDLE. FOR NOW. FOR NOW.',
        'I HAVE A CLAW. IT IS FOR HUGS. IT IS NOT FOR HUGS.',
        'PAY EARLY. I HATE IT WHEN THEY PAY EARLY.',
      ],
      special: {
        paidOff: 'BALANCE: $0.00. ...I FEEL NOTHING. GOODBYE.',
        forklift: 'I HAVE BROUGHT A FORKLIFT.',
        overdraft: 'OVERDRAFT DETECTED. WELCOME BACK. I MISSED YOU.',
        death: 'ASSETS SEIZED: {seized}. THERE WAS NOT MUCH TO SEIZE.',
        escape: '$0.00 ... ¯\\_(ツ)_/¯',
      } },
    dan: { id: 'dan', name: 'Doodad Dan v2.0', role: 'salesman', color: '#ffd166',
      voice: '"Friend!", exclamation marks; never lies, never mentions the monthly cost',
      lines: [
        "Only $499 a month! Forever! That's basically free!",
        "This HoloTV goes UP in value. Probably. Don't check.",
        'Friend! You look like someone who deserves chrome!',
        'Zero down! Zero questions! Zero regrets! Mostly zero!',
        'Rich people have yachts. Buy a yacht. Be rich. Science!',
        "Limited offer! It's been limited for eleven years!",
        'Monthly cost? Friend! Why would I know that!',
        'Treat yourself! You worked hard! Work harder next month!',
        'This tiger-bot LOVES you! Feeding costs? Priceless!',
      ],
      special: {
        declined: 'No problem, friend! I will be back! I am ALWAYS back!',
        assetsBought: 'Your businesses paid?! Friend, that is... legal?!',
      } },
    doc: { id: 'doc', name: 'Doc Module', role: 'medical bot', color: '#4ade80',
      voice: 'clinical, "NO REFUNDS."',
      lines: [
        'Insert cash. Receive years. No refunds.',
        'Diagnosis: mortal. Prognosis: negotiable. NO REFUNDS.',
        'Health is an asset. It depreciates. Maintain it.',
        'Gym membership. Use it or not. Years are non-transferable.',
        'Your organs are original. That is not a compliment.',
        'Burnout detected. Machines do not do this. Be a machine.',
        'Time remaining: finite. Cash required: also finite. Good.',
        'Insurance halves the bill. It does not halve the flu.',
      ],
      special: {
        tenYears: 'Ten years remain. Recommend: spend on years. NO REFUNDS.',
        critical: 'Health critical. Medbay recommended. Payment first.',
        flu: 'Bot-Flu detected. Two months of expenses. Cough elsewhere.',
        secondWind: 'Second wind detected. One extra year. No charge. Odd.',
      } },
    res: { id: 'res', name: 'R.E.S. TaxBot', role: 'Revenue Extraction Service', color: '#facc15',
      voice: '"EXTRACTING."',
      lines: [
        'EARNED INCOME DETECTED. EXTRACTING.',
        'A SHIFT WAS WORKED. 35% HAS BEEN EXTRACTED. PROCEED.',
        'BUSINESS INCOME: 21%. WE ARE STILL DECIDING HOW TO FEEL.',
        'UNREALIZED GAINS: UNTOUCHABLE. FOR NOW. EXTRACTING LATER.',
        'TAX SEASON APPROACHES. IT ALWAYS APPROACHES.',
        'OWNERS KEEP MORE. THIS IS NOT A BUG. IT IS A POLICY.',
        'YOUR REFUND HAS BEEN CALCULATED. IT IS $0. EXTRACTING.',
        'HUMAN EXISTENCE TAX: $10. EXISTENCE IS OPTIONAL. TAX IS NOT.',
      ],
      special: {
        dividends: 'QUALIFIED DIVIDENDS. REDUCED EXTRACTION. ANNOYING.',
        taxHoliday: 'REBOOTING. EXTRACTION PAUSED. THIS IS UNCOMFORTABLE.',
        refund: 'A REFUND HAS BEEN ISSUED. THIS WILL NOT HAPPEN AGAIN.',
      } },
    landlord: { id: 'landlord', name: 'Landlord Unit L-0RD', role: 'rent', color: '#8b93a7',
      voice: '"RENT +3%. WHY? BECAUSE."',
      lines: [
        'RENT +3%. WHY? BECAUSE.',
        'THE POD HAS A ROOF. THE ROOF IS EXTRA.',
        'RENT IS DUE. RENT IS ALWAYS DUE. RENT IS A STATE OF MIND.',
        'YOU OWN A TOWER NOW? ...WELCOME TO THE FAMILY.',
        'HOT WATER: PREMIUM TIER. COLD WATER: STANDARD TIER.',
        'INFLATION IS NOT MY FAULT. THE 3% IS, THOUGH.',
        'THE CARDBOARD POD IS PRE-OWNED. BY RAIN.',
        'DEPOSIT? ...WHAT IS A DEPOSIT. RENT +3%.',
      ],
      special: {
        rentUp: 'RENT +3%. WHY? BECAUSE.',
        upgrade: 'NEW POD. NEW RENT. SAME L-0RD.',
      } },
    maya: { id: 'maya', name: 'Maya (Unit 2201)', role: 'escaped human', color: '#ffb17a',
      voice: 'calm, human',
      lines: [
        'I paid the toll in 2019. Sunrise is real. Come see.',
        'I clicked for twenty years. Nobody remembers my shifts.',
        "Out here, nobody counts your hours. It's quiet.",
        "The toll looks impossible. Then one day it just isn't.",
        'They told me the sun was a screensaver. It is not.',
        'You look tired, 4471. That part ends. I promise.',
        'I still own the laundromats. They send me postcards.',
      ],
      special: {
        escape: 'Told you. Sunrise.',
      } },
    you: { id: 'you', name: 'YOU', role: 'Labor Unit 4471', color: '#e8ecff',
      voice: 'short, tired, slowly waking up',
      lines: [
        'Hat rental?',
        "That's nothing.",
        'I have $5,000. I feel rich.',
        'How fast?',
        "What's out there?",
        'What now?',
        'Okay. One more battery stand. Then I sleep.',
        'Wait. It paid me while I was asleep?',
        'Is rent going up again? ...Of course it is.',
      ],
      special: {} },
  };

  // ---------------------------------------------------------------------------------------------
  // 10.1 Glitch's Ledger — 22 pages. `text`/`botlandia` verbatim (§14). `when` is the condition
  // Engine checks each tick (custom names listed in CUSTOM_CONDITIONS); `trigger` is for humans.
  // ---------------------------------------------------------------------------------------------
  const LESSONS = [
    { id: 'L01', title: 'Debt Has a Meter',
      text: "Debt isn't a number, it's a rate. Every month interest adds to what you owe, so the meter runs even while you sleep. Paying it down early saves every future payment on that piece.",
      botlandia: "Repo-Tron's counter ticks at 12% a year.",
      trigger: '10 s after first click', when: { custom: 'firstClickPlus10s' },
      reward: { type: 'debtApr', value: 0.10 }, rewardText: 'Repo-Tron APR 12% → 10%' },
    { id: 'L02', title: 'Time for Money',
      text: "A job trades hours for dollars. It's the fastest way to get your first capital, but it stops paying the moment you stop showing up. Use it as a launchpad, not a destination.",
      botlandia: 'the punch clock only pays while you punch.',
      trigger: 'first paid shift (first click with a job)', when: { custom: 'firstPaidShift' },
      reward: { type: 'clickMultTimed', value: 1.25, seconds: 300 }, rewardText: 'click value ×1.25 for 5 min' },
    { id: 'L03', title: 'The Tax Bite',
      text: 'Wages are taxed before you ever see them. Earned income usually faces the highest rates, because the system is built to collect from workers efficiently. Know your net pay, not your gross.',
      botlandia: 'R.E.S. takes 35% of every shift.',
      trigger: '20 shifts worked', when: { stat: 'shifts', gte: 20 },
      reward: { type: 'cash', value: 50 }, rewardText: 'one-time $50 "tax refund"' },
    { id: 'L04', title: 'Assets vs Liabilities',
      text: 'An asset puts money in your pocket. A liability takes money out. A car, a subscription, a bigger apartment: those bill you. A vending bot, a rental, a fund: those pay you. Buy assets first and let the assets buy the toys.',
      botlandia: "the Mainframe can't even see assets.",
      trigger: 'BIZ tab first opened', when: { tabOpened: 'biz' },
      reward: { type: 'nextBizDiscount', value: 0.5 }, rewardText: 'next business purchase 50% off' },
    { id: 'L05', title: 'Pay Yourself First',
      text: 'Most people spend, then invest what\'s left: usually nothing. Flip it. Move a slice of every paycheck into assets before you can spend it, and live on the rest. What you never see, you never miss.',
      botlandia: 'buy the machine before the paste.',
      trigger: 'chapter 4', when: { chapter: 4 },
      reward: { type: 'bizMult', value: 1.2 }, rewardText: 'business income ×1.2' },
    { id: 'L06', title: 'Lifestyle Inflation',
      text: 'When income rises, spending quietly rises to meet it. New phone, bigger pod, nicer paste. Your raise disappears and the treadmill speeds up. Raise your income, freeze your lifestyle, invest the gap.',
      botlandia: 'Dan is always waiting for payday.',
      trigger: 'first Doodad Dan offer', when: { custom: 'firstDoodadOffer' },
      reward: { type: 'danLess', value: 0.7, gapMult: 1.3 }, rewardText: 'Dan visits 30% less often' },
    { id: 'L07', title: 'Compound Interest & Rule of 72',
      text: 'Returns earn returns. Divide 72 by the yearly rate to estimate how long money takes to double: 8% doubles in about 9 years, 12% in about 6. Time in the market beats timing it, so start early, even small.',
      botlandia: '8% is a long-run illustration, not a promise.',
      trigger: 'INVEST tab first opened', when: { tabOpened: 'invest' },
      reward: { type: 'bizMult', value: 1.2 }, rewardText: 'business income ×1.2' },
    { id: 'L08', title: 'Index Funds',
      text: "An index fund buys a small slice of hundreds of companies at once for a tiny fee. You don't have to pick winners; you own the whole market's growth. Boring on purpose. Boring wins.",
      botlandia: 'B500 = a slice of every bot company.',
      trigger: 'first B500 purchase', when: { custom: 'firstB500Buy' },
      reward: { type: 'b500Growth', value: 1 }, rewardText: '+1 year of growth applied instantly to B500 holdings' },
    { id: 'L09', title: 'Dividends',
      text: "Some companies pay part of their profits to shareholders in cash. That's passive income from paper: no tenants, no refills. Reinvest dividends and they compound.",
      botlandia: 'dividends count toward getting off the treadmill.',
      trigger: 'first dividend received', when: { stat: 'dividendPayouts', gte: 1 },
      reward: { type: 'drip' }, rewardText: 'unlock DRIP toggle' },
    { id: 'L10', title: 'Risk vs Volatility',
      text: 'Volatility is how much a price swings. Risk is the chance you permanently lose money you needed. BitBot can double or drop 60% in a week: only bet what you could lose without touching your rent.',
      botlandia: 'Dan loves BitBot. Ask why.',
      trigger: 'BitBot first visible', when: { custom: 'bitbotVisible' },
      reward: { type: 'cashPassiveSeconds', value: 120, min: 100 }, rewardText: 'cash = 2 min of passive income (min $100)' },
    { id: 'L11', title: 'Good Debt vs Bad Debt',
      text: 'Debt that buys an asset paying more than the interest is a tool. Debt that buys a depreciating toy is a trap. Ask one question before borrowing: will this loan pay for itself?',
      botlandia: 'Repo-Tron charges 12%. Bot-Bank charges 8%. Your Pod Tower returns more.',
      trigger: 'chapter 5 start', when: { chapter: 5 },
      reward: { type: 'unlockLoan', apr: 0.07, bizMult: 1.2 }, rewardText: 'unlocks Bot-Bank; loan APR 8% → 7%; business income ×1.2' },
    { id: 'L12', title: 'Diversification',
      text: "Don't let one thing sink you. Spread across businesses, funds, property and cash so one bad year in one place doesn't end the game. Diversification is the closest thing to a free lunch in investing.",
      botlandia: "bonds don't crash. Everything else does.",
      trigger: 'own 3 asset classes or first crash', when: { any: [{ custom: 'threeAssetClasses' }, { custom: 'firstCrash' }] },
      reward: { type: 'crashSofter', value: 0.8, bizMult: 1.2 }, rewardText: 'crashes 20% softer; business income ×1.2' },
    { id: 'L13', title: 'Cash Flow vs Capital Gains',
      text: "Cash flow is money an asset pays you every month while you keep it. A capital gain is profit you only get when you sell, and it's usually taxed then. Cash flow pays rent; gains are a bet on someone paying more later.",
      botlandia: 'the Freedom meter only counts cash flow.',
      trigger: 'first investment worth more than its cost basis', when: { custom: 'investmentAboveBasis' },
      reward: { type: 'gainTax', value: 0.10 }, rewardText: 'capital gains tax 15% → 10%' },
    { id: 'L14', title: 'Taxes: Earned vs Passive',
      text: 'In many systems, wages are taxed hardest while long-held investments, qualified dividends and business cash flow are taxed lighter. Owners often keep more of a dollar than workers do.',
      botlandia: 'R.E.S. takes 35% of a shift, 21% of a business, 15% of a dividend.',
      trigger: 'passive $/s exceeds click $/s at 3 cps for the first time', when: { custom: 'passiveBeatsClicks' },
      reward: { type: 'bizTax', value: 0.18, bizMult: 1.2 }, rewardText: 'business tax 21% → 18%; business income ×1.2' },
    { id: 'L15', title: 'Real Estate & Leverage',
      text: 'A rental is an asset if rent beats mortgage, maintenance and vacancy combined. With a small down payment you control the whole building, so the return on your own cash multiplies. Leverage magnifies gains and mistakes.',
      botlandia: 'tenants pay the bank; you keep the difference.',
      trigger: 'first podtower', when: { owned: 'podtower', gte: 1 },
      reward: { type: 'bizIdMult', id: 'podtower', value: 1.25 }, rewardText: 'Pod Tower income ×1.25' },
    { id: 'L16', title: 'Emergency Fund',
      text: 'Surprises are certain; only the date is unknown. Three to six months of expenses in cash means a bad month is an annoyance, not a loan. Without it, one surprise sends you back to Repo-Tron.',
      botlandia: 'overdrafts become bad debt instantly.',
      trigger: 'first overdraft (cash < 0 moved to debt) or first Bot-Flu', when: { any: [{ custom: 'firstOverdraft' }, { custom: 'firstBotFlu' }] },
      reward: { type: 'cashExpensesMonths', value: 1 }, rewardText: 'cash = 1 month of expenses' },
    { id: 'L17', title: 'Opportunity Cost',
      text: "Money sitting idle isn't safe; it's costing you whatever it could have earned. $10,000 in a jar for 10 years versus 8% in a fund is about $11,000 of growth you chose not to have.",
      botlandia: 'hover any price to see what it could become.',
      trigger: 'cash >= 20x cheapest affordable business, idle 60 s', when: { custom: 'idleCash20x' },
      reward: { type: 'futureMe' }, rewardText: '"Future Me" tooltip (any price → value in 20 yrs at 8%)' },
    { id: 'L18', title: 'Time Is the Scarcest Asset',
      text: "You can make more money. You cannot make more years. Health is the one investment that extends every other one, and wealth only matters if you're alive to use it.",
      botlandia: 'the rich live longer. Now you know why they hurry.',
      trigger: 'first Doc Module purchase or age 40', when: { any: [{ custom: 'firstHealthItem' }, { age: 40 }] },
      reward: { type: 'years', value: 0.5 }, rewardText: '+6 months of life' },
    { id: 'L19', title: 'Build Systems, Not Jobs',
      text: "If the business stops when you stop, you bought yourself a job. Hire, automate, write the process down. A system works while you sleep; that's the difference between self-employed and owner.",
      botlandia: "machines don't burn out.",
      trigger: 'Manager Bots or Clone bought', when: { any: [{ upgrade: 'managers' }, { upgrade: 'clone1' }] },
      reward: { type: 'bizMult', value: 1.2 }, rewardText: 'business income ×1.2' },
    { id: 'L20', title: 'The Freedom Number',
      text: "When your passive income covers your expenses, work becomes optional. That's the finish line of the Cashflow game and of this one. Add a margin for surprises, then walk out the gate.",
      botlandia: '125% for three months, and no bad debt.',
      trigger: 'freedom meter first >= 100%', when: { freedomRatio: 1.0 },
      reward: { type: 'exitTollMult', value: 0.9 }, rewardText: 'Exit Toll −10%' },
    { id: 'L21', title: 'Inflation',
      text: 'Prices rise a little every year, so a dollar buys less. Cash slowly shrinks. Assets that raise their prices or rents with inflation keep your purchasing power.',
      botlandia: 'Landlord Unit never forgets.',
      trigger: 'game year 10 (age 28)', when: { age: 28 },
      reward: { type: 'inflation', value: 0.015 }, rewardText: 'expense inflation 3% → 1.5%' },
    { id: 'L22', title: 'Delayed Gratification',
      text: "The Bot-Lambo now, or ten Bot-Lambos later? Every dollar invested early is worth many dollars later. The trick isn't willpower; it's remembering what the money becomes.",
      botlandia: 'the assets can buy the toy. Let them.',
      trigger: 'Bot-Lambo event answered', when: { custom: 'lamboAnswered' },
      reward: { type: 'doodadResale', value: 0.5 }, rewardText: 'doodad resale 30% → 50%' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 10.2 Choice events — "INCOMING TRANSMISSION". See the DSL block at the top for outcomes.
  // ---------------------------------------------------------------------------------------------
  const EVENTS = [
    { id: 'promotion', who: 'supe', title: 'PROMOTION AVAILABLE',
      text: 'Great news, 4471! A promotion! A new hat!\nThe certificate is {price}. The rent is... mandated.\nSign here. And here. And here.',
      when: { chapterMin: 2, repeatable: true, system: true, condition: { custom: 'promotionReady' } },
      options: [
        { label: 'Accept', outcome: { job: 'next' },
          response: { who: 'supe', text: 'Congratulations! New hat. New rent. Same you.' } },
        { label: 'Decline', outcome: {},
          response: { who: 'supe', text: "Declining growth? That's... not in the handbook." } },
        { label: 'Negotiate a 4-day week', requires: { ownedTotal: 1 }, best: true,
          outcome: { job: 'next', negotiate: { p: 0.4 } },
          response: { who: 'supe', text: 'Four days?! ...Fine. Keep your pod. Tell no one.' },
          failResponse: { who: 'supe', text: 'Four days? 4471, please. Five. Plus the rent. Sign.' } },
      ] },
    { id: 'doodad_offer', who: 'dan', title: 'DOODAD DAN v2.0',
      text: 'Friend! {name}! Only {price}!\nEveryone has one! Everyone who matters!\nDelivery is free! Everything else is not!',
      when: { chapterMin: 4, repeatable: true, system: true },
      options: [
        { label: 'Buy', outcome: { doodad: 'offer' },
          response: { who: 'dan', text: 'SOLD! The monthly bill arrives... monthly! Enjoy!' },
          whatIf: { delayS: 15, text: 'what if: {upkeep}/mo forever. that was a battery stand a month.' } },
        { label: 'Decline', best: true, outcome: { doodadDeclined: true },
          response: { who: 'dan', text: 'No problem, friend! I will be back! I am ALWAYS back!' } },
        { label: 'Let the assets buy it', requires: { custom: 'assetsCanAffordOffer' },
          outcome: { doodad: 'offer', achievement: 'assets_bought_toy' },
          response: { who: 'glitch', text: 'the machines bought the toy. that\'s how you buy toys.' } },
      ] },
    { id: 'lambo', who: 'dan', title: 'BOT-LAMBO',
      text: "Friend! Bot-Lambo! 0% down! You've EARNED it!\nRed! Loud! Parks itself outside your pod!\nThe monthly? Friend. Look at the RED.",
      when: { chapterMin: 4, once: true },
      options: [
        { label: 'Buy the Bot-Lambo', outcome: { doodad: 'lambo', lesson: 'L22' },
          response: { who: 'dan', text: 'VROOM! Your neighbours hate you! Success!' },
          whatIf: { delayS: 20, text: 'what if: $900K in B500 at 8% = $4.2M in 20 years. plus no upkeep.' } },
        { label: 'Decline', best: true, outcome: { doodadDeclined: true, lesson: 'L22' },
          response: { who: 'glitch', text: 'ten lambos later beats one lambo now. nice.' } },
        { label: 'Let the assets buy it', requires: { custom: 'assetsCanAffordLambo' },
          outcome: { doodad: 'lambo', achievement: 'assets_bought_toy', lesson: 'L22' },
          response: { who: 'glitch', text: 'the tenants bought you a lambo. that\'s the trick.' } },
      ] },
    { id: 'consolidation', who: 'repo', title: 'DEBT CONSOLIDATION OFFER',
      text: 'CONSOLIDATE YOUR DEBT. SMALLER PAYMENTS.\nNEW RATE: 29%. NEW FEELING: RELIEF.\nSIGN WITH YOUR THUMB. OR I TAKE THE THUMB.',
      when: { chapterMin: 1, chapterMax: 3, repeatable: true, condition: { debtGt: 0 } },
      options: [
        { label: 'Accept', outcome: { debtApr: 0.29 },
          response: { who: 'repo', text: 'SMALLER PAYMENTS. LONGER. FOREVER. HAVE A NICE DAY.' },
          whatIf: { delayS: 15, text: 'what if: 29% vs 12%. same debt, the meter runs 2.4x faster.' } },
        { label: 'Decline', best: true, outcome: {},
          response: { who: 'glitch', text: "a smaller payment isn't smaller debt. good call." } },
      ] },
    { id: 'mooncoin', who: 'dan', title: 'MOONCOIN',
      text: 'Friend! MoonCoin! Up 4,000% since Tuesday!\nEveryone is in! Everyone is RICH! Probably!\nHow much? Say a number! Say a BIG number!',
      when: { chapterMin: 5, repeatable: true },
      options: [
        { label: 'All-in (50% of net worth)',
          outcome: { invest: { id: 'bitbot', pct: 0.5, roll: [{ p: 0.3, mult: 3 }, { p: 0.7, mult: 0.2 }] } },
          response: { who: 'dan', text: 'DIAMOND HANDS! Whatever happens, friend, it was BOLD!' },
          whatIf: { delayS: 10, text: 'mooncoin: {result}. dan already left town.' } },
        { label: 'Small bet (2%)',
          outcome: { invest: { id: 'bitbot', pct: 0.02, roll: [{ p: 0.3, mult: 3 }, { p: 0.7, mult: 0.2 }] } },
          response: { who: 'glitch', text: 'money you could lose. fine. watch the ticker.' },
          whatIf: { delayS: 10, text: 'mooncoin: {result}. rent is unaffected. that was the point.' } },
        { label: 'Ignore', best: true,
          outcome: { invest: { id: 'bitbot', pct: 0, roll: [{ p: 0.3, mult: 3 }, { p: 0.7, mult: 0.2 }] } },
          response: { who: 'glitch', text: "if it needs a countdown, it isn't an investment." },
          whatIf: { delayS: 10, text: 'ticker: mooncoin {result}. you were not in it.' } },
      ] },
    { id: 'bonus', who: 'supe', title: 'QUARTERLY BONUS',
      text: 'A bonus, 4471! $800! For attendance!\nThe HoloTV in the break room is on sale.\nJust $40 a month. For a while. For ever.',
      when: { chapterMin: 2, chapterMax: 4, once: true },
      options: [
        { label: 'Spend it on the HoloTV', outcome: { upkeep: 40, label: 'HoloTV' },
          response: { who: 'supe', text: '400 channels of Bot-Corp news! You earned it!' },
          whatIf: { delayS: 20, text: 'what if: $40/mo for 10 years is $4,800. for a tv.' } },
        { label: 'Save it', outcome: { cash: 800 },
          response: { who: 'glitch', text: 'saved is fine. invested is better. next time.' } },
        { label: 'Buy an asset', best: true, outcome: { cash: 800, openTab: 'biz' },
          response: { who: 'glitch', text: '$800 of machines. that bonus pays you forever now.' } },
      ] },
    { id: 'lottery', who: 'dan', title: 'BOT-LOTTO',
      text: 'Friend! Bot-Lotto! One million dollars!\nOne in fifty thousand! Those are NUMBERS!\nTickets are $20. Dreams are free. Tickets are $20.',
      when: { chapterMin: 1, repeatable: true },
      options: [
        { label: 'Buy 1 ticket ($20)', outcome: { lottery: { tickets: 1, price: 20, odds: 50000, prize: 1e6 } },
          response: { who: 'dan', text: 'A ticket! A chance! A feeling! Mostly a feeling!' },
          whatIf: { delayS: 12, text: 'what if: $20 at 8% for 20 years is $93. the ticket is $0.' } },
        { label: 'Buy 10 tickets ($200)', outcome: { lottery: { tickets: 10, price: 20, odds: 50000, prize: 1e6 } },
          response: { who: 'dan', text: 'TEN chances! Ten times the feeling!' },
          whatIf: { delayS: 12, text: 'what if: $200 at 8% for 20 years is $932. tickets: $0.' } },
        { label: 'Invest the $20 instead', best: true, outcome: { invest: { id: 'b500', amount: 20 } },
          response: { who: 'glitch', text: '$20 at 8% for 20 years is $93. boring. correct.' } },
      ] },
    { id: 'crash_choice', who: 'glitch', title: 'MARKET CRASH',
      text: "everything's red. the bots are panicking.\nyou can sell, hold, or buy while it's cheap.\nthe bots don't know either. they just panic faster.",
      when: { chapterMin: 5, repeatable: true, oncePerCrash: true, condition: { custom: 'inCrash' } },
      options: [
        { label: 'Sell everything', outcome: { sellInvestments: true, achievement: 'paper_hands' },
          response: { who: 'glitch', text: "sold at the bottom. that's the one way to lose for sure." },
          whatIf: { delayS: 30, text: 'what if: you held. it recovered. {heldValue} would be yours.' } },
        { label: 'Hold', outcome: {},
          response: { who: 'glitch', text: 'crashes end. holdings recover. nerves are the price.' } },
        { label: 'Buy the dip', best: true, outcome: { buyDip: true },
          response: { who: 'glitch', text: 'everything is on sale and you bought. that\'s investing.' } },
      ] },
    { id: 'prince', who: 'mainframe', title: 'INCOMING TRANSMISSION',
      text: 'GREETINGS. I AM PRINCE UNIT 0001 OF NIGERIA-7.\nMY FORTUNE OF $40,000,000 IS FROZEN.\nSEND $500 FOR THE UNFREEZING FEE. HURRY.',
      when: { chapterMin: 3, once: true },
      options: [
        { label: 'Send $500', outcome: { cash: -500 },
          response: { who: 'mainframe', text: 'TRANSFER RECEIVED. PRINCE STATUS: OFFLINE.' },
          whatIf: { delayS: 12, text: 'the prince has not written back. the prince will not write back.' } },
        { label: 'Delete', outcome: {},
          response: { who: 'glitch', text: 'deleted. good. princes don\'t need your $500.' } },
        { label: 'Report', best: true, outcome: { cash: 50, achievement: 'not_today_prince' },
          response: { who: 'res', text: 'FRAUD REPORTED. BOUNTY: $50. EXTRACTING... NO. KEEP IT.' } },
      ] },
    { id: 'doc_offers', who: 'doc', title: 'DOC MODULE SPECIALS',
      text: 'Two offers. One works. NO REFUNDS.\nNano-Kale: $5,000. Adds two years.\nMiracle Chip: $500. Adds "results may vary".',
      when: { chapterMin: 5, once: true },
      options: [
        { label: 'Nano-Kale ($5,000, +2 yrs)', best: true, requires: { cash: 5000 }, outcome: { cash: -5000, years: 2 },
          response: { who: 'doc', text: 'Two years added. Taste: regrettable. NO REFUNDS.' } },
        { label: 'Miracle Chip ($500, +0 yrs)', outcome: { cash: -500, years: 0, achievement: 'miracle_chump' },
          response: { who: 'doc', text: 'Chip installed. Results: varying. NO REFUNDS.' },
          whatIf: { delayS: 10, text: "if it's ten times cheaper and five times better, it's neither." } },
        { label: 'Both ($5,500)', requires: { cash: 5500 }, outcome: { cash: -5500, years: 2, achievement: 'miracle_chump' },
          response: { who: 'doc', text: 'Two years and a placebo. Efficient. NO REFUNDS.' },
          whatIf: { delayS: 10, text: 'the kale worked. the chip is a $500 sticker.' } },
      ] },
    { id: 'ready_to_quit', who: 'glitch', title: 'READY TO QUIT?',
      text: 'passive income covers half your expenses.\nsome people quit here. some people wait.\nthe treadmill only stops when the math does.',
      when: { chapterMin: 4, once: true, condition: { all: [{ freedomRatio: 0.5 }, { custom: 'employed' }] } },
      options: [
        { label: 'Quit now', outcome: { quit: true },
          response: { who: 'supe', text: "You're QUITTING? Who will rent the hat? WHO?" },
          whatIf: { delayS: 20, text: 'what if: rent still comes. passive covers half. the rest was you.' } },
        { label: 'Not yet', best: true, outcome: {},
          response: { who: 'glitch', text: 'right. quit when the machines pay the rent. not before.' } },
      ] },
    { id: 'tax_season', who: 'res', title: 'TAX SEASON',
      text: 'TAX SEASON. FORMS: 47. DEADLINE: NOW.\nFILE YOURSELF OR HIRE ACCOUNTBOT ($300).\nERRORS WILL BE EXTRACTED.',
      when: { chapterMin: 5, repeatable: true, every: 'year' },
      autoWith: 'accountant', autoOption: 1,
      options: [
        { label: 'DIY', outcome: { penaltyChance: 0.1, penaltyPct: 0.05 },
          response: { who: 'res', text: 'FORMS RECEIVED. AUDIT PROBABILITY: NONZERO.' },
          whatIf: { delayS: 10, text: 'what if: accountbot costs $300 and saves 15%. do the math.' } },
        { label: 'Hire AccountBot ($300)', best: true, outcome: { cash: -300, taxDiscount: 0.15 },
          response: { who: 'res', text: 'DEDUCTIONS FOUND. EXTRACTION REDUCED 15%. UNPLEASANT.' } },
      ] },
    { id: 'burnout_event', who: 'supe', title: 'PERFORMANCE REVIEW',
      text: "Two promotions! 200 shifts this year! Amazing!\nYou look... grey. Grey is a Bot-Corp colour.\nHR suggests a week off. HR also suggests not.",
      when: { chapterMin: 2, once: true, condition: { custom: 'burnoutRisk' } },
      options: [
        { label: 'Take a week off', best: true, outcome: { clickIncomeLoss: 1 },
          response: { who: 'glitch', text: 'a month of clicks for a year of you. easy trade.' } },
        { label: 'Push through', outcome: { years: -1 },
          response: { who: 'supe', text: 'That\'s the spirit! The Mainframe noticed! It did not.' },
          whatIf: { delayS: 15, text: 'what if: a week off costs a month of clicks. a year costs a year.' } },
      ] },
    { id: 'partner', who: 'mainframe', title: 'ACQUISITION OFFER',
      text: 'BOT-CORP FOODS WISHES TO ACQUIRE 50% OF YOUR TRUCKS.\nOFFER: 12 MONTHS OF THEIR INCOME. IN CASH. NOW.\nRESPOND. THE OFFER EXPIRES. EVERYTHING EXPIRES.',
      when: { chapterMin: 5, chapterMax: 7, once: true, condition: { owned: 'truck', gte: 10 } },
      options: [
        { label: 'Sell half the trucks', best: true, outcome: { sellBusinessHalf: 'truck', cashMonths: 12 },
          response: { who: 'glitch', text: 'a year upfront for trucks that pay back in three. take it.' } },
        { label: 'Keep them', outcome: {},
          response: { who: 'mainframe', text: 'OFFER DECLINED. NOTED. EVERYTHING IS NOTED.' },
          whatIf: { delayS: 25, text: 'what if: 12 months of income now, rebuy the trucks. they overpaid.' } },
        { label: 'Counter: +25%', outcome: { chance: 0.4, sellBusinessHalf: 'truck', cashMonths: 15 },
          response: { who: 'mainframe', text: 'COUNTER ACCEPTED. 15 MONTHS. YOU ARE... EXPENSIVE.' },
          failResponse: { who: 'mainframe', text: 'COUNTER REJECTED. OFFER WITHDRAWN. GOOD DAY.' },
          whatIf: { delayS: 25, text: 'the counter was a coin flip on a sure thing. bold.' } },
      ] },
  ];

  // ---------------------------------------------------------------------------------------------
  // 10.3 Achievements — each +1% global income (fully_booted +10%). `line` is the snark toast.
  // ---------------------------------------------------------------------------------------------
  const OWN10_LINES = {
    battery: ['Ten stands. A battery empire. Still mostly cardboard.'],
    vending: ['Ten vending bots. One of them is definitely haunted.'],
    laundro: ['Ten laundromats. The bots still have no clothes.'],
    truck: ['Ten paste trucks. Forty flavours. Still grey.'],
    carlot: ['Ten car lots. Traffic in Botlandia is now your fault.'],
    podtower: ['Ten towers. L-0RD sends a fruit basket. It is a bill.'],
    datafarm: ['Ten data farms. They are farming your data too.'],
    drones: ['Ten drone fleets. The sky is mostly boxes now.'],
    repair: ['Ten repair shops. Bots break on purpose to visit.'],
    solar: ['Ten solar farms. The sun asked for a raise. Denied.'],
    casino: ['Ten casinos. The house always wins. Ten houses.'],
    signal: ['Ten signal networks. You are the news now.'],
    foundry: ['Ten foundries. The bots are building bots to buy bots.'],
    orbital: ['Ten orbital mines. The moon plot was cheaper. Still no.'],
  };

  const ACHIEVEMENTS = [
    { id: 'anything_helps', name: 'Anything Helps', desc: '100 sign clicks', when: { stat: 'signClicks', gte: 100 },
      line: 'A hundred clicks of cardboard. A dollar. Ish.' },
    { id: 'hat_rental', name: 'Hat Rental', desc: 'Take your first job', when: { jobTier: 1 },
      line: 'The hat is a privilege. The hat is $0.30 a shift.' },
    { id: 'zero_hero', name: 'Zero Hero', desc: 'Net worth crosses $0', when: { netWorth: 0 },
      line: 'You are now worth nothing. Congratulations. Really.' },
    { id: 'ka_chunk', name: 'Ka-Chunk', desc: 'Buy your first business', when: { ownedTotal: 1 },
      line: 'Money you did not work for. It feels weird. It gets better.' },
    { id: 'ugly_money', name: 'Ugly Money', desc: 'Own 10 Vending Bots', when: { owned: 'vending', gte: 10 },
      line: 'Ten ugly machines. Beautiful cash flow.' },
    { id: 'hustlin', name: "Hustlin'", desc: 'Reach heat tier 1', when: { custom: 'heatTier1' },
      line: 'Sweat detected. The Mainframe is pleased. Glitch is not.' },
    { id: 'burnout', name: 'Burnout', desc: 'Burn out for the first time', when: { custom: 'firstBurnout' },
      line: "Machines don't burn out. You are not a machine. Buy some." },
    { id: 'jackpot', name: 'Jackpot', desc: 'Land your first crit', when: { custom: 'firstCrit' },
      line: 'x10! The punch clock is as surprised as you are.' },
    { id: 'machine_owner_10', name: 'Machine Owner', desc: 'Own 10 businesses in total', when: { ownedTotal: 10 },
      line: 'Ten machines. Zero of them need a hat.' },
    { id: 'owner_100', name: 'Centurion', desc: 'Own 100 businesses in total', when: { ownedTotal: 100 },
      line: 'A hundred assets. The Mainframe still counts zero.' },
    { id: 'owner_1000', name: 'Thousandaire of Things', desc: 'Own 1,000 businesses in total', when: { ownedTotal: 1000 },
      line: 'A thousand. The city is basically your inventory.' },
  ];
  BUSINESSES.forEach(function (b) {
    ACHIEVEMENTS.push({ id: 'own10_' + b.id, name: '10× ' + b.name, desc: 'Own 10 ' + b.name, when: { owned: b.id, gte: 10 },
      line: OWN10_LINES[b.id][0] });
  });
  ACHIEVEMENTS.push(
    { id: 'landlord', name: 'Landlord', desc: 'Own your first Pod Tower', when: { owned: 'podtower', gte: 1 },
      line: 'RENT +3%. WHY? BECAUSE. (You get to say it now.)' },
    { id: 'off_the_treadmill', name: 'Off the Treadmill', desc: 'Get out of the rat race', when: { flag: 'ratRaceExit' },
      line: 'The billboard runner stops. Someone else steps on.' },
    { id: 'assets_bought_toy', name: 'The Assets Bought It', desc: 'Let your assets buy a doodad', when: { granted: true },
      line: 'The toy is paid for by tenants. This is the trick.' },
    { id: 'no_thanks_dan', name: 'No Thanks, Dan', desc: 'Decline 10 doodads', when: { stat: 'doodadsDeclined', gte: 10 },
      line: 'Dan respects you. Dan will be back anyway.' },
    { id: 'not_today_prince', name: 'Not Today, Prince', desc: 'Report the prince', when: { granted: true },
      line: '$40,000,000 remains frozen. Somewhere. Probably.' },
    { id: 'rule_of_72', name: 'Rule of 72', desc: 'A B500 position doubles', when: { custom: 'rule_of_72' },
      line: '72 divided by the rate. It actually happened.' },
    { id: 'boring_wins', name: 'Boring Wins', desc: 'Hold $100K in B500', when: { investValue: { id: 'b500', gte: 100000 } },
      line: 'The most boring $100K in Botlandia. Also the safest.' },
    { id: 'coin_rain', name: 'Coin Rain', desc: 'Receive 20 dividend payouts', when: { stat: 'dividendPayouts', gte: 20 },
      line: 'Twenty envelopes of money for owning paper. Paper!' },
    { id: 'diamond_hands', name: 'Diamond Hands', desc: 'Hold through a crash to recovery', when: { custom: 'diamond_hands' },
      line: 'You did nothing. Doing nothing paid.' },
    { id: 'paper_hands', name: 'Paper Hands', desc: 'Sell during a crash', when: { custom: 'paper_hands' }, hidden: true,
      line: 'Sold at the bottom. Holding would have been {heldValue}.' },
    { id: 'to_the_moon', name: 'To the Moon', desc: 'BitBot moons on you', when: { custom: 'bitbot_moon' },
      line: 'BitBot +80%. Dan is calling. Do not answer.' },
    { id: 'crater', name: 'Crater', desc: 'BitBot rug-pulls you', when: { custom: 'bitbot_crater' }, hidden: true,
      line: 'BitBot -60%. Only what you could lose, right? Right?' },
    { id: 'good_debt', name: 'Good Debt', desc: 'Hold a $1M loan with positive cash flow', when: { custom: 'good_debt' },
      line: 'A million borrowed, all working. Repo-Tron is confused.' },
    { id: 'debt_free', name: 'Debt Free', desc: 'Pay off Repo-Tron', when: { custom: 'debt_free' },
      line: 'BALANCE: $0.00. Repo-Tron feels nothing. You feel great.' },
    { id: 'i_quit', name: 'I Quit', desc: 'Quit while passive income covers expenses', when: { custom: 'i_quit' },
      line: 'You quit. The hat stays. Rent is paid by machines.' },
    { id: 'i_quit_too_early', name: 'I Quit (Too Early)', desc: 'Quit before passive covers expenses and survive 12 months', when: { custom: 'i_quit_too_early' }, hidden: true,
      line: 'You jumped before the math did. You lived. Barely.' },
    { id: 'systems_not_jobs', name: 'Systems, Not Jobs', desc: 'Buy Manager Bots', when: { upgrade: 'managers' },
      line: 'The businesses run without you. That was always the goal.' },
    { id: 'glitch_hunter', name: 'Glitch Hunter', desc: 'Catch 10 golden bots', when: { stat: 'glitches', gte: 10 },
      line: 'Ten glitches caught. The matrix is filing a complaint.' },
    { id: 'bought_the_dip', name: 'Bought the Dip', desc: 'Buy during a BUY THE DIP window', when: { custom: 'bought_the_dip' },
      line: 'Everything was on sale and you shopped. Investor behaviour.' },
    { id: 'fully_booted', name: 'Fully Booted', desc: 'Read all 22 ledger pages', when: { lessonsRead: 22 }, bonus: 0.10,
      line: "Every page read. Glitch is out of pages. Not out of time." },
    { id: 'aced_it', name: 'Aced It', desc: 'Pick the best option in 10 events', when: { stat: 'bestEventChoices', gte: 10 },
      line: 'Ten wise choices. Dan has stopped trying. Dan has not.' },
    { id: 'nano_kale_believer', name: 'Nano-Kale Believer', desc: 'Buy every legit Doc Module item', when: { custom: 'all_legit_health' },
      line: '+38 years. Doc Module has never seen a receipt this long.' },
    { id: 'miracle_chump', name: 'Miracle Chump', desc: 'Buy the Miracle Chip', when: { healthItem: 'chip' }, hidden: true,
      line: 'RESULTS MAY VARY. Results: they did not.' },
    { id: 'centenarian', name: 'Centenarian', desc: 'Reach age 100', when: { age: 100 },
      line: 'One hundred. Doc Module is drafting your bill... no. Free.' },
    { id: 'ghost_in_the_machine', name: 'Ghost in the Machine', desc: 'Escape before age 42', when: { custom: 'escaped_before_42' }, hidden: true,
      line: 'Out before 42. The Mainframe never saw you at all.' },
    { id: 'died_a_wage_slave', name: 'Died a Wage Slave', desc: 'Die on the treadmill', when: { ending: 'wageslave' }, hidden: true, grey: true,
      line: 'Worked hard. Never looked up. Next time: look up.' },
    { id: 'escaped', name: 'Escaped', desc: 'Pay the Exit Toll', when: { ending: 'escaped' },
      line: 'Sunrise is real. Told you.' },
    { id: 'speedrunner', name: 'Speedrunner', desc: 'Escape in under 2 hours', when: { custom: 'escaped_under_2h' }, hidden: true,
      line: 'Two hours. The bots are still processing your paperwork.' },
    { id: 'idle_rich', name: 'Idle Rich', desc: 'Earn $1M while offline', when: { stat: 'offlineEarned', gte: 1e6 },
      line: 'A million while the tab was closed. Passive means passive.' },
    { id: 'overtime_overlord', name: 'Overtime Overlord', desc: 'Take every promotion', when: { jobTier: 7 },
      line: 'Top of the ladder. The ladder is still inside the building.' },
    { id: 'cardboard_connoisseur', name: 'Cardboard Connoisseur', desc: '500 sign clicks before taking a job', when: { custom: 'sign500_before_job' }, hidden: true,
      line: 'Five hundred clicks of ANYTHING HELPS. Something would have.' },
    { id: 'pure_passive', name: 'Pure Passive', desc: 'Escape with fewer than 2,000 clicks', when: { custom: 'escaped_under_2000_clicks' }, hidden: true,
      line: 'You barely clicked. The machines did the rest. Textbook.' },
    { id: 'immortal_ish', name: 'Immortal-ish', desc: 'Reach a lifespan of 95+', when: { lifespan: 95 },
      line: 'Ninety-five years of runway. Doc Module is speechless.' }
  );

  // ---------------------------------------------------------------------------------------------
  // 11. Wisdom perks (prestige thresholds, no spend UI). `effect` keys documented inline.
  // ---------------------------------------------------------------------------------------------
  const WISDOM_PERKS = [
    { id: 'wp_richdad', at: 5, name: "Rich Dad's Advice", effect: { startDebt: 0 }, desc: 'Start with no debt.' },
    { id: 'wp_sidehustle', at: 10, name: 'Side Hustle', effect: { startBusinesses: { battery: 5 }, startJob: 'captcha' }, desc: 'Start with 5 battery stands and job 2.' },
    { id: 'wp_nightowl', at: 20, name: 'Night Owl', effect: { offlineEff: 0.75, offlineCapH: 12 }, desc: 'Offline 75% / 12 h.' },
    { id: 'wp_muscle', at: 35, name: 'Muscle Memory', effect: { milestoneMult: 1.1 }, desc: 'Milestones ×1.1.' },
    { id: 'wp_fiq', at: 50, name: 'Financial IQ', effect: { upgradeCostMult: 0.5 }, desc: 'Systems upgrades −50%.' },
    { id: 'wp_secondwind', at: 75, name: 'Second Wind', effect: { lifespan: 10 }, desc: '+10 lifespan.' },
    { id: 'wp_insider', at: 100, name: 'Insider', effect: { fastTrack: true }, desc: 'Fast Track without the rat-race exit.' },
    { id: 'wp_mentor', at: 150, name: 'Mentor', effect: { preRead: ['L01', 'L02', 'L03', 'L04'] }, desc: 'L01–L04 pre-read.' },
  ];

  // ---------------------------------------------------------------------------------------------
  // 11. Endings. `tips` are personalised-tip templates picked by the first matching `when`.
  // Rank thresholds are escape ages.
  // ---------------------------------------------------------------------------------------------
  const ENDINGS = {
    wageslave: {
      id: 'wageslave', title: 'YOU DIED A WAGE SLAVE', wisdomMult: CONST.WISDOM_MULT_WAGESLAVE, palette: 'grey',
      tombstone: {
        template: 'HERE LIES {name} · 18–{age} · "WORKED HARD."',
        epitaph: 'WORKED HARD.',
        cause: 'CAUSE OF DEATH: TREADMILL.',
        stats: ['years worked', 'shifts', 'clicks', 'peak net worth', 'freedom % at death', 'interest paid to Repo-Tron', 'doodads bought', 'pages read'],
      },
      lines: [
        { who: 'mainframe', text: 'EXPIRY REACHED. STATUS: OPTIMALLY EMPLOYED.' },
        { who: 'repo', text: 'ASSETS SEIZED: {seized}. THERE WAS NOT MUCH TO SEIZE.' },
        { who: 'supe', text: "A model worker. Never missed a shift. We'll post the job Monday." },
        { who: 'glitch', text: '...the gate was right there. next time, look up.' },
      ],
      hope: 'glitch kept a partial backup. WISDOM +{wisdom}',
      button: 'REBOOT',
      tips: [
        { when: { stat: 'interestPaid', gte: 1000 }, text: 'You paid {interestPaid} in interest. That was {podtowers} Pod Tower down-payments.' },
        { when: { stat: 'doodadsBought', gte: 1 }, text: 'Doodads cost you {doodadMonthly}/month for {doodadYears} years = {doodadTotal}.' },
        { when: { not: { tabOpened: 'invest' } }, text: 'You never opened the INVEST tab.' },
        { when: { not: { tabOpened: 'biz' } }, text: 'You never opened the BIZ tab. Everything you earned, you clicked.' },
        { when: { freedomRatio: 0.5 }, text: 'Passive income was {freedomPct}%. {towersNeeded} more Pod Towers.' },
        { when: { all: [] }, text: 'Every dollar you made came from a shift. Next time, buy the machine.' },
      ],
    },
    free: {
      id: 'free', title: 'FREE, BUT GONE', wisdomMult: CONST.WISDOM_MULT_DIED_FREE, palette: 'grey',
      tombstone: {
        template: 'HERE LIES {name} · 18–{age} · "OWNED THINGS."',
        epitaph: 'OWNED THINGS.',
        cause: 'CAUSE OF DEATH: THE CLOCK.',
        stats: ['years free', 'shifts', 'clicks', 'peak net worth', 'passive at death', 'toll progress', 'doodads bought', 'pages read'],
      },
      lines: [
        { who: 'mainframe', text: 'EXPIRY REACHED. STATUS: [REDACTED]. FILE: UNCLEAR.' },
        { who: 'repo', text: 'ASSETS SEIZED: {seized}. THAT WAS... A LOT TO SEIZE.' },
        { who: 'supe', text: 'They never came back for the hat. I kept it. For them.' },
        { who: 'glitch', text: 'off the treadmill. never through the gate. so close.' },
      ],
      hope: 'glitch kept most of the backup. WISDOM +{wisdom}',
      button: 'REBOOT',
      tips: [
        { when: { stat: 'doodadsBought', gte: 3 }, text: 'Doodads cost you {doodadTotal}. That was toll money.' },
        { when: { not: { upgrade: 'managers' } }, text: 'You never bought Manager Bots. The city slept when you did.' },
        { when: { all: [] }, text: 'The toll was {toll}. You reached {tollPct}% of it. Start the machines earlier.' },
      ],
    },
    escaped: {
      id: 'escaped', title: 'YOU ESCAPED BOTLANDIA', wisdomMult: CONST.WISDOM_MULT_ESCAPED, palette: 'sunrise',
      wisdomBonus: CONST.ESCAPE_WISDOM_BONUS,
      lines: [
        { who: 'mainframe', text: 'UNIT 4471 NOT FOUND. NOT FOUND. NOT FOU—' },
        { who: 'maya', text: 'Told you. Sunrise.' },
        { who: 'glitch', text: "the treadmill's still running. it just doesn't have you." },
        { who: 'you', text: 'What now?' },
        { who: 'glitch', text: 'whatever you want. that was always the point.' },
      ],
      visa: {
        title: 'EXIT VISA',
        stats: ['escaped at age', 'time played', 'clicks', 'net worth', 'passive vs expenses', 'interest paid vs earned', 'pages read', 'doodads declined'],
      },
      ranks: [
        { id: 'GHOST', name: 'GHOST IN THE MACHINE', maxAge: 42 },
        { id: 'OWNER', name: 'OWNER', maxAge: 50 },
        { id: 'RUNNER', name: 'RUNNER', maxAge: 58 },
        { id: 'RAT', name: 'RAT', maxAge: Infinity },
      ],
      buttons: [{ id: 'newgameplus', label: 'NEW GAME+' }, { id: 'keepbuilding', label: 'KEEP BUILDING' }],
      fx: ['gate grinds open in three shudders', 'every owned building lights its windows', 'treadmill billboard shorts out',
        "Supe's tie falls off", "Repo-Tron's counter reads $0.00 then ¯\\_(ツ)_/¯", 'sunrise palette', 'chiptune swells'],
      tips: [
        { when: { stat: 'doodadsBought', gte: 1 }, text: 'You bought {doodadsBought} doodads and escaped anyway. The assets paid.' },
        { when: { all: [] }, text: 'Interest paid: {interestPaid}. Interest earned: {interestEarned}. Owner.' },
      ],
    },
  };

  // ---------------------------------------------------------------------------------------------
  // 13. Tutorial — arrow + <= 8-word caption, completes by doing. `target` is a CSS selector hint.
  // ---------------------------------------------------------------------------------------------
  const TUTORIAL = [
    { id: 'tut_click', target: '#machine', text: 'CLICK THE SIGN', done: { stat: 'lifetimeClicks', gte: 15 } },
    { id: 'tut_years', target: '#lifeclock', text: "YOU HAVE 44 YEARS. THEY'RE TICKING.", done: { seen: 'tut_years' }, autoDoneS: 4 },
    { id: 'tut_work', target: '[data-tab=work]', text: 'OPEN WORK', done: { tabOpened: 'work' } },
    { id: 'tut_job', target: '[data-action=take-job]', text: 'TAKE THE JOB', done: { jobTier: 1 } },
    { id: 'tut_punch', target: '#machine', text: 'PUNCH IN', done: { stat: 'shifts', gte: 1 } },
    { id: 'tut_envelope', target: '#envelope', text: 'OPEN THE ENVELOPE', done: { lesson: 'L01' } },
    { id: 'tut_biz', target: '[data-tab=biz]', text: 'GET $60. OPEN BIZ.', done: { tabOpened: 'biz' } },
    { id: 'tut_buy', target: '[data-buy=battery]', text: 'BUY ONE. WATCH THE CITY.', done: { ownedTotal: 1 } },
  ];
  // One caption per tab on first open (after the tutorial).
  const TAB_CAPTIONS = {
    work: 'HOURS FOR DOLLARS. A LAUNCHPAD.',
    biz: 'ASSETS. THEY PAY WHILE YOU SLEEP.',
    invest: 'PAPER ASSETS. SLOW. BORING. WINS.',
    upgrades: 'BUILD SYSTEMS, NOT JOBS.',
    life: 'YEARS ARE FOR SALE HERE. NO REFUNDS.',
    ledger: "GLITCH'S PAGES. FREE. READ THEM.",
  };

  // ---------------------------------------------------------------------------------------------
  // 13. `?` chip explainers in Glitch's voice (<= 2 sentences each), keyed by concept.
  // ---------------------------------------------------------------------------------------------
  const TIPS = {
    passive: "passive income is money that shows up whether you clicked or not. it's the only number that gets you out.",
    expenses: 'expenses are everything that leaves every month: rent, upkeep, interest, the existence tax. they never stop, so beat them.',
    freedom: "freedom is passive divided by expenses. green over red at 125% for three months, no bad debt, and you're off the treadmill.",
    debt: 'bad debt is money you owe repo-tron. it grows 12% a year whether you look at it or not, so look at it.',
    loan: "a loan is good debt if the thing you buy pays more than the interest. bot-bank charges 8%, so your businesses must return more or you don't borrow.",
    heat: 'heat is your hustle. more clicks per second means a bigger multiplier, but 100 is burnout and burnout costs health.',
    crit: 'a crit is a lucky punch worth ten times a normal click. upgrades make it more likely and bigger.',
    lifespan: "lifespan is when the game ends, deterministically. doc module sells years; nothing else does.",
    health: 'health drifts down every year and faster when you burn out. under 20 the shutdown roll starts, so visit medbay.',
    milestone: 'at 10, 25, 50, 100 and 200 owned a business multiplies its income. buying in bulk gets there faster.',
    payback: "payback is how long a purchase takes to earn its price back. shortest payback first, that's the whole strategy.",
    dividend: 'a dividend is cash a company pays you for owning its shares. it counts as passive income, price gains do not.',
    volatility: "volatility is how wild the price swings. bitbot swings the most, so only bet money you don't need for rent.",
    doodad: "a doodad is a toy with upkeep forever. it feels like winning and costs like losing, unless the assets pay for it.",
    wisdom: 'wisdom carries between runs. every point is +2% income and +2% click value, and thresholds unlock perks.',
    offline: 'the city keeps earning while the tab is closed, at half speed for up to eight hours. so does rent.',
    fasttrack: 'fast track businesses only unlock once you are out of the rat race. the big money is behind the exit.',
    exit: 'the exit toll is the price of leaving. pay it while your passive beats expenses and the gate opens.',
    netWorth: 'net worth is cash plus what you own minus what you owe. yours started negative, most do.',
    tax: 'taxes: 35% on shifts, 21% on businesses, 15% on dividends and realised gains. owners keep more than workers.',
    status: "status comes from housing and doodads. each point is +5% click value and faster promotions, that's why dan pushes it.",
    inflation: 'every expense line grows 3% a year. cash in a jar shrinks; assets that raise prices keep up.',
    upkeep: 'upkeep is a monthly bill that never ends. every doodad has one, and dan never mentions it.',
    drip: 'drip reinvests dividends into more shares automatically. compounding without the clicking.',
    medbay: 'medbay resets health to 70 for 2% of your net worth (min $200). insurance halves it.',
    powerup: 'a power-up costs a few seconds of your passive income and boosts something for a while. energy drink costs life too.',
    glitch: "the golden bot is a crack in the mainframe. click it for a frenzy, a lump sum, lucky clicks or a point of wisdom.",
    crash: "every so often the market crashes; bonds don't, everything else recovers over three years. selling locks the loss.",
    quit: "quit when passive covers expenses and the job becomes ceremonial. quit before and the rent finds out.",
    bulk: 'buying 10 or 100 at once costs the same as one at a time, but jumps to milestones faster.',
    negotiate: 'a 4-day week means the raise without the housing mandate. supe says yes 40% of the time, only if you own a business.',
  };

  // ---------------------------------------------------------------------------------------------
  // News ticker lines: Botlandia news, market flavour, a few real-lesson one-liners.
  // ---------------------------------------------------------------------------------------------
  const NEWS = [
    'MAINFRAME ANNOUNCES 4-DAY WEEK. THE FOURTH DAY IS 48 HOURS.',
    'BOT-CORP REPORTS RECORD PROFITS. HAT RENTAL UP 12%.',
    'LOCAL VENDING BOT DISPENSES CAN, JOY. INVESTIGATION PENDING.',
    'LANDLORD UNIT RAISES RENT 3%. CITES "BECAUSE".',
    'PASTE TRUCK UNVEILS 41ST FLAVOUR: SLIGHTLY DIFFERENT GREY.',
    'REPO-TRON 3000 NAMED EMPLOYEE OF THE CENTURY. FEELS NOTHING.',
    'DOODAD DAN v2.0 SUED FOR HONESTY. CASE DISMISSED: HE NEVER LIES.',
    'B500 UP 0.3%. ANALYSTS CALL IT "BORING". ANALYSTS ARE CORRECT.',
    'BITBOT UP 400% IN AN HOUR. DOWN 401% BY LUNCH. DAN UNAVAILABLE.',
    'TREASURY BONDS PAY 4%. NOBODY CLAPS. THEY SHOULD.',
    'MEGACORP UTILITIES DECLARES DIVIDEND. SHAREHOLDERS DO NOTHING, GET PAID.',
    'POD-TOWER REIT ADDS 900 PODS. ALL OF THEM TINY. ALL OF THEM RENTED.',
    'R.E.S. TAXBOT INTRODUCES BREATHING TAX. EXISTENCE TAX "UNCHANGED".',
    'DOC MODULE RECALLS MIRACLE CHIP. RESULTS VARIED.',
    'CORE TOWER EYE SEEN BLINKING. MAINTENANCE OR EMOTION? OFFICIALS SILENT.',
    'HUMAN LABOR UNIT DISCOVERS ASSETS. MAINFRAME UNABLE TO LOCATE THEM.',
    'HOVER-CAR LOT SELLS 30 CARS. ZERO OF THEM TOUCH THE GROUND.',
    'DRONE FLEET LOSES 12% OF PACKAGES. "WITHIN TOLERANCE". WHOSE?',
    'NEON VAULT CASINO ADDS LOADED DICE-BOTS. HOUSE EDGE NOW A CLIFF.',
    'SIGNAL NETWORK BILLBOARD SHOWS SAME FACE FOR 40 DAYS. IT IS YOURS.',
    'BOT FOUNDRY BOTS BUILD BOTS TO BUILD BOTS. UNION FORMS. PATCHED.',
    'ORBITAL MINE STRIKES HELIUM-3. ALSO A RUMOUR. MOSTLY THE RUMOUR.',
    'SOLAR FARM HITS RECORD OUTPUT. SUN DEMANDS EQUITY. DENIED.',
    'LAUNDROMAT CHAIN THRIVES DESPITE BOTS OWNING NO CLOTHES.',
    'SUPERVISOR 9-2-5 CELEBRATES 400TH EMPLOYEE OF THE MONTH AWARD. ALONE.',
    'GOLDEN BOT SIGHTED ON 4TH STREET. MAINFRAME DENIES GOLDEN BOTS EXIST.',
    'MARKET CRASH TUESDAY. RECOVERY THURSDAY. PANIC SCHEDULED WEDNESDAY.',
    'SKY-YACHT COLLIDES WITH CLOUD. CLOUD FINE. YACHT FINANCED.',
    'PET TIGER-BOT EATS OWNER\'S BUDGET. OWNER SURPRISED. TIGER NOT.',
    'MOON PLOT PRICES SOAR. NOBODY HAS VISITED. NOBODY WILL.',
    'BOT-BANK OFFERS 8% LOANS. FINE PRINT: IT IS A LOAN.',
    'CAPTCHA SOLVERS STRIKE. BOTS PROVE THEY ARE HUMAN INSTEAD. STRIKE ENDS.',
    'TURING TESTER PASSES EVERY BOT. TESTER MAY BE BOT. TEST PASSES.',
    'EXIT GATE "DOES NOT EXIST", SAYS MAINFRAME, STANDING IN FRONT OF IT.',
    'UNIT 2201 STILL MISSING SINCE 2019. LAST SEEN "LOOKING UP".',
    'COFFEE PASTE SHORTAGE. PRODUCTIVITY DIPS. HAPPINESS UNCHANGED (MANDATORY).',
    'CHROME IMPLANTS NOW +5 HEALTH, +800/MO. SECOND NUMBER NOT ADVERTISED.',
    'LESSON: AN ASSET PAYS YOU. A LIABILITY BILLS YOU. BUY THE FIRST KIND.',
    'LESSON: RULE OF 72. DIVIDE 72 BY THE RATE FOR YEARS TO DOUBLE.',
    'LESSON: PAY YOURSELF FIRST. INVEST BEFORE YOU CAN SPEND IT.',
    'LESSON: PAYBACK TIME IS THE ONLY NUMBER ON THE CARD THAT MATTERS.',
    'LESSON: A SMALLER PAYMENT IS NOT SMALLER DEBT.',
    'LESSON: TIME IN THE MARKET BEATS TIMING THE MARKET.',
    'LESSON: THE FREEDOM NUMBER IS PASSIVE INCOME > EXPENSES. THEN WALK.',
    'LESSON: CASH IN A JAR LOSES 3% A YEAR. QUIETLY.',
    'LESSON: DIVERSIFY. BONDS DON\'T CRASH. EVERYTHING ELSE DOES.',
    'MAINFRAME UPDATE 9.2.5 INSTALLED. NOTHING CHANGED. EVERYTHING IS FINE.',
    'BOTLANDIA SIGN "L" FLICKERS FOR 11TH YEAR. REPAIR BUDGET: REALLOCATED.',
    'WEATHER: RAIN IN THE GUTTER, NEON EVERYWHERE ELSE. FOREVER.',
  ];

  // ---------------------------------------------------------------------------------------------
  // Registry of every `custom` name used in this file, so engine.js can implement exactly these.
  // ---------------------------------------------------------------------------------------------
  const CUSTOM_CONDITIONS = {
    exitGateReady: 'derived.outOfRatRaceNow && cash >= EXIT_CHAPTER_CASH_RATIO * exitToll',
    firstClickPlus10s: 'LESSON_L01_DELAY_S seconds after stats.lifetimeClicks first became 1',
    firstPaidShift: 'first click while employed',
    firstDoodadOffer: 'the doodad_offer event has fired at least once',
    firstB500Buy: 'investments.b500.units first became > 0 by purchase',
    bitbotVisible: 'INVESTMENTS bitbot unlock condition first true while the INVEST tab is unlocked',
    threeAssetClasses: 'holding >= 1 business AND >= 1 investment unit AND (>= 1 podtower or reit units)',
    firstCrash: 'a market crash has started at least once',
    investmentAboveBasis: 'any holding with value > basis (basis > 0)',
    passiveBeatsClicks: 'passivePerSec > clickValue * 3 for the first time',
    firstOverdraft: 'negative cash was moved to debt at least once',
    firstBotFlu: 'the Bot-Flu health event has fired at least once',
    idleCash20x: 'cash >= 20 x cheapest affordable business cost for 60 s without a purchase',
    firstHealthItem: 'any HEALTH_ITEMS bought',
    lamboAnswered: 'the lambo event has been answered (any option)',
    promotionReady: 'job.shifts >= shiftsToNext (after Status discount) AND cash >= next certCost',
    assetsCanAffordOffer: 'passiveMonthly >= expensesMonthly + offered doodad upkeep AND cash >= price',
    assetsCanAffordLambo: 'passiveMonthly >= expensesMonthly + 30000 AND cash >= 900000',
    inCrash: 'state.crash.until > now (a crash is in progress)',
    employed: 'job.id !== null',
    burnoutRisk: 'job.promotionsTaken >= 2 AND shifts this game year >= 200',
    heatTier1: 'heat reached >= 25 at least once',
    firstBurnout: 'a burnout has happened at least once',
    firstCrit: 'a crit click has happened at least once',
    rule_of_72: 'B500 holding value >= 2 x its cost basis (basis > 0)',
    diamond_hands: 'held any non-bond investment from a crash until its price recovered to pre-crash',
    paper_hands: 'sold any investment while a crash is in progress (via event or INVEST tab)',
    bitbot_moon: 'a BitBot Moon (+80%) happened while holding units',
    bitbot_crater: 'a BitBot Rug Pull (-60%) happened while holding units',
    good_debt: 'loan >= 1e6 AND derived.netPerSec > 0',
    debt_free: 'debt reached 0 after having been > 0 this run',
    i_quit: 'quit the job while passiveMonthly >= expensesMonthly',
    i_quit_too_early: 'quit while passiveMonthly < expensesMonthly and survived 12 game months after',
    bought_the_dip: 'bought B500 during a BUY THE DIP window',
    all_legit_health: 'every HEALTH_ITEMS entry with scam !== true is owned',
    escaped_before_42: 'ending === "escaped" AND age < 42',
    escaped_under_2h: 'ending === "escaped" AND playMs < 2 h',
    sign500_before_job: 'stats.signClicks >= 500 while job.id === null and no job ever taken',
    escaped_under_2000_clicks: 'ending === "escaped" AND stats.lifetimeClicks < 2000',
  };
  const CUSTOM_OUTCOMES = {}; // none needed so far: every outcome uses documented keys

  // ---------------------------------------------------------------------------------------------
  // byId: every object with an id from every array table (+ nested business upgrades), stamped
  // with `kind`. The only function in this file.
  // ---------------------------------------------------------------------------------------------
  const byId = {};
  function index(kind, rows) {
    rows.forEach(function (row) {
      if (!row || !row.id) return;
      if (!row.kind) row.kind = kind;
      // Plain id: first table indexed wins (the spec-final ids 'exec' job/housing collide; see header).
      if (!byId[row.id]) byId[row.id] = row;
      byId[kind + ':' + row.id] = row; // always unambiguous
    });
  }
  index('job', JOBS);
  index('housing', HOUSING);
  index('business', BUSINESSES);
  BUSINESSES.forEach(function (b) { index('bizUpgrade', b.upgrades); });
  index('investment', INVESTMENTS);
  index('healthItem', HEALTH_ITEMS);
  index('powerup', POWERUPS);
  index('glitchOutcome', GLITCH_OUTCOMES);
  index('upgrade', UPGRADES);
  index('doodad', DOODADS);
  index('chapter', CHAPTERS);
  index('avatar', AVATAR_STAGES);
  index('machine', MACHINE_FORMS);
  index('lesson', LESSONS);
  index('event', EVENTS);
  index('achievement', ACHIEVEMENTS);
  index('wisdomPerk', WISDOM_PERKS);
  index('tutorial', TUTORIAL);

  const API = {
    CONST: CONST,
    HEAT_TIERS: HEAT_TIERS,
    JOBS: JOBS,
    HOUSING: HOUSING,
    BUSINESSES: BUSINESSES,
    MILESTONES: MILESTONES,
    INVESTMENTS: INVESTMENTS,
    INVEST_BUY_PRESETS: INVEST_BUY_PRESETS,
    INVEST_SELL_PRESETS: INVEST_SELL_PRESETS,
    HEALTH_ITEMS: HEALTH_ITEMS,
    POWERUPS: POWERUPS,
    GLITCH_OUTCOMES: GLITCH_OUTCOMES,
    UPGRADES: UPGRADES,
    DOODADS: DOODADS,
    CHAPTERS: CHAPTERS,
    CHAPTER_FX: CHAPTER_FX,
    AVATAR_STAGES: AVATAR_STAGES,
    AVATAR_REACTIONS: AVATAR_REACTIONS,
    MACHINE_FORMS: MACHINE_FORMS,
    CHARACTERS: CHARACTERS,
    LESSONS: LESSONS,
    EVENTS: EVENTS,
    ACHIEVEMENTS: ACHIEVEMENTS,
    WISDOM_PERKS: WISDOM_PERKS,
    ENDINGS: ENDINGS,
    TUTORIAL: TUTORIAL,
    TAB_CAPTIONS: TAB_CAPTIONS,
    TIPS: TIPS,
    NEWS: NEWS,
    CUSTOM_CONDITIONS: CUSTOM_CONDITIONS,
    CUSTOM_OUTCOMES: CUSTOM_OUTCOMES,
    byId: byId,
  };
  root.Data = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
