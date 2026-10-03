/* gen_bang.js —— Level !「不想死就快跑！」地图生成（医院式蛇形长走廊 + 追逐）
 *
 * 注册：贴图 bang_wall / bang_floor（墙面映射 bang->bang_wall），
 *       环境音 BANG（火警双音警报 + 荧光灯嗡鸣）。
 * placer 只用传入的 rng（禁用 Math.random / Date / DOM / THREE）。
 *   DOM / THREE 只出现在贴图绘制器与环境音 builder（test-gen 豁免范围）。
 *
 * 布局：9 条东西向长走廊（每条 52 tile = 156 米），U 形转弯室串成蛇形，
 *   全程约 1500 米，按疾跑 5.6 m/s 约 4.5 分钟（游戏尺度改编，见 LORE.md）。
 * POI：spawn / bang_chaser / bang_exit / bang_fake_door / bang_window /
 *       bang_obs（门/病床/椅子/可跳低障碍）/ bang_supply / note。
 *
 * 通行检查（verifyBang，纯几何、无 THREE，可进 test-gen）：
 *   ① 低障碍 h ≤ 0.9（玩家跳跃顶点 1.11m，留余量）；
 *   ② 高障碍在走廊横断面至少留 2.4m 净宽；
 *   ③ spawn→bang_exit 在 0.75m 精细网格上 BFS 可达
 *      （高障碍按 r+0.45m 膨胀阻挡，低障碍视为可跳过，关闭的门视为阻挡）。
 */
(function () {
  var BR = window.BR;

  /* ================= 贴图（医院风） ================= */
  function mkCanvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    return c;
  }
  // 医院墙面：米白瓷砖 + 腰线扶手带 + 底部污渍
  BR.Textures.registerTex('bang_wall', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var R = new BR.RNG(BR.hashSeed('bangtex:wall'));
    x.fillStyle = '#dbe2dc'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(115,135,130,0.55)'; x.lineWidth = 2;
    var i, j;
    for (i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(0, i * h / 8); x.lineTo(w, i * h / 8); x.stroke(); }
    for (j = 0; j <= 8; j++) { x.beginPath(); x.moveTo(j * w / 8, 0); x.lineTo(j * w / 8, h); x.stroke(); }
    x.fillStyle = '#2e6f7e'; x.fillRect(0, h * 0.52, w, h * 0.07); // 腰线扶手
    x.fillStyle = 'rgba(255,255,255,0.28)'; x.fillRect(0, h * 0.52, w, 3);
    for (i = 0; i < 26; i++) { // 底部污渍
      x.fillStyle = 'rgba(88,98,94,' + (0.05 + R.next() * 0.10).toFixed(2) + ')';
      x.beginPath(); x.arc(R.next() * w, h * 0.86 + R.next() * h * 0.14, 3 + R.next() * 9, 0, 6.2832); x.fill();
    }
    for (i = 0; i < 5; i++) { // 暗红拖痕（追逐氛围，克制）
      x.fillStyle = 'rgba(120,30,26,' + (0.10 + R.next() * 0.12).toFixed(2) + ')';
      var sx = R.next() * w;
      x.fillRect(sx, h * 0.80 + R.next() * h * 0.1, 3 + R.next() * 4, 10 + R.next() * 22);
    }
    return c;
  });
  // 油毡地面：灰绿底 + 斑点 + 淡接缝
  BR.Textures.registerTex('bang_floor', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var R = new BR.RNG(BR.hashSeed('bangtex:floor'));
    x.fillStyle = '#a9b2a8'; x.fillRect(0, 0, w, h);
    var i;
    for (i = 0; i < 220; i++) {
      x.fillStyle = 'rgba(' + (120 + ((R.next() * 60) | 0)) + ',' + (125 + ((R.next() * 55) | 0)) + ',' +
        (115 + ((R.next() * 50) | 0)) + ',0.5)';
      x.fillRect(R.next() * w, R.next() * h, 2, 2);
    }
    x.strokeStyle = 'rgba(70,80,72,0.35)'; x.lineWidth = 2;
    for (i = 0; i <= 4; i++) {
      x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke();
      x.beginPath(); x.moveTo(i * w / 4, 0); x.lineTo(i * w / 4, h); x.stroke();
    }
    return c;
  });
  BR.Textures.registerWallTex('bang', 'bang_wall');

  /* ================= 环境音：火警双音警报 ================= */
  BR.Audio.registerAmbient('BANG', function () {
    var rig = this._loopRig(function (R) {
      // 双音警报：方波 660Hz，0.45Hz LFO 在 ±150Hz 间摆动（经典火警"嘀—嘟—"）
      var o = R.osc('square', 660), og = R.gain(0.15);
      var lfo = R.osc('sine', 0.45), lg = R.gain(150);
      lfo.connect(lg); lg.connect(o.frequency);
      o.connect(og); og.connect(R.group);
      // 荧光灯嗡鸣
      var hum = R.osc('sine', 50), hg = R.gain(0.20);
      hum.connect(hg); hg.connect(R.group);
      // 远处通风噪音
      var n = R.noise(), lp = R.filter('lowpass', 300, 0.7), ng = R.gain(0.10);
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
    });
    rig.target = 0.5;
    return rig;
  });

  /* ================= 蛇形长廊生成 ================= */
  var LANES = 9;                 // 走廊条数
  var LANE_X0 = 2, LANE_X1 = 53; // 走廊 x 范围（含）
  var CH_W = 5;                  // U 形转弯室宽（tile）
  function laneY0(i) { return 4 + i * 5; }
  function laneDir(i) { return (i % 2 === 0) ? 1 : -1; } // 偶数条向东，奇数条向西
  function laneCZ(i) { return (laneY0(i) + 1) * BR.TILE; } // 走廊中心 z（占 y0,y0+1 两行）

  // 假出口储藏室 / 真出口门的 tile（buildContent 与 verify 共用）
  var FAKE = { doorTx: 30, doorTy: 31, winTx: 31, winTy: 31, cx0: 30, cy0: 32 };
  var EXIT = { doorTx: 54, doorTy: 44 };

  function carveRect(map, x0, y0, w, h) {
    var x, y;
    for (y = y0; y < y0 + h; y++)
      for (x = x0; x < x0 + w; x++)
        if (x >= 1 && y >= 1 && x <= map.w - 2 && y <= map.h - 2) map.tiles[y * map.w + x] = 1;
  }
  function addRoom(map, x, y, w, h) {
    var r = { id: map.rooms.length, x: x, y: y, w: w, h: h, cx: x + (w - 1) / 2, cy: y + (h - 1) / 2, tag: 'bang' };
    map.rooms.push(r); return r;
  }
  function addPOI(map, type, tx, ty, data) {
    var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
    map.pois.push(p); return p;
  }

  // 走廊横断面净宽检查：高障碍圆（r）在 z=cz±3 范围内至少留 CLEAR 净宽
  // （单侧即可：玩家直径 0.7m，1.0m 净宽可通过；放置规则保证贴边）
  var LANE_HALF = 3.0, NEED_CLEAR = 1.0, LOW_MAX_H = 0.9;

  function placeBang(map, rng) {
    var i, x, y;
    // generate() 已按 cfg 挖了房间+走廊：清空重做
    for (i = 0; i < map.w * map.h; i++) map.tiles[i] = 0;
    map.rooms.length = 0;
    map.doors.length = 0;

    // 蛇形走廊 + U 形转弯室
    for (i = 0; i < LANES; i++) {
      var y0 = laneY0(i);
      carveRect(map, LANE_X0, y0, LANE_X1 - LANE_X0 + 1, 2);
      addRoom(map, LANE_X0, y0, LANE_X1 - LANE_X0 + 1, 2);
      if (i < LANES - 1) {
        var east = laneDir(i) === 1;
        var cx0 = east ? LANE_X1 - CH_W + 1 : 1;
        carveRect(map, cx0, y0, CH_W, 7);
        addRoom(map, cx0, y0, CH_W, 7);
      }
    }
    // 假出口储藏室（第 5 条走廊南侧 2x2；门洞/观察窗 tile 留墙，由 buildContent 处理）
    carveRect(map, FAKE.cx0, FAKE.cy0, 2, 2);
    addRoom(map, FAKE.cx0, FAKE.cy0, 2, 2);
    // 真出口门洞（第 8 条东端）：门 tile 本身保持地板，由门阻挡
    carveRect(map, EXIT.doorTx, EXIT.doorTy, 1, 1);

    // ---- POI ----
    var y0_0 = laneY0(0);
    addPOI(map, 'spawn', 5, y0_0, { yaw: -Math.PI / 2 }); // 面向 +x（逃跑方向）
    addPOI(map, 'bang_chaser', 2, y0_0, {});
    var y0_8 = laneY0(8);
    addPOI(map, 'bang_exit', EXIT.doorTx - 1, y0_8, {}); // 真出口门前
    addPOI(map, 'bang_fake_door', FAKE.doorTx, FAKE.doorTy, {});
    addPOI(map, 'bang_window', FAKE.winTx, FAKE.winTy, {});

    // ---- 障碍 ----
    // 每条走廊：1~2 个可跳低障碍（整幅）+ 2 个半开门 + 1~2 张病床 + 0~1 把椅子
    // 规则（通行保证）：低障碍 h=0.8 ≤ 0.9；高障碍贴边放（|dz| 见下），同 x 断面不同时两侧放；
    //   障碍间距 ≥5 tile；距走廊两端 ≥8 tile；第 0 条起点 12 tile 内净空（出生安全区）。
    // 防卡死（v1.5 W6 修）：高障碍推挤圈与走廊墙的玩家禁区必须零重叠，
    //   即 off + r ≤ 2.2（墙面 z=27/33，墙禁区 z<27.35；障碍在北侧 z_d=30-off，
    //   最多把玩家推到 z = z_d-(r+0.35) = 27.45 > 27.35，墙滑永远有效）。
    //   旧约束 off+r≤2.5 只保证"可行区存在"，但离散径向推挤+分轴墙滑的动力学会在
    //   重叠透镜里形成稳定不动点——实测玩家被永久钉在 (131, 27.3) 等死。
    //   中间净宽仍要求 off - r ≥ 1.0（玩家直径 0.7m 舒适通过）。
    //   door: off=1.6, r=0.6 → 和 2.2 ✓ / 中间 1.0 ✓
    //   bed:  off=1.6, r=0.6 → 和 2.2 ✓ / 中间 1.0 ✓
    //   chair: off=1.8, r=0.35 → 和 2.15 ✓ / 中间 1.45 ✓（另可跳过）
    var side = rng.int(0, 1) ? 1 : -1;
    for (i = 0; i < LANES; i++) {
      var y0 = laneY0(i); // v1.5 W6 修：本循环必须自取 y0；之前漏写导致复用 carving 循环残留 y0=44，
      var cz = laneCZ(i); //   全部障碍/补给 POI ty=44 → mesh 只在第 8 条走廊构建、前 8 条隐形但碰撞仍在
      var usedX = [];
      var clear0 = (i === 0) ? 14 : 10; // 距西端净空（tile x 下限）
      function freeX() {
        for (var t = 0; t < 40; t++) {
          var tx = rng.int(clear0, LANE_X1 - 8);
          var ok = true;
          for (var k = 0; k < usedX.length; k++)
            if (Math.abs(usedX[k] - tx) < 5) { ok = false; break; }
          if (ok) { usedX.push(tx); return tx; }
        }
        return -1;
      }
      // 低障碍：整幅杂物堆，必须跳
      var nLow = 1 + rng.int(0, 1);
      for (var li = 0; li < nLow; li++) {
        var lx = freeX(); if (lx < 0) break;
        addPOI(map, 'bang_obs', lx, y0, {
          kind: 'low', x: (lx + 0.5) * BR.TILE, z: cz, w: LANE_HALF * 2, h: 0.8,
          seed: rng.int(0, 999999)
        });
      }
      // 半开门：从墙边斜伸出来（off=1.6, r=0.6：防卡死三约束见上）
      for (var di = 0; di < 2; di++) {
        var dx = freeX(); if (dx < 0) break;
        side = -side;
        addPOI(map, 'bang_obs', dx, y0, {
          kind: 'door', x: (dx + 0.5) * BR.TILE, z: cz + side * 1.6,
          r: 0.6, h: 2.2, side: side, seed: rng.int(0, 999999)
        });
      }
      // 病床（off=1.6, r=0.6）
      var nBed = 1 + rng.int(0, 1);
      for (var bi = 0; bi < nBed; bi++) {
        var bx = freeX(); if (bx < 0) break;
        side = -side;
        addPOI(map, 'bang_obs', bx, y0, {
          kind: 'bed', x: (bx + 0.5) * BR.TILE, z: cz + side * 1.6,
          r: 0.6, h: 1.2, side: side, rot: (rng.next() - 0.5) * 0.5, seed: rng.int(0, 999999)
        });
      }
      // 椅子（小，可绕可跳；off=1.8, r=0.35）
      if (rng.chance(0.6)) {
        var hx = freeX();
        if (hx >= 0) {
          side = -side;
          addPOI(map, 'bang_obs', hx, y0, {
            kind: 'chair', x: (hx + 0.5) * BR.TILE, z: cz + side * 1.8,
            r: 0.35, h: 0.9, side: side, seed: rng.int(0, 999999)
          });
        }
      }
      // 补给：走廊边缘，边跑边拾（z 偏 1.6m，拾取半径 2.2m，中线跑过即拾）
      var sx = rng.int(clear0, LANE_X1 - 8);
      side = -side;
      addPOI(map, 'bang_supply', sx, y0, {
        item: (i % 2 === 0) ? 'almond' : 'bandage',
        x: (sx + 0.5) * BR.TILE, z: cz + side * 1.6
      });
    }
    // 假储藏室里 1 瓶杏仁水（上当者的安慰奖）
    addPOI(map, 'bang_supply', FAKE.cx0, FAKE.cy0, {
      item: 'almond', x: (FAKE.cx0 + 1) * BR.TILE, z: (FAKE.cy0 + 1) * BR.TILE
    });
    // 字条
    addPOI(map, 'bang_note', 20, laneY0(1), { noteId: 0 });
    addPOI(map, 'bang_note', 30, laneY0(4), { noteId: 1 });
    addPOI(map, 'bang_note', 22, laneY0(7), { noteId: 2 });

    // ---- 通行检查 ----
    var chk = verifyBang(map);
    map.meta.bang = {
      lanes: LANES,
      routeLen: Math.round(LANES * (LANE_X1 - LANE_X0 + 1) * BR.TILE),
      obs: map.pois.filter(function (p) { return p.type === 'bang_obs'; }).length,
      supplies: map.pois.filter(function (p) { return p.type === 'bang_supply'; }).length,
      passOk: chk.ok, passIssues: chk.issues
    };
    if (!chk.ok && BR.log) BR.log('[bang] 通行检查未通过: ' + chk.issues.join('; '));
  }

  // 通行检查：纯几何，供 placer 与 test-gen 共用
  function verifyBang(map) {
    var issues = [];
    var obs = map.pois.filter(function (p) { return p.type === 'bang_obs'; });
    // ① 低障碍高度 ≤ 0.9；② 高障碍横断面净宽 ≥ 2.4
    for (var i = 0; i < obs.length; i++) {
      var d = obs[i].data;
      if (d.kind === 'low') {
        if (!(d.h <= LOW_MAX_H)) issues.push('low 过高 h=' + d.h + ' @' + obs[i].tx + ',' + obs[i].ty);
      } else {
        // 横断面：走廊半宽 3m，障碍圆心偏离中心 off、半径 r；
        // 两侧净宽 = max(off - r（靠中心侧）, HALF - (off + r)（靠墙侧）)
        var lcz = laneCZ(laneOf(obs[i].ty));
        var off = Math.abs(d.z - lcz);
        var side1 = Math.max(0, off - d.r);
        var side2 = Math.max(0, LANE_HALF - (off + d.r));
        var best = Math.max(side1, side2);
        if (best < NEED_CLEAR - 1e-6) issues.push(d.kind + ' 净宽不足 ' + best.toFixed(2) + 'm @' + obs[i].tx + ',' + obs[i].ty);
        // ④ 防卡死：高障碍推挤圈与走廊墙的玩家禁区必须零重叠（off + r ≤ 2.2 + eps；
        //    否则离散径向推挤+分轴墙滑会在重叠透镜里形成稳定不动点，玩家被永久钉住等死，
        //    实测旧值曾把玩家钉在 (131, 27.3)）。有零重叠时墙侧任何缝隙都可进出，无陷阱。
        if (off + d.r > 2.2 + 1e-6) issues.push(d.kind + ' 推挤圈与墙禁区重叠 off+r=' + (off + d.r).toFixed(2) + ' @' + obs[i].tx + ',' + obs[i].ty);
      }
    }
    // ③ 精细网格 BFS：spawn → bang_exit（高障碍膨胀 0.45，低障碍可跳过，门 tile 视为阻挡）
    var sp = null, ex = null, j;
    for (j = 0; j < map.pois.length; j++) {
      if (map.pois[j].type === 'spawn') sp = map.pois[j];
      if (map.pois[j].type === 'bang_exit') ex = map.pois[j];
    }
    if (sp && ex) {
      var cell = 0.75, gw = Math.ceil(map.w * BR.TILE / cell), gh = Math.ceil(map.h * BR.TILE / cell);
      var blocked = new Uint8Array(gw * gh);
      var doorTiles = {};
      doorTiles[FAKE.doorTy * map.w + FAKE.doorTx] = 1;
      doorTiles[EXIT.doorTy * map.w + EXIT.doorTx] = 1;
      var tall = obs.filter(function (p) { return p.data.kind !== 'low'; });
      for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
        var wx = (gx + 0.5) * cell, wz = (gy + 0.5) * cell;
        var tx = Math.floor(wx / BR.TILE), ty = Math.floor(wz / BR.TILE);
        var blk = (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) ||
          map.tiles[ty * map.w + tx] !== 1 || doorTiles[ty * map.w + tx];
        if (!blk) {
          for (var t2 = 0; t2 < tall.length; t2++) {
            var td = tall[t2].data;
            var rr = td.r + 0.45;
            if ((wx - td.x) * (wx - td.x) + (wz - td.z) * (wz - td.z) < rr * rr) { blk = true; break; }
          }
        }
        blocked[gy * gw + gx] = blk ? 1 : 0;
      }
      function cellOf(px, pz) {
        return [Math.max(0, Math.min(gw - 1, Math.floor(px / cell))),
                Math.max(0, Math.min(gh - 1, Math.floor(pz / cell)))];
      }
      var s0 = cellOf((sp.tx + 0.5) * BR.TILE, (sp.ty + 0.5) * BR.TILE);
      var e0 = cellOf((ex.tx + 0.5) * BR.TILE, (ex.ty + 0.5) * BR.TILE);
      var prev = new Int32Array(gw * gh).fill(-1);
      var q = [s0[1] * gw + s0[0]]; prev[q[0]] = q[0];
      var qi = 0, found = false;
      var DD = [1, 0, -1, 0, 0, 1, 0, -1];
      while (qi < q.length) {
        var cur = q[qi++], cx = cur % gw, cy = (cur / gw) | 0;
        if (cx === e0[0] && cy === e0[1]) { found = true; break; }
        for (var dd = 0; dd < 8; dd += 2) {
          var nx2 = cx + DD[dd], ny2 = cy + DD[dd + 1];
          if (nx2 < 0 || ny2 < 0 || nx2 >= gw || ny2 >= gh) continue;
          var nk = ny2 * gw + nx2;
          if (blocked[nk] || prev[nk] !== -1) continue;
          prev[nk] = cur; q.push(nk);
        }
      }
      if (!found) issues.push('spawn→bang_exit 精细网格不可达');
    } else {
      issues.push('缺 spawn / bang_exit POI');
    }
    return { ok: issues.length === 0, issues: issues };
  }
  // 由 tile y 反查走廊序号（障碍 POI 的 ty 即走廊顶行）
  function laneOf(ty) {
    for (var i = 0; i < LANES; i++) if (laneY0(i) === ty) return i;
    return 0;
  }

  BR.Gen.registerLevel('bang',
    { rw: [4, 9], rh: [4, 9], corrW: [2, 2], loops: [2, 4], wallH: 3.0 },
    placeBang,
    ['spawn', 'bang_exit']
  );
  // 导出供 test-gen 断言
  BR.Gen._bangVerify = verifyBang;
  BR.Gen._bangConst = { LANES: LANES, LANE_X0: LANE_X0, LANE_X1: LANE_X1, laneY0: laneY0, LOW_MAX_H: LOW_MAX_H };
})();
