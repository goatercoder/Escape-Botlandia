# Escape Botlandia 🤖💸
*Note: This is currently under development and will be released soon.*

**An 8-bit cash-flow tycoon game.** You wake up homeless and $2,000 in debt in Botlandia, a city run by bots
where humans live on the Wage Treadmill. Work a job to get your first capital, buy cash-flow businesses, invest,
dodge the doodads, extend your life, get **out of the rat race** and pay the **Exit Toll** before your time runs out.

Or die a wage slave. That is a real ending.

It is a cookie clicker at heart, but instead of cookies you build businesses that pay you while you sleep, and the
game quietly teaches the ideas behind *Rich Dad Poor Dad*, the *Cashflow* board game and *Build Your Stax*:
assets vs liabilities, cash flow vs capital gains, compound interest, good debt vs bad debt, lifestyle inflation,
taxes on earned vs passive income, diversification, and why time is the scarcest asset.

## Play it

Open `index.html` in a browser. No install, no build step, no accounts; the game saves itself in your browser.

Hosted edition (after the repo owner enables GitHub Pages under *Settings → Pages → Source: GitHub Actions*):
**https://goatercoder.github.io/Escape-Botlandia/**

## How it works

| Thing | Rule |
|---|---|
| **The Machine** | The big button on the left. It starts as a cardboard sign, becomes a punch clock, a cash register, a vault, a golden core and finally the Exit Lever. Click it (or press Space) to hustle. |
| **Hustle Meter** | Fast clicking heats you up: HUSTLIN' ×1.5 → ON FIRE ×2 → OVERTIME ×3 → BURNOUT (8 s lockout, −2 health). Machines don't burn out. Buy machines. |
| **Jobs** | Earned income, taxed 35%. Every promotion mandates a bigger apartment (golden handcuffs). You can always quit. |
| **Businesses** | 14 assets from a Bootleg Battery Stand to an Orbital Mine. Each next one costs ~15% more; owning 10/25/50/100/200 multiplies output. Every business animates in the city behind the UI. |
| **Investments** | Index fund, dividend stock, bond, REIT and BitBot with a seeded random walk. Only dividends count as passive income; price gains don't until you sell (and then they're taxed). Market crashes have a 20-second BUY THE DIP window. Bonds never crash. |
| **Debt** | Repo-Tron's bad debt at 12%/yr vs Bot-Bank's good debt at 8%/yr, capped at half your business book value. Overdrafts become bad debt instantly. |
| **Doodads** | Doodad Dan sells Hover-Bikes, Bot-Lambos and Sky-Yachts. They add upkeep forever and look great parked outside your building. A third option appears when your assets can pay for the toy. |
| **Lifespan** | You start at 18 with 44 years to live (150 real seconds per year). Doc Module sells life extension, from a Gym Membership (+2 years) to a Cryo-Chamber (+10). Max age 100. Health under 20 is CRITICAL and can end you; the Medbay is cheap. |
| **Out of the rat race** | Passive income ≥ 1.25 × expenses for 3 months with zero bad debt. The little you on the Treadmill billboard steps off, and the Fast Track businesses unlock. |
| **Escape** | While out of the rat race, pay the Mainframe's Exit Toll. Rank: RAT / RUNNER / OWNER / GHOST IN THE MACHINE depending on your age. |
| **Wisdom** | Every ending grants Wisdom (half on a bad ending). Each point is +2% income forever; thresholds unlock perks like starting with no debt or +10 lifespan. |
| **Offline** | Your businesses earn at 50% for up to 8 hours while you're away. You also age, at quarter speed, never past your last year. |

Glitch's Ledger has 22 short lessons that arrive as envelopes and never block play; each one gives a perk that
demonstrates the lesson. Choice events let you make the mistakes (buy the Lambo, sell at the bottom, quit too early)
and then show you what would have happened.

## Project layout

```
index.html        the page: top bar, YOU column, THE MARKET column, dialogue box, modals
style.css         8-bit theme (Press Start 2P, pixel borders, hard shadows)
data.js           every table of content: jobs, businesses, investments, lessons, events, chapters, achievements
engine.js         pure game rules (no DOM): tick, buy, click, chapters, death, prestige, save/load
sprites.js        pixel art as character grids: avatar stages, the Machine, portraits, bots, icons
sprites-city.js   buildings, vehicles, props and palettes for the city
scene.js          the animated city canvas behind the UI
audio.js          WebAudio chiptune SFX and music (no asset files)
ui.js             DOM rendering, tabs, tooltips, tutorial, toasts, modals
main.js           boot, game loop, autosave, offline progress, keyboard
tools/sim.js      headless balance simulation (greedy / grinder / idle policies)
test/             node --test (rules + balance gate)
docs/SPEC.md      the full design document and module contract
```

## Development

```
npm test          # rules tests + balance gate (greedy escapes in 90–150 min, grinder dies a wage slave)
npm run check     # node --check on every module
npm start         # serve on http://localhost:8080
node tools/sim.js # print the pacing table
```

Add a business: one row in `Data.BUSINESSES`, one building in `sprites-city.js`. Add a lesson: one row in
`Data.LESSONS` plus its trigger in `engine.js`.

## Credits and disclaimers

Made with pixels and WebAudio; no assets, no trackers, everything stays in `localStorage`.
The financial ideas are simplified illustrations for a game, not advice: an 8% index return is a long-run
illustration, tax rates are Botlandia's, and the Rule of 72 is an approximation.
