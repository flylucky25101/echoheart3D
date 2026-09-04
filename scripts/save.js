'use strict';
// Save + settings: localStorage with validation, migration, memory fallback,
// export/import. Never throws; game continues if storage is blocked (file://).
(function () {
  var EH = window.EchoHeart;
  var KEY = 'echoheart_save_v1';

  function defSettings() {
    return {
      masterVol: 0.8, sfxVol: 0.9, musicVol: 0.55,
      vibration: true, screenShake: 1, damageNumbers: true,
      reduceMotion: false, lowSpec: false,
      // spriteMode 0 = real-time 3D meshes. The baked-sprite path is kept as an
      // option, but once scenery was instanced and joints were batched by
      // material the 3D path costs the same 121 draw calls, so there is no
      // longer a reason to default to flat billboards.
      buttonScale: 1, joystickSens: 1, autoAim: 0.75, tutorial: true, spriteMode: 0, showFps: false, bloom: true
    };
  }
  var SETTING_RANGE = {
    masterVol: [0, 1], sfxVol: [0, 1], musicVol: [0, 1],
    screenShake: [0, 1], buttonScale: [0.75, 1.5], joystickSens: [0.5, 1.8], autoAim: [0, 1], spriteMode: [0, 1]
  };
  var BOOL_SETTINGS = ['vibration', 'damageNumbers', 'reduceMotion', 'lowSpec', 'tutorial',
    'showFps', 'bloom'];

  function defaults() {
    return {
      version: EH.SAVE_VERSION,
      crystals: 0,
      meta: {}, adapt: { melee: 0, projectile: 0, blast: 0, field: 0, boss: 0 },
      weapon: 'riftsword',
      deaths: 0, wins: 0, bestRoom: 0, abyss: 0, bestAbyss: 0,
      weaponUse: { riftsword: 0, pulsebow: 0, chaingaunt: 0 },
      bestCombo: 0, bestTime: 0, totalKills: 0,
      settings: defSettings(),
      tutorialSeen: false,
      hints: {},
      unlocks: { abyss: false },
      run: null, seed: 0
    };
  }

  function num(v, min, max, dflt) {
    v = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(v)) return dflt;
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    return v;
  }

  function sanitize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    var s = d;
    s.crystals = Math.floor(num(raw.crystals, 0, 1e9, 0));
    s.deaths = Math.floor(num(raw.deaths, 0, 1e9, 0));
    s.wins = Math.floor(num(raw.wins, 0, 1e9, 0));
    s.bestRoom = Math.floor(num(raw.bestRoom, 0, 999, 0));
    s.abyss = Math.floor(num(raw.abyss, 0, 20, 0));
    s.bestAbyss = Math.floor(num(raw.bestAbyss, 0, 20, 0));
    s.bestCombo = Math.floor(num(raw.bestCombo, 0, 1e6, 0));
    s.bestTime = num(raw.bestTime, 0, 1e7, 0);
    s.totalKills = Math.floor(num(raw.totalKills, 0, 1e9, 0));
    s.tutorialSeen = !!raw.tutorialSeen;
    if (raw.hints && typeof raw.hints === 'object') {
      for (var hk in raw.hints) if (raw.hints[hk]) s.hints[hk] = 1;
    }
    // meta: only known ids, clamped to max
    if (raw.meta && typeof raw.meta === 'object') {
      EH.META.forEach(function (m) {
        var lv = Math.floor(num(raw.meta[m.id], 0, m.max, 0));
        if (lv > 0) s.meta[m.id] = lv;
      });
    }
    // adaptation clamped
    if (raw.adapt && typeof raw.adapt === 'object') {
      for (var k in EH.ADAPT) s.adapt[k] = Math.floor(num(raw.adapt[k], 0, EH.ADAPT[k].max, 0));
    }
    // weapon must exist
    s.weapon = (EH.WEAPONS[raw.weapon]) ? raw.weapon : 'riftsword';
    if (raw.weaponUse && typeof raw.weaponUse === 'object') {
      EH.WEAPON_ORDER.forEach(function (w) { s.weaponUse[w] = Math.floor(num(raw.weaponUse[w], 0, 1e9, 0)); });
    }
    // settings clamped to range
    var rs = (raw.settings && typeof raw.settings === 'object') ? raw.settings : {};
    for (var key in s.settings) {
      if (BOOL_SETTINGS.indexOf(key) >= 0) {
        s.settings[key] = (rs[key] === undefined) ? s.settings[key] : !!rs[key];
      } else if (SETTING_RANGE[key]) {
        s.settings[key] = num(rs[key], SETTING_RANGE[key][0], SETTING_RANGE[key][1], s.settings[key]);
      }
    }
    s.unlocks = { abyss: !!(raw.unlocks && raw.unlocks.abyss) || s.wins > 0 };
    s.seed = Math.floor(num(raw.seed, 0, 4294967295, 0));
    // in-progress run: only keep if structurally sane
    s.run = null;
    var r = raw.run;
    if (r && typeof r === 'object' && typeof r.roomIndex === 'number' && isFinite(r.roomIndex)) {
      s.run = {
        seed: Math.floor(num(r.seed, 0, 4294967295, 0)),
        roomIndex: Math.floor(num(r.roomIndex, 0, 50, 0)),
        hp: num(r.hp, 0, 1e5, 100),
        cores: Math.floor(num(r.cores, 0, 5, 1)),
        shards: Math.floor(num(r.shards, 0, 1e6, 0)),
        weapon: EH.WEAPONS[r.weapon] ? r.weapon : 'riftsword',
        abyss: Math.floor(num(r.abyss, 0, 20, 0)),
        echoes: {},
        kills: Math.floor(num(r.kills, 0, 1e6, 0)),
        elapsed: num(r.elapsed, 0, 1e6, 0),
        path: Array.isArray(r.path) ? r.path.filter(function (x) { return typeof x === 'string' && EH.ROOM_TYPES[x]; }).slice(0, 20) : []
      };
      if (r.echoes && typeof r.echoes === 'object') {
        EH.ECHOES.forEach(function (e) {
          var st = Math.floor(num(r.echoes[e.id], 0, e.max, 0));
          if (st > 0) s.run.echoes[e.id] = st;
        });
      }
    }
    return s;
  }

  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var v = Math.floor(num(raw.version, 0, 999, 0));
    if (v === EH.SAVE_VERSION) return raw;
    // v0/v1/v2 -> v3 : fields added over time; sanitize() fills anything missing.
    var out = raw;
    if (v < 2) { out.adapt = out.adapt || {}; out.weaponUse = out.weaponUse || {}; }
    if (v < 3) { out.unlocks = out.unlocks || {}; out.run = out.run || null; }
    out.version = EH.SAVE_VERSION;
    out._migratedFrom = v;
    return out;
  }

  var Save = {
    data: defaults(),
    storageOk: true,
    lastError: '',
    load: function () {
      var raw = null;
      try {
        var txt = window.localStorage.getItem(KEY);
        if (txt) raw = JSON.parse(txt);
        this.storageOk = true;
      } catch (e) {
        this.storageOk = false; this.lastError = String(e && e.message || e);
        EH.warn('저장 불러오기 실패(메모리 저장으로 전환):', e);
      }
      try { raw = migrate(raw); } catch (e2) { raw = null; }
      this.data = sanitize(raw);
      return this.data;
    },
    save: function () {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(this.data));
        this.storageOk = true; return true;
      } catch (e) {
        this.storageOk = false; this.lastError = String(e && e.message || e);
        return false;
      }
    },
    reset: function () { this.data = defaults(); this.save(); return this.data; },
    exportString: function () {
      try { return btoa(unescape(encodeURIComponent(JSON.stringify(this.data)))); }
      catch (e) { return JSON.stringify(this.data); }
    },
    importString: function (str) {
      if (!str || typeof str !== 'string') return { ok: false, msg: '입력이 비어 있습니다.' };
      var obj = null;
      try { obj = JSON.parse(decodeURIComponent(escape(atob(str.trim())))); }
      catch (e) { try { obj = JSON.parse(str); } catch (e2) { return { ok: false, msg: '저장 코드를 해석할 수 없습니다.' }; } }
      if (!obj || typeof obj !== 'object') return { ok: false, msg: '저장 데이터 형식이 올바르지 않습니다.' };
      try { obj = migrate(obj); } catch (e3) { return { ok: false, msg: '마이그레이션 실패' }; }
      this.data = sanitize(obj);
      this.save();
      return { ok: true, msg: '저장 데이터를 불러왔습니다.' };
    },
    // settings helpers
    get: function (k) { return this.data.settings[k]; },
    set: function (k, v) {
      if (BOOL_SETTINGS.indexOf(k) >= 0) this.data.settings[k] = !!v;
      else if (SETTING_RANGE[k]) this.data.settings[k] = num(v, SETTING_RANGE[k][0], SETTING_RANGE[k][1], this.data.settings[k]);
      else return;
      this.save();
    },
    defaults: defaults, defSettings: defSettings, sanitize: sanitize, migrate: migrate,
    SETTING_RANGE: SETTING_RANGE, BOOL_SETTINGS: BOOL_SETTINGS
  };
  EH.Save = Save;
  EH.Settings = { get: function (k) { return Save.get(k); }, set: function (k, v) { Save.set(k, v); } };
})();
