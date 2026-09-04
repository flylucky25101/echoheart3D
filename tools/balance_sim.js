'use strict';
// Measures real weapon-vs-enemy performance by driving the actual combat code.
// Not a spreadsheet model: it spawns an enemy, holds attack, and counts frames
// until it dies, so reach / arc / wind-up / recovery / ramp all matter.
//
//   node tools/balance_sim.js            summary table
//   node tools/balance_sim.js --json     machine-readable
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');

const h = fs.readFileSync(path.join(__dirname, 'headless_test.js'), 'utf8');
const tr = JSON.parse(fs.readFileSync(path.join(__dirname, 'texture_report.json'), 'utf8'));
global.__texDims = {};
tr.forEach(r => { const d = r.dim.split('x').map(Number); global.__texDims[r.path] = [d[0], d[1]]; });
new Function('//' + h.split('// ---------------- DOM mock')[1]
  .split('// ---------------- load game scripts')[0]).call(global);
[...fs.readFileSync(path.join(R, 'index.html'), 'utf8').matchAll(/src="([^"]+)"/g)]
  .map(m => m[1]).forEach(s => new Function(fs.readFileSync(path.join(R, s), 'utf8')).call(global));

const EH = global.window.EchoHeart, G = EH.Game;

// The engine seeds each run from Date.now(), which made two identical
// measurement runs disagree. Pin it so every measurement is reproducible.
EH.randomSeed = function () { return 20240101; };
const DT = 1 / 60;

function step(n) { for (let i = 0; i < n; i++) { G.last -= 16.7; G.loop(G.last + 16.7); } }

// Deterministic RNG so crit rolls do not add noise between weapons.
let seed = 12345;
function seededRandom() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

/**
 * Time-to-kill for one weapon against one enemy kind.
 * The enemy is frozen in place (speed 0, no attacks) so we measure the weapon,
 * not the enemy's ability to run away. Distance is fixed per weapon class.
 */
function ttk(weapon, kind, opts) {
  opts = opts || {};
  const IN = EH.Input; IN.keys = IN.keys || {};
  IN.keys.j = false; IN.keys.w = IN.keys.a = IN.keys.s = IN.keys.d = false;
  IN._edge = { dash: false, skill: false, ult: false, pause: false, confirm: false, attackTap: false };
  // Seed BEFORE startRun: room generation consumes RNG, so seeding afterwards
  // let earlier cells leak into later ones and made results jump between runs.
  seed = 12345;
  G.startRun(); step(4);
  G.stats.critChance = 0;   // startRun recomputes stats; keep cells crit-free
  const W = G.world, p = W.player;
  W.enemies.length = 0; W.boss = null;
  W.projectiles.clear(); W.particles.clear(); W.fields.clear();
  if (G.room) G.room.props = [];

  p.weapon = weapon;
  p.x = 0; p.z = 0; p.y = 0;
  p.hp = p.maxHp; p.dead = false; p.atkPhase = ''; p.comboIdx = 0;
  p.ramp = 0; p.rampT = 0; p.skillCd = 0; p.ult = 0;
  p.setState('idle');

  const ranged = !!EH.WEAPONS[weapon].ranged;
  // Melee is measured at contact range (radius sum + a small gap), which is
  // where a player actually stands. A fixed 1.5m instead made the result
  // depend on each enemy's radius rather than on the weapon.
  let dist = opts.dist;
  const e = W.spawnEnemy(kind, 0, 3, null, true);
  if (dist == null) dist = ranged ? 7.0 : (e.radius + W.player.radius + 0.15);
  e.x = 0; e.z = dist;
  e.hp = e.maxHp = opts.hp != null ? opts.hp : e.maxHp;
  // freeze: the enemy is a damage dummy
  e.def = Object.assign({}, e.def, { speed: 0 });
  e.beginTell = function () { };
  e.doAttack = function () { };
  e.knockX = e.knockZ = 0;

  // Fixed-window sustained DPS against an unkillable dummy. Measuring
  // "frames until death" instead would reward big single hits through overkill
  // and punish slow weapons for their first wind-up.
  e.hp = e.maxHp = 1e9;
  let dealt = 0;
  const FR = opts.frames || 480;                 // 8 seconds
  const origDamage = W.damageEnemy.bind(W);
  W.damageEnemy = function (t, amt, o) { const d = origDamage(t, amt, o); dealt += d || 0; return d; };

  IN.keys.j = true;
  for (let i = 0; i < FR; i++) {
    // hold position: re-anchor so knockback does not drift the fight
    e.x = 0; e.z = dist; e.knockX = 0; e.knockZ = 0;
    p.x = 0; p.z = 0;
    step(1);
  }
  IN.keys.j = false;
  W.damageEnemy = origDamage;

  const secs = FR * DT;
  return { secs: secs, killed: true, dps: dealt / secs };
}

function run() {
  Math.random = seededRandom;
  // neutral baseline: no meta upgrades, no crit variance
  const st = G.stats;
  st.critChance = 0;

  const weapons = EH.WEAPON_ORDER;
  const kinds = EH.ENEMY_ORDER;
  const out = { weapons: {}, matrix: {}, resist: {} };

  for (const w of weapons) {
    out.matrix[w] = {};
    out.resist[w] = {};
    let total = 0;
    for (const k of kinds) {
      const r = ttk(w, k, { hp: 100 });         // fixed HP so DPS is comparable
      out.matrix[w][k] = +r.dps.toFixed(2);
      out.resist[w][k] = (EH.ENEMIES[k].resist || {})[EH.WEAPONS[w].dmgType] || 1;
      total += r.dps;
    }
    out.weapons[w] = { dmgType: EH.WEAPONS[w].dmgType, totalDps: +total.toFixed(2) };
  }
  return out;
}

const res = run();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(res, null, 1));
} else {
  const kinds = EH.ENEMY_ORDER;
  const pad = (s, n) => String(s).padEnd(n);
  const padl = (s, n) => String(s).padStart(n);
  console.log('무기별 DPS (적 HP 100 고정, 크리 없음, 적 정지)\n');
  console.log(pad('무기', 14) + kinds.map(k => padl(EH.ENEMIES[k].name, 11)).join('') + padl('합계', 10));
  for (const w of EH.WEAPON_ORDER) {
    const row = kinds.map(k => padl(res.matrix[w][k].toFixed(1), 11)).join('');
    console.log(pad(EH.WEAPONS[w].name + '(' + res.weapons[w].dmgType + ')', 14) + row +
      padl(res.weapons[w].totalDps.toFixed(1), 10));
  }
  // Raw DPS is deliberately NOT equal: the bow trades damage for safety.
  // What must hold is that each weapon matches its design budget.
  const BUDGET = { riftsword: 1.00, chaingaunt: 1.02, pulsebow: 0.84 };
  const base = res.weapons.riftsword.totalDps / BUDGET.riftsword;
  console.log('\n설계 예산 대비 (사거리 위험 프리미엄 반영):');
  let worst = 0;
  for (const w of EH.WEAPON_ORDER) {
    const want = base * BUDGET[w], got = res.weapons[w].totalDps;
    const dev = ((got - want) / want) * 100;
    worst = Math.max(worst, Math.abs(dev));
    console.log('  ' + pad(EH.WEAPONS[w].name, 10) + '목표 ' + padl(want.toFixed(0), 6) +
      '  실측 ' + padl(got.toFixed(0), 6) + '  편차 ' + padl(dev.toFixed(1) + '%', 8));
  }
  console.log('  최대 편차 ' + worst.toFixed(1) + '%  (5% 이내 목표)');
  // per-enemy best weapon
  console.log('\n적별 최적 무기:');
  for (const k of kinds) {
    const best = EH.WEAPON_ORDER.reduce((a, b) => res.matrix[a][k] >= res.matrix[b][k] ? a : b);
    const worst = EH.WEAPON_ORDER.reduce((a, b) => res.matrix[a][k] <= res.matrix[b][k] ? a : b);
    console.log('  ' + pad(EH.ENEMIES[k].name, 12) + ' 최적 ' + pad(EH.WEAPONS[best].name, 8) +
      ' / 최악 ' + EH.WEAPONS[worst].name);
  }
}
