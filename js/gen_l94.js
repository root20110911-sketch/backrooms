/* gen_l94.js —— Level 94「动画」地图生成（定格动画风草坡小镇）
 *
 * 注册：贴图 town_grass / town_wall / castle_far（墙面映射 L94->town_wall），
 *       环境音 L94（白天：轻音乐+风声）/ L94D（黄昏：风渐强+低鸣）/ L94N（夜晚：风声+心跳）。
 * placer 只用传入的 rng（禁用 Math.random / Date / DOM / THREE）。
 * POI：spawn / house(带编号) / car / castle / cache / hideout / watcher / note / crate。
 * watcher 实体由 entities.js 集成（见交付片段），gen 侧只放 POI（type:'watcher', data:{mode}）。
 */
(function () {
  var BR = window.BR;

  /* ================= 贴图（卡通定格动画风） ================= */
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // 卡通草地：平涂绿 + 深色草块 + 草叶小笔画 + 碎花
  // 确定性绘制：painter 签名收不到 rng，用固定种子派生（贴图每次加载一致）
  BR.Textures.registerTex('town_grass', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var R = new BR.RNG(BR.hashSeed('L94tex'));
    x.fillStyle = '#69a84f'; x.fillRect(0, 0, w, h);
    var i, px, py;
    for (i = 0; i < 26; i++) { // 深色草块
      x.fillStyle = 'rgba(46,110,44,' + (0.25 + R.next() * 0.3).toFixed(2) + ')';
      x.beginPath();
      x.arc(R.next() * w, R.next() * h, 12 + R.next() * 26, 0, 6.2832);
      x.fill();
    }
    x.strokeStyle = 'rgba(30,80,30,0.55)'; x.lineWidth = 2; // 草叶
    for (i = 0; i < 130; i++) {
      px = R.next() * w; py = R.next() * h;
      x.beginPath(); x.moveTo(px, py);
      x.lineTo(px + (R.next() - 0.5) * 6, py - 4 - R.next() * 5); x.stroke();
    }
    for (i = 0; i < 14; i++) { // 小碎花
      x.fillStyle = ['#ffd94d', '#ffffff', '#ff8ab0'][(R.next() * 3) | 0];
      x.beginPath(); x.arc(R.next() * w, R.next() * h, 2.4, 0, 6.2832); x.fill();
    }
    return c;
  });

  // 卡通墙：奶油底 + 粗描边砖块
  BR.Textures.registerTex('town_wall', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#f3e2bd'; x.fillRect(0, 0, w, h);
    x.lineWidth = 5; x.strokeStyle = '#7a5a38';
    var bh = 42, row, col;
    for (row = 0; row * bh < h; row++) {
      var off = (row % 2) * 32;
      for (col = -1; col * 64 < w + 64; col++) {
        x.strokeRect(col * 64 + off, row * bh, 64, bh);
      }
    }
    x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(0, 0, w, 40); // 顶部高光
    return c;
  });

  // 远处悬浮城堡：透明底剪影，做远景 billboard（装饰性大地标）
  BR.Textures.registerTex('castle_far', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.clearRect(0, 0, w, h);
    function tower(cx, base, tw, th, col) {
      var m;
      x.fillStyle = col;
      x.fillRect(cx - tw / 2, base - th, tw, th);
      for (m = 0; m < 4; m++) x.fillRect(cx - tw / 2 + m * (tw / 4), base - th - 10, tw / 5, 10); // 城垛
      x.fillStyle = '#3b2d5a'; // 尖顶
      x.beginPath();
      x.moveTo(cx - tw / 2 - 4, base - th - 10);
      x.lineTo(cx, base - th - 34);
      x.lineTo(cx + tw / 2 + 4, base - th - 10);
      x.closePath(); x.fill();
      x.strokeStyle = '#c0392b'; x.lineWidth = 2; // 旗杆+旗
      x.beginPath(); x.moveTo(cx, base - th - 34); x.lineTo(cx, base - th - 46); x.stroke();
      x.fillStyle = '#c0392b';
      x.beginPath();
      x.moveTo(cx, base - th - 46); x.lineTo(cx + 12, base - th - 42); x.lineTo(cx, base - th - 38);
      x.closePath(); x.fill();
      x.fillStyle = '#ffd94d'; // 夜晚亮灯的窗
      x.fillRect(cx - 4, base - th + 18, 8, 12);
    }
    var base = h - 70;
    x.fillStyle = '#4a3a6e';
    x.fillRect(58, base - 60, 140, 60); // 主体
    tower(80, base, 30, 110, '#4a3a6e');
    tower(128, base, 36, 140, '#54447e');
    tower(176, base, 30, 110, '#4a3a6e');
    x.fillStyle = '#3a3348'; // 悬浮岩底
    x.beginPath();
    x.moveTo(50, base); x.lineTo(206, base);
    x.lineTo(170, base + 52); x.lineTo(96, base + 44);
    x.closePath(); x.fill();
    x.strokeStyle = '#241d38'; x.lineWidth = 3; // 粗描边（定格动画感）
    x.strokeRect(58, base - 60, 140, 60);
    return c;
  });
  BR.Textures.registerWallTex('L94', 'town_wall');

  /* ================= 环境音 ================= */
  // 白天：轻音乐（柔和大三和弦 pad）+ 风声
  BR.Audio.registerAmbient('L94', function () {
    var rig = this._loopRig(function (R) {
      var n = R.noise(), bp = R.filter('bandpass', 480, 0.6), ng = R.gain(0.30);
      n.connect(bp); bp.connect(ng); ng.connect(R.group);
      var lfo = R.osc('sine', 0.13), lg = R.gain(0.16);
      lfo.connect(lg); lg.connect(ng.gain); // 风的呼吸起伏
      var fs = [196.0, 246.94, 293.66]; // G 大三和弦，轻音乐感
      for (var i = 0; i < fs.length; i++) {
        var o = R.osc('sine', fs[i]), g = R.gain(0.05);
        o.connect(g); g.connect(R.group);
      }
    });
    rig.target = 0.30;
    return rig;
  });
  // 黄昏：风渐强 + 低鸣（"音乐变调"前兆）
  BR.Audio.registerAmbient('L94D', function () {
    var rig = this._loopRig(function (R) {
      var n = R.noise(), bp = R.filter('bandpass', 380, 0.5), ng = R.gain(0.45);
      n.connect(bp); bp.connect(ng); ng.connect(R.group);
      var lfo = R.osc('sine', 0.21), lg = R.gain(0.22);
      lfo.connect(lg); lg.connect(ng.gain);
      var o = R.osc('sine', 82.4), og = R.gain(0.10); // 低鸣，不安感
      o.connect(og); og.connect(R.group);
    });
    rig.target = 0.34;
    return rig;
  });
  // 夜晚：风声 + 心跳感（白天的"音乐"停止）
  BR.Audio.registerAmbient('L94N', function () {
    var rig = this._loopRig(function (R) {
      var n = R.noise(), lp = R.filter('lowpass', 420, 0.7), ng = R.gain(0.55);
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
      var lfo = R.osc('sine', 0.11), lg = R.gain(0.30);
      lfo.connect(lg); lg.connect(ng.gain);
      var o = R.osc('sine', 52), hg = R.gain(0.5); // 心跳载体
      o.connect(hg); hg.connect(R.group);
      var hb = R.osc('square', 1.15), hbg = R.gain(0.5); // 1.15Hz 方波调制 0~1
      hb.connect(hbg); hbg.connect(hg.gain);
    });
    rig.target = 0.42;
    return rig;
  });

  /* ================= placer（只用 rng） ================= */
  function addPOI(map, type, tx, ty, data) {
    var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
    map.pois.push(p);
    return p;
  }
  function randTileInRoom(rng, map, room) {
    for (var t = 0; t < 24; t++) {
      var x = rng.int(room.x, room.x + room.w - 1), y = rng.int(room.y, room.y + room.h - 1);
      if (map.tiles[y * map.w + x] === 1) return [x, y];
    }
    return [Math.round(room.cx), Math.round(room.cy)];
  }
  function pickRoom(rng, map, exclude) {
    var cands = [];
    for (var i = 0; i < map.rooms.length; i++) {
      if (exclude.indexOf(map.rooms[i]) >= 0) continue;
      cands.push(map.rooms[i]);
    }
    return rng.pick(cands.length ? cands : map.rooms);
  }

  function placeL94(map, rng) {
    var rooms = map.rooms;
    var spawnRoom = rooms[0];
    var sx = Math.round(spawnRoom.cx), sy = Math.round(spawnRoom.cy);
    addPOI(map, 'spawn', sx, sy, { yaw: 0 });
    var farRoom = map.farRoom || rooms[rooms.length - 1];
    var used = [spawnRoom, farRoom];

    // 小房子 ×4~6（带编号）
    var nHouse = rng.int(4, 6);
    for (var i = 0; i < nHouse; i++) {
      var hr = pickRoom(rng, map, used);
      used.push(hr);
      var ht = randTileInRoom(rng, map, hr);
      addPOI(map, 'house', ht[0], ht[1], { no: i + 1 });
    }
    // 老式汽车（白天出口 →L11）
    var carR = pickRoom(rng, map, used);
    used.push(carR);
    var ct = randTileInRoom(rng, map, carR);
    addPOI(map, 'car', ct[0], ct[1], {});
    // 悬浮城堡（夜晚出口 →L188）：放在离出生点最远的房间
    addPOI(map, 'castle', Math.round(farRoom.cx), Math.round(farRoom.cy), {});
    // 补给藏匿点
    var cacheR = pickRoom(rng, map, used);
    used.push(cacheR);
    var cat = randTileInRoom(rng, map, cacheR);
    addPOI(map, 'cache', cat[0], cat[1], {});
    // 藏身点 ×2（可进小屋 / 灌木）
    for (var hi = 0; hi < 2; hi++) {
      var hir = pickRoom(rng, map, used);
      used.push(hir);
      var hit = randTileInRoom(rng, map, hir);
      addPOI(map, 'hideout', hit[0], hit[1], { idx: hi + 1 });
    }
    // 观察者 ×3：离出生点 ≥10 格，两两 ≥8 格（POI 供 entities.js 集成）
    var watchers = [], guard = 0;
    while (watchers.length < 3 && guard++ < 80) {
      var wr = pickRoom(rng, map, [spawnRoom]);
      var wt = randTileInRoom(rng, map, wr);
      if (Math.hypot(wt[0] - sx, wt[1] - sy) < 10) continue;
      var ok = true;
      for (var wi = 0; wi < watchers.length; wi++) {
        if (Math.hypot(wt[0] - watchers[wi][0], wt[1] - watchers[wi][1]) < 8) { ok = false; break; }
      }
      if (!ok) continue;
      watchers.push(wt);
      addPOI(map, 'watcher', wt[0], wt[1], { mode: 'day' });
    }
    // 字条 ×2 / 板条箱 ×2
    var L94_NOTES = ['L94_note0', 'L94_note1'];
    for (var n = 0; n < 2; n++) {
      var nr = pickRoom(rng, map, [spawnRoom]);
      var nt = randTileInRoom(rng, map, nr);
      addPOI(map, 'note', nt[0], nt[1], { noteId: L94_NOTES[n] });
    }
    var items = ['almond', 'bandage'];
    for (var k = 0; k < 2; k++) {
      var kr = pickRoom(rng, map, [spawnRoom]);
      var kt = randTileInRoom(rng, map, kr);
      addPOI(map, 'crate', kt[0], kt[1], { item: items[k] });
    }
  }

  BR.Gen.registerLevel('L94',
    { rw: [6, 12], rh: [6, 12], corrW: [2, 3], loops: [2, 4], wallH: 3.2 },
    placeL94,
    ['spawn', 'car', 'castle', 'cache']
  );
})();
