/* ============================================================
 * Level 37「泳池房」—— 地图生成（placer）
 * 独立 IIFE：只调用 BR.* 注册钩子，不改动 gen.js 本体。
 * 铁律：placer 只用传入的 rng（禁止用全局随机源与时钟）。
 * ============================================================ */
(function () {
  var BR = window.BR;

  /* ---------------- placer ---------------- */
  function placeL37(map, rng) {
    function addPOI(type, tx, ty, data) {
      map.pois.push({ id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} });
    }
    function randTileIn(r, margin) {
      margin = (margin == null) ? 1 : margin;
      var tx = r.x + margin + Math.floor(rng.next() * Math.max(1, r.w - margin * 2));
      var ty = r.y + margin + Math.floor(rng.next() * Math.max(1, r.h - margin * 2));
      return [tx, ty];
    }

    var rooms = map.rooms;
    // 出生点：干燥区（首个房间，永不标为泳池）
    var spawnR = rooms[0];
    addPOI('spawn', Math.round(spawnR.cx), Math.round(spawnR.cy), {});

    // 选 3~5 个房间做泳池（洗牌后取，保证出生房干燥）
    var cand = [];
    for (var i = 1; i < rooms.length; i++) cand.push(i);
    rng.shuffle(cand);
    var poolN = Math.min(cand.length, 3 + Math.floor(rng.next() * 3));
    var pools = []; // {r, deep, depth}
    for (var n = 0; n < poolN; n++) {
      var r = rooms[cand[n]];
      // 第一个必深、第二个必浅，保证两种出口都有载体
      var deep = (n === 0) ? true : (n === 1) ? false : rng.chance(0.45);
      r.tag = deep ? 'pool_deep' : 'pool_shallow';
      var depth = deep ? 1.7 + rng.next() * 0.5 : 0.6 + rng.next() * 0.3;
      depth = +depth.toFixed(2);
      pools.push({ r: r, deep: deep, depth: depth });
      // wcx/wcz：房间精确世界中心（tile 取整会偏，用它对齐水面/水域）
      addPOI('pool', Math.round(r.cx), Math.round(r.cy),
        { depth: depth, rw: r.w, rh: r.h,
          wcx: (r.x + r.w / 2) * BR.TILE, wcz: (r.y + r.h / 2) * BR.TILE });
    }

    var deepPools = pools.filter(function (p) { return p.deep; });
    var shallowPools = pools.filter(function (p) { return !p.deep; });
    deepPools.sort(function (a, b) { return (b.r.w * b.r.h) - (a.r.w * a.r.h); });
    var deepR = deepPools[0].r, deepDepth = deepPools[0].depth;

    // 深水区标记 + 水下通道（同一深水池内不同格）
    var dt = randTileIn(deepR, 1);
    addPOI('deep_zone', dt[0], dt[1], { depth: deepDepth });
    var tt = randTileIn(deepR, 1);
    if (tt[0] === dt[0] && tt[1] === dt[1]) tt[0] = Math.min(deepR.x + deepR.w - 2, tt[0] + 1);
    addPOI('tunnel', tt[0], tt[1], { depth: deepDepth });

    // 浅水出口
    var shR = shallowPools[0].r;
    var st = randTileIn(shR, 1);
    addPOI('shallow_exit', st[0], st[1], {});

    // 拱洞：tunnel 所在深水池必有一个（蓝色横梁标记），再补 1~2 个池房
    var archRs = [deepR];
    if (shallowPools[0]) archRs.push(shallowPools[0].r);
    if (deepPools[1] && archRs.length < 3) archRs.push(deepPools[1].r);
    for (var a = 0; a < archRs.length; a++) {
      var ar = archRs[a];
      var ax = ar.x + ar.w - 1; // 房间东缘
      var ay = Math.max(ar.y, Math.min(ar.y + ar.h - 1, Math.round(ar.cy)));
      addPOI('archway', ax, ay, { tunnel: ar === deepR });
    }
  }

  BR.Gen.registerLevel('L37',
    { rw: [5, 10], rh: [5, 10], corrW: [2, 2], loops: [2, 4], wallH: 3.2 },
    placeL37,
    ['spawn', 'tunnel', 'shallow_exit']);
})();
