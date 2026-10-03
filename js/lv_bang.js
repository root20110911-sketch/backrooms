/* lv_bang.js —— Level !「不想死就快跑！」追逐逻辑
 *
 * 独立 IIFE，注册 BR.Levels.bang。不修改任何现有文件（注册点改动见各文件注释）。
 *
 * 玩法：载入即面向逃跑方向；警报 + 身后动静预热 6 秒；随后追逐者沿路线
 *   BFS 追击（真追逐，不是只放声音）。被抓到：-30 生命 + 击退 + 追逐者硬直 4.5s
 *   （不许必败）。追逐者移速 4.0~4.55（玩家耐力限制下可持续约 4.87，疾跑 5.6），
 *   管好耐力+干净跳跃能缓慢拉开；障碍/转弯/耐力耗尽会吃掉优势（不许无脑冲刺无压力）。
 * 障碍：半开门/病床/椅子（高，需绕行）+ 整幅杂物堆（低，h=0.8，必须跳，
 *   玩家跳跃顶点 1.11m）。碰撞为运行时推挤（tile 碰撞之外），跳起越过低障碍。
 * 补给：走过即自动拾取（边跑边拾）；快捷栏（按钮/数字键 1/2）直接使用杏仁水/绷带。
 * 假出口：中途 EXIT 门 + 旁边观察窗可看到储藏室骷髅（可观察区别，非随机二选一）；
 *   真出口：走廊尽头安全门 → 逃脱标记 + 传送（优先 W10 的 BR.Cutout.travelTo）。
 */
(function () {
  var BR = window.BR;
  var T = BR.TILE;

  /* ================= BR.Bang：跨关卡共享 ================= */
  // "已完成层级池"：W10 交付真正的完成度追踪前，以"已注册且非当前关"为兜底口径；
  // W10 可直接替换 BR.Bang.completedPool 的实现，本关其余逻辑不动。
  var COMPLETED_FALLBACK = ['L0', 'L1', 'L2', 'L3', 'FUN', 'L11', 'L37', 'L188', 'L7'];
  function completedPool() {
    var cur = BR.Game ? BR.Game.level : null;
    return COMPLETED_FALLBACK.filter(function (lv) { return lv !== cur && BR.Levels && BR.Levels[lv]; });
  }
  function pickCompletedDest() {
    var pool = completedPool();
    if (!pool.length) return 'L1';
    var n = (BR.Game.flags && BR.Game.flags.bangEscapes) || 0;
    var rng = new BR.RNG(BR.hashSeed(((BR.Game.seed == null ? 0 : BR.Game.seed)) + ':bangdest:' + n));
    return pool[rng.int(0, pool.length - 1)];
  }
  // 真出口传送：W10 的 BR.Cutout.travelTo(levelId, {mode, dropText})（已完成层级池 +
  // 落点安全检查）；travelTo 不可用时走旧统一接口 travel 兜底，不自己写传送。
  function travelOut(dest) {
    if (BR.Cutout && typeof BR.Cutout.travelTo === 'function') {
      try {
        var r = BR.Cutout.travelTo(dest, { mode: 'door', dropText: '你撞开安全门，扑进另一条走廊——暂时安全了。' });
        if (r && typeof r.then === 'function') r.catch(function () {});
        return;
      } catch (e) { if (BR.log) BR.log('[bang] travelTo 异常，走 travel 兜底', e); }
    }
    if (BR.Cutout && typeof BR.Cutout.travel === 'function') {
      BR.Cutout.travel(dest, { kind: 'walk', dropText: '你撞开安全门，扑进另一条走廊——暂时安全了。' });
    } else if (BR.Game && BR.Game.gotoLevel) {
      BR.Game.gotoLevel(dest, {});
    }
  }
  BR.Bang = { completedPool: completedPool, pickCompletedDest: pickCompletedDest, travelOut: travelOut };

  // 只读调试钩子（e2e 实测观察追逐者/预热状态用，不改变游戏逻辑）
  BR.Bang._debug = function () {
    if (!S) return null;
    return {
      warmup: S.warmup, escaped: S.escaped,
      chaser: S.chaser ? {
        x: S.chaser.x, z: S.chaser.z, state: S.chaser.state, stunT: S.chaser.stunT
      } : null,
      suppliesTaken: S.supplies.filter(function (s) { return s.taken; }).length,
      supplies: S.supplies.map(function (s) { return { x: s.x, z: s.z, taken: s.taken }; })
    };
  };

  // W10 契约：关卡 id 为 'bang'（非 'BANG'），按 cutout.js 注释设置 BANG_ID；
  // 并把 Level ! 登记进随机候选池（权重 10，接替原 L94 的位置）。
  if (BR.Cutout) {
    BR.Cutout.BANG_ID = 'bang';
    if (typeof BR.Cutout.registerRiftDest === 'function') BR.Cutout.registerRiftDest('bang', 10);
  }

  /* ================= 运行时态 ================= */
  var S = null;
  function newState() {
    return {
      warmup: 6, warmSndT: 0,          // 预热：警报 + 身后动静
      chaser: null,                    // {x,z,yaw,mesh,state,path,pathI,repathT,stunT,hopY,animT}
      solids: [],                      // 高障碍 {x,z,r,h}（需绕行）
      lows: [],                        // 低障碍 {x,z,hw（半宽，沿走廊方向）,h}（跳过）
      supplies: [],                    // {x,z,item,id,taken,group}
      escaped: false,
      footT: 0, growlT: 0,
      qb: null, keyH: null
    };
  }

  /* ================= 几何体缓存（关卡内复用，随 mesh 释放不单独管） ================= */
  var _gc = {};
  function bx(w, h, d) {
    var k = 'b' + w + ',' + h + ',' + d;
    return _gc[k] || (_gc[k] = new THREE.BoxGeometry(w, h, d));
  }
  function sph(r, a, b) {
    var k = 's' + r;
    return _gc[k] || (_gc[k] = new THREE.SphereGeometry(r, a || 10, b || 8));
  }

  /* ================= 追逐者 BFS（tile 网格，自包含） ================= */
  function findPath(W, sx, sy, tx, ty) {
    sx |= 0; sy |= 0; tx |= 0; ty |= 0;
    var map = W.map, w = map.w, h = map.h;
    if (sx === tx && sy === ty) return [];
    if (sx < 0 || sy < 0 || tx < 0 || ty < 0 || sx >= w || sy >= h || tx >= w || ty >= h) return null;
    var prev = new Int32Array(w * h).fill(-1);
    var s0 = sy * w + sx;
    var q = [s0]; prev[s0] = s0;
    var qi = 0, found = false;
    var DD = [1, 0, -1, 0, 0, 1, 0, -1];
    while (qi < q.length && q.length < 6000) {
      var cur = q[qi++], cx = cur % w, cy = (cur / w) | 0;
      if (cx === tx && cy === ty) { found = true; break; }
      for (var d = 0; d < 8; d += 2) {
        var nx = cx + DD[d], ny = cy + DD[d + 1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (W.blocked(nx, ny)) continue;
        var nk = ny * w + nx;
        if (prev[nk] !== -1) continue;
        prev[nk] = cur; q.push(nk);
      }
    }
    if (!found) return null;
    var path = [], cur2 = ty * w + tx, guard = 0;
    while (cur2 !== s0 && guard++ < 500) {
      path.push({ x: BR.tileCX(cur2 % w), z: BR.tileCZ((cur2 / w) | 0) });
      cur2 = prev[cur2];
    }
    path.reverse();
    return path;
  }

  /* ================= 追逐者模型 ================= */
  function buildChaserMesh() {
    var g = new THREE.Group();
    var skin = new THREE.MeshLambertMaterial({ color: 0x0b0b0f });
    var torso = new THREE.Mesh(bx(0.55, 1.15, 0.34), skin);
    torso.position.y = 1.35; g.add(torso);
    var head = new THREE.Mesh(sph(0.21), skin);
    head.position.y = 2.12; g.add(head);
    var eyeM = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    var eyeG = sph(0.045, 6, 5);
    var eL = new THREE.Mesh(eyeG, eyeM); eL.position.set(-0.08, 2.14, 0.17); g.add(eL);
    var eR = new THREE.Mesh(eyeG, eyeM); eR.position.set(0.08, 2.14, 0.17); g.add(eR);
    var armG = bx(0.13, 1.25, 0.13);
    var aL = new THREE.Mesh(armG, skin); aL.position.set(-0.37, 1.2, 0); g.add(aL);
    var aR = new THREE.Mesh(armG, skin); aR.position.set(0.37, 1.2, 0); g.add(aR);
    var legG = bx(0.16, 0.85, 0.16);
    var lL = new THREE.Mesh(legG, skin); lL.position.set(-0.15, 0.42, 0); g.add(lL);
    var lR = new THREE.Mesh(legG, skin); lR.position.set(0.15, 0.42, 0); g.add(lR);
    g.userData = { aL: aL, aR: aR, lL: lL, lR: lR, eyeM: eyeM };
    return g;
  }
  function animateChaser(ch, dt) {
    var u = ch.mesh.userData;
    ch.animT = (ch.animT || 0) + dt * (ch.state === 'chase' && ch.stunT <= 0 ? 11 : 3);
    var t = ch.animT, sw = Math.sin(t) * 0.55;
    u.aL.rotation.x = sw; u.aR.rotation.x = -sw;
    u.lL.rotation.x = -sw * 0.9; u.lR.rotation.x = sw * 0.9;
    // 眼睛脉动
    var p = 0.7 + 0.3 * Math.sin(t * 0.7);
    u.eyeM.color.setRGB(1.0 * p, 0.16 * p, 0.1 * p);
  }

  /* ================= 碰撞推挤 ================= */
  // 高障碍：圆形推挤；玩家跳起（feetY > h-0.15）可越过
  function collideSolids(x, z, radius, feetY, isPlayer) {
    for (var i = 0; i < S.solids.length; i++) {
      var s = S.solids[i];
      if (isPlayer && feetY > s.h - 0.15) continue;
      var dx = x - s.x, dz = z - s.z;
      var d = Math.hypot(dx, dz), min = s.r + radius;
      if (d < min) {
        if (d < 0.0001) { dx = 1; dz = 0; d = 1; }
        x = s.x + dx / d * min; z = s.z + dz / d * min;
      }
    }
    return [x, z];
  }
  // 低障碍：整幅杂物堆；feetY < h-0.30 时按走廊方向推回（撞上），跳起则通过。
  // v1.5 W6 修：容错窗口——旧值 hw=0.7/clearance h-0.15 在疾跑 5.6m/s 下起跳时机窗口仅约 47ms，
  //   人类/autopilot 都极难命中，实测 autopilot 原地弹跳 502 次被追上致死。现 hw=0.45、clearance h-0.30，
  //   窗口放宽到约 176ms；视觉仍是整幅杂物堆（跳跃落点在堆体中部，属可接受的视觉宽容）。
  function collideLows(x, z, feetY) {
    for (var i = 0; i < S.lows.length; i++) {
      var l = S.lows[i];
      if (feetY >= l.h - 0.30) continue;
      if (Math.abs(z - l.z) < 3.0 && Math.abs(x - l.x) < l.hw + 0.35) {
        x = l.x + (x >= l.x ? l.hw + 0.35 : -(l.hw + 0.35));
      }
    }
    return [x, z];
  }

  /* ================= 家具/障碍 mesh ================= */
  function buildObstacleMesh(kind, d, rng) {
    var g = new THREE.Group();
    if (kind === 'door') {
      // 半开的防火门：门框 + 斜开的门扇
      var fm = new THREE.MeshLambertMaterial({ color: 0x5a2a22 });
      var frame = new THREE.Mesh(bx(0.18, 2.3, 0.18), fm);
      frame.position.y = 1.15; g.add(frame);
      var panel = new THREE.Mesh(bx(1.15, 2.2, 0.09),
        new THREE.MeshLambertMaterial({ color: 0x7a3a2a }));
      panel.position.set(0.55 * (d.side >= 0 ? 1 : -1), 1.1, 0.35);
      panel.rotation.y = (d.side >= 0 ? -1 : 1) * 0.85;
      g.add(panel);
    } else if (kind === 'bed') {
      // 医院病床：床架 + 床垫 + 枕头 + 四腿
      var fr = new THREE.MeshLambertMaterial({ color: 0x8a9498 });
      var base = new THREE.Mesh(bx(1.1, 0.14, 2.1), fr);
      base.position.y = 0.62; g.add(base);
      var mat = new THREE.Mesh(bx(1.0, 0.18, 2.0),
        new THREE.MeshLambertMaterial({ color: 0xe4e8ea }));
      mat.position.y = 0.78; g.add(mat);
      var pil = new THREE.Mesh(bx(0.7, 0.14, 0.4),
        new THREE.MeshLambertMaterial({ color: 0xf2f4f4 }));
      pil.position.set(0, 0.92, -0.7); g.add(pil);
      var legG = bx(0.09, 0.62, 0.09);
      [[-0.45, -0.9], [0.45, -0.9], [-0.45, 0.9], [0.45, 0.9]].forEach(function (pt) {
        var leg = new THREE.Mesh(legG, fr);
        leg.position.set(pt[0], 0.31, pt[1]); g.add(leg);
      });
      var rail = new THREE.Mesh(bx(0.06, 0.35, 2.1), fr);
      rail.position.set(0.55, 1.0, 0); g.add(rail);
      g.rotation.y = d.rot || 0;
    } else if (kind === 'chair') {
      // 候诊椅
      var cm = new THREE.MeshLambertMaterial({ color: 0x3a5a6a });
      var seat = new THREE.Mesh(bx(0.55, 0.08, 0.55), cm);
      seat.position.y = 0.48; g.add(seat);
      var back = new THREE.Mesh(bx(0.55, 0.6, 0.08), cm);
      back.position.set(0, 0.8, -0.26); g.add(back);
      var cg = bx(0.06, 0.48, 0.06);
      [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].forEach(function (pt) {
        var leg = new THREE.Mesh(cg, cm);
        leg.position.set(pt[0], 0.24, pt[1]); g.add(leg);
      });
    } else { // low：整幅杂物堆（翻倒的推车/碎块），顶高 0.8
      var R = new BR.RNG(d.seed || 1);
      var dm = new THREE.MeshLambertMaterial({ color: 0x6a6f6a });
      var dm2 = new THREE.MeshLambertMaterial({ color: 0x54585a });
      for (var k = 0; k < 4; k++) {
        var bw = 1.0 + R.next() * 0.8, bh = 0.5 + R.next() * 0.3, bd = 1.4 + R.next() * 0.8;
        var b = new THREE.Mesh(bx(bw, bh, bd), k % 2 ? dm : dm2);
        b.position.set((R.next() - 0.5) * 1.2, bh / 2, -2.2 + k * 1.5 + (R.next() - 0.5) * 0.5);
        b.rotation.y = (R.next() - 0.5) * 0.7;
        b.rotation.z = (R.next() - 0.5) * 0.25;
        g.add(b);
      }
    }
    return g;
  }

  // 文字牌（EXIT / 安全出口）：CanvasTexture
  function textPlate(text, bg, fg, w, h) {
    var cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    var x = cv.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 256, 64);
    x.fillStyle = fg; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, 34);
    return new THREE.CanvasTexture(cv);
  }
  function graffitiTexture() {
    var cv = document.createElement('canvas'); cv.width = 512; cv.height = 160;
    var x = cv.getContext('2d');
    x.fillStyle = 'rgba(20,20,22,0.85)'; x.fillRect(0, 0, 512, 160);
    x.fillStyle = '#c22'; x.font = 'bold 56px sans-serif'; x.textAlign = 'center';
    x.fillText('跑错了！继续跑！', 256, 70);
    x.fillStyle = '#a33'; x.font = '28px sans-serif';
    x.fillText('— M.', 256, 120);
    return new THREE.CanvasTexture(cv);
  }

  function poiList(map, type) {
    return (map.pois || []).filter(function (p) { return p.type === type; });
  }

  /* ================= 字条 ================= */
  var BANG_NOTES = [
    { title: '潦草的字条', body: '跑！\n\n别停。别回头。\n它数着你的脚步声。\n\n——上一个跑过去的人' },
    { title: '警告字条', body: '警告：中途的「安全出口」是假的！\n\n我亲眼看见有人推开那扇门——\n里面只有一间储藏室，和一具骷髅。\n\n真正的出口在走廊尽头。一直跑。\n\n——M.' },
    { title: '血字', body: '它没有影子。\n警报声就是它的心跳。\n\n杏仁水能让你多跑一会儿。\n\n跑！！' }
  ];
  function addNoteBang(W, p, note) {
    var id = 'bangnote_' + p.tx + '_' + p.ty;
    W.addChunkContent(p.tx, p.ty, function (group) {
      if (W.state.picked.includes(id)) return;
      var m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
        new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
      m.position.set(BR.tileCX(p.tx), 1.5, BR.tileCZ(p.ty));
      m.rotation.y = Math.PI / 4;
      W.reg(group, m);
      W.addInteractable({
        id: id, kind: 'note', chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [m], pos: m.position.clone(), radius: 2.4,
        prompt: function () { return '阅读字条'; },
        canUse: function () { return true; },
        use: function () {
          BR.Audio.paper();
          BR.UI.showNote(note.title, note.body);
          if (W.state.picked.indexOf(id) < 0) W.state.picked.push(id);
        }
      });
    });
  }

  /* ================= 逃脱 ================= */
  function escape(W) {
    if (!S || S.escaped) return;
    S.escaped = true;
    BR.Game.flags.bangEscaped = true;   // W10 的随机规则读这个标记：逃脱后不再随机送回
    BR.Game.flags.bangEscapes = (BR.Game.flags.bangEscapes || 0) + 1;
    BR.Audio.stinger();
    BR.UI.toast('你撞开安全门——跑出来了！', 3000);
    BR.Game.autosave();
    var dest = BR.Bang.pickCompletedDest();
    setTimeout(function () { BR.Bang.travelOut(dest); }, 900);
  }

  /* ================= 快捷栏（边跑边用道具） ================= */
  function ensureQuickbar() {
    if (S.qb || !document.body) return;
    var div = document.createElement('div');
    div.id = 'bang-quickbar';
    div.style.cssText = 'position:fixed;right:12px;bottom:120px;z-index:40;display:flex;' +
      'flex-direction:column;gap:10px;pointer-events:auto;';
    var defs = [
      { it: 'almond', label: '杏仁水', key: '1' },
      { it: 'bandage', label: '绷带', key: '2' }
    ];
    defs.forEach(function (df) {
      var b = document.createElement('button');
      b.setAttribute('data-it', df.it);
      b.style.cssText = 'min-width:76px;padding:10px 8px;border-radius:12px;border:1px solid #7fd4c8;' +
        'background:rgba(10,20,24,0.72);color:#e8f4f2;font-size:13px;touch-action:none;';
      b.innerHTML = df.label + ' <span class="ct"></span><br><small style="opacity:.6">[' + df.key + ']</small>';
      var use = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (BR.Game.state === 'playing' && BR.Game.level === 'bang') BR.UI.useItem(df.it);
      };
      // 多点触控：touchstart 直接消费，不干扰摇杆/视角的触摸跟踪
      b.addEventListener('touchstart', use, { passive: false });
      b.addEventListener('mousedown', use);
      div.appendChild(b);
    });
    document.body.appendChild(div);
    S.qb = div;
  }
  function updateQuickbar() {
    if (!S.qb) return;
    var inv = (BR.Game && BR.Game.inv) || {};
    var btns = S.qb.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var it = btns[i].getAttribute('data-it');
      var ct = btns[i].querySelector('.ct');
      if (ct) ct.textContent = '×' + (inv[it] || 0);
      btns[i].style.opacity = (inv[it] || 0) > 0 ? '1' : '0.45';
    }
  }
  function bindQuickKeys() {
    if (S.keyH) return;
    S.keyH = function (e) {
      if (e.repeat) return;
      if (!BR.Game || BR.Game.level !== 'bang' || BR.Game.state !== 'playing') return;
      if (e.code === 'Digit1') BR.UI.useItem('almond');
      else if (e.code === 'Digit2') BR.UI.useItem('bandage');
    };
    window.addEventListener('keydown', S.keyH);
  }

  function cleanup() {
    if (!S) return;
    if (S.qb && S.qb.parentNode) S.qb.parentNode.removeChild(S.qb);
    if (S.keyH) window.removeEventListener('keydown', S.keyH);
    if (S.chaser && S.chaser.mesh && S.chaser.mesh.parent) S.chaser.mesh.parent.remove(S.chaser.mesh);
    // v1.5 W6：恢复耐力消耗（离开本关即失效；默认 1，不影响其他关卡）
    try { if (BR.Player) BR.Player.staminaDrainMul = 1; } catch (e) {}
    S = null;
  }

  /* ================= 关卡定义 ================= */
  var L = {
    name: 'Level ! ——「不想死就快跑！」',
    theme: {
      bg: 0x0a0c0e, fogNear: 8, fogFar: 46, ambient: 0xbfd4d8, ambInt: 0.5,
      sky: 0xdfeef2, ground: 0x8a9494, light: 0xf4fbff, lightInt: 0.85,
      wallH: 3.0, wall: 'bang_wall', floor: 'bang_floor', ceil: 'ceiling',
      surface: 'tile', fixtureEvery: 5, hum: 0.25
    },

    onEnter: function () {
      if (!S) S = newState();
      S.warmup = 6; S.warmSndT = 0.4; S.escaped = false;
      var W = BR.World;
      var cp = poiList(W.map, 'bang_chaser')[0];
      if (S.chaser) {
        S.chaser.x = BR.tileCX(cp.tx); S.chaser.z = BR.tileCZ(cp.ty);
        S.chaser.state = 'dormant'; S.chaser.path = null; S.chaser.stunT = 0;
      }
      BR.Audio.setAmbient('BANG');
      BR.UI.setObjective(W.objective || '跑！穿过医院长廊，别被身后的东西抓住');
      BR.UI.toast('警报响了。身后有动静——跑！别回头！', 5000);
      // v1.5 W6：追逐肾上腺素——本关疾跑不耗耐力（W9 耐力系统默认 14 秒耗尽，
      // 与"持续疾跑 4~5 分钟"的关卡设计冲突，不改则走路必被追上=必败）；
      // 钩子默认 1，只影响本关，离开时 cleanup() 恢复。
      try {
        BR.Player.staminaDrainMul = 0;
        BR.Player.stamina = 100;
      } catch (e) {}
      ensureQuickbar();
      bindQuickKeys();
      updateQuickbar();
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player;
      if (!BR.Game || BR.Game.level !== 'bang') { cleanup(); return; }
      if (!W || !W.map || W.map.level !== 'bang') return;
      if (!P || BR.Game.state !== 'playing') return;
      if (!S || !S.chaser) return;
      var ch = S.chaser;

      // —— 预热：警报 + 身后动静（追逐者不动） ——
      if (ch.state === 'dormant') {
        S.warmup -= dt;
        S.warmSndT -= dt;
        if (S.warmSndT <= 0) {
          S.warmSndT = 1.4;
          BR.Audio.thud();
          P.shake(0.22);
        }
        if (S.warmup <= 0) {
          ch.state = 'chase';
          BR.Audio.stinger(); BR.Audio.growl();
          BR.UI.toast('它来了——跑！！！', 2600);
        }
        return;
      }
      if (S.escaped) return;

      var dx = P.pos.x - ch.x, dz = P.pos.z - ch.z;
      var dist = Math.hypot(dx, dz);

      if (ch.stunT > 0) {
        ch.stunT -= dt;
      } else {
        // —— 真追逐：BFS 路径追踪 ——
        ch.repathT -= dt;
        if (ch.repathT <= 0 || !ch.path) {
          ch.path = findPath(W,
            Math.floor(ch.x / T), Math.floor(ch.z / T),
            Math.floor(P.pos.x / T), Math.floor(P.pos.z / T));
          ch.pathI = 0; ch.repathT = 0.5;
        }
        var speed = 4.2;                    // 基础：低于玩家可持续速度（耐力限制下约 4.87）
        if (dist > 30) speed = 4.55;        // 掉太远：加速（仍 < 疾跑 5.6，干净冲刺能拉开）
        else if (dist < 10) speed = 4.0;    // 贴太近：减速，给反应空间
        if (ch.path && ch.pathI < ch.path.length) {
          var wp = ch.path[ch.pathI];
          var wx = wp.x - ch.x, wz = wp.z - ch.z;
          var wd = Math.hypot(wx, wz);
          if (wd < 0.6) { ch.pathI++; }
          else {
            ch.x += wx / wd * speed * dt; ch.z += wz / wd * speed * dt;
            ch.yaw = Math.atan2(wx, wz);
          }
        } else if (dist > 0.01) {
          ch.x += dx / dist * speed * dt; ch.z += dz / dist * speed * dt;
          ch.yaw = Math.atan2(dx, dz);
        }
        // 高障碍推挤；低障碍直接跨过（跳跃动作）
        var cs = collideSolids(ch.x, ch.z, 0.4, 0, false);
        ch.x = cs[0]; ch.z = cs[1];
        ch.hopY = 0;
        for (var li = 0; li < S.lows.length; li++) {
          var l = S.lows[li];
          if (Math.abs(ch.z - l.z) < 3.0 && Math.abs(ch.x - l.x) < l.hw + 0.4) { ch.hopY = 0.9; break; }
        }
        // —— 抓到：-30 生命 + 击退 + 硬直（不许必败） ——
        if (dist < 2.0) {
          P.hurt(30, 'bang_chaser');
          P.shake(0.8);
          BR.Audio.stinger();
          BR.UI.toast('它抓住了你！甩开它，继续跑！', 2200);
          var px = P.pos.x - ch.x, pz = P.pos.z - ch.z, pd = Math.hypot(px, pz) || 1;
          P.vel.x += px / pd * 9; P.vel.z += pz / pd * 9;
          ch.stunT = 4.5; ch.path = null;
        }
      }

      // 落位 + 动画
      ch.mesh.position.set(ch.x, ch.hopY || 0, ch.z);
      ch.mesh.rotation.y = ch.yaw;
      animateChaser(ch, dt);

      // 追逐音效：脚步 + 低吼 + 近身理智侵蚀
      S.footT -= dt;
      if (S.footT <= 0 && dist < 34 && ch.stunT <= 0) { S.footT = 0.42; BR.Audio.footstep('tile'); }
      S.growlT -= dt;
      if (S.growlT <= 0 && dist < 22 && ch.stunT <= 0) { S.growlT = 6; BR.Audio.growl(); }
      if (dist < 10 && ch.stunT <= 0) P.drainSanity(dt * 2);

      // 玩家障碍推挤（跳起越过低障碍）
      var feetY = P.pos.y || 0;
      var pc = collideSolids(P.pos.x, P.pos.z, 0.35, feetY, true);
      var pl = collideLows(pc[0], pc[1], feetY);
      P.pos.x = pl[0]; P.pos.z = pl[1];

      // 补给：走过即拾（边跑边拾；半径 2.2m，补给在走廊边缘 ±1.6m，中线跑过即拾）
      for (var si = 0; si < S.supplies.length; si++) {
        var sp = S.supplies[si];
        if (sp.taken) continue;
        if (Math.hypot(P.pos.x - sp.x, P.pos.z - sp.z) < 2.2) {
          sp.taken = true;
          BR.Game.inv[sp.item] = (BR.Game.inv[sp.item] || 0) + 1;
          BR.Audio.pickup();
          var nm = { almond: '杏仁水', bandage: '绷带' }[sp.item] || sp.item;
          BR.UI.toast('跑过时抓起' + nm + ' ×1');
          if (W.state.picked.indexOf(sp.id) < 0) W.state.picked.push(sp.id);
          BR.bus.emit('picked', { id: sp.id });
          if (sp.group && sp.group.parent) sp.group.parent.remove(sp.group);
          BR.UI.updateInv();
        }
      }
      updateQuickbar();
    },

    buildContent: function (map, W) {
      cleanup();
      S = newState();
      var rng = new BR.RNG(BR.hashSeed(map.seed + ':bangbuild'));

      // —— 障碍 ——
      poiList(map, 'bang_obs').forEach(function (p) {
        var d = p.data;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = buildObstacleMesh(d.kind, d, rng);
          g.position.set(d.x, 0, d.z);
          W.reg(group, g);
        });
        if (d.kind === 'low') S.lows.push({ x: d.x, z: d.z, hw: 0.45, h: d.h }); // v1.5 W6：hw 0.7→0.45，跳跃时机窗口 47ms→176ms
        else S.solids.push({ x: d.x, z: d.z, r: d.r, h: d.h });
      });

      // —— 假出口：门 + 观察窗 + 储藏室（骷髅 + 涂鸦 + 字条） ——
      W.addDoor({
        id: 'bang_fake', tx: 30, ty: 31, label: '安全出口',
        prompt: function () { return '推开安全出口的门（EXIT）'; },
        use: function (dd) {
          W.setDoor('bang_fake', true);
          BR.Audio.doorCreak();
          if (W.state.events.indexOf('bang_fake_opened') < 0) {
            W.state.events.push('bang_fake_opened');
            BR.UI.toast('门后只有一间储藏室……假的！继续跑！', 3200);
          }
          BR.Game.autosave();
        }
      });
      // 观察窗：跳过整面墙渲染，改建窗框 + 铁栏（能看到储藏室里面）
      W.skipWall(31, 31);
      W.addChunkContent(31, 31, function (group) {
        var g = new THREE.Group();
        var wx = BR.tileCX(31), wz = BR.tileCZ(31);
        var wallM = new THREE.MeshLambertMaterial({ color: 0xdbe2dc });
        [[-1.05], [1.05]].forEach(function (o) { // 两侧补墙
          var f = new THREE.Mesh(bx(0.9, 3.0, 0.3), wallM);
          f.position.set(wx + o[0], 1.5, wz); g.add(f);
        });
        var barM = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
        for (var bi = -1; bi <= 1; bi++) { // 铁栏
          var bar = new THREE.Mesh(bx(0.07, 1.3, 0.07), barM);
          bar.position.set(wx + bi * 0.4, 1.5, wz); g.add(bar);
        }
        var sill = new THREE.Mesh(bx(1.3, 0.1, 0.34), wallM);
        sill.position.set(wx, 0.85, wz); g.add(sill);
        var lint = new THREE.Mesh(bx(1.3, 1.1, 0.34), wallM);
        lint.position.set(wx, 2.45, wz); g.add(lint);
        g.position.set(0, 0, 0);
        W.reg(group, g);
        // EXIT 灯牌（假门上方，红色）
        var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28),
          new THREE.MeshBasicMaterial({ map: textPlate('EXIT', '#a02020', '#ffffff') }));
        sign.position.set(BR.tileCX(30), 2.62, BR.tileCZ(30) - 1.42);
        sign.rotation.y = Math.PI;
        W.reg(group, sign);
      });
      // 储藏室：骷髅 + 涂鸦（MeshBasicMaterial，无光也可见）
      W.addChunkContent(30, 32, function (group) {
        var g = new THREE.Group();
        var bone = new THREE.MeshBasicMaterial({ color: 0xd8d4c8 });
        var cx = BR.tileCX(30) + 0.6, cz = BR.tileCZ(32) + 0.4;
        var skull = new THREE.Mesh(sph(0.14, 8, 6), bone);
        skull.position.set(cx, 0.16, cz); g.add(skull);
        var torso = new THREE.Mesh(bx(0.4, 0.18, 0.7), bone);
        torso.position.set(cx + 0.3, 0.12, cz + 0.5); torso.rotation.y = 0.4; g.add(torso);
        [[0.1, 0.9], [-0.15, 1.2]].forEach(function (o) {
          var limb = new THREE.Mesh(bx(0.09, 0.09, 0.6), bone);
          limb.position.set(cx + o[0], 0.08, cz + o[1]); limb.rotation.y = 0.9; g.add(limb);
        });
        var gr = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.7),
          new THREE.MeshBasicMaterial({ map: graffitiTexture() }));
        gr.position.set(BR.tileCX(30) + 0.5, 1.5, (33 + 1) * T - 0.06); // 储藏室南墙内面
        gr.rotation.y = Math.PI;
        g.add(gr);
        W.reg(group, g);
        W.addInteractable({
          id: 'bang_closet_note', kind: 'note', chunkKey: W.chunkKeyOf(30, 32),
          meshes: [skull], pos: new THREE.Vector3(cx, 0.6, cz), radius: 2.4,
          prompt: function () { return '查看骷髅旁的字条'; },
          canUse: function () { return true; },
          use: function () {
            BR.Audio.paper();
            BR.UI.showNote('骷髅旁的字条', '……你推开门，里面只有一具骷髅。\n\n墙上用红漆写着：「跑错了！继续跑！」\n\n中途的出口不能信。真正的出口在走廊尽头。');
          }
        });
      });

      // —— 真出口：走廊尽头安全门 + 门后光 ——
      W.addDoor({
        id: 'bang_exit_door', tx: 54, ty: 44, axis: 'z', label: '安全门',
        prompt: function () { return '撞开安全门——逃出去！'; },
        use: function (dd) {
          W.setDoor('bang_exit_door', true, true);
          BR.Audio.doorOpen();
          escape(W);
        }
      });
      W.addChunkContent(54, 44, function (group) {
        // 门后白光（磨砂玻璃后的光亮，区别于假门）
        var glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.6),
          new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
        glow.position.set(54 * T + 2.94, 1.5, BR.tileCZ(44));
        glow.rotation.y = -Math.PI / 2;
        W.reg(group, glow);
        var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38),
          new THREE.MeshBasicMaterial({ map: textPlate('安全出口', '#1a7a3a', '#ffffff') }));
        sign.position.set(54 * T - 0.06, 2.66, BR.tileCZ(44));
        sign.rotation.y = -Math.PI / 2;
        W.reg(group, sign);
      });

      // —— 补给（自动拾取） ——
      poiList(map, 'bang_supply').forEach(function (p) {
        var d = p.data, id = 'bangsup_' + p.tx + '_' + p.ty;
        W.addChunkContent(p.tx, p.ty, function (group) {
          if (W.state.picked.indexOf(id) >= 0) return;
          var g = BR.itemMesh(d.item);
          g.position.set(d.x, 0.02, d.z);
          W.reg(group, g);
          S.supplies.push({ x: d.x, z: d.z, item: d.item, id: id, taken: false, group: g });
        });
      });

      // —— 字条 ——
      poiList(map, 'bang_note').forEach(function (p) {
        addNoteBang(W, p, BANG_NOTES[p.data.noteId % BANG_NOTES.length]);
      });

      // —— 追逐者 ——
      var cp = poiList(map, 'bang_chaser')[0];
      var mesh = buildChaserMesh();
      mesh.position.set(BR.tileCX(cp.tx), 0, BR.tileCZ(cp.ty));
      W.scene.add(mesh);
      S.chaser = {
        x: BR.tileCX(cp.tx), z: BR.tileCZ(cp.ty), yaw: -Math.PI / 2,
        mesh: mesh, state: 'dormant', path: null, pathI: 0, repathT: 0,
        stunT: 0, hopY: 0, animT: 0
      };

      W.objective = '跑！穿过医院长廊，别被身后的东西抓住——真正的出口在走廊尽头';
    }
  };
  BR.Levels.bang = L;
})();
