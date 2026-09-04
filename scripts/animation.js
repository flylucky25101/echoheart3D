'use strict';
// Part-hierarchy (joint) animation: per-part local rotation + offset, blended,
// composed into world matrices. Real articulated limb motion, not whole-body wobble.
(function () {
  var EH = window.EchoHeart, M = null;

  function Animator(meshName) {
    M = EH.M;
    this.name = meshName;
    this.mesh = EH.Meshes[meshName];
    if (!this.mesh) { this.parts = []; this.n = 0; return; }
    this.parts = this.mesh.parts;
    this.n = this.parts.length;
    this.index = {};
    this.mats = new Array(this.n);
    this.rot = new Float32Array(this.n * 3);
    this.target = new Float32Array(this.n * 3);
    this.off = new Float32Array(this.n * 3);
    this.offT = new Float32Array(this.n * 3);
    this.scl = new Float32Array(this.n); this.sclT = new Float32Array(this.n);
    for (var i = 0; i < this.n; i++) {
      this.index[this.parts[i].n] = i;
      this.mats[i] = M.Mat4.create();
      this.scl[i] = this.sclT[i] = 1;
    }
    this.root = M.Mat4.create();
    this._q = [0, 0, 0, 1]; this._v = [0, 0, 0]; this._s = [1, 1, 1];
    this._local = M.Mat4.create();
    this.time = 0; this.state = ''; this.stateTime = 0;
  }

  Animator.prototype.set = function (name, rx, ry, rz) {
    var i = this.index[name]; if (i === undefined) return;
    this.target[i * 3] = rx || 0; this.target[i * 3 + 1] = ry || 0; this.target[i * 3 + 2] = rz || 0;
  };
  Animator.prototype.add = function (name, rx, ry, rz) {
    var i = this.index[name]; if (i === undefined) return;
    this.target[i * 3] += rx || 0; this.target[i * 3 + 1] += ry || 0; this.target[i * 3 + 2] += rz || 0;
  };
  Animator.prototype.move = function (name, x, y, z) {
    var i = this.index[name]; if (i === undefined) return;
    this.offT[i * 3] = x || 0; this.offT[i * 3 + 1] = y || 0; this.offT[i * 3 + 2] = z || 0;
  };
  Animator.prototype.scale = function (name, s) {
    var i = this.index[name]; if (i === undefined) return;
    this.sclT[i] = s;
  };
  Animator.prototype.has = function (name) { return this.index[name] !== undefined; };

  // rootMat: entity world transform (position + facing + scale)
  Animator.prototype.update = function (dt, clipFn, ctx, blendRate) {
    if (!this.n) return;
    this.time += dt;
    for (var i = 0; i < this.n * 3; i++) { this.target[i] = 0; this.offT[i] = 0; }
    for (var s = 0; s < this.n; s++) this.sclT[s] = 1;
    if (clipFn) clipFn(this, this.stateTime, ctx || {});
    var k = 1 - Math.exp(-(blendRate || 16) * dt);
    for (var j = 0; j < this.n * 3; j++) {
      this.rot[j] += (this.target[j] - this.rot[j]) * k;
      this.off[j] += (this.offT[j] - this.off[j]) * k;
    }
    for (var q = 0; q < this.n; q++) this.scl[q] += (this.sclT[q] - this.scl[q]) * k;
  };

  Animator.prototype.compose = function (rootMat) {
    if (!this.n) return this.mats;
    for (var i = 0; i < this.n; i++) {
      var p = this.parts[i], o = i * 3;
      M.Quat.fromEuler(this._q, this.rot[o], this.rot[o + 1], this.rot[o + 2]);
      this._v[0] = p.rest[0] + this.off[o];
      this._v[1] = p.rest[1] + this.off[o + 1];
      this._v[2] = p.rest[2] + this.off[o + 2];
      this._s[0] = this._s[1] = this._s[2] = this.scl[i];
      M.Mat4.fromRTS(this._local, this._q, this._v, this._s);
      if (p.par < 0) M.Mat4.multiply(this.mats[i], rootMat, this._local);
      else M.Mat4.multiply(this.mats[i], this.mats[p.par], this._local);
    }
    return this.mats;
  };

  // world position of a part origin (weapon mount, muzzle, hit point)
  Animator.prototype.partPos = function (name, out) {
    var i = this.index[name]; out = out || [0, 0, 0];
    if (i === undefined) { out[0] = out[1] = out[2] = 0; return out; }
    var m = this.mats[i]; out[0] = m[12]; out[1] = m[13]; out[2] = m[14]; return out;
  };
  Animator.prototype.partMat = function (name) {
    var i = this.index[name]; return i === undefined ? null : this.mats[i];
  };

  EH.Animator = Animator;

  // ================= CLIP LIBRARY =================
  var sin = Math.sin, cos = Math.cos, PI = Math.PI;
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function pulse(t, a, b) { return ease((t - a) / Math.max(1e-4, b - a)); }

  // ---- player (lian) ----
  var lian = {};
  function lianBase(an, t, c) {
    var br = sin(t * 2.2) * 0.035;
    an.set('torso', br * 0.6, 0, 0);
    an.set('head', -br * 0.4, sin(t * 0.7) * 0.12, 0);
    an.move('pelvis', 0, sin(t * 2.2) * 0.012, 0);
    an.set('cloak', 0.12 + sin(t * 1.3) * 0.06, sin(t * 0.9) * 0.08, 0);
    an.set('heart', 0, 0, 0);
    an.scale('heart', 1 + sin(t * 3.4) * 0.10);
  }
  lian.idle = function (an, t, c) {
    lianBase(an, t, c);
    an.set('upperArmR', 0.06, 0, -0.18); an.set('lowerArmR', -0.28, 0, 0);
    an.set('upperArmL', 0.06, 0, 0.18); an.set('lowerArmL', -0.24, 0, 0);
    an.set('thighR', 0, 0, 0.03); an.set('thighL', 0, 0, -0.03);
  };
  lian.hubIdle = function (an, t, c) {
    lianBase(an, t * 0.7, c);
    an.set('upperArmR', 0.1, 0, -0.22); an.set('lowerArmR', -0.5, 0, 0);
    an.set('upperArmL', 0.05, 0, 0.2); an.set('lowerArmL', -0.3, 0, 0);
    an.set('head', sin(t * 0.5) * 0.1, sin(t * 0.33) * 0.3, 0);
  };
  lian.run = function (an, t, c) {
    var sp = c.speed || 1, w = t * 9.5 * sp, sw = sin(w), sw2 = sin(w + PI);
    an.set('torso', 0.16, sin(w * 2) * 0.05, 0);
    an.set('head', -0.08, 0, 0);
    an.move('pelvis', 0, Math.abs(sin(w)) * 0.055, 0);
    an.set('thighR', sw * 0.85, 0, 0.03); an.set('shinR', Math.max(0, -sw) * 0.9, 0, 0);
    an.set('thighL', sw2 * 0.85, 0, -0.03); an.set('shinL', Math.max(0, -sw2) * 0.9, 0, 0);
    an.set('upperArmR', sw2 * 0.6, 0, -0.2); an.set('lowerArmR', -0.5 - Math.abs(sw2) * 0.3, 0, 0);
    an.set('upperArmL', sw * 0.6, 0, 0.2); an.set('lowerArmL', -0.45 - Math.abs(sw) * 0.3, 0, 0);
    an.set('cloak', 0.5 + sin(w) * 0.12, 0, 0);
    an.scale('heart', 1 + sin(t * 5) * 0.12);
  };
  lian.dash = function (an, t, c) {
    var p = ease(t / 0.22);
    an.set('torso', 0.5 - p * 0.15, 0, 0);
    an.set('head', -0.25, 0, 0);
    an.set('upperArmR', -0.9, 0, -0.5); an.set('lowerArmR', -0.7, 0, 0);
    an.set('upperArmL', -0.9, 0, 0.5); an.set('lowerArmL', -0.7, 0, 0);
    an.set('thighR', -0.5, 0, 0); an.set('shinR', 0.9, 0, 0);
    an.set('thighL', 0.6, 0, 0); an.set('shinL', 0.4, 0, 0);
    an.set('cloak', 1.25, 0, 0);
  };
  lian.hit = function (an, t, c) {
    var p = 1 - ease(t / 0.26);
    an.set('torso', -0.35 * p, 0.2 * p, 0);
    an.set('head', -0.3 * p, 0, 0);
    an.set('upperArmR', -0.4 * p, 0, -0.4 * p);
    an.set('upperArmL', -0.4 * p, 0, 0.4 * p);
    an.scale('heart', 1 + p * 0.5);
  };
  lian.death = function (an, t, c) {
    var p = ease(t / 0.9);
    an.set('torso', 0.5 * p, 0.3 * p, 0);
    an.set('head', 0.7 * p, 0, 0.2 * p);
    an.move('pelvis', 0, -0.55 * p, 0);
    an.set('thighR', 1.1 * p, 0, 0); an.set('shinR', -1.3 * p, 0, 0);
    an.set('thighL', 0.9 * p, 0, 0); an.set('shinL', -1.1 * p, 0, 0);
    an.set('upperArmR', 0.8 * p, 0, -0.7 * p); an.set('upperArmL', 0.8 * p, 0, 0.7 * p);
    an.set('cloak', 0.2 * p, 0, 0);
    an.scale('heart', 1 + p * 0.8);
  };
  lian.revive = function (an, t, c) {
    var p = ease(t / 1.0);
    an.set('torso', 0.6 * (1 - p), 0, 0);
    an.move('pelvis', 0, -0.5 * (1 - p), 0);
    an.set('head', 0.5 * (1 - p) - 0.1, 0, 0);
    an.set('upperArmR', -1.2 * p * (1 - p) * 4 - 0.1, 0, -0.3);
    an.set('upperArmL', -1.2 * p * (1 - p) * 4 - 0.1, 0, 0.3);
    an.set('thighR', 0.8 * (1 - p), 0, 0); an.set('thighL', 0.7 * (1 - p), 0, 0);
    an.scale('heart', 1 + (1 - p) * 1.6);
  };
  // sword combo: windup -> strike -> recover, with torso twist + weight shift
  function swordSwing(an, t, c, dur, dirSign, high) {
    var w = EH.clamp(t / dur, 0, 1);
    var wind = pulse(w, 0, 0.32), strike = pulse(w, 0.32, 0.62), rec = pulse(w, 0.62, 1);
    var twist = (-0.5 * wind + 1.0 * strike - 0.45 * rec) * dirSign;
    an.set('torso', 0.1 + 0.18 * strike, twist, 0);
    an.set('pelvis', 0, twist * 0.35, 0);
    an.set('head', -0.05, twist * 0.5, 0);
    var swing = (-1.5 * wind + 2.6 * strike - 0.9 * rec);
    an.set('upperArmR', -0.5 + swing * (high ? 0.9 : 0.65), 0, -0.35 - twist * 0.4);
    an.set('lowerArmR', -0.8 + wind * 0.5 - strike * 0.5, 0, 0);
    an.set('upperArmL', 0.2 - swing * 0.25, 0, 0.5 + twist * 0.3);
    an.set('lowerArmL', -0.7, 0, 0);
    an.set('thighR', -0.12 * strike, 0, 0.03); an.set('thighL', 0.22 * strike, 0, -0.03);
    an.move('pelvis', 0, -0.05 * strike, 0.12 * strike);
    an.set('cloak', 0.3 + strike * 0.5, twist * 0.4, 0);
  }
  lian.sword1 = function (an, t, c) { swordSwing(an, t, c, c.dur || 0.35, 1, false); };
  lian.sword2 = function (an, t, c) { swordSwing(an, t, c, c.dur || 0.34, -1, false); };
  lian.sword3 = function (an, t, c) { swordSwing(an, t, c, c.dur || 0.56, 1, true); };
  lian.swordSkill = function (an, t, c) {
    var w = EH.clamp(t / 0.5, 0, 1), wind = pulse(w, 0, 0.35), thrust = pulse(w, 0.35, 0.55), rec = pulse(w, 0.55, 1);
    an.set('torso', 0.1 - 0.25 * wind + 0.3 * thrust - 0.15 * rec, -0.5 * wind + 0.7 * thrust, 0);
    an.set('upperArmR', -1.6 * wind + 1.9 * thrust - 0.4 * rec, 0, -0.3);
    an.set('lowerArmR', -1.2 * wind + 1.3 * thrust, 0, 0);
    an.set('upperArmL', 0.4 * wind - 0.3 * thrust, 0, 0.6);
    an.move('pelvis', 0, 0, 0.3 * thrust - 0.2 * rec);
    an.set('cloak', 0.3 + thrust * 0.7, 0, 0);
  };
  lian.swordUlt = function (an, t, c) {
    var spin = t * 11;
    an.set('torso', 0.05, spin, 0);
    an.set('upperArmR', 0.2 + sin(spin * 2) * 0.5, 0, -1.2);
    an.set('lowerArmR', -0.3, 0, 0);
    an.set('upperArmL', 0.2 + cos(spin * 2) * 0.4, 0, 1.2);
    an.move('pelvis', 0, 0.18 + sin(t * 8) * 0.06, 0);
    an.set('cloak', 0.9, 0, 0);
    an.scale('heart', 1.5 + sin(t * 14) * 0.4);
  };
  lian.bowShoot = function (an, t, c) {
    var w = EH.clamp(t / (c.dur || 0.3), 0, 1), draw = pulse(w, 0, 0.45), rel = pulse(w, 0.45, 0.65);
    an.set('torso', 0.06, -0.45, 0);
    an.set('pelvis', 0, -0.3, 0);
    an.set('head', 0, -0.25, 0);
    an.set('upperArmL', -1.45, 0, 0.55); an.set('lowerArmL', -0.1, 0, 0);
    an.set('upperArmR', -1.15 - draw * 0.25 + rel * 0.3, 0, -0.9 - draw * 0.35 + rel * 0.5);
    an.set('lowerArmR', -1.1 - draw * 0.6 + rel * 0.9, 0, 0);
    an.set('cloak', 0.25, -0.3, 0);
  };
  lian.bowSkill = function (an, t, c) {
    var w = EH.clamp(t / 0.55, 0, 1), draw = pulse(w, 0, 0.55), rel = pulse(w, 0.55, 0.75);
    an.set('torso', -0.12 + rel * 0.25, -0.5, 0);
    an.set('upperArmL', -1.5, 0, 0.6); an.set('lowerArmL', -0.05, 0, 0);
    an.set('upperArmR', -1.2 - draw * 0.5 + rel * 0.6, 0, -1.0 - draw * 0.5 + rel * 0.7);
    an.set('lowerArmR', -1.2 - draw * 0.9 + rel * 1.4, 0, 0);
    an.move('pelvis', 0, -0.06 * draw, -0.12 * draw);
    an.scale('heart', 1 + draw * 0.5);
  };
  lian.bowUlt = function (an, t, c) {
    an.set('torso', -0.4, 0, 0);
    an.set('upperArmL', -2.2, 0, 0.7); an.set('upperArmR', -2.2, 0, -0.7);
    an.set('lowerArmL', -0.2, 0, 0); an.set('lowerArmR', -0.2, 0, 0);
    an.set('head', -0.4, 0, 0);
    an.move('pelvis', 0, 0.12 + sin(t * 9) * 0.05, 0);
    an.scale('heart', 1.6 + sin(t * 12) * 0.4);
  };
  function punch(an, t, c, dur, right) {
    var w = EH.clamp(t / dur, 0, 1), wind = pulse(w, 0, 0.28), hit = pulse(w, 0.28, 0.5), rec = pulse(w, 0.5, 1);
    var ext = -1.2 * wind + 2.3 * hit - 1.0 * rec;
    var tw = (right ? -1 : 1) * (0.35 * wind - 0.55 * hit + 0.25 * rec);
    an.set('torso', 0.14, tw, 0); an.set('pelvis', 0, tw * 0.5, 0);
    if (right) {
      an.set('upperArmR', -0.2 + ext * 0.55, 0, -0.5 - ext * 0.25);
      an.set('lowerArmR', -1.3 + ext * 1.1, 0, 0);
      an.set('upperArmL', 0.3 - ext * 0.2, 0, 0.75); an.set('lowerArmL', -1.4, 0, 0);
    } else {
      an.set('upperArmL', -0.2 + ext * 0.55, 0, 0.5 + ext * 0.25);
      an.set('lowerArmL', -1.3 + ext * 1.1, 0, 0);
      an.set('upperArmR', 0.3 - ext * 0.2, 0, -0.75); an.set('lowerArmR', -1.4, 0, 0);
    }
    an.move('pelvis', 0, 0, 0.1 * hit);
    an.set('cloak', 0.3 + hit * 0.3, tw * 0.5, 0);
  }
  lian.gaunt1 = function (an, t, c) { punch(an, t, c, c.dur || 0.21, true); };
  lian.gaunt2 = function (an, t, c) { punch(an, t, c, c.dur || 0.21, false); };
  lian.gaunt3 = function (an, t, c) { punch(an, t, c, c.dur || 0.21, true); };
  lian.gaunt4 = function (an, t, c) {
    var w = EH.clamp(t / (c.dur || 0.44), 0, 1), wind = pulse(w, 0, 0.3), hit = pulse(w, 0.3, 0.52), rec = pulse(w, 0.52, 1);
    an.set('torso', 0.2 - 0.3 * wind + 0.5 * hit - 0.3 * rec, 0, 0);
    an.set('upperArmR', -1.5 * wind + 2.2 * hit - 0.7 * rec, 0, -0.4);
    an.set('upperArmL', -1.4 * wind + 2.0 * hit - 0.6 * rec, 0, 0.4);
    an.set('lowerArmR', -0.9 + hit * 0.6, 0, 0); an.set('lowerArmL', -0.9 + hit * 0.6, 0, 0);
    an.move('pelvis', 0, -0.12 * hit, 0.15 * hit);
    an.set('cloak', 0.3 + hit * 0.8, 0, 0);
  };
  lian.gauntSkill = function (an, t, c) {
    var p = ease(t / 0.4);
    an.set('torso', 0.45, 0, 0); an.set('head', -0.3, 0, 0);
    an.set('upperArmR', -0.3 + p * 1.2, 0, -0.9); an.set('lowerArmR', -0.5, 0, 0);
    an.set('upperArmL', -0.9, 0, 0.6); an.set('lowerArmL', -1.0, 0, 0);
    an.set('thighR', -0.4, 0, 0); an.set('thighL', 0.5, 0, 0);
    an.set('cloak', 1.1, 0, 0);
  };
  lian.gauntUlt = function (an, t, c) {
    var w = EH.clamp(t / 0.9, 0, 1), up = pulse(w, 0, 0.4), down = pulse(w, 0.4, 0.55);
    an.set('torso', -0.5 * up + 0.9 * down, 0, 0);
    an.set('upperArmR', -2.4 * up + 2.6 * down, 0, -0.5);
    an.set('upperArmL', -2.4 * up + 2.6 * down, 0, 0.5);
    an.move('pelvis', 0, 0.35 * up - 0.5 * down, 0);
    an.set('thighR', -0.3 * up + 0.9 * down, 0, 0);
    an.set('thighL', -0.3 * up + 0.9 * down, 0, 0);
    an.scale('heart', 1.4 + sin(t * 16) * 0.5);
  };

  // ---- generic humanoid enemy ----
  function hasLegs(an) { return an.has('thighR') || an.has('thighL'); }
  var foe = {};
  foe.idle = function (an, t, c) {
    var b = sin(t * 1.9) * 0.05;
    an.set('torso', b, sin(t * 0.6) * 0.1, 0);
    an.set('head', -b * 0.5, sin(t * 0.45) * 0.25, 0);
    an.move('pelvis', 0, sin(t * 1.9) * 0.02, 0);
    an.set('upperArmR', 0.05, 0, -0.2); an.set('upperArmL', 0.05, 0, 0.2);
    if (an.has('ring1')) an.set('ring1', 0, t * 0.8, 0);
    if (an.has('ring2')) an.set('ring2', t * 0.6, 0, 0);
  };
  foe.move = function (an, t, c) {
    var w = t * 8 * (c.speed || 1), sw = sin(w), sw2 = sin(w + PI);
    an.set('torso', 0.12, sin(w * 2) * 0.06, 0);
    if (hasLegs(an)) {
      an.move('pelvis', 0, Math.abs(sin(w)) * 0.04, 0);
      an.set('thighR', sw * 0.7, 0, 0); an.set('shinR', Math.max(0, -sw) * 0.8, 0, 0);
      an.set('thighL', sw2 * 0.7, 0, 0); an.set('shinL', Math.max(0, -sw2) * 0.8, 0, 0);
    } else {
      an.move('pelvis', 0, sin(t * 3) * 0.09, 0);
    }
    an.set('upperArmR', sw2 * 0.45, 0, -0.25); an.set('upperArmL', sw * 0.45, 0, 0.25);
    if (an.has('ring1')) an.set('ring1', 0, t * 1.6, 0);
    if (an.has('ring2')) an.set('ring2', t * 1.2, 0, 0);
  };
  foe.tell = function (an, t, c) {   // wind-up: clear, readable
    var p = ease(t / Math.max(0.12, c.tell || 0.5));
    an.set('torso', -0.35 * p, 0, 0);
    an.set('head', -0.2 * p, 0, 0);
    an.move('pelvis', 0, -0.12 * p, -0.1 * p);
    an.set('upperArmR', -1.1 * p, 0, -0.5 - 0.3 * p);
    an.set('upperArmL', -1.0 * p, 0, 0.5 + 0.3 * p);
    an.set('lowerArmR', -0.8 * p, 0, 0); an.set('lowerArmL', -0.8 * p, 0, 0);
    if (hasLegs(an)) { an.set('thighR', -0.3 * p, 0, 0); an.set('thighL', 0.25 * p, 0, 0); }
    if (an.has('shell0')) for (var i = 0; i < 4; i++) an.set('shell' + i, -0.9 * p, 0, 0);
    if (an.has('ring1')) an.set('ring1', 0, t * 5, 0);
    if (an.has('gun')) an.set('gun', -0.25 * p, 0, 0);
  };
  foe.attack = function (an, t, c) {
    var w = EH.clamp(t / Math.max(0.12, c.dur || 0.35), 0, 1);
    var hit = pulse(w, 0, 0.35), rec = pulse(w, 0.35, 1);
    an.set('torso', 0.45 * hit - 0.3 * rec, 0, 0);
    an.set('upperArmR', 1.6 * hit - 0.9 * rec, 0, -0.4);
    an.set('upperArmL', 1.4 * hit - 0.8 * rec, 0, 0.4);
    an.set('lowerArmR', 0.5 * hit, 0, 0);
    an.move('pelvis', 0, 0, 0.25 * hit - 0.2 * rec);
    if (an.has('gun')) an.set('gun', 0.3 * hit, 0, 0);
    if (an.has('shell0')) for (var i = 0; i < 4; i++) an.set('shell' + i, -1.5, 0, 0);
    if (an.has('ring1')) an.set('ring1', 0, t * 8, 0);
  };
  foe.hit = function (an, t, c) {
    var p = 1 - ease(t / 0.2);
    an.set('torso', -0.4 * p, 0.25 * p, 0);
    an.set('head', -0.35 * p, 0, 0);
    an.move('pelvis', 0, 0, -0.1 * p);
  };
  foe.death = function (an, t, c) {
    var p = ease(t / 0.55);
    an.set('torso', 0.9 * p, 0.5 * p, 0.3 * p);
    an.set('head', 0.8 * p, 0, 0);
    an.move('pelvis', 0, -0.45 * p, 0);
    if (hasLegs(an)) { an.set('thighR', 1.0 * p, 0, 0); an.set('thighL', 0.8 * p, 0, 0); }
    an.set('upperArmR', 1.0 * p, 0, -0.8 * p); an.set('upperArmL', 0.9 * p, 0, 0.8 * p);
    for (var i = 0; i < 4; i++) if (an.has('shell' + i)) an.set('shell' + i, -1.2 * p, 0, 0);
    an.scale('core', 1 - p * 0.6);
  };

  // ---- boss ----
  var boss = {};
  function bossIdleBase(an, t, s) {
    an.move('pelvis', 0, sin(t * 1.1) * 0.16, 0);
    an.set('torso', sin(t * 0.9) * 0.05, sin(t * 0.4) * 0.12, 0);
    an.set('ring1', 0, t * 0.5 * s, 0);
    an.set('ring2', t * 0.42 * s, 0, 0);
    an.set('ring3', 0, -t * 0.35 * s, t * 0.2 * s);
    an.scale('core', 1 + sin(t * 2.6) * 0.08);
    for (var i = 0; i < 4; i++) {
      an.set('arm' + i, sin(t * 0.8 + i) * 0.12, 0, cos(t * 0.7 + i) * 0.1);
      an.set('forearm' + i, sin(t * 0.9 + i * 1.3) * 0.15, 0, 0);
    }
  }
  boss.intro = function (an, t, c) {
    var p = ease(t / 2.2);
    an.move('pelvis', 0, -6 * (1 - p) + sin(t * 1.1) * 0.16 * p, 0);
    an.set('torso', -0.3 * (1 - p), t * 1.4 * (1 - p), 0);
    an.set('ring1', 0, t * 3 * (1 - p) + t * 0.5, 0);
    an.set('ring2', t * 2 * (1 - p), 0, 0);
    an.scale('core', 0.3 + 0.7 * p + sin(t * 6) * 0.1 * p);
    for (var i = 0; i < 4; i++) {
      an.set('arm' + i, -1.2 * (1 - p), 0, 0);
      an.set('forearm' + i, 1.0 * (1 - p), 0, 0);
    }
  };
  boss.idle = function (an, t, c) { bossIdleBase(an, t, 1 + (c.phase || 0) * 0.4); };
  boss.sweep = function (an, t, c) {
    bossIdleBase(an, t, 1);
    var w = EH.clamp(t / 1.1, 0, 1), wind = pulse(w, 0, 0.4), fire = pulse(w, 0.4, 0.62), rec = pulse(w, 0.62, 1);
    an.set('torso', -0.25 * wind + 0.35 * fire - 0.15 * rec, 0, 0);
    for (var i = 0; i < 4; i++) {
      an.set('arm' + i, -1.0 * wind + 1.5 * fire - 0.5 * rec, 0, (i % 2 ? 1 : -1) * (0.5 * fire));
      an.set('forearm' + i, 0.8 * wind - 1.0 * fire, 0, 0);
    }
    an.scale('core', 1 + wind * 0.35 + fire * 0.2);
  };
  boss.slam = function (an, t, c) {
    bossIdleBase(an, t, 1);
    var w = EH.clamp(t / 1.3, 0, 1), up = pulse(w, 0, 0.45), down = pulse(w, 0.45, 0.58), rec = pulse(w, 0.58, 1);
    an.move('pelvis', 0, 1.4 * up - 2.0 * down + 0.6 * rec, 0);
    for (var i = 0; i < 4; i++) {
      an.set('arm' + i, -1.6 * up + 2.4 * down - 0.8 * rec, 0, 0);
      an.set('forearm' + i, -0.9 * up + 1.3 * down, 0, 0);
    }
    an.set('torso', -0.4 * up + 0.6 * down - 0.2 * rec, 0, 0);
  };
  boss.dash = function (an, t, c) {
    an.set('torso', 0.35, sin(t * 8) * 0.2, 0);
    an.move('pelvis', 0, 0.3 + sin(t * 9) * 0.1, 0);
    an.set('ring1', 0, t * 4, 0); an.set('ring2', t * 3, 0, 0);
    for (var i = 0; i < 4; i++) { an.set('arm' + i, -0.9, 0, 0); an.set('forearm' + i, -0.6, 0, 0); }
    an.scale('core', 1.15 + sin(t * 12) * 0.1);
  };
  boss.spin = function (an, t, c) {
    an.set('torso', 0, t * 4.5, 0);
    an.move('pelvis', 0, 0.5 + sin(t * 2) * 0.2, 0);
    an.set('ring1', 0, t * 6, 0); an.set('ring2', t * 5, 0, 0); an.set('ring3', 0, -t * 4, 0);
    for (var i = 0; i < 4; i++) { an.set('arm' + i, 0.2, 0, (i % 2 ? 1 : -1) * 1.1); an.set('forearm' + i, -0.3, 0, 0); }
    an.scale('core', 1.2 + sin(t * 9) * 0.15);
  };
  boss.phase = function (an, t, c) {
    var p = ease(t / 1.6);
    an.move('pelvis', 0, 1.2 * Math.sin(p * PI), 0);
    an.set('torso', -0.5 * Math.sin(p * PI), t * 5, 0);
    an.set('ring1', 0, t * 9, 0); an.set('ring2', t * 7, 0, 0); an.set('ring3', 0, -t * 6, 0);
    an.scale('core', 1 + Math.sin(p * PI) * 0.9);
    for (var i = 0; i < 4; i++) { an.set('arm' + i, -1.5 * Math.sin(p * PI), 0, 0); }
  };
  boss.hit = function (an, t, c) {
    bossIdleBase(an, t, 1);
    var p = 1 - ease(t / 0.22);
    an.set('torso', -0.18 * p, 0.14 * p, 0);
    an.scale('core', 1 + p * 0.25);
  };
  boss.groggy = function (an, t, c) {   // counter-attack window
    var p = ease(t / 0.5);
    an.move('pelvis', 0, -0.9 * p + sin(t * 2) * 0.05, 0);
    an.set('torso', 0.45 * p, sin(t * 1.2) * 0.25, 0);
    an.set('ring1', 0, t * 0.15, 0); an.set('ring2', t * 0.1, 0, 0);
    an.scale('core', 1.25 + sin(t * 3) * 0.1);
    for (var i = 0; i < 4; i++) { an.set('arm' + i, 0.9 * p, 0, 0); an.set('forearm' + i, 0.7 * p, 0, 0); }
  };
  boss.death = function (an, t, c) {
    var p = ease(t / 3.0);
    an.move('pelvis', 0, -1.6 * p, 0);
    an.set('torso', 0.6 * p, t * (1 - p) * 3, 0.3 * p);
    an.set('ring1', 0, t * 2 * (1 - p), 0); an.set('ring2', t * 1.5 * (1 - p), 0, 0);
    an.scale('core', 1 + Math.sin(t * 8) * 0.3 * (1 - p) - p * 0.7);
    for (var i = 0; i < 4; i++) { an.set('arm' + i, 1.2 * p, 0, (i % 2 ? 1 : -1) * 0.8 * p); an.set('forearm' + i, 0.9 * p, 0, 0); }
  };

  EH.CLIPS = { lian: lian, foe: foe, boss: boss };
  EH.CLIP_COUNT = Object.keys(lian).length + Object.keys(foe).length + Object.keys(boss).length;
})();
