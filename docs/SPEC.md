# ESCAPE BOTLANDIA — Game Specification (v1)

> An 8-bit incremental ("cookie clicker") game about cash flow. You wake up homeless and in debt in
> **Botlandia**, a city run by bots where humans live on the **Wage Treadmill**. Work a job to get
> capital, buy cash-flow businesses, invest, dodge the doodads, extend your life, get **out of the
> rat race** (passive income > expenses) and pay the **Exit Toll** before your time runs out.
> Or die a wage slave. Lessons come from *Rich Dad Poor Dad*, the *Cashflow* board game and
> *Build Your Stax*, delivered by characters with motives, never by walls of text.

This document is the single source of truth for the implementation. Section 12 is the exact module
contract that lets `data.js`, `engine.js`, `sprites*.js`, `scene.js`, `audio.js`, `ui.js` and
`main.js` be written independently. **Every ID in this document is final; use it verbatim.**

---

## 0. Design pillars

1. **Every click is a tiny fireworks show.** Squash, coins, a number that pops, a chunky sound.
2. **The city is the progress bar.** Botlandia visibly fills with *your* stuff; the little "you" on
   the Treadmill billboard slows down as passive income catches up with expenses.
3. **Time is the villain.** A beating pixel heart with your age and years left is always visible.
4. **The lesson is the loop.** Clicking = trading time for money (the trap). Passive income = the escape.
5. **Explain once, in character, in two sentences.** A `?` chip opens a Glitch bubble; every shop card
   tooltip shows the formula in plain words, the payback time and a one-line lesson.
6. **Mistakes are allowed.** Buy the Bot-Lambo, sell at the bottom, quit too early: the game lets you,
   then shows the "what if" within seconds. Paired achievements for both sides of a choice.

---

## 1. Core constants (`Data.CONST`)

| Key | Value | Meaning |
|---|---|---|
| `SEC_PER_YEAR` | 150 | one game year = 150 real seconds of active play (month = 12.5 s) |
| `SEC_PER_MONTH` | 12.5 | expenses/interest/dividends are *accounted* monthly but *charged per tick* |
| `SEC_PER_WEEK` | 3 | investment price tick |
| `START_AGE` | 18 | |
| `BASE_LIFESPAN` | 62 | → 44 years = 110 min of active play with no health purchases |
| `MAX_AGE` | 100 | hard cap on lifespan |
| `START_CASH` | 0 | |
| `START_DEBT` | 2000 | "Vagrancy Fine + Processing Fee", owed to Repo-Tron 3000 |
| `DEBT_APR` | 0.12 | bad debt, compounds monthly (`balance *= 1 + APR/12`) |
| `LOAN_APR` | 0.08 | Bot-Bank good debt |
| `INFLATION` | 0.03 | per year, applied monthly to every expense line |
| `TAX_JOB` | 0.35 | earned income |
| `TAX_BIZ` | 0.21 | business cash flow (0.18 after lesson L14) |
| `TAX_DIV` | 0.15 | dividends / coupons |
| `TAX_GAIN` | 0.15 | realized capital gains only (0.10 after lesson L13) |
| `EXISTENCE_TAX` | 10 | $/month "Human Existence Tax", always charged |
| `START_HEALTH` | 60 | 0..100 |
| `HEAT_PER_CLICK` | 2.0 | hustle meter |
| `HEAT_DECAY_PER_SEC` | 3.0 | |
| `BURNOUT_LOCK_MS` | 8000 | |
| `BURNOUT_HEALTH` | 2 | health lost per burnout |
| `CRIT_CHANCE` | 0.03 | base; upgrades raise to 0.06 / 0.12 |
| `CRIT_MULT` | 10 | base; upgrade raises to 25 |
| `RAT_RACE_RATIO` | 1.25 | passive ≥ 1.25 × expenses |
| `RAT_RACE_MONTHS` | 3 | consecutive months required |
| `EXIT_TOLL_BASE` | 1e12 | $1T on run 1 (tune with `tools/sim.js`) |
| `EXIT_TOLL_RUN_MULT` | 3 | toll ×3 per completed run |
| `OFFLINE_CAP_H` | 8 | 12 with the Night Owl upgrade / 20 Wisdom |
| `OFFLINE_EFF` | 0.5 | 0.75 with Night Owl |
| `OFFLINE_AGE_RATE` | 0.25 | you age at quarter speed while away, never past `lifespan − 1` |
| `GLITCH_MIN_S` / `GLITCH_MAX_S` | 180 / 420 | Golden Bot event interval |
| `GLITCH_DURATION_S` | 12 | |
| `EVENT_MIN_GAP_S` | 90 | minimum gap between choice events |
| `DOODAD_OFFER_GAP_S` | 300 | Doodad Dan offer interval (×1.3 after lesson L06) |
| `MEDBAY_MIN` | 200 | Medbay cost = max(200, 2% net worth) → health 70 |
| `SHUTDOWN_CHANCE_MONTH` | 0.04 | fatal roll per month while health < 20 |
| `TICK_MS` | 100 | logic tick |
| `AUTOSAVE_MS` | 10000 | |

Game clock: `gameSeconds` accumulates only while the tab is active (plus credited offline time).
`age = START_AGE + gameSeconds / SEC_PER_YEAR`. Display "AGE 34" and "28 YRS LEFT".

Day/night is **purely cosmetic**: a 90 s cycle in `scene.js` (not tied to the calendar).

---

## 2. Money model

- `cash` (spendable, can go negative only transiently: at the end of a tick any negative cash is moved
  into `debt` — "the overdraft"), `debt` (bad debt, Repo-Tron), `loan` (good debt, Bot-Bank).
- **Net worth** = cash + business book value (sum of what you paid) + investment value − debt − loan.
  It is **negative at the start** (−$2,000): the top bar shows it in red.
- **Income lines** (all per second, gross → net):
  - Clicks: `jobGross × (1 − TAX_JOB) × clickMult` (earned income, taxed hardest).
  - Businesses: `Σ baseIncome × owned × milestoneMult × upgradeMult × bizGlobalMult × (1 − TAX_BIZ)`.
  - Dividends/coupons: monthly `units × price × yield / 12 × (1 − TAX_DIV)`, charged smoothly per tick.
  - Realized gains on sale: `(proceeds − costBasis) × TAX_GAIN` if positive.
- **Passive income** (the thing that gets you out of the rat race) = businesses net + dividends net.
  Price gains never count. Click income never counts.
- **Expenses per month** = `housing.rent + Σ doodad.upkeep + Σ healthItem.upkeep + EXISTENCE_TAX`
  all × `inflationMult`, plus `debt × DEBT_APR/12` and `loan × LOAN_APR/12` (interest lines).
  Charged per tick as `monthly / SEC_PER_MONTH × dt`. A "MONTH END" ledger toast summarises once per month
  only if something changed (rent rise, interest ≥ $1, dividends).
- **Multiplier order** for business income: base → owned → milestone → upgrades → lessons (×1.25 each)
  → wisdom (1 + 0.02 × wisdom) → achievements (1 + 0.01 × n) → power-ups → events → tax.

Number formatting (`Engine.fmtMoney`): `$0.40` (cents when |n| < 100), `$1,234` (< 1e6),
`$1.23M`, `$45.6B`, `$7.89T`, then `Qa Qi Sx Sp Oc No Dc`, beyond that `$1.23e36`. Negative keeps the sign:
`-$2,000`. `fmt(n)` is the same without `$`. `fmtTime(sec)` → `4m 20s`, `1h 05m`, `12s`.

---

## 3. Jobs, clicking, the Hustle Meter

### 3.1 Job ladder (`Data.JOBS`) — "golden handcuffs"

Every promotion mandates a **minimum housing tier** (rent goes up with the raise). Promotion requires
shifts at the current job **and** paying a "Bot-Compliance Retraining" certificate; it is *offered* by
Supervisor 9-2-5 as a choice event (`promotion`) the moment both are met (accept / decline / negotiate).

| # | id | Job | Gross $/click | Shifts to unlock next | Cert cost | Mandated housing |
|---|---|---|---|---|---|---|
| 1 | `scrap` | Scrap Sorter | 5 | 60 | 0 | `cardboard` |
| 2 | `captcha` | Captcha Solver | 14 | 150 | 100 | `sleeping` |
| 3 | `labeler` | Data Labeler | 40 | 250 | 800 | `sleeping` |
| 4 | `drone` | Drone Delivery Runner | 120 | 350 | 6,000 | `micro` |
| 5 | `turing` | Turing Tester | 400 | 450 | 50,000 | `micro` |
| 6 | `manager` | Bot-Corp Middle Manager | 1,400 | 600 | 400,000 | `condo` |
| 7 | `exec` | Compliance Executive | 4,000 | — | 3,000,000 | `exec` |

- Taking the first job (`scrap`) is free and instant (tutorial). Jobs are only unlocked in order.
- **Quit Job** always available (with a confirm + Supe's meltdown). Quitting lifts the housing mandate.
  After quitting the button becomes the **Hands-On Owner** hustle: each click yields
  `1% of gross passive per second` (min $1) — clicking stays alive but is clearly ceremonial.
- **Status** (from doodads/housing): each point = +5% click value and −5% shifts to promote (max 50%).
- Every 100 shifts at job tier ≥ 4 → health −1 ("Grind Fatigue" toast).

### 3.2 Housing (`Data.HOUSING`)

| id | Name | Rent/mo | Health drift/yr | Click mult | Status |
|---|---|---|---|---|---|
| `cardboard` | Cardboard Pod | 25 | −3 | 1.00 | 0 |
| `sleeping` | Sleeping Pod | 150 | −1 | 1.05 | 0 |
| `micro` | Micro-Apartment | 800 | 0 | 1.10 | 0 |
| `condo` | Condo | 6,000 | +1 | 1.15 | 1 |
| `exec` | Exec Suite | 50,000 | +2 | 1.25 | 2 |

The player may upgrade housing voluntarily (LIFE tab) and may downgrade only to the tier their job
mandates (or any tier when unemployed). Landlord Unit raises rent 3%/yr (inflation) with a line.

### 3.3 Clicking

```
clickValue = jobGross × (1 − TAX_JOB) × heatMult(heat) × (crit ? CRIT_MULT : 1)
           × (1 + 0.05 × status) × housing.clickMult × (1 + 0.02 × wisdom) × powerupClickMult × lessonL02
```
When unemployed: `clickValue = max(1, 0.01 × grossPassivePerSec) × heatMult × crit × powerupClickMult`.

**Hustle Meter ("heat")** — one value 0..100:
- `+HEAT_PER_CLICK` per click, `−HEAT_DECAY_PER_SEC × dt` continuously.
- Tiers: heat < 25 → ×1 (grey) · 25 → **HUSTLIN'** ×1.5 (yellow) · 50 → **ON FIRE** ×2 (orange, flame
  pixels on the Machine) · 75 → **OVERTIME** ×3 (red, the Bot-Corp eye on the clock turns angry).
- At 100 → **BURNOUT**: heat resets to 0, `health −= BURNOUT_HEALTH`, clicks disabled for
  `BURNOUT_LOCK_MS` (the avatar sits down, steam particles). First time: Glitch says
  "machines don't burn out. buy machines." Skill: pace clicks at ~1.5/s to ride OVERTIME forever.
- Auto-clicks (Hire a Clone) produce **no heat**.
- Click SFX pitch rises one semitone per 8 heat (up to +12).

**Crit**: `CRIT_CHANCE` for ×`CRIT_MULT` ("JACKPOT" stamp, golden coin shower).

---

## 4. Businesses (`Data.BUSINESSES`) — 14 assets in 5 tiers

Formulas (pure, in `engine.js`):
```
cost(b, owned)               = b.baseCost × b.costMult^owned
bulkCost(b, owned, qty)      = b.baseCost × b.costMult^owned × (b.costMult^qty − 1) / (b.costMult − 1)
maxAffordable(b, owned, cash)= floor( log( cash × (b.costMult − 1) / (b.baseCost × b.costMult^owned) + 1 ) / log(b.costMult) )
milestoneMult(owned)         = Π over Data.MILESTONES [[10,1.5],[25,1.5],[50,2],[100,2],[200,3]]   // max ×13.5
upgradeMult(levels)          = 1.5^levels (0..3)
grossPerSec(b)               = b.baseIncome × owned × milestoneMult × upgradeMult × bizGlobalMult
netPerSec(b)                 = grossPerSec × (1 − taxBiz)
```
Prices shown in the shop are after the Negotiator discount (−3%/level, max 3 levels) and the lesson L04
first-purchase discount.

Per-business upgrades: 3 levels, cost `baseCost × 15 / 150 / 1,500`, require `5 / 25 / 50` owned, ×1.5 each.
A business card is visible (greyed "???", showing its price) once you own ≥ 1 of the previous tier
**or** have cash ≥ 50% of its cost; the first tier is always visible. Tiers 8–14 additionally require
**Out of the Rat Race** ("FAST TRACK" lock icon and explanation) — or Wisdom ≥ 100.

| # | id | Business | Base cost | Base gross $/s | Cost mult | Fast Track | City animation | Upgrades (3) |
|---|---|---|---|---|---|---|---|---|
| 1 | `battery` | Bootleg Battery Stand | 60 | 0.40 | 1.15 | no | tiny stall, blinking battery icon; +1 stall per 5 owned (cap 4) | Solar Trickle-Charger / Bulk Cells / Neon Sign |
| 2 | `vending` | Vending Bot | 350 | 2 | 1.15 | no | vending machine glows; customer bot walks up, can drops | Snack Restock / Card Reader / Talking Bot |
| 3 | `laundro` | Wash-o-Tron Laundromat | 2,000 | 10 | 1.15 | no | storefront with spinning porthole drums (4 frames) | Industrial Dryers / 24h Bot Attendant / Detergent Subscription |
| 4 | `truck` | Paste Truck | 12,000 | 50 | 1.15 | no | food truck, steam puffs, spatula flips; at 10+ a second truck drives by | Flavor Cartridges / Franchise Recipe / Delivery Drone |
| 5 | `carlot` | Hover-Car Lot | 70,000 | 250 | 1.14 | no | lot with cars; **8-bit hover-cars drive across the road**, 1 moving per 5 owned (cap 8) | Chrome Detailing / Financing Desk / Auction Bot |
| 6 | `podtower` | Pod Tower (apartments) | 400,000 | 1,250 | 1.14 | no | apartment block that **grows a floor per 10 owned** (cap 12) with a crane; windows light at dusk | Roof Garden / Rent-Bot Manager / Sky-Bridge |
| 7 | `datafarm` | Data Farm | 2.2M | 6,000 | 1.14 | no | server building, scrolling green LEDs, cyan glow at night | Liquid Cooling / Fiber Backbone / AI Tenant |
| 8 | `drones` | Drone Fleet Logistics | 12M | 30,000 | 1.13 | **yes** | drones cross the sky carrying boxes, 1 per 10 owned (cap 6) | Swarm Routing / Night Shift / Cargo Blimp |
| 9 | `repair` | Bot Repair Franchise | 65M | 145,000 | 1.13 | yes | garage with welding sparks; broken bots queue, fixed bots leave smiling | Spare-Parts Depot / Warranty Scheme / Franchise Expansion |
| 10 | `solar` | Solar Farm | 350M | 700,000 | 1.13 | yes | panel field on the hill; sun-glint sweep by day | Tracking Mounts / Battery Bank / Grid Contract |
| 11 | `casino` | Neon Vault Casino | 1.8B | 3.3M | 1.12 | yes | flashing marquee, gambling bot silhouettes | Loaded Dice-Bots / VIP Lounge / Crypto Cage |
| 12 | `signal` | Signal Network | 9B | 15M | 1.12 | yes | broadcast tower with pulsing rings; billboard shows your avatar | Ad-Bot Engine / Streaming Rights / Propaganda Channel |
| 13 | `foundry` | Bot Foundry | 45B | 70M | 1.12 | yes | smokestacks; new bots march off the line onto the street | Self-Replication / Firmware Licensing / Unionbuster Patch |
| 14 | `orbital` | Orbital Mine | 220B | 320M | 1.11 | yes | asteroid over the city; cargo pods drop on parachutes | Mass Driver / Asteroid Tug / Helium-3 Contract |

Each business also carries `blurb` (one line, funny) and `lesson` (one line shown in the tooltip, e.g.
"An asset puts money in your pocket while you sleep.").

**Milestone banner** at 10/25/50/100/200 owned: "MILESTONE ×1.5", parade in the city, +30 s ×2 for that business.

---

## 5. Investments (`Data.INVESTMENTS`), debt and loans

Prices step every `SEC_PER_WEEK` with a seeded **mulberry32** RNG stored in the save (`state.seed`,
`state.rngCalls`), geometric Brownian motion: `price *= exp((mu − sigma²/2)·dt + sigma·√dt·z)`, `dt = 1/52`,
`z` from Box–Muller. 52-point price history kept per asset for sparklines.

| id | Ticker | Name | Start | μ/yr | σ/yr | Yield/yr | Unlock | Extra |
|---|---|---|---|---|---|---|---|---|
| `b500` | B500 | Bot-500 Index Fund | 100 | +8% | 15% | 0 | INVEST tab | crash −25% |
| `mcu` | MCU | MegaCorp Utilities | 50 | +3% | 18% | 5% | INVEST tab | 2%/yr chance dividend cut (yield 2.5% for 1 yr) |
| `bond` | BOND | Botlandia Treasury Bond | 1,000 | 0% | 2% | 4% | INVEST tab | **immune to crashes**; can never fall below 95% of start |
| `reit` | REIT | Pod-Tower REIT | 25 | +4% | 22% | 7% | own ≥ 1 `podtower` | crash −35% |
| `bitbot` | BBT | BitBot | 10 | +20% | 90% | 0 | job ≥ 4 or net worth ≥ $50k | weekly 1% Rug Pull (−60%), 1% Moon (+80%); crash −50% |

Buy presets: `$100 · $1K · 10% cash · 50% cash · MAX`; sell presets `25% · 50% · ALL`. Cards show units,
value, cost basis, unrealized gain (green/red), yield/mo, and the 52-week sparkline. Dividends count as
passive; the lesson tooltip says so. **DRIP** toggle (after L09) auto-reinvests dividends.

**Market Crash** (world event, only once you own any investment; every 8–15 min): sky goes storm-green,
lightning strikes the Core Tower, all assets drop by their crash factor, then a **20-second BUY THE DIP**
window (orange banner, B500 30% cheaper). Prices recover with +15% drift over the next 3 game years.
Diversification lesson (L12) softens crashes by 20%. Bonds untouched.

### Debt (`state.debt`, bad) and loans (`state.loan`, good)
- Repo-Tron patrols the street while `debt > 0`; its LED shows the balance. Interest 12%/yr (10% after L01),
  compounding monthly. `payDebt(amount)` any time; presets `$100 · 50% · ALL`.
- Overdraft: negative cash at the end of a tick is moved to `debt` (toast "OVERDRAFT → Repo-Tron").
- **Bot-Bank** (unlocked by reading L11): `loanCapacity = 0.5 × businessBookValue − loan`; APR 8% (7% after L11).
  Panel shows "Your businesses return X%/yr on cost vs 8% loan → leverage is +Y%" in green/red.
  **Repossession**: if cash < 0 at 3 consecutive month-ends while `loan > 0`, the bank sells your newest
  businesses worth 1.5× the shortfall (toast + Repo-Tron line "I HAVE BROUGHT A FORKLIFT.").
- **Out of the rat race requires `debt == 0`**; `loan` may be nonzero.

---

## 6. Expenses, doodads, lifestyle — the Rat Race

- Doodad Dan pops up every `DOODAD_OFFER_GAP_S` with a random unowned doodad as a choice event
  (`doodad_offer`), 8-second pitch, options: **Buy** / **Decline** / **"Let the assets buy it"** (only shown
  when `passiveMonthly ≥ expensesMonthly + upkeep`; achievement `assets_bought_toy`).
- Every doodad card shows "UPKEEP +$X/mo FOREVER" in red and its Status perk. Sellable at 30% (50% after L22).
  Each appears as a **cosmetic in the city** (`cosmetic` key).

| id | Doodad | Price | Upkeep/mo | Status | Cosmetic |
|---|---|---|---|---|---|
| `hoverbike` | Hover-Bike | 3,000 | 100 | 1 | bike parked by your building |
| `implants` | Chrome Implants | 25,000 | 800 | 1 (+5 health once) | avatar sparkle |
| `butler` | Bot Butler | 40,000 | 2,000 | 2 | butler bot follows avatar |
| `exosuit` | Designer Exo-Suit | 250,000 | 10,000 | 2 | avatar gold trim |
| `lambo` | Bot-Lambo | 900,000 | 30,000 | 3 | red lambo parked outside, revs |
| `yacht` | Sky-Yacht | 5,000,000 | 150,000 | 3 | yacht floats across the sky |
| `tiger` | Pet Tiger-Bot | 50,000,000 | 1,500,000 | 4 | tiger-bot walks beside avatar |
| `moonplot` | Private Moon Plot | 2,000,000,000 | 50,000,000 | 6 | flag on the moon |

**Freedom meter** (top bar, from Ch4): `freedomRatio = passiveMonthly / expensesMonthly`, shown as a green
bar over a red bar with "PASSIVE $X/mo vs EXPENSES $Y/mo — 83%". Tooltip: "Green ≥ red × 1.25 for 3 months
and zero bad debt = you're out of the rat race."

**Out of the rat race** (`state.flags.ratRaceExit`): `debt === 0 && freedomRatio ≥ RAT_RACE_RATIO` at
`RAT_RACE_MONTHS` consecutive month-ends. Fires chapter 7, the treadmill sprite steps off, Fast Track unlocks,
Quit-Job nudge. If the ratio later drops below 1.0 the status is **kept** (chapter 7 doesn't regress) but
`derived.outOfRatRaceNow` is false and the Exit cannot be paid until it is true again.

---

## 7. Lifespan, health, death

- `lifespan = BASE_LIFESPAN + Σ healthItem.years + lessonL18(0.5) + wisdomPerk75(10) + eventYears`, capped `MAX_AGE`.
- **Death is deterministic** at `age ≥ lifespan`. Always shown: beating pixel heart + "AGE 34 · 28 YRS LEFT".
  Heart beat rate tied to years left (calm > 20, brisk < 10, frantic < 3). Bar colour green/amber (<10)/red (<5).
  Telegraphing: Doc Module line at 10 years left; horizon turns red at 5; at 1 year Glitch: "hey. look up."
- **Health** 0..100. Yearly drift: −1 base, −1 more after age 50, −2 more after 70, + housing drift, + Gym (+2),
  + Nanobots (+1); Gene Reweave removes the age-related drift. Applied continuously per tick.
- Health < 20 = **CRITICAL**: red vignette, heartbeat SFX, "SEEK MEDBAY" banner in the LIFE tab and top bar.
  The **only random death**: `SHUTDOWN_CHANCE_MONTH` per month-end while health < 20 ("SUDDEN SHUTDOWN").
- **Medbay** (LIFE tab, always available): cost `max(MEDBAY_MIN, 2% × netWorth)` (halved with Insurance) → health 70.
- Burnout −2 health; Grind Fatigue −1 per 100 shifts at job ≥ 4; Chrome Implants +5 once.

### Doc Module's ladder (`Data.HEALTH_ITEMS`, one-time each; visible from Ch4 so the deadline is telegraphed)

| id | Item | Cost | Upkeep/mo | +Years | Other |
|---|---|---|---|---|---|
| `gym` | Gym Membership | 400 | 20 | +2 | health +2/yr |
| `insurance` | Health Insurance | 2,000 | 60 | +3 | Medbay & Bot-Flu costs ×0.5 |
| `checkups` | Bot-Doctor Checkups | 25,000 | 0 | +4 | Bot-Flu chance ×0.5 |
| `organs` | Organ Printing | 400,000 | 0 | +5 | sets health to max(health, 80) |
| `nanobots` | Nanobot Bloodstream | 8,000,000 | 0 | +6 | health drift +1/yr |
| `genes` | Gene Reweave | 150,000,000 | 0 | +8 | removes age-related drift |
| `cryo` | Cryo-Chamber | 3,000,000,000 | 0 | +10 | — |
| `chip` | Miracle Chip™ | 500 | 0 | **+0** | scam: "RESULTS MAY VARY"; achievement `miracle_chump`; Glitch: "if it's ten times cheaper and five times better, it's neither." |

Total legit +38 → max age 100 exactly. A pure job grinder (≈ $4–8k/s net at the top of the ladder) can
afford through Nanobots (+20 → dies at 82 ≈ 160 min) but never Gene Reweave or the Exit: **the grinder
always dies a wage slave, and sees it coming for an hour.**

Random health events (rolled monthly with the seeded RNG): **Bot-Flu** `0.01 + 0.03 × (1 − health/100)`
→ pay 2 months of expenses, health −5; **Second Wind** `0.01 × health/100` → +1 lifespan year.

### Offline
On load: `delta = min(now − lastSeen, OFFLINE_CAP_H × 3600)` seconds. Earn `passiveNet × delta × OFFLINE_EFF`,
charge expenses for `delta` seconds, advance investments `delta / SEC_PER_WEEK` ticks, pay dividends,
age `delta × OFFLINE_AGE_RATE / SEC_PER_YEAR` years clamped to `lifespan − 1`. The **WHILE YOU WERE AWAY** card
states earned, spent, and "You aged 2.1 years." (Glitch: "passive income works while you sleep. so does rent.")

---

## 8. Power-ups (`Data.POWERUPS`) and Systems upgrades (`Data.UPGRADES`)

Power-up cost = `max(minCost, costSeconds × grossPassivePerSec)` — always "N seconds of income".

| id | Power-up | Effect | Duration | Cooldown | Cost | Life cost |
|---|---|---|---|---|---|---|
| `overclock` | Overclock | click ×5 | 30 s | 5 min | 120 s (min $50) | — |
| `strike` | Bot Strike | all businesses ×3 | 60 s | 10 min | 180 s (min $200) | — |
| `taxholiday` | Tax Holiday | all taxes 0% | 120 s | 15 min | 240 s (min $500) | — |
| `coffee` | Coffee Paste | heat → 0, no heat gain for 30 s | 30 s | 3 min | $20 × jobTier (min $20) | — |
| `energy` | Energy Drink | click ×2 | 30 s | 2 min | 30 s (min $10) | **−0.1 year** (shown on card) |

**Golden Bot — "GLITCH IN THE MATRIX"** (free): every 3–7 min a screen tear, then a sparkling golden bot
walks across the street for 12 s. Click it: 50% **FRENZY** (all income ×7 for 40 s), 35% lump sum
(15% of passive × 120 s, min $25), 12% **LUCKY SHIFT** (next 20 clicks ×20), 3% "you saw the code" (+1 Wisdom).

Systems upgrades (UPGRADES tab; costs ×0.5 with Wisdom ≥ 50):

| id | Upgrade | Cost | Effect |
|---|---|---|---|
| `clone1` / `clone2` / `clone3` | Hire a Clone I/II/III | 5,000 / 250,000 / 25M | auto-clicks 1 / 3 / 8 per s (no heat); a robot arm sprouts from the Machine |
| `crit1` / `crit2` | Lucky Punch I/II | 2,000 / 200,000 | crit chance 6% / 12% |
| `crit3` | Jackpot | 5M | crit ×25 |
| `negotiator1..3` | Negotiator I–III | 20,000 / 2M / 200M | all business prices −3% per level |
| `accountant` | Accountant Bot | 100,000 | all taxes −3 points; auto-passes Tax Season |
| `managers` | Manager Bots | 1,000,000 | businesses run at 100% offline; unlocks lesson L19 |
| `nightowl` | Night Owl Protocol | 5,000,000 | offline 75% / 12 h |
| `autobuy` | Auto-Buy Bot | 50,000,000 | toggle per business: auto-buys when affordable (keeps a 2-minute cash cushion) |

---

## 9. Story, characters, chapters

### 9.1 World
Botlandia is run by **THE MAINFRAME**, which manages every human as a "Labor Unit". Humans get a serial
number, a cot and a spot on the **WAGE TREADMILL**. The Mainframe has one blind spot: it only counts
*labor*. It cannot count what a human *owns*. That is the exploit. That is the escape.

Tone rules: dialogue lines ≤ 60 characters, ≤ 3 lines per box, Earthbound + Papers Please. Satire targets
the system and the bots, never the player. Every lesson comes from a character with a motive.

### 9.2 Cast (`Data.CHARACTERS`)
| id | Name | Role | Voice |
|---|---|---|---|
| `mainframe` | THE MAINFRAME | the system | ALL CAPS, clipped, status codes |
| `glitch` | Glitch | mentor (the "Rich Dad"): rogue vending-machine-repair bot with a cracked smiley screen | lowercase, dry, warm |
| `supe` | Supervisor 9-2-5 | the "Poor Dad"/boss: beige bot with a painted tie; kind and wrong | corporate jargon |
| `repo` | Repo-Tron 3000 | debt collector: tank treads, claw, red LED counter | ALL CAPS, countdowns |
| `dan` | Doodad Dan v2.0 | salesman: chrome, rotating hat, tablet; never lies, never mentions the monthly cost | "Friend!", exclamation marks |
| `doc` | Doc Module | vending-machine-shaped medical bot | clinical, "NO REFUNDS." |
| `res` | R.E.S. TaxBot | Revenue Extraction Service | "EXTRACTING." |
| `landlord` | Landlord Unit L-0RD | rent | "RENT +3%. WHY? BECAUSE." |
| `maya` | Maya (Unit 2201) | escaped human at the Exit Gate (Ch8 only) | calm, human |

Sample lines live in `Data.CHARACTERS[id].lines` (ambient) and in chapter scenes/events.

### 9.3 Chapters (`Data.CHAPTERS`) — 8 chapters, 6 Machine forms, 7 avatar stages

| Ch | id | Title | Unlock (`Engine.chapterFor`) | Machine form | Avatar stage | Status label | Unlocks |
|---|---|---|---|---|---|---|---|
| 1 | `wakeup` | WAKE UP, 4471 | new game | `sign` (cardboard "ANYTHING HELPS") | `vagrant` | VAGRANT | clicking, debt meter, life clock |
| 2 | `punchin` | PUNCH IN | lifetimeClicks ≥ 15 | `clock` (Bot-Corp punch clock) | `wageslave` | LABOR UNIT | WORK tab, first job, R.E.S. tax chunk, housing rent |
| 3 | `sidehustle` | THE SIDE HUSTLE | first business owned (BIZ tab appears at cash ≥ $40) | `register` (cash register) | `hustler` | SIDE-HUSTLER | BIZ tab, LEDGER tab, city district |
| 4 | `treadmill` | THE TREADMILL | net worth ≥ $5,000 | `register` | `hustler` | TREADMILL RUNNER | Freedom meter, LIFE tab (housing, doodads, Doc Module, Medbay), UPGRADES tab, Doodad Dan, Landlord, Treadmill billboard |
| 5 | `paper` | PAPER ASSETS | net worth ≥ $25,000 | `vault` (vault door) | `owner` | OWNER | INVEST tab (B500, MCU, BOND, BitBot), Bot-Bank lesson |
| 6 | `bricks` | BRICKS | own ≥ 1 `podtower` or net worth ≥ $300,000 | `vault` | `investor` | INVESTOR | REIT, Bot-Bank leverage, Data Farm visible |
| 7 | `offtreadmill` | OFF THE TREADMILL | `flags.ratRaceExit` | `core` (golden core) | `tycoon` | [REDACTED] | Fast Track tiers 8–14, Quit-Job nudge, Managers |
| 8 | `exitgate` | THE EXIT GATE | out of rat race now AND cash ≥ 10% of Exit Toll | `lever` (exit lever) | `tycoon` | [REDACTED] | Exit Gate appears in the city; EXIT button (pay toll) |

Chapter transition: diagonal scanline wipe, banner "CHAPTER N — TITLE", 4-note fanfare, avatar flash,
Machine transformation cutscene (old form shakes, sparks, blackout, new form drops in with a thud), then the
chapter's dialogue scene (blocking, tap to advance, ≤ 5 lines). Ch1's first line types out over a black screen.

Chapter scenes (verbatim in `Data.CHAPTERS[i].scene`, each `{ who, text }`):
- **Ch1**: mainframe "WAKE UP, LABOR UNIT 4471. STATUS: VAGRANT." → repo "BALANCE: -$2,000. INTEREST: TICKING. HAVE A NICE DAY." → glitch "psst. the sign works. a job works faster."
- **Ch2**: supe "Welcome to Bot-Corp! Safety. Stability. Shifts." → supe "$5 per shift. Minus tax. Minus hat rental." → you "Hat rental?" → supe "The hat is a privilege, 4471." → glitch "take the job. keep the cash. i'll show you the trick."
- **Ch3**: glitch "here. battery stand. it's ugly. it pays while you sleep." → you "That's nothing." → glitch "it's money you didn't work for. buy ten. then it's something." → glitch "the sign was you. the job was you. this is not you."
- **Ch4**: landlord "RENT +3%. WHY? BECAUSE." → dan "Friend! Bot-Lambo! 0% down! You've EARNED it!" → you "I have $5,000. I feel rich." → glitch "you have $5,000 and rent going out. you're on the treadmill." → glitch "watch the billboard. that's you. get off it."
- **Ch5**: glitch "vending machines need refilling. this doesn't." → glitch "index fund. a slice of every bot company. it grows." → you "How fast?" → glitch "72 divided by the rate. 8% doubles in 9 years." → supe "Investing is gambling. Now, about overtime..."
- **Ch6**: glitch "now the real trick. the bank lends you money to buy an asset." → glitch "tenants pay the bank. you keep the difference." → repo "LOAN APPROVED. ...THIS FEELS DIFFERENT. I AM UNSETTLED." → glitch "good debt buys assets. bad debt buys lambos."
- **Ch7**: mainframe "ERROR. UNIT 4471 PASSIVE INCOME EXCEEDS EXPENSES." → mainframe "RECLASSIFYING... STATUS: [REDACTED]" → supe "You're LEAVING? But you had... a desk." → glitch "told you. now build systems. hire bots. own the treadmill."
- **Ch8**: maya "I paid the toll in 2019. Sunrise is real. Come see." → mainframe "EXIT TOLL: $1T. PASSIVE INCOME WILL BE... UNCOUNTED." → glitch "it never counted it anyway. that was the whole point." → you "What's out there?" → glitch "time. all of it. yours."

### 9.4 Avatar stages (`Data.AVATAR_STAGES`, sprites in `Sprites.AVATARS[id]`)
`vagrant` (hoodie, stubble, cardboard box, one sock) → `wageslave` (blue Bot-Corp jumpsuit, name tag "4471",
coffee cup, eye bags) → `hustler` (jumpsuit half-unzipped, cap backwards, phone) → `owner` (rolled white
sleeves, clipboard, key ring) → `investor` (navy blazer, tablet with green chart) → `tycoon` (long coat, gold
shades, cane with bot-head knob) → `escapee` (hoodie again, backpack, standing in sunrise). Idle animations:
shiver / sip coffee / type on phone / flip clipboard / scroll tablet / twirl cane. Reactions: jump on purchase,
arms up on crit, sit down on burnout, cough when health < 30, hair greys at 60, stoop at 70, hide during crash,
sleep with "Z" at night when idle 20 s.

### 9.5 The Machine (`Data.MACHINE_FORMS`, sprites in `Sprites.MACHINES[id]`, 24×24 grids drawn at 5×)
`sign` (cardboard sign "ANYTHING HELPS", wobbles; coin arcs into a box) → `clock` (grimy Bot-Corp punch clock,
amber LCD, red eye logo; card slams in, paycheck pops; a tax chunk flies to the R.E.S. bot in the corner) →
`register` (beige cash register, bell; drawer slams open "CHA-CHING", bills fly) → `vault` (round steel door,
spinning wheel, gold rivets; wheel spins, door cracks, coins pour) → `core` (gold-plated pulsing orb in a cage,
tubes feeding the city; pulses, city-wide shimmer) → `lever` (giant gate lever; each click charges toward the
toll; pulled fully when the toll is paid).

Click animation (all forms): squash 0.88x/1.08y over 90 ms, overshoot 1.05, settle (`cubic-bezier(.2,1.6,.4,1)`);
±2° random rotation; 6–14 coin particles (bills at OVERTIME) with gravity, one bounce; floating `+$X` (gold,
bigger, "!!" on crit); glow ring; screen shake 1 px at HUSTLIN', 3 px at OVERTIME, 6 px/120 ms on crit
("Reduce motion" disables shake/particles).

---

## 10. Education: Glitch's Ledger (`Data.LESSONS`), choice events (`Data.EVENTS`), achievements

### 10.1 Ledger pages — 22, free, event-triggered, non-blocking
A page arrives as a bouncing envelope on the HUD ("NEW PAGE"); it never blocks play (L01–L04 auto-open once,
the tutorial). Each card: title, 2–4 sentences, an "IN BOTLANDIA:" tie-in, a **CLAIM** button that grants the
reward. Read pages live in the LEDGER tab ("14/22 PAGES"). ≤ 1 new page per 3 minutes (queue the rest).
Reading all 22 → achievement `fully_booted` (+10% income). Six pages carry a **×1.25 business income** reward.

| id | Title | Trigger (`Engine` implements) | Reward |
|---|---|---|---|
| `L01` | Debt Has a Meter | 10 s after first click | debt APR 12% → 10% |
| `L02` | Time for Money | first paid shift (first click with a job) | click value ×1.25 for 5 min |
| `L03` | The Tax Bite | 20 shifts worked | one-time $50 "tax refund" |
| `L04` | Assets vs Liabilities | BIZ tab first opened | next business purchase 50% off |
| `L05` | Pay Yourself First | chapter 4 | **×1.25** business income |
| `L06` | Lifestyle Inflation | first Doodad Dan offer | Dan visits 30% less often |
| `L07` | Compound Interest & Rule of 72 | INVEST tab first opened | **×1.25** business income |
| `L08` | Index Funds | first B500 purchase | +1 year of growth applied instantly to B500 holdings |
| `L09` | Dividends | first dividend received | unlock DRIP toggle |
| `L10` | Risk vs Volatility | BitBot first visible | cash = 2 min of passive income (min $100) |
| `L11` | Good Debt vs Bad Debt | chapter 5 start | unlocks Bot-Bank; loan APR 8% → 7%; **×1.25** |
| `L12` | Diversification | own 3 asset classes or first crash | crashes 20% softer; **×1.25** |
| `L13` | Cash Flow vs Capital Gains | first investment worth more than its cost basis | capital gains tax 15% → 10% |
| `L14` | Taxes: Earned vs Passive | passive $/s exceeds click $/s at 3 cps for the first time | business tax 21% → 18%; **×1.25** |
| `L15` | Real Estate & Leverage | first `podtower` | Pod Tower income ×1.25 |
| `L16` | Emergency Fund | first overdraft (cash < 0 moved to debt) or first Bot-Flu | cash = 1 month of expenses |
| `L17` | Opportunity Cost | cash ≥ 20× cheapest affordable business, idle 60 s | "Future Me" tooltip (any price → value in 20 yrs at 8%) |
| `L18` | Time Is the Scarcest Asset | first Doc Module purchase or age 40 | +6 months of life |
| `L19` | Build Systems, Not Jobs | Manager Bots or Clone bought | **×1.25** |
| `L20` | The Freedom Number | freedom meter first ≥ 100% | Exit Toll −10% |
| `L21` | Inflation | game year 10 (age 28) | expense inflation 3% → 1.5% |
| `L22` | Delayed Gratification | Bot-Lambo event answered | doodad resale 30% → 50% |

Text (`text`, `botlandia`) for every page is in the story appendix (§14) and must be used verbatim.
Accuracy: "in many systems" wording on tax; 8% is "a long-run illustration, not a promise"; Rule of 72 is approximate.

### 10.2 Choice events — "INCOMING TRANSMISSION" (`Data.EVENTS`)
Modal 8-bit box with portrait, ≤ 3 lines, 2–4 options. `Engine.answerEvent(state, eventId, optionIndex)` applies
a pure outcome and queues the response line; "mistake" options schedule a **what-if** toast within 10–30 s.
Deck rules: fire at most one at a time, ≥ `EVENT_MIN_GAP_S` apart, chapter-gated, once per run unless
`repeatable`; `promotion` and `doodad_offer` are system-driven (not from the random deck).

| id | Who | When | Options → outcome |
|---|---|---|---|
| `promotion` | supe | shifts + cert met | Accept (pay cert, new job, housing mandate shown) / Decline / Negotiate 4-day week (only if ≥ 1 business: accept without the housing mandate rising this time, 40% chance; else Supe refuses) |
| `doodad_offer` | dan | every 5 min from Ch4 | Buy / Decline / Let the assets buy it |
| `lambo` | dan | Ch4+, once | Buy Bot-Lambo (liability) / Decline / Assets buy it (if affordable) → achievement |
| `consolidation` | repo | Ch1–3 while debt > 0, repeatable | Accept (interest 12%→29%, "smaller payments") / Decline ("smaller payment isn't smaller debt") |
| `mooncoin` | dan | Ch5+, repeatable | All-in 50% NW (30%: +200% / 70%: −80%) / Small bet 2% / Ignore (ticker shows what happened 10 s later) |
| `bonus` | supe | Ch2–4, once | Spend on HoloTV (+$40/mo upkeep) / Save it (+$800 cash) / Buy an asset (+$800, opens BIZ tab) |
| `lottery` | dan | any, repeatable | Buy 1 ($20, 1-in-50,000 for $1M) / Buy 10 / Invest the $20 instead (shows $20 → $93 in 20 yrs at 8%) |
| `crash_choice` | glitch | during a crash, once per crash | Sell everything (locks losses; what-if 3 yrs later) / Hold / Buy the dip |
| `prince` | mainframe | Ch3+, once | Send $500 (gone) / Delete / Report (+$50, achievement `not_today_prince`) |
| `doc_offers` | doc | Ch5+, once | Nano-Kale $5,000 = +2 yrs / Miracle Chip $500 = +0 yrs / Both |
| `ready_to_quit` | glitch | passive = 50% of expenses, once | Quit now (allowed) / Not yet |
| `tax_season` | res | yearly from Ch5 | DIY (10% chance 5% penalty) / Hire AccountBot $300 (−15% tax this year; auto with `accountant`) |
| `burnout_event` | supe | 2+ promotions taken & ≥ 200 shifts this year, once | Take a week off (−1 month of click income) / Push through (−1 year of life) |
| `partner` | mainframe | Ch5–7, once, requires ≥ 10 `truck` | Sell half the trucks for 12 months of their income / Keep / Counter 25% (40% accepted) |

### 10.3 Achievements (`Data.ACHIEVEMENTS`) — each +1% global income; pixel badge; one-line snark
`anything_helps` (100 sign clicks) · `hat_rental` (first job) · `zero_hero` (net worth crosses $0) ·
`ka_chunk` (first business) · `ugly_money` (10 vending) · `hustlin` (heat tier 1) · `burnout` (first burnout) ·
`jackpot` (first crit) · `machine_owner_10` (10 businesses total) · `owner_100` (100 total) · `owner_1000` (1,000 total) ·
`each_business` ×14 (`own10_<id>`: 10 of each) · `landlord` (first podtower) · `off_the_treadmill` (rat race exit) ·
`assets_bought_toy` · `no_thanks_dan` (decline 10 doodads) · `not_today_prince` · `rule_of_72` (B500 position doubles) ·
`boring_wins` ($100k in B500) · `coin_rain` (20 dividend payouts) · `diamond_hands` (hold through a crash to recovery) ·
`paper_hands` (sell during a crash; tooltip shows what holding would have been worth) · `to_the_moon` / `crater` (BitBot ±) ·
`good_debt` (hold $1M loan with positive cash flow) · `debt_free` (Repo-Tron paid off) · `i_quit` (quit while passive ≥ expenses) ·
`i_quit_too_early` (quit while passive < expenses and survive 12 months) · `systems_not_jobs` (Manager Bots) ·
`glitch_hunter` (10 golden bots) · `bought_the_dip` · `fully_booted` (all 22 pages, +10%) · `aced_it` (best option in 10 events) ·
`nano_kale_believer` (every legit Doc item) · `miracle_chump` · `centenarian` (age 100) · `ghost_in_the_machine` (escape before 42) ·
`died_a_wage_slave` (grey badge) · `escaped` · `speedrunner` (escape < 2 h) · `idle_rich` ($1M offline) · `overtime_overlord` (every promotion) ·
`cardboard_connoisseur` (500 sign clicks before a job) · `pure_passive` (escape with < 2,000 clicks) · `immortal_ish` (lifespan ≥ 95).

---

## 11. Endings and prestige

### Bad ending — "YOU DIED A WAGE SLAVE" (`state.ending = 'wageslave'`)
Trigger: death while `!flags.ratRaceExit`. Time slows (dt × 0.2 for 2 s), audio low-passes, the avatar sits
on the sidewalk, the Machine's LCD flickers "OUT", **bots keep walking, indifferent**, grey desaturation.
Tombstone card: `HERE LIES <name> · 18–<age> · "WORKED HARD."`, years worked, shifts, clicks, peak net worth,
freedom % at death, interest paid to Repo-Tron, doodads bought, pages read, "CAUSE OF DEATH: TREADMILL.", and one
**personalised tip** chosen from stats (e.g. "You paid $41,200 in interest. That was 3 Pod Tower down-payments.",
"Doodads cost you $X/month for Y years = $Z.", "You never opened the INVEST tab.", "Passive income was 74%. Two
more Pod Towers."). Lines: mainframe "EXPIRY REACHED. STATUS: OPTIMALLY EMPLOYED." · repo "ASSETS SEIZED: N. THERE WAS
NOT MUCH TO SEIZE." · supe "A model worker. Never missed a shift. We'll post the job Monday." · glitch "...the gate was
right there. next time, look up." Then immediately the **hope beat**: "glitch kept a partial backup. WISDOM +N"
and a **REBOOT** button (`Engine.dieAndRestart`).

Variants: died after rat-race exit but before the toll → "FREE, BUT GONE" (75% Wisdom, warmer text).

### Good ending — "YOU ESCAPED BOTLANDIA" (`state.ending = 'escaped'`)
Trigger: `Engine.escape` (out of rat race now and cash ≥ toll). The gate grinds open in three shudders, every
owned building lights its windows, the treadmill billboard shorts out, Supe's tie falls off, Repo-Tron's counter
reads `$0.00` then `¯\_(ツ)_/¯`, sunrise palette (the only warm palette in the game), chiptune swells.
Lines: mainframe "UNIT 4471 NOT FOUND. NOT FOUND. NOT FOU—" · maya "Told you. Sunrise." · glitch "the treadmill's
still running. it just doesn't have you." · you "What now?" · glitch "whatever you want. that was always the point."
**EXIT VISA** card: escaped at age X, time played, clicks, net worth, passive vs expenses, interest paid vs earned,
pages read, doodads declined, rank **RAT** (> 58) / **RUNNER** (50–58) / **OWNER** (42–50) / **GHOST IN THE MACHINE** (< 42).
Buttons: **NEW GAME+** (`Engine.escape` → new run) and **KEEP BUILDING** (sandbox continues, ending recorded).

### Prestige — Wisdom (`state.wisdom`, never lost)
```
wisdomForRun = floor(4 × log10(1 + lifetimeEarned / 1000)) × (escaped ? 1 : diedFree ? 0.75 : 0.5) + (escaped ? 25 : 0)
```
Each point: +2% business income and +2% click value. Threshold perks (`Data.WISDOM_PERKS`, no spend UI):
5 **Rich Dad's Advice** (start with no debt) · 10 **Side Hustle** (start with 5 battery stands and job 2) ·
20 **Night Owl** (offline 75% / 12 h) · 35 **Muscle Memory** (milestones ×1.1) · 50 **Financial IQ** (upgrades −50%) ·
75 **Second Wind** (+10 lifespan) · 100 **Insider** (Fast Track without rat-race exit) · 150 **Mentor** (L01–L04 pre-read).
Run 2+: Exit Toll ×3 per run, Repo-Tron starts at 15% APR, the city shows a **scanline ghost** of last run's buildings,
Glitch: "you remember the alley. you remember the price." Loop 3 adds Supe's buyout offer event (v2).

---

## 12. Architecture and module contract

Vanilla HTML/CSS/JS, **no build step**, no dependencies. Every module is an IIFE that attaches to `globalThis`
(browser) **and** sets `module.exports` when `module` exists, so Node can `require()` the pure modules for tests.
Script order in `index.html`: `data.js → engine.js → sprites.js → sprites-city.js → audio.js → scene.js → ui.js → main.js`.

- `data.js`, `engine.js`: **pure** — no DOM, no `Date.now()`, no `Math.random()` (the engine takes `now` and uses
  its own seeded RNG in the state). Unit-tested with `node --test test/`.
- `sprites.js` / `sprites-city.js`: grids are pure data; `render()` uses `document.createElement('canvas')` and is
  cached; both load in Node without touching the DOM at load time.
- `audio.js`, `scene.js`, `ui.js`, `main.js`: browser only.

### 12.1 `Data` (data.js)
```
Data.CONST, Data.JOBS[], Data.HOUSING[], Data.BUSINESSES[], Data.MILESTONES, Data.INVESTMENTS[], Data.HEALTH_ITEMS[],
Data.POWERUPS[], Data.UPGRADES[], Data.DOODADS[], Data.CHAPTERS[] (index 0 = chapter 1), Data.AVATAR_STAGES[],
Data.MACHINE_FORMS[], Data.CHARACTERS{}, Data.LESSONS[], Data.EVENTS[], Data.ACHIEVEMENTS[], Data.WISDOM_PERKS[],
Data.ENDINGS{}, Data.TUTORIAL[], Data.TIPS{} (the `?` chip explainers, keyed by concept), Data.NEWS[] (ticker lines),
Data.byId (map of every id → object, built at load)
```
Every table row has `id`, `name`, and the text fields named in this document. `Data.EVENTS[i].options[j].outcome`
is a **declarative** object the engine interprets (`{ cash:+800 }`, `{ upkeep:+40, label:'HoloTV' }`, `{ job:'next' }`,
`{ debtApr:0.29 }`, `{ years:-1 }`, `{ custom:'lambo_buy' }` …); `Data.ACHIEVEMENTS[i].when` is a condition object
(`{ stat:'lifetimeClicks', gte:100 }`, `{ owned:'vending', gte:10 }`, `{ flag:'ratRaceExit' }`, `{ custom:'rule_of_72' }`).

### 12.2 `Engine` (engine.js) — exact API
```js
Engine.newState(now, opts?)                 // opts: { wisdom, run, name } — applies Wisdom perks
Engine.tick(state, dtMs, now)               // advance; dtMs already capped by the caller (≤ 1000). Returns nothing; pushes UI events onto state.queue.
Engine.derive(state)                        // memo-free pure computation of everything the UI shows (see below)
Engine.click(state, now)                    // → { earned, crit, heat, tier, burnout:boolean, locked:boolean }
Engine.takeJob(state, jobId)                // → { ok, reason }
Engine.quitJob(state)                       // → { ok }
Engine.setHousing(state, housingId)         // → { ok, reason }
Engine.buy(state, businessId, qty)          // qty 1|10|100|'max' → { ok, bought, spent, reason }
Engine.quote(state, businessId, qty)        // → { count, total, incomeGain } (what the button would do)
Engine.buyUpgrade(state, upgradeId)         // business upgrades ('battery_u1') and systems ('clone1') → { ok, reason }
Engine.buyHealth(state, itemId)             // Doc Module ladder → { ok, reason }
Engine.medbay(state)                        // → { ok, cost }
Engine.activatePowerup(state, powerupId, now) // → { ok, reason, cost }
Engine.investBuy(state, assetId, cashAmount) / Engine.investSell(state, assetId, fraction) // → { ok, units, proceeds, tax }
Engine.setDrip(state, on)
Engine.payDebt(state, amount) / Engine.takeLoan(state, amount) / Engine.repayLoan(state, amount) // → { ok, reason }
Engine.buyDoodad(state, doodadId) / Engine.sellDoodad(state, doodadId)
Engine.answerEvent(state, eventId, optionIndex, now) // → { ok, response:{who,text}, whatIf?:{delayS,text} }
Engine.readLesson(state, lessonId)          // marks read, applies reward → { ok, rewardText }
Engine.collectGlitch(state, now)            // golden bot clicked → { kind, text }
Engine.markSeen(state, key)                 // tutorial/tip bookkeeping (flags.seen[key] = true)
Engine.openTab(state, tabId)                // records first-open triggers (L04, L07 …)
Engine.canEscape(state)                     // → { ok, toll, reason }
Engine.escape(state, now)                   // → new state for the next run (Wisdom applied); the old state gets ending='escaped' first
Engine.dieAndRestart(state, now)            // → new state (Wisdom from the death)
Engine.applyOffline(state, now)             // → { seconds, earned, spent, yearsAged, events } (also mutates)
Engine.save(state) → string / Engine.load(str, now) → state|null   // JSON, v field, migrations, validation
Engine.chapterFor(state) → 1..8             // pure; tick() promotes state.chapter monotonically
Engine.fmt(n) / Engine.fmtMoney(n) / Engine.fmtTime(sec) / Engine.fmtPct(x)
Engine.rng(state) → [0,1)                   // mulberry32 from state.seed / state.rngCalls (deterministic)
Engine.cost / bulkCost / maxAffordable / milestoneMult   // exported pure helpers
```

`Engine.derive(state)` returns:
```
{ cash, debt, loan, netWorth, bookValue, investValue,
  clickValue, heat, heatTier (0..3), heatLabel, burnoutUntil,
  grossPassivePerSec, passivePerSec (net), bizNetPerSec, dividendPerSec, expensesPerSec, netPerSec,
  passiveMonthly, expensesMonthly, freedomRatio, ratRaceMonths (consecutive so far), outOfRatRaceNow,
  age, yearsLeft, lifespan, health, healthDriftPerYear, critical (health<20),
  chapter, chapterTitle, machineForm, avatarStage, statusLabel,
  job: { id, name, gross, shifts, shiftsToPromote, canPromote, nextJob, mandatedHousing } | null,
  businesses: [{ id, owned, level, cost, nextCost, grossPerSec, netPerSec, milestoneMult, nextMilestone, unlocked, fastTrackLocked, payback }],
  investments: [{ id, price, units, value, basis, gain, yieldPerMonth, history[], unlocked }],
  loanCapacity, loanRoi (business return %/yr on cost), exitToll, canEscape,
  taxes: { job, biz, div, gain }, multipliers: { lessons, wisdom, achievements, powerups, events },
  activePowerups: [{ id, until, cooldownUntil }], tabsUnlocked: ['work','biz','invest','upgrades','life','ledger'],
  lessonsRead, lessonsTotal, achievementsUnlocked, achievementsTotal, incomeSplit: { clicks, business, dividends } (last 30 s)
}
```

`state.queue` is a FIFO of UI events the engine pushes and the UI drains every frame. Types and payloads:
`toast {text, kind:'info'|'money'|'warn'|'gold'}` · `chapter {chapter}` · `lesson {lessonId}` (envelope) ·
`event {eventId}` (choice modal) · `achievement {id}` · `milestone {businessId, count, mult}` · `purchase {businessId, count}` ·
`glitch {activeUntil}` · `crash {factor}` / `crashOver` · `dipWindow {until}` · `burnout` · `promotion {jobId}` ·
`death {ending:'wageslave'|'free'}` · `escape` · `heal` · `debtPaid` · `ratRaceExit` · `monthEnd {summary}` ·
`say {who, text, ttlMs}` (ambient dialogue) · `sfx {name}`.

### 12.3 State shape (`v: 1`)
```js
{ v:1, run:1, name:'4471', wisdom:0, seed:123456, rngCalls:0, created, lastSeen, playMs:0, gameSeconds:0,
  cash:0, debt:2000, loan:0, debtApr:0.12, loanApr:0.08,
  age: 18.0, lifespan:62, health:60, heat:0, burnoutUntil:0, luckyClicks:0,
  job:{ id:null, shifts:0, totalShifts:0, promotionsTaken:0 }, housing:'cardboard', inflationMult:1,
  businesses:{ [id]:{ owned:0, level:0 } }, upgrades:{ [id]:true }, healthItems:{ [id]:true },
  doodads:{ [id]:true }, extraUpkeep:[{ label, monthly }],
  investments:{ [id]:{ units:0, basis:0 } }, market:{ [id]:{ price, history:[], drift, recoverUntil } }, drip:false,
  powerups:{ [id]:{ until:0, cooldownUntil:0 } }, frenzyUntil:0, frenzyMult:1,
  chapter:1, lessons:{ [id]:'queued'|'read' }, lessonQueue:[], lastLessonAt:0,
  events:{ fired:{ [id]:count }, lastAt:0, pending:null }, achievements:{ [id]:true },
  glitch:{ nextAt, activeUntil }, crash:{ until, dipUntil }, doodadOfferAt,
  flags:{ ratRaceExit:false, ratRaceMonths:0, tutorialStep:0, seen:{}, tabsOpened:{}, ... },
  stats:{ lifetimeEarned, lifetimeClicks, signClicks, shifts, interestPaid, interestEarned, taxesPaid, doodadsBought,
          doodadsDeclined, glitches, crashesSurvived, peakNetWorth, dividendPayouts, bestEventChoices, offlineEarned },
  queue:[] /* the UI event FIFO, see 12.2 */,
  ending:null }
```
(`state.events` holds choice-event bookkeeping; `state.queue` is the UI FIFO.)

### 12.4 `Sprites` (sprites.js + sprites-city.js)
Grids are arrays of equal-length strings; each char maps to a colour in the sprite's `palette`; `.` = transparent.
```js
Sprites.render(sprite, scale, { flip, tint, frame }) → HTMLCanvasElement (cached)
Sprites.frame(sprite, t) → sub-sprite for animated sprites ({ frames:[rows,…], fps })
Sprites.AVATARS[stageId]        // { palette, frames:[...16×24 grids], fps:2, reactions:{ jump, arms_up, sit, cough, sleep } }
Sprites.MACHINES[formId]        // { palette, frames:[24×24 …] (idle), hit:[…] (click frames) }
Sprites.PORTRAITS[characterId]  // 16×16 dialogue portraits for all 9 characters (+ 'you')
Sprites.BOTS: { worker (2-frame walk), customer, golden, repo, supe, dan, doc, glitch, butler, tiger }
Sprites.ICONS: { coin, bill, heart, skull, lock, star, envelope, question, tab_work, tab_biz, tab_invest, tab_upgrades, tab_life, tab_ledger,
                 business icons by id (16×16), investment tickers, health items, powerups, doodads, achievement badge frames }
Sprites.CITY (sprites-city.js): { buildings[businessId] : { levels:[sprite per growth stage], anim:{...} },
                                  vehicles: { hovercar[3 colours], truck, bus, lambo, drone, cargoPod, yacht },
                                  props: { lamp, dumpster, crane, sun, moon, star, cloud, sign_botlandia, core_tower, tower_silhouettes[], treadmill_billboard,
                                           exit_gate, rain, smoke, spark, confetti, ghost overlay }, palettes: { gutter, block, alley, treadmill, ledger, skyline, heights, gate, sunrise } }
```

### 12.5 `Audio` (audio.js)
`Audio.init()` (on first gesture) · `Audio.play(name, opts)` names: `click` (opts.pitch semitones), `crit`, `buy`,
`chaching`, `coin`, `chapter`, `achievement`, `lesson`, `burnout`, `error`, `glitch`, `crash`, `thunder`, `heartbeat`,
`death`, `escape`, `milestone`, `tick`, `whoosh` · `Audio.music(mode)` modes `none|city|lowtime|sunrise` (tiny chiptune loops,
WebAudio oscillators, voice cap 8) · `Audio.setMuted(bool)` / `Audio.setVolume(0..1)` · never throws without AudioContext.

### 12.6 `Scene` (scene.js)
```js
const scene = Scene.create(canvas)      // full-viewport canvas behind the UI, nearest-neighbour, DPR-aware
scene.setState(state, derived)          // called every frame (cheap: reads counts, chapter, flags, doodads, ghost)
scene.setSafeArea({ left, right, top, bottom }) // the rectangle not covered by UI panels; the district camera keeps action inside it
scene.event(type, payload)              // 'purchase' | 'milestone' | 'glitch' | 'glitchGone' | 'crash' | 'crashOver' | 'chapter' | 'parade' |
                                        // 'ratRaceExit' | 'death' | 'escape' | 'burnout' | 'click' {x,y} | 'coinburst' {x,y,n,gold} | 'crit'
scene.hitTest(x, y) → 'goldenbot' | null // for the Golden Bot click
scene.start() / scene.stop() / scene.resize()
scene.setReduceMotion(bool)
```
Layers (back → front, parallax factor): sky (0, day/night gradient, sun/moon with a bot face, stars) → far skyline
(0.1: Bot-Corp towers, the **Core Tower** with a scanning red eye, neon "OBEY · WORK · BUY", the broken "BOTLANDIA"
sign with a flickering L, the **Treadmill billboard** from Ch4) → your district (0.35: 14 plots, buildings appear on
purchase with a dust puff and grow at milestone counts, ghost buildings from last run, doodad cosmetics, the Exit Gate at
the far right in Ch8) → street (0.7: road with dashed line, sidewalk, lampposts lit at night, worker bots shuffling,
customer bots entering your businesses, your avatar walking, Repo-Tron patrolling while in debt, hover-cars/trucks/lambo,
the Golden Bot) → foreground (1.0: rain in the Gutter palette, bus, fireflies at night, confetti, lightning). Camera pans
slowly (ping-pong) across the district so every building drifts through the safe area; drag to pan.

### 12.7 `UI` (ui.js) and `main.js`
`UI.init({ engine: Engine, state, scene, audio })` → `{ render(state, derived, now), drain(queue), setState(state) }`.
`main.js`: load or new game (name prompt on the title card), `applyOffline`, loop (engine tick every 100 ms with dt
capped at 1000 ms; render on rAF), autosave every 10 s + on `visibilitychange`/`pagehide`, keyboard: Space/Enter = click,
1–6 = tabs, Esc closes modals, M mute.

---

## 13. UI layout and visual language

**The city is the page background.** A full-viewport canvas (`#scene`) sits behind everything; a second
full-viewport canvas (`#fx`, pointer-events none) on top draws click particles and floating numbers. UI panels are
opaque-ish navy (`rgba(11,15,43,.92)`) with 4 px pixel borders and notched corners, floating over the city.

Desktop (≥ 1000 px):
```
┌ TOP BAR (56 px, full width) ───────────────────────────────────────────────────────────────┐
│ $ CASH 12.3K │ NET WORTH -1.2K │ PASSIVE +$142/s │ EXPENSES -$38/s │ FREEDOM ▓▓▓▓░░ 61% │ ♥ AGE 34 · 28 LEFT │ 🔊 ⚙ │
├ LEFT "YOU" (300 px) ────────────┬── open city (safe area) ──────────┬ RIGHT "THE MARKET" (380 px) ┤
│ ID card: avatar 3×, name,        │                                   │ tabs: WORK BIZ INVEST UPGR LIFE LEDGER │
│  status label, DEBT chip         │   (buildings, cars, bots,         │ cards list (scrolls)                    │
│ THE MACHINE (120 px, click here) │    treadmill billboard,           │  icon · name · owned ×N · $/s           │
│ HUSTLE METER  ×2 ON FIRE         │    golden bot, Repo-Tron)         │  [BUY 1|10|100|MAX] cost · payback · ?  │
│ JOB card  [WORK] [PROMOTE] [QUIT]│                                   │ buy-multiplier + NEWS TICKER at bottom  │
│ boosts (power-up buttons w/ rings)│  DIALOGUE BOX docked bottom      │                                         │
│ toasts stack (bottom-left)       │  (portrait + typed text)          │                                         │
└──────────────────────────────────┴───────────────────────────────────┴─────────────────────────────────────────┘
```
Between 700–1000 px: right panel becomes a bottom sheet opened by a SHOP button. Below 700 px (phone): the canvas is a
fixed 180 px band at the top, then the Machine + meter (touch target ≥ 120 px), then a bottom tab bar
`HUSTLE · CITY · SHOP · LEDGER · ME`. Always visible: cash, passive, freedom, heart/age, the Machine, mute.

Visual language: **Press Start 2P** (Google Fonts, monospace fallback), body 10–12 px at 1.6 line-height, headings
14–18 px, top-bar numbers 16 px. Palette tokens: navy `#0b0f2b`, panel `#161a3a`, border `#3d4a8a`, text `#e8ecff`,
cash green `#4ade80`, cost yellow `#facc15`, danger red `#f87171`, gold `#ffd166`, bot grey `#8b93a7`, Bot-Corp red
`#ff3b3b`, glitch cyan `#39d4ff`. Buttons: 3 px hard drop-shadow that collapses on `:active`. Cards glow when affordable,
pulse when newly unlocked, show a lock + reason when locked. Counters tween (lerp 15%/frame) and flash white on big
jumps. Toasts: bottom-left stack, max 3, 3.5 s. Tooltips (hover / long-press) on every card: plain-words formula
("Next costs $1.38K = $1.2K × 1.15"), payback ("pays for itself in 4m 20s"), one-line lesson, and "Future Me" after L17.
`?` chips open a Glitch bubble anchored to the element once (then it lives in the LEDGER tab's Codex).
Settings (⚙): sound, music, reduce motion, number format, export/import save (base64), replay tutorial, hard reset (2-step).

**Tutorial** (`Data.TUTORIAL`, arrow + ≤ 8-word caption, completes by doing): CLICK THE SIGN → (15 clicks) YOU HAVE 44
YEARS. THEY'RE TICKING. → OPEN WORK → TAKE THE JOB → PUNCH IN (tax chunk flies) → OPEN THE ENVELOPE (L01) →
GET $60. OPEN BIZ. → BUY ONE. WATCH THE CITY. → done; later tabs get one caption on first open.

---

## 14. Story appendix — lesson texts (use verbatim)

- **L01 Debt Has a Meter** — "Debt isn't a number, it's a rate. Every month interest adds to what you owe, so the meter runs even while you sleep. Paying it down early saves every future payment on that piece." *In Botlandia: Repo-Tron's counter ticks at 12% a year.*
- **L02 Time for Money** — "A job trades hours for dollars. It's the fastest way to get your first capital, but it stops paying the moment you stop showing up. Use it as a launchpad, not a destination." *In Botlandia: the punch clock only pays while you punch.*
- **L03 The Tax Bite** — "Wages are taxed before you ever see them. Earned income usually faces the highest rates, because the system is built to collect from workers efficiently. Know your net pay, not your gross." *In Botlandia: R.E.S. takes 35% of every shift.*
- **L04 Assets vs Liabilities** — "An asset puts money in your pocket. A liability takes money out. A car, a subscription, a bigger apartment: those bill you. A vending bot, a rental, a fund: those pay you. Buy assets first and let the assets buy the toys." *In Botlandia: the Mainframe can't even see assets.*
- **L05 Pay Yourself First** — "Most people spend, then invest what's left: usually nothing. Flip it. Move a slice of every paycheck into assets before you can spend it, and live on the rest. What you never see, you never miss." *In Botlandia: buy the machine before the paste.*
- **L06 Lifestyle Inflation** — "When income rises, spending quietly rises to meet it. New phone, bigger pod, nicer paste. Your raise disappears and the treadmill speeds up. Raise your income, freeze your lifestyle, invest the gap." *In Botlandia: Dan is always waiting for payday.*
- **L07 Compound Interest & Rule of 72** — "Returns earn returns. Divide 72 by the yearly rate to estimate how long money takes to double: 8% doubles in about 9 years, 12% in about 6. Time in the market beats timing it, so start early, even small." *In Botlandia: 8% is a long-run illustration, not a promise.*
- **L08 Index Funds** — "An index fund buys a small slice of hundreds of companies at once for a tiny fee. You don't have to pick winners; you own the whole market's growth. Boring on purpose. Boring wins." *In Botlandia: B500 = a slice of every bot company.*
- **L09 Dividends** — "Some companies pay part of their profits to shareholders in cash. That's passive income from paper: no tenants, no refills. Reinvest dividends and they compound." *In Botlandia: dividends count toward getting off the treadmill.*
- **L10 Risk vs Volatility** — "Volatility is how much a price swings. Risk is the chance you permanently lose money you needed. BitBot can double or drop 60% in a week: only bet what you could lose without touching your rent." *In Botlandia: Dan loves BitBot. Ask why.*
- **L11 Good Debt vs Bad Debt** — "Debt that buys an asset paying more than the interest is a tool. Debt that buys a depreciating toy is a trap. Ask one question before borrowing: will this loan pay for itself?" *In Botlandia: Repo-Tron charges 12%. Bot-Bank charges 8%. Your Pod Tower returns more.*
- **L12 Diversification** — "Don't let one thing sink you. Spread across businesses, funds, property and cash so one bad year in one place doesn't end the game. Diversification is the closest thing to a free lunch in investing." *In Botlandia: bonds don't crash. Everything else does.*
- **L13 Cash Flow vs Capital Gains** — "Cash flow is money an asset pays you every month while you keep it. A capital gain is profit you only get when you sell, and it's usually taxed then. Cash flow pays rent; gains are a bet on someone paying more later." *In Botlandia: the Freedom meter only counts cash flow.*
- **L14 Taxes: Earned vs Passive** — "In many systems, wages are taxed hardest while long-held investments, qualified dividends and business cash flow are taxed lighter. Owners often keep more of a dollar than workers do." *In Botlandia: R.E.S. takes 35% of a shift, 21% of a business, 15% of a dividend.*
- **L15 Real Estate & Leverage** — "A rental is an asset if rent beats mortgage, maintenance and vacancy combined. With a small down payment you control the whole building, so the return on your own cash multiplies. Leverage magnifies gains and mistakes." *In Botlandia: tenants pay the bank; you keep the difference.*
- **L16 Emergency Fund** — "Surprises are certain; only the date is unknown. Three to six months of expenses in cash means a bad month is an annoyance, not a loan. Without it, one surprise sends you back to Repo-Tron." *In Botlandia: overdrafts become bad debt instantly.*
- **L17 Opportunity Cost** — "Money sitting idle isn't safe; it's costing you whatever it could have earned. $10,000 in a jar for 10 years versus 8% in a fund is about $11,000 of growth you chose not to have." *In Botlandia: hover any price to see what it could become.*
- **L18 Time Is the Scarcest Asset** — "You can make more money. You cannot make more years. Health is the one investment that extends every other one, and wealth only matters if you're alive to use it." *In Botlandia: the rich live longer. Now you know why they hurry.*
- **L19 Build Systems, Not Jobs** — "If the business stops when you stop, you bought yourself a job. Hire, automate, write the process down. A system works while you sleep; that's the difference between self-employed and owner." *In Botlandia: machines don't burn out.*
- **L20 The Freedom Number** — "When your passive income covers your expenses, work becomes optional. That's the finish line of the Cashflow game and of this one. Add a margin for surprises, then walk out the gate." *In Botlandia: 125% for three months, and no bad debt.*
- **L21 Inflation** — "Prices rise a little every year, so a dollar buys less. Cash slowly shrinks. Assets that raise their prices or rents with inflation keep your purchasing power." *In Botlandia: Landlord Unit never forgets.*
- **L22 Delayed Gratification** — "The Bot-Lambo now, or ten Bot-Lambos later? Every dollar invested early is worth many dollars later. The trick isn't willpower; it's remembering what the money becomes." *In Botlandia: the assets can buy the toy. Let them.*

Ambient lines (`Data.CHARACTERS[id].lines`), examples: glitch "i fix vending machines. they pay me while i sleep. you?" ·
"the mainframe counts your hours. it can't count your assets." · "a job feeds you today. an asset feeds you every day." ·
"rich isn't a number. rich is when the clock stops scaring you." · supe "Businesses fail, 4471. Payroll never fails. Mostly." ·
"A raise! 3%! Your rent goes up 4%, but still. A raise!" · "You have 34 years left. Plenty of time to save. Somewhat." ·
repo "CONSOLIDATE YOUR DEBT? NEW DEBT. SAME REPO-TRON." · (paid off) "BALANCE: $0.00. ...I FEEL NOTHING. GOODBYE." ·
dan "Only $499 a month! Forever! That's basically free!" · "This HoloTV goes UP in value. Probably. Don't check." ·
doc "Insert cash. Receive years. No refunds." · res "EARNED INCOME DETECTED. EXTRACTING." · (later) "QUALIFIED DIVIDENDS. REDUCED EXTRACTION. ANNOYING."

---

## 15. Balance gate

`tools/sim.js` runs the real `Engine` headlessly with two policies and is executed by `npm test`:
- **greedy** (3 clicks/s while employed, accepts promotions, always buys the best-payback affordable item, buys health
  items when affordable and years left < 20, pays debt first, reads lessons, declines doodads): must escape between
  **90 and 150 minutes** of simulated play.
- **grinder** (3 clicks/s, promotions, health items, never buys a business): must **die a wage slave**.
- **idle** (no clicks after minute 5, buys with whatever accrues): must not die before minute 60.
Re-run whenever any multiplier, cost, toll or lifespan number changes.
