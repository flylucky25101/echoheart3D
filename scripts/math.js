'use strict';
// Minimal linear algebra. Mat4 = Float32Array(16), COLUMN-MAJOR (WebGL).
(function () {
  var EH = window.EchoHeart;
  var M = EH.M = {};

  // ---------- Vec3 (plain arrays) ----------
  var V = M.Vec3 = {
    create: function () { return [0, 0, 0]; },
    set: function (o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; },
    copy: function (o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
    add: function (o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
    sub: function (o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
    scale: function (o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
    addScaled: function (o, a, b, s) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross: function (o, a, b) {
      var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
      o[0] = ay * bz - az * by; o[1] = az * bx - ax * bz; o[2] = ax * by - ay * bx; return o;
    },
    len: function (a) { return Math.hypot(a[0], a[1], a[2]); },
    dist: function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); },
    normalize: function (o, a) {
      var l = Math.hypot(a[0], a[1], a[2]);
      if (l > 1e-8) { o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; } else { o[0] = 0; o[1] = 0; o[2] = 0; }
      return o;
    },
    lerp: function (o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; },
    transformMat4: function (o, a, m) {
      var x = a[0], y = a[1], z = a[2];
      var w = m[3] * x + m[7] * y + m[11] * z + m[15]; w = w || 1.0;
      o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      return o;
    }
  };

  // ---------- Quaternion [x,y,z,w] ----------
  var Q = M.Quat = {
    create: function () { return [0, 0, 0, 1]; },
    identity: function (o) { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 1; return o; },
    setAxisAngle: function (o, ax, ay, az, rad) {
      var h = rad * 0.5, s = Math.sin(h);
      o[0] = ax * s; o[1] = ay * s; o[2] = az * s; o[3] = Math.cos(h); return o;
    },
    fromEuler: function (o, x, y, z) { // radians, order ZYX applied as XYZ mult
      var cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
      var cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
      var cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
      o[0] = sx * cy * cz - cx * sy * sz;
      o[1] = cx * sy * cz + sx * cy * sz;
      o[2] = cx * cy * sz - sx * sy * cz;
      o[3] = cx * cy * cz + sx * sy * sz;
      return o;
    },
    multiply: function (o, a, b) {
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bx = b[0], by = b[1], bz = b[2], bw = b[3];
      o[0] = aw * bx + ax * bw + ay * bz - az * by;
      o[1] = aw * by - ax * bz + ay * bw + az * bx;
      o[2] = aw * bz + ax * by - ay * bx + az * bw;
      o[3] = aw * bw - ax * bx - ay * by - az * bz;
      return o;
    },
    normalize: function (o, a) {
      var l = Math.hypot(a[0], a[1], a[2], a[3]);
      if (l > 1e-8) { o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; o[3] = a[3] / l; }
      else { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 1; }
      return o;
    },
    slerp: function (o, a, b, t) {
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bx = b[0], by = b[1], bz = b[2], bw = b[3];
      var cosom = ax * bx + ay * by + az * bz + aw * bw;
      if (cosom < 0) { cosom = -cosom; bx = -bx; by = -by; bz = -bz; bw = -bw; }
      var scale0, scale1;
      if (1 - cosom > 1e-6) {
        var omega = Math.acos(cosom), sinom = Math.sin(omega);
        scale0 = Math.sin((1 - t) * omega) / sinom; scale1 = Math.sin(t * omega) / sinom;
      } else { scale0 = 1 - t; scale1 = t; }
      o[0] = scale0 * ax + scale1 * bx; o[1] = scale0 * ay + scale1 * by;
      o[2] = scale0 * az + scale1 * bz; o[3] = scale0 * aw + scale1 * bw;
      return o;
    }
  };

  // ---------- Mat4 (column-major) ----------
  var T = M.Mat4 = {
    create: function () { var o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    identity: function (o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    copy: function (o, a) { o.set(a); return o; },
    multiply: function (o, a, b) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
          a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (var i = 0; i < 4; i++) {
        var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return o;
    },
    perspective: function (o, fovy, aspect, near, far) {
      var f = 1.0 / Math.tan(fovy / 2); o.fill(0);
      o[0] = f / aspect; o[5] = f; o[11] = -1;
      if (far != null && far !== Infinity) {
        var nf = 1 / (near - far); o[10] = (far + near) * nf; o[14] = 2 * far * near * nf;
      } else { o[10] = -1; o[14] = -2 * near; }
      return o;
    },
    ortho: function (o, l, r, b, t, n, f) {
      var lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f); o.fill(0);
      o[0] = -2 * lr; o[5] = -2 * bt; o[10] = 2 * nf; o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1; return o;
    },
    lookAt: function (o, eye, center, up) {
      var ex = eye[0], ey = eye[1], ez = eye[2];
      var zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
      var zl = Math.hypot(zx, zy, zz); if (zl < 1e-8) { return T.identity(o); }
      zx /= zl; zy /= zl; zz /= zl;
      var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      var xl = Math.hypot(xx, xy, xz); if (xl < 1e-8) { xx = 0; xy = 0; xz = 0; } else { xx /= xl; xy /= xl; xz /= xl; }
      var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
      o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * ex + xy * ey + xz * ez);
      o[13] = -(yx * ex + yy * ey + yz * ez);
      o[14] = -(zx * ex + zy * ey + zz * ez);
      o[15] = 1; return o;
    },
    fromRTS: function (o, q, v, s) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x, y2 = y + y, z2 = z + z;
      var xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
      var wx = w * x2, wy = w * y2, wz = w * z2, sx = s[0], sy = s[1], sz = s[2];
      o[0] = (1 - (yy + zz)) * sx; o[1] = (xy + wz) * sx; o[2] = (xz - wy) * sx; o[3] = 0;
      o[4] = (xy - wz) * sy; o[5] = (1 - (xx + zz)) * sy; o[6] = (yz + wx) * sy; o[7] = 0;
      o[8] = (xz + wy) * sz; o[9] = (yz - wx) * sz; o[10] = (1 - (xx + yy)) * sz; o[11] = 0;
      o[12] = v[0]; o[13] = v[1]; o[14] = v[2]; o[15] = 1; return o;
    },
    translate: function (o, a, v) {
      if (o !== a) o.set(a);
      o[12] = a[0] * v[0] + a[4] * v[1] + a[8] * v[2] + a[12];
      o[13] = a[1] * v[0] + a[5] * v[1] + a[9] * v[2] + a[13];
      o[14] = a[2] * v[0] + a[6] * v[1] + a[10] * v[2] + a[14];
      return o;
    },
    scale: function (o, a, v) {
      o[0] = a[0] * v[0]; o[1] = a[1] * v[0]; o[2] = a[2] * v[0]; o[3] = a[3] * v[0];
      o[4] = a[4] * v[1]; o[5] = a[5] * v[1]; o[6] = a[6] * v[1]; o[7] = a[7] * v[1];
      o[8] = a[8] * v[2]; o[9] = a[9] * v[2]; o[10] = a[10] * v[2]; o[11] = a[11] * v[2];
      o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15]; return o;
    },
    rotateY: function (o, a, rad) {
      var s = Math.sin(rad), c = Math.cos(rad);
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      if (o !== a) { o[4] = a[4]; o[5] = a[5]; o[6] = a[6]; o[7] = a[7]; o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15]; }
      o[0] = a00 * c - a20 * s; o[1] = a01 * c - a21 * s; o[2] = a02 * c - a22 * s; o[3] = a03 * c - a23 * s;
      o[8] = a00 * s + a20 * c; o[9] = a01 * s + a21 * c; o[10] = a02 * s + a22 * c; o[11] = a03 * s + a23 * c;
      return o;
    },
    invert: function (o, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
          a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
          b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
          b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
          b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return null; det = 1.0 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
    normalMat3FromMat4: function (o9, m) {
      // returns 3x3 (Float32Array 9) = inverse-transpose of upper-left 3x3
      var a00 = m[0], a01 = m[1], a02 = m[2], a10 = m[4], a11 = m[5], a12 = m[6], a20 = m[8], a21 = m[9], a22 = m[10];
      var b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
      var det = a00 * b01 + a01 * b11 + a02 * b21;
      if (!det) { o9[0] = 1; o9[1] = 0; o9[2] = 0; o9[3] = 0; o9[4] = 1; o9[5] = 0; o9[6] = 0; o9[7] = 0; o9[8] = 1; return o9; }
      det = 1.0 / det;
      o9[0] = b01 * det; o9[1] = (-a22 * a01 + a02 * a21) * det; o9[2] = (a12 * a01 - a02 * a11) * det;
      o9[3] = b11 * det; o9[4] = (a22 * a00 - a02 * a20) * det; o9[5] = (-a12 * a00 + a02 * a10) * det;
      o9[6] = b21 * det; o9[7] = (-a21 * a00 + a01 * a20) * det; o9[8] = (a11 * a00 - a01 * a10) * det;
      return o9;
    },
    hasNaN: function (m) { for (var i = 0; i < 16; i++) if (!isFinite(m[i])) return true; return false; }
  };
})();
