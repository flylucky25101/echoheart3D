'use strict';
// Web Audio synthesis: all SFX + adaptive music. No audio files.
(function () {
  var EH = window.EchoHeart;

  function Audio() {
    this.ctx = null; this.ok = false; this.enabled = true;
    this.master = null; this.sfxBus = null; this.musBus = null;
    this.music = { on: false, next: 0, step: 0, intensity: 0, phase: 0, tempo: 2.0 };
  }
  Audio.prototype.init = function () {
    if (this.ctx) return this.ok;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.ok = false; return false; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musBus = this.ctx.createGain();
      this.sfxBus.connect(this.master); this.musBus.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
      this.ok = true;
    } catch (e) { EH.warn('오디오 초기화 실패(무음으로 계속):', e); this.ok = false; }
    return this.ok;
  };
  Audio.prototype.resume = function () {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { } }
  };
  Audio.prototype.applyVolumes = function () {
    if (!this.ok) return;
    var S = EH.Settings;
    this.master.gain.value = S.get('masterVol');
    this.sfxBus.gain.value = S.get('sfxVol');
    this.musBus.gain.value = S.get('musicVol') * 0.6;
  };
  Audio.prototype._env = function (node, t, a, d, peak) {
    var g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  Audio.prototype.tone = function (o) {
    if (!this.ok || !this.enabled) return;
    var c = this.ctx, t = c.currentTime + (o.delay || 0);
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.dur || 0.2));
    var dest = g;
    if (o.filter) {
      var flt = c.createBiquadFilter();
      flt.type = o.filterType || 'lowpass';
      flt.frequency.setValueAtTime(o.filter, t);
      if (o.filter2) flt.frequency.exponentialRampToValueAtTime(Math.max(60, o.filter2), t + (o.dur || 0.2));
      flt.Q.value = o.q || 1;
      g.connect(flt); flt.connect(o.bus || this.sfxBus); dest = g;
    } else { g.connect(o.bus || this.sfxBus); }
    osc.connect(g);
    this._env(g, t, o.a || 0.005, o.dur || 0.2, o.gain == null ? 0.25 : o.gain);
    osc.start(t); osc.stop(t + (o.a || 0.005) + (o.dur || 0.2) + 0.05);
  };
  Audio.prototype.noise = function (o) {
    if (!this.ok || !this.enabled) return;
    var c = this.ctx, t = c.currentTime + (o.delay || 0);
    var dur = o.dur || 0.15;
    var len = Math.max(1, Math.floor(c.sampleRate * (dur + 0.05)));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource(); src.buffer = buf;
    var flt = c.createBiquadFilter();
    flt.type = o.filterType || 'bandpass';
    flt.frequency.setValueAtTime(o.filter || 900, t);
    if (o.filter2) flt.frequency.exponentialRampToValueAtTime(Math.max(60, o.filter2), t + dur);
    flt.Q.value = o.q || 1.2;
    var g = c.createGain();
    src.connect(flt); flt.connect(g); g.connect(o.bus || this.sfxBus);
    this._env(g, t, o.a || 0.004, dur, o.gain == null ? 0.3 : o.gain);
    src.start(t); src.stop(t + dur + 0.06);
  };

  var R = {
    menuMove: function (A) { A.tone({ f: 520, f2: 640, dur: 0.07, type: 'triangle', gain: 0.10 }); },
    menuSelect: function (A) { A.tone({ f: 380, f2: 760, dur: 0.14, type: 'square', gain: 0.10, filter: 2200 }); },
    attack: function (A) { A.noise({ filter: 1500, filter2: 500, dur: 0.10, gain: 0.20 }); A.tone({ f: 260, f2: 150, dur: 0.09, type: 'sawtooth', gain: 0.12, filter: 1400 }); },
    comboFinish: function (A) { A.noise({ filter: 2400, filter2: 300, dur: 0.22, gain: 0.30 }); A.tone({ f: 180, f2: 70, dur: 0.26, type: 'sawtooth', gain: 0.22, filter: 1200 }); },
    bowShot: function (A) { A.tone({ f: 900, f2: 1700, dur: 0.10, type: 'triangle', gain: 0.16 }); A.noise({ filter: 3000, filter2: 1200, dur: 0.07, gain: 0.12 }); },
    projectileHit: function (A) { A.tone({ f: 640, f2: 220, dur: 0.10, type: 'sine', gain: 0.14 }); A.noise({ filter: 1800, dur: 0.07, gain: 0.10 }); },
    // Enemy muzzle report. Pitched well below bowShot and much drier, so the
    // player can tell incoming fire from their own without looking away from
    // whatever they are dodging.
    enemyShot: function (A) { A.tone({ f: 300, f2: 130, dur: 0.09, type: 'square', gain: 0.11, filter: 1100 }); A.noise({ filter: 2000, filter2: 600, dur: 0.06, gain: 0.09 }); },
    skill: function (A) { A.tone({ f: 160, f2: 620, dur: 0.32, type: 'sawtooth', gain: 0.20, filter: 900, filter2: 3000 }); },
    ult: function (A) {
      A.tone({ f: 90, f2: 420, dur: 0.85, type: 'sawtooth', gain: 0.26, filter: 600, filter2: 3600 });
      A.tone({ f: 240, f2: 900, dur: 0.7, type: 'square', gain: 0.12, filter: 2400, delay: 0.05 });
      A.noise({ filter: 400, filter2: 4000, dur: 0.8, gain: 0.18 });
    },
    dash: function (A) { A.noise({ filter: 2600, filter2: 700, dur: 0.16, gain: 0.16 }); },
    hurt: function (A) { A.tone({ f: 200, f2: 80, dur: 0.22, type: 'square', gain: 0.20, filter: 800 }); A.noise({ filter: 500, dur: 0.16, gain: 0.16 }); },
    crit: function (A) { A.tone({ f: 1200, f2: 500, dur: 0.16, type: 'square', gain: 0.16, filter: 3000 }); A.noise({ filter: 3200, filter2: 800, dur: 0.14, gain: 0.18 }); },
    enemyDeath: function (A) { A.tone({ f: 300, f2: 60, dur: 0.30, type: 'sawtooth', gain: 0.18, filter: 1200, filter2: 200 }); A.noise({ filter: 900, filter2: 150, dur: 0.28, gain: 0.16 }); },
    eliteSpawn: function (A) { A.tone({ f: 70, f2: 180, dur: 0.6, type: 'sawtooth', gain: 0.22, filter: 500 }); A.tone({ f: 320, f2: 200, dur: 0.5, type: 'square', gain: 0.10, delay: 0.08 }); },
    echoPick: function (A) { A.tone({ f: 520, f2: 1040, dur: 0.28, type: 'triangle', gain: 0.16 }); A.tone({ f: 780, f2: 1560, dur: 0.24, type: 'sine', gain: 0.10, delay: 0.06 }); },
    metaUpgrade: function (A) { A.tone({ f: 300, f2: 900, dur: 0.4, type: 'square', gain: 0.14, filter: 2400 }); A.tone({ f: 600, f2: 1200, dur: 0.3, type: 'triangle', gain: 0.10, delay: 0.1 }); },
    revive: function (A) {
      A.tone({ f: 120, f2: 700, dur: 0.7, type: 'sawtooth', gain: 0.24, filter: 700, filter2: 3200 });
      A.tone({ f: 440, f2: 880, dur: 0.5, type: 'sine', gain: 0.14, delay: 0.1 });
      A.noise({ filter: 300, filter2: 3000, dur: 0.6, gain: 0.16 });
    },
    playerDeath: function (A) {
      A.tone({ f: 260, f2: 40, dur: 1.2, type: 'sawtooth', gain: 0.26, filter: 1400, filter2: 120 });
      A.noise({ filter: 700, filter2: 90, dur: 1.1, gain: 0.20 });
    },
    bossIntro: function (A) {
      A.tone({ f: 40, f2: 90, dur: 2.0, type: 'sawtooth', gain: 0.30, filter: 300, filter2: 900 });
      A.tone({ f: 160, f2: 120, dur: 1.6, type: 'square', gain: 0.12, delay: 0.2, filter: 800 });
      A.noise({ filter: 200, filter2: 1800, dur: 1.8, gain: 0.16 });
    },
    bossPhase: function (A) {
      A.tone({ f: 70, f2: 260, dur: 0.9, type: 'sawtooth', gain: 0.28, filter: 400, filter2: 2600 });
      A.noise({ filter: 300, filter2: 3000, dur: 0.8, gain: 0.20 });
    },
    bossDeath: function (A) {
      A.tone({ f: 200, f2: 30, dur: 2.4, type: 'sawtooth', gain: 0.30, filter: 1600, filter2: 80 });
      A.noise({ filter: 900, filter2: 60, dur: 2.2, gain: 0.24 });
      A.tone({ f: 600, f2: 100, dur: 1.4, type: 'triangle', gain: 0.14, delay: 0.3 });
    },
    victory: function (A) {
      [523, 659, 784, 1047].forEach(function (f, i) {
        A.tone({ f: f, dur: 0.5, type: 'triangle', gain: 0.16, delay: i * 0.13 });
      });
    }
  };
  Audio.prototype.play = function (name) {
    if (!this.ok || !this.enabled) return;
    var r = R[name]; if (r) { try { r(this); } catch (e) { } }
  };

  // ---- adaptive music: drone + bass sequence + hats ----
  var SCALE = [0, 3, 5, 7, 10];
  Audio.prototype.startMusic = function () {
    if (!this.ok) return;
    this.music.on = true;
    this.music.next = this.ctx.currentTime + 0.1;
    if (!this.drone) {
      var c = this.ctx;
      this.drone = c.createOscillator(); this.drone2 = c.createOscillator();
      this.droneG = c.createGain(); this.droneF = c.createBiquadFilter();
      this.drone.type = 'sawtooth'; this.drone2.type = 'sine';
      this.drone.frequency.value = 55; this.drone2.frequency.value = 27.5;
      this.droneF.type = 'lowpass'; this.droneF.frequency.value = 320; this.droneF.Q.value = 3;
      this.droneG.gain.value = 0.10;
      this.drone.connect(this.droneF); this.drone2.connect(this.droneF);
      this.droneF.connect(this.droneG); this.droneG.connect(this.musBus);
      try { this.drone.start(); this.drone2.start(); } catch (e) { }
    }
  };
  Audio.prototype.stopMusic = function () {
    this.music.on = false;
    if (this.droneG) try { this.droneG.gain.value = 0; } catch (e) { }
  };
  Audio.prototype.setIntensity = function (v, phase) {
    this.music.intensity = EH.clamp(v, 0, 1);
    this.music.phase = phase || 0;
    if (this.droneF) {
      this.droneF.frequency.value = 260 + this.music.intensity * 900 + this.music.phase * 200;
      this.droneG.gain.value = (this.music.on ? 0.09 : 0) + this.music.intensity * 0.05;
    }
  };
  Audio.prototype.updateMusic = function () {
    if (!this.ok || !this.music.on || !this.enabled) return;
    var c = this.ctx, m = this.music;
    var beat = 60 / (86 + m.intensity * 34 + m.phase * 10) ;
    while (m.next < c.currentTime + 0.25) {
      var t = m.next, s = m.step % 16;
      var root = 55 * (m.phase >= 2 ? 1.122 : 1);
      // bass
      if (s % 4 === 0) {
        var n = SCALE[(m.step / 4 | 0) % SCALE.length];
        this.tone({ f: root * Math.pow(2, n / 12), dur: beat * 1.6, type: 'sawtooth', gain: 0.13 + m.intensity * 0.05, filter: 400 + m.intensity * 700, bus: this.musBus, delay: Math.max(0, t - c.currentTime) });
      }
      // arp when intense
      if (m.intensity > 0.3 && s % 2 === 1) {
        var n2 = SCALE[(m.step * 3) % SCALE.length];
        this.tone({ f: root * 4 * Math.pow(2, n2 / 12), dur: beat * 0.5, type: 'triangle', gain: 0.05 + m.intensity * 0.04, bus: this.musBus, delay: Math.max(0, t - c.currentTime) });
      }
      // hat
      if (m.intensity > 0.15 && s % 2 === 0) {
        this.noise({ filter: 6000, dur: 0.04, gain: 0.03 + m.intensity * 0.04, bus: this.musBus, delay: Math.max(0, t - c.currentTime) });
      }
      // kick
      if (s === 0 || s === 8 || (m.intensity > 0.6 && s === 12)) {
        this.tone({ f: 110, f2: 40, dur: 0.18, type: 'sine', gain: 0.18, bus: this.musBus, delay: Math.max(0, t - c.currentTime) });
      }
      m.next += beat; m.step++;
    }
  };
  EH.Audio = new Audio();
})();
