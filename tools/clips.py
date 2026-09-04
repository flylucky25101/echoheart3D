#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Python port of scripts/animation.js clips, used to bake sprite frames."""
import math
sin, cos, PI = math.sin, math.cos, math.pi

def ease(t): return 0.0 if t < 0 else (1.0 if t > 1 else t*t*(3-2*t))
def pulse(t, a, b): return ease((t-a)/max(1e-4, b-a))
def clamp(v, a, b): return a if v < a else (b if v > b else v)

class Pose(dict):
    def set(self, n, rx=0, ry=0, rz=0):
        e = list(self.get(n, [0]*7)); e[0], e[1], e[2] = rx, ry, rz
        while len(e) < 7: e.append(0)
        if e[6] == 0: e[6] = 1
        self[n] = e
    def move(self, n, x=0, y=0, z=0):
        e = list(self.get(n, [0, 0, 0, 0, 0, 0, 1])); e[3], e[4], e[5] = x, y, z
        self[n] = e
    def scale(self, n, s):
        e = list(self.get(n, [0, 0, 0, 0, 0, 0, 1])); e[6] = s
        self[n] = e
    def final(self):
        return {k: tuple(v if len(v) == 7 else list(v)+[1]) for k, v in self.items()}

# ------------------------------------------------------------------ player
def _base(a, t):
    br = sin(t*2.2)*0.035
    a.set('torso', br*0.6, 0, 0)
    a.set('head', -br*0.4, sin(t*0.7)*0.12, 0)
    a.move('pelvis', 0, sin(t*2.2)*0.012, 0)
    a.set('cloak', 0.12+sin(t*1.3)*0.06, sin(t*0.9)*0.08, 0)
    a.scale('heart', 1+sin(t*3.4)*0.10)

def l_idle(a, t, c):
    _base(a, t)
    a.set('upperArmR', 0.06, 0, -0.18); a.set('lowerArmR', -0.28, 0, 0)
    a.set('upperArmL', 0.06, 0, 0.18);  a.set('lowerArmL', -0.24, 0, 0)
    a.set('thighR', 0, 0, 0.03); a.set('thighL', 0, 0, -0.03)

def l_run(a, t, c):
    w = t*9.5; sw, sw2 = sin(w), sin(w+PI)
    a.set('torso', 0.16, sin(w*2)*0.05, 0)
    a.set('head', -0.08, 0, 0)
    a.move('pelvis', 0, abs(sin(w))*0.055, 0)
    a.set('thighR', sw*0.85, 0, 0.03);  a.set('shinR', max(0, -sw)*0.9, 0, 0)
    a.set('thighL', sw2*0.85, 0, -0.03); a.set('shinL', max(0, -sw2)*0.9, 0, 0)
    a.set('upperArmR', sw2*0.6, 0, -0.2); a.set('lowerArmR', -0.5-abs(sw2)*0.3, 0, 0)
    a.set('upperArmL', sw*0.6, 0, 0.2);   a.set('lowerArmL', -0.45-abs(sw)*0.3, 0, 0)
    a.set('cloak', 0.5+sin(w)*0.12, 0, 0)
    a.scale('heart', 1+sin(t*5)*0.12)

def l_dash(a, t, c):
    p = ease(t/0.22)
    a.set('torso', 0.5-p*0.15, 0, 0); a.set('head', -0.25, 0, 0)
    a.set('upperArmR', -0.9, 0, -0.5); a.set('lowerArmR', -0.7, 0, 0)
    a.set('upperArmL', -0.9, 0, 0.5);  a.set('lowerArmL', -0.7, 0, 0)
    a.set('thighR', -0.5, 0, 0); a.set('shinR', 0.9, 0, 0)
    a.set('thighL', 0.6, 0, 0);  a.set('shinL', 0.4, 0, 0)
    a.set('cloak', 1.25, 0, 0)

def l_hit(a, t, c):
    p = 1-ease(t/0.26)
    a.set('torso', -0.35*p, 0.2*p, 0); a.set('head', -0.3*p, 0, 0)
    a.set('upperArmR', -0.4*p, 0, -0.4*p); a.set('upperArmL', -0.4*p, 0, 0.4*p)
    a.scale('heart', 1+p*0.5)

def l_death(a, t, c):
    p = ease(t/0.9)
    a.set('torso', 0.5*p, 0.3*p, 0); a.set('head', 0.7*p, 0, 0.2*p)
    a.move('pelvis', 0, -0.55*p, 0)
    a.set('thighR', 1.1*p, 0, 0); a.set('shinR', -1.3*p, 0, 0)
    a.set('thighL', 0.9*p, 0, 0); a.set('shinL', -1.1*p, 0, 0)
    a.set('upperArmR', 0.8*p, 0, -0.7*p); a.set('upperArmL', 0.8*p, 0, 0.7*p)
    a.set('cloak', 0.2*p, 0, 0); a.scale('heart', 1+p*0.8)

def l_revive(a, t, c):
    p = ease(t/1.0)
    a.set('torso', 0.6*(1-p), 0, 0)
    a.move('pelvis', 0, -0.5*(1-p), 0)
    a.set('head', 0.5*(1-p)-0.1, 0, 0)
    a.set('upperArmR', -1.2*p*(1-p)*4-0.1, 0, -0.3)
    a.set('upperArmL', -1.2*p*(1-p)*4-0.1, 0, 0.3)
    a.set('thighR', 0.8*(1-p), 0, 0); a.set('thighL', 0.7*(1-p), 0, 0)
    a.scale('heart', 1+(1-p)*1.6)

def _swing(a, t, dur, sgn, high):
    w = clamp(t/dur, 0, 1)
    wind, strike, rec = pulse(w, 0, .32), pulse(w, .32, .62), pulse(w, .62, 1)
    twist = (-0.5*wind + 1.0*strike - 0.45*rec)*sgn
    a.set('torso', 0.1+0.18*strike, twist, 0)
    a.set('pelvis', 0, twist*0.35, 0)
    a.set('head', -0.05, twist*0.5, 0)
    swing = (-1.5*wind + 2.6*strike - 0.9*rec)
    a.set('upperArmR', -0.5+swing*(0.9 if high else 0.65), 0, -0.35-twist*0.4)
    a.set('lowerArmR', -0.8+wind*0.5-strike*0.5, 0, 0)
    a.set('upperArmL', 0.2-swing*0.25, 0, 0.5+twist*0.3)
    a.set('lowerArmL', -0.7, 0, 0)
    a.set('thighR', -0.12*strike, 0, 0.03); a.set('thighL', 0.22*strike, 0, -0.03)
    a.move('pelvis', 0, -0.05*strike, 0.12*strike)
    a.set('cloak', 0.3+strike*0.5, twist*0.4, 0)

def l_sword1(a, t, c): _swing(a, t, 0.35, 1, False)
def l_sword2(a, t, c): _swing(a, t, 0.34, -1, False)
def l_sword3(a, t, c): _swing(a, t, 0.56, 1, True)

def l_swordSkill(a, t, c):
    w = clamp(t/0.5, 0, 1)
    wind, thrust, rec = pulse(w, 0, .35), pulse(w, .35, .55), pulse(w, .55, 1)
    a.set('torso', 0.1-0.25*wind+0.3*thrust-0.15*rec, -0.5*wind+0.7*thrust, 0)
    a.set('upperArmR', -1.6*wind+1.9*thrust-0.4*rec, 0, -0.3)
    a.set('lowerArmR', -1.2*wind+1.3*thrust, 0, 0)
    a.set('upperArmL', 0.4*wind-0.3*thrust, 0, 0.6)
    a.move('pelvis', 0, 0, 0.3*thrust-0.2*rec)
    a.set('cloak', 0.3+thrust*0.7, 0, 0)

def l_bowShoot(a, t, c):
    w = clamp(t/0.3, 0, 1); draw, rel = pulse(w, 0, .45), pulse(w, .45, .65)
    a.set('torso', 0.06, -0.45, 0); a.set('pelvis', 0, -0.3, 0); a.set('head', 0, -0.25, 0)
    a.set('upperArmL', -1.45, 0, 0.55); a.set('lowerArmL', -0.1, 0, 0)
    a.set('upperArmR', -1.15-draw*0.25+rel*0.3, 0, -0.9-draw*0.35+rel*0.5)
    a.set('lowerArmR', -1.1-draw*0.6+rel*0.9, 0, 0)
    a.set('cloak', 0.25, -0.3, 0)

def l_bowSkill(a, t, c):
    w = clamp(t/0.55, 0, 1); draw, rel = pulse(w, 0, .55), pulse(w, .55, .75)
    a.set('torso', -0.12+rel*0.25, -0.5, 0)
    a.set('upperArmL', -1.5, 0, 0.6); a.set('lowerArmL', -0.05, 0, 0)
    a.set('upperArmR', -1.2-draw*0.5+rel*0.6, 0, -1.0-draw*0.5+rel*0.7)
    a.set('lowerArmR', -1.2-draw*0.9+rel*1.4, 0, 0)
    a.move('pelvis', 0, -0.06*draw, -0.12*draw)
    a.scale('heart', 1+draw*0.5)

def _punch(a, t, dur, right):
    w = clamp(t/dur, 0, 1)
    wind, hit, rec = pulse(w, 0, .28), pulse(w, .28, .5), pulse(w, .5, 1)
    ext = -1.2*wind + 2.3*hit - 1.0*rec
    tw = (-1 if right else 1)*(0.35*wind - 0.55*hit + 0.25*rec)
    a.set('torso', 0.14, tw, 0); a.set('pelvis', 0, tw*0.5, 0)
    if right:
        a.set('upperArmR', -0.2+ext*0.55, 0, -0.5-ext*0.25)
        a.set('lowerArmR', -1.3+ext*1.1, 0, 0)
        a.set('upperArmL', 0.3-ext*0.2, 0, 0.75); a.set('lowerArmL', -1.4, 0, 0)
    else:
        a.set('upperArmL', -0.2+ext*0.55, 0, 0.5+ext*0.25)
        a.set('lowerArmL', -1.3+ext*1.1, 0, 0)
        a.set('upperArmR', 0.3-ext*0.2, 0, -0.75); a.set('lowerArmR', -1.4, 0, 0)
    a.move('pelvis', 0, 0, 0.1*hit)
    a.set('cloak', 0.3+hit*0.3, tw*0.5, 0)

def l_gaunt1(a, t, c): _punch(a, t, 0.21, True)
def l_gaunt2(a, t, c): _punch(a, t, 0.21, False)

def l_gaunt4(a, t, c):
    w = clamp(t/0.44, 0, 1)
    wind, hit, rec = pulse(w, 0, .3), pulse(w, .3, .52), pulse(w, .52, 1)
    a.set('torso', 0.2-0.3*wind+0.5*hit-0.3*rec, 0, 0)
    a.set('upperArmR', -1.5*wind+2.2*hit-0.7*rec, 0, -0.4)
    a.set('upperArmL', -1.4*wind+2.0*hit-0.6*rec, 0, 0.4)
    a.set('lowerArmR', -0.9+hit*0.6, 0, 0); a.set('lowerArmL', -0.9+hit*0.6, 0, 0)
    a.move('pelvis', 0, -0.12*hit, 0.15*hit)
    a.set('cloak', 0.3+hit*0.8, 0, 0)

def l_gauntSkill(a, t, c):
    p = ease(t/0.4)
    a.set('torso', 0.45, 0, 0); a.set('head', -0.3, 0, 0)
    a.set('upperArmR', -0.3+p*1.2, 0, -0.9); a.set('lowerArmR', -0.5, 0, 0)
    a.set('upperArmL', -0.9, 0, 0.6); a.set('lowerArmL', -1.0, 0, 0)
    a.set('thighR', -0.4, 0, 0); a.set('thighL', 0.5, 0, 0)
    a.set('cloak', 1.1, 0, 0)

# ------------------------------------------------------------------ enemies
def _haslegs(names): return 'thighR' in names or 'thighL' in names

def f_idle(a, t, c):
    b = sin(t*1.9)*0.05
    a.set('torso', b, sin(t*0.6)*0.1, 0)
    a.set('head', -b*0.5, sin(t*0.45)*0.25, 0)
    a.move('pelvis', 0, sin(t*1.9)*0.02, 0)
    a.set('upperArmR', 0.05, 0, -0.2); a.set('upperArmL', 0.05, 0, 0.2)
    a.set('ring1', 0, t*0.8, 0); a.set('ring2', t*0.6, 0, 0)

def f_move(a, t, c):
    w = t*8; sw, sw2 = sin(w), sin(w+PI)
    a.set('torso', 0.12, sin(w*2)*0.06, 0)
    if c.get('legs'):
        a.move('pelvis', 0, abs(sin(w))*0.04, 0)
        a.set('thighR', sw*0.7, 0, 0); a.set('shinR', max(0, -sw)*0.8, 0, 0)
        a.set('thighL', sw2*0.7, 0, 0); a.set('shinL', max(0, -sw2)*0.8, 0, 0)
    else:
        a.move('pelvis', 0, sin(t*3)*0.09, 0)
    a.set('upperArmR', sw2*0.45, 0, -0.25); a.set('upperArmL', sw*0.45, 0, 0.25)
    a.set('ring1', 0, t*1.6, 0); a.set('ring2', t*1.2, 0, 0)

def f_tell(a, t, c):
    p = ease(t/max(0.12, c.get('tell', 0.5)))
    a.set('torso', -0.35*p, 0, 0); a.set('head', -0.2*p, 0, 0)
    a.move('pelvis', 0, -0.12*p, -0.1*p)
    a.set('upperArmR', -1.1*p, 0, -0.5-0.3*p); a.set('upperArmL', -1.0*p, 0, 0.5+0.3*p)
    a.set('lowerArmR', -0.8*p, 0, 0); a.set('lowerArmL', -0.8*p, 0, 0)
    if c.get('legs'):
        a.set('thighR', -0.3*p, 0, 0); a.set('thighL', 0.25*p, 0, 0)
    for i in range(4): a.set('shell%d' % i, -0.9*p, 0, 0)
    a.set('ring1', 0, t*5, 0); a.set('gun', -0.25*p, 0, 0)

def f_attack(a, t, c):
    w = clamp(t/0.35, 0, 1); hit, rec = pulse(w, 0, .35), pulse(w, .35, 1)
    a.set('torso', 0.45*hit-0.3*rec, 0, 0)
    a.set('upperArmR', 1.6*hit-0.9*rec, 0, -0.4)
    a.set('upperArmL', 1.4*hit-0.8*rec, 0, 0.4)
    a.set('lowerArmR', 0.5*hit, 0, 0)
    a.move('pelvis', 0, 0, 0.25*hit-0.2*rec)
    a.set('gun', 0.3*hit, 0, 0)
    for i in range(4): a.set('shell%d' % i, -1.5, 0, 0)
    a.set('ring1', 0, t*8, 0)

def f_hit(a, t, c):
    p = 1-ease(t/0.2)
    a.set('torso', -0.4*p, 0.25*p, 0); a.set('head', -0.35*p, 0, 0)
    a.move('pelvis', 0, 0, -0.1*p)

def f_death(a, t, c):
    p = ease(t/0.55)
    a.set('torso', 0.9*p, 0.5*p, 0.3*p); a.set('head', 0.8*p, 0, 0)
    a.move('pelvis', 0, -0.45*p, 0)
    if c.get('legs'):
        a.set('thighR', 1.0*p, 0, 0); a.set('thighL', 0.8*p, 0, 0)
    a.set('upperArmR', 1.0*p, 0, -0.8*p); a.set('upperArmL', 0.9*p, 0, 0.8*p)
    for i in range(4): a.set('shell%d' % i, -1.2*p, 0, 0)
    a.scale('core', 1-p*0.6)

# ------------------------------------------------------------------ boss
def _bidle(a, t, s):
    a.move('pelvis', 0, sin(t*1.1)*0.16, 0)
    a.set('torso', sin(t*0.9)*0.05, sin(t*0.4)*0.12, 0)
    a.set('ring1', 0, t*0.5*s, 0); a.set('ring2', t*0.42*s, 0, 0)
    a.set('ring3', 0, -t*0.35*s, t*0.2*s)
    a.scale('core', 1+sin(t*2.6)*0.08)
    for i in range(4):
        a.set('arm%d' % i, sin(t*0.8+i)*0.12, 0, cos(t*0.7+i)*0.1)
        a.set('forearm%d' % i, sin(t*0.9+i*1.3)*0.15, 0, 0)

def b_idle(a, t, c): _bidle(a, t, 1+c.get('phase', 0)*0.4)

def b_intro(a, t, c):
    p = ease(t/2.2)
    a.move('pelvis', 0, -6*(1-p)+sin(t*1.1)*0.16*p, 0)
    a.set('torso', -0.3*(1-p), t*1.4*(1-p), 0)
    a.set('ring1', 0, t*3*(1-p)+t*0.5, 0); a.set('ring2', t*2*(1-p), 0, 0)
    a.scale('core', 0.3+0.7*p+sin(t*6)*0.1*p)
    for i in range(4):
        a.set('arm%d' % i, -1.2*(1-p), 0, 0); a.set('forearm%d' % i, 1.0*(1-p), 0, 0)

def b_sweep(a, t, c):
    _bidle(a, t, 1)
    w = clamp(t/1.1, 0, 1); wind, fire, rec = pulse(w, 0, .4), pulse(w, .4, .62), pulse(w, .62, 1)
    a.set('torso', -0.25*wind+0.35*fire-0.15*rec, 0, 0)
    for i in range(4):
        a.set('arm%d' % i, -1.0*wind+1.5*fire-0.5*rec, 0, (1 if i % 2 else -1)*(0.5*fire))
        a.set('forearm%d' % i, 0.8*wind-1.0*fire, 0, 0)
    a.scale('core', 1+wind*0.35+fire*0.2)

def b_slam(a, t, c):
    _bidle(a, t, 1)
    w = clamp(t/1.3, 0, 1); up, dn, rec = pulse(w, 0, .45), pulse(w, .45, .58), pulse(w, .58, 1)
    a.move('pelvis', 0, 1.4*up-2.0*dn+0.6*rec, 0)
    for i in range(4):
        a.set('arm%d' % i, -1.6*up+2.4*dn-0.8*rec, 0, 0)
        a.set('forearm%d' % i, -0.9*up+1.3*dn, 0, 0)
    a.set('torso', -0.4*up+0.6*dn-0.2*rec, 0, 0)

def b_dash(a, t, c):
    a.set('torso', 0.35, sin(t*8)*0.2, 0)
    a.move('pelvis', 0, 0.3+sin(t*9)*0.1, 0)
    a.set('ring1', 0, t*4, 0); a.set('ring2', t*3, 0, 0)
    for i in range(4):
        a.set('arm%d' % i, -0.9, 0, 0); a.set('forearm%d' % i, -0.6, 0, 0)
    a.scale('core', 1.15+sin(t*12)*0.1)

def b_spin(a, t, c):
    a.set('torso', 0, t*4.5, 0)
    a.move('pelvis', 0, 0.5+sin(t*2)*0.2, 0)
    a.set('ring1', 0, t*6, 0); a.set('ring2', t*5, 0, 0); a.set('ring3', 0, -t*4, 0)
    for i in range(4):
        a.set('arm%d' % i, 0.2, 0, (1 if i % 2 else -1)*1.1); a.set('forearm%d' % i, -0.3, 0, 0)
    a.scale('core', 1.2+sin(t*9)*0.15)

def b_phase(a, t, c):
    p = ease(t/1.6)
    a.move('pelvis', 0, 1.2*sin(p*PI), 0)
    a.set('torso', -0.5*sin(p*PI), t*5, 0)
    a.set('ring1', 0, t*9, 0); a.set('ring2', t*7, 0, 0); a.set('ring3', 0, -t*6, 0)
    a.scale('core', 1+sin(p*PI)*0.9)
    for i in range(4): a.set('arm%d' % i, -1.5*sin(p*PI), 0, 0)

def b_hit(a, t, c):
    _bidle(a, t, 1)
    p = 1-ease(t/0.22)
    a.set('torso', -0.18*p, 0.14*p, 0); a.scale('core', 1+p*0.25)

def b_groggy(a, t, c):
    p = ease(t/0.5)
    a.move('pelvis', 0, -0.9*p+sin(t*2)*0.05, 0)
    a.set('torso', 0.45*p, sin(t*1.2)*0.25, 0)
    a.set('ring1', 0, t*0.15, 0); a.set('ring2', t*0.1, 0, 0)
    a.scale('core', 1.25+sin(t*3)*0.1)
    for i in range(4):
        a.set('arm%d' % i, 0.9*p, 0, 0); a.set('forearm%d' % i, 0.7*p, 0, 0)

def b_death(a, t, c):
    p = ease(t/3.0)
    a.move('pelvis', 0, -1.6*p, 0)
    a.set('torso', 0.6*p, t*(1-p)*3, 0.3*p)
    a.set('ring1', 0, t*2*(1-p), 0); a.set('ring2', t*1.5*(1-p), 0, 0)
    a.scale('core', 1+sin(t*8)*0.3*(1-p)-p*0.7)
    for i in range(4):
        a.set('arm%d' % i, 1.2*p, 0, (1 if i % 2 else -1)*0.8*p)
        a.set('forearm%d' % i, 0.9*p, 0, 0)

# name -> (fn, duration, frame count, loops)
PLAYER = {
    'idle':   (l_idle, 2.856, 4, True),
    'run':    (l_run, 0.661, 6, True),
    'dash':   (l_dash, 0.22, 3, False),
    'hit':    (l_hit, 0.26, 2, False),
    'death':  (l_death, 0.90, 6, False),
    'revive': (l_revive, 1.00, 4, False),
}
WEAPON_CLIPS = {
    'riftsword':  {'atk1': (l_sword1, 0.35, 4, False), 'atk2': (l_sword2, 0.34, 4, False),
                   'atk3': (l_sword3, 0.56, 5, False), 'skill': (l_swordSkill, 0.50, 5, False)},
    'pulsebow':   {'atk1': (l_bowShoot, 0.30, 4, False), 'atk2': (l_bowShoot, 0.30, 4, False),
                   'atk3': (l_bowShoot, 0.30, 4, False), 'skill': (l_bowSkill, 0.55, 5, False)},
    'chaingaunt': {'atk1': (l_gaunt1, 0.21, 4, False), 'atk2': (l_gaunt2, 0.21, 4, False),
                   'atk3': (l_gaunt4, 0.44, 5, False), 'skill': (l_gauntSkill, 0.40, 5, False)},
}
ENEMY = {
    'idle':   (f_idle, 3.307, 4, True),
    'move':   (f_move, 0.785, 6, True),
    'tell':   (f_tell, 0.50, 3, False),
    'attack': (f_attack, 0.35, 4, False),
    'hit':    (f_hit, 0.20, 2, False),
    'death':  (f_death, 0.55, 4, False),
}
BOSS_DIR = {          # rendered in 5 directions (mirrored to 8 at runtime)
    'idle':   (b_idle, 5.712, 5, True),
    'sweep':  (b_sweep, 1.10, 5, False),
    'slam':   (b_slam, 1.30, 5, False),
    'dash':   (b_dash, 0.50, 4, True),
    'spin':   (b_spin, 1.00, 5, True),
    'hit':    (b_hit, 0.22, 2, False),
    'groggy': (b_groggy, 0.50, 3, False),
}
BOSS_FLAT = {         # single facing (front) - cinematic states
    'intro':  (b_intro, 2.20, 8, False),
    'phase':  (b_phase, 1.60, 5, False),
    'death':  (b_death, 3.00, 8, False),
}
