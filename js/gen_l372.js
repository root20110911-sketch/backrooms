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
 *                      arrivalGate:{tx,ty,wx,wz,face}, returnGate:{tx,ty,wx,wz,face},
 *                      roles:{gallery,grand,abyss,returnRoom}, mirrorRect, crackRect,
 *                      arches:[{tx,ty,dir}], colonnade:[[tx,ty]] }
 * 纯函数（Node 可测，无 document/THREE）：
 *     BR.Gen.L372waterAt(map, x, z) -> null | {surface, floor, depth}
 *     BR.Gen.L372isWater(map, x, z) -> bool
 *     BR.Gen.L372floorAt(map, x, z) -> 池底 Y（坑外/无水区返回 0）
 *
 * v2.3（W-l372）：让 L37.2 真正独立于 L37，不再是换皮 ——
 *   气质：L37 封闭/池核/静谧 → L37.2 明亮/开阔/天空之境（lv 侧更强光照+更远雾+露天庭院）。
 *   空间序列（按离出生房距离/面积分配角色，宁静休息关里"值得的 5 分钟"）：
 *     发现(gallery,最近厅)：粉色开口画廊 —— 粉色阳光开口加密；
 *     开阔(grand,最大厅)：露天大庭院 —— 柱廊+下沉浅滩+中央平台，一眼见天；
 *     倒影(mirror,大庭院内 3x3)：镜面池 —— 静水（去波纹层）+ 无源涟漪（原创异常）；
 *     异常(abyss,次远厅)：裂纹区 —— 瓷砖裂纹（原著称瓷砖"永远保持崭新"，裂纹即异常，
 *       原创，非原著）+ 深水更暗 + 本厅无粉色开口；
 *     返回(return,最远厅)：黑暗开口 → L37（契约不变）。
 *   拾取/木箱只放有意义的：平台边杏仁水（休息）、深水坑边荧光棒（潜水）、
 *   返回厅木箱+绷带（有人在回去前留下补给）。字条两处：出生房（身份+改编声明）、
 *   裂纹区（异常目击记录，游戏内虚构）。
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

    /* ---- v2.3 空间角色：发现(gallery)→开阔(grand)→倒影(mirror,大庭院内)→异常(abyss)→返回(return)
     * 按"离出生房距离/面积"分配；房间太少时允许角色合并（测试按 picked 数量放宽断言）。 */
    var spawnD2 = function (r) { var dx = r.cx - spawnR.cx, dy = r.cy - spawnR.cy; return dx * dx + dy * dy; };
    var byDist = picked.slice().sort(function (a, b) { return spawnD2(a) - spawnD2(b); });
    var returnRoom = byDist[byDist.length - 1]; // 最远：返回厅（黑暗开口→L37）
    var galleryRoom = byDist[0];                // 最近：发现厅（粉色开口画廊）
    var byArea = picked.slice().sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
    var grandRoom = null, gi2;
    for (gi2 = 0; gi2 < byArea.length; gi2++) {
      if (byArea[gi2] !== galleryRoom && byArea[gi2] !== returnRoom) { grandRoom = byArea[gi2]; break; }
    }
    if (!grandRoom) grandRoom = byArea[0];
    var abyssRoom = null, ai2;
    for (ai2 = byDist.length - 2; ai2 >= 0; ai2--) {
      if (byDist[ai2] !== galleryRoom && byDist[ai2] !== grandRoom) { abyssRoom = byDist[ai2]; break; }
    }
    if (!abyssRoom) abyssRoom = byDist.length > 1 ? byDist[byDist.length - 2] : byDist[0];

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
      // v2.3：大庭院恒为露天（开阔记忆点）；第二庭院看面积+概率
      grandRoom.tag = 'open_court';
      openRooms.push(grandRoom);
      var rest = byArea.filter(function (r) { return r !== grandRoom; });
      if (rest.length && rest[0].w * rest[0].h >= 32 && rng.chance(0.7)) {
        rest[0].tag = 'open_court';
        openRooms.push(rest[0]);
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
    /* ---- 深水坑：v2.3 改放到异常厅（裂纹区的水下部分）；太小则回退到最大非庭院厅 ----
     * 异常厅的深水更暗（pit.dark，原创视觉，非原著），台阶 + 扶梯。 */
    (function carveDeep() {
      function fits(r) { return r && (r.w - 2) >= 3 && (r.h - 2) >= 3; }
      var target = (fits(abyssRoom) && !isCourt(abyssRoom)) ? abyssRoom : null;
      if (!target) {
        var halls = picked.filter(function (r) { return !isCourt(r); })
          .sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
        for (var hi = 0; hi < halls.length; hi++) {
          if (fits(halls[hi])) { target = halls[hi]; break; }
        }
      }
      if (!target) return;
      var r = target;
      var iw = r.w - 2, ih = r.h - 2;
      var pw = Math.min(3, iw), ph = Math.min(3, ih);
      var px = r.x + 1 + Math.floor(rng.next() * Math.max(1, iw - pw + 1));
      var py = r.y + 1 + Math.floor(rng.next() * Math.max(1, ih - ph + 1));
      var pit = { tx0: px, ty0: py, tx1: px + pw - 1, ty1: py + ph - 1,
                  floorY: DEEP_FLOOR, kind: 'deep', steps: null, ramp: null,
                  dark: (target === abyssRoom) };
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
    /* ---- v2.3 下沉浅滩：大庭院 3x2（floorY=0.2，淹没在水下约 0.25m，可涉行） ----
     * lv 侧按实心台体渲染，水面会漫过它（只有 floorY>SURF 的干平台才避水）。
     * 全房间扫描找空位，确定性顺序（rectFree 为函数声明，提升可用）。 */
    (function carveShelf() {
      var r = grandRoom;
      if (!r || r.w < 6 || r.h < 5) return;
      for (var yy = r.y + 1; yy + 1 < r.y + r.h - 1; yy++) {
        for (var xx = r.x + 1; xx + 2 < r.x + r.w - 1; xx++) {
          if (!rectFree(xx, yy, 3, 2, r, 0)) continue;
          var shelf = { tx0: xx, ty0: yy, tx1: xx + 2, ty1: yy + 1,
                        floorY: 0.2, kind: 'shelf', steps: null, ramp: null };
          shelf.steps = [{ edge: edgeTowardCenter(r, xx, yy, 3, 2), n: 2 }];
          carvePitTiles(shelf);
          pits.push(shelf);
          return;
        }
      }
    })();
    /* ---- v2.3 镜面池（倒影）与裂纹区（异常） ----
     * 镜面池：大庭院内 3x3 静水区（lv 侧只留天空反射层、无波纹）+ 无源涟漪；
     * 裂纹区：异常厅内 3x2 瓷砖裂纹。两者均为原创异常，非原著
     * （原著只有粉色开口+白色虚空+恒定微小涟漪+永葆崭新的瓷砖）。 */
    function rectFree(tx0, ty0, w, h, r, margin) {
      var m = margin || 0;
      if (tx0 < r.x || ty0 < r.y || tx0 + w > r.x + r.w || ty0 + h > r.y + r.h) return false;
      for (var q = 0; q < pits.length; q++) {
        var p = pits[q];
        if (tx0 < p.tx1 + 1 + m && tx0 + w > p.tx0 - m &&
            ty0 < p.ty1 + 1 + m && ty0 + h > p.ty0 - m) return false;
      }
      return true;
    }
    function inMirrorT(tx, ty) {
      return !!mirrorRect && tx >= mirrorRect.tx0 && tx <= mirrorRect.tx1 &&
             ty >= mirrorRect.ty0 && ty <= mirrorRect.ty1;
    }
    function inCrack(tx, ty) {
      return !!crackRect && tx >= crackRect.tx0 && tx <= crackRect.tx1 &&
             ty >= crackRect.ty0 && ty <= crackRect.ty1;
    }
    var mirrorRect = null;
    (function placeMirror() {
      var r = grandRoom;
      if (!r || r.w < 5 || r.h < 5) return;
      // 全房间扫描 3x3 空位（避开平台/坑/浅滩），确定性顺序
      for (var yy = r.y + 1; yy + 2 < r.y + r.h - 1; yy++) {
        for (var xx = r.x + 1; xx + 2 < r.x + r.w - 1; xx++) {
          if (rectFree(xx, yy, 3, 3, r, 0)) {
            mirrorRect = { tx0: xx, ty0: yy, tx1: xx + 2, ty1: yy + 2 };
            return;
          }
        }
      }
    })();
    var crackRect = null;
    (function placeCrack() {
      var r = abyssRoom;
      if (!r || r.w < 5 || r.h < 4) return;
      for (var yy = r.y + 1; yy + 1 < r.y + r.h - 1; yy++) {
        for (var xx = r.x + 1; xx + 2 < r.x + r.w - 1; xx++) {
          if (rectFree(xx, yy, 3, 2, r, 0)) {
            crackRect = { tx0: xx, ty0: yy, tx1: xx + 2, ty1: yy + 1 };
            return;
          }
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
    /* ---- v2.3 柱廊：大庭院内缘立柱成排（池核建筑语言） ----
     * 沿庭院长边布置（宽庭院走南侧横排，高庭院走东侧竖排），tile=0 真实碰撞，
     * 先于随机柱阵放置，走 roomConnected 连通校验。 */
    var colonnade = [];
    (function placeColonnade() {
      var r = grandRoom;
      if (!r) return;
      var horiz = r.w >= r.h;
      var line, from, to, x, y, ok;
      if (horiz) {
        if (r.w < 8 || r.h < 6) return;
        line = r.y + r.h - 2; from = r.x + 2; to = r.x + r.w - 3;
      } else {
        if (r.h < 8 || r.w < 6) return;
        line = r.x + r.w - 2; from = r.y + 2; to = r.y + r.h - 3;
      }
      function tryCol(cx, cy) {
        if (tiles[T(cx, cy)] !== 1) return;
        if (pitRing(cx, cy)) return;
        if (pathSet[cx + ',' + cy]) return;
        if (inCrack(cx, cy) || inMirrorT(cx, cy)) return;
        if (Math.hypot(cx - r.cx, cy - r.cy) < 1.5) return;
        tiles[T(cx, cy)] = 0;
        if (roomConnected(r)) { colonnade.push([cx, cy]); pillars.push([cx, cy]); }
        else tiles[T(cx, cy)] = 1; // 回退
      }
      for (var t = from; t <= to && colonnade.length < 4; t += 3) {
        if (horiz) tryCol(t, line); else tryCol(line, t);
      }
    })();
    for (var rn = 0; rn < picked.length; rn++) {
      (function () {
        var r = picked[rn];
        if (r.w < 8 || r.h < 8) return;
        var cands = [], px2, py2;
        for (py2 = r.y + 2; py2 <= r.y + r.h - 3; py2 += 3)
          for (px2 = r.x + 2; px2 <= r.x + r.w - 3; px2 += 3) {
            if (tiles[T(px2, py2)] !== 1) continue;
            if (pitRing(px2, py2)) continue;
            if (inCrack(px2, py2) || inMirrorT(px2, py2)) continue; // v2.3：裂纹/镜面保持干净
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
      if (pinkOpenings.length >= 24) return; // v2.3：画廊加密，上限放宽
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
    // 庭院与大厅内墙：发现厅 6 个（粉色开口画廊），其余 3 个；异常厅没有（v2.3）
    for (var hr = 0; hr < picked.length; hr++) {
      var hrr = picked[hr];
      if (hrr === abyssRoom) continue; // v2.3：异常厅里粉色阳光照不进来
      var want = (hrr === galleryRoom) ? 6 : 3;
      var got = 0;
      for (var qy = hrr.y; qy < hrr.y + hrr.h && got < want; qy++)
        for (var qx = hrr.x; qx < hrr.x + hrr.w && got < want; qx++) {
          var before = pinkOpenings.length;
          tryPink(qx, qy);
          if (pinkOpenings.length > before) got++;
        }
    }

    /* ---- v2.3 拱门：水道上跨水拱（装饰性，不改碰撞） ----
     * 全水道 tile 候选，按"两侧贴墙"程度评分排序取优（柱础贴墙最稳，无墙也立得住，
     * 柱础落在水道 tile 自身范围内，不悬空）。相邻拱门至少隔 2 格。 */
    var arches = [];
    (function placeArches() {
      if (!chanRects.length) return;
      var cands = [], ci, t, tx, ty;
      for (ci = 0; ci < chanRects.length; ci++) {
        var cr = chanRects[ci];
        var horiz = (cr.x1 - cr.x0) >= (cr.y1 - cr.y0);
        var t0 = horiz ? cr.x0 : cr.y0, t1 = horiz ? cr.x1 : cr.y1;
        for (t = t0; t <= t1; t++) {
          tx = horiz ? t : cr.x0; ty = horiz ? cr.y0 : t;
          if (tileAt(tx, ty) !== 1) continue;
          if (pitRing(tx, ty)) continue;
          var s1 = horiz ? tileAt(tx, ty - 1) : tileAt(tx - 1, ty);
          var s2 = horiz ? tileAt(tx, ty + 1) : tileAt(tx + 1, ty);
          var score = (s1 === 0 ? 1 : 0) + (s2 === 0 ? 1 : 0);
          cands.push({ tx: tx, ty: ty, dir: horiz ? 'NS' : 'EW', score: score });
        }
      }
      cands.sort(function (a, b) {
        return (b.score - a.score) || (a.tx - b.tx) || (a.ty - b.ty);
      });
      var n = Math.min(3, cands.length);
      for (var i = 0; i < cands.length && arches.length < n; i++) {
        var c = cands[i], ok = true;
        for (var j = 0; j < arches.length; j++) {
          if (Math.abs(arches[j].tx - c.tx) + Math.abs(arches[j].ty - c.ty) < 3) { ok = false; break; }
        }
        if (ok) arches.push({ tx: c.tx, ty: c.ty, dir: c.dir });
      }
    })();

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
    // v2.3：即 roles.returnRoom（与上面空间角色同一房间）。
    var farR = returnRoom;
    var ret = edgeTileByWall(farR, null);
    if (!ret) {
      var rft = nearestFloorTile(farR, Math.round(farR.cx), Math.round(farR.cy));
      ret = { tx: rft[0], ty: rft[1], face: 'S' };
    }
    var rwx = (ret.tx + 0.5) * TILE, rwz = (ret.ty + 0.5) * TILE;
    addPOI('return_gate', ret.tx, ret.ty,
      { wx: rwx, wz: rwz, face: ret.face });
    // Pinnicorns（原著无害实体；孤证趣味设定，见 LORE_V21.md）：水面漂浮装饰
    // v2.3：优先放在大庭院（开阔水面最显眼）
    var pinRooms = [grandRoom];
    for (var pni = 0; pni < picked.length; pni++) {
      if (picked[pni] !== grandRoom) pinRooms.push(picked[pni]);
    }
    var pinN = 0;
    for (var pn3 = 0; pn3 < pinRooms.length && pinN < 2; pn3++) {
      var pr4 = pinRooms[pn3];
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
    /* ---- v2.3 拾取/木箱：只放有意义的，不许乱塞 ----
     * 大庭院平台边 2×杏仁水（有人在此休息）、深水坑边 1×荧光棒（潜水照明）、
     * 返回厅木箱 medkit（有人在回去前留下多余补给）+ 木箱边 1×绷带。
     * 全部 tile-1、可达（沿用可达性断言）。 */
    function tilesBesidePit(pit) {
      var out = [], xx, yy, q;
      function nearOtherPit(x, y) {
        for (q = 0; q < pits.length; q++) {
          var p = pits[q];
          if (p === pit) continue; // 自身坑的 ring 不算（邻位本就在它旁边）
          if (x >= p.tx0 - 1 && x <= p.tx1 + 1 && y >= p.ty0 - 1 && y <= p.ty1 + 1) return true;
        }
        return false;
      }
      for (yy = pit.ty0 - 1; yy <= pit.ty1 + 1; yy++)
        for (xx = pit.tx0 - 1; xx <= pit.tx1 + 1; xx++) {
          if (xx >= pit.tx0 && xx <= pit.tx1 && yy >= pit.ty0 && yy <= pit.ty1) continue;
          if (xx < 1 || xx >= W - 1 || yy < 1 || yy >= H - 1) continue;
          if (tileAt(xx, yy) !== 1 || nearOtherPit(xx, yy) || inCrack(xx, yy)) continue;
          out.push([xx, yy]);
        }
      return out;
    }
    function deepPitOf() {
      for (var i = 0; i < pits.length; i++) if (pits[i].kind === 'deep') return pits[i];
      return null;
    }
    var dpit = deepPitOf();
    if (dpit) {
      var gpos = tilesBesidePit(dpit);
      if (gpos.length) addPOI('pickup', gpos[0][0], gpos[0][1], { item: 'glowstick', n: 1 });
    }
    if (deckRects.length) {
      var apos = tilesBesidePit(deckRects[0]);
      for (var an = 0; an < Math.min(2, apos.length); an++)
        addPOI('pickup', apos[an][0], apos[an][1], { item: 'almond', n: 1 });
    }
    // 木箱：返回厅，离返回门 2~4 格
    (function placeGateCrate() {
      var best = null, xx, yy;
      for (yy = returnRoom.y; yy < returnRoom.y + returnRoom.h; yy++) {
        for (xx = returnRoom.x; xx < returnRoom.x + returnRoom.w; xx++) {
          if (tileAt(xx, yy) !== 1 || pitRing(xx, yy) || inCrack(xx, yy)) continue;
          if (xx === ret.tx && yy === ret.ty) continue;
          var cd = Math.max(Math.abs(xx - ret.tx), Math.abs(yy - ret.ty));
          if (cd < 2 || cd > 4) continue;
          best = [xx, yy]; break;
        }
        if (best) break;
      }
      if (!best) return;
      addPOI('crate', best[0], best[1], { item: 'medkit' });
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var d = 0; d < 4; d++) {
        var bx = best[0] + nb[d][0], by = best[1] + nb[d][1];
        if (tileAt(bx, by) === 1 && !pitRing(bx, by) && !inCrack(bx, by) &&
            !(bx === ret.tx && by === ret.ty)) {
          addPOI('pickup', bx, by, { item: 'bandage', n: 1 });
          break;
        }
      }
    })();

    map.meta.l372 = {
      surface: SURF, rects: rects, pits: pits, pillars: pillars, chanRects: chanRects,
      openRooms: openRooms.map(function (r) { return r.id; }),
      pinkOpenings: pinkOpenings,
      arrivalGate: { tx: arrival.tx, ty: arrival.ty, wx: awx, wz: awz, face: arrival.face },
      returnGate: { tx: ret.tx, ty: ret.ty, wx: rwx, wz: rwz, face: ret.face },
      // v2.3：空间角色与新要素（旧存档读档重建时缺字段，lv 侧全部按缺省兜底）
      roles: { gallery: galleryRoom.id, grand: grandRoom.id, abyss: abyssRoom.id, returnRoom: returnRoom.id },
      mirrorRect: mirrorRect, crackRect: crackRect, arches: arches, colonnade: colonnade
    };
  }

  BR.Gen.registerLevel('L372',
    { rw: [6, 11], rh: [6, 11], corrW: [2, 2], loops: [2, 4], wallH: 3.2 },
    placeL372,
    ['spawn', 'return_gate']);
})();
