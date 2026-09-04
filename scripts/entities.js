'use strict';
// World + entities: player, 6 enemy AIs, 3-phase boss, projectiles, pooled FX.
// Movement/collision uses 2D circles on the ground plane; rendering is full 3D.
(function () {
  var EH = window.EchoHeart;
  var C = null;

  // ---------------- pools ----------------
  function Pool(factory, max) { this.items = []; this.factory = factory; this.max = max; }
  Pool.prototype.get = function () {
    for (var i = 0; i < this.items.length; i++) if (!this.items[i].alive) return this.items[i];
    if (this.items.length >= this.max) return null;
    var o = this.factory(); this.items.push(o); return o;
  };
  // The configured ceiling, not items.length - the pool allocates lazily, so
  // items.length is merely the high-water mark and comparing a peak against it
  // would always look like 100% usage.
  Pool.prototype.capacity = function () { return this.max; };
  Pool.prototype.each = function (fn) {
    for (var i = 0; i < this.items.length; i++) if (this.items[i].alive) fn(this.items[i], i);
  };
  Pool.prototype.clear = function () { for (var i = 0; i < this.items.length; i++) this.items[i].alive = false; };
  Pool.prototype.count = function () { var n = 0; for (var i = 0; i < this.items.length; i++) if (this.items[i].alive) n++; return n; };

  // ---------------- world ----------------
  function World(game) {
    C = EH.CONFIG;
    this.game = game;
    this.enemies = [];
    this.boss = null;
    this.player = null;
    this.time = 0;
    this.hitStop = 0;
    this.hitStopCd = 0;
    this.slowmoT = 0;        // was only ever assigned by startUlt -> undefined
                             // arithmetic elsewhere produced NaN
    this.sanitizedCount = 0;
    this.half = C.floorHalf;
    this.projectiles = new Pool(function () { return new Projectile(); }, 260);
    // 480, not 320: projectile trails are a constant background draw on the
    // pool, and an exhausted pool fails silently - hit sparks and death bursts
    // just stop appearing, which reads as the game glitching rather than as a
    // budget being hit. They all render in one batched call regardless.
    this.particles = new Pool(function () { return new Particle(); }, 480);
    this.numbers = new Pool(function () { return { alive: false, x: 0, y: 0, z: 0, v: 0, crit: false, life: 0, vy: 0 }; }, 60);
    this.telegraphs = new Pool(function () { return new Telegraph(); }, 60);
    this.fields = new Pool(function () { return new Field(); }, 40);
    this.trail = [];
    this.combo = 0; this.comboTimer = 0; this.maxCombo = 0;
    this.kills = 0; this.eliteKills = 0;
    this.shake = 0;
  }
  World.prototype.reset = function () {
    this.enemies.length = 0; this.boss = null;
    this.projectiles.clear(); this.particles.clear(); this.numbers.clear();
    this.telegraphs.clear(); this.fields.clear();
    this.trail.length = 0; this.combo = 0; this.comboTimer = 0; this.hitStop = 0;
    this.hitStopCd = 0; this.slowmoT = 0;
  };
  World.prototype.aliveEnemies = function () {
    var n = 0;
    for (var i = 0; i < this.enemies.length; i++) if (this.enemies[i].alive && !this.enemies[i].dying) n++;
    if (this.boss && this.boss.alive && !this.boss.dying) n++;
    return n;
  };
  // The arena is a RING of walls (rooms.js places them on a circle), so the
  // bound has to be circular too. It used to be a square clamp, which let you
  // reach half*sqrt(2) ~= 12.7 on the diagonal while the wall ring sits at 9.6
  // - dashing toward a corner visibly punched through the wall and back.
  World.prototype.clampToRoom = function (e) {
    var r = this.half - e.radius;
    if (r < 0.1) r = 0.1;
    var d2 = e.x * e.x + e.z * e.z;
    if (d2 <= r * r) return false;
    var d = Math.sqrt(d2);
    if (d < 1e-6) { e.x = r; e.z = 0; return true; }
    var k = r / d;
    e.x *= k; e.z *= k;
    // kill the outward part of velocity/knockback so actors slide along the
    // wall instead of grinding into it
    var nx = e.x / r, nz = e.z / r;
    var vOut = e.vx * nx + e.vz * nz;
    if (vOut > 0) { e.vx -= nx * vOut; e.vz -= nz * vOut; }
    var kOut = (e.knockX || 0) * nx + (e.knockZ || 0) * nz;
    if (kOut > 0) { e.knockX -= nx * kOut; e.knockZ -= nz * kOut; }
    return true;
  };
  // push an actor out of solid props (pillars, gears, forges, altars, devices)
  World.prototype.resolveProps = function (e) {
    var props = this.game.room && this.game.room.props;
    if (!props) return;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (!p.col) continue;
      var dx = e.x - p.x, dz = e.z - p.z;
      var min = p.col + e.radius;
      var d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      var d = Math.sqrt(d2);
      if (d < 1e-4) { e.x = p.x + min; continue; }
      var k = (min - d) / d;
      e.x += dx * k; e.z += dz * k;
    }
  };
  // single place that guarantees an actor is legal: props first, then walls
  World.prototype.confine = function (e) {
    this.resolveProps(e);
    return this.clampToRoom(e);      // true when the actor hit the arena ring
  };

  // ---------------- effects helpers ----------------
  World.prototype.spawnParticles = function (x, y, z, n, color, opts) {
    opts = opts || {};
    if (EH.Settings.get('lowSpec')) n = Math.max(1, Math.floor(n * 0.5));
    // the perf governor also thins effects out on a struggling device
    var pf = this.game && this.game.perf;
    if (pf && pf.scale < 0.99) n = Math.max(1, Math.floor(n * (0.35 + pf.scale * 0.65)));
    for (var i = 0; i < n; i++) {
      var p = this.particles.get(); if (!p) return;
      var a = Math.random() * Math.PI * 2, sp = (opts.speed || 3) * (0.4 + Math.random() * 0.8);
      p.alive = true; p.x = x; p.y = y; p.z = z;
      p.vx = Math.cos(a) * sp * (opts.dirX || 1) + (opts.vx || 0);
      p.vy = (opts.up == null ? 3 : opts.up) * (0.3 + Math.random());
      p.vz = Math.sin(a) * sp * (opts.dirZ || 1) + (opts.vz || 0);
      p.life = p.maxLife = (opts.life || 0.6) * (0.6 + Math.random() * 0.7);
      p.size = (opts.size || 0.12) * (0.5 + Math.random());
      p.color = color; p.grav = opts.grav == null ? -9 : opts.grav;
      p.prim = opts.prim || 'shard';
      p.spin = Math.random() * 6; p.rot = Math.random() * 6;
    }
  };
  World.prototype.damageNumber = function (x, y, z, v, crit, matchup) {
    if (!EH.Settings.get('damageNumbers')) return;
    var n = this.numbers.get(); if (!n) return;
    n.alive = true; n.x = x; n.y = y; n.z = z;
    n.v = Math.round(isFinite(v) ? v : 0); n.crit = crit;
    n.matchup = matchup || 0;          // +1 strong / -1 weak -> coloured feedback
    n.life = 0.85; n.vy = 2.4;
  };
  World.prototype.MAX_TELEGRAPHS = 3;   // more than this on screen is unreadable
  World.prototype.activeTelegraphs = function () {
    var n = 0;
    this.telegraphs.each(function () { n++; });
    return n;
  };
  // priority = boss / lethal attacks always get shown; chaff attacks yield
  World.prototype.telegraph = function (kind, x, z, a, b, dur, color, priority) {
    if (!priority && this.activeTelegraphs() >= this.MAX_TELEGRAPHS) return null;
    var t = this.telegraphs.get(); if (!t) return null;
    t.alive = true; t.kind = kind; t.x = x; t.z = z; t.a = a; t.b = b;
    t.t = 0; t.dur = dur; t.color = color || [1, 0.3, 0.25];
    return t;
  };
  World.prototype.addField = function (x, z, r, dur, dps, color, type) {
    var f = this.fields.get(); if (!f) return null;
    f.alive = true; f.x = x; f.z = z; f.r = r; f.t = 0; f.dur = dur;
    f.dps = dps; f.color = color || [1, 0.5, 0.1]; f.type = type || 'field'; f.tick = 0;
    return f;
  };
  World.prototype.shakeCam = function (a) {
    if (!isFinite(a)) return;
    this.shake = Math.max(this.shake, a);
  };

  // ---------------- integrity sweep ----------------
  // A single NaN (bad division, zero-length normalise, corrupt save) would
  // otherwise propagate through positions and permanently freeze an actor
  // off-screen. Sweeping every frame keeps one bad value from becoming a
  // broken run; sanitized() reports so tests can assert it never fires.
  var NUM_FIELDS = ['x', 'y', 'z', 'vx', 'vz', 'facing', 'hp', 'knockX', 'knockZ'];

  function fixActor(a, w) {
    var bad = 0, i, f, v;
    for (i = 0; i < NUM_FIELDS.length; i++) {
      f = NUM_FIELDS[i]; v = a[f];
      if (v == null) continue;
      if (typeof v !== 'number' || !isFinite(v)) {
        bad++;
        (w._sanLog || (w._sanLog = [])).push((a.kind || 'player') + '.' + f);
        a[f] = (f === 'hp') ? Math.max(1, a.maxHp || 1) : 0;
      }
    }
    // circular bound, matching the wall ring
    var lim = (w.half || 40) + 3;
    var tag = (a.kind || 'player');
    var dd = Math.sqrt(a.x * a.x + a.z * a.z);
    if (dd > lim) {
      (w._sanLog || (w._sanLog = [])).push(tag + '.oob');
      var kk = lim / (dd || 1); a.x *= kk; a.z *= kk; bad++;
    }
    if (a.maxHp && a.hp > a.maxHp) a.hp = a.maxHp;
    return bad;
  }

  World.prototype.sanitize = function () {
    var bad = 0, i;
    var tags = (this._sanLog || (this._sanLog = []));
    if (this.player) bad += fixActor(this.player, this);
    for (i = 0; i < this.enemies.length; i++) bad += fixActor(this.enemies[i], this);
    if (this.boss) bad += fixActor(this.boss, this);
    this.projectiles.each(function (p) {
      if (!isFinite(p.x) || !isFinite(p.z) || !isFinite(p.vx) || !isFinite(p.vz) ||
          !isFinite(p.dmg) || !isFinite(p.life)) { p.alive = false; bad++; tags.push('proj'); }
    });
    this.particles.each(function (p) {
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) || !isFinite(p.life)) {
        p.alive = false; bad++; tags.push('particle');
      }
    });
    if (!isFinite(this.shake)) { (this._sanLog || (this._sanLog = [])).push('shake'); this.shake = 0; bad++; }
    if (!isFinite(this.hitStop)) { (this._sanLog || (this._sanLog = [])).push('hitStop'); this.hitStop = 0; bad++; }
    if (!isFinite(this.slowmoT)) { (this._sanLog || (this._sanLog = [])).push('slowmoT'); this.slowmoT = 0; bad++; }
    if (bad) {
      this.sanitizedCount = (this.sanitizedCount || 0) + bad;
      EH.warn('[sanitize]', bad, (this._sanLog || []).slice(0, 6).join(','));
      this._sanLog = null;
    }
    return bad;
  };

  // ---------------- projectile ----------------
  function Projectile() {
    this.alive = false; this.x = 0; this.y = 0.9; this.z = 0;
    this.vx = 0; this.vz = 0; this.r = 0.25; this.dmg = 0;
    this.fromPlayer = false; this.life = 0; this.pierce = 0; this.hitIds = null;
    this.color = [0.4, 1, 1]; this.kind = 'bolt'; this.spin = 0;
    this.rot = 0; this.trailT = 0;
  }
  World.prototype.fire = function (o) {
    var p = this.projectiles.get(); if (!p) return null;
    p.alive = true; p.x = o.x; p.y = o.y == null ? 0.95 : o.y; p.z = o.z;
    p.vx = o.vx; p.vz = o.vz; p.r = o.r || 0.25; p.dmg = o.dmg;
    p.fromPlayer = !!o.fromPlayer; p.life = o.life || 2;
    // pooled objects: clear every per-shot field, or a recycled slot keeps the
    // previous round's tumble and trail phase
    p.pierce = o.pierce || 0; p.hitIds = null; p.spin = 0; p.rot = 0; p.trailT = 0;
    p.color = o.color || (o.fromPlayer ? [0.5, 1, 0.9] : [1, 0.4, 0.35]);
    p.kind = o.kind || 'bolt';
    return p;
  };

  function Particle() { this.alive = false; }
  function Telegraph() { this.alive = false; }
  function Field() { this.alive = false; }

  // How long a skill/ultimate press is remembered when the player cannot act
  // yet (mid-swing, mid-dash). Standard action-game input buffering.
  var INPUT_BUFFER = 0.32;

  // ---------------- base actor ----------------
  function Actor(meshName) {
    this.x = 0; this.z = 0; this.y = 0; this.vx = 0; this.vz = 0;
    this.facing = 0; this.radius = 0.5; this.alive = true; this.dying = false;
    this.hp = 1; this.maxHp = 1; this.flash = 0; this.dissolve = 0;
    this.anim = new EH.Animator(meshName);
    this.mesh = meshName; this.state = 'idle'; this.stateTime = 0;
    this.root = EH.M.Mat4.create();
    this.scale = 1; this.knockX = 0; this.knockZ = 0;
    this.id = EH.uid();
  }
  Actor.prototype.setState = function (s) {
    if (this.state === s) return;
    this.state = s; this.stateTime = 0; this.anim.stateTime = 0;
  };
  Actor.prototype.baseUpdate = function (dt) {
    this.stateTime += dt; this.anim.stateTime += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.4);
    if (this.skillFlash > 0) this.skillFlash = Math.max(0, this.skillFlash - dt * 2.2);
    if (this.skillZoomT > 0) { this.skillZoomT -= dt; if (this.skillZoomT <= 0 && this.state !== 'ult') this.world.game.cam.setZoom(1); }
    // knockback decay
    this.x += this.knockX * dt; this.z += this.knockZ * dt;
    var k = Math.exp(-9 * dt);
    this.knockX *= k; this.knockZ *= k;
  };
  Actor.prototype.buildRoot = function () {
    var q = EH.M.Quat.fromEuler([0, 0, 0, 1], 0, this.facing, 0);
    EH.M.Mat4.fromRTS(this.root, q, [this.x, this.y, this.z], [this.scale, this.scale, this.scale]);
    return this.root;
  };

  // ---------------- player ----------------
  function Player(world) {
    var pm = (EH.CONFIG.playerMesh && EH.Meshes[EH.CONFIG.playerMesh]) ? EH.CONFIG.playerMesh : 'lian';
    Actor.call(this, pm);
    this.world = world;
    this.radius = C.playerRadius;
    this.weapon = 'riftsword';
    this.comboIdx = 0; this.comboWindow = 0; this.queued = false;
    this.aimTarget = null; this.aimMarkT = 0;
    this.bufSkill = 0; this.bufUlt = 0;
    this.atkPhase = ''; this.atkTimer = 0; this.atkDidHit = false;
    this.dashCd = 0; this.iframes = 0; this.dashTime = 0;
    this.skillCd = 0; this.ult = 0; this.ultActive = 0;
    this.cores = 1; this.reviving = 0; this.dead = false;
    this.hitCount = 0; this.rampT = 0; this.ramp = 0;
    this.trailPts = [];
    this.aimX = 0; this.aimZ = 1;
    this.lastDamageType = 'melee';
    this.invulnFromRevive = 0;
    this.burnTickers = {};
    this.skillFlash = 0; this.skillZoomT = 0;
  }
  Player.prototype = Object.create(Actor.prototype);
  Player.prototype.constructor = Player;

  Player.prototype.applyStats = function (stats) {
    this.stats = stats;
    this.maxHp = stats.maxHp;
    this.cores = stats.maxLifeCores;
    this.maxCores = stats.maxLifeCores;
  };
  Player.prototype.spawn = function (x, z) {
    this.x = x; this.z = z; this.y = 0; this.vx = this.vz = 0;
    this.hp = this.maxHp; this.dead = false; this.dying = false; this.alive = true;
    this.dissolve = 0; this.iframes = 0; this.dashCd = 0; this.skillCd = 0;
    this.ult = 0; this.ultActive = 0; this.comboIdx = 0; this.atkPhase = '';
    this.aimTarget = null; this.aimMarkT = 0;
    this.bufSkill = 0; this.bufUlt = 0;
    this.setState('idle');
  };
  // Skills and ultimates may cancel the recovery tail of a basic attack. Only
  // the wind-up and active frames are committed, so a queued skill lands
  // promptly instead of waiting out a long 3rd-hit recovery.
  Player.prototype.canCancelInto = function () {
    if (this.dead || this.state === 'dash' || this.state === 'hit' ||
        this.state === 'revive' || this.state === 'ult') return false;
    return this.atkPhase === '' || this.atkPhase === 'recover';
  };

  Player.prototype.wdata = function () { return EH.WEAPONS[this.weapon]; };

  Player.prototype.canAct = function () {
    return !this.dead && this.state !== 'dash' && this.state !== 'hit' &&
      this.state !== 'revive' && this.atkPhase === '' && this.state !== 'ult';
  };

  Player.prototype.nearestEnemy = function (maxDist) {
    var best = null, bd = maxDist * maxDist, w = this.world;
    for (var i = 0; i < w.enemies.length; i++) {
      var e = w.enemies[i]; if (!e.alive || e.dying) continue;
      var dx = e.x - this.x, dz = e.z - this.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = e; }
    }
    if (w.boss && w.boss.alive && !w.boss.dying) {
      var bx = w.boss.x - this.x, bz = w.boss.z - this.z, d2 = bx * bx + bz * bz;
      if (d2 < bd) best = w.boss;
    }
    return best;
  };

  // Pick the best auto-aim target: mostly nearest, with a mild bias toward
  // whatever we are already facing so a crowd does not make the pick jitter.
  Player.prototype.acquireTarget = function (maxDist) {
    var w = this.world, best = null, bestScore = Infinity, self = this;
    function consider(e) {
      if (!e || !e.alive || e.dying) return;
      var dx = e.x - self.x, dz = e.z - self.z;
      var dist = Math.hypot(dx, dz);
      if (dist > maxDist) return;
      var want = Math.atan2(dx, dz);
      var off = Math.abs(((want - self.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      var score = dist * (1 + 0.28 * (off / Math.PI));   // nearest wins, ties go to the front
      if (score < bestScore) { bestScore = score; best = e; }
    }
    for (var i = 0; i < w.enemies.length; i++) consider(w.enemies[i]);
    consider(w.boss);
    return best;
  };

  // Turn to face the target the instant an attack is committed. This is what
  // makes kiting work: you can run away and still land hits behind you.
  Player.prototype.snapAim = function (maxDist) {
    var strength = EH.Settings.get('autoAim');
    if (strength <= 0) return null;
    var t = this.acquireTarget(maxDist);
    if (!t) return null;
    var want = Math.atan2(t.x - this.x, t.z - this.z);
    var d = ((want - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.facing += d * Math.min(1, 0.35 + strength);   // full snap at the default 0.75
    this.aimTarget = t; this.aimMarkT = 0.35;
    return t;
  };

  // Soft tracking during the wind-up so a target that keeps moving still gets hit.
  Player.prototype.trackAim = function (dt, maxDist) {
    var strength = EH.Settings.get('autoAim');
    if (strength <= 0) return;
    var t = (this.aimTarget && this.aimTarget.alive && !this.aimTarget.dying)
      ? this.aimTarget : this.acquireTarget(maxDist);
    if (!t) return;
    this.aimTarget = t;
    var want = Math.atan2(t.x - this.x, t.z - this.z);
    var d = ((want - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.facing += d * Math.min(1, strength * 9 * dt);
  };

  Player.prototype.aimRange = function () { return this.wdata().ranged ? 14 : 5.5; };

  Player.prototype.update = function (dt, input) {
    this.baseUpdate(dt);
    var st = this.stats;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.skillCd > 0) this.skillCd -= dt;
    if (this.comboWindow > 0) this.comboWindow -= dt; else if (this.atkPhase === '') this.comboIdx = 0;
    if (this.rampT > 0) { this.rampT -= dt; if (this.rampT <= 0) this.ramp = 0; }

    if (this.dead) { this.updateDeath(dt); return; }
    if (this.state === 'revive') {
      this.reviving -= dt;
      if (this.reviving <= 0) this.setState('idle');
      this.buildRoot(); this.animate(dt); return;
    }

    var mv = Math.hypot(input.moveX, input.moveZ);
    // ---- dash ----
    if (input.take('dash') && this.dashCd <= 0 && !this.dead && this.state !== 'ult') {
      var dx = input.moveX, dz = input.moveZ;
      if (mv < 0.1) { dx = Math.sin(this.facing); dz = Math.cos(this.facing); }
      var dl = Math.hypot(dx, dz) || 1;
      this.dashDirX = dx / dl; this.dashDirZ = dz / dl;
      this.facing = Math.atan2(this.dashDirX, this.dashDirZ);
      this.setState('dash');
      this.dashTime = 0;
      this.dashCd = st.dashCooldown;
      this.iframes = Math.max(this.iframes, st.dashIFrames);
      this.atkPhase = '';
      EH.Audio.play('dash');
      this.world.game.vibrate(12);
      if (st.dashFlame > 0) this.world.addField(this.x, this.z, 1.0, 2.2, 6 * st.dashFlame, [1, 0.5, 0.15], 'playerFire');
    }
    if (this.state === 'dash') {
      this.dashTime += dt;
      var dur = st.dashDist / st.dashSpeed;
      if (this.dashTime < dur) {
        this.x += this.dashDirX * st.dashSpeed * dt;
        this.z += this.dashDirZ * st.dashSpeed * dt;
        this.world.spawnParticles(this.x, 0.85, this.z, 2, [0.45, 1, 1], { speed: 0.5, up: 0.3, life: 0.34, size: 0.42, grav: 0, prim: 'shard' });
        this.world.spawnParticles(this.x, 0.5, this.z, 1, [0.3, 0.85, 1], { speed: 0.3, up: 0.2, life: 0.3, size: 0.3, grav: 0, prim: 'sphere' });
      } else {
        if (st.dashShock > 0) {
          this.world.addField(this.x, this.z, 1.6, 0.5, 0, [0.5, 0.85, 1], 'playerShock');
          this.world.shockDamage(this.x, this.z, 1.9, 10 * st.dashShock, 'playerShock');
        }
        this.setState('idle');
      }
      // hitting the ring ends the dash instead of grinding along it
      if (this.world.confine(this)) {
        this.setState('idle');
        this.world.spawnParticles(this.x, 0.6, this.z, 6, [0.5, 0.9, 1],
          { speed: 4, up: 2, life: 0.28, size: 0.16 });
      }
      this.buildRoot(); this.animate(dt); return;
    }

    // ---- movement ----
    var speed = st.moveSpeed * (this.atkPhase ? 0.35 : 1) * (this.state === 'ult' ? 0.4 : 1);
    if (mv > 0.05) {
      this.vx = input.moveX * speed; this.vz = input.moveZ * speed;
      if (this.atkPhase === '' && this.state !== 'ult') this.facing = Math.atan2(input.moveX, input.moveZ);
    } else { this.vx *= Math.exp(-14 * dt); this.vz *= Math.exp(-14 * dt); }
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.world.confine(this);

    // ---- aim assist (idle drift toward the target while standing still) ----
    var aimStrength = EH.Settings.get('autoAim');
    if (this.aimMarkT > 0) this.aimMarkT -= dt;
    if (aimStrength > 0 && this.atkPhase === '' && mv < 0.05) {
      var tgt = this.acquireTarget(this.aimRange());
      if (tgt) {
        var want = Math.atan2(tgt.x - this.x, tgt.z - this.z);
        var d = ((want - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        this.facing += d * Math.min(1, aimStrength * 8 * dt);
      }
    }

    // ---- skill / ultimate ----
    // These are checked BEFORE the basic attack and their press is buffered.
    // Previously the attack ran first, set atkPhase and made canAct() false,
    // and then take('skill') consumed the press and threw it away - so while
    // holding attack (the normal way to play) a skill or ultimate never fired.
    if (input.take('skill')) this.bufSkill = INPUT_BUFFER;
    if (input.take('ult')) this.bufUlt = INPUT_BUFFER;
    if (this.bufSkill > 0) this.bufSkill -= dt;
    if (this.bufUlt > 0) this.bufUlt -= dt;
    if (this.bufSkill > 0 && this.skillCd <= 0 && this.canCancelInto()) {
      this.bufSkill = 0; this.atkPhase = '';      // cancel the recovery
      this.snapAim(this.aimRange() + 2); this.startSkill();
    }
    if (this.bufUlt > 0 && this.ult >= st.ultMax && this.canCancelInto()) {
      this.bufUlt = 0; this.atkPhase = '';
      this.snapAim(this.aimRange() + 3); this.startUlt();
    }
    if (this.state === 'ult') this.updateUlt(dt);

    // ---- attack ----
    var wantAttack = input.attackHeld || input.take('attackTap');
    if (wantAttack && this.canAct()) { this.snapAim(this.aimRange()); this.startAttack(); }
    else if (wantAttack && this.atkPhase === 'recover') this.queued = true;
    // keep tracking through the wind-up so moving targets still get hit
    if (this.atkPhase === 'wind') this.trackAim(dt, this.aimRange());
    this.updateAttack(dt);

    if (this.atkPhase === '' && this.state !== 'ult') {
      this.setState(mv > 0.05 ? 'run' : 'idle');
    }
    this.buildRoot(); this.animate(dt);
  };

  Player.prototype.chargeUlt = function (v) {
    var st = this.stats;
    this.ult = Math.min(st.ultMax, this.ult + v * st.ultChargeMul);
  };

  Player.prototype.startAttack = function () {
    var w = this.wdata();
    var steps = w.combo.length;
    var step = w.combo[this.comboIdx % steps];
    this.atkPhase = 'wind'; this.atkTimer = 0; this.atkDidHit = false;
    this.curStep = step;
    var spd = this.stats.attackSpeedMul * (1 + this.ramp);
    this.atkDurs = { wind: step.wind / spd, active: step.active / spd, rec: step.rec / spd };
    this.trailPts.length = 0;
    var idx = this.comboIdx % steps;
    if (this.weapon === 'riftsword') this.setState(['sword1', 'sword2', 'sword3'][Math.min(idx, 2)]);
    else if (this.weapon === 'pulsebow') this.setState('bowShoot');
    else this.setState(['gaunt1', 'gaunt2', 'gaunt3', 'gaunt4'][Math.min(idx, 3)]);
    this.animCtx = { dur: this.atkDurs.wind + this.atkDurs.active + this.atkDurs.rec };
  };

  Player.prototype.updateAttack = function (dt) {
    if (!this.atkPhase) return;
    this.atkTimer += dt;
    var w = this.wdata();
    if (this.atkPhase === 'wind' && this.atkTimer >= this.atkDurs.wind) {
      this.atkPhase = 'active'; this.atkTimer = 0;
      if (w.ranged) this.fireArrow();
      else {
        this.world.meleeSwing(this, this.curStep);
        EH.Audio.play(this.comboIdx % w.combo.length === w.combo.length - 1 ? 'comboFinish' : 'attack');
      }
    } else if (this.atkPhase === 'active' && this.atkTimer >= this.atkDurs.active) {
      this.atkPhase = 'recover'; this.atkTimer = 0;
    } else if (this.atkPhase === 'recover' && this.atkTimer >= this.atkDurs.rec) {
      this.atkPhase = ''; this.comboIdx++; this.comboWindow = 0.45;
      if (this.comboIdx >= w.combo.length) this.comboIdx = 0;
    }
  };

  Player.prototype.fireArrow = function () {
    var w = this.wdata(), st = this.stats;
    this.snapAim(14);                       // each bolt re-acquires -> kiting works
    var sx = Math.sin(this.facing), sz = Math.cos(this.facing);
    var sp = w.shot.speed * st.projectileSpeedMul;
    this.world.fire({
      x: this.x + sx * 0.6, z: this.z + sz * 0.6, y: 1.0,
      vx: sx * sp, vz: sz * sp, r: w.shot.radius,
      dmg: w.dmg * w.shot.dmg * st.damageMul, fromPlayer: true,
      life: w.shot.life, pierce: Math.random() < w.shot.pierceChance ? 1 : 0,
      color: [0.5, 1, 0.75], kind: 'arrow'
    });
    EH.Audio.play('bowShot');
  };

  Player.prototype.startSkill = function () {
    var w = this.wdata(), st = this.stats;
    this.skillCd = w.skill.cd * st.skillCooldownMul;
    this.atkPhase = ''; this.trailPts.length = 0;
    this.skillFlash = 1.0;                      // weapon/character glow surge
    this.skillZoomT = 0.5; this.world.game.cam.setZoom(0.9);   // punch-in
    EH.Audio.play('skill'); EH.Audio.play('comboFinish');      // layered = weightier
    this.world.game.vibrate(45);
    if (this.weapon === 'riftsword') {
      this.setState('swordSkill');
      this.world.swordSkill(this);
    } else if (this.weapon === 'pulsebow') {
      this.setState('bowSkill');
      this.world.bowSkill(this);
    } else {
      this.setState('gauntSkill');
      this.world.gauntSkill(this);
    }
  };

  Player.prototype.startUlt = function () {
    this.ult = 0; this.ultActive = 0; this.atkPhase = '';
    this.setState('ult');
    this.ultKind = this.weapon;
    this.ultTimer = 0;
    this.ultHits = 0;
    var w = this.world;
    var tint = this.weapon === 'riftsword' ? [0.45, 1, 1] : this.weapon === 'pulsebow' ? [0.5, 1, 0.7] : [1, 0.72, 0.32];
    this.ultTint = tint;
    EH.Audio.play('ult');
    w.game.vibrate(70);
    w.game.cam.setZoom(0.76);
    w.shakeCam(0.55);
    if (w.game.ultFlash) w.game.ultFlash(tint);   // tinted screen surge
    w.slowmoT = 0.7;                              // longer slow-motion punch
    // launch eruption: double shock ring + pillar of light + debris
    w.shockwave(this.x, this.z, 6.2, 0, true);
    w.addField(this.x, this.z, 3.4, 0.7, 0, tint, 'wave');
    w.addField(this.x, this.z, 5.2, 0.5, 0, tint, 'wave');
    w.spawnParticles(this.x, 1.0, this.z, 48, tint, { speed: 12, up: 7, life: 0.85, size: 0.24 });
    w.spawnParticles(this.x, 0.3, this.z, 26, [1, 1, 1], { speed: 8, up: 1.5, life: 0.6, size: 0.16 });
    w.spawnParticles(this.x, 0.5, this.z, 20, tint, { speed: 2, up: 10, life: 1.0, size: 0.22, grav: -3 });
  };
  Player.prototype.updateUlt = function (dt) {
    var w = this.wdata();
    this.ultTimer += dt;
    var u = w.ult;
    // periodic strikes over duration
    var per = u.dur / u.hits;
    while (this.ultHits < u.hits && this.ultTimer > this.ultHits * per) {
      this.world.ultStrike(this, this.ultHits, u);
      this.ultHits++;
    }
    if (this.ultTimer >= u.dur + 0.25) {
      this.setState('idle');
      this.world.game.cam.setZoom(1);
    }
  };

  Player.prototype.animate = function (dt) {
    var clips = EH.CLIPS.lian, fn = clips.idle, ctx = { speed: 1 };
    var s = this.state;
    if (s === 'ult') fn = clips[this.weapon === 'riftsword' ? 'swordUlt' : this.weapon === 'pulsebow' ? 'bowUlt' : 'gauntUlt'];
    else if (clips[s]) { fn = clips[s]; ctx = this.animCtx || ctx; }
    if (s === 'run') { fn = clips.run; ctx = { speed: EH.clamp(Math.hypot(this.vx, this.vz) / 4.4, 0.5, 1.5) }; }
    this.anim.update(dt, fn, ctx, 18);
    this.anim.compose(this.buildRoot());
    if (this.atkPhase === 'active' && !this.wdata().ranged) {
      var m = this.anim.partMat('weaponMount');
      if (m) {
        var reach = (this.curStep ? this.curStep.reach : 2) * 0.78;
        this.trailPts.push({
          a: [m[12], m[13] - 0.1, m[14]],
          b: [m[12] + Math.sin(this.facing) * reach, m[13] + 0.5, m[14] + Math.cos(this.facing) * reach]
        });
        if (this.trailPts.length > 14) this.trailPts.shift();
      }
    } else if (this.trailPts.length && this.atkPhase !== 'active') {
      this.trailPts.shift();
    }
  };

  Player.prototype.updateDeath = function (dt) {
    this.dissolve = Math.min(0.95, this.dissolve + dt * 0.75);
    if (Math.random() < 0.5) {
      this.world.spawnParticles(this.x, 0.9 + Math.random() * 0.7, this.z, 1, [1, 0.25, 0.3],
        { speed: 1.2, up: 2, life: 0.9, size: 0.13, grav: -2, prim: 'shard' });
    }
    this.anim.update(dt, EH.CLIPS.lian.death, {}, 10);
    this.anim.compose(this.buildRoot());
  };

  Player.prototype.revive = function () {
    this.cores--;
    this.hp = Math.round(this.maxHp * 0.5);
    this.dead = false; this.dissolve = 0;
    this.iframes = 1.5;
    this.setState('revive'); this.reviving = 1.0;
    this.world.shockwave(this.x, this.z, 4.2, 0, true);
    this.world.spawnParticles(this.x, 1.0, this.z, 26, [1, 0.3, 0.35], { speed: 5, up: 4, life: 0.9, size: 0.16, prim: 'shard' });
    this.world.addField(this.x, this.z, 2.6, 0.8, 0, [1, 0.3, 0.35], 'reviveRing');
    this.world.shakeCam(0.3);
    EH.Audio.play('revive');
    this.world.game.vibrate(60);
  };

  // ---------------- enemy ----------------
  function Enemy(world, kind, elite) {
    var d = EH.ENEMIES[kind];
    var skin = (EH.__enemyMesh && EH.__enemyMesh[kind] && EH.Meshes[EH.__enemyMesh[kind]]) ? EH.__enemyMesh[kind] : d.mesh;
    Actor.call(this, skin);
    this.world = world; this.kind = kind; this.def = d;
    this.radius = d.radius;
    this.elite = elite || null;
    var ab = EH.Prog.abyssMul(world.game.run ? world.game.run.abyss : 0);
    var em = elite ? EH.ELITES[elite] : null;
    this.maxHp = d.hp * ab.hp * (em ? em.hp : 1);
    this.hp = this.maxHp;
    this.dmgMul = ab.dmg * (em ? em.dmg : 1);
    this.speedMul = em ? em.speed : 1;
    this.shield = em && em.shield ? em.shield : 0;
    this.cd = 1.3 + Math.random() * 2.4;   // spread out so waves don't telegraph in unison
    this.burn = 0; this.burnTime = 0; this.burnTick = 0;
    this.y = d.floaty ? 0.35 : 0;
    this.baseY = this.y;
    this.deathT = 0;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.scale = 1;
  }
  Enemy.prototype = Object.create(Actor.prototype);
  Enemy.prototype.constructor = Enemy;

  Enemy.prototype.update = function (dt, player) {
    this.baseUpdate(dt);
    if (this.dying) {
      this.deathT += dt;
      this.world.confine(this);
      this.dissolve = Math.min(0.96, this.deathT * 1.5);
      this.anim.update(dt, EH.CLIPS.foe.death, {}, 12);
      this.anim.compose(this.buildRoot());
      if (this.deathT > 0.75) this.alive = false;
      return;
    }
    // burn damage over time
    if (this.burn > 0) {
      this.burnTime -= dt; this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = 0.5;
        this.world.damageEnemy(this, this.burn * 0.5, { type: 'burn', silent: true });
        this.world.spawnParticles(this.x, this.y + 0.7, this.z, 1, [1, 0.5, 0.15], { speed: 0.5, up: 1.5, life: 0.4, size: 0.1, prim: 'sphere' });
      }
      if (this.burnTime <= 0) this.burn = 0;
    }
    if (!this.alive) return;
    var dx = player.x - this.x, dz = player.z - this.z;
    var dist = Math.hypot(dx, dz) || 0.001;
    var nx = dx / dist, nz = dz / dist;
    this.cd -= dt;
    var d = this.def, sp = d.speed * this.speedMul;
    var ai = d.ai;

    if (this.state === 'tell') {
      if (this.stateTime >= (this.tellDur || d.tell)) this.doAttack(nx, nz, dist);
      this.faceTo(nx, nz, ai === 'shield' ? 0.6 : 3, dt);
      this.finish(dt); return;
    }
    if (this.state === 'attack') {
      if (ai === 'charger') {
        this.x += this.chX * 11 * dt; this.z += this.chZ * 11 * dt;
        if (this.stateTime > 0.28) { this.setState('recover'); this.cd = d.chargeCd; }
      } else if (this.stateTime > 0.35) { this.setState('idle'); this.cd = 1.2 + Math.random(); }
      this.finish(dt); return;
    }
    if (this.state === 'recover') {
      if (this.stateTime > 0.55) this.setState('idle');
      this.finish(dt); return;
    }

    // --- approach / positioning ---
    var move = 0;
    if (ai === 'charger' || ai === 'shield') {
      if (dist > this.radius + player.radius + 0.25) { this.x += nx * sp * dt; this.z += nz * sp * dt; move = 1; }
      if (dist < (ai === 'charger' ? 4.2 : 1.9) && this.cd <= 0) this.beginTell();
    } else if (ai === 'shooter') {
      var want = d.range * 0.75;
      if (dist > want + 1) { this.x += nx * sp * dt; this.z += nz * sp * dt; move = 1; }
      else if (dist < want - 2) { this.x -= nx * sp * dt; this.z -= nz * sp * dt; move = 1; }
      if (this.cd <= 0 && dist < d.range) this.beginTell();
    } else if (ai === 'bomber') {
      this.x += nx * sp * dt; this.z += nz * sp * dt; move = 1;
      if (dist < 1.8 && this.cd <= 0) this.beginTell();
    } else if (ai === 'summoner') {
      if (dist < 5) { this.x -= nx * sp * dt; this.z -= nz * sp * dt; move = 1; }
      if (this.cd <= 0) this.beginTell();
    } else if (ai === 'orbiter') {
      var tx = -nz * this.orbitDir, tz = nx * this.orbitDir;
      var radial = (dist - d.orbitR) * 0.9;
      this.x += (tx * sp + nx * radial) * dt;
      this.z += (tz * sp + nz * radial) * dt;
      move = 1;
      if (this.cd <= 0) this.beginTell();
    }
    this.faceTo(nx, nz, 6, dt);
    // beginTell() may have committed us to an action this frame - do NOT overwrite it,
    // otherwise the tell is cancelled every frame and the attack never fires.
    if (this.state !== 'tell' && this.state !== 'attack' && this.state !== 'recover') {
      this.setState(move ? 'move' : 'idle');
    }
    this.finish(dt);
  };

  Enemy.prototype.faceTo = function (nx, nz, rate, dt) {
    var want = Math.atan2(nx, nz);
    var diff = ((want - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.facing += diff * Math.min(1, rate * dt);
  };
  Enemy.prototype.finish = function (dt) {
    this.world.confine(this);
    if (this.def.floaty) this.y = this.baseY + Math.sin(this.world.time * 2 + this.id) * 0.08;
    var clips = EH.CLIPS.foe;
    var fn = clips[this.state] || clips.idle;
    if (this.state === 'tell') fn = clips.tell;
    if (this.state === 'recover') fn = clips.idle;
    this.anim.update(dt, fn, { speed: this.speedMul, tell: this.tellDur || this.def.tell, dur: 0.35 }, 14);
    this.anim.compose(this.buildRoot());
  };

  Enemy.prototype.beginTell = function () {
    var d = this.def;
    if (this.state === 'tell' || this.state === 'attack' || this.state === 'recover') return;
    this.setState('tell');
    this.cd = 1e9;            // released by doAttack()/recover so we can't re-tell mid-wind-up
    this.tellDur = d.tell;
    var p = this.world.player;
    if (d.ai === 'charger') {
      var dx = p.x - this.x, dz = p.z - this.z, l = Math.hypot(dx, dz) || 1;
      this.chX = dx / l; this.chZ = dz / l;
      this.world.telegraph('line', this.x, this.z, Math.atan2(this.chX, this.chZ), 5.0, d.tell, [1, 0.35, 0.3]);
    } else if (d.ai === 'shooter') {
      this.world.telegraph('line', this.x, this.z, Math.atan2(p.x - this.x, p.z - this.z), d.range, d.tell, [1, 0.6, 0.3]);
    } else if (d.ai === 'bomber') {
      this.tellDur = d.fuse;
      this.world.telegraph('circle', this.x, this.z, d.blastR, 0, d.fuse, [1, 0.4, 0.2]);
    } else if (d.ai === 'shield') {
      this.world.telegraph('cone', this.x, this.z, this.facing, 2.4, d.tell, [1, 0.4, 0.35]);
    } else if (d.ai === 'summoner') {
      this.world.telegraph('circle', this.x, this.z, 1.2, 0, d.tell, [0.9, 0.3, 0.9]);
    } else if (d.ai === 'orbiter') {
      this.world.telegraph('ring', this.x, this.z, 2.2, 0, d.tell, [1, 0.4, 0.4]);
    }
  };

  Enemy.prototype.doAttack = function (nx, nz, dist) {
    var d = this.def, w = this.world, p = w.player;
    this.setState('attack');
    if (this.cd > 1e8) this.cd = 2.0;   // default release; each AI overrides below
    var dmg = d.dmg * this.dmgMul;
    if (d.ai === 'charger') { /* movement handled in attack state; contact damage */ }
    else if (d.ai === 'shooter') {
      var sp = d.projSpeed;
      // spawn at the barrel, not at the model's centre, so the muzzle flash and
      // the round line up with the weapon instead of blooming out of the chest
      var mzx = this.x + nx * 0.62, mzz = this.z + nz * 0.62;
      w.fire({
        x: mzx, z: mzz, y: 1.0, vx: nx * sp, vz: nz * sp, r: 0.26, dmg: dmg,
        fromPlayer: false, life: 3, color: [1, 0.55, 0.3], kind: 'slug'
      });
      w.spawnParticles(mzx, 1.0, mzz, 6, [1, 0.78, 0.46],
        { speed: 6.5, up: 0.7, life: 0.16, size: 0.13, prim: 'sphere' });
      EH.Audio.play('enemyShot');
      this.cd = d.fireCd;
    } else if (d.ai === 'bomber') {
      w.shockDamage(this.x, this.z, d.blastR, dmg, 'blast');
      w.spawnParticles(this.x, 0.6, this.z, 18, [1, 0.5, 0.2], { speed: 7, up: 3, life: 0.7, size: 0.16 });
      w.shakeCam(0.16); EH.Audio.play('projectileHit');
      this.die(true);
    } else if (d.ai === 'shield') {
      if (dist < 2.6) {
        var ang = Math.atan2(p.x - this.x, p.z - this.z);
        var diff = Math.abs(((ang - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff < d.frontArc) w.damagePlayer(dmg, 'melee', this.x, this.z);
      }
      this.cd = 2.8;
    } else if (d.ai === 'summoner') {
      // count minions THIS summoner already has alive, and cap the brood
      var live = 0, meId = this.id, es = w.enemies;
      for (var li = 0; li < es.length; li++) {
        var ce = es[li];
        if (ce.summonedBy === meId && ce.alive && !ce.dying) live++;
      }
      var room = Math.max(0, (d.sumMax || 4) - live);
      var toSpawn = Math.min(d.sumCount, room);
      for (var i = 0; i < toSpawn; i++) {
        var a = Math.random() * Math.PI * 2, r = 1.6;
        var child = w.spawnEnemy('stalker', this.x + Math.cos(a) * r, this.z + Math.sin(a) * r, null, true);
        if (child) child.summonedBy = meId;
      }
      this.cd = d.sumCd;
      // blink with telegraphed destination
      var bx = EH.clamp(this.x + (Math.random() - 0.5) * 8, -w.half + 1, w.half - 1);
      var bz = EH.clamp(this.z + (Math.random() - 0.5) * 8, -w.half + 1, w.half - 1);
      w.telegraph('circle', bx, bz, 0.9, 0, 0.45, [0.9, 0.3, 0.9]);
      this.blinkTo = { x: bx, z: bz, t: 0.45 };
    } else if (d.ai === 'orbiter') {
      var n = d.ringCount, base = Math.random() * Math.PI * 2;
      for (var k = 0; k < n; k++) {
        if (k === (n >> 1)) continue;              // guaranteed safe gap
        var ang2 = base + k * (Math.PI * 2 / n);
        w.fire({
          x: this.x, z: this.z, y: 0.95,
          vx: Math.sin(ang2) * d.projSpeed, vz: Math.cos(ang2) * d.projSpeed,
          r: 0.24, dmg: dmg, fromPlayer: false, life: 3.4, color: [1, 0.45, 0.5],
          kind: 'pellet'
        });
      }
      EH.Audio.play('enemyShot');
      this.cd = d.fireCd;
    }
  };

  Enemy.prototype.die = function (silent) {
    if (this.dying) return;
    this.dying = true; this.deathT = 0; this.setState('death');
    this.world.onEnemyKilled(this, silent);
  };

  // ---------------- boss ----------------
  function Boss(world) {
    var d = EH.BOSS;
    Actor.call(this, d.mesh);
    this.world = world; this.def = d;
    this.radius = d.hitRadius;
    var ab = EH.Prog.abyssMul(world.game.run ? world.game.run.abyss : 0);
    this.maxHp = d.hp * ab.hp; this.hp = this.maxHp;
    this.dmgMul = ab.dmg;
    this.phase = 0; this.phaseLock = false;
    this.state = 'intro'; this.stateTime = 0;
    this.cd = 3.0; this.pattern = ''; this.patTime = 0;
    this.y = 0; this.scale = 1;
    this.groggy = 0; this.deathT = 0;
    this.introDone = false; this.defeated = false;
    this.burn = 0; this.burnTime = 0; this.burnTick = 0;
  }
  Boss.prototype = Object.create(Actor.prototype);
  Boss.prototype.constructor = Boss;

  Boss.prototype.phaseFor = function () {
    var f = this.hp / this.maxHp;
    if (f > 0.65) return 0;
    if (f > 0.30) return 1;
    return 2;
  };

  Boss.prototype.update = function (dt, player) {
    this.baseUpdate(dt);
    if (this.dying) {
      this.deathT += dt;
      this.dissolve = Math.min(0.9, this.deathT * 0.3);
      if (Math.random() < 0.7) this.world.spawnParticles(this.x + (Math.random() - 0.5) * 3, 1 + Math.random() * 3, this.z + (Math.random() - 0.5) * 3, 1, [1, 0.3, 0.3], { speed: 2, up: 3, life: 1.2, size: 0.3, grav: -3 });
      this.anim.update(dt, EH.CLIPS.boss.death, {}, 8);
      this.anim.compose(this.buildRoot());
      return;
    }
    if (this.burn > 0) {
      this.burnTime -= dt; this.burnTick -= dt;
      if (this.burnTick <= 0) { this.burnTick = 0.5; this.world.damageEnemy(this, this.burn * 0.5, { type: 'burn', silent: true }); }
      if (this.burnTime <= 0) this.burn = 0;
    }

    if (this.state === 'intro') {
      if (this.stateTime > 2.6) { this.state = 'idle'; this.stateTime = 0; this.introDone = true; }
      this.anim.update(dt, EH.CLIPS.boss.intro, {}, 8);
      this.anim.compose(this.buildRoot());
      return;
    }
    // phase transition (once each)
    var want = this.phaseFor();
    if (want > this.phase && !this.phaseLock) {
      this.phase = want; this.phaseLock = true;
      this.state = 'phase'; this.stateTime = 0; this.pattern = '';
      EH.Audio.play('bossPhase');
      this.world.shakeCam(0.35);
      this.world.game.onBossPhase(this.phase);
      this.world.shockwave(this.x, this.z, 7, 0, false);
    }
    if (this.state === 'phase') {
      if (this.stateTime > 1.7) { this.state = 'idle'; this.stateTime = 0; this.phaseLock = false; this.cd = 0.8; }
      this.anim.update(dt, EH.CLIPS.boss.phase, {}, 8);
      this.anim.compose(this.buildRoot());
      return;
    }
    if (this.state === 'groggy') {
      this.groggy -= dt;
      if (this.groggy <= 0) { this.state = 'idle'; this.cd = 0.5; }
      this.anim.update(dt, EH.CLIPS.boss.groggy, {}, 8);
      this.anim.compose(this.buildRoot());
      return;
    }

    var dx = player.x - this.x, dz = player.z - this.z;
    var dist = Math.hypot(dx, dz) || 0.001;
    var nx = dx / dist, nz = dz / dist;
    this.facing += (((Math.atan2(nx, nz) - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, 1.6 * dt);

    if (this.pattern) { this.runPattern(dt, nx, nz, dist, player); }
    else {
      this.cd -= dt;
      if (this.cd <= 0) this.choosePattern(dist);
      this.anim.update(dt, EH.CLIPS.boss.idle, { phase: this.phase }, 8);
      this.anim.compose(this.buildRoot());
    }
  };

  Boss.prototype.choosePattern = function (dist) {
    var opts;
    if (this.phase === 0) opts = ['fan', 'cracks', 'homing', 'slam'];
    else if (this.phase === 1) opts = ['dash', 'spiral', 'slowzone', 'closing', 'fan'];
    else opts = ['fan', 'spiral', 'slam', 'closing', 'summon', 'dash'];
    this.pattern = opts[Math.floor(Math.random() * opts.length)];
    this.patTime = 0; this.patStep = 0;
    var st = { fan: 'sweep', cracks: 'sweep', homing: 'sweep', slam: 'slam', dash: 'dash', spiral: 'spin', slowzone: 'sweep', closing: 'spin', summon: 'sweep' };
    this.state = st[this.pattern] || 'idle';
    this.stateTime = 0;
    this.telegraphed = false;
  };

  Boss.prototype.endPattern = function (restWindow) {
    this.pattern = ''; this.state = 'idle';
    var speed = 1 - this.phase * 0.18;
    this.cd = (restWindow || 1.5) * speed;
    if (this.phase === 2 && Math.random() < 0.35) {
      this.state = 'groggy'; this.groggy = 1.6;   // guaranteed counter window
    }
  };

  Boss.prototype.runPattern = function (dt, nx, nz, dist, player) {
    this.patTime += dt;
    var w = this.world, p = this.pattern, T = this.patTime;
    var dmg = 14 * this.dmgMul;
    var clip = EH.CLIPS.boss[this.state] || EH.CLIPS.boss.idle;
    this.anim.update(dt, clip, { phase: this.phase }, 8);
    this.anim.compose(this.buildRoot());

    if (p === 'fan') {
      if (!this.telegraphed) { this.telegraphed = true; w.telegraph('cone', this.x, this.z, this.facing, 9, 0.85, [1, 0.35, 0.3], true); }
      if (T > 0.85 && this.patStep === 0) {
        this.patStep = 1;
        var n = 7 + this.phase * 2, spread = 1.1;
        for (var i = 0; i < n; i++) {
          var a = this.facing + (i / (n - 1) - 0.5) * spread * 2;
          w.fire({ x: this.x, z: this.z, y: 1.6, vx: Math.sin(a) * 7, vz: Math.cos(a) * 7, r: 0.34, dmg: dmg, fromPlayer: false, life: 3.2, color: [1, 0.4, 0.3], kind: 'shard' });
        }
        EH.Audio.play('skill');
      }
      if (T > 1.5) this.endPattern(1.4);
    } else if (p === 'cracks') {
      if (this.patStep < 5 && T > this.patStep * 0.32) {
        var a2 = Math.random() * Math.PI * 2, r2 = 2 + Math.random() * 6;
        var cx = EH.clamp(player.x + Math.cos(a2) * r2 * 0.4, -w.half + 1, w.half - 1);
        var cz = EH.clamp(player.z + Math.sin(a2) * r2 * 0.4, -w.half + 1, w.half - 1);
        w.delayedBlast(cx, cz, 2.0, 0.9, dmg * 0.9, 'field');
        this.patStep++;
      }
      if (T > 2.6) this.endPattern(1.5);
    } else if (p === 'homing') {
      if (this.patStep < 3 && T > 0.6 + this.patStep * 0.45) {
        this.patStep++;
        w.fire({ x: this.x, z: this.z, y: 1.5, vx: nx * 3.4, vz: nz * 3.4, r: 0.42, dmg: dmg, fromPlayer: false, life: 5, color: [1, 0.3, 0.6], kind: 'homing' });
      }
      if (T > 2.4) this.endPattern(1.4);
    } else if (p === 'slam') {
      if (!this.telegraphed) { this.telegraphed = true; w.telegraph('circle', this.x + nx * 3, this.z + nz * 3, 3.6, 0, 1.0, [1, 0.3, 0.25], true); this.slamX = this.x + nx * 3; this.slamZ = this.z + nz * 3; }
      if (T > 1.0 && this.patStep === 0) {
        this.patStep = 1;
        w.shockDamage(this.slamX, this.slamZ, 3.6, dmg * 1.3, 'blast');
        w.shockwave(this.slamX, this.slamZ, 3.6, 0, false);
        w.spawnParticles(this.slamX, 0.4, this.slamZ, 22, [1, 0.4, 0.25], { speed: 8, up: 4, life: 0.8, size: 0.2 });
        w.shakeCam(0.3); EH.Audio.play('comboFinish');
      }
      if (T > 1.9) this.endPattern(1.8);
    } else if (p === 'dash') {
      if (!this.telegraphed) { this.telegraphed = true; this.dashX = nx; this.dashZ = nz; w.telegraph('line', this.x, this.z, Math.atan2(nx, nz), 12, 0.7, [1, 0.35, 0.3], true); }
      if (T > 0.7 && T < 1.15) {
        this.x += this.dashX * 17 * dt; this.z += this.dashZ * 17 * dt;
        w.clampToRoom(this);
        if (Math.hypot(player.x - this.x, player.z - this.z) < this.radius + player.radius + 0.2) {
          w.damagePlayer(dmg * 0.9, 'melee', this.x, this.z);
        }
      }
      if (T > 1.15 && this.patStep < 2 && this.phase >= 1) { this.patStep++; this.patTime = 0; this.telegraphed = false; }
      else if (T > 1.5) this.endPattern(1.6);
    } else if (p === 'spiral') {
      if (this.patStep < (10 + this.phase * 4) && T > this.patStep * 0.11) {
        var ang = this.patStep * 0.55 + this.stateTime;
        for (var k = 0; k < 3; k++) {
          var aa = ang + k * (Math.PI * 2 / 3);
          w.fire({ x: this.x, z: this.z, y: 1.5, vx: Math.sin(aa) * 6, vz: Math.cos(aa) * 6, r: 0.3, dmg: dmg * 0.8, fromPlayer: false, life: 3.4, color: [1, 0.55, 0.3], kind: 'shard' });
        }
        this.patStep++;
      }
      if (T > 2.4) this.endPattern(1.6);
    } else if (p === 'slowzone') {
      if (!this.telegraphed) {
        this.telegraphed = true;
        for (var z2 = 0; z2 < 3; z2++) {
          var ax = (Math.random() - 0.5) * w.half * 1.4, az = (Math.random() - 0.5) * w.half * 1.4;
          w.addField(ax, az, 2.6, 5.0, dmg * 0.25, [0.5, 0.3, 1], 'slow');
        }
      }
      if (T > 1.0) this.endPattern(1.3);
    } else if (p === 'closing') {
      // ring closing from the outside with a clear safe center
      if (!this.telegraphed) { this.telegraphed = true; w.telegraph('ring', 0, 0, w.half, 0, 1.2, [1, 0.4, 0.3], true); }
      if (T > 1.2 && this.patStep === 0) {
        this.patStep = 1;
        var count = 22;
        for (var i2 = 0; i2 < count; i2++) {
          var a3 = i2 / count * Math.PI * 2;
          w.fire({
            x: Math.sin(a3) * (w.half - 0.5), z: Math.cos(a3) * (w.half - 0.5), y: 1.1,
            vx: -Math.sin(a3) * 4.2, vz: -Math.cos(a3) * 4.2,
            r: 0.32, dmg: dmg, fromPlayer: false, life: 3.0, color: [1, 0.45, 0.35], kind: 'shard'
          });
        }
      }
      if (T > 2.2) this.endPattern(2.0);
    } else if (p === 'summon') {
      if (!this.telegraphed) {
        this.telegraphed = true;
        var bLive = 0, bes = w.enemies;
        for (var bi = 0; bi < bes.length; bi++) { if (bes[bi].summonedByBoss && bes[bi].alive && !bes[bi].dying) bLive++; }
        var bRoom = Math.max(0, 6 - bLive), bN = Math.min(2, bRoom);
        for (var s = 0; s < bN; s++) {
          var sa = Math.random() * Math.PI * 2, sr = 4 + Math.random() * 3;
          var bc = w.spawnEnemy('stalker', Math.cos(sa) * sr, Math.sin(sa) * sr, null, true);
          if (bc) bc.summonedByBoss = true;
        }
      }
      if (T > 1.2) this.endPattern(1.6);
    } else { this.endPattern(1.2); }
  };

  Boss.prototype.die = function () {
    if (this.dying || this.defeated) return;
    this.defeated = true; this.dying = true; this.deathT = 0;
    this.world.onBossKilled(this);
  };

  World.prototype.spawnEnemy = function (kind, x, z, elite, instant) {
    if (!EH.ENEMIES[kind]) return null;
    var e = new Enemy(this, kind, elite);
    e.x = EH.clamp(x, -this.half + 1, this.half - 1);
    e.z = EH.clamp(z, -this.half + 1, this.half - 1);
    e.facing = Math.atan2(this.player.x - e.x, this.player.z - e.z);
    this.enemies.push(e);
    if (elite) EH.Audio.play('eliteSpawn');
    this.spawnParticles(e.x, 0.4, e.z, 8, [0.4, 0.9, 1], { speed: 3, up: 2, life: 0.5, size: 0.12 });
    return e;
  };
  World.prototype.spawnBoss = function () {
    this.boss = new Boss(this);
    this.boss.x = 0; this.boss.z = -4;
    this.boss.facing = Math.PI;
    EH.Audio.play('bossIntro');
    return this.boss;
  };

  EH.World = World; EH.Player = Player; EH.Enemy = Enemy; EH.Boss = Boss; EH.Pool = Pool;
})();
