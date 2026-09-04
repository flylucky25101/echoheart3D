'use strict';
// Combat resolution: hit detection, damage pipeline (crit/echoes/adaptation),
// status effects, weapon skills/ultimates, world simulation step.
(function () {
  var EH = window.EchoHeart;
  var W = EH.World.prototype;

  function angDiff(a, b) { return Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI); }

  // heavy hit feel reserved for skills (basic attacks stay modest so the gap reads)
  W.skillImpact = function (x, z, color, big) {
    this.punch(big ? 0.10 : 0.075, big ? 0.30 : 0.22);
    this.spawnParticles(x, 0.7, z, big ? 22 : 16, color, { speed: 11, up: 4, life: 0.5, size: 0.30 });
    this.spawnParticles(x, 0.9, z, 10, [1, 1, 0.9], { speed: 6, up: 3, life: 0.35, size: 0.20, grav: -4 });
    this.addField(x, z, big ? 3.2 : 2.4, 0.4, 0, color, 'wave');   // expanding shock ring
  };

  // ---------- targeting helpers ----------
  W.forEachTarget = function (fn) {
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.alive && !e.dying) fn(e);
    }
    if (this.boss && this.boss.alive && !this.boss.dying && this.boss.introDone) fn(this.boss);
  };

  // ---------- player damage output ----------
  // Weapon-vs-enemy matchup. Every weapon has 2 strong / 2 neutral / 2 weak
  // targets and the three columns sum to exactly the same total, so no weapon
  // is stronger overall - they just prefer different enemies.
  W.resistOf = function (target) {
    var type = (EH.WEAPONS[this.player.weapon] || {}).dmgType;
    if (!type) return 1;
    var tbl = null;
    if (target === this.boss) {
      var ph = EH.clamp(target.phase | 0, 0, EH.BOSS_RESIST.length - 1);
      tbl = EH.BOSS_RESIST[ph];
    } else if (target.def) {
      tbl = target.def.resist;
    }
    var m = tbl ? tbl[type] : 1;
    return (typeof m === 'number' && isFinite(m) && m > 0) ? m : 1;
  };
  W.matchupOf = function (target) {
    var m = this.resistOf(target);
    return m > 1.12 ? 1 : (m < 0.88 ? -1 : 0);   // strong / neutral / weak
  };

  W.computeHit = function (base, target) {
    var p = this.player, st = p.stats, save = this.game.save.data;
    var dmg = base;
    if (st.executeLowHp > 0 && target.hp / target.maxHp < 0.35) dmg *= 1 + 0.10 * st.executeLowHp;
    if (st.lowHpDmg > 0 && p.hp / p.maxHp < 0.4) dmg *= 1 + 0.12 * st.lowHpDmg;
    var crit = Math.random() < st.critChance;
    if (crit) dmg *= st.critMul;
    if (target === this.boss) dmg *= EH.Prog.bossBonus(save);
    // NOTE: the matchup multiplier is NOT applied here. damageEnemy() is the
    // single funnel for damage dealt to enemies, so it is applied there once -
    // otherwise paths that skip computeHit (chains, fields, shocks) would be
    // unaffected and paths that use it would be multiplied twice.
    return { dmg: dmg, crit: crit };
  };

  W.damageEnemy = function (target, amount, opts) {
    opts = opts || {};
    if (!target.alive || target.dying) return 0;
    var p = this.player, st = p.stats;
    var dmg = amount;
    // weapon-vs-enemy matchup (single application point for every damage path)
    var matchup = 0;
    if (!opts.noMatchup) {
      var res = this.resistOf(target);
      dmg *= res;
      matchup = (res > 1.12 ? 1 : (res < 0.88 ? -1 : 0));
    }
    // elite ward + shield-enemy frontal block
    if (target.shield) dmg *= (1 - target.shield * 0.5);
    if (opts.fromX != null && target.def && target.def.ai === 'shield') {
      var ang = Math.atan2(opts.fromX - target.x, opts.fromZ - target.z);
      if (angDiff(ang, target.facing) < target.def.frontArc) dmg *= (1 - target.def.block);
    }
    if (!isFinite(dmg)) dmg = 1;
    dmg = Math.max(1, dmg);
    target.hp -= dmg;
    target.flash = 1.35;
    if (!opts.silent) {
      this.damageNumber(target.x, target.y + 1.2, target.z, dmg, !!opts.crit, matchup);
      // fewer, bigger, faster chunks read better than a fine spray
      this.spawnParticles(target.x, target.y + 0.9, target.z, opts.crit ? 7 : 4,
        opts.crit ? [1, 0.92, 0.45] : [1, 0.78, 0.52],
        { speed: 6.5, up: 3.2, life: 0.42, size: opts.crit ? 0.26 : 0.19 });
      // heavy blows get a directional spark fan + a ground ring
      if ((opts.weight || 1) >= 1.5) {
        this.spawnParticles(target.x, target.y + 0.7, target.z, 6, [1, 0.85, 0.6],
          { speed: 9, up: 1.6, life: 0.3, size: 0.22, grav: -4 });
        this.addField(target.x, target.z, 1.1, 0.22, 0, [1, 0.8, 0.5], 'wave');
      }
      EH.Audio.play(opts.crit ? 'crit' : 'projectileHit');
      // hit stop scaled by strength
      var wgt = opts.weight || 1;
      this.punch(wgt >= 1.5 ? C_HITSTOP_HEAVY : C_HITSTOP,
                 EH.clamp(0.030 * wgt, 0, 0.13));
      this.combo++; this.comboTimer = 2.2;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      if (this.combo > 0 && this.combo % 10 === 0 && this.game.streakPop) this.game.streakPop(this.combo + ' 연속타!');
      p.chargeUlt(1.5 * (opts.weight || 1));
      this.game.vibrate(opts.crit ? 18 : 8);
    }
    // knockback
    if (opts.kb && opts.fromX != null) {
      var kx = target.x - opts.fromX, kz = target.z - opts.fromZ, kl = Math.hypot(kx, kz) || 1;
      target.knockX += (kx / kl) * opts.kb; target.knockZ += (kz / kl) * opts.kb;
    }
    // on-hit echo effects (only from real player hits)
    if (!opts.silent) {
      if (st.burnLevel > 0) {
        target.burn = (4 + st.burnLevel * 2) * st.burnMul;
        target.burnTime = 3.0; target.burnTick = 0.5;
      }
      if (st.lifesteal > 0 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + dmg * st.lifesteal);
      }
      if (opts.crit && st.critHeal) p.hp = Math.min(p.maxHp, p.hp + 1.5);
      if (st.chainLevel > 0) {
        p.hitCount++;
        var need = st.storm5th ? 4 : 5;
        if (p.hitCount >= need) { p.hitCount = 0; this.chainLightning(target, st.chainLevel); }
      }
    }
    if (target.hp <= 0) {
      if (target === this.boss) target.die();
      else target.die();
      return dmg;
    }
    return dmg;
  };
  // Hit-stop is a spice, not a sauce. Every hit used to freeze the game for
  // 50-110ms; at 8 enemies with attack held that was 19% of all frames frozen,
  // which reads as constant stutter rather than impact. Basic hits now get a
  // barely-there freeze, only heavy blows get a real one, and a cooldown stops
  // consecutive hits from chaining freezes together.
  var C_HITSTOP = 0.026;          // basic hit
  var C_HITSTOP_HEAVY = 0.060;    // 3rd combo hit / skills
  var HITSTOP_GAP = 0.20;         // minimum time between freezes
  W.punch = function (amount, shake) {
    if (this.hitStopCd > 0) {
      // a hint of a kick so rapid hits do not feel dead, but small enough that
      // continuous attacking does not leave the camera permanently vibrating
      this.shakeCam((shake || 0) * 0.15);
      return;
    }
    this.hitStopCd = HITSTOP_GAP;
    this.hitStop = Math.max(this.hitStop, amount);
    this.shakeCam(shake || 0);
  };

  W.chainLightning = function (from, level) {
    var self = this, hits = 0, max = 2 + level;
    var dmg = 7 * level * this.player.stats.damageMul;
    this.forEachTarget(function (e) {
      if (e === from || hits >= max) return;
      var d = Math.hypot(e.x - from.x, e.z - from.z);
      if (d < 5.5) {
        hits++;
        self.damageEnemy(e, dmg, { silent: true, type: 'chain' });
        self.damageNumber(e.x, e.y + 1.3, e.z, dmg, false);
        self.spawnParticles(e.x, e.y + 0.9, e.z, 4, [0.6, 0.9, 1], { speed: 3, up: 2, life: 0.3, size: 0.1, prim: 'sphere' });
      }
    });
    if (hits) EH.Audio.play('crit');
  };

  W.onEnemyKilled = function (e, silent) {
    this.kills++;
    if (e.elite) this.eliteKills++;
    if (this.game.run) { this.game.run.kills++; if (e.elite) this.game.run.eliteKills++; }
    var st = this.player.stats;
    if (!silent) EH.Audio.play('enemyDeath');
    // death pop: chunky burst + expanding ring + kick
    this.spawnParticles(e.x, e.y + 0.8, e.z, 12, [0.65, 0.95, 1],
      { speed: 8, up: 4.5, life: 0.75, size: 0.26 });
    this.addField(e.x, e.z, 1.9, 0.34, 0, [0.5, 0.9, 1], 'wave');
    this.punch(0.035, 0.075);
    this.player.chargeUlt(4);
    // ember: burning enemies explode
    if (st.burstOnBurnDeath > 0 && e.burn > 0) {
      var r = 2.2 + st.burstOnBurnDeath * 0.4;
      this.shockDamage(e.x, e.z, r, 14 * st.burstOnBurnDeath * st.damageMul, 'playerFire');
      this.spawnParticles(e.x, 0.6, e.z, 16, [1, 0.5, 0.15], { speed: 6, up: 3, life: 0.6, size: 0.16 });
    }
    // void: shield on kill
    if (st.killShield > 0) {
      this.player.shieldHp = (this.player.shieldHp || 0) + 6 * st.killShield;
      this.player.shieldTime = 3.0;
    }
    // elite split
    if (e.elite === 'split' && !e._split) {
      var d = EH.ELITES.split;
      for (var i = 0; i < d.splitN; i++) {
        var a = Math.random() * Math.PI * 2;
        var c = this.spawnEnemy(d.splitInto, e.x + Math.cos(a) * 1.2, e.z + Math.sin(a) * 1.2, null, true);
        if (c) { c._split = true; c.maxHp *= 0.5; c.hp = c.maxHp; c.scale = 0.8; }
      }
    }
    // time shards drop
    if (this.game.run) this.game.run.shards += 2 + (e.elite ? 5 : 0);
  };

  W.onBossKilled = function (b) {
    EH.Audio.play('bossDeath');
    this.shakeCam(0.5);
    this.game.onBossDefeated();
  };

  // ---------- area damage ----------
  W.shockDamage = function (x, z, r, dmg, type) {
    var toPlayer = type.indexOf('player') !== 0;
    if (toPlayer) {
      var d = Math.hypot(this.player.x - x, this.player.z - z);
      if (d < r + this.player.radius) this.damagePlayer(dmg, type === 'blast' ? 'blast' : 'field', x, z);
    } else {
      var self = this;
      this.forEachTarget(function (e) {
        var dd = Math.hypot(e.x - x, e.z - z);
        if (dd < r + e.radius) self.damageEnemy(e, dmg, { fromX: x, fromZ: z, kb: 3, weight: 1.2 });
      });
    }
  };
  W.shockwave = function (x, z, r, delay, friendly) {
    this.addField(x, z, r, 0.45, 0, friendly ? [1, 0.35, 0.4] : [1, 0.5, 0.3], 'wave');
    if (friendly) {
      var self = this;
      this.forEachTarget(function (e) {
        var d = Math.hypot(e.x - x, e.z - z);
        if (d < r) {
          var kx = e.x - x, kz = e.z - z, kl = Math.hypot(kx, kz) || 1;
          e.knockX += kx / kl * 12; e.knockZ += kz / kl * 12;
        }
      });
    }
  };
  W.delayedBlast = function (x, z, r, delay, dmg, type) {
    this.telegraph('circle', x, z, r, 0, delay, [1, 0.35, 0.3], true);
    this._pending = this._pending || [];
    this._pending.push({ x: x, z: z, r: r, t: delay, dmg: dmg, type: type });
  };

  // ---------- player melee ----------
  W.meleeSwing = function (p, step) {
    var self = this, st = p.stats;
    var base = this.wdmg(p) * step.dmg;
    var hitAny = false;
    var trail = EH.WEAPONS[p.weapon].trail;
    // ---- the swing itself is always drawn, so the player can read the attack ----
    var steps = 9, reach = step.reach * 0.86;
    for (var i = 0; i < steps; i++) {
      var t = i / (steps - 1);
      var ang0 = p.facing + (t - 0.5) * step.arc;
      this.spawnParticles(p.x + Math.sin(ang0) * reach, 1.0, p.z + Math.cos(ang0) * reach, 1,
        trail, { speed: 0.5, up: 0.4, life: 0.20 + t * 0.06, size: 0.24, grav: -1.2, prim: 'sphere' });
    }
    this.forEachTarget(function (e) {
      var dx = e.x - p.x, dz = e.z - p.z;
      var d = Math.hypot(dx, dz);
      if (d > step.reach + e.radius + 0.25) return;               // slightly forgiving reach
      var ang = Math.atan2(dx, dz);
      if (angDiff(ang, p.facing) > step.arc * 0.5 + 0.18) return; // slightly forgiving arc
      var r = self.computeHit(base, e);
      self.damageEnemy(e, r.dmg, { crit: r.crit, fromX: p.x, fromZ: p.z, kb: step.kb, weight: step.dmg });
      // unmistakable contact: white spark burst + ground flash at the impact point
      var ix = p.x + (e.x - p.x) * 0.72, iz = p.z + (e.z - p.z) * 0.72;
      self.spawnParticles(ix, 1.0, iz, 5, [1, 1, 0.92],
        { speed: 8, up: 2.6, life: 0.24, size: 0.30, grav: -6, prim: 'shard' });
      self.addField(ix, iz, 0.85, 0.18, 0, [1, 0.95, 0.8], 'wave');
      hitAny = true;
    });
    if (hitAny && p.weapon === 'chaingaunt') {
      var ramp = EH.WEAPONS.chaingaunt.ramp;
      p.ramp = Math.min(ramp.max, p.ramp + ramp.perHit);
      p.rampT = ramp.decay;
    } else if (!hitAny && p.weapon === 'chaingaunt') { p.ramp = 0; }
  };
  W.wdmg = function (p) { return EH.WEAPONS[p.weapon].dmg * p.stats.damageMul; };

  W.swordSkill = function (p) {
    var s = EH.WEAPONS.riftsword.skill, self = this;
    var base = this.wdmg(p) * s.dmg;
    var sx = Math.sin(p.facing), sz = Math.cos(p.facing);
    this.forEachTarget(function (e) {
      var dx = e.x - p.x, dz = e.z - p.z;
      var along = dx * sx + dz * sz;
      var perp = Math.abs(dx * sz - dz * sx);
      if (along > -0.5 && along < s.reach && perp < s.width + e.radius) {
        var r = self.computeHit(base, e);
        self.damageEnemy(e, r.dmg, { crit: r.crit, fromX: p.x, fromZ: p.z, kb: s.kb, weight: 2 });
        if (p.stats.skillBurst > 0) self.shockDamage(e.x, e.z, 2.2, 12 * p.stats.skillBurst * p.stats.damageMul, 'playerFire');
      }
    });
    // dense bright slash sweeping down the whole reach
    var col = [0.5, 1, 1];
    for (var i = 0; i < 22; i++) {
      var d = (i / 21) * s.reach;
      this.spawnParticles(p.x + sx * d, 0.9, p.z + sz * d, 1, col,
        { speed: 3.0, up: 1.4, life: 0.5, size: 0.34, prim: 'shard', grav: -2 });
    }
    // rift crack decal running forward + tip explosion
    this.addField(p.x + sx * s.reach * 0.5, p.z + sz * s.reach * 0.5, s.reach, 0.35, 0, col, 'wave');
    this.skillImpact(p.x + sx * s.reach * 0.7, p.z + sz * s.reach * 0.7, col, true);
  };
  W.bowSkill = function (p) {
    var s = EH.WEAPONS.pulsebow.skill;
    var sx = Math.sin(p.facing), sz = Math.cos(p.facing);
    this.fire({
      x: p.x + sx * 0.6, z: p.z + sz * 0.6, y: 1.05,
      vx: sx * s.speed, vz: sz * s.speed, r: 0.6,
      dmg: this.wdmg(p) * s.dmg, fromPlayer: true, life: s.life,
      pierce: 99, color: [0.6, 1, 0.85], kind: 'beam'
    });
    // muzzle flash + recoil kick backward
    this.spawnParticles(p.x + sx * 0.8, 1.05, p.z + sz * 0.8, 12, [0.7, 1, 0.9],
      { speed: 7, up: 1.5, life: 0.3, size: 0.22 });
    p.knockX -= sx * 3; p.knockZ -= sz * 3;
    this.hitStop = Math.max(this.hitStop, 0.10);
    this.shakeCam(0.28);
  };
  W.gauntSkill = function (p) {
    var s = EH.WEAPONS.chaingaunt.skill, self = this;
    var sx = Math.sin(p.facing), sz = Math.cos(p.facing);
    var base = this.wdmg(p) * s.dmg;
    p.dashDirX = sx; p.dashDirZ = sz;
    var steps = 8, dist = s.dist / steps;
    var hitIds = {};
    for (var i = 0; i < steps; i++) {
      var cx = p.x + sx * dist * i, cz = p.z + sz * dist * i;
      this.forEachTarget(function (e) {
        if (hitIds[e.id]) return;
        if (Math.hypot(e.x - cx, e.z - cz) < s.radius + e.radius) {
          hitIds[e.id] = 1;
          var r = self.computeHit(base, e);
          self.damageEnemy(e, r.dmg, { crit: r.crit, fromX: cx, fromZ: cz, kb: s.kb, weight: 1.6 });
        }
      });
    }
    // launch shock + charge trail
    this.addField(p.x, p.z, 1.8, 0.35, 0, [1, 0.7, 0.35], 'wave');
    for (var t2 = 0; t2 < 8; t2++) {
      this.spawnParticles(p.x + sx * s.dist * (t2 / 8), 0.6, p.z + sz * s.dist * (t2 / 8), 1,
        [1, 0.7, 0.35], { speed: 2, up: 1.2, life: 0.4, size: 0.26, prim: 'shard' });
    }
    p.x = EH.clamp(p.x + sx * s.dist, -this.half + p.radius, this.half - p.radius);
    p.z = EH.clamp(p.z + sz * s.dist, -this.half + p.radius, this.half - p.radius);
    p.iframes = Math.max(p.iframes, 0.3);
    this.skillImpact(p.x, p.z, [1, 0.65, 0.3], true);   // slam at the end of the charge
  };

  W.ultStrike = function (p, i, u) {
    var self = this, base = this.wdmg(p) * u.dmg;
    var tint = p.ultTint || [0.6, 1, 1];
    if (p.weapon === 'riftsword') {
      var a = i * 0.9, r = 1.6 + (i % 3) * 0.9;
      var x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      this.shockDamageEnemies(x, z, 2.1, base, 1.4);
      this.addField(x, z, 1.9, 0.32, 0, tint, 'wave');           // visible slash ring each strike
      this.spawnParticles(x, 0.9, z, 14, tint, { speed: 7, up: 4, life: 0.45, size: 0.2 });
      this.spawnParticles(x, 1.1, z, 4, [1, 1, 1], { speed: 4, up: 3, life: 0.3, size: 0.13 });
    } else if (p.weapon === 'pulsebow') {
      var t = this.pickUltTarget(i, u.radius);
      this.shockDamageEnemies(t.x, t.z, 1.9, base, 1.2);
      this.addField(t.x, t.z, 1.7, 0.3, 0, tint, 'wave');
      this.spawnParticles(t.x, 1.6, t.z, 16, tint, { speed: 3, up: -6, life: 0.4, size: 0.18, grav: -20 });
      this.spawnParticles(t.x, 0.2, t.z, 8, [1, 1, 1], { speed: 6, up: 2, life: 0.4, size: 0.15 });
    } else {
      var rr = 2.0 + i * 1.8;
      this.shockDamageEnemies(p.x, p.z, rr, base, 2.0);
      this.addField(p.x, p.z, rr, 0.45, 0, tint, 'wave');
      this.spawnParticles(p.x, 0.5, p.z, 18, tint, { speed: 9, up: 4, life: 0.5, size: 0.22 });
      this.shakeCam(0.24);
    }
    // rhythmic screen surge + kick so every strike lands
    if (this.game.ultFlash && (i % 2 === 0)) this.game.ultFlash(tint, 0.55);
    this.shakeCam(0.12);
  };
  W.shockDamageEnemies = function (x, z, r, dmg, weight) {
    var self = this;
    this.forEachTarget(function (e) {
      if (Math.hypot(e.x - x, e.z - z) < r + e.radius) {
        var res = self.computeHit(dmg, e);
        self.damageEnemy(e, res.dmg, { crit: res.crit, fromX: x, fromZ: z, kb: 2, weight: weight || 1 });
      }
    });
  };
  W.pickUltTarget = function (i, radius) {
    var best = null;
    this.forEachTarget(function (e) { if (!best || Math.random() < 0.4) best = e; });
    if (best) return { x: best.x, z: best.z };
    var a = i * 1.3;
    return { x: this.player.x + Math.cos(a) * 2.5, z: this.player.z + Math.sin(a) * 2.5 };
  };

  // ---------- damage to player ----------
  W.damagePlayer = function (amount, type, sx, sz) {
    var p = this.player;
    if (p.dead || p.iframes > 0 || this.game.runOver) return;
    var save = this.game.save.data;
    var dmg = EH.Prog.mitigate(save, amount, type);
    // absorb with void shield first
    if (p.shieldHp > 0) {
      var a = Math.min(p.shieldHp, dmg);
      p.shieldHp -= a; dmg -= a;
      this.spawnParticles(p.x, 1.1, p.z, 5, [0.6, 0.8, 1], { speed: 3, up: 2, life: 0.3, size: 0.12, prim: 'sphere' });
    }
    if (dmg <= 0) return;
    p.hp -= dmg;
    p.lastDamageType = type;
    p.iframes = 0.6;
    p.flash = 1;
    p.chargeUlt(3);
    this.combo = 0;
    if (sx != null) {
      var kx = p.x - sx, kz = p.z - sz, kl = Math.hypot(kx, kz) || 1;
      p.knockX += kx / kl * 4; p.knockZ += kz / kl * 4;
    }
    this.damageNumber(p.x, 1.6, p.z, dmg, false);
    this.spawnParticles(p.x, 1.0, p.z, 8, [1, 0.35, 0.35], { speed: 4, up: 2.5, life: 0.45, size: 0.12 });
    this.shakeCam(0.16);
    this.game.vibrate(35);
    if (this.game.hurtFlash) this.game.hurtFlash();
    EH.Audio.play('hurt');
    if (p.state !== 'dash' && p.atkPhase === '') p.setState('hit');
    if (p.hp <= 0) {
      p.hp = 0;
      if (p.cores > 0) p.revive();
      else this.killPlayer(type);
    }
  };
  W.killPlayer = function (type) {
    var p = this.player;
    if (p.dead) return;               // no duplicate death handling
    p.dead = true; p.hp = 0; p.setState('death');
    p.dissolve = 0.01;
    EH.Audio.play('playerDeath');
    this.shakeCam(0.4);
    this.game.vibrate(120);
    this.game.onPlayerDeath(type || p.lastDamageType || 'melee');
  };

  // ---------- world step ----------
  W.update = function (dt) {
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);            // a stall must never teleport the world
    this.time += dt;
    var realDt = dt;
    if (this.hitStopCd > 0) this.hitStopCd = Math.max(0, this.hitStopCd - realDt);
    // 0.12 was a near-total freeze; 0.30 still reads as impact but keeps the
    // game moving underneath it
    if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - realDt); dt *= 0.30; }
    if (this.slowmoT > 0) { this.slowmoT = Math.max(0, this.slowmoT - realDt); dt *= 0.42; }
    var p = this.player;
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    if (p.shieldTime > 0) { p.shieldTime -= dt; if (p.shieldTime <= 0) p.shieldHp = 0; }

    // enemies
    for (var i = this.enemies.length - 1; i >= 0; i--) {
      var e = this.enemies[i];
      e.update(dt, p);
      if (e.blinkTo) {
        e.blinkTo.t -= dt;
        if (e.blinkTo.t <= 0) { e.x = e.blinkTo.x; e.z = e.blinkTo.z; e.blinkTo = null; }
      }
      if (!e.alive) { this.enemies.splice(i, 1); continue; }
      // contact damage
      if (!e.dying && e.def.touch && !p.dead) {
        var d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < e.radius + p.radius) {
          if (e.def.ai !== 'charger' || e.state === 'attack') {
            this.damagePlayer(e.def.dmg * e.dmgMul * (e.state === 'attack' ? 1 : 0.5), 'melee', e.x, e.z);
          }
        }
      }
    }
    // separation between enemies (avoid stacking / getting stuck)
    for (var a = 0; a < this.enemies.length; a++) {
      var ea = this.enemies[a]; if (ea.dying) continue;
      for (var b = a + 1; b < this.enemies.length; b++) {
        var eb = this.enemies[b]; if (eb.dying) continue;
        var dx = eb.x - ea.x, dz = eb.z - ea.z, dd = Math.hypot(dx, dz);
        var min = ea.radius + eb.radius;
        if (dd < min && dd > 0.0001) {
          var push = (min - dd) * 0.5, ux = dx / dd, uz = dz / dd;
          ea.x -= ux * push; ea.z -= uz * push;
          eb.x += ux * push; eb.z += uz * push;
          this.confine(ea); this.confine(eb);   // separation must stay inside the arena
        }
      }
    }
    // boss
    if (this.boss && this.boss.alive) {
      this.boss.update(dt, p);
      this.clampToRoom(this.boss);
      if (this.boss.dying && this.boss.deathT > 3.2) this.boss.alive = false;
      if (!this.boss.dying && !p.dead) {
        var bd = Math.hypot(p.x - this.boss.x, p.z - this.boss.z);
        if (bd < this.boss.radius + p.radius) {
          this.damagePlayer(this.boss.def.contactDmg * this.boss.dmgMul * dt * 2.2, 'boss', this.boss.x, this.boss.z);
        }
      }
    }
    this.updateProjectiles(dt);
    this.updateFields(dt);
    this.updateTelegraphs(dt);
    this.updateParticles(dt);
    this.updateNumbers(dt);
    // pending delayed blasts
    if (this._pending) {
      for (var q = this._pending.length - 1; q >= 0; q--) {
        var pb = this._pending[q];
        pb.t -= dt;
        if (pb.t <= 0) {
          this.shockDamage(pb.x, pb.z, pb.r, pb.dmg, pb.type);
          this.spawnParticles(pb.x, 0.4, pb.z, 10, [1, 0.4, 0.3], { speed: 5, up: 3, life: 0.5, size: 0.14 });
          this._pending.splice(q, 1);
        }
      }
    }
    if (this.shake > 0) { this.game.cam.shake(this.shake); this.shake = 0; }
    // last line of defence: repair any non-finite state before it is rendered
    // or fed back into next frame's physics
    this.sanitize();
  };

  W.updateProjectiles = function (dt) {
    var self = this, p = this.player, half = this.half + 2;
    this.projectiles.each(function (pr) {
      pr.life -= dt;
      if (pr.kind === 'homing' && !p.dead) {
        var hx = p.x - pr.x, hz = p.z - pr.z, hl = Math.hypot(hx, hz) || 1;
        var sp = Math.hypot(pr.vx, pr.vz);
        pr.vx += (hx / hl * sp - pr.vx) * Math.min(1, 1.1 * dt);
        pr.vz += (hz / hl * sp - pr.vz) * Math.min(1, 1.1 * dt);
      }
      pr.x += pr.vx * dt; pr.z += pr.vz * dt;
      pr.spin += dt * 8;

      // Ember trail. Emitted on a timer rather than per frame: at 120fps a
      // per-frame emitter doubles the particle count for the same visual, and
      // particles are the one thing here that scales with framerate.
      if (pr.kind === 'slug' || pr.kind === 'pellet') {
        pr.trailT = (pr.trailT || 0) - dt;
        if (pr.trailT <= 0) {
          pr.trailT = 0.032;
          self.spawnParticles(pr.x, pr.y, pr.z, 1, pr.color,
            { speed: 0.5, up: 0.3, life: 0.26, size: pr.r * 0.75, prim: 'sphere' });
        }
      }

      if (pr.life <= 0 || pr.x < -half || pr.x > half || pr.z < -half || pr.z > half) { pr.alive = false; return; }
      if (pr.fromPlayer) {
        self.forEachTarget(function (e) {
          if (!pr.alive) return;
          if (pr.hitIds && pr.hitIds[e.id]) return;
          if (Math.hypot(e.x - pr.x, e.z - pr.z) < e.radius + pr.r) {
            var r = self.computeHit(pr.dmg, e);
            self.damageEnemy(e, r.dmg, { crit: r.crit, fromX: pr.x, fromZ: pr.z, kb: 2, weight: 1 });
            self.spawnParticles(pr.x, pr.y, pr.z, 5, pr.color, { speed: 3, up: 1.5, life: 0.3, size: 0.1, prim: 'sphere' });
            if (pr.pierce > 0) { pr.pierce--; pr.hitIds = pr.hitIds || {}; pr.hitIds[e.id] = 1; }
            else pr.alive = false;
          }
        });
      } else if (!p.dead && p.iframes <= 0) {
        if (Math.hypot(p.x - pr.x, p.z - pr.z) < p.radius + pr.r) {
          self.damagePlayer(pr.dmg, 'projectile', pr.x, pr.z);
          // enemy rounds used to simply vanish on contact - the hit read as the
          // projectile despawning rather than as an impact
          self.spawnParticles(pr.x, pr.y, pr.z, 9, pr.color,
            { speed: 5.5, up: 2.2, life: 0.32, size: 0.12, prim: 'sphere' });
          pr.alive = false;
        }
      }
    });
  };

  W.updateFields = function (dt) {
    var self = this, p = this.player;
    this.fields.each(function (f) {
      f.t += dt;
      if (f.t >= f.dur) { f.alive = false; return; }
      if (f.dps > 0) {
        f.tick -= dt;
        if (f.tick <= 0) {
          f.tick = 0.4;
          if (f.type === 'playerFire') {
            self.forEachTarget(function (e) {
              if (Math.hypot(e.x - f.x, e.z - f.z) < f.r + e.radius) {
                self.damageEnemy(e, f.dps * 0.4, { silent: true });
                self.damageNumber(e.x, e.y + 1.2, e.z, f.dps * 0.4, false);
              }
            });
          } else {
            if (Math.hypot(p.x - f.x, p.z - f.z) < f.r + p.radius) self.damagePlayer(f.dps * 0.4, 'field', f.x, f.z);
          }
        }
      }
      if (f.type === 'slow') {
        if (Math.hypot(p.x - f.x, p.z - f.z) < f.r) p.slowed = 0.15;
      }
    });
  };

  W.updateTelegraphs = function (dt) {
    this.telegraphs.each(function (t) {
      t.t += dt;
      if (t.t >= t.dur) t.alive = false;
    });
  };
  W.updateParticles = function (dt) {
    this.particles.each(function (p) {
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; return; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      if (p.y < 0.03) { p.y = 0.03; p.vy *= -0.28; p.vx *= 0.7; p.vz *= 0.7; }
    });
  };
  W.updateNumbers = function (dt) {
    this.numbers.each(function (n) {
      n.life -= dt;
      if (n.life <= 0) { n.alive = false; return; }
      n.y += n.vy * dt; n.vy -= 5 * dt;
    });
  };
})();
