'use strict';
// Input: keyboard/mouse + floating virtual joystick + multitouch action buttons.
(function () {
  var EH = window.EchoHeart;

  function Input() {
    this.keys = {};
    this.moveX = 0; this.moveZ = 0;
    this.aimX = 0; this.aimZ = 1;
    this.attackHeld = false;
    this._edge = { dash: false, skill: false, ult: false, pause: false, confirm: false, attackTap: false };
    this.joy = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, mag: 0, radius: 70 };
    this.buttons = { attack: false, dash: false, skill: false, ult: false };
    this._btnPointers = {};
    this.enabled = true;
    this.pointerInWorld = false;
    this.mouse = { x: 0, y: 0, down: false };
  }

  Input.prototype.attach = function (canvas, uiRoot) {
    var self = this;
    this.canvas = canvas;

    window.addEventListener('keydown', function (e) {
      if (!self.enabled) return;
      var k = e.key.toLowerCase();
      if (self.keys[k]) { if (isGameKey(k)) e.preventDefault(); return; }
      self.keys[k] = true;
      if (k === 'k' || k === 'shift') self._edge.dash = true;
      if (k === 'l') self._edge.skill = true;
      if (k === ' ') self._edge.ult = true;
      if (k === 'escape') self._edge.pause = true;
      if (k === 'enter') self._edge.confirm = true;
      if (k === 'j') self._edge.attackTap = true;
      if (isGameKey(k)) e.preventDefault();
    }, { passive: false });
    window.addEventListener('keyup', function (e) {
      var k = e.key.toLowerCase(); self.keys[k] = false;
    });
    window.addEventListener('blur', function () { self.releaseAll(); });

    function isGameKey(k) {
      return ['w', 'a', 's', 'd', 'j', 'k', 'l', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0;
    }

    // ---- pointer (canvas = world area; joystick on left half) ----
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      if (!self.enabled) return;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      var r = canvas.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.pointerType === 'mouse') {
        // Only the left button counts as "attack held". Setting mouse.down for
        // any button made right-click raise attackHeld, so right-click fired an
        // attack and swallowed the skill.
        if (e.button === 0) { self.mouse.down = true; self._edge.attackTap = true; }
        if (e.button === 2) self._edge.skill = true;
        return;
      }
      if (x < r.width * 0.5 && self.joy.id < 0) {
        self.joy.active = true; self.joy.id = e.pointerId;
        self.joy.ox = x; self.joy.oy = y; self.joy.x = 0; self.joy.y = 0; self.joy.mag = 0;
      }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!self.enabled) return;
      var r = canvas.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      self.mouse.x = x; self.mouse.y = y;
      if (e.pointerId === self.joy.id && self.joy.active) {
        var dx = x - self.joy.ox, dy = y - self.joy.oy;
        var sens = EH.Settings.get('joystickSens') || 1;
        var rad = self.joy.radius / sens;
        var d = Math.hypot(dx, dy);
        if (d > rad) { dx = dx / d * rad; dy = dy / d * rad; d = rad; }
        self.joy.x = dx / rad; self.joy.y = dy / rad; self.joy.mag = d / rad;
      }
    });
    function endPointer(e) {
      if (e.pointerId === self.joy.id) {
        self.joy.active = false; self.joy.id = -1; self.joy.x = 0; self.joy.y = 0; self.joy.mag = 0;
      }
      if (e.pointerType === 'mouse' && e.button !== 2) self.mouse.down = false;
      for (var role in self._btnPointers) {
        if (self._btnPointers[role] === e.pointerId) { self.buttons[role] = false; delete self._btnPointers[role]; }
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('lostpointercapture', endPointer);
    window.addEventListener('touchcancel', function () { self.releaseAll(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) self.releaseAll(); });
  };

  // bind a DOM element as an action button (proper CSS states, no canvas hit-test)
  Input.prototype.bindButton = function (el, role) {
    if (!el) return;
    var self = this;
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!self.enabled) return;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      self._btnPointers[role] = e.pointerId;
      self.buttons[role] = true;
      el.classList.add('is-pressed');
      if (role === 'dash') self._edge.dash = true;
      if (role === 'skill') self._edge.skill = true;
      if (role === 'ult') self._edge.ult = true;
      if (role === 'attack') self._edge.attackTap = true;
    });
    function up(e) {
      e.preventDefault(); e.stopPropagation();
      self.buttons[role] = false; delete self._btnPointers[role];
      el.classList.remove('is-pressed');
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', function (e) {
      if (self._btnPointers[role] === e.pointerId) up(e);
    });
  };

  Input.prototype.releaseAll = function () {
    this.keys = {};
    this.joy.active = false; this.joy.id = -1; this.joy.x = this.joy.y = this.joy.mag = 0;
    for (var r in this.buttons) this.buttons[r] = false;
    this._btnPointers = {};
    this.mouse.down = false;
    this.attackHeld = false;
    var els = document.querySelectorAll('.is-pressed');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('is-pressed');
  };

  Input.prototype.update = function () {
    var kx = 0, kz = 0;
    if (this.keys['a'] || this.keys['arrowleft']) kx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) kx += 1;
    if (this.keys['w'] || this.keys['arrowup']) kz -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) kz += 1;
    var kl = Math.hypot(kx, kz);
    if (kl > 1) { kx /= kl; kz /= kl; }
    if (this.joy.mag > 0.12) {
      // screen -> world (camera looks down -Z): screen up = -Z
      var dz = 0.12, m = (this.joy.mag - dz) / (1 - dz);
      var l = Math.hypot(this.joy.x, this.joy.y) || 1;
      this.moveX = (this.joy.x / l) * m;
      this.moveZ = (this.joy.y / l) * m;
    } else { this.moveX = kx; this.moveZ = kz; }
    this.attackHeld = !!(this.keys['j'] || this.buttons.attack || this.mouse.down);
  };

  Input.prototype.take = function (name) {
    var v = this._edge[name]; this._edge[name] = false; return v;
  };
  EH.Input = new Input();
})();
