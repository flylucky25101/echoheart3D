'use strict';
// Batched 2D sprite renderer (WebGL2). Atlas textures, depth sorting, tint/flash,
// normal + additive blending, tiled floor. No 3D meshes at runtime.
(function () {
  var EH = window.EchoHeart;

  var VS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aPos;',
    'layout(location=1) in vec2 aUv;',
    'layout(location=2) in vec4 aCol;',
    'layout(location=3) in float aFlash;',
    'uniform vec2 uViewport;',
    'out vec2 vUv; out vec4 vCol; out float vFlash;',
    'void main(){',
    '  vUv=aUv; vCol=aCol; vFlash=aFlash;',
    '  vec2 p = aPos / uViewport * 2.0 - 1.0;',
    '  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; in vec4 vCol; in float vFlash;',
    'uniform sampler2D uTex;',
    'out vec4 frag;',
    'void main(){',
    '  vec4 t = texture(uTex, vUv);',
    '  if(t.a < 0.004) discard;',
    '  vec3 c = t.rgb * vCol.rgb;',
    '  c = mix(c, vec3(1.0), clamp(vFlash,0.0,1.0));',
    '  frag = vec4(c, t.a * vCol.a);',
    '}'
  ].join('\n');

  var MAX_SPRITES = 3000;
  var FLOATS_PER_VERT = 9;

  function compile(gl, type, src, name) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      EH.err('[sprite shader ' + name + ']\n' + gl.getShaderInfoLog(s) + '\n' +
        src.split('\n').map(function (l, i) { return (i + 1) + ': ' + l; }).join('\n'));
      return null;
    }
    return s;
  }

  function SpriteRenderer(canvas) {
    this.canvas = canvas; this.gl = null;
    this.tex = {};            // sheetKey -> GLTexture
    this.list = [];           // draw commands for this frame
    this.n = 0;
    this.drawCalls = 0; this.sprites = 0;
    this.errors = [];
    this.lowSpec = false;
    this.resScale = 1;
  }

  SpriteRenderer.prototype.init = function () {
    var gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) { this.errors.push('WebGL2 컨텍스트를 생성할 수 없습니다.'); return false; }
    this.gl = gl;
    var vs = compile(gl, gl.VERTEX_SHADER, VS, 'vs');
    var fs = compile(gl, gl.FRAGMENT_SHADER, FS, 'fs');
    if (!vs || !fs) { this.errors.push('스프라이트 셰이더 컴파일 실패'); return false; }
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUv');
    gl.bindAttribLocation(p, 2, 'aCol'); gl.bindAttribLocation(p, 3, 'aFlash');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      EH.err('[sprite program link]\n' + gl.getProgramInfoLog(p));
      this.errors.push('스프라이트 셰이더 링크 실패'); return false;
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.prog = p;
    this.uViewport = gl.getUniformLocation(p, 'uViewport');
    this.uTex = gl.getUniformLocation(p, 'uTex');

    this.data = new Float32Array(MAX_SPRITES * 4 * FLOATS_PER_VERT);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    var stride = FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);
    var idx = new Uint16Array(MAX_SPRITES * 6);
    for (var i = 0; i < MAX_SPRITES; i++) {
      var v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    var ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.clearColor(0.02, 0.03, 0.05, 1);
    this.white = this._solid([255, 255, 255, 255]);
    return true;
  };

  SpriteRenderer.prototype._solid = function (rgba) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };

  SpriteRenderer.prototype.upload = function (key, img, repeat) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); }
    catch (e) { EH.err('sprite texImage2D 실패:', key, e); return null; }
    var w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.tex[key] = t;
    return t;
  };

  SpriteRenderer.prototype.bindSheets = function (loader) {
    var n = 0;
    for (var key in EH.SpriteSheets) {
      var img = loader.images['sheet_' + key];
      if (img && this.upload('sheet_' + key, img, false)) n++;
      else this.tex['sheet_' + key] = this.white;
    }
    var f = loader.images['floorTex'];
    this.tex.floor = f ? (this.upload('floor', f, true) || this.white) : this.white;
    return n;
  };

  SpriteRenderer.prototype.resize = function (cssW, cssH, dprCap) {
    var dpr = Math.min(window.devicePixelRatio || 1, dprCap || 2);
    if (this.lowSpec) dpr = Math.min(dpr, 1.25);
    dpr *= this.resScale;
    var w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dpr = dpr; this.width = w; this.height = h;
    if (this.gl) this.gl.viewport(0, 0, w, h);
  };

  SpriteRenderer.prototype.begin = function () {
    var gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.list.length = 0;
    this.drawCalls = 0; this.sprites = 0;
  };

  // px-space draw command; sort ascending (drawn back to front)
  SpriteRenderer.prototype.push = function (texKey, u0, v0, u1, v1, x, y, w, h, opt) {
    opt = opt || {};
    this.list.push({
      t: texKey, u0: u0, v0: v0, u1: u1, v1: v1,
      x: x, y: y, w: w, h: h,
      r: opt.r == null ? 1 : opt.r, g: opt.g == null ? 1 : opt.g, b: opt.b == null ? 1 : opt.b,
      a: opt.a == null ? 1 : opt.a, f: opt.flash || 0,
      rot: opt.rot || 0, add: !!opt.additive, sort: opt.sort == null ? y : opt.sort
    });
  };

  // draw a sprite-sheet cell anchored at (sx,sy) in screen px
  SpriteRenderer.prototype.sprite = function (animKey, cellOffset, sx, sy, scale, opt) {
    var A = EH.SpriteAnims[animKey];
    if (!A) return;
    var sh = EH.SpriteSheets[A.sheet];
    if (!sh) return;
    var idx = A.start + cellOffset;
    var col = idx % sh.cols, row = (idx / sh.cols) | 0;
    var c = sh.cell;
    var u0 = (col * c) / sh.w, v0 = (row * c) / sh.h;
    var u1 = ((col + 1) * c) / sh.w, v1 = ((row + 1) * c) / sh.h;
    opt = opt || {};
    if (opt.flipX) { var t = u0; u0 = u1; u1 = t; }
    var w = c * scale, h = c * scale;
    var ax = (opt.anchor ? opt.anchor[0] : A.anchor[0]) * scale;
    var ay = (opt.anchor ? opt.anchor[1] : A.anchor[1]) * scale;
    this.push('sheet_' + A.sheet, u0, v0, u1, v1, sx - ax, sy - ay, w, h, opt);
  };

  SpriteRenderer.prototype.flush = function () {
    var gl = this.gl, list = this.list;
    if (!list.length) return;
    list.sort(function (a, b) { return a.sort - b.sort; });
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uViewport, this.width, this.height);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    var data = this.data, n = 0, curTex = null, curAdd = null;
    var self = this;
    function flushBatch() {
      if (!n) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, self.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 4 * FLOATS_PER_VERT);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
      self.drawCalls++; self.sprites += n; n = 0;
    }
    var s = this.dpr || 1;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      var tx = this.tex[d.t] || this.white;
      if (tx !== curTex || d.add !== curAdd || n >= MAX_SPRITES) {
        flushBatch();
        curTex = tx; curAdd = d.add;
        gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.blendFunc(gl.SRC_ALPHA, d.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      }
      var x0 = d.x * s, y0 = d.y * s, x1 = (d.x + d.w) * s, y1 = (d.y + d.h) * s;
      var px = [x0, y0, x1, y0, x1, y1, x0, y1];
      if (d.rot) {
        var cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5;
        var co = Math.cos(d.rot), si = Math.sin(d.rot);
        for (var k = 0; k < 4; k++) {
          var dx = px[k * 2] - cx, dy = px[k * 2 + 1] - cy;
          px[k * 2] = cx + dx * co - dy * si;
          px[k * 2 + 1] = cy + dx * si + dy * co;
        }
      }
      var uv = [d.u0, d.v0, d.u1, d.v0, d.u1, d.v1, d.u0, d.v1];
      var o = n * 4 * FLOATS_PER_VERT;
      for (var v = 0; v < 4; v++) {
        var b = o + v * FLOATS_PER_VERT;
        data[b] = px[v * 2]; data[b + 1] = px[v * 2 + 1];
        data[b + 2] = uv[v * 2]; data[b + 3] = uv[v * 2 + 1];
        data[b + 4] = d.r; data[b + 5] = d.g; data[b + 6] = d.b; data[b + 7] = d.a;
        data[b + 8] = d.f;
      }
      n++;
    }
    flushBatch();
    gl.bindVertexArray(null);
  };

  // tiled arena floor (uses the seamless stone texture, REPEAT wrap)
  SpriteRenderer.prototype.floor = function (x, y, w, h, uvScale, tint, alpha) {
    this.push('floor', 0, 0, uvScale, uvScale, x, y, w, h,
      { r: tint[0], g: tint[1], b: tint[2], a: alpha == null ? 1 : alpha, sort: -1e9 });
  };
  SpriteRenderer.prototype.dispose = function () {
    var gl = this.gl; if (!gl) return;
    for (var k in this.tex) gl.deleteTexture(this.tex[k]);
    this.tex = {};
  };

  EH.SpriteRenderer = SpriteRenderer;
})();
