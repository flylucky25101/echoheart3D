'use strict';
// Sprite-sheet frame animator: clip playback + 8-way direction (with mirroring).
(function () {
  var EH = window.EchoHeart;
  var TAU = Math.PI * 2;

  function SpriteAnim(prefix) {
    this.prefixes = Array.isArray(prefix) ? prefix.slice() : [prefix || ''];
    this.prefix = this.prefixes[0];
    this.clip = ''; this.key = ''; this.A = null;
    this.t = 0; this.frame = 0; this.done = false;
    this.stateTime = 0; this.speed = 1;
  }
  SpriteAnim.prototype.setPrefix = function (p) {
    if (this.prefix === p) return;
    this.prefix = p; this.prefixes = [p];
    if (this.clip) this.play(this.clip, true);
  };
  SpriteAnim.prototype.lookup = function (clip) {
    for (var i = 0; i < this.prefixes.length; i++) {
      var k = this.prefixes[i] + ':' + clip;
      if (EH.SpriteAnims[k]) return k;
    }
    return null;
  };
  SpriteAnim.prototype.has = function (clip) { return !!this.lookup(clip); };
  SpriteAnim.prototype.play = function (clip, restart) {
    var key = this.lookup(clip);
    if (!key) return false;
    var A = EH.SpriteAnims[key];
    if (this.key === key && !restart) return true;
    this.clip = clip; this.key = key; this.A = A;
    this.t = 0; this.frame = 0; this.done = false;
    return true;
  };
  SpriteAnim.prototype.update = function (dt) {
    this.stateTime += dt;
    var A = this.A; if (!A) return;
    this.t += dt * this.speed;
    var f = Math.floor(this.t * A.fps);
    if (A.loop) { this.frame = ((f % A.frames) + A.frames) % A.frames; }
    else if (f >= A.frames) { this.frame = A.frames - 1; this.done = true; }
    else this.frame = Math.max(0, f);
  };
  // facing: atan2(dx,dz) — same convention used when baking
  SpriteAnim.prototype.resolve = function (facing) {
    var A = this.A; if (!A) return null;
    var d = Math.round(((facing % TAU) + TAU) % TAU / (TAU / 8)) % 8;
    var flip = false, rd = d;
    if (A.mirror && A.dirs === 5) {
      if (d > 4) { rd = 8 - d; flip = true; }
    } else if (A.dirs === 1) { rd = 0; }
    else if (rd >= A.dirs) { rd = A.dirs - 1; }
    return { cell: rd * A.frames + this.frame, flipX: flip, A: A };
  };
  EH.SpriteAnim = SpriteAnim;
})();
