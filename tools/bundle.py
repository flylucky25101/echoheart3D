#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fold the whole game into one self-contained .html file.

Two outputs, because they have different constraints:

  dist/echoheart.html   standalone page - open it from disk or serve it anywhere
  dist/artifact.html    body fragment only, for hosts that supply their own
                        <html>/<head> skeleton

The baked sprite sheets are dropped by default (--with-sprites keeps them).
They are 3.86MB of the 5.3MB total, and since scenery instancing brought the
real-time 3D path down to the same draw-call cost, the sprite path is now just
an alternative look rather than the fast one. With the sheets absent
Game.spriteFor finds no EH.SpriteImported and falls through to 3D on its own,
so nothing needs to be stubbed out.

Run: python3 tools/bundle.py [--with-sprites]
"""
import os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "dist")

SPRITE_ONLY = ("scripts/sprite-embedded.js", "scripts/sprite-imported.js")


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def guard(rel, src):
    """Keep one bad file from taking down the rest of the bundle.

    Separate <script> tags fail independently; concatenating them into one tag
    would mean a syntax error anywhere kills every script after it. Wrapping each
    in its own tag preserves that isolation.
    """
    # '</script>' inside a string literal would close the tag early
    return src.replace("</script>", "<\\/script>")


def build(with_sprites):
    html = read("index.html")

    # NOTE: every re.sub below takes a lambda, never a plain replacement string.
    # re.sub processes backslash escapes in the replacement, so passing source
    # code directly turns every '\n' in a JS string literal into a real newline -
    # which silently produced a bundle whose shaders were unterminated strings.
    css = read("styles/game.css")
    html = re.sub(r'<link rel="stylesheet" href="styles/game\.css">',
                  lambda _m: "<style>\n" + css + "\n</style>", html)

    scripts = re.findall(r'<script src="([^"]+)" defer></script>', html)
    kept, dropped = [], []
    for s in scripts:
        if not with_sprites and s in SPRITE_ONLY:
            dropped.append(s)
            continue
        kept.append(s)

    blocks = []
    for s in kept:
        blocks.append("<script>/* %s */\n%s\n</script>" % (s, guard(s, read(s))))
    inlined = "\n".join(blocks)

    # replace the whole run of script tags with the inlined ones
    html = re.sub(r'(<script src="[^"]+" defer></script>\s*)+',
                  lambda _m: inlined + "\n", html)

    os.makedirs(OUT, exist_ok=True)
    full = os.path.join(OUT, "echoheart.html")
    with open(full, "w", encoding="utf-8") as f:
        f.write(html)

    # body-only variant for hosts that wrap content in their own page skeleton
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    head_extra = (
        '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;'
        'background:#05070a}</style>\n'
    )
    frag = os.path.join(OUT, "artifact.html")
    with open(frag, "w", encoding="utf-8") as f:
        f.write(head_extra + body)

    bad = verify(full, kept)

    for p, label in ((full, "standalone"), (frag, "fragment")):
        sys.stderr.write("  %-11s %-22s %.2fMB\n"
                         % (label, os.path.basename(p), os.path.getsize(p) / 1e6))
    if dropped:
        sys.stderr.write("  제외: %s\n" % ", ".join(dropped))
    sys.stderr.write("  인라인 스크립트 %d개, 파싱 실패 %d개\n" % (len(kept), bad))
    if bad:
        sys.exit(1)


def verify(path, expected):
    """Re-parse every inlined block with node.

    Inlining is string surgery on source code, so it can produce a file that is
    still valid HTML while containing broken JavaScript - which is exactly what
    happened once. Checking here means a corrupt bundle fails the build instead
    of failing in the player's browser.
    """
    import json, subprocess, tempfile
    html = open(path, encoding="utf-8").read()
    blocks = re.findall(r"<script>/\* ([^*]+) \*/\n(.*?)\n</script>", html, re.S)
    names = [n for n, _ in blocks]
    if names != expected:
        sys.stderr.write("  순서/개수 불일치: %d vs %d\n" % (len(names), len(expected)))
        return 1
    bad = 0
    tmp = tempfile.mkdtemp()
    js = os.path.join(tmp, "chunk.js")
    for name, src in blocks:
        with open(js, "w", encoding="utf-8") as f:
            f.write(src.replace("<\\/script>", "</script>"))
        r = subprocess.run(["node", "--check", js], capture_output=True)
        if r.returncode:
            bad += 1
            sys.stderr.write("  파싱 실패 %s: %s\n"
                             % (name, r.stderr.decode(errors="replace").strip().split("\n")[1][:90]))
    for el in ("gl", "hud", "overlay", "toast", "joyBase", "btnAttack", "btnUlt"):
        if ('id="%s"' % el) not in html:
            sys.stderr.write("  DOM 누락: #%s\n" % el)
            bad += 1
    return bad


if __name__ == "__main__":
    build("--with-sprites" in sys.argv)
