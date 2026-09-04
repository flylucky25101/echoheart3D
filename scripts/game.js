'use strict';
// Main engine: init, single rAF loop, 3D scene rendering, run lifecycle, hub.
(function () {
  var EH = window.EchoHeart;
  var M = null;

  var HUB_DEVICES = [
    { kind: 'weapon', mesh: 'device', x: -5.0, z: -2.0, label: '무기 선택대' },
    { kind: 'growth', mesh: 'forge', x: 0, z: -5.0, label: '영구 성장 (잔향의 대장간)' },
    { kind: 'adapt', mesh: 'altar', x: 5.0, z: -2.0, label: '사망 적응 기록' },
    { kind: 'abyss', mesh: 'altar', x: -5.0, z: 3.0, label: '심연 단계' },
    { kind: 'records', mesh: 'device', x: 5.0, z: 3.0, label: '기록 홀로그램' },
    { kind: 'settings', mesh: 'device', x: 0, z: 5.5, label: '설정 장치' },
    { kind: 'portal', mesh: 'door', x: 0, z: -8.0, label: '새 런 포털' }
  ];

  function Game() {
    this.mode = 'boot';
    this.paused = false; this.runOver = false;
    this.save = EH.Save;
    this.stats = null; this.run = null;
    this.last = 0; this.acc = 0; this.started = false;
    this.hubTargets = [];
    this.numEls = []; this.numPool = 12;
    this._m = null; this._tmp = [0, 0, 0];
    this.contextLost = false;
    this.frame = 0;
    this.spawnQueue = [];
    this.roomToken = 0;
    this.initPerf();
  }

  // ---------------- init ----------------
  Game.prototype.init = function () {
    M = EH.M;
    this._m = M.Mat4.create();
    EH.UI.init();
    EH.Scenes.init(this);
    this.save.load();
    EH.Scenes.goLoading();

    this.canvas = document.getElementById('gl');
    this.renderer = new EH.Renderer(this.canvas);
    this.renderer.lowSpec = this.save.get('lowSpec');
    this.renderer.wantBloom = this.save.get('bloom') !== false;
    if (!this.renderer.init()) {
      EH.Scenes.goError('WebGL 2를 초기화할 수 없습니다. 최신 브라우저에서 하드웨어 가속을 켜고 다시 시도해 주세요.',
        this.renderer.errors.join('\n'));
      return;
    }
    this.cam = new EH.Camera();
    this.world = new EH.World(this);
    this.world.player = new EH.Player(this.world);
    this.stats = EH.Prog.computeStats(this.save.data, {});
    this.world.player.applyStats(this.stats);
    this.world.player.weapon = this.save.data.weapon;

    EH.Input.attach(this.canvas, document.getElementById('hud'));
    this.bindUI();
    this.applyButtonScale();

    var self = this;
    this.loader = new EH.TextureLoader();
    this.loader.loadAll(EH.AssetManifest,
      function (d, t) { EH.Scenes.loadProgress(d, t); },
      function () { self.onAssetsLoaded(); });

    window.addEventListener('resize', function () { self.resize(); });
    window.addEventListener('orientationchange', function () { setTimeout(function () { self.resize(); }, 120); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { self.paused = true; EH.Input.releaseAll(); }
      else { self.last = EH.now(); }
    });
    this.canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); self.contextLost = true; self.paused = true;
      EH.Scenes.goError('그래픽 컨텍스트가 손실되었습니다. 복구를 시도합니다.');
    });
    this.canvas.addEventListener('webglcontextrestored', function () { self.restoreContext(); });
    window.addEventListener('error', function (ev) {
      EH.err('[onerror]', ev.message, ev.filename, ev.lineno);
      if (!self.started) EH.Scenes.goError('초기화 중 오류가 발생했습니다.', ev.message + '\n' + ev.filename + ':' + ev.lineno);
    });
    window.addEventListener('unhandledrejection', function (ev) {
      EH.err('[unhandledrejection]', ev.reason);
    });
    // first gesture unlocks audio
    var unlock = function () {
      EH.Audio.init(); EH.Audio.resume(); EH.Audio.applyVolumes();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.resize();
  };

  Game.prototype.onAssetsLoaded = function () {
    var failed = this.loader.failed;
    this.renderer.bindTextures(this.loader);
    var n = this.renderer.uploadAll();
    EH.log('meshes uploaded:', n);
    this.renderer.spriteTex = {};
    if (EH.SpriteImported) {
      for (var sn in EH.SpriteImported) {
        var meta = EH.SpriteImported[sn], img = this.loader.images[meta.key];
        if (img) this.renderer.spriteTex[sn] = this.renderer.textureFromImage(meta.key, img);
      }
    }
    if (failed.length > this.loader.total * 0.5) {
      EH.Scenes.goError('필수 텍스처를 불러오지 못했습니다 (' + failed.length + '개 실패).',
        failed.slice(0, 20).join('\n'));
      return;
    }
    if (failed.length) EH.UI.toast(failed.length + '개 텍스처가 대체 재질로 표시됩니다.');
    this.buildNumberPool();
    this.started = true;
    this.enterHub();
    EH.Scenes.goTitle();
    this.last = EH.now();
    var self = this;
    if (!this._raf) this._raf = requestAnimationFrame(function (t) { self.loop(t); });
  };
  Game.prototype.retryInit = function () {
    if (this.started) { EH.Scenes.goTitle(); return; }
    window.location.reload();
  };
  Game.prototype.restoreContext = function () {
    try {
      this.renderer.dispose();
      if (!this.renderer.init()) throw new Error('renderer re-init failed');
      this.renderer.bindTextures(this.loader);
      this.renderer.uploadAll();
      this.contextLost = false; this.paused = false;
      EH.UI.close(); EH.UI.toast('그래픽이 복구되었습니다.');
      this.last = EH.now();
    } catch (e) {
      EH.err(e);
      EH.Scenes.goError('그래픽 복구에 실패했습니다.', String(e));
    }
  };

  Game.prototype.bindUI = function () {
    var self = this, E = EH.UI.el;
    EH.Input.bindButton(E.btnAttack, 'attack');
    EH.Input.bindButton(E.btnDash, 'dash');
    EH.Input.bindButton(E.btnSkill, 'skill');
    EH.Input.bindButton(E.btnUlt, 'ult');
    E.btnPause.addEventListener('click', function (e) {
      e.preventDefault();
      if (self.mode === 'run' && !self.paused && !self.runOver) EH.Scenes.goPause();
    });
  };
  Game.prototype.applyButtonScale = function () {
    var s = this.save.get('buttonScale');
    var pad = document.querySelector('.action-pad');
    if (pad) { pad.style.transform = 'scale(' + s + ')'; pad.style.transformOrigin = 'bottom right'; }
  };
  Game.prototype.applyLowSpec = function () {
    this.renderer.lowSpec = this.save.get('lowSpec');
    this.applyBloom();
    this.resize();
  };
  Game.prototype.applyBloom = function () {
    var on = this.save.get('bloom');
    this.renderer.wantBloom = (on == null) ? true : !!on;
  };
  Game.prototype.vibrate = function (ms) {
    if (!this.save.get('vibration')) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { } }
  };
  Game.prototype.resize = function () {
    var w = window.innerWidth, h = window.innerHeight;
    var aspect = this.renderer.resize(w, h, 2);
    this.cam.updateProj(aspect);
    var portrait = h > w * 1.05;
    document.getElementById('portrait').classList.toggle('hidden', !(portrait && this.mode === 'run'));
  };

  // ---------------- damage number DOM pool ----------------
  Game.prototype.buildNumberPool = function () {
    var host = document.getElementById('hud');
    this.numLayer = document.createElement('div');
    this.numLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    host.appendChild(this.numLayer);
    for (var i = 0; i < 26; i++) {
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;font-weight:900;font-size:21px;letter-spacing:-0.5px;' +
        'text-shadow:0 2px 8px #000,0 0 14px rgba(0,0,0,.9);' +
        'transform:translate(-50%,-50%);display:none;white-space:nowrap;';
      this.numLayer.appendChild(d);
      this.numEls.push(d);
    }
  };
  Game.prototype.buildHudFx = function () {
    if (this._fxBuilt) return;
    this._fxBuilt = true;
    var hud = document.getElementById('hud');
    var host = (hud && hud.parentNode) || document.body;
    if (!host || !host.appendChild) { this.ehpEls = []; return; }
    function mk(cls, parent) { var d = document.createElement('div'); if (cls) d.className = cls; (parent || host).appendChild(d); return d; }
    var fx = mk(''); fx.id = 'fxLayer';
    this.fx = {
      vig: mk('vignette', fx), hurt: mk('hurtflash', fx), ult: mk('ultflash', fx),
      banner: mk('phase-banner', fx), streak: mk('streak-pop', fx),
      fps: mk('fps-readout', fx)
    };
    // tower climb indicator: which floor, which district, how far up
    var tw = mk('tower-hud', fx);
    var tf = mk('t-floor', tw), tt = mk('t-tier', tw);
    var tr = mk('t-track', tw); var tb = mk('t-bar', tr);
    this.fx.towerWrap = tw; this.fx.towerFloor = tf;
    this.fx.towerTier = tt; this.fx.towerBar = tb;
    var eh = mk(''); eh.id = 'ehpLayer'; fx.appendChild(eh);
    this.fx.vig.style.opacity = 0; this.fx.hurt.style.opacity = 0; this.fx.ult.style.opacity = 0;
    this.ehpLayer = eh; this.ehpEls = [];
    for (var i = 0; i < 28; i++) { var b = document.createElement('div'); b.className = 'ehp'; var f = document.createElement('div'); f.className = 'f'; b.appendChild(f); b._fill = f; eh.appendChild(b); this.ehpEls.push(b); }
    // room progress dots (own absolutely-positioned strip near the top-centre)
    var rd = mk('room-dots', fx);
    rd.style.position = 'absolute'; rd.style.top = '46px'; rd.style.left = '0'; rd.style.right = '0';
    this.roomDots = rd;
  };
  Game.prototype.showBanner = function (main, sub) {
    if (!this.fx || !this.fx.banner) return;
    var b = this.fx.banner; b.innerHTML = main + (sub ? '<small>' + sub + '</small>' : '');
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  };
  Game.prototype.streakPop = function (txt) {
    if (!this.fx || !this.fx.streak) return;
    var b = this.fx.streak; b.textContent = txt;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  };
  Game.prototype.hurtFlash = function () { if (this.fx) this.fx.hurt.style.opacity = 0.9; };
  Game.prototype.ultFlash = function (tint, peak) {
    if (!this.fx) return;
    if (tint) {
      var rgb = (tint[0] * 255 | 0) + ',' + (tint[1] * 255 | 0) + ',' + (tint[2] * 255 | 0);
      this.fx.ult.style.background = 'radial-gradient(circle at center, rgba(' + rgb + ',0) 22%, rgba(' + rgb + ',0.6) 100%)';
    }
    var cur = parseFloat(this.fx.ult.style.opacity) || 0;
    this.fx.ult.style.opacity = Math.max(cur, peak == null ? 1 : peak);
  };
  Game.prototype.updateHudFx = function (dt) {
    if (!this._fxBuilt) this.buildHudFx();
    if (!this.fx) return;
    var run = (this.mode === 'run' && !this.runOver);
    // low-hp danger vignette (pulsing)
    var p = this.world.player, vig = 0;
    if (run && p && !p.dead) {
      var frac = p.hp / p.maxHp;
      if (frac < 0.34) { var ct = (this.renderer && this.renderer.time) || 0; vig = (0.35 + (0.34 - frac) * 2) * (0.7 + 0.3 * Math.sin(ct * 8)); }
    }
    this.fx.vig.style.opacity = (vig > 0 ? vig : 0);
    // tower climb indicator
    if (this.fx.towerWrap) {
      if (run) {
        this.fx.towerWrap.style.display = 'flex';
        var tier = this.currentTier(), fl = this.currentFloor();
        if (this._lastFloor !== fl) {
          this._lastFloor = fl;
          this.fx.towerFloor.textContent = fl + '층';
          this.fx.towerTier.textContent = tier.name;
          this.fx.towerWrap.setAttribute('data-tier', tier.id);
        }
        var total = EH.Rooms.TOTAL;
        var prog = EH.clamp(((this.run.roomIndex + 1) / (total + 1)), 0, 1);
        this.fx.towerBar.style.height = (prog * 100).toFixed(1) + '%';
      } else if (this.fx.towerWrap.style.display !== 'none') {
        this.fx.towerWrap.style.display = 'none';
        this._lastFloor = null;
      }
    }
    // fps / adaptive-resolution readout (settings toggle)
    if (this.fx.fps) {
      var showFps = EH.Settings.get('showFps');
      if (showFps) {
        var pf = this.perf;
        this.fx.fps.style.display = 'block';
        this._fpsT = (this._fpsT || 0) + dt;
        if (this._fpsT > 0.25) {
          this._fpsT = 0;
          this.fx.fps.textContent = (pf ? pf.fps.toFixed(0) : '--') + ' fps  x' +
            (pf ? pf.scale.toFixed(2) : '1.00') +
            '  draw ' + (this.renderer.lastDrawCalls || 0);
        }
      } else if (this.fx.fps.style.display !== 'none') {
        this.fx.fps.style.display = 'none';
      }
    }
    // decay flashes
    var hf = parseFloat(this.fx.hurt.style.opacity) || 0; if (hf > 0) this.fx.hurt.style.opacity = Math.max(0, hf - dt * 3.2);
    var uf = parseFloat(this.fx.ult.style.opacity) || 0; if (uf > 0) this.fx.ult.style.opacity = Math.max(0, uf - dt * 1.05);
    // enemy hp bars
    this.updateEnemyBars(run);
    // room dots
    this.updateRoomDots();
  };
  Game.prototype.updateEnemyBars = function (run) {
    if (!this.ehpEls) return;
    var i = 0, self = this, pt = this._tmp, w = this.world;
    if (run) {
      for (var k = 0; k < w.enemies.length && i < this.ehpEls.length; k++) {
        var e = w.enemies[k];
        if (!e.alive || e.dying || e.hp >= e.maxHp - 0.5) continue;
        var top = (e.def && e.def.floaty ? 1.5 : 1.8);
        if (!this.project(e.x, top, e.z, pt)) continue;
        var bar = this.ehpEls[i++]; bar.style.display = 'block';
        bar.style.left = pt[0] + 'px'; bar.style.top = pt[1] + 'px';
        bar.classList.toggle('elite', !!e.elite);
        bar._fill.style.width = (EH.clamp(e.hp / e.maxHp, 0, 1) * 100) + '%';
      }
    }
    for (; i < this.ehpEls.length; i++) this.ehpEls[i].style.display = 'none';
  };
  Game.prototype.updateRoomDots = function () {
    if (!this.roomDots) return;
    var r = this.run, total = EH.Rooms.TOTAL + 1;
    if (!r || this.mode !== 'run') { this.roomDots.style.display = 'none'; return; }
    this.roomDots.style.display = 'flex';
    if (this.roomDots.childElementCount !== total) {
      this.roomDots.innerHTML = '';
      for (var i = 0; i < total; i++) { var d = document.createElement('div'); d.className = 'd' + (i === total - 1 ? ' boss' : ''); this.roomDots.appendChild(d); }
    }
    for (var j = 0; j < total; j++) {
      var el = this.roomDots.children[j];
      var boss = (j === total - 1);
      el.className = 'd' + (boss ? ' boss' : '');
      if (j < r.roomIndex) el.className += ' done';
      else if (j === r.roomIndex) el.className += ' cur';
    }
  };

  Game.prototype.project = function (x, y, z, out) {
    var m = this._m;
    M.Mat4.multiply(m, this.cam.proj, this.cam.view);
    var cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    var cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    var cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.001) return false;
    out[0] = (cx / cw * 0.5 + 0.5) * window.innerWidth;
    out[1] = (1 - (cy / cw * 0.5 + 0.5)) * window.innerHeight;
    return true;
  };
  Game.prototype.updateNumbers = function () {
    var i = 0, self = this, p = this._tmp;
    this.world.numbers.each(function (n) {
      if (i >= self.numEls.length) return;
      var d = self.numEls[i++];
      if (self.project(n.x, n.y, n.z, p)) {
        d.style.display = 'block';
        d.style.left = p[0] + 'px'; d.style.top = p[1] + 'px';
        d.style.opacity = Math.min(1, n.life * 1.6);
        // matchup feedback: cyan = effective, grey = resisted
        d.style.color = n.crit ? '#ffd166'
          : (n.matchup > 0 ? '#7dfbff' : (n.matchup < 0 ? '#9aa3ae' : '#ffffff'));
        var pop = 1 + Math.max(0, n.life - 0.65) * 1.6;   // brief scale-up on spawn
        d.style.fontSize = ((n.crit ? 30 : (n.matchup > 0 ? 25 : (n.matchup < 0 ? 18 : 21))) * pop).toFixed(0) + 'px';
        d.textContent = (n.crit ? '✦' : '') + n.v + (n.matchup > 0 ? '!' : '');
      } else d.style.display = 'none';
    });
    for (; i < this.numEls.length; i++) this.numEls[i].style.display = 'none';
  };

  // ---------------- hub ----------------
  Game.prototype.buildHubLabels = function () {
    if (this.hubLabelEls) return;
    var hud = document.getElementById('hud');
    var host = (hud && hud.parentNode) || document.body;
    if (!host || !host.appendChild) { this.hubLabelEls = []; return; }   // headless/degraded DOM
    var layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;';
    host.appendChild(layer);
    this.hubLabelLayer = layer;
    this.hubLabelEls = [];
    for (var i = 0; i < HUB_DEVICES.length; i++) {
      var el = document.createElement('div');
      el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;' +
        'font:600 13px/1.2 Pretendard,\'Noto Sans KR\',sans-serif;color:#cfe8f2;' +
        'background:rgba(8,13,18,.78);border:1px solid rgba(79,227,240,.35);border-radius:14px;' +
        'padding:4px 11px;text-shadow:0 1px 3px #000;display:none;';
      layer.appendChild(el);
      this.hubLabelEls.push(el);
    }
  };
  Game.prototype.updateHubLabels = function () {
    if (!this.hubLabelEls) this.buildHubLabels();
    if (!this.hubLabelEls || !this.hubLabelEls.length) return;
    var show = (this.mode === 'hub' || this.mode === 'title') && !EH.UI.modal;
    var pt = this._tmp;
    for (var i = 0; i < HUB_DEVICES.length; i++) {
      var d = HUB_DEVICES[i], el = this.hubLabelEls[i];
      if (!show) { el.style.display = 'none'; continue; }
      var topY = d.mesh === 'door' ? 3.0 : (d.mesh === 'forge' ? 2.0 : 1.9);
      if (this.project(d.x, topY, d.z, pt)) {
        el.style.display = 'block';
        el.style.left = pt[0] + 'px';
        el.style.top = pt[1] + 'px';
        var near = this.nearDevice === d;
        el.textContent = d.label + (near ? '  ⏎' : '');
        el.style.borderColor = near ? 'rgba(79,227,240,.9)' : 'rgba(79,227,240,.35)';
        el.style.color = near ? '#eafcff' : '#cfe8f2';
      } else el.style.display = 'none';
    }
  };

  Game.prototype.enterHub = function () {
    this.mode = 'hub'; this.paused = false; this.runOver = false;
    this.world.reset();
    var rng = new EH.RNG(4242);
    this.room = { type: 'hub', theme: 'engine', props: EH.Rooms.buildProps(rng, 'engine', 'hub'), waves: [] };
    // hub devices as real 3D objects
    this.hubTargets = HUB_DEVICES.slice();
    var p = this.world.player;
    p.applyStats(EH.Prog.computeStats(this.save.data, {}));
    p.weapon = this.save.data.weapon;
    p.spawn(0, 2.5);
    p.hp = p.maxHp;
    this.cam.setTargetImmediate(0, 2.5);
    EH.Audio.startMusic(); EH.Audio.setIntensity(0.12, 0);
    this.nearDevice = null;
    EH.UI.showHUD(false);
  };
  Game.prototype.setHubWeapon = function (id) {
    this.world.player.weapon = id;
  };
  Game.prototype.updateHub = function (dt) {
    var p = this.world.player, inp = EH.Input;
    inp.update();
    // --- HUB IS A SAFE ZONE: no combat here ---
    // capture the interaction press up-front and consume every combat edge, then
    // neutralise held-attack so the player never runs an attack (which was leaving
    // swing FX / decals on the floor).
    var interact = inp.take('attackTap') || inp.take('confirm');
    inp.take('skill'); inp.take('ult'); inp.take('dash');
    inp.attackHeld = false;
    p.atkPhase = ''; p.ult = 0; p.skillCd = Math.max(p.skillCd, 0.1);
    p.update(dt, inp);
    // nearest device
    var best = null, bd = 2.4;
    for (var i = 0; i < this.hubTargets.length; i++) {
      var d = this.hubTargets[i];
      var dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (dist < bd) { bd = dist; best = d; }
    }
    if (best !== this.nearDevice) {
      this.nearDevice = best;
      if (best) EH.UI.hint(best.label + ' — 공격/Enter 로 상호작용', 0);
      else EH.UI.hint(null);
    }
    if (best && interact) {
      EH.UI.hint(null);
      EH.Audio.play('menuSelect');
      EH.Scenes.hubPanel(best.kind);
    }
    this.world.updateParticles(dt);
    this.cam.update(dt, p.x, p.z, p.vx * 0.1, p.vz * 0.1);
    this.updateHubLabels();
  };

  // ---------------- run lifecycle ----------------
  Game.prototype.startRun = function () {
    var s = this.save.data;
    this.clearTimers();          // a pending finishRun from a previous run must
                                 // never fire into the new one
    var seed = EH.randomSeed();
    this.run = {
      seed: seed, rng: new EH.RNG(seed),
      roomIndex: -1, roomType: 'combat', path: [],
      echoes: {}, shards: 0, kills: 0, eliteKills: 0, roomsCleared: 0,
      abyss: s.abyss || 0, weapon: s.weapon, elapsed: 0,
      rerollsLeft: 0, reachedBoss: false, nextRareBonus: 0,
      altarHpPenalty: 0, altarDmg: 0, nextRoomHard: false, bonusCrystals: 0
    };
    this.runOver = false; this.paused = false;
    this.refreshStats();
    this.run.rerollsLeft = this.stats.rerolls || 0;
    this.run.shards = Math.round(this.stats.startShards || 0);
    s.weaponUse[s.weapon] = (s.weaponUse[s.weapon] || 0) + 1;
    this.save.save();
    this.enterRoom('combat');
    if (!s.tutorialSeen && this.save.get('tutorial')) {
      s.tutorialSeen = true; this.save.save();
      var self = this;
      setTimeout(function () { EH.UI.hint('적을 모두 처치하면 다음 방으로 갈 수 있습니다.', 3200); }, 900);
    }
  };
  Game.prototype.resumeRun = function () {
    var r = this.save.data.run;
    if (!r) { EH.Scenes.goHub(); return; }
    this.run = {
      seed: r.seed, rng: new EH.RNG(r.seed + r.roomIndex * 7919),
      roomIndex: r.roomIndex - 1, roomType: 'combat', path: r.path || [],
      echoes: r.echoes || {}, shards: r.shards, kills: r.kills, eliteKills: 0,
      roomsCleared: r.roomIndex, abyss: r.abyss, weapon: r.weapon, elapsed: r.elapsed,
      rerollsLeft: 0, reachedBoss: false, nextRareBonus: 0,
      altarHpPenalty: 0, altarDmg: 0, nextRoomHard: false, bonusCrystals: 0
    };
    this.runOver = false; this.paused = false;
    this.refreshStats();
    this.resumeHp = r.hp; this.resumeCores = r.cores;
    this.enterRoom(r.roomIndex >= EH.Rooms.TOTAL ? 'boss' : 'combat');
  };
  Game.prototype.persistRun = function () {
    var r = this.run, p = this.world.player;
    if (!r || this.runOver) { this.save.data.run = null; this.save.save(); return; }
    this.save.data.run = {
      seed: r.seed, roomIndex: r.roomIndex, hp: p.hp, cores: p.cores,
      shards: r.shards, weapon: r.weapon, abyss: r.abyss,
      echoes: r.echoes, kills: r.kills, elapsed: r.elapsed, path: r.path
    };
    this.save.save();
  };

  Game.prototype.refreshStats = function () {
    var st = EH.Prog.computeStats(this.save.data, this.run ? this.run.echoes : {});
    if (this.run) {
      st.maxHp = Math.max(20, st.maxHp - (this.run.altarHpPenalty || 0));
      st.damageMul += (this.run.altarDmg || 0);
    }
    this.stats = st;
    var p = this.world.player;
    var frac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    var prevCores = p.cores;
    p.applyStats(st);
    p.hp = Math.min(st.maxHp, Math.max(1, frac * st.maxHp));
    if (prevCores !== undefined && this.run) p.cores = Math.min(st.maxLifeCores, prevCores);
  };

  Game.prototype.enterRoom = function (type) {
    var r = this.run;
    r.roomIndex++;
    r.roomType = type;
    r.path.push(type);
    var rng = new EH.RNG(r.seed + r.roomIndex * 7919);
    this.room = EH.Rooms.build(rng, type, r.roomIndex, r.abyss + (r.nextRoomHard ? 1 : 0));
    r.nextRoomHard = false;
    this.world.reset();
    this.spawnQueue.length = 0;
    var token = ++this.roomToken;
    var p = this.world.player;
    p.weapon = r.weapon;
    p.spawn(0, EH.CONFIG.floorHalf - 3);
    if (this.resumeHp != null) { p.hp = Math.min(p.maxHp, this.resumeHp); p.cores = this.resumeCores; this.resumeHp = null; }
    this.cam.setTargetImmediate(p.x, p.z);
    // the climb: each landing rises into view, with the floor number called out
    this.cam.startRise(5.5, 1.0);
    this.playAscent();
    this.mode = 'run'; this.paused = false; this.runOver = false;
    this.updateHubLabels();   // hides them (mode!=='hub')
    this.roomState = 'active';
    this.doorChoices = null;
    this._idleT = 0;
    EH.UI.close(); EH.UI.showHUD(true);
    this.persistRun();

    if (type === 'boss') {
      r.reachedBoss = true;
      this.world.spawnBoss();
      EH.Scenes.bossIntro();
      EH.Audio.setIntensity(0.9, 0);
    } else if (this.room.waves.length) {
      this.spawnWave(0);
      EH.Audio.setIntensity(0.45 + Math.min(0.3, r.roomIndex * 0.05), 0);
    } else {
      // special room: open its panel immediately
      this.roomState = 'special';
      EH.Audio.setIntensity(0.18, 0);
      var self = this;
      setTimeout(function () {
        if (self.roomToken !== token || self.runOver) return;   // stale timer guard
        if (type === 'heal') EH.Scenes.goHeal();
        else if (type === 'shop') EH.Scenes.goShop();
        else if (type === 'altar') EH.Scenes.goAltar();
      }, 380);
    }
    this.resize();
  };

  Game.prototype.spawnWave = function (i) {
    var room = this.room, w = room.waves[i];
    if (!w) return;
    room.waveIndex = i;
    var rng = new EH.RNG(this.run.seed + this.run.roomIndex * 131 + i * 17);
    var self = this;
    w.forEach(function (spec, k) {
      var sp = EH.Rooms.spawnPoint(rng, self.world.player, self.world.half);
      // quiet spawn puff (a warning circle per spawning enemy was far too busy)
      self.world.spawnParticles(sp.x, 0.3, sp.z, 5, [0.35, 0.9, 1],
        { speed: 2.2, up: 1.6, life: 0.45, size: 0.18, prim: 'sphere' });
      self.spawnQueue.push({ kind: spec.kind, elite: spec.elite, x: sp.x, z: sp.z, t: 0.56 + k * 0.09 });
    });
  };

  Game.prototype.updateSpawnQueue = function (dt) {
    for (var i = this.spawnQueue.length - 1; i >= 0; i--) {
      var s = this.spawnQueue[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.world.spawnEnemy(s.kind, s.x, s.z, s.elite);
        this.spawnQueue.splice(i, 1);
      }
    }
  };

  Game.prototype.checkRoomClear = function () {
    if (this.roomState !== 'active' || this.runOver) return;
    if (this.spawnQueue.length > 0) return;        // wave still materialising
    if (this.world.aliveEnemies() > 0) return;
    var room = this.room;
    if (room.waveIndex + 1 < room.waves.length) {
      this.spawnWave(room.waveIndex + 1);
      return;
    }
    if (this.run.roomType === 'boss') return;  // boss handled separately
    // cleared
    this.roomState = 'cleared';
    this.run.roomsCleared++;
    var s = this.save.data;
    if (this.run.roomIndex + 1 > s.bestRoom) { s.bestRoom = this.run.roomIndex + 1; }
    var heal = this.stats.roomHeal || 0;
    var p = this.world.player;
    if (heal > 0) { p.hp = Math.min(p.maxHp, p.hp + heal); EH.UI.toast('재생 파동: 체력 +' + heal); }
    this.persistRun();
    EH.Audio.setIntensity(0.2, 0);
    var self = this, token = this.roomToken;
    // frame-driven, not setTimeout: a wall-clock timer keeps running while the
    // game is paused or backgrounded and would pop the reward screen over a
    // paused game.
    this.after(0.7, function () {
      if (self.runOver || self.roomToken !== token) return;   // stale guard
      EH.Scenes.goReward();
    });
  };
  Game.prototype.completeSpecialRoom = function () {
    if (this.roomState === 'done') return;
    this.roomState = 'done';
    this.run.roomsCleared++;
    this.persistRun();
    EH.Scenes.afterReward();
  };

  Game.prototype.onBossPhase = function (phase) {
    EH.Audio.setIntensity(0.9 + phase * 0.03, phase);
    this.showBanner((phase + 1) + '단계', EH.BOSS.phases[phase].name);
  };
  Game.prototype.onBossDefeated = function () {
    if (this.runOver) return;
    this.runOver = true;
    this.world.slowmo = 1.4;
    var self = this;
    this.after(2.6, function () { self.finishRun(true); });
  };
  Game.prototype.onPlayerDeath = function (cause) {
    if (this.runOver) return;
    this.runOver = true;
    this.deathCause = cause;
    var self = this;
    this.after(1.9, function () { self.finishRun(false); });
  };

  // ---------------- adaptive performance governor ----------------
  // The heaviest surface is the floor: it fills the screen and runs the full
  // PBR shader (4 texture fetches + a derivative-based tangent frame) for every
  // pixel. On a weak GPU that alone blows the frame budget, so instead of
  // guessing a fixed quality level we measure and scale the render resolution
  // until the frame time fits. Everything else stays untouched.
  // This is a SAFETY NET, not the main strategy. The real fixes are the pixel
  // budget, the flat-plane floor path, MSAA off and batched particles; the
  // governor only steps in on hardware those are still not enough for, so its
  // threshold is deliberately low to keep default image quality intact.
  var PERF_TARGET = 1 / 57;      // recover once comfortably above 57fps
  var PERF_BAD = 1 / 40;         // only shed resolution below 40fps
  var PERF_MIN = 0.6, PERF_MAX = 1.0;

  Game.prototype.initPerf = function () {
    this.perf = {
      ema: 1 / 60, samples: 0, cooldown: 0,
      scale: 1, fps: 60, worst: 0, adjusts: 0, enabled: true
    };
  };
  Game.prototype.updatePerf = function (dt) {
    var pf = this.perf || (this.initPerf(), this.perf);
    if (!(dt > 0) || dt > 0.5) return;              // ignore stalls / tab switches
    pf.ema = pf.ema * 0.9 + dt * 0.1;
    pf.fps = 1 / Math.max(pf.ema, 1e-4);
    if (dt > pf.worst) pf.worst = dt;
    pf.samples++;
    if (pf.cooldown > 0) { pf.cooldown -= dt; return; }
    if (pf.samples < 30 || !pf.enabled) return;
    pf.samples = 0;
    var R = this.renderer, changed = false;
    if (pf.ema > PERF_BAD && pf.scale > PERF_MIN) {
      pf.scale = Math.max(PERF_MIN, pf.scale - 0.10);
      changed = true;
    } else if (pf.ema < PERF_TARGET && pf.scale < PERF_MAX) {
      pf.scale = Math.min(PERF_MAX, pf.scale + 0.05);
      changed = true;
    }
    if (changed) {
      pf.adjusts++;
      pf.cooldown = 1.0;                            // settle before judging again
      R.resScale = pf.scale;
      this.resize();
      EH.log('[perf] resScale -> ' + pf.scale.toFixed(2) + ' (' + pf.fps.toFixed(0) + 'fps)');
    }
  };

  // ---------------- frame-driven delays ----------------
  // Used instead of setTimeout for anything that should respect pause,
  // slow-motion and tab-backgrounding. Also makes tests deterministic:
  // wall-clock timers raced with the test harness under CPU load.
  Game.prototype.after = function (secs, fn) {
    (this._timers || (this._timers = [])).push({ t: secs, fn: fn });
  };
  Game.prototype.clearTimers = function () { if (this._timers) this._timers.length = 0; };
  Game.prototype.tickTimers = function (dt) {
    var ts = this._timers;
    if (!ts || !ts.length) return;
    for (var i = ts.length - 1; i >= 0; i--) {
      ts[i].t -= dt;
      if (ts[i].t <= 0) {
        var fn = ts[i].fn;
        ts.splice(i, 1);
        try { fn(); } catch (e) { EH.err('[timer]', e); }
      }
    }
  };

  Game.prototype.finishRun = function (won) {
    this.spawnQueue.length = 0;
    var s = this.save.data, r = this.run;
    if (!r) { EH.Scenes.goHub(); return; }
    var crystals = EH.Prog.runReward({
      roomsCleared: r.roomsCleared, kills: r.kills, eliteKills: r.eliteKills,
      reachedBoss: r.reachedBoss, abyss: r.abyss, echoes: r.echoes
    }, s, won) + (r.bonusCrystals || 0);
    s.crystals += crystals;
    s.totalKills += r.kills;
    if (this.world.maxCombo > s.bestCombo) s.bestCombo = this.world.maxCombo;
    s.run = null;
    var info = {
      roomsCleared: r.roomsCleared, kills: r.kills, eliteKills: r.eliteKills,
      maxCombo: this.world.maxCombo, abyss: r.abyss, crystals: crystals,
      time: r.elapsed
    };
    EH.Audio.stopMusic();
    if (won) {
      s.wins++;
      s.unlocks.abyss = true;
      if (s.bestTime === 0 || r.elapsed < s.bestTime) s.bestTime = r.elapsed;
      var newAb = r.abyss + 1;
      if (newAb > s.bestAbyss) { s.bestAbyss = newAb; info.newAbyss = newAb; }
      this.save.save();
      EH.Audio.play('victory');
      EH.Scenes.goVictory(info);
    } else {
      s.deaths++;
      info.adapt = EH.Prog.recordDeath(s, this.deathCause || 'melee');
      this.save.save();
      EH.Scenes.goGameOver(info);
    }
    this.run = null;
    this.mode = 'results';
    EH.UI.showHUD(false);
  };
  Game.prototype.abandonRun = function () {
    this.runOver = true;
    this.spawnQueue.length = 0;
    this.save.data.run = null; this.save.save();
    this.run = null; this.paused = false;
    EH.Scenes.goHub();
  };

  // ---------------- loop ----------------
  Game.prototype.loop = function (t) {
    var self = this;
    this._raf = requestAnimationFrame(function (n) { self.loop(n); });
    if (this.contextLost) return;
    // A single bad timestamp must not poison the clock: if we stored a NaN in
    // this.last every later delta would be NaN and the game would freeze at
    // dt = 0 forever.
    if (!isFinite(t)) t = isFinite(this.last) ? this.last + 16.7 : EH.now();
    if (!isFinite(this.last)) this.last = t;
    var dt = (t - this.last) / 1000;
    this.last = t;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, EH.CONFIG.maxDelta);
    this.frame++;
    this.updatePerf(dt);
    try {
      this.update(dt);
      this.render(dt);
    } catch (e) {
      EH.err('[loop]', e);
      if (!this._loopErrShown) {
        this._loopErrShown = true;
        EH.Scenes.goError('실행 중 오류가 발생했습니다.', (e && e.stack) || String(e));
      }
    }
  };

  Game.prototype.update = function (dt) {
    EH.Audio.updateMusic();
    if (this.mode === 'hub' || this.mode === 'title') {
      if (!EH.UI.modal || EH.UI.current === 'title') this.updateHub(dt);
      else { this.world.updateParticles(dt); this.cam.update(dt, this.world.player.x, this.world.player.z, 0, 0); }
      this.animateProps(dt);
      return;
    }
    if (this.mode === 'results') {
      this.tickTimers(dt);
      this.world.updateParticles(dt);
      this.cam.update(dt, this.world.player.x, this.world.player.z, 0, 0);
      this.animateProps(dt);
      return;
    }
    if (this.mode !== 'run') return;
    if (this.paused || EH.UI.modal) {
      // menus open: freeze simulation but keep camera smooth. Delayed events
      // (reward / victory / game-over) are deliberately NOT ticked here, so a
      // pause never pops a screen over the pause menu.
      this.cam.update(dt, this.world.player.x, this.world.player.z, 0, 0);
      EH.UI.updateJoystick(EH.Input);
      return;
    }
    this.tickTimers(dt);
    // tickTimers can end the run (finishRun clears this.run and switches mode),
    // so re-check before touching run state in the rest of this same frame.
    if (this.mode !== 'run' || !this.run) return;
    var inp = EH.Input;
    inp.update();
    if (inp.take('pause') && !this.runOver) { EH.Scenes.goPause(); return; }
    this.run.elapsed += dt;
    var p = this.world.player;
    var slow = p.slowed ? 0.55 : 1; p.slowed = 0;
    p.update(dt * slow, inp);
    this.updateSpawnQueue(dt);
    this.world.update(dt);
    this.animateProps(dt);
    this.checkHints(dt);
    this.checkRoomClear();
    this.cam.update(dt, p.x, p.z, p.vx * 0.12, p.vz * 0.12);
    EH.UI.updateHUD(this);
    this.updateHudFx(dt);
    EH.UI.updateJoystick(inp);
    this.updateNumbers();
    if (this.frame % 30 === 0) this.persistRun();
  };

  // ---------------- contextual hints (each shown once per save) ----------------
  Game.prototype.hintOnce = function (id, text, ms) {
    if (!this.save.get('tutorial')) return false;
    var h = this.save.data.hints || (this.save.data.hints = {});
    if (h[id]) return false;
    h[id] = 1; this.save.save();
    EH.UI.hint(text, ms || 3600);
    return true;
  };
  Game.prototype.checkHints = function (dt) {
    if (!this.run || this.runOver || EH.UI.modal) return;
    var p = this.world.player, st = this.stats, w = this.world;
    var enemies = w.aliveEnemies();
    if (this.run.roomIndex === 0 && enemies > 0 && w.kills === 0) {
      this._idleT = (this._idleT || 0) + dt;
      if (this._idleT > 3.0)
        this.hintOnce('atk', '공격 — J 또는 마우스 좌클릭 (모바일: 오른쪽 아래 공격 버튼)', 4200);
    }
    if (enemies > 0 && p.dashCd <= 0)
      this.hintOnce('dash', '대시 — K 또는 Shift · 짧은 무적이라 공격을 통과할 수 있습니다', 4200);
    if (this.run.roomIndex >= 1 && p.skillCd <= 0)
      this.hintOnce('skill', '스킬 — L 또는 마우스 우클릭 · 무기마다 효과가 완전히 다릅니다', 4000);
    if (p.ult >= st.ultMax)
      this.hintOnce('ult', '궁극기 충전 완료 — Space', 3200);
    if (!p.dead && p.hp / p.maxHp < 0.35 && p.cores > 0)
      this.hintOnce('core', '체력 위험 — 쓰러져도 생명 코어가 있으면 절반 체력으로 한 번 부활합니다', 4200);
    if (this.run.roomType === 'elite')
      this.hintOnce('elite', '엘리트 — 강화된 적입니다. 대신 더 좋은 잔향을 줍니다', 3800);
    if (this.run.roomType === 'boss')
      this.hintOnce('boss', '바닥의 예고 범위가 차오르면 공격이 옵니다 — 대시로 빠져나가세요', 5000);
  };

  Game.prototype.animateProps = function (dt) {
    var props = this.room && this.room.props;
    if (!props) return;
    this.propT = (this.propT || 0) + dt;
    for (var i = 0; i < props.length; i++) {
      var pr = props[i];
      if (pr.spin) pr.rot += pr.spin * dt;
    }
  };

  // ---------------- render (3D) ----------------
  Game.prototype.render = function (dt) {
    var R = this.renderer, cam = this.cam;
    var baseTheme = EH.THEMES[(this.room && this.room.theme) || 'engine'];
    var theme = baseTheme;
    var p = this.world && this.world.player;
    var surge = (p && p.state === 'ult') ? 1 : (this.world && this.world.slowmoT > 0 ? this.world.slowmoT / 0.7 : 0);
    if (surge > 0) {
      // temporary lighting surge -> the whole arena flares in the ultimate's color
      var ut = (p && p.ultTint) || [0.5, 0.7, 1];
      theme = { name: baseTheme.name, floor: baseTheme.floor, wall: baseTheme.wall,
        accent: [baseTheme.accent[0] + surge * (0.7 + ut[0] * 0.7), baseTheme.accent[1] + surge * (0.6 + ut[1] * 0.6), baseTheme.accent[2] + surge * (0.8 + ut[2] * 0.7)],
        fog: baseTheme.fog,
        amb: [baseTheme.amb[0] + surge * (0.4 + ut[0] * 0.3), baseTheme.amb[1] + surge * (0.35 + ut[1] * 0.3), baseTheme.amb[2] + surge * (0.5 + ut[2] * 0.3)],
        floorTint: baseTheme.floorTint };
    }
    R.beginFrameTarget();        // render offscreen when bloom is on
    R.begin(cam, theme, dt);
    this.drawTowerBackdrop(theme);   // the shaft below - sells the altitude
    this.drawFloor(theme);
    this.drawShadows();          // grounds everything before anything stands on it
    this.drawProps(theme);
    if (this.mode === 'hub' || this.mode === 'title') this.drawHubDevices();
    this.drawActors();
    R.drawSky();              // depth-tested background fill (see Renderer.drawSky)
    this.drawEffects(theme);
    R.resolveBloom();         // bright-pass -> blur -> composite to the screen
  };

  // The arena is a landing on a tower, not a circle floating in a void. This
  // draws the platform's own thickness plus the shaft receding below it, so the
  // player can see how far they have climbed. All of it is unlit ring/strut
  // geometry fading into the fog, which is cheap and never occludes gameplay.
  Game.prototype.drawTowerBackdrop = function (theme) {
    var R = this.renderer, m = this._m;
    var tier = this.currentTier();
    var half = EH.CONFIG.floorHalf;
    var acc = theme.accent, fog = theme.fog;
    var t = this.renderer.time || 0;

    R.beginUnlit(false);

    // --- platform rim: gives the disc real thickness ---
    for (var L = 0; L < 3; L++) {
      var ry = -0.10 - L * 0.28;
      var rr = (half + 1.15) - L * 0.16;
      var f = 1 - L / 3;
      M.Mat4.fromRTS(m, M.Quat.identity([0, 0, 0, 1]), [0, ry, 0], [rr * 2, 1, rr * 2]);
      R.drawPrim('quad', m, [acc[0] * 0.30 * f + 0.05, acc[1] * 0.34 * f + 0.05,
                             acc[2] * 0.40 * f + 0.07, 0.85 - L * 0.18], 4);
    }

    // --- shaft: concentric rings marching down into the haze ---
    var rings = tier.shaftRings, gap = tier.ringGap;
    for (var i = 1; i <= rings; i++) {
      var depth = i / rings;                       // 0 near, 1 far below
      var y = -0.7 - i * gap;
      // slight taper + a lazy rotation so the shaft does not look like a stack
      var rad = (half + 1.4) * (1 + depth * 0.55);
      var fade = Math.pow(1 - depth, 1.5) * (1 - tier.hazeStart) + 0.04;
      if (fade < 0.02) continue;
      var q = M.Quat.fromEuler([0, 0, 0, 1], 0, t * 0.05 + i * 0.7, 0);
      M.Mat4.fromRTS(m, q, [0, y, 0], [rad * 2, 1, rad * 2]);
      R.drawPrim('quad', m, [
        fog[0] + acc[0] * 0.22 * fade,
        fog[1] + acc[1] * 0.26 * fade,
        fog[2] + acc[2] * 0.32 * fade,
        fade * 0.9], 4);
    }

    // --- struts: verticals tie the rings together and read as structure ---
    // 'card' is an upright quad on XY, so scaling Y gives a genuinely vertical
    // pillar. (A rotated 'bolt' produced one enormous diagonal beam instead.)
    var n = tier.strutCount, drop = rings * gap * 0.62;
    for (var k = 0; k < n; k++) {
      var a = (k / n) * Math.PI * 2;
      var sx = Math.cos(a) * (half + 1.05), sz = Math.sin(a) * (half + 1.05);
      var qs = M.Quat.fromEuler([0, 0, 0, 1], 0, -a + Math.PI / 2, 0);
      M.Mat4.fromRTS(m, qs, [sx, -drop * 0.5 - 0.4, sz], [0.85, drop, 1]);
      R.drawPrim('card', m, [fog[0] + acc[0] * 0.12, fog[1] + acc[1] * 0.14,
                             fog[2] + acc[2] * 0.20, 0.50], 0);
    }
    R.endUnlit();
  };

  // Upward streaks + a floor banner so entering a room reads as "we went up",
  // not "the scene changed".
  Game.prototype.playAscent = function () {
    var w = this.world, tier = this.currentTier(), fl = this.currentFloor();
    var acc = (EH.THEMES[tier.theme] || EH.THEMES.engine).accent;
    for (var i = 0; i < 26; i++) {
      var a = Math.random() * Math.PI * 2;
      var r = EH.CONFIG.floorHalf * (0.5 + Math.random() * 0.55);
      w.spawnParticles(Math.cos(a) * r, -1.5, Math.sin(a) * r, 1, acc,
        { speed: 0.4, up: 12 + Math.random() * 8, life: 1.1, size: 0.2, grav: 0.6, prim: 'shard' });
    }
    if (this.showBanner) this.showBanner(fl + '층', tier.name + ' · ' + tier.label);
    EH.Audio.play('ascend') || EH.Audio.play('menuSelect');
  };

  Game.prototype.currentTier = function () {
    var idx = (this.run && this.run.roomIndex != null) ? this.run.roomIndex : 0;
    return EH.tierFor(Math.max(0, idx));
  };
  Game.prototype.currentFloor = function () {
    var idx = (this.run && this.run.roomIndex != null) ? this.run.roomIndex : 0;
    return EH.floorNumber(Math.max(0, idx));
  };

  Game.prototype.drawFloor = function (theme) {
    var R = this.renderer, m = this._m;
    var size = (EH.CONFIG.floorHalf + 2);
    var q = M.Quat.identity([0, 0, 0, 1]);
    M.Mat4.fromRTS(m, q, [0, 0, 0], [size, 1, size]);
    // clip to just past the wall ring so no floor is visible outside the arena
    R.drawMesh('floorTile', [m], { uvScale: size * 1.6, tint: theme.floorTint,
      emissive: 0.8, clipR: EH.CONFIG.floorHalf + 1.15, flatTBN: true });
  };

  // Contact shadows. Without them every actor reads as floating above the
  // floor, which is the single biggest thing that made the scene look flat.
  // All of them go out in one batched draw with multiply blending.
  Game.prototype.drawShadows = function () {
    var R = this.renderer, w = this.world;
    if (!R.beginParticles) return;
    R.beginParticles();
    var n = 0;
    function blob(x, y, z, radius, strength) {
      // higher off the ground -> larger and fainter, like a real soft shadow
      var lift = Math.max(0, y);
      var size = radius * (2.5 + lift * 0.55);
      var a = strength / (1 + lift * 1.5);
      if (a < 0.02) return;
      R.addGroundQuad(x, 0.03, z, size, [0, 0, 0], a);
      n++;
    }
    var p = w.player;
    if (p && p.alive && !p.dead) blob(p.x, p.y, p.z, p.radius, 0.66);
    for (var i = 0; i < w.enemies.length; i++) {
      var e = w.enemies[i];
      if (!e.alive || !R.visible(e.x, 1, e.z, 2.2)) continue;
      blob(e.x, e.y, e.z, e.radius, e.dying ? 0.28 : 0.60);
    }
    if (w.boss && w.boss.alive) blob(w.boss.x, w.boss.y, w.boss.z, w.boss.radius, 0.72);
    var props = this.room && this.room.props;
    if (props) {
      for (var k = 0; k < props.length; k++) {
        var pr = props[k];
        if (pr.wall || !pr.col) continue;                  // walls sit on the rim
        if (!R.visible(pr.x, 1, pr.z, 3)) continue;
        blob(pr.x, pr.y, pr.z, pr.col, 0.55);
      }
    }
    if (n) R.endParticles(true);                           // multiply = darken
  };

  Game.prototype.drawProps = function (theme) {
    var R = this.renderer, m = this._m, props = this.room && this.room.props;
    if (!props) return;
    var t = this.propT || 0;
    var billboards = null;
    // Scenery repeats the same mesh many times over - the arena wall ring alone
    // is 22 copies, and in 3D mode that was 44 draw calls a frame, more than the
    // actors cost. Bucket by everything that changes GL state (mesh, material,
    // tint, glow) and issue one instanced call per bucket.
    var buckets = this._propBuckets || (this._propBuckets = {});
    var order = this._propOrder || (this._propOrder = []);
    order.length = 0;
    for (var key in buckets) buckets[key].length = 0;

    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      var y = p.y + (p.bob ? Math.sin(t * 1.4 + i) * 0.18 * p.bob : 0);
      if (!R.visible(p.x, y + 1, p.z, 3)) continue;
      // scenery uses the pre-rendered billboard atlas so it matches the
      // cel-shaded characters; walls stay 3D because they are oriented planes.
      var sp = (!p.wall && !p.mat) ? this.propSprite(p.mesh) : null;
      if (sp) { (billboards || (billboards = [])).push({ p: p, y: y, sp: sp }); continue; }
      var q = M.Quat.fromEuler([0, 0, 0, 1], 0, p.rot, 0);
      var mm = M.Mat4.create();
      M.Mat4.fromRTS(mm, q, [p.x, y, p.z], [p.scale, p.scale, p.scale]);
      var bk = p.mesh + '|' + (p.mat || '') + '|' + (p.wall ? 'w' : '') + '|' + (p.glow ? 'g' : '');
      if (!buckets[bk]) buckets[bk] = [];
      if (!buckets[bk].length) { order.push(bk); buckets[bk].p = p; }
      buckets[bk].push(mm);
    }
    for (var b = 0; b < order.length; b++) {
      var list = buckets[order[b]], ref = list.p;
      R.drawMeshInstanced(ref.mesh, list, {
        tint: ref.wall ? theme.floorTint : null,
        materialOverride: ref.mat ? [ref.mat] : null,
        emissive: ref.glow ? 2.2 : 1
      });
    }
    if (billboards) this.drawPropBillboards(billboards);
  };

  Game.prototype.propSprite = function (meshName) {
    var meta = EH.SpriteImported && EH.SpriteImported.props;
    if (!meta || !meta.propRows || meta.propRows[meshName] == null) return null;
    if (EH.Settings && EH.Settings.get && EH.Settings.get('spriteMode') === 0) return null;
    var tex = this.renderer.spriteTex && this.renderer.spriteTex.props;
    if (!tex) return null;
    var info = (meta.propInfo && meta.propInfo[meshName]) || null;
    return { meta: meta, tex: tex, row: meta.propRows[meshName], info: info };
  };

  Game.prototype.drawPropBillboards = function (list) {
    var R = this.renderer, TAU = Math.PI * 2;
    R.beginSprites();
    for (var i = 0; i < list.length; i++) {
      var it = list[i], p = it.p, meta = it.sp.meta;
      var dirs = meta.dirs || 8;
      var d = Math.round((((p.rot % TAU) + TAU) % TAU) / (TAU / dirs)) % dirs;
      var uw = 1 / meta.cols, vh = 1 / meta.rows;
      // Size the quad from the real mesh height so the billboard matches the
      // footprint the 3D prop used to have, then drop it by its cell padding.
      var info = it.sp.info;
      var h = info ? (info.meshH * p.scale * info.cellPerUnit) : (p.scale * 2.6);
      var w = h * (meta.cw / meta.ch);
      var g = p.glow ? 1.35 : 1;
      var foot = it.y - h * ((info ? info.footPad : meta.footPad) || 0);
      R.drawSprite(it.sp.tex, d * uw, it.sp.row * vh, (d + 1) * uw, (it.sp.row + 1) * vh,
        p.x, foot, p.z, w, h, [g, g, g, 1], false);
    }
    R.endSprites();
  };

  Game.prototype.drawHubDevices = function () {
    var R = this.renderer, m = this._m;
    for (var i = 0; i < this.hubTargets.length; i++) {
      var d = this.hubTargets[i];
      var near = this.nearDevice === d;
      var q = M.Quat.fromEuler([0, 0, 0, 1], 0, Math.PI, 0);
      M.Mat4.fromRTS(m, q, [d.x, 0, d.z], [1.15, 1.15, 1.15]);
      R.drawMesh(d.mesh, d.mesh === 'door' ? this.doorMats(d) : [m], {
        emissive: near ? 3.0 : 1.4,
        tint: near ? [1.3, 1.3, 1.3] : null
      });
    }
  };
  Game.prototype.doorMats = function (d) {
    var mesh = EH.Meshes.door, out = [];
    var root = M.Mat4.create();
    M.Mat4.fromRTS(root, M.Quat.identity([0, 0, 0, 1]), [d.x, 0, d.z], [1, 1, 1]);
    for (var i = 0; i < mesh.parts.length; i++) {
      var mm = M.Mat4.create(), local = M.Mat4.create();
      M.Mat4.fromRTS(local, M.Quat.identity([0, 0, 0, 1]), mesh.parts[i].rest, [1, 1, 1]);
      M.Mat4.multiply(mm, root, local);
      out.push(mm);
    }
    return out;
  };

  Game.prototype.spriteFor = function (kind) {
    if (!EH.SpriteImported) return null;
    if (EH.Settings && EH.Settings.get && EH.Settings.get('spriteMode') === 0) return null;
    var name = null;
    if (kind === 'player') {
      // one baked sheet per weapon so the in-hand weapon always matches
      var c = EH.__spriteChar;
      var wid = this.world && this.world.player && this.world.player.weapon;
      name = (c && typeof c === 'object') ? (c[wid] || c[Object.keys(c)[0]]) : c;
    } else if (kind === 'boss') name = EH.__spriteBoss;
    else name = EH.__spriteEnemy && EH.__spriteEnemy[kind];
    if (!name) return null;
    var meta = EH.SpriteImported[name];
    var tex = this.renderer.spriteTex && this.renderer.spriteTex[name];
    return (meta && tex) ? { meta: meta, tex: tex } : null;
  };
  Game.prototype.queueSprite = function (e, kind, moving, tint) {
    var sp = this.spriteFor(kind);
    if (!sp) return false;
    (this._spriteQ || (this._spriteQ = [])).push({ e: e, sp: sp, moving: moving, tint: tint });
    return true;
  };

  Game.prototype.drawActors = function () {
    this._spriteQ = [];
    var R = this.renderer, w = this.world, p = w.player;
    if (p && p.alive && R.visible(p.x, 1, p.z, 2)) {
     if (this.queueSprite(p, 'player', Math.hypot(p.vx, p.vz) > 0.5)) { /* sprite billboard */ } else {
      R.drawMesh(p.mesh, p.anim.mats, {
        flash: Math.max(p.flash * 0.7, (p.skillFlash || 0) * 0.35), dissolve: p.dissolve,
        emissive: 1 + (p.ult / Math.max(1, p.stats.ultMax)) * 1.2 + (p.iframes > 0 ? 0.8 : 0) + (p.skillFlash || 0) * 1.6
      });
      var mount = p.anim.partMat('weaponMount');
      if (mount && !p.dead) {
        var wmesh = (EH.__weaponMesh && EH.__weaponMesh[p.weapon]) || EH.WEAPONS[p.weapon].mesh;
        R.drawMesh(wmesh, this.weaponMats(mount, wmesh, p.weapon),
          { emissive: (p.atkPhase === 'active' ? 2.0 : 0.8) + (p.skillFlash || 0) * 3.0 });
      }
     }
    }
    for (var i = 0; i < w.enemies.length; i++) {
      var e = w.enemies[i];
      if (!e.alive || !R.visible(e.x, 1, e.z, 2.2)) continue;
      var tint = null;
      if (e.elite) {
        var c = EH.ELITES[e.elite].color;
        tint = { r: 1 + c[0] * 0.5, g: 1 + c[1] * 0.5, b: 1 + c[2] * 0.5 };
      }
      if (this.queueSprite(e, e.kind, e.state === 'move', tint)) continue;
      R.drawMesh(e.mesh, e.anim.mats, {
        flash: e.flash, dissolve: e.dissolve, tint: tint ? [tint.r, tint.g, tint.b] : null,
        emissive: 1 + (e.state === 'tell' ? 2.2 : 0) + (e.burn > 0 ? 1.2 : 0) + (e.elite ? 1.0 : 0)
      });
    }
    var b = w.boss;
    if (b && b.alive) {
      if (!this.queueSprite(b, 'boss', b.state === 'dash', b.state === 'groggy' ? { r: 1.6, g: 1.4, b: 0.9 } : null)) {
        R.drawMesh(b.mesh, b.anim.mats, {
          flash: b.flash, dissolve: b.dissolve,
          emissive: 1.2 + b.phase * 0.5 + (b.state === 'groggy' ? 1.5 : 0)
        });
      }
    }
    this.flushSprites();
  };
  Game.prototype.weaponMats = function (mount, meshName, weaponId) {
    var mesh = EH.Meshes[meshName];
    if (!mesh) return [];
    var out = [], grip = M.Mat4.create(), local = M.Mat4.create();
    var imported = EH.__weaponImported && EH.__weaponImported[meshName];
    var g = (weaponId && EH.WEAPONS[weaponId] && EH.WEAPONS[weaponId].grip) || null;
    var rot = g ? g.rot : (imported ? [0, 0, 0] : [1.25, 0, 0]);
    var off = g ? g.off : [0, 0, 0];
    var sc = g ? g.scale : 1;
    M.Mat4.fromRTS(local, M.Quat.fromEuler([0, 0, 0, 1], rot[0], rot[1], rot[2]), off, [sc, sc, sc]);
    M.Mat4.multiply(grip, mount, local);
    for (var i = 0; i < mesh.parts.length; i++) {
      var mm = M.Mat4.create(), lm = M.Mat4.create();
      M.Mat4.fromRTS(lm, M.Quat.identity([0, 0, 0, 1]), mesh.parts[i].rest, [1, 1, 1]);
      M.Mat4.multiply(mm, grip, lm);
      out.push(mm);
    }
    return out;
  };

  Game.prototype.flushSprites = function () {
    var q = this._spriteQ;
    if (!q || !q.length) return;
    var R = this.renderer;
    R.beginSprites();
    for (var i = 0; i < q.length; i++) {
      var it = q[i], e = it.e, m = it.meta = it.sp.meta;
      // stateTime resets on every state change, so one-shot clips (attack /
      // death) start from frame 0 exactly when the state begins.
      var st = (e.stateTime != null) ? e.stateTime
             : (e.anim ? e.anim.stateTime : this.world.time);
      var raw = it.state || e.state;
      if (e.dying || e.dead) raw = 'death';
      else if (e.atkPhase) raw = 'attack';
      var c = EH.SpriteView.cell(m, e.facing, st, it.moving, raw);
      var h = m.scale, w = h * (m.cw / m.ch);
      var t = it.tint, col = [t ? t.r : 1, t ? t.g : 1, t ? t.b : 1, 1 - (e.dissolve || 0)];
      if (e.flash > 0) { col[0] += e.flash; col[1] += e.flash; col[2] += e.flash; }
      // The baked cell centres the character, so there is empty space below it.
      // Drop the quad by that padding, otherwise everyone floats above the floor.
      var foot = (e.y || 0) + 0.02 - h * (m.footPad || 0);
      R.drawSprite(it.sp.tex, c.u0, c.v0, c.u1, c.v1, e.x, foot, e.z, w, h, col, c.flip);
    }
    R.endSprites();
  };

  Game.prototype.drawEffects = function (theme) {
    var R = this.renderer, w = this.world, m = this._m;
    R.beginUnlit(false);
    function blob(x, z, r, a) {
      M.Mat4.fromRTS(m, M.Quat.identity([0, 0, 0, 1]), [x, 0.035, z], [r, 1, r]);
      R.drawPrim('quad', m, [0, 0, 0, a], 1);
    }
    if (w.player && w.player.alive && !w.player.dead) blob(w.player.x, w.player.z, 1.5, 0.5);
    for (var i = 0; i < w.enemies.length; i++) {
      var e = w.enemies[i];
      if (e.alive && !e.dying) blob(e.x, e.z, e.radius * 3.2, 0.45);
    }
    if (w.boss && w.boss.alive && !w.boss.dying) blob(w.boss.x, w.boss.z, 7.0, 0.5);
    w.telegraphs.each(function (t) {
      // k = charge progress 0..1 -> drives the fill sweep so timing is readable
      var k = EH.clamp(t.t / t.dur, 0, 1);
      var col = t.color;
      var q = M.Quat.fromEuler([0, 0, 0, 1], 0, (t.kind === 'cone' || t.kind === 'line') ? t.a : 0, 0);
      if (t.kind === 'circle') {
        M.Mat4.fromRTS(m, q, [t.x, 0.05, t.z], [t.a * 2, 1, t.a * 2]);
        R.drawPrim('quad', m, [col[0], col[1], col[2], 1], 5, k);
      } else if (t.kind === 'ring') {
        M.Mat4.fromRTS(m, q, [t.x, 0.05, t.z], [t.a * 2, 1, t.a * 2]);
        R.drawPrim('quad', m, [col[0], col[1], col[2], 1], 7, k);
      } else if (t.kind === 'line') {
        var len = t.b;
        M.Mat4.fromRTS(m, q, [t.x + Math.sin(t.a) * len * 0.5, 0.05, t.z + Math.cos(t.a) * len * 0.5], [1.6, 1, len]);
        R.drawPrim('quad', m, [col[0], col[1], col[2], 1], 6, k);
      } else if (t.kind === 'cone') {
        M.Mat4.fromRTS(m, q, [t.x + Math.sin(t.a) * t.b * 0.42, 0.05, t.z + Math.cos(t.a) * t.b * 0.42], [t.b * 1.0, 1, t.b * 0.9]);
        R.drawPrim('quad', m, [col[0], col[1], col[2], 1], 5, k);
      }
    });
    // auto-aim lock marker: shows which target the next hit will turn toward
    var ap = w.player;
    if (ap && ap.aimMarkT > 0 && ap.aimTarget && ap.aimTarget.alive && !ap.aimTarget.dying) {
      var at = ap.aimTarget, ak = Math.max(0, ap.aimMarkT / 0.35);
      var arot = (this.renderer.time || 0) * 2.2;
      var aq = M.Quat.fromEuler([0, 0, 0, 1], 0, arot, 0);
      var asz = at.radius * (2.6 + (1 - ak) * 1.0);
      M.Mat4.fromRTS(m, aq, [at.x, 0.07, at.z], [asz, 1, asz]);
      R.drawPrim('quad', m, [0.45, 1, 1, 0.5 * ak], 4);
    }
    // elite marker: a rotating ring under elites so they read at a glance
    for (var ei = 0; ei < w.enemies.length; ei++) {
      var en = w.enemies[ei];
      if (!en.alive || en.dying || !en.elite) continue;
      var ec = EH.ELITES[en.elite].color;
      var rot = (this.renderer.time || 0) * (en.elite === 'accel' ? 3.5 : 1.6);
      var qr = M.Quat.fromEuler([0, 0, 0, 1], 0, rot, 0);
      M.Mat4.fromRTS(m, qr, [en.x, 0.06, en.z], [en.radius * 3.4, 1, en.radius * 3.4]);
      R.drawPrim('quad', m, [ec[0], ec[1], ec[2], 0.5], 4);          // ring
      var qr2 = M.Quat.fromEuler([0, 0, 0, 1], 0, -rot * 0.7, 0);
      M.Mat4.fromRTS(m, qr2, [en.x, 0.05, en.z], [en.radius * 2.4, 1, en.radius * 2.4]);
      R.drawPrim('quad', m, [ec[0], ec[1], ec[2], 0.28], 4);
    }
    w.fields.each(function (f) {
      var k = f.t / f.dur;
      var expand = (f.type === 'wave' || f.type === 'reviveRing');
      var r = expand ? f.r * (0.4 + k * 1.2) : f.r;
      M.Mat4.fromRTS(m, M.Quat.identity([0, 0, 0, 1]), [f.x, 0.06, f.z], [r * 2, 1, r * 2]);
      var a = expand ? (1 - k) * 0.75 : 0.3 + 0.15 * Math.sin(f.t * 8);
      R.drawPrim('quad', m, [f.color[0], f.color[1], f.color[2], a], expand ? 4 : 1);
    });
    R.endUnlit();

    R.beginUnlit(true);
    w.projectiles.each(function (pr) {
      var heading = Math.atan2(pr.vx, pr.vz);
      if (pr.kind === 'arrow' || pr.kind === 'beam') {
        // crossbow bolt / pierce lance: a sharp shape oriented along travel
        var q = M.Quat.fromEuler([0, 0, 0, 1], 0, heading, 0);
        var wdt = pr.r * (pr.kind === 'beam' ? 1.4 : 1.15);
        var len = pr.r * (pr.kind === 'beam' ? 9 : 4.6);
        M.Mat4.fromRTS(m, q, [pr.x, pr.y, pr.z], [wdt, wdt, len]);
        R.drawPrim('bolt', m, [pr.color[0], pr.color[1], pr.color[2], 0.98], 0);
        // bright energy core at the tip
        var tx = pr.x + Math.sin(heading) * len * 0.4, tz = pr.z + Math.cos(heading) * len * 0.4;
        M.Mat4.fromRTS(m, M.Quat.identity([0, 0, 0, 1]), [tx, pr.y, tz], [pr.r * 0.9, pr.r * 0.9, pr.r * 0.9]);
        R.drawPrim('sphere', m, [1, 1, 0.9, 0.9], 0);
      } else if (pr.kind === 'shard') {
        // BOSS energy shard: a long crystalline dart along travel with a comet tail + hot core
        var cr = pr.color, qs = M.Quat.fromEuler([0, 0, 0, 1], pr.spin * 0.6, heading, 0);
        var swd = pr.r * 1.7, sln = pr.r * 7.0;
        // fading motion echoes behind (comet tail)
        for (var e = 3; e >= 1; e--) {
          var ex = pr.x - Math.sin(heading) * sln * 0.42 * e;
          var ez = pr.z - Math.cos(heading) * sln * 0.42 * e;
          var ef = 1 - e * 0.24;
          M.Mat4.fromRTS(m, qs, [ex, pr.y, ez], [swd * ef, swd * ef, sln * ef]);
          R.drawPrim('bolt', m, [cr[0], cr[1], cr[2], 0.30 / e], 0);
        }
        // main shard body
        M.Mat4.fromRTS(m, qs, [pr.x, pr.y, pr.z], [swd, swd, sln]);
        R.drawPrim('bolt', m, [Math.min(1, cr[0] + 0.2), Math.min(1, cr[1] + 0.15), Math.min(1, cr[2] + 0.15), 0.98], 0);
        // hot white-hot core
        M.Mat4.fromRTS(m, M.Quat.identity([0, 0, 0, 1]), [pr.x, pr.y, pr.z], [pr.r * 1.25, pr.r * 1.25, pr.r * 1.25]);
        R.drawPrim('sphere', m, [1, 0.95, 0.85, 0.95], 0);
      } else if (pr.kind === 'homing') {
        // BOSS seeker: a slow spinning spiked crystal with a pulsing menacing core
        var qh = M.Quat.fromEuler([0, 0, 0, 1], pr.spin, pr.spin * 0.6, heading);
        var pulse = pr.r * (2.1 + 0.5 * Math.sin(pr.spin * 3));
        M.Mat4.fromRTS(m, qh, [pr.x, pr.y, pr.z], [pulse, pulse, pulse]);
        R.drawPrim('shard', m, [pr.color[0], pr.color[1], pr.color[2], 0.96], 0);
        var q2b = M.Quat.fromEuler([0, 0, 0, 1], -pr.spin * 1.3, 0, 0);
        M.Mat4.fromRTS(m, q2b, [pr.x, pr.y, pr.z], [pulse * 0.7, pulse * 0.7, pulse * 0.7]);
        R.drawPrim('shard', m, [1, 0.7, 0.85, 0.85], 0);
        M.Mat4.fromRTS(m, M.Quat.identity([0, 0, 0, 1]), [pr.x, pr.y, pr.z], [pr.r * 1.1, pr.r * 1.1, pr.r * 1.1]);
        R.drawPrim('sphere', m, [1, 0.85, 0.95, 0.9], 0);
      } else if (pr.kind === 'slug') {
        // Rifle round. Only the boss ever got a real projectile shape; every
        // ordinary enemy shot fell through to the plain stretched sphere below,
        // which is what made them look like flying dots.
        //
        // Two draws, no more: several shooters plus an orbiter ring can put a
        // dozen rounds in the air at once and the frame has a 150-call budget.
        // The tail and glow come from the batched particle emitter instead.
        var cs = pr.color;
        var speed = Math.hypot(pr.vx, pr.vz);
        // faster rounds streak longer - reads as velocity rather than as size
        var slen = pr.r * (3.2 + Math.min(4.0, speed * 0.42));
        var qg = M.Quat.fromEuler([0, 0, 0, 1], 0, heading, 0);
        M.Mat4.fromRTS(m, qg, [pr.x, pr.y, pr.z], [pr.r * 1.05, pr.r * 1.05, slen]);
        R.drawPrim('bolt', m, [cs[0], cs[1] * 0.85, cs[2] * 0.7, 0.95], 0);
        // white-hot tip, offset forward so the round has a direction at a glance
        var htx = pr.x + Math.sin(heading) * slen * 0.34;
        var htz = pr.z + Math.cos(heading) * slen * 0.34;
        M.Mat4.fromRTS(m, M.Quat.identity([0, 0, 0, 1]), [htx, pr.y, htz],
          [pr.r * 0.85, pr.r * 0.85, pr.r * 0.85]);
        R.drawPrim('sphere', m, [1, 0.93, 0.78, 0.98], 0);
      } else if (pr.kind === 'pellet') {
        // orbiter ring shot: a slow tumbling shard, deliberately unlike the
        // shooter's flat tracer so the two threats never read as the same thing
        var cp = pr.color;
        var qp = M.Quat.fromEuler([0, 0, 0, 1], pr.spin * 1.4, heading, pr.spin);
        var ps = pr.r * 2.0;
        M.Mat4.fromRTS(m, qp, [pr.x, pr.y, pr.z], [ps, ps, ps]);
        R.drawPrim('shard', m, [cp[0], cp[1], cp[2], 0.96], 0);
        M.Mat4.fromRTS(m, M.Quat.identity([0, 0, 0, 1]), [pr.x, pr.y, pr.z],
          [pr.r * 0.9, pr.r * 0.9, pr.r * 0.9]);
        R.drawPrim('sphere', m, [1, 0.9, 0.85, 0.95], 0);
      } else {
        // energy orbs (anything that did not ask for a shape)
        var q2 = M.Quat.fromEuler([0, 0, 0, 1], pr.spin, heading, 0);
        var sc = pr.r * 2.2;
        M.Mat4.fromRTS(m, q2, [pr.x, pr.y, pr.z], [sc, sc, sc * 1.3]);
        R.drawPrim('sphere', m, [pr.color[0], pr.color[1], pr.color[2], 0.95], 0);
      }
    });
    // one batched draw for every particle (was one draw call each, which spiked
    // to ~320 calls the moment an ultimate fired)
    R.endUnlit();
    R.beginParticles();
    w.particles.each(function (p) {
      var k = p.life / p.maxLife;
      R.addParticle(p.x, p.y, p.z, p.size * (0.9 + k * 1.5), p.color, k);
    });
    R.endParticles();
    R.beginUnlit(true);
    var pl = w.player;
    if (pl && pl.trailPts.length > 1) {
      var col = EH.WEAPONS[pl.weapon].trail;
      R.drawRibbon(pl.trailPts, [col[0] * 1.4, col[1] * 1.4, col[2] * 1.4, 0.92]);
    }
    if (this.mode === 'hub' || this.mode === 'title') {
      var d = this.hubTargets[this.hubTargets.length - 1];
      if (d) {
        M.Mat4.fromRTS(m, M.Quat.identity([0, 0, 0, 1]), [d.x, 1.2, d.z + 0.1], [3.2, 2.6, 1]);
        R.drawPrim('card', m, [0.3, 0.95, 1, 0.5], 3);
      }
    }
    R.endUnlit();
  };

  // ---------------- boot ----------------
  var game = new Game();
  EH.Game = game;
  EH.runSelfTest = function () {
    return (EH.SelfTest ? EH.SelfTest.run() : { error: 'tests.html 에서 실행하세요.' });
  };
  function boot() {
    try { game.init(); }
    catch (e) {
      EH.err(e);
      try { EH.UI.init(); EH.Scenes.init(game); EH.Scenes.goError('초기화 실패', (e && e.stack) || String(e)); } catch (e2) { }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
