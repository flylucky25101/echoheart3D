'use strict';
// ECHOHEART global namespace + tiny helpers (no modules, no imports).
(function () {
  var EH = window.EchoHeart = window.EchoHeart || {};
  EH.Meshes = EH.Meshes || {};
  EH.version = '1.0.0';
  EH.SAVE_VERSION = 3;
  EH.build = { debug: false };
  EH.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  EH.lerp = function (a, b, t) { return a + (b - a) * t; };
  EH.approach = function (a, b, dt) { return Math.abs(b - a) <= dt ? b : a + Math.sign(b - a) * dt; };
  EH.deg = Math.PI / 180;
  EH.TAU = Math.PI * 2;
  EH.now = function () { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); };
  EH.log = function () { if (EH.build.debug && typeof console !== 'undefined') console.log.apply(console, arguments); };
  EH.warn = function () { if (typeof console !== 'undefined') console.warn.apply(console, arguments); };
  EH.err = function () { if (typeof console !== 'undefined') console.error.apply(console, arguments); };
  // deterministic-ish id
  EH._id = 1; EH.uid = function () { return EH._id++; };
})();
