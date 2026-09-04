'use strict';
// Seeded room generation: path choices, themes, 3D prop layout, enemy waves.
(function () {
  var EH = window.EchoHeart;
  var R = EH.Rooms = {};

  // ground footprint radius per prop (0 = walk-through decoration)
  R.COLLIDE = { pillar: 0.42, gear: 0.50, forge: 0.95, altar: 0.62, device: 0.45, crystal: 0.0, wall: 0.0 };

  R.TOTAL = EH.RUN_ROOMS;           // 6 normal/special + boss = 7

  // Derived from EH.TOWER so the district you see and the district the HUD
  // reports can never disagree.
  R.themeFor = function (index) {
    if (index >= R.TOTAL) return 'heart';
    var tier = EH.tierFor(Math.max(0, index));
    return tier.theme || 'engine';
  };

  // two choices for the NEXT room; rules keep runs fair and varied
  R.nextChoices = function (rng, state) {
    var idx = state.roomIndex + 1;           // index of the room being chosen
    if (idx >= R.TOTAL) return ['boss'];
    if (idx === 0) return ['combat'];
    var last = state.path[state.path.length - 1] || 'combat';
    var pool = [];
    function add(t, w) { for (var i = 0; i < w; i++) pool.push(t); }
    add('combat', 34);
    add('elite', idx >= 2 ? 20 : 6);
    add('shop', 14);
    add('altar', 14);
    var healW = 16;
    if (state.hpFrac < 0.5) healW += 18;      // low hp -> heal more likely
    if (idx === R.TOTAL - 1) healW += 20;     // right before boss
    add('heal', healW);
    // no back-to-back identical special rooms
    pool = pool.filter(function (t) { return !(t === last && t !== 'combat'); });
    var picks = [];
    for (var n = 0; n < 2 && pool.length; n++) {
      var t = pool[Math.floor(rng.next() * pool.length)];
      picks.push(t);
      pool = pool.filter(function (x) { return x !== t; });
    }
    if (picks.length === 0) picks = ['combat'];
    if (picks.length === 1) picks.push(picks[0] === 'combat' ? 'shop' : 'combat');
    return picks;
  };

  // ---- prop layout (3D environment dressing, never blocking movement) ----
  R.buildProps = function (rng, theme, type) {
    var props = [], half = EH.CONFIG.floorHalf;
    function far(x, z, minR) {
      if (Math.hypot(x, z) < minR) return false;
      for (var i = 0; i < props.length; i++) {
        if (Math.hypot(props[i].x - x, props[i].z - z) < 2.0) return false;
      }
      return true;
    }
    function place(mesh, count, minR, opts) {
      opts = opts || {};
      var tries = 0;
      while (count > 0 && tries < 120) {
        tries++;
        var a = rng.next() * Math.PI * 2;
        var r = minR + rng.next() * (half - minR - 1.2);
        var x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!far(x, z, minR)) continue;
        var sc = (opts.scale || 1) * (0.85 + rng.next() * 0.35);
        props.push({
          mesh: mesh, x: x, z: z, y: opts.y || 0,
          rot: rng.next() * Math.PI * 2,
          scale: sc,
          spin: opts.spin || 0,
          bob: opts.bob || 0,
          mat: opts.mat || null,
          // solid footprint: entities are pushed out of this radius
          col: (opts.col == null ? R.COLLIDE[mesh] || 0 : opts.col) * sc
        });
        count--;
      }
    }
    // walls ring the arena (real 3D geometry, outside the play circle)
    var wallN = 22;
    for (var i = 0; i < wallN; i++) {
      var a = (i / wallN) * Math.PI * 2;
      props.push({
        mesh: 'wall', x: Math.cos(a) * (half + 0.6), z: Math.sin(a) * (half + 0.6),
        y: 0, rot: -a + Math.PI / 2, scale: 1.15, wall: true,
        col: 0   // walls are enforced by the arena bound clamp, not per-prop pushout
      });
    }
    var low = EH.Settings.get('lowSpec');
    var mul = low ? 0.5 : 1;
    if (theme === 'engine') {
      place('gear', Math.round(4 * mul), 4.5, { spin: 0.5, y: 0.15, scale: 1.1 });
      place('pillar', Math.round(4 * mul), 5.0, {});
      place('crystal', Math.round(3 * mul), 4.0, { y: 0.5, bob: 0.5, mat: 'energyCyan' });
    } else if (theme === 'archive') {
      place('pillar', Math.round(5 * mul), 4.5, { scale: 1.1 });
      place('crystal', Math.round(6 * mul), 3.5, { y: 1.0, bob: 0.7, mat: 'energyCyan' });
      place('altar', Math.round(2 * mul), 5.0, {});
    } else if (theme === 'forge') {
      place('forge', Math.round(2 * mul), 5.5, {});
      place('gear', Math.round(3 * mul), 4.5, { spin: -0.4, y: 0.15 });
      place('crystal', Math.round(3 * mul), 4.0, { y: 0.4, bob: 0.4, mat: 'crystalRed' });
      place('pillar', Math.round(3 * mul), 5.0, {});
    } else { // heart / boss arena - keep the floor clear for patterns
      place('pillar', Math.round(4 * mul), 7.0, { scale: 1.2 });
      place('crystal', Math.round(4 * mul), 6.5, { y: 1.2, bob: 0.6, mat: 'crystalRed' });
    }
    if (type === 'shop') props.push({ mesh: 'device', x: 0, z: -2.5, y: 0, rot: 0, scale: 1.2, glow: true, col: 0.5 });
    if (type === 'heal') props.push({ mesh: 'device', x: 0, z: -2.5, y: 0, rot: 0, scale: 1.2, glow: true, col: 0.5 });
    if (type === 'altar') props.push({ mesh: 'altar', x: 0, z: -2.5, y: 0, rot: 0, scale: 1.4, glow: true, col: 0.7 });
    return props;
  };

  // ---- enemy composition ----
  R.buildWaves = function (rng, type, index, abyss) {
    if (type === 'heal' || type === 'shop' || type === 'altar') return [];
    if (type === 'boss') return [];
    var waves = [];
    var power = 3 + index * 1.1 + abyss * 0.8;
    var kinds = ['stalker', 'gunner'];
    if (index >= 1) kinds.push('orb');
    if (index >= 2) kinds.push('shield');
    if (index >= 3) kinds.push('sentinel');
    if (index >= 4) kinds.push('summoner');
    if (type === 'elite') {
      var eliteKinds = Object.keys(EH.ELITES);
      var n = 2 + (index >= 4 ? 1 : 0);
      var w0 = [];
      for (var i = 0; i < n; i++) {
        w0.push({ kind: kinds[Math.floor(rng.next() * kinds.length)], elite: eliteKinds[Math.floor(rng.next() * eliteKinds.length)] });
      }
      for (var j = 0; j < 2; j++) w0.push({ kind: 'stalker', elite: null });
      waves.push(w0);
    } else {
      var count = Math.round(EH.clamp(power, 3, 9));
      var w1 = [];
      for (var k = 0; k < count; k++) w1.push({ kind: kinds[Math.floor(rng.next() * kinds.length)], elite: null });
      waves.push(w1.slice(0, Math.ceil(count / 2)));
      if (w1.length > Math.ceil(count / 2)) waves.push(w1.slice(Math.ceil(count / 2)));
      if (index >= 3 && rng.next() < 0.35) {
        waves.push([{ kind: kinds[Math.floor(rng.next() * kinds.length)], elite: Object.keys(EH.ELITES)[Math.floor(rng.next() * 3)] }]);
      }
    }
    return waves;
  };

  // spawn positions: never inside walls, never on top of the player
  R.spawnPoint = function (rng, player, half) {
    for (var i = 0; i < 40; i++) {
      var a = rng.next() * Math.PI * 2;
      var r = 3.5 + rng.next() * (half - 5.0);
      var x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - player.x, z - player.z) > 4.0 &&
          Math.abs(x) < half - 1.2 && Math.abs(z) < half - 1.2) {
        return { x: x, z: z };
      }
    }
    return { x: Math.cos(rng.next() * 6.28) * (half - 2), z: Math.sin(rng.next() * 6.28) * (half - 2) };
  };

  R.build = function (rng, type, index, abyss) {
    var theme = type === 'boss' ? 'heart' : R.themeFor(index);
    return {
      type: type, index: index, theme: theme,
      props: R.buildProps(rng, theme, type),
      waves: R.buildWaves(rng, type, index, abyss),
      cleared: false, waveIndex: 0
    };
  };

  // door positions for the 2 next-room choices
  R.doorPositions = function (n) {
    var half = EH.CONFIG.floorHalf;
    if (n === 1) return [{ x: 0, z: -half + 0.4, rot: 0 }];
    return [
      { x: -3.2, z: -half + 0.4, rot: 0 },
      { x: 3.2, z: -half + 0.4, rot: 0 }
    ];
  };
})();
