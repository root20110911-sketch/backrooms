/* gen.js —— 随机地图生成器（纯逻辑，不依赖 3D 引擎与 DOM）
 *
 * Node 下测试方法（在 ~/workspace/backrooms 目录执行）：
 *   node tools/test-gen.js
 * 该脚本先加载 js/config.js 与 js/utils.js（提供 window.BR 与 BR.RNG），
 * 再加载本文件，对 5 关 × 种子 [1,2] 做一致性 / 差异性 / 连通性断言。
 *
 * 约定（与 SPEC.md 一致）：
 * - 网格 56×56，tiles: 0=墙 1=地；tx 向东 +x，ty 向南 +z
 * - rooms: {id,x,y,w,h,cx,cy,tag}，tag ∈ 'spawn' | 'exit' | 'safe' | 'power' | 'party' | 'red' | ''
 * - doors: {id,tx,ty,axis,locked,label,exitTo}；
 *   axis='x' 表示门洞沿东西向通行（门装在南北墙上），
 *   axis='z' 表示门洞沿南北向通行（门装在东西墙上）；
 *   门 tile 在 BFS 中视为可通过
 * - pois: {id,type,tx,ty,data}，type 见 SPEC 的 POI type 列表
 * - 本文件只使用 BR.RNG，禁用内置随机与时间 API，保证同一种子逐 tile 一致
 */
(function () {
  var _g = (typeof window !== 'undefined') ? window : globalThis;
  var BR = _g.BR || (_g.BR = {});
  BR.Gen = BR.Gen || {};

  var W = 56, H = 56;

  // 各关卡生成参数：房间尺寸 / 走廊宽 / 回环数 / 墙高
  var LEVEL_CFG = {
    L0:  { rw: [4, 9], rh: [4, 9], corrW: [1, 2], loops: [2, 4], wallH: 3.0, alcove: true,
           openHall: true }, // L0 不用房间+窄走廊：carveOpenHall 挖开阔大厅+柱子+半墙
    L1:  { rw: [3, 6], rh: [3, 6], corrW: [1, 2], loops: [2, 4], wallH: 3.4, warehouse: true,
           garagePillars: true }, // L1 大房间里布混凝土柱阵（connectRooms 之后，_segs 避让）
    L2:  { rw: [3, 5], rh: [3, 5], corrW: [1, 2], loops: [3, 5], wallH: 2.9, wideCorr: true },
    L3:  { rw: [3, 7], rh: [3, 7], corrW: [1, 1], loops: [2, 4], wallH: 3.2 },
    FUN: { rw: [5, 9], rh: [5, 9], corrW: [2, 2], loops: [1, 3], wallH: 3.0, chain: true }
  };

  // 每关必须可达的关键 POI（assertConnected / 兜底打通的依据）
  var CRITICAL = {
    L0:  ['anomaly_wall'],
    L1:  ['exit_corridor', 'fun_hole', 'safe_room', 'blackout'],
    L2:  ['exit_door', 'valve', 'steam'],
    L3:  ['elevator', 'power_room'],
    FUN: ['fun_exit']
  };

  function T(x, y) { return y * W + x; }
  function inCarve(x, y) { return x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function createMap(level, seed) {
    return {
      level: level, seed: seed >>> 0, w: W, h: H,
      tiles: new Uint8Array(W * H),
      rooms: [], doors: [], pois: [],
      wallH: LEVEL_CFG[level].wallH,
      meta: {}
    };
  }

  function setT(map, x, y, v) {
    if (inCarve(x, y)) map.tiles[T(x, y)] = v;
  }

  // ---- 走廊挖掘 ----
  function carveH(map, y, x1, x2, w) {
    var a = Math.min(x1, x2), b = Math.max(x1, x2), off = -(w >> 1);
    for (var x = a; x <= b; x++)
      for (var k = 0; k < w; k++) setT(map, x, y + off + k, 1);
  }
  function carveV(map, x, y1, y2, w) {
    var a = Math.min(y1, y2), b = Math.max(y1, y2), off = -(w >> 1);
    for (var y = a; y <= b; y++)
      for (var k = 0; k < w; k++) setT(map, x + off + k, y, 1);
  }
  // L 形走廊：随机先横后竖 / 先竖后横；把每段直线记入 _segs（蒸汽选址用）
  function carveL(rng, map, x1, y1, x2, y2, w) {
    var legs;
    if (rng.chance(0.5)) legs = [[x1, y1, x2, y1], [x2, y1, x2, y2]];
    else legs = [[x1, y1, x1, y2], [x1, y2, x2, y2]];
    for (var i = 0; i < legs.length; i++) {
      var L = legs[i];
      if (L[0] === L[2] && L[1] === L[3]) continue;
      if (L[1] === L[3]) carveH(map, L[1], L[0], L[2], w);
      else carveV(map, L[0], L[1], L[3], w);
      map._segs.push({ x1: L[0], y1: L[1], x2: L[2], y2: L[3], w: w });
    }
  }

  // ---- 房间 ----
  // 矩形重叠检测（pad 为房间之间的最小墙厚）
  function overlaps(rooms, x, y, w, h, pad, skipId) {
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (r.id === skipId) continue;
      if (x - pad < r.x + r.w && x + w + pad > r.x &&
          y - pad < r.y + r.h && y + h + pad > r.y) return true;
    }
    return false;
  }

  function placeRooms(rng, map, cfg) {
    var target = 14 + rng.int(0, 8); // 14~22 个房间
    var guard = 0, pad = 1;
    while (map.rooms.length < target && guard++ < 1500) {
      if (guard === 900) pad = 0; // 实在摆不下就放宽到允许贴边
      var w, h;
      if (cfg.warehouse && rng.chance(0.35)) { w = rng.int(6, 12); h = rng.int(6, 12); }
      else { w = rng.int(cfg.rw[0], cfg.rw[1]); h = rng.int(cfg.rh[0], cfg.rh[1]); }
      var x = rng.int(2, W - 2 - w), y = rng.int(2, H - 2 - h);
      if (overlaps(map.rooms, x, y, w, h, pad, -1)) continue;
      var room = { id: map.rooms.length, x: x, y: y, w: w, h: h, cx: 0, cy: 0, tag: '' };
      room.cx = x + (w - 1) / 2; room.cy = y + (h - 1) / 2;
      for (var yy = y; yy < y + h; yy++)
        for (var xx = x; xx < x + w; xx++) map.tiles[T(xx, yy)] = 1;
      map.rooms.push(room);
    }
    // L0 房间形状多变：部分房间外扩一个 1~2 格的小凹室，形成不规则轮廓
    if (cfg.alcove) {
      var list = map.rooms.slice();
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!rng.chance(0.35)) continue;
        for (var t = 0; t < 4; t++) {
          var side = rng.int(0, 3), aw = rng.int(1, 2), ah = rng.int(1, 2), ax, ay;
          if (side === 0) { ax = clamp(Math.round(r.cx) - (aw >> 1), r.x, r.x + r.w - aw); ay = r.y - ah; }
          else if (side === 1) { ax = clamp(Math.round(r.cx) - (aw >> 1), r.x, r.x + r.w - aw); ay = r.y + r.h; }
          else if (side === 2) { ax = r.x - aw; ay = clamp(Math.round(r.cy) - (ah >> 1), r.y, r.y + r.h - ah); }
          else { ax = r.x + r.w; ay = clamp(Math.round(r.cy) - (ah >> 1), r.y, r.y + r.h - ah); }
          if (ax < 2 || ay < 2 || ax + aw > W - 2 || ay + ah > H - 2) continue;
          if (overlaps(map.rooms, ax, ay, aw, ah, 1, r.id)) continue;
          for (var by = ay; by < ay + ah; by++)
            for (var bx = ax; bx + 0 < ax + aw; bx++) setT(map, bx, by, 1);
          // 更新房间包围盒
          var nx = Math.min(r.x, ax), ny = Math.min(r.y, ay);
          r.w = Math.max(r.x + r.w, ax + aw) - nx;
          r.h = Math.max(r.y + r.h, ay + ah) - ny;
          r.x = nx; r.y = ny;
          r.cx = r.x + (r.w - 1) / 2; r.cy = r.y + (r.h - 1) / 2;
          break;
        }
      }
    }
  }

  // 每个房间连到已连通集合中最近的房间，再加若干回环
  function connectRooms(rng, map, cfg) {
    var rooms = map.rooms, count = 0;
    function width() {
      if (cfg.wideCorr) return rng.chance(0.65) ? 2 : 1;
      return rng.int(cfg.corrW[0], cfg.corrW[1]);
    }
    function link(a, b) {
      carveL(rng, map, Math.round(a.cx), Math.round(a.cy), Math.round(b.cx), Math.round(b.cy), width());
      count++;
    }
    if (cfg.chain) {
      // FUN：派对室连成串
      for (var i = 1; i < rooms.length; i++) link(rooms[i - 1], rooms[i]);
    } else {
      var connected = [rooms[0]];
      for (var j = 1; j < rooms.length; j++) {
        var r = rooms[j], best = null, bd = Infinity;
        for (var k = 0; k < connected.length; k++) {
          var c = connected[k];
          var d = (r.cx - c.cx) * (r.cx - c.cx) + (r.cy - c.cy) * (r.cy - c.cy);
          if (d < bd) { bd = d; best = c; }
        }
        link(r, best);
        connected.push(r);
      }
    }
    var loops = rng.int(cfg.loops[0], cfg.loops[1]);
    for (var m = 0; m < loops; m++) {
      var a = rng.pick(rooms), b = rng.pick(rooms);
      if (a === b) continue;
      link(a, b);
    }
    map.meta.corridors = count;
    map.meta.loops = loops;
  }

  // ---- BFS ----
  function doorSetOf(map) {
    var s = {};
    for (var i = 0; i < map.doors.length; i++) s[T(map.doors[i].tx, map.doors[i].ty)] = 1;
    return s;
  }
  function bfsDist(map, sx, sy) {
    var tiles = map.tiles, dist = new Int32Array(W * H);
    dist.fill(-1);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return dist;
    var ds = doorSetOf(map);
    if (tiles[T(sx, sy)] !== 1 && !ds[T(sx, sy)]) return dist;
    var qx = [sx], qy = [sy], head = 0;
    dist[T(sx, sy)] = 0;
    while (head < qx.length) {
      var x = qx[head], y = qy[head]; head++;
      var d0 = dist[T(x, y)];
      var nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (var i = 0; i < 4; i++) {
        var nx = nb[i][0], ny = nb[i][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var idx = T(nx, ny);
        if (dist[idx] !== -1) continue;
        if (tiles[idx] === 1 || ds[idx]) {
          dist[idx] = d0 + 1;
          qx.push(nx); qy.push(ny);
        }
      }
    }
    return dist;
  }

  BR.Gen.reachable = function (map, sx, sy, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
    if (sx === tx && sy === ty) {
      var ds = doorSetOf(map);
      return map.tiles[T(tx, ty)] === 1 || !!ds[T(tx, ty)];
    }
    return bfsDist(map, sx, sy)[T(tx, ty)] >= 0;
  };

  // POI 实际需要玩家站到的地板 tile（墙上 POI 取其面朝房间的一侧）
  function poiFloorTile(poi) {
    if (poi.type === 'anomaly_wall')
      return [poi.tx + poi.data.dirx, poi.ty + poi.data.dirz];
    if ((poi.type === 'exit_door' || poi.type === 'fun_exit') && poi.data.fx !== undefined)
      return [poi.data.fx, poi.data.fy];
    return [poi.tx, poi.ty];
  }

  BR.Gen.assertConnected = function (map) {
    var spawn = null, missing = [];
    for (var i = 0; i < map.pois.length; i++)
      if (map.pois[i].type === 'spawn') { spawn = map.pois[i]; break; }
    if (!spawn) return { ok: false, missing: [{ type: 'spawn', id: '?' }] };
    var crit = CRITICAL[map.level] || [];
    var dist = bfsDist(map, spawn.tx, spawn.ty);
    for (var c = 0; c < crit.length; c++) {
      var type = crit[c], found = false;
      for (var j = 0; j < map.pois.length; j++) {
        var p = map.pois[j];
        if (p.type !== type) continue;
        var t = poiFloorTile(p);
        if (t[0] >= 0 && t[0] < map.w && t[1] >= 0 && t[1] < map.h &&
            dist[T(t[0], t[1])] >= 0) { found = true; break; }
      }
      if (!found)
        for (var k = 0; k < map.pois.length; k++)
          if (map.pois[k].type === type) { missing.push({ type: type, id: map.pois[k].id }); break; }
    }
    return { ok: missing.length === 0, missing: missing };
  };

  // 兜底：仍有关键 POI 不可达时，从出生点向其打一条直走廊（挖穿），最多 20 次
  function ensureConnected(map, rng) {
    var s = map.rooms[0];
    for (var attempt = 0; attempt < 20; attempt++) {
      var chk = BR.Gen.assertConnected(map);
      if (chk.ok) return;
      for (var i = 0; i < chk.missing.length; i++) {
        var poi = null;
        for (var j = 0; j < map.pois.length; j++)
          if (map.pois[j].id === chk.missing[i].id) { poi = map.pois[j]; break; }
        if (!poi) continue;
        var t = poiFloorTile(poi);
        carveL(rng, map, Math.round(s.cx), Math.round(s.cy), t[0], t[1], 1);
      }
    }
    if (BR.log) BR.log('gen: 20 次兜底后仍有不可达', JSON.stringify(BR.Gen.assertConnected(map).missing));
  };

  // ---- 通用放置工具 ----
  function addPOI(map, type, tx, ty, data) {
    var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
    map.pois.push(p);
    return p;
  }
  // 薄墙（不稳定切出点）：随机地板格相邻墙，贴墙挤压可随机切出到同层别处
  function placeThinWalls(map, rng, count) {
    var spawn = null;
    for (var i = 0; i < map.pois.length; i++) if (map.pois[i].type === 'spawn') spawn = map.pois[i];
    var placed = 0, guard = 0;
    while (placed < count && guard++ < 80) {
      var r = pickRoom(rng, map, []), t = randTileInRoom(rng, map, r);
      var tx = t[0], ty = t[1];
      var dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]), wall = null;
      for (var d = 0; d < 4; d++) {
        var wx = tx + dirs[d][0], wy = ty + dirs[d][1];
        if (wx < 1 || wy < 1 || wx >= map.w - 1 || wy >= map.h - 1) continue;
        if (map.tiles[T(wx, wy)] !== 1) { wall = dirs[d]; break; }
      }
      if (!wall) continue;
      if (spawn && Math.hypot(tx - spawn.tx, ty - spawn.ty) < 6) continue;
      var dup = false;
      for (var k = 0; k < map.pois.length; k++) {
        var p = map.pois[k];
        if (p.type === 'thin_wall' && Math.hypot(p.tx - tx, p.ty - ty) < 8) { dup = true; break; }
      }
      if (dup) continue;
      addPOI(map, 'thin_wall', tx, ty, { dx: wall[0], dz: wall[1] });
      placed++;
    }
  }
  // 迁跃浆果灌木：极稀有（约 35% 概率出现 0~1 株），种在离出生点偏远的房间。
  // 只用 rng；调用点放在各 placer 末尾，不扰动已有 rng 消耗顺序（已有 POI 位置不变）。
  function placeBerryBush(map, rng) {
    if (rng.next() >= 0.35) return; // 本局没有浆果灌木
    var cands = [];
    for (var i = 1; i < map.rooms.length; i++) cands.push(map.rooms[i]);
    cands.sort(function (a, b) { return b._d - a._d; });
    var far = cands.slice(0, Math.max(1, Math.ceil(cands.length / 3)));
    var r = rng.pick(far);
    var t = randTileInRoom(rng, map, r);
    addPOI(map, 'berry_bush', t[0], t[1], {});
  }
  function addDoor(map, tx, ty, axis, locked, label, exitTo) {
    var d = { id: 'd' + map.doors.length, tx: tx, ty: ty, axis: axis, locked: !!locked, label: label, exitTo: exitTo || null };
    map.doors.push(d);
    return d;
  }
  function doorAt(map, tx, ty) {
    for (var i = 0; i < map.doors.length; i++)
      if (map.doors[i].tx === tx && map.doors[i].ty === ty) return true;
    return false;
  }
  // 在房间内随机找一个地板 tile
  function randTileInRoom(rng, map, room) {
    for (var t = 0; t < 24; t++) {
      var x = rng.int(room.x, room.x + room.w - 1), y = rng.int(room.y, room.y + room.h - 1);
      if (map.tiles[T(x, y)] === 1) return [x, y];
    }
    return [Math.round(room.cx), Math.round(room.cy)];
  }
  // 随机取房间（排除列表除外）
  function pickRoom(rng, map, exclude) {
    var cands = [];
    for (var i = 0; i < map.rooms.length; i++) {
      var bad = false;
      for (var j = 0; j < exclude.length; j++) if (exclude[j] === map.rooms[i]) { bad = true; break; }
      if (!bad) cands.push(map.rooms[i]);
    }
    return rng.pick(cands.length ? cands : map.rooms);
  }
  // 在房间某面墙上找门位：返回 {tx,ty(墙tile),fx,fy(内侧地板),axis}
  function findDoorSpot(rng, map, room) {
    var sides = rng.shuffle([0, 1, 2, 3]); // 0北 1南 2西 3东
    for (var s = 0; s < 4; s++) {
      var side = sides[s], len = side < 2 ? room.w : room.h;
      var offs = [];
      for (var q = 0; q < len; q++) offs.push(q);
      rng.shuffle(offs);
      for (var k = 0; k < offs.length; k++) {
        var o = offs[k], tx, ty, fx, fy, axis;
        if (side === 0) { tx = room.x + o; ty = room.y - 1; fx = tx; fy = room.y; axis = 'z'; }
        else if (side === 1) { tx = room.x + o; ty = room.y + room.h; fx = tx; fy = room.y + room.h - 1; axis = 'z'; }
        else if (side === 2) { tx = room.x - 1; ty = room.y + o; fx = room.x; fy = ty; axis = 'x'; }
        else { tx = room.x + room.w; ty = room.y + o; fx = room.x + room.w - 1; fy = ty; axis = 'x'; }
        if (tx < 1 || ty < 1 || tx > W - 2 || ty > H - 2) continue;
        if (map.tiles[T(tx, ty)] !== 0) continue;  // 外侧必须是墙
        if (doorAt(map, tx, ty)) continue;
        if (map.tiles[T(fx, fy)] !== 1) continue;  // 内侧必须是地板
        return { tx: tx, ty: ty, fx: fx, fy: fy, axis: axis };
      }
    }
    return null;
  }
  // 在一组房间里找任意可用门位；返回 {spot, room}，找不到返回 null
  function findDoorSpotAny(rng, map, rooms) {
    var rs = rng.shuffle(rooms.slice());
    for (var i = 0; i < rs.length; i++) {
      var s = findDoorSpot(rng, map, rs[i]);
      if (s) return { spot: s, room: rs[i] };
    }
    return null;
  }
  // 含 (tx,ty) 的房间（无则 null）
  function roomOf(map, tx, ty) {
    for (var i = 0; i < map.rooms.length; i++) {
      var r = map.rooms[i];
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
    }
    return null;
  }
  // 终极兜底：直接取房间北墙第一格（理论上不会走到，保证不崩）
  function manualWallSpot(room) {
    return { tx: room.x, ty: room.y - 1, fx: room.x, fy: room.y, axis: 'z' };
  }
  function borderDist(room) {
    var d = [
      { d: room.y, dirx: 0, dirz: -1 },
      { d: H - (room.y + room.h), dirx: 0, dirz: 1 },
      { d: room.x, dirx: -1, dirz: 0 },
      { d: W - (room.x + room.w), dirx: 1, dirz: 0 }
    ];
    d.sort(function (a, b) { return a.d - b.d; });
    return d[0];
  }
  function tileInAnyRoom(map, x, y) {
    for (var i = 0; i < map.rooms.length; i++) {
      var r = map.rooms[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
    }
    return false;
  }
  // 走廊 tile（地板但不在任何房间内）
  function corridorTiles(map) {
    var out = [];
    for (var y = 1; y < H - 1; y++)
      for (var x = 1; x < W - 1; x++)
        if (map.tiles[T(x, y)] === 1 && !tileInAnyRoom(map, x, y)) out.push([x, y]);
    return out;
  }
  function allFloorTiles(map) {
    var out = [];
    for (var y = 1; y < H - 1; y++)
      for (var x = 1; x < W - 1; x++)
        if (map.tiles[T(x, y)] === 1) out.push([x, y]);
    return out;
  }
  // 散布取点（farthest-point 采样，保证巡逻路线覆盖不同区域）
  function spreadPoints(rng, cands, n) {
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

  // 离 (tx,ty) 最近的走廊 tile（走廊不存在则退化为全地板）
  function nearestCorrTile(map, tx, ty) {
    var cands = corridorTiles(map);
    if (!cands.length) cands = allFloorTiles(map);
    var best = null, bd = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var d = (cands[i][0] - tx) * (cands[i][0] - tx) + (cands[i][1] - ty) * (cands[i][1] - ty);
      if (d < bd) { bd = d; best = cands[i]; }
    }
    return best;
  }

  // ---- 各关 POI 放置 ----
  function placeCommonSpawn(map) {
    var s = map.rooms[0];
    s.tag = 'spawn';
    addPOI(map, 'spawn', Math.round(s.cx), Math.round(s.cy), {});
  }

  // 矩形相交检测（含边界接触）
  function boxIntersects(a, b) {
    return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
  }

  // ---- L0 开阔大厅地形（后室观感：半开放大空间 + 柱子/半墙遮挡，不用窄迷宫走廊） ----
  // 思路来源：开源后室生成（davidpcahill/backrooms 的 pillar halls；
  // H1an1/meathill backrooms 的"大厅被独立半墙 slab 分隔 + 经典柱林区"）——只借鉴思路。
  // 4 个相互重叠的大厅（重叠=天然连通）+ 独立半墙 + 柱阵 + 封闭马尼拉房间。
  // 结果存 map._slabs（半墙列表）/ map._manila（门与内厅边界）供 placeL0 用，generate 末尾删除。
  function carveOpenHall(rng, map) {
    var defs = [
      { x: 4,  y: 5,  w: 21, h: 18 },
      { x: 23, y: 4,  w: 21, h: 19 },
      { x: 11, y: 21, w: 22, h: 19 },
      { x: 31, y: 22, w: 20, h: 18 }
    ];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var x = clamp(d.x + rng.int(-2, 2), 2, W - 2 - d.w);
      var y = clamp(d.y + rng.int(-2, 2), 2, H - 2 - d.h);
      var w = Math.min(d.w + rng.int(-2, 2), W - 2 - x);
      var h = Math.min(d.h + rng.int(-2, 2), H - 2 - y);
      for (var yy = y; yy < y + h; yy++)
        for (var xx = x; xx < x + w; xx++) map.tiles[T(xx, yy)] = 1;
      var room = { id: map.rooms.length, x: x, y: y, w: w, h: h, cx: 0, cy: 0, tag: '' };
      room.cx = x + (w - 1) / 2; room.cy = y + (h - 1) / 2;
      map.rooms.push(room);
    }
    // 抖动后若某厅与其余厅不连通（无重叠/贴边），用 4 格宽走廊接上，保持开阔感
    for (var j = 1; j < map.rooms.length; j++) {
      var rj = map.rooms[j], touch = false;
      for (var k = 0; k < j; k++) {
        var rk = map.rooms[k];
        if (rj.x <= rk.x + rk.w && rj.x + rj.w >= rk.x &&
            rj.y <= rk.y + rk.h && rj.y + rj.h >= rk.y) { touch = true; break; }
      }
      if (!touch) {
        var cx0 = Math.round(rj.cx), cy0 = Math.round(rj.cy);
        var cx1 = Math.round(map.rooms[0].cx), cy1 = Math.round(map.rooms[0].cy);
        carveH(map, cy0, cx0, cx1, 4);
        carveV(map, cx1, cy0, cy1, 4);
      }
    }
    // 马尼拉房间：封闭矩形（内厅 3×3 tiles = 9×9m，贴近原设定 8×8m）+ 一圈墙 + 一扇门（走 map.doors，不上锁）
    // 契约（建造工人按此在 levels.js 建内饰）：POI 在门 tile 上，
    // data = {x0,y0,x1,y1（内厅 tile 边界，含）, doorTx, doorTy（门 tile）}
    var hallCenters = map.rooms.map(function (r) { return [Math.round(r.cx), Math.round(r.cy)]; });
    var mh = map.rooms[1 + rng.int(0, map.rooms.length - 2)]; // 不在出生厅
    var mw = 5, mhh = 5; // 含一圈墙 → 内厅 3×3 tiles = 9×9m（原设定 8×8m，3m/tile 下最接近的整数解）
    var mx = -1, my = -1;
    for (var mg = 0; mg < 60 && mx < 0; mg++) {
      var tx0 = rng.int(mh.x + 2, mh.x + mh.w - mw - 2);
      var ty0 = rng.int(mh.y + 2, mh.y + mh.h - mhh - 2);
      var clash = false;
      for (var ci = 0; ci < hallCenters.length; ci++) { // 不压住任何大厅中心（POI 落点）
        var hc = hallCenters[ci];
        if (hc[0] >= tx0 && hc[0] < tx0 + mw && hc[1] >= ty0 && hc[1] < ty0 + mhh) { clash = true; break; }
      }
      if (!clash) { mx = tx0; my = ty0; }
    }
    if (mx < 0) { mx = mh.x + 2; my = mh.y + 2; } // 终极兜底（理论上走不到）
    var x0 = mx + 1, y0 = my + 1, x1 = mx + mw - 2, y1 = my + mhh - 2;
    for (var wy = my; wy < my + mhh; wy++)
      for (var wx = mx; wx < mx + mw; wx++)
        if (wx === mx || wy === my || wx === mx + mw - 1 || wy === my + mhh - 1)
          setT(map, wx, wy, 0);
    var sides = rng.shuffle([0, 1, 2, 3]); // 0北 1南 2西 3东
    var dtx = -1, dty = -1, daxis = 'x', doorOk = false;
    for (var s = 0; s < 4 && !doorOk; s++) {
      var offs = [];
      var span = sides[s] < 2 ? mw - 2 : mhh - 2;
      for (var q = 1; q <= span; q++) offs.push(q);
      rng.shuffle(offs);
      for (var oi = 0; oi < offs.length; oi++) {
        var o = offs[oi], tx, ty, ox, oy;
        if (sides[s] === 0)      { tx = mx + o; ty = my;           ox = tx; oy = ty - 1; daxis = 'x'; }
        else if (sides[s] === 1) { tx = mx + o; ty = my + mhh - 1; ox = tx; oy = ty + 1; daxis = 'x'; }
        else if (sides[s] === 2) { tx = mx;     ty = my + o;       ox = tx - 1; oy = ty; daxis = 'z'; }
        else                     { tx = mx + mw - 1; ty = my + o;  ox = tx + 1; oy = ty; daxis = 'z'; }
        // 门外必须是厅地板（房间整体埋在大厅里，恒成立；仍做检查防极端种子）
        if (map.tiles[T(ox, oy)] === 1 && !doorAt(map, tx, ty)) {
          addDoor(map, tx, ty, daxis, false, '木门', null);
          dtx = tx; dty = ty; doorOk = true; break;
        }
      }
    }
    if (!doorOk) { // 终极兜底（理论上走不到）
      dtx = mx + 1; dty = my;
      addDoor(map, dtx, dty, 'x', false, '木门', null);
    }
    map._manila = { doorTx: dtx, doorTy: dty, x0: x0, y0: y0, x1: x1, y1: y1 };
    var manilaEx = { x0: mx - 1, y0: my - 1, x1: mx + mw, y1: my + mhh };
    // 独立半墙（freestanding slabs）：大厅里的遮挡，直段、互不接触、不贴厅边——不形成封闭口袋
    var slabs = [];
    var nSlab = 10 + rng.int(0, 5), sguard = 0;
    while (slabs.length < nSlab && sguard++ < 250) {
      var h = rng.pick(map.rooms);
      var len = rng.int(3, 7), horiz = rng.chance(0.5);
      var sw = horiz ? len : 1, sh = horiz ? 1 : len;
      if (h.w < sw + 5 || h.h < sh + 5) continue;
      var sx = rng.int(h.x + 2, h.x + h.w - 2 - sw);
      var sy = rng.int(h.y + 2, h.y + h.h - 2 - sh);
      // 不压任何大厅中心（大厅互相重叠，半墙可能落在别厅的中心 POI 落点上）
      var badC = false;
      for (var ci2 = 0; ci2 < hallCenters.length; ci2++) {
        var hx = hallCenters[ci2][0], hy = hallCenters[ci2][1];
        if (sx <= hx + 1 && sx + sw - 1 >= hx - 1 && sy <= hy + 1 && sy + sh - 1 >= hy - 1) { badC = true; break; }
      }
      if (badC) continue;
      var box = { x0: sx - 2, y0: sy - 2, x1: sx + sw + 1, y1: sy + sh + 1 };
      if (boxIntersects(box, manilaEx)) continue;
      var ok = true;
      for (var bi = 0; bi < slabs.length; bi++)
        if (boxIntersects(box, slabs[bi].box)) { ok = false; break; }
      if (!ok) continue;
      for (var by = sy; by < sy + sh; by++)
        for (var bx = sx; bx < sx + sw; bx++) setT(map, bx, by, 0);
      slabs.push({ x: sx, y: sy, w: sw, h: sh, box: box });
    }
    // 柱阵：网格柱林（经典后室柱林），随机缺几根，柱距 4 不可能围死人
    var zones = [], nZone = 2 + rng.int(0, 1), zguard = 0, zplaced = 0;
    while (zplaced < nZone && zguard++ < 120) {
      var hz = rng.pick(map.rooms);
      var zw = rng.int(7, 10), zh = rng.int(7, 10);
      if (hz.w < zw + 5 || hz.h < zh + 5) continue;
      var zx = rng.int(hz.x + 2, hz.x + hz.w - 2 - zw);
      var zy = rng.int(hz.y + 2, hz.y + hz.h - 2 - zh);
      var zbox = { x0: zx - 1, y0: zy - 1, x1: zx + zw, y1: zy + zh };
      if (boxIntersects(zbox, manilaEx)) continue;
      var zok = true;
      for (var zi = 0; zi < slabs.length; zi++)
        if (boxIntersects(zbox, slabs[zi].box)) { zok = false; break; }
      for (var pj = 0; pj < zones.length; pj++)
        if (boxIntersects(zbox, zones[pj])) { zok = false; break; }
      if (!zok) continue;
      for (var py = zy; py < zy + zh; py += 4)
        for (var px = zx; px < zx + zw; px += 4) {
          if (rng.chance(0.25)) continue;
          var nearC = false; // 不压任何大厅中心
          for (var ci3 = 0; ci3 < hallCenters.length; ci3++)
            if (Math.hypot(px - hallCenters[ci3][0], py - hallCenters[ci3][1]) < 3) { nearC = true; break; }
          if (nearC) continue;
          setT(map, px, py, 0);
        }
      zones.push(zbox); zplaced++;
    }
    map._slabs = slabs;
  }

  // L0 薄墙（不稳定切出点）×6：大厅贴外墙的地板格 / 半墙旁（开阔地形专用）
  function placeThinWallsOpen(map, rng, count) {
    var spawn = null;
    for (var i = 0; i < map.pois.length; i++)
      if (map.pois[i].type === 'spawn') spawn = map.pois[i];
    var cands = [];
    for (var ri = 0; ri < map.rooms.length; ri++) {
      var r = map.rooms[ri];
      for (var x = r.x; x < r.x + r.w; x++) {
        if (map.tiles[T(x, r.y)] === 1 && map.tiles[T(x, r.y - 1)] === 0)
          cands.push([x, r.y, 0, -1]);
        if (map.tiles[T(x, r.y + r.h - 1)] === 1 && map.tiles[T(x, r.y + r.h)] === 0)
          cands.push([x, r.y + r.h - 1, 0, 1]);
      }
      for (var y = r.y; y < r.y + r.h; y++) {
        if (map.tiles[T(r.x, y)] === 1 && map.tiles[T(r.x - 1, y)] === 0)
          cands.push([r.x, y, -1, 0]);
        if (map.tiles[T(r.x + r.w - 1, y)] === 1 && map.tiles[T(r.x + r.w, y)] === 0)
          cands.push([r.x + r.w - 1, y, 1, 0]);
      }
    }
    var slabs = map._slabs || [];
    for (var s = 0; s < slabs.length; s++) {
      var sb = slabs[s];
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var sy = sb.y; sy < sb.y + sb.h; sy++)
        for (var sx = sb.x; sx < sb.x + sb.w; sx++)
          for (var dd = 0; dd < 4; dd++) {
            var nx = sx + dirs[dd][0], ny = sy + dirs[dd][1];
            if (map.tiles[T(nx, ny)] === 1) cands.push([nx, ny, -dirs[dd][0], -dirs[dd][1]]);
          }
    }
    rng.shuffle(cands);
    var placed = 0;
    for (var i = 0; i < cands.length && placed < count; i++) {
      var c = cands[i];
      if (spawn && Math.hypot(c[0] - spawn.tx, c[1] - spawn.ty) < 6) continue;
      var dup = false;
      for (var k = 0; k < map.pois.length; k++) {
        var p = map.pois[k];
        if (p.type === 'thin_wall' && Math.hypot(p.tx - c[0], p.ty - c[1]) < 8) { dup = true; break; }
      }
      if (dup) continue;
      addPOI(map, 'thin_wall', c[0], c[1], { dx: c[2], dz: c[3] });
      placed++;
    }
  }

  // L1 车库柱阵：大房间（≥6×6）内按 3 格间距布 1×1 混凝土柱；
  // 在 connectRooms 之后调用，用 _segs 走廊带避让（柱子不压走廊、不堵路）；
  // 单柱不相连、不贴房间边，不可能围死人；房间中心 tile 留空（出生点）。
  function scatterGaragePillars(rng, map) {
    var segs = map._segs || [];
    function onCorrBand(px, py) {
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        var m = ((s.w || 1) >> 1); // 走廊精确带：柱子可贴走廊放（不压走廊 tile 就不堵路）
        if (px >= Math.min(s.x1, s.x2) - m && px <= Math.max(s.x1, s.x2) + m &&
            py >= Math.min(s.y1, s.y2) - m && py <= Math.max(s.y1, s.y2) + m) return true;
      }
      return false;
    }
    for (var i = 0; i < map.rooms.length; i++) {
      var r = map.rooms[i];
      if (r.w < 6 || r.h < 6) continue;
      for (var py = r.y + 1; py <= r.y + r.h - 2; py += 3)
        for (var px = r.x + 1; px <= r.x + r.w - 2; px += 3) {
          if (rng.chance(0.25)) continue;
          if (map.tiles[T(px, py)] !== 1) continue;
          if (Math.hypot(px - r.cx, py - r.cy) < 1.5) continue;
          if (onCorrBand(px, py)) continue;
          setT(map, px, py, 0);
        }
    }
  }

  // L1 薄墙（不稳定切出点）：优先放在走廊直线段中段（显眼），相邻墙为走廊侧壁；
  // 数量不够时回退到通用随机放置。
  function placeThinWallsCorridor(map, rng, count) {
    var spawn = null;
    for (var i = 0; i < map.pois.length; i++)
      if (map.pois[i].type === 'spawn') spawn = map.pois[i];
    var placed = 0;
    function tryAdd(tx, ty, dx, dz) {
      if (spawn && Math.hypot(tx - spawn.tx, ty - spawn.ty) < 6) return;
      for (var k = 0; k < map.pois.length; k++) {
        var p = map.pois[k];
        if (p.type === 'thin_wall' && Math.hypot(p.tx - tx, p.ty - ty) < 8) return;
      }
      addPOI(map, 'thin_wall', tx, ty, { dx: dx, dz: dz });
      placed++;
    }
    var segs = rng.shuffle((map._segs || []).slice());
    for (var i = 0; i < segs.length && placed < count; i++) {
      var s = segs[i];
      var len = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
      if (len < 6) continue;
      var dx = Math.sign(s.x2 - s.x1), dy = Math.sign(s.y2 - s.y1);
      var off = (len / 2) | 0;
      var tx = s.x1 + dx * off, ty = s.y1 + dy * off;
      if (map.tiles[T(tx, ty)] !== 1) continue;
      var perp = dx !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      for (var d = 0; d < 2; d++) {
        var wx = tx + perp[d][0], wy = ty + perp[d][1];
        if (map.tiles[T(wx, wy)] === 0) { tryAdd(tx, ty, perp[d][0], perp[d][1]); break; }
      }
    }
    if (placed < count) placeThinWalls(map, rng, count - placed); // 回退：通用放置（自带防重逻辑）
  }

  // L1 家具 POI ×3~6：桌子/柜子，靠墙放，item 可能是补给；
  // 契约（建造工人按此在 levels.js 建内饰）：addPOI(map,'furniture',tx,ty,{kind:'table'|'cabinet',item:'almond'|'bandage'|'food'|null})
  function placeFurnitureL1(map, rng) {
    var spawn = map.rooms[0];
    var n = 3 + rng.int(0, 3), placed = 0, guard = 0;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (placed < n && guard++ < 150) {
      var r = pickRoom(rng, map, [spawn]);
      var t = randTileInRoom(rng, map, r);
      var tx = t[0], ty = t[1];
      var walled = false;
      for (var d = 0; d < 4; d++) {
        var wx = tx + dirs[d][0], wy = ty + dirs[d][1];
        if (wx < 1 || wy < 1 || wx >= map.w - 1 || wy >= map.h - 1) continue;
        if (map.tiles[T(wx, wy)] === 0) { walled = true; break; }
      }
      if (!walled) continue;
      var dup = false;
      for (var k = 0; k < map.pois.length; k++) {
        var p = map.pois[k];
        if (Math.abs(p.tx - tx) + Math.abs(p.ty - ty) < 2) { dup = true; break; }
      }
      if (dup) continue;
      addPOI(map, 'furniture', tx, ty, {
        kind: rng.chance(0.5) ? 'table' : 'cabinet',
        item: rng.pick(['almond', 'bandage', 'food', null, null])
      });
      placed++;
    }
  }

  function placeL0(map, rng) {
    placeCommonSpawn(map);
    var exit = map.farRoom; exit.tag = 'exit';
    // 异常墙：出口厅某面外墙，法线指向厅内；绝不在出生点旁
    var found = findDoorSpotAny(rng, map, [exit].concat(map.rooms.slice(1)));
    var spot = found ? found.spot : manualWallSpot(exit);
    addPOI(map, 'anomaly_wall', spot.tx, spot.ty, {
      dirx: Math.sign(spot.fx - spot.tx), dirz: Math.sign(spot.fy - spot.ty)
    });
    // 红房间：另一处异常点（厅中心；若中心恰被遮挡，取最近的地板格）
    var rr = pickRoom(rng, map, [map.rooms[0], exit]); rr.tag = 'red';
    var rcx = Math.round(rr.cx), rcy = Math.round(rr.cy), rrt = [rcx, rcy];
    if (map.tiles[T(rcx, rcy)] !== 1) {
      for (var rad = 1; rad < 8 && map.tiles[T(rrt[0], rrt[1])] !== 1; rad++)
        for (var rdy = -rad; rdy <= rad; rdy++)
          for (var rdx = -rad; rdx <= rad; rdx++) {
            if (Math.max(Math.abs(rdx), Math.abs(rdy)) !== rad) continue;
            if (map.tiles[T(rcx + rdx, rcy + rdy)] === 1) { rrt = [rcx + rdx, rcy + rdy]; break; }
          }
    }
    addPOI(map, 'red_room', rrt[0], rrt[1], {});
    // 少量笔记
    var n = 1 + rng.int(0, 1);
    for (var i = 0; i < n; i++) {
      var r = pickRoom(rng, map, [map.rooms[0]]), t = randTileInRoom(rng, map, r);
      addPOI(map, 'note', t[0], t[1], { noteId: 'L0_note' + i });
    }
    // 马尼拉房间：carveOpenHall 已单独 carve 出封闭矩形房间 + 一扇门（map.doors，不上锁）；
    // 这里只按契约登记 POI：POI 在门 tile 上，data 给内厅 tile 边界 + 门 tile 坐标
    // （建造工人在 levels.js 按此 data 建内饰：暖光/地毯/桌子/柜子）
    var mp = map._manila;
    addPOI(map, 'manila_room', mp.doorTx, mp.doorTy, {
      x0: mp.x0, y0: mp.y0, x1: mp.x1, y1: mp.y1,
      doorTx: mp.doorTx, doorTy: mp.doorTy
    });
    // Systems A：FUN 涂鸦洞口（本游戏原创机制）——8% 概率出现墙上涂鸦 + 附近可爬洞口 → FUN
    if (rng.next() < 0.08) {
      var gr = pickRoom(rng, map, [map.rooms[0], exit]);
      var gt = randTileInRoom(rng, map, gr);
      addPOI(map, 'fun_graffiti', gt[0], gt[1], {});
      var gdirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], ghole = null;
      for (var gi = 0; gi < 4 && !ghole; gi++) {
        var gx = gt[0] + gdirs[gi][0], gy = gt[1] + gdirs[gi][1];
        if (gx > 0 && gy > 0 && gx < map.w - 1 && gy < map.h - 1 && map.tiles[T(gx, gy)] === 1) ghole = [gx, gy];
      }
      if (ghole) addPOI(map, 'fun_hole2', ghole[0], ghole[1], {});
    }
    // 薄墙：不稳定切出点（L0 的不确定性来源之一：数量 6，位置随机且互相远离；
    // 开阔地形专用放置：大厅边缘 / 半墙旁）
    placeThinWallsOpen(map, rng, 6);
  }

  // L1 出口长走廊：从靠边的远房间向地图边缘打一条 10~14 格直走廊
  function makeExitCorridor(map, rng) {
    // 四个方向按空隙从大到小试，返回首个满足 minLen 的方案
    function tryBuild(r, minLen) {
      var dirs = [
        { d: r.y, dirx: 0, dirz: -1 },
        { d: H - (r.y + r.h), dirx: 0, dirz: 1 },
        { d: r.x, dirx: -1, dirz: 0 },
        { d: W - (r.x + r.w), dirx: 1, dirz: 0 }
      ];
      dirs.sort(function (a, b) { return b.d - a.d; });
      for (var i = 0; i < dirs.length; i++) {
        var bd = dirs[i], maxLen = bd.d - 2; // 留出边框
        if (maxLen < minLen) continue;
        var len = Math.min(rng.int(10, 14), maxLen), sx, sy;
        if (bd.dirx !== 0) {
          sx = bd.dirx > 0 ? r.x + r.w : r.x - 1;
          sy = clamp(Math.round(r.cy), r.y, r.y + r.h - 1);
        } else {
          sy = bd.dirz > 0 ? r.y + r.h : r.y - 1;
          sx = clamp(Math.round(r.cx), r.x, r.x + r.w - 1);
        }
        for (var k = 0; k < len; k++) setT(map, sx + bd.dirx * k, sy + bd.dirz * k, 1);
        r.tag = 'exit';
        return { sx: sx, sy: sy, dirx: bd.dirx, dirz: bd.dirz, len: len };
      }
      return null;
    }
    // 第一遍：离出生点远的房间优先，保证长度 10~14
    var cands = map.rooms.slice(1);
    cands.sort(function (a, b) { return (b._d - a._d) || (borderDist(a).d - borderDist(b).d); });
    for (var i = 0; i < cands.length; i++) {
      if (cands[i].tag === 'spawn') continue;
      var r1 = tryBuild(cands[i], 10);
      if (r1) return r1;
    }
    // 第二遍：所有非出生房间，只要能打出 10 格就要
    for (var j = 1; j < map.rooms.length; j++) {
      var r2 = tryBuild(map.rooms[j], 10);
      if (r2) return r2;
    }
    // 兜底：用最远房间，长度钳制到可行范围（极罕见）
    return tryBuild(map.farRoom, 4) || tryBuild(map.rooms[1], 4);
  }

  function placeL1(map, rng) {
    placeCommonSpawn(map);
    var spawn = map.rooms[0];
    // 主线出口：长走廊 + 尽头门（→L2）
    var ec = makeExitCorridor(map, rng);
    addPOI(map, 'exit_corridor', ec.sx, ec.sy, { dirx: ec.dirx, dirz: ec.dirz, len: ec.len });
    addDoor(map, ec.sx + ec.dirx * (ec.len - 1), ec.sy + ec.dirz * (ec.len - 1),
      ec.dirx !== 0 ? 'x' : 'z', false, '出口门', 'L2');
    // 按离出生点距离把房间排序，取中段做安全屋 / 闪烁区
    var byDist = map.rooms.slice(1).sort(function (a, b) { return a._d - b._d; });
    var safeR = byDist[Math.floor(byDist.length / 2)] || byDist[0];
    safeR.tag = 'safe';
    var st = [Math.round(safeR.cx), Math.round(safeR.cy)];
    addPOI(map, 'safe_room', st[0], st[1], { cx: st[0], cy: st[1], r: 5 });
    var boR = pickRoom(rng, map, [spawn, safeR]);
    var bt = [Math.round(boR.cx), Math.round(boR.cy)];
    addPOI(map, 'blackout', bt[0], bt[1], { cx: bt[0], cy: bt[1], r: 4 });
    // 潜伏者 ×1：盘踞在闪烁区房间。平时蜷伏，灯灭/风暴期出来狩猎——
    // L1 的"闪烁期判断"：听到风暴嗡鸣或灯灭时，别往黑的地方凑（entities.js 给 lurker 加了黑暗增益）
    var lz1t = randTileInRoom(rng, map, boR);
    addPOI(map, 'lurker_zone', lz1t[0], lz1t[1], { cx: lz1t[0], cy: lz1t[1], r: 5 });
    // 支线入口：异常天花板（破洞），藏在某个非出生房间
    var fhR = pickRoom(rng, map, [spawn, safeR, boR]);
    var fht = randTileInRoom(rng, map, fhR);
    addPOI(map, 'fun_hole', fht[0], fht[1], {});
    // 板条箱：4~7 个，前两个必为杏仁水和手电筒
    var nc = 4 + rng.int(0, 3);
    for (var i = 0; i < nc; i++) {
      var cr = pickRoom(rng, map, [spawn]), ct = randTileInRoom(rng, map, cr);
      var item = i === 0 ? 'almond' : (i === 1 ? 'flashlight' :
        rng.pick(['almond', 'bandage', 'empty', 'empty']));
      addPOI(map, 'crate', ct[0], ct[1], { item: item });
    }
    // 笔记与定居点地标
    var nn = 2 + rng.int(0, 1);
    for (var j = 0; j < nn; j++) {
      var nr = pickRoom(rng, map, [spawn]), nt = randTileInRoom(rng, map, nr);
      addPOI(map, 'note', nt[0], nt[1], { noteId: 'L1_note' + j });
    }
    var nl = 1 + rng.int(0, 1);
    for (var m = 0; m < nl; m++) {
      var lr = pickRoom(rng, map, [spawn]);
      addPOI(map, 'landmark', Math.round(lr.cx), Math.round(lr.cy), { kind: 'settle' });
    }
    // 薄墙（不稳定切出点）：数量 4→6，优先放在走廊直线段中段（更显眼，而非角落）
    placeThinWallsCorridor(map, rng, 6);
    // 家具：桌子/柜子 ×3~6，靠墙（建造工人在 levels.js 按 kind/item 建内饰与补给）
    placeFurnitureL1(map, rng);
    placeBerryBush(map, rng); // 迁跃浆果灌木：极低概率 0~1 株（末尾调用，不影响已有布局）
  }

  // 在已挖掘的走廊直线段上找一段放蒸汽；传 nearX/nearY 时优先选其附近的段
  //（L2：蒸汽优先挡在出口房附近的走廊上，让"工业环境"有实际风险，而不是随机落在无关走廊）
  function findSteamSpot(map, rng, nearX, nearY) {
    var good = [];
    for (var i = 0; i < map._segs.length; i++) {
      var s = map._segs[i];
      var len = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
      if (len >= 5) good.push(s);
    }
    var pool = good;
    if (nearX !== undefined && good.length > 3) {
      var sorted = good.slice().sort(function (a, b) {
        var am = Math.hypot((a.x1 + a.x2) / 2 - nearX, (a.y1 + a.y2) / 2 - nearY);
        var bm = Math.hypot((b.x1 + b.x2) / 2 - nearX, (b.y1 + b.y2) / 2 - nearY);
        return am - bm;
      });
      pool = sorted.slice(0, 3); // 最近的 3 段里随机：偏向出口，但不完全 deterministic
    }
    var s = rng.pick(pool); // 走廊必存在，good 不会为空
    var dx = Math.sign(s.x2 - s.x1), dy = Math.sign(s.y2 - s.y1);
    var total = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
    var segLen = Math.min(total - 1, 4 + rng.int(0, 2));
    var off = rng.int(0, Math.max(0, total - segLen));
    return { tx: s.x1 + dx * off, ty: s.y1 + dy * off, dirx: dx, dirz: dy, len: segLen };
  }

  function placeL2(map, rng) {
    placeCommonSpawn(map);
    var spawn = map.rooms[0];
    var exit = map.farRoom; exit.tag = 'exit';
    // 出口门：出口房墙上未上锁的异常门（→L3）
    var efound = findDoorSpotAny(rng, map, [exit].concat(map.rooms.slice(1)));
    var spot = efound ? efound.spot : manualWallSpot(exit);
    var ed = addDoor(map, spot.tx, spot.ty, spot.axis, false, '出口门', 'L3');
    addPOI(map, 'exit_door', spot.tx, spot.ty, { doorId: ed.id, fx: spot.fx, fy: spot.fy });
    // 3~6 扇上锁的门（干扰项）
    var nLock = 3 + rng.int(0, 3);
    var order = rng.shuffle(map.rooms.slice());
    var placed = 0;
    for (var i = 0; i < order.length && placed < nLock; i++) {
      if (order[i] === spawn || order[i] === exit) continue;
      var ls = findDoorSpot(rng, map, order[i]);
      if (!ls) continue;
      var ld = addDoor(map, ls.tx, ls.ty, ls.axis, true,
        rng.pick(['上锁的铁门', '锈蚀的铁门', '封死的木门']), null);
      addPOI(map, 'locked_door', ls.tx, ls.ty, { doorId: ld.id });
      placed++;
    }
    // 虚空之门 ×1
    var vr = pickRoom(rng, map, [spawn, exit]);
    var vs = findDoorSpot(rng, map, vr);
    if (vs) {
      var vd = addDoor(map, vs.tx, vs.ty, vs.axis, false, '虚空之门', null);
      addPOI(map, 'void_door', vs.tx, vs.ty, { doorId: vd.id });
    }
    // 蒸汽：优先选出口门附近的走廊段（玩家去出口大概率要处理它：阀门 60 秒窗口或硬闯）；
    // 阀门：在附近房间
    var stm = findSteamSpot(map, rng, spot.fx, spot.fy);
    addPOI(map, 'steam', stm.tx, stm.ty, { dirx: stm.dirx, dirz: stm.dirz, len: stm.len });
    var near = null, nd = Infinity;
    for (var q = 0; q < map.rooms.length; q++) {
      var r = map.rooms[q];
      var d = (r.cx - stm.tx) * (r.cx - stm.tx) + (r.cy - stm.ty) * (r.cy - stm.ty);
      if (d < nd) { nd = d; near = r; }
    }
    var vt = randTileInRoom(rng, map, near);
    addPOI(map, 'valve', vt[0], vt[1], {});
    // 潜伏者区域 ×2：一处在出口门所在房间（玩家开出口门前必须处理：蹲伏困惑/绕开/硬闯），
    // 一处随机房间（探索时的遭遇）
    var lzR1 = roomOf(map, spot.fx, spot.fy) || exit;
    var lzt1 = randTileInRoom(rng, map, lzR1);
    addPOI(map, 'lurker_zone', lzt1[0], lzt1[1], { cx: lzt1[0], cy: lzt1[1], r: 5 });
    var lzR = pickRoom(rng, map, [spawn, exit]);
    var lzt = randTileInRoom(rng, map, lzR);
    addPOI(map, 'lurker_zone', lzt[0], lzt[1], { cx: lzt[0], cy: lzt[1], r: 5 });
    // 物资与笔记
    var nc = 2 + rng.int(0, 2);
    for (var c = 0; c < nc; c++) {
      var cr2 = pickRoom(rng, map, [spawn]), ct2 = randTileInRoom(rng, map, cr2);
      addPOI(map, 'crate', ct2[0], ct2[1], { item: rng.pick(['almond', 'bandage', 'empty']) });
    }
    var nn = 1 + rng.int(0, 1);
    for (var n2 = 0; n2 < nn; n2++) {
      var nr2 = pickRoom(rng, map, [spawn]), nt2 = randTileInRoom(rng, map, nr2);
      addPOI(map, 'note', nt2[0], nt2[1], { noteId: 'L2_note' + n2 });
    }
    placeThinWalls(map, rng, 4);
    placeBerryBush(map, rng); // 迁跃浆果灌木：极低概率 0~1 株（末尾调用，不影响已有布局）
  }

  function placeL3(map, rng) {
    placeCommonSpawn(map);
    var spawn = map.rooms[0];
    var exit = map.farRoom; exit.tag = 'exit';
    // 电梯：出口房墙上，POI 在门前地板，dir 指向电梯门方向
    var lfound = findDoorSpotAny(rng, map, [exit].concat(map.rooms.slice(1)));
    var spot = lfound ? lfound.spot : manualWallSpot(exit);
    var elevPoi = addPOI(map, 'elevator', spot.fx, spot.fy, {
      dirx: Math.sign(spot.tx - spot.fx), dirz: Math.sign(spot.ty - spot.fy)
    });
    // 电力房
    var pr = pickRoom(rng, map, [spawn, exit]); pr.tag = 'power';
    addPOI(map, 'power_room', Math.round(pr.cx), Math.round(pr.cy), {});
    // 栅栏区
    var fr = pickRoom(rng, map, [spawn, exit, pr]);
    var ft = randTileInRoom(rng, map, fr);
    addPOI(map, 'fence_zone', ft[0], ft[1], { cx: ft[0], cy: ft[1], r: 4 });
    // 实体巡逻路线：沿走廊取 5~8 个散布点成环；
    // 其中 2 个钉在"电力房附近"和"电梯门口"——玩家做主线（开 3 台发电机→乘电梯）
    // 必进猎犬活动区，实体位置真正影响路线（配合发电机噪音引怪与 1.5s 目视预警）
    var cands = corridorTiles(map);
    if (cands.length < 10) cands = allFloorTiles(map);
    var pts = [];
    var anchorA = nearestCorrTile(map, Math.round(pr.cx), Math.round(pr.cy));
    var anchorB = nearestCorrTile(map, elevPoi.tx, elevPoi.ty);
    if (anchorA) pts.push(anchorA);
    if (anchorB && (!anchorA || Math.abs(anchorB[0] - anchorA[0]) + Math.abs(anchorB[1] - anchorA[1]) > 4)) pts.push(anchorB);
    var rest = spreadPoints(rng, cands, (5 + rng.int(0, 3)) - pts.length);
    for (var ri = 0; ri < rest.length; ri++) {
      var rp = rest[ri], dup = false;
      for (var pi = 0; pi < pts.length; pi++)
        if (Math.abs(rp[0] - pts[pi][0]) + Math.abs(rp[1] - pts[pi][1]) < 3) { dup = true; break; }
      if (!dup) pts.push(rp);
    }
    while (pts.length < 5) pts.push(rng.pick(cands)); // 去重后不足 5 个则补
    for (var i = 0; i < pts.length; i++)
      addPOI(map, 'patrol', pts[i][0], pts[i][1], { route: 0, order: i });
    // 物资与笔记
    var nc = 2 + rng.int(0, 1);
    for (var c = 0; c < nc; c++) {
      var cr = pickRoom(rng, map, [spawn]), ct = randTileInRoom(rng, map, cr);
      addPOI(map, 'crate', ct[0], ct[1], { item: rng.pick(['almond', 'bandage', 'empty']) });
    }
    for (var n2 = 0; n2 < 2; n2++) {
      var nr = pickRoom(rng, map, [spawn]), nt = randTileInRoom(rng, map, nr);
      addPOI(map, 'note', nt[0], nt[1], { noteId: 'L3_note' + n2 });
    }
    placeThinWalls(map, rng, 3);
    placeBerryBush(map, rng); // 迁跃浆果灌木：极低概率 0~1 株（末尾调用，不影响已有布局）
  }

  function placeFUN(map, rng) {
    placeCommonSpawn(map);
    var spawn = map.rooms[0];
    for (var i = 1; i < map.rooms.length; i++) map.rooms[i].tag = 'party';
    var deep = map.farRoom; deep.tag = 'party';
    // 派对客出生点 ×2~4（不在出生房）
    var np = 2 + rng.int(0, 2);
    for (var p = 0; p < np; p++) {
      var pr2 = pickRoom(rng, map, [spawn]), pt = randTileInRoom(rng, map, pr2);
      addPOI(map, 'partygoer', pt[0], pt[1], { group: 0 });
    }
    // 线索 ×2~3
    var nc = 2 + rng.int(0, 1);
    for (var c = 0; c < nc; c++) {
      var cr = pickRoom(rng, map, [spawn]), ct = randTileInRoom(rng, map, cr);
      addPOI(map, 'clue', ct[0], ct[1], { clueId: 'fun_c' + c });
    }
    // 蛋糕桌
    var kr = pickRoom(rng, map, [spawn, deep]);
    addPOI(map, 'cake_table', Math.round(kr.cx), Math.round(kr.cy), {});
    // 隐藏出口：最深派对室的员工通道门（→L1）
    var ffound = findDoorSpotAny(rng, map, [deep].concat(map.rooms.slice(1)));
    var spot = ffound ? ffound.spot : manualWallSpot(deep);
    var fd = addDoor(map, spot.tx, spot.ty, spot.axis, false, '员工通道', 'L1');
    addPOI(map, 'fun_exit', spot.tx, spot.ty, { doorId: fd.id, fx: spot.fx, fy: spot.fy });
    placeThinWalls(map, rng, 3);
  }

  var PLACERS = { L0: placeL0, L1: placeL1, L2: placeL2, L3: placeL3, FUN: placeFUN };

  // 计算离出生点最远的房间（BFS 距离）
  function computeFarRoom(map) {
    var s = map.rooms[0];
    var dist = bfsDist(map, Math.round(s.cx), Math.round(s.cy));
    var best = null, bd = -1;
    for (var i = 1; i < map.rooms.length; i++) {
      var r = map.rooms[i];
      var d = dist[T(Math.round(r.cx), Math.round(r.cy))];
      r._d = d;
      if (d > bd) { bd = d; best = r; }
    }
    map.farRoom = best || map.rooms[1] || map.rooms[0];
  }

  // ---- 主入口 ----
  BR.Gen.generate = function (level, seed) {
    if (!BR.RNG) throw new Error('gen.js 需要先加载 utils.js（BR.RNG）');
    if (!LEVEL_CFG[level]) throw new Error('未知关卡: ' + level);
    var rng = new BR.RNG(seed >>> 0);
    var cfg = LEVEL_CFG[level];
    var map = createMap(level, seed);
    map._segs = [];
    if (cfg.openHall) carveOpenHall(rng, map); // L0：开阔大厅+柱子+半墙（不用房间+窄走廊）
    else {
      placeRooms(rng, map, cfg);      // 14~22 个不重叠房间，首个为出生房
      connectRooms(rng, map, cfg);    // L 形走廊连通 + 额外回环
      if (cfg.garagePillars) scatterGaragePillars(rng, map); // L1：走廊挖完后布混凝土柱阵（_segs 避让）
    }
    computeFarRoom(map);            // 最远房间（出口 / 电梯 / 异常墙用）
    PLACERS[level](map, rng);       // 各关 POI / 门
    ensureConnected(map, rng);      // 兜底：关键 POI 全部可达
    delete map._segs;
    delete map._slabs;   // L0 半墙列表（placer 已用完）
    delete map._manila;  // L0 马尼拉房间数据（POI data 已登记）
    delete map.farRoom;
    for (var i = 0; i < map.rooms.length; i++) delete map.rooms[i]._d;
    map.meta.roomCount = map.rooms.length;
    map.meta.doorCount = map.doors.length;
    map.meta.poiCount = map.pois.length;
    return map;
  };

  // 房间 + 门 + POI + 全图 tile 校验的稳定哈希（测试比较用）
  BR.Gen.hashMap = function (map) {
    var parts = [map.level, map.seed, map.w, map.h];
    for (var i = 0; i < map.rooms.length; i++) {
      var r = map.rooms[i];
      parts.push('R' + [r.id, r.x, r.y, r.w, r.h, r.tag].join(','));
    }
    for (var j = 0; j < map.doors.length; j++) {
      var d = map.doors[j];
      parts.push('D' + [d.id, d.tx, d.ty, d.axis, d.locked ? 1 : 0, d.exitTo || ''].join(','));
    }
    for (var k = 0; k < map.pois.length; k++) {
      var p = map.pois[k];
      parts.push('P' + [p.id, p.type, p.tx, p.ty, JSON.stringify(p.data || {})].join(','));
    }
    var th = 2166136261 >>> 0, t = map.tiles;
    for (var n = 0; n < t.length; n++) { th ^= t[n]; th = Math.imul(th, 16777619); }
    parts.push('T' + (th >>> 0).toString(16));
    var s = parts.join('|');
    if (BR.hashSeed) return BR.hashSeed(s).toString(16).padStart(8, '0');
    var h2 = 2166136261 >>> 0;
    for (var m = 0; m < s.length; m++) { h2 ^= s.charCodeAt(m); h2 = Math.imul(h2, 16777619); }
    return (h2 >>> 0).toString(16).padStart(8, '0');
  };

  // 扩建钩子：新关卡在独立文件里注册（避免多人同时改 gen.js 冲突）
  // 用法：BR.Gen.registerLevel('L7', {rw:[4,9],rh:[4,9],corrW:[1,2],loops:[2,4],wallH:3.0}, placeL7, ['spawn','exit_x']);
  // placerFn(map, rng)：只许用传入的 rng（禁用 Math.random/Date），用 addPOI/addDoor 工具函数
  BR.Gen.registerLevel = function (id, cfg, placerFn, critical) {
    LEVEL_CFG[id] = cfg;
    PLACERS[id] = placerFn;
    CRITICAL[id] = critical || [];
  };
})();
