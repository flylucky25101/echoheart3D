'use strict';
// GLSL ES 3.00 shader sources (Raw WebGL2). Authored by hand.
(function () {
  var EH = window.EchoHeart;
  EH.SHADERS = {
    pbrVS: [
      '#version 300 es',
      'precision highp float;',
      'layout(location=0) in vec3 aPos;',
      'layout(location=1) in vec3 aNrm;',
      'layout(location=2) in vec2 aUv;',
      // Which joint this vertex belongs to. Characters are drawn as one call per
      // material with every part's matrix uploaded at once, instead of one call
      // per part - a 14-part actor was 14 draws, and a busy room blew the frame
      // budget more than three times over.
      'layout(location=3) in float aPart;',
      // Per-instance model matrix. Scenery repeats the same mesh many times with
      // nothing but the transform changing - the arena wall ring alone was 44
      // draws a frame - so those go out as one instanced call per material.
      'layout(location=4) in vec4 aI0;',
      'layout(location=5) in vec4 aI1;',
      'layout(location=6) in vec4 aI2;',
      'layout(location=7) in vec4 aI3;',
      'uniform mat4 uProj,uView,uModel; uniform mat3 uNormalMat;',
      'uniform mat4 uParts[' + 16 + ']; uniform int uPartCount; uniform int uInstanced;',
      'out vec3 vWorld; out vec3 vNrm; out vec2 vUv;',
      'void main(){',
      '  mat4 M; mat3 N;',
      '  if(uInstanced>0){',
      '    M=mat4(aI0,aI1,aI2,aI3);',
      '    N=mat3(normalize(M[0].xyz),normalize(M[1].xyz),normalize(M[2].xyz));',
      '  } else if(uPartCount>0){',
      '    M=uParts[int(aPart)];',
      // Joint scale is always uniform (Animator.compose writes one scalar to all
      // three axes), so the rotation block normalised is an exact normal matrix
      // and we can skip uploading a second array of them.
      '    N=mat3(normalize(M[0].xyz),normalize(M[1].xyz),normalize(M[2].xyz));',
      '  } else { M=uModel; N=uNormalMat; }',
      '  vec4 w=M*vec4(aPos,1.0); vWorld=w.xyz; vNrm=normalize(N*aNrm); vUv=aUv;',
      '  gl_Position=uProj*uView*w;',
      '}'
    ].join('\n'),
    pbrFS: [
      '#version 300 es',
      'precision highp float;',
      'in vec3 vWorld; in vec3 vNrm; in vec2 vUv;',
      'uniform vec3 uCamPos,uLightDir,uLightColor,uAmbient,uFogColor,uTint,uAccent;',
      'uniform vec3 uFillDir,uFillColor;',
      'uniform float uFogDensity,uEmissive,uUvScale,uFlash,uDissolve,uTime,uClipR,uFlatTBN;',
      'uniform sampler2D uAlbedo,uNormal,uOrm,uEmis;',
      'out vec4 frag;',
      'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
      'mat3 cotangent(vec3 N, vec3 p, vec2 uv){',
      '  vec3 dp1=dFdx(p),dp2=dFdy(p); vec2 d1=dFdx(uv),d2=dFdy(uv);',
      '  vec3 dp2p=cross(dp2,N); vec3 dp1p=cross(N,dp1);',
      '  vec3 T=dp2p*d1.x+dp1p*d2.x; vec3 B=dp2p*d1.y+dp1p*d2.y;',
      '  float im=inversesqrt(max(dot(T,T),dot(B,B))); return mat3(T*im,B*im,N);',
      '}',
      'void main(){',
      '  // circular arena clip: the walls are a ring, so the floor must be a',
      '  // disc. Without this the square floor plate juts out past the wall.',
      '  if(uClipR>0.0){ float rr=length(vWorld.xz); if(rr>uClipR) discard; }',
      '  vec2 uv=vUv*uUvScale;',
      '  vec4 alb=texture(uAlbedo,uv);',
      '  if(uDissolve>0.0){ float n=hash(floor(vWorld.xz*7.0)+floor(vec2(vWorld.y*7.0))); if(n<uDissolve) discard; }',
      '  vec3 base=alb.rgb*uTint;',
      '  vec3 orm=texture(uOrm,uv).rgb; float ao=orm.r, rough=clamp(orm.g,0.06,1.0), metal=orm.b;',
      '  vec3 nTex=texture(uNormal,uv).xyz*2.0-1.0;',
      '  nTex.xy *= 1.6;                                  // stronger surface relief',
      '  vec3 N=normalize(vNrm);',
      '  // The floor is a Y-up plane, so its tangent frame is constant. Running',
      '  // cotangent() there costs 4 derivative ops per pixel across the whole',
      '  // screen for a result we already know. Uniform branch = no divergence.',
      '  if(uFlatTBN>0.5){ N=normalize(vec3(nTex.x, nTex.z, nTex.y)); }',
      '  else { mat3 TBN=cotangent(N,vWorld,uv); N=normalize(TBN*normalize(nTex)); }',
      '  vec3 V=normalize(uCamPos-vWorld);',
      '  vec3 L=normalize(uLightDir);',
      '  vec3 F=normalize(uFillDir);',
      '  // --- key: half-lambert wrap so limbs read as rounded volumes ---',
      '  float ndl=dot(N,L);',
      '  float key=pow(clamp(ndl*0.5+0.5,0.0,1.0),1.6);',
      '  // --- fill from the opposite side: separates form from background ---',
      '  float fill=clamp(dot(N,F)*0.5+0.5,0.0,1.0)*0.55;',
      '  // --- bounce from the floor ---',
      '  float bounce=clamp(-N.y*0.5+0.5,0.0,1.0)*0.22;',
      '  // --- shadow term keeps cavities dark so the silhouette stays crisp ---',
      '  float shade=clamp(ndl,0.0,1.0);',
      '  vec3 diffuse = base * ( uAmbient*ao*0.9',
      '                        + uLightColor*key*1.25',
      '                        + uFillColor*fill*ao',
      '                        + uAccent*bounce*ao );',
      '  // --- specular (Blinn-Phong, roughness driven) ---',
      '  vec3 H=normalize(L+V); float ndh=max(dot(N,H),0.0);',
      '  float spec=pow(ndh, mix(12.0,180.0,1.0-rough))*(1.0-rough*0.75)*shade;',
      '  vec3 specCol=mix(vec3(0.05),base,metal);',
      '  // --- rim light: cyan edge that pops characters off the floor ---',
      '  float fres=pow(1.0-max(dot(N,V),0.0),3.2);',
      '  vec3 rim=uAccent*fres*(0.55+0.85*(1.0-rough));',
      '  vec3 col = diffuse + uLightColor*spec*specCol*2.6 + rim;',
      '  vec3 em=texture(uEmis,uv).rgb; col+=em*uEmissive;',
      '  if(uDissolve>0.0){ col+=uAccent*0.8; }',
      '  col=mix(col,vec3(1.0),uFlash);',
      '  float dist=length(uCamPos-vWorld); float fog=1.0-exp(-uFogDensity*dist);',
      '  col=mix(col,uFogColor,clamp(fog,0.0,0.85));',
      '  col=col/(col+vec3(0.85));',
      '  col=pow(max(col,0.0),vec3(1.0/2.2));',
      '  frag=vec4(col, alb.a);',
      '}'
    ].join('\n'),
    unlitVS: [
      '#version 300 es',
      'precision highp float;',
      'layout(location=0) in vec3 aPos;',
      'layout(location=1) in vec3 aNrm;',
      'layout(location=2) in vec2 aUv;',
      'uniform mat4 uProj,uView,uModel;',
      'out vec2 vUv; out vec3 vWorld;',
      'void main(){ vec4 w=uModel*vec4(aPos,1.0); vWorld=w.xyz; vUv=aUv; gl_Position=uProj*uView*w; }'
    ].join('\n'),
    unlitFS: [
      '#version 300 es',
      'precision highp float;',
      'in vec2 vUv; in vec3 vWorld;',
      'uniform vec4 uColor; uniform int uMode; uniform float uTime,uScroll,uProgress;',
      'uniform vec3 uCamPos,uFogColor; uniform float uFogDensity;',
      'uniform sampler2D uTex; uniform int uUseTex;',
      'out vec4 frag;',
      'void main(){',
      '  vec4 c=uColor;',
      '  if(uMode==1){ float d=length(vUv-0.5)*2.0; c.a*=smoothstep(1.0,0.15,d); }',
      '  else if(uMode==2){ if(uUseTex==1){ vec4 t=texture(uTex,vUv+vec2(uTime*uScroll,uTime*uScroll*0.3)); c.rgb*=t.rgb+0.4; c.a*=clamp(max(max(t.r,t.g),t.b),0.0,1.0);} }',
      '  else if(uMode==3){ float d=length(vUv-0.5); float a=atan(vUv.y-0.5,vUv.x-0.5); float ring=sin(d*26.0-uTime*4.0+a*3.0)*0.5+0.5; c.rgb*=(0.4+ring*0.9); c.a*=smoothstep(0.5,0.05,d);} ',
      '  else if(uMode==4){ float d=length(vUv-0.5)*2.0; c.a*=smoothstep(1.0,0.75,d)*step(d,1.0);} ',
      // ---- 5: area warning : dark tint + thin sweep line + crisp boundary ----
      '  else if(uMode==5){',
      '    vec2 p=vUv-0.5; float d=length(p)*2.0;',
      '    if(d>1.0) discard;',
      '    float fill=step(d,uProgress);',
      '    float sweep=smoothstep(0.045,0.0,abs(d-uProgress));',
      '    float rim=smoothstep(0.90,1.0,d);',
      '    float a=fill*0.13+rim*0.34+sweep*0.26;',
      '    c.rgb*=(0.45+rim*0.75+sweep*1.05);',
      '    c.a*=a;',
      '  }',
      // ---- 6: lane warning : side rails + leading edge, low fill ----
      '  else if(uMode==6){',
      '    float across=abs(vUv.x-0.5)*2.0; float along=vUv.y;',
      '    if(across>1.0) discard;',
      '    float rails=smoothstep(0.86,1.0,across);',
      '    float fill=step(along,uProgress);',
      '    float head=smoothstep(0.045,0.0,abs(along-uProgress));',
      '    float a=fill*0.11+rails*0.26+head*0.22;',
      '    c.rgb*=(0.45+rails*0.60+head*0.95);',
      '    c.a*=a;',
      '  }',
      // ---- 7: closing ring : single thin ring ----
      '  else if(uMode==7){',
      '    vec2 p=vUv-0.5; float d=length(p)*2.0;',
      '    float ring=smoothstep(0.085,0.0,abs(d-1.0));',
      '    float inner=smoothstep(0.06,0.0,abs(d-(1.0-uProgress*0.85)));',
      '    float a=ring*0.34+inner*0.28;',
      '    c.rgb*=(0.5+inner*1.1);',
      '    c.a*=a;',
      '  }',
      '  else if(uMode==8){ vec4 t=texture(uTex,vUv); if(t.a<0.35) discard; c.rgb*=t.rgb; c.a*=t.a; }',
      '  if(uMode!=1){ float dist=length(uCamPos-vWorld); float fog=1.0-exp(-uFogDensity*dist*0.4); c.rgb=mix(c.rgb,uFogColor,clamp(fog,0.0,0.6)); }',
      '  frag=c;',
      '}'
    ].join('\n'),
    // ---- batched particles ----
    // Every particle used to be its own drawPrim call (matrix build + uniform
    // upload + draw). At 320 live particles that is 320 draw calls in the one
    // moment the game is busiest - the ultimate. These are camera-facing quads
    // with per-vertex colour, uploaded and drawn as a single batch instead.
    partVS: [
      '#version 300 es',
      'precision highp float;',
      'layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUv;',
      'layout(location=2) in vec4 aCol;',
      'uniform mat4 uProj,uView;',
      'out vec2 vUv; out vec4 vCol; out vec3 vWorld;',
      'void main(){ vUv=aUv; vCol=aCol; vWorld=aPos; gl_Position=uProj*uView*vec4(aPos,1.0); }'
    ].join('\n'),
    partFS: [
      '#version 300 es',
      'precision highp float;',
      'in vec2 vUv; in vec4 vCol; in vec3 vWorld;',
      'uniform vec3 uCamPos,uFogColor; uniform float uFogDensity;',
      'out vec4 frag;',
      'void main(){',
      '  vec2 d=vUv*2.0-1.0;',
      '  float r=dot(d,d);',
      '  if(r>1.0) discard;',
      '  float a=vCol.a*(1.0-r)*(1.0-r);',            // soft round falloff
      '  vec3 c=vCol.rgb*(0.65+0.55*(1.0-r));',
      '  float dist=length(uCamPos-vWorld);',
      '  float fog=1.0-exp(-uFogDensity*dist*0.4);',
      '  c=mix(c,uFogColor,clamp(fog,0.0,0.5));',
      '  frag=vec4(c,a);',
      '}'
    ].join('\n'),
    // ---- bloom post chain ----
    // Fullscreen triangle generated from gl_VertexID: no vertex buffer needed.
    postVS: [
      '#version 300 es',
      'precision highp float; out vec2 vUv;',
      'void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));',
      '  vUv=p; gl_Position=vec4(p*2.0-1.0,0.0,1.0); }'
    ].join('\n'),
    // bright-pass + 1/4-res downsample in one go (4 taps)
    brightFS: [
      '#version 300 es',
      'precision highp float; in vec2 vUv; uniform sampler2D uTex;',
      'uniform vec2 uTexel; uniform float uThreshold,uKnee;',
      'out vec4 frag;',
      'vec3 tap(vec2 o){ return texture(uTex, vUv+o*uTexel).rgb; }',
      'void main(){',
      '  vec3 c=(tap(vec2(-1,-1))+tap(vec2(1,-1))+tap(vec2(-1,1))+tap(vec2(1,1)))*0.25;',
      '  float l=max(c.r,max(c.g,c.b));',
      '  // soft knee so the glow ramps in instead of popping at the threshold',
      '  float s=clamp((l-uThreshold+uKnee)/(2.0*uKnee),0.0,1.0);',
      '  float w=max(l-uThreshold, s*s*uKnee)/max(l,1e-4);',
      '  frag=vec4(c*w,1.0);',
      '}'
    ].join('\n'),
    // separable gaussian, 9 taps via 5 bilinear samples
    blurFS: [
      '#version 300 es',
      'precision highp float; in vec2 vUv; uniform sampler2D uTex;',
      'uniform vec2 uDir;',
      'out vec4 frag;',
      'void main(){',
      '  vec3 c=texture(uTex,vUv).rgb*0.2270270270;',
      '  c+=texture(uTex,vUv+uDir*1.3846153846).rgb*0.3162162162;',
      '  c+=texture(uTex,vUv-uDir*1.3846153846).rgb*0.3162162162;',
      '  c+=texture(uTex,vUv+uDir*3.2307692308).rgb*0.0702702703;',
      '  c+=texture(uTex,vUv-uDir*3.2307692308).rgb*0.0702702703;',
      '  frag=vec4(c,1.0);',
      '}'
    ].join('\n'),
    // composite: scene + bloom, then a gentle filmic curve and vignette
    compositeFS: [
      '#version 300 es',
      'precision highp float; in vec2 vUv;',
      'uniform sampler2D uScene,uBloom;',
      'uniform float uBloomAmt,uVignette;',
      'out vec4 frag;',
      'void main(){',
      '  vec3 c=texture(uScene,vUv).rgb;',
      '  c+=texture(uBloom,vUv).rgb*uBloomAmt;',
      '  // subtle vignette pulls the eye to the middle of the arena',
      '  vec2 d=vUv-0.5; float v=1.0-dot(d,d)*uVignette;',
      '  c*=clamp(v,0.0,1.0);',
      '  frag=vec4(c,1.0);',
      '}'
    ].join('\n'),
    skyVS: [
      '#version 300 es',
      'precision highp float; out vec2 vUv;',
      'void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv=p; gl_Position=vec4(p*2.0-1.0,0.999,1.0); }'
    ].join('\n'),
    skyFS: [
      '#version 300 es',
      'precision highp float; in vec2 vUv; uniform vec3 uTop,uBot; uniform float uTime; out vec4 frag;',
      'void main(){ float t=clamp(vUv.y*0.5,0.0,1.0); vec3 c=mix(uBot,uTop,t);',
      '  float v=distance(vUv*0.5,vec2(0.5)); c*=1.0-v*0.55;',
      '  float g=sin(vUv.x*40.0+uTime*0.5)*sin(vUv.y*30.0-uTime*0.3); c+=0.015*g*uTop;',
      '  frag=vec4(max(c,0.0),1.0); }'
    ].join('\n')
  };
})();
