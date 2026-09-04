'use strict';
// All DOM screens, HUD, cards, settings. Every control is wired to real logic.
(function () {
  var EH = window.EchoHeart;
  var ICON_COLS = 4, ICON_CELL = 128, ICON_SHEET = 512;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function iconStyle(name, px) {
    px = px || 34;
    var man = EH.AssetManifest && EH.AssetManifest.ui_icons;
    var c = man && man.coords && man.coords[name];
    if (!c) return 'width:' + px + 'px;height:' + px + 'px;';
    var scale = px / ICON_CELL;
    return 'width:' + px + 'px;height:' + px + 'px;' +
      'background-size:' + (ICON_SHEET * scale) + 'px auto;' +
      'background-position:' + (-c[0] * scale) + 'px ' + (-c[1] * scale) + 'px;';
  }

  var UI = EH.UI = {
    overlay: null, hud: null, current: null, modal: false, _toastT: 0,
    init: function () {
      this.overlay = document.getElementById('overlay');
      this.hud = document.getElementById('hud');
      this.toastEl = document.getElementById('toast');
      this.hintEl = document.getElementById('hint');
      this.comboEl = document.getElementById('combo');
      this.portraitEl = document.getElementById('portrait');
      this.bossBar = document.getElementById('bossBar');
      this.el = {
        hpFill: document.getElementById('hpFill'), hpText: document.getElementById('hpText'),
        ultFill: document.getElementById('ultFill'), cores: document.getElementById('cores'),
        roomInfo: document.getElementById('roomInfo'), shards: document.getElementById('shards'),
        bossFill: document.getElementById('bossFill'), bossName: document.getElementById('bossName'),
        bossPhase: document.getElementById('bossPhase'),
        joyBase: document.getElementById('joyBase'), joyKnob: document.getElementById('joyKnob'),
        btnAttack: document.getElementById('btnAttack'), btnDash: document.getElementById('btnDash'),
        btnSkill: document.getElementById('btnSkill'), btnUlt: document.getElementById('btnUlt'),
        btnPause: document.getElementById('btnPause')
      };
    },
    // ---------- generic screen ----------
    close: function () { this.overlay.innerHTML = ''; this.current = null; this.modal = false; },
    screen: function (name, opts) {
      opts = opts || {};
      this.overlay.innerHTML = '';
      this.current = name;
      this.modal = !opts.clear;      // 'clear' screens are decorative and do NOT pause play
      var s = el('div', 'screen' + (opts.clear ? ' clear' : ''));
      var wrap = el('div', 'wrap');
      var panel = el('div', 'panel');
      wrap.appendChild(panel); s.appendChild(wrap);
      this.overlay.appendChild(s);
      return panel;
    },
    button: function (label, cls, fn) {
      var b = el('button', 'btn ' + (cls || ''), label);
      b.addEventListener('click', function (e) {
        e.preventDefault();
        EH.Audio.play('menuSelect');
        fn && fn();
      });
      b.addEventListener('pointerenter', function () { EH.Audio.play('menuMove'); });
      return b;
    },
    row: function (parent, buttons) {
      var r = el('div', 'row');
      buttons.forEach(function (b) { if (b) r.appendChild(b); });
      parent.appendChild(r); return r;
    },
    toast: function (msg, ms) {
      var t = this.toastEl;
      t.textContent = msg; t.classList.remove('hidden');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(function () { t.classList.add('hidden'); }, ms || 1900);
    },
    hint: function (msg, ms) {
      var h = this.hintEl;
      if (!msg) { h.classList.add('hidden'); return; }
      h.textContent = msg; h.classList.remove('hidden');
      clearTimeout(this._hintT);
      var self = this;
      if (ms !== 0) this._hintT = setTimeout(function () { h.classList.add('hidden'); }, ms || 2600);
    },
    showHUD: function (on) { this.hud.classList.toggle('hidden', !on); },

    // ---------- HUD ----------
    updateHUD: function (g) {
      var p = g.world && g.world.player;
      if (!p) return;
      var e = this.el;
      var frac = EH.clamp(p.hp / p.maxHp, 0, 1);
      e.hpFill.style.width = (frac * 100) + '%';
      e.hpText.textContent = Math.ceil(p.hp) + ' / ' + Math.round(p.maxHp);
      e.ultFill.style.width = (EH.clamp(p.ult / p.stats.ultMax, 0, 1) * 100) + '%';
      // cores
      if (e.cores.childElementCount !== p.maxCores) {
        e.cores.innerHTML = '';
        for (var i = 0; i < p.maxCores; i++) e.cores.appendChild(el('div', 'core-pip'));
      }
      for (var j = 0; j < e.cores.childElementCount; j++) {
        e.cores.children[j].classList.toggle('on', j < p.cores);
      }
      var r = g.run;
      if (r) {
        e.roomInfo.textContent = (r.roomType === 'boss' ? '최종 보스' : '방 ' + (r.roomIndex + 1) + ' / ' + (EH.Rooms.TOTAL + 1)) +
          (r.abyss > 0 ? '  ·  심연 ' + r.abyss : '');
        e.shards.textContent = '시간 파편 ' + r.shards;
      }
      // cooldown rings
      var st = p.stats;
      this.ring(e.btnDash, 1 - EH.clamp(p.dashCd / st.dashCooldown, 0, 1));
      var scd = EH.WEAPONS[p.weapon].skill.cd * st.skillCooldownMul;
      this.ring(e.btnSkill, 1 - EH.clamp(p.skillCd / scd, 0, 1));
      e.btnUlt.classList.toggle('ready', p.ult >= st.ultMax);
      e.btnUlt.classList.toggle('disabled', p.ult < st.ultMax);
      // combo
      if (g.world.combo >= 3) {
        this.comboEl.classList.remove('hidden');
        this.comboEl.innerHTML = g.world.combo + '<small>COMBO</small>';
      } else this.comboEl.classList.add('hidden');
      // boss bar
      var b = g.world.boss;
      if (b && b.alive && b.introDone && !b.defeated) {
        this.bossBar.classList.remove('hidden');
        e.bossFill.style.width = (EH.clamp(b.hp / b.maxHp, 0, 1) * 100) + '%';
        e.bossPhase.textContent = (b.phase + 1) + '단계 · ' + EH.BOSS.phases[b.phase].name;
      } else this.bossBar.classList.add('hidden');
    },
    ring: function (btn, frac) {
      var c = btn && btn.querySelector('.cd-ring');
      if (!c) return;
      c.style.strokeDashoffset = (100.5 * EH.clamp(frac, 0, 1)).toFixed(1);
      btn.classList.toggle('disabled', frac < 0.999);
    },
    updateJoystick: function (inp) {
      var b = this.el.joyBase, k = this.el.joyKnob;
      if (inp.joy.active) {
        b.classList.remove('hidden');
        b.style.left = inp.joy.ox + 'px'; b.style.top = inp.joy.oy + 'px';
        k.style.transform = 'translate(calc(-50% + ' + (inp.joy.x * 34) + 'px), calc(-50% + ' + (inp.joy.y * 34) + 'px))';
      } else b.classList.add('hidden');
    },

    // ---------- cards ----------
    echoCard: function (echo, stacks, onPick) {
      var rar = EH.RARITY[echo.rar];
      var c = el('div', 'card rar-' + echo.rar);
      var head = el('div', 'chead');
      head.appendChild(el('div', 'icon', '')).setAttribute('style', iconStyle(echo.icon));
      var t = el('div', '');
      t.appendChild(el('div', 'cname', echo.name));
      var tag = el('span', 'ctag', rar.name + ' · ' + famName(echo.fam));
      tag.style.color = rar.color;
      t.appendChild(tag);
      head.appendChild(t);
      c.appendChild(head);
      c.appendChild(el('div', 'cdesc', EH.Prog.echoDesc(echo, stacks + 1)));
      var meta = '중첩 ' + stacks + ' → ' + (stacks + 1) + ' (최대 ' + echo.max + ')';
      c.appendChild(el('div', 'cmeta', meta));
      c.addEventListener('click', function () { EH.Audio.play('echoPick'); onPick(echo); });
      return c;
    },
    metaCard: function (m, save, onBuy) {
      var lv = EH.Prog.metaLevel(save, m.id);
      var cost = EH.Prog.metaCost(save, m.id);
      var maxed = lv >= m.max;
      var afford = cost != null && save.crystals >= cost;
      var c = el('div', 'card' + (maxed ? ' maxed' : ''));
      var head = el('div', 'chead');
      head.appendChild(el('div', 'icon', '')).setAttribute('style', iconStyle(m.icon));
      var t = el('div', '');
      t.appendChild(el('div', 'cname', m.name));
      t.appendChild(el('span', 'ctag', 'Lv ' + lv + ' / ' + m.max));
      head.appendChild(t); c.appendChild(head);
      c.appendChild(el('div', 'cdesc', EH.Prog.metaDesc(m, Math.min(lv + 1, m.max)) +
        (lv > 0 ? '  (현재: ' + EH.Prog.metaDesc(m, lv) + ')' : '')));
      c.appendChild(el('div', 'cmeta', maxed ? '최대 레벨' :
        ('비용 ' + cost + ' 결정' + (afford ? '' : ' — 부족'))));
      if (!maxed) {
        c.addEventListener('click', function () { onBuy(m); });
        if (!afford) c.style.opacity = '.6';
      }
      return c;
    }
  };
  function famName(f) {
    return { ember: '잿불', storm: '폭풍', void: '공허', neutral: '중립' }[f] || f;
  }
  UI.famName = famName;
  UI.iconStyle = iconStyle;
  UI.el_ = el;
})();
