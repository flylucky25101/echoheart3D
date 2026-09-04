'use strict';
// Screen flow: title -> hub -> run -> rewards -> death/victory -> hub.
(function () {
  var EH = window.EchoHeart;
  var UI = null, G = null;
  var el = null;
  var S = EH.Scenes = {};

  S.init = function (game) { G = game; UI = EH.UI; el = UI.el_; };

  function save() { return EH.Save.data; }
  function kv(parent, k, v) {
    var d = el('div', 'kv'); d.appendChild(el('span', '', k)); d.appendChild(el('b', '', String(v)));
    parent.appendChild(d); return d;
  }

  // ---------------- loading ----------------
  S.goLoading = function () {
    var p = UI.screen('loading');
    p.appendChild(el('h1', 'title', 'ECHOHEART'));
    p.appendChild(el('h2', 'sub', '아르카의 마지막 밤'));
    var bar = el('div', 'load-bar'); var fill = el('div', 'fill');
    bar.appendChild(fill); p.appendChild(bar);
    var txt = el('p', 'small', '자산을 불러오는 중...');
    txt.style.textAlign = 'center'; p.appendChild(txt);
    S._loadFill = fill; S._loadTxt = txt;
  };
  S.loadProgress = function (done, total) {
    if (S._loadFill) S._loadFill.style.width = (done / Math.max(1, total) * 100) + '%';
    if (S._loadTxt) S._loadTxt.textContent = '자산 ' + done + ' / ' + total + ' 준비됨';
  };

  // ---------------- title ----------------
  S.goTitle = function () {
    G.mode = 'title'; UI.showHUD(false);
    var p = UI.screen('title');
    p.appendChild(el('h1', 'title', 'ECHOHEART'));
    p.appendChild(el('h2', 'sub', '아르카의 마지막 밤'));
    var s = save();
    var stat = el('p', 'small', '');
    stat.style.textAlign = 'center'; stat.style.marginTop = '14px';
    stat.innerHTML = '잔향 결정 <b style="color:var(--cyan)">' + s.crystals + '</b> · 사망 ' + s.deaths + ' · 승리 ' + s.wins;
    p.appendChild(stat);
    var hasRun = !!s.run;
    UI.row(p, [
      UI.button(hasRun ? '이어하기 (진행 중인 런)' : '새 게임', 'primary', function () {
        if (hasRun) S.resumeRun(); else S.goHub();
      }),
      hasRun ? UI.button('새 런 시작', '', function () { S.confirmNew(); }) : null,
      UI.button('설정', '', function () { S.goSettings('title'); }),
      UI.button('저장 관리', '', function () { S.goSaveManage('title'); })
    ]);
    var tip = el('p', 'small', '이동 WASD / 방향키 · 공격 J 또는 마우스 좌클릭 · 대시 K/Shift · 스킬 L 또는 우클릭 · 궁극기 Space · 일시정지 Esc<br>모바일: 왼쪽 화면을 눌러 조이스틱, 오른쪽 버튼으로 전투');
    tip.style.textAlign = 'center'; tip.style.marginTop = '18px';
    p.appendChild(tip);
  };

  S.confirmNew = function () {
    var p = UI.screen('confirmNew');
    p.appendChild(el('h3', '', '새 런을 시작할까요?'));
    p.appendChild(el('p', 'small', '진행 중이던 런은 사라집니다. 잔향 결정과 영구 성장은 그대로 유지됩니다.'));
    UI.row(p, [
      UI.button('새 런 시작', 'danger', function () { save().run = null; EH.Save.save(); S.goHub(); }),
      UI.button('취소', '', function () { S.goTitle(); })
    ]);
  };

  // ---------------- settings ----------------
  S.goSettings = function (back) {
    var p = UI.screen('settings');
    p.appendChild(el('h3', '', '설정'));
    var sl = [
      ['masterVol', '전체 음량'], ['sfxVol', '효과음'], ['musicVol', '배경음'],
      ['screenShake', '화면 흔들림'], ['buttonScale', '모바일 버튼 크기'],
      ['joystickSens', '조이스틱 감도'], ['autoAim', '자동 조준 강도'],
      ['spriteMode', '스프라이트 모드 (0=실시간 3D, 1=구운 스프라이트)']
    ];
    sl.forEach(function (o) {
      var r = el('div', 'set-row');
      r.appendChild(el('span', '', o[1]));
      var range = EH.Save.SETTING_RANGE[o[0]];
      var inp = document.createElement('input');
      inp.type = 'range'; inp.min = range[0]; inp.max = range[1]; inp.step = 0.05;
      inp.value = EH.Settings.get(o[0]);
      var val = el('span', '', (+inp.value).toFixed(2));
      val.style.minWidth = '42px'; val.style.textAlign = 'right'; val.style.color = 'var(--cyan)';
      inp.addEventListener('input', function () {
        EH.Settings.set(o[0], parseFloat(inp.value));
        val.textContent = parseFloat(inp.value).toFixed(2);
        EH.Audio.applyVolumes();
        if (o[0] === 'buttonScale') G.applyButtonScale();
      });
      r.appendChild(inp); r.appendChild(val); p.appendChild(r);
    });
    var tg = [
      ['vibration', '진동'], ['damageNumbers', '피해 숫자'], ['reduceMotion', '모션 감소'],
      ['showFps', 'FPS 표시 (성능 확인용)'],
      ['bloom', '발광 번짐 (블룸)'],
      ['lowSpec', '저사양 모드'], ['tutorial', '튜토리얼 안내']
    ];
    tg.forEach(function (o) {
      var r = el('div', 'set-row');
      r.appendChild(el('span', '', o[1]));
      var sw = el('div', 'switch' + (EH.Settings.get(o[0]) ? ' on' : ''));
      sw.addEventListener('click', function () {
        var v = !EH.Settings.get(o[0]);
        EH.Settings.set(o[0], v);
        sw.classList.toggle('on', v);
        EH.Audio.play('menuSelect');
        if (o[0] === 'lowSpec') G.applyLowSpec();
        if (o[0] === 'bloom' && G.applyBloom) G.applyBloom();
      });
      r.appendChild(sw); p.appendChild(r);
    });
    UI.row(p, [
      UI.button('튜토리얼 다시 보기', '', function () {
        save().tutorialSeen = false; EH.Save.save(); UI.toast('다음 런에서 안내가 다시 표시됩니다.');
      }),
      UI.button('돌아가기', 'primary', function () {
        if (back === 'pause') S.goPause(); else if (back === 'hub') S.goHub(); else S.goTitle();
      })
    ]);
  };

  // ---------------- save manage ----------------
  S.goSaveManage = function (back) {
    var p = UI.screen('saveManage');
    p.appendChild(el('h3', '', '저장 관리'));
    if (!EH.Save.storageOk) {
      var w = el('p', 'small', '⚠ 이 환경에서는 localStorage를 사용할 수 없어 메모리에만 저장됩니다. 아래 코드를 복사해 두면 진행 상황을 보존할 수 있습니다.');
      w.style.color = 'var(--amber)'; p.appendChild(w);
    }
    p.appendChild(el('p', 'small', '저장 코드를 복사해 보관하거나, 다른 기기에서 붙여넣어 불러올 수 있습니다.'));
    var ta = el('textarea', 'save-box');
    ta.value = EH.Save.exportString();
    p.appendChild(ta);
    UI.row(p, [
      UI.button('저장 내보내기(코드 갱신)', '', function () { ta.value = EH.Save.exportString(); UI.toast('저장 코드를 갱신했습니다.'); }),
      UI.button('저장 불러오기', '', function () {
        var r = EH.Save.importString(ta.value);
        UI.toast(r.msg);
        if (r.ok) { G.applyLowSpec(); EH.Audio.applyVolumes(); S.goTitle(); }
      }),
      UI.button('저장 초기화', 'danger', function () { S.confirmReset(back); }),
      UI.button('돌아가기', 'primary', function () { back === 'hub' ? S.goHub() : S.goTitle(); })
    ]);
  };
  S.confirmReset = function (back) {
    var p = UI.screen('reset1');
    p.appendChild(el('h3', '', '정말 초기화할까요?'));
    p.appendChild(el('p', 'small', '잔향 결정, 영구 성장, 사망 적응, 기록이 모두 사라집니다.'));
    UI.row(p, [
      UI.button('계속', 'danger', function () {
        var p2 = UI.screen('reset2');
        p2.appendChild(el('h3', '', '마지막 확인'));
        p2.appendChild(el('p', 'small', '이 작업은 되돌릴 수 없습니다. 정말 모든 기록을 삭제할까요?'));
        UI.row(p2, [
          UI.button('모두 삭제', 'danger', function () {
            EH.Save.reset(); G.applyLowSpec(); EH.Audio.applyVolumes();
            UI.toast('저장을 초기화했습니다.'); S.goTitle();
          }),
          UI.button('취소', 'primary', function () { S.goSaveManage(back); })
        ]);
      }),
      UI.button('취소', 'primary', function () { S.goSaveManage(back); })
    ]);
  };

  // ---------------- hub (3D space; panels open on device interaction) ----------------
  S.goHub = function () {
    G.enterHub();
    UI.close();
    UI.showHUD(false);
    var s = save();
    var line = EH.HUB_LINES[Math.min(EH.HUB_LINES.length - 1,
      (s.deaths + s.wins) % EH.HUB_LINES.length)];
    UI.hint(line, 4200);
  };
  S.hubPanel = function (kind) {
    if (kind === 'weapon') S.goWeapon();
    else if (kind === 'growth') S.goGrowth();
    else if (kind === 'adapt') S.goAdapt();
    else if (kind === 'abyss') S.goAbyss();
    else if (kind === 'records') S.goRecords();
    else if (kind === 'settings') S.goSettings('hub');
    else if (kind === 'portal') S.startRun();
  };

  S.goWeapon = function () {
    var p = UI.screen('weapon');
    p.appendChild(el('h3', '', '무기 선택'));
    var g = el('div', 'grid g3');
    EH.WEAPON_ORDER.forEach(function (id) {
      var w = EH.WEAPONS[id];
      var c = el('div', 'card' + (save().weapon === id ? ' rar-rare' : ''));
      var head = el('div', 'chead');
      head.appendChild(el('div', 'icon', '')).setAttribute('style', UI.iconStyle(w.icon));
      var t = el('div', '');
      t.appendChild(el('div', 'cname', w.name));
      t.appendChild(el('span', 'ctag', save().weapon === id ? '선택됨' : '선택 가능'));
      head.appendChild(t); c.appendChild(head);
      c.appendChild(el('div', 'cdesc', w.desc));
      // matchup: every weapon has exactly 2 strong / 2 weak enemy types and the
      // three columns sum to the same total, so this is preference, not power.
      var strong = [], weak = [];
      EH.ENEMY_ORDER.forEach(function (k) {
        var r = (EH.ENEMIES[k].resist || {})[w.dmgType];
        if (r > 1.12) strong.push(EH.ENEMIES[k].name);
        else if (r < 0.88) weak.push(EH.ENEMIES[k].name);
      });
      var mt = el('div', 'cmatch');
      mt.appendChild(el('span', 'mtype', (EH.DMG_TYPE_NAME[w.dmgType] || '') + ' 속성'));
      mt.appendChild(el('span', 'mgood', '강함 ' + strong.join('·')));
      mt.appendChild(el('span', 'mbad', '약함 ' + weak.join('·')));
      c.appendChild(mt);
      c.appendChild(el('div', 'cmeta', '스킬: ' + w.skill.name + ' · 궁극기: ' + w.ult.name));
      c.addEventListener('click', function () {
        save().weapon = id; EH.Save.save();
        EH.Audio.play('menuSelect');
        G.setHubWeapon(id);
        S.goWeapon();
      });
      g.appendChild(c);
    });
    p.appendChild(g);
    UI.row(p, [UI.button('닫기', 'primary', function () { UI.close(); })]);
  };

  S.goGrowth = function () {
    var s = save();
    var p = UI.screen('growth');
    p.appendChild(el('h3', '', '영구 성장 — 잔향 결정 ' + s.crystals));
    var g = el('div', 'grid g3');
    EH.META.forEach(function (m) {
      g.appendChild(UI.metaCard(m, s, function () {
        var r = EH.Prog.buyMeta(s, m.id);
        UI.toast(r.msg);
        if (r.ok) { EH.Audio.play('metaUpgrade'); EH.Save.save(); S.goGrowth(); }
      }));
    });
    p.appendChild(g);
    UI.row(p, [UI.button('닫기', 'primary', function () { UI.close(); })]);
  };

  S.goAdapt = function () {
    var s = save();
    var p = UI.screen('adapt');
    p.appendChild(el('h3', '', '사망 적응 기록'));
    p.appendChild(el('p', 'small', '잔향심장은 죽음의 원인을 기억합니다. 같은 방식으로 죽을수록 그 피해에 강해집니다.'));
    var sep = el('div', 'sep'); p.appendChild(sep);
    for (var k in EH.ADAPT) {
      var a = EH.ADAPT[k], lv = s.adapt[k] || 0;
      var pct = a.kind === 'boss' ? (lv * a.per * 100).toFixed(0) + '% 피해 증가'
        : (lv * a.per * 100).toFixed(0) + '% 피해 감소';
      kv(p, a.name + ' 적응  (' + lv + ' / ' + a.max + ')', lv > 0 ? pct : '없음');
    }
    UI.row(p, [UI.button('닫기', 'primary', function () { UI.close(); })]);
  };

  S.goAbyss = function () {
    var s = save();
    var p = UI.screen('abyss');
    p.appendChild(el('h3', '', '심연 단계'));
    if (!s.unlocks.abyss) {
      p.appendChild(el('p', 'small', '크로노보어를 한 번 쓰러뜨리면 심연 단계가 열립니다. 적이 강해지는 대신 잔향 결정을 더 많이 얻습니다.'));
    } else {
      p.appendChild(el('p', 'small', '심연 단계를 올리면 적의 체력과 피해가 증가하고, 잔향 결정 획득량이 늘어납니다. 최고 기록: ' + s.bestAbyss));
      var g = el('div', 'grid g3');
      for (var i = 0; i <= Math.min(10, s.bestAbyss + 1); i++) {
        (function (lv) {
          var m = EH.Prog.abyssMul(lv);
          var c = el('div', 'card' + (s.abyss === lv ? ' rar-rare' : ''));
          c.appendChild(el('div', 'cname', lv === 0 ? '기본' : '심연 ' + lv));
          c.appendChild(el('div', 'cdesc', '적 체력 x' + m.hp.toFixed(2) + ' · 적 피해 x' + m.dmg.toFixed(2)));
          c.appendChild(el('div', 'cmeta', '결정 획득 x' + m.reward.toFixed(2)));
          c.addEventListener('click', function () {
            s.abyss = lv; EH.Save.save(); EH.Audio.play('menuSelect'); S.goAbyss();
          });
          g.appendChild(c);
        })(i);
      }
      p.appendChild(g);
    }
    UI.row(p, [UI.button('닫기', 'primary', function () { UI.close(); })]);
  };

  S.goRecords = function () {
    var s = save();
    var p = UI.screen('records');
    p.appendChild(el('h3', '', '기록 홀로그램'));
    kv(p, '잔향 결정', s.crystals);
    kv(p, '총 사망', s.deaths);
    kv(p, '총 승리', s.wins);
    kv(p, '최고 도달 방', s.bestRoom);
    kv(p, '최고 심연 단계', s.bestAbyss);
    var most = 'riftsword', mv = -1;
    EH.WEAPON_ORDER.forEach(function (w) { if ((s.weaponUse[w] || 0) > mv) { mv = s.weaponUse[w] || 0; most = w; } });
    kv(p, '가장 많이 사용한 무기', EH.WEAPONS[most].name + ' (' + mv + '회)');
    kv(p, '최고 콤보', s.bestCombo);
    kv(p, '최단 클리어 시간', s.bestTime > 0 ? (s.bestTime.toFixed(1) + '초') : '기록 없음');
    kv(p, '총 처치 수', s.totalKills);
    UI.row(p, [UI.button('닫기', 'primary', function () { UI.close(); })]);
  };

  // ---------------- run ----------------
  S.startRun = function () {
    G.startRun();
    UI.close(); UI.showHUD(true);
  };
  S.resumeRun = function () {
    G.resumeRun();
    UI.close(); UI.showHUD(true);
  };

  // reward: pick 1 of 3 echoes
  S.goReward = function (opts) {
    var run = G.run;
    var p = UI.screen('reward');
    p.appendChild(el('h3', '', '잔향 선택'));
    if (!save().hints.echo) {
      save().hints.echo = 1; EH.Save.save();
      var ex = el('p', 'small', '잔향은 이번 런에만 적용되는 강화입니다. 같은 계열(잿불·폭풍·공허)을 ' +
        '3개 모으면 시너지가 열립니다. 런이 끝나면 사라지지만, 잔향 결정은 영구히 남습니다.');
      ex.style.textAlign = 'center'; ex.style.marginBottom = '10px';
      p.appendChild(ex);
    }
    var syn = EH.Prog.familyCounts(run.echoes);
    var sy = el('p', 'small', '시너지 진행: ' +
      ['ember', 'storm', 'void'].map(function (f) {
        return UI.famName(f) + ' ' + syn[f] + '/' + EH.SYNERGY[f].need + (syn[f] >= EH.SYNERGY[f].need ? ' ✔' : '');
      }).join('  ·  '));
    sy.style.textAlign = 'center'; p.appendChild(sy);
    var g = el('div', 'grid g3');
    var rareBonus = (run.roomsCleared === 0 ? (G.stats.firstRareChance || 0) : 0) + (run.nextRareBonus || 0);
    var offers = opts && opts.offers ? opts.offers : EH.Prog.offerEchoes(run.rng, run.echoes, 3, rareBonus);
    run._offers = offers;
    offers.forEach(function (e) {
      g.appendChild(UI.echoCard(e, run.echoes[e.id] || 0, function (echo) {
        run.echoes[echo.id] = (run.echoes[echo.id] || 0) + 1;
        run.nextRareBonus = 0;
        G.refreshStats();
        S.afterReward();
      }));
    });
    p.appendChild(g);
    var btns = [];
    if ((run.rerollsLeft || 0) > 0) {
      btns.push(UI.button('새로고침 (' + run.rerollsLeft + '회 남음)', '', function () {
        run.rerollsLeft--;
        S.goReward({ offers: EH.Prog.offerEchoes(run.rng, run.echoes, 3, rareBonus) });
      }));
    }
    if (offers.length === 0) {
      p.appendChild(el('p', 'small', '더 이상 획득할 수 있는 잔향이 없습니다.'));
      btns.push(UI.button('계속', 'primary', function () { S.afterReward(); }));
    }
    if (btns.length) UI.row(p, btns);
  };
  S.afterReward = function () {
    var run = G.run;
    if (run.roomIndex + 1 >= EH.Rooms.TOTAL) { S.goNextRoom(['boss']); return; }
    var choices = EH.Rooms.nextChoices(run.rng, {
      roomIndex: run.roomIndex, path: run.path, hpFrac: G.world.player.hp / G.world.player.maxHp
    });
    S.goNextRoom(choices);
  };

  S.goNextRoom = function (choices) {
    var p = UI.screen('nextRoom');
    p.appendChild(el('h3', '', '다음 경로 선택'));
    var g = el('div', 'grid g2');
    choices.forEach(function (t) {
      var rt = EH.ROOM_TYPES[t];
      var c = el('div', 'card');
      var head = el('div', 'chead');
      head.appendChild(el('div', 'icon', '')).setAttribute('style', UI.iconStyle(rt.icon));
      var tt = el('div', '');
      tt.appendChild(el('div', 'cname', rt.name));
      tt.appendChild(el('span', 'ctag', '위험도 ' + '★'.repeat(Math.max(1, rt.danger)) ));
      head.appendChild(tt); c.appendChild(head);
      c.appendChild(el('div', 'cdesc', roomDesc(t)));
      c.appendChild(el('div', 'cmeta', '보상: ' + rewardName(rt.reward)));
      c.addEventListener('click', function () { EH.Audio.play('menuSelect'); G.enterRoom(t); });
      g.appendChild(c);
    });
    p.appendChild(g);
  };
  function roomDesc(t) {
    return {
      combat: '모든 적을 처치하면 잔향을 얻습니다.',
      elite: '강화된 적이 등장합니다. 높은 등급의 잔향을 노릴 수 있습니다.',
      heal: '체력을 회복하거나 생명 코어를 되살립니다.',
      shop: '시간 파편으로 회복과 강화를 구매합니다.',
      altar: '위험을 감수하고 더 큰 힘을 얻습니다.',
      boss: '시간을 집어삼키는 크로노보어와 마주합니다.'
    }[t] || '';
  }
  function rewardName(r) {
    return { echo: '잔향', 'echo+': '고급 잔향', heal: '회복', shop: '상점', altar: '제단', victory: '승리' }[r] || r;
  }

  // ---------------- special rooms ----------------
  S.goHeal = function () {
    var p = UI.screen('heal', { clear: false });
    var pl = G.world.player;
    p.appendChild(el('h3', '', '회복실'));
    var g = el('div', 'grid g2');
    var healAmt = Math.round(pl.maxHp * 0.45);
    var c1 = el('div', 'card');
    c1.appendChild(el('div', 'cname', '체력 회복'));
    c1.appendChild(el('div', 'cdesc', '체력을 ' + healAmt + ' 회복합니다.'));
    c1.addEventListener('click', function () {
      pl.hp = Math.min(pl.maxHp, pl.hp + healAmt);
      EH.Audio.play('echoPick'); G.completeSpecialRoom();
    });
    g.appendChild(c1);
    var canCore = pl.cores < pl.maxCores;
    var c2 = el('div', 'card' + (canCore ? '' : ' maxed'));
    c2.appendChild(el('div', 'cname', '생명 코어 복구'));
    c2.appendChild(el('div', 'cdesc', canCore ? '소모한 생명 코어 1개를 되살립니다.' : '생명 코어가 이미 가득합니다.'));
    if (canCore) c2.addEventListener('click', function () {
      pl.cores++; EH.Audio.play('revive'); G.completeSpecialRoom();
    });
    g.appendChild(c2);
    p.appendChild(g);
  };

  S.goShop = function () {
    var run = G.run, pl = G.world.player;
    var p = UI.screen('shop');
    p.appendChild(el('h3', '', '상점 — 시간 파편 ' + run.shards));
    var items = [
      { n: '응급 회복', d: '체력 40 회복', c: 30, f: function () { pl.hp = Math.min(pl.maxHp, pl.hp + 40); } },
      { n: '완전 회복', d: '체력을 모두 회복', c: 70, f: function () { pl.hp = pl.maxHp; } },
      { n: '임시 강화', d: '이번 런 동안 피해 +12%', c: 55, f: function () { run.echoes['neu_dmg'] = Math.min(5, (run.echoes['neu_dmg'] || 0) + 1); G.refreshStats(); } },
      { n: '잔향 구매', d: '무작위 잔향 1개 즉시 획득', c: 80, f: function () { S.grantRandomEcho(); } },
      { n: '생명 코어 복구', d: '생명 코어 1개 복구', c: 110, f: function () { pl.cores = Math.min(pl.maxCores, pl.cores + 1); } }
    ];
    var g = el('div', 'grid g2');
    items.forEach(function (it) {
      var afford = run.shards >= it.c;
      var canUse = !(it.n === '생명 코어 복구' && pl.cores >= pl.maxCores);
      var c = el('div', 'card' + (afford && canUse ? '' : ' maxed'));
      c.appendChild(el('div', 'cname', it.n));
      c.appendChild(el('div', 'cdesc', it.d));
      c.appendChild(el('div', 'cmeta', it.c + ' 파편' + (afford ? '' : ' — 부족')));
      if (afford && canUse) c.addEventListener('click', function () {
        run.shards -= it.c; it.f(); EH.Audio.play('metaUpgrade');
        S.goShop();
      });
      g.appendChild(c);
    });
    p.appendChild(g);
    UI.row(p, [UI.button('상점을 떠난다', 'primary', function () { G.completeSpecialRoom(); })]);
  };
  S.grantRandomEcho = function () {
    var run = G.run;
    var offers = EH.Prog.offerEchoes(run.rng, run.echoes, 1, 0.4);
    if (!offers.length) { UI.toast('더 얻을 수 있는 잔향이 없습니다.'); return; }
    run.echoes[offers[0].id] = (run.echoes[offers[0].id] || 0) + 1;
    G.refreshStats();
    UI.toast(offers[0].name + ' 획득!');
  };

  S.goAltar = function () {
    var run = G.run, pl = G.world.player;
    var p = UI.screen('altar');
    p.appendChild(el('h3', '', '기억의 제단'));
    p.appendChild(el('p', 'small', '대가를 치르고 힘을 얻습니다. 하나만 선택할 수 있습니다.'));
    var opts = [
      { n: '깎여나간 그릇', d: '최대 체력 15 감소 · 공격력 18% 증가',
        f: function () { run.altarHpPenalty = (run.altarHpPenalty || 0) + 15; run.altarDmg = (run.altarDmg || 0) + 0.18; G.refreshStats(); } },
      { n: '피의 대가', d: '현재 체력 25% 소모 · 다음 잔향 희귀도 증가',
        f: function () { pl.hp = Math.max(1, pl.hp * 0.75); run.nextRareBonus = 0.6; } },
      { n: '들끓는 밤', d: '다음 방의 적 강화 · 잔향 결정 추가 획득',
        f: function () { run.nextRoomHard = true; run.bonusCrystals = (run.bonusCrystals || 0) + 30; } },
      { n: '심장의 조각', d: '생명 코어 1개 소모 · 영웅 잔향 즉시 획득',
        f: function () { pl.cores--; S.grantEpic(); }, need: function () { return pl.cores > 0; } }
    ];
    var g = el('div', 'grid g2');
    opts.forEach(function (o) {
      var ok = !o.need || o.need();
      var c = el('div', 'card' + (ok ? '' : ' maxed'));
      c.appendChild(el('div', 'cname', o.n));
      c.appendChild(el('div', 'cdesc', o.d));
      if (ok) c.addEventListener('click', function () {
        o.f(); EH.Audio.play('echoPick'); G.completeSpecialRoom();
      });
      g.appendChild(c);
    });
    p.appendChild(g);
    UI.row(p, [UI.button('아무것도 취하지 않는다', '', function () { G.completeSpecialRoom(); })]);
  };
  S.grantEpic = function () {
    var run = G.run;
    var pool = EH.ECHOES.filter(function (e) { return e.rar === 'epic' && (run.echoes[e.id] || 0) < e.max; });
    if (!pool.length) pool = EH.Prog.available(run.echoes);
    if (!pool.length) return;
    var e = pool[Math.floor(run.rng.next() * pool.length)];
    run.echoes[e.id] = (run.echoes[e.id] || 0) + 1;
    G.refreshStats();
    UI.toast('영웅 잔향: ' + e.name);
  };

  // ---------------- pause ----------------
  S.goPause = function () {
    G.paused = true;
    var p = UI.screen('pause');
    p.appendChild(el('h3', '', '일시정지'));
    var run = G.run;
    if (run) {
      kv(p, '방', (run.roomIndex + 1) + ' / ' + (EH.Rooms.TOTAL + 1));
      kv(p, '처치', run.kills);
      kv(p, '시간 파편', run.shards);
      kv(p, '무기', EH.WEAPONS[run.weapon].name);
    }
    UI.row(p, [
      UI.button('계속하기', 'primary', function () { G.paused = false; UI.close(); }),
      UI.button('설정', '', function () { S.goSettings('pause'); }),
      UI.button('런 포기 (허브로)', 'danger', function () { G.abandonRun(); })
    ]);
  };

  // ---------------- boss intro ----------------
  S.bossIntro = function () {
    var p = UI.screen('bossIntro', { clear: true });
    p.style.background = 'transparent';
    p.style.border = 'none';
    p.style.boxShadow = 'none';
    p.appendChild(el('h1', 'title', '크로노보어'));
    p.appendChild(el('h2', 'sub', '시간을 집어삼키는 자'));
    setTimeout(function () { if (UI.current === 'bossIntro') UI.close(); }, 2600);
  };

  // ---------------- results ----------------
  S.goGameOver = function (info) {
    UI.showHUD(false);
    var p = UI.screen('gameOver');
    p.appendChild(el('h1', 'title', '육체가 무너졌다'));
    p.appendChild(el('h2', 'sub', '잔향심장은 계속 뛴다'));
    var sep = el('div', 'sep'); p.appendChild(sep);
    var rl = function (k, v) {
      var d = el('div', 'result-line');
      d.appendChild(el('span', '', k)); d.appendChild(el('b', '', String(v)));
      p.appendChild(d);
    };
    rl('도달한 방', (info.roomsCleared + 1) + ' / ' + (EH.Rooms.TOTAL + 1));
    rl('처치한 적', info.kills);
    rl('엘리트 처치', info.eliteKills);
    rl('최고 콤보', info.maxCombo);
    rl('심연 단계', info.abyss);
    rl('획득한 잔향 결정', '+' + info.crystals);
    if (info.adapt) {
      var a = EH.ADAPT[info.adapt.cause];
      var note = el('div', 'adapt-note');
      note.innerHTML = '“이번 죽음을 잔향심장이 기억했습니다.”<br>' +
        (info.adapt.gained
          ? '<span class="hl">' + a.name + ' 적응 ' + info.adapt.level + '단계 획득</span><br>' +
            '다음 런부터 ' + a.desc + ' ' + (a.per * info.adapt.level * 100).toFixed(0) + '%' +
            (a.kind === 'boss' ? ' 증가합니다.' : ' 적용됩니다.')
          : '<span class="hl">' + a.name + ' 적응은 이미 최대 단계입니다.</span>');
      p.appendChild(note);
    }
    UI.row(p, [
      UI.button('잔향의 대장간으로', 'primary', function () { S.goHub(); }),
      UI.button('바로 다시 도전', '', function () { S.startRun(); })
    ]);
  };

  S.goVictory = function (info) {
    UI.showHUD(false);
    var p = UI.screen('victory');
    p.appendChild(el('h1', 'title', '최초의 심장을 되찾았다'));
    p.appendChild(el('h2', 'sub', '아르카의 밤이 처음으로 끝났다'));
    var sep = el('div', 'sep'); p.appendChild(sep);
    var rl = function (k, v) {
      var d = el('div', 'result-line');
      d.appendChild(el('span', '', k)); d.appendChild(el('b', '', String(v)));
      p.appendChild(d);
    };
    rl('클리어 시간', info.time.toFixed(1) + '초');
    rl('처치한 적', info.kills);
    rl('최고 콤보', info.maxCombo);
    rl('심연 단계', info.abyss);
    rl('획득한 잔향 결정', '+' + info.crystals);
    if (info.newAbyss) {
      var n = el('div', 'adapt-note');
      n.style.background = 'rgba(79,227,240,.09)';
      n.style.borderColor = 'rgba(79,227,240,.35)';
      n.innerHTML = '<span class="hl" style="color:var(--cyan)">심연 ' + info.newAbyss + ' 단계 해금</span><br>' +
        '허브의 심연 장치에서 더 높은 난이도로 도전할 수 있습니다.';
      p.appendChild(n);
    }
    UI.row(p, [
      UI.button('잔향의 대장간으로', 'primary', function () { S.goHub(); }),
      UI.button('더 강해진 적과 다시', '', function () { S.startRun(); })
    ]);
  };

  // ---------------- error recovery ----------------
  S.goError = function (msg, detail) {
    UI.showHUD(false);
    var p = UI.screen('error');
    p.appendChild(el('h3', '', '문제가 발생했습니다'));
    var m = el('p', 'small', msg || '알 수 없는 오류');
    m.style.color = 'var(--amber)'; p.appendChild(m);
    if (detail) {
      var d = el('textarea', 'save-box');
      d.value = String(detail).slice(0, 1200);
      d.readOnly = true;
      p.appendChild(d);
    }
    UI.row(p, [
      UI.button('다시 시도', 'primary', function () { G.retryInit(); }),
      UI.button('타이틀로 돌아가기', '', function () { S.goTitle(); })
    ]);
  };
})();
