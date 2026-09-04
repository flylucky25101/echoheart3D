'use strict';
// Stats pipeline: base -> meta upgrades -> echoes -> synergies; echo offers,
// meta purchase, death adaptation, run rewards, abyss scaling.
(function () {
  var EH = window.EchoHeart;
  var P = EH.Prog = {};

  P.blankStats = function () {
    var b = EH.CONFIG.baseStats, s = {};
    for (var k in b) s[k] = b[k];
    s.crystalGain = 1;
    return s;
  };

  P.applyMod = function (stats, mod, times) {
    for (var k in mod) {
      if (stats[k] === undefined) stats[k] = 0;
      stats[k] += mod[k] * times;
    }
  };

  P.familyCounts = function (echoes) {
    var c = { ember: 0, storm: 0, void: 0, neutral: 0 };
    EH.ECHOES.forEach(function (e) {
      var st = echoes[e.id] || 0;
      if (st > 0) c[e.fam] += st;
    });
    return c;
  };
  P.synergies = function (echoes) {
    var c = P.familyCounts(echoes), out = {};
    for (var f in EH.SYNERGY) out[f] = c[f] >= EH.SYNERGY[f].need;
    return out;
  };

  // full stat computation for a run
  P.computeStats = function (save, echoes) {
    var s = P.blankStats();
    echoes = echoes || {};
    // meta (permanent)
    EH.META.forEach(function (m) {
      var lv = (save && save.meta && save.meta[m.id]) || 0;
      if (lv > 0) P.applyMod(s, m.mod, lv);
    });
    // echoes (this run)
    EH.ECHOES.forEach(function (e) {
      var st = echoes[e.id] || 0;
      if (st > 0) P.applyMod(s, e.mod, st);
    });
    // synergies
    var syn = P.synergies(echoes);
    if (syn.ember) s.burnMul += 0.6;
    if (syn.storm) s.storm5th = 1;
    if (syn.void) s.critHeal = 1;
    // hard caps / sanity
    s.maxHp = Math.max(10, s.maxHp);
    s.maxLifeCores = EH.clamp(Math.round(s.maxLifeCores), 1, 2);
    s.critChance = EH.clamp(s.critChance, 0, 0.75);
    s.critMul = EH.clamp(s.critMul, 1, 6);
    s.lifesteal = EH.clamp(s.lifesteal, 0, 0.08);
    s.attackSpeedMul = EH.clamp(s.attackSpeedMul, 0.5, 2.2);
    s.moveSpeed = EH.clamp(s.moveSpeed, 2, 9);
    s.dashCooldown = Math.max(0.45, s.dashCooldown);
    s.skillCooldownMul = Math.max(0.4, s.skillCooldownMul);
    s.ultChargeMul = EH.clamp(s.ultChargeMul, 0.5, 3);
    s.damageMul = Math.max(0.2, s.damageMul);
    s.synergy = syn;
    return s;
  };

  // ---- echo offers ----
  P.available = function (echoes) {
    return EH.ECHOES.filter(function (e) { return (echoes[e.id] || 0) < e.max; });
  };
  P.offerEchoes = function (rng, echoes, count, rareBonus) {
    var pool = P.available(echoes).slice();
    var out = [];
    count = count || 3;
    rareBonus = rareBonus || 0;
    while (out.length < count && pool.length) {
      // weight by rarity, boosted toward rare/epic by rareBonus
      var total = 0, i;
      for (i = 0; i < pool.length; i++) {
        var r = EH.RARITY[pool[i].rar];
        var w = r.w;
        if (pool[i].rar !== 'common') w *= (1 + rareBonus * 2);
        pool[i]._w = w; total += w;
      }
      var pick = rng.next() * total, acc = 0, chosen = pool.length - 1;
      for (i = 0; i < pool.length; i++) { acc += pool[i]._w; if (pick <= acc) { chosen = i; break; } }
      out.push(pool[chosen]);
      pool.splice(chosen, 1);   // no duplicates in one offer
    }
    return out;
  };

  // ---- meta ----
  P.metaLevel = function (save, id) { return (save.meta && save.meta[id]) || 0; };
  P.metaCost = function (save, id) {
    var m = null;
    for (var i = 0; i < EH.META.length; i++) if (EH.META[i].id === id) m = EH.META[i];
    if (!m) return null;
    var lv = P.metaLevel(save, id);
    if (lv >= m.max) return null;
    return m.cost(lv);
  };
  P.buyMeta = function (save, id) {
    var m = null;
    for (var i = 0; i < EH.META.length; i++) if (EH.META[i].id === id) m = EH.META[i];
    if (!m) return { ok: false, msg: '알 수 없는 업그레이드입니다.' };
    var lv = P.metaLevel(save, id);
    if (lv >= m.max) return { ok: false, msg: '이미 최대 레벨입니다.' };
    var cost = m.cost(lv);
    if (save.crystals < cost) return { ok: false, msg: '잔향 결정이 부족합니다.' };
    save.crystals -= cost;
    save.meta[id] = lv + 1;
    return { ok: true, msg: m.name + ' ' + (lv + 1) + '레벨', level: lv + 1, cost: cost };
  };

  // ---- adaptation ----
  P.recordDeath = function (save, cause) {
    if (!EH.ADAPT[cause]) cause = 'melee';
    var cur = save.adapt[cause] || 0;
    var max = EH.ADAPT[cause].max;
    if (cur >= max) return { cause: cause, level: cur, gained: false, max: max };
    save.adapt[cause] = cur + 1;
    return { cause: cause, level: cur + 1, gained: true, max: max };
  };
  // incoming damage to player, reduced by matching adaptation
  P.mitigate = function (save, dmg, type) {
    var a = EH.ADAPT[type];
    if (!a || a.kind !== 'reduce') return dmg;
    var lv = (save.adapt && save.adapt[type]) || 0;
    return dmg * (1 - Math.min(0.5, lv * a.per));
  };
  // outgoing damage vs boss, boosted by boss adaptation
  P.bossBonus = function (save) {
    var lv = (save.adapt && save.adapt.boss) || 0;
    return 1 + lv * EH.ADAPT.boss.per;
  };

  // ---- abyss scaling (post-victory difficulty) ----
  P.abyssMul = function (level) {
    level = Math.max(0, level | 0);
    return { hp: 1 + level * 0.18, dmg: 1 + level * 0.12, reward: 1 + level * 0.25 };
  };

  // ---- run rewards ----
  P.runReward = function (run, save, won) {
    var rooms = run.roomsCleared || 0;
    var base = 8;                        // guaranteed minimum, even on room 1
    var perRoom = 7, perKill = 0.55, perElite = 6;
    var v = base + rooms * perRoom + (run.kills || 0) * perKill + (run.eliteKills || 0) * perElite;
    if (run.reachedBoss) v += 25;
    if (won) v += 60;
    var ab = P.abyssMul(run.abyss || 0);
    v *= ab.reward;
    var stats = P.computeStats(save, run.echoes || {});
    v *= (stats.crystalGain || 1);
    return Math.max(5, Math.round(v));
  };

  P.echoDesc = function (echo, stacks) {
    try { return echo.desc(stacks); } catch (e) { return ''; }
  };
  P.metaDesc = function (m, lv) {
    try { return m.desc(lv); } catch (e) { return ''; }
  };
})();
