/* main.js — boot, the game loop, autosave, offline progress and the glue between Engine, Scene, UI and audio. */
(function () {
  'use strict';
  const SAVE_KEY = 'escape-botlandia-save-v1';
  const Engine = window.Engine, Data = window.Data;
  const A = window.BotAudio || { init() {}, play() {}, music() {}, setMuted() {}, setMusicEnabled() {}, lowpass() {}, setVolume() {} };
  const $ = (id) => document.getElementById(id);

  let state = null, scene = null, ui = null;
  let lastFrame = 0, acc = 0, lastSave = 0, started = false;

  // ---------------------------------------------------------------- persistence
  function storageGet() { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } }
  function storageSet(v) { try { localStorage.setItem(SAVE_KEY, v); return true; } catch (e) { return false; } }
  function save() { if (state && started) { state.lastSeen = Date.now(); storageSet(Engine.save(state)); lastSave = performance.now(); } }
  function exportSave() { try { return btoa(unescape(encodeURIComponent(Engine.save(state)))); } catch (e) { return ''; } }
  function importSave(code) {
    let json = code;
    try { json = decodeURIComponent(escape(atob(code))); } catch (e) { /* maybe raw JSON */ }
    const s = Engine.load(json, Date.now());
    if (!s) return false;
    s.lastSeen = Date.now();
    swapState(s);
    save();
    return true;
  }
  function hardReset() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } location.reload(); }

  // ---------------------------------------------------------------- scene (with a stub if scene.js is missing)
  const STUB = { setState() {}, setSafeArea() {}, event() {}, hitTest() { return null; }, start() {}, stop() {}, resize() {}, setReduceMotion() {} };
  function makeScene() {
    if (window.Scene && window.Scene.create) {
      try { return window.Scene.create($('scene')); } catch (e) { console.error('scene failed to start', e); }
    }
    return STUB;
  }
  function safeArea() {
    const top = $('topbar').getBoundingClientRect();
    if (innerWidth <= 760) {
      return { left: 0, right: 0, top: Math.max(0, top.bottom), bottom: Math.max(0, innerHeight - (top.bottom + 190)) };
    }
    const you = $('col-you').getBoundingClientRect(), mk = $('col-market').getBoundingClientRect();
    return { left: Math.round(you.right), right: Math.round(innerWidth - mk.left), top: Math.round(top.bottom), bottom: 0 };
  }
  function applySettings() {
    const s = state.settings;
    A.setMuted(!s.sound);
    A.setMusicEnabled(!!s.music && !!s.sound);
    if (A.setVolume) A.setVolume(s.volume == null ? 0.7 : s.volume);
    scene.setReduceMotion(!!s.reduceMotion);
    const b = $('btn-sound'); b.classList.toggle('off', !s.sound);
  }

  // ---------------------------------------------------------------- engine events → scene / audio
  function route(ev) {
    ui.handle(ev);
    switch (ev.type) {
      case 'purchase':
        if (ev.businessId && ev.count > 0) scene.event('purchase', { businessId: ev.businessId, count: ev.count });
        if (ev.doodad) scene.event('doodad', { id: ev.doodad });
        break;
      case 'milestone': scene.event('milestone', { businessId: ev.businessId, count: ev.count }); scene.event('parade', {}); break;
      case 'glitch': scene.event('glitch', {}); break;
      case 'glitchGone': scene.event('glitchGone', {}); break;
      case 'crash': scene.event('crash', {}); break;
      case 'crashOver': scene.event('crashOver', {}); break;
      case 'chapter': scene.event('chapter', { chapter: ev.chapter }); break;
      case 'ratRaceExit': scene.event('ratRaceExit', {}); scene.event('parade', {}); break;
      case 'death': scene.event('death', {}); A.lowpass(true); A.music('none'); break;
      case 'escape': scene.event('escape', {}); break;
      case 'burnout': scene.event('burnout', {}); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- loop
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = lastFrame ? t - lastFrame : 16;
    lastFrame = t;
    if (started) {
      if (dt > 5000) {
        // The tab slept (rAF pauses in background tabs): count it as time away.
        Engine.applyOffline(state, Date.now());
        acc = 0;
      } else if (!ui.isBusy()) {
        // Reading is free: the clock stops while a story scene or a card is open.
        acc += dt;
        let n = 0;
        while (acc >= 100 && n++ < 20) { Engine.tick(state, 100, Date.now()); acc -= 100; }
        if (acc > 1000) acc = 0;
      } else {
        acc = 0;
        state.lastSeen = Date.now();
      }
      const q = state.queue;
      if (q.length) { state.queue = []; for (let i = 0; i < q.length; i++) route(q[i]); }
    }
    const d = Engine.derive(state);
    scene.setState(state, d);
    ui.render(state, d, t);
    if (started) {
      const want = !state.settings.music ? 'none' : state.ending === 'escaped' ? 'sunrise' : state.ending ? 'none' : d.yearsLeft < 5 ? 'lowtime' : 'city';
      A.music(want);
      if (performance.now() - lastSave > 10000) save();
    }
  }

  // ---------------------------------------------------------------- state changes
  function swapState(s) {
    state = s;
    ui.setState(s);
    applySettings();
    A.lowpass(false);
  }
  function rebirth() {
    const next = Engine.rebirth(state, Date.now());
    swapState(next);
    save();
    ui.intro();
  }
  function escape() {
    const r = Engine.escape(state, Date.now());
    if (!r.ok) ui.toast(r.reason, 'warn');
    else save();
  }
  function gesture() { A.init(); }

  // ---------------------------------------------------------------- boot
  function boot() {
    const saved = storageGet();
    let loaded = saved ? Engine.load(saved, Date.now()) : null;
    state = loaded || Engine.newState(Date.now(), {});
    scene = makeScene();
    ui = window.UI.init({
      state, scene,
      onRebirth: rebirth, onEscape: escape, onSettings: applySettings, onUserGesture: gesture,
      exportSave, importSave, hardReset,
    });
    applySettings();
    scene.start();
    const updateSafe = () => { scene.resize(); scene.setSafeArea(safeArea()); };
    addEventListener('resize', updateSafe);
    // the golden bot lives in the city canvas
    $('scene').addEventListener('pointerdown', (e) => {
      gesture();
      if (!started) return;
      if (scene.hitTest(e.clientX, e.clientY) === 'goldenbot') {
        const r = Engine.collectGlitch(state, Date.now());
        if (r.kind) { ui.burst(e.clientX, e.clientY, 30, true); scene.event('glitchGone', { caught: true }); }
      }
    });
    addEventListener('pointerdown', gesture, { capture: true });
    addEventListener('keydown', gesture, { capture: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    addEventListener('pagehide', save);
    addEventListener('beforeunload', save);

    if (loaded) {
      $('app').hidden = false;
      started = true;
      if (state.ending === 'wageslave' || state.ending === 'free') { state.queue.push({ type: 'death', ending: state.ending }); }
      else Engine.applyOffline(state, Date.now());
    } else {
      $('title-screen').hidden = false;
      const start = () => {
        const name = ($('title-name').value || '').trim().slice(0, 12) || '4471';
        state = Engine.newState(Date.now(), { name });
        swapState(state);
        $('title-screen').hidden = true;
        $('app').hidden = false;
        started = true;
        A.init();
        A.play('chapter');
        save();
        ui.intro();
        requestAnimationFrame(updateSafe);
      };
      $('btn-start').addEventListener('click', start);
      $('title-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
      setTimeout(() => $('title-name').focus(), 100);
    }
    requestAnimationFrame(() => { updateSafe(); requestAnimationFrame(frame); });
    // debug handle for playtesting from the console
    window.BOTLANDIA = { get state() { return state; }, Engine, save, tick: (s) => { for (let i = 0; i < s * 10; i++) Engine.tick(state, 100, Date.now()); } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
