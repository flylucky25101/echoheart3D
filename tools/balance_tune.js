'use strict';
// Auto-tunes weapon base damage until every weapon hits its design budget.
//
// Budget (deliberate, not accidental):
//   riftsword  1.00  - mid reach, must close
//   chaingaunt 1.02  - shortest reach, hugs the target -> small risk premium
//   pulsebow   0.84  - fights from safety, pays for it in raw damage
//
// The matchup table (identical column sums) decides WHICH enemies each weapon
// prefers; this script only equalises overall power.
//
// Measurement is delegated to balance_sim.js so there is exactly one source of
// truth - an earlier version duplicated the measurement here and the two copies
// silently drifted apart, producing contradictory numbers.
//
//   node tools/balance_tune.js                one dry-run pass
//   node tools/balance_tune.js --write        apply one pass
//   node tools/balance_tune.js --write -n 6   iterate until converged
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');

const R = path.join(__dirname, '..');
const CFG = path.join(R, 'scripts', 'config.js');
const SIM = path.join(__dirname, 'balance_sim.js');

const BUDGET = { riftsword: 1.00, chaingaunt: 1.02, pulsebow: 0.84 };
const WRITE = process.argv.includes('--write');
const nIdx = process.argv.indexOf('-n');
const ITER = nIdx >= 0 ? (parseInt(process.argv[nIdx + 1], 10) || 1) : 1;

function measure() {
  const raw = execFileSync(process.execPath, [SIM, '--json'], { encoding: 'utf8' });
  return JSON.parse(raw);
}

function readDmg() {
  const s = fs.readFileSync(CFG, 'utf8');
  const out = {};
  for (const w of Object.keys(BUDGET)) {
    const m = s.match(new RegExp(w + ":\\s*\\{[\\s\\S]*?dmg:\\s*([0-9.]+)"));
    out[w] = m ? parseFloat(m[1]) : null;
  }
  return out;
}

function writeDmg(vals) {
  let s = fs.readFileSync(CFG, 'utf8');
  for (const w of Object.keys(vals)) {
    const re = new RegExp("(" + w + ":\\s*\\{[\\s\\S]*?dmg:\\s*)([0-9.]+)");
    if (!re.test(s)) { console.log('!! 패턴 불일치: ' + w); continue; }
    s = s.replace(re, "$1" + vals[w]);
  }
  fs.writeFileSync(CFG, s);
}

const order = ['riftsword', 'pulsebow', 'chaingaunt'];
const NAME = { riftsword: '균열검', pulsebow: '맥동궁', chaingaunt: '사슬완갑' };

for (let it = 0; it < ITER; it++) {
  const res = measure();
  const dmg = readDmg();
  // anchor on the sword so the game keeps its existing pacing
  const base = res.weapons.riftsword.totalDps / BUDGET.riftsword;
  const next = {};
  let worst = 0;
  console.log((ITER > 1 ? '[' + (it + 1) + '/' + ITER + '] ' : '') +
    '무기       실측합계   목표합계    편차      dmg');
  for (const w of order) {
    const got = res.weapons[w].totalDps, want = base * BUDGET[w];
    const dev = ((got - want) / want) * 100;
    worst = Math.max(worst, Math.abs(dev));
    // damp the correction: the response is not perfectly linear (combo
    // breakpoints, damage floor, ramp) and a full-step correction oscillates
    const scale = 1 + (want / got - 1) * 0.85;
    next[w] = Math.round(dmg[w] * scale * 10) / 10;
    console.log('  ' + NAME[w].padEnd(8) + got.toFixed(0).padStart(8) +
      want.toFixed(0).padStart(10) + (dev.toFixed(1) + '%').padStart(9) +
      '   ' + dmg[w] + ' -> ' + next[w]);
  }
  console.log('  최대 편차 ' + worst.toFixed(1) + '%');
  if (!WRITE) { console.log('\n(미적용 - 반영하려면 --write)'); break; }
  if (worst < 2.0) { console.log('\n수렴 완료 (편차 2% 미만).'); break; }
  writeDmg(next);
}
