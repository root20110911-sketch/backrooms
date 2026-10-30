/* lv_l4.js —— Level 4「废弃办公室」场景内容 / 机制 / 出口
 *
 * 独立视觉语言：明亮但异常寂静——高照度荧光灯 + 几乎无声的环境
 * （偶发远处嗡鸣 / 纸张摩擦）；办公家具真实比例（桌高 0.74m、隔断 1.5m）。
 *
 * 原著锚点（Wikidot backrooms-wiki level-4）：
 *  - 窗户多被封死，未封死的窗户是陷阱（本作：靠近掉理智 + 耳语）；
 *  - 杏仁水最丰富的层（饮水机 / 贩卖机 / 文件柜补给）；
 *  - 出口多为办公楼梯 / 电梯（原著→L5/L6/回L3；本作收敛到 L3/L2/L1，见下）；
 *  - 出口移开视线可能消失（本作：雕花木门异常）。
 * 本作改编（最终汇报逐项标注）：电梯→L3（原著电梯可回 L3）；楼梯间→L2
 * （原著“L2 有扇没上锁的门可到 L4”的反向）；停车场坡道→L1（取自
 *  backrooms-noclip wiki“一楼停车场通往 Level 1”）；雕花木门→L5 因本作
 *  无 L5，改为“门后虚空 + 移开视线消失”。
 *
 * 全部交互走 W.addInteractable 统一管线（docs/INTERACTION.md），不监听按键；
 * prompt 读 BR.interactKeyLabel()；手机端触屏交互钮自动可用。
 * 存档：沿用 P0-2 按关 ws（events/picked/openedDoors/cabinetOpen 自动持久化）；
 * 跨关标记走 BR.Game.flags（l4_visited / l4_found_* / l4_completed），
 * 完成标记只在真正使用出口时置位（照抄 Level! 的 bangEscaped 模式）。
 */
(function () {
  var BR = (typeof window !== 'undefined' ? window : globalThis).BR || {};
  if (!BR.Levels) return;

  /* ================= 运行时态（buildContent 重置） ================= */
  var S = null;
  function newState() {
    return {
      t: 0,
      elev: null,          // {open, anim, panels:[l,r], glow}
      traps: [],           // 未封死窗户 {x,z,warnedT}
      hums: [],            // 嗡鸣区 {x,z,mesh,phase,toastDone}
      ornate: null,        // {x,z,mesh,panel,gone,seen}
      completed: false,
      whisperT: 0
    };
  }

  /* ================= 小工具 ================= */
  function poiList(map, type) { return (map.pois || []).filter(function (p) { return p.type === type; }); }
  // 贴墙锚点（与 levels.js 涂鸦、lv_l11.js findWallAnchor 同口径）：
  // wallNormalOrNull 返回「墙→房间」法线，无相邻墙时返回 null（不给缺省法线冒充）。
  function wallNormalOrNull(W, tx, ty) {
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var dx = dirs[i][0], dy = dirs[i][1];
      if (W.isWall(tx + dx, ty + dy)) return { x: -dx, z: -dy };
    }
    return null;
  }
  // 在 (tx,ty) 周边 maxR 格内找最近的「地板 tile + 相邻墙」，返回 {fx, fy, nx, nz}；
  // 锚点位置 = 地板 tile 中心 - n*(T/2-0.05)，距墙面 back≈0.05；找不到返回 null。
  function findWallAnchor(W, tx, ty, maxR) {
    for (var r = 0; r <= maxR; r++) {
      for (var dx = -r; dx <= r; dx++) for (var dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        var fx = tx + dx, fy = ty + dy;
        if (W.tile(fx, fy) !== 1) continue;
        var n = wallNormalOrNull(W, fx, fy);
        if (n) return { fx: fx, fy: fy, nx: n.x, nz: n.z };
      }
    }
    return null;
  }
  function hashRng(s) { return new BR.RNG(BR.hashSeed(s)); }
  function keyLabel() { return (BR.interactKeyLabel ? BR.interactKeyLabel() : ''); }
  function doTravel(level) {
    if (BR.Cutout && typeof BR.Cutout.travelTo === 'function')
      return BR.Cutout.travelTo(level, { mode: 'door' });
    if (BR.Game && BR.Game.gotoLevel) { BR.Game.gotoLevel(level, {}); return null; }
    return null;
  }
  function pushEvent(id) {
    var W = BR.World;
    if (W && W.state && W.state.events.indexOf(id) < 0) {
      W.state.events.push(id);
      if (BR.bus) BR.bus.emit('event', { id: id });
    }
  }
  function markFound(exitId, label) {
    if (BR.Game && BR.Game.flags && !BR.Game.flags['l4_found_' + exitId]) {
      BR.Game.flags['l4_found_' + exitId] = true;
      BR.UI.toast('你记下了这个出口的位置：' + label, 2600);
      if (BR.Game.autosave) BR.Game.autosave();
    }
    pushEvent('l4_found_' + exitId);
  }
  // 完成只在真正使用出口时置位（bangEscaped 模式）
  function markCompleted(exitId) {
    S.completed = true;
    if (BR.Game && BR.Game.flags) {
      BR.Game.flags.l4_completed = true;
      if (BR.Game.autosave) BR.Game.autosave();
    }
    pushEvent('l4_exited_' + exitId);
  }
  function giveItem(id, n) {
    n = n || 1;
    BR.Game.inv[id] = (BR.Game.inv[id] || 0) + n;
    BR.Audio.pickup();
    BR.UI.toast('获得了' + BR.Items.itemName(id) + (n > 1 ? ' ×' + n : ''));
    BR.UI.updateInv();
    if (BR.Game.autosave) BR.Game.autosave();
  }

  /* ================= 几何/材质缓存 ================= */
  var _gc = {};
  function bx(w, h, d) {
    var k = 'b' + w + ',' + h + ',' + d;
    return _gc[k] || (_gc[k] = new THREE.BoxGeometry(w, h, d));
  }
  function pl(w, h) {
    var k = 'p' + w + ',' + h;
    return _gc[k] || (_gc[k] = new THREE.PlaneGeometry(w, h));
  }
  var _mc = {};
  function mc(key, make) { return _mc[key] || (_mc[key] = make()); }
  function lam(color) {
    return mc('c' + color, function () { return new THREE.MeshLambertMaterial({ color: color }); });
  }
  function texMat(tex, tint) {
    var k = 't' + tex + '_' + (tint || '');
    return mc(k, function () {
      return new THREE.MeshLambertMaterial({ map: BR.Textures.get(tex), color: tint || 0xffffff });
    });
  }

  /* ================= 家具（真实比例，米） ================= */
  function buildChair(g, x, z, ry) {
    var c = new THREE.Group();
    c.position.set(x, 0, z); c.rotation.y = ry || 0;
    var dark = lam(0x2a2d33), seatM = lam(0x3a3f47);
    var seat = new THREE.Mesh(bx(0.46, 0.07, 0.44), seatM); seat.position.y = 0.46; c.add(seat);
    var back = new THREE.Mesh(bx(0.44, 0.5, 0.07), seatM); back.position.set(0, 0.78, -0.21); back.rotation.x = 0.1; c.add(back);
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8), dark); stem.position.y = 0.22; c.add(stem);
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.04, 10), dark); base.position.y = 0.03; c.add(base);
    g.add(c);
    BR.World.addPropCircle(x, z, 0.30); // v2.5 道具碰撞：椅子底盘 Ø0.6（全部椅子调用点共用此登记）
    return c;
  }
  function buildDesk(g, x, z, ry, rng, opts) {
    opts = opts || {};
    var d = new THREE.Group();
    d.position.set(x, 0, z); d.rotation.y = ry || 0;
    var top = new THREE.Mesh(bx(1.4, 0.05, 0.7), texMat('l4_desk')); top.position.y = 0.74; d.add(top);
    var legM = lam(0x555a61);
    [[-0.64, -0.29], [0.64, -0.29], [-0.64, 0.29], [0.64, 0.29]].forEach(function (p) {
      var leg = new THREE.Mesh(bx(0.06, 0.72, 0.06), legM); leg.position.set(p[0], 0.36, p[1]); d.add(leg);
    });
    // 显示器（大多黑屏，偶尔亮着没写完的文档）
    var mon = new THREE.Group(); mon.position.set(-0.25, 0.765, -0.12); mon.rotation.y = 0.15;
    var scr = new THREE.Mesh(bx(0.52, 0.33, 0.035),
      rng.chance(0.12) ? mc('scr_on', function () {
        return new THREE.MeshBasicMaterial({ color: 0x9fb6cc });
      }) : lam(0x0b0d11));
    scr.position.y = 0.28; mon.add(scr);
    var stand = new THREE.Mesh(bx(0.08, 0.12, 0.08), lam(0x22252a)); stand.position.y = 0.06; mon.add(stand);
    d.add(mon);
    if (!opts.noKeyboard) {
      var kb = new THREE.Mesh(bx(0.4, 0.02, 0.14), lam(0x1c1e22)); kb.position.set(0.05, 0.775, 0.12); d.add(kb);
    }
    if (rng.chance(0.5)) { // 散落的纸
      var paper = new THREE.Mesh(pl(0.21, 0.3), lam(0xe8e4d8));
      paper.rotation.x = -Math.PI / 2; paper.rotation.z = rng.next() * 3;
      paper.position.set(0.35 + (rng.next() - 0.5) * 0.2, 0.768, 0.05); d.add(paper);
    }
    g.add(d);
    BR.World.addPropBox(x, z, 0.70, 0.35, { rot: ry || 0 }); // v2.5 道具碰撞：办公桌桌面 1.4×0.7
    return d;
  }
  function buildCubicle(g, cx, cz, ry, rng) {
    var cu = new THREE.Group();
    cu.position.set(cx, 0, cz); cu.rotation.y = ry;
    var pm = texMat('l4_cubicle');
    var back = new THREE.Mesh(bx(1.8, 1.5, 0.06), pm); back.position.set(0, 0.75, -0.87); cu.add(back);
    var s1 = new THREE.Mesh(bx(0.06, 1.5, 1.8), pm); s1.position.set(-0.87, 0.75, 0); cu.add(s1);
    var s2 = new THREE.Mesh(bx(0.06, 1.5, 1.8), pm); s2.position.set(0.87, 0.75, 0); cu.add(s2);
    cu.add((function () { var t = new THREE.Mesh(bx(1.7, 0.05, 0.6), texMat('l4_desk')); t.position.set(0, 0.74, -0.55); return t; })());
    var mon = new THREE.Mesh(bx(0.5, 0.32, 0.04), rng.chance(0.1) ?
      mc('scr_on2', function () { return new THREE.MeshBasicMaterial({ color: 0x8aa4bd }); }) : lam(0x0b0d11));
    mon.position.set(0, 1.0, -0.6); cu.add(mon);
    g.add(cu);
    // v2.5 道具碰撞：隔断三片薄板 + 内置桌，按 cu 朝向 ry 把局部偏移变换到世界坐标逐片登记（正面开口不封）
    (function () {
      var cs = Math.cos(ry), sn = Math.sin(ry);
      function regPanel(lx, lz, hw, hd) {
        BR.World.addPropBox(cx + lx * cs + lz * sn, cz - lx * sn + lz * cs, hw, hd, { rot: ry });
      }
      regPanel(0, -0.87, 0.90, 0.03);  // 背板 1.8×0.06
      regPanel(-0.87, 0, 0.03, 0.90);  // 左侧板 0.06×1.8
      regPanel(0.87, 0, 0.03, 0.90);   // 右侧板 0.06×1.8
      regPanel(0, -0.55, 0.85, 0.30);  // 内置桌 1.7×0.6
    })();
    buildChair(g, cx + Math.sin(ry) * 0.1, cz + Math.cos(ry) * 0.75, ry + Math.PI + (rng.next() - 0.5) * 0.8);
    return cu;
  }
  function buildMeetingTable(g, cx, cz, rng) {
    var t = new THREE.Mesh(bx(3.0, 0.07, 1.2), texMat('l4_desk')); t.position.set(cx, 0.74, cz); g.add(t);
    var legM = lam(0x555a61);
    [[-1.4, -0.5], [1.4, -0.5], [-1.4, 0.5], [1.4, 0.5]].forEach(function (p) {
      var leg = new THREE.Mesh(bx(0.08, 0.72, 0.08), legM); leg.position.set(cx + p[0], 0.36, cz + p[1]); g.add(leg);
    });
    BR.World.addPropBox(cx, cz, 1.50, 0.60); // v2.5 道具碰撞：会议桌 3.0×1.2（四周椅子由 buildChair 各自登记）
    for (var k = 0; k < 6; k++) {
      var side = k < 3 ? -1 : 1, px = cx - 1 + (k % 3) * 1.0;
      buildChair(g, px, cz + side * 1.0, side < 0 ? 0 : Math.PI);
    }
  }
  function buildBoxes(g, cx, cz, rng) { // 纸箱堆（档案室装饰）
    var n = 2 + ((rng.next() * 3) | 0);
    for (var k = 0; k < n; k++) {
      var s = 0.45 + rng.next() * 0.2;
      var b = new THREE.Mesh(bx(s, s * 0.7, s), lam(0x9a7d55));
      b.position.set(cx + (rng.next() - 0.5) * 0.9, s * 0.35 + (k > 1 ? s * 0.7 : 0), cz + (rng.next() - 0.5) * 0.9);
      b.rotation.y = rng.next() * 0.6;
      g.add(b);
    }
  }

  /* ================= Level 定义 ================= */
  BR.Levels.L4 = {
    name: 'Level 4 ——「废弃办公室」',
    theme: {
      bg: 0x05060a, fogNear: 12, fogFar: 68,
      ambient: 0xe8ecf4, ambInt: 0.8, sky: 0x000000, ground: 0x39404e,
      light: 0xfff2dc, lightInt: 0.9,
      wallH: 3, wall: 'l4_wall', floor: 'l4_carpet', ceil: 'ceiling',
      surface: 'concrete', fixtureEvery: 4, flickerRate: 0.05, hum: 0
    },

    buildContent: function (map, W) {
      S = newState();
      var L = (W._l4 = { S: S });
      var meta = (map.meta && map.meta.l4) || { blocks: [] };
      var seed = map.seed;

      ['l4_wall', 'l4_carpet', 'l4_cubicle', 'l4_desk'].forEach(function (n) {
        var t = BR.Textures.get(n);
        if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      });

      // POI tile 快查（家具避让）
      var poiTiles = {};
      (map.pois || []).forEach(function (p) { poiTiles[p.tx + ',' + p.ty] = 1; });

      // 窗墙 tile 集合（贴墙物选址要避开：窗玻璃就在墙内面，牌/板压上去会盖窗）
      var winTiles = {};
      poiList(map, 'window').forEach(function (p) {
        if (p.data && p.data.wtx != null) winTiles[p.data.wtx + ',' + p.data.wty] = 1;
      });
      // 街区环墙实墙段扫描：返回指定侧的实墙连续段（沿轴 tile 区间 {c0,c1}）。
      // 门洞（环上的地板 tile）与窗墙 tile 都是断点——贴墙物只能挂实段上。
      function ringSegs(b, side) {
        var tiles = [], i2;
        if (side === 'n' || side === 's') {
          var ty = side === 'n' ? b.y0 : b.y1;
          for (i2 = b.x0; i2 <= b.x1; i2++) tiles.push({ a: i2, tx: i2, ty: ty });
        } else {
          var tx = side === 'w' ? b.x0 : b.x1;
          for (i2 = b.y0; i2 <= b.y1; i2++) tiles.push({ a: i2, tx: tx, ty: i2 });
        }
        var segs = [], cur = null;
        tiles.forEach(function (tl) {
          var ok = W.isWall(tl.tx, tl.ty) && !winTiles[tl.tx + ',' + tl.ty];
          if (ok) { if (cur) cur.c1 = tl.a; else cur = { c0: tl.a, c1: tl.a }; }
          else if (cur) { segs.push(cur); cur = null; }
        });
        if (cur) segs.push(cur);
        return segs;
      }

      /* ---------- 街区家具 ---------- */
      meta.blocks.forEach(function (b) {
        var ccx = (b.x0 + b.x1) >> 1, ccy = (b.y0 + b.y1) >> 1;
        W.addChunkContent(ccx, ccy, function (group) {
          var rng = hashRng('l4furn:' + seed + ':' + b.id);
          var cx, cz, k;
          if (b.zone === 'open_office') {
            // 格子间阵列：3 tile 间距，留走道列
            for (var gy = b.iy0 + 1; gy + 1 <= b.iy1 - 1; gy += 3) {
              for (var gx = b.ix0 + 1; gx + 1 <= b.ix1 - 1; gx += 3) {
                if (((gx - b.ix0) / 3 | 0) % 3 === 2) continue; // 走道
                if (poiTiles[gx + ',' + gy] || poiTiles[(gx + 1) + ',' + gy]) continue;
                cx = BR.tileCX(gx) + 1.5; cz = BR.tileCZ(gy) + 1.5;
                buildCubicle(group, cx, cz, (rng.next() < 0.5 ? 0 : Math.PI) + (rng.next() - 0.5) * 0.2, rng);
              }
            }
          } else if (b.zone === 'private_offices') {
            var mx = ((b.ix0 + b.ix1) >> 1), my = ((b.iy0 + b.iy1) >> 1);
            [[b.ix0, mx - 1, b.iy0, my - 1], [mx + 1, b.ix1, b.iy0, my - 1],
             [b.ix0, mx - 1, my + 1, b.iy1], [mx + 1, b.ix1, my + 1, b.iy1]].forEach(function (cl) {
              var ddx = BR.tileCX((cl[0] + cl[1]) >> 1), ddz = BR.tileCZ((cl[2] + cl[3]) >> 1);
              buildDesk(group, ddx, ddz, (rng.next() * 4 | 0) * Math.PI / 2, rng);
              buildChair(group, ddx + 0.9, ddz + 0.3, rng.next() * 6.28);
              if (rng.chance(0.5)) buildBoxes(group, ddx - 1.2, ddz - 1.0, rng);
            });
          } else if (b.zone === 'meeting_room') {
            cx = BR.tileCX((b.ix0 + b.ix1) >> 1); cz = BR.tileCZ((b.iy0 + b.iy1) >> 1);
            buildMeetingTable(group, cx, cz, rng);
            // 白板选址（A2-W02）：旧式无条件贴北墙正中，但 meeting_room 每面临走廊侧
            // 都在正中开 2 tile 门洞（gen openSides），by≥1 的会议室北墙正中恰是门洞
            // → 白板整块悬在门洞口挡门。改为按 n/s/e/w 顺序找第一面带 ≥1 tile 实墙段
            // （避门洞/窗，ringSegs）的墙，板心取该面最长实段中心，同墙面内平移避门；
            // 无门洞时（如 by=0 北墙）实段中心即原正中位置，行为不变。
            var wbPos = null;
            ['n', 's', 'e', 'w'].some(function (side) {
              var segs = ringSegs(b, side).filter(function (sg) { return (sg.c1 - sg.c0 + 1) * 3 >= 3.0; });
              if (!segs.length) return false;
              segs.sort(function (a2, b2) { return (b2.c1 - b2.c0) - (a2.c1 - a2.c0); });
              var mid = (segs[0].c0 + segs[0].c1 + 1) * 1.5;
              if (side === 'n') wbPos = { x: mid, z: BR.tileCZ(b.iy0) - 1.44, ry: 0 };
              else if (side === 's') wbPos = { x: mid, z: BR.tileCZ(b.iy1) + 1.44, ry: Math.PI };
              else if (side === 'w') wbPos = { x: BR.tileCX(b.ix0) - 1.44, z: mid, ry: Math.PI / 2 };
              else wbPos = { x: BR.tileCX(b.ix1) + 1.44, z: mid, ry: -Math.PI / 2 };
              return true;
            });
            if (!wbPos) wbPos = { x: cx, z: BR.tileCZ(b.iy0) - 1.44, ry: 0 }; // 理论兜底：四面无实段时维持旧位
            var wb = new THREE.Mesh(pl(2.4, 1.2), texMat('l4_whiteboard'));
            wb.position.set(wbPos.x, 1.7, wbPos.z);
            wb.rotation.y = wbPos.ry;
            group.add(wb); W.reg(group, wb);
          } else if (b.zone === 'break_room') {
            for (k = 0; k < 2; k++) {
              cx = BR.tileCX(b.ix0 + 2 + k * 3); cz = BR.tileCZ(b.iy1 - 2);
              var tb = new THREE.Mesh(bx(0.9, 0.06, 0.9), texMat('l4_desk')); tb.position.set(cx, 0.73, cz); group.add(tb);
              var tl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.72, 8), lam(0x555a61));
              tl.position.set(cx, 0.36, cz); group.add(tl);
              BR.World.addPropBox(cx, cz, 0.45, 0.45); // v2.5 道具碰撞：茶水间小桌 0.9×0.9
              buildChair(group, cx + 0.8, cz, -Math.PI / 2);
              buildChair(group, cx - 0.8, cz, Math.PI / 2);
            }
          } else if (b.zone === 'archive') {
            var rngA = hashRng('l4arch:' + seed + ':' + b.id);
            for (var ax = b.ix0 + 1; ax <= b.ix1 - 1; ax += 2) {
              if (poiTiles[ax + ',' + (b.iy1 - 1)]) continue;
              if (rngA.chance(0.6)) buildBoxes(group, BR.tileCX(ax), BR.tileCZ(b.iy1 - 1), rngA);
            }
          } else if (b.zone === 'garage') {
            // 车库地面覆盖
            var gw = (b.ix1 - b.ix0 + 1) * 3, gd = (b.iy1 - b.iy0 + 1) * 3;
            var gf = new THREE.Mesh(pl(gw, gd), texMat('l4_garagefloor'));
            gf.rotation.x = -Math.PI / 2;
            gf.position.set(BR.tileCX((b.ix0 + b.ix1) >> 1), 0.02, BR.tileCZ((b.iy0 + b.iy1) >> 1));
            group.add(gf); W.reg(group, gf);
          } else if (b.zone === 'loop_office') {
            cx = BR.tileCX((b.ix0 + b.ix1) >> 1); cz = BR.tileCZ((b.iy0 + b.iy1) >> 1);
            buildDesk(group, cx - 1.5, cz, Math.PI / 2, rng);
            buildChair(group, cx - 0.6, cz + 0.4, -Math.PI / 2 + 0.4);
            buildDesk(group, cx + 1.5, cz, -Math.PI / 2, rng);
            buildChair(group, cx + 0.6, cz - 0.4, Math.PI / 2 - 0.3);
            // 视错觉墙：“递归办公室”整面贴画（A2-W03）：旧式固定贴西墙整面，但
            // loop_office 唯一门洞恒开在 corrSides 首侧正中（bx>0 时即西墙）→ 画整面
            // 盖住唯一入口，玩家进出要穿画。改挂全环最长实墙段所在墙面（实段=无门洞、
            // 无窗的连续环墙，ringSegs），画宽随实段收（段长*3-0.6）、距墙面 0.06，
            // 入口所在墙面不再被盖，门洞一眼可辨。
            var bestSeg = null, bestSide = null;
            ['n', 's', 'e', 'w'].forEach(function (side) {
              ringSegs(b, side).forEach(function (sg) {
                if (!bestSeg || (sg.c1 - sg.c0) > (bestSeg.c1 - bestSeg.c0)) { bestSeg = sg; bestSide = side; }
              });
            });
            var lp = null;
            if (bestSeg) {
              var lmid = (bestSeg.c0 + bestSeg.c1 + 1) * 1.5;
              var lwW = (bestSeg.c1 - bestSeg.c0 + 1) * 3 - 0.6;
              if (bestSide === 'n') lp = { x: lmid, z: b.y0 * 3 + 3.06, ry: 0, nx: 0, nz: 1, w: lwW };
              else if (bestSide === 's') lp = { x: lmid, z: b.y1 * 3 - 0.06, ry: Math.PI, nx: 0, nz: -1, w: lwW };
              else if (bestSide === 'w') lp = { x: b.x0 * 3 + 3.06, z: lmid, ry: Math.PI / 2, nx: 1, nz: 0, w: lwW };
              else lp = { x: b.x1 * 3 - 0.06, z: lmid, ry: -Math.PI / 2, nx: -1, nz: 0, w: lwW };
            }
            if (!lp) lp = { x: BR.tileCX(b.ix0) - 1.42, z: cz, ry: Math.PI / 2, nx: 1, nz: 0, w: (b.iy1 - b.iy0 + 1) * 3 - 0.6 }; // 理论兜底：四面无实段时维持旧位
            var lw = new THREE.Mesh(pl(lp.w, 2.6), texMat('l4_loop'));
            lw.position.set(lp.x, 1.45, lp.z);
            lw.rotation.y = lp.ry;
            group.add(lw); W.reg(group, lw);
            W.addInteractable({
              id: 'l4_loopwall_' + b.id, kind: 'inspect', chunkKey: W.chunkKeyOf(ccx, ccy),
              meshes: [lw], pos: new THREE.Vector3(lp.x + lp.nx * 0.55, 1.4, lp.z + lp.nz * 0.55), radius: 2.6,
              prompt: function () { return keyLabel() + '端详这面墙'; },
              canUse: function () { return true; },
              use: function () {
                BR.Audio.whisper();
                BR.UI.toast('墙上的办公室一层套一层，桌椅、显示器、你……你数到第七层就不敢数了。', 3600);
                var P = BR.Player;
                if (P) P.sanity = Math.max(0, P.sanity - 3);
                pushEvent('l4_loop_seen');
              }
            });
          } else if (b.zone === 'elevator_lobby') {
            // 休息椅 + 枯死的绿植
            var bx0 = BR.tileCX(b.ix0 + 1), bz0 = BR.tileCZ(b.iy1 - 1);
            var bench = new THREE.Mesh(bx(1.8, 0.08, 0.5), texMat('l4_desk')); bench.position.set(bx0, 0.45, bz0); group.add(bench);
            var plant = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 7), lam(0x5a4a2a));
            plant.position.set(BR.tileCX(b.ix1 - 1), 0.75, BR.tileCZ(b.iy1 - 1)); group.add(plant);
            var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.4, 10), lam(0x8a4a3a));
            pot.position.set(BR.tileCX(b.ix1 - 1), 0.2, BR.tileCZ(b.iy1 - 1)); group.add(pot);
            BR.World.addPropBox(bx0, bz0, 0.90, 0.25); // v2.5 道具碰撞：休息长椅 1.8×0.5
            BR.World.addPropCircle(BR.tileCX(b.ix1 - 1), BR.tileCZ(b.iy1 - 1), 0.24); // v2.5 道具碰撞：绿植花盆 Ø0.44
          }
        });
      });

      /* ---------- 文件柜（BR.Container，可开、逐件拾取） ---------- */
      var CAB_PATTERNS = [
        [{ item: 'almond', dx: -0.25, y: 0.35 }, { item: 'bandage', dx: 0.25, y: 0.35 }, { item: 'empty' }],
        [{ item: 'energy_bar', dx: -0.2, y: 0.9 }, { item: 'almond', dx: 0.2, y: 0.35 }, { item: 'empty' }],
        [{ item: 'bandage', dx: -0.25, y: 0.35 }, { item: 'bandage', dx: 0.25, y: 0.9 }, { item: 'empty' }]
      ];
      poiList(map, 'cabinet').forEach(function (p) {
        var fx = BR.tileCX(p.tx), fz = BR.tileCZ(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var furn = BR.buildFurnitureMesh('cabinet');
          // 朝向：门朝房间（背对最近的墙）
          var ry = 0;
          if (W.isWall(p.tx, p.ty - 1)) ry = 0;
          else if (W.isWall(p.tx, p.ty + 1)) ry = Math.PI;
          else if (W.isWall(p.tx - 1, p.ty)) ry = Math.PI / 2;
          else if (W.isWall(p.tx + 1, p.ty)) ry = -Math.PI / 2;
          furn.position.set(fx, 0, fz); furn.rotation.y = ry;
          W.reg(group, furn);
          W.addPropBox(fx, fz, 0.53, 0.28, { rot: ry }); // v2.5 道具碰撞：文件柜 1.05×0.55（走 BR.Container 而非 addFurniturePickup，自行登记）
          furn.updateMatrixWorld(true);
          var flat = [];
          furn.traverse(function (o) { if (o.isMesh) flat.push(o); });
          function innerPos(idx, entry) {
            return furn.localToWorld(new THREE.Vector3(entry.dx || 0, entry.y != null ? entry.y : 0.6, (entry.dz || 0) + 0.08));
          }
          BR.Container.create(W, {
            id: 'l4cab_' + p.tx + '_' + p.ty + '_' + p.data.idx,
            kind: 'cabinet', closable: true,
            tx: p.tx, ty: p.ty, group: group,
            visual: { pivot: furn.userData.doorPivot },
            meshes: flat, pos: new THREE.Vector3(fx, 1.0, fz),
            innerPosOf: innerPos,
            contents: CAB_PATTERNS[(p.data.idx || 0) % 3],
            text: { open: '打开文件柜', openedToast: '文件柜里塞满了文件夹，底下压着补给', emptyToast: '只有发黄的空文件夹。' },
            autosave: true
          });
        });
      });

      /* ---------- 字条 ---------- */
      var NOTES = [
        ['皱巴巴的值班表', '“……电梯又开始自己上下了。老张说他按了 B3，门开的时候外面是 Level 3 的机房走廊，他没敢出去。如果你也想下去，就去大厅的电梯，别按错层。”'],
        ['消防演习通知', '“……楼梯间直通下层，演习时别坐电梯。上次有人从楼梯间回来，说下面全是嗡嗡响的管道（像 Level 2）。演习时间：永不。”'],
        ['停车场施工通知', '“B1 坡道维修中，但其实一直能走。下去就是 B1，灯是黄的。有人说 B1 其实是 Level 1 的大厅——我没去过，你自己看。”'],
        ['手写的警告', '“不要靠近没封死的窗户！！小李昨天就多看了一眼，现在还在医务室说胡话。窗户后面不是外面，记住了吗？！”'],
        ['行政备忘', '“雕花木门后面是什么？行政说那是通往 5 楼的。可这栋楼根本没有 5 楼。别碰它。”']
      ];
      poiList(map, 'note').forEach(function (p, ni) {
        var nn = NOTES[ni % NOTES.length];
        var id = 'note_l4_' + p.tx + '_' + p.ty;
        W.addChunkContent(p.tx, p.ty, function (group) {
          // 贴墙锚定（A2-W01，家族通病两连）：① 字条 POI 在街区内 (ix0+1, iy0+2)、离环墙
          // 2 tile，旧式只查紧邻 4 格，找不到墙就用缺省法线 (0,1) 把纸贴在房间中央；
          // ② 找到墙时偏移沿「背离墙」法线施加（tileC + n*1.1），把纸推离墙面 2.6m。
          // 改用 findWallAnchor 向外找最近贴墙地板 tile，锚点 = 锚点 tile 中心
          // - 法线*(T/2-0.05)（涂鸦/L11 同口径），back≈0.05；朝向仍用法线朝房间。
          var anchor = findWallAnchor(W, p.tx, p.ty, 3);
          var m = new THREE.Mesh(pl(0.55, 0.75), new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
          var noteMeshes = [m];
          if (anchor) {
            m.position.set(BR.tileCX(anchor.fx) - anchor.nx * (BR.TILE / 2 - 0.05), 1.5, BR.tileCZ(anchor.fy) - anchor.nz * (BR.TILE / 2 - 0.05));
            m.rotation.y = Math.atan2(anchor.nx, anchor.nz);
          } else {
            // 周边 3 格内无墙可贴（理论兜底）：改立式告示牌（木桩落地+纸面架桩），不悬空贴墙纸
            var post = new THREE.Mesh(bx(0.09, 1.5, 0.09), lam(0x4a4035));
            post.position.set(BR.tileCX(p.tx), 0.75, BR.tileCZ(p.ty));
            group.add(post); W.reg(group, post);
            noteMeshes.push(post);
            m.position.set(BR.tileCX(p.tx), 1.32, BR.tileCZ(p.ty) + 0.06);
            m.rotation.y = 0;
          }
          W.reg(group, m);
          W.addInteractable({
            id: id, kind: 'note', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: noteMeshes, pos: m.position.clone(), radius: 2.4,
            prompt: function () { return keyLabel() + '阅读字条'; },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.paper();
              BR.UI.showNote(nn[0], nn[1]);
              if (W.state.picked.indexOf(id) < 0) {
                W.state.picked.push(id);
                BR.bus.emit('picked', { id: id });
              }
            }
          });
        });
      });

      /* ---------- 贩卖机 / 饮水机 ---------- */
      poiList(map, 'vending').forEach(function (p) {
        var fx = BR.tileCX(p.tx), fz = BR.tileCZ(p.ty);
        var id = 'l4vend_' + p.tx + '_' + p.ty;
        var broken = !!p.data.broken;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = new THREE.Group(); g.position.set(fx, 0, fz);
          var ry = 0;
          if (W.isWall(p.tx, p.ty - 1)) ry = 0;
          else if (W.isWall(p.tx, p.ty + 1)) ry = Math.PI;
          else if (W.isWall(p.tx - 1, p.ty)) ry = Math.PI / 2;
          else if (W.isWall(p.tx + 1, p.ty)) ry = -Math.PI / 2;
          g.rotation.y = ry;
          var body = new THREE.Mesh(bx(1.0, 1.9, 0.8), lam(0x23262c)); body.position.y = 0.95; g.add(body);
          var front = new THREE.Mesh(pl(0.86, 1.7),
            broken ? lam(0x0c0d10) : new THREE.MeshBasicMaterial({ map: BR.Textures.get('l4_vendfront') }));
          front.position.set(0, 0.98, 0.41); g.add(front);
          if (broken) { g.rotation.z = 0.06; }
          W.reg(group, g);
          W.addPropBox(fx, fz, 0.50, 0.40, { rot: ry }); // v2.5 道具碰撞：贩卖机 1.0×0.8（正面可站，交互半径 2.4 内可达）
          var flat = []; g.traverse(function (o) { if (o.isMesh) flat.push(o); });
          W.addInteractable({
            id: id, kind: 'shop', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: flat, pos: new THREE.Vector3(fx, 1.1, fz), radius: 2.4,
            prompt: function () {
              if (W.state.picked.indexOf(id) >= 0) return '贩卖机（已经空了）';
              return broken ? keyLabel() + '掏一下坏掉的贩卖机' : keyLabel() + '买一瓶杏仁水';
            },
            canUse: function () { return W.state.picked.indexOf(id) < 0; },
            use: function () {
              if (W.state.picked.indexOf(id) >= 0) return;
              W.state.picked.push(id);
              BR.bus.emit('picked', { id: id });
              BR.Audio.vend ? BR.Audio.vend() : BR.Audio.pickup();
              giveItem('almond', 1);
              BR.UI.toast(broken ? '取货口卡着一瓶没掉下去的杏仁水，归你了。' : '贩卖机“哐当”一声，掉出一瓶冰凉的杏仁水。', 2600);
            }
          });
        });
      });
      poiList(map, 'watercooler').forEach(function (p) {
        var fx = BR.tileCX(p.tx), fz = BR.tileCZ(p.ty);
        var id = 'l4cool_' + p.tx + '_' + p.ty;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = new THREE.Group(); g.position.set(fx, 0, fz);
          var body = new THREE.Mesh(bx(0.36, 1.0, 0.36), lam(0xd8d4c8)); body.position.y = 0.5; g.add(body);
          var bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.42, 12),
            mc('coolwater', function () {
              return new THREE.MeshLambertMaterial({ color: 0x9fd0e8, transparent: true, opacity: 0.75 });
            }));
          bottle.position.y = 1.22; g.add(bottle);
          W.reg(group, g);
          W.addPropBox(fx, fz, 0.18, 0.18); // v2.5 道具碰撞：饮水机 0.36×0.36（交互半径 2.2 内可达）
          var flat = []; g.traverse(function (o) { if (o.isMesh) flat.push(o); });
          W.addInteractable({
            id: id, kind: 'inspect', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: flat, pos: new THREE.Vector3(fx, 1.0, fz), radius: 2.2,
            prompt: function () {
              return W.state.picked.indexOf(id) >= 0 ? '饮水机（水桶空了）' : keyLabel() + '接一杯杏仁水';
            },
            canUse: function () { return W.state.picked.indexOf(id) < 0; },
            use: function () {
              if (W.state.picked.indexOf(id) >= 0) return;
              W.state.picked.push(id);
              BR.bus.emit('picked', { id: id });
              BR.Audio.drink();
              giveItem('almond', 1);
              BR.UI.toast('接了满满一杯，水有点甜——是杏仁水。', 2400);
            }
          });
        });
      });

      /* ---------- 窗户（封死的 / 虚空陷阱） ---------- */
      poiList(map, 'window').forEach(function (p) {
        var blacked = !!p.data.blacked;
        var wx = BR.tileCX(p.data.wtx), wz = BR.tileCZ(p.data.wty);
        var side = p.data.side;
        // 墙内表面位置（朝房间）
        var ix = wx + (side === 'w' ? 1.5 : side === 'e' ? -1.5 : 0);
        var iz = wz + (side === 'n' ? 1.5 : side === 's' ? -1.5 : 0);
        var ry = side === 'w' ? Math.PI / 2 : side === 'e' ? -Math.PI / 2 : side === 'n' ? 0 : Math.PI;
        // 记录建在回调外：chunk 重建会重跑回调，记录不能重复
        if (!blacked) S.traps.push({ x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty), warnedT: 0 });
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = new THREE.Group(); g.position.set(ix, 0, iz); g.rotation.y = ry;
          var fm = lam(0x6a6f76);
          var fw = 1.8, fh = 1.5, fy = 1.55;
          [[-fw / 2, 0], [fw / 2, 0]].forEach(function (pp) {
            var post = new THREE.Mesh(bx(0.1, fh, 0.12), fm); post.position.set(pp[0], fy, 0); g.add(post);
          });
          [[-fh / 2], [fh / 2]].forEach(function (pp) {
            var bar = new THREE.Mesh(bx(fw + 0.1, 0.1, 0.12), fm); bar.position.set(0, fy + pp[0], 0); g.add(bar);
          });
          var mid = new THREE.Mesh(bx(0.06, fh, 0.08), fm); mid.position.set(0, fy, 0); g.add(mid);
          var glass = new THREE.Mesh(pl(fw - 0.1, fh - 0.1),
            new THREE.MeshBasicMaterial({ map: BR.Textures.get(blacked ? 'l4_blackout' : 'l4_void') }));
          glass.position.set(0, fy, 0.03); // 紧贴墙面（墙体实心，虚空用贴图表现纵深）
          g.add(glass);
          W.reg(group, g);
        });
      });

      /* ---------- 灯管嗡鸣区 ---------- */
      poiList(map, 'hum_zone').forEach(function (p, hi) {
        var hx = BR.tileCX(p.tx), hz = BR.tileCZ(p.ty);
        var HU = { x: hx, z: hz, mesh: null, phase: hi * 2.39, toastDone: false };
        S.hums.push(HU); // 记录建在回调外，防 chunk 重建重复
        BR.Audio.addLoop('l4_hum_' + hi, 'hum', hx, hz, 0.45);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var panel = new THREE.Mesh(pl(1.2, 0.6),
            new THREE.MeshBasicMaterial({ map: BR.Textures.get('fluor'), color: 0xd8d2c0 }));
          panel.rotation.x = Math.PI / 2;
          panel.position.set(hx, 2.93, hz);
          W.reg(group, panel);
          HU.mesh = panel;
        });
      });

      /* ---------- 出口：电梯 → L3（原著：L4 电梯可回 L3） ---------- */
      poiList(map, 'exit_elevator').forEach(function (p) {
        var fx = BR.tileCX(p.tx), fz = BR.tileCZ(p.ty);
        var wx = BR.tileCX(p.data.wtx), wz = BR.tileCZ(p.data.wty);
        // 门在南墙面上（wtx,wty 为墙 tile）
        var dx0 = wx, dz0 = wz + 1.5;
        var E = { open: false, anim: 0, pl: null, pr: null, ind: null };
        S.elev = E;
        if (W.state.events.indexOf('l4_elev_open') >= 0) { E.open = true; E.anim = 1; }
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = new THREE.Group(); g.position.set(dx0, 0, dz0);
          var fm = lam(0x3a3d42);
          [[-1.0], [1.0]].forEach(function (pp) {
            var post = new THREE.Mesh(bx(0.16, 2.4, 0.2), fm); post.position.set(pp[0], 1.2, 0.06); g.add(post);
          });
          var lin = new THREE.Mesh(bx(2.16, 0.16, 0.2), fm); lin.position.set(0, 2.48, 0.06); g.add(lin);
          var dm = texMat('l4_elev');
          E.pl = new THREE.Mesh(bx(0.9, 2.4, 0.08), dm); E.pl.position.set(-0.45, 1.2, 0.1); g.add(E.pl);
          E.pr = new THREE.Mesh(bx(0.9, 2.4, 0.08), dm); E.pr.position.set(0.45, 1.2, 0.1); g.add(E.pr);
          // 轿厢内的黑暗（贴墙面，门板在其前滑动）
          var dark = new THREE.Mesh(pl(1.8, 2.4), new THREE.MeshBasicMaterial({ color: 0x020203 }));
          dark.position.set(0, 1.2, 0.03); g.add(dark);
          // 呼梯按钮 + 指示灯
          var btn = new THREE.Mesh(bx(0.12, 0.18, 0.06), lam(0xb03030)); btn.position.set(1.25, 1.2, 0.1); g.add(btn);
          E.ind = new THREE.Mesh(pl(0.3, 0.12), new THREE.MeshBasicMaterial({ color: 0x301505 }));
          E.ind.position.set(0, 2.68, 0.07); g.add(E.ind);
          if (E.open) { E.pl.position.x = -1.3; E.pr.position.x = 1.3; E.ind.material.color.setHex(0x30ff60); }
          W.reg(group, g);
          var flat = []; g.traverse(function (o) { if (o.isMesh) flat.push(o); });
          W.addInteractable({
            id: 'l4_elev', kind: 'elevator', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: flat, pos: new THREE.Vector3(dx0, 1.2, dz0 + 0.6), radius: 3.0,
            prompt: function () {
              return E.open ? keyLabel() + '走进电梯（去下层）' : keyLabel() + '按下呼梯按钮';
            },
            canUse: function () { return true; },
            use: function () {
              if (!E.open) {
                E.open = true; E.anim = 0.0001;
                BR.Audio.doorCreak();
                if (E.ind) E.ind.material.color.setHex(0x30ff60);
                BR.UI.toast('电梯门缓缓滑开——轿厢里一片漆黑，楼层键只有 B3 还亮着。', 3000);
                pushEvent('l4_elev_open');
                markFound('elevator', '大厅电梯（通往下层）');
                return;
              }
              markFound('elevator', '大厅电梯（通往下层）');
              markCompleted('elevator');
              BR.Input.setLocked(true);
              BR.UI.toast('你走进轿厢，门在身后合拢——失重感一闪而过。', 2200);
              setTimeout(function () {
                var done = doTravel('L3');
                if (done && typeof done.then === 'function') done.then(function (ok) {
                  if (!ok) { BR.Input.setLocked(false); BR.UI.toast('电梯抖了一下，停住了——这次没能下去，稍后再试。', 2600); }
                });
                else BR.Input.setLocked(false);
              }, 900);
            }
          });
        });
      });

      /* ---------- 出口：楼梯间 → L2（原著“L2 未上锁的门↔L4”的反向改编） ---------- */
      poiList(map, 'exit_stair').forEach(function (p) {
        var wx = BR.tileCX(p.data.wtx), wz = BR.tileCZ(p.data.wty);
        var side = p.data.side;
        var ix = wx + (side === 'w' ? 1.5 : side === 'e' ? -1.5 : 0);
        var iz = wz + (side === 'n' ? 1.5 : side === 's' ? -1.5 : 0);
        var ry = side === 'w' ? Math.PI / 2 : side === 'e' ? -Math.PI / 2 : side === 'n' ? 0 : Math.PI;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = new THREE.Group(); g.position.set(ix, 0, iz); g.rotation.y = ry;
          var door = new THREE.Mesh(bx(1.1, 2.3, 0.1), texMat('l4_wood')); door.position.set(0, 1.15, 0); g.add(door);
          var sign = new THREE.Mesh(pl(0.7, 0.25), new THREE.MeshBasicMaterial({ map: BR.Textures.get('l4_exitsign') }));
          sign.position.set(0, 2.62, 0.06); g.add(sign);
          var fm = lam(0x3a3d42);
          [[-0.62], [0.62]].forEach(function (pp) {
            var post = new THREE.Mesh(bx(0.12, 2.4, 0.14), fm); post.position.set(pp[0], 1.2, 0); g.add(post);
          });
          W.reg(group, g);
          var flat = []; g.traverse(function (o) { if (o.isMesh) flat.push(o); });
          W.addInteractable({
            id: 'l4_stair', kind: 'exit', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: flat, pos: new THREE.Vector3(ix, 1.2, iz), radius: 2.6,
            prompt: function () { return keyLabel() + '推开楼梯间的门（向下）'; },
            canUse: function () { return true; },
            use: function () {
              markFound('stair', '楼梯间（通往下层）');
              markCompleted('stair');
              BR.Audio.doorCreak();
              BR.UI.toast('门后是向下盘旋的楼梯，传来管道的嗡鸣——你走了下去。', 2400);
              setTimeout(function () { doTravel('L2'); }, 800);
            }
          });
        });
      });

      /* ---------- 出口：停车场坡道 → L1（改编自 noclip wiki“停车场→L1”） ---------- */
      poiList(map, 'exit_garage').forEach(function (p) {
        var fx = BR.tileCX(p.tx), fz = BR.tileCZ(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = new THREE.Group(); g.position.set(fx, 0, fz);
          var ramp = new THREE.Mesh(pl(2.6, 4.2), new THREE.MeshBasicMaterial({ color: 0x060708 }));
          ramp.rotation.x = -Math.PI / 2 + 0.18; // 向下倾斜
          ramp.position.set(0, -0.35, -1.2);
          g.add(ramp);
          var edgeM = lam(0xc8a020);
          [[-1.3], [1.3]].forEach(function (pp) {
            var edge = new THREE.Mesh(bx(0.12, 0.06, 4.2), edgeM);
            edge.position.set(pp[0], 0.03, -1.2); edge.rotation.x = 0.18; g.add(edge);
          });
          // EXIT/B1 牌（A2-W04）：旧式挂在 POI tile 中心上方 (0, y, 1.2)，是「假定身后
          // 有墙」的锚点——POI 在车库角落开敞处，身后 3.3m 才碰墙，两牌悬空 3.09m。
          // 改为自 POI 逐向（优先南墙）探实际墙面：命中墙行后沿墙找离 POI 最近的实墙段
          // （避窗/门洞，winTiles+isWall），牌心沿墙钳进实段内、距墙面 0.06 贴墙。
          var spot = null;
          var probeDirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
          for (var pdi = 0; pdi < 4 && !spot; pdi++) {
            var pdx = probeDirs[pdi][0], pdy = probeDirs[pdi][1], pk = 0;
            for (var kk = 1; kk <= 3; kk++) {
              if (W.isWall(p.tx + pdx * kk, p.ty + pdy * kk)) { pk = kk; break; }
              if (W.tile(p.tx + pdx * kk, p.ty + pdy * kk) !== 1) break;
            }
            if (!pk) continue;
            var hwtx = p.tx + pdx * pk, hwty = p.ty + pdy * pk;
            var horiz = (pdy !== 0), cA = horiz ? hwtx : hwty;
            var segs2 = [], cur2 = null;
            for (var a2 = cA - 6; a2 <= cA + 6; a2++) {
              var sx2 = horiz ? a2 : hwtx, sy2 = horiz ? hwty : a2;
              var ok2 = W.isWall(sx2, sy2) && !winTiles[sx2 + ',' + sy2];
              if (ok2) { if (cur2) cur2.c1 = a2; else cur2 = { c0: a2, c1: a2 }; }
              else if (cur2) { segs2.push(cur2); cur2 = null; }
            }
            if (cur2) segs2.push(cur2);
            var poiA = horiz ? fx : fz, bestClamp = null, bestDd = Infinity;
            segs2.forEach(function (sg) {
              var cl = Math.max(sg.c0 * 3 + 0.48, Math.min((sg.c1 + 1) * 3 - 0.48, poiA));
              var dd = Math.abs(cl - poiA);
              if (dd < bestDd) { bestDd = dd; bestClamp = cl; }
            });
            if (bestClamp == null) continue;
            var faceOff = pk * 3 - 1.56; // POI 中心 → 墙面内侧 0.06 处的沿向偏移
            if (pdy === 1) spot = { lx: bestClamp - fx, lz: faceOff, ry: Math.PI, wx: 0, wz: 1 };
            else if (pdy === -1) spot = { lx: bestClamp - fx, lz: -faceOff, ry: 0, wx: 0, wz: -1 };
            else if (pdx === 1) spot = { lx: faceOff, lz: bestClamp - fz, ry: -Math.PI / 2, wx: 1, wz: 0 };
            else spot = { lx: -faceOff, lz: bestClamp - fz, ry: Math.PI / 2, wx: -1, wz: 0 };
          }
          if (!spot) spot = { lx: 0, lz: 1.2, ry: Math.PI, wx: 0, wz: 1 }; // 理论兜底：四向 3 格无墙时维持旧位
          var sign = new THREE.Mesh(pl(0.9, 0.3), new THREE.MeshBasicMaterial({ map: BR.Textures.get('l4_exitsign') }));
          sign.position.set(spot.lx, 2.5, spot.lz); sign.rotation.y = spot.ry;
          g.add(sign);
          var b1 = new THREE.Mesh(pl(0.8, 0.5), new THREE.MeshBasicMaterial({ color: 0xc8a020 }));
          b1.position.set(spot.lx + spot.wx * 0.01, 1.9, spot.lz + spot.wz * 0.01); b1.rotation.y = spot.ry; g.add(b1);
          W.reg(group, g);
          var flat = []; g.traverse(function (o) { if (o.isMesh) flat.push(o); });
          W.addInteractable({
            id: 'l4_garage_exit', kind: 'exit', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: flat, pos: new THREE.Vector3(fx, 1.0, fz), radius: 2.8,
            prompt: function () { return keyLabel() + '沿坡道走下去（B1）'; },
            canUse: function () { return true; },
            use: function () {
              markFound('garage', '停车场坡道（B1）');
              markCompleted('garage');
              BR.UI.toast('坡道向下消失在黑暗里。你扶着墙，一步步走下去……', 2400);
              setTimeout(function () { doTravel('L1'); }, 800);
            }
          });
        });
      });

      /* ---------- 雕花木门（异常：门后虚空 + 移开视线消失） ---------- */
      poiList(map, 'ornate_door').forEach(function (p) {
        var wx = BR.tileCX(p.data.wtx), wz = BR.tileCZ(p.data.wty);
        var side = p.data.side;
        var ix = wx + (side === 'w' ? 1.5 : side === 'e' ? -1.5 : 0);
        var iz = wz + (side === 'n' ? 1.5 : side === 's' ? -1.5 : 0);
        var ry = side === 'w' ? Math.PI / 2 : side === 'e' ? -Math.PI / 2 : side === 'n' ? 0 : Math.PI;
        var O = { seen: false, gone: false, panel: null, g: null };
        S.ornate = O;
        if (W.state.events.indexOf('l4_ornate_gone') >= 0) O.gone = true;
        if (W.state.events.indexOf('l4_ornate_seen') >= 0) O.seen = true;
        W.addChunkContent(p.tx, p.ty, function (group) {
          if (O.gone) return;
          var g = new THREE.Group(); g.position.set(ix, 0, iz); g.rotation.y = ry;
          O.g = g;
          var fm = lam(0x2c2e33);
          [[-0.65], [0.65]].forEach(function (pp) {
            var post = new THREE.Mesh(bx(0.14, 2.5, 0.16), fm); post.position.set(pp[0], 1.25, 0); g.add(post);
          });
          var panel = new THREE.Mesh(bx(1.16, 2.36, 0.09), texMat('l4_ornate'));
          panel.position.set(0, 1.18, 0); g.add(panel);
          O.panel = panel;
          var dark = new THREE.Mesh(pl(1.16, 2.36), new THREE.MeshBasicMaterial({ color: 0x010102 }));
          dark.position.set(0, 1.18, 0.02); g.add(dark);
          W.reg(group, g);
          var flat = []; g.traverse(function (o) { if (o.isMesh) flat.push(o); });
          W.addInteractable({
            id: 'l4_ornate', kind: 'anomaly', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: flat, pos: new THREE.Vector3(ix, 1.2, iz), radius: 2.6,
            prompt: function () { return O.seen ? keyLabel() + '再看一眼雕花木门' : keyLabel() + '推开雕花木门'; },
            canUse: function () { return !O.gone; },
            use: function () {
              if (O.gone) return;
              O.seen = true;
              pushEvent('l4_ornate_seen');
              if (O.panel) O.panel.rotation.y = -1.9;
              BR.Audio.doorCreak();
              BR.UI.toast('门后只有翻涌的黑暗，隐约有风。——这扇门通往的地方，在这层楼里不存在。', 3600);
            }
          });
        });
      });

      /* ---------- 薄墙（随机切出） ---------- */
      if (BR.buildThinWalls) BR.buildThinWalls(map, W);
      if (BR.thinWallTick) { /* tick 里推进 */ }

      W.objective = '探索废弃办公室：补充物资，找到电梯 / 楼梯间 / 停车场出口离开';
    },

    onEnter: function () {
      BR.UI.setObjective(BR.World.objective);
      BR.Audio.setAmbient('L4');
      if (BR.Game && BR.Game.flags && !BR.Game.flags.l4_visited) {
        BR.Game.flags.l4_visited = true;
        if (BR.Game.autosave) BR.Game.autosave();
      }
      setTimeout(function () {
        BR.UI.toast('废弃办公室。灯很亮，静得能听见自己的呼吸。', 3600);
      }, 1200);
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player;
      if (!S || !W || !P) return;
      if (!BR.Game || BR.Game.level !== 'L4' || BR.Game.state !== 'playing') return;
      if (BR.thinWallTick) BR.thinWallTick(dt);
      S.t += dt;

      // 电梯门动画
      var E = S.elev;
      if (E && E.anim < 1) {
        E.anim = Math.min(1, E.anim + dt * 0.9);
        if (E.pl) E.pl.position.x = -0.45 - E.anim * 0.85;
        if (E.pr) E.pr.position.x = 0.45 + E.anim * 0.85;
      }

      // 未封死的窗户：靠近掉理智 + 耳语（原著：未封死的窗户是陷阱）
      S.whisperT = Math.max(0, S.whisperT - dt);
      for (var i = 0; i < S.traps.length; i++) {
        var tr = S.traps[i];
        var d = Math.hypot(P.pos.x - tr.x, P.pos.z - tr.z);
        if (d < 2.4) {
          P.sanity = Math.max(0, P.sanity - 4 * dt);
          if (S.whisperT <= 0) {
            S.whisperT = 6;
            BR.Audio.whisper();
          }
          tr.warnedT -= dt;
          if (tr.warnedT <= 0) {
            tr.warnedT = 25;
            BR.UI.toast('窗外有什么东西在“看”你——别再靠近没封死的窗户了。', 3000);
          }
        } else {
          tr.warnedT = Math.min(tr.warnedT + dt, 0);
        }
      }

      // 嗡鸣区：灯管频闪 + 初入提示
      for (var h = 0; h < S.hums.length; h++) {
        var hu = S.hums[h];
        var hd = Math.hypot(P.pos.x - hu.x, P.pos.z - hu.z);
        if (hd < 14) {
          if (!hu.toastDone) {
            hu.toastDone = true;
            BR.UI.toast('这段走廊的灯管嗡嗡作响，空气里有股臭氧味。', 2800);
          }
          if (hu.mesh) hu.mesh.visible = ((S.t * 11 + hu.phase) % 1) > 0.07;
        } else if (hu.mesh && !hu.mesh.visible) {
          hu.mesh.visible = true;
        }
      }

      // 雕花木门：看过之后，走远（>16m）就消失（原著：出口移开视线可能消失）
      var O = S.ornate;
      if (O && O.seen && !O.gone) {
        var od = Math.hypot(P.pos.x - O.g.position.x, P.pos.z - O.g.position.z);
        if (od > 16) {
          O.gone = true;
          if (O.g.parent) O.g.parent.remove(O.g);
          if (W.removeInteractable) W.removeInteractable('l4_ornate');
          pushEvent('l4_ornate_gone');
          BR.UI.toast('你回头看了一眼——那扇雕花木门不见了，墙上什么都没有。', 3600);
        }
      }
    }
  };

  // v2.0 P4：把 L4 登记进随机裂隙候选池（权重 10，接 cutout.js _extraRiftDests）。
  if (BR.Cutout && typeof BR.Cutout.registerRiftDest === 'function') BR.Cutout.registerRiftDest('L4', 10);
})();
