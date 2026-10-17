/* ============================================================
 * Level 37.2「Sunlit Pools（阳光泳池）」—— 地图生成（placer）+ 纯水体模型
 * 独立 IIFE：只调用 BR.* 注册钩子，不改动 gen.js 本体。
 * 铁律：placer 只用传入的 rng（禁止用全局随机源与时钟）。
 *
 * [改编标注 —— 必读]
 *   原著依据（Fandom 主站 Level 37.2 "Sunlit Pools"，见 docs/LORE_V21.md）：
 *     白瓷砖永葆崭新、及膝清澈浅水、恒定微小涟漪、墙面矩形开口透粉色阳光
 *     （开口外是白色虚空、光源不可抵达）；实体 Pinnicorns（充气浮具状，无害）。
 *   用户明确要求的游戏化改编（LORE_V21.md 第六节已登记）：
 *     露天蓝天 + 可见太阳 + 柔和云层 + 水面映天空的"天空之境"感 +
 *     部分区域无屋顶。原著两个来源（Fandom 主站 / liminality 同人）都没有
 *     露天蓝天与可见太阳 —— 游戏内文档/注释必须如实标注为改编。
 *
 * 水体模型（沿用 L37 v1.4 架构）：
 *   全关统一水面高度 SURF（=0.45，世界 Y，及膝深），深浅由池底几何形成：
 *   - 浅水区：池底 = 0（默认地板），水深 0.45，可涉行；
 *   - 深水坑：池底 -1.2（tile=2 雕刻），水深 1.65，可游泳；
 *   - 干燥平台：池底 0.55 / 0.9（tile=2 雕刻，高出水面），台阶进出；
 *   tile=2 的坑/平台：buildChunk 视为"墙分支"，lv_l372 buildContent 里对全部
 *   tile=2 调 W.skipWall()（不渲染默认墙体），再自建池底/池壁/顶面/台阶；
 *   碰撞 W.blocked() 把 tile=2 视为可行走（E 路游泳物理接管 Y）。
 *   瓷柱：tile=0（真实碰撞），lv 侧 skipWall + 自建细柱。
 *   露天庭院：tag='open_court' 的房间，lv 侧对全部 tile 调 W.setOpenCeil()
 *   （天花板实例跳过，灯具也不放），直接看到天空穹顶。
 *
 *   map.meta.l372 = { surface, rects, pits, pillars, chanRects,
 *                      openRooms:[room ids], pinkOpenings:[{tx,ty,face}],
 *                      arrivalGate:{tx,ty,wx,wz,face}, returnGate:{tx,ty,wx,wz,face} }
 * 纯函数（Node 可测，无 document/THREE）：
 *     BR.Gen.L372waterAt(map, x, z) -> null | {surface, floor, depth}
 *     BR.Gen.L372isWater(map, x, z) -> bool
 *     BR.Gen.L372floorAt(map, x, z) -> 池底 Y（坑外/无水区返回 0）
 * ============================================================ */
(function () {
  var BR = window.BR;
  var TILE = BR.TILE; // 3（米）

  /* ---------------- 水体常量 ---------------- */
  var SURF = 0.45;      // 全关统一水面高度（世界 Y）：及膝深浅水
  var DEEP_FLOOR = -1.2; // 深水坑底（水深 1.65，可游泳）
  BR.Gen.L372SURF = SURF;

  /* ---------------- 纯水体查询（E 路游泳物理用；Node 可测） ---------------- */
  function inTileRect(r, x, z) {
    return x >= r.x0 * TILE && x < (r.x1 + 1) * TILE &&
           z >= r.y0 * TILE && z < (r.y1 + 1) * TILE;
  }
  // 坑/平台内某点的池底 Y（含台阶：steps 占坑边缘 1 tile，从 fromY 走向 pit.floorY）
  function pitFloorAt(pit, x, z) {
    var px0 = pit.tx0 * TILE, px1 = (pit.tx1 + 1) * TILE;
    var pz0 = pit.ty0 * TILE, pz1 = (pit.ty1 + 1) * TILE;
    var steps = pit.steps || null;
    if (steps) {
      for (var s = 0; s < steps.length; s++) {
        var st = steps[s], n = st.n;
        var fromY = (st.fromY != null ? st.fromY : 0);
        var riser = Math.abs(pit.floorY - fromY) / n, k = -1;
        if (st.edge === 'N') { if (z < pz0 + TILE) k = Math.floor((z - pz0) / TILE * n); }
        else if (st.edge === 'S') { if (z > pz1 - TILE) k = Math.floor((pz1 - z) / TILE * n); }
        else if (st.edge === 'W') { if (x < px0 + TILE) k = Math.floor((x - px0) / TILE * n); }
        else if (st.edge === 'E') { if (x > px1 - TILE) k = Math.floor((px1 - x) / TILE * n); }
        if (k >= 0) {
          if (k > n - 1) k = n - 1;
          var dir = pit.floorY < fromY ? -1 : 1;
          return +((fromY + dir * (k + 1) * riser).toFixed(3));
        }
      }
    }
    return pit.floorY;
  }
  function pitAt(L, x, z) {
    for (var i = 0; i < L.pits.length; i++) {
      var p = L.pits[i];
      if (x >= p.tx0 * TILE && x < (p.tx1 + 1) * TILE &&
          z >= p.ty0 * TILE && z < (p.ty1 + 1) * TILE) return p;
    }
    return null;
  }
  // BR.Levels.L372.waterAt 的纯逻辑后援（lv_l372.js 里绑定到当前地图）
  BR.Gen.L372waterAt = function (map, x, z) {
    var L = map.meta && map.meta.l372;
    if (!L) return null;
    var inW = false;
    for (var i = 0; i < L.rects.length; i++) {
      if (inTileRect(L.rects[i], x, z)) { inW = true; break; }
    }
    if (!inW) return null;
    var floor = 0;
    var pit = pitAt(L, x, z);
    if (pit) floor = pitFloorAt(pit, x, z);
    return { surface: L.surface, floor: floor, depth: +(L.surface - floor).toFixed(2) };
  };
  BR.Gen.L372isWater = function (map, x, z) { return !!BR.Gen.L372waterAt(map, x, z); };
  // 某点池底 Y（坑外/无水区返回 0；E 路 _groundYAt via BR.Levels.L372.floorYAt 用）
  BR.Gen.L372floorAt = function (map, x, z) {
    var L = map.meta && map.meta.l372;
    if (!L) return 0;
    var pit = pitAt(L, x, z);
    return pit ? pitFloorAt(pit, x, z) : 0;
  };

  /* ---------------- placer ---------------- */
  function placeL372(map, rng) {
    var W = map.w, H = map.h, tiles = map.tiles;
    function T(x, y) { return y * W + x; }
    function addPOI(type, tx, ty, data) {
      map.pois.push({ id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} });
    }
    function tileAt(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      return tiles[T(x, y)];
    }
    function roomAt(tx, ty) {
      for (var i = 0; i < map.rooms.length; i++) {
        var r = map.rooms[i];
        if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
      }
      return null;
    }
    // tile BFS（4 向；可排除出生房内部，保证出生房干燥）
    function bfsPath(sx, sy, tx, ty, exclRoom) {
      function ok(x, y) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
        if (tiles[T(x, y)] !== 1) return false;
        if (exclRoom && x >= exclRoom.x && x < exclRoom.x + exclRoom.w &&
            y >= exclRoom.y && y < exclRoom.y + exclRoom.h) return false;
        return true;
      }
      if (!ok(sx, sy) || !ok(tx, ty)) return null;
      var prev = new Int32Array(W * H).fill(-1);
      var s0 = sy * W + sx, t0 = ty * W + tx;
      prev[s0] = s0;
      var q = [s0];
      for (var h = 0; h < q.length; h++) {
        var cur = q[h];
        if (cur === t0) break;
        var cx = cur % W, cy = (cur / W) | 0;
        var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d = 0; d < 4; d++) {
          var nx = cx + nb[d][0], ny = cy + nb[d][1];
          if (!ok(nx, ny)) continue;
          var ni = ny * W + nx;
          if (prev[ni] !== -1) continue;
          prev[ni] = cur; q.push(ni);
        }
      }
      if (prev[t0] === -1) return null;
      var path = [], c = t0;
      for (;;) { path.push([c % W, (c / W) | 0]); if (c === prev[c]) break; c = prev[c]; }
      return path;
    }
    function nearestFloorTile(r, tx, ty) {
      if (tileAt(tx, ty) === 1) return [tx, ty];
      for (var rad = 1; rad < 6; rad++)
        for (var yy = ty - rad; yy <= ty + rad; yy++)
          for (var xx = tx - rad; xx <= tx + rad; xx++) {
            if (xx < r.x || xx >= r.x + r.w || yy < r.y || yy >= r.y + r.h) continue;
            if (tileAt(xx, yy) === 1) return [xx, yy];
          }
      return [tx, ty];
    }
    // 房间内找一个"贴墙"的地板 tile（门/开口装饰用）：返回 {tx,ty,face}，
    // face 为墙所在方位（'N' 表示 (tx,ty-1) 是墙）。
    function edgeTileByWall(r, wantFace) {
      var cands = [];
      var faces = wantFace ? [wantFace] : ['N', 'S', 'E', 'W'];
      for (var yy = r.y; yy < r.y + r.h; yy++)
        for (var xx = r.x; xx < r.x + r.w; xx++) {
          if (tileAt(xx, yy) !== 1) continue;
          for (var f = 0; f < faces.length; f++) {
            var fc = faces[f];
            var nx = xx + (fc === 'E' ? 1 : fc === 'W' ? -1 : 0);
            var ny = yy + (fc === 'S' ? 1 : fc === 'N' ? -1 : 0);
            if (tileAt(nx, ny) === 0) cands.push({ tx: xx, ty: yy, face: fc });
          }
        }
      if (!cands.length) return null;
      return cands[Math.floor(rng.next() * cands.length)];
    }

    var rooms = map.rooms;
    if (!rooms.length) return;
    var spawnR = rooms[0]; // 出生房：干燥（L37 侧发光开口的对应落点）
    var sCX = Math.round(spawnR.cx), sCY = Math.round(spawnR.cy);
    var sft0 = nearestFloorTile(spawnR, sCX, sCY);
    addPOI('spawn', sft0[0], sft0[1], {});

    /* ---- 选泳池厅：空间聚类（贪心最近扩张），保证互相靠近可连通 ---- */
    var cand = [];
    for (var i = 1; i < rooms.length; i++) cand.push(rooms[i]);
    if (!cand.length) return;
    var poolN = Math.min(cand.length, 3 + Math.floor(rng.next() * 3)); // 3~5
    var picked = [cand[Math.floor(rng.next() * cand.length)]];
    function roomDist(a, b) {
      var dx = a.cx - b.cx, dy = a.cy - b.cy;
      return dx * dx + dy * dy;
    }
    while (picked.length < poolN) {
      var best = null, bestD = Infinity, ci, pi;
      for (ci = 0; ci < cand.length; ci++) {
        var cr = cand[ci], dup = false;
        for (pi = 0; pi < picked.length; pi++) if (picked[pi] === cr) { dup = true; break; }
        if (dup) continue;
        var dmin = Infinity;
        for (var pj = 0; pj < picked.length; pj++) {
          var dd = roomDist(cr, picked[pj]);
          if (dd < dmin) dmin = dd;
        }
        if (dmin < bestD) { bestD = dmin; best = cr; }
      }
      if (!best) break;
      picked.push(best);
    }

    /* ---- 水道：泳池厅两两之间 tile BFS 连水（走廊 tile 记为 channel） ---- */
    var flooded = {}; // room.id -> true
    for (var f0 = 0; f0 < picked.length; f0++) flooded[picked[f0].id] = true;
    var channelTiles = [];
    for (var li = 0; li + 1 < picked.length; li++) {
      var A = picked[li], B = picked[li + 1];
      var ax = Math.round(A.cx), ay = Math.round(A.cy);
      var bx = Math.round(B.cx), by = Math.round(B.cy);
      var path = bfsPath(ax, ay, bx, by, spawnR) || bfsPath(ax, ay, bx, by, null);
      if (!path) continue;
      for (var q2 = 0; q2 < path.length; q2++) {
        var ptx = path[q2][0], pty = path[q2][1];
        var pr = roomAt(ptx, pty);
        if (pr === spawnR) continue; // 出生房永不淹没
        if (pr) flooded[pr.id] = true;
        else channelTiles.push([ptx, pty]);
      }
    }
    // channelTiles 按行合并为矩形
    channelTiles.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
    var chanRects = [];
    for (var cr2 = 0; cr2 < channelTiles.length; cr2++) {
      var ct = channelTiles[cr2];
      var last = chanRects[chanRects.length - 1];
      if (last && last.y0 === ct[1] && ct[0] === last.x1 + 1) last.x1 = ct[0];
      else chanRects.push({ x0: ct[0], y0: ct[1], x1: ct[0], y1: ct[1] });
    }
    var pathSet = {};
    for (var ps = 0; ps < channelTiles.length; ps++) pathSet[channelTiles[ps][0] + ',' + channelTiles[ps][1]] = 1;

    /* ---- 露天庭院：从 picked 里选面积最大（≥48 tile²）的 1 间，至多再加 1 间 ----
     * tag='open_court'：lv 侧 setOpenCeil（无天花板、直接见天），
     * 中央有干燥平台（tile=2，floorY=0.55），四周浅水 + 柱。 */
    var openRooms = [];
    (function pickCourts() {
      var byArea = picked.slice().sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
      if (byArea.length && byArea[0].w * byArea[0].h >= 48) {
        byArea[0].tag = 'open_court';
        openRooms.push(byArea[0]);
      }
      if (byArea.length > 1 && byArea[1].w * byArea[1].h >= 40 && rng.chance(0.6)) {
        byArea[1].tag = 'open_court';
        openRooms.push(byArea[1]);
      }
    })();
    function isCourt(r) { return openRooms.indexOf(r) >= 0; }

    function carvePitTiles(pit) {
      for (var yy = pit.ty0; yy <= pit.ty1; yy++)
        for (var xx = pit.tx0; xx <= pit.tx1; xx++)
          tiles[T(xx, yy)] = 2;
    }
    function edgeTowardCenter(r, px, py, pw, ph) {
      var pcx = px + (pw - 1) / 2, pcy = py + (ph - 1) / 2;
      var dx = r.cx - pcx, dy = r.cy - pcy;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
    }
    function oppEdge(e) { return e === 'N' ? 'S' : e === 'S' ? 'N' : e === 'W' ? 'E' : 'W'; }

    var pits = [];
    var deckRects = []; // 干燥平台（swim zone 的 holes 用）
    /* ---- 深水坑：最大非庭院泳池厅里 1 个（3x3，-1.2），台阶 + 扶梯 ---- */
    (function carveDeep() {
      var halls = picked.filter(function (r) { return !isCourt(r); })
        .sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
      if (!halls.length) return;
      var r = halls[0];
      var iw = r.w - 2, ih = r.h - 2;
      if (iw < 3 || ih < 3) return;
      var pw = Math.min(3, iw), ph = Math.min(3, ih);
      var px = r.x + 1 + Math.floor(rng.next() * Math.max(1, iw - pw + 1));
      var py = r.y + 1 + Math.floor(rng.next() * Math.max(1, ih - ph + 1));
      var pit = { tx0: px, ty0: py, tx1: px + pw - 1, ty1: py + ph - 1,
                  floorY: DEEP_FLOOR, kind: 'deep', steps: null, ramp: null };
      var edge = edgeTowardCenter(r, px, py, pw, ph);
      pit.steps = [{ edge: edge, n: 3 }];
      pit.ladder = { edge: oppEdge(edge) };
      carvePitTiles(pit);
      pits.push(pit);
    })();
    /* ---- 干燥平台：庭院中央 3x3（0.55），第二大厅 2x2（0.9） ----
     * 台阶从甲板（fromY=0）向上；deck 上不铺水面。 */
    (function carveDecks() {
      var di, r, dx0, dy0, dp, edges;
      for (di = 0; di < openRooms.length; di++) {
        r = openRooms[di];
        if (r.w < 5 || r.h < 5) continue;
        dx0 = r.x + Math.floor((r.w - 3) / 2);
        dy0 = r.y + Math.floor((r.h - 3) / 2);
        dp = { tx0: dx0, ty0: dy0, tx1: dx0 + 2, ty1: dy0 + 2,
               floorY: 0.55, kind: 'deck', steps: null, ramp: null };
        edges = ['N', 'S'];
        dp.steps = [{ edge: edges[0], n: 2 }, { edge: edges[1], n: 2 }];
        carvePitTiles(dp);
        pits.push(dp);
        deckRects.push(dp);
      }
      var halls = picked.filter(function (r) { return !isCourt(r); })
        .sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
      if (halls.length > 1) {
        r = halls[1];
        if (r.w >= 5 && r.h >= 5) {
          dx0 = r.x + Math.floor((r.w - 2) / 2);
          dy0 = r.y + Math.floor((r.h - 2) / 2);
          var dp2 = { tx0: dx0, ty0: dy0, tx1: dx0 + 1, ty1: dy0 + 1,
                      floorY: 0.9, kind: 'deck', steps: null, ramp: null };
          dp2.steps = [{ edge: edgeTowardCenter(r, dx0, dy0, 2, 2), n: 3 }];
          carvePitTiles(dp2);
          pits.push(dp2);
          deckRects.push(dp2);
        }
      }
    })();
    // 经过房间打 tag（柱子避让/装饰用）
    for (var fi = 0; fi < rooms.length; fi++) {
      if (flooded[rooms[fi].id] && !rooms[fi].tag) rooms[fi].tag = 'pool_hall';
    }

    /* ---- 瓷柱（tile=0 真实碰撞）：大厅柱阵 + 庭院平台角柱 ---- */
    var pillars = [];
    function pitRing(tx, ty) {
      for (var q3 = 0; q3 < pits.length; q3++) {
        var p = pits[q3];
        if (tx >= p.tx0 - 1 && tx <= p.tx1 + 1 && ty >= p.ty0 - 1 && ty <= p.ty1 + 1) return true;
      }
      return false;
    }
    function roomConnected(r) {
      var seen = {}, cnt = 0, total = 0, sx2 = -1, sy2 = -1, xx, yy;
      for (yy = r.y; yy < r.y + r.h; yy++)
        for (xx = r.x; xx < r.x + r.w; xx++) {
          if (tiles[T(xx, yy)] !== 1) continue;
          total++;
          if (sx2 < 0) { sx2 = xx; sy2 = yy; }
        }
      if (!total) return true;
      var qq = [[sx2, sy2]]; seen[sx2 + ',' + sy2] = 1; cnt = 1;
      for (var h2 = 0; h2 < qq.length; h2++) {
        var nb2 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d2 = 0; d2 < 4; d2++) {
          var nx2 = qq[h2][0] + nb2[d2][0], ny2 = qq[h2][1] + nb2[d2][1];
          if (nx2 < r.x || nx2 >= r.x + r.w || ny2 < r.y || ny2 >= r.y + r.h) continue;
          if (tiles[T(nx2, ny2)] !== 1 || seen[nx2 + ',' + ny2]) continue;
          seen[nx2 + ',' + ny2] = 1; cnt++; qq.push([nx2, ny2]);
        }
      }
      return cnt === total;
    }
    for (var rn = 0; rn < picked.length; rn++) {
      (function () {
        var r = picked[rn];
        if (r.w < 8 || r.h < 8) return;
        var cands = [], px2, py2;
        for (py2 = r.y + 2; py2 <= r.y + r.h - 3; py2 += 3)
          for (px2 = r.x + 2; px2 <= r.x + r.w - 3; px2 += 3) {
            if (tiles[T(px2, py2)] !== 1) continue;
            if (pitRing(px2, py2)) continue;
            if (pathSet[px2 + ',' + py2]) continue;
            if (Math.hypot(px2 - r.cx, py2 - r.cy) < 1.5) continue;
            if (!rng.chance(0.5)) continue;
            cands.push([px2, py2]);
          }
        var placed = 0;
        for (var ci2 = 0; ci2 < cands.length && placed < 6; ci2++) {
          var c2 = cands[ci2];
          tiles[T(c2[0], c2[1])] = 0;
          if (roomConnected(r)) { placed++; pillars.push(c2); }
          else tiles[T(c2[0], c2[1])] = 1; // 回退
        }
      })();
    }

    /* ---- 水域矩形（tile 坐标）：淹没房间全覆盖 + 走廊水道 ---- */
    var rects = [];
    for (var ri2 = 0; ri2 < rooms.length; ri2++) {
      var rr2 = rooms[ri2];
      if (flooded[rr2.id]) rects.push({ x0: rr2.x, y0: rr2.y, x1: rr2.x + rr2.w - 1, y1: rr2.y + rr2.h - 1 });
    }
    for (var ri3 = 0; ri3 < chanRects.length; ri3++) rects.push(chanRects[ri3]);

    /* ---- 粉色阳光开口（原著核心元素）：水道两侧墙面 + 庭院/大厅内墙 ----
     * 记录 {tx,ty,face}：face 为墙所在方位；lv 侧在墙面上贴粉色发光矩形。 */
    var pinkOpenings = [];
    function tryPink(tx, ty) {
      if (pinkOpenings.length >= 16) return;
      if (tileAt(tx, ty) !== 1 && tileAt(tx, ty) !== 2) return;
      var faces = ['N', 'S', 'E', 'W'];
      for (var f = 0; f < faces.length; f++) {
        var fc = faces[f];
        var nx = tx + (fc === 'E' ? 1 : fc === 'W' ? -1 : 0);
        var ny = ty + (fc === 'S' ? 1 : fc === 'N' ? -1 : 0);
        if (tileAt(nx, ny) === 0 && rng.chance(0.4)) {
          pinkOpenings.push({ tx: tx, ty: ty, face: fc });
          return;
        }
      }
    }
    // 异常长廊：最长水道两侧连续开口
    (function pinkCorridor() {
      if (!chanRects.length) return;
      var longest = chanRects[0], li;
      for (li = 1; li < chanRects.length; li++) {
        var wA = chanRects[li].x1 - chanRects[li].x0, wB = longest.x1 - longest.x0;
        if (wA > wB) longest = chanRects[li];
      }
      for (var yy = longest.y0; yy <= longest.y1; yy++)
        for (var xx = longest.x0; xx <= longest.x1; xx++) tryPink(xx, yy);
    })();
    // 庭院与大厅内墙：每间 2~3 个
    for (var hr = 0; hr < picked.length; hr++) {
      var hrr = picked[hr];
      var got = 0;
      for (var qy = hrr.y; qy < hrr.y + hrr.h && got < 3; qy++)
        for (var qx = hrr.x; qx < hrr.x + hrr.w && got < 3; qx++) {
          var before = pinkOpenings.length;
          tryPink(qx, qy);
          if (pinkOpenings.length > before) got++;
        }
    }

    /* ---- POI ---- */
    // 入口对应：L37 侧"墙面异常发光开口"的本侧落点（出生房内贴墙）。
    // 接线契约（W-l37）：W-l37 在其 buildContent 里暴露 BR.World.l37_sunlitGate；
    // 本关 onEnter 只读它做一致性校验；实际出生落点用下面的 arrival_gate POI。
    var arrival = edgeTileByWall(spawnR, 'N') || edgeTileByWall(spawnR, null) ||
                  { tx: sft0[0], ty: sft0[1], face: 'S' };
    var awx = (arrival.tx + 0.5) * TILE, awz = (arrival.ty + 0.5) * TILE;
    addPOI('arrival_gate', arrival.tx, arrival.ty,
      { wx: awx, wz: awz, face: arrival.face });
    // 返回 L37：离出生房最远的泳池厅贴墙处（"黑暗开口"→ 回 L37，原著出口）。
    var farR = picked[0], farD = -1, pr3;
    for (pr3 = 0; pr3 < picked.length; pr3++) {
      var dd3 = roomDist(spawnR, picked[pr3]);
      if (dd3 > farD) { farD = dd3; farR = picked[pr3]; }
    }
    var ret = edgeTileByWall(farR, null);
    if (!ret) {
      var rft = nearestFloorTile(farR, Math.round(farR.cx), Math.round(farR.cy));
      ret = { tx: rft[0], ty: rft[1], face: 'S' };
    }
    var rwx = (ret.tx + 0.5) * TILE, rwz = (ret.ty + 0.5) * TILE;
    addPOI('return_gate', ret.tx, ret.ty,
      { wx: rwx, wz: rwz, face: ret.face });
    // Pinnicorns（原著无害实体；孤证趣味设定，见 LORE_V21.md）：水面漂浮装饰
    var pinN = 0;
    for (var pn3 = 0; pn3 < picked.length && pinN < 2; pn3++) {
      var pr4 = picked[pn3];
      if (!rng.chance(0.55)) continue;
      var pwx = (pr4.x + pr4.w / 2) * TILE, pwz = (pr4.y + pr4.h / 2) * TILE;
      var chk = BR.Gen.L372waterAt(map, pwx, pwz);
      var pft;
      if (!chk) {
        pft = nearestFloorTile(pr4, Math.round(pr4.cx), Math.round(pr4.cy));
        pwx = (pft[0] + 0.5) * TILE; pwz = (pft[1] + 0.5) * TILE;
      } else {
        pft = [Math.floor(pwx / TILE), Math.floor(pwz / TILE)];
        if (tileAt(pft[0], pft[1]) !== 1) {
          var nf = nearestFloorTile(pr4, pft[0], pft[1]);
          pwx = (nf[0] + 0.5) * TILE; pwz = (nf[1] + 0.5) * TILE;
        }
      }
      addPOI('pinnicorn', Math.floor(pwx / TILE), Math.floor(pwz / TILE),
        { wx: pwx, wz: pwz, yaw: rng.range(0, 6.2832) });
      pinN++;
    }
    // 拾取（tile-1，保证可达性断言）
    var loot = [['almond', 2], ['almond', 1], ['bandage', 1], ['battery', 1], ['glowstick', 2], ['cashew', 1]];
    var li2 = 0;
    for (var pn4 = 0; pn4 < picked.length && li2 < loot.length; pn4++) {
      var pr5 = picked[pn4];
      var tries = 0;
      while (li2 < loot.length && tries < 4) {
        tries++;
        var ltx = pr5.x + 1 + Math.floor(rng.next() * Math.max(1, pr5.w - 2));
        var lty = pr5.y + 1 + Math.floor(rng.next() * Math.max(1, pr5.h - 2));
        if (tileAt(ltx, lty) !== 1) continue;
        if (pitRing(ltx, lty)) continue;
        addPOI('pickup', ltx, lty, { item: loot[li2][0], n: loot[li2][1] });
        li2++;
        break;
      }
    }
    // 木箱（容器；tile-1）
    var crateItems = ['almond', 'medkit'];
    for (var cn = 0; cn < 2; cn++) {
      var crR = picked[(cn * 2 + 1) % picked.length];
      var ctx = crR.x + 1 + Math.floor(rng.next() * Math.max(1, crR.w - 2));
      var cty = crR.y + 1 + Math.floor(rng.next() * Math.max(1, crR.h - 2));
      if (tileAt(ctx, cty) !== 1 || pitRing(ctx, cty)) continue;
      addPOI('crate', ctx, cty, { item: crateItems[cn] || 'almond' });
    }

    map.meta.l372 = {
      surface: SURF, rects: rects, pits: pits, pillars: pillars, chanRects: chanRects,
      openRooms: openRooms.map(function (r) { return r.id; }),
      pinkOpenings: pinkOpenings,
      arrivalGate: { tx: arrival.tx, ty: arrival.ty, wx: awx, wz: awz, face: arrival.face },
      returnGate: { tx: ret.tx, ty: ret.ty, wx: rwx, wz: rwz, face: ret.face }
    };
  }

  BR.Gen.registerLevel('L372',
    { rw: [6, 11], rh: [6, 11], corrW: [2, 2], loops: [2, 4], wallH: 3.2 },
    placeL372,
    ['spawn', 'return_gate']);
})();
