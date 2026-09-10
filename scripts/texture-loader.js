'use strict';
// Loads textures as <img> (no fetch).
// IMPORTANT: under file:// Chrome treats local images as cross-origin, so
// gl.texImage2D(img) throws SecurityError and every surface turns flat white.
// The embedded data: URIs are same-origin and always uploadable, so they are
// what the game actually ships with.
//
// The embedded copy is preferred on EVERY protocol, not just file://. This used
// to try entry.path first whenever served over http(s), on the assumption that
// a deployed build would carry higher-res originals in assets/. That assumption
// stopped being true once assets/ became build-time-only input: the deploy has
// no assets/ directory, so every single texture 404'd and then silently fell
// back - 76 failed requests on every page load, for bytes already in the page.
(function () {
  var EH = window.EchoHeart;

  function TextureLoader() {
    this.images = {}; this.status = {};
    this.total = 0; this.done = 0; this.failed = [];
    this.usedEmbedded = 0; this.usedFile = 0;
  }

  TextureLoader.prototype.srcFor = function (key, entry) {
    var data = EH.TextureData && EH.TextureData[key];
    if (data) return { src: data, embedded: true };
    // no embedded copy for this key - the file on disk is the only source
    return { src: entry.path, embedded: false };
  };

  TextureLoader.prototype.loadAll = function (manifest, onProgress, onComplete) {
    var self = this;
    var keys = Object.keys(manifest);
    this.total = keys.length; this.done = 0;
    if (!keys.length) { onComplete && onComplete(); return; }
    keys.forEach(function (key) {
      var entry = manifest[key];
      var pick = self.srcFor(key, entry);
      var img = new Image();
      img.decoding = 'async';
      var settled = false, triedFallback = false;
      function finish(ok) {
        if (settled) return; settled = true;
        self.status[key] = ok ? 'ok' : 'fail';
        if (ok) {
          self.images[key] = img;
          if (pick.embedded) self.usedEmbedded++; else self.usedFile++;
        } else {
          self.failed.push(entry.path);
          EH.warn('텍스처 로딩 실패:', entry.path);
        }
        self.done++;
        onProgress && onProgress(self.done, self.total, key);
        if (self.done >= self.total) onComplete && onComplete();
      }
      img.onload = function () { finish(img.naturalWidth > 0); };
      img.onerror = function () {
        // Embedded copy corrupt or absent? Try the file on disk once. This is
        // the reverse of the old order, matching the reversal in srcFor.
        if (!triedFallback && pick.embedded && entry.path) {
          triedFallback = true; pick = { src: entry.path, embedded: false };
          img.src = entry.path; return;
        }
        finish(false);
      };
      img.src = pick.src;
    });
  };

  TextureLoader.fallbackColor = function (type) {
    if (type === 'normal') return [128, 128, 255, 255];
    if (type === 'orm') return [255, 140, 0, 255];
    if (type === 'emissive') return [0, 0, 0, 255];
    return [150, 150, 160, 255];
  };
  EH.TextureLoader = TextureLoader;
})();
