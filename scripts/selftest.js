'use strict';
// Self tests (no frameworks). Runs from tests.html or EchoHeart.runSelfTest().
(function () {
  var EH = window.EchoHeart;
  var T = EH.SelfTest = { results: [] };

  function ok(name, cond, extra) {
    T.results.push({ name: name, ok: !!cond, extra: extra == null ? '' : String(extra) });
    return !!cond;
  }
  function tryOk(name, fn) {
    try { var r = fn(); return ok(name, r === undefined ? true : r); }
    catch (e) { return ok(name, false, (e && e.message) || e); }
  }

  T.run = function (done) {
    T.results = [];

    var EHm = EH.Meshes;

    // ---------- WebGL2 + shaders ----------
    var canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    var R = new EH.Renderer(canvas);
    var glOk = R.init();
    ok('WebGL2 컨텍스트 생성', glOk, R.errors.join(';'));
    ok('셰이더 컴파일/링크 (pbr)', glOk && R.progs.pbr.ok, glOk ? (R.progs.pbr.error || '') : 'no context');
    ok('셰이더 컴파일/링크 (unlit)', glOk && R.progs.unlit.ok, glOk ? (R.progs.unlit.error || '') : 'no context');
    ok('셰이더 컴파일/링크 (sky)', glOk && R.progs.sky.ok, glOk ? (R.progs.sky.error || '') : 'no context');
    tryOk('모든 메시 GPU 업로드', function () { return glOk && R.uploadAll() === Object.keys(EHm).length; });

    // ---------- mesh data ----------
    var meshNames = Object.keys(EHm);
    ok('메시 데이터 존재 (20종)', meshNames.length >= 20, meshNames.length + '종');
    var attrBad = 0, idxBad = 0, nanBad = 0, windBad = 0, volBad = 0, tris = 0, parts = 0;
    var lowY = 1e9, highY = -1e9;
    meshNames.forEach(function (n) {
      EHm[n].parts.forEach(function (p) {
        parts++;
        var nv = p.pos.length / 3;
        tris += p.idx.length / 3;
        if (p.nrm.length / 3 !== nv || p.uv.length / 2 !== nv) attrBad++;
        for (var i = 0; i < p.idx.length; i++) if (p.idx[i] >= nv) { idxBad++; break; }
        for (var k = 0; k < p.pos.length; k++) if (!isFinite(p.pos[k])) { nanBad++; break; }
        var vol = 0;
        for (var t = 0; t < p.idx.length; t += 3) {
          var a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3, P = p.pos, N = p.nrm;
          vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
                - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
                + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
          var ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
          var vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
          var gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
          if (gx * (N[a] + N[b] + N[c]) + gy * (N[a + 1] + N[b + 1] + N[c + 1])
            + gz * (N[a + 2] + N[b + 2] + N[c + 2]) < 0) windBad++;
        }
        if (vol < -1e-6) volBad++;
      });
    });
    ok('정점/노멀/UV 개수 일치', attrBad === 0, attrBad + '건 불일치');
    ok('인덱스 범위 유효', idxBad === 0, idxBad + '건 초과');
    ok('메시 NaN 없음', nanBad === 0, nanBad + '건');
    ok('와인딩과 노멀 방향 일치', windBad === 0, windBad + '개 삼각형 불일치');
    ok('뒤집힌(내부향) 파트 없음', volBad === 0, volBad + '개');
    ok('메시 통계', true, parts + ' 파트 / ' + tris + ' 삼각형');
    // rig must stand ON the floor (regression: pivot was subtracted twice)
    tryOk('리그가 바닥 위에 정확히 서 있음', function () {
      var an = new EH.Animator('lian');
      an.update(0.016, EH.CLIPS.lian.idle, {});
      var root = EH.M.Mat4.create();
      EH.M.Mat4.identity(root);
      an.compose(root);
      var minY = 1e9, maxY = -1e9;
      for (var i = 0; i < an.parts.length; i++) {
        var m = an.mats[i], P = an.parts[i].pos;
        for (var v = 0; v < P.length; v += 3) {
          var y = m[1] * P[v] + m[5] * P[v + 1] + m[9] * P[v + 2] + m[13];
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      lowY = minY; highY = maxY;
      return minY > -0.25 && minY < 0.35 && maxY > 1.4 && maxY < 2.3;
    });
    ok('플레이어 신장 (발~머리)', true, lowY.toFixed(2) + ' ~ ' + highY.toFixed(2) + ' 유닛');

    // ---------- textures ----------
    var man = EH.AssetManifest;
    var manKeys = Object.keys(man || {});
    ok('텍스처 매니페스트 유효', manKeys.length > 0 && manKeys.every(function (k) {
      return man[k].path && typeof man[k].path === 'string' && man[k].path.indexOf('http') !== 0;
    }), manKeys.length + '개 항목');
    var missingMat = [];
    Object.keys(EH.MATERIALS).forEach(function (id) {
      ['albedo', 'normal', 'orm', 'emissive'].forEach(function (kind) {
        if (!man[EH.MATERIALS[id].group + '_' + kind]) missingMat.push(id + '/' + kind);
      });
    });
    ok('모든 재질의 필수 텍스처 존재', missingMat.length === 0, missingMat.join(','));
    // REGRESSION: file:// blocks GL upload of local images -> every surface went flat white.
    var noEmbed = [];
    Object.keys(EH.MATERIALS).forEach(function (id) {
      ['albedo', 'normal', 'orm', 'emissive'].forEach(function (kind) {
        var k = EH.MATERIALS[id].group + '_' + kind;
        if (!(EH.TextureData && EH.TextureData[k])) noEmbed.push(k);
      });
    });
    ok('모든 재질에 내장 텍스처(data URI) 존재 — file:// 대응', noEmbed.length === 0,
      noEmbed.length ? noEmbed.slice(0, 4).join(',') : Object.keys(EH.TextureData || {}).length + '개 내장');
    tryOk('내장 텍스처가 유효한 data URI 형식', function () {
      var ks = Object.keys(EH.TextureData || {});
      if (!ks.length) return false;
      return ks.every(function (k) {
        var v = EH.TextureData[k];
        return typeof v === 'string' && v.indexOf('data:image/') === 0 && v.length > 200;
      });
    });
    tryOk('file:// 에서 로더가 내장 텍스처를 선택', function () {
      var L = new EH.TextureLoader();
      L.embeddedMode = true;
      var pick = L.srcFor('riftSteel_albedo', { path: 'assets/x.webp' });
      return pick.embedded === true && pick.src.indexOf('data:image/') === 0;
    });

    // ---------- save ----------
    tryOk('기본 저장 생성', function () {
      var d = EH.Save.defaults();
      return d.version === EH.SAVE_VERSION && d.crystals === 0 && d.weapon === 'riftsword';
    });
    tryOk('저장 왕복(export/import)', function () {
      var backup = EH.Save.data;
      EH.Save.data = EH.Save.defaults();
      EH.Save.data.crystals = 1234;
      var code = EH.Save.exportString();
      EH.Save.data.crystals = 0;
      var r = EH.Save.importString(code);
      var pass = r.ok && EH.Save.data.crystals === 1234;
      EH.Save.data = backup;
      return pass;
    });
    tryOk('잘못된 JSON 안전 처리', function () { return EH.Save.importString('{{{not json').ok === false; });
    tryOk('NaN/음수/범위이탈 값 정규화', function () {
      var s = EH.Save.sanitize({ crystals: -50, deaths: NaN, bestTime: Infinity, settings: { masterVol: 99, sfxVol: -3 } });
      return s.crystals === 0 && s.deaths === 0 && isFinite(s.bestTime) &&
        s.settings.masterVol === 1 && s.settings.sfxVol === 0;
    });
    tryOk('존재하지 않는 업그레이드 ID 제거', function () {
      var s = EH.Save.sanitize({ meta: { nope_xyz: 5, m_hp: 2 } });
      return !('nope_xyz' in s.meta) && s.meta.m_hp === 2;
    });
    tryOk('저장 마이그레이션 (v1 -> 현재)', function () {
      var m = EH.Save.migrate({ version: 1, crystals: 7 });
      return m.version === EH.SAVE_VERSION && m._migratedFrom === 1;
    });
    tryOk('설정 범위 클램프', function () {
      var s = EH.Save.sanitize({ settings: { joystickSens: 99, autoAim: -5, buttonScale: 0 } });
      var r = EH.Save.SETTING_RANGE;
      return s.settings.joystickSens === r.joystickSens[1] &&
        s.settings.autoAim === r.autoAim[0] &&
        s.settings.buttonScale === r.buttonScale[0];
    });

    // ---------- rng / rooms ----------
    tryOk('seeded random 재현성', function () {
      var a = new EH.RNG(555), b = new EH.RNG(555);
      for (var i = 0; i < 50; i++) if (a.next() !== b.next()) return false;
      return true;
    });
    tryOk('방 생성: 첫 방은 항상 일반 전투', function () {
      for (var s = 0; s < 40; s++) {
        var r = new EH.RNG(s);
        var c = EH.Rooms.nextChoices(r, { roomIndex: -1, path: [], hpFrac: 1 });
        if (c.length !== 1 || c[0] !== 'combat') return false;
      }
      return true;
    });
    tryOk('방 생성: 특수방 연속 등장 없음', function () {
      for (var s = 0; s < 60; s++) {
        var r = new EH.RNG(s), st = { roomIndex: 0, path: ['combat'], hpFrac: 1 }, prev = 'combat';
        for (var i = 1; i < EH.Rooms.TOTAL; i++) {
          var c = EH.Rooms.nextChoices(r, st);
          if (c.indexOf(prev) >= 0 && prev !== 'combat') return false;
          prev = c[0]; st.roomIndex++; st.path.push(prev);
        }
      }
      return true;
    });
    tryOk('방 생성: 총 7방 구성', function () {
      var r = new EH.RNG(3), st = { roomIndex: -1, path: [], hpFrac: 1 }, n = 0;
      for (var i = 0; i < EH.Rooms.TOTAL; i++) { var c = EH.Rooms.nextChoices(r, st); st.roomIndex++; st.path.push(c[0]); n++; }
      var last = EH.Rooms.nextChoices(r, st);
      return n === EH.Rooms.TOTAL && last[0] === 'boss';
    });
    tryOk('적 스폰 위치: 벽 밖/플레이어 위 생성 없음', function () {
      var half = EH.CONFIG.floorHalf, p = { x: 0, z: 0 };
      for (var i = 0; i < 200; i++) {
        var sp = EH.Rooms.spawnPoint(new EH.RNG(i), p, half);
        if (Math.hypot(sp.x, sp.z) <= 4.0) return false;
        if (Math.abs(sp.x) >= half || Math.abs(sp.z) >= half) return false;
      }
      return true;
    });

    // ---------- progression ----------
    tryOk('잔향 제안 중복 없음', function () {
      for (var s = 0; s < 60; s++) {
        var o = EH.Prog.offerEchoes(new EH.RNG(s), {}, 3, 0);
        var ids = o.map(function (x) { return x.id; });
        if (new Set(ids).size !== ids.length) return false;
      }
      return true;
    });
    tryOk('잔향 최대 중첩 초과 불가', function () {
      var maxed = {};
      EH.ECHOES.forEach(function (e) { maxed[e.id] = e.max; });
      return EH.Prog.offerEchoes(new EH.RNG(1), maxed, 3, 0).length === 0;
    });
    tryOk('영구 업그레이드 상한', function () {
      var s = EH.Save.defaults(); s.crystals = 999999;
      var m = EH.META[0];
      for (var i = 0; i < m.max; i++) EH.Prog.buyMeta(s, m.id);
      return EH.Prog.buyMeta(s, m.id).ok === false && s.meta[m.id] === m.max;
    });
    tryOk('결정 부족 시 구매 거부', function () {
      var s = EH.Save.defaults(); s.crystals = 0;
      return EH.Prog.buyMeta(s, EH.META[0].id).ok === false;
    });
    tryOk('사망 적응 상한 (3단계)', function () {
      var s = EH.Save.defaults();
      for (var i = 0; i < 6; i++) EH.Prog.recordDeath(s, 'blast');
      return s.adapt.blast === EH.ADAPT.blast.max;
    });
    tryOk('적응이 피해를 실제로 감소', function () {
      var s = EH.Save.defaults(); s.adapt.melee = 3;
      return EH.Prog.mitigate(s, 100, 'melee') < 100 && EH.Prog.mitigate(s, 100, 'projectile') === 100;
    });
    tryOk('첫 방 사망도 최소 보상 지급', function () {
      return EH.Prog.runReward({ roomsCleared: 0, kills: 0, echoes: {} }, EH.Save.defaults(), false) > 0;
    });
    tryOk('생명 코어 최대 2개 제한', function () {
      var s = EH.Save.defaults(); s.meta['m_core'] = 5;
      return EH.Prog.computeStats(s, {}).maxLifeCores === 2;
    });

    // ---------- data integrity ----------
    tryOk('무기 데이터 3종 + 메시 존재', function () {
      return EH.WEAPON_ORDER.length === 3 && EH.WEAPON_ORDER.every(function (w) {
        var d = EH.WEAPONS[w];
        return d && d.skill && d.ult && EHm[d.mesh] && EHm[d.mesh].parts.length > 0;
      });
    });
    tryOk('적 데이터 6종 + 메시 존재', function () {
      return EH.ENEMY_ORDER.length >= 6 && EH.ENEMY_ORDER.every(function (k) {
        var d = EH.ENEMIES[k];
        return d && EHm[d.mesh] && EHm[d.mesh].parts.length > 0;
      });
    });
    tryOk('엘리트 속성 3종', function () { return Object.keys(EH.ELITES).length === 3; });
    tryOk('잔향 18종 이상 · ID 고유 · 설명 동작', function () {
      var ids = EH.ECHOES.map(function (e) { return e.id; });
      if (EH.ECHOES.length < 18 || new Set(ids).size !== ids.length) return false;
      return EH.ECHOES.every(function (e) {
        return typeof EH.Prog.echoDesc(e, 1) === 'string' && EH.Prog.echoDesc(e, 1).length > 0 && e.max > 0;
      });
    });
    tryOk('영구 업그레이드 12종 이상 · ID 고유', function () {
      var ids = EH.META.map(function (m) { return m.id; });
      return EH.META.length >= 12 && new Set(ids).size === ids.length &&
        EH.META.every(function (m) { return m.max > 0 && typeof m.cost(0) === 'number'; });
    });
    tryOk('보스 3단계 정의', function () { return EH.BOSS.phases.length === 3 && !!EHm[EH.BOSS.mesh]; });
    tryOk('애니메이션 클립 (플레이어/적/보스)', function () {
      return Object.keys(EH.CLIPS.lian).length >= 18 && Object.keys(EH.CLIPS.foe).length >= 6
        && Object.keys(EH.CLIPS.boss).length >= 7;
    });
    tryOk('애니메이션 클립 NaN 없음', function () {
      var an = new EH.Animator('lian'), root = EH.M.Mat4.create();
      var names = Object.keys(EH.CLIPS.lian);
      for (var i = 0; i < names.length; i++) {
        an.stateTime = 0;
        for (var f = 0; f < 20; f++) {
          an.stateTime += 0.033;
          an.update(0.033, EH.CLIPS.lian[names[i]], { speed: 1, dur: 0.35 });
          an.compose(root);
        }
        for (var m2 = 0; m2 < an.mats.length; m2++) if (EH.M.Mat4.hasNaN(an.mats[m2])) return false;
      }
      return true;
    });
    tryOk('행렬 수학 정확도 (invert/perspective/lookAt)', function () {
      var M = EH.M.Mat4, q = EH.M.Quat.fromEuler([0, 0, 0, 1], 0.3, 0.7, -0.4);
      var a = M.create(); M.fromRTS(a, q, [1, 2, 3], [1.5, 0.8, 1.2]);
      var inv = M.invert(M.create(), a), id = M.multiply(M.create(), a, inv);
      var err = 0;
      for (var i = 0; i < 16; i++) err += Math.abs(id[i] - (i % 5 === 0 ? 1 : 0));
      var p = M.perspective(M.create(), 1, 1.7, 0.1, 100);
      return err < 1e-4 && !M.hasNaN(p);
    });

    // ---------- combat / life core / boss (headless world) ----------
    var stub = {
      save: EH.Save, runOver: false, paused: false,
      run: { abyss: 0, kills: 0, eliteKills: 0, shards: 0, echoes: {} },
      cam: { shake: function () {}, setZoom: function () {} },
      vibrate: function () {}, deaths: 0, wins: 0, phases: [],
      onPlayerDeath: function () { this.deaths++; },
      onBossDefeated: function () { this.wins++; },
      onBossPhase: function (p) { this.phases.push(p); }
    };
    var world = null;
    tryOk('월드/플레이어 생성', function () {
      world = new EH.World(stub);
      world.player = new EH.Player(world);
      world.player.applyStats(EH.Prog.computeStats(EH.Save.defaults(), {}));
      world.player.spawn(0, 0);
      return world.player.hp === world.player.maxHp;
    });
    tryOk('생명 코어 1개 소비 후 50% 체력 부활', function () {
      var p = world.player;
      p.maxCores = 2; p.cores = 1; p.hp = 5; p.iframes = 0; p.dead = false;
      world.damagePlayer(9999, 'melee', 1, 1);
      return p.cores === 0 && !p.dead && Math.abs(p.hp - p.maxHp * 0.5) < 1.5 && p.iframes > 1;
    });
    tryOk('무적 시간 중 피해 무시', function () {
      var p = world.player, hp = p.hp;
      world.damagePlayer(50, 'melee', 1, 1);
      return p.hp === hp;
    });
    tryOk('생명 코어 중복 소비 없음', function () {
      var p = world.player;
      p.iframes = 0; p.cores = 0; p.hp = 1; stub.deaths = 0;
      world.damagePlayer(9999, 'projectile', 1, 1);
      var afterFirst = stub.deaths;
      world.killPlayer('projectile');
      world.killPlayer('melee');
      return afterFirst === 1 && stub.deaths === 1 && p.cores === 0;
    });
    tryOk('보스 단계 전환 중복 없음 · 승리 1회 처리', function () {
      var w2 = new EH.World(stub);
      w2.player = new EH.Player(w2);
      w2.player.applyStats(EH.Prog.computeStats(EH.Save.defaults(), {}));
      w2.player.spawn(0, 0);
      stub.phases = []; stub.wins = 0;
      var b = w2.spawnBoss();
      b.state = 'idle'; b.introDone = true; b.stateTime = 0;
      for (var i = 0; i < 40; i++) b.update(0.05, w2.player);
      b.hp = b.maxHp * 0.5;
      for (var j = 0; j < 80; j++) b.update(0.05, w2.player);
      b.hp = b.maxHp * 0.2;
      for (var k = 0; k < 80; k++) b.update(0.05, w2.player);
      var uniquePhases = new Set(stub.phases).size === stub.phases.length;
      b.hp = 0; b.die(); b.die(); b.die();
      return uniquePhases && stub.wins === 1;
    });
    // --- REGRESSION: 사용자 제보 (예고만 하고 실제 공격을 하지 않음) ---
    tryOk('적 6종 모두 예고 후 실제로 공격한다', function () {
      var bad = [];
      EH.ENEMY_ORDER.forEach(function (kind) {
        var w2 = new EH.World(stub);
        w2.player = new EH.Player(w2);
        w2.player.applyStats(EH.Prog.computeStats(EH.Save.defaults(), {}));
        w2.player.spawn(0, 0);
        var far = (kind === 'gunner' || kind === 'sentinel') ? 5.5 : 1.6;
        var e = w2.spawnEnemy(kind, far, 0, null);
        if (!e) { bad.push(kind + '(spawn)'); return; }
        var dmg = 0;
        var orig = w2.damagePlayer.bind(w2);
        w2.damagePlayer = function (a, t, x, z) { dmg += a; return orig(a, t, x, z); };
        var attacked = false;
        for (var i = 0; i < 620; i++) {
          w2.player.hp = 100; w2.player.iframes = 0;   // survive so we can observe
          w2.update(0.016);
          if (e.state === 'attack') attacked = true;
        }
        var proj = 0; w2.projectiles.items.forEach(function () { proj++; });
        if (dmg <= 0 && !attacked && proj === 0) bad.push(kind);
      });
      return bad.length === 0;
    });
    tryOk('예고가 매 프레임 재생성되지 않는다', function () {
      var w2 = new EH.World(stub);
      w2.player = new EH.Player(w2);
      w2.player.applyStats(EH.Prog.computeStats(EH.Save.defaults(), {}));
      w2.player.spawn(0, 0);
      var e = w2.spawnEnemy('stalker', 2.0, 0, null);
      if (!e) return true;
      var made = 0;
      var ot = w2.telegraph.bind(w2);
      w2.telegraph = function () { made++; return ot.apply(w2, arguments); };
      for (var i = 0; i < 620; i++) { w2.player.hp = 100; w2.player.iframes = 0; w2.update(0.016); }
      return made > 0 && made < 12;    // a handful over 10s, not one per frame
    });
    tryOk('행동 상태(tell/attack/recover)는 이동 상태에 덮어써지지 않는다', function () {
      var w2 = new EH.World(stub);
      w2.player = new EH.Player(w2);
      w2.player.applyStats(EH.Prog.computeStats(EH.Save.defaults(), {}));
      w2.player.spawn(0, 0);
      var e = w2.spawnEnemy('stalker', 1.6, 0, null);
      if (!e) return true;
      e.cd = 0;                       // force a tell on the next frame
      w2.update(0.016);
      var held = (e.state === 'tell');
      w2.update(0.016);               // the very next frame used to reset it to idle
      return held && (e.state === 'tell' || e.state === 'attack');
    });

    // --- REGRESSION: 사용자 제보 (적이 벽 밖으로 나가고 지형물을 통과함) ---
    tryOk('적이 아레나 밖으로 나가지 않음 (강한 넉백에도)', function () {
      stub.room = { props: [] };
      var h = EH.CONFIG.floorHalf;
      var okAll = true;
      for (var k = 0; k < 4; k++) {
        var e = world.spawnEnemy('stalker', (k % 2 ? 6 : -6), (k < 2 ? 6 : -6), null);
        if (!e) continue;
        e.knockX = 900 * (k % 2 ? 1 : -1);
        e.knockZ = 900 * (k < 2 ? 1 : -1);
        for (var i = 0; i < 90; i++) e.update(0.016, world.player);
        if (Math.abs(e.x) > h + 0.01 || Math.abs(e.z) > h + 0.01) okAll = false;
        e.alive = false;
      }
      return okAll;
    });
    tryOk('죽어가는 적도 벽 밖으로 새지 않음', function () {
      stub.room = { props: [] };
      var e = world.spawnEnemy('gunner', 8, 8, null);
      if (!e) return true;
      e.dying = true; e.knockX = 800; e.knockZ = 800;
      for (var i = 0; i < 60; i++) e.update(0.016, world.player);
      var h = EH.CONFIG.floorHalf;
      var pass = Math.abs(e.x) <= h + 0.01 && Math.abs(e.z) <= h + 0.01;
      e.alive = false;
      return pass;
    });
    tryOk('플레이어가 지형물을 통과하지 못함', function () {
      stub.room = { props: [{ mesh: 'pillar', x: 2, z: 0, col: 0.5 }] };
      var p = world.player;
      p.x = 2.0; p.z = 0.0;                       // start dead inside the pillar
      world.confine(p);
      var d = Math.hypot(p.x - 2, p.z - 0);
      var pass = d >= 0.5 + p.radius - 0.02;
      stub.room = { props: [] };
      return pass;
    });
    tryOk('적도 지형물을 통과하지 못함', function () {
      stub.room = { props: [{ mesh: 'forge', x: -3, z: 1, col: 0.95 }] };
      var e = world.spawnEnemy('shield', -3, 1, null);
      if (!e) { stub.room = { props: [] }; return true; }
      world.confine(e);
      var d = Math.hypot(e.x + 3, e.z - 1);
      var pass = d >= 0.95 + e.radius - 0.02;
      e.alive = false; stub.room = { props: [] };
      return pass;
    });
    tryOk('지형물 충돌 반경이 정의되어 있음', function () {
      var rng = new EH.RNG(5);
      var props = EH.Rooms.buildProps(rng, 'engine', 'combat');
      var solid = props.filter(function (p) { return p.col > 0; });
      return solid.length > 0 && props.every(function (p) { return typeof p.col === 'number' && isFinite(p.col); });
    });

    tryOk('죽은 적은 추가 피해를 받지 않음', function () {
      var e = world.spawnEnemy('stalker', 3, 3, null);
      e.hp = 1; world.damageEnemy(e, 500, {});
      var before = stub.run.kills;
      world.damageEnemy(e, 500, {});
      return e.dying === true && stub.run.kills === before;
    });

    // ---------- UI / scenes ----------
    tryOk('UI 초기화 및 버튼 동작', function () {
      if (!document.getElementById('overlay')) return true;   // no UI host in this page
      EH.UI.init();
      var clicked = 0;
      var b = EH.UI.button('테스트', '', function () { clicked++; });
      b.dispatchEvent ? b.dispatchEvent(new Event('click')) : b.click();
      return clicked === 1;
    });
    tryOk('모든 화면 빌더가 예외 없이 실행', function () {
      if (!document.getElementById('overlay')) return true;
      var stubG = {
        save: EH.Save, run: null, world: { player: EH.Game && EH.Game.world ? EH.Game.world.player : null },
        stats: EH.Prog.computeStats(EH.Save.data, {}),
        enterHub: function () {}, setHubWeapon: function () {},
        applyLowSpec: function () {}, applyButtonScale: function () {},
        startRun: function () {}, resumeRun: function () {}, retryInit: function () {}
      };
      EH.Scenes.init(stubG);
      ['goTitle', 'confirmNew', 'goSettings', 'goSaveManage', 'goWeapon',
       'goGrowth', 'goAdapt', 'goAbyss', 'goRecords', 'goLoading'].forEach(function (fn) {
        EH.Scenes[fn]('title');
      });
      EH.Scenes.goGameOver({ roomsCleared: 1, kills: 5, eliteKills: 0, maxCombo: 3, abyss: 0, crystals: 20, adapt: { cause: 'melee', level: 1, gained: true } });
      EH.Scenes.goVictory({ time: 100, kills: 50, maxCombo: 9, abyss: 0, crystals: 200, newAbyss: 1 });
      EH.Scenes.goError('테스트', 'detail');
      EH.UI.close();
      if (EH.Game && EH.Game.started) EH.Scenes.init(EH.Game);
      return true;
    });

    // ---------- async: real texture loading (embedded + GL upload) ----------
    var loader = new EH.TextureLoader();
    loader.loadAll(EH.AssetManifest, null, function () {
      ok('텍스처 실제 로딩', loader.failed.length === 0,
        loader.failed.length ? ('실패 ' + loader.failed.length + '개') :
          (loader.total + '개 성공 (내장 ' + loader.usedEmbedded + ' / 파일 ' + loader.usedFile + ')'));
      if (glOk) {
        R.bindTextures(loader);
        var bad = [];
        for (var id in EH.MATERIALS) {
          var set = R.matTex[id];
          if (!set) { bad.push(id); continue; }
          // a material still pointing at the 1x1 fallback means the upload failed
          if (set.albedo === R.fallback.albedo) bad.push(id + '(albedo=fallback)');
        }
        ok('모든 재질이 실제 텍스처로 업로드됨 (흰 박스 회귀 방지)', bad.length === 0,
          bad.length ? bad.slice(0, 4).join(',') : Object.keys(R.matTex).length + '개 재질');
      } else {
        ok('모든 재질이 실제 텍스처로 업로드됨 (흰 박스 회귀 방지)', false, 'no context');
      }
      // ---- weapon matchup integrity ----
      // Each weapon must have exactly 2 strong / 2 weak enemies AND the three
      // resistance columns must sum to the same total; otherwise one weapon is
      // quietly stronger overall instead of merely preferring other targets.
      (function () {
        var types = ['slash', 'pierce', 'impact'];
        var cols = {}, cnt = {}, rowsOk = true;
        types.forEach(function (ty) { cols[ty] = 0; cnt[ty] = { s: 0, w: 0 }; });
        EH.ENEMY_ORDER.forEach(function (k) {
          var r = EH.ENEMIES[k].resist;
          if (!r) { rowsOk = false; return; }
          types.forEach(function (ty) {
            var v = r[ty];
            if (!(v > 0 && isFinite(v))) rowsOk = false;
            cols[ty] += v;
            if (v > 1.12) cnt[ty].s++; else if (v < 0.88) cnt[ty].w++;
          });
        });
        var vals = types.map(function (ty) { return cols[ty]; });
        var even = Math.max.apply(null, vals) - Math.min.apply(null, vals) < 1e-6;
        var sym = types.every(function (ty) { return cnt[ty].s === 2 && cnt[ty].w === 2; });
        ok('무기 상성: 저항값 유효', rowsOk);
        ok('무기 상성: 무기별 저항 합계 동일 (총합 편향 없음)', even,
          types.map(function (ty) { return ty + '=' + cols[ty].toFixed(2); }).join(' '));
        ok('무기 상성: 무기마다 강함2/약함2 대칭', sym,
          types.map(function (ty) { return ty + ' 강' + cnt[ty].s + '/약' + cnt[ty].w; }).join(' '));
        var bc = { slash: 0, pierce: 0, impact: 0 };
        EH.BOSS_RESIST.forEach(function (ph) {
          bc.slash += ph.slash; bc.pierce += ph.pierce; bc.impact += ph.impact;
        });
        var bv = [bc.slash, bc.pierce, bc.impact];
        ok('보스 페이즈 저항: 무기별 합계 동일',
          Math.max.apply(null, bv) - Math.min.apply(null, bv) < 1e-6,
          bv.map(function (x) { return x.toFixed(2); }).join('/'));
        var miss = EH.WEAPON_ORDER.filter(function (w) { return !EH.WEAPONS[w].dmgType; });
        ok('모든 무기에 데미지 타입 지정', miss.length === 0, miss.join(','));
      })();

      T.summary = summarise();
      if (done) done(T.summary);
    });

    function summarise() {
      var pass = 0;
      T.results.forEach(function (r) { if (r.ok) pass++; });
      return { total: T.results.length, passed: pass, failed: T.results.length - pass, results: T.results };
    }
    T.summary = summarise();
    return T.summary;
  };
})();
