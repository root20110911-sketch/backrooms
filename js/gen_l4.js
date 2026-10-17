/* gen_l4.js —— Level 4「废弃办公室」地图生成
 * 办公楼空间逻辑（不是 L0 换皮）：走廊网格把整层划分成 16 个街区——
 * 开放办公区（格子间阵列）/独立办公室/会议室/茶水间/档案室/
 * 停车场/电梯厅/楼梯间/循环办公室。
 *
 * 原著依据（Wikidot backrooms-wiki level-4，2025-05 修订）：
 *  - 空置办公楼，几乎没有家具；窗户多被封死，未封死的窗户是陷阱、必须避开；
 *  - 实体极少（只观测到 Hounds / Dullers），Smiler 目击无证据；
 *  - 杏仁水最丰富的层（饮水机/自动贩卖机/喷泉）；
 *  - 出口多为办公楼梯/电梯（→L5/L6，或回 L3）；出口一旦移开视线可能消失；
 *  - M.E.G. Base Omega 等据点（本作不做 NPC，只留环境叙事）。
 * Fandom / Enter-the-Backrooms 等游戏向 wiki 另有电梯 95%→L5 等规则，
 *  与本作关卡表（无 L5/L6）不兼容，未采用。
 * 本作改编（报告中会逐项标注）：出口方向收敛到已有关卡 L1/L2/L3；
 *  L2 方向的门对应原著“L2 有扇没上锁的门可到 L4”的反向；停车场→L1 取自
 *  backrooms-noclip wiki（“一楼停车场通往 Level 1”）；雕花木门→L5 因本作
 *  无 L5，改为“门后虚空 + 移开视线消失”的异常门。
 *
 * 铁律：只用传入的 rng，禁用 Math.random / Date / DOM / THREE。
 */
(function () {
  var _g = (typeof window !== 'undefined') ? window : globalThis;
  var BR = _g.BR || (_g.BR = {});

  /* ================= 贴图（确定性绘制，只用 pr） ================= */
  function pr(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function speckle(x, w, h, n, cols, seed) {
    for (var i = 0; i < n; i++) {
      x.fillStyle = cols[(pr(seed + i) * cols.length) | 0];
      x.fillRect(pr(seed + 5000 + i) * w, pr(seed + 9000 + i) * h, 2, 2);
    }
  }

  // l4_wall：办公墙（暖灰 + 踢脚线）
  BR.Textures.registerTex('l4_wall', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#c7c0b1'; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 900, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.05)'], 11);
    x.fillStyle = 'rgba(60,55,48,0.9)'; x.fillRect(0, h - 14, w, 14); // 踢脚线
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(0, h - 16, w, 2);
    return c;
  });
  // l4_carpet：蓝灰地毯
  BR.Textures.registerTex('l4_carpet', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#44566b'; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 2600, ['rgba(0,0,0,0.10)', 'rgba(255,255,255,0.05)', 'rgba(20,30,45,0.12)'], 77);
    return c;
  });
  // l4_cubicle：隔断织物
  BR.Textures.registerTex('l4_cubicle', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#7d838b'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < w; i += 3) {
      x.fillStyle = pr(i) < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
      x.fillRect(i, 0, 1, h);
    }
    speckle(x, w, h, 500, ['rgba(0,0,0,0.08)'], 913);
    return c;
  });
  // l4_desk：木纹桌面
  BR.Textures.registerTex('l4_desk', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#8a6c46'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 26; i++) {
      x.strokeStyle = 'rgba(60,40,20,' + (0.10 + pr(i) * 0.12) + ')';
      x.lineWidth = 1 + pr(300 + i) * 2;
      x.beginPath();
      var yy = pr(500 + i) * h;
      x.moveTo(0, yy);
      x.bezierCurveTo(w * 0.3, yy + (pr(700 + i) - 0.5) * 14, w * 0.7, yy + (pr(900 + i) - 0.5) * 14, w, yy);
      x.stroke();
    }
    return c;
  });
  // l4_void：窗外虚空（凝固的风暴夜 + 不可能的纵深）
  BR.Textures.registerTex('l4_void', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#04060b'); g.addColorStop(0.55, '#0a0e18'); g.addColorStop(1, '#030406');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 130; i++) { // 远处凝固的光点
      var a = 0.15 + pr(100 + i) * 0.5;
      x.fillStyle = 'rgba(180,200,230,' + a.toFixed(2) + ')';
      var r = pr(400 + i) < 0.85 ? 1 : 2;
      x.fillRect(pr(700 + i) * w, pr(1000 + i) * h * 0.7, r, r);
    }
    x.strokeStyle = 'rgba(90,110,150,0.16)'; // 不可能的纵深：同心矩形
    for (var k = 1; k <= 5; k++) {
      x.lineWidth = 2;
      x.strokeRect(w * 0.5 - k * w * 0.09, h * 0.42 - k * h * 0.07, k * w * 0.18, k * h * 0.14);
    }
    return c;
  });
  // l4_blackout：被封死的窗（黑纸 + 胶带十字）
  BR.Textures.registerTex('l4_blackout', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#0b0b0d'; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 200, ['rgba(255,255,255,0.03)'], 55);
    x.strokeStyle = 'rgba(120,115,100,0.5)'; x.lineWidth = 10;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.stroke();
    x.beginPath(); x.moveTo(w, 0); x.lineTo(0, h); x.stroke();
    return c;
  });
  // l4_loop：循环办公室视错觉（递归的办公室）
  BR.Textures.registerTex('l4_loop', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#b9b2a4'; x.fillRect(0, 0, w, h);
    for (var k = 6; k >= 1; k--) {
      var s = k / 6, ww = w * 0.86 * s, hh = h * 0.8 * s;
      var ox = (w - ww) / 2, oy = (h - hh) / 2;
      x.fillStyle = k % 2 ? '#a8a193' : '#c7c0b1';
      x.fillRect(ox, oy, ww, hh);
      x.strokeStyle = 'rgba(40,38,34,0.65)'; x.lineWidth = 3;
      x.strokeRect(ox, oy, ww, hh);
      x.fillStyle = 'rgba(70,60,45,0.8)'; // 递归的桌子
      x.fillRect(ox + ww * 0.2, oy + hh * 0.62, ww * 0.6, hh * 0.08);
      x.fillStyle = 'rgba(30,34,40,0.85)'; // 递归的显示器
      x.fillRect(ox + ww * 0.42, oy + hh * 0.44, ww * 0.16, hh * 0.14);
    }
    return c;
  });
  // l4_elev：电梯拉丝金属门
  BR.Textures.registerTex('l4_elev', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#9aa0a8'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < w; i += 2) {
      x.fillStyle = pr(i * 3) < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
      x.fillRect(i, 0, 1, h);
    }
    x.fillStyle = 'rgba(20,22,26,0.85)'; x.fillRect(w / 2 - 2, 0, 4, h); // 中缝
    return c;
  });
  // l4_wood：木门
  BR.Textures.registerTex('l4_wood', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#6b4a2e'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(30,18,8,0.7)'; x.lineWidth = 5;
    x.strokeRect(14, 14, w - 28, h * 0.38);
    x.strokeRect(14, h * 0.48, w - 28, h * 0.44);
    speckle(x, w, h, 400, ['rgba(0,0,0,0.10)', 'rgba(255,220,170,0.06)'], 313);
    return c;
  });
  // l4_ornate：雕花木门（去 L5 的门，本作中通往虚空）
  BR.Textures.registerTex('l4_ornate', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#4a2f1a'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(220,180,120,0.55)'; x.lineWidth = 3;
    for (var k = 0; k < 3; k++) {
      x.beginPath();
      x.arc(w / 2, h * (0.25 + k * 0.25), 26 - k * 5, 0, Math.PI * 2);
      x.stroke();
    }
    x.strokeStyle = 'rgba(15,8,4,0.8)'; x.lineWidth = 8;
    x.strokeRect(6, 6, w - 12, h - 12);
    return c;
  });
  // l4_vendfront：贩卖机正面
  BR.Textures.registerTex('l4_vendfront', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#1b1e24'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(140,200,255,0.28)'; x.fillRect(w * 0.08, h * 0.06, w * 0.6, h * 0.5); // 玻璃
    var cols = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad'];
    for (var r = 0; r < 3; r++)
      for (var q = 0; q < 5; q++) {
        x.fillStyle = cols[(pr(r * 31 + q * 7) * cols.length) | 0];
        x.fillRect(w * 0.12 + q * w * 0.11, h * 0.12 + r * h * 0.13, w * 0.07, h * 0.09);
      }
    x.fillStyle = 'rgba(255,240,200,0.85)'; x.fillRect(w * 0.76, h * 0.1, w * 0.16, h * 0.05); // 灯条
    x.fillStyle = '#0c0d10'; x.fillRect(w * 0.76, h * 0.62, w * 0.16, h * 0.12); // 取货口
    return c;
  });
  // l4_exitsign：安全出口灯牌
  BR.Textures.registerTex('l4_exitsign', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#0d5c2e'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#eafff0';
    x.font = 'bold ' + ((h * 0.52) | 0) + 'px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('EXIT', w / 2, h / 2 + 2);
    return c;
  });
  // l4_whiteboard：白板（残留的字迹）
  BR.Textures.registerTex('l4_whiteboard', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#eef0ee'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(30,60,160,0.55)'; x.lineWidth = 3;
    x.beginPath(); // 没写完的箭头
    x.moveTo(w * 0.15, h * 0.6); x.quadraticCurveTo(w * 0.4, h * 0.3, w * 0.62, h * 0.55);
    x.lineTo(w * 0.55, h * 0.5); x.moveTo(w * 0.62, h * 0.55); x.lineTo(w * 0.55, h * 0.62);
    x.stroke();
    x.strokeStyle = 'rgba(160,30,30,0.5)';
    x.beginPath(); x.arc(w * 0.75, h * 0.35, h * 0.12, 0, Math.PI * 2); x.stroke(); // 红圈
    x.fillStyle = 'rgba(40,40,40,0.6)';
    x.font = ((h * 0.12) | 0) + 'px sans-serif';
    x.fillText('待办', w * 0.14, h * 0.3);
    return c;
  });
  // l4_garagefloor：车库地面（混凝土 + 车位线）
  BR.Textures.registerTex('l4_garagefloor', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#5a5c5e'; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 1200, ['rgba(0,0,0,0.10)', 'rgba(255,255,255,0.04)'], 414);
    x.strokeStyle = 'rgba(220,190,60,0.75)'; x.lineWidth = 6; // 车位线
    for (var i = 0; i < 4; i++) {
      var yy = h * (0.18 + i * 0.22);
      x.beginPath(); x.moveTo(w * 0.06, yy); x.lineTo(w * 0.94, yy); x.stroke();
    }
    return c;
  });

  BR.Textures.registerWallTex('L4', 'l4_wall');

  /* ================= 环境音：异常寂静 =================
   * 明亮但几乎无声：极低的空调底噪 + 远处荧光灯嗡鸣（慢起伏、时有时无）。
   * 纸张摩擦 / 近处嗡鸣由 lv_l4 在 hum_zone 用 addLoop 补。 */
  BR.Audio.registerAmbient('L4', function () {
    var rig = this._loopRig(function (R) {
      var n = R.noise(), f = R.filter('lowpass', 240, 0.4), g = R.gain(0.016);
      n.connect(f); f.connect(g); g.connect(R.group);
      var o = R.osc('sine', 55), og = R.gain(0.012);
      o.connect(og); og.connect(R.group);
      var lfo = R.osc('sine', 0.021), lg = R.gain(0.012);
      lfo.connect(lg); lg.connect(og.gain);
    });
    rig.target = 0.5;
    return rig;
  });

  /* ================= 关卡注册 ================= */
  BR.Gen.registerLevel('L4',
    { rw: [5, 10], rh: [5, 10], corrW: [2, 2], loops: [6, 10], wallH: 3 },
    placeL4,
    ['spawn', 'exit_elevator', 'exit_stair', 'exit_garage', 'cabinet', 'note']
  );

  /* ================= placer =================
   * 56×56。走廊网格（2 宽）：x/y ∈ {13,14},{27,28},{41,42}，
   * 切出 4×4=16 个街区；每街区外圈 1 tile 为墙（门洞除外）。
   * 街区带：[4..12],[15..26],[29..40],[43..51]（内径 7/10/10/7）。
   */
  function placeL4(map, rng) {
    var W = map.w, H = map.h, MGN = 2;
    function T(x, y) { return y * W + x; }
    function tile(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      return map.tiles[T(x, y)];
    }
    function setT(x, y, v) {
      if (x >= MGN && y >= MGN && x < W - MGN && y < H - MGN) map.tiles[T(x, y)] = v;
    }
    function addPOI(type, tx, ty, data) {
      var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
      map.pois.push(p);
      return p;
    }
    function farthest(points, n, minD) {
      var pts = [];
      if (!points.length) return pts;
      pts.push(rng.pick(points));
      var guard = 0;
      while (pts.length < n && guard++ < 400) {
        var best = null, bd = -1;
        for (var t = 0; t < 24; t++) {
          var c = rng.pick(points), md = Infinity;
          for (var i = 0; i < pts.length; i++) {
            var d = (c[0] - pts[i][0]) * (c[0] - pts[i][0]) + (c[1] - pts[i][1]) * (c[1] - pts[i][1]);
            if (d < md) md = d;
          }
          if (md > bd) { bd = md; best = c; }
        }
        if (minD && bd < minD * minD) break;
        pts.push(best);
      }
      return pts;
    }
    function nearPOI(tx, ty, r) {
      for (var i = 0; i < map.pois.length; i++) {
        var p = map.pois[i];
        if (Math.hypot(p.tx - tx, p.ty - ty) < r) return true;
      }
      return false;
    }
    // 把 (tx,ty) 吸附到街区 b 内的最近地板（防落在独立办公室十字墙等内部墙上）
    function snapFloor(b, tx, ty) {
      if (tile(tx, ty) === 1) return [tx, ty];
      var best = null, bd = Infinity;
      for (var yy = b.iy0; yy <= b.iy1; yy++)
        for (var xx = b.ix0; xx <= b.ix1; xx++) {
          if (tile(xx, yy) !== 1) continue;
          var d = (xx - tx) * (xx - tx) + (yy - ty) * (yy - ty);
          if (d < bd) { bd = d; best = [xx, yy]; }
        }
      return best || [tx, ty];
    }

    /* ---------- Stage 0：清空（gen.js 的房间+走廊作废，办公楼自己画） ---------- */
    for (var ci = 0; ci < map.tiles.length; ci++) map.tiles[ci] = 0;
    map.rooms.length = 0;

    /* ---------- Stage 1：楼板 + 走廊网格 ---------- */
    var XB = [[4, 12], [15, 26], [29, 40], [43, 51]];
    var YB = [[4, 12], [15, 26], [29, 40], [43, 51]];
    var CORR = [13, 27, 41]; // 走廊占 c,c+1
    var x, y, i;
    for (y = 4; y <= 51; y++) for (x = 4; x <= 51; x++) setT(x, y, 1);
    function isCorr(x, y) {
      for (var k = 0; k < 3; k++) {
        if ((x === CORR[k] || x === CORR[k] + 1) && y >= 4 && y <= 51) return true;
        if ((y === CORR[k] || y === CORR[k] + 1) && x >= 4 && x <= 51) return true;
      }
      return false;
    }

    /* ---------- Stage 2：街区分区 ---------- */
    var blocks = [];
    for (var by = 0; by < 4; by++) for (var bx = 0; bx < 4; bx++) {
      blocks.push({
        id: 'b' + bx + '_' + by, bx: bx, by: by,
        x0: XB[bx][0], x1: XB[bx][1], y0: YB[by][0], y1: YB[by][1],
        ix0: XB[bx][0] + 1, ix1: XB[bx][1] - 1, iy0: YB[by][0] + 1, iy1: YB[by][1] - 1,
        zone: 'open_office'
      });
    }
    function bAt(bx, by) { return blocks[by * 4 + bx]; }
    function bDist(a, b) { return Math.abs(a.bx - b.bx) + Math.abs(a.by - b.by); }
    // 街区外圈砌墙（门洞稍后按区开）
    blocks.forEach(function (b) {
      for (x = b.x0; x <= b.x1; x++) { setT(x, b.y0, 0); setT(x, b.y1, 0); }
      for (y = b.y0; y <= b.y1; y++) { setT(b.x0, y, 0); setT(b.x1, y, 0); }
    });
    // 走廊朝向：街区某侧是否临走廊
    function corrSides(b) {
      var s = [];
      if (b.bx > 0) s.push('w');
      if (b.bx < 3) s.push('e');
      if (b.by > 0) s.push('n');
      if (b.by < 3) s.push('s');
      return s;
    }
    // 在街区外圈墙上开门洞（side 侧、中心 at、宽 w）
    function ringDoor(b, side, at, w) {
      for (i = 0; i < w; i++) {
        var t = at - ((w - 1) >> 1) + i;
        if (side === 'n') setT(t, b.y0, 1);
        else if (side === 's') setT(t, b.y1, 1);
        else if (side === 'w') setT(b.x0, t, 1);
        else setT(b.x1, t, 1);
      }
    }
    function sideCenter(b, side) {
      return (side === 'n' || side === 's') ? ((b.x0 + b.x1) >> 1) : ((b.y0 + b.y1) >> 1);
    }
    function openSides(b, w) { // 每个临走廊侧开 w 宽门洞
      var ss = corrSides(b);
      for (var k = 0; k < ss.length; k++) ringDoor(b, ss[k], sideCenter(b, ss[k]), w);
    }

    // 分区：先定必需区（带约束），剩下全是开放办公区
    var used = {};
    function claim(b, zone) { b.zone = zone; used[b.id] = 1; }
    var inner = blocks.filter(function (b) { return b.bx >= 1 && b.bx <= 2 && b.by >= 1 && b.by <= 2; });
    var corners = [bAt(0, 0), bAt(0, 3), bAt(3, 0), bAt(3, 3)];
    var elevB = rng.pick(rng.shuffle(inner.slice()));
    claim(elevB, 'elevator_lobby');
    var garC = rng.shuffle(corners.slice());
    var garB = null;
    for (i = 0; i < garC.length; i++) if (bDist(garC[i], elevB) >= 3) { garB = garC[i]; break; }
    if (!garB) garB = garC[0];
    claim(garB, 'garage');
    var stairC = rng.shuffle(blocks.filter(function (b) { return !used[b.id] && bDist(b, elevB) >= 3 && bDist(b, garB) >= 2; }));
    if (!stairC.length) stairC = rng.shuffle(blocks.filter(function (b) { return !used[b.id]; }));
    var stairB = stairC[0];
    claim(stairB, 'stair_room');
    var loopC = rng.shuffle(blocks.filter(function (b) { return !used[b.id] && bDist(b, elevB) >= 2; }));
    claim(loopC[0], 'loop_office');
    var rest = rng.shuffle(blocks.filter(function (b) { return !used[b.id]; }));
    claim(rest[0], 'break_room');
    claim(rest[1], 'archive');
    // 独立办公室不放在角落（角落格子间有两面外墙、门不好开）
    var nonCorner = rest.slice(2).filter(function (b) {
      return !((b.bx === 0 || b.bx === 3) && (b.by === 0 || b.by === 3));
    });
    var privates = nonCorner.slice(0, 2);
    claim(privates[0], 'private_offices');
    claim(privates[1], 'private_offices');
    var meetC = rest.slice(2).filter(function (b) { return privates.indexOf(b) < 0; });
    claim(meetC[0], 'meeting_room');
    claim(meetC[1], 'meeting_room');
    // 其余 → open_office（默认已是）

    /* ---------- Stage 3：各区内部 ---------- */
    blocks.forEach(function (b) {
      if (b.zone === 'open_office') { openSides(b, 3); }
      else if (b.zone === 'meeting_room') { openSides(b, 2); }
      else if (b.zone === 'break_room') { openSides(b, 2); }
      else if (b.zone === 'archive') { openSides(b, 2); }
      else if (b.zone === 'elevator_lobby') {
        openSides(b, 3);
        // 电梯井：2×2 实心墙体，门朝南
        var cx = ((b.ix0 + b.ix1) >> 1), cy = ((b.iy0 + b.iy1) >> 1);
        for (y = cy; y <= cy + 1; y++) for (x = cx - 1; x <= cx; x++) setT(x, y, 0);
        b.elevCore = { x0: cx - 1, x1: cx, y0: cy, y1: cy + 1, doorTx: cx - 1, doorTy: cy + 1 };
        addPOI('exit_elevator', cx - 1, cy + 2, { wtx: cx - 1, wty: cy + 1, side: 's' });
        addPOI('spawn', cx + 2, b.iy1 - 1, {});
      }
      else if (b.zone === 'garage') {
        openSides(b, 4);
        // 混凝土柱阵
        var px = [b.ix0 + 2, b.ix1 - 2], py = [b.iy0 + 2, b.iy1 - 2];
        for (i = 0; i < 2; i++) for (var j = 0; j < 2; j++) setT(px[i], py[j], 0);
        addPOI('exit_garage', b.ix1 - 1, b.iy1 - 1, {});
      }
      else if (b.zone === 'stair_room') {
        // 入口门洞 1 tile（临走廊侧任选），出口楼梯门在另一侧墙上
        var ss = corrSides(b);
        ringDoor(b, ss[0], sideCenter(b, ss[0]), 1);
        var es = ss.length > 1 ? ss[1] : ss[0];
        var ex = sideCenter(b, es), wx, wy, fx, fy;
        if (es === 'n') { wx = ex; wy = b.y0; fx = ex; fy = b.y0 + 1; }
        else if (es === 's') { wx = ex; wy = b.y1; fx = ex; fy = b.y1 - 1; }
        else if (es === 'w') { wx = b.x0; wy = ex; fx = b.x0 + 1; fy = ex; }
        else { wx = b.x1; wy = ex; fx = b.x1 - 1; fy = ex; }
        addPOI('exit_stair', fx, fy, { wtx: wx, wty: wy, side: es });
      }
      else if (b.zone === 'loop_office') {
        var ls = corrSides(b);
        ringDoor(b, ls[0], sideCenter(b, ls[0]), 1);
        addPOI('loop_room', (b.ix0 + b.ix1) >> 1, (b.iy0 + b.iy1) >> 1, {});
      }
      else if (b.zone === 'private_offices') {
        // 2×2 独立办公室：十字隔墙 + 每间 1 扇门（朝临走廊侧开）
        var mx = ((b.ix0 + b.ix1) >> 1), my = ((b.iy0 + b.iy1) >> 1);
        for (x = b.ix0; x <= b.ix1; x++) setT(x, my, 0);
        for (y = b.iy0; y <= b.iy1; y++) setT(mx, y, 0);
        var cells = [
          { x0: b.ix0, x1: mx - 1, y0: b.iy0, y1: my - 1 },
          { x0: mx + 1, x1: b.ix1, y0: b.iy0, y1: my - 1 },
          { x0: b.ix0, x1: mx - 1, y0: my + 1, y1: b.iy1 },
          { x0: mx + 1, x1: b.ix1, y0: my + 1, y1: b.iy1 }
        ];
        cells.forEach(function (cl) {
          var placed = false;
          var trySide = function (side) {
            if (placed) return;
            if (corrSides(b).indexOf(side) < 0) return;
            if (side === 'n' && cl.y0 === b.iy0) { ringDoor(b, 'n', (cl.x0 + cl.x1) >> 1, 1); placed = true; }
            if (side === 's' && cl.y1 === b.iy1) { ringDoor(b, 's', (cl.x0 + cl.x1) >> 1, 1); placed = true; }
            if (side === 'w' && cl.x0 === b.ix0) { ringDoor(b, 'w', (cl.y0 + cl.y1) >> 1, 1); placed = true; }
            if (side === 'e' && cl.x1 === b.ix1) { ringDoor(b, 'e', (cl.y0 + cl.y1) >> 1, 1); placed = true; }
          };
          rng.shuffle(['n', 's', 'w', 'e']).forEach(trySide);
          if (!placed) { // 兜底（理论上走不到）：就近朝临走廊侧开门
            var cs0 = corrSides(b)[0];
            ringDoor(b, cs0, sideCenter(b, cs0), 1);
          }
        });
      }
    });

    /* ---------- Stage 4：POI ---------- */
    // 窗户：外圈街区的外墙（临建筑外侧），每 4 tile 一扇
    var winIdx = 0;
    blocks.forEach(function (b) {
      var outer = [];
      if (b.bx === 0) outer.push('w');
      if (b.bx === 3) outer.push('e');
      if (b.by === 0) outer.push('n');
      if (b.by === 3) outer.push('s');
      outer.forEach(function (side) {
        var a0, a1, fixed;
        if (side === 'w' || side === 'e') { a0 = b.y0 + 1; a1 = b.y1 - 1; fixed = (side === 'w') ? b.x0 : b.x1; }
        else { a0 = b.x0 + 1; a1 = b.x1 - 1; fixed = (side === 'n') ? b.y0 : b.y1; }
        for (var t = a0 + 1; t <= a1; t += 4) {
          var wx = (side === 'w' || side === 'e') ? fixed : t;
          var wy = (side === 'w' || side === 'e') ? t : fixed;
          var fx = wx + (side === 'w' ? 1 : side === 'e' ? -1 : 0);
          var fy = wy + (side === 'n' ? 1 : side === 's' ? -1 : 0);
          if (tile(fx, fy) !== 1) continue;
          addPOI('window', fx, fy, { wtx: wx, wty: wy, side: side, blacked: rng.chance(0.7) ? 1 : 0, idx: winIdx++ });
        }
      });
    });

    // 文件柜：档案室沿墙一排 + 开放办公区/独立办公室若干
    var cabIdx = 0;
    function cabRow(b, n) {
      for (i = 0; i < n; i++) {
        var tx = b.ix0 + 1 + i * 2;
        if (tx > b.ix1 - 1) break;
        if (tile(tx, b.iy0) !== 1) continue; // 十字墙等：跳过
        addPOI('cabinet', tx, b.iy0, { idx: cabIdx++ });
      }
    }
    blocks.forEach(function (b) {
      if (b.zone === 'archive') cabRow(b, 6);
      else if (b.zone === 'open_office' && rng.chance(0.4)) cabRow(b, 2);
      else if (b.zone === 'private_offices' && rng.chance(0.5)) {
        addPOI('cabinet', b.ix0 + 1, b.iy0, { idx: cabIdx++ });
      }
    });

    // 字条 ×5：办公室墙边
    var noteBlocks = rng.shuffle(blocks.filter(function (b) {
      return b.zone === 'open_office' || b.zone === 'private_offices' || b.zone === 'meeting_room';
    }));
    for (i = 0; i < 5 && i < noteBlocks.length; i++) {
      var nb = noteBlocks[i];
      addPOI('note', nb.ix0 + 1, nb.iy0 + 2, { noteId: 'L4_note' + i });
    }

    // 茶水间：贩卖机 ×2（一台故障）+ 饮水机
    var brk = blocks.filter(function (b) { return b.zone === 'break_room'; })[0];
    addPOI('vending', brk.ix0 + 1, brk.iy0 + 1, { broken: 0, idx: 0 });
    addPOI('vending', brk.ix0 + 2, brk.iy0 + 1, { broken: 1, idx: 1 });
    addPOI('watercooler', brk.ix1 - 1, brk.iy0 + 1, {});
    // 走廊饮水机 ×1：找临墙走廊 tile
    var wcSpot = null;
    for (y = 4; y <= 51 && !wcSpot; y++) for (x = 4; x <= 51 && !wcSpot; x++) {
      if (!isCorr(x, y) || tile(x, y) !== 1 || nearPOI(x, y, 3)) continue;
      if (tile(x + 1, y) === 0 || tile(x - 1, y) === 0 || tile(x, y + 1) === 0 || tile(x, y - 1) === 0)
        wcSpot = [x, y];
    }
    if (wcSpot) addPOI('watercooler', wcSpot[0], wcSpot[1], {});

    // 雕花木门（→L5 的门，本作中为异常门）：离出生 ≥18 tile 的办公室
    var sp = null;
    for (i = 0; i < map.pois.length; i++) if (map.pois[i].type === 'spawn') sp = map.pois[i];
    var ornC = blocks.filter(function (b) {
      return (b.zone === 'open_office' || b.zone === 'private_offices' || b.zone === 'meeting_room') &&
        Math.hypot((b.x0 + b.x1) / 2 - sp.tx, (b.y0 + b.y1) / 2 - sp.ty) > 18;
    });
    if (ornC.length) {
      var ob = rng.pick(ornC), os = rng.pick(corrSides(ob)), ot = sideCenter(ob, os);
      var owx = os === 'w' ? ob.x0 : os === 'e' ? ob.x1 : ot;
      var owy = os === 'n' ? ob.y0 : os === 's' ? ob.y1 : ot;
      var ofx = owx + (os === 'w' ? 1 : os === 'e' ? -1 : 0);
      var ofy = owy + (os === 'n' ? 1 : os === 's' ? -1 : 0);
      var snapped = snapFloor(ob, ofx, ofy);
      addPOI('ornate_door', snapped[0], snapped[1], { wtx: owx, wty: owy, side: os });
    }

    // 灯管嗡鸣区 ×2：走廊上相距远的两点
    var humCands = [];
    for (y = 4; y <= 51; y++) for (x = 4; x <= 51; x++) {
      if (isCorr(x, y) && tile(x, y) === 1 && !nearPOI(x, y, 4)) humCands.push([x, y]);
    }
    var humPts = farthest(humCands, 2, 20);
    for (i = 0; i < humPts.length; i++) addPOI('hum_zone', humPts[i][0], humPts[i][1], { idx: i });

    // 薄墙 ×1-2（随机切出）：走廊临墙 tile
    (function placeThinWallsLocal(count) {
      var sts = [];
      for (y = 4; y <= 51; y++) for (x = 4; x <= 51; x++) {
        if (!isCorr(x, y) || tile(x, y) !== 1 || nearPOI(x, y, 4)) continue;
        sts.push([x, y]);
      }
      var placed = 0, guard = 0;
      while (placed < count && guard++ < 120 && sts.length) {
        var t = rng.pick(sts);
        var dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]), wall = null;
        for (var d = 0; d < 4; d++) {
          var wx2 = t[0] + dirs[d][0], wy2 = t[1] + dirs[d][1];
          if (wx2 < 2 || wy2 < 2 || wx2 >= W - 2 || wy2 >= H - 2) continue;
          if (tile(wx2, wy2) !== 1) { wall = dirs[d]; break; }
        }
        if (!wall) continue;
        if (sp && Math.hypot(t[0] - sp.tx, t[1] - sp.ty) < 6) continue;
        addPOI('thin_wall', t[0], t[1], { dx: wall[0], dz: wall[1] });
        placed++;
      }
    })(1 + rng.int(0, 1));

    /* ---------- Stage 5：meta（给 lv_l4 的街区描述） ---------- */
    map.meta.l4 = {
      blocks: blocks.map(function (b) {
        return {
          id: b.id, zone: b.zone,
          x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1,
          ix0: b.ix0, iy0: b.iy0, ix1: b.ix1, iy1: b.iy1,
          elevCore: b.elevCore || null
        };
      })
    };
  }
})();
