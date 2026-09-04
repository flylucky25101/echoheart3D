'use strict';
// Runtime helper: pick the correct sheet cell (UV rect) for a facing + state +
// animation time. Sheets are baked by tools/bake_premium.py as a regular grid:
//   row = stateIndex * dirs + direction,  col = frame
(function () {
  var EH = window.EchoHeart;
  var TAU = Math.PI * 2;

  // gameplay state -> baked sheet state
  var STATE_MAP = {
    idle: 'idle', run: 'move', move: 'move', dash: 'move',
    attack: 'attack', tell: 'attack', recover: 'attack', ult: 'attack',
    sweep: 'attack', slam: 'attack', spin: 'attack', intro: 'attack',
    hit: 'idle', groggy: 'idle', revive: 'idle',
    death: 'death'
  };
  // states that play once and then hold the last frame
  var ONESHOT = { attack: 1, death: 1 };

  var SV = EH.SpriteView = {
    stateFor: function (raw, moving) {
      var s = STATE_MAP[raw];
      if (!s) s = moving ? 'move' : 'idle';
      if (s === 'idle' && moving) s = 'move';
      return s;
    },

    // meta, facing (atan2(sinX,cosZ)), elapsed time in state -> {u0,v0,u1,v1,flip}
    cell: function (meta, facing, t, moving, rawState) {
      var cols = meta.cols, rows = meta.rows, dirs = meta.dirs || 8;
      var states = meta.states || ['idle'];

      // --- direction row: sheets were baked at facing = d * (2pi/dirs) ---
      var bucket = Math.round((((facing % TAU) + TAU) % TAU) / (TAU / dirs)) % dirs;

      // --- state block ---
      var want = SV.stateFor(rawState, moving);
      var si = states.indexOf(want);
      if (si < 0) si = states.indexOf(moving ? 'move' : 'idle');
      if (si < 0) si = 0;

      var row = si * dirs + bucket;
      if (row > rows - 1) row = rows - 1;
      if (row < 0) row = 0;

      // --- frame column ---
      var fps = meta.fps || 10;
      var f;
      if (ONESHOT[states[si]]) {
        f = Math.floor(t * fps);
        if (f > cols - 1) f = cols - 1;          // hold the final pose
      } else {
        f = Math.floor(t * fps) % cols;
      }
      if (!(f >= 0)) f = 0;

      var uw = 1 / cols, vh = 1 / rows;
      return {
        u0: f * uw, v0: row * vh, u1: (f + 1) * uw, v1: (row + 1) * vh, flip: false
      };
    }
  };
})();
