/* ui.js - every piece of DOM for ESCAPE BOTLANDIA (global `UI`): top bar, the Machine, tabs,
 * tooltips, dialogue, toasts, chapter banners, choice events, lesson pages, endings, tutorial. */
(function (root) {
  'use strict';
  const Data = root.Data, Engine = root.Engine, Sprites = root.Sprites;
  const C = Data.CONST;
  const $ = (id) => document.getElementById(id);
  const fm = (n) => Engine.fmtMoney(n);
  const fps = (n) => Engine.fmtMoney(n) + '/s';
  // Cashflow speaks in months: every income/expense line in the UI is per game month (12.5 s).
  const pm = (n) => Engine.fmtMoney(n) + '/mo';
  const pct = (x) => (x >= 9.995 ? '999%+' : Engine.fmtPct(x));
  // Compact money for tight spots (boost buttons): $950, $12K, $1.3M ...
  function short(n) {
    const a = Math.abs(n);
    if (a < 1000) return '$' + Math.round(a);
    const u = [[1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [v, k] of u) if (a >= v) { const x = a / v; return '$' + (x < 10 ? x.toFixed(1) : Math.round(x)) + k; }
    return '$' + Math.round(a);
  }
  // Humans call you by your name; bots use your serial number.
  const HUMANS = { glitch: 1, maya: 1, you: 1 };
  function humanize(who, text) { return HUMANS[who] && S && S.name && S.name !== '4471' ? String(text).replace(/4471/g, S.name) : text; }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------------------------------
  // small DOM + sprite helpers
  // ------------------------------------------------------------------------------------------
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach((c) => { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  const urlCache = new Map();
  function spriteURL(sp, scale, opts) {
    if (!sp) return '';
    const key = sp;
    let m = urlCache.get(key);
    if (!m) { m = new Map(); urlCache.set(key, m); }
    const k2 = scale + '|' + JSON.stringify(opts || {});
    let u = m.get(k2);
    if (!u) { u = Sprites.render(sp, scale, opts || {}).toDataURL(); m.set(k2, u); }
    return u;
  }
  const ICON = (id, scale) => spriteURL(Sprites.ICONS[id] || Sprites.ICONS.question, scale || 2);
  function img(id, cls, scale) { return el('img', { src: ICON(id, scale), class: cls || '', alt: '' }); }
  function drawSprite(canvas, sp, scale, t, opts) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sp) return;
    const f = opts && opts.frame !== undefined ? sp : Sprites.frame(sp, t || 0, opts);
    const c = Sprites.render(f, scale, opts || {});
    ctx.drawImage(c, Math.floor((canvas.width - c.width) / 2), Math.floor((canvas.height - c.height) / 2));
  }
  function portrait(canvas, who) {
    drawSprite(canvas, Sprites.PORTRAITS[who] || Sprites.PORTRAITS.you, Math.floor(canvas.width / 16), 0);
  }
  const charName = (who) => (Data.CHARACTERS[who] ? Data.CHARACTERS[who].name : who).toUpperCase();
  const charColor = (who) => (Data.CHARACTERS[who] ? Data.CHARACTERS[who].color : '#e8ecff');

  // ------------------------------------------------------------------------------------------
  // module state
  // ------------------------------------------------------------------------------------------
  let S = null, D = null, ctx = null;
  const ui = {
    tab: 'work', qty: '1', tabSig: '', lastPanel: 0, cashShown: 0, nwShown: 0,
    modal: null, blockers: [], blocking: false, dialogueQ: [], dialogueCur: null,
    toasts: [], tutorialDone: false, captionTimer: 0, avatarReact: null, machineHitAt: -1e9,
    particles: [], floaters: [], lastT: 0, reduceMotion: false, glitchSeenAt: 0, lastHeartBeat: 0,
  };

  // ------------------------------------------------------------------------------------------
  // expense breakdown (for tooltips / LIFE / LEDGER)
  // ------------------------------------------------------------------------------------------
  function expenseLines() {
    const infl = S.inflationMult;
    const H = Data.byId['housing:' + S.housing];
    const rent = (S.chapter >= 2 || S.job.id) ? H.rent * infl : 0;
    let doodad = 0; Data.DOODADS.forEach((x) => { if (S.doodads[x.id]) doodad += x.upkeep; });
    let health = 0; Data.HEALTH_ITEMS.forEach((x) => { if (S.healthItems[x.id]) health += x.upkeep || 0; });
    let subs = 0; S.extraUpkeep.forEach((x) => { subs += x.monthly; });
    return [
      ['Rent: ' + H.name, rent],
      ['Doodad upkeep', doodad * infl],
      ['Health plans', health * infl],
      ['Subscriptions', subs * infl],
      ['Human Existence Tax', C.EXISTENCE_TAX * infl],
      ['Interest: Repo-Tron ' + Math.round(S.debtApr * 100) + '%', S.debt * S.debtApr / 12],
      ['Interest: Bot-Bank ' + Math.round(S.loanApr * 100) + '%', S.loan * S.loanApr / 12],
    ];
  }

  // ------------------------------------------------------------------------------------------
  // tooltips
  // ------------------------------------------------------------------------------------------
  function futureMe(price) {
    if (!D || !D.futureMe) return '';
    return `<p class="futureme">FUTURE ME: ${fm(price)} at 8% for 20 yrs ≈ <b>${fm(price * Math.pow(1.08, 20))}</b></p>`;
  }
  const TIPS = {
    cash: () => `<h4>CASH</h4><p>Money you can spend right now.</p><p>Bills are paid every tick. If cash hits $0, <b>Repo-Tron</b> pays them for you and adds it to your debt at ${Math.round(S.debtApr * 100)}%/yr.</p>`,
    netWorth: () => `<h4>NET WORTH ${fm(D.netWorth)}</h4><div class="kv"><span>Cash</span><span>${fm(D.cash)}</span><span>Businesses (what you paid)</span><span>${fm(D.bookValue)}</span><span>Investments</span><span>${fm(D.investValue)}</span><span>Repo-Tron debt</span><span class="bad">${fm(-D.debt)}</span><span>Bot-Bank loan</span><span class="bad">${fm(-D.loan)}</span></div><p>What you own minus what you owe. Yours started negative. Most do.</p>`,
    passive: () => `<h4>PASSIVE INCOME ${pm(D.passiveMonthly)}</h4><div class="kv"><span>Businesses (after ${Math.round(D.taxBizBase * 100)}% tax)</span><span class="good">${pm(D.bizNetBasePerSec * C.SEC_PER_MONTH)}</span><span>Dividends (after tax)</span><span class="good">${pm(D.divNetBasePerSec * C.SEC_PER_MONTH)}</span><span>Right now, with boosts</span><span>${pm(D.passiveMonthlyNow)}</span></div><p>Money that arrives whether you click or not. <b>Clicks don't count.</b> This is the number that gets you out.</p><p>1 game month = ${C.SEC_PER_MONTH} seconds. Boosts (Bot Strike, FRENZY) pay now but don't count toward freedom.</p>`,
    expenses: () => `<h4>EXPENSES ${fm(D.expensesMonthly)}/mo</h4><div class="kv">${expenseLines().filter((l) => l[1] > 0.005).map((l) => `<span>${esc(l[0])}</span><span>${fm(l[1])}</span>`).join('')}<span class="total">Total per month</span><span class="total bad">${fm(D.expensesMonthly)}</span></div><p>One game month = ${C.SEC_PER_MONTH} seconds. Prices rise ${(S.mods.inflation * 100).toFixed(1)}% a year.</p>${S.overdraftDebt > 0.5 ? `<p class="bad">Unpaid bills (${fm(S.overdraftDebt)}) are repaid automatically from your next income.</p>` : ''}`,
    freedom: () => {
      const locked = S.chapter < 4;
      if (locked) return `<h4>FREEDOM</h4><p>Unlocks in chapter 4. It will compare what your assets pay you with what life costs.</p>`;
      if (S.ending === 'escaped') return `<h4>ESCAPED</h4><p>You paid the toll. Nothing here counts your hours any more.</p>`;
      const audit = S.chapter >= C.RAT_RACE_FROM_CHAPTER;
      return `<h4>FREEDOM ${pct(D.freedomRatio)}</h4><div class="kv"><span>Passive per month</span><span class="good">${fm(D.passiveMonthly)}</span><span>Expenses per month</span><span class="bad">${fm(D.expensesMonthly)}</span></div>
        <p>The Cashflow rule: when <b>passive ≥ 125% of expenses</b> for <b>3 months in a row</b> with <b>no Repo-Tron debt</b>, you're <b>out of the rat race</b>.</p>
        ${S.flags.ratRaceExit ? '<p class="good">You are OUT of the rat race. Fast Track unlocked.</p>' : audit ? `<p>Good months so far: <b>${S.flags.ratRaceMonths}/${C.RAT_RACE_MONTHS}</b>${S.debt > 0 ? ' <span class="bad">(pay off Repo-Tron first!)</span>' : ''}</p>` : `<p>The Mainframe starts counting once you own real estate (<b>chapter 6: BRICKS</b>, buy a Pod Tower).</p>`}
        <p>The gold line marks the 125% goal. Promotions raise your rent and push the bar back.</p>${S.chapter >= 7 ? `<p>Now the bar shows your progress toward the <b>Exit Toll</b> (${fm(D.exitToll)}).</p>` : ''}`;
    },
    lifespan: () => `<h4>LIFE CLOCK</h4><div class="kv"><span>Age</span><span>${D.age.toFixed(1)}</span><span>Lifespan</span><span>${D.lifespan.toFixed(1)}</span><span>Years left</span><span class="${D.yearsLeft < 10 ? 'bad' : ''}">${D.yearsLeft.toFixed(1)}</span><span>Health</span><span class="${D.critical ? 'bad' : ''}">${Math.round(D.health)}/100 (${D.healthDriftPerYear >= 0 ? '+' : ''}${D.healthDriftPerYear}/yr)</span></div>
      <p>One year = ${C.SEC_PER_YEAR} seconds. When age reaches lifespan, the run ends. Die before you're out of the rat race and you <b class="bad">die a wage slave</b>.</p><p>Doc Module sells extra years in the LIFE tab. Health under ${C.CRITICAL_HEALTH} risks a sudden shutdown: visit the Medbay.</p>`,
    heat: () => `<h4>HUSTLE METER</h4><p>Click fast to heat up: <b>HUSTLIN' ×1.5</b> at 25, <b>ON FIRE ×2</b> at 50, <b>OVERTIME ×3</b> at 75.</p><p>At 100 you <b class="bad">BURN OUT</b>: ${C.BURNOUT_LOCK_MS / 1000}s locked, -${C.BURNOUT_HEALTH} health. Ride OVERTIME with a steady rhythm (~1.5 clicks/s).</p><p class="lesson">machines don't burn out. buy machines.</p>`,
    debt: () => `<h4>REPO-TRON DEBT ${fm(S.debt)}</h4><p>Bad debt at <b>${Math.round(S.debtApr * 100)}%/yr</b>. Interest is charged every month as an expense, and unpaid bills add to it.</p><p>You <b>must</b> pay it to zero to get out of the rat race.</p><p class="lesson">debt isn't a number. it's a rate.</p>`,
  };
  function tipFor(key) {
    if (!S || !D) return '';
    if (TIPS[key]) return TIPS[key]();
    const [kind, id] = key.split(':');
    if (kind === 'biz') {
      const B = Data.byId['business:' + id]; const b = D.businesses.find((x) => x.id === id);
      const each = b.owned > 0 ? b.netPerSec / b.owned : B.baseIncome * D.global * (1 - D.taxBiz);
      const disc = (S.flags.nextBizDiscount ? ' × ' + Math.round(S.flags.nextBizDiscount * 100) + '% (page 4 coupon)' : '') + (S.mods.bizDiscount ? ' - ' + Math.round(S.mods.bizDiscount * 100) + '% Negotiator' : '');
      return `<h4>${esc(B.name)}</h4><p>${esc(B.blurb)}</p><div class="kv"><span>Owned</span><span>${b.owned}</span><span>Each earns</span><span class="good">+${pm(each * C.SEC_PER_MONTH)}</span><span>Total</span><span class="good">+${pm(b.netPerSec * C.SEC_PER_MONTH)}</span><span>Milestone</span><span>×${b.milestoneMult}${b.nextMilestone ? ' (next at ' + b.nextMilestone + ')' : ''}</span><span>Upgrades</span><span>${b.level}/3</span></div>
        <p>Next costs <b>${fm(b.cost)}</b> = ${fm(B.baseCost)} × ${B.costMult}^${b.owned}${disc}</p><p>Pays for itself in <b>${b.payback < 1e9 ? Engine.fmtTime(b.payback) : '-'}</b></p><p class="lesson">${esc(B.lesson)}</p>${futureMe(b.cost)}`;
    }
    if (kind === 'bizupg') {
      const U = Data.byId['bizUpgrade:' + id]; const B = Data.byId['business:' + U.bizId];
      return `<h4>${esc(U.name)}</h4><p>${esc(B.name)} income <b>×${U.mult}</b>. Needs ${U.requires} owned.</p><p>Costs <b>${fm(U.cost)}</b>.</p>`;
    }
    if (kind === 'inv') {
      const I = Data.byId['investment:' + id]; const v = D.investments.find((x) => x.id === id);
      return `<h4>${esc(I.ticker)} · ${esc(I.name)}</h4><p>${esc(I.blurb)}</p><div class="kv"><span>Avg return</span><span>${Math.round(I.mu * 100)}%/yr</span><span>Swings (volatility)</span><span>${Math.round(I.sigma * 100)}%/yr</span><span>Dividend yield</span><span>${(I.yield * 100).toFixed(1)}%/yr</span><span>Crash drop</span><span>${I.immuneToCrash ? 'none' : '-' + Math.round(I.crash * 100) + '%'}</span></div>${v.units > 0 ? `<p>You own <b>${Engine.fmt(v.units)}</b> units worth <b>${fm(v.value)}</b> (paid ${fm(v.basis)}).</p>` : ''}<p class="lesson">${esc(I.lesson)}</p>`;
    }
    if (kind === 'upg') {
      const U = Data.byId['upgrade:' + id];
      return `<h4>${esc(U.name)}</h4><p>${esc(U.desc)}</p><p>${esc(U.blurb)}</p><p>Costs <b>${fm(Engine.upgradePrice(S, id))}</b></p>`;
    }
    if (kind === 'health') {
      const H = Data.byId['healthItem:' + id];
      return `<h4>${esc(H.name)}</h4><p>${esc(H.blurb)}</p><div class="kv"><span>Price</span><span>${fm(H.cost)}</span><span>Adds</span><span>${H.years ? '+' + H.years + ' years' : H.other}</span>${H.upkeep ? `<span>Upkeep</span><span class="bad">${fm(H.upkeep)}/mo</span>` : ''}${H.other && H.years ? `<span>Also</span><span>${esc(H.other)}</span>` : ''}</div>`;
    }
    if (kind === 'doodad') {
      const X = Data.byId['doodad:' + id];
      return `<h4>${esc(X.name)}</h4><p>"${esc(X.pitch)}"</p><div class="kv"><span>Price</span><span>${fm(X.price)}</span><span>Upkeep</span><span class="bad">${fm(X.upkeep)}/mo FOREVER</span><span>Status</span><span>+${X.status} (+${Math.round(X.status * C.STATUS_CLICK_BONUS * 100)}% clicks, faster promotions)</span></div><p class="lesson">a liability takes money out of your pocket every month.</p>${futureMe(X.price)}`;
    }
    if (kind === 'pu') {
      const P = Data.byId['powerup:' + id]; const p = D.activePowerups.find((x) => x.id === id);
      return `<h4>${esc(P.name)}</h4><p>${esc(P.desc)}</p><p>${esc(P.blurb)}</p><div class="kv"><span>Cost now</span><span>${fm(p.cost)}</span><span>Lasts</span><span>${P.durationS}s</span><span>Cooldown</span><span>${Engine.fmtTime(P.cooldownS)}</span>${P.lifeCost ? `<span>Life cost</span><span class="bad">-${P.lifeCost} yr</span>` : ''}</div>`;
    }
    if (kind === 'ach') {
      const A = Data.byId['achievement:' + id]; const got = S.achievements[id];
      if (!got && A.hidden) return `<h4>???</h4><p>A secret achievement.</p>`;
      return `<h4>${esc(A.name)}${got ? ' ✓' : ''}</h4><p>${esc(A.desc)}</p>${got ? `<p class="lesson">${esc(Engine.subst(A.line, { heldValue: fm(S.flags.lastHeldValue || 0) }))}</p>` : ''}<p>Each achievement: +1% income.</p>`;
    }
    if (kind === 'job') {
      const J = Data.byId['job:' + id]; const H = Data.byId['housing:' + J.housing];
      return `<h4>${esc(J.name)}</h4><p>${esc(J.blurb)}</p><div class="kv"><span>Pay per shift</span><span>${fm(J.gross)} > ${fm(J.gross * (1 - C.TAX_JOB))} after tax</span><span>Certificate</span><span>${fm(J.certCost)}</span><span>Mandated housing</span><span class="bad">${esc(H.name)} ${fm(H.rent)}/mo</span></div>`;
    }
    if (kind === 'housing') {
      const H = Data.byId['housing:' + id];
      return `<h4>${esc(H.name)}</h4><p>${esc(H.blurb)}</p><div class="kv"><span>Rent</span><span class="bad">${fm(H.rent)}/mo</span><span>Health</span><span>${H.healthDrift >= 0 ? '+' : ''}${H.healthDrift}/yr</span><span>Click bonus</span><span>×${H.clickMult}</span><span>Status</span><span>+${H.status}</span></div>`;
    }
    return '';
  }
  function showTooltip(target, x, y) {
    const key = target.getAttribute('data-tip');
    ui.tipKey = key;
    const html = tipFor(key);
    const t = $('tooltip');
    if (!html) { t.hidden = true; return; }
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 16, top = y + 16;
    if (left + r.width > innerWidth - 8) left = x - r.width - 16;
    if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
    t.style.left = Math.max(8, left) + 'px'; t.style.top = top + 'px';
    ui.tipTarget = target;
  }
  function hideTooltip() { $('tooltip').hidden = true; ui.tipTarget = null; ui.tipKey = null; }

  function showBubble(anchor, key) {
    const b = $('bubble');
    const text = Data.TIPS[key] || key;
    b.innerHTML = '';
    const cv = el('canvas', { width: 32, height: 32 }); portrait(cv, 'glitch');
    b.appendChild(cv);
    b.appendChild(el('div', { text: text }));
    b.appendChild(el('span', { class: 'gb-close', text: '[ got it ]' }));
    b.hidden = false;
    const r = anchor.getBoundingClientRect(); const br = b.getBoundingClientRect();
    let left = r.left + r.width / 2 - br.width / 2; let top = r.bottom + 8;
    if (top + br.height > innerHeight - 8) top = r.top - br.height - 8;
    b.style.left = Math.max(8, Math.min(innerWidth - br.width - 8, left)) + 'px';
    b.style.top = Math.max(8, top) + 'px';
    Engine.markSeen(S, 'tip_' + key);
    anchor.classList && anchor.classList.add('seen');
    clearTimeout(ui.bubbleTimer);
    ui.bubbleTimer = setTimeout(() => { b.hidden = true; }, 12000);
    audio('lesson');
  }
  function q(key) { return el('button', { class: 'qchip' + (S && S.flags.seen['tip_' + key] ? ' seen' : ''), 'data-q': key, 'aria-label': 'Explain', text: '?' }); }

  // ------------------------------------------------------------------------------------------
  // audio helpers
  // ------------------------------------------------------------------------------------------
  function audio(name, opts) { const A = root.BotAudio; if (A && S && S.settings.sound) try { A.play(name, opts); } catch (e) { /* never break the game for sound */ } }

  // ------------------------------------------------------------------------------------------
  // toasts
  // ------------------------------------------------------------------------------------------
  function toast(text, kind, iconId) {
    const box = $('toasts');
    const t = el('div', { class: 'toast ' + (kind || 'info') }, [iconId ? img(iconId, '', 2) : null, el('span', { text: text })]);
    box.appendChild(t);
    const kids = box.querySelectorAll('.toast:not(.out)');
    if (kids.length > C.TOAST_MAX) dismiss(kids[0]);
    setTimeout(() => dismiss(t), kind === 'whatif' ? 7000 : C.TOAST_MS);
  }
  function dismiss(t) { if (!t || t.classList.contains('out')) return; t.classList.add('out'); setTimeout(() => t.remove(), 320); }

  // ------------------------------------------------------------------------------------------
  // dialogue: ambient lines (non-blocking) and scenes (blocking, click to advance)
  // ------------------------------------------------------------------------------------------
  function say(who, text, ttl) {
    if (!text) return;
    // Trim only ambient lines: dropping a scene's last blocking line would leave the game paused forever.
    let ambient = 0;
    for (const x of ui.dialogueQ) if (!x.blocking) ambient++;
    if (ambient >= 2) { const i = ui.dialogueQ.findIndex((x) => !x.blocking); ui.dialogueQ.splice(i, 1); }
    ui.dialogueQ.push({ who, text: humanize(who, text), ttl: ttl || 4000, blocking: false });
  }
  function playScene(lines, onDone) {
    const items = lines.map((l) => ({ who: l.who, text: humanize(l.who, Engine.subst(l.text, { name: S.name })), blocking: true }));
    items[items.length - 1].onDone = onDone;
    ui.dialogueQ = items.concat(ui.dialogueQ.filter((x) => x.blocking));
    ui.dialogueCur = null;
    nextDialogue(performance.now());
  }
  function nextDialogue(now) {
    const box = $('dialogue');
    const cur = ui.dialogueCur;
    if (cur && cur.onDone) { const f = cur.onDone; cur.onDone = null; f(); }
    ui.dialogueCur = ui.dialogueQ.shift() || null;
    if (!ui.dialogueCur) { box.hidden = true; return; }
    const d = ui.dialogueCur;
    d.start = now; d.shown = 0;
    box.hidden = false;
    box.classList.toggle('blocking', !!d.blocking);
    portrait($('dialogue-portrait'), d.who);
    const w = $('dialogue-who'); w.textContent = charName(d.who); w.style.color = charColor(d.who);
    $('dialogue-text').textContent = '';
    box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
    if (d.blocking) audio('tick');
  }
  function updateDialogue(now) {
    const d = ui.dialogueCur;
    if (!d) {
      if (ui.dialogueQ.length && (!ui.blocking || ui.dialogueQ[0].blocking)) nextDialogue(now);
      return;
    }
    const cps = 55;
    const n = Math.min(d.text.length, Math.floor((now - d.start) / 1000 * cps));
    if (n !== d.shown) { d.shown = n; $('dialogue-text').textContent = d.text.slice(0, n); }
    if (!d.blocking && n >= d.text.length && now - d.start > d.text.length / cps * 1000 + d.ttl) nextDialogue(now);
  }
  function clickDialogue() {
    const d = ui.dialogueCur;
    if (!d) return;
    const now = performance.now();
    if (d.shown < d.text.length) { d.start = -1e9; return; } // finish typing first
    nextDialogue(now);
  }

  // ------------------------------------------------------------------------------------------
  // blockers: chapter banners + scenes, endings, offline card. One at a time.
  // ------------------------------------------------------------------------------------------
  function pushBlocker(fn) { ui.blockers.push(fn); if (!ui.blocking) runBlocker(); }
  function runBlocker() {
    const fn = ui.blockers.shift();
    if (!fn) { ui.blocking = false; return; }
    ui.blocking = true;
    fn(() => { ui.blocking = false; runBlocker(); });
  }
  function chapterSequence(n) {
    pushBlocker((done) => {
      const ch = Data.CHAPTERS[n - 1];
      const b = $('chapter-banner');
      $('cb-kicker').textContent = 'CHAPTER ' + n;
      $('cb-title').textContent = humanize('you', ch.title);
      $('cb-unlocks').innerHTML = n > 1 ? ch.unlocks.map((u) => '+ ' + esc(u.toUpperCase())).join('<br>')
        : 'EXPIRY IN ' + Math.round(S.lifespan - S.age) + ' YEARS · ' + (S.debt > 0 ? 'DEBT: ' + fm(S.debt) : 'NO DEBT');
      b.classList.remove('out'); b.hidden = false;
      $('bubble').hidden = true;
      audio('chapter');
      const hold = ui.reduceMotion ? 1200 : 2000;
      const big = n === 1 || n === 4 || n === 7 || n === 8;
      setTimeout(() => {
        b.classList.add('out');
        setTimeout(() => {
          b.hidden = true;
          if (big) playScene(ch.scene, () => { done(); });
          else { ch.scene.forEach((l) => say(l.who, Engine.subst(l.text, { name: S.name }), 3200)); done(); }
        }, 450);
      }, hold);
    });
  }

  // ------------------------------------------------------------------------------------------
  // modals
  // ------------------------------------------------------------------------------------------
  function openModal(build, opts) {
    // An offline or ending card owns the screen until it is dismissed (its blocker callback must run).
    if (ui.modal && (ui.modal.kind === 'offline' || ui.modal.kind === 'ending') && !(opts && (opts.kind === 'offline' || opts.kind === 'ending'))) return false;
    const rootEl = $('modal-root'), m = $('modal');
    m.className = 'modal' + (opts && opts.cls ? ' ' + opts.cls : '');
    m.innerHTML = '';
    build(m);
    rootEl.hidden = false;
    ui.modal = opts || {};
    hideTooltip();
    // Focus the card itself, not its first option: a player mashing Space to hustle must never
    // pick "All-in on MoonCoin" by accident. Options need a real click (or Tab first).
    m.setAttribute('tabindex', '-1');
    setTimeout(() => m.focus({ preventScroll: true }), 0);
    ui.modalAt = performance.now(); ui.modalKeyNav = false;
    $('app').inert = true;
    return true;
  }
  function closeModal() {
    const was = ui.modal;
    $('modal-root').hidden = true; $('modal').innerHTML = '';
    ui.modal = null;
    $('app').inert = false;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (was && was.onClose) was.onClose();
  }
  function closeX() { return el('button', { class: 'icon-btn close-x', 'aria-label': 'Close', text: '✕', onclick: () => closeModal() }); }
  function modalHead(who, title) {
    const cv = el('canvas', { width: 64, height: 64 }); portrait(cv, who);
    return el('div', { class: 'modal-head' }, [cv, el('div', {}, [el('div', { class: 'who', text: charName(who), style: 'color:' + charColor(who) }), el('h2', { text: title })])]);
  }

  function showEvent(pe) {
    const ev = Data.byId['event:' + pe.id];
    openModal((m) => {
      m.appendChild(modalHead(pe.who, pe.title));
      m.appendChild(el('div', { class: 'event-text', text: pe.text }));
      // extra context the event needs to teach properly
      if (pe.doodadId || pe.id === 'lambo') {
        const X = Data.byId['doodad:' + (pe.doodadId || 'lambo')];
        const credit = Math.max(0, X.price - S.cash);
        const expAfter = D.expensesMonthly + X.upkeep * S.inflationMult + credit * S.debtApr / 12;
        m.appendChild(el('div', { class: 'infobox warn', html: `<b>${esc(X.name)}</b>: ${fm(X.price)} · upkeep <b class="bad">${fm(X.upkeep)}/mo FOREVER</b> · +${X.status} status.<br>FREEDOM now <b>${pct(D.freedomRatio)}</b> · if you buy it: <b class="bad">${pct(expAfter > 0 ? D.passiveMonthly / expAfter : 0)}</b>${credit > 0 ? '<br><span class="bad">You are ' + fm(credit) + ' short. "0% down" means Repo-Tron lends it at ' + Math.round(S.debtApr * 100) + '%.</span>' : ''}` }));
      }
      if (pe.id === 'promotion' && D.job && D.job.nextJob) {
        const J = Data.byId['job:' + D.job.nextJob]; const H = Data.byId['housing:' + J.housing]; const cur = Data.byId['housing:' + S.housing];
        const rentUp = Data.HOUSING.indexOf(H) > Data.HOUSING.indexOf(cur);
        m.appendChild(el('div', { class: 'infobox gold', html: `<b>${esc(J.name)}</b>: ${fm(J.gross)}/shift (was ${fm(D.job.gross)}). Certificate: ${fm(J.certCost)}.<br>Mandated housing: <b class="${rentUp ? 'bad' : ''}">${esc(H.name)} ${fm(H.rent)}/mo</b>${rentUp ? ' (now ' + fm(cur.rent) + ')' : ' (no change)'}.<br><span class="muted">Golden handcuffs: a raise that raises your rent pushes the FREEDOM bar back.</span>` }));
      }
      const opts = el('div', { class: 'options' });
      pe.options.forEach((o) => {
        if (!o.visible) return;
        const op = ev.options[o.index];
        const cost = optionCost(op, pe, o);
        const kids = [el('span', { text: o.label })];
        if (cost > S.cash + 0.005) kids.push(el('span', { class: 'hint bad', text: 'ON CREDIT: ' + fm(cost - S.cash) + ' at ' + Math.round(S.debtApr * 100) + '%' }));
        const b = el('button', { class: 'btn', onclick: () => answer(pe.id, o.index) }, kids);
        opts.appendChild(b);
      });
      m.appendChild(opts);
    }, { kind: 'event', id: pe.id });
    audio(pe.who === 'dan' ? 'coin' : 'lesson');
  }
  // What an option would take out of your pocket right now (so the card can warn about "0% down").
  function optionCost(op, pe, view) {
    const o = op.outcome || {};
    let c = 0;
    if (o.cash < 0) c -= o.cash;
    if (o.lottery) c += o.lottery.tickets * o.lottery.price;
    if (o.doodad) { const X = Data.byId['doodad:' + (o.doodad === 'offer' ? pe.doodadId : o.doodad)]; if (X) c += X.price; }
    if (o.coverUpkeep && view && view.plan) c += view.plan.cost;
    if (o.job === 'next' && D.job) c += D.job.certCost;
    return c;
  }
  function answer(id, idx) {
    const r = Engine.answerEvent(S, id, idx, Date.now());
    closeModal();
    if (r && r.ok) {
      if (r.openTab) setTab(r.openTab);
      audio('buy');
    }
  }

  function showLesson(id) {
    const L = Data.byId['lesson:' + id];
    const status = S.lessons[id];
    const idx = Data.LESSONS.indexOf(L) + 1;
    openModal((m) => {
      const card = el('div', { class: 'lesson-card' });
      card.appendChild(el('div', { class: 'page-no', text: "GLITCH'S LEDGER · PAGE " + idx + '/' + Data.LESSONS.length }));
      card.appendChild(el('h2', { text: L.title }));
      card.appendChild(el('p', { text: L.text }));
      card.appendChild(el('p', { class: 'in-botlandia', html: '<b>IN BOTLANDIA:</b> ' + esc(L.botlandia) }));
      card.appendChild(el('div', { class: 'reward', html: (status === 'read' ? 'CLAIMED: ' : 'REWARD: ') + esc(L.rewardText) }));
      m.appendChild(card);
      const row = el('div', { class: 'row', style: 'margin-top:12px' });
      if (status === 'new') row.appendChild(el('button', { class: 'btn gold big wide', text: 'CLAIM REWARD', onclick: () => {
        const r = Engine.readLesson(S, id);
        closeModal();
        if (r.ok) { toast('PAGE ' + idx + ': ' + r.rewardText, 'gold', 'envelope'); audio('achievement'); }
      } }));
      else row.appendChild(el('button', { class: 'btn wide', text: 'CLOSE', onclick: closeModal }));
      m.appendChild(row);
    }, { kind: 'lesson' });
    audio('lesson');
  }

  function showOffline(sum) {
    pushBlocker((done) => {
      openModal((m) => {
        m.appendChild(modalHead('glitch', 'WHILE YOU WERE AWAY'));
        const g = el('div', { class: 'stats-grid' });
        const rows = [['Time away', Engine.fmtTime(sum.elapsed) + (sum.elapsed > sum.seconds ? ' (counted ' + Engine.fmtTime(sum.seconds) + ')' : '')],
          ['Your businesses earned', '+' + fm(sum.earned)], ['Rent, upkeep & interest', '-' + fm(sum.spent)], ['You aged', sum.yearsAged.toFixed(1) + ' years']];
        rows.forEach((r) => { g.appendChild(el('span', { text: r[0] })); g.appendChild(el('span', { text: r[1], class: r[1][0] === '+' ? 'good' : r[1][0] === '-' ? 'bad' : '' })); });
        m.appendChild(g);
        m.appendChild(el('div', { class: 'tip-line', text: Data.CHARACTERS.glitch.special.offline }));
        m.appendChild(el('button', { class: 'btn gold big wide', style: 'margin-top:12px', text: 'COLLECT', onclick: () => { closeModal(); burstAt($('machine'), 30, true); audio('chaching'); done(); } }));
      }, { kind: 'offline' });
    });
  }

  function statsRows(pairs) {
    const g = el('div', { class: 'stats-grid' });
    pairs.forEach((p) => { g.appendChild(el('span', { text: p[0] })); g.appendChild(el('span', { text: p[1], class: p[2] || '' })); });
    return g;
  }
  function personalTip(ending) {
    const E = Data.ENDINGS[ending];
    const doodadMonthly = Data.DOODADS.reduce((a, x) => a + (S.doodads[x.id] ? x.upkeep : 0), 0);
    const years = Math.max(1, Math.round(S.age - 18));
    const podCost = Data.byId['business:podtower'].baseCost;
    const tokens = {
      name: S.name, age: Math.floor(S.age), interestPaid: fm(S.stats.interestPaid), podtowers: Math.max(1, Math.round(S.stats.interestPaid / podCost * 4)),
      doodadMonthly: fm(doodadMonthly), doodadYears: years, doodadTotal: fm(doodadMonthly * 12 * years), freedomPct: Math.round(D.freedomRatio * 100),
      towersNeeded: Math.max(1, Math.ceil((D.expensesMonthly * 1.25 - D.passiveMonthly) / (Data.byId['business:podtower'].baseIncome * (1 - D.taxBiz) * C.SEC_PER_MONTH * D.global))),
      toll: fm(D.exitToll), tollPct: Math.round(Math.min(1, S.cash / D.exitToll) * 100), doodadsBought: S.stats.doodadsBought + (S.stats.doodadsBought === 1 ? ' doodad' : ' doodads'), interestEarned: fm(S.stats.interestEarned),
      wisdom: S.pendingWisdom,
    };
    for (const t of E.tips) if (Engine.evalCond(S, t.when)) return Engine.subst(t.text, tokens);
    return '';
  }
  function showDeath() {
    const ending = S.ending;
    const E = Data.ENDINGS[ending];
    pushBlocker((done) => {
      setTimeout(() => {
        const seized = Engine._internal.ownedTotal(S);
        playScene(E.lines.map((l) => ({ who: l.who, text: Engine.subst(l.text, { seized: seized }) })), () => {
          openModal((m) => {
            m.appendChild(el('h2', { text: E.title, style: 'text-align:center;color:' + (ending === 'free' ? 'var(--cyan)' : 'var(--red)') }));
            const t = el('div', { class: 'tombstone' });
            t.appendChild(el('div', { class: 'rip', text: 'R.I.P.' }));
            t.appendChild(el('div', { class: 'epitaph', html: `HERE LIES ${esc(S.name)}<br>18 - ${Math.floor(S.age)}<br>"${esc(E.tombstone.epitaph)}"<br><span class="muted">${esc(E.tombstone.cause)}</span>` }));
            m.appendChild(t);
            m.appendChild(statsRows([
              ['Years lived', Math.floor(S.age - 18) + ''], ['Shifts worked', Engine.fmt(S.stats.shifts).replace('.00', '')], ['Clicks', S.stats.lifetimeClicks + ''],
              ['Peak net worth', fm(S.stats.peakNetWorth)], ['Freedom at death', Engine.fmtPct(D.freedomRatio), D.freedomRatio >= 1 ? 'good' : 'bad'],
              ['Interest paid to Repo-Tron', fm(S.stats.interestPaid), 'bad'], ['Doodads bought', S.stats.doodadsBought + ''], ['Ledger pages read', D.lessonsRead + '/22'],
            ]));
            const tip = personalTip(ending);
            if (tip) m.appendChild(el('div', { class: 'tip-line', text: tip }));
            m.appendChild(el('div', { class: 'wisdom-gain', text: Engine.subst(E.hope, { wisdom: S.pendingWisdom }) }));
            m.appendChild(el('button', { class: 'btn gold big wide', text: E.button, onclick: () => { closeModal(); done(); ctx.onRebirth(); } }));
          }, { kind: 'ending' });
        });
      }, ui.reduceMotion ? 300 : 2600);
    });
  }
  function showEscape(ev) {
    const E = Data.ENDINGS.escaped;
    pushBlocker((done) => {
      setTimeout(() => {
        playScene(E.lines, () => {
          openModal((m) => {
            const v = el('div', { class: 'visa' });
            v.appendChild(el('h2', { text: E.visa.title + ' · ' + S.name }));
            v.appendChild(el('div', { class: 'rank', text: 'RANK: ' + (S.flags.rank || '') }));
            v.appendChild(statsRows([
              ['Escaped at age', S.age.toFixed(1)], ['Time played', Engine.fmtTime(S.playMs / 1000)], ['Clicks', S.stats.lifetimeClicks + ''],
              ['Net worth', fm(D.netWorth)], ['Passive vs expenses', fm(D.passiveMonthly) + ' / ' + fm(D.expensesMonthly) + ' a month'],
              ['Interest paid vs dividends + gains earned', fm(S.stats.interestPaid) + ' / ' + fm(S.stats.interestEarned)], ['Ledger pages read', D.lessonsRead + '/22'],
              ['Doodads declined', S.stats.doodadsDeclined + ''],
            ]));
            m.appendChild(v);
            const tip = personalTip('escaped');
            if (tip) m.appendChild(el('div', { class: 'tip-line', style: 'margin-top:10px', text: tip }));
            m.appendChild(el('div', { class: 'wisdom-gain', text: 'WISDOM +' + S.pendingWisdom + ' (each point: +2% income forever)' }));
            const row = el('div', { class: 'row' });
            row.appendChild(el('button', { class: 'btn gold big', text: 'NEW GAME+', onclick: () => { closeModal(); done(); ctx.onRebirth(); } }));
            row.appendChild(el('button', { class: 'btn big', text: 'KEEP BUILDING', onclick: () => { closeModal(); done(); toast('Sandbox mode. Start NEW GAME+ from ⚙ settings any time.', 'info'); } }));
            m.appendChild(row);
          }, { kind: 'ending' });
        });
      }, ui.reduceMotion ? 300 : 2400);
    });
  }

  function showSettings() {
    openModal((m) => {
      m.appendChild(closeX());
      m.appendChild(el('h2', { text: 'SETTINGS' }));
      const set = S.settings;
      const toggle = (label, key, after) => {
        const b = el('button', { class: 'btn small' + (set[key] ? ' on' : ''), text: set[key] ? 'ON' : 'OFF' });
        b.onclick = () => { set[key] = !set[key]; b.textContent = set[key] ? 'ON' : 'OFF'; b.classList.toggle('on', set[key]); after && after(); };
        return el('div', { class: 'settings-row' }, [el('span', { text: label }), b]);
      };
      m.appendChild(toggle('SOUND EFFECTS', 'sound', () => ctx.onSettings()));
      m.appendChild(toggle('MUSIC', 'music', () => ctx.onSettings()));
      m.appendChild(toggle('REDUCE MOTION', 'reduceMotion', () => ctx.onSettings()));
      m.appendChild(el('div', { class: 'settings-row' }, [el('span', { text: 'HOW TO PLAY' }), el('button', { class: 'btn small', text: 'OPEN', onclick: () => { closeModal(); showHelp(); } })]));
      const box = el('textarea', { class: 'save-box', spellcheck: 'false' });
      m.appendChild(el('h3', { class: 'section', text: 'SAVE CODE (copy to back up, paste to restore)' }));
      m.appendChild(box);
      m.appendChild(el('div', { class: 'row' }, [
        el('button', { class: 'btn small', text: 'EXPORT', onclick: () => { box.value = ctx.exportSave(); box.select(); } }),
        el('button', { class: 'btn small', text: 'IMPORT', onclick: () => { if (ctx.importSave(box.value.trim())) closeModal(); else box.value = 'That save code did not load.'; } }),
      ]));
      if (S.ending === 'escaped') m.appendChild(el('button', { class: 'btn gold wide', style: 'margin-top:12px', text: 'START NEW GAME+ (WISDOM +' + S.pendingWisdom + ')', onclick: () => { closeModal(); ctx.onRebirth(); } }));
      const reset = el('button', { class: 'btn red wide', style: 'margin-top:12px', text: 'HARD RESET (DELETE EVERYTHING)' });
      let armed = false;
      reset.onclick = () => { if (!armed) { armed = true; reset.textContent = 'REALLY? CLICK AGAIN TO DELETE'; return; } ctx.hardReset(); };
      m.appendChild(reset);
      m.appendChild(el('p', { class: 'muted', text: 'Escape Botlandia v1 · all data stays in your browser.' }));
    }, { kind: 'settings' });
  }
  function showHelp() {
    openModal((m) => {
      m.appendChild(closeX());
      m.appendChild(el('h2', { text: 'HOW TO ESCAPE BOTLANDIA' }));
      m.appendChild(el('ol', { class: 'help-list', html: [
        '<b>Click the Machine</b> (or press Space) to hustle. A steady rhythm keeps the HUSTLE meter in OVERTIME (×3). Too fast and you burn out.',
        '<b>Take a job</b> in WORK. Jobs pay per click but are taxed 35%, and every promotion forces pricier housing.',
        '<b>Buy businesses</b> in BIZ. They pay you every second, even while you sleep. Pick the shortest PAYBACK first. 10/25/50/100/200 owned multiplies them.',
        '<b>Pay off Repo-Tron</b> (the DEBT box). Bad debt grows 12% a year and blocks your escape.',
        '<b>Watch FREEDOM</b>: passive income ÷ expenses. Hold 125% for 3 months with no debt, after you own real estate, and you are out of the rat race.',
        '<b>Stay alive</b>: the heart shows your years left. Doc Module (LIFE) sells extra years. Health under 20 is dangerous.',
        '<b>Escape</b>: once out of the rat race, save up for the Exit Toll and walk out. Die first and you die a wage slave.',
        '<b>Read Glitch\'s pages</b> (the envelope). Each teaches one money idea and gives a real bonus.',
      ].map((x) => '<li>' + x + '</li>').join('') }));
      m.appendChild(el('p', { class: 'muted', text: 'TIME: 1 game month = ' + C.SEC_PER_MONTH + ' seconds, 1 year = ' + C.SEC_PER_YEAR + ' seconds. Income and bills are shown per month. The clock stops while you read.' }));
      m.appendChild(el('h3', { class: 'section', text: 'KEYS' }));
      m.appendChild(el('p', { class: 'muted', text: 'SPACE / ENTER hustle · 1-6 tabs · M mute · ESC close' }));
      m.appendChild(el('h3', { class: 'section', text: "GLITCH'S CODEX" }));
      const grid = el('div', { class: 'pages' });
      Object.keys(Data.TIPS).forEach((k) => grid.appendChild(el('button', { class: 'page-btn', text: k.toUpperCase(), onclick: (e) => showBubble(e.currentTarget, k) })));
      m.appendChild(grid);
    }, { kind: 'help' });
  }
  function renameDialog() {
    openModal((m) => {
      m.appendChild(el('h2', { text: 'WHAT IS YOUR NAME?' }));
      const inp = el('input', { value: S.name, maxlength: 12, class: 'title-name-input', style: 'width:100%;padding:8px;background:#0a0d26;border:3px solid var(--border);color:var(--gold);font-size:12px' });
      m.appendChild(inp);
      m.appendChild(el('button', { class: 'btn gold wide', style: 'margin-top:12px', text: 'SAVE', onclick: () => { const v = inp.value.trim().slice(0, 12); if (v) S.name = v; closeModal(); } }));
      setTimeout(() => inp.focus(), 50);
    }, { kind: 'rename' });
  }

  // ------------------------------------------------------------------------------------------
  // particles on the #fx canvas: coins, bills, sparks, floating numbers
  // ------------------------------------------------------------------------------------------
  let fx = null, fxCtx = null, dpr = 1;
  function resizeFx() {
    dpr = Math.min(2, root.devicePixelRatio || 1);
    fx.width = Math.floor(innerWidth * dpr); fx.height = Math.floor(innerHeight * dpr);
    fxCtx = fx.getContext('2d'); fxCtx.imageSmoothingEnabled = false;
  }
  function burst(x, y, n, gold, bills) {
    if (ui.reduceMotion) n = Math.min(n, 4);
    for (let i = 0; i < n && ui.particles.length < 220; i++) {
      ui.particles.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: -4 - Math.random() * 4, life: 900 + Math.random() * 300, age: 0,
        kind: bills ? 'bill' : 'coin', gold: !!gold, floor: y + 70 + Math.random() * 30, bounced: false });
    }
  }
  function burstAt(elm, n, gold) { const r = elm.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, n, gold); }
  function floatText(x, y, text, color, big) {
    ui.floaters.push({ x: x + (Math.random() - 0.5) * 30, y, text, color: color || '#4ade80', big: !!big, age: 0, life: big ? 1300 : 850 });
    if (ui.floaters.length > 40) ui.floaters.shift();
  }
  function drawFx(dt) {
    const g = fxCtx; if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    const coin = Sprites.render(Sprites.ICONS.coin, 2), coinG = Sprites.render(Sprites.ICONS.coin, 3), bill = Sprites.render(Sprites.ICONS.bill, 2);
    for (let i = ui.particles.length - 1; i >= 0; i--) {
      const p = ui.particles[i];
      p.age += dt; if (p.age > p.life) { ui.particles.splice(i, 1); continue; }
      const k = dt / 16.7;
      p.vy += 0.35 * k; p.x += p.vx * k; p.y += p.vy * k;
      if (!p.bounced && p.y > p.floor) { p.y = p.floor; p.vy *= -0.45; p.bounced = true; }
      g.globalAlpha = Math.max(0, 1 - p.age / p.life);
      const s = p.kind === 'bill' ? bill : p.gold ? coinG : coin;
      g.drawImage(s, Math.round(p.x - s.width / 2), Math.round(p.y - s.height / 2));
    }
    g.textAlign = 'center';
    for (let i = ui.floaters.length - 1; i >= 0; i--) {
      const f = ui.floaters[i];
      f.age += dt; if (f.age > f.life) { ui.floaters.splice(i, 1); continue; }
      const t = f.age / f.life;
      g.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      g.font = (f.big ? '18px' : '11px') + " 'Press Start 2P', monospace";
      const y = f.y - t * (f.big ? 80 : 60);
      g.fillStyle = '#05071a'; g.fillText(f.text, f.x + 2, y + 2);
      g.fillStyle = f.color; g.fillText(f.text, f.x, y);
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------------------------------------
  // the Machine
  // ------------------------------------------------------------------------------------------
  function onMachine(e) {
    if (!S || S.ending === 'wageslave' || S.ending === 'free') return;
    if (e && e.preventDefault) e.preventDefault();
    if (ctx.onUserGesture) ctx.onUserGesture();
    // The clock is frozen while a story scene or card is open, so the Machine is too.
    if (ui.blocking || ui.modal) {
      const now = performance.now();
      if (now - (ui.storyHintAt || 0) > 900) { ui.storyHintAt = now; const r0 = $('machine').getBoundingClientRect(); floatText(r0.left + r0.width / 2, r0.top + 20, 'STORY FIRST', '#ffd166'); }
      return;
    }
    const m = $('machine');
    const r = Engine.click(S, Date.now());
    const rect = m.getBoundingClientRect();
    const x = e && e.clientX ? e.clientX : rect.left + rect.width / 2;
    const y = e && e.clientY ? e.clientY : rect.top + rect.height / 3;
    if (r.locked) { audio('error'); floatText(x, y, 'BURNED OUT', '#f87171'); return; }
    ui.machineHitAt = performance.now();
    m.classList.remove('bounce'); m.classList.add('squash');
    setTimeout(() => { m.classList.remove('squash'); m.classList.add('bounce'); }, 80);
    m.style.rotate = ((Math.random() - 0.5) * 4).toFixed(1) + 'deg';
    const ring = $('machine-ring'); ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go');
    ring.style.borderColor = ['#ffd166', '#facc15', '#ff9a3c', '#ff3b3b'][r.tier] || '#ffd166';
    const n = r.crit ? 18 : 4 + r.tier * 3;
    burst(rect.left + rect.width / 2, rect.top + rect.height * 0.55, n, r.crit, r.tier >= 3);
    if (r.earned > 0) floatText(x, y - 10, '+' + fm(r.earned) + (r.crit ? '!!' : ''), r.crit ? '#ffd166' : '#4ade80', r.crit);
    if (r.crit) { floatText(rect.left + rect.width / 2, rect.top, 'JACKPOT!', '#ffd166', true); shake(); ui.avatarReact = { name: 'arms_up', until: performance.now() + 700 }; if (ctx.scene) ctx.scene.event('crit', {}); }
    if (r.tier >= 3 && !ui.reduceMotion && Math.random() < 0.3) shake();
    audio('click', { pitch: Math.min(12, Math.floor(S.heat / 8)), form: D ? D.machineForm : 'sign' });
    if (r.burnout) { audio('burnout'); shake(); ui.avatarReact = { name: 'sit', until: performance.now() + C.BURNOUT_LOCK_MS }; }
  }
  function shake() {
    if (ui.reduceMotion) return;
    document.body.classList.remove('shake'); void document.body.offsetWidth; document.body.classList.add('shake');
  }

  // ------------------------------------------------------------------------------------------
  // left column rendering (every frame, cheap)
  // ------------------------------------------------------------------------------------------
  let lastMachineKey = '', lastAvatarKey = '';
  function renderYou(now) {
    const form = D.machineForm;
    const hitting = now - ui.machineHitAt < 160;
    const mk = form + '|' + (hitting ? 'h' + Math.floor((now - ui.machineHitAt) / 80) : 'i' + Math.floor(now / 500) % 2) + '|' + (D.burnedOut ? 'b' : '');
    if (mk !== lastMachineKey) {
      lastMachineKey = mk;
      const sp = Sprites.MACHINES[form];
      const cv = $('machine-canvas');
      const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, cv.width, cv.height);
      const frame = hitting && sp.hit ? Sprites.frame(sp, now - ui.machineHitAt, { hit: true, fps: 12 }) : Sprites.frame(sp, now);
      g.drawImage(Sprites.render(frame, 6, D.burnedOut ? { tint: { color: '#ff3b3b', amount: 0.35 } } : {}), 0, 0);
    }
    const mf = Data.byId['machine:' + form];
    $('machine-verb').textContent = S.job.id || form !== 'sign' ? (S.job.id ? mf.clickVerb : 'HUSTLE') : mf.clickVerb;
    $('machine-value').textContent = '+' + fm(D.clickValue);
    const m = $('machine');
    m.className = 'machine' + (D.burnedOut ? ' locked' : '') + (D.heatTier ? ' tier' + D.heatTier : '') + (m.classList.contains('squash') ? ' squash' : m.classList.contains('bounce') ? ' bounce' : '');
    $('burnout-overlay').hidden = !D.burnedOut;
    if (D.burnedOut) $('burnout-left').textContent = Math.ceil(D.burnoutUntil - D.gameSeconds);
    const arms = S.mods.autoClicks;
    $('clone-arms').hidden = !arms;
    if (arms) $('clone-arms').textContent = 'CLONE ARMS: ' + arms + ' AUTO-SHIFTS/S';
    // hustle meter
    const segs = $('hustle-meter').children;
    const on = Math.round(D.heat / 100 * 12);
    for (let i = 0; i < 12; i++) segs[i].className = i < on ? 'on c' + D.heatTier : '';
    const lab = $('hustle-label'); lab.textContent = D.heatLabel; lab.className = 'hustle-label t' + D.heatTier;
    $('hustle-mult').textContent = '×' + D.heatMult;
    // avatar
    let stage = D.avatarStage;
    const react = ui.avatarReact && ui.avatarReact.until > now ? ui.avatarReact.name : (D.burnedOut ? 'sit' : D.health < 30 && Math.floor(now / 1500) % 3 === 0 ? 'cough' : null);
    const ak = stage + '|' + (react || Math.floor(now / 500) % 2) + '|' + (S.age >= 60 ? 'g' : '');
    if (ak !== lastAvatarKey) {
      lastAvatarKey = ak;
      let sp = Sprites.AVATARS[stage];
      if (S.age >= 60) sp = Sprites.withPalette(sp, { h: '#b8bfd8', H: '#8b93a7' });
      const cv = $('avatar');
      const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, cv.width, cv.height);
      const f = react && sp.reactions && sp.reactions[react] ? sp.reactions[react] : Sprites.frame(sp, now);
      g.drawImage(Sprites.render(f, 3), 0, 0);
    }
    // debt chip
    const dc = $('debt-chip');
    dc.hidden = S.debt <= 0.005;
    if (!dc.hidden) {
      $('debt-amount').textContent = fm(S.debt);
      $('debt-apr').textContent = Math.round(S.debtApr * 100) + '%/yr' + (S.overdraftDebt > 0.5 ? ' · bills auto-repay' : '');
      dc.classList.toggle('urgent', S.chapter >= 6 && !S.flags.ratRaceExit);
    }
    // envelope
    const newPages = Data.LESSONS.filter((L) => S.lessons[L.id] === 'new');
    $('envelope').hidden = !newPages.length;
    if (newPages.length) $('envelope-count').textContent = newPages.length;
    // boosts
    const bw = $('boosts');
    bw.hidden = S.chapter < 3;
    if (!bw.hidden) {
      if (!bw.children.length) Data.POWERUPS.forEach((P) => {
        const b = el('button', { class: 'boost', 'data-tip': 'pu:' + P.id, 'data-pu': P.id }, [img(P.id), el('span', { class: 'cost' }), el('i', { class: 'cd' })]);
        bw.appendChild(b);
      });
      D.activePowerups.forEach((p, i) => {
        const b = bw.children[i];
        const P = Data.POWERUPS[i];
        b.classList.toggle('active', p.active);
        b.classList.toggle('poor', !p.active && p.ready && S.cash < p.cost);
        b.disabled = !p.ready && !p.active;
        b.children[1].textContent = p.active ? Math.ceil(p.until - D.gameSeconds) + 's' : p.ready ? short(p.cost) : Engine.fmtTime(p.cooldownUntil - D.gameSeconds);
        b.children[2].style.height = !p.ready && !p.active ? Math.max(0, Math.min(100, (p.cooldownUntil - D.gameSeconds) / P.cooldownS * 100)) + '%' : '0';
      });
    }
  }

  // ------------------------------------------------------------------------------------------
  // top bar (every frame)
  // ------------------------------------------------------------------------------------------
  function renderTop(now, dt) {
    const lerp = (a, b) => (Math.abs(b - a) < Math.max(0.01, Math.abs(b) * 1e-4) ? b : a + (b - a) * Math.min(1, dt / 90));
    const prevCash = ui.cashShown;
    ui.cashShown = lerp(ui.cashShown, D.cash);
    ui.nwShown = lerp(ui.nwShown, D.netWorth);
    const cashEl = $('tb-cash');
    cashEl.textContent = fm(ui.cashShown);
    cashEl.classList.toggle('flash', Math.abs(ui.cashShown - prevCash) > Math.max(5, Math.abs(prevCash) * 0.05));
    const nw = $('tb-nw'); nw.textContent = fm(ui.nwShown); nw.className = 'stat-value ' + (D.netWorth < 0 ? 'bad' : '');
    const pv = $('tb-passive');
    if (D.boosted && D.passiveMonthlyNow > D.passiveMonthly * 1.01) { pv.textContent = '+' + fm(D.passiveMonthlyNow) + ' BOOST'; pv.classList.add('boost'); }
    else { pv.textContent = '+' + fm(D.passiveMonthly); pv.classList.remove('boost'); }
    $('tb-exp').textContent = fm(-D.expensesMonthly);
    const fw = $('tb-freedom-wrap');
    const locked = S.chapter < 4;
    fw.classList.toggle('locked', locked);
    fw.classList.toggle('free', !!S.flags.ratRaceExit);
    fw.classList.toggle('toll', !!(S.flags.ratRaceExit && S.chapter >= 7) || S.ending === 'escaped');
    fw.classList.toggle('precount', !locked && S.chapter < C.RAT_RACE_FROM_CHAPTER);
    if (locked) { $('tb-freedom-pct').textContent = 'LOCKED'; $('tb-freedom-fill').style.width = '0'; $('tb-freedom-title').textContent = 'FREEDOM'; }
    else if (S.ending === 'escaped') { $('tb-freedom-title').textContent = 'ESCAPED'; $('tb-freedom-pct').textContent = 'YOU ARE FREE'; $('tb-freedom-fill').style.width = '100%'; }
    else {
      const fill = Math.min(1, D.freedomRatio / (C.RAT_RACE_RATIO / 0.8)); // gold line at 80% of the bar = 125%
      $('tb-freedom-fill').style.width = (fill * 100).toFixed(1) + '%';
      const title = S.flags.ratRaceExit ? (S.chapter >= 7 ? 'EXIT TOLL' : 'FREE!')
        : S.chapter < C.RAT_RACE_FROM_CHAPTER ? 'FREEDOM (COUNTS FROM CH.6)'
        : S.flags.ratRaceMonths > 0 ? 'FREEDOM ' + S.flags.ratRaceMonths + '/3 MO' : 'FREEDOM · GOAL 125%';
      $('tb-freedom-title').textContent = title;
      if (S.flags.ratRaceExit && S.chapter >= 7) {
        const tp = Math.max(0, Math.min(1, S.cash / D.exitToll));
        $('tb-freedom-pct').textContent = (tp * 100).toFixed(tp < 0.1 ? 2 : 1) + '% of ' + fm(D.exitToll);
        $('tb-freedom-fill').style.width = (tp * 100).toFixed(2) + '%';
      } else $('tb-freedom-pct').textContent = pct(D.freedomRatio);
    }
    // life clock
    const yl = D.yearsLeft;
    $('tb-age').textContent = 'AGE ' + Math.floor(D.age);
    $('tb-left').textContent = S.ending === 'escaped' ? 'FREE' : yl.toFixed(yl < 10 ? 1 : 0) + ' YRS LEFT';
    const lf = $('tb-life-fill');
    lf.style.width = Math.max(0, Math.min(100, yl / Math.max(1, D.lifespan - 18) * 100)) + '%';
    lf.className = 'mini-fill life' + (yl < 5 ? ' danger' : yl < 10 ? ' warn' : '');
    const hf = $('tb-health-fill'); hf.style.width = Math.max(0, D.health) + '%'; hf.className = 'mini-fill health' + (D.critical ? ' danger' : '');
    $('lifeclock').className = 'stat stat-life' + (yl < 5 ? ' danger' : yl < 10 ? ' warn' : '');
    // heart beats faster as time runs out
    const period = S.ending ? 2000 : yl > 20 ? 1200 : yl > 10 ? 850 : yl > 3 ? 560 : 330;
    const ph = (now % period) / period;
    const beat = ph < 0.12 ? 1.25 : ph < 0.24 ? 1.05 : ph < 0.34 ? 1.18 : 1;
    const heart = $('tb-heart'); heart.style.transform = 'scale(' + beat + ')';
    if (yl < 3 && ph < 0.05 && now - ui.lastHeartBeat > period * 0.8 && !S.ending) { ui.lastHeartBeat = now; audio('heartbeat'); }
    $('vignette').classList.toggle('on', !!(D.critical && !S.ending));
    document.body.classList.toggle('crash', !!D.crashActive);
    // escape button + golden bot fallback
    $('escape-banner').hidden = !D.canEscape || ui.blocking || !!ui.modal;
    if (D.glitchActive) { if (!ui.glitchSeenAt) ui.glitchSeenAt = now; } else ui.glitchSeenAt = 0;
    $('glitch-btn').hidden = !(D.glitchActive && now - ui.glitchSeenAt > 4000) || !$('escape-banner').hidden;
  }

  // ------------------------------------------------------------------------------------------
  // tabs
  // ------------------------------------------------------------------------------------------
  const TAB_LIST = [
    { id: 'work', name: 'WORK', icon: 'tab_work', ch: 2 },
    { id: 'biz', name: 'BIZ', icon: 'tab_biz', ch: 3 },
    { id: 'invest', name: 'INVEST', icon: 'tab_invest', ch: 5 },
    { id: 'upgrades', name: 'UPGR', icon: 'tab_upgrades', ch: 4 },
    { id: 'life', name: 'LIFE', icon: 'tab_life', ch: 4 },
    { id: 'ledger', name: 'LEDGER', icon: 'tab_ledger', ch: 3 },
  ];
  function buildTabs() {
    const nav = $('tabs'); nav.innerHTML = '';
    TAB_LIST.forEach((t, i) => {
      nav.appendChild(el('button', { class: 'tab', 'data-tab': t.id, role: 'tab', title: t.name + ' (' + (i + 1) + ')', onclick: () => setTab(t.id) }, [img(t.icon, '', 1), el('span', { text: t.name })]));
    });
  }
  function tabUnlocked(id) { return D && D.tabsUnlocked.indexOf(id) >= 0; }
  function setTab(id) {
    if (!tabUnlocked(id)) {
      const t = TAB_LIST.find((x) => x.id === id);
      toast(t.name + ' unlocks in chapter ' + t.ch + '.', 'info', 'lock');
      audio('error');
      return;
    }
    if (ui.tab !== id) audio('tick');
    ui.tab = id; ui.tabSig = '';
    $('bubble').hidden = true;
    const first = !S.flags.tabsOpened[id];
    Engine.openTab(S, id);
    const cap = $('tab-caption');
    if (first && Data.TAB_CAPTIONS[id]) { cap.textContent = Data.TAB_CAPTIONS[id]; cap.hidden = false; clearTimeout(ui.captionTimer); ui.captionTimer = setTimeout(() => { cap.hidden = true; }, 6000); }
    renderPanel(true);
    $('tab-body').scrollTop = 0;
  }
  function renderTabsBar() {
    const nav = $('tabs');
    for (const b of nav.children) {
      const id = b.getAttribute('data-tab');
      const un = tabUnlocked(id);
      b.classList.toggle('active', id === ui.tab);
      b.classList.toggle('locked', !un);
      let dot = b.querySelector('.dot');
      const want = un && !S.flags.tabsOpened[id];
      if (want && !dot) b.appendChild(el('i', { class: 'dot' }));
      if (!want && dot) dot.remove();
    }
    if (!tabUnlocked(ui.tab)) {
      const firstUn = TAB_LIST.find((t) => tabUnlocked(t.id));
      ui.tab = firstUn ? firstUn.id : 'work';
    }
  }

  // Each tab: sig() > string that changes when the structure must be rebuilt; build(body) creates
  // DOM and returns update(); update() refreshes numbers in place.
  let tabUpdate = null;
  function renderPanel(force) {
    const body = $('tab-body');
    if (!tabUnlocked(ui.tab)) {
      if (ui.tabSig !== 'empty') {
        ui.tabSig = 'empty'; body.innerHTML = ''; tabUpdate = null;
        body.appendChild(el('div', { class: 'infobox', html: S.chapter < 2 ? '<b>Nothing to buy yet.</b><br>Click the big cardboard sign (the Machine). Bots sometimes drop a coin.<br><br>You are ' + Math.floor(S.age) + ', homeless' + (S.debt > 0 ? ' and ' + fm(S.debt) + ' in debt. Every click is cash; paying Repo-Tron is a button. Interest never sleeps.' : '.') : 'Locked.' }));
      }
      return;
    }
    const T = TABS[ui.tab];
    const sig = ui.tab + '|' + T.sig();
    if (force || sig !== ui.tabSig) {
      const keep = body.scrollTop;
      ui.tabSig = sig; body.innerHTML = '';
      tabUpdate = T.build(body);
      body.scrollTop = keep;
    }
    if (tabUpdate) tabUpdate();
  }

  function card(opts) {
    const c = el('div', { class: 'card' + (opts.cls ? ' ' + opts.cls : ''), 'data-tip': opts.tip || null });
    const iconBox = el('div', { class: 'card-icon' }, [opts.icon ? img(opts.icon) : null]);
    const badge = el('span', { class: 'owned-badge' }); badge.hidden = true; iconBox.appendChild(badge);
    const name = el('div', { class: 'card-name', text: opts.name });
    const sub = el('div', { class: 'card-sub', html: opts.sub || '' });
    const main = el('div', { class: 'card-main' }, [name, sub]);
    const actions = el('div', { class: 'card-actions' });
    c.appendChild(iconBox); c.appendChild(main); c.appendChild(actions);
    return { root: c, badge, name, sub, main, actions };
  }

  const TABS = {};
  // ---------------- WORK
  TABS.work = {
    sig: () => [S.job.id, D.job && D.job.canPromote, S.chapter >= 4].join(','),
    build(body) {
      const refs = {};
      if (!S.job.id) {
        body.appendChild(el('div', { class: 'infobox', html: '<b>BOT-CORP IS HIRING.</b> A job trades your hours for dollars. It is the fastest way to get your first capital. Use it as a launchpad, not a destination.' }));
        const J = Data.JOBS[0];
        const k = card({ name: J.name, icon: 'tab_work', tip: 'job:' + J.id, sub: `${fm(J.gross)} per shift, taxed 35% > <span class="good">${fm(J.gross * (1 - C.TAX_JOB))}</span><br>${esc(J.blurb)}` });
        k.actions.appendChild(el('button', { class: 'btn green', 'data-action': 'take-job', text: 'TAKE THE JOB', onclick: () => { const r = Engine.takeJob(S, 'scrap'); if (r.ok) { audio('promotion'); toast('Hired! Your Machine is now a punch clock.', 'money', 'tab_work'); } } }));
        body.appendChild(k.root);
      } else {
        const J = Data.byId['job:' + S.job.id];
        const H = Data.byId['housing:' + S.housing];
        const k = card({ name: J.name, icon: 'tab_work', tip: 'job:' + J.id, cls: 'owned-item' });
        refs.sub = k.sub;
        body.appendChild(k.root);
        const next = D.job && D.job.nextJob ? Data.byId['job:' + D.job.nextJob] : null;
        const prog = el('div', { class: 'infobox' });
        refs.prog = prog;
        body.appendChild(prog);
        const row = el('div', { class: 'row' });
        if (next) {
          refs.promote = el('button', { class: 'btn green', text: 'PROMOTE', onclick: () => {
            const r = Engine.takeJob(S, next.id);
            if (r.ok) { audio('promotion'); toast('Promoted to ' + next.name + '!', 'money', 'star'); } else toast(r.reason, 'warn');
          } });
          row.appendChild(refs.promote);
        }
        row.appendChild(el('button', { class: 'btn red', text: 'QUIT JOB', onclick: () => confirmQuit() }));
        body.appendChild(row);
        body.appendChild(el('div', { class: 'sep' }));
        const h = el('h3', { class: 'section' }, ['THE LADDER (GOLDEN HANDCUFFS)', q('quit')]);
        body.appendChild(h);
        Data.JOBS.forEach((X) => {
          const HX = Data.byId['housing:' + X.housing];
          const mine = X.id === S.job.id;
          const r = el('div', { class: 'perk' + (mine ? ' got' : ''), 'data-tip': 'job:' + X.id }, [
            el('span', { text: X.tier + '. ' + X.name }),
            el('span', { html: `${fm(X.gross)}/shift · <span class="bad">rent ${fm(HX.rent)}</span>` }),
          ]);
          body.appendChild(r);
        });
        body.appendChild(el('p', { class: 'muted', style: 'font-size:8px;line-height:1.8', text: 'Each rung pays more, and Bot-Corp moves you into pricier housing. The rent eats the raise. That is the treadmill.' }));
        refs.update = () => {
          const net = J.gross * (1 - D.taxJob);
          k.sub.innerHTML = `${esc(J.blurb)}<br>PAY ${fm(J.gross)} - TAX <span class="bad">${fm(J.gross * D.taxJob)}</span> = <span class="good">${fm(net)}</span> a shift<br>Housing: ${esc(H.name)} <span class="bad">${pm(H.rent * S.inflationMult)}</span>`;
          if (next) {
            const done = Math.min(1, D.job.shifts / D.job.shiftsToPromote);
            const NH = Data.byId['housing:' + next.housing];
            prog.innerHTML = `<b>NEXT: ${esc(next.name)}</b> · ${fm(next.gross)}/shift<br>Shifts ${Math.min(D.job.shifts, D.job.shiftsToPromote)}/${D.job.shiftsToPromote} · certificate ${fm(next.certCost)} · housing ${esc(NH.name)} (${pm(NH.rent)})<div class="bar gold" style="margin-top:6px"><i style="width:${(done * 100).toFixed(1)}%"></i></div>`;
            refs.promote.disabled = !D.job.canPromote;
          } else prog.innerHTML = '<b>TOP OF THE LADDER.</b> The ladder is still inside the building.';
        };
      }
      if (S.chapter >= 3) body.appendChild(el('div', { class: 'infobox gold', style: 'margin-top:8px', html: 'Your businesses keep paying when you stop clicking. Your job does not. Compare them in the LEDGER tab.' }));
      return () => { if (refs.update) refs.update(); };
    },
  };
  function confirmQuit() {
    openModal((m) => {
      m.appendChild(modalHead('supe', 'QUIT BOT-CORP?'));
      const covered = D.passiveMonthly >= D.expensesMonthly;
      m.appendChild(el('p', { html: covered ? 'Your passive income covers your expenses. The job is optional now. Clicks become <b>Hands-On Owner</b>: 1% of your business income per click.' : `<span class="bad">Your passive income (${fm(D.passiveMonthly)}/mo) does NOT cover your expenses (${fm(D.expensesMonthly)}/mo).</span> Without the job, the gap becomes debt.` }));
      m.appendChild(el('p', { class: 'muted', text: 'Quitting also lifts the housing mandate: you can move somewhere cheaper in LIFE. If you ever come back, Bot-Corp starts you at the bottom again.' }));
      const row = el('div', { class: 'row' });
      row.appendChild(el('button', { class: 'btn red', text: 'QUIT', onclick: () => { Engine.quitJob(S); closeModal(); audio('whoosh'); } }));
      row.appendChild(el('button', { class: 'btn', text: 'STAY', onclick: closeModal }));
      m.appendChild(row);
    }, { kind: 'confirm' });
  }

  // ---------------- BIZ
  TABS.biz = {
    sig: () => D.businesses.map((b) => (b.unlocked || S.flags.seen['biz_' + b.id] ? 1 : 0) + (b.fastTrackLocked ? 'f' : '') + b.level).join('') + ui.qty + (S.mods.autobuy ? 'a' : '') + (S.flags.tabsOpened.biz ? '' : 'n'),
    build(body) {
      const qrow = el('div', { class: 'qty-row' }, [el('span', { class: 'label', text: 'BUY' })]);
      ['1', '10', '100', 'max'].forEach((v) => qrow.appendChild(el('button', { class: 'btn' + (ui.qty === v ? ' on' : ''), text: v === 'max' ? 'MAX' : '×' + v, onclick: () => { ui.qty = v; renderPanel(true); } })));
      qrow.appendChild(q('payback'));
      body.appendChild(qrow);
      if (Engine._internal.ownedTotal(S) === 0) body.appendChild(el('div', { class: 'infobox', html: '<b>ASSETS PAY YOU WHILE YOU SLEEP.</b> Buy one and watch it appear in the city. <b>PAYBACK</b> = how long until it has paid for itself. Shortest payback first.' }));
      const cards = [];
      let shownMystery = false;
      D.businesses.forEach((b, i) => {
        const B = Data.BUSINESSES[i];
        if (!b.unlocked && !S.flags.seen['biz_' + B.id]) {
          if (shownMystery) return;
          shownMystery = true;
          const k = card({ name: '??? ' + (B.fastTrack ? '(FAST TRACK)' : ''), icon: B.id, cls: 'mystery', sub: `Unlocks when you own a ${esc(Data.BUSINESSES[i - 1].name)} or have ${fm(b.cost * C.BIZ_VISIBLE_CASH_PCT)} cash.` });
          body.appendChild(k.root);
          return;
        }
        const k = card({ name: B.name, icon: B.id, tip: 'biz:' + B.id });
        const buy = el('button', { class: 'btn buy', 'data-buy': B.id, onclick: () => buyBiz(B.id, buy) });
        const price = el('div', { class: 'price' });
        k.actions.appendChild(buy); k.actions.appendChild(price);
        const ms = el('div', { class: 'ms' }, [el('div', { class: 'bar gold' }, [el('i')])]);
        k.main.appendChild(ms);
        const up = el('div', { class: 'upgrades' });
        k.main.appendChild(up);
        B.upgrades.forEach((U) => {
          if (b.level >= U.level) up.appendChild(el('button', { class: 'btn owned', 'data-tip': 'bizupg:' + U.id, text: '✓ ' + U.name, disabled: true }));
          else if (b.level === U.level - 1) {
            const ub = el('button', { class: 'btn', 'data-tip': 'bizupg:' + U.id, onclick: () => { const r = Engine.buyUpgrade(S, U.id); if (r.ok) { audio('buy'); toast(U.name + ': ' + B.name + ' ×1.5', 'money', B.id); } else toast(r.reason, 'warn'); } });
            ub._U = U; up.appendChild(ub);
          }
        });
        if (S.mods.autobuy) {
          const ab = el('button', { class: 'btn tiny' + (b.auto ? ' on' : ''), text: 'AUTO ' + (b.auto ? 'ON' : 'OFF'), onclick: () => { Engine.setAutobuy(S, B.id, !S.businesses[B.id].auto); renderPanel(true); } });
          k.actions.appendChild(ab);
        }
        if (b.fastTrackLocked) k.root.appendChild(el('div', { class: 'fasttrack-lock', html: 'FAST TRACK<br>get out of the rat race to unlock' }));
        if (!S.flags.seen['biz_' + B.id]) { k.root.classList.add('fresh'); S.flags.seen['biz_' + B.id] = true; }
        body.appendChild(k.root);
        cards.push({ k, b: B, buy, price, ms, up });
      });
      return () => {
        cards.forEach((c, idx) => {
          const b = D.businesses.find((x) => x.id === c.b.id);
          const qte = Engine.quote(S, c.b.id, ui.qty);
          const count = ui.qty === 'max' ? Math.max(1, qte.count) : qte.count;
          const qq = ui.qty === 'max' && qte.count === 0 ? Engine.quote(S, c.b.id, 1) : qte;
          const afford = qte.count > 0 && S.cash >= qq.total - 1e-6 && !b.fastTrackLocked;
          c.k.root.classList.toggle('affordable', afford);
          c.k.root.classList.toggle('boosted', b.boosted);
          c.buy.textContent = 'BUY ×' + count;
          c.buy.disabled = !afford;
          c.price.textContent = fm(qq.total);
          c.k.badge.hidden = !b.owned; c.k.badge.textContent = '×' + b.owned;
          const each = b.owned > 0 ? b.netPerSec / b.owned : c.b.baseIncome * D.global * (1 - D.taxBiz);
          c.k.sub.innerHTML = `<span class="good">+${pm(each * C.SEC_PER_MONTH)}</span> each${b.owned ? ' · total <span class="good">' + pm(b.netPerSec * C.SEC_PER_MONTH) + '</span>' : ''}<br>PAYBACK ${b.payback < 1e9 ? Engine.fmtTime(b.payback) : '-'}${b.boosted ? ' · <span class="gold">MILESTONE ×2!</span>' : ''}`;
          const nm = b.nextMilestone;
          const prevM = [0, 10, 25, 50, 100, 200].filter((x) => x <= b.owned).pop();
          const msp = nm ? (b.owned - prevM) / (nm - prevM) : 1;
          c.ms.firstChild.firstChild.style.width = (msp * 100).toFixed(1) + '%';
          c.ms.title = nm ? 'Next milestone at ' + nm + ' owned' : 'All milestones reached';
          for (const ub of c.up.children) if (ub._U) { ub.textContent = ub._U.name + ' ' + fm(ub._U.cost); ub.disabled = S.cash < ub._U.cost || b.owned < ub._U.requires; if (b.owned < ub._U.requires) ub.textContent = ub._U.name + ' (own ' + ub._U.requires + ')'; }
        });
      };
    },
  };
  function buyBiz(id, btn) {
    const r = Engine.buy(S, id, ui.qty);
    if (r.ok) {
      audio('chaching');
      const rect = btn.getBoundingClientRect();
      floatText(rect.left + rect.width / 2, rect.top, '-' + fm(r.spent), '#facc15');
      ui.avatarReact = { name: 'jump', until: performance.now() + 500 };
    } else { audio('error'); toast(r.reason, 'warn'); }
  }

  // ---------------- INVEST
  TABS.invest = {
    sig: () => D.investments.map((v) => (v.unlocked ? 1 : 0)).join('') + (D.dripUnlocked ? 'd' : '') + (D.loanUnlocked ? 'l' : '') + (D.dipActive ? 'x' : ''),
    build(body) {
      if (D.dipActive) body.appendChild(el('div', { class: 'infobox gold pulse', html: '<b>BUY THE DIP!</b> B500 is 30% off for a few seconds. Everything is on sale.' }));
      body.appendChild(el('div', { class: 'infobox', html: '<b>PAPER ASSETS.</b> Dividends count as passive income. Price gains only count when you sell, and then they are taxed. Bonds never crash; everything else does.' }));
      if (D.dripUnlocked) {
        const drip = el('button', { class: 'btn small' + (S.drip ? ' on' : ''), text: 'DRIP ' + (S.drip ? 'ON' : 'OFF'), onclick: () => { Engine.setDrip(S, !S.drip); renderPanel(true); } });
        body.appendChild(el('div', { class: 'row', style: 'margin-bottom:8px' }, [el('span', { class: 'muted', style: 'font-size:8px;flex:2', text: 'Reinvest dividends automatically' }), drip, q('drip')]));
      }
      const cards = [];
      D.investments.forEach((v) => {
        const I = Data.byId['investment:' + v.id];
        if (!v.unlocked) {
          body.appendChild(card({ name: '??? ' + I.ticker, icon: I.id, cls: 'mystery', sub: 'Unlocks: ' + esc(I.unlockText) }).root);
          return;
        }
        const c = el('div', { class: 'card invest-card', 'data-tip': 'inv:' + I.id });
        const priceBox = el('div', { class: 'iprice' });
        const sub = el('div', { class: 'card-sub' });
        c.appendChild(el('div', { class: 'ihead' }, [el('div', { class: 'card-icon' }, [img(I.id)]), el('div', { class: 'card-main' }, [el('div', { class: 'card-name', text: I.ticker + ' · ' + I.name }), sub]), priceBox]));
        const spark = el('canvas', { class: 'spark', width: 340, height: 34 });
        c.appendChild(spark);
        const buys = el('div', { class: 'ibuttons' }, [el('span', { class: 'ilabel', text: 'BUY' })]);
        [['$100', () => 100], ['$1K', () => 1000], ['10%', () => S.cash * 0.1], ['50%', () => S.cash * 0.5], ['MAX', () => S.cash]].forEach(([label, amt]) => {
          buys.appendChild(el('button', { class: 'btn green', text: label, onclick: () => { const r = Engine.investBuy(S, I.id, amt()); if (r.ok) audio('chaching'); else { toast(r.reason, 'warn'); audio('error'); } } }));
        });
        const sells = el('div', { class: 'isell' }, [el('span', { class: 'ilabel', text: 'SELL' })]);
        [['25%', 0.25], ['50%', 0.5], ['ALL', 1]].forEach(([label, f]) => {
          sells.appendChild(el('button', { class: 'btn red', text: label, onclick: () => { const r = Engine.investSell(S, I.id, f); if (r.ok) { audio('coin'); toast(`Sold for ${fm(r.proceeds)}${r.tax > 0 ? ' (gains tax -' + fm(r.tax) + ')' : ''}`, r.gain >= 0 ? 'money' : 'warn'); } else toast(r.reason, 'warn'); } }));
        });
        c.appendChild(buys); c.appendChild(sells);
        body.appendChild(c);
        cards.push({ I, priceBox, sub, spark, sells });
      });
      body.appendChild(el('div', { class: 'sep' }));
      // Bot-Bank
      let loanRefs = null;
      if (D.loanUnlocked) {
        const box = el('div', { class: 'card', style: 'display:block' });
        box.appendChild(el('h3', { class: 'section' }, ['BOT-BANK (GOOD DEBT)', q('loan')]));
        const info = el('div', { class: 'kv' });
        box.appendChild(info);
        const row = el('div', { class: 'row', style: 'margin-top:8px' });
        [['BORROW 25%', 0.25], ['50%', 0.5], ['MAX', 1]].forEach(([label, f]) => row.appendChild(el('button', { class: 'btn cyan small', text: label, onclick: () => { const r = Engine.takeLoan(S, D.loanCapacity * f); if (r.ok) { audio('chaching'); toast('Borrowed ' + fm(r.amount) + ' at ' + Math.round(S.loanApr * 100) + '%', 'info'); } else toast(r.reason, 'warn'); } })));
        row.appendChild(el('button', { class: 'btn small', text: 'REPAY ALL', onclick: () => { const r = Engine.repayLoan(S, S.loan); if (!r.ok) toast(r.reason, 'warn'); else audio('coin'); } }));
        box.appendChild(row);
        body.appendChild(box);
        loanRefs = info;
      } else body.appendChild(el('div', { class: 'infobox', html: 'BOT-BANK loans unlock with Glitch\'s page <b>Good Debt vs Bad Debt</b>.' }));
      return () => {
        cards.forEach((c) => {
          const v = D.investments.find((x) => x.id === c.I.id);
          const h = v.history; const first = h[0], last = h[h.length - 1];
          const ch = first ? (last - first) / first : 0;
          c.priceBox.innerHTML = `${fm(v.dipPrice)}<small class="${ch >= 0 ? 'good' : 'bad'}">${ch >= 0 ? '▲' : '▼'} ${(Math.abs(ch) * 100).toFixed(1)}% 52w</small>`;
          c.sub.innerHTML = v.units > 0 ? `${Engine.fmt(v.units)} units · ${fm(v.value)} <span class="${v.gain >= 0 ? 'good' : 'bad'}">(${v.gain >= 0 ? '+' : ''}${fm(v.gain)})</span>${c.I.yield ? ' · <span class="good">+' + fm(v.yieldPerMonth) + '/mo</span>' : ''}` : `yield ${(c.I.yield * 100).toFixed(1)}%/yr · avg ${Math.round(c.I.mu * 100)}%/yr`;
          for (const b of c.sells.querySelectorAll('button')) b.disabled = v.units <= 0;
          drawSpark(c.spark, h, D.crashActive && !c.I.immuneToCrash);
        });
        if (loanRefs) loanRefs.innerHTML = `<span>Borrowed</span><span>${fm(S.loan)}</span><span>Can borrow</span><span>${fm(D.loanCapacity)}</span><span>Rate</span><span>${Math.round(S.loanApr * 100)}%/yr</span><span>Your businesses return</span><span class="${D.loanRoi > S.loanApr ? 'good' : 'bad'}">${(D.loanRoi * 100).toFixed(0)}%/yr on cost</span><span>Leverage</span><span class="${D.loanRoi > S.loanApr ? 'good' : 'bad'}">${D.loanRoi > S.loanApr ? 'PAYS (+' : 'COSTS ('}${((D.loanRoi - S.loanApr) * 100).toFixed(0)}%)</span>`;
      };
    },
  };
  // Projected age at which steady passive income alone reaches the Exit Toll.
  function tollAge() {
    const perSec = D.bizNetBasePerSec + D.divNetBasePerSec - D.expensesPerSec;
    if (S.cash >= D.exitToll) return D.age;
    if (perSec <= 0) return Infinity;
    return D.age + (D.exitToll - S.cash) / perSec / C.SEC_PER_YEAR;
  }
  function drawSpark(cv, h, red) {
    const g = cv.getContext('2d');
    const w = cv.width, ht = cv.height;
    g.clearRect(0, 0, w, ht);
    if (h.length < 2) return;
    let lo = Infinity, hi = -Infinity; h.forEach((x) => { lo = Math.min(lo, x); hi = Math.max(hi, x); });
    const span = hi - lo || 1;
    g.fillStyle = red ? '#f87171' : h[h.length - 1] >= h[0] ? '#4ade80' : '#f87171';
    for (let i = 0; i < h.length; i++) {
      const x = Math.floor(i / (h.length - 1) * (w - 3));
      const y = Math.floor((1 - (h[i] - lo) / span) * (ht - 6)) + 2;
      g.fillRect(x, y, 3, 3);
      if (i > 0) { const px = Math.floor((i - 1) / (h.length - 1) * (w - 3)); const py = Math.floor((1 - (h[i - 1] - lo) / span) * (ht - 6)) + 2; const steps = Math.max(1, Math.abs(x - px)); for (let s = 0; s < steps; s += 2) g.fillRect(px + s, Math.round(py + (y - py) * s / steps), 2, 2); }
    }
  }

  // ---------------- UPGRADES
  TABS.upgrades = {
    sig: () => Data.UPGRADES.map((U) => (S.upgrades[U.id] ? 1 : 0)).join(''),
    build(body) {
      body.appendChild(el('div', { class: 'infobox', html: '<b>BUILD SYSTEMS, NOT JOBS.</b> These make your money work without you: clone arms that click for you, managers that run things while you sleep.' }));
      const cards = [];
      Data.UPGRADES.forEach((U) => {
        const owned = S.upgrades[U.id];
        if (!owned && U.requires && !S.upgrades[U.requires]) return;
        const icon = U.id.startsWith('clone') ? 'energy' : U.id.startsWith('crit') ? 'star' : U.id.startsWith('negotiator') ? 'tab_biz' : U.id === 'accountant' ? 'taxholiday' : U.id === 'managers' ? 'tab_upgrades' : U.id === 'nightowl' ? 'coffee' : 'strike';
        const k = card({ name: U.name, icon, tip: 'upg:' + U.id, cls: owned ? 'owned-item' : '', sub: esc(U.desc) + '<br><span class="muted">' + esc(U.blurb) + '</span>' });
        if (owned) k.actions.appendChild(el('div', { class: 'price good', text: 'OWNED' }));
        else {
          const b = el('button', { class: 'btn buy', text: 'BUY', onclick: () => { const r = Engine.buyUpgrade(S, U.id); if (r.ok) { audio('buy'); toast(U.name + ' installed.', 'money'); } else toast(r.reason, 'warn'); } });
          const p = el('div', { class: 'price' });
          k.actions.appendChild(b); k.actions.appendChild(p);
          cards.push({ k, b, p, U });
        }
        body.appendChild(k.root);
      });
      return () => cards.forEach((c) => { const price = Engine.upgradePrice(S, c.U.id); c.p.textContent = fm(price); c.b.disabled = S.cash < price; c.k.root.classList.toggle('affordable', S.cash >= price); });
    },
  };

  // ---------------- LIFE
  TABS.life = {
    sig: () => [S.housing, S.job.mandatedHousing, Data.HEALTH_ITEMS.map((H) => (S.healthItems[H.id] ? 1 : 0)).join(''), Data.DOODADS.map((X) => (S.doodads[X.id] ? 1 : 0)).join('')].join('|'),
    build(body) {
      const refs = {};
      const hb = el('div', { class: 'card', style: 'display:block' });
      hb.appendChild(el('h3', { class: 'section' }, ['HEALTH & LIFESPAN', q('health')]));
      refs.health = el('div'); hb.appendChild(refs.health);
      refs.medbay = el('button', { class: 'btn green wide', style: 'margin-top:8px', onclick: () => { const r = Engine.medbay(S); if (r.ok) { audio('achievement'); toast('Medbay: health restored to 70 (-' + fm(r.cost) + ')', 'money', 'heart'); } else toast(r.reason, 'warn'); } });
      hb.appendChild(refs.medbay);
      body.appendChild(hb);
      body.appendChild(el('h3', { class: 'section' }, ["DOC MODULE: BUY YEARS", q('lifespan')]));
      const hcards = [];
      Data.HEALTH_ITEMS.forEach((H) => {
        const owned = S.healthItems[H.id];
        const k = card({ name: H.name, icon: H.id, tip: 'health:' + H.id, cls: (owned ? 'owned-item' : '') + (H.scam ? ' scam' : ''), sub: (H.years ? '<span class="good">+' + H.years + ' years</span>' : '<span class="muted">' + esc(H.other) + '</span>') + (H.upkeep ? ' · <span class="bad">' + fm(H.upkeep) + '/mo</span>' : '') + (H.years && H.other ? '<br>' + esc(H.other) : '') });
        if (owned) k.actions.appendChild(el('div', { class: 'price good', text: H.scam ? 'NO REFUNDS' : 'OWNED' }));
        else {
          const b = el('button', { class: 'btn buy', text: 'BUY', onclick: () => { const r = Engine.buyHealth(S, H.id); if (!r.ok) toast(r.reason, 'warn'); else audio(H.scam ? 'error' : 'achievement'); } });
          k.actions.appendChild(b); k.actions.appendChild(el('div', { class: 'price', text: fm(H.cost) }));
          hcards.push({ k, b, H });
        }
        body.appendChild(k.root);
      });
      body.appendChild(el('h3', { class: 'section' }, ['HOUSING', q('status')]));
      const mand = S.job.id && S.job.mandatedHousing ? Data.HOUSING.findIndex((h) => h.id === S.job.mandatedHousing) : 0;
      Data.HOUSING.forEach((H, i) => {
        const cur = H.id === S.housing;
        const k = card({ name: H.name, icon: 'tab_life', tip: 'housing:' + H.id, cls: cur ? 'owned-item' : '', sub: `<span class="bad">${fm(H.rent)}/mo</span> · health ${H.healthDrift >= 0 ? '+' : ''}${H.healthDrift}/yr · clicks ×${H.clickMult}${H.status ? ' · +' + H.status + ' status' : ''}` });
        if (cur) k.actions.appendChild(el('div', { class: 'price good', text: 'HOME' }));
        else if (i < mand) k.actions.appendChild(el('div', { class: 'price bad', text: 'JOB SAYS NO' }));
        else k.actions.appendChild(el('button', { class: 'btn small', text: 'MOVE', onclick: () => { const r = Engine.setHousing(S, H.id); if (!r.ok) toast(r.reason, 'warn'); else audio('whoosh'); } }));
        body.appendChild(k.root);
      });
      body.appendChild(el('h3', { class: 'section' }, ['DOODADS (LIABILITIES)', q('doodad')]));
      body.appendChild(el('p', { class: 'muted', style: 'font-size:8px;line-height:1.8', text: 'Shiny, status-boosting, and billing you every month forever. Buy them with passive income, never with debt.' }));
      const dcards = [];
      Data.DOODADS.forEach((X) => {
        const owned = S.doodads[X.id];
        const k = card({ name: X.name, icon: X.id, tip: 'doodad:' + X.id, cls: owned ? 'owned-item' : '', sub: `${fm(X.price)} · <span class="bad">upkeep ${fm(X.upkeep)}/mo forever</span> · +${X.status} status` });
        if (owned) k.actions.appendChild(el('button', { class: 'btn small red', text: 'SELL ' + fm(X.price * D.doodadResale), onclick: () => { const r = Engine.sellDoodad(S, X.id); if (r.ok) { audio('coin'); toast('Sold ' + X.name + ' for ' + fm(r.proceeds) + '. Upkeep gone.', 'money'); } } }));
        else {
          const b = el('button', { class: 'btn small', text: 'BUY', onclick: () => { const r = Engine.buyDoodad(S, X.id); if (r.ok) { audio('buy'); say('dan', 'SOLD! Enjoy! The monthly bill knows where you live!'); } else toast(r.reason, 'warn'); } });
          k.actions.appendChild(b);
          dcards.push({ b, X });
        }
        body.appendChild(k.root);
      });
      return () => {
        const d = D;
        refs.health.innerHTML = `<div class="kv"><span>Health</span><span class="${d.critical ? 'bad' : ''}">${Math.round(d.health)}/100 (${d.healthDriftPerYear >= 0 ? '+' : ''}${d.healthDriftPerYear}/yr)</span><span>Age</span><span>${d.age.toFixed(1)}</span><span>Lifespan</span><span>${d.lifespan.toFixed(1)} (base ${C.BASE_LIFESPAN}, max ${C.MAX_AGE})</span><span>Years left</span><span class="${d.yearsLeft < 10 ? 'bad' : 'good'}">${d.yearsLeft.toFixed(1)}</span></div><div class="bar ${d.critical ? 'red' : 'cyan'}" style="margin-top:6px"><i style="width:${Math.max(0, d.health)}%"></i></div>${d.critical ? '<p class="bad" style="font-size:8px">CRITICAL: each month there is a 4% chance of a sudden shutdown. Visit the Medbay.</p>' : ''}`;
        refs.medbay.textContent = 'MEDBAY: HEALTH > 70 (' + fm(d.medbayCost) + ')';
        refs.medbay.disabled = d.health >= C.MEDBAY_HEALTH || S.cash < d.medbayCost;
        hcards.forEach((c) => { c.b.disabled = S.cash < c.H.cost; c.k.root.classList.toggle('affordable', S.cash >= c.H.cost && !c.H.scam); });
        dcards.forEach((c) => { c.b.disabled = S.cash < c.X.price; });
      };
    },
  };

  // ---------------- LEDGER
  TABS.ledger = {
    sig: () => Data.LESSONS.map((L) => (S.lessons[L.id] || '-')[0]).join('') + '|' + D.achievementsUnlocked + '|' + (S.chapter >= 7) + (S.hall || []).length + Math.floor(S.wisdom),
    build(body) {
      const refs = {};
      body.appendChild(el('h3', { class: 'section' }, ['MONTHLY CASH FLOW', q('freedom')]));
      refs.flow = el('div', { class: 'kv' }); body.appendChild(refs.flow);
      body.appendChild(el('h3', { class: 'section' }, ['WHERE YOUR MONEY CAME FROM (LAST 30s)']));
      refs.split = el('div', { class: 'split-bar' }, [el('i', { class: 's-click' }), el('i', { class: 's-biz' }), el('i', { class: 's-div' })]);
      body.appendChild(refs.split);
      body.appendChild(el('div', { class: 'legend', html: '<span><i style="background:var(--red)"></i>CLICKS (your time)</span><span><i style="background:var(--green)"></i>BUSINESSES</span><span><i style="background:var(--cyan)"></i>DIVIDENDS</span>' }));
      body.appendChild(el('h3', { class: 'section' }, ['BALANCE SHEET', q('netWorth')]));
      refs.bs = el('div', { class: 'kv' }); body.appendChild(refs.bs);
      if (S.chapter >= 7) {
        body.appendChild(el('h3', { class: 'section' }, ['THE EXIT TOLL', q('exit')]));
        refs.toll = el('div'); body.appendChild(refs.toll);
        refs.escBtn = el('button', { class: 'btn gold wide', style: 'margin-top:6px', text: 'PAY THE TOLL & ESCAPE', onclick: () => ctx.onEscape() });
        body.appendChild(refs.escBtn);
      }
      body.appendChild(el('h3', { class: 'section', text: "GLITCH'S LEDGER " + Data.LESSONS.filter((L) => S.lessons[L.id] === 'read').length + '/22' }));
      const pages = el('div', { class: 'pages' });
      Data.LESSONS.forEach((L, i) => {
        const st = S.lessons[L.id];
        const b = el('button', { class: 'page-btn' + (st === 'new' ? ' unread' : !st || st === 'queued' ? ' locked' : ''), text: (i + 1) + '. ' + (st === 'read' || st === 'new' ? L.title : st === 'queued' ? '(arriving soon)' : '???') });
        if (st === 'read' || st === 'new') b.onclick = () => showLesson(L.id);
        pages.appendChild(b);
      });
      body.appendChild(pages);
      body.appendChild(el('h3', { class: 'section', text: 'ACHIEVEMENTS ' + D.achievementsUnlocked + '/' + D.achievementsTotal + ' (+1% income each)' }));
      const grid = el('div', { class: 'ach-grid' });
      Data.ACHIEVEMENTS.forEach((A, i) => {
        const got = S.achievements[A.id];
        const badge = Sprites.ICONS.badge;
        const im = el('img', { src: spriteURL(badge, 2, { frame: i % (badge.frames ? badge.frames.length : 1) }), alt: '' });
        grid.appendChild(el('div', { class: 'ach' + (got ? ' got' : ' locked') + (A.grey && got ? ' grey' : ''), 'data-tip': 'ach:' + A.id }, [im]));
      });
      body.appendChild(grid);
      body.appendChild(el('h3', { class: 'section' }, ['WISDOM ' + Math.floor(S.wisdom) + ' (+' + Math.round(S.wisdom * 2) + '% income)', q('wisdom')]));
      Data.WISDOM_PERKS.forEach((P) => body.appendChild(el('div', { class: 'perk' + (S.wisdom >= P.at ? ' got' : '') }, [el('span', { text: P.at + ' · ' + P.name }), el('span', { text: P.desc })])));
      if ((S.hall || []).length) {
        body.appendChild(el('h3', { class: 'section', text: 'HALL OF LIVES' }));
        S.hall.slice().reverse().forEach((h) => body.appendChild(el('div', { class: 'perk' + (h.ending === 'escaped' ? ' got' : '') }, [el('span', { text: 'Life ' + h.attempt + ': ' + (h.ending === 'escaped' ? 'ESCAPED' : h.ending === 'free' ? 'FREE, BUT GONE' : h.ending === 'wageslave' ? 'WAGE SLAVE' : h.ending.toUpperCase()) }), el('span', { text: 'age ' + h.age + ' · peak ' + fm(h.peakNetWorth) + ' · +' + h.wisdom + 'W' })])));
      }
      return () => {
        refs.flow.innerHTML = `<span>Passive income</span><span class="good">+${fm(D.passiveMonthly)}</span><span>Expenses</span><span class="bad">${fm(-D.expensesMonthly)}</span><span class="total">Cash flow (without clicks)</span><span class="total ${D.passiveMonthly >= D.expensesMonthly ? 'good' : 'bad'}">${fm(D.passiveMonthly - D.expensesMonthly)}/mo</span><span>Freedom</span><span>${pct(D.freedomRatio)}${S.flags.ratRaceExit ? ' · OUT OF THE RAT RACE' : ''}</span>`;
        const sp = D.incomeSplit;
        refs.split.children[0].style.width = (sp.clicks * 100) + '%'; refs.split.children[1].style.width = (sp.business * 100) + '%'; refs.split.children[2].style.width = (sp.dividends * 100) + '%';
        refs.bs.innerHTML = `<span>Cash</span><span>${fm(D.cash)}</span><span>Businesses (cost)</span><span>${fm(D.bookValue)}</span><span>Investments</span><span>${fm(D.investValue)}</span><span>Repo-Tron debt</span><span class="bad">${fm(-D.debt)}</span><span>Bot-Bank loan</span><span class="bad">${fm(-D.loan)}</span><span class="total">Net worth</span><span class="total ${D.netWorth >= 0 ? 'good' : 'bad'}">${fm(D.netWorth)}</span>`;
        if (refs.toll) {
          const tp = Math.max(0, Math.min(1, S.cash / D.exitToll));
          refs.toll.innerHTML = `<div class="kv"><span>Toll</span><span>${fm(D.exitToll)}</span><span>Cash</span><span>${fm(S.cash)} (${(tp * 100).toFixed(2)}%)</span><span>At this rate you pay it at</span><span class="${tollAge() > D.lifespan ? 'bad' : 'good'}">${tollAge() < 1e4 ? 'age ' + tollAge().toFixed(1) + ' (lifespan ' + D.lifespan.toFixed(0) + ')' : 'never, at this rate'}</span></div><div class="bar gold" style="margin-top:6px"><i style="width:${(tp * 100).toFixed(2)}%"></i></div>${!D.outOfRatRaceNow ? '<p class="bad" style="font-size:8px">Passive income must cover expenses (and no bad debt) to pay the toll.</p>' : ''}`;
          refs.escBtn.disabled = !D.canEscape;
        }
      };
    },
  };

  // The NEXT line under your name: always the one concrete thing that moves the story forward.
  function goalText(ch) {
    if (S.ending === 'escaped') return 'YOU ESCAPED. KEEP BUILDING OR START NEW GAME+';
    if (S.ending) return 'THE END. REBOOT FOR ANOTHER LIFE.';
    const n = S.chapter, owned = Engine._internal.ownedTotal(S);
    switch (n) {
      case 1: return 'NEXT: Click the sign (' + Math.min(15, S.stats.lifetimeClicks) + '/15)';
      case 2:
        if (!S.job.id && !S.flags.everEmployed) return 'NEXT: Take the job (WORK tab)';
        if (!owned && S.cash < 60) return 'NEXT: Save $60 for a battery stand (' + fm(S.cash) + ')';
        return 'NEXT: Buy your first business (BIZ tab)';
      case 3: return 'NEXT: Reach $5,000 net worth (' + fm(D.netWorth) + ')';
      case 4: return 'NEXT: Reach $50,000 net worth (' + fm(D.netWorth) + ')';
      case 5: return 'NEXT: Buy a Pod Tower (real estate) or reach $1M';
      case 6:
        if (S.debt > 0.005) return 'NEXT: Pay off Repo-Tron (' + fm(S.debt) + '). Bad debt blocks your exit.';
        if (D.freedomRatio < C.RAT_RACE_RATIO) return 'NEXT: Passive income to 125% of expenses (now ' + pct(D.freedomRatio) + ')';
        return 'NEXT: Hold it! Good months ' + S.flags.ratRaceMonths + '/3';
      case 7: return 'NEXT: Save 10% of the Exit Toll (' + (Math.min(1, S.cash / (0.1 * D.exitToll)) * 100).toFixed(0) + '%)';
      default:
        if (!D.outOfRatRaceNow) return S.debt > 0.005 ? 'NEXT: Pay off Repo-Tron to use the gate' : 'NEXT: Passive must cover expenses to use the gate';
        return 'NEXT: Pay the Exit Toll ' + fm(D.exitToll) + ' (' + (Math.min(1, S.cash / D.exitToll) * 100).toFixed(1) + '%)';
    }
  }

  // ------------------------------------------------------------------------------------------
  // tutorial arrow
  // ------------------------------------------------------------------------------------------
  function renderTutorial(now) {
    const box = $('tutorial');
    document.querySelectorAll('.tut-target').forEach((e) => e.classList.remove('tut-target'));
    // Past chapter 3 the player knows the ropes; the envelope and '?' chips carry the rest.
    if (!S.flags.tutorialDoneAll && S.chapter >= 4) S.flags.tutorialDoneAll = true;
    if (ui.tutorialDone || S.flags.tutorialDoneAll || ui.blocking || ui.modal || S.ending) { box.hidden = true; return; }
    let step = null;
    for (const T of Data.TUTORIAL) {
      if (Engine.evalCond(S, T.done)) continue;
      step = T; break;
    }
    if (!step) { S.flags.tutorialDoneAll = true; box.hidden = true; toast('Tutorial done. Glitch\'s pages (the envelope) explain the rest.', 'gold', 'star'); return; }
    if (step.autoDoneS) {
      if (!ui.autoStepAt || ui.autoStepId !== step.id) { ui.autoStepAt = now; ui.autoStepId = step.id; }
      if (now - ui.autoStepAt > step.autoDoneS * 1000) Engine.markSeen(S, step.id);
    }
    const target = document.querySelector(step.target);
    if (!target || target.hidden || target.offsetParent === null) { box.hidden = true; return; }
    const r = target.getBoundingClientRect();
    if (r.width === 0) { box.hidden = true; return; }
    box.hidden = false;
    $('tut-text').textContent = step.id === 'tut_years' ? 'YOU HAVE ' + Math.floor(D.yearsLeft) + " YEARS. THEY'RE TICKING." : step.text;
    // Put the caption in the open city next to the panel the target lives in, so it never hides
    // the debt chip, the NEXT goal or the card you need to read. Phones: above/below, clamped.
    const you = $('col-you').getBoundingClientRect(), mk = $('col-market').getBoundingClientRect();
    const phone = innerWidth <= 760;
    let mode, x, y;
    if (!phone && r.left >= you.left - 2 && r.right <= you.right + 2) { mode = 'right'; x = you.right + 12; y = r.top + r.height / 2; }
    else if (!phone && r.left >= mk.left - 2) { mode = 'left'; x = mk.left - 12; y = r.top + r.height / 2; }
    else if (r.top < 150 || (phone && r.bottom + 60 < innerHeight)) { mode = 'below'; x = r.left + r.width / 2; y = r.bottom + 6; }
    else { mode = 'above'; x = r.left + r.width / 2; y = r.top - 4; }
    box.className = 'm-' + mode;
    $('tut-arrow').textContent = { right: '◀', left: '▶', below: '▲', above: '▼' }[mode];
    const w = box.offsetWidth || 200;
    if (mode === 'below' || mode === 'above') {
      const maxX = phone ? innerWidth - w / 2 - 6 : Math.min(innerWidth - w / 2 - 6, mk.left - w / 2 - 8);
      x = Math.max(w / 2 + 6, Math.min(maxX, x));
    }
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    target.classList.add('tut-target');
  }

  // ------------------------------------------------------------------------------------------
  // news ticker
  // ------------------------------------------------------------------------------------------
  let tickerX = 0, tickerW = 0, tickerNext = 0;
  function renderTicker(dt) {
    const tr = $('ticker');
    if (!tr.children.length || tickerX < -tickerW) {
      tr.innerHTML = '';
      const items = [];
      for (let i = 0; i < 6; i++) items.push(el('span', { text: Data.NEWS[(tickerNext++ * 7 + 3) % Data.NEWS.length] }));
      if (S.chapter >= 5) D.investments.forEach((v) => { if (!v.unlocked) return; const h = v.history; const ch = h.length > 1 ? (h[h.length - 1] - h[h.length - 2]) / h[h.length - 2] : 0; items.splice(Math.floor(Math.random() * items.length), 0, el('span', { class: ch >= 0 ? 'up' : 'down', text: v.ticker + ' ' + fm(v.price) + ' ' + (ch >= 0 ? '▲' : '▼') + (Math.abs(ch) * 100).toFixed(1) + '%' })); });
      items.forEach((x) => tr.appendChild(x));
      tickerW = tr.scrollWidth;
      tickerX = tr.parentElement.clientWidth;
    }
    tickerX -= dt * 0.045;
    tr.style.transform = 'translateX(' + Math.round(tickerX) + 'px)';
  }

  // ------------------------------------------------------------------------------------------
  // engine events > UI
  // ------------------------------------------------------------------------------------------
  function handle(ev) {
    switch (ev.type) {
      case 'toast': toast(ev.text, ev.kind); if (ev.kind === 'warn') audio('error'); break;
      case 'say': say(ev.who, ev.text, ev.ttlMs); break;
      case 'whatif': toast('WHAT IF: ' + ev.text.replace(/^what if: /i, ''), 'whatif', 'question'); audio('tick'); break;
      case 'achievement': {
        const A = Data.byId['achievement:' + ev.id];
        toast('ACHIEVEMENT: ' + A.name + ' · ' + Engine.subst(A.line, { heldValue: fm(S.flags.lastHeldValue || 0) }), 'gold', 'star');
        audio('achievement');
        break;
      }
      case 'lesson': {
        // several pages can land in the same second (the tutorial pages skip the queue): one toast is enough
        const now = performance.now();
        if (now - (ui.lastLessonToast || 0) > 4000) { audio('lesson'); toast('NEW PAGE FROM GLITCH: click the envelope', 'gold', 'envelope'); }
        ui.lastLessonToast = now;
        break;
      }
      case 'chapter': chapterSequence(ev.chapter); break;
      case 'milestone': {
        const B = Data.byId['business:' + ev.businessId];
        toast(`MILESTONE: ${ev.count} ${B.name}! ×${ev.mult} forever (+×2 for 30s)`, 'gold', B.id); audio('milestone'); break;
      }
      case 'purchase': break;
      case 'promotion': ui.avatarReact = { name: 'jump', until: performance.now() + 600 }; break;
      case 'burnout': break;
      case 'glitch': toast('GLITCH IN THE MATRIX! Click the golden bot in the city!', 'gold', 'star'); audio('glitch'); break;
      case 'crash': audio('crash'); audio('thunder'); shake(); break;
      case 'dipWindow': break;
      case 'crashOver': toast('The market crash is over. Prices will recover over ~3 years.', 'info'); break;
      case 'debtPaid': toast('DEBT FREE! Repo-Tron has nothing left to count.', 'gold', 'star'); audio('chaching'); break;
      case 'ratRaceExit': audio('escape'); toast('OUT OF THE RAT RACE: passive income beats expenses. Fast Track businesses unlocked!', 'gold', 'star'); break;
      case 'heal': audio('achievement'); break;
      case 'death': document.body.classList.add('dead'); audio('death'); showDeath(); break;
      case 'escape': audio('escape'); showEscape(ev); break;
      case 'offline': showOffline(ev.summary); break;
      case 'event': break; // shown from derived.pendingEvent
      case 'sfx': audio(ev.name); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------------------------------
  // main render (called every animation frame by main.js)
  // ------------------------------------------------------------------------------------------
  function render(state, derived, now) {
    S = state; D = derived;
    const dt = ui.lastT ? Math.min(100, now - ui.lastT) : 16; ui.lastT = now;
    ui.reduceMotion = !!S.settings.reduceMotion;
    document.body.classList.toggle('reduce-motion', ui.reduceMotion);
    renderTop(now, dt);
    renderYou(now);
    updateDialogue(now);
    if (now - ui.lastPanel > 200) {
      ui.lastPanel = now;
      renderTabsBar();
      renderPanel(false);
      const ch = Data.CHAPTERS[S.chapter - 1];
      $('id-name').textContent = S.name;
      const st = $('id-status'); st.textContent = 'STATUS: ' + ch.statusLabel; st.classList.toggle('redacted', S.chapter >= 7);
      $('id-chapter').textContent = 'CH.' + S.chapter + ' ' + humanize('you', ch.title);
      $('id-goal').textContent = goalText(ch);
      if (ui.tipKey && !$('tooltip').hidden) {
        const t = $('tooltip'); const html = tipFor(ui.tipKey); if (html) t.innerHTML = html;
      }
    }
    renderTutorial(now);
    renderTicker(dt);
    drawFx(dt);
    // a choice event waits for a quiet moment
    if (!ui.modal && !ui.blocking && D.pendingEvent && !(ui.dialogueCur && ui.dialogueCur.blocking)) showEvent(D.pendingEvent);
    if (ui.modal && ui.modal.kind === 'event' && !D.pendingEvent) closeModal();
  }

  // ------------------------------------------------------------------------------------------
  // init + input wiring
  // ------------------------------------------------------------------------------------------
  function init(opts) {
    ctx = opts;
    S = opts.state;
    fx = $('fx'); resizeFx();
    addEventListener('resize', resizeFx);
    buildTabs();
    const meter = $('hustle-meter'); for (let i = 0; i < 12; i++) meter.appendChild(el('i'));
    drawSprite($('tb-heart'), Sprites.ICONS.heart, 1, 0);
    drawSprite($('envelope-icon'), Sprites.ICONS.envelope, 2, 0);
    const m = $('machine');
    m.addEventListener('pointerdown', onMachine);
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); });
    $('envelope').addEventListener('click', () => { const L = Data.LESSONS.find((x) => S.lessons[x.id] === 'new'); if (L) showLesson(L.id); });
    $('dialogue').addEventListener('click', clickDialogue);
    $('id-name').addEventListener('click', renameDialog);
    $('avatar-frame').addEventListener('click', () => { ui.avatarReact = { name: 'jump', until: performance.now() + 500 }; const lines = Data.CHARACTERS.you.lines; say('you', lines[Math.floor(Math.random() * lines.length)], 2500); });
    $('btn-settings').addEventListener('click', showSettings);
    $('btn-help').addEventListener('click', showHelp);
    $('btn-sound').addEventListener('click', () => { S.settings.sound = !S.settings.sound; ctx.onSettings(); });
    // After a mouse click, drop focus from page buttons so Space goes back to hustling (keyboard users keep focus).
    document.addEventListener('click', (e) => {
      if (e.detail > 0 && !ui.modal) { const b = e.target.closest && e.target.closest('button'); if (b && b.id !== 'machine') b.blur(); }
    });
    // Phone quick-nav
    document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
      const where = b.getAttribute('data-jump');
      if (where === 'ledger' && tabUnlocked('ledger')) setTab('ledger');
      const target = where === 'hustle' ? $('col-you') : $('col-market');
      target.scrollIntoView({ behavior: ui.reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }));
    $('btn-escape').addEventListener('click', () => ctx.onEscape());
    $('glitch-btn').addEventListener('click', (e) => { const r = Engine.collectGlitch(S, Date.now()); if (r.kind) burst(e.clientX, e.clientY, 24, true); });
    $('debt-chip').addEventListener('click', (e) => {
      const b = e.target.closest('[data-debt]'); if (!b) return;
      const v = b.getAttribute('data-debt');
      const amt = v === 'all' ? S.debt : v === 'half' ? S.debt / 2 : 100;
      const r = Engine.payDebt(S, amt);
      if (r.ok) { audio('coin'); toast('Paid Repo-Tron ' + fm(r.paid) + '. Less interest forever.', 'money'); } else { audio('error'); toast(S.cash <= 0 ? 'No cash to pay with. Hustle first.' : r.reason, 'warn'); }
    });
    $('boosts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pu]'); if (!b) return;
      const r = Engine.activatePowerup(S, b.getAttribute('data-pu'), Date.now());
      if (!r.ok) { toast(r.reason === 'cannot afford' ? 'Need ' + fm(r.cost) : r.reason, 'warn'); audio('error'); }
    });
    // delegated: tooltips + ? chips
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t) showTooltip(t, e.clientX, e.clientY); else if (!$('tooltip').hidden) hideTooltip();
    });
    document.addEventListener('click', (e) => {
      const qc = e.target.closest && e.target.closest('[data-q]');
      if (qc) { e.stopPropagation(); showBubble(qc, qc.getAttribute('data-q')); return; }
      if (!$('bubble').hidden && !e.target.closest('#bubble')) $('bubble').hidden = true;
      else if (e.target.closest('#bubble')) $('bubble').hidden = true;
    }, true);
    $('modal-root').addEventListener('pointerdown', (e) => { if (e.target === $('modal-root') && ui.modal && ['settings', 'help', 'lesson', 'rename', 'confirm'].includes(ui.modal.kind)) closeModal(); });
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) { if (e.key === 'Enter' && ui.modal && ui.modal.kind === 'rename') { const b = $('modal').querySelector('.btn.gold'); b && b.click(); } return; }
      if (e.key === 'Escape') { if (ui.modal && ['settings', 'help', 'lesson', 'rename', 'confirm'].includes(ui.modal.kind)) closeModal(); $('bubble').hidden = true; return; }
      const act = e.key === ' ' || e.key === 'Enter';
      if (ui.modal) {
        if (e.key === 'Tab') ui.modalKeyNav = true;
        // Only a button the player deliberately tabbed to may be pressed, and not in the first 0.6 s.
        const onCardButton = e.target && e.target.closest && e.target.closest('#modal button');
        if (act && (!onCardButton || !ui.modalKeyNav || performance.now() - ui.modalAt < 600)) e.preventDefault();
        return;
      }
      if (ui.dialogueCur && ui.dialogueCur.blocking && act) { e.preventDefault(); clickDialogue(); return; }
      const t = e.target;
      const free = !t || t === document.body || t === document.documentElement || t.id === 'machine';
      if (act && free) { e.preventDefault(); if (!e.repeat) onMachine(null); return; }
      if (act) return; // a focused button/link keeps its normal keyboard behaviour
      if (e.key >= '1' && e.key <= '6') { setTab(TAB_LIST[+e.key - 1].id); return; }
      if (e.key === 'm' || e.key === 'M') { S.settings.sound = !S.settings.sound; ctx.onSettings(); }
    });
    ui.cashShown = S.cash; ui.nwShown = 0;
    return { render, handle, setState, intro, burst, toast, say, closeModal, isBusy: () => !!ui.modal || ui.blocking };
  }
  function setState(s) {
    S = s; ui.tabSig = ''; ui.blockers = []; ui.blocking = false; ui.dialogueQ = []; ui.dialogueCur = null; $('dialogue').hidden = true;
    ui.cashShown = s.cash; ui.tutorialDone = false; lastMachineKey = ''; lastAvatarKey = '';
    document.body.classList.remove('dead');
    $('boosts').innerHTML = '';
    if (ui.modal) closeModal();
  }
  function intro() { chapterSequence(1); }

  root.UI = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
