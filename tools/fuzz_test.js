'use strict';
// Hostile-conditions test: random input storms, hostile dt, deliberate NaN
// injection, corrupt saves, every weapon against every enemy and all boss
// phases. Asserts zero exceptions and zero surviving non-finite state.
//
//   node tools/fuzz_test.js [frames]
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');

const h = fs.readFileSync(path.join(__dirname, 'headless_test.js'), 'utf8');
const tr = JSON.parse(fs.readFileSync(path.join(__dirname, 'texture_report.json'), 'utf8'));
global.__texDims = {};
tr.forEach(r => { const d = r.dim.split('x').map(Number); global.__texDims[r.path] = [d[0], d[1]]; });
new Function('//' + h.split('// ---------------- DOM mock')[1]
  .split('// ---------------- load game scripts')[0]).call(global);

const errors = [];
const origErr = console.error;
console.error = function () { errors.push(Array.from(arguments).join(' ')); };

[...fs.readFileSync(path.join(R, 'index.html'), 'utf8').matchAll(/src="([^"]+)"/g)]
  .map(m => m[1]).forEach(s => new Function(fs.readFileSync(path.join(R, s), 'utf8')).call(global));

const EH = global.window.EchoHeart, G = EH.Game;
EH.randomSeed = function () { return 777; };

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

let thrown = 0;
function guarded(fn) { try { fn(); } catch (e) { thrown++; console.log('  !! 예외: ' + (e && e.stack || e)); } }

// step with an arbitrary (possibly hostile) delta
function stepDt(ms) { G.last -= ms; G.loop(G.last + ms); }
function step(n, ms) { for (let i = 0; i < n; i++) stepDt(ms == null ? 16.7 : ms); }

let rs = 4242;
function rnd() { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }
function pick(a) { return a[Math.floor(rnd() * a.length)] || a[0]; }

function nonFinite(W) {
  let bad = [];
  const chk = (o, tag) => {
    if (!o) return;
    ['x', 'y', 'z', 'vx', 'vz', 'facing', 'hp'].forEach(f => {
      const v = o[f];
      if (typeof v === 'number' && !isFinite(v)) bad.push(tag + '.' + f);
    });
  };
  chk(W.player, 'player');
  W.enemies.forEach((e, i) => chk(e, 'enemy' + i));
  chk(W.boss, 'boss');
  W.projectiles.each(p => { if (!isFinite(p.x) || !isFinite(p.z)) bad.push('proj'); });
  return bad;
}

setTimeout(() => {
  const FRAMES = parseInt(process.argv[2], 10) || 6000;
  console.log('ECHOHEART 퍼즈/소크 테스트\n');

  // ---------- 1. 랜덤 입력 폭풍 + 적대적 dt ----------
  const IN = EH.Input; IN.keys = IN.keys || {};
  const KEYS = ['w', 'a', 's', 'd', 'j', 'k', 'l', ' '];
  guarded(() => {
    G.startRun(); step(5);
    for (let i = 0; i < FRAMES; i++) {
      // random input every few frames
      if (i % 3 === 0) {
        KEYS.forEach(k => { IN.keys[k] = rnd() < 0.35; });
        if (rnd() < 0.08) IN._edge[pick(['dash', 'skill', 'ult', 'attackTap'])] = true;
      }
      // hostile deltas: stalls, zero, negative, absurd
      let ms = 16.7;
      const r = rnd();
      if (r < 0.02) ms = 0;
      else if (r < 0.04) ms = -50;
      else if (r < 0.06) ms = 5000;
      else if (r < 0.08) ms = NaN;
      stepDt(ms);
      // random weapon swaps mid-combat
      if (i % 500 === 0 && G.world.player) G.world.player.weapon = pick(EH.WEAPON_ORDER);
      // keep the run alive so we keep exercising combat
      if (G.runOver || G.mode !== 'run') { G.startRun(); step(3); }
    }
    KEYS.forEach(k => { IN.keys[k] = false; });
  });
  check('랜덤 입력 ' + FRAMES + '프레임 + 적대적 dt: 예외 없음', thrown === 0, thrown + '건');
  check('비정상 수치 잔존 없음', nonFinite(G.world).length === 0, nonFinite(G.world).join(','));

  // ---------- 2. NaN 주입 후 자동 복구 ----------
  guarded(() => {
    G.startRun(); step(3);
    const W = G.world, p = W.player;
    p.x = NaN; p.z = Infinity; p.vx = NaN; p.hp = NaN; p.facing = NaN;
    const e = W.spawnEnemy('stalker', 3, 0, null, true);
    e.x = NaN; e.z = -Infinity; e.hp = NaN;
    step(3);
  });
  const after = nonFinite(G.world);
  check('NaN/Infinity 주입 -> 자동 복구', after.length === 0, after.join(','));
  check('복구 카운터가 실제로 동작', (G.world.sanitizedCount || 0) > 0,
    '누적 ' + (G.world.sanitizedCount || 0));

  // ---------- 3. 전 무기 x 전 적 x 엘리트 ----------
  let combos = 0;
  guarded(() => {
    for (const w of EH.WEAPON_ORDER) {
      for (const k of EH.ENEMY_ORDER) {
        for (const el of [null, 'accel', 'ward']) {
          G.startRun(); step(3);
          G.world.player.weapon = w;
          const e = G.world.spawnEnemy(k, 2.2, 0, el, true);
          if (!e) continue;
          IN.keys.j = true; step(45); IN.keys.j = false;
          combos++;
        }
      }
    }
  });
  check('무기3 x 적6 x 엘리트3 = ' + combos + '조합 전투: 예외 없음', thrown === 0, thrown + '건');

  // ---------- 4. 보스 전 페이즈 + 상성 ----------
  let phases = new Set();
  guarded(() => {
    for (const w of EH.WEAPON_ORDER) {
      G.startRun(); step(3);
      G.world.player.weapon = w;
      const b = G.world.spawnBoss();
      for (let ph = 0; ph < 3; ph++) {
        b.phase = ph; b.hp = b.maxHp;
        phases.add(ph);
        // resistance must resolve to a finite positive number in every phase
        const r = G.world.resistOf(b);
        if (!(r > 0 && isFinite(r))) throw new Error('보스 저항 이상: ' + w + ' ph' + ph + ' = ' + r);
        IN.keys.j = true; step(40); IN.keys.j = false;
      }
    }
  });
  check('보스 3페이즈 x 무기3: 저항 유효 + 예외 없음', thrown === 0 && phases.size === 3);

  // ---------- 5. 손상된 세이브 ----------
  const CORRUPT = [
    'not json at all', '{', '[]', 'null', '{"version":"x"}',
    '{"settings":null,"cores":"abc"}',
    '{"settings":{"autoAim":1e309,"spriteMode":NaN},"weapon":12345}',
    JSON.stringify({ settings: { buttonScale: -99, joystickSens: 1e9 }, upgrades: 'nope', weapon: '없는무기' })
  ];
  let saveOk = 0;
  CORRUPT.forEach(txt => {
    guarded(() => {
      global.window.localStorage.setItem('echoheart.save.v1', txt);
      EH.Save.load();
      const d = EH.Save.data;
      if (d && d.settings && isFinite(EH.Settings.get('autoAim'))) saveOk++;
    });
  });
  check('손상 세이브 ' + CORRUPT.length + '종 복구', saveOk === CORRUPT.length, saveOk + '/' + CORRUPT.length);

  // ---------- 6. 알 수 없는 설정 키 ----------
  guarded(() => {
    const v = EH.Settings.get('존재하지않는키');
    if (v === undefined || v === null || typeof v === 'number' || typeof v === 'boolean') return;
    throw new Error('예상 밖 반환: ' + v);
  });
  check('알 수 없는 설정 키 안전 처리', thrown === 0);

  // ---------- 7. 장시간 소크 (메모리/풀 누수) ----------
  let poolBefore, poolAfter;
  guarded(() => {
    G.startRun(); step(5);
    poolBefore = G.world.projectiles.items.length + G.world.particles.items.length;
    for (let i = 0; i < 3000; i++) {
      if (i % 7 === 0) IN.keys.j = true; else if (i % 7 === 3) IN.keys.j = false;
      if (i % 300 === 0) G.world.spawnEnemy(pick(EH.ENEMY_ORDER), rnd() * 8 - 4, rnd() * 8 - 4, null, true);
      step(1);
    }
    IN.keys.j = false;
    poolAfter = G.world.projectiles.items.length + G.world.particles.items.length;
  });
  check('3000프레임 소크: 예외 없음', thrown === 0, thrown + '건');
  check('오브젝트 풀 상한 준수 (누수 없음)', poolAfter <= 260 + 320,
    poolBefore + ' -> ' + poolAfter);

  // ---------- 8. 상성 테이블 무결성 ----------
  const cols = { slash: 0, pierce: 0, impact: 0 };
  let rowsOk = true;
  EH.ENEMY_ORDER.forEach(k => {
    const r = EH.ENEMIES[k].resist;
    if (!r) { rowsOk = false; return; }
    ['slash', 'pierce', 'impact'].forEach(t => {
      if (!(r[t] > 0 && isFinite(r[t]))) rowsOk = false;
      cols[t] += r[t];
    });
  });
  const vals = Object.values(cols);
  check('적 저항 테이블 유효', rowsOk);
  check('무기별 저항 합계 동일 (편향 없음)',
    Math.max(...vals) - Math.min(...vals) < 1e-6,
    JSON.stringify(cols));
  const bcols = { slash: 0, pierce: 0, impact: 0 };
  EH.BOSS_RESIST.forEach(p => ['slash', 'pierce', 'impact'].forEach(t => bcols[t] += p[t]));
  const bvals = Object.values(bcols);
  check('보스 페이즈 저항 합계 동일',
    Math.max(...bvals) - Math.min(...bvals) < 1e-6, JSON.stringify(bcols));

  // ---------- 9. 콘솔 오류 ----------
  const real = errors.filter(e => !/sanitize/.test(e));
  check('콘솔 오류 없음', real.length === 0, real.slice(0, 3).join(' | '));

  console.log('\ntotal ' + (pass + fail) + '  passed ' + pass + '  failed ' + fail +
    '  throw ' + thrown);
  console.error = origErr;
  process.exit(fail || thrown ? 1 : 0);
}, 600);
