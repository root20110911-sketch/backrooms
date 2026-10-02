/* gen_l7.js —— Level 7「深海恐惧症」地图生成
 * 结构：狭小干燥入口房间（entry_room：出生点/字条/补给/返回门）
 *       → 门外是一望无际的昏暗海洋（大面积开放水域 + 深水区 + 海底起伏装饰）
 * 铁律：placer 只用传入的 rng；禁用 Math.random / Date / DOM / THREE。
 */
(function () {
  var BR = window.BR;

  /* ================= 1. 贴图注册（顶层调用） ================= */
  function mkc(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  // 确定性伪随机（贴图绘制用，不触碰 Math.random）
  function lcg(seed) {
    var s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 海底沙地：深蓝灰 + 沙波纹 + 碎石斑点
  BR.Textures.registerTex('ocean_floor', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(77);
    var i, k, px;
    x.fillStyle = '#26313c'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(255,255,255,0.05)'; x.lineWidth = 2;
    for (i = 0; i < 9; i++) { // 沙波纹
      x.beginPath();
      var y0 = (i + 0.5) * h / 9;
      for (px = 0; px <= w; px += 16) x.lineTo(px, y0 + Math.sin(px * 0.09 + i * 1.7) * 5);
      x.stroke();
    }
    for (k = 0; k < 260; k++) { // 碎石斑点
      var g = 40 + R() * 40;
      x.fillStyle = 'rgba(' + g + ',' + (g + 8) + ',' + (g + 14) + ',0.5)';
      x.beginPath(); x.arc(R() * w, R() * h, 1 + R() * 3, 0, 6.2832); x.fill();
    }
    return c;
  });

  // 深海岩壁：近黑 + 纵向岩层 + 岩点
  BR.Textures.registerTex('ocean_wall', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(913);
    var i, k;
    x.fillStyle = '#161c23'; x.fillRect(0, 0, w, h);
    for (i = 0; i < 7; i++) { // 纵向岩层
      var x0 = R() * w;
      x.fillStyle = 'rgba(255,255,255,' + (0.03 + R() * 0.04).toFixed(3) + ')';
      x.fillRect(x0, 0, 6 + R() * 22, h);
      x.fillStyle = 'rgba(0,0,0,0.35)';
      x.fillRect(x0 + 4 + R() * 18, 0, 2 + R() * 3, h);
    }
    for (k = 0; k < 120; k++) { // 岩点
      var g = 18 + R() * 26;
      x.fillStyle = 'rgba(' + g + ',' + (g + 5) + ',' + (g + 10) + ',0.6)';
      x.beginPath(); x.arc(R() * w, R() * h, 1 + R() * 2.5, 0, 6.2832); x.fill();
    }
    return c;
  });
  BR.Textures.registerWallTex('L7', 'ocean_wall');

  /* ================= 2. 环境音：深海低频 + 水声 ================= */
  BR.Audio.registerAmbient('L7', function () {
    var rig = this._loopRig(function (R) {
      var o = R.osc('sine', 38), og = R.gain(0.7); // 深海低频
      o.connect(og); og.connect(R.group);
      var o2 = R.osc('sine', 76), g2 = R.gain(0.18);
      o2.connect(g2); g2.connect(R.group);
      var n = R.noise(), lp = R.filter('lowpass', 500, 0.7), ng = R.gain(0.22); // 水声涌动
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
      var lfo = R.osc('sine', 0.11), lg = R.gain(0.12); // 缓慢涌动调制
      lfo.connect(lg); lg.connect(ng.gain);
    });
    rig.target = 0.42;
    return rig;
  });

  /* ================= 3. 关卡生成 ================= */
  var OX0 = 2, OY0 = 2, OX1 = 53, OY1 = 53; // 海洋矩形（tile 坐标，含边界）

  function tileAt(map, x, y) { return map.tiles[y * map.w + x]; }
  function setTile(map, x, y, v) {
    if (x >= 1 && y >= 1 && x <= map.w - 2 && y <= map.h - 2) map.tiles[y * map.w + x] = v;
  }
  function addPOI(map, type, tx, ty, data) {
    var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
    map.pois.push(p);
    return p;
  }

  // 入口房间某面墙上找门位：墙 tile（0）+ 内侧地板（1）；返回 {tx,ty,fx,fy,axis}
  function pickEntryDoor(map, rng, entry) {
    var cands = [];
    function tryWall(tx, ty, fx, fy, axis) {
      if (tx < 1 || ty < 1 || tx > map.w - 2 || ty > map.h - 2) return;
      if (tileAt(map, tx, ty) !== 0) return; // 必须是墙
      if (tileAt(map, fx, fy) !== 1) return; // 内侧必须是地板
      cands.push({ tx: tx, ty: ty, fx: fx, fy: fy, axis: axis });
    }
    var x, y;
    for (x = entry.x; x < entry.x + entry.w; x++) {
      tryWall(x, entry.y - 1, x, entry.y, 'z');
      tryWall(x, entry.y + entry.h, x, entry.y + entry.h - 1, 'z');
    }
    for (y = entry.y; y < entry.y + entry.h; y++) {
      tryWall(entry.x - 1, y, entry.x, y, 'x');
      tryWall(entry.x + entry.w, y, entry.x + entry.w - 1, y, 'x');
    }
    if (!cands.length) return { tx: entry.x, ty: entry.y - 1, fx: entry.x, fy: entry.y, axis: 'z' }; // 终极兜底
    return rng.pick(cands);
  }

  // 海洋地板 tile 候选（排除入口房间外扩一圈）
  function collectOcean(map, entry) {
    var out = [], x, y;
    for (y = OY0; y <= OY1; y++)
      for (x = OX0; x <= OX1; x++) {
        if (x >= entry.x - 1 && x <= entry.x + entry.w && y >= entry.y - 1 && y <= entry.y + entry.h) continue;
        if (tileAt(map, x, y) === 1) out.push([x, y]);
      }
    return out;
  }

  // 最远点散布取点（确定性，只用 rng）
  // avoidPts: [[tx,ty]...] 需保持 avoidGap 距离的点集
  function spreadPick(rng, cands, n, minGap, sx, sy, minSpawn, avoidPts, avoidGap) {
    var ok = [], i, a;
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (Math.hypot(c[0] - sx, c[1] - sy) < minSpawn) continue;
      var bad = false;
      if (avoidPts) for (a = 0; a < avoidPts.length; a++) {
        if (Math.hypot(c[0] - avoidPts[a][0], c[1] - avoidPts[a][1]) < avoidGap) { bad = true; break; }
      }
      if (!bad) ok.push(c);
    }
    if (!ok.length) ok = cands.slice(); // 实在没有也保证返回
    var pts = [rng.pick(ok)];
    var guard = 0;
    while (pts.length < n && guard++ < 60) {
      var best = null, bd = -1, t, j;
      for (t = 0; t < 40; t++) {
        var cc = rng.pick(ok), md = Infinity;
        for (j = 0; j < pts.length; j++) {
          var d = Math.hypot(cc[0] - pts[j][0], cc[1] - pts[j][1]);
          if (d < md) md = d;
        }
        if (md > bd) { bd = md; best = cc; }
      }
      if (best && (bd >= minGap || pts.length === 0)) pts.push(best);
      else if (best && guard > 30) pts.push(best); // 多次尝试后放宽间距要求
    }
    return pts;
  }

  // 在 (tx,ty) 附近 rMin..rMax 格内找一个海洋地板 tile
  function nudgeInOcean(map, entry, tx, ty, rng, rMin, rMax) {
    for (var t = 0; t < 40; t++) {
      var ang = rng.next() * 6.2832, r = rMin + rng.next() * (rMax - rMin);
      var nx = Math.round(tx + Math.cos(ang) * r), ny = Math.round(ty + Math.sin(ang) * r);
      if (nx < OX0 || nx > OX1 || ny < OY0 || ny > OY1) continue;
      if (nx >= entry.x - 1 && nx <= entry.x + entry.w && ny >= entry.y - 1 && ny <= entry.y + entry.h) continue;
      if (tileAt(map, nx, ny) === 1) return [nx, ny];
    }
    return [tx, ty];
  }

  function placeL7(map, rng) {
    var entry = map.rooms[0];
    entry.tag = 'entry_room';
    var ecx = Math.round(entry.cx), ecy = Math.round(entry.cy);

    /* ---- 入口房间：出生点 / entry_room / 字条 / 补给（干燥安全区） ---- */
    addPOI(map, 'spawn', ecx, ecy, {});
    addPOI(map, 'entry_room', ecx, ecy, {});
    addPOI(map, 'note', entry.x, entry.y, { noteId: 'L7_entry' });
    addPOI(map, 'cache', entry.x + entry.w - 1, entry.y + entry.h - 1,
      { items: ['almond', 'almond', 'bandage'] });

    /* ---- 海洋：挖空大矩形，入口房间外扩一圈保留为墙 ---- */
    var x, y;
    for (y = OY0; y <= OY1; y++)
      for (x = OX0; x <= OX1; x++) {
        if (x >= entry.x - 1 && x <= entry.x + entry.w && y >= entry.y - 1 && y <= entry.y + entry.h) continue;
        setTile(map, x, y, 1);
      }

    /* ---- 入口门：入口房间墙上，通向海洋 ---- */
    var door = pickEntryDoor(map, rng, entry);
    var dd = {
      id: 'd' + map.doors.length, tx: door.tx, ty: door.ty, axis: door.axis,
      locked: false, label: '锈蚀的舱门', exitTo: null
    };
    map.doors.push(dd);
    addPOI(map, 'entry_door', door.tx, door.ty, { doorId: dd.id, fx: door.fx, fy: door.fy });

    /* ---- 海洋 POI ---- */
    var ocean = collectOcean(map, entry);

    // 深水区 ×3：深度 1..3，彼此远离、远离出生点
    var zoneTiles = spreadPick(rng, ocean, 3, 12, ecx, ecy, 14, null, 0);
    var zonePts = [];
    for (var i = 0; i < zoneTiles.length; i++) {
      var zp = addPOI(map, 'deep_zone', zoneTiles[i][0], zoneTiles[i][1], { depth: i + 1, r: 7 });
      zonePts.push([zp.tx, zp.ty]);
    }
    var deepest = map.pois[map.pois.length - 1]; // depth=3 的深水区

    // 动静点 ×3：极远处，只放视觉/声音线索（不放实体）；远离深水区
    var distTiles = spreadPick(rng, ocean, 3, 10, ecx, ecy, 16, zonePts, 8);
    var distPts = [];
    for (var di = 0; di < distTiles.length; di++) {
      addPOI(map, 'disturbance', distTiles[di][0], distTiles[di][1], {});
      distPts.push([distTiles[di][0], distTiles[di][1]]);
    }

    // 利维坦：只在最深水区（实体由 Systems B 据 POI 生成）
    addPOI(map, 'leviathan', deepest.tx, deepest.ty, { depth: deepest.data.depth });

    // 深处出口：最深水区内偏移 2~3 格（发光上升流 →L37）
    var de = nudgeInOcean(map, entry, deepest.tx, deepest.ty, rng, 2, 3);
    addPOI(map, 'deep_exit', de[0], de[1], { depth: deepest.data.depth });

    // 异常切出点：海洋中隐蔽一处（水面不反光 →L0，需观察发现）
    var an = spreadPick(rng, ocean, 1, 0, ecx, ecy, 12, zonePts.concat(distPts), 8)[0];
    addPOI(map, 'anomaly_exit', an[0], an[1], {});

    // buildContent 用的元数据（不参与 hashMap）
    map.meta.l7 = {
      ocean: { x0: OX0, y0: OY0, x1: OX1, y1: OY1 },
      entryRoom: { x: entry.x, y: entry.y, w: entry.w, h: entry.h }
    };
  }

  BR.Gen.registerLevel('L7',
    { rw: [3, 6], rh: [3, 6], corrW: [1, 2], loops: [2, 4], wallH: 3.2 },
    placeL7,
    ['spawn', 'entry_room', 'deep_exit']);
})();
