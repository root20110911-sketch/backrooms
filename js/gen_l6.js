/* gen_l6.js —— Level 6「熄灯之时」地图生成
 * 结构：黑暗中的混凝土/机房混合结构 —— 3×3 扇区大开间（值班室/机房大厅/空旷大厅）
 *       + 1 格宽狭窄维修道连接（生成树 + 2~4 条回环），避免纯迷宫感。
 * L7 连接（原著依据，Wikidot Level 6 / Level 7 词条，2026-10-17 核实）：
 *   "Exploring deep enough into Level 6 can lead to a stairwell down to Level 7.
 *    The easiest way to find this stairwell is to listen for the faint sound of waves."
 *   楼梯间 POI（l6_stairwell）为 critical，进 ensureConnected，保证可达。
 *   注：Wikidot 原文是 "a stairwell down to Level 7"，并无"小屋"说法；
 *   L7 词条称楼梯直通"the entrance room"（楼梯底的家具房），本作按"楼梯间"实现。
 * 铁律：placer 只用传入的 rng，禁用 Math.random / Date / DOM / THREE。
 */
(function () {
  var _g = (typeof window !== 'undefined') ? window : globalThis;
  var BR = _g.BR || (_g.BR = {});

  /* ================= 贴图（确定性绘制，只用 pr） ================= */
  function pr(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // l6_conc：深色混凝土墙（污渍 + 纵向水痕，比 L1/L2 的 concrete 更暗）
  BR.Textures.registerTex('l6_conc', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#33353a'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 1500; i++) {
      var g = 38 + ((pr(i) * 26) | 0);
      x.fillStyle = 'rgb(' + g + ',' + g + ',' + (g + 3) + ')';
      x.fillRect(pr(5000 + i) * w, pr(6000 + i) * h, 2, 2);
    }
    for (var k = 0; k < 12; k++) { // 纵向水痕
      var sx = pr(7000 + k) * w, sw = 4 + pr(7100 + k) * 16;
      var grd = x.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(12,13,15,0.55)');
      grd.addColorStop(1, 'rgba(12,13,15,0)');
      x.fillStyle = grd;
      x.fillRect(sx, pr(7200 + k) * h * 0.4, sw, h);
    }
    for (var j = 0; j < 24; j++) { // 霉斑
      x.fillStyle = 'rgba(20,26,18,' + (0.10 + pr(8000 + j) * 0.16).toFixed(2) + ')';
      x.beginPath(); x.arc(pr(8100 + j) * w, pr(8200 + j) * h, 5 + pr(8300 + j) * 18, 0, 6.2832); x.fill();
    }
    x.strokeStyle = 'rgba(10,10,12,0.5)'; x.lineWidth = 2; // 板缝
    for (var b = 1; b < 4; b++) {
      x.beginPath(); x.moveTo(b * w / 4, 0); x.lineTo(b * w / 4, h); x.stroke();
      x.beginPath(); x.moveTo(0, b * h / 4); x.lineTo(w, b * h / 4); x.stroke();
    }
    return c;
  });

  // l6_metal：机房设备金属（深灰 + 铆钉 + 油污）
  BR.Textures.registerTex('l6_metal', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#2b2d31'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 700; i++) {
      var g = 34 + ((pr(i * 3 + 1) * 24) | 0);
      x.fillStyle = 'rgb(' + g + ',' + (g + 1) + ',' + (g + 4) + ')';
      x.fillRect(pr(9000 + i) * w, pr(9100 + i) * h, 3, 2);
    }
    x.fillStyle = 'rgba(16,15,13,0.85)'; // 铆钉
    for (var k = 0; k < 2; k++)
      for (var i2 = 0; i2 < 6; i2++) {
        x.beginPath(); x.arc((i2 + 0.5) * w / 6, h * (0.1 + k * 0.8), 4, 0, 6.2832); x.fill();
      }
    for (var j = 0; j < 10; j++) { // 油污
      x.fillStyle = 'rgba(10,10,8,' + (0.2 + pr(9300 + j) * 0.25).toFixed(2) + ')';
      x.beginPath(); x.arc(pr(9400 + j) * w, pr(9500 + j) * h, 6 + pr(9600 + j) * 20, 0, 6.2832); x.fill();
    }
    return c;
  });

  // l6_door_steel：楼梯间钢门（深色 + 门框 + 警示条）
  BR.Textures.registerTex('l6_door_steel', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#232528'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,0,0,0.7)'; x.lineWidth = 8; x.strokeRect(4, 4, w - 8, h - 8);
    x.fillStyle = 'rgba(150,120,30,0.5)'; // 底部警示条（磨损）
    for (var i = 0; i < 5; i++) x.fillRect(10 + i * (w - 20) / 5, h - 22, (w - 20) / 10, 8);
    x.fillStyle = 'rgba(0,0,0,0.6)';
    x.fillRect(w / 2 - 3, 6, 6, h - 12); // 门缝
    return c;
  });

  BR.Textures.registerWallTex('L6', 'l6_conc');

  /* ================= 环境音：近乎死寂（Wikidot："eerily silent, akin to a soundproof room"） ================= */
  BR.Audio.registerAmbient('L6', function () {
    var rig = this._loopRig(function (R) {
      // 极低频压迫感（缓慢起伏）
      var o = R.osc('sine', 34), g = R.gain(0.10);
      o.connect(g); g.connect(R.group);
      var lfo = R.osc('sine', 0.05), lg = R.gain(0.05);
      lfo.connect(lg); lg.connect(g.gain);
      // 空气死寂：极低电平低通噪声
      var n = R.noise(), lp = R.filter('lowpass', 160, 0.5), ng = R.gain(0.045);
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
      // 偶发远处金属冷缩"咔哒"由关卡 tick 的 one-shot 补，不进 loop
    });
    rig.target = 0.30;
    return rig;
  });

  /* ================= 关卡注册 ================= */
  BR.Gen.registerLevel('L6',
    { rw: [6, 12], rh: [6, 12], corrW: [1, 1], loops: [3, 6], wallH: 3.0 },
    placeL6,
    ['spawn', 'l6_stairwell'] // critical：出生点 + 通往 L7 的楼梯间（原著连接，保证可达）
  );

  /* ================= placer =================
   * 3×3 扇区 → 每扇区一个大开间 → 生成树 + 回环的 1 宽维修道连接。
   * tiles：1=地板，0=墙/设备块（碰撞走 tile；渲染由 lv_l6 按 meta.l6 自建）。
   */
  function placeL6(map, rng) {
    var W = map.w, H = map.h, MGN = 2; // 外圈 2 格恒为墙（缝线契约）
    function T(x, y) { return y * W + x; }
    function tile(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      return map.tiles[T(x, y)];
    }
    function setT(x, y, v) { if (x >= MGN && y >= MGN && x < W - MGN && y < H - MGN) map.tiles[T(x, y)] = v; }
    function addPOI(type, tx, ty, data) {
      var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
      map.pois.push(p);
      return p;
    }

    /* ---------- Stage 0：清空（L11 同款：城市/机房自己画） ---------- */
    for (var ci = 0; ci < map.tiles.length; ci++) map.tiles[ci] = 0;
    map.rooms.length = 0;

    /* ---------- Stage 1：3×3 扇区大开间 ---------- */
    var SX = 4, SY = 4, SS = 16; // 扇区原点与边长，覆盖 [4,52)
    var sectors = []; // {i,j,x0,y0,x1,y1,cx,cy,kind}
    var spawnSec = rng.int(0, 8);
    // 机房扇区：2 个（与出生扇区不同；尽量散开）
    var machSecs = [];
    var order = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8].filter(function (s) { return s !== spawnSec; }));
    machSecs.push(order[0], order[1]);
    for (var sj = 0; sj < 3; sj++)
      for (var si = 0; si < 3; si++) {
        var idx = sj * 3 + si, bx = SX + si * SS, by = SY + sj * SS;
        var kind = idx === spawnSec ? 'duty' : (machSecs.indexOf(idx) >= 0 ? 'machine' : 'hall');
        var rw = kind === 'duty' ? 5 : (8 + rng.int(0, 4));
        var rh = kind === 'duty' ? 5 : (8 + rng.int(0, 4));
        var rx0 = bx + 1 + rng.int(0, SS - rw - 2);
        var ry0 = by + 1 + rng.int(0, SS - rh - 2);
        for (var yy = ry0; yy < ry0 + rh; yy++)
          for (var xx = rx0; xx < rx0 + rw; xx++) setT(xx, yy, 1);
        sectors.push({
          i: si, j: sj, x0: rx0, y0: ry0, x1: rx0 + rw - 1, y1: ry0 + rh - 1,
          cx: (rx0 + rx0 + rw - 1) / 2, cy: (ry0 + ry0 + rh - 1) / 2, kind: kind
        });
      }

    var zones = []; // 回声/脚步分区 {x0,y0,x1,y1,kind}
    sectors.forEach(function (s) {
      zones.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, kind: s.kind });
    });

    /* ---------- Stage 2：维修道（生成树 + 回环，1 宽） ---------- */
    function carveCorr(x1, y1, x2, y2, zoneKind) {
      // L 形：先横后竖 / 先竖后横随机；记录每段为回声分区
      var legs;
      if (rng.chance(0.5)) legs = [[x1, y1, x2, y1], [x2, y1, x2, y2]];
      else legs = [[x1, y1, x1, y2], [x1, y2, x2, y2]];
      for (var i = 0; i < legs.length; i++) {
        var L = legs[i];
        var xa = Math.min(L[0], L[2]), xb = Math.max(L[0], L[2]);
        var ya = Math.min(L[1], L[3]), yb = Math.max(L[1], L[3]);
        for (var y = ya; y <= yb; y++)
          for (var x = xa; x <= xb; x++) setT(x, y, 1);
        if (xa !== xb || ya !== yb)
          zones.push({ x0: xa, y0: ya, x1: xb, y1: yb, kind: zoneKind || 'corr' });
      }
    }
    // 随机 Prim 生成树
    var inTree = {}, edges = [];
    function secId(s) { return s.j * 3 + s.i; }
    var start = sectors[rng.int(0, 8)];
    inTree[secId(start)] = 1;
    var frontier = [];
    function pushFrontier(s) {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var ni = s.i + d[0], nj = s.j + d[1];
        if (ni < 0 || nj < 0 || ni > 2 || nj > 2) return;
        var o = sectors[nj * 3 + ni];
        if (!inTree[secId(o)]) frontier.push([s, o]);
      });
    }
    pushFrontier(start);
    while (frontier.length) {
      var fi = rng.int(0, frontier.length - 1);
      var e = frontier.splice(fi, 1)[0], a = e[0], b = e[1];
      if (inTree[secId(b)]) continue;
      inTree[secId(b)] = 1;
      edges.push(e);
      pushFrontier(b);
    }
    // 回环：2~4 条额外邻接边
    var extra = 2 + rng.int(0, 2), guard = 0;
    while (extra > 0 && guard++ < 60) {
      var sA = sectors[rng.int(0, 8)];
      var d = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      var ni2 = sA.i + d[0], nj2 = sA.j + d[1];
      if (ni2 < 0 || nj2 < 0 || ni2 > 2 || nj2 > 2) continue;
      var sB = sectors[nj2 * 3 + ni2], dup = false;
      for (var ei = 0; ei < edges.length; ei++)
        if ((edges[ei][0] === sA && edges[ei][1] === sB) || (edges[ei][0] === sB && edges[ei][1] === sA)) { dup = true; break; }
      if (dup) continue;
      edges.push([sA, sB]);
      extra--;
    }
    var corrTiles = []; // 维修道 tile（死胡同/POI 选址用）
    edges.forEach(function (e2) {
      var A = e2[0], B = e2[1];
      var ax = Math.round(A.cx), ay = Math.round(A.cy), bx = Math.round(B.cx), by = Math.round(B.cy);
      carveCorr(ax, ay, bx, by, 'corr');
    });
    // 收集维修道 tile（房间外的地板）
    for (var cyy = MGN; cyy < H - MGN; cyy++)
      for (var cxx = MGN; cxx < W - MGN; cxx++) {
        if (map.tiles[T(cxx, cyy)] !== 1) continue;
        var inRoom = false;
        for (var ri = 0; ri < sectors.length; ri++) {
          var rs = sectors[ri];
          if (cxx >= rs.x0 && cxx <= rs.x1 && cyy >= rs.y0 && cyy <= rs.y1) { inRoom = true; break; }
        }
        if (!inRoom) corrTiles.push([cxx, cyy]);
      }
    // 1~2 段维修道标为"静音区"（Wikidot：soundproof room 特性）
    var quietLegs = zones.filter(function (z) { return z.kind === 'corr'; });
    for (var qi = 0; qi < Math.min(2, quietLegs.length); qi++) {
      var qz = rng.pick(quietLegs);
      qz.kind = 'quiet';
    }

    /* ---------- Stage 3：机房设备块（2×2 实心，靠墙角放，不堵路） ---------- */
    var machineBlocks = []; // {x0,y0} 2×2
    sectors.forEach(function (s) {
      if (s.kind !== 'machine') return;
      var corners = [
        [s.x0 + 1, s.y0 + 1], [s.x1 - 2, s.y0 + 1],
        [s.x0 + 1, s.y1 - 2], [s.x1 - 2, s.y1 - 2]
      ];
      var picks = rng.shuffle(corners).slice(0, 2);
      picks.forEach(function (cn) {
        for (var dy = 0; dy < 2; dy++)
          for (var dx = 0; dx < 2; dx++) map.tiles[T(cn[0] + dx, cn[1] + dy)] = 0;
        machineBlocks.push({ x0: cn[0], y0: cn[1] });
        // 设备正对的地板 tile 作为 hum 锚点
        var ax2 = cn[0] + 1, ay2 = cn[1] + 2;
        if (tile(ax2, ay2) !== 1) { ay2 = cn[1] - 1; }
        if (tile(ax2, ay2) === 1) addPOI('l6_machine', ax2, ay2, {});
      });
    });

    /* ---------- 工具：BFS ---------- */
    function flood(sx, sy) {
      var dist = new Int32Array(W * H).fill(-1), qx = [sx], qy = [sy], head = 0;
      if (tile(sx, sy) !== 1) return dist;
      dist[T(sx, sy)] = 0;
      while (head < qx.length) {
        var x = qx[head], y = qy[head]; head++;
        var ds = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d = 0; d < 4; d++) {
          var nx = x + ds[d][0], ny = y + ds[d][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (map.tiles[T(nx, ny)] !== 1 || dist[T(nx, ny)] >= 0) continue;
          dist[T(nx, ny)] = dist[T(x, y)] + 1; qx.push(nx); qy.push(ny);
        }
      }
      return dist;
    }
    function nearPOI(x, y, r) {
      for (var i = 0; i < map.pois.length; i++) {
        var p = map.pois[i];
        if (Math.hypot(p.tx - x, p.ty - y) < r) return true;
      }
      return false;
    }

    /* ---------- Stage 4：出生（值班室） ---------- */
    var duty = sectors[spawnSec];
    var spawnTx = Math.round(duty.cx), spawnTy = Math.round(duty.cy);
    addPOI('spawn', spawnTx, spawnTy, {});
    // 手电拾取点：出生 tile 旁（保证出生安全区内可拿）
    var flashTx = spawnTx + 1, flashTy = spawnTy;
    if (tile(flashTx, flashTy) !== 1) { flashTx = spawnTx; flashTy = spawnTy; }
    addPOI('l6_flash', flashTx, flashTy, {});

    /* ---------- Stage 5：楼梯间（→L7，原著连接；离出生最远的大厅旁） ---------- */
    var distS = flood(spawnTx, spawnTy);
    var farSec = null, farD = -1;
    sectors.forEach(function (s) {
      if (s.kind === 'duty' || s.kind === 'machine') return;
      var d = distS[T(Math.round(s.cx), Math.round(s.cy))];
      if (d > farD) { farD = d; farSec = s; }
    });
    if (!farSec) farSec = sectors[(spawnSec + 4) % 9];
    // 在 farSec 的某一侧贴墙建 3×3 楼梯间
    var stairPlaced = false, stairTx = -1, stairTy = -1;
    var sDirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    for (var sdi = 0; sdi < sDirs.length && !stairPlaced; sdi++) {
      var sd = sDirs[sdi];
      var ex = sd[0] !== 0 ? (sd[0] > 0 ? farSec.x1 + 1 : farSec.x0 - 1) : Math.round(farSec.cx);
      var ey = sd[1] !== 0 ? (sd[1] > 0 ? farSec.y1 + 1 : farSec.y0 - 1) : Math.round(farSec.cy);
      // 3×3 区域需全是墙且在边界内
      var ok = true;
      for (var oy = -1; oy <= 1 && ok; oy++)
        for (var ox = -1; ox <= 1 && ok; ox++) {
          var tx = ex + ox + sd[0] * 2, ty = ey + oy + sd[1] * 2;
          if (tx < MGN || ty < MGN || tx >= W - MGN || ty >= H - MGN || tile(tx, ty) === 1) ok = false;
        }
      if (!ok) continue;
      // 挖 3×3 + 2 格连接道
      for (var oy2 = -1; oy2 <= 1; oy2++)
        for (var ox2 = -1; ox2 <= 1; ox2++) setT(ex + ox2 + sd[0] * 2, ey + oy2 + sd[1] * 2, 1);
      var ccx = ex + sd[0], ccy = ey + sd[1];
      setT(ccx, ccy, 1); setT(ccx + sd[0], ccy + sd[1], 1);
      stairTx = ex + sd[0] * 2; stairTy = ey + sd[1] * 2;
      zones.push({ x0: stairTx - 1, y0: stairTy - 1, x1: stairTx + 1, y1: stairTy + 1, kind: 'stair' });
      stairPlaced = true;
    }
    if (!stairPlaced) { // 终极兜底：直接放在 farSec 中心旁
      stairTx = Math.round(farSec.cx); stairTy = Math.round(farSec.cy);
      zones.push({ x0: stairTx - 1, y0: stairTy - 1, x1: stairTx + 1, y1: stairTy + 1, kind: 'stair' });
    }
    addPOI('l6_stairwell', stairTx, stairTy, {});

    /* ---------- Stage 6：死胡同"最安静的房间"（Wikidot 出哨致敬） ---------- */
    var switchTx = -1, switchTy = -1;
    var ctries = rng.shuffle(corrTiles.slice());
    for (var cti = 0; cti < ctries.length && switchTx < 0; cti++) {
      var ct = ctries[cti];
      var wdirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      for (var wdi = 0; wdi < wdirs.length; wdi++) {
        var wd = wdirs[wdi], ok2 = true;
        for (var L2 = 1; L2 <= 3; L2++) {
          var wx = ct[0] + wd[0] * L2, wy = ct[1] + wd[1] * L2;
          if (wx < MGN || wy < MGN || wx >= W - MGN || wy >= H - MGN || tile(wx, wy) === 1) { ok2 = false; break; }
        }
        if (!ok2) continue;
        for (var L3 = 1; L3 <= 3; L3++) setT(ct[0] + wd[0] * L3, ct[1] + wd[1] * L3, 1);
        switchTx = ct[0] + wd[0] * 3; switchTy = ct[1] + wd[1] * 3;
        zones.push({
          x0: Math.min(ct[0], switchTx) - 1, y0: Math.min(ct[1], switchTy) - 1,
          x1: Math.max(ct[0], switchTx) + 1, y1: Math.max(ct[1], switchTy) + 1, kind: 'quiet'
        });
        break;
      }
    }
    if (switchTx >= 0) addPOI('l6_switch', switchTx, switchTy, {});

    /* ---------- Stage 7：POI 散布 ---------- */
    function spreadCands(minD, maxD, minPoi) {
      var out = [];
      for (var y = MGN; y < H - MGN; y++)
        for (var x = MGN; x < W - MGN; x++) {
          if (map.tiles[T(x, y)] !== 1) continue;
          var d = Math.hypot(x - spawnTx, y - spawnTy);
          if (d < minD || d > maxD) continue;
          if (nearPOI(x, y, minPoi)) continue;
          out.push([x, y]);
        }
      return out;
    }
    function farthest(points, n, minD) {
      var pts = [];
      if (!points.length) return pts;
      pts.push(rng.pick(points));
      var g2 = 0;
      while (pts.length < n && g2++ < 400) {
        var best = null, bd = -1;
        for (var t = 0; t < 24; t++) {
          var c = rng.pick(points), md = Infinity;
          for (var i = 0; i < pts.length; i++) {
            var dd = (c[0] - pts[i][0]) * (c[0] - pts[i][0]) + (c[1] - pts[i][1]) * (c[1] - pts[i][1]);
            if (dd < md) md = dd;
          }
          if (md > bd) { bd = md; best = c; }
        }
        if (minD && bd < minD * minD) break;
        pts.push(best);
      }
      return pts;
    }
    // 应急灯 ×4（微光导航锚点；离出生 8 格外散布）
    var emPts = farthest(spreadCands(8, 60, 7), 4, 9);
    emPts.forEach(function (pt) { addPOI('l6_emlight', pt[0], pt[1], {}); });
    // 荧光标记 ×8（出生区附近维修道，弱引导）
    var glowCands = corrTiles.filter(function (t) {
      return Math.hypot(t[0] - spawnTx, t[1] - spawnTy) < 26 && !nearPOI(t[0], t[1], 3);
    });
    var glowPts = farthest(glowCands.length ? glowCands : spreadCands(3, 26, 3), 8, 4);
    glowPts.forEach(function (pt) { addPOI('l6_glow', pt[0], pt[1], {}); });
    // 补给箱 ×4
    var crateItems = ['battery', 'almond', 'bandage', 'empty'];
    var cratePts = farthest(spreadCands(6, 60, 6), 4, 8);
    cratePts.forEach(function (pt, i) {
      addPOI('crate', pt[0], pt[1], { item: crateItems[i % crateItems.length] });
    });
    // 字条 ×4（noteId 固定顺序，lv 侧配文案）
    var notePts = farthest(spreadCands(5, 60, 6), 4, 8);
    notePts.forEach(function (pt, i) {
      addPOI('note', pt[0], pt[1], { noteId: 'L6_note' + i });
    });
    // Mimicry 区：维修道交叉口附近 5×5（zone only + 一张字条警示）
    var mimPlaced = false;
    for (var mti = 0; mti < ctries.length && !mimPlaced; mti += 7) {
      var mt = ctries[mti];
      if (Math.hypot(mt[0] - spawnTx, mt[1] - spawnTy) < 12) continue;
      if (nearPOI(mt[0], mt[1], 4)) continue;
      zones.push({ x0: mt[0] - 2, y0: mt[1] - 2, x1: mt[0] + 2, y1: mt[1] + 2, kind: 'mimic' });
      addPOI('note', mt[0], mt[1], { noteId: 'L6_mimic' });
      mimPlaced = true;
    }
    // 薄墙 ×1~2（随机切出；离出生 6 格外）
    (function placeThinWallsLocal(count) {
      var placed = 0, g3 = 0;
      var sts = spreadCands(6, 60, 0);
      while (placed < count && g3++ < 120 && sts.length) {
        var t = rng.pick(sts);
        var dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]), wall = null;
        for (var d = 0; d < 4; d++) {
          var wx = t[0] + dirs[d][0], wy = t[1] + dirs[d][1];
          if (wx < 1 || wy < 1 || wx >= W - 1 || wy >= H - 1) continue;
          if (tile(wx, wy) !== 1) { wall = dirs[d]; break; }
        }
        if (!wall) continue;
        var dup = false;
        for (var k = 0; k < map.pois.length; k++) {
          var p = map.pois[k];
          if (p.type === 'thin_wall' && Math.hypot(p.tx - t[0], p.ty - t[1]) < 8) { dup = true; break; }
        }
        if (dup) continue;
        addPOI('thin_wall', t[0], t[1], { dx: wall[0], dz: wall[1] });
        placed++;
      }
    })(1 + rng.int(0, 1));

    /* ---------- Stage 8：连通性修补（全部地板从出生可达） ---------- */
    var dist0 = flood(spawnTx, spawnTy);
    for (var fy = MGN; fy < H - MGN; fy++)
      for (var fx = MGN; fx < W - MGN; fx++) {
        if (map.tiles[T(fx, fy)] !== 1 || dist0[T(fx, fy)] >= 0) continue;
        var bx = -1, by = -1, bd = Infinity;
        for (var gy = MGN; gy < H - MGN; gy++)
          for (var gx = MGN; gx < W - MGN; gx++) {
            if (dist0[T(gx, gy)] < 0) continue;
            var dd = Math.abs(gx - fx) + Math.abs(gy - fy);
            if (dd < bd) { bd = dd; bx = gx; by = gy; }
          }
        if (bx < 0) continue;
        var cx2 = fx;
        while (cx2 !== bx) { setT(cx2, fy, 1); cx2 += (bx > cx2 ? 1 : -1); }
        var cy2 = fy;
        while (cy2 !== by) { setT(bx, cy2, 1); cy2 += (by > cy2 ? 1 : -1); }
        setT(bx, by, 1);
        zones.push({
          x0: Math.min(fx, bx), y0: Math.min(fy, by),
          x1: Math.max(fx, bx), y1: Math.max(fy, by), kind: 'corr'
        });
        dist0 = flood(spawnTx, spawnTy);
      }

    /* ---------- Stage 9：rooms 登记（测试/哈希用） ---------- */
    var baseRooms = sectors.map(function (s, i) {
      return {
        id: 'l6r' + i, x: s.x0, y: s.y0, w: s.x1 - s.x0 + 1, h: s.y1 - s.y0 + 1,
        cx: s.cx, cy: s.cy, tag: s.kind === 'duty' ? 'spawn' : ''
      };
    });
    baseRooms.push({
      id: 'l6stair', x: stairTx - 1, y: stairTy - 1, w: 3, h: 3,
      cx: stairTx, cy: stairTy, tag: 'exit'
    });
    // 通用断言要求房间数 14~22：拆最大的普通房间（不拆值班室/楼梯间）
    var rseq = 0;
    while (baseRooms.length < 14) {
      var cands = baseRooms.filter(function (r) { return r.tag === ''; })
        .sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
      var big = cands[0];
      if (!big || big.w < 4 || big.h < 4) break;
      var bi = baseRooms.indexOf(big);
      baseRooms.splice(bi, 1);
      var a2, b2;
      if (big.w >= big.h) {
        var cw = Math.max(2, big.w >> 1);
        a2 = { id: 'l6s' + (rseq++), x: big.x, y: big.y, w: cw, h: big.h, tag: '' };
        b2 = { id: 'l6s' + (rseq++), x: big.x + cw, y: big.y, w: big.w - cw, h: big.h, tag: '' };
      } else {
        var ch = Math.max(2, big.h >> 1);
        a2 = { id: 'l6s' + (rseq++), x: big.x, y: big.y, w: big.w, h: ch, tag: '' };
        b2 = { id: 'l6s' + (rseq++), x: big.x, y: big.y + ch, w: big.w, h: big.h - ch, tag: '' };
      }
      [a2, b2].forEach(function (r) {
        r.cx = r.x + (r.w - 1) / 2; r.cy = r.y + (r.h - 1) / 2;
        baseRooms.push(r);
      });
    }
    map.rooms = baseRooms;

    map.meta.l6 = {
      zones: zones,
      machineBlocks: machineBlocks,
      stairwell: { tx: stairTx, ty: stairTy },
      duty: { tx: spawnTx, ty: spawnTy, x0: duty.x0, y0: duty.y0, x1: duty.x1, y1: duty.y1 },
      sectorKinds: sectors.map(function (s) { return s.kind; })
    };
  }
})();
