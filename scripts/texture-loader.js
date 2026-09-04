'use strict';
// Loads textures as <img> (no fetch).
// IMPORTANT: under file:// Chrome treats local images as cross-origin, so
// gl.texImage2D(img) throws SecurityError and every surface turns flat white.
// We therefore prefer the embedded data: URIs (same-origin, always uploadable)
// and use the real files when served over http(s), where they are higher-res.
(function () {
  var EH = window.EchoHeart;

  function isFileProtocol() {
    try { return window.location.protocol === 'file:'; } catch (e) { return true; }
  }

  function TextureLoader() {
    this.images = {}; this.status = {};
    this.total = 0; this.done = 0; this.failed = [];
    this.usedEmbedded = 0; this.usedFile = 0;
    this.embeddedMode = isFileProtocol();
  }

  TextureLoader.prototype.srcFor = function (key, entry) {
    var data = EH.TextureData && EH.TextureData[key];
    if (this.embeddedMode && data) return { src: data, embedded: true };
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
        // file missing over http(s)? fall back to the embedded copy
        var data = EH.TextureData && EH.TextureData[key];
        if (!triedFallback && data && !pick.embedded) {
          triedFallback = true; pick = { src: data, embedded: true };
          img.src = data; return;
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
