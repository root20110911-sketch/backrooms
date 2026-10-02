/* gen_l11.js —— Level 11「无垠城市」地图生成
 * 街区式布局：广场（出生）/ 街道（宽走廊）/ 商店 / MEG 前哨 / 流浪者营地 / 地铁入口
 * 通过 BR.Gen.registerLevel 注册（不改 gen.js）。
 * 铁律：只用传入的 rng，禁用 Math.random / Date / DOM / THREE。
 */
(function () {
  var _g = (typeof window !== 'undefined') ? window : globalThis;
  var BR = _g.BR || (_g.BR = {});

  /* ================= 贴图 ================= */
  // 确定性伪随机（贴图绘制用，保证每次加载一致）
  function pr(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // city_wall：砖墙店面（暗红砖 + 灰缝 + 褪色招牌底带）
  BR.Textures.registerTex('city_wall', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#4a3630'; x.fillRect(0, 0, w, h);
    var bh = 16, bw = 42, n = 0;
    for (var row = 0; row * bh < h; row++) {
      var off = (row % 2) * bw / 2;
      for (var col = -1; col * bw < w + bw; col++, n++) {
        var v = 66 + ((pr(n) * 26) | 0);
        x.fillStyle = 'rgb(' + v + ',' + ((v * 0.60) | 0) + ',' + ((v * 0.54) | 0) + ')';
        x.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
      }
    }
    // 店面招牌底带（褪色深蓝）
    x.fillStyle = 'rgba(22,28,38,0.88)'; x.fillRect(0, h * 0.16, w, h * 0.20);
    x.fillStyle = 'rgba(255,205,130,0.14)'; x.fillRect(0, h * 0.16, w, 5);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, h * 0.36 - 3, w, 3);
    // 污渍与颗粒
    for (var i = 0; i < 260; i++) {
      x.fillStyle = pr(900 + i) < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,240,220,0.05)';
      x.fillRect(pr(1000 + i) * w, pr(2000 + i) * h, 2, 2);
    }
    x.fillStyle = 'rgba(20,14,10,0.45)'; x.fillRect(0, h - 8, w, 8); // 底部污边
    return c;
  });

  // city_road：沥青路面（深灰 + 噪点 + 裂缝）
  BR.Textures.registerTex('city_road', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#33363b'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 2400; i++) {
      var g = 40 + ((pr(i) * 30) | 0);
      x.fillStyle = 'rgb(' + g + ',' + (g + 2) + ',' + (g + 5) + ')';
      x.fillRect(pr(5000 + i) * w, pr(6000 + i) * h, 2, 2);
    }
    x.strokeStyle = 'rgba(15,16,18,0.55)'; x.lineWidth = 2; // 裂缝
    for (var k = 0; k < 4; k++) {
      x.beginPath();
      var sx = pr(7000 + k) * w, sy = pr(7100 + k) * h;
      x.moveTo(sx, sy);
      for (var s = 1; s <= 5; s++) x.lineTo(sx + (pr(7200 + k * 10 + s) - 0.5) * 90, sy + s * 22);
      x.stroke();
    }
    return c;
  });

  // shop_sign：霓虹招牌底板（通用款，"OPEN" 霓虹字；各店中文名走 note 文本）
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

  BR.Textures.registerWallTex('L11', 'city_wall');

  /* ================= 环境音：远处城市嗡鸣 + 风声 ================= */
  BR.Audio.registerAmbient('L11', function () {
    var rig = this._loopRig(function (R) {
      var o1 = R.osc('sine', 55), g1 = R.gain(0.30);   // 城市低频嗡鸣
      o1.connect(g1); g1.connect(R.group);
      var o2 = R.osc('sine', 110), g2 = R.gain(0.10);  // 谐波
      o2.connect(g2); g2.connect(R.group);
      var n = R.noise(), f = R.filter('lowpass', 480, 0.6), g3 = R.gain(0.16); // 风声
      n.connect(f); f.connect(g3); g3.connect(R.group);
      var n2 = R.noise(), f2 = R.filter('bandpass', 900, 2.5), g4 = R.gain(0.045); // 远处人声般的嗡动
      n2.connect(f2); f2.connect(g4); g4.connect(R.group);
    });
    rig.target = 0.4;
    return rig;
  });

  /* ================= 关卡注册 ================= */
  BR.Gen.registerLevel('L11',
    { rw: [5, 10], rh: [5, 10], corrW: [2, 2], loops: [6, 10], wallH: 3.6 },
    placeL11,
    ['spawn', 'meg_post', 'subway']
  );

  /* ================= placer（只用 rng） ================= */
  function placeL11(map, rng) {
    // ---- 本地小工具（gen.js 内部函数不可见，重写） ----
    function T(x, y) { return y * map.w + x; }
    function tile(x, y) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) return 0;
      return map.tiles[T(x, y)];
    }
    function addPOI(type, tx, ty, data) {
      var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
      map.pois.push(p);
      return p;
    }
    function randTileInRoom(r) {
      for (var t = 0; t < 24; t++) {
        var x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
        if (tile(x, y) === 1) return [x, y];
      }
      return [Math.round(r.cx), Math.round(r.cy)];
    }
    function pickRoom(exclude) {
      var c = [];
      for (var i = 0; i < map.rooms.length; i++) {
        var bad = false;
        for (var j = 0; j < exclude.length; j++) if (map.rooms[i] === exclude[j]) { bad = true; break; }
        if (!bad) c.push(map.rooms[i]);
      }
      return rng.pick(c.length ? c : map.rooms);
    }
    function tileInAnyRoom(x, y) {
      for (var i = 0; i < map.rooms.length; i++) {
        var r = map.rooms[i];
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
      }
      return false;
    }
    function corridorTiles() {
      var out = [];
      for (var y = 1; y < map.h - 1; y++)
        for (var x = 1; x < map.w - 1; x++)
          if (tile(x, y) === 1 && !tileInAnyRoom(x, y)) out.push([x, y]);
      return out;
    }
    function spreadPoints(cands, n) { // farthest-point 散布取点
      var pts = [];
      if (!cands.length) return pts;
      pts.push(rng.pick(cands));
      while (pts.length < n) {
        var best = null, bd = -1;
        for (var t = 0; t < 24; t++) {
          var c = rng.pick(cands), md = Infinity;
          for (var i = 0; i < pts.length; i++) {
            var d = (c[0] - pts[i][0]) * (c[0] - pts[i][0]) + (c[1] - pts[i][1]) * (c[1] - pts[i][1]);
            if (d < md) md = d;
          }
          if (md > bd) { bd = md; best = c; }
        }
        pts.push(best);
      }
      return pts;
    }
    // 薄墙（复制 gen.js placeThinWalls 逻辑：距出生≥6、两两≥8）
    function placeThinWallsLocal(count) {
      var spawn = null;
      for (var i = 0; i < map.pois.length; i++) if (map.pois[i].type === 'spawn') spawn = map.pois[i];
      var placed = 0, guard = 0;
      while (placed < count && guard++ < 80) {
        var r = pickRoom([]), t = randTileInRoom(r), tx = t[0], ty = t[1];
        var dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]), wall = null;
        for (var d = 0; d < 4; d++) {
          var wx = tx + dirs[d][0], wy = ty + dirs[d][1];
          if (wx < 1 || wy < 1 || wx >= map.w - 1 || wy >= map.h - 1) continue;
          if (tile(wx, wy) !== 1) { wall = dirs[d]; break; }
        }
        if (!wall) continue;
        if (spawn && Math.hypot(tx - spawn.tx, ty - spawn.ty) < 6) continue;
        var dup = false;
        for (var k = 0; k < map.pois.length; k++) {
          var p = map.pois[k];
          if (p.type === 'thin_wall' && Math.hypot(p.tx - tx, p.ty - ty) < 8) { dup = true; break; }
        }
        if (dup) continue;
        addPOI('thin_wall', tx, ty, { dx: wall[0], dz: wall[1] });
        placed++;
      }
    }
    // MEG 队员带路路径：从前哨向地铁方向贪心走 8 格（约 24 米），只走地板
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

    // ---- 出生广场（rooms[0]） ----
    var spawnR = map.rooms[0];
    spawnR.tag = 'plaza';
    var st = randTileInRoom(spawnR);
    addPOI('spawn', st[0], st[1], {});
    addPOI('plaza', st[0], st[1], {});

    // rooms 按离出生距离排序（computeFarRoom 已在 placer 之前跑完，_d 可用）
    var byDist = map.rooms.slice(1).sort(function (a, b) { return a._d - b._d; });

    // ---- 地铁入口：最远的房间（探索发现） ----
    var subR = map.farRoom || byDist[byDist.length - 1] || spawnR;
    subR.tag = 'exit';
    var subt = randTileInRoom(subR);
    addPOI('subway', subt[0], subt[1], {});

    // ---- MEG 前哨：中段距离 ----
    var megR = byDist[Math.floor(byDist.length / 2)] || byDist[0] || spawnR;
    if (megR === subR) megR = byDist[Math.floor(byDist.length / 3)] || spawnR;
    megR.tag = 'safe';
    var megt = randTileInRoom(megR);
    var gpath = guidePath(megt[0], megt[1], subt[0], subt[1]);
    addPOI('meg_post', megt[0], megt[1], { path: gpath });

    // ---- 流浪者营地：另一处中段房间 ----
    var wcR = pickRoom([spawnR, subR, megR]);
    wcR.tag = 'safe';
    var wct = randTileInRoom(wcR);
    addPOI('wanderer_camp', wct[0], wct[1], {});

    // ---- 商店：3~5 个小房间 ----
    var used = [spawnR, subR, megR, wcR];
    var nShop = 3 + rng.int(0, 2);
    var shopItems = ['almond', 'bandage'];
    for (var i = 0; i < nShop; i++) {
      var sr = pickRoom(used); used.push(sr);
      var srt = randTileInRoom(sr);
      addPOI('shop', srt[0], srt[1], { idx: i, item: shopItems[i % 2] });
    }

    // ---- 路灯：沿街道散布 ----
    var lamps = spreadPoints(corridorTiles(), 7 + rng.int(0, 3));
    for (var l = 0; l < lamps.length; l++) addPOI('streetlamp', lamps[l][0], lamps[l][1], {});

    // ---- 字条 & 街边补给箱 ----
    var nn = 2 + rng.int(0, 1);
    for (var j = 0; j < nn; j++) {
      var nr = pickRoom([spawnR]), nt = randTileInRoom(nr);
      addPOI('note', nt[0], nt[1], { noteId: 'L11_note' + j });
    }
    var nc = 2;
    for (var k = 0; k < nc; k++) {
      var cr = pickRoom([spawnR]), ct = randTileInRoom(cr);
      addPOI('crate', ct[0], ct[1], { item: rng.pick(['almond', 'bandage', 'empty']) });
    }

    // ---- 薄墙：1~2 处（随机切出，不放 chase 型实体） ----
    placeThinWallsLocal(1 + rng.int(0, 1));
  }
})();
