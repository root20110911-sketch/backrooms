/* gen_l11.js —— Level 11「无垠城市·混凝土森林」地图生成
 * v1.5 重构（W4）：真正的城市生成器。生成顺序严格遵守：
 *   主道路+大路口 → 次级路/巷道/街区 → 建筑占地与高度 → 立面/可进入空间 → 路灯/井盖/路牌细节
 * 铁律：只用传入的 rng，禁用 Math.random / Date / DOM / THREE。
 * 版本取舍（见 LORE.md）：荒凉无序的混凝土森林版，不做"大量居民和安全基地"版。
 */
(function () {
  var _g = (typeof window !== 'undefined') ? window : globalThis;
  var BR = _g.BR || (_g.BR = {});

  /* ================= 贴图（确定性绘制，只用 pr） ================= */
  function pr(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // city_road：沥青路面（深灰 + 噪点 + 裂缝），低饱和
  BR.Textures.registerTex('city_road', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#33363b'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 2400; i++) {
      var g = 40 + ((pr(i) * 30) | 0);
      x.fillStyle = 'rgb(' + g + ',' + (g + 2) + ',' + (g + 5) + ')';
      x.fillRect(pr(5000 + i) * w, pr(6000 + i) * h, 2, 2);
    }
    x.strokeStyle = 'rgba(15,16,18,0.55)'; x.lineWidth = 2;
    for (var k = 0; k < 4; k++) {
      x.beginPath();
      var sx = pr(7000 + k) * w, sy = pr(7100 + k) * h;
      x.moveTo(sx, sy);
      for (var s = 1; s <= 5; s++) x.lineTo(sx + (pr(7200 + k * 10 + s) - 0.5) * 90, sy + s * 22);
      x.stroke();
    }
    return c;
  });

  // 立面贴图：三种低饱和风格 + 窗户网格（大多熄灯，偶有昏黄）
  // mis=1：窗户行与楼层错位（空间异常用）；salt 改变亮窗分布（重排变体用）
  function facadePainter(base, mortar, mis, salt) {
    return function (w, h) {
      var c = mkCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = base; x.fillRect(0, 0, w, h);
      var rows = 8, cols = 8, cw = w / cols, chh = h / rows;
      for (var r = 0; r < rows; r++) {
        for (var q = 0; q < cols; q++) {
          var wy = r * chh + (mis ? ((q % 2) * chh * 0.5) : 0); // 错位：奇偶列差半层
          var lit = pr(r * 131 + q * 17 + (mis ? 777 : 0) + (salt || 0)) < 0.06;
          x.fillStyle = lit ? 'rgba(150,125,70,0.85)' : 'rgba(12,15,20,0.92)';
          x.fillRect(q * cw + cw * 0.22, (wy % h) + chh * 0.24, cw * 0.56, chh * 0.52);
          x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 2;
          x.strokeRect(q * cw + cw * 0.22, (wy % h) + chh * 0.24, cw * 0.56, chh * 0.52);
        }
      }
      // 污渍
      for (var i = 0; i < 200; i++) {
        x.fillStyle = pr(3000 + i) < 0.6 ? 'rgba(0,0,0,0.10)' : 'rgba(255,250,240,0.04)';
        x.fillRect(pr(4000 + i) * w, pr(5000 + i) * h, 3, 3);
      }
      x.fillStyle = 'rgba(10,10,12,0.5)'; x.fillRect(0, h - 10, w, 10); // 底部污边
      return c;
    };
  }
  BR.Textures.registerTex('fac_brick', facadePainter('#54463e', '#3a312c', 0, 0));
  BR.Textures.registerTex('fac_conc', facadePainter('#5f6266', '#4a4d52', 0, 0));
  BR.Textures.registerTex('fac_panel', facadePainter('#565b63', '#43474e', 0, 0));
  BR.Textures.registerTex('fac_brick_mis', facadePainter('#54463e', '#3a312c', 1, 0)); // 窗户错位异常
  BR.Textures.registerTex('fac_conc_mis', facadePainter('#5f6266', '#4a4d52', 1, 0));  // 窗户错位异常
  // _b：重排变体（同风格、窗光分布不同；只用于远楼，不动几何/碰撞）
  BR.Textures.registerTex('fac_brick_b', facadePainter('#54463e', '#3a312c', 0, 4242));
  BR.Textures.registerTex('fac_conc_b', facadePainter('#5f6266', '#4a4d52', 0, 4242));
  BR.Textures.registerTex('fac_panel_b', facadePainter('#565b63', '#43474e', 0, 4242));
  BR.Textures.registerTex('fac_brick_mis_b', facadePainter('#54463e', '#3a312c', 1, 4242));
  BR.Textures.registerTex('fac_conc_mis_b', facadePainter('#5f6266', '#4a4d52', 1, 4242));
  // roof_top：楼顶（深灰 + 防水卷材条纹）
  BR.Textures.registerTex('roof_top', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#2c2e33'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,0.25)';
    for (var i = 0; i < h; i += 18) x.fillRect(0, i, w, 3);
    for (var j = 0; j < 160; j++) {
      x.fillStyle = 'rgba(255,255,255,0.04)';
      x.fillRect(pr(6000 + j) * w, pr(7000 + j) * h, 2, 2);
    }
    return c;
  });
  // manhole_lid：圆形井盖（深色金属 + 同心环 + 铰链缺口）
  BR.Textures.registerTex('manhole_lid', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#26282c'; x.fillRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, r = w * 0.44;
    x.fillStyle = '#3a3d42';
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#17181b'; x.lineWidth = 5;
    for (var k = 1; k <= 3; k++) { x.beginPath(); x.arc(cx, cy, r * k / 3.4, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = '#17181b';
    x.fillRect(cx - r * 0.7, cy - 4, r * 1.4, 8); // 防滑横条
    x.fillStyle = 'rgba(0,0,0,0.4)';
    x.beginPath(); x.arc(cx + r * 0.8, cy - r * 0.55, 7, 0, Math.PI * 2); x.fill(); // 撬孔
    return c;
  });
  // door_shut：明确关闭的入口（链条 + 封条，低饱和）
  BR.Textures.registerTex('door_shut', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#3d3a36'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#2c2a27';
    for (var i = 0; i < 6; i++) x.fillRect(8, 10 + i * (h - 20) / 6, w - 16, 4); // 门板横缝
    x.strokeStyle = '#1d1d20'; x.lineWidth = 10; // 链条
    x.beginPath(); x.moveTo(10, h * 0.42); x.lineTo(w - 10, h * 0.58); x.stroke();
    x.beginPath(); x.moveTo(10, h * 0.58); x.lineTo(w - 10, h * 0.42); x.stroke();
    x.fillStyle = 'rgba(160,150,130,0.75)'; // 封条
    x.fillRect(w * 0.3, h * 0.46, w * 0.4, h * 0.08);
    return c;
  });
  // door_anomaly：异常门（门缝透出微光）
  BR.Textures.registerTex('door_anomaly', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#46413a'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,220,150,0.5)'; x.fillRect(w / 2 - 2, 6, 4, h - 12); // 门缝光
    x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
    return c;
  });
  // shop_sign：霓虹招牌底板（"OPEN" 霓虹字；各店中文名走 note 文本）
  BR.Textures.registerTex('shop_sign', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#0d1117'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(255,120,200,0.95)'; x.lineWidth = 8; x.strokeRect(10, 10, w - 20, h - 20);
    x.strokeStyle = 'rgba(255,120,200,0.35)'; x.lineWidth = 16; x.strokeRect(10, 10, w - 20, h - 20);
    x.fillStyle = '#ffd9ec'; x.font = 'bold 92px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('OPEN', w / 2, h / 2 + 4);
    for (var i = 0; i < 300; i++) {
      x.fillStyle = 'rgba(255,255,255,0.06)';
      x.fillRect(pr(8000 + i) * w, pr(8100 + i) * h, 2, 2);
    }
    return c;
  });

  BR.Textures.registerWallTex('L11', 'fac_conc');

  /* ================= 环境音：风声 + 远处金属结构声 + 空旷回响感 ================= */
  BR.Audio.registerAmbient('L11', function () {
    var rig = this._loopRig(function (R) {
      // 风声（低通噪声 + 慢速阵风调制）
      var n = R.noise(), f = R.filter('lowpass', 420, 0.5), g = R.gain(0.20);
      n.connect(f); f.connect(g); g.connect(R.group);
      var lfo = R.osc('sine', 0.07), lg = R.gain(0.09);
      lfo.connect(lg); lg.connect(g.gain);
      // 远处金属结构声：高Q带通噪声，中心频率缓慢漂移（金属呻吟）
      var n2 = R.noise(), f2 = R.filter('bandpass', 620, 9), g2 = R.gain(0.055);
      n2.connect(f2); f2.connect(g2); g2.connect(R.group);
      var lfo2 = R.osc('sine', 0.043), lg2 = R.gain(200);
      lfo2.connect(lg2); lg2.connect(f2.frequency);
      var n3 = R.noise(), f3 = R.filter('bandpass', 240, 12), g3 = R.gain(0.04);
      n3.connect(f3); f3.connect(g3); g3.connect(R.group);
      var lfo3 = R.osc('sine', 0.031), lg3 = R.gain(90);
      lfo3.connect(lg3); lg3.connect(f3.frequency);
      // 空旷回响感：极低频城市嗡鸣（缓慢起伏）
      var o1 = R.osc('sine', 48), g1 = R.gain(0.22);
      o1.connect(g1); g1.connect(R.group);
      var lfo4 = R.osc('sine', 0.05), lg4 = R.gain(0.07);
      lfo4.connect(lg4); lg4.connect(g1.gain);
    });
    rig.target = 0.42;
    return rig;
  });

  /* ================= 关卡注册 ================= */
  BR.Gen.registerLevel('L11',
    { rw: [5, 10], rh: [5, 10], corrW: [2, 2], loops: [6, 10], wallH: 3.6 },
    placeL11,
    ['spawn', 'meg_post', 'subway']
  );

  /* ================= placer =================
   * 生成顺序：主道路+大路口 → 次级路/巷道/街区 → 建筑占地与高度 → POI（立面/可进入/细节）
   * tiles：1=街道/广场/巷道/室内，0=建筑体量（碰撞走 tile；渲染由 lv_l11 按 meta.l11.buildings 自建）
   */
  function placeL11(map, rng) {
    var W = map.w, H = map.h, MGN = 2; // 外圈 2 格恒为墙（缝线契约）
    function T(x, y) { return y * W + x; }
    function tile(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      return map.tiles[T(x, y)];
    }
    function setT(x, y, v) { if (x >= 0 && y >= 0 && x < W && y < H) map.tiles[T(x, y)] = v; }
    function addPOI(type, tx, ty, data) {
      var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
      map.pois.push(p);
      return p;
    }
    function farthest(points, n, minD) { // farthest-point 散布取点
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

    /* ---------- Stage 0：清空（gen.js 的房间+走廊作废，城市自己画） ---------- */
    for (var ci = 0; ci < map.tiles.length; ci++) map.tiles[ci] = 0;
    map.rooms.length = 0;

    /* ---------- Stage 1：主道路 + 大路口 ---------- */
    // 轴对齐路段 [x1,y1,x2,y2,w]
    var ROADS = [
      // A：南北大道（3宽），y=20 处错位 jog
      [14, 2, 14, 20, 3], [14, 20, 19, 20, 3], [19, 20, 19, 54, 3],
      // B：东西大道（3宽），x=28 处错位 jog
      [2, 32, 28, 32, 3], [28, 32, 28, 36, 3], [28, 36, 54, 36, 3],
      // C：南北支干（2宽），南端 T 接 B
      [40, 2, 40, 36, 2],
      // 次级路（2宽）：有意留缺口/断头，形成 T 形口与尽端
      [8, 6, 8, 26, 2],
      [30, 6, 30, 26, 2], [30, 40, 30, 52, 2],
      [48, 8, 48, 50, 2],
      [4, 10, 26, 10, 2],
      [23, 24, 38, 24, 2],
      [6, 44, 54, 44, 2],
      [20, 50, 50, 50, 2],
      [8, 44, 8, 52, 2],
      // 局部回环：矩形环路（1宽），绕一个街区
      [33, 12, 39, 12, 1], [39, 12, 39, 18, 1], [39, 18, 33, 18, 1], [33, 18, 33, 12, 1],
      // 异常长巷道（1宽）：贯穿东侧，带两次小折
      [52, 4, 52, 24, 1], [52, 24, 50, 24, 1], [50, 24, 50, 50, 1]
    ];
    function carveSeg(x1, y1, x2, y2, w) {
      var r0 = -((w - 1) >> 1), r1 = r0 + w - 1;
      if (x1 === x2) {
        var ya = Math.min(y1, y2), yb = Math.max(y1, y2);
        for (var y = ya; y <= yb; y++)
          for (var o = r0; o <= r1; o++) setT(x1 + o, y, 1);
      } else {
        var xa = Math.min(x1, x2), xb = Math.max(x1, x2);
        for (var x = xa; x <= xb; x++)
          for (var o2 = r0; o2 <= r1; o2++) setT(x, y1 + o2, 1);
      }
    }
    for (var ri = 0; ri < ROADS.length; ri++) carveSeg(ROADS[ri][0], ROADS[ri][1], ROADS[ri][2], ROADS[ri][3], ROADS[ri][4]);
    // 大路口：A×B 交叉口 (19,32) 扩成 7×7 开阔交叉口
    for (var ix = 16; ix <= 22; ix++)
      for (var iy = 29; iy <= 35; iy++) setT(ix, iy, 1);
    // 出生广场：A 大道南段旁 5×5（干涸喷泉广场）
    for (var px = 17; px <= 21; px++)
      for (var py = 46; py <= 50; py++) setT(px, py, 1);

    /* ---------- Stage 2：次级巷道（街区内部 1 宽短巷，多为断头） ---------- */
    // 街区 = 墙体连通块；找若干大街区的临街边，向内打 2~6 格断头巷
    function wallComponents() {
      var seen = {}, comps = [];
      for (var y = MGN; y < H - MGN; y++)
        for (var x = MGN; x < W - MGN; x++) {
          if (map.tiles[T(x, y)] !== 0 || seen[T(x, y)]) continue;
          var comp = [], stack = [[x, y]];
          seen[T(x, y)] = 1;
          while (stack.length) {
            var c = stack.pop();
            comp.push(c);
            var ds = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (var d = 0; d < 4; d++) {
              var nx = c[0] + ds[d][0], ny = c[1] + ds[d][1];
              if (nx < MGN || ny < MGN || nx >= W - MGN || ny >= H - MGN) continue;
              if (map.tiles[T(nx, ny)] === 0 && !seen[T(nx, ny)]) { seen[T(nx, ny)] = 1; stack.push([nx, ny]); }
            }
          }
          comps.push(comp);
        }
      return comps;
    }
    var comps = wallComponents();
    // 按面积排序，取大街区打巷（跳过最小的碎块）
    comps.sort(function (a, b) { return b.length - a.length; });
    var alleyCount = 0;
    for (var bi = 2; bi < comps.length && alleyCount < 14; bi++) {
      var comp = comps[bi];
      if (comp.length < 30) continue;
      if (!rng.chance(0.75)) continue;
      // 找临街边 tile（4 邻域有地板）
      var edge = [];
      for (var ei = 0; ei < comp.length; ei++) {
        var ex = comp[ei][0], ey = comp[ei][1];
        if (tile(ex + 1, ey) === 1 || tile(ex - 1, ey) === 1 || tile(ex, ey + 1) === 1 || tile(ex, ey - 1) === 1)
          edge.push(comp[ei]);
      }
      if (!edge.length) continue;
      var start = rng.pick(edge);
      // 朝街区内部走：选远离街道的方向
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], sdir = null;
      for (var di = 0; di < 4; di++) {
        var sx = start[0] + dirs[di][0], sy = start[1] + dirs[di][1];
        if (tile(sx, sy) === 0 && tile(sx + dirs[di][0], sy + dirs[di][1]) === 0) { sdir = dirs[di]; break; }
      }
      if (!sdir) continue;
      var len = 2 + rng.int(0, 4), ax = start[0], ay = start[1];
      for (var ai = 0; ai < len; ai++) {
        ax += sdir[0]; ay += sdir[1];
        if (ax < MGN || ay < MGN || ax >= W - MGN || ay >= H - MGN) break;
        if (tile(ax, ay) === 1) break; // 打通到另一条街就停（保持连通，不强制断头）
        setT(ax, ay, 1);
      }
      alleyCount++;
    }

    /* ---------- 连通性修补：所有地板必须从出生广场可达 ---------- */
    function flood(sx, sy) {
      var dist = new Array(W * H).fill(-1), q = [[sx, sy]];
      dist[T(sx, sy)] = 0;
      while (q.length) {
        var c = q.pop(), cd = dist[T(c[0], c[1])];
        var ds = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d = 0; d < 4; d++) {
          var nx = c[0] + ds[d][0], ny = c[1] + ds[d][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (map.tiles[T(nx, ny)] !== 1 || dist[T(nx, ny)] >= 0) continue;
          dist[T(nx, ny)] = cd + 1; q.push([nx, ny]);
        }
      }
      return dist;
    }
    var spawnTx = 19, spawnTy = 48;
    var dist0 = flood(spawnTx, spawnTy);
    // 孤立地板：从其 tile 向最近的可达 tile 打 L 形 1 宽连接道
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
        dist0 = flood(spawnTx, spawnTy);
      }

    /* ---------- Stage 3：建筑占地与高度 ---------- */
    comps = wallComponents();
    // 碎块（<6 tile）并入记录但不单独成楼（渲染为矮护栏）
    var buildings = [], bid = 0;
    function districtOf(ty) { // 北高南低
      if (ty < 20) return 0; if (ty < 36) return 1; return 2;
    }
    function splitBox(x0, y0, x1, y1, out) {
      var w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (w <= 7 && h <= 7) { out.push([x0, y0, x1, y1]); return; }
      if (w >= h) {
        var cut = x0 + Math.max(2, Math.min(w - 2, Math.round(w * (0.38 + rng.next() * 0.24))));
        splitBox(x0, y0, cut - 1, y1, out);
        splitBox(cut + 1, y0, x1, y1, out); // 中间留 1 格墙缝
      } else {
        var cut2 = y0 + Math.max(2, Math.min(h - 2, Math.round(h * (0.38 + rng.next() * 0.24))));
        splitBox(x0, y0, x1, cut2 - 1, out);
        splitBox(x0, cut2 + 1, x1, y1, out);
      }
    }
    for (var ci2 = 0; ci2 < comps.length; ci2++) {
      var comp2 = comps[ci2];
      var x0 = 99, y0 = 99, x1 = -1, y1 = -1;
      for (var ti = 0; ti < comp2.length; ti++) {
        var tx2 = comp2[ti][0], ty2 = comp2[ti][1];
        if (tx2 < x0) x0 = tx2; if (ty2 < y0) y0 = ty2;
        if (tx2 > x1) x1 = tx2; if (ty2 > y1) y1 = ty2;
      }
      if (comp2.length < 6) {
        buildings.push({ id: bid++, x0: x0, y0: y0, x1: x1, y1: y1, h: 1.2, style: 1, setback: 0, stub: true });
        continue;
      }
      var pieces = [];
      splitBox(x0, y0, x1, y1, pieces);
      for (var pi = 0; pi < pieces.length; pi++) {
        var pc = pieces[pi], pw = pc[2] - pc[0] + 1, ph = pc[3] - pc[1] + 1;
        if (pw < 2 || ph < 2) continue;
        var d = districtOf((pc[1] + pc[3]) / 2), hh;
        if (d === 0) hh = 16 + rng.int(0, 22);
        else if (d === 1) hh = 8 + rng.int(0, 16);
        else hh = 5 + rng.int(0, 9);
        var style = rng.next() < 0.3 ? 0 : (rng.next() < 0.62 ? 1 : 2);
        buildings.push({
          id: bid++, x0: pc[0], y0: pc[1], x1: pc[2], y1: pc[3],
          h: hh, style: style,
          setback: (hh >= 16 && rng.chance(0.55)) ? 1 : 0,
          winMis: 0, enterable: null
        });
      }
    }
    // 窗户错位异常：挑 2 栋散布的高楼（立面窗户行与楼层错位，可观察）
    var tallB = buildings.filter(function (b) { return !b.stub && b.h >= 12; });
    var misIdx = farthest(tallB.map(function (b) { return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }), Math.min(2, tallB.length));
    for (var mi = 0; mi < misIdx.length; mi++) {
      for (var bi3 = 0; bi3 < tallB.length; bi3++) {
        var bb = tallB[bi3];
        if (Math.abs((bb.x0 + bb.x1) / 2 - misIdx[mi][0]) < 0.01 &&
            Math.abs((bb.y0 + bb.y1) / 2 - misIdx[mi][1]) < 0.01) { bb.winMis = 1; break; }
      }
    }
    map.meta.l11 = {
      buildings: buildings,
      longAlley: [[52, 4], [52, 24], [50, 24], [50, 50]],
      ring: { x0: 33, y0: 12, x1: 39, y1: 18 },
      junction: { x: 19, y: 32 }
    };

    // map.rooms = 街区（合并到 14~22 个，供测试与哈希）
    var rooms = comps.filter(function (c) { return c.length >= 6; }).map(function (c, i) {
      var ax0 = 99, ay0 = 99, ax1 = -1, ay1 = -1;
      for (var k = 0; k < c.length; k++) {
        if (c[k][0] < ax0) ax0 = c[k][0]; if (c[k][1] < ay0) ay0 = c[k][1];
        if (c[k][0] > ax1) ax1 = c[k][0]; if (c[k][1] > ay1) ay1 = c[k][1];
      }
      return { id: 'blk' + i, x: ax0, y: ay0, w: ax1 - ax0 + 1, h: ay1 - ay0 + 1, cx: (ax0 + ax1) / 2, cy: (ay0 + ay1) / 2, tag: 'block' };
    });
    rooms.sort(function (a, b) { return (a.w * a.h) - (b.w * b.h); });
    while (rooms.length > 22) {
      var sm = rooms.shift(), near = null, nd = Infinity;
      for (var rj = 0; rj < rooms.length; rj++) {
        var dd2 = Math.hypot(rooms[rj].cx - sm.cx, rooms[rj].cy - sm.cy);
        if (dd2 < nd) { nd = dd2; near = rooms[rj]; }
      }
      var ux0 = Math.min(sm.x, near.x), uy0 = Math.min(sm.y, near.y);
      var ux1 = Math.max(sm.x + sm.w, near.x + near.w), uy1 = Math.max(sm.y + sm.h, near.y + near.h);
      near.x = ux0; near.y = uy0; near.w = ux1 - ux0; near.h = uy1 - uy0;
      near.cx = (ux0 + ux1 - 1) / 2; near.cy = (uy0 + uy1 - 1) / 2;
    }
    // 太少时拆最大的街区（测试要求 14~22）
    var rseq = 0;
    while (rooms.length < 14) {
      var big = rooms.pop(), a2, b2;
      if (big.w >= big.h) {
        var cw = Math.max(2, big.w >> 1);
        a2 = { id: 'blkS' + (rseq++), x: big.x, y: big.y, w: cw, h: big.h, tag: 'block' };
        b2 = { id: 'blkS' + (rseq++), x: big.x + cw, y: big.y, w: big.w - cw, h: big.h, tag: 'block' };
      } else {
        var ch = Math.max(2, big.h >> 1);
        a2 = { id: 'blkS' + (rseq++), x: big.x, y: big.y, w: big.w, h: ch, tag: 'block' };
        b2 = { id: 'blkS' + (rseq++), x: big.x, y: big.y + ch, w: big.w, h: big.h - ch, tag: 'block' };
      }
      [a2, b2].forEach(function (r) { r.cx = r.x + (r.w - 1) / 2; r.cy = r.y + (r.h - 1) / 2; rooms.push(r); });
      rooms.sort(function (a, b) { return (a.w * a.h) - (b.w * b.h); });
    }
    map.rooms = rooms;

    /* ---------- Stage 4：POI（立面/可进入空间/细节） ---------- */
    function streetTiles() {
      var out = [];
      for (var y = MGN; y < H - MGN; y++)
        for (var x = MGN; x < W - MGN; x++)
          if (map.tiles[T(x, y)] === 1) out.push([x, y]);
      return out;
    }
    function nearPOI(x, y, r) {
      for (var i = 0; i < map.pois.length; i++) {
        var p = map.pois[i];
        if (Math.hypot(p.tx - x, p.ty - y) < r) return true;
      }
      return false;
    }
    // 出生广场
    addPOI('spawn', spawnTx, spawnTy, {});
    addPOI('plaza', spawnTx, spawnTy, {});
    // 地铁入口：离出生最远的街道 tile（探索发现）
    var distS = flood(spawnTx, spawnTy), farTx = spawnTx, farTy = spawnTy, farD = -1;
    for (var sy2 = MGN; sy2 < H - MGN; sy2++)
      for (var sx2 = MGN; sx2 < W - MGN; sx2++) {
        if (map.tiles[T(sx2, sy2)] !== 1) continue;
        if (distS[T(sx2, sy2)] > farD) { farD = distS[T(sx2, sy2)]; farTx = sx2; farTy = sy2; }
      }
    addPOI('subway', farTx, farTy, {});
    // MEG 前哨：中段距离的街道 tile（大路口附近）
    var megCands = streetTiles().filter(function (t) {
      var d = Math.hypot(t[0] - spawnTx, t[1] - spawnTy);
      return d > 12 && d < 30 && Math.hypot(t[0] - 19, t[1] - 32) < 10;
    });
    var megT = megCands.length ? rng.pick(megCands) : [19, 30];
    // MEG 带路路径：沿街道贪心走 8 格（朝地铁方向）
    function guidePath(sx, sy, gx, gy) {
      var path = [[sx, sy]], cx = sx, cy = sy, seen = {};
      seen[sx + ',' + sy] = 1;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var step = 0; step < 8; step++) {
        var best = null, bd = Infinity;
        for (var d = 0; d < 4; d++) {
          var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
          if (tile(nx, ny) !== 1 || seen[nx + ',' + ny]) continue;
          var dd = (nx - gx) * (nx - gx) + (ny - gy) * (ny - gy);
          if (dd < bd) { bd = dd; best = [nx, ny]; }
        }
        if (!best) break;
        cx = best[0]; cy = best[1]; seen[cx + ',' + cy] = 1; path.push([cx, cy]);
      }
      return path.length >= 5 ? path : null;
    }
    addPOI('meg_post', megT[0], megT[1], { path: guidePath(megT[0], megT[1], farTx, farTy) });
    // 流浪者营地：断头巷附近的中段街道
    var wcCands = streetTiles().filter(function (t) {
      var d = Math.hypot(t[0] - spawnTx, t[1] - spawnTy);
      return d > 10 && d < 34 && !nearPOI(t[0], t[1], 4);
    });
    var wcT = wcCands.length ? farthest(wcCands, 1)[0] : [30, 44];
    addPOI('wanderer_camp', wcT[0], wcT[1], {});

    // 可进入建筑 ×3：挑 ≥4×4、临街的大楼，内部掏空，临街开门洞
    // noPOI：室内 tile 不参与街面 POI 选址（路灯/井盖/商店/字条/箱子不上房顶进屋）
    var noPOI = {};
    var enterables = [];
    var candB = buildings.filter(function (b) {
      return !b.stub && !b.winMis && (b.x1 - b.x0 + 1) >= 4 && (b.y1 - b.y0 + 1) >= 4;
    });
    var bPts = farthest(candB.map(function (b) { return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }), 6, 9);
    // 顺序打乱多试几栋，保证 2~3 栋可进入
    var bTry = bPts.slice();
    for (var ei2 = 0; ei2 < bTry.length && enterables.length < 3; ei2++) {
      var eb = null;
      for (var bi4 = 0; bi4 < candB.length; bi4++) {
        var cb = candB[bi4];
        if (Math.abs((cb.x0 + cb.x1) / 2 - bTry[ei2][0]) < 0.01 &&
            Math.abs((cb.y0 + cb.y1) / 2 - bTry[ei2][1]) < 0.01) { eb = cb; break; }
      }
      if (!eb || enterables.indexOf(eb) >= 0) continue;
      // 找临街的一面
      var sides = [
        { dx: 0, dz: -1, t: [eb.x0, eb.y0 - 1, eb.x1, eb.y0 - 1] },
        { dx: 0, dz: 1, t: [eb.x0, eb.y1 + 1, eb.x1, eb.y1 + 1] },
        { dx: -1, dz: 0, t: [eb.x0 - 1, eb.y0, eb.x0 - 1, eb.y1] },
        { dx: 1, dz: 0, t: [eb.x1 + 1, eb.y0, eb.x1 + 1, eb.y1] }
      ];
      var side = null;
      var order = rng.shuffle(sides.slice());
      for (var si = 0; si < order.length; si++) {
        var s = order[si], ok = false;
        if (s.dx === 0) { for (var qx = s.t[0]; qx <= s.t[2]; qx++) if (tile(qx, s.t[1]) === 1) { ok = true; break; } }
        else { for (var qy = s.t[1]; qy <= s.t[3]; qy++) if (tile(s.t[0], qy) === 1) { ok = true; break; } }
        if (ok) { side = s; break; }
      }
      if (!side) continue;
      // 内部掏空（内缩 1 圈）
      var ix0 = eb.x0 + 1, iy0 = eb.y0 + 1, ix1 = eb.x1 - 1, iy1 = eb.y1 - 1;
      for (var iy3 = iy0; iy3 <= iy1; iy3++)
        for (var ix3 = ix0; ix3 <= ix1; ix3++) { setT(ix3, iy3, 1); noPOI[T(ix3, iy3)] = 1; }
      // 门洞：沿临街面找"外侧是地板且内侧连通内部"的位置（中点优先）
      var dtx = -1, dty = -1;
      if (side.dx === 0) {
        var dyOut = side.dz < 0 ? eb.y0 : eb.y1, midX = (eb.x0 + eb.x1) >> 1, oxs = [];
        for (var qx = eb.x0 + 1; qx <= eb.x1 - 1; qx++) oxs.push(qx);
        oxs.sort(function (a, b) { return Math.abs(a - midX) - Math.abs(b - midX); });
        for (var qi = 0; qi < oxs.length; qi++)
          if (tile(oxs[qi], dyOut + side.dz) === 1) { dtx = oxs[qi]; dty = dyOut; break; }
      } else {
        var dxOut = side.dx < 0 ? eb.x0 : eb.x1, midY = (eb.y0 + eb.y1) >> 1, oys = [];
        for (var qy = eb.y0 + 1; qy <= eb.y1 - 1; qy++) oys.push(qy);
        oys.sort(function (a, b) { return Math.abs(a - midY) - Math.abs(b - midY); });
        for (var qj = 0; qj < oys.length; qj++)
          if (tile(dxOut + side.dx, oys[qj]) === 1) { dtx = dxOut; dty = oys[qj]; break; }
      }
      if (dtx < 0) continue; // 找不到合法门位：放弃这栋
      setT(dtx, dty, 1);
      eb.enterable = { ix0: ix0, iy0: iy0, ix1: ix1, iy1: iy1, doorTx: dtx, doorTy: dty, outDx: side.dx, outDz: side.dz };
      enterables.push(eb);
      addPOI('bld_door', dtx, dty, { bld: eb.id });
    }

    // 异常门 ×2：临街立面（门后短走廊/砖墙，由 lv 表现）
    var anB = buildings.filter(function (b) {
      return !b.stub && !b.enterable && (b.x1 - b.x0 + 1) >= 3 && (b.y1 - b.y0 + 1) >= 3;
    });
    var anPts = farthest(anB.map(function (b) { return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }), 4, 12);
    var anPlaced = 0;
    for (var ai2 = 0; ai2 < anPts.length && anPlaced < 2; ai2++) {
      var ab = null;
      for (var bi5 = 0; bi5 < anB.length; bi5++) {
        var cab = anB[bi5];
        if (Math.abs((cab.x0 + cab.x1) / 2 - anPts[ai2][0]) < 0.01 &&
            Math.abs((cab.y0 + cab.y1) / 2 - anPts[ai2][1]) < 0.01) { ab = cab; break; }
      }
      if (!ab || ab.anomalyDoor) continue;
      var asides = rng.shuffle([
        { dx: 0, dz: -1 }, { dx: 0, dz: 1 }, { dx: -1, dz: 0 }, { dx: 1, dz: 0 }
      ]);
      for (var asi = 0; asi < asides.length; asi++) {
        var asd = asides[asi], atx, aty;
        if (asd.dx === 0) { atx = (ab.x0 + ab.x1) >> 1; aty = asd.dz < 0 ? ab.y0 : ab.y1; }
        else { atx = asd.dx < 0 ? ab.x0 : ab.x1; aty = (ab.y0 + ab.y1) >> 1; }
        if (tile(atx + asd.dx, aty + asd.dz) === 1) {
          ab.anomalyDoor = { tx: atx, ty: aty, nx: asd.dx, nz: asd.dz };
          addPOI('anomaly_door', atx + asd.dx, aty + asd.dz, { bld: ab.id, kind: rng.chance(0.5) ? 'niche' : 'bricked' });
          anPlaced++;
          break;
        }
      }
    }
    // 上不去的楼梯 ×1：多试几栋临街大楼
    var stB = rng.shuffle(buildings.filter(function (b) { return !b.stub && !b.enterable && b.h >= 10 && !b.anomalyDoor; }));
    var stPlaced = false;
    for (var sti = 0; sti < stB.length && !stPlaced; sti++) {
      var sb = stB[sti];
      var ssides = rng.shuffle([{ dx: 0, dz: -1 }, { dx: 0, dz: 1 }, { dx: -1, dz: 0 }, { dx: 1, dz: 0 }]);
      for (var ssi = 0; ssi < ssides.length; ssi++) {
        var ssd = ssides[ssi], stx, sty;
        if (ssd.dx === 0) { stx = (sb.x0 + sb.x1) >> 1; sty = ssd.dz < 0 ? sb.y0 : sb.y1; }
        else { stx = ssd.dx < 0 ? sb.x0 : sb.x1; sty = (sb.y0 + sb.y1) >> 1; }
        if (tile(stx + ssd.dx, sty + ssd.dz) === 1) {
          sb.anomalyStairs = { tx: stx, ty: sty, nx: ssd.dx, nz: ssd.dz };
          addPOI('anomaly_stairs', stx + ssd.dx, sty + ssd.dz, { bld: sb.id });
          stPlaced = true;
          break;
        }
      }
    }

    // 商店 ×3-5：临街（立面旁地板）
    var shopCands = streetTiles().filter(function (t) {
      if (noPOI[T(t[0], t[1])] || nearPOI(t[0], t[1], 5)) return false;
      return tile(t[0] + 1, t[1]) === 0 || tile(t[0] - 1, t[1]) === 0 ||
             tile(t[0], t[1] + 1) === 0 || tile(t[0], t[1] - 1) === 0;
    });
    var shopPts = farthest(shopCands, 3 + rng.int(0, 2), 8);
    var shopItems = ['almond', 'bandage'];
    for (var shi = 0; shi < shopPts.length; shi++)
      addPOI('shop', shopPts[shi][0], shopPts[shi][1], { idx: shi, item: shopItems[shi % 2] });

    // 路灯 ×7-9：沿主干道
    var lampCands = streetTiles().filter(function (t) { return !noPOI[T(t[0], t[1])] && !nearPOI(t[0], t[1], 3); });
    var lampPts = farthest(lampCands, 7 + rng.int(0, 2), 6);
    for (var li = 0; li < lampPts.length; li++) addPOI('streetlamp', lampPts[li][0], lampPts[li][1], {});

    // 井盖：普通 ×5-8（纯装饰）+ 特定 ×1（→L2，原著连接）
    var mhCands = streetTiles().filter(function (t) { return !noPOI[T(t[0], t[1])] && !nearPOI(t[0], t[1], 3); });
    var mhPts = farthest(mhCands, 5 + rng.int(0, 3), 5);
    for (var mhi = 0; mhi < mhPts.length; mhi++) addPOI('manhole', mhPts[mhi][0], mhPts[mhi][1], {});
    // 特定井盖：离出生 15~40 格的主干道上
    var exCands = streetTiles().filter(function (t) {
      var d = Math.hypot(t[0] - spawnTx, t[1] - spawnTy);
      return d > 15 && d < 40 && !noPOI[T(t[0], t[1])] && !nearPOI(t[0], t[1], 4);
    });
    var exT = exCands.length ? rng.pick(exCands) : [19, 32];
    addPOI('manhole_exit', exT[0], exT[1], {});

    // 街角交通灯 ×3：大路口两处 + B×C 路口一处（落在真实地板上）
    function floorNear(tx, ty, r) {
      for (var rr = 0; rr <= r; rr++)
        for (var dy = -rr; dy <= rr; dy++)
          for (var dx = -rr; dx <= rr; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
            if (tile(tx + dx, ty + dy) === 1 && !noPOI[T(tx + dx, ty + dy)]) return [tx + dx, ty + dy];
          }
      return null;
    }
    var tlSpots = [floorNear(16, 29, 5), floorNear(22, 35, 5), floorNear(40, 34, 5)];
    for (var tli = 0; tli < tlSpots.length; tli++)
      if (tlSpots[tli]) addPOI('traflite', tlSpots[tli][0], tlSpots[tli][1], { phase: tli, corner: 1 });

    // 薄墙由下文既有逻辑生成（1~2 处，靠建筑墙面）

    // 字条 ×2-3 / 街边补给箱 ×2
    var noteCands = streetTiles().filter(function (t) { return !noPOI[T(t[0], t[1])] && !nearPOI(t[0], t[1], 4); });
    var nn = 2 + rng.int(0, 1);
    var notePts = farthest(noteCands, nn, 8);
    for (var ni = 0; ni < notePts.length; ni++)
      addPOI('note', notePts[ni][0], notePts[ni][1], { noteId: 'L11_note' + ni });
    var cratePts = farthest(noteCands, 2, 10);
    for (var cri = 0; cri < cratePts.length; cri++)
      addPOI('crate', cratePts[cri][0], cratePts[cri][1], { item: rng.pick(['almond', 'bandage', 'empty']) });

    // 薄墙 1~2（随机切出）
    (function placeThinWallsLocal(count) {
      var sp = null;
      for (var i = 0; i < map.pois.length; i++) if (map.pois[i].type === 'spawn') sp = map.pois[i];
      var sts = streetTiles(), placed = 0, guard = 0;
      while (placed < count && guard++ < 80 && sts.length) {
        var t = rng.pick(sts);
        var dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]), wall = null;
        for (var d = 0; d < 4; d++) {
          var wx = t[0] + dirs[d][0], wy = t[1] + dirs[d][1];
          if (wx < 1 || wy < 1 || wx >= W - 1 || wy >= H - 1) continue;
          if (tile(wx, wy) !== 1) { wall = dirs[d]; break; }
        }
        if (!wall) continue;
        if (sp && Math.hypot(t[0] - sp.tx, t[1] - sp.ty) < 6) continue;
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
  }
})();
