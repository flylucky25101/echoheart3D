'use strict';
// Perspective oblique top-down camera: follow, lead, shake, bounds.
(function () {
  var EH = window.EchoHeart, M = null;
  function Camera() {
    M = EH.M;
    this.target = [0, 0, 0];
    this.center = [0, 0, 0];
    this.eye = [0, 12, 12];
    this.rise = 0; this.riseT = 0; this.riseAmt = 0; this.riseDur = 0.9;
    this.dist = EH.CONFIG.camDist;
    this.height = EH.CONFIG.camHeight;
    this.fov = EH.CONFIG.camFov * EH.deg;
    this.view = M.Mat4.create();
    this.proj = M.Mat4.create();
    // 0.6 was a huge jolt that read as juddering rather than impact
    this.shakeAmt = 0; this.shakeMax = 0.15; this.shakeT = 0;
    this.zoom = 1; this.zoomTarget = 1;
    this.up = [0, 1, 0];
    this._so = [0, 0, 0];
    this.bounds = EH.CONFIG.floorHalf;
  }
  Camera.prototype.setTargetImmediate = function (x, z) {
    this.target[0] = x; this.target[2] = z;
    this.center[0] = x; this.center[2] = z; this.center[1] = 0.6;
  };
  Camera.prototype.shake = function (a) {
    if (EH.Settings.get('reduceMotion')) a *= 0.25;
    var cap = EH.Settings.get('screenShake');
    if (cap <= 0) { this.shakeAmt = 0; return; }
    this.shakeAmt = Math.min(this.shakeMax * cap, Math.max(this.shakeAmt, a));
  };
  Camera.prototype.setZoom = function (z) { this.zoomTarget = z; };
  Camera.prototype.startRise = function (amount, dur) {
    this.riseAmt = amount; this.riseDur = dur || 0.9; this.riseT = this.riseDur;
  };
  Camera.prototype.update = function (dt, px, pz, leadX, leadZ) {
    var b = this.bounds - 1.5;
    var tx = EH.clamp(px + (leadX || 0) * EH.CONFIG.camLookLead, -b, b);
    var tz = EH.clamp(pz + (leadZ || 0) * EH.CONFIG.camLookLead, -b, b);
    var k = 1 - Math.exp(-EH.CONFIG.camFollowLerp * dt);
    this.target[0] += (tx - this.target[0]) * k;
    this.target[2] += (tz - this.target[2]) * k;
    this.center[0] = this.target[0]; this.center[2] = this.target[2]; this.center[1] = 0.7;
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-6 * dt));
    this.shakeT += dt * 40;
    var s = this.shakeAmt;
    this._so[0] = Math.sin(this.shakeT * 1.7) * s;
    this._so[1] = Math.sin(this.shakeT * 2.3 + 1.0) * s * 0.6;
    this._so[2] = Math.cos(this.shakeT * 1.9) * s;
    // faster settle: at -9 the half-life was ~0.11s, so hits landing more
    // often than that kept the camera shaking continuously (71% of frames)
    this.shakeAmt *= Math.exp(-16 * dt);
    if (this.shakeAmt < 0.004) this.shakeAmt = 0;
    // ascent offset: the arena rises into view when a new floor begins
    if (this.riseT > 0) {
      this.riseT = Math.max(0, this.riseT - dt);
      var rk = this.riseT / this.riseDur;
      this.rise = -this.riseAmt * rk * rk;      // ease-out from below
    } else { this.rise = 0; }
    var d = this.dist * this.zoom, h = this.height * this.zoom + this.rise;
    this.eye[0] = this.center[0] + this._so[0];
    this.eye[1] = h + this._so[1];
    this.eye[2] = this.center[2] + d + this._so[2];
    var c2 = [this.center[0] + this._so[0], this.center[1] + this._so[1], this.center[2] + this._so[2]];
    M.Mat4.lookAt(this.view, this.eye, c2, this.up);
  };
  Camera.prototype.updateProj = function (aspect) {
    M.Mat4.perspective(this.proj, this.fov, aspect, 0.1, 120);
  };
  EH.Camera = Camera;
})();
