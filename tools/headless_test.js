'use strict';
// Headless integration harness: mock DOM + WebGL2 so the REAL game code runs
// end-to-end in Node. Dev tool only - not part of the shipped game.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const results = []; let failures = 0;
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || '' });
  if (!cond) failures++;
}

// real on-disk texture dimensions (measured by tools/generate_textures.py + PIL)
const texReport = JSON.parse(fs.readFileSync(path.join(__dirname, 'texture_report.json'), 'utf8'));
global.__texDims = {};
texReport.forEach(r => { const d = r.dim.split('x').map(Number); global.__texDims[r.path] = [d[0], d[1]]; });
// sprite sheet dimensions (what the 2D build actually loads)
const spriteSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'sprite-data.js'), 'utf8');
const SHEETS = JSON.parse(spriteSrc.match(/EH\.SpriteSheets=(\{.*?\});/s)[1]);
Object.keys(SHEETS).forEach(k => { global.__texDims[SHEETS[k].path] = [SHEETS[k].w, SHEETS[k].h]; });

// ---------------- DOM mock ----------------
function mkClassList(el) {
  const s = new Set();
  return {
    add: (...c) => c.forEach(x => s.add(x)),
    remove: (...c) => c.forEach(x => s.delete(x)),
    toggle: (c, f) => { if (f === undefined) f = !s.has(c); f ? s.add(c) : s.delete(c); return f; },
    contains: c => s.has(c), _set: s
  };
}
function mkStyle() {
  return new Proxy({ cssText: '', setProperty() {}, removeProperty() {} }, {
    get: (t, p) => (p in t ? t[p] : ''), set: (t, p, v) => { t[p] = v; return true; }
  });
}
let elemCount = 0;
function mkEl(tag) {
  elemCount++;
  const el = {
    tagName: (tag || 'div').toUpperCase(), children: [], _handlers: {},
    style: mkStyle(), dataset: {}, value: '', readOnly: false,
    _text: '', _html: '',
    get childElementCount() { return this.children.length; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(t, f) { (this._handlers[t] = this._handlers[t] || []).push(f); },
    removeEventListener() {},
    dispatch(t, ev) { (this._handlers[t] || []).forEach(f => f(Object.assign({ preventDefault() {}, stopPropagation() {}, pointerId: 1, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 }, ev))); },
    setAttribute(k, v) { if (k === 'style') this.style.cssText = v; },
    getAttribute() { return null; },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, click() { this.dispatch('click', {}); }
  };
  el.classList = mkClassList(el);
  if ((tag || '').toLowerCase() === 'canvas') {
    el.width = 64; el.height = 64;
    el.getContext = type => (type === 'webgl2' ? mkGL() : null);
  }
  return el;
}
const elements = {};
['gl','hud','overlay','toast','hint','combo','portrait','bossBar','hpFill','hpText','ultFill','cores',
 'roomInfo','shards','bossFill','bossName','bossPhase','joyBase','joyKnob','btnAttack','btnDash',
 'btnSkill','btnUlt','btnPause'].forEach(id => { elements[id] = mkEl('div'); });

// action buttons need a .cd-ring child
['btnDash','btnSkill'].forEach(id => {
  const ring = mkEl('circle'); ring.classList.add('cd-ring');
  elements[id].querySelector = sel => sel === '.cd-ring' ? ring : null;
});

// ---------------- WebGL2 mock ----------------
let drawCalls = 0, shaderCount = 0, programCount = 0, texCount = 0, bufCount = 0, fboCount = 0;
function mkGL() {
  const real = {
    createShader: () => (shaderCount++, { id: shaderCount }),
    shaderSource: () => {}, compileShader: () => {},
    getShaderParameter: () => true, getShaderInfoLog: () => '',
    deleteShader: () => {},
    createProgram: () => (programCount++, { id: programCount }),
    attachShader: () => {}, bindAttribLocation: () => {}, linkProgram: () => {},
    getProgramParameter: () => true, getProgramInfoLog: () => '',
    useProgram: () => {}, getUniformLocation: (p, n) => ({ n }),
    getExtension: () => null, getParameter: () => 8,
    createTexture: () => (texCount++, { id: texCount }),
    createBuffer: () => (bufCount++, { id: bufCount }),
    createVertexArray: () => ({ vao: true }),
    drawElements: () => { drawCalls++; }, drawArrays: () => { drawCalls++; },
    // One instanced call is one draw call no matter how many copies it renders -
    // that is the entire point of counting them here.
    drawElementsInstanced: () => { drawCalls++; },
    drawArraysInstanced: () => { drawCalls++; },
    vertexAttribDivisor: () => {},
    texImage2D: () => {}, generateMipmap: () => {},
    bufferData: () => {}, bufferSubData: () => {},
    // framebuffer objects: needed so the bloom chain is actually exercised
    // rather than silently taking its no-bloom fallback
    createFramebuffer: () => ({ fbo: ++fboCount }),
    createRenderbuffer: () => ({ rb: true }),
    checkFramebufferStatus: () => 0x1000 + 'FRAMEBUFFER_COMPLETE'.length,
    deleteFramebuffer: () => {}, deleteRenderbuffer: () => {}, deleteTexture: () => {}
  };
  return new Proxy(real, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'string' && /^[A-Z][A-Z0-9_]*$/.test(p)) return 0x1000 + p.length;
      return () => {};
    }
  });
}
elements.gl.getContext = type => (type === 'webgl2' ? mkGL() : null);
elements.gl.width = 1280; elements.gl.height = 720;

// ---------------- window/document ----------------
const store = {};
global.window = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() {}, removeEventListener() {},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  requestAnimationFrame: () => 0,
  location: { reload() {} },
  AudioContext: undefined, webkitAudioContext: undefined   // audio unsupported path
};
global.document = {
  readyState: 'complete',
  getElementById: id => elements[id] || (elements[id] = mkEl('div')),
  createElement: mkEl, addEventListener() {},
  querySelector: sel => (sel === '.action-pad' ? mkEl('div') : null),
  querySelectorAll: () => [],
  body: mkEl('body'), hidden: false
};
Object.defineProperty(global, 'navigator', { value: { vibrate: () => true, userAgent: 'node' }, configurable: true, writable: true });
Object.defineProperty(global, 'performance', { value: { now: () => Date.now() }, configurable: true, writable: true });
global.requestAnimationFrame = () => 0;
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.atob = s => Buffer.from(s, 'base64').toString('binary');
global.Image = class {
  constructor() { this.naturalWidth = 0; this.naturalHeight = 0; this.decoding = ''; }
  set src(v) {
    this._src = v;
    const d = (global.__texDims || {})[v];
    const isData = typeof v === 'string' && v.indexOf('data:') === 0;
    this.naturalWidth = d ? d[0] : (isData ? 256 : 512);
    this.naturalHeight = d ? d[1] : (isData ? 256 : 512);
    setTimeout(() => this.onload && this.onload(), 0);
  }
  get src() { return this._src; }
};
global.Uint8Array = Uint8Array; global.Float32Array = Float32Array;

// ---------------- load game scripts in index.html order ----------------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
for (const s of srcs) {
  const p = path.join(ROOT, s);
  if (!fs.existsSync(p)) { check('script exists: ' + s, false); continue; }
  const code = fs.readFileSync(p, 'utf8');
  try { new Function(code).call(global); }
  catch (e) { check('script executes: ' + s, false, e.message); }
}
const EH = global.window.EchoHeart;
check('EchoHeart namespace built', !!EH);
check('all ' + srcs.length + ' scripts executed without throwing', failures === 0);

// ---------------- drive the game ----------------
const G = EH.Game;
// The engine seeds every run from Date.now(), so room composition - and with it
// which enemy kind lands in enemies[0] - changed on each run. That was the last
// source of intermittent failures. Pin it.
EH.randomSeed = function () { return 20240101; };
function step(frames, dt) {
  dt = dt || 16.7;
  for (let i = 0; i < frames; i++) { G.last = G.last - dt; G.loop(G.last + dt); }
}
function killAll() {
  G.world.enemies.forEach(e => { if (e.alive && !e.dying) { e.hp = 0; e.die(); } });
}
function drainSpawns(max) {                       // step until the spawn queue empties
  let i = 0; max = max || 300;
  while (G.spawnQueue && G.spawnQueue.length && i++ < max) step(1);
  step(4);
}
async function clearRoom() {          // fully resolve a combat room (rooms can have 2-3 waves)
  for (let i = 0; i < 14 && G.roomState === 'active'; i++) {
    drainSpawns();
    killAll();
    step(40);                          // lets checkRoomClear queue the next wave
  }
  // reward/finish delays are frame-driven now, so advance frames instead of
  // sleeping on the wall clock (that raced under CPU load and flaked)
  step(90);
}

(async () => {
  // Wait for the loader to actually finish instead of guessing a duration.
  // ~100 mock images each resolve on their own setTimeout(0); a fixed 60ms
  // sleep drained them only when the machine was idle, which is what made this
  // suite fail intermittently under CPU load.
  await (async () => {
    for (let i = 0; i < 2000; i++) {
      if (G.started) return;
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error('assets did not finish loading (started=' + G.started +
      ', done=' + (G.loader && G.loader.done) + '/' + (G.loader && G.loader.total) + ')');
  })();

  check('renderer initialised (WebGL2)', !!G.renderer && !!G.renderer.gl);
  {
    // count-agnostic: every program the renderer built must have linked
    const names = Object.keys(G.renderer.progs);
    const bad = names.filter(n => !G.renderer.progs[n].ok);
    check('all shader programs linked', bad.length === 0 && names.length >= 3,
      names.length + ' progs: ' + names.join(',') + (bad.length ? ' BAD=' + bad.join(',') : ''));
  }
  check('all meshes uploaded to GPU', Object.keys(G.renderer.meshGPU).length === Object.keys(EH.Meshes).length,
    Object.keys(G.renderer.meshGPU).length + '/' + Object.keys(EH.Meshes).length);
  check('every material got a real texture (not the white fallback)', (() => {
    const bad = [];
    for (const id in EH.MATERIALS) {
      const set = G.renderer.matTex[id];
      if (!set || set.albedo === G.renderer.fallback.albedo) bad.push(id);
    }
    return bad.length === 0;
  })(), Object.keys(G.renderer.matTex).length + ' materials');
  check('embedded texture pack present for file://',
    !!EH.TextureData && Object.keys(EH.TextureData).length >= 60,
    Object.keys(EH.TextureData || {}).length + ' embedded');
  check('game started (title)', G.started === true);

  // ---- hub ----
  EH.Scenes.goHub();
  step(30);
  check('hub is a 3D scene with devices', G.mode === 'hub' && G.hubTargets.length === 7);
  check('hub renders draw calls', drawCalls > 0, drawCalls + ' calls');
  const hubDraw = drawCalls;

  // player walks in hub
  EH.Input.keys['w'] = true; step(20); EH.Input.keys['w'] = false;
  check('player moves in hub', Math.abs(G.world.player.z - 2.5) > 0.2);

  // ---- start a run ----
  G.startRun();
  step(5);
  check('run started, room 1 is combat', G.mode === 'run' && G.run.roomIndex === 0 && G.run.roomType === 'combat');
  check('first room always combat', G.run.path[0] === 'combat');
  drainSpawns();
  check('enemies spawned in room 1', G.world.enemies.length > 0, G.world.enemies.length + ' enemies');
  check('enemies are real 3D meshes', G.world.enemies.every(e => EH.Meshes[e.mesh] && EH.Meshes[e.mesh].parts.length > 0));

  // ---- combat: attack + dash + skill ----
  const p = G.world.player;
  const e0 = G.world.enemies[0];
  const hp0 = e0.hp;
  // Hold the target in place. enemies[0] can be a gunner/sentinel, which
  // actively backs away - a stationary player then legitimately never lands a
  // hit, which is enemy AI working, not the melee failing. This test is about
  // the melee.
  e0.def = Object.assign({}, e0.def, { speed: 0 });
  const eAx = e0.x, eAz = e0.z;
  p.x = e0.x - 1.0; p.z = e0.z; p.facing = Math.atan2(e0.x - p.x, e0.z - p.z);
  EH.Input.attackHeld = true;
  EH.Input.keys['j'] = true;
  for (let i = 0; i < 40; i++) { e0.x = eAx; e0.z = eAz; e0.knockX = 0; e0.knockZ = 0; step(1); }
  EH.Input.attackHeld = false; EH.Input.keys['j']=false;
  check('melee attack damages an enemy', e0.hp < hp0, `hp ${hp0.toFixed(0)} -> ${e0.hp.toFixed(0)}`);
  check('hit feedback: particles spawned', G.world.particles.count() > 0);
  check('ult charges from hitting', p.ult > 0);

  const dcd = p.dashCd; EH.Input._edge.dash = true; step(3);
  check('dash triggers and sets cooldown', p.dashCd > 0 && p.state === 'dash');
  step(30);
  EH.Input._edge.skill = true; step(5);
  check('skill triggers and sets cooldown', p.skillCd > 0);

  // ranged weapon check
  EH.UI.close();
  G.world.spawnEnemy('gunner', p.x + 5, p.z + 5, null);
  p.weapon = 'pulsebow'; p.atkPhase = ''; p.comboIdx = 0;
  // Count arrows CREATED, not still alive: with auto-aim the bolts now hit the
  // target and despawn inside the sample window, so "alive > 0" was flaky.
  let bowShots = 0;
  const _fire = G.world.fire.bind(G.world);
  G.world.fire = function (o) { if (o && o.fromPlayer) bowShots++; return _fire(o); };
  EH.Input.keys['j'] = true; step(30); EH.Input.keys['j'] = false;
  G.world.fire = _fire;
  check('bow fires 3D projectiles', bowShots > 0, 'shots=' + bowShots);
  p.weapon = 'riftsword';

  // ---- clear room -> reward ----
  await clearRoom();
  check('room cleared -> echo reward screen', EH.UI.current === 'reward', 'screen=' + EH.UI.current);
  const offers = G.run._offers || [];
  check('reward offers 3 distinct echoes', offers.length === 3 && new Set(offers.map(o => o.id)).size === 3);

  // pick first echo
  const beforeDmg = G.stats.damageMul, pick = offers[0];
  G.run.echoes[pick.id] = (G.run.echoes[pick.id] || 0) + 1;
  G.refreshStats();
  EH.Scenes.afterReward();
  check('echo applied to live stats', JSON.stringify(G.stats) !== '{}' && G.run.echoes[pick.id] === 1);
  check('next-room choice screen shown', EH.UI.current === 'nextRoom');

  // ---- walk the whole path to the boss ----
  let guard = 0;
  while (G.run && G.run.roomIndex < EH.Rooms.TOTAL && guard++ < 20) {
    const nxt = (G.run.roomIndex + 1 >= EH.Rooms.TOTAL) ? 'boss' : 'combat';
    G.enterRoom(nxt);
    step(5);
    if (nxt === 'boss') break;
    await clearRoom();
    if (EH.UI.current === 'reward') {
      const o = (G.run._offers || [])[0];
      if (o) { G.run.echoes[o.id] = (G.run.echoes[o.id] || 0) + 1; G.refreshStats(); }
      EH.Scenes.afterReward();
    }
  }
  check('reached the boss room', G.run && G.run.roomType === 'boss', 'roomIndex=' + (G.run && G.run.roomIndex));
  check('boss spawned as a 3D mesh', !!G.world.boss && EH.Meshes[G.world.boss.mesh].parts.length > 10);

  // ---- boss: 3 phases ----
  const boss = G.world.boss;
  step(200);                                    // intro + idle
  check('boss intro completed', boss.introDone === true);
  const phasesSeen = new Set([boss.phase]);
  boss.hp = boss.maxHp * 0.5; step(140); phasesSeen.add(boss.phase);
  boss.hp = boss.maxHp * 0.2; step(140); phasesSeen.add(boss.phase);
  check('boss transitions through 3 phases', phasesSeen.has(0) && phasesSeen.has(1) && phasesSeen.has(2),
    'phases=' + [...phasesSeen].join(','));
  // drive the boss until it actually raises a warning (pool allocation was a weak proxy)
  let sawTelegraph = false, tKind = '';
  for (let i = 0; i < 900 && !sawTelegraph; i++) {
    step(1);
    G.world.telegraphs.each(t => { if (t.alive) { sawTelegraph = true; tKind = t.kind; } });
  }
  check('boss attacks are telegraphed', sawTelegraph, tKind);
  check('telegraphs stay under the readability cap', (() => {
    // flood: many enemies trying to telegraph at once must not spam the screen
    for (let i = 0; i < 30; i++) G.world.telegraph('circle', i, 0, 2, 0, 1.0, [1, 0, 0]);
    let n = 0; G.world.telegraphs.each(() => n++);
    return n <= G.world.MAX_TELEGRAPHS + 1;
  })(), 'cap=' + G.world.MAX_TELEGRAPHS);

  // ---- life core: revive then death ----
  const pl = G.world.player;
  pl.stats.maxLifeCores = 2; pl.maxCores = 2; pl.cores = 1;
  pl.iframes = 0; pl.hp = 5;
  G.world.damagePlayer(999, 'melee', pl.x + 1, pl.z);
  check('life core consumed on lethal hit', pl.cores === 0 && !pl.dead);
  check('revive restores 50% max HP', Math.abs(pl.hp - pl.maxHp * 0.5) < 1.5, 'hp=' + pl.hp.toFixed(1));
  check('revive grants i-frames', pl.iframes > 1.0);
  // i-frames block damage
  const hpAfterRevive = pl.hp;
  G.world.damagePlayer(50, 'melee', pl.x + 1, pl.z);
  check('i-frames block damage', pl.hp === hpAfterRevive);

  // ---- boss victory ----
  boss.hp = 1;
  G.world.damageEnemy(boss, 999, { crit: false });
  check('boss death fires exactly once', boss.defeated === true && boss.dying === true);
  const beforeCrystals = EH.Save.data.crystals, beforeWins = EH.Save.data.wins;
  boss.die();                                   // duplicate call must be ignored
  step(200);                                    // 2.6s victory delay, frame-driven
  check('victory screen shown', EH.UI.current === 'victory', 'screen=' + EH.UI.current);
  check('win recorded once', EH.Save.data.wins === beforeWins + 1);
  check('crystals awarded on victory', EH.Save.data.crystals > beforeCrystals);
  check('abyss unlocked after first win', EH.Save.data.unlocks.abyss === true);
  check('abyss tier raised', EH.Save.data.bestAbyss >= 1);

  // ---- death path + adaptation ----
  EH.Scenes.goHub(); step(5);
  G.startRun(); step(5);
  drainSpawns();
  const pl2 = G.world.player;
  const adaptBefore = EH.Save.data.adapt.projectile;
  const deaths0 = EH.Save.data.deaths, crys0 = EH.Save.data.crystals;
  pl2.cores = 0; pl2.iframes = 0;
  G.world.damagePlayer(9999, 'projectile', pl2.x + 1, pl2.z);
  check('player death triggers once', pl2.dead === true);
  G.world.killPlayer('projectile');             // duplicate must be ignored
  step(150);                                    // 1.9s death delay, frame-driven
  check('game over screen shown', EH.UI.current === 'gameOver', 'screen=' + EH.UI.current);
  check('death counted once', EH.Save.data.deaths === deaths0 + 1);
  check('projectile adaptation gained', EH.Save.data.adapt.projectile === adaptBefore + 1);
  check('crystals granted even on death', EH.Save.data.crystals > crys0);

  // ---- permanent growth affects next run ----
  EH.Save.data.crystals = 9999;
  const hpBefore = EH.Prog.computeStats(EH.Save.data, {}).maxHp;
  EH.Prog.buyMeta(EH.Save.data, 'm_hp');
  const hpAfter = EH.Prog.computeStats(EH.Save.data, {}).maxHp;
  check('meta upgrade raises max HP', hpAfter > hpBefore, hpBefore + ' -> ' + hpAfter);
  EH.Scenes.goHub(); G.startRun(); step(5);
  check('next run uses upgraded stats', Math.abs(G.world.player.maxHp - hpAfter) < 0.01,
    G.world.player.maxHp + ' vs ' + hpAfter);
  const mitig = EH.Prog.mitigate(EH.Save.data, 100, 'projectile');
  check('adaptation reduces projectile damage next run', mitig < 100, '100 -> ' + mitig.toFixed(1));

  // ---- save round trip ----
  const code = EH.Save.exportString();
  const crystalsNow = EH.Save.data.crystals;
  EH.Save.data.crystals = 0;
  const imp = EH.Save.importString(code);
  check('save export/import round trip', imp.ok && EH.Save.data.crystals === crystalsNow);
  check('corrupt save handled gracefully', EH.Save.importString('###bad###').ok === false);

  // ---- pause / resume ----
  G.startRun(); step(5);
  EH.Scenes.goPause();
  check('pause screen opens', EH.UI.current === 'pause' && G.paused === true);
  const px = G.world.player.x;
  step(40);
  check('simulation frozen while paused', Math.abs(G.world.player.x - px) < 0.001);
  G.paused = false; EH.UI.close(); step(10);

  // ---- rendering sanity ----
  check('frames rendered without error', drawCalls > hubDraw + 500, drawCalls + ' draw calls');
  check('no NaN in camera matrices', !EH.M.Mat4.hasNaN(G.cam.view) && !EH.M.Mat4.hasNaN(G.cam.proj));
  check('player rig stands on the floor (not collapsed)', (() => {
    const p = G.world.player, an = p.anim;
    let minY = 1e9, maxY = -1e9;
    for (let i = 0; i < an.parts.length; i++) {
      const m = an.mats[i], P = an.parts[i].pos;
      for (let v = 0; v < P.length; v += 3) {
        const y = m[1]*P[v] + m[5]*P[v+1] + m[9]*P[v+2] + m[13];
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return (maxY - minY) > 1.4;
  })());

  // ---- frame-driven delays (were setTimeout: ran while paused, raced tests) ----
  {
    const g = G;
    g.startRun(); step(4); EH.UI.modal = false;
    let fired = false;
    g.after(0.5, () => { fired = true; });
    g.paused = true; step(90);
    const during = fired;
    g.paused = false; step(45);
    check('지연 타이머: 일시정지 중 발동 안 함', during === false);
    check('지연 타이머: 재개 후 발동', fired === true);

    g.startRun(); step(3);
    let stale = false;
    g.after(0.3, () => { stale = true; });
    g.startRun(); step(50);
    check('지연 타이머: 새 런 시작 시 이전 타이머 폐기', stale === false);

    let later = false, threw = false;
    const _warn = EH.err; EH.err = function () {};   // the throw below is intentional
    g.after(0.05, () => { throw new Error('intentional'); });
    g.after(0.10, () => { later = true; });
    try { step(25); } catch (e) { threw = true; }
    EH.err = _warn;
    check('지연 타이머: 콜백 예외가 루프를 죽이지 않음', !threw && later === true);
  }

  // ---- circular arena containment ----
  // The wall ring is circular but the bound used to be a square clamp, so a
  // diagonal dash reached half*sqrt(2) and visibly left the arena.
  {
    const IN = EH.Input; IN.keys = IN.keys || {};
    const HALF = EH.CONFIG.floorHalf;
    G.startRun(); step(5);
    const W = G.world, p = W.player;
    const limit = HALF - p.radius + 0.02;
    let maxR = 0, violations = 0;
    const dirs = [['w'], ['s'], ['a'], ['d'], ['w', 'd'], ['w', 'a'], ['s', 'd'], ['s', 'a']];
    for (const combo of dirs) {
      for (let rep = 0; rep < 4; rep++) {
        Object.keys(IN.keys).forEach(k => { IN.keys[k] = false; });
        combo.forEach(k => { IN.keys[k] = true; });
        IN._edge.dash = true;
        for (let i = 0; i < 35; i++) {
          step(1);
          const r = Math.hypot(p.x, p.z);
          if (r > maxR) maxR = r;
          if (r > limit) violations++;
        }
      }
    }
    Object.keys(IN.keys).forEach(k => { IN.keys[k] = false; });
    check('아레나 경계: 대각선 대시로도 원형 벽을 벗어나지 않음',
      violations === 0, 'maxR=' + maxR.toFixed(2) + ' limit=' + limit.toFixed(2));

    p.x = HALF - 1; p.z = 0;
    for (let i = 0; i < 30; i++) { p.knockX = 200; p.knockZ = 150; step(1); }
    check('아레나 경계: 극단적 넉백에도 갇힘', Math.hypot(p.x, p.z) <= limit,
      'r=' + Math.hypot(p.x, p.z).toFixed(2));

    W.enemies.length = 0;
    for (let i = 0; i < 8; i++) W.spawnEnemy(EH.ENEMY_ORDER[i % 6], Math.cos(i) * 30, Math.sin(i) * 30, null, true);
    step(20);
    let eMax = 0;
    W.enemies.forEach(e => { eMax = Math.max(eMax, Math.hypot(e.x, e.z)); });
    check('아레나 경계: 적도 원형 안으로 수렴', eMax <= HALF + 0.05, 'eMax=' + eMax.toFixed(2));
  }

  // ---- draw-call budget ----
  // Particles used to be one draw call each, so an ultimate at full enemy count
  // spiked to ~400 calls in the exact moment the game was busiest.
  {
    const IN = EH.Input; IN.keys = IN.keys || {};
    G.startRun(); step(6);
    const W = G.world;
    for (let i = 0; i < 14; i++) {
      W.spawnEnemy(EH.ENEMY_ORDER[i % 6], Math.cos(i) * 4, Math.sin(i) * 4, i % 3 === 0 ? 'accel' : null, true);
    }
    let peakCalls = 0, peakParts = 0;
    IN.keys.j = true;
    for (let f = 0; f < 260; f++) {
      if (f === 90) { W.player.ult = W.player.stats.ultMax; IN._edge.ult = true; }
      if (f % 70 === 0) IN._edge.skill = true;
      step(1);
      peakParts = Math.max(peakParts, W.particles.count());
      G.renderer.drawCalls = 0;
      G.render(0.016);
      peakCalls = Math.max(peakCalls, G.renderer.drawCalls);
    }
    IN.keys.j = false;
    check('드로우콜 예산: 최악 상황에서도 150 이하',
      peakCalls <= 150, 'peak=' + peakCalls + ' particles=' + peakParts);
    check('파티클은 단일 배치로 렌더', !!(G.renderer.progs.part && G.renderer.progs.part.ok));
    // An exhausted pool does not throw - it just stops handing out particles, so
    // hit sparks and death bursts quietly vanish in exactly the busiest fights.
    // Peak was previously only printed, never asserted.
    var cap = W.particles.capacity ? W.particles.capacity() : 480;
    check('파티클 풀 여유: 최악 상황에서도 85% 이하 사용',
      peakParts <= cap * 0.85, peakParts + '/' + cap);
  }

  // ---- fragment cost budget ----
  // A hi-dpi display was rendering 8-15 megapixels per frame through the full
  // PBR shader. Total pixels are capped so the cost does not scale with the
  // user's monitor.
  {
    const Rr = G.renderer;
    const cases = [[390, 844, 3], [1280, 720, 1], [1920, 1080, 2], [2560, 1440, 2]];
    let worstMP = 0;
    for (const [w, hh, d] of cases) {
      global.window.devicePixelRatio = d;
      global.window.innerWidth = w; global.window.innerHeight = hh;
      Rr.resScale = 1; Rr.lowSpec = false;
      Rr.resize(w, hh, 2);
      worstMP = Math.max(worstMP, Rr.width * Rr.height / 1e6);
    }
    check('픽셀 예산: 어떤 화면에서도 2.4MP 이하', worstMP <= 2.4,
      'worst=' + worstMP.toFixed(2) + 'MP');
    global.window.devicePixelRatio = 2;
    global.window.innerWidth = 1280; global.window.innerHeight = 720;
    Rr.resize(1280, 720, 2);
  }
  check('MSAA 비활성 (전체화면 대역폭 절감)', (function () {
    // the mock context may not implement getContextAttributes; assert on the
    // source of truth instead
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'scripts', 'renderer.js'), 'utf8');
    return /antialias:\s*false/.test(src);
  })());

  // ---- shadows + bloom ----
  {
    const Rr = G.renderer;
    G.startRun(); step(6);
    for (let i = 0; i < 8; i++) {
      G.world.spawnEnemy(EH.ENEMY_ORDER[i % 6], Math.cos(i) * 4, Math.sin(i) * 4, null, true);
    }
    let blobs = 0;
    const og = Rr.addGroundQuad.bind(Rr);
    Rr.addGroundQuad = function () { blobs++; return og.apply(Rr, arguments); };
    G.render(0.016);
    Rr.addGroundQuad = og;
    check('접지 그림자: 액터/구조물마다 생성', blobs >= 9, 'blobs=' + blobs);

    EH.Settings.set('bloom', true); G.applyBloom();
    Rr.drawCalls = 0; G.render(0.016); const withB = Rr.drawCalls;
    EH.Settings.set('bloom', false); G.applyBloom();
    Rr.drawCalls = 0; G.render(0.016); const noB = Rr.drawCalls;
    EH.Settings.set('bloom', true); G.applyBloom();
    check('블룸: 켜면 후처리 4패스 추가 (bright+blur2+composite)',
      withB - noB === 4, 'on=' + withB + ' off=' + noB);
    check('블룸: 1/4 해상도로 처리',
      !!(Rr.bloom && Rr.bloom.qw === (Rr.width >> 2)),
      Rr.bloom ? Rr.bloom.qw + 'x' + Rr.bloom.qh : 'none');
    Rr.lowSpec = true;
    check('블룸: 저사양 모드에서 자동 비활성', Rr.bloomEnabled() === false);
    Rr.lowSpec = false;

    // context loss must free and rebuild the offscreen targets
    Rr.dispose();
    const reok = Rr.init();
    Rr.bindTextures(G.loader); Rr.uploadAll();
    G.render(0.016);
    check('컨텍스트 재초기화 후 블룸 타깃 재생성',
      reok && !!(Rr.bloom && Rr.bloom.ok));
  }

  // ---- tower climb ----
  {
    // every room must map to exactly one district, floors must increase, and
    // the theme the player sees must match the district the HUD reports
    let floorsRise = true, themesMatch = true, lastFloor = 0;
    const seen = {};
    for (let i = 0; i <= EH.Rooms.TOTAL; i++) {
      const tier = EH.tierFor(i), fl = EH.floorNumber(i);
      if (fl <= lastFloor) floorsRise = false;
      lastFloor = fl;
      if (EH.Rooms.themeFor(i) !== tier.theme) themesMatch = false;
      seen[tier.id] = (seen[tier.id] || 0) + 1;
    }
    check('탑 층계: 방마다 층수가 증가', floorsRise, '최상층 ' + lastFloor + '층');
    check('탑 층계: 표시 구역과 실제 테마 일치', themesMatch);
    check('탑 층계: 4개 구역 모두 사용', Object.keys(seen).length === 4,
      JSON.stringify(seen));

    // the backdrop must actually draw, and stay within budget in the spire
    G.startRun(); step(4);
    for (let i = 0; i <= EH.Rooms.TOTAL; i++) { G.enterRoom(i === EH.Rooms.TOTAL ? 'boss' : 'combat'); step(3); }
    check('탑 층계: 첨탑까지 도달', G.currentTier().id === 'spire',
      G.currentFloor() + '층 ' + G.currentTier().name);
    const Rr = G.renderer;
    let bg = 0;
    const ob = G.drawTowerBackdrop.bind(G);
    G.drawTowerBackdrop = function (t) { const b0 = Rr.drawCalls; ob(t); bg = Rr.drawCalls - b0; };
    Rr.drawCalls = 0; G.render(0.016);
    G.drawTowerBackdrop = ob;
    check('탑 배경: 실제로 그려짐', bg > 8, 'backdrop=' + bg + ' calls');

    // ascent transition: camera starts low and settles back
    G.enterRoom('combat'); step(1);
    const dip = G.cam.rise;
    step(80);
    check('상승 연출: 카메라가 아래에서 올라와 복귀', dip < -1 && Math.abs(G.cam.rise) < 0.01,
      'dip=' + dip.toFixed(2) + ' end=' + G.cam.rise.toFixed(3));
  }

  // ---- shader program binding ----
  // drawMesh used to rely on begin() having left the PBR program bound. Once a
  // pass switched programs (tower backdrop, shadows, sprites, bloom) the PBR
  // uniforms went to the wrong program and the mesh silently vanished - that is
  // how the hub floor disappeared entirely.
  {
    const Rr = G.renderer, gl = Rr.gl;
    const byProg = new Map();
    for (const k in Rr.progs) byProg.set(Rr.progs[k].program, k);
    let active = null;
    const oUse = gl.useProgram.bind(gl);
    gl.useProgram = function (p) { active = byProg.get(p) || '?'; return oUse(p); };
    const badMesh = {}, badSprite = {};
    const oM = Rr.drawMesh.bind(Rr);
    Rr.drawMesh = function (name) { const r = oM.apply(Rr, arguments); if (active !== 'pbr') badMesh[name] = active; return r; };
    const oS = Rr.drawSprite.bind(Rr);
    Rr.drawSprite = function () { const r = oS.apply(Rr, arguments); if (active !== 'unlit') badSprite.sprite = active; return r; };

    G.enterHub(); step(4); G.render(0.016);
    check('셰이더 프로그램 바인딩: 허브 메시가 모두 PBR 로 렌더',
      Object.keys(badMesh).length === 0, JSON.stringify(badMesh));

    for (const k in badMesh) delete badMesh[k];
    G.startRun(); step(6);
    for (let i = 0; i < 8; i++) G.world.spawnEnemy(EH.ENEMY_ORDER[i % 6], Math.cos(i) * 4, Math.sin(i) * 4, null, true);
    EH.Input.keys = EH.Input.keys || {}; EH.Input.keys.j = true; step(40); EH.Input.keys.j = false;
    G.render(0.016);
    check('셰이더 프로그램 바인딩: 전투 중에도 유지',
      Object.keys(badMesh).length === 0 && Object.keys(badSprite).length === 0,
      JSON.stringify(badMesh) + JSON.stringify(badSprite));

    // the hub must actually draw a floor - the reported symptom was an empty void
    let sawFloor = false;
    Rr.drawMesh = function (name) { if (name === 'floorTile') sawFloor = true; return oM.apply(Rr, arguments); };
    G.enterHub(); step(3); G.render(0.016);
    check('허브에 바닥이 실제로 그려짐', sawFloor);
    Rr.drawMesh = oM; Rr.drawSprite = oS; gl.useProgram = oUse;
  }

  // ---- input priority / buffering ----
  // The attack used to be processed first: it set atkPhase, canAct() went
  // false, and take('skill') then consumed the press and discarded it. Holding
  // attack - the normal way to play - made skills and ultimates unusable.
  {
    const IN = EH.Input; IN.keys = IN.keys || {};
    G.startRun(); step(5);
    const p = G.world.player;
    const os = p.startSkill.bind(p), ou = p.startUlt.bind(p);
    function trial(edge, restore) {
      let hit = 0;
      for (let t = 0; t < 12; t++) {
        p.skillCd = 0; p.ult = p.stats.ultMax;
        p.atkPhase = ''; p.comboIdx = 0; p.setState('idle');
        p.bufSkill = 0; p.bufUlt = 0;
        let fired = false;
        if (edge === 'skill') p.startSkill = function () { fired = true; return os(); };
        else p.startUlt = function () { fired = true; return ou(); };
        IN.keys.j = true; step(t + 2);
        IN._edge[edge] = true;
        step(30);
        IN.keys.j = false;
        p.startSkill = os; p.startUlt = ou;
        if (fired) hit++;
      }
      return hit;
    }
    const sHit = trial('skill'), uHit = trial('ult');
    check('입력 우선순위: 공격 홀드 중에도 스킬이 나간다', sHit === 12, sHit + '/12');
    check('입력 우선순위: 공격 홀드 중에도 궁극기가 나간다', uHit === 12, uHit + '/12');

    // right-click must not raise attackHeld
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'scripts', 'input.js'), 'utf8');
    const mouseBlock = src.split("if (e.pointerType === 'mouse') {")[1].split('return;')[0];
    check('우클릭이 공격을 발동시키지 않는다',
      /e\.button === 0\)\s*\{\s*self\.mouse\.down = true/.test(mouseBlock) &&
      !/^\s*self\.mouse\.down = true;/m.test(mouseBlock));
  }

  // ---- game-feel budget ----
  // Hit-stop froze 19% of all frames (up to 100ms at a time) and the camera
  // shook 74% of the time, which the player read as the game stuttering rather
  // than as impact. These caps keep the juice from becoming judder.
  {
    const IN = EH.Input; IN.keys = IN.keys || {};
    G.startRun(); step(6);
    const W = G.world;
    for (let i = 0; i < 8; i++) {
      const e = W.spawnEnemy(EH.ENEMY_ORDER[i % 6], Math.cos(i) * 2.0, Math.sin(i) * 2.0, null, true);
      e.hp = e.maxHp = 1e9;                       // unkillable so the fight lasts
    }
    W.player.x = 0; W.player.z = 0;
    let frozen = 0, worstRun = 0, run = 0, visShake = 0, peak = 0;
    const total = 480;
    IN.keys.j = true;
    for (let f = 0; f < total; f++) {
      step(1);
      if (W.hitStop > 0) { frozen++; run++; if (run > worstRun) worstRun = run; } else run = 0;
      if (G.cam.shakeAmt > 0.03) visShake++;
      if (G.cam.shakeAmt > peak) peak = G.cam.shakeAmt;
    }
    IN.keys.j = false;
    check('연출 밀도: 히트스톱이 프레임의 12% 이하', frozen / total <= 0.12,
      (frozen / total * 100).toFixed(0) + '%');
    check('연출 밀도: 연속 정지 4프레임 이하', worstRun <= 4, worstRun + 'frames');
    check('연출 밀도: 체감 화면흔들림 25% 이하', visShake / total <= 0.25,
      (visShake / total * 100).toFixed(0) + '%');
    check('연출 밀도: 흔들림 진폭 상한 준수', peak <= 0.16, peak.toFixed(3));
  }

  // ---- report ----
  const pass = results.filter(r => r.ok).length;
  console.log('\n=== ECHOHEART headless integration ===');
  results.forEach(r => console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   [' + r.extra + ']' : '')));
  console.log(`\ntotal ${results.length}  passed ${pass}  failed ${results.length - pass}`);
  fs.writeFileSync(path.join(__dirname, 'headless_results.json'),
    JSON.stringify({ total: results.length, passed: pass, failed: results.length - pass, drawCalls, results }, null, 1));
  process.exit(results.length - pass > 0 ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
