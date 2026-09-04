'use strict';
// Raw WebGL2 renderer: programs, VAOs, textures, materials, draw calls.
(function () {
  var EH = window.EchoHeart;

  function numberSource(src) {
    return src.split('\n').map(function (l, i) { return (i + 1) + ': ' + l; }).join('\n');
  }

  function Program(gl, vsSrc, fsSrc, name) {
    this.gl = gl; this.name = name; this.uniforms = {}; this.ok = false;
    var vs = this._compile(gl.VERTEX_SHADER, vsSrc, 'vertex');
    var fs = this._compile(gl.FRAGMENT_SHADER, fsSrc, 'fragment');
    if (!vs || !fs) return;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNrm');
    gl.bindAttribLocation(p, 2, 'aUv');
    gl.bindAttribLocation(p, 3, 'aPart');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      EH.err('[shader link failed: ' + name + ']\n' + gl.getProgramInfoLog(p));
      this.error = 'link:' + name; return;
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.program = p; this.ok = true;
  }
  Program.prototype._compile = function (type, src, kind) {
    var gl = this.gl, sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      EH.err('[shader compile failed: ' + this.name + ' / ' + kind + ']\n' +
        gl.getShaderInfoLog(sh) + '\n--- source ---\n' + numberSource(src));
      this.error = 'compile:' + this.name + ':' + kind;
      gl.deleteShader(sh); return null;
    }
    return sh;
  };
  Program.prototype.use = function () { this.gl.useProgram(this.program); };
  Program.prototype.loc = function (n) {
    if (!(n in this.uniforms)) this.uniforms[n] = this.gl.getUniformLocation(this.program, n);
    return this.uniforms[n];
  };

  function Renderer(canvas) {
    this.canvas = canvas; this.gl = null;
    this.meshGPU = {}; this.meshGroups = {}; this.texCache = {}; this.matTex = {};
    this.progs = {}; this.prims = {};
    this.dpr = 1; this.lowSpec = false; this.resScale = 1;
    this.wantBloom = true; this.usingBloom = false;
    this.bloom = null; this.bloomAmount = 1.35;
    this.time = 0;
    this.drawCalls = 0; this.tris = 0;
    this._nm = new Float32Array(9);
    this._m = null; this._vp = null;
    this.errors = [];
    this._curProg = null;
  }

  Renderer.prototype.init = function () {
    var gl = this.canvas.getContext('webgl2', {
      // MSAA multiplies fragment bandwidth across the whole screen; at dpr 2
      // the extra sharpness is not worth the frame time on integrated GPUs.
      antialias: false, alpha: false, depth: true, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false
    });
    if (!gl) { this.errors.push('WebGL2 컨텍스트를 생성할 수 없습니다.'); return false; }
    this.gl = gl;
    this._m = EH.M.Mat4.create(); this._vp = EH.M.Mat4.create();
    var S = EH.SHADERS;
    this.progs.pbr = new Program(gl, S.pbrVS, S.pbrFS, 'pbr');
    this.progs.unlit = new Program(gl, S.unlitVS, S.unlitFS, 'unlit');
    this.progs.sky = new Program(gl, S.skyVS, S.skyFS, 'sky');
    this.progs.part = new Program(gl, S.partVS, S.partFS, 'part');
    this.progs.bright = new Program(gl, S.postVS, S.brightFS, 'bright');
    this.progs.blur = new Program(gl, S.postVS, S.blurFS, 'blur');
    this.progs.composite = new Program(gl, S.postVS, S.compositeFS, 'composite');
    var bad = [];
    for (var k in this.progs) if (!this.progs[k].ok) bad.push(this.progs[k].error || k);
    if (bad.length) { this.errors.push('셰이더 오류: ' + bad.join(', ')); return false; }
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    // 4x is visually indistinguishable at this camera angle but roughly halves
    // the per-pixel texture fetches on the full-screen floor
    this.maxAniso = this.aniso ? Math.min(4, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 0;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
    gl.clearColor(0.02, 0.03, 0.05, 1);
    this._buildPrimitives();
    this._buildFallbacks();
    this.emptyVao = gl.createVertexArray();
    return true;
  };

  // ---------- textures ----------
  Renderer.prototype._makeSolid = function (rgba) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };
  Renderer.prototype._buildFallbacks = function () {
    this.fallback = {
      albedo: this._makeSolid([150, 150, 160, 255]),
      normal: this._makeSolid([128, 128, 255, 255]),
      orm: this._makeSolid([255, 140, 0, 255]),
      emissive: this._makeSolid([0, 0, 0, 255]),
      atlas: this._makeSolid([255, 255, 255, 255])
    };
  };
  Renderer.prototype.textureFromImage = function (key, img, isSRGBish) {
    var gl = this.gl;
    if (this.texCache[key]) return this.texCache[key];
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (e) {
      EH.err('texImage2D 실패:', key, e); return null;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (this.aniso && this.maxAniso > 1) {
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, this.lowSpec ? 2 : this.maxAniso);
    }
    this.texCache[key] = t;
    return t;
  };
  // build material -> 4 textures using loaded images
  Renderer.prototype.bindTextures = function (loader) {
    this.loader = loader;
    var kinds = ['albedo', 'normal', 'orm', 'emissive'];
    for (var id in EH.MATERIALS) {
      var g = EH.MATERIALS[id].group, set = {};
      for (var i = 0; i < kinds.length; i++) {
        var kind = kinds[i], key = g + '_' + kind;
        var img = loader.images[key];
        set[kind] = img ? (this.textureFromImage(key, img) || this.fallback[kind]) : this.fallback[kind];
      }
      this.matTex[id] = set;
    }
    var ic = loader.images['ui_icons'];
    this.iconTex = ic ? (this.textureFromImage('ui_icons', ic) || this.fallback.atlas) : this.fallback.atlas;
  };

  // ---------- meshes ----------
  Renderer.prototype._uploadPart = function (part) {
    var gl = this.gl;
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    function buf(data, loc, size) {
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return b;
    }
    var bp = buf(part.pos, 0, 3), bn = buf(part.nrm, 1, 3), bu = buf(part.uv, 2, 2);
    var ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, part.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    // keep the buffer handles: the instanced VAO needs to re-bind the same
    // vertex data alongside a per-instance transform stream
    return { vao: vao, count: part.idx.length, mat: part.mat,
             bp: bp, bn: bn, bu: bu, ib: ib, ivao: null };
  };
  // Maximum joints addressable by uParts[]. Meshes above this fall back to the
  // per-part path rather than silently reading past the end of the array.
  var MAX_PARTS = 16;

  // Merge a mesh's parts into one buffer per material, tagging each vertex with
  // its joint index. Draw cost then scales with a character's material count
  // (3-6) instead of its part count (up to 14).
  Renderer.prototype._uploadGroups = function (mesh) {
    var gl = this.gl, parts = mesh.parts;
    if (parts.length > MAX_PARTS) return null;
    var order = [], byMat = {};
    for (var i = 0; i < parts.length; i++) {
      var id = parts[i].mat || 'darkMetal';
      if (!byMat[id]) { byMat[id] = []; order.push(id); }
      byMat[id].push(i);
    }
    var groups = [];
    for (var g = 0; g < order.length; g++) {
      var list = byMat[order[g]], nv = 0, ni = 0, k;
      for (k = 0; k < list.length; k++) {
        nv += parts[list[k]].pos.length / 3;
        ni += parts[list[k]].idx.length;
      }
      // 16-bit indices are all the index buffers use; bail out rather than wrap
      if (nv > 65535) return null;
      var pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
      var uv = new Float32Array(nv * 2), pid = new Float32Array(nv);
      var idx = new Uint16Array(ni), vo = 0, io = 0;
      for (k = 0; k < list.length; k++) {
        var pt = parts[list[k]], pc = pt.pos.length / 3;
        pos.set(pt.pos, vo * 3); nrm.set(pt.nrm, vo * 3); uv.set(pt.uv, vo * 2);
        for (var v = 0; v < pc; v++) pid[vo + v] = list[k];
        for (var t = 0; t < pt.idx.length; t++) idx[io + t] = pt.idx[t] + vo;
        vo += pc; io += pt.idx.length;
      }
      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      function buf(data, loc, size) {
        var b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      }
      buf(pos, 0, 3); buf(nrm, 1, 3); buf(uv, 2, 2); buf(pid, 3, 1);
      var ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      groups.push({ vao: vao, count: ni, mat: order[g], parts: list });
    }
    return groups;
  };

  Renderer.prototype.uploadMesh = function (name) {
    if (this.meshGPU[name]) return this.meshGPU[name];
    var mesh = EH.Meshes[name];
    if (!mesh) { EH.warn('메시 없음:', name); return null; }
    var out = [];
    for (var i = 0; i < mesh.parts.length; i++) out.push(this._uploadPart(mesh.parts[i]));
    this.meshGPU[name] = out;
    // Grouped buffers are an optimisation, never a requirement: if anything
    // about this mesh does not suit them the per-part path above still works.
    try { this.meshGroups[name] = this._uploadGroups(mesh) || null; }
    catch (e) { this.meshGroups[name] = null; }
    return out;
  };
  Renderer.prototype.uploadAll = function () {
    for (var n in EH.Meshes) this.uploadMesh(n);
    return Object.keys(this.meshGPU).length;
  };

  // runtime effect primitives (particles/trails/decals only - not characters)
  Renderer.prototype._buildPrimitives = function () {
    var gl = this.gl;
    function mk(pos, nrm, uv, idx) {
      return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint16Array(idx), mat: 'darkMetal' };
    }
    // unit quad on XZ plane (y=0), centered, size 1
    var q = mk(
      [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5],
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [0, 2, 1, 0, 3, 2]);
    // billboard-ish upright quad on XY (used only for non-character FX)
    var q2 = mk(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
      [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [0, 1, 2, 0, 2, 3]);
    // small shard (tetrahedron) for debris
    var s = 0.5, sp = [0, s, 0, -s, -s, s, s, -s, s, 0, -s, -s];
    var si = [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2];
    var sn = [], su = [];
    for (var i = 0; i < 4; i++) { sn.push(sp[i * 3], sp[i * 3 + 1], sp[i * 3 + 2]); su.push(0.5, 0.5); }
    var shard = mk(sp, sn, su, si);
    // low sphere
    var sph = { pos: [], nrm: [], uv: [], idx: [] }, W = 10, H = 7;
    for (var iy = 0; iy <= H; iy++) for (var ix = 0; ix <= W; ix++) {
      var th = iy / H * Math.PI, ph = ix / W * Math.PI * 2;
      var nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
      sph.pos.push(nx * 0.5, ny * 0.5, nz * 0.5); sph.nrm.push(nx, ny, nz); sph.uv.push(ix / W, 1 - iy / H);
    }
    for (var iy2 = 0; iy2 < H; iy2++) for (var ix2 = 0; ix2 < W; ix2++) {
      var a = iy2 * (W + 1) + ix2, b = a + 1, c = a + W + 1, dd = c + 1;
      sph.idx.push(a, c, b, b, c, dd);
    }
    var sphere = mk(sph.pos, sph.nrm, sph.uv, sph.idx);
    var bl = { pos: [], nrm: [], uv: [], idx: [] };
    (function () {
      var L = 0.5, w = 0.12;
      var vs = [[0,0,L],[0,0,-L],[w,0,0],[0,w,0],[-w,0,0],[0,-w,0]];
      var faces = [[0,2,3],[0,3,4],[0,4,5],[0,5,2],[1,3,2],[1,4,3],[1,5,4],[1,2,5]];
      faces.forEach(function (fc) {
        var a = vs[fc[0]], b = vs[fc[1]], c = vs[fc[2]];
        var base = bl.pos.length / 3;
        var nx = (b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);
        var ny = (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
        var nz = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
        var l = Math.hypot(nx,ny,nz)||1; nx/=l; ny/=l; nz/=l;
        [a,b,c].forEach(function (p) { bl.pos.push(p[0],p[1],p[2]); bl.nrm.push(nx,ny,nz); bl.uv.push(0.5,0.5); });
        bl.idx.push(base,base+1,base+2);
      });
    })();
    this.prims.bolt = this._uploadPart({ pos: new Float32Array(bl.pos), nrm: new Float32Array(bl.nrm),
      uv: new Float32Array(bl.uv), idx: new Uint16Array(bl.idx), mat: 'darkMetal' });
    this.prims.quad = this._uploadPart(q);
    this.prims.card = this._uploadPart(q2);
    this.prims.shard = this._uploadPart(shard);
    this.prims.sphere = this._uploadPart(sphere);
    // dynamic ribbon buffer (weapon trails) - triangle strip as tris
    this.ribbonMax = 64; // segments
    var rv = new Float32Array(this.ribbonMax * 2 * 3);
    var rn = new Float32Array(this.ribbonMax * 2 * 3);
    var ru = new Float32Array(this.ribbonMax * 2 * 2);
    var ri = [];
    for (var k = 0; k < this.ribbonMax - 1; k++) {
      var b0 = k * 2; ri.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
    }
    this.ribbon = { vao: gl.createVertexArray(), count: 0, idxCount: ri.length };
    gl.bindVertexArray(this.ribbon.vao);
    this.ribbon.pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbon.pb);
    gl.bufferData(gl.ARRAY_BUFFER, rv, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.ribbon.nb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbon.nb);
    gl.bufferData(gl.ARRAY_BUFFER, rn, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    this.ribbon.ub = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbon.ub);
    gl.bufferData(gl.ARRAY_BUFFER, ru, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    var rib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ri), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this._ribV = rv; this._ribN = rn; this._ribU = ru;
    // dynamic camera-facing billboard quad (uploaded per sprite)
    this.initParticleBatch();
    this.bbVao = gl.createVertexArray();
    gl.bindVertexArray(this.bbVao);
    this.bbPos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bbPos);
    gl.bufferData(gl.ARRAY_BUFFER, 12 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);   // reuse pos as dummy nrm
    this.bbUv = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bbUv);
    gl.bufferData(gl.ARRAY_BUFFER, 8 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    var bbi = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bbi);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this._bbPos = new Float32Array(12); this._bbUv = new Float32Array(8);

  };

  // ---------- frame ----------
  Renderer.prototype.resize = function (cssW, cssH, dprCap) {
    var dpr = Math.min(window.devicePixelRatio || 1, dprCap || 2);
    if (this.lowSpec) dpr = Math.min(dpr, 1.25);
    // Bound total fragment work instead of guessing a device class: a small
    // phone keeps its full pixel ratio (stays sharp) while a large hi-dpi
    // display is capped, because the cost is pixels, not the device name.
    var budget = this.lowSpec ? 1.15e6 : 2.30e6;      // ~1080p worth of pixels
    var want = cssW * cssH * dpr * dpr;
    if (want > budget) dpr *= Math.sqrt(budget / want);
    dpr = Math.max(dpr, 0.75);                        // never go blurry-bad
    dpr *= this.resScale;
    var w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.dpr = dpr; this.width = w; this.height = h;
    if (this.gl) this.gl.viewport(0, 0, w, h);
    return w / h;
  };

  Renderer.prototype.begin = function (cam, theme, dt) {
    this.lastDrawCalls = this.drawCalls;   // previous frame, for the perf readout
    var gl = this.gl;
    this.time += dt; this.drawCalls = 0; this.tris = 0;
    this.cam = cam; this.theme = theme;
    // NOTE: no bindFramebuffer(null) here - beginFrameTarget() may have bound
    // the offscreen scene target for the bloom chain.
    if (!this.usingBloom) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
    }
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // The sky used to be drawn here first with depth test OFF, so it shaded
    // every pixel on screen and the floor then painted over almost all of it -
    // a whole wasted full-screen pass. It is now drawn last (drawSky) with the
    // depth test on, so only genuinely empty background pixels get shaded.
    // viewProj for culling
    EH.M.Mat4.multiply(this._vp, cam.proj, cam.view);
    // setup pbr constants
    var p = this.progs.pbr; p.use(); this._curProg = p;
    gl.uniformMatrix4fv(p.loc('uProj'), false, cam.proj);
    gl.uniformMatrix4fv(p.loc('uView'), false, cam.view);
    gl.uniform3fv(p.loc('uCamPos'), cam.eye);
    gl.uniform3f(p.loc('uLightDir'), 0.52, 0.70, 0.48);      // raking key -> readable form
    gl.uniform3f(p.loc('uLightColor'), 1.15, 1.05, 0.92);
    gl.uniform3f(p.loc('uFillDir'), -0.62, 0.28, -0.72);      // opposite cool fill
    gl.uniform3f(p.loc('uFillColor'), 0.32, 0.46, 0.68);
    gl.uniform3fv(p.loc('uAmbient'), theme.amb);
    gl.uniform3fv(p.loc('uFogColor'), theme.fog);
    gl.uniform1f(p.loc('uFogDensity'), this.lowSpec ? 0.020 : 0.026);
    gl.uniform3fv(p.loc('uAccent'), theme.accent);
    gl.uniform1f(p.loc('uTime'), this.time);
    gl.uniform1i(p.loc('uAlbedo'), 0); gl.uniform1i(p.loc('uNormal'), 1);
    gl.uniform1i(p.loc('uOrm'), 2); gl.uniform1i(p.loc('uEmis'), 3);
  };

  // frustum-ish visibility test on a bounding sphere
  Renderer.prototype.visible = function (x, y, z, r) {
    var m = this._vp;
    var cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    var cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    var cz = m[2] * x + m[6] * y + m[10] * z + m[14];
    var cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    var lim = cw + r * 1.6;
    if (cz < -lim || cz > lim) return false;
    if (cx < -lim || cx > lim) return false;
    if (cy < -lim || cy > lim) return false;
    return true;
  };

  var _tmpTint = new Float32Array(3);
  Renderer.prototype.drawMesh = function (name, mats, opts) {
    var gl = this.gl, gpu = this.meshGPU[name] || this.uploadMesh(name);
    if (!gpu) return;
    opts = opts || {};
    var p = this.progs.pbr;
    // Bind our own program. This used to rely on begin() having left pbr
    // active, so any pass that switched programs (unlit backdrop, sprites,
    // particles) silently sent pbr uniforms to the wrong program and the mesh
    // vanished - that is what emptied the hub floor.
    if (this._curProg !== p) { p.use(); this._curProg = p; }
    var flash = opts.flash || 0, diss = opts.dissolve || 0;
    var emisMul = opts.emissive == null ? 1 : opts.emissive;
    gl.uniform1f(p.loc('uClipR'), opts.clipR || 0);
    gl.uniform1f(p.loc('uFlatTBN'), opts.flatTBN ? 1 : 0);
    var tint = opts.tint;

    // Fast path: one draw per material with every joint matrix sent at once.
    // Skipped when a caller overrides materials per part, since the grouping was
    // baked around the mesh's own assignment.
    var grp = this.meshGroups[name];
    if (grp && !opts.materialOverride && mats && mats.length <= 16) {
      this._drawGrouped(grp, mats, opts, flash, diss, emisMul, tint);
      return;
    }

    gl.uniform1i(p.loc('uPartCount'), 0);
    for (var i = 0; i < gpu.length; i++) {
      var part = gpu[i], m = mats[i];
      if (!m || EH.M.Mat4.hasNaN(m)) continue;
      var matId = (opts.materialOverride && opts.materialOverride[i]) || part.mat;
      var mat = EH.MATERIALS[matId] || EH.MATERIALS.darkMetal;
      var tex = this.matTex[matId] || this.matTex.darkMetal;
      gl.uniformMatrix4fv(p.loc('uModel'), false, m);
      EH.M.Mat4.normalMat3FromMat4(this._nm, m);
      gl.uniformMatrix3fv(p.loc('uNormalMat'), false, this._nm);
      _tmpTint[0] = mat.tint[0] * (tint ? tint[0] : 1);
      _tmpTint[1] = mat.tint[1] * (tint ? tint[1] : 1);
      _tmpTint[2] = mat.tint[2] * (tint ? tint[2] : 1);
      gl.uniform3fv(p.loc('uTint'), _tmpTint);
      gl.uniform1f(p.loc('uEmissive'), mat.emissive * emisMul * (this.lowSpec ? 0.75 : 1));
      gl.uniform1f(p.loc('uUvScale'), (opts.uvScale || 1) * mat.uv);
      gl.uniform1f(p.loc('uFlash'), flash);
      gl.uniform1f(p.loc('uDissolve'), diss);
      if (tex) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.albedo);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.normal);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.orm);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex.emissive);
      }
      gl.bindVertexArray(part.vao);
      gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
      this.drawCalls++; this.tris += part.count / 3;
    }
    gl.bindVertexArray(null);
  };

  var _partBuf = new Float32Array(16 * 16);
  var _instData = new Float32Array(64 * 16);

  // VAO that reads the part's own vertex data plus a per-instance mat4 stream.
  Renderer.prototype._instancedVao = function (part) {
    if (part.ivao) return part.ivao;
    var gl = this.gl;
    if (!this._instBuf) this._instBuf = gl.createBuffer();
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    function attr(b, loc, size) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    attr(part.bp, 0, 3); attr(part.bn, 1, 3); attr(part.bu, 2, 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instBuf);
    for (var i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(4 + i);
      gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(4 + i, 1);   // advance once per instance, not per vertex
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.ib);
    gl.bindVertexArray(null);
    part.ivao = vao;
    return vao;
  };

  // Draw one mesh many times, one call per part regardless of instance count.
  Renderer.prototype.drawMeshInstanced = function (name, mats, opts) {
    var gl = this.gl, gpu = this.meshGPU[name] || this.uploadMesh(name);
    if (!gpu || !mats.length) return;
    opts = opts || {};
    var p = this.progs.pbr;
    if (this._curProg !== p) { p.use(); this._curProg = p; }
    var n = 0;
    if (mats.length * 16 > _instData.length) _instData = new Float32Array(mats.length * 16);
    for (var k = 0; k < mats.length; k++) {
      if (!mats[k] || EH.M.Mat4.hasNaN(mats[k])) continue;
      _instData.set(mats[k], n * 16); n++;
    }
    if (!n) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instBuf || (this._instBuf = gl.createBuffer()));
    gl.bufferData(gl.ARRAY_BUFFER, _instData.subarray(0, n * 16), gl.DYNAMIC_DRAW);
    gl.uniform1i(p.loc('uInstanced'), 1);
    gl.uniform1i(p.loc('uPartCount'), 0);
    gl.uniform1f(p.loc('uClipR'), opts.clipR || 0);
    gl.uniform1f(p.loc('uFlatTBN'), opts.flatTBN ? 1 : 0);
    gl.uniform1f(p.loc('uFlash'), 0);
    gl.uniform1f(p.loc('uDissolve'), 0);
    var tint = opts.tint, emisMul = opts.emissive == null ? 1 : opts.emissive;
    for (var i = 0; i < gpu.length; i++) {
      var part = gpu[i];
      var matId = (opts.materialOverride && opts.materialOverride[i]) || part.mat;
      var mat = EH.MATERIALS[matId] || EH.MATERIALS.darkMetal;
      var tex = this.matTex[matId] || this.matTex.darkMetal;
      _tmpTint[0] = mat.tint[0] * (tint ? tint[0] : 1);
      _tmpTint[1] = mat.tint[1] * (tint ? tint[1] : 1);
      _tmpTint[2] = mat.tint[2] * (tint ? tint[2] : 1);
      gl.uniform3fv(p.loc('uTint'), _tmpTint);
      gl.uniform1f(p.loc('uEmissive'), mat.emissive * emisMul * (this.lowSpec ? 0.75 : 1));
      gl.uniform1f(p.loc('uUvScale'), (opts.uvScale || 1) * mat.uv);
      if (tex) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.albedo);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.normal);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.orm);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex.emissive);
      }
      gl.bindVertexArray(this._instancedVao(part));
      gl.drawElementsInstanced(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0, n);
      this.drawCalls++; this.tris += part.count / 3 * n;
    }
    gl.bindVertexArray(null);
    gl.uniform1i(p.loc('uInstanced'), 0);
  };

  Renderer.prototype._drawGrouped = function (groups, mats, opts, flash, diss, emisMul, tint) {
    var gl = this.gl, p = this.progs.pbr;
    var n = Math.min(mats.length, 16), i;
    for (i = 0; i < n; i++) {
      var m = mats[i];
      // A joint whose matrix went bad is collapsed to zero scale rather than
      // skipped: its vertices live in a shared buffer now, so there is no way to
      // omit them from the draw. Degenerate triangles cost nothing.
      if (!m || EH.M.Mat4.hasNaN(m)) { _partBuf.fill(0, i * 16, i * 16 + 16); continue; }
      _partBuf.set(m, i * 16);
    }
    gl.uniformMatrix4fv(p.loc('uParts[0]'), false, _partBuf.subarray(0, n * 16));
    gl.uniform1i(p.loc('uPartCount'), n);
    gl.uniform1f(p.loc('uFlash'), flash);
    gl.uniform1f(p.loc('uDissolve'), diss);
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      var mat = EH.MATERIALS[g.mat] || EH.MATERIALS.darkMetal;
      var tex = this.matTex[g.mat] || this.matTex.darkMetal;
      _tmpTint[0] = mat.tint[0] * (tint ? tint[0] : 1);
      _tmpTint[1] = mat.tint[1] * (tint ? tint[1] : 1);
      _tmpTint[2] = mat.tint[2] * (tint ? tint[2] : 1);
      gl.uniform3fv(p.loc('uTint'), _tmpTint);
      gl.uniform1f(p.loc('uEmissive'), mat.emissive * emisMul * (this.lowSpec ? 0.75 : 1));
      gl.uniform1f(p.loc('uUvScale'), (opts.uvScale || 1) * mat.uv);
      if (tex) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.albedo);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.normal);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.orm);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex.emissive);
      }
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
      this.drawCalls++; this.tris += g.count / 3;
    }
    gl.bindVertexArray(null);
  };

  // ---------- unlit effects ----------
  Renderer.prototype.beginUnlit = function (additive) {
    var gl = this.gl, p = this.progs.unlit; p.use(); this._curProg = p;
    gl.uniformMatrix4fv(p.loc('uProj'), false, this.cam.proj);
    gl.uniformMatrix4fv(p.loc('uView'), false, this.cam.view);
    gl.uniform3fv(p.loc('uCamPos'), this.cam.eye);
    gl.uniform3fv(p.loc('uFogColor'), this.theme.fog);
    gl.uniform1f(p.loc('uFogDensity'), 0.02);
    gl.uniform1f(p.loc('uTime'), this.time);
    gl.uniform1i(p.loc('uTex'), 0);
    gl.uniform1i(p.loc('uUseTex'), 0);
    gl.uniform1f(p.loc('uScroll'), 0.4);
    gl.uniform1f(p.loc('uProgress'), 1);
    gl.enable(gl.BLEND);
    if (additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
  };
  Renderer.prototype.endUnlit = function () {
    var gl = this.gl;
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.bindVertexArray(null);
  };
  Renderer.prototype.drawPrim = function (prim, mat, color, mode, progress) {
    var gl = this.gl, p = this.progs.unlit, o = this.prims[prim];
    if (!o || EH.M.Mat4.hasNaN(mat)) return;
    gl.uniformMatrix4fv(p.loc('uModel'), false, mat);
    gl.uniform4fv(p.loc('uColor'), color);
    gl.uniform1i(p.loc('uMode'), mode || 0);
    gl.uniform1f(p.loc('uProgress'), progress == null ? 1 : progress);
    gl.bindVertexArray(o.vao);
    gl.drawElements(gl.TRIANGLES, o.count, gl.UNSIGNED_SHORT, 0);
    this.drawCalls++;
  };
  // draw an existing 3D mesh with the unlit/energy shader (portals, energy props)
  Renderer.prototype.drawMeshUnlit = function (name, mat, color, mode) {
    var gl = this.gl, p = this.progs.unlit, gpu = this.meshGPU[name] || this.uploadMesh(name);
    if (!gpu || EH.M.Mat4.hasNaN(mat)) return;
    gl.uniformMatrix4fv(p.loc('uModel'), false, mat);
    gl.uniform4fv(p.loc('uColor'), color);
    gl.uniform1i(p.loc('uMode'), mode || 0);
    for (var i = 0; i < gpu.length; i++) {
      gl.bindVertexArray(gpu[i].vao);
      gl.drawElements(gl.TRIANGLES, gpu[i].count, gl.UNSIGNED_SHORT, 0);
      this.drawCalls++;
    }
  };
  // weapon ribbon trail from a list of {a:[x,y,z], b:[x,y,z]} segments
  Renderer.prototype.drawRibbon = function (segs, color) {
    if (!segs || segs.length < 2) return;
    var gl = this.gl, p = this.progs.unlit;
    var n = Math.min(segs.length, this.ribbonMax);
    for (var i = 0; i < n; i++) {
      var s = segs[i], o = i * 6, u = i * 4;
      this._ribV[o] = s.a[0]; this._ribV[o + 1] = s.a[1]; this._ribV[o + 2] = s.a[2];
      this._ribV[o + 3] = s.b[0]; this._ribV[o + 4] = s.b[1]; this._ribV[o + 5] = s.b[2];
      this._ribN[o] = 0; this._ribN[o + 1] = 1; this._ribN[o + 2] = 0;
      this._ribN[o + 3] = 0; this._ribN[o + 4] = 1; this._ribN[o + 5] = 0;
      var t = i / Math.max(1, n - 1);
      this._ribU[u] = t; this._ribU[u + 1] = 0; this._ribU[u + 2] = t; this._ribU[u + 3] = 1;
    }
    gl.bindVertexArray(this.ribbon.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbon.pb);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._ribV, 0, n * 6);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbon.nb);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._ribN, 0, n * 6);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbon.ub);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._ribU, 0, n * 4);
    var idm = EH.M.Mat4.identity(this._m);
    gl.uniformMatrix4fv(p.loc('uModel'), false, idm);
    gl.uniform4fv(p.loc('uColor'), color);
    gl.uniform1i(p.loc('uMode'), 0);
    gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES, (n - 1) * 6, gl.UNSIGNED_SHORT, 0);
    gl.enable(gl.CULL_FACE);
    this.drawCalls++;
  };

  // ---------- billboard sprites (2D character/enemy sheets in the 3D world) ----------
  // ---------------- bloom post-processing ----------------
  // The scene renders into an offscreen colour target, bright areas are pulled
  // out at quarter resolution, blurred separably, then composited back. Doing
  // the expensive part at 1/4 res keeps the whole chain cheap while giving the
  // neon the spill it needs to read as light rather than paint.
  Renderer.prototype._makeTarget = function (w, h, depth) {
    var gl = this.gl;
    var t = { w: w, h: h };
    t.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    t.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    if (depth) {
      t.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.depth);
    }
    var okStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!okStatus) return null;
    return t;
  };
  Renderer.prototype._freeTarget = function (t) {
    if (!t) return;
    var gl = this.gl;
    if (t.fbo) gl.deleteFramebuffer(t.fbo);
    if (t.tex) gl.deleteTexture(t.tex);
    if (t.depth) gl.deleteRenderbuffer(t.depth);
  };
  Renderer.prototype.ensureBloomTargets = function () {
    var w = this.width, h = this.height;
    if (this.bloom && this.bloom.w === w && this.bloom.h === h) return this.bloom.ok;
    if (this.bloom) {
      this._freeTarget(this.bloom.scene);
      this._freeTarget(this.bloom.a);
      this._freeTarget(this.bloom.b);
    }
    var qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    var scene = this._makeTarget(w, h, true);
    var a = this._makeTarget(qw, qh, false);
    var b = this._makeTarget(qw, qh, false);
    this.bloom = { w: w, h: h, qw: qw, qh: qh, scene: scene, a: a, b: b,
                   ok: !!(scene && a && b) };
    if (!this.bloom.ok) EH.warn('블룸 타깃 생성 실패 - 블룸 없이 렌더합니다');
    return this.bloom.ok;
  };
  Renderer.prototype.bloomEnabled = function () {
    return this.wantBloom && !this.lowSpec && this.progs.bright && this.progs.bright.ok;
  };
  // bind the offscreen scene target (call before begin())
  Renderer.prototype.beginFrameTarget = function () {
    this.usingBloom = false;
    if (!this.bloomEnabled()) return false;
    if (!this.ensureBloomTargets()) return false;
    this.usingBloom = true;
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloom.scene.fbo);
    gl.viewport(0, 0, this.width, this.height);
    return true;
  };
  Renderer.prototype._fullscreen = function () {
    var gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.drawCalls++;
  };
  Renderer.prototype.resolveBloom = function () {
    if (!this.usingBloom) return;
    var gl = this.gl, B = this.bloom;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(false);

    // bright pass -> quarter res
    var bp = this.progs.bright; bp.use(); this._curProg = bp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, B.a.fbo);
    gl.viewport(0, 0, B.qw, B.qh);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, B.scene.tex);
    gl.uniform1i(bp.loc('uTex'), 0);
    gl.uniform2f(bp.loc('uTexel'), 1 / this.width, 1 / this.height);
    gl.uniform1f(bp.loc('uThreshold'), 0.48);
    gl.uniform1f(bp.loc('uKnee'), 0.32);
    this._fullscreen();

    // separable blur: a -> b (horizontal), b -> a (vertical)
    var bl = this.progs.blur; bl.use(); this._curProg = bl;
    gl.uniform1i(bl.loc('uTex'), 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, B.b.fbo);
    gl.bindTexture(gl.TEXTURE_2D, B.a.tex);
    gl.uniform2f(bl.loc('uDir'), 1 / B.qw, 0);
    this._fullscreen();
    gl.bindFramebuffer(gl.FRAMEBUFFER, B.a.fbo);
    gl.bindTexture(gl.TEXTURE_2D, B.b.tex);
    gl.uniform2f(bl.loc('uDir'), 0, 1 / B.qh);
    this._fullscreen();

    // composite to the screen
    var cp = this.progs.composite; cp.use(); this._curProg = cp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, B.scene.tex);
    gl.uniform1i(cp.loc('uScene'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B.a.tex);
    gl.uniform1i(cp.loc('uBloom'), 1);
    gl.uniform1f(cp.loc('uBloomAmt'), this.bloomAmount == null ? 1.35 : this.bloomAmount);
    gl.uniform1f(cp.loc('uVignette'), 0.55);
    this._fullscreen();

    // Release the post-process textures from their sampler units. The composite
    // leaves scene.tex on unit 0, and next frame beginFrameTarget binds that
    // same texture's framebuffer as the render target - a texture cannot be read
    // and written in one draw, so the driver rejected every single draw call of
    // the following frame with GL_INVALID_OPERATION (feedback loop).
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    this.usingBloom = false;
  };

  // ---------------- batched particles (one draw call for all of them) ----------------
  Renderer.prototype.initParticleBatch = function () {
    var gl = this.gl;
    this.partMax = 384;
    this.partCount = 0;
    this.partPos = new Float32Array(this.partMax * 4 * 3);
    this.partUv = new Float32Array(this.partMax * 4 * 2);
    this.partCol = new Float32Array(this.partMax * 4 * 4);
    var idx = new Uint16Array(this.partMax * 6);
    for (var i = 0; i < this.partMax; i++) {
      var v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    // uv is constant per quad -> fill once, never re-upload
    for (var q = 0; q < this.partMax; q++) {
      var u = q * 8;
      this.partUv[u] = 0; this.partUv[u + 1] = 0;
      this.partUv[u + 2] = 1; this.partUv[u + 3] = 0;
      this.partUv[u + 4] = 1; this.partUv[u + 5] = 1;
      this.partUv[u + 6] = 0; this.partUv[u + 7] = 1;
    }
    this.partVao = gl.createVertexArray();
    gl.bindVertexArray(this.partVao);
    this.partPosBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.partPos.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.partUvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partUvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.partUv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    this.partColBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partColBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.partCol.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    this.partIdxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.partIdxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  };

  Renderer.prototype.beginParticles = function () {
    this.partCount = 0;
    this._pRight = [this.cam.view[0], this.cam.view[4], this.cam.view[8]];
    this._pUp = [this.cam.view[1], this.cam.view[5], this.cam.view[9]];
  };
  // Ground-aligned variant of addParticle: used for contact shadows, which must
  // lie flat on the floor rather than face the camera. Shares the same batch
  // buffers and the same soft radial falloff, so it is still one draw call.
  Renderer.prototype.addGroundQuad = function (x, y, z, size, color, alpha) {
    if (this.partCount >= this.partMax) return;
    var i = this.partCount++, o = i * 12, c = i * 16;
    var h = size * 0.5;
    var P = this.partPos;
    P[o] = x - h; P[o + 1] = y; P[o + 2] = z - h;
    P[o + 3] = x + h; P[o + 4] = y; P[o + 5] = z - h;
    P[o + 6] = x + h; P[o + 7] = y; P[o + 8] = z + h;
    P[o + 9] = x - h; P[o + 10] = y; P[o + 11] = z + h;
    var C = this.partCol, cr = color[0], cg = color[1], cb = color[2];
    for (var k = 0; k < 4; k++) {
      C[c + k * 4] = cr; C[c + k * 4 + 1] = cg; C[c + k * 4 + 2] = cb; C[c + k * 4 + 3] = alpha;
    }
  };

  Renderer.prototype.addParticle = function (x, y, z, size, color, alpha) {
    if (this.partCount >= this.partMax) return;
    var i = this.partCount++, o = i * 12, c = i * 16;
    var r = this._pRight, u = this._pUp, h = size * 0.5;
    var rx = r[0] * h, ry = r[1] * h, rz = r[2] * h;
    var ux = u[0] * h, uy = u[1] * h, uz = u[2] * h;
    var P = this.partPos;
    P[o] = x - rx - ux; P[o + 1] = y - ry - uy; P[o + 2] = z - rz - uz;
    P[o + 3] = x + rx - ux; P[o + 4] = y + ry - uy; P[o + 5] = z + rz - uz;
    P[o + 6] = x + rx + ux; P[o + 7] = y + ry + uy; P[o + 8] = z + rz + uz;
    P[o + 9] = x - rx + ux; P[o + 10] = y - ry + uy; P[o + 11] = z - rz + uz;
    var C = this.partCol, cr = color[0], cg = color[1], cb = color[2];
    for (var k = 0; k < 4; k++) {
      C[c + k * 4] = cr; C[c + k * 4 + 1] = cg; C[c + k * 4 + 2] = cb; C[c + k * 4 + 3] = alpha;
    }
  };
  Renderer.prototype.endParticles = function (multiply) {
    if (!this.partCount) return;
    var gl = this.gl, p = this.progs.part;
    if (!p || !p.ok) return;
    p.use(); this._curProg = p;
    gl.uniformMatrix4fv(p.loc('uProj'), false, this.cam.proj);
    gl.uniformMatrix4fv(p.loc('uView'), false, this.cam.view);
    gl.uniform3fv(p.loc('uCamPos'), this.cam.eye);
    gl.uniform3fv(p.loc('uFogColor'), this.theme.fog);
    gl.uniform1f(p.loc('uFogDensity'), this.lowSpec ? 0.020 : 0.026);
    gl.enable(gl.BLEND);
    // shadows darken what is underneath; particles composite normally
    if (multiply) gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(this.partVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partPosBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.partPos, 0, this.partCount * 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partColBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.partCol, 0, this.partCount * 16);
    gl.drawElements(gl.TRIANGLES, this.partCount * 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.BLEND);
    this.drawCalls++;
  };

  // Deferred background fill: depth-tested so covered pixels are rejected.
  Renderer.prototype.drawSky = function () {
    var gl = this.gl, sp = this.progs.sky;
    if (!sp || !sp.ok) return;
    sp.use(); this._curProg = sp;
    gl.disable(gl.BLEND);
    gl.depthMask(false);                 // sky must not occlude anything
    gl.bindVertexArray(this.emptyVao);
    var top = this.theme.amb, bot = this.theme.fog;
    gl.uniform3f(sp.loc('uTop'), top[0] * 1.6, top[1] * 1.6, top[2] * 1.8);
    gl.uniform3f(sp.loc('uBot'), bot[0], bot[1], bot[2]);
    gl.uniform1f(sp.loc('uTime'), this.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    this.drawCalls++;
  };

  Renderer.prototype.beginSprites = function () {
    var gl = this.gl, p = this.progs.unlit; p.use(); this._curProg = p;
    gl.uniformMatrix4fv(p.loc('uProj'), false, this.cam.proj);
    gl.uniformMatrix4fv(p.loc('uView'), false, this.cam.view);
    gl.uniform3fv(p.loc('uCamPos'), this.cam.eye);
    gl.uniform3fv(p.loc('uFogColor'), this.theme.fog);
    gl.uniform1f(p.loc('uFogDensity'), 0.018);
    gl.uniform1f(p.loc('uTime'), this.time);
    gl.uniform1i(p.loc('uTex'), 0);
    gl.uniform1i(p.loc('uMode'), 8);
    var idm = EH.M.Mat4.identity(this._m);
    gl.uniformMatrix4fv(p.loc('uModel'), false, idm);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);            // alpha-cutout sprites write depth -> correct occlusion
    this._camRight = [this.cam.view[0], this.cam.view[4], this.cam.view[8]];
    this._camUp = [this.cam.view[1], this.cam.view[5], this.cam.view[9]];
  };
  Renderer.prototype.drawSprite = function (tex, u0, v0, u1, v1, x, y, z, w, h, color, flip) {
    var gl = this.gl, p = this.progs.unlit;
    var r = this._camRight, u = this._camUp;
    var hw = w * 0.5, bx = x, by = y, bz = z;   // anchor = bottom centre (feet at y)
    var P = this._bbPos;
    // bottom-left, bottom-right, top-right, top-left
    P[0] = bx - r[0] * hw;         P[1] = by - u[0] * 0;      P[2] = bz - r[2] * hw;
    P[3] = bx + r[0] * hw;         P[4] = by;                 P[5] = bz + r[2] * hw;
    P[6] = bx + r[0] * hw + u[0] * h; P[7] = by + u[1] * h;   P[8] = bz + r[2] * hw + u[2] * h;
    P[9] = bx - r[0] * hw + u[0] * h; P[10] = by + u[1] * h;  P[11] = bz - r[2] * hw + u[2] * h;
    // proper bottom corners need vertical too (use up for full height, base at y)
    P[1] = by; P[4] = by;
    var U = this._bbUv;
    if (flip) { var t = u0; u0 = u1; u1 = t; }
    U[0] = u0; U[1] = v1; U[2] = u1; U[3] = v1; U[4] = u1; U[5] = v0; U[6] = u0; U[7] = v0;
    gl.uniform4fv(p.loc('uColor'), color || [1, 1, 1, 1]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindVertexArray(this.bbVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bbPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, P);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bbUv); gl.bufferSubData(gl.ARRAY_BUFFER, 0, U);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    this.drawCalls++;
    gl.bindVertexArray(null);
  };
  Renderer.prototype.endSprites = function () {
    var gl = this.gl; gl.disable(gl.BLEND);
  };

  Renderer.prototype.dispose = function () {
    var gl = this.gl; if (!gl) return;
    if (this.bloom) { this._freeTarget(this.bloom.scene); this._freeTarget(this.bloom.a); this._freeTarget(this.bloom.b); this.bloom = null; }
    for (var n in this.meshGPU) this.meshGPU[n].forEach(function (p) { gl.deleteVertexArray(p.vao); });
    this.meshGPU = {}; this.meshGroups = {}; this.texCache = {}; this.matTex = {};
  };

  EH.Renderer = Renderer;
})();
