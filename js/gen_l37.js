/* ============================================================
 * Level 37「泳池房」—— v2.3 Poolrooms 独立空间生成
 * 独立 IIFE：只调用 BR.* 注册钩子，不改动 gen.js 本体。
 * 铁律：placer 只用传入的 rng（禁止用全局随机源与时钟）。
 *
 * v2.3 彻底重塑：禁用"普通后室生成器 + 水池房间"思路。
 * placer 直接丢弃通用房间/走廊布局（tiles.fill(0)），从零建造
 * Poolrooms 空间复合体 —— 建筑本身由水/平台/台阶/楼梯/瓷砖/
 * 通道/拱门/柱廊共同构成，不再是"后室房间里挖几个坑"。
 *
 * 空间语言（每种子恒定出现，位置/朝向随种子变化）：
 *   dry_spawn    出生庭（干燥）：唯一的干燥出生点
 *   dry_gate     门厅（干燥）：Sunlit Gate（→L37.2）+ 异常门
 *   pool_grand   异常开阔的大池室：13x13 中央深水池（-2.2，较暗）、
 *                四周临水平台环（+0.55）、外圈浅水柱列、宽台阶×2、扶梯
 *   pool_colonnade 柱廊大厅：12x5 双柱列浅水长廊，异常延伸感
 *   pool_arch    拱门连接的池室 ×2：拱门入口 + 中央泳池（-1.2）
 *   pool_sink    深水沉降区 + 通往深处的楼梯：临水平台 → 7 级宽大
 *                楼梯（+0.55 → -2.2）→ 深水 basin（-2.2）
 *   pool_submerged 半淹没大厅（v2.1 保留）：架空步道 + 柱列 + 踏步平台
 *   pool_court   下沉庭院（v2.1 保留，修复嵌套坑视觉遮挡）：阶梯环（-0.6）
 *                + 内核深水（-1.8），环与核为不重叠矩形
 *   走廊         浅水走廊（2 tile 宽，水深 0.5）：链式连接所有空间 + 2 回环
 *   underpass    水下通道：最长走廊中段下沉 -2.0，顶部低板（0.8m），需潜穿
 *
 * 水体模型（沿用 v1.4，签名冻结）：
 *   全关统一水面 SURF=0.5（世界 Y），深浅由池底几何形成。
 *   tile=2 的坑：buildContent 里 W.skipWall + setOpenFloor/setOpenCeil，
 *   自建池底/池壁/顶面/台阶；碰撞 W.blocked() 把 tile=2 视为可行走
 *   （E 路游泳物理接管 Y）。
 *   v2.3 新增：坑严格无重叠（杜绝 v2.1 下沉庭院内核被外环地板
 *   盖住的视觉 bug）；邻坑高差边立高差墙（替代"共边不立墙"）。
 *
 *   map.meta.l37 = { surface, rects, pits, pillars, chanRects,
 *                    archTiles, gate }
 *   纯函数（Node 可测，无 document/THREE）：
 *     BR.Gen.L37waterAt(map, x, z) -> null | {surface, floor, depth}
 *     BR.Gen.L37isWater(map, x, z) -> bool
 *     BR.Gen.L37floorAt(map, x, z) -> 池底 Y（坑外/无水区返回 0）
 * 连接契约（不许破坏）：
 *   - POI 'sunlit_gate' + meta.l37.gate（↔L37.2 双向）
 *   - POI 'tunnel'（坑心深水，headUnder 进入 →L7）+ 'deep_zone'
 *   - POI 'shallow_exit'（→L0）、'spawn'、'duck_spawn'（小黄鸭保留）
 *   - 零怪物（宁静保持）
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
      // 四边台阶时转角归 N/S 边所有 —— E/W 边带在 z 向内收 1 tile，
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
    // v2.3：坑严格无重叠，顺序无关；保留反向遍历（兼容旧逻辑）
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
  // 某点池底 Y（坑外/无水区返回 0；E 路 _groundYAt via BR.Levels.L37.floorYAt 用）
  BR.Gen.L37floorAt = function (map, x, z) {
    var L = map.meta && map.meta.l37;
    if (!L) return 0;
    var pit = pitAt(L, x, z);
    return pit ? pitFloorAt(pit, x, z) : 0;
  };

  /* ---------------- placer ---------------- */
  function placeL37(map, rng) {
    var W = map.w, H = map.h, tiles = map.tiles;
    // v2.3：丢弃通用房间/走廊布局，从零建造 Poolrooms 空间复合体
    tiles.fill(0);
    map.rooms.length = 0;
    map.doors.length = 0;
    function T(x, y) { return y * W + x; }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function addPOI(type, tx, ty, data) {
      map.pois.push({ id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} });
    }
    function tileAt(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      return tiles[T(x, y)];
    }
    function setT(x, y, v) {
      if (x >= 1 && y >= 1 && x < W - 1 && y < H - 1) tiles[T(x, y)] = v;
    }
    function carveRect(x0, y0, x1, y1) {
      for (var y = y0; y <= y1; y++)
        for (var x = x0; x <= x1; x++) setT(x, y, 1);
    }

    /* ---- 1. 空间布局（顺序 = 连接链顺序；rooms[0] 为出生庭） ---- */
    var SPACE_DEFS = [
      { type: 'dry_spawn',  w: 4,  h: 5,  tag: 'dry_spawn' },      // 0 出生庭（干燥）
      { type: 'dry_gate',   w: 5,  h: 5,  tag: 'dry_gate' },       // 1 门厅（干燥）：Sunlit Gate + 异常门
      { type: 'grand_pool', w: 13, h: 13, tag: 'pool_grand' },     // 2 异常开阔的大池室
      { type: 'colonnade',  w: 12, h: 5,  tag: 'pool_colonnade' }, // 3 柱廊大厅
      { type: 'arch_pool',  w: 7,  h: 7,  tag: 'pool_arch' },      // 4 拱门池室 A
      { type: 'sink',       w: 14, h: 8,  tag: 'pool_sink' },      // 5 深水沉降区 + 通往深处的楼梯
      { type: 'arch_pool',  w: 6,  h: 6,  tag: 'pool_arch' },      // 6 拱门池室 B
      { type: 'submerged',  w: 8,  h: 8,  tag: 'pool_submerged' }, // 7 半淹没大厅（v2.1 保留）
      { type: 'court',      w: 10, h: 10, tag: 'pool_court' }      // 8 下沉庭院（v2.1 保留，修嵌套）
    ];
    var spaces = [];
    function spacesOverlap(x, y, w, h, pad) {
      for (var i = 0; i < spaces.length; i++) {
        var s = spaces[i];
        if (x - pad < s.x + s.w && x + w + pad > s.x &&
            y - pad < s.y + s.h && y + h + pad > s.y) return true;
      }
      return false;
    }
    for (var si = 0; si < SPACE_DEFS.length; si++) {
      var def = SPACE_DEFS[si];
      // 最后一个空间（庭院）离前一个远一些：保证有一条长走廊可做水下通道
      var sepNeed = (si === SPACE_DEFS.length - 1) ? 16 : 10;
      var placed = null;
      for (var att = 0; att < 1800 && !placed; att++) {
        var pad = att < 600 ? 2 : (att < 1200 ? 1 : 0);
        var sep = att < 600 ? sepNeed : (att < 1200 ? 10 : 0);
        var pw = def.w, ph = def.h;
        var px = 2 + Math.floor(rng.next() * (W - 3 - pw));
        var py = 2 + Math.floor(rng.next() * (H - 3 - ph));
        if (px + pw > W - 2 || py + ph > H - 2) continue;
        if (spacesOverlap(px, py, pw, ph, pad)) continue;
        if (si > 0 && sep > 0) {
          var pv = spaces[si - 1];
          var dcx = (px + pw / 2) - pv.cx, dcy = (py + ph / 2) - pv.cy;
          if (Math.hypot(dcx, dcy) < sep) continue;
        }
        placed = { id: spaces.length, x: px, y: py, w: pw, h: ph,
                   cx: px + (pw - 1) / 2, cy: py + (ph - 1) / 2,
                   tag: def.tag, type: def.type, mouths: [] };
      }
      if (!placed) { // 理论上走不到：地图基本是空的
        placed = { id: spaces.length, x: 2, y: 2, w: def.w, h: def.h,
                   cx: 2 + (def.w - 1) / 2, cy: 2 + (def.h - 1) / 2,
                   tag: def.tag, type: def.type, mouths: [] };
      }
      carveRect(placed.x, placed.y, placed.x + placed.w - 1, placed.y + placed.h - 1);
      spaces.push(placed);
      map.rooms.push(placed);
    }
    var spawnS = spaces[0];

    /* ---- 2. 浅水走廊：链式连接 + 2 条回环（2 tile 宽，水深 0.5） ---- */
    var corrSet = {};    // "x,y" -> 1（走廊 tile；柱/坑避让用）
    var corrLegs = [];   // {x0,y0,x1,y1,horiz} tile 矩形（水域 rect / 水下通道候选用）
    var mouthSet = {};   // "x,y" -> 1（空间门洞 tile；水下通道避让，保证门洞可通行）
    function carveH(y, xa, xb) {
      var x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
      for (var x = x0; x <= x1; x++) {
        setT(x, y, 1); setT(x, y + 1, 1);
        corrSet[x + ',' + y] = 1; corrSet[x + ',' + (y + 1)] = 1;
      }
      corrLegs.push({ x0: x0, y0: y, x1: x1, y1: y + 1, horiz: true });
    }
    function carveV(x, ya, yb) {
      var y0 = Math.min(ya, yb), y1 = Math.max(ya, yb);
      for (var y = y0; y <= y1; y++) {
        setT(x, y, 1); setT(x + 1, y, 1);
        corrSet[x + ',' + y] = 1; corrSet[(x + 1) + ',' + y] = 1;
      }
      corrLegs.push({ x0: x, y0: y0, x1: x + 1, y1: y1, horiz: false });
    }
    // 连接两空间：L 形 2 宽走廊；记录双方门洞（拱门用）。
    // 门洞行/列钳制在 [边+1, 边+尺寸-3]，保证拱门柱有落位。
    function connectSpaces(A, B) {
      var dx = B.cx - A.cx, dy = B.cy - A.cy;
      if (Math.abs(dx) >= Math.abs(dy)) {
        var ay = clamp(Math.round(B.cy - 0.5), A.y + 1, A.y + A.h - 3);
        var by = clamp(Math.round(A.cy - 0.5), B.y + 1, B.y + B.h - 3);
        var ax = dx >= 0 ? A.x + A.w - 1 : A.x;
        var bx = dx >= 0 ? B.x : B.x + B.w - 1;
        carveH(ay, ax, bx);
        carveV(bx, ay, by);
        A.mouths.push({ tx: ax, ty: ay, dir: dx >= 0 ? 'E' : 'W' });
        B.mouths.push({ tx: bx, ty: by, dir: dx >= 0 ? 'W' : 'E' });
        mouthSet[ax + ',' + ay] = 1; mouthSet[bx + ',' + by] = 1;
      } else {
        var ax2 = clamp(Math.round(B.cx - 0.5), A.x + 1, A.x + A.w - 3);
        var bx2 = clamp(Math.round(A.cx - 0.5), B.x + 1, B.x + B.w - 3);
        var ay2 = dy >= 0 ? A.y + A.h - 1 : A.y;
        var by2 = dy >= 0 ? B.y : B.y + B.h - 1;
        carveV(ax2, ay2, by2);
        carveH(by2, ax2, bx2);
        A.mouths.push({ tx: ax2, ty: ay2, dir: dy >= 0 ? 'S' : 'N' });
        B.mouths.push({ tx: bx2, ty: by2, dir: dy >= 0 ? 'N' : 'S' });
        mouthSet[ax2 + ',' + ay2] = 1; mouthSet[bx2 + ',' + by2] = 1;
      }
    }
    for (var ci = 0; ci + 1 < spaces.length; ci++) connectSpaces(spaces[ci], spaces[ci + 1]);
    connectSpaces(spaces[2], spaces[5]); // 回环
    connectSpaces(spaces[3], spaces[7]); // 回环

    /* v2.3：走廊腿避开干燥房内部 —— 回环走廊可能穿过出生庭/门厅，
     * 把干燥房内部（去边缘，门口边缘仍可接水）从 corrLegs 抠掉并拆段。
     * 走廊 tile 照常通行，只是该段无水、保持干燥。 */
    (function clipDryRooms() {
      var dryIn = [];
      for (var di = 0; di < 2; di++) {
        var dr = spaces[di];
        dryIn.push({ x0: dr.x + 1, y0: dr.y + 1, x1: dr.x + dr.w - 2, y1: dr.y + dr.h - 2 });
      }
      var out = [];
      for (var li = 0; li < corrLegs.length; li++) {
        var segs = [corrLegs[li]];
        for (var k = 0; k < dryIn.length; k++) {
          var next = [], ob = dryIn[k];
          for (var sgi = 0; sgi < segs.length; sgi++) {
            var sg = segs[sgi];
            if (sg.x1 < ob.x0 || sg.x0 > ob.x1 || sg.y1 < ob.y0 || sg.y0 > ob.y1) {
              next.push(sg); continue;
            }
            // 相交：沿腿方向拆成障碍前/后两段（腿是轴对齐直线）
            if (sg.horiz) {
              if (sg.x0 < ob.x0) next.push({ x0: sg.x0, y0: sg.y0, x1: ob.x0 - 1, y1: sg.y1, horiz: true });
              if (sg.x1 > ob.x1) next.push({ x0: ob.x1 + 1, y0: sg.y0, x1: sg.x1, y1: sg.y1, horiz: true });
            } else {
              if (sg.y0 < ob.y0) next.push({ x0: sg.x0, y0: sg.y0, x1: sg.x1, y1: ob.y0 - 1, horiz: false });
              if (sg.y1 > ob.y1) next.push({ x0: sg.x0, y0: ob.y1 + 1, x1: sg.x1, y1: sg.y1, horiz: false });
            }
          }
          segs = next;
        }
        for (var fi = 0; fi < segs.length; fi++) out.push(segs[fi]);
      }
      corrLegs.length = 0;
      for (var oi = 0; oi < out.length; oi++) corrLegs.push(out[oi]);
    })();

    /* ---- 3. 拱门：空间门洞两侧立柱（tile=0 真实碰撞）+ lintel（lv 侧） ----
     * 拱门是空间转场的结构标记（非装饰）：柱子有碰撞，门洞保持通行。 */
    var archTiles = {}; // "x,y" -> 1（拱门柱 tile；柱/坑避让用）
    var archTileList = [];
    function tryArch(S, m) {
      var px1, py1, px2, py2;
      if (m.dir === 'E') { px1 = m.tx - 1; py1 = m.ty - 1; px2 = m.tx - 1; py2 = m.ty + 2; }
      else if (m.dir === 'W') { px1 = m.tx + 1; py1 = m.ty - 1; px2 = m.tx + 1; py2 = m.ty + 2; }
      else if (m.dir === 'S') { px1 = m.tx - 1; py1 = m.ty - 1; px2 = m.tx + 2; py2 = m.ty - 1; }
      else { px1 = m.tx - 1; py1 = m.ty + 1; px2 = m.tx + 2; py2 = m.ty + 1; }
      var pts = [[px1, py1], [px2, py2]];
      for (var i = 0; i < 2; i++) {
        var qx = pts[i][0], qy = pts[i][1];
        if (qx < S.x || qx >= S.x + S.w || qy < S.y || qy >= S.y + S.h) return false;
        if (tileAt(qx, qy) !== 1 || corrSet[qx + ',' + qy] || archTiles[qx + ',' + qy]) return false;
      }
      tiles[T(px1, py1)] = 0; tiles[T(px2, py2)] = 0;
      archTiles[px1 + ',' + py1] = 1; archTiles[px2 + ',' + py2] = 1;
      archTileList.push([px1, py1]); archTileList.push([px2, py2]);
      // 大池室的拱门标青色（旧契约：tunnel 所在厅的拱洞做标记）
      addPOI('archway', m.tx, m.ty, { tunnel: S.tag === 'pool_grand', kind: 'mouth', dir: m.dir });
      return true;
    }
    var archCount = 0;
    for (var ai = 0; ai < spaces.length; ai++) {
      var SA = spaces[ai];
      for (var mi = 0; mi < SA.mouths.length; mi++) {
        if (tryArch(SA, SA.mouths[mi])) archCount++;
      }
    }

    /* ---- 4. 坑（tile=2 雕刻；v2.3 铁律：严格无重叠） ---- */
    var pits = [];
    function P(tx0, ty0, tx1, ty1, floorY, kind, opts) {
      var pit = { tx0: tx0, ty0: ty0, tx1: tx1, ty1: ty1, floorY: floorY, kind: kind,
                  steps: null, ramp: null };
      if (opts) for (var k in opts) pit[k] = opts[k];
      return pit;
    }
    function ST(edge, n, fromY) { var s = { edge: edge, n: n }; if (fromY != null) s.fromY = fromY; return s; }
    function carvePit(pit, keepTiles) {
      // v2.3：坑不再改写 tiles（全程保持 tile=1）。
      // 原因：gen.js 的 bfsDist/assertConnected 只认 tile=1 为可走；
      // 坑（tile=2）若落在走廊上会切断连通性。渲染/水体/泳区/池壁全走 pit 矩形，
      // 与 tile 值无关；游泳由水深驱动。拱门柱（tile=0）天然不受影响。
      // keepTiles 参数保留（语义：tile 不动），underpass 沿用。
      pits.push(pit);
    }
    var pillars = [];
    function tryPillar(tx, ty) {
      if (tileAt(tx, ty) !== 1 || corrSet[tx + ',' + ty] || archTiles[tx + ',' + ty]) return false;
      tiles[T(tx, ty)] = 0;
      pillars.push([tx, ty]);
      return true;
    }

    // ---- 2 大池室：中央深水池 + 临水平台环 + 外圈浅水柱列 ----
    (function grandPool() {
      var S = spaces[2], gx = S.x, gy = S.y;
      carvePit(P(gx + 3, gy + 3, gx + 9, gy + 9, PIT_DEEP, 'deep',
        { dark: true, role: 'grand_pool',
          steps: [ST('N', 7, 0.55), ST('S', 7, 0.55)], ladder: { edge: 'E' } }));
      carvePit(P(gx + 2, gy + 2, gx + 10, gy + 2, 0.55, 'deck', { role: 'deck_n', steps: [ST('N', 2, 0)] }));
      carvePit(P(gx + 2, gy + 10, gx + 10, gy + 10, 0.55, 'deck', { role: 'deck_s', steps: [ST('S', 2, 0)] }));
      carvePit(P(gx + 2, gy + 3, gx + 2, gy + 9, 0.55, 'deck', { role: 'deck_w', steps: [ST('W', 2, 0)] }));
      carvePit(P(gx + 10, gy + 3, gx + 10, gy + 9, 0.55, 'deck', { role: 'deck_e', steps: [ST('E', 2, 0)] }));
      var cols = [[gx + 1, gy + 1], [gx + 1, gy + 6], [gx + 1, gy + 11],
                  [gx + 11, gy + 1], [gx + 11, gy + 6], [gx + 11, gy + 11],
                  [gx + 6, gy + 1], [gx + 6, gy + 11]];
      for (var i = 0; i < cols.length; i++) tryPillar(cols[i][0], cols[i][1]);
    })();

    // ---- 3 柱廊大厅：双柱列浅水长廊（无坑，全程涉水） ----
    (function colonnade() {
      var S = spaces[3];
      for (var x = S.x + 1; x <= S.x + S.w - 2; x += 3) {
        tryPillar(x, S.y + 1);
        tryPillar(x, S.y + 3);
      }
    })();

    // ---- 4/6 拱门池室 ----
    function archPool(idx) {
      var S = spaces[idx];
      var inset = 1;
      carvePit(P(S.x + inset, S.y + inset, S.x + S.w - 1 - inset, S.y + S.h - 1 - inset,
        PIT_SWIM, 'swim', { role: 'arch_pool', steps: [ST('S', 3, 0)], ladder: { edge: 'N' } }));
    }
    archPool(4); archPool(6);

    // ---- 5 深水沉降区 + 通往深处的楼梯：平台 → 7 级宽大楼梯 → 深水 basin ----
    (function sink() {
      var S = spaces[5], sx = S.x, sy = S.y;
      carvePit(P(sx + 1, sy + 1, sx + 2, sy + 6, 0.55, 'deck',
        { role: 'deck', steps: [ST('W', 2, 0)] }));
      carvePit(P(sx + 3, sy + 1, sx + 7, sy + 6, PIT_DEEP, 'basin',
        { role: 'grand_stair', steps: [ST('W', 7, 0.55)] }));
      carvePit(P(sx + 8, sy + 1, sx + 12, sy + 6, PIT_DEEP, 'basin',
        { role: 'sink_basin', steps: [ST('S', 5, 0)], ladder: { edge: 'E' } }));
    })();

    // ---- 7 半淹没大厅（v2.1 保留）：架空步道 + 柱列 + 踏步平台 ----
    (function submerged() {
      var S = spaces[7], hx = S.x, hy = S.y;
      carvePit(P(hx + 4, hy + 1, hx + 4, hy + 6, 0.55, 'deck',
        { role: 'deck', steps: [ST('N', 2, 0), ST('S', 2, 0)] }));
      tryPillar(hx + 3, hy + 2); tryPillar(hx + 5, hy + 2);
      tryPillar(hx + 3, hy + 4); tryPillar(hx + 5, hy + 4);
      // 踏步平台：被水隔开的 1x1 平台（涉水前往）
      if (tileAt(hx + 1, hy + 2) === 1 && !corrSet[(hx + 1) + ',' + (hy + 2)])
        carvePit(P(hx + 1, hy + 2, hx + 1, hy + 2, 0.55, 'deck', { role: 'deck', steps: [ST('E', 2, 0)] }));
      if (tileAt(hx + 6, hy + 5) === 1 && !corrSet[(hx + 6) + ',' + (hy + 5)])
        carvePit(P(hx + 6, hy + 5, hx + 6, hy + 5, 0.55, 'deck', { role: 'deck', steps: [ST('W', 2, 0)] }));
    })();

    // ---- 8 下沉庭院（v2.1 保留；v2.3 修复：环与核为不重叠矩形，
    //        杜绝外环地板盖住内核的视觉 bug） ----
    (function court() {
      var S = spaces[8], cx = S.x, cy = S.y;
      carvePit(P(cx + 1, cy + 1, cx + 8, cy + 2, -0.6, 'swim', { role: 'court_shelf', steps: [ST('N', 2, 0)] }));
      carvePit(P(cx + 1, cy + 7, cx + 8, cy + 8, -0.6, 'swim', { role: 'court_shelf', steps: [ST('S', 2, 0)] }));
      carvePit(P(cx + 1, cy + 3, cx + 2, cy + 6, -0.6, 'swim', { role: 'court_shelf', steps: [ST('W', 2, 0)] }));
      carvePit(P(cx + 7, cy + 3, cx + 8, cy + 6, -0.6, 'swim', { role: 'court_shelf', steps: [ST('E', 2, 0)] }));
      carvePit(P(cx + 3, cy + 3, cx + 6, cy + 6, -1.8, 'swim',
        { role: 'court_core',
          steps: [ST('N', 3, -0.6), ST('S', 3, -0.6), ST('E', 3, -0.6), ST('W', 3, -0.6)] }));
    })();

    /* ---- 5. 水下通道：最长走廊直线段中段下沉 -2.0 ----
     * 顶部低板（0.8m），需潜穿；两端拱门标记。候选段必须干净
     *（无坑/柱/拱门 tile），中段 5 tile，两端各留 ≥2 tile。 */
    var underpassPit = null;
    (function underpass() {
      var cands = [];
      for (var i = 0; i < corrLegs.length; i++) {
        var L = corrLegs[i];
        var len = L.horiz ? (L.x1 - L.x0 + 1) : (L.y1 - L.y0 + 1);
        if (len >= 9) cands.push({ leg: L, len: len });
      }
      cands.sort(function (a, b) { return b.len - a.len; });
      function pitRectFor(c) {
        var L = c.leg, mid = (c.len - 5) >> 1, r;
        if (L.horiz) { var px = L.x0 + mid; r = { x0: px, y0: L.y0, x1: px + 4, y1: L.y1 }; }
        else { var py = L.y0 + mid; r = { x0: L.x0, y0: py, x1: L.x1, y1: py + 4 }; }
        return r;
      }
      for (var ci = 0; ci < cands.length; ci++) {
        var r = pitRectFor(cands[ci]);
        var clean = true;
        for (var yy = r.y0; yy <= r.y1 && clean; yy++)
          for (var xx = r.x0; xx <= r.x1 && clean; xx++) {
            var t = tileAt(xx, yy);
            if (t !== 1 || corrSet[xx + ',' + yy] !== 1 ||
                archTiles[xx + ',' + yy] || mouthSet[xx + ',' + yy]) clean = false;
          }
        // v2.3：tile 不再区分坑/走廊，须显式避开已有坑矩形（防重叠）
        if (clean) {
          for (var pi2 = 0; pi2 < pits.length && clean; pi2++) {
            var qp = pits[pi2];
            if (!(r.x1 < qp.tx0 || r.x0 > qp.tx1 || r.y1 < qp.ty0 || r.y0 > qp.ty1)) clean = false;
          }
        }
        if (!clean) continue;
        var L2 = cands[ci].leg, pit;
        if (L2.horiz) {
          pit = P(r.x0, r.y0, r.x1, r.y1, -2.0, 'dive',
            { role: 'underpass', noCeil: true,
              steps: [ST('W', 5, 0), ST('E', 5, 0)],
              slab: { tx0: r.x0 + 1, ty0: r.y0, tx1: r.x1 - 1, ty1: r.y1, yBot: 0.8, yTop: 1.05 } });
        } else {
          pit = P(r.x0, r.y0, r.x1, r.y1, -2.0, 'dive',
            { role: 'underpass', noCeil: true,
              steps: [ST('N', 5, 0), ST('S', 5, 0)],
              slab: { tx0: r.x0, ty0: r.y0 + 1, tx1: r.x1, ty1: r.y1 - 1, yBot: 0.8, yTop: 1.05 } });
        }
        carvePit(pit, true); // tile 保持 1（走廊不断路），坑体走 pit 矩形
        underpassPit = pit;
        // 两端拱门（纯视觉跨廊拱，不占 tile；人在浅水端涉水穿过）
        // v2.3：落点须可走（tile 1/2），否则跳过该拱
        function passageArch(ax, ay, dir) {
          var tt = tileAt(ax, ay);
          if (tt === 1 || tt === 2) addPOI('archway', ax, ay, { tunnel: false, kind: 'passage', dir: dir });
        }
        if (L2.horiz) {
          passageArch(r.x0 - 1, r.y0, 'E');
          passageArch(r.x1 + 1, r.y0, 'E');
        } else {
          passageArch(r.x0, r.y0 - 1, 'S');
          passageArch(r.x0, r.y1 + 1, 'S');
        }
        return;
      }
    })();

    /* ---- 6. 水域矩形（tile 坐标）：湿空间全覆盖 + 走廊 ----
     * 出生庭/门厅干燥（无水）。 */
    var rects = [];
    for (var ri = 0; ri < spaces.length; ri++) {
      var spr = spaces[ri];
      if (spr.tag === 'dry_spawn' || spr.tag === 'dry_gate') continue;
      rects.push({ x0: spr.x, y0: spr.y, x1: spr.x + spr.w - 1, y1: spr.y + spr.h - 1 });
    }
    for (var li = 0; li < corrLegs.length; li++) rects.push(corrLegs[li]);
    var chanRects = corrLegs.slice();
    map.meta.l37 = { surface: SURF, rects: rects, pits: pits, pillars: pillars,
                     chanRects: chanRects, archTiles: archTileList, spaces: spaces.length };

    /* ---- 7. POI ---- */
    function nearestFloorTile(S, tx, ty) {
      if (tileAt(tx, ty) === 1) return [tx, ty];
      for (var rad = 1; rad < 9; rad++)
        for (var yy = ty - rad; yy <= ty + rad; yy++)
          for (var xx = tx - rad; xx <= tx + rad; xx++) {
            if (xx < S.x || xx >= S.x + S.w || yy < S.y || yy >= S.y + S.h) continue;
            if (tileAt(xx, yy) === 1) return [xx, yy];
          }
      return [tx, ty];
    }
    // 出生点：出生庭中心（干燥 tile=1）
    addPOI('spawn', Math.round(spawnS.cx), Math.round(spawnS.cy), {});
    // v2.3：从出生点 tile=1 BFS 可达集 —— 拱门柱+池柱可能夹塞窄环带，
    // POI 落点必须在可达集内，否则 assertConnected / 步行可达断言失败
    var spawnReach = {};
    (function () {
      var sp = null;
      for (var i = 0; i < map.pois.length; i++) if (map.pois[i].type === 'spawn') { sp = map.pois[i]; break; }
      if (!sp) return;
      var q = [[sp.tx, sp.ty]];
      spawnReach[sp.tx + ',' + sp.ty] = 1;
      while (q.length) {
        var cur = q.pop(), cx = cur[0], cy = cur[1];
        var nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (var ni = 0; ni < 4; ni++) {
          var nx = nbs[ni][0], ny = nbs[ni][1], k = nx + ',' + ny;
          if (!spawnReach[k] && tileAt(nx, ny) === 1) { spawnReach[k] = 1; q.push([nx, ny]); }
        }
      }
    })();
    // 泳池 POI ×4（计数兼容）：大池 / 沉降区 / 庭院 / 拱门池 A
    // v2.3：落点须出生点可达（防夹塞孤立带）
    var poolSpaces = [spaces[2], spaces[5], spaces[8], spaces[4]];
    var poolDepths = [2.7, 2.7, 2.3, 1.7];
    for (var pi = 0; pi < poolSpaces.length; pi++) {
      var ps = poolSpaces[pi];
      var ft = nearestFloorTile(ps, Math.round(ps.cx), Math.round(ps.cy));
      if (!spawnReach[ft[0] + ',' + ft[1]]) {
        // 找可达的最近 tile
        var bft = null, bd = Infinity;
        for (var pyy = ps.y; pyy < ps.y + ps.h; pyy++)
          for (var pxx = ps.x; pxx < ps.x + ps.w; pxx++) {
            if (tileAt(pxx, pyy) !== 1 || !spawnReach[pxx + ',' + pyy]) continue;
            var dd = Math.abs(pxx - ps.cx) + Math.abs(pyy - ps.cy);
            if (dd < bd) { bd = dd; bft = [pxx, pyy]; }
          }
        if (bft) ft = bft;
      }
      addPOI('pool', ft[0], ft[1], {
        depth: poolDepths[pi], rw: ps.w, rh: ps.h,
        wcx: (ps.x + ps.w / 2) * TILE, wcz: (ps.y + ps.h / 2) * TILE
      });
    }
    // 深水区标记 + 水下通道（→L7）：大池中央深水坑（kind 'deep' 恒存在）
    var deepPit = null;
    for (var dpi = 0; dpi < pits.length; dpi++)
      if (pits[dpi].kind === 'deep') { deepPit = pits[dpi]; break; }
    // v2.3：从出生点 tile=1 BFS 可达集 —— 拱门柱+池柱可能夹塞外环带，
    // 深水区标记 + 水下通道（→L7）：大池中央深水坑（kind 'deep' 恒存在）
    // （spawnReach 见上文：出生点 tile=1 可达集）
    if (deepPit) {
      // 坑周 tile=1 环（半径 1..3；平台环是 tile=2，取外圈浅水带），仅保留出生点可达的
      var ring = [];
      for (var rr = 1; rr <= 3 && ring.length < 2; rr++) {
        for (var ry3 = deepPit.ty0 - rr; ry3 <= deepPit.ty1 + rr && ring.length < 2; ry3++)
          for (var rx3 = deepPit.tx0 - rr; rx3 <= deepPit.tx1 + rr && ring.length < 2; rx3++) {
            var inPit = rx3 >= deepPit.tx0 && rx3 <= deepPit.tx1 &&
                        ry3 >= deepPit.ty0 && ry3 <= deepPit.ty1;
            if (!inPit && tileAt(rx3, ry3) === 1 && spawnReach[rx3 + ',' + ry3]) ring.push([rx3, ry3]);
          }
      }
      // 兜底：若可达环为空（理论上不应发生），退回不可达环
      if (ring.length === 0) {
        for (var rr2 = 1; rr2 <= 3 && ring.length < 2; rr2++) {
          for (var ry4 = deepPit.ty0 - rr2; ry4 <= deepPit.ty1 + rr2 && ring.length < 2; ry4++)
            for (var rx4 = deepPit.tx0 - rr2; rx4 <= deepPit.tx1 + rr2 && ring.length < 2; rx4++) {
              var inPit2 = rx4 >= deepPit.tx0 && rx4 <= deepPit.tx1 &&
                          ry4 >= deepPit.ty0 && ry4 <= deepPit.ty1;
              if (!inPit2 && tileAt(rx4, ry4) === 1) ring.push([rx4, ry4]);
            }
        }
      }
      var dwx = (deepPit.tx0 + deepPit.tx1 + 1) / 2 * TILE;
      var dwz = (deepPit.ty0 + deepPit.ty1 + 1) / 2 * TILE;
      var deepDepth = +(SURF - deepPit.floorY).toFixed(2);
      // 交互射线最远 4m：浮标放在 POI 朝坑心 2m 处（坑边水下）
      function edgePoint(ptx, pty) {
        var cx = (ptx + 0.5) * TILE, cz = (pty + 0.5) * TILE;
        var dx = dwx - cx, dz = dwz - cz, d = Math.hypot(dx, dz) || 1;
        return [cx + dx / d * 2.0, cz + dz / d * 2.0];
      }
      // v2.0 P3 契约：tunnel 圆环在坑心 —— 坑心水深 2.7，可下潜、头可没入；
      // 坑边常落在台阶上（水深<1m），永远满足不了"潜入水中才能进入"。
      if (ring.length >= 2) {
        var bi = 0, bj = 1, bd = -1;
        for (var q4 = 0; q4 < ring.length; q4++) for (var q5 = q4 + 1; q5 < ring.length; q5++) {
          var dd2 = Math.abs(ring[q4][0] - ring[q5][0]) + Math.abs(ring[q4][1] - ring[q5][1]);
          if (dd2 > bd) { bd = dd2; bi = q4; bj = q5; }
        }
        addPOI('deep_zone', ring[bi][0], ring[bi][1],
          { depth: deepDepth, wx: edgePoint(ring[bi][0], ring[bi][1])[0], wz: edgePoint(ring[bi][0], ring[bi][1])[1] });
        addPOI('tunnel', ring[bj][0], ring[bj][1],
          { depth: deepDepth, wx: dwx, wz: dwz });
      } else if (ring.length === 1) {
        addPOI('deep_zone', ring[0][0], ring[0][1],
          { depth: deepDepth, wx: edgePoint(ring[0][0], ring[0][1])[0], wz: edgePoint(ring[0][0], ring[0][1])[1] });
        addPOI('tunnel', ring[0][0], ring[0][1],
          { depth: deepDepth, wx: dwx, wz: dwz });
      }
    }
    // 浅水出口（→L0）：拱门池室 B 东缘
    // v2.3：选出生点可达的东缘 tile（防拱门柱夹塞 1 宽环带导致孤立）
    (function shallowExit() {
      var S = spaces[6];
      var sx = S.x + S.w - 1;
      var sy = clamp(Math.round(S.cy), S.y + 1, S.y + S.h - 2);
      var best = null, bestD = Infinity;
      for (var yy = S.y; yy < S.y + S.h; yy++)
        for (var xx = S.x; xx < S.x + S.w; xx++) {
          if (tileAt(xx, yy) !== 1 || !spawnReach[xx + ',' + yy]) continue;
          var d = (S.x + S.w - 1 - xx) * 2 + Math.abs(yy - S.cy);
          if (d < bestD) { bestD = d; best = [xx, yy]; }
        }
      if (best) { sx = best[0]; sy = best[1]; }
      else if (tileAt(sx, sy) !== 1) { var sft = nearestFloorTile(S, sx, sy); sx = sft[0]; sy = sft[1]; }
      addPOI('shallow_exit', sx, sy, {});
    })();
    /* ---- 小鸭子坐骑刷新点（v1.5 W5，本游戏原创；v2.3 保留） ----
     * 按区域生成事件一次掷骰（不许每帧抽奖）：候选区 = 大池深水 + 庭院内核，
     * 每个候选区按概率独立掷骰，总数上限 DUCK.max，保持稀少。
     * POI 落在坑边 tile-1（BFS 可达性断言要求）；data.wx/wz 为坑内实际水面点。 */
    var DUCK = BR.Gen.L37DUCK = { prob: 0.35, max: 2, zones: ['grand_pool', 'court_core'] };
    (function placeDucks() {
      var spots = [];
      for (var di = 0; di < pits.length; di++) {
        var dpit = pits[di];
        if (dpit.role !== 'grand_pool' && dpit.role !== 'court_core') continue;
        if (SURF - dpit.floorY < 1.0) continue; // 够深才能浮起鸭子
        var ring = [];
        for (var ry = dpit.ty0 - 3; ry <= dpit.ty1 + 3; ry++)
          for (var rx = dpit.tx0 - 3; rx <= dpit.tx1 + 3; rx++) {
            var inP = rx >= dpit.tx0 && rx <= dpit.tx1 && ry >= dpit.ty0 && ry <= dpit.ty1;
            // v2.3：只取出生点可达的 tile（防拱门柱+池柱夹塞孤立带）
            if (!inP && tileAt(rx, ry) === 1 && spawnReach[rx + ',' + ry]) ring.push([rx, ry]);
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
    /* ---- Sunlit Gate（→L37.2「Sunlit Pools」入口；契约见文件头） ----
     * Fandom 主站依据：Level 37 墙上异常发光的开口，常藏于柱子或旋转楼梯后。
     * 只生成位置并暴露：POI 'sunlit_gate'（tile=1 可达）+ meta.l37.gate；
     * lv 侧据此建发光视觉并置 BR.World.l37_sunlitGate / l37_sunlitReturn。
     * 返回落点 = 开口内侧 2.5m、面向开口。 */
    (function placeSunlitGate() {
      // v2.3：优先门厅（dry_gate），遍历其全部周界格找"内1外0"；
      // 门厅不行再按面积试其他非池空间。保证开口必存在（L37↔L37.2 契约）。
      var cands = spaces.filter(function (r) {
        return r.tag !== 'dry_spawn' && r.tag.indexOf('pool_') !== 0;
      }).sort(function (a, b) {
        var ag = a.tag === 'dry_gate' ? 1 : 0, bg = b.tag === 'dry_gate' ? 1 : 0;
        if (ag !== bg) return bg - ag;
        return (b.w * b.h) - (a.w * a.h);
      });
      if (!cands.length) return;
      var start = BR.hashSeed(map.seed + ':l37gate') % cands.length;
      for (var di = 0; di < cands.length; di++) {
        var pick = cands[(start + di) % cands.length];
        // 周界格：按边收集，中心优先（视觉居中）
        var per = [];
        for (var px = pick.x; px < pick.x + pick.w; px++) {
          per.push({ gx: px, gy: pick.y, e: 'N', ox: 0, oy: -1 });
          per.push({ gx: px, gy: pick.y + pick.h - 1, e: 'S', ox: 0, oy: 1 });
        }
        for (var py = pick.y; py < pick.y + pick.h; py++) {
          per.push({ gx: pick.x, gy: py, e: 'W', ox: -1, oy: 0 });
          per.push({ gx: pick.x + pick.w - 1, gy: py, e: 'E', ox: 1, oy: 0 });
        }
        var cx0 = pick.x + (pick.w >> 1), cy0 = pick.y + (pick.h >> 1);
        per.sort(function (a, b) {
          return (Math.abs(a.gx - cx0) + Math.abs(a.gy - cy0)) -
                 (Math.abs(b.gx - cx0) + Math.abs(b.gy - cy0));
        });
        var sel = null;
        for (var i = 0; i < per.length; i++) {
          var c = per[i];
          if (tileAt(c.gx, c.gy) !== 1) continue;
          if (tileAt(c.gx + c.ox, c.gy + c.oy) !== 0) continue; // 外侧必须是墙
          // v2.3：开口格须出生点可达（不断言关键 POI，但保证玩家能走到）
          if (!spawnReach[c.gx + ',' + c.gy]) continue;
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
  }

  BR.Gen.registerLevel('L37',
    { rw: [6, 11], rh: [6, 11], corrW: [2, 2], loops: [2, 4], wallH: 3.2 },
    placeL37,
    ['spawn', 'tunnel', 'shallow_exit']);
})();
