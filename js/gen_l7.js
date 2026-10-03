/* gen_l7.js —— Level 7「深海恐惧症」地图生成（v1.5 重构）
 * 结构：金属舱室（entry_room：出生点/字条/补给/舱盖门/楼梯/平台）
 *       → 舱盖门外是露天阴天海洋（开放水域 + 深水区 + 深海实体锚点 + L37 门）
 * 版本依据：Fandom 版 Level 7（金属舱室入口 + 露天阴天海洋 + 深海）。
 *   距离/深度均为游戏尺度改编（见 LORE.md），非原著数值。
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

  // 锈蚀金属墙面：深灰底 + 纵向锈 streak + 铆钉 + 划痕（舱室墙体用）
  BR.Textures.registerTex('rust_metal', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(3101);
    var i, k;
    x.fillStyle = '#4a4d4f'; x.fillRect(0, 0, w, h);
    for (i = 0; i < 900; i++) { // 金属噪点
      var g = 58 + R() * 34;
      x.fillStyle = 'rgba(' + g + ',' + (g - 2) + ',' + (g - 6) + ',0.5)';
      x.fillRect(R() * w, R() * h, 2 + R() * 3, 2 + R() * 3);
    }
    for (i = 0; i < 34; i++) { // 纵向锈 streak
      var sx = R() * w, sw = 3 + R() * 14, sh = h * (0.2 + R() * 0.8);
      var gg = x.createLinearGradient(0, 0, 0, sh);
      var rust = 90 + R() * 50;
      gg.addColorStop(0, 'rgba(' + rust + ',' + (rust * 0.45) + ',' + (rust * 0.25) + ',0.75)');
      gg.addColorStop(1, 'rgba(' + rust + ',' + (rust * 0.45) + ',' + (rust * 0.25) + ',0)');
      x.fillStyle = gg;
      x.fillRect(sx, R() * h * 0.3, sw, sh);
    }
    x.fillStyle = 'rgba(20,18,16,0.9)'; // 铆钉行
    for (k = 0; k < 2; k++) {
      var ry = h * (0.12 + k * 0.76);
      for (i = 0; i < 8; i++) {
        x.beginPath(); x.arc((i + 0.5) * w / 8, ry, 4, 0, 6.2832); x.fill();
        x.fillStyle = 'rgba(120,116,110,0.5)';
        x.beginPath(); x.arc((i + 0.5) * w / 8 - 1, ry - 1, 1.6, 0, 6.2832); x.fill();
        x.fillStyle = 'rgba(20,18,16,0.9)';
      }
    }
    x.strokeStyle = 'rgba(15,14,13,0.6)'; x.lineWidth = 1.5; // 划痕
    for (i = 0; i < 12; i++) {
      x.beginPath();
      var px = R() * w, py = R() * h;
      x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 90, py + (R() - 0.5) * 30); x.stroke();
    }
    return c;
  });
  BR.Textures.registerWallTex('L7', 'rust_metal');

  // 锈蚀金属（暗版）：舱室天花板
  BR.Textures.registerTex('rust_dark', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(7707);
    x.fillStyle = '#2c2e30'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 500; i++) {
      var g = 34 + R() * 26;
      x.fillStyle = 'rgba(' + g + ',' + g + ',' + (g - 4) + ',0.5)';
      x.fillRect(R() * w, R() * h, 2 + R() * 4, 2 + R() * 4);
    }
    for (i = 0; i < 16; i++) { // 锈斑
      var rust = 70 + R() * 40;
      x.fillStyle = 'rgba(' + rust + ',' + (rust * 0.45) + ',' + (rust * 0.28) + ',' + (0.25 + R() * 0.3).toFixed(2) + ')';
      x.beginPath(); x.arc(R() * w, R() * h, 4 + R() * 16, 0, 6.2832); x.fill();
    }
    return c;
  });

  // 甲板钢板：深色板缝 + 防滑条纹（舱外甲板/楼梯用）
  BR.Textures.registerTex('deck_plate', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(5515);
    x.fillStyle = '#33363a'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(12,12,14,0.8)'; x.lineWidth = 3; // 板缝
    for (var i = 0; i <= 4; i++) {
      x.beginPath(); x.moveTo(i * w / 4, 0); x.lineTo(i * w / 4, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke();
    }
    x.fillStyle = 'rgba(140,140,135,0.16)'; // 防滑凸点
    for (i = 0; i < 260; i++) x.fillRect(R() * w, R() * h, 3, 2);
    for (i = 0; i < 10; i++) { // 锈蚀边缘
      var rust = 80 + R() * 40;
      x.fillStyle = 'rgba(' + rust + ',' + (rust * 0.45) + ',' + (rust * 0.28) + ',0.35)';
      x.beginPath(); x.arc(R() * w, R() * h, 3 + R() * 9, 0, 6.2832); x.fill();
    }
    return c;
  });

  // 阴天云层：低饱和灰 + 柔和团块（天空穹顶/云层平面用）
  BR.Textures.registerTex('overcast', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(9090);
    x.fillStyle = '#7d858c'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 130; i++) { // 云团：径向渐变灰块
      var bx = R() * w, by = R() * h, br = 20 + R() * 70;
      var v = 96 + R() * 56;
      var g = x.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, 'rgba(' + v + ',' + (v + 3) + ',' + (v + 6) + ',' + (0.20 + R() * 0.30).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(' + v + ',' + (v + 3) + ',' + (v + 6) + ',0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(bx, by, br, 0, 6.2832); x.fill();
    }
    for (i = 0; i < 40; i++) { // 暗部
      var dx = R() * w, dy = R() * h, dr = 24 + R() * 60, dv = 60 + R() * 30;
      var g2 = x.createRadialGradient(dx, dy, 0, dx, dy, dr);
      g2.addColorStop(0, 'rgba(' + dv + ',' + (dv + 4) + ',' + (dv + 8) + ',' + (0.18 + R() * 0.22).toFixed(2) + ')');
      g2.addColorStop(1, 'rgba(' + dv + ',' + (dv + 4) + ',' + (dv + 8) + ',0)');
      x.fillStyle = g2;
      x.beginPath(); x.arc(dx, dy, dr, 0, 6.2832); x.fill();
    }
    return c;
  });

  // 深渊：近黑蓝灰 + 微噪（海洋 tile 地板贴图；正常海域不铺可辨认的平坦地板，
  // 透过水面只看到深色，读作"深不见底"而非"脚下有地板"）
  BR.Textures.registerTex('abyss', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(31337);
    x.fillStyle = '#04070b'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 320; i++) {
      var g = 6 + R() * 16;
      x.fillStyle = 'rgba(' + g + ',' + (g + 4) + ',' + (g + 9) + ',0.5)';
      x.fillRect(R() * w, R() * h, 2 + R() * 5, 2 + R() * 5);
    }
    return c;
  });

  // 海面细节：大尺度深色斑块（单张大贴图铺整片海面，跨区块无接缝）
  BR.Textures.registerTex('sea_detail', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(2718);
    x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, w, h); // 中性灰底（与材质色相乘）
    for (var i = 0; i < 90; i++) {
      var bx = R() * w, by = R() * h, br = 12 + R() * 46;
      var v = 110 + R() * 60;
      var g = x.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',' + (0.25 + R() * 0.35).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(bx, by, br, 0, 6.2832); x.fill();
    }
    return c;
  });

  /* ================= 2. 环境音：深海低频 + 水声（v1.5：阴天海面版） ================= */
  BR.Audio.registerAmbient('L7', function () {
    var rig = this._loopRig(function (R) {
      var o = R.osc('sine', 38), og = R.gain(0.55); // 深海低频
      o.connect(og); og.connect(R.group);
      var o2 = R.osc('sine', 76), g2 = R.gain(0.14);
      o2.connect(g2); g2.connect(R.group);
      var n = R.noise(), lp = R.filter('lowpass', 500, 0.7), ng = R.gain(0.20); // 水声涌动
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
      var n2 = R.noise(), bp = R.filter('bandpass', 2400, 0.6), wg = R.gain(0.05); // 海面风声
      n2.connect(bp); bp.connect(wg); wg.connect(R.group);
      var lfo = R.osc('sine', 0.11), lg = R.gain(0.10); // 缓慢涌动调制
      lfo.connect(lg); lg.connect(ng.gain);
    });
    rig.target = 0.40;
    return rig;
  });
  // L7_uw：水下闷声变体（头部入水时 BR.Swim 按 dry+'_uw' 约定切换）
  BR.Audio.registerAmbient('L7_uw', function () {
    var rig = this._loopRig(function (R) {
      var o = R.osc('sine', 30), og = R.gain(0.7); // 更深的闷响
      o.connect(og); og.connect(R.group);
      var n = R.noise(), lp = R.filter('lowpass', 220, 0.9), ng = R.gain(0.5); // 水下闷水声
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
      var lfo = R.osc('sine', 0.07), lg = R.gain(0.16);
      lfo.connect(lg); lg.connect(ng.gain);
    });
    rig.target = 0.5;
    return rig;
  });

  /* ================= 3. 关卡生成 ================= */
  var OX0 = 2, OY0 = 2, OX1 = 53, OY1 = 53; // 海洋矩形（tile 坐标，含边界）
  var DECK_H = 0.72;   // 甲板/舱盖平台高度（米；相对舱内地面）
  var DECK_OUT = 2;    // 甲板向外延伸 tile 数
  var DECK_HALF = 1;   // 甲板半宽 tile 数

  function tileAt(map, x, y) { return map.tiles[y * map.w + x]; }
  function setTile(map, x, y, v) {
    if (x >= 1 && y >= 1 && x <= map.w - 2 && y <= map.h - 2) map.tiles[y * map.w + x] = v;
  }
  function addPOI(map, type, tx, ty, data) {
    var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
    map.pois.push(p);
    return p;
  }
  function inRoom(entry, tx, ty) {
    return tx >= entry.x && tx < entry.x + entry.w && ty >= entry.y && ty < entry.y + entry.h;
  }

  // 甲板 2×3 tile 是否全部落在海洋矩形内（门朝地图边缘时不可用）
  function deckOk(tx, ty, nx, ny) {
    for (var k = 1; k <= DECK_OUT; k++)
      for (var p = -DECK_HALF; p <= DECK_HALF; p++) {
        var dtx = tx + nx * k - ny * p, dty = ty + ny * k + nx * p;
        if (dtx < OX0 || dtx > OX1 || dty < OY0 || dty > OY1) return false;
      }
    return true;
  }

  // 入口舱室某面墙上找舱盖门位：墙 tile（0）+ 内侧地板（1）；返回 {tx,ty,fx,fy,axis}
  // 优先保证甲板能伸出去（deckOk）；都不满足时选朝向地图中心的一扇
  function pickEntryDoor(map, rng, entry) {
    var cands = [];
    function tryWall(tx, ty, fx, fy, axis) {
      if (tx < 1 || ty < 1 || tx > map.w - 2 || ty > map.h - 2) return;
      if (tileAt(map, tx, ty) !== 0) return; // 必须是墙
      if (tileAt(map, fx, fy) !== 1) return; // 内侧必须是地板
      var nx = 0, ny = 0;
      if (axis === 'z') ny = (ty < entry.y) ? -1 : 1;
      else nx = (tx < entry.x) ? -1 : 1;
      cands.push({ tx: tx, ty: ty, fx: fx, fy: fy, axis: axis, nx: nx, ny: ny });
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
    if (!cands.length) return { tx: entry.x, ty: entry.y - 1, fx: entry.x, fy: entry.y, axis: 'z', nx: 0, ny: -1 }; // 终极兜底
    var good = cands.filter(function (c) { return deckOk(c.tx, c.ty, c.nx, c.ny); });
    if (good.length) return rng.pick(good);
    // 兜底：选外法线最朝向地图中心的一扇
    var mcx = (OX0 + OX1) / 2, mcy = (OY0 + OY1) / 2;
    var rcx = entry.x + entry.w / 2, rcy = entry.y + entry.h / 2;
    var best = cands[0], bs = -1e9;
    for (var i = 0; i < cands.length; i++) {
      var s = (mcx - rcx) * cands[i].nx + (mcy - rcy) * cands[i].ny;
      if (s > bs) { bs = s; best = cands[i]; }
    }
    return best;
  }

  // 海洋地板 tile 候选（排除入口舱室外扩一圈）
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

    /* ---- 海洋：挖空大矩形，入口舱室外扩一圈保留为墙 ---- */
    var x, y;
    for (y = OY0; y <= OY1; y++)
      for (x = OX0; x <= OX1; x++) {
        if (x >= entry.x - 1 && x <= entry.x + entry.w && y >= entry.y - 1 && y <= entry.y + entry.h) continue;
        setTile(map, x, y, 1);
      }

    /* ---- 舱盖门：舱室墙上，通向甲板/海洋 ---- */
    var door = pickEntryDoor(map, rng, entry);
    // 外法线（tile 空间；pickEntryDoor 已算好）
    var dnx = door.nx || 0, dny = door.ny || 0;
    if (dnx === 0 && dny === 0) { // 兜底重算
      if (door.axis === 'z') dny = (door.ty < entry.y) ? -1 : 1;
      else dnx = (door.tx < entry.x) ? -1 : 1;
    }

    /* ---- 楼梯：门内侧 tile 为平台（0.72m），再向内一格为楼梯坡道 ---- */
    var lx = door.fx, ly = door.fy; // 平台 tile（门内侧）
    var stairCands = [
      [lx - dnx, ly - dny],
      [lx + dny, ly + dnx],
      [lx - dny, ly - dnx]
    ];
    var stair = null;
    for (var si = 0; si < stairCands.length; si++) {
      var stx = stairCands[si][0], sty = stairCands[si][1];
      if (inRoom(entry, stx, sty) && tileAt(map, stx, sty) === 1 &&
          !(stx === lx && sty === ly)) { stair = { tx: stx, ty: sty }; break; }
    }
    if (!stair) stair = { tx: lx, ty: ly, flat: true }; // 极小房间兜底：无坡道，平台即台阶

    /* ---- 甲板：门外 2 格深 × 3 格宽（tile 矩形，供 floorYAt/栏杆/积水判定） ---- */
    var deckTiles = [];
    for (var k = 1; k <= DECK_OUT; k++)
      for (var p = -DECK_HALF; p <= DECK_HALF; p++) {
        var dtx = door.tx + dnx * k - dny * p, dty = door.ty + dny * k + dnx * p;
        deckTiles.push([dtx, dty]);
      }
    var deckTx = deckTiles.map(function (t) { return t[0]; });
    var deckTy = deckTiles.map(function (t) { return t[1]; });
    var deckRect = {
      x0: Math.min.apply(null, deckTx), y0: Math.min.apply(null, deckTy),
      x1: Math.max.apply(null, deckTx), y1: Math.max.apply(null, deckTy)
    };

    /* ---- 小船停靠点：甲板侧方（世界坐标；船头朝外） ---- */
    // 甲板中心 + 侧向偏移 2 tile（避开甲板，浮在水面）
    var dcx = (deckRect.x0 + deckRect.x1 + 1) / 2, dcy = (deckRect.y0 + deckRect.y1 + 1) / 2;
    var side = (BR.hashSeed(map.seed + ':l7boatside') % 2 === 0) ? 1 : -1;
    var bx = (dcx - dny * side * 2), bz = (dcy + dnx * side * 2); // tile 中心坐标（浮点）
    // 钳制进海洋矩形（1 格边距），保证船始终在可玩水域
    bx = Math.max(OX0 + 1, Math.min(OX1 - 1, bx));
    bz = Math.max(OY0 + 1, Math.min(OY1 - 1, bz));
    var boatYaw = Math.atan2(-dnx, -dny); // 船头朝外（yaw=0 面向 -z）

    /* ---- 入口舱室：出生点 / entry_room / 字条 / 补给（干燥安全区） ---- */
    addPOI(map, 'spawn', ecx, ecy, {});
    addPOI(map, 'entry_room', ecx, ecy, {});
    // 字条/补给：避开楼梯/平台/门内侧 2 格
    var avoidC = [[lx, ly], [stair.tx, stair.ty], [door.fx, door.fy]];
    var freeTiles = [];
    for (y = entry.y; y < entry.y + entry.h; y++)
      for (x = entry.x; x < entry.x + entry.w; x++) {
        if (tileAt(map, x, y) !== 1) continue;
        var bad = false;
        for (var ai = 0; ai < avoidC.length; ai++)
          if (Math.hypot(x - avoidC[ai][0], y - avoidC[ai][1]) < 2) { bad = true; break; }
        if (!bad) freeTiles.push([x, y]);
      }
    if (!freeTiles.length) { // 兜底：房间太小就用任意地板
      for (y = entry.y; y < entry.y + entry.h; y++)
        for (x = entry.x; x < entry.x + entry.w; x++)
          if (tileAt(map, x, y) === 1) freeTiles.push([x, y]);
    }
    var noteT = rng.pick(freeTiles);
    var cacheT = rng.pick(freeTiles);
    addPOI(map, 'note', noteT[0], noteT[1], { noteId: 'L7_entry' });
    addPOI(map, 'cache', cacheT[0], cacheT[1],
      { items: ['almond', 'almond', 'bandage'] });

    /* ---- 舱盖门 / 小船 POI ---- */
    var dd = {
      id: 'd' + map.doors.length, tx: door.tx, ty: door.ty, axis: door.axis,
      locked: false, label: '舱盖', exitTo: null
    };
    map.doors.push(dd);
    addPOI(map, 'entry_door', door.tx, door.ty,
      { doorId: dd.id, fx: door.fx, fy: door.fy, nx: dnx, ny: dny });
    addPOI(map, 'boat_mooring',
      Math.max(OX0, Math.min(OX1, Math.round(bx))),
      Math.max(OY0, Math.min(OY1, Math.round(bz))),
      { x: (bx + 0.5) * 3, z: (bz + 0.5) * 3, yaw: boatYaw, side: side });

    /* ---- 海洋 POI ---- */
    var ocean = collectOcean(map, entry);

    // 深水区 ×3：depth 1..3（游戏尺度：海床 -10/-16/-24m），彼此远离、远离出生点
    var zoneTiles = spreadPick(rng, ocean, 3, 12, ecx, ecy, 14, null, 0);
    var zonePts = [];
    for (var i = 0; i < zoneTiles.length; i++) {
      var zp = addPOI(map, 'deep_zone', zoneTiles[i][0], zoneTiles[i][1], { depth: i + 1, r: 7 });
      zonePts.push([zp.tx, zp.ty]);
    }
    var deepest = map.pois[map.pois.length - 1]; // depth=3 的深水区

    // 动静点 ×3：深海实体的远影偏好锚点；远离深水区与出生点
    var distTiles = spreadPick(rng, ocean, 3, 10, ecx, ecy, 16, zonePts, 8);
    var distPts = [];
    for (var di = 0; di < distTiles.length; di++) {
      addPOI(map, 'disturbance', distTiles[di][0], distTiles[di][1], {});
      distPts.push([distTiles[di][0], distTiles[di][1]]);
    }

    // 深海实体锚点：在最深水区（实体由本关 tick 驱动的环境演出，非追逐怪）
    addPOI(map, 'leviathan', deepest.tx, deepest.ty, { depth: deepest.data.depth });

    // 深处出口：最深水区内偏移 2~3 格（瓷砖结构残片 + 光柱 →L37，需潜入内部触发）
    var de = nudgeInOcean(map, entry, deepest.tx, deepest.ty, rng, 2, 3);
    addPOI(map, 'deep_exit', de[0], de[1], { depth: deepest.data.depth });

    // 异常切出点：海洋中隐蔽一处（水面不反光 →L0，需观察发现）
    var an = spreadPick(rng, ocean, 1, 0, ecx, ecy, 12, zonePts.concat(distPts), 8)[0];
    addPOI(map, 'anomaly_exit', an[0], an[1], {});

    // buildContent 用的元数据（不参与 hashMap）
    map.meta.l7 = {
      ocean: { x0: OX0, y0: OY0, x1: OX1, y1: OY1 },
      entryRoom: { x: entry.x, y: entry.y, w: entry.w, h: entry.h },
      door: { tx: door.tx, ty: door.ty, fx: door.fx, fy: door.fy, nx: dnx, ny: dny, axis: door.axis },
      landing: { tx: lx, ty: ly, h: DECK_H },
      stair: { tx: stair.tx, ty: stair.ty, flat: !!stair.flat },
      deck: deckRect,
      deckH: DECK_H,
      boat: { x: (bx + 0.5) * 3, z: (bz + 0.5) * 3, yaw: boatYaw }
    };
  }

  BR.Gen.registerLevel('L7',
    { rw: [4, 6], rh: [4, 6], corrW: [1, 2], loops: [2, 4], wallH: 3.2 },
    placeL7,
    ['spawn', 'entry_room', 'deep_exit']);
})();
