/* ============================================================
 * Level 37「泳池房」—— 地图生成（placer）+ 纯水体模型
 * 独立 IIFE：只调用 BR.* 注册钩子，不改动 gen.js 本体。
 * 铁律：placer 只用传入的 rng（禁止用全局随机源与时钟）。
 *
 * 水体模型（v1.4 D 路重做）：
 *   全关统一水面高度 SURF（=0.5，世界 Y），深浅全部由池底几何形成：
 *   - 浅滩/走廊：池底 = 0（默认地板），水深 0.5，可涉行；
 *   - 泳池坑：池底 -1.2（tile=2 雕刻），水深 1.7，可游泳；
 *   - 深水坑：池底 -2.2（tile=2 雕刻），水深 2.7，可下潜；
 *   - 缓坡坑：池底沿一轴从 0 线性降到 -1.2；
 *   - 每个坑沿"朝房间中心"的一边带台阶段（n 级，每级宽 3/n 米），
 *     保证任何水域都有可见、可通行的进出路径（无不可见边界）。
 *   tile=2 的坑：buildChunk 视为"墙分支"，lv_l37 buildContent 里对全部
 *   tile=2 调 W.skipWall()（不渲染默认墙体），再自建池底/池壁/顶面几何；
 *   碰撞 W.blocked() 把 tile=2 视为可行走（E 路游泳物理接管 Y）。
 *   瓷柱阵：tile=0（真实碰撞，同 L1 车库柱先例），lv 侧 skipWall + 自建细柱。
 *
 *   map.meta.l37 = { surface, rects:[{x0,y0,x1,y1} tile], pits:[...], pillars:[[tx,ty]] }
 *   纯函数（Node 可测，无 document/THREE）：
 *     BR.Gen.L37waterAt(map, x, z) -> null | {surface, floor, depth}
 *     BR.Gen.L37isWater(map, x, z) -> bool
 * ============================================================ */
(function () {
  var BR = window.BR;
  var TILE = BR.TILE; // 3（米）

  /* ---------------- 水体常量 ---------------- */
  var SURF = 0.5;      // 全关统一水面高度（世界 Y）：跨池/跨区块天然连续
  var PIT_SWIM = -1.2; // 泳池坑底
  var PIT_DEEP = -2.2; // 深水坑底
  BR.Gen.L37SURF = SURF;

  /* ---------------- 纯水体查询（E 路游泳物理用；Node 可测） ---------------- */
  function inTileRect(r, x, z) {
    return x >= r.x0 * TILE && x < (r.x1 + 1) * TILE &&
           z >= r.y0 * TILE && z < (r.y1 + 1) * TILE;
  }
  // 坑内某点的池底 Y（含台阶/缓坡/平台）
  // steps: [{edge:'N'|'S'|'E'|'W', n, fromY}]，台阶带占坑边缘 1 tile，
  //   从 fromY（默认 0=甲板）逐级走向 pit.floorY（可上可下：平台/分层深水）
  function pitFloorAt(pit, x, z) {
    var px0 = pit.tx0 * TILE, px1 = (pit.tx1 + 1) * TILE;
    var pz0 = pit.ty0 * TILE, pz1 = (pit.ty1 + 1) * TILE;
    if (pit.ramp) {
      var t;
      if (pit.ramp.axis === 'x') t = pit.ramp.dir > 0 ? (x - px0) / (px1 - px0) : (px1 - x) / (px1 - px0);
      else t = pit.ramp.dir > 0 ? (z - pz0) / (pz1 - pz0) : (pz1 - z) / (pz1 - pz0);
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      return +(pit.floorY * t).toFixed(3);
    }
    var steps = pit.steps || (pit.step ? [pit.step] : null);
    if (steps) {
      // v2.1：四边台阶（下沉庭院）时，转角归 N/S 边所有 —— E/W 边带在 z 向内收 1 tile，
      // 与 buildPits 几何一致（转角不双重建模，避免 z-fighting）
      var hasNS = false, hasEW = false, s0;
      for (s0 = 0; s0 < steps.length; s0++) {
        if (steps[s0].edge === 'N' || steps[s0].edge === 'S') hasNS = true;
        else hasEW = true;
      }
      var cornerCut = hasNS && hasEW;
      for (var s = 0; s < steps.length; s++) {
        var st = steps[s], n = st.n;
        var fromY = (st.fromY != null ? st.fromY : 0);
        var riser = Math.abs(pit.floorY - fromY) / n, k = -1;
        if (st.edge === 'N') { if (z < pz0 + TILE) k = Math.floor((z - pz0) / TILE * n); }
        else if (st.edge === 'S') { if (z > pz1 - TILE) k = Math.floor((pz1 - z) / TILE * n); }
        else if (st.edge === 'W') {
          if (x < px0 + TILE && (!cornerCut || (z >= pz0 + TILE && z <= pz1 - TILE)))
            k = Math.floor((x - px0) / TILE * n);
        }
        else if (st.edge === 'E') {
          if (x > px1 - TILE && (!cornerCut || (z >= pz0 + TILE && z <= pz1 - TILE)))
            k = Math.floor((px1 - x) / TILE * n);
        }
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
    // v2.1：反向遍历 —— 后压入的坑优先（下沉庭院内核坑覆盖外环，互不干扰旧坑：旧坑互不重叠）
    for (var i = L.pits.length - 1; i >= 0; i--) {
      var p = L.pits[i];
      if (x >= p.tx0 * TILE && x < (p.tx1 + 1) * TILE &&
          z >= p.ty0 * TILE && z < (p.ty1 + 1) * TILE) return p;
    }
    return null;
  }
  // BR.Levels.L37.waterAt 的纯逻辑后援（lv_l37.js 里绑定到当前地图）
  BR.Gen.L37waterAt = function (map, x, z) {
    var L = map.meta && map.meta.l37;
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
  BR.Gen.L37isWater = function (map, x, z) { return !!BR.Gen.L37waterAt(map, x, z); };
  // 某点池底 Y（坑外/无水区返回 0；E 路 _groundYAt  via BR.Levels.L37.floorYAt 用）
  BR.Gen.L37floorAt = function (map, x, z) {
    var L = map.meta && map.meta.l37;
    if (!L) return 0;
    var pit = pitAt(L, x, z);
    return pit ? pitFloorAt(pit, x, z) : 0;
  };

  /* ---------------- placer ---------------- */
  function placeL37(map, rng) {
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

    var rooms = map.rooms;
    var spawnR = rooms[0]; // 出生房：永不淹没
    var sCX = Math.round(spawnR.cx), sCY = Math.round(spawnR.cy);
    addPOI('spawn', sCX, sCY, {});

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
      var best = null, bestD = Infinity;
      for (var ci = 0; ci < cand.length; ci++) {
        var cr = cand[ci], dup = false;
        for (var pi = 0; pi < picked.length; pi++) if (picked[pi] === cr) { dup = true; break; }
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
        if (pr === spawnR) continue; // 出生房永不淹没（此处留干缺口）
        if (pr) flooded[pr.id] = true; // 穿过房间：整间淹没，保证水面连续
        else channelTiles.push([ptx, pty]); // 纯走廊：在水道
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

    /* ---- v1.5 W5 角色分配：lane 长泳道 / grand 宽阔大厅 / tiered 分层泳池 ----
     * picked[0] 恒为深水房（dark；水下通道 POI 依赖），不参与角色分配。
     * lane：最长边 ≥9 tile 的房间 → 长条泳道（2 tile 宽长坑 + 两侧步道柱廊）；
     * grand：面积最大的剩余房间（≥48 tile²）→ 宽阔大厅（大泳池 + 宽台阶 + 临水平台）；
     * tiered：剩余中较长的房间 → 分层泳池（-1.2 浅半 + 台阶带 + -2.2 深半）。
     * 尺寸不够则角色空缺，回退为普通泳池（不许硬塞小房间）。 */
    var roleOf = {}; // room.id -> 'lane' | 'grand' | 'tiered'
    (function assignRoles() {
      var rest = picked.slice(1);
      var laneR = null, gi;
      var byLong = rest.slice().sort(function (a, b) { return Math.max(b.w, b.h) - Math.max(a.w, a.h); });
      for (gi = 0; gi < byLong.length; gi++) {
        if (Math.max(byLong[gi].w, byLong[gi].h) >= 9) { laneR = byLong[gi]; break; }
      }
      if (laneR) roleOf[laneR.id] = 'lane';
      var rest2 = rest.filter(function (r) { return r !== laneR; });
      rest2.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
      var grandR = (rest2.length && rest2[0].w * rest2[0].h >= 48) ? rest2[0] : null;
      if (grandR) roleOf[grandR.id] = 'grand';
      var rest3 = rest2.filter(function (r) { return r !== grandR; });
      for (gi = 0; gi < rest3.length; gi++) {
        var tr = rest3[gi];
        if ((tr.w >= 8 && tr.h >= 6) || (tr.h >= 8 && tr.w >= 6)) { roleOf[tr.id] = 'tiered'; break; }
      }
    })();

    function carvePitTiles(pit) {
      for (var yy = pit.ty0; yy <= pit.ty1; yy++)
        for (var xx = pit.tx0; xx <= pit.tx1; xx++)
          tiles[T(xx, yy)] = 2;
    }
    // 进出边：朝房间中心的一边
    function edgeTowardCenter(r, px, py, pw, ph) {
      var pcx = px + (pw - 1) / 2, pcy = py + (ph - 1) / 2;
      var dx = r.cx - pcx, dy = r.cy - pcy;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
    }
    function oppEdge(e) { return e === 'N' ? 'S' : e === 'S' ? 'N' : e === 'W' ? 'E' : 'W'; }

    /* ---- 坑（tile=2 雕刻）：角色坑 + 普通坑 ---- */
    var pits = [];
    var poolDepths = []; // 每间泳池厅的最大水深（POI data 用）
    // 长泳道柱廊（tile=0 真实碰撞；柱在坑外步道上，不堵泳道本身）
    var laneCols = [];
    for (var pn = 0; pn < picked.length; pn++) {
      (function (n) {
        var r = picked[n];
        var role = roleOf[r.id];
        if (role === 'lane') { // ---- 长条泳道 ----
          r.tag = 'pool_lane';
          var horiz = r.w >= r.h;
          var pit;
          if (horiz) {
            var lcy = Math.round(r.cy);
            pit = { tx0: r.x + 1, ty0: lcy - 1, tx1: r.x + r.w - 2, ty1: lcy,
                    floorY: PIT_SWIM, kind: 'swim', steps: null, ramp: null, role: 'lane' };
          } else {
            var lcx = Math.round(r.cx);
            pit = { tx0: lcx - 1, ty0: r.y + 1, tx1: lcx, ty1: r.y + r.h - 2,
                    floorY: PIT_SWIM, kind: 'swim', steps: null, ramp: null, role: 'lane' };
          }
          var e1 = horiz ? 'W' : 'N', e2 = horiz ? 'E' : 'S';
          pit.steps = [{ edge: e1, n: 3 }, { edge: e2, n: 3 }]; // 两端入水台阶
          pit.ladder = { edge: horiz ? 'N' : 'W' };              // 长边中部扶梯
          carvePitTiles(pit); pits.push(pit); poolDepths.push(+(SURF - PIT_SWIM).toFixed(2));
          // 柱廊：两侧步道（坑外各 1 tile）每 3 tile 一根
          var c0, c1, fixed, d;
          if (horiz) {
            for (d = -1; d <= 1; d += 2) {
              fixed = (d < 0 ? pit.ty0 - 1 : pit.ty1 + 1);
              for (c0 = pit.tx0; c0 <= pit.tx1; c0 += 3) {
                if (tiles[T(c0, fixed)] === 1) { tiles[T(c0, fixed)] = 0; laneCols.push([c0, fixed]); }
              }
            }
          } else {
            for (d = -1; d <= 1; d += 2) {
              fixed = (d < 0 ? pit.tx0 - 1 : pit.tx1 + 1);
              for (c1 = pit.ty0; c1 <= pit.ty1; c1 += 3) {
                if (tiles[T(fixed, c1)] === 1) { tiles[T(fixed, c1)] = 0; laneCols.push([fixed, c1]); }
              }
            }
          }
          return;
        }
        if (role === 'grand') { // ---- 宽阔泳池大厅 ----
          r.tag = 'pool_grand';
          var gw = Math.min(r.w - 2, 5), gh = Math.min(r.h - 2, 5);
          var gx = r.x + 1 + Math.floor((r.w - 2 - gw) / 2);
          var gy = r.y + 1 + Math.floor((r.h - 2 - gh) / 2);
          var gp = { tx0: gx, ty0: gy, tx1: gx + gw - 1, ty1: gy + gh - 1,
                     floorY: PIT_SWIM, kind: 'swim', steps: null, ramp: null, role: 'grand' };
          var ge = edgeTowardCenter(r, gx, gy, gw, gh);
          gp.steps = [{ edge: ge, n: 4 }];       // 宽台阶（4 级，每级 0.3m）
          gp.ladder = { edge: oppEdge(ge) };
          carvePitTiles(gp); pits.push(gp);
          // 临水平台：北墙内侧 1 tile 宽，高出水面 0.55（tile=2，floorY>0；水面不覆盖）
          var dp = { tx0: r.x + 1, ty0: r.y, tx1: r.x + r.w - 2, ty1: r.y,
                     floorY: 0.55, kind: 'deck', steps: [{ edge: 'S', n: 2 }], ramp: null, role: 'grand_deck' };
          carvePitTiles(dp); pits.push(dp);
          poolDepths.push(+(SURF - PIT_SWIM).toFixed(2));
          return;
        }
        if (role === 'tiered') { // ---- 分层泳池：浅半 + 台阶带 + 深半 ----
          r.tag = 'pool_tiered';
          var sp, dp2;
          if (r.w >= r.h) {
            var mx = r.x + (r.w >> 1);
            sp = { tx0: r.x + 1, ty0: r.y + 1, tx1: mx - 1, ty1: r.y + r.h - 2,
                   floorY: PIT_SWIM, kind: 'swim', steps: null, ramp: null, role: 'tiered_s' };
            dp2 = { tx0: mx, ty0: r.y + 1, tx1: r.x + r.w - 2, ty1: r.y + r.h - 2,
                    floorY: PIT_DEEP, kind: 'tiered_deep', steps: [{ edge: 'W', n: 2, fromY: PIT_SWIM }],
                    ramp: null, role: 'tiered_d' };
          } else {
            var mz = r.y + (r.h >> 1);
            sp = { tx0: r.x + 1, ty0: r.y + 1, tx1: r.x + r.w - 2, ty1: mz - 1,
                   floorY: PIT_SWIM, kind: 'swim', steps: null, ramp: null, role: 'tiered_s' };
            dp2 = { tx0: r.x + 1, ty0: mz, tx1: r.x + r.w - 2, ty1: r.y + r.h - 2,
                    floorY: PIT_DEEP, kind: 'tiered_deep', steps: [{ edge: 'N', n: 2, fromY: PIT_SWIM }],
                    ramp: null, role: 'tiered_d' };
          }
          // 浅半入水台阶（朝房间中心）
          var se = edgeTowardCenter(r, sp.tx0, sp.ty0, sp.tx1 - sp.tx0 + 1, sp.ty1 - sp.ty0 + 1);
          // 台阶带占深半边缘：若朝中心边与台阶带同边，换一边
          var deepEdge = dp2.steps[0].edge;
          if (se === deepEdge || se === oppEdge(deepEdge)) {
            var opts = ['N', 'S', 'E', 'W'].filter(function (e) { return e !== deepEdge && e !== oppEdge(deepEdge); });
            se = opts[0];
          }
          sp.steps = [{ edge: se, n: 3 }];
          dp2.ladder = { edge: oppEdge(deepEdge) }; // 深端外缘扶梯
          carvePitTiles(sp); pits.push(sp);
          carvePitTiles(dp2); pits.push(dp2);
          poolDepths.push(+(SURF - PIT_DEEP).toFixed(2));
          return;
        }
        // ---- 普通坑（原逻辑；n===0 恒为深水 = 较暗深水区） ----
        var kind, floorY;
        if (n === 0) { kind = 'deep'; floorY = PIT_DEEP; }        // 首间必深
        else if (n === 1) { kind = 'none'; floorY = 0; }          // 次间必浅
        else if (n === 2) { kind = 'ramp'; floorY = PIT_SWIM; }   // 缓坡
        else { var rr = rng.next(); kind = rr < 0.45 ? 'swim' : (rr < 0.7 ? 'deep' : 'none'); floorY = kind === 'deep' ? PIT_DEEP : PIT_SWIM; }
        if (kind === 'none') {
          r.tag = 'pool_shallow';
          poolDepths.push(SURF);
          return;
        }
        r.tag = (kind === 'deep') ? 'pool_dark' : 'pool_shallow';
        // 坑位：房间内缘 1 格，2~4 tile 见方
        var ix0 = r.x + 1, iy0 = r.y + 1, ix1 = r.x + r.w - 2, iy1 = r.y + r.h - 2;
        var iw = ix1 - ix0 + 1, ih = iy1 - iy0 + 1;
        var pw = Math.min(iw, rng.int(2, 4)), ph = Math.min(ih, rng.int(2, 4));
        var px = ix0 + Math.floor(rng.next() * Math.max(1, iw - pw + 1));
        var py = iy0 + Math.floor(rng.next() * Math.max(1, ih - ph + 1));
        var pit = { tx0: px, ty0: py, tx1: px + pw - 1, ty1: py + ph - 1, floorY: floorY, kind: kind, steps: null, ramp: null };
        if (kind === 'deep') pit.dark = true; // 较暗深水区：光线深度过渡
        // 进出边：朝房间中心的一边
        var edge = edgeTowardCenter(r, px, py, pw, ph);
        if (kind === 'ramp') {
          pit.ramp = edge === 'N' ? { axis: 'z', dir: 1 } : edge === 'S' ? { axis: 'z', dir: -1 } :
                     edge === 'W' ? { axis: 'x', dir: 1 } : { axis: 'x', dir: -1 };
        } else {
          pit.steps = [{ edge: edge, n: Math.ceil(Math.abs(floorY) / 0.45) }]; // 每级 ≤0.45m
          pit.ladder = { edge: oppEdge(edge) };
        }
        carvePitTiles(pit);
        pits.push(pit);
        poolDepths.push(+(SURF - floorY).toFixed(2));
      })(pn);
    }
    /* ---- 转折水道高度变化：最长水道中段挖 2 tile 缓降坑（-0.7），两端台阶 ----
     * 水面保持 SURF 连续；tile=2 可行走，台阶保证进出。 */
    (function carveChannelDip() {
      if (!chanRects.length) return;
      var longest = chanRects[0], li;
      for (li = 1; li < chanRects.length; li++) {
        if ((chanRects[li].x1 - chanRects[li].x0) > (longest.x1 - longest.x0)) longest = chanRects[li];
      }
      if (longest.x1 - longest.x0 + 1 < 5) return;
      var d0 = longest.x0 + 1 + Math.floor((longest.x1 - longest.x0 - 3) / 2);
      var dip = { tx0: d0, ty0: longest.y0, tx1: d0 + 1, ty1: longest.y0,
                  floorY: -0.7, kind: 'dip', steps: [{ edge: 'W', n: 2 }, { edge: 'E', n: 2 }],
                  ramp: null, role: 'dip' };
      carvePitTiles(dip);
      pits.push(dip);
    })();
    // 经过房间（水道厅）打 tag（异常门/柱子避让用）
    for (var fi = 0; fi < rooms.length; fi++) {
      if (flooded[rooms[fi].id] && !rooms[fi].tag) rooms[fi].tag = 'pool_channel';
    }

    /* ---- 瓷柱阵（tile=0 真实碰撞；lv 侧 skipWall + 自建细柱） ----
     * 长泳道柱廊（laneCols）在坑雕刻时已落定，这里并入 pillars。 */
    var pillars = [];
    for (var lc = 0; lc < laneCols.length; lc++) pillars.push(laneCols[lc]);
    var pathSet = {};
    for (var ps = 0; ps < channelTiles.length; ps++) pathSet[channelTiles[ps][0] + ',' + channelTiles[ps][1]] = 1;
    function pitRing(tx, ty) {
      for (var q3 = 0; q3 < pits.length; q3++) {
        var p = pits[q3];
        if (tx >= p.tx0 - 1 && tx <= p.tx1 + 1 && ty >= p.ty0 - 1 && ty <= p.ty1 + 1) return true;
      }
      return false;
    }
    for (var rn = 0; rn < picked.length; rn++) {
      (function () {
        var r = picked[rn];
        if (r.w < 8 || r.h < 8) return; // 只在大厅布柱阵
        var cands = [];
        for (var py2 = r.y + 2; py2 <= r.y + r.h - 3; py2 += 3)
          for (var px2 = r.x + 2; px2 <= r.x + r.w - 3; px2 += 3) {
            if (tiles[T(px2, py2)] !== 1) continue;
            if (pitRing(px2, py2)) continue;
            if (pathSet[px2 + ',' + py2]) continue;
            if (Math.hypot(px2 - r.cx, py2 - r.cy) < 1.5) continue;
            if (!rng.chance(0.55)) continue;
            cands.push([px2, py2]);
          }
        // 逐个试放：放后校验房间 tile-1 连通性，断开则回退（确定性）
        var placed = [];
        function roomConnected() {
          var seen = {}, cnt = 0, total = 0, sx2 = -1, sy2 = -1;
          for (var yy = r.y; yy < r.y + r.h; yy++)
            for (var xx = r.x; xx < r.x + r.w; xx++) {
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
        for (var ci2 = 0; ci2 < cands.length && placed.length < 8; ci2++) {
          var c2 = cands[ci2];
          tiles[T(c2[0], c2[1])] = 0;
          if (roomConnected()) { placed.push(c2); pillars.push(c2); }
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
    map.meta.l37 = { surface: SURF, rects: rects, pits: pits, pillars: pillars, chanRects: chanRects };

    /* ---- v2.1 W-l37 空间重塑：水域塑造建筑 ----
     * 在剩余干燥房间（非出生房/泳池房/水道厅）里按面积挑选特征房，
     * 尺寸不够则该类型空缺（不许硬塞小房间）：
     *  - submerged_hall 半淹没大厅：整间浅淹 0.5m，中央架空步道（deck 0.55）+ 两侧柱列成柱廊，
     *    另有 2 块被水隔开的踏步平台；
     *  - sunken_court 下沉庭院：大房间阶梯式下沉泳池（外环 -0.6 + 内核 -1.8，
     *    内核后压入 pitAt 反向优先），四周 1 tile 干环为临水平台；
     *  - stair_hall 浸水台阶厅：宽台阶从干燥地面直降深水坑（原著「楼梯直接通向深水坑」），两侧立柱；
     *  - dive_channel 水下连通水道：最长水道中段挖深 -2.0（避开缓降坑），需潜穿；
     * 柱廊另由 lane 长泳道两侧柱列承担（已存在）。柱子试放均带房间连通性回退。
     * （放在 meta 赋值之后：rects/pits/pillars 均已声明；数组引用共享，push 即时生效。） */
    (function shapeWaterArchitecture() {
      var featRooms = rooms.filter(function (r) {
        return r !== spawnR && !r.tag && !flooded[r.id];
      }).sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
      function take(minW, minH) {
        for (var i = 0; i < featRooms.length; i++) {
          var r = featRooms[i];
          if (r.w >= minW && r.h >= minH) { featRooms.splice(i, 1); return r; }
        }
        return null;
      }
      function roomConnected(r) {
        var seen = {}, cnt = 0, total = 0, sx = -1, sy = -1, xx, yy;
        for (yy = r.y; yy < r.y + r.h; yy++) for (xx = r.x; xx < r.x + r.w; xx++) {
          if (tiles[T(xx, yy)] !== 1) continue;
          total++;
          if (sx < 0) { sx = xx; sy = yy; }
        }
        if (!total) return true;
        var q = [[sx, sy]]; seen[sx + ',' + sy] = 1; cnt = 1;
        var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var h = 0; h < q.length; h++) for (var d = 0; d < 4; d++) {
          var nx = q[h][0] + nb[d][0], ny = q[h][1] + nb[d][1];
          if (nx < r.x || nx >= r.x + r.w || ny < r.y || ny >= r.y + r.h) continue;
          if (tiles[T(nx, ny)] !== 1 || seen[nx + ',' + ny]) continue;
          seen[nx + ',' + ny] = 1; cnt++; q.push([nx, ny]);
        }
        return cnt === total;
      }
      function tryPillar(r, tx, ty) {
        if (tx < r.x || tx >= r.x + r.w || ty < r.y || ty >= r.y + r.h) return false;
        if (tiles[T(tx, ty)] !== 1) return false;
        tiles[T(tx, ty)] = 0;
        if (roomConnected(r)) { pillars.push([tx, ty]); return true; }
        tiles[T(tx, ty)] = 1;
        return false;
      }
      // ---- 下沉庭院（阶梯式下沉泳池；最先挑：尺寸要求最高，防被大厅抢走） ----
      var court = take(9, 9);
      if (court) {
        var ax0 = court.x + 1, ay0 = court.y + 1, ax1 = court.x + court.w - 2, ay1 = court.y + court.h - 2;
        var bx0 = ax0 + 2, by0 = ay0 + 2, bx1 = ax1 - 2, by1 = ay1 - 2;
        if (bx1 - bx0 + 1 >= 2 && by1 - by0 + 1 >= 2) {
          court.tag = 'pool_court';
          var pitA = { tx0: ax0, ty0: ay0, tx1: ax1, ty1: ay1, floorY: -0.6, kind: 'swim',
                       steps: [{ edge: 'N', n: 3 }, { edge: 'S', n: 3 },
                               { edge: 'E', n: 3 }, { edge: 'W', n: 3 }],
                       ramp: null, role: 'court_shelf' };
          var pitB = { tx0: bx0, ty0: by0, tx1: bx1, ty1: by1, floorY: -1.8, kind: 'swim',
                       steps: [{ edge: 'N', n: 3, fromY: -0.6 }, { edge: 'S', n: 3, fromY: -0.6 },
                               { edge: 'E', n: 3, fromY: -0.6 }, { edge: 'W', n: 3, fromY: -0.6 }],
                       ramp: null, role: 'court_core' };
          carvePitTiles(pitA); carvePitTiles(pitB);
          pits.push(pitA); pits.push(pitB); // 内核后压：pitAt 反向优先
          rects.push({ x0: ax0, y0: ay0, x1: ax1, y1: ay1 });
          flooded[court.id] = true;
          poolDepths.push(+(SURF - (-1.8)).toFixed(2));
        } else {
          court.tag = null; // 内核放不下：回退为普通干燥房
        }
      }
      // ---- 半淹没大厅 ----
      var hall = take(7, 7);
      if (hall) {
        hall.tag = 'pool_submerged';
        rects.push({ x0: hall.x, y0: hall.y, x1: hall.x + hall.w - 1, y1: hall.y + hall.h - 1 });
        flooded[hall.id] = true;
        var hHoriz = hall.w >= hall.h;
        var bw;
        if (hHoriz) {
          var hby = Math.round(hall.cy);
          bw = { tx0: hall.x + 1, ty0: hby, tx1: hall.x + hall.w - 2, ty1: hby,
                 floorY: 0.55, kind: 'deck', steps: [{ edge: 'W', n: 2 }, { edge: 'E', n: 2 }],
                 ramp: null, role: 'hall_bridge' };
          carvePitTiles(bw); pits.push(bw);
          for (var ht = bw.tx0 + 1; ht <= bw.tx1 - 1; ht += 2) {
            tryPillar(hall, ht, hby - 1); tryPillar(hall, ht, hby + 1);
          }
        } else {
          var hbx = Math.round(hall.cx);
          bw = { tx0: hbx, ty0: hall.y + 1, tx1: hbx, ty1: hall.y + hall.h - 2,
                 floorY: 0.55, kind: 'deck', steps: [{ edge: 'N', n: 2 }, { edge: 'S', n: 2 }],
                 ramp: null, role: 'hall_bridge' };
          carvePitTiles(bw); pits.push(bw);
          for (var ht2 = bw.ty0 + 1; ht2 <= bw.ty1 - 1; ht2 += 2) {
            tryPillar(hall, hbx - 1, ht2); tryPillar(hall, hbx + 1, ht2);
          }
        }
        // 被水隔开的踏步平台：2 块 1x1 deck（0.55），一侧台阶下水（涉水前往）
        var pads = 0, tries = 0;
        while (pads < 2 && tries < 24) {
          tries++;
          var ppx = hall.x + 1 + Math.floor(rng.next() * Math.max(1, hall.w - 2));
          var ppy = hall.y + 1 + Math.floor(rng.next() * Math.max(1, hall.h - 2));
          if (tiles[T(ppx, ppy)] !== 1) continue;
          if (ppx >= bw.tx0 - 1 && ppx <= bw.tx1 + 1 && ppy >= bw.ty0 - 1 && ppy <= bw.ty1 + 1) continue;
          var pe = hHoriz ? (ppy < bw.ty0 ? 'S' : 'N') : (ppx < bw.tx0 ? 'E' : 'W');
          var pad = { tx0: ppx, ty0: ppy, tx1: ppx, ty1: ppy,
                      floorY: 0.55, kind: 'deck', steps: [{ edge: pe, n: 2 }],
                      ramp: null, role: 'hall_pad' };
          carvePitTiles(pad); pits.push(pad);
          pads++;
        }
      }
      // ---- 浸水台阶厅（宽台阶直降深水坑） ----
      var sth = take(5, 5);
      if (sth) {
        var sHoriz = sth.w >= sth.h;
        var sp;
        if (sHoriz) {
          var smx = sth.x + (sth.w >> 1);
          sp = { tx0: smx, ty0: sth.y + 1, tx1: sth.x + sth.w - 2, ty1: sth.y + sth.h - 2,
                 floorY: PIT_DEEP, kind: 'deep', steps: [{ edge: 'W', n: 5 }],
                 ramp: null, role: 'stair_hall' };
        } else {
          var smz = sth.y + (sth.h >> 1);
          sp = { tx0: sth.x + 1, ty0: smz, tx1: sth.x + sth.w - 2, ty1: sth.y + sth.h - 2,
                 floorY: PIT_DEEP, kind: 'deep', steps: [{ edge: 'N', n: 5 }],
                 ramp: null, role: 'stair_hall' };
        }
        if ((sp.tx1 - sp.tx0 + 1) >= 2 && (sp.ty1 - sp.ty0 + 1) >= 2) {
          sth.tag = 'pool_stairs';
          carvePitTiles(sp); pits.push(sp);
          rects.push({ x0: sp.tx0, y0: sp.ty0, x1: sp.tx1, y1: sp.ty1 });
          flooded[sth.id] = true;
          poolDepths.push(+(SURF - PIT_DEEP).toFixed(2));
          var st3;
          if (sHoriz) {
            for (st3 = sp.tx0; st3 <= sp.tx1; st3 += 2) {
              tryPillar(sth, st3, sp.ty0 - 1); tryPillar(sth, st3, sp.ty1 + 1);
            }
          } else {
            for (st3 = sp.ty0; st3 <= sp.ty1; st3 += 2) {
              tryPillar(sth, sp.tx0 - 1, st3); tryPillar(sth, sp.tx1 + 1, st3);
            }
          }
        } else {
          sth.tag = null;
        }
      }
      // ---- 水下连通水道（最长水道中段挖深 -2.0，避开缓降坑） ----
      (function diveChannel() {
        if (!chanRects.length) return;
        var best = null, bi;
        for (bi = 0; bi < chanRects.length; bi++) {
          var cr = chanRects[bi], len = cr.x1 - cr.x0 + 1;
          if (len >= 6 && (!best || len > best.x1 - best.x0 + 1)) best = cr;
        }
        if (!best) return;
        for (var d0 = best.x0 + 1; d0 + 2 <= best.x1 - 1; d0++) {
          var free = true;
          for (var pi = 0; pi < pits.length; pi++) {
            var ep = pits[pi];
            if (d0 <= ep.tx1 && d0 + 2 >= ep.tx0 && best.y0 <= ep.ty1 && best.y0 >= ep.ty0) { free = false; break; }
          }
          if (!free) continue;
          var dv = { tx0: d0, ty0: best.y0, tx1: d0 + 2, ty1: best.y0,
                     floorY: -2.0, kind: 'dive', steps: [{ edge: 'W', n: 5 }, { edge: 'E', n: 5 }],
                     ramp: null, role: 'dive_channel' };
          carvePitTiles(dv); pits.push(dv);
          return;
        }
      })();
    })();

    /* ---- POI（落脚 tile 必须为 tile-1，保证可达性断言） ---- */
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
    // 泳池 POI（3~5，数量断言用）
    for (var pi2 = 0; pi2 < picked.length; pi2++) {
      var pr2 = picked[pi2];
      var ft = nearestFloorTile(pr2, Math.round(pr2.cx), Math.round(pr2.cy));
      addPOI('pool', ft[0], ft[1], {
        depth: poolDepths[pi2], rw: pr2.w, rh: pr2.h,
        wcx: (pr2.x + pr2.w / 2) * TILE, wcz: (pr2.y + pr2.h / 2) * TILE
      });
    }
    // 深水区标记 + 水下通道：首间深水坑边（tile-1 环），视觉点在坑心水下
    var deepPit = null;
    for (var dpi = 0; dpi < pits.length; dpi++) if (pits[dpi].kind === 'deep') { deepPit = pits[dpi]; break; }
    if (deepPit) {
      var ring = [];
      for (var ry3 = deepPit.ty0 - 1; ry3 <= deepPit.ty1 + 1; ry3++)
        for (var rx3 = deepPit.tx0 - 1; rx3 <= deepPit.tx1 + 1; rx3++) {
          var inPit = rx3 >= deepPit.tx0 && rx3 <= deepPit.tx1 && ry3 >= deepPit.ty0 && ry3 <= deepPit.ty1;
          if (!inPit && tileAt(rx3, ry3) === 1) ring.push([rx3, ry3]);
        }
      var dwx = (deepPit.tx0 + deepPit.tx1 + 1) / 2 * TILE;
      var dwz = (deepPit.ty0 + deepPit.ty1 + 1) / 2 * TILE;
      var deepDepth = +(SURF - deepPit.floorY).toFixed(2);
      // 交互射线最远 4m：浮标放在 POI 朝坑心 2m 处（坑边水下）。
      // v2.0 P3：tunnel 圆环改放坑心 —— 坑边 2m 处常落在台阶上（水深<1m），
      // 玩家站台阶上头在水面之上，永远满足不了"潜入水中才能进入"；坑心水深 2.7，
      // 可下潜、头可没入，圆环在视野正中也更易发现。
      function edgePoint(ptx, pty) {
        var cx = (ptx + 0.5) * TILE, cz = (pty + 0.5) * TILE;
        var dx = dwx - cx, dz = dwz - cz, d = Math.hypot(dx, dz) || 1;
        return [cx + dx / d * 2.0, cz + dz / d * 2.0];
      }
      if (ring.length >= 2) {
        // 取相距最远的两格，标记与通道分开
        var bi = 0, bj = 1, bd = -1;
        for (var q4 = 0; q4 < ring.length; q4++) for (var q5 = q4 + 1; q5 < ring.length; q5++) {
          var dd2 = Math.abs(ring[q4][0] - ring[q5][0]) + Math.abs(ring[q4][1] - ring[q5][1]);
          if (dd2 > bd) { bd = dd2; bi = q4; bj = q5; }
        }
        addPOI('deep_zone', ring[bi][0], ring[bi][1],
          { depth: deepDepth, wx: edgePoint(ring[bi][0], ring[bi][1])[0], wz: edgePoint(ring[bi][0], ring[bi][1])[1] });
        addPOI('tunnel', ring[bj][0], ring[bj][1],
          { depth: deepDepth, wx: dwx, wz: dwz }); // v2.0 P3：圆环在坑心（见上）
      } else if (ring.length === 1) {
        addPOI('deep_zone', ring[0][0], ring[0][1],
          { depth: deepDepth, wx: edgePoint(ring[0][0], ring[0][1])[0], wz: edgePoint(ring[0][0], ring[0][1])[1] });
        var alt = nearestFloorTile(picked[0], deepPit.tx0, deepPit.ty0 - 1);
        addPOI('tunnel', alt[0], alt[1],
          { depth: deepDepth, wx: dwx, wz: dwz }); // v2.0 P3：圆环在坑心（见上）
      }
    }
    // 浅水出口：次间（必浅）东缘
    var shR = picked[1] || picked[0];
    var sx = shR.x + shR.w - 1;
    var sy = Math.max(shR.y, Math.min(shR.y + shR.h - 1, Math.round(shR.cy)));
    if (tileAt(sx, sy) !== 1) { var sft = nearestFloorTile(shR, sx, sy); sx = sft[0]; sy = sft[1]; }
    addPOI('shallow_exit', sx, sy, {});
    /* ---- 小鸭子坐骑刷新点（v1.5 W5，本游戏原创） ----
     * 按区域生成事件一次掷骰（不许每帧抽奖）：候选区 = 长泳道/宽阔大厅的泳池，
     * 每个候选区按概率独立掷骰，总数上限 DUCK.max，保持稀少。
     * POI 落在坑边 tile-1（BFS 可达性断言要求）；data.wx/wz 为坑内实际水面点。 */
    var DUCK = BR.Gen.L37DUCK = { prob: 0.35, max: 2, zones: ['lane', 'grand'] };
    (function placeDucks() {
      var spots = [];
      for (var di = 0; di < pits.length; di++) {
        var dpit = pits[di];
        if (dpit.role !== 'lane' && dpit.role !== 'grand') continue;
        if (SURF - dpit.floorY < 1.0) continue; // 够深才能浮起鸭子
        var ring = [];
        for (var ry = dpit.ty0 - 1; ry <= dpit.ty1 + 1; ry++)
          for (var rx = dpit.tx0 - 1; rx <= dpit.tx1 + 1; rx++) {
            var inP = rx >= dpit.tx0 && rx <= dpit.tx1 && ry >= dpit.ty0 && ry <= dpit.ty1;
            if (!inP && tileAt(rx, ry) === 1) ring.push([rx, ry]);
          }
        if (ring.length) spots.push({ pit: dpit, ring: ring, zone: dpit.role });
      }
      var drng = new BR.RNG(BR.hashSeed(map.seed + ':l37duck'));
      var placed = 0;
      for (var si = 0; si < spots.length && placed < DUCK.max; si++) {
        if (!drng.chance(DUCK.prob)) continue;
        var spot = spots[si];
        var rt = spot.ring[drng.int(0, spot.ring.length - 1)];
        var pcx = (spot.pit.tx0 + spot.pit.tx1 + 1) / 2 * TILE;
        var pcz = (spot.pit.ty0 + spot.pit.ty1 + 1) / 2 * TILE;
        var ccx = (rt[0] + 0.5) * TILE, ccz = (rt[1] + 0.5) * TILE;
        var ddx = pcx - ccx, ddz = pcz - ccz, dd = Math.hypot(ddx, ddz) || 1;
        var wx = ccx + ddx / dd * 2.2, wz = ccz + ddz / dd * 2.2;
        // 保险：wx/wz 必须落在坑内水域（depth≥1），否则顺延到坑心
        var chk = BR.Gen.L37waterAt(map, wx, wz);
        if (!chk || chk.depth < 1.0) { wx = pcx; wz = pcz; }
        addPOI('duck_spawn', rt[0], rt[1],
          { wx: wx, wz: wz, yaw: drng.range(0, 6.2832), zone: spot.zone });
        placed++;
      }
    })();
    /* ---- v2.1 W-l37：Sunlit Gate（→L37.2「Sunlit Pools」入口预留） ----
     * Fandom 主站依据：Level 37 墙上异常发光的开口，常藏于柱子或旋转楼梯后，
     * 是 secret 子层 Level 37.2 的入口。
     * 本函数只生成位置并暴露：POI 'sunlit_gate'（tile=1 可达）+ meta.l37.gate；
     * lv 侧据此建发光视觉并置 BR.World.l37_sunlitGate / l37_sunlitReturn，
     * 具体跳转逻辑由总协调统一接线。返回落点 = 开口内侧 2.5m、面向开口。 */
    (function placeSunlitGate() {
      var dry = rooms.filter(function (r) {
        return r !== spawnR && !(r.tag && r.tag.indexOf('pool_') === 0) && !flooded[r.id];
      }).sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
      if (!dry.length) return;
      var start = BR.hashSeed(map.seed + ':l37gate') % dry.length;
      for (var di = 0; di < dry.length; di++) {
        var pick = dry[(start + di) % dry.length];
        var edges = [
          { e: 'N', gx: pick.x + (pick.w >> 1), gy: pick.y, ox: 0, oy: -1 },
          { e: 'S', gx: pick.x + (pick.w >> 1), gy: pick.y + pick.h - 1, ox: 0, oy: 1 },
          { e: 'W', gx: pick.x, gy: pick.y + (pick.h >> 1), ox: -1, oy: 0 },
          { e: 'E', gx: pick.x + pick.w - 1, gy: pick.y + (pick.h >> 1), ox: 1, oy: 0 }
        ];
        var rot = BR.hashSeed(map.seed + ':l37gateEdge');
        var sel = null;
        for (var i = 0; i < 4; i++) {
          var c = edges[(rot + i) % 4];
          if (tileAt(c.gx, c.gy) !== 1) continue;
          if (tileAt(c.gx + c.ox, c.gy + c.oy) !== 0) continue; // 外侧必须是墙
          sel = c; break;
        }
        if (!sel) continue;
        // 开口平面：墙面内侧 0.06m；返回落点：内侧 2.5m
        var px = (sel.gx + 0.5) * TILE + sel.ox * (TILE / 2 - 0.06);
        var pz = (sel.gy + 0.5) * TILE + sel.oy * (TILE / 2 - 0.06);
        var yaw = sel.e === 'N' ? 0 : sel.e === 'S' ? Math.PI : sel.e === 'W' ? Math.PI / 2 : -Math.PI / 2;
        var gate = {
          tx: sel.gx, ty: sel.gy, edge: sel.e,
          wx: +px.toFixed(3), wy: 1.45, wz: +pz.toFixed(3), yaw: +yaw.toFixed(4),
          dest: 'L37.2',
          retX: +(px - sel.ox * 2.5).toFixed(3),
          retZ: +(pz - sel.oy * 2.5).toFixed(3),
          retYaw: +Math.atan2(-sel.ox, -sel.oy).toFixed(4)
        };
        addPOI('sunlit_gate', sel.gx, sel.gy, gate);
        map.meta.l37.gate = gate;
        return;
      }
    })();
    // 拱洞：深水厅 + 浅水厅东缘（tunnel 所在厅标青色）
    var archRs = [picked[0]];
    if (picked[1] && archRs.indexOf(picked[1]) < 0) archRs.push(picked[1]);
    if (picked[2] && archRs.length < 3) archRs.push(picked[2]);
    for (var a = 0; a < archRs.length; a++) {
      var ar = archRs[a];
      var ax2 = ar.x + ar.w - 1;
      var ay2 = Math.max(ar.y, Math.min(ar.y + ar.h - 1, Math.round(ar.cy)));
      if (tileAt(ax2, ay2) !== 1) { var aft = nearestFloorTile(ar, ax2, ay2); ax2 = aft[0]; ay2 = aft[1]; }
      addPOI('archway', ax2, ay2, { tunnel: deepPit && ar === picked[0] });
    }
  }

  BR.Gen.registerLevel('L37',
    { rw: [6, 11], rh: [6, 11], corrW: [2, 2], loops: [2, 4], wallH: 3.2 },
    placeL37,
    ['spawn', 'tunnel', 'shallow_exit']);
})();
