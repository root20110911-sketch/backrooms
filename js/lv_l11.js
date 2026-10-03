/* lv_l11.js —— Level 11「无垠城市·混凝土森林」内容搭建
 * v1.5 重构（W4）：真正的城市。建筑按 meta.l11.buildings 自建（高度/风格/退台各异），
 * 默认墙体渲染对建筑 tile 全部 skipWall（碰撞仍走 tile）。
 * 版本取舍（见 LORE.md）：荒凉无序的混凝土森林版；街道空旷、无车流、无居民群落。
 * 出口：井盖→L2（原著依据，Fandom Level 2 词条 Entrances）；地铁→L2/指引→L1/流浪者→Level ! 为游戏改编。
 * 井盖规则：只有 manhole_exit 那口特定井盖能开、能下；普通 manhole 纯装饰，走过不传送。
 */
(function () {
  var BR = window.BR;
  var T = BR.TILE;

  /* ---------- 出口 ---------- */
  function travelTo(to, kind) {
    if (!BR.Levels[to]) {
      BR.UI.toast('……那条路通向 ' + to + '，不过它好像还没被建造出来。');
      return;
    }
    if (BR.Cutout && typeof BR.Cutout.travel === 'function') {
      BR.Cutout.travel(to, { kind: kind || 'walk' });
      return;
    }
    BR.Game.gotoLevel(to);
  }
  // 井盖 → L2（原著连接）：优先 W10 的 BR.Cutout.travelTo('L2', {mode:'door'})，未落地时兜底旧 API
  function travelManholeL2() {
    if (BR.Cutout && typeof BR.Cutout.travelTo === 'function') {
      return BR.Cutout.travelTo('L2', { mode: 'door' }); // Promise<boolean>：busy 时 resolve(false)
    }
    travelTo('L2', 'walk');
    return null;
  }

  /* ---------- 本地小工具 ---------- */
  function poiList(map, type) { return (map.pois || []).filter(function (p) { return p.type === type; }); }
  function wallNormal(W, tx, ty) {
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var dx = dirs[i][0], dy = dirs[i][1];
      if (W.isWall(tx + dx, ty + dy)) return { x: -dx, z: -dy };
    }
    return { x: 0, z: 1 };
  }
  var ITEM_NAME = { almond: '杏仁水', bandage: '绷带' };
  function hashRng(str) { return new BR.RNG(BR.hashSeed(str)); }

  function addNote(W, tx, ty, title, body, idSuffix) {
    var id = 'note_l11_' + tx + '_' + ty + '_' + (idSuffix || '0');
    W.addChunkContent(tx, ty, function (group) {
      var n = wallNormal(W, tx, ty);
      var m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
        new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
      m.position.set(BR.tileCX(tx) + n.x * 1.1, 1.5, BR.tileCZ(ty) + n.z * 1.1);
      m.rotation.y = Math.atan2(n.x, n.z);
      W.reg(group, m);
      W.addInteractable({
        id: id, kind: 'note', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: [m], pos: m.position.clone(), radius: 2.4,
        prompt: function () { return '阅读字条'; },
        canUse: function () { return true; },
        use: function () {
          BR.Audio.paper();
          BR.UI.showNote(title, body);
          if (W.state.picked.indexOf(id) < 0) {
            W.state.picked.push(id);
            BR.bus.emit('picked', { id: id });
          }
        }
      });
    });
  }

  function addCrate(W, tx, ty, item, suffix) {
    var id = 'crate_l11_' + tx + '_' + ty + '_' + (suffix || '0');
    W.addChunkContent(tx, ty, function (group) {
      var cm = BR.buildCrateMesh(W);
      cm.group.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
      W.reg(group, cm.group);
      BR.wireCrateTwoStage(W, group, cm, { id: id, tx: tx, ty: ty, item: item || 'empty' });
    });
  }

  function makeNPC(bodyColor, headColor, hood) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.1, 10),
      new THREE.MeshLambertMaterial({ color: bodyColor }));
    body.position.y = 0.85; g.add(body);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10),
      new THREE.MeshLambertMaterial({ color: headColor }));
    head.position.y = 1.62; g.add(head);
    if (hood) {
      var h = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.42, 10),
        new THREE.MeshLambertMaterial({ color: bodyColor }));
      h.position.y = 1.82; g.add(h);
    }
    return { group: g, body: body, head: head };
  }

  function signTexture(lines, borderColor) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 128;
    var x = c.getContext('2d');
    x.fillStyle = '#0d1117'; x.fillRect(0, 0, 256, 128);
    x.strokeStyle = borderColor; x.lineWidth = 7; x.strokeRect(8, 8, 240, 112);
    x.fillStyle = '#f2f6ff'; x.font = 'bold 40px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (lines.length === 1) x.fillText(lines[0], 128, 66);
    else { x.fillText(lines[0], 128, 44); x.fillText(lines[1], 128, 88); }
    return new THREE.CanvasTexture(c);
  }

  function compass(dx, dy) {
    var s = '';
    if (dy > 2) s += '南'; else if (dy < -2) s += '北';
    if (dx > 2) s += '东'; else if (dx < -2) s += '西';
    return s || '附近';
  }

  /* ---------- 建筑盒子：立面纹理按 ~6m 重复，避免拉伸 ---------- */
  var FAC_TEX = ['fac_brick', 'fac_conc', 'fac_panel'];
  function facadeBox(W, wT, hM, dT, sideMat, topMat) {
    var geo = new THREE.BoxGeometry(wT * T, hM, dT * T);
    var uv = geo.attributes.uv, su = wT * T / 6, sv = hM / 6, du = dT * T / 6;
    for (var i = 0; i < 24; i++) {
      var f = (i / 4) | 0, u = uv.getX(i), v = uv.getY(i);
      if (f === 0 || f === 1) uv.setXY(i, u * du, v * sv);       // ±x 面：进深×高
      else if (f === 4 || f === 5) uv.setXY(i, u * su, v * sv);  // ±z 面：宽×高
      else uv.setXY(i, u * su, v * du);                          // 顶/底
    }
    uv.needsUpdate = true;
    return new THREE.Mesh(geo, [sideMat, sideMat, topMat, topMat, sideMat, sideMat]);
  }
  function bFacadeMat(W, b, rearr) {
    var name = FAC_TEX[b.style] + (b.winMis ? '_mis' : '') + (rearr ? '_b' : '');
    if (b.winMis && b.style === 2) name = 'fac_conc_mis' + (rearr ? '_b' : ''); // panel 无 mis 版，借 conc
    return W.mat(name);
  }

  /* 远楼重排（明确事件时）：只换玩家 55m 外远楼的立面窗光材质，不动几何/碰撞，
   * 不闪烁眼前、不穿过玩家、不困玩家。材质走 W.mat 缓存，无泄漏。 */
  function applyRearr(W, L) {
    var P = BR.Player;
    if (!P || !P.pos) return;
    for (var i = 0; i < L.bldMeshes.length; i++) {
      var rec = L.bldMeshes[i], b = rec.b;
      if (!rec.meshes.length) continue;
      var cx = BR.tileCX((b.x0 + b.x1) / 2), cz = BR.tileCZ((b.y0 + b.y1) / 2);
      if (Math.hypot(cx - P.pos.x, cz - P.pos.z) < 55) continue; // 玩家不可见区才动
      var alt = bFacadeMat(W, b, true);
      for (var j = 0; j < rec.meshes.length; j++) {
        var m = rec.meshes[j];
        if (!m || !m.parent) continue; // 已卸载的 chunk 跳过（重载时按 L.rearr 规则重建）
        if (Array.isArray(m.material)) m.material = [alt, alt, m.material[2], m.material[3], alt, alt];
        else m.material = alt;
      }
    }
  }

  /* ================= Level 定义 ================= */
  BR.Levels.L11 = {
    name: 'Level 11 ——「无垠城市·混凝土森林」',
    theme: {
      bg: 0x11141b, fogNear: 12, fogFar: 85, ambient: 0x8a90a8, ambInt: 0.55,
      sky: 0x3a4358, ground: 0x1e2026, light: 0xffd9a0, lightInt: 0.8,
      wallH: 3.6, wall: 'fac_conc', floor: 'city_road', ceil: 'ceiling',
      surface: 'concrete', fixtureEvery: 9999, hum: 0.3
    },

    buildContent: function (map, W) {
      var meta = map.meta.l11 || { buildings: [] };
      var L = (W._l11 = { guide: null, megNPC: null, manholes: [], traflites: [], anoDoors: [], rearr: false, bldMeshes: [] });
      var sp = poiList(map, 'spawn')[0];
      var spx = sp ? BR.tileCX(sp.tx) : 0, spz = sp ? BR.tileCZ(sp.ty) : 0;
      // 重排标记：事件里有 l11_rearranged 即进入"重排态"（重进/明确事件后远处立面换窗光）
      for (var ei = 0; ei < W.state.events.length; ei++)
        if (W.state.events[ei].indexOf('l11_rearranged') === 0) { L.rearr = true; break; }

      // 立面纹理允许重复
      ['fac_brick', 'fac_conc', 'fac_panel', 'fac_brick_mis', 'fac_conc_mis',
       'fac_brick_b', 'fac_conc_b', 'fac_panel_b', 'fac_brick_mis_b', 'fac_conc_mis_b', 'roof_top']
        .forEach(function (n) {
          var t = BR.Textures.get(n);
          if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
        });

      // 开放天空
      for (var ty = 0; ty < map.h; ty++)
        for (var tx = 0; tx < map.w; tx++)
          if (map.tiles[ty * map.w + tx] === 1) W.setOpenCeil(tx, ty);

      /* ---------- 建筑 ---------- */
      var buildings = meta.buildings;
      var bById = {};
      buildings.forEach(function (b) { bById[b.id] = b; });
      // 远楼判定（重排只动 60m 外、雾里的楼）
      function isFar(b) {
        var cx = BR.tileCX((b.x0 + b.x1) / 2), cz = BR.tileCZ((b.y0 + b.y1) / 2);
        return Math.hypot(cx - spx, cz - spz) > 60;
      }
      // 建筑包围盒可能含巷道雕刻出的开放 tile：递归切除开放段，只渲染实心子矩形。
      // 可进入建筑不切（开放 tile 是中空内院）。纯渲染期，不影响 gen/RNG/测试。
      function splitBld(b) {
        if (b.enterable || b.stub) return [b];
        function isOpen(x, y) { return map.tiles[y * map.w + x] === 1; }
        var out = [];
        (function rec(x0, y0, x1, y1) {
          var fx = -1, fy = -1;
          outer:
          for (var y = y0; y <= y1; y++)
            for (var x = x0; x <= x1; x++)
              if (isOpen(x, y)) { fx = x; fy = y; break outer; }
          if (fx < 0) { out.push({ x0: x0, y0: y0, x1: x1, y1: y1 }); return; }
          var xL = fx, xR = fx;
          while (xL - 1 >= x0 && isOpen(xL - 1, fy)) xL--;
          while (xR + 1 <= x1 && isOpen(xR + 1, fy)) xR++;
          var yT = fy, yB = fy;
          while (yT - 1 >= y0 && isOpen(fx, yT - 1)) yT--;
          while (yB + 1 <= y1 && isOpen(fx, yB + 1)) yB++;
          if ((xR - xL) >= (yB - yT)) {
            if (fy > y0) rec(x0, y0, x1, fy - 1);
            if (fy < y1) rec(x0, fy + 1, x1, y1);
            if (xL > x0) rec(x0, fy, xL - 1, fy);
            if (xR < x1) rec(xR + 1, fy, x1, fy);
          } else {
            if (fx > x0) rec(x0, y0, fx - 1, y1);
            if (fx < x1) rec(fx + 1, y0, x1, y1);
            if (yT > y0) rec(fx, y0, fx, yT - 1);
            if (yB < y1) rec(fx, yB + 1, fx, y1);
          }
        })(b.x0, b.y0, b.x1, b.y1);
        return out.filter(function (r) { return r.x0 <= r.x1 && r.y0 <= r.y1; })
          .map(function (r) {
            // 子块继承原建筑属性
            return { id: b.id + '_' + r.x0 + '_' + r.y0, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
              h: b.h, style: b.style, setback: b.setback, winMis: b.winMis,
              enterable: b.enterable, stub: b.stub, anomalyDoor: b.anomalyDoor };
          });
      }
      buildings.forEach(function (b) {
        var parts = splitBld(b);
        // 全部建筑 tile 跳过默认墙体渲染（碰撞仍走 tile）；只跳实心子块
        parts.forEach(function (pb) {
          for (var yy = pb.y0; yy <= pb.y1; yy++)
            for (var xx = pb.x0; xx <= pb.x1; xx++) W.skipWall(xx, yy);
        });
        var atx = (b.x0 + b.x1) >> 1, aty = (b.y0 + b.y1) >> 1;
        W.addChunkContent(atx, aty, function (group) {
          var rearr = L.rearr && isFar(b); // 重排只影响远楼窗光，不动几何/碰撞
          var sideMat = bFacadeMat(W, b, rearr), topMat = W.mat('roof_top');
          // 重排登记：异常门事件时只换玩家 55m 外远楼的立面窗光（不可见区，不动几何/碰撞）
          var rec = b.enterable ? null : { b: b, meshes: [] };
          var prng = hashRng('l11roof:' + map.seed + ':' + b.id);
          parts.forEach(function (pb, pIdx) {
            var wT = pb.x0 <= pb.x1 ? (pb.x1 - pb.x0 + 1) : 1, dT = pb.y0 <= pb.y1 ? (pb.y1 - pb.y0 + 1) : 1;
            var cx = BR.tileCX((pb.x0 + pb.x1) / 2), cz = BR.tileCZ((pb.y0 + pb.y1) / 2);
            if (pb.stub) { // 碎块：矮混凝土护栏
              var bar = facadeBox(W, wT, 1.2, dT, W.mat('fac_conc'), topMat);
              bar.position.set(cx, 0.6, cz); W.reg(group, bar);
              rec.meshes.push(bar);
              return;
            }
            // 接触阴影：楼底一圈暗色
            var sh = new THREE.Mesh(new THREE.PlaneGeometry((wT + 1.2) * T, (dT + 1.2) * T),
              new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
            sh.rotation.x = -Math.PI / 2; sh.position.set(cx, 0.02, cz); W.reg(group, sh);

            if (pb.enterable) buildEnterable(W, group, pb, sideMat, topMat, cx, cz, wT, dT);
            else {
              if (pb.setback) { // 退台：下部 62% 高全占地，上部收进 1 格
                var h1 = pb.h * 0.62, h2 = pb.h - h1;
                var lo = facadeBox(W, wT, h1, dT, sideMat, topMat);
                lo.position.set(cx, h1 / 2, cz); W.reg(group, lo);
                var up = facadeBox(W, Math.max(1, wT - 2), h2, Math.max(1, dT - 2), sideMat, topMat);
                up.position.set(cx, h1 + h2 / 2, cz); W.reg(group, up);
                rec.meshes.push(lo, up);
              } else {
                var box = facadeBox(W, wT, pb.h, dT, sideMat, topMat);
                box.position.set(cx, pb.h / 2, cz); W.reg(group, box);
                rec.meshes.push(box);
              }
            }
            // 楼顶小品：水箱 / 天线（偶发；只在最大子块放，避免重复）
            if (pIdx === 0) {
              if (!pb.stub && prng.chance(0.35)) {
                var tank = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.7, 10),
                  new THREE.MeshLambertMaterial({ color: 0x3f434a }));
                tank.position.set(cx + (prng.next() - 0.5) * wT * T * 0.4, pb.h + 0.85,
                  cz + (prng.next() - 0.5) * dT * T * 0.4);
                W.reg(group, tank);
              }
              if (!pb.stub && pb.h >= 20 && prng.chance(0.4)) {
                var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6),
                  new THREE.MeshLambertMaterial({ color: 0x2c2f35 }));
                ant.position.set(cx, pb.h + 2.5, cz); W.reg(group, ant);
                var tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6),
                  new THREE.MeshBasicMaterial({ color: 0xff4444 }));
                tip.position.set(cx, pb.h + 5, cz); W.reg(group, tip);
              }
              // 明确关闭的入口（链条封门，纯视觉，无交互）
              if (!pb.enterable && !pb.anomalyDoor && prng.chance(0.45)) buildShutDoor(W, group, pb, prng, map);
            }
          });
          if (rec) L.bldMeshes.push(rec);
        });
      });

  /* 可进入建筑：空心围合（4 面墙 + 门洞），内部有补给意义 */
  function buildEnterable(W, group, b, sideMat, topMat, cx, cz, wT, dT) {
    var e = b.enterable, th = 0.4;
    var x0w = BR.tileCX(b.x0) - T / 2, x1w = BR.tileCX(b.x1) + T / 2;
    var z0w = BR.tileCZ(b.y0) - T / 2, z1w = BR.tileCZ(b.y1) + T / 2;
    function wallSeg(w, h, d, x, y, z) {
      var m = facadeBox(W, Math.max(0.2, w / T), h, Math.max(0.2, d / T), sideMat, topMat);
      m.position.set(x, y, z); W.reg(group, m); return m;
    }
    var H = Math.min(b.h, 9); // 室内只建底层 9m（上部体量用实墙封顶视觉）
    // 门在哪面
    var doorWX = BR.tileCX(e.doorTx), doorWZ = BR.tileCZ(e.doorTy);
    if (e.outDz !== 0) { // 南北面开门
      var zw = e.outDz < 0 ? z0w : z1w;
      var segs = [[x0w, doorWX - 0.7], [doorWX + 0.7, x1w]];
      segs.forEach(function (s) {
        if (s[1] - s[0] > 0.3) wallSeg(s[1] - s[0], H, th, (s[0] + s[1]) / 2, H / 2, zw);
      });
      wallSeg(x1w - x0w, H, th, cx, H / 2, e.outDz < 0 ? z1w : z0w); // 对面整墙
      wallSeg(th, H, z1w - z0w, x0w, H / 2, cz);
      wallSeg(th, H, z1w - z0w, x1w, H / 2, cz);
      // 门楣 + 敞开的门板
      wallSeg(1.9, 0.5, th, doorWX, 2.45, zw);
      var panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 1.15),
        new THREE.MeshLambertMaterial({ color: 0x4a4238 }));
      panel.position.set(doorWX - 0.62, 1.1, zw + e.outDz * 0.55);
      panel.rotation.y = 1.1; W.reg(group, panel);
    } else { // 东西面开门
      var xw = e.outDx < 0 ? x0w : x1w;
      var segs2 = [[z0w, doorWZ - 0.7], [doorWZ + 0.7, z1w]];
      segs2.forEach(function (s) {
        if (s[1] - s[0] > 0.3) wallSeg(th, H, s[1] - s[0], xw, H / 2, (s[0] + s[1]) / 2);
      });
      wallSeg(th, H, z1w - z0w, e.outDx < 0 ? x1w : x0w, H / 2, cz);
      wallSeg(x1w - x0w, H, th, cx, H / 2, z0w);
      wallSeg(x1w - x0w, H, th, cx, H / 2, z1w);
      wallSeg(th, 0.5, 1.9, xw, 2.45, doorWZ);
      var panel2 = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.2, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x4a4238 }));
      panel2.position.set(xw + e.outDx * 0.55, 1.1, doorWZ - 0.62);
      panel2.rotation.y = 1.1; W.reg(group, panel2);
    }
    // 室内顶（3m 暗顶）+ 灯泡假发光
    var ceil = new THREE.Mesh(new THREE.PlaneGeometry((b.x1 - b.x0) * T, (b.y1 - b.y0) * T),
      new THREE.MeshLambertMaterial({ color: 0x1c1e22 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, 3.0, cz); W.reg(group, ceil);
    var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    bulb.position.set(cx, 2.85, cz); W.reg(group, bulb);
    // 上部体量（视觉封顶，不可上）
    var cap = facadeBox(W, wT, Math.max(1, b.h - H), dT, sideMat, topMat);
    cap.position.set(cx, H + Math.max(1, b.h - H) / 2, cz); W.reg(group, cap);
    // 室内意义：补给箱 + 字条（直接建，不走 POI）
    var itx = (e.ix0 + e.ix1) >> 1, itz = (e.iy0 + e.iy1) >> 1;
    addCrate(W, itx, itz, 'almond', 'in' + b.id);
    addNote(W, e.ix0, e.iy0, '住户的字条',
      '这栋楼里曾经住过人。现在只剩我偶尔回来拿点东西。\n\n门别关死——关死了，就再也打不开了。', 'in' + b.id);
  }

  /* 明确关闭的入口：链条封门（纯视觉，无交互——不许"可交互却无效果"） */
  function buildShutDoor(W, group, b, prng, map) {
    var sides = [];
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(function (d) {
      var tx = d[0] === 0 ? ((b.x0 + b.x1) >> 1) : (d[0] < 0 ? b.x0 : b.x1);
      var ty = d[1] === 0 ? ((b.y0 + b.y1) >> 1) : (d[1] < 0 ? b.y0 : b.y1);
      if (map.tiles[ty * map.w + tx] !== 0) return;
      var ox = tx + d[0], oy = ty + d[1];
      if (ox < 0 || oy < 0 || ox >= map.w || oy >= map.h) return;
      if (map.tiles[oy * map.w + ox] === 1) sides.push({ d: d, tx: tx, ty: ty });
    });
    if (!sides.length) return;
    var s = prng.pick(sides), d = s.d;
    var px = BR.tileCX(s.tx) + d[0] * (T / 2 + 0.04), pz = BR.tileCZ(s.ty) + d[1] * (T / 2 + 0.04);
    var door = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.3),
      new THREE.MeshLambertMaterial({ map: BR.Textures.get('door_shut') }));
    door.position.set(px, 1.15, pz);
    door.rotation.y = Math.atan2(d[0], d[1]);
    W.reg(group, door);
  }

      /* ---------- 广场：干涸的喷泉（出生点，相对安全） ---------- */
      poiList(map, 'plaza').forEach(function (p) {
        var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var basin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.7, 14),
            new THREE.MeshLambertMaterial({ color: 0x5a5e64 }));
          basin.position.set(cx, 0.35, cz); W.reg(group, basin);
          var col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 10),
            new THREE.MeshLambertMaterial({ color: 0x6a6e74 }));
          col.position.set(cx, 1.2, cz); W.reg(group, col);
          // 干涸：没有水，只有裂缝和灰
          var Li = new THREE.PointLight(0xffc37a, 1.0, 18, 2);
          Li.position.set(cx, 3.2, cz); W.reg(group, Li);
        });
        addNote(W, p.tx, p.ty, '褪色的城市导览图',
          '【原著依据】按后室 Fandom 记载：Level 11「无垠城市」是一座荒凉无序的混凝土森林；' +
          'Fandom Level 2 词条 Entrances 记载："Removing a manhole cover in Level 11 and descending downward"（掀开 Level 11 的井盖向下）可进入 Level 2。\n\n' +
          '【游戏改编】本作中"M.E.G. 前哨对话""流浪者""地铁→L2"等为游戏性改编，并非原著事实。' +
          '地铁年久失修，真正可靠的下行路线是街上那口能掀开的井盖。\n\n——开发组', 'meta');
      });

      /* ---------- MEG 前哨（孤立个例，非安全基地网络） ---------- */
      poiList(map, 'meg_post').forEach(function (p) {
        var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
        var pathTiles = (p.data && p.data.path) || null;
        W.addChunkContent(p.tx, p.ty, function (group, chunk) {
          var n = wallNormal(W, p.tx, p.ty);
          var awn = new THREE.Group();
          var cloth = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 2.6),
            new THREE.MeshLambertMaterial({ color: 0x6a6a5a }));
          cloth.position.y = 2.5; awn.add(cloth);
          [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]].forEach(function (o) {
            var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8),
              new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
            pole.position.set(o[0], 1.25, o[1]); awn.add(pole);
          });
          var table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.9),
            new THREE.MeshLambertMaterial({ color: 0x4a4035 }));
          table.position.y = 0.8; awn.add(table);
          awn.position.set(cx + n.x * 0.4, 0, cz + n.z * 0.4);
          W.reg(group, awn);
          var flagTex = signTexture(['M.E.G.'], 'rgba(255,200,60,0.95)');
          var flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85),
            new THREE.MeshBasicMaterial({ map: flagTex }));
          flag._ownMat = true;
          flag.position.set(cx + n.x * 1.2, 2.2, cz + n.z * 1.2);
          flag.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, flag);
          var Li = new THREE.PointLight(0xffe0a0, 1.1, 16, 2);
          Li.position.set(cx, 2.6, cz); W.reg(group, Li);

          var npc = makeNPC(0x2a3a5a, 0xd8b090, false);
          var band = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.12, 10),
            new THREE.MeshBasicMaterial({ color: 0xff8c1a }));
          band.position.y = 1.15; npc.group.add(band);
          npc.group.position.set(cx - n.x * 0.6, 0, cz - n.z * 0.6);
          npc.group.rotation.y = Math.atan2(-n.x, -n.z);
          W.reg(group, npc.group);
          L.megNPC = {
            group: npc.group, body: npc.body,
            home: npc.group.position.clone(), homeYaw: npc.group.rotation.y,
            pathTiles: pathTiles
          };

          W.addInteractable({
            id: 'npc_meg', kind: 'npc_meg', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [npc.body, npc.head], pos: npc.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), radius: 3.2,
            prompt: function () {
              var ev = W.state.events;
              if (ev.indexOf('l11_meg_talk') < 0) return '与 M.E.G. 队员交谈';
              if (ev.indexOf('l11_meg_guide') < 0 && pathTiles) return '请队员带你走一段（往地铁方向）';
              return '请求前往 Level 1 的指引';
            },
            canUse: function () { return !L.guide; },
            use: function () {
              var ev = W.state.events;
              if (ev.indexOf('l11_meg_talk') < 0) {
                BR.Game.inv.almond = (BR.Game.inv.almond || 0) + 1;
                BR.Game.inv.bandage = (BR.Game.inv.bandage || 0) + 1;
                BR.UI.updateInv();
                BR.Audio.pickup();
                var P = BR.Player, line;
                if (P.hp < 50) line = '你伤得不轻（生命 ' + Math.round(P.hp) + '）。听我的：去 Level 1，长走廊尽头有医疗点，别硬撑。';
                else if (P.sanity < 40) line = '你眼神不太对（理智 ' + Math.round(P.sanity) + '）。回 Level 0 的马尼拉房间歇会儿，那儿安全。';
                else line = '你状态不错。想继续走就去坐地铁——入口在城市另一头，顺路的话我可以带你走一段。';
                BR.UI.showNote('M.E.G. 前哨队员',
                  '流浪者，欢迎来到无垠城市。这里是 M.E.G. 的前哨站，相对安全。\n\n' +
                  '附近已知风险：\n· 地铁方向偶有薄墙，别贴着墙挤。\n· 别跟流浪者进那条医院走廊——那是 Level ! 的地界，进去就听见警报。\n\n' +
                  '拿着这些补给（杏仁水×1、绷带×1），别客气。\n\n路线建议：\n' + line);
                ev.push('l11_meg_talk');
                BR.bus.emit('event', { id: 'l11_meg_talk' });
                BR.UI.toast('获得补给：杏仁水×1、绷带×1');
                return;
              }
              if (ev.indexOf('l11_meg_guide') < 0 && pathTiles && L.megNPC && L.megNPC.group.parent) {
                var wp = pathTiles.map(function (t) { return { x: BR.tileCX(t[0]), z: BR.tileCZ(t[1]) }; });
                L.guide = { path: wp, i: 1, dir: 1, back: false };
                BR.UI.toast('队员："跟上，送你一程。"（跟着他走约 20 米）');
                BR.Audio.checkpoint();
                return;
              }
              BR.UI.showNote('M.E.G. 的指引',
                '沿主街一直往北走，看到混凝土长廊就进去——那是回 Level 1 的路。\n\n路上别碰墙上颜色不对的地方。\n\n保重，流浪者。');
              BR.UI.toast('你沿着队员指的方向离开前哨……');
              travelTo('L1', 'walk');
            }
          });
        });
      });

      /* ---------- 流浪者营地 ---------- */
      poiList(map, 'wanderer_camp').forEach(function (p) {
        var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var fire = new THREE.Group();
          for (var i = 0; i < 7; i++) {
            var st = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6),
              new THREE.MeshLambertMaterial({ color: 0x5a5a5a }));
            var a = i / 7 * Math.PI * 2;
            st.position.set(Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.7); fire.add(st);
          }
          var flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 8),
            new THREE.MeshBasicMaterial({ color: 0xff9a2a }));
          flame.position.y = 0.55; fire.add(flame);
          fire.position.set(cx, 0, cz);
          W.reg(group, fire);
          var Li = new THREE.PointLight(0xff9a4a, 1.2, 14, 2);
          Li.position.set(cx, 1.4, cz); W.reg(group, Li);
          var tent = new THREE.Group();
          var c1 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.0),
            new THREE.MeshLambertMaterial({ color: 0x4a4438, side: THREE.DoubleSide }));
          c1.position.set(0, 0.9, -0.6); c1.rotation.x = 0.6; tent.add(c1);
          var c2 = c1.clone(); c2.position.z = 0.6; c2.rotation.x = -0.6; tent.add(c2);
          tent.position.set(cx + 1.8, 0, cz + 0.6);
          W.reg(group, tent);

          var npc = makeNPC(0x5a4a3a, 0xc8a080, true);
          npc.group.position.set(cx - 1.6, 0, cz - 0.4);
          npc.group.rotation.y = Math.atan2(1.6, 0.4);
          W.reg(group, npc.group);

          W.addInteractable({
            id: 'npc_wanderer', kind: 'npc_wanderer', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [npc.body, npc.head], pos: npc.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), radius: 3.2,
            prompt: function () {
              var ev = W.state.events;
              if (ev.indexOf('l11_w_heard') < 0) return '与流浪者交谈';
              if (ev.indexOf('l11_w_trade') < 0 && (BR.Game.inv.bandage || 0) > 0) return '用 1 卷绷带换一条路线信息';
              return '顺着流浪者指的路离开（→ Level !）';
            },
            canUse: function () { return true; },
            use: function () {
              var ev = W.state.events;
              if (ev.indexOf('l11_w_heard') < 0) {
                BR.UI.showNote('流浪者',
                  '又一个掉进来的？坐，烤烤火。\n\n' +
                  '我在这儿住了三年，告诉你几件事：\n' +
                  '· 城里没有昼夜，但城郊那座城堡不对劲——进去的人没几个回来。\n' +
                  '· 城郊有辆老式汽车，坐它能到 Level !（警报响的时候千万别上车）。\n' +
                  '· 想去下层？找街上能掀开的井盖——掀开往下，就是 Level 2（老手册里写的）。\n\n' +
                  '——营地后面那条小路一直走，翻过两道街，就是城郊。想去 Level ! 的话，我指给你看。');
                ev.push('l11_w_heard');
                BR.bus.emit('event', { id: 'l11_w_heard' });
                return;
              }
              if (ev.indexOf('l11_w_trade') < 0 && (BR.Game.inv.bandage || 0) > 0) {
                BR.Game.inv.bandage--;
                BR.UI.updateInv();
                var subs = poiList(map, 'manhole_exit')[0];
                var dir = subs ? compass(subs.tx - p.tx, subs.ty - p.ty) : '东南';
                var dist = subs ? Math.round(Math.hypot(subs.tx - p.tx, subs.ty - p.ty) * T) : 0;
                BR.Audio.paper();
                BR.UI.toast('流浪者："那口能下去的井盖在' + dir + '方向，约 ' + dist + ' 米，盖子边上有撬过的痕迹，别认错。"');
                ev.push('l11_w_trade');
                BR.bus.emit('event', { id: 'l11_w_trade' });
                return;
              }
              BR.UI.toast('你沿着流浪者指的小路走出城市……');
              travelTo('bang', 'walk');
            }
          });
        });
      });

      /* ---------- 地铁入口（→L2，游戏改编路线，保留） ---------- */
      poiList(map, 'subway').forEach(function (p) {
        var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var n = wallNormal(W, p.tx, p.ty);
          var stairs = new THREE.Group();
          var swMat = new THREE.MeshLambertMaterial({ color: 0x23262c });
          var stMat = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
          [-1.25, 1.25].forEach(function (sx) {
            var sw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.7, 3.6), swMat);
            sw.position.set(sx, 0.85, 0); stairs.add(sw);
          });
          var bw2 = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.2, 0.18), swMat);
          bw2.position.set(0, 1.1, -1.75); stairs.add(bw2);
          for (var i = 0; i < 7; i++) {
            var stp = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 0.5), stMat);
            stp.position.set(0, 1.02 - i * 0.16, -1.25 + i * 0.48);
            stairs.add(stp);
          }
          var pit = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.7),
            new THREE.MeshBasicMaterial({ color: 0x040506 }));
          pit.rotation.x = -Math.PI / 2; pit.position.set(0, 0.03, 1.7); stairs.add(pit);
          stairs.position.set(cx, 0, cz);
          stairs.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, stairs);
          var st2 = signTexture(['SUBWAY', '▼ 地铁'], 'rgba(90,220,255,0.95)');
          var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95),
            new THREE.MeshBasicMaterial({ map: st2 }));
          sign._ownMat = true;
          sign.position.set(cx + n.x * 1.3, 2.6, cz + n.z * 1.3);
          sign.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, sign);
          var Li = new THREE.PointLight(0x6ad2ff, 0.9, 12, 2);
          Li.position.set(cx, 2.4, cz); W.reg(group, Li);
          W.addInteractable({
            id: 'subway_exit', kind: 'subway', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [sign], pos: new THREE.Vector3(cx, 1.4, cz), radius: 3.0,
            prompt: function () { return '走下地铁楼梯（深入地铁站）'; },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.doorCreak();
              BR.UI.toast('你走下楼梯，身后的灯光一盏盏熄灭……');
              travelTo('L2', 'walk');
            }
          });
        });
      });

      /* ---------- 商店 ---------- */
      var SHOP_NAMES = ['24小时便利店', '旧书店', '杏仁水专卖店', '五金修理铺', '流浪者杂货'];
      poiList(map, 'shop').forEach(function (p) {
        var idx = p.data.idx || 0;
        var name = SHOP_NAMES[idx % SHOP_NAMES.length];
        W.addChunkContent(p.tx, p.ty, function (group) {
          var n = wallNormal(W, p.tx, p.ty);
          var sm = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9),
            new THREE.MeshBasicMaterial({ map: BR.Textures.get('shop_sign') }));
          sm._ownMat = true;
          sm.position.set(BR.tileCX(p.tx) + n.x * 1.2, 2.5, BR.tileCZ(p.ty) + n.z * 1.2);
          sm.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, sm);
          var awn = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 1.1),
            new THREE.MeshLambertMaterial({ color: [0x5a2a2a, 0x2a4a5a, 0x4a4a2a, 0x2a4a2a, 0x3a2a4a][idx % 5] }));
          awn.position.set(BR.tileCX(p.tx) + n.x * 0.8, 2.0, BR.tileCZ(p.ty) + n.z * 0.8);
          awn.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, awn);
          W.addInteractable({
            id: 'shop_' + p.tx + '_' + p.ty, kind: 'shop_sign', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [sm], pos: sm.position.clone(), radius: 2.8,
            prompt: function () { return '看店招牌：' + name; },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.paper();
              var body = '「' + name + '」\n\n';
              if (idx % SHOP_NAMES.length === 0)
                body += '店主在纸条上写：想去下层别指望地铁——找街上能掀开的井盖，盖子边有撬痕的那口。\n\n货架上还有免费样品，自己拿。';
              else if (idx % SHOP_NAMES.length === 2)
                body += '杏仁水论瓶卖——可惜你没钱。店主看你可怜，留了一瓶样品在门口箱子里。';
              else
                body += '门虚掩着，里面没人，只有货架和灰。门口箱子里或许还有剩的东西。';
              BR.UI.showNote(name, body);
            }
          });
        });
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d = 0; d < 4; d++) {
          var nx = p.tx + dirs[d][0], ny = p.ty + dirs[d][1];
          if (W.tile(nx, ny) === 1 && !(nx === p.tx && ny === p.ty)) {
            addCrate(W, nx, ny, p.data.item || 'almond', 'shop' + idx);
            break;
          }
        }
      });

      /* ---------- 路灯 ---------- */
      poiList(map, 'streetlamp').forEach(function (p) {
        W.addChunkContent(p.tx, p.ty, function (group, chunk) {
          var x = BR.tileCX(p.tx), z = BR.tileCZ(p.ty);
          var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.10, 4.4, 8),
            new THREE.MeshLambertMaterial({ color: 0x2c3138 }));
          pole.position.set(x, 2.2, z); W.reg(group, pole);
          var arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.08),
            new THREE.MeshLambertMaterial({ color: 0x2c3138 }));
          arm.position.set(x + 0.5, 4.38, z); W.reg(group, arm);
          var head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.24),
            new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
          head.position.set(x + 0.95, 4.32, z); W.reg(group, head);
          var cone = new THREE.Mesh(new THREE.ConeGeometry(1.35, 4.1, 12, 1, true),
            new THREE.MeshBasicMaterial({
              color: 0xffd9a0, transparent: true, opacity: 0.10,
              side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
            }));
          cone.position.set(x + 0.95, 2.05, z); W.reg(group, cone);
          chunk.fixtures.push({ x: x + 0.95, y: 4.1, z: z, phase: 0, flicker: false });
        });
      });

      /* ---------- 井盖 ---------- */
      // 普通井盖：纯装饰，无交互，走过不传送
      poiList(map, 'manhole').forEach(function (p) {
        W.addChunkContent(p.tx, p.ty, function (group) {
          var prng = hashRng('l11mh:' + map.seed + ':' + p.tx + '_' + p.ty);
          var disc = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20),
            new THREE.MeshLambertMaterial({ map: BR.Textures.get('manhole_lid') }));
          disc.rotation.x = -Math.PI / 2;
          disc.rotation.z = prng.next() * Math.PI * 2;
          disc._ownMat = true;
          disc.position.set(BR.tileCX(p.tx), 0.02, BR.tileCZ(p.ty));
          W.reg(group, disc);
        });
      });
      // 特定井盖 → L2（原著连接）：开启动画 + 向下空间 + 进入判定
      poiList(map, 'manhole_exit').forEach(function (p) {
        var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
        var MH = { open: false, opening: 0, descending: false, lid: null, cx: cx, cz: cz };
        L.manholes.push(MH);
        if (W.state.events.indexOf('l11_manhole_open') >= 0) { MH.open = true; MH.opening = 1; }
        W.addChunkContent(p.tx, p.ty, function (group) {
          // 井圈
          var rim = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 20),
            new THREE.MeshLambertMaterial({ color: 0x1e2024 }));
          rim.rotation.x = -Math.PI / 2; rim.position.set(cx, 0.025, cz); W.reg(group, rim);
          // 井盖（可掀开）
          var lid = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.09, 20),
            new THREE.MeshLambertMaterial({ map: BR.Textures.get('manhole_lid') }));
          lid._ownMat = true;
          lid.position.set(cx, 0.055, cz); W.reg(group, lid);
          MH.lid = lid;
          if (MH.open) { lid.position.set(cx + 0.95, 0.055, cz); lid.rotation.z = 0.5; }
          // 向下空间：井筒（内壁）+ 梯子 + 底部微光
          var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 3.2, 14, 1, true),
            new THREE.MeshBasicMaterial({ color: 0x0a0c0e, side: THREE.BackSide }));
          shaft.position.set(cx, -1.6, cz); W.reg(group, shaft);
          var rungG = new THREE.BoxGeometry(0.4, 0.05, 0.06);
          var rungM = new THREE.MeshLambertMaterial({ color: 0x4a4d52 });
          for (var ri = 0; ri < 6; ri++) {
            var rung = new THREE.Mesh(rungG, rungM);
            rung.position.set(cx, -0.4 - ri * 0.45, cz - 0.42); W.reg(group, rung);
          }
          var glow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12),
            new THREE.MeshBasicMaterial({ color: 0x1a3a2a }));
          glow.rotation.x = -Math.PI / 2; glow.position.set(cx, -3.1, cz); W.reg(group, glow);
          W.addInteractable({
            id: 'manhole_exit', kind: 'manhole_exit', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [lid], pos: new THREE.Vector3(cx, 0.5, cz), radius: 3.2,
            prompt: function () {
              if (MH.descending) return '……';
              return MH.open ? '爬下井道（通往下层）' : '掀开井盖（盖边有撬过的痕迹）';
            },
            canUse: function () { return !MH.descending; },
            use: function () {
              if (MH.descending) return;
              if (!MH.open) {
                MH.opening = 0.0001; // tick 里做开启动画
                BR.Audio.doorCreak();
                BR.UI.toast('井盖被掀开了——下面是垂直的井筒，有梯子。', 2600);
                if (W.state.events.indexOf('l11_manhole_open') < 0) {
                  W.state.events.push('l11_manhole_open');
                  BR.bus.emit('event', { id: 'l11_manhole_open' });
                }
                return;
              }
              // 进入判定：盖已开 → 下井
              MH.descending = true;
              BR.Input.setLocked(true); // 下降过程锁定输入（碰撞语义：玩家处于井筒内）
              BR.Audio.doorCreak();
              BR.UI.toast('你顺着梯子爬进黑暗，井盖在头顶缓缓合拢……', 2200);
              setTimeout(function () {
                var done = travelManholeL2();
                // travelTo busy（返回 false）时回退：解锁 + 允许重试，不把玩家锁死在井里
                if (done && typeof done.then === 'function') done.then(function (ok) {
                  if (!ok) {
                    MH.descending = false;
                    BR.Input.setLocked(false);
                    BR.UI.toast('井筒深处传来一声闷响——这次没能下去，稍后再试。', 2600);
                  }
                });
              }, 900);
            }
          });
        });
      });

      /* ---------- 街角交通灯：无规律变灯，不生成车流 ---------- */
      poiList(map, 'traflite').forEach(function (p, pi) {
        var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
        var TL = { state: 'green', t: 3 + pi * 2.7, cycle: 0, mats: null, seed: BR.hashSeed('l11tl:' + map.seed + ':' + pi) };
        L.traflites.push(TL);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 8),
            new THREE.MeshLambertMaterial({ color: 0x24282e }));
          pole.position.set(cx, 2.6, cz); W.reg(group, pole);
          var headBox = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.25, 0.44),
            new THREE.MeshLambertMaterial({ color: 0x14161a }));
          headBox.position.set(cx, 4.6, cz); W.reg(group, headBox);
          var cols = [0xff3b30, 0xffcc00, 0x34c759], mats = [];
          for (var li = 0; li < 3; li++) {
            var lamp = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12),
              new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
            lamp._ownMat = true;
            lamp.position.set(cx, 5.0 - li * 0.38, cz + 0.23);
            W.reg(group, lamp);
            mats.push({ mesh: lamp, color: cols[li] });
          }
          TL.mats = mats;
          applyTl(TL);
        });
      });
      function applyTl(TL) {
        if (!TL.mats) return;
        var on = TL.state === 'red' ? 0 : (TL.state === 'yellow' ? 1 : 2);
        TL.mats.forEach(function (m, i) {
          m.mesh.material.color.setHex(i === on ? m.color : 0x141414);
        });
      }
      L._applyTl = applyTl;

      /* ---------- 空间异常 ---------- */
      // 异常门：门后短走廊 / 砖墙（可观察，无传送）
      poiList(map, 'anomaly_door').forEach(function (p) {
        var b = null;
        for (var bi = 0; bi < buildings.length; bi++) if (buildings[bi].id === p.data.bld) b = buildings[bi];
        if (!b || !b.anomalyDoor) return;
        var ad = b.anomalyDoor, kind = p.data.kind || 'niche';
        var fx = BR.tileCX(ad.tx) + ad.nx * (T / 2 + 0.04), fz = BR.tileCZ(ad.ty) + ad.nz * (T / 2 + 0.04);
        var AD = { open: false, anim: 0, door: null };
        L.anoDoors.push(AD);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var yaw = Math.atan2(ad.nx, ad.nz);
          // 门框
          var fm = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
          [[-0.68], [0.68]].forEach(function (o) {
            var post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), fm);
            post.position.set(fx + Math.cos(yaw) * o[0], 1.25, fz - Math.sin(yaw) * o[0]);
            W.reg(group, post);
          });
          var lintel = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.18, 0.18), fm);
          lintel.position.set(fx, 2.5, fz); lintel.rotation.y = yaw; W.reg(group, lintel);
          // 门后：砖墙 或 1 米短走廊
          if (kind === 'bricked') {
            var bw = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.3),
              new THREE.MeshLambertMaterial({ map: BR.Textures.get('door_shut') }));
            bw.position.set(fx + ad.nx * 0.5, 1.15, fz + ad.nz * 0.5);
            bw.rotation.y = yaw; W.reg(group, bw);
          } else {
            var corr = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 1.0),
              new THREE.MeshLambertMaterial({ color: 0x0c0d10, side: THREE.BackSide }));
            corr.position.set(fx + ad.nx * 0.5, 1.2, fz + ad.nz * 0.5);
            corr.rotation.y = yaw; W.reg(group, corr);
            var end = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4),
              new THREE.MeshLambertMaterial({ map: BR.Textures.get('door_shut') }));
            end.position.set(fx + ad.nx * 1.0, 1.2, fz + ad.nz * 1.0);
            end.rotation.y = yaw; W.reg(group, end);
          }
          // 门板（可推开）
          var door = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.3),
            new THREE.MeshLambertMaterial({ map: BR.Textures.get('door_anomaly'), side: THREE.DoubleSide }));
          var hinge = new THREE.Group();
          hinge.position.set(fx - Math.cos(yaw) * 0.6, 0, fz + Math.sin(yaw) * 0.6);
          door.position.set(0.6, 1.15, 0);
          hinge.add(door); hinge.rotation.y = yaw;
          W.reg(group, hinge);
          AD.door = hinge; AD.baseYaw = yaw;
          W.addInteractable({
            id: 'anomaly_door_' + p.tx + '_' + p.ty, kind: 'anomaly_door', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [door], pos: new THREE.Vector3(fx, 1.3, fz), radius: 3.0,
            prompt: function () { return AD.open ? '这扇门后……' : '推开这扇门（门缝里透着光）'; },
            canUse: function () { return !AD.open; },
            use: function () {
              AD.open = true;
              BR.Audio.doorCreak();
              if (kind === 'bricked')
                BR.UI.toast('门后直接就是一堵砖墙——砌得严严实实，像是刚砌上没多久。', 3200);
              else
                BR.UI.toast('门后只有一条一米深的短走廊，尽头还是砖墙。走廊比门框还窄。', 3200);
              // 明确事件：远处不可见街区的窗光重排（不动几何/碰撞，不困玩家）
              if (W.state.events.indexOf('l11_rearranged') < 0) {
                W.state.events.push('l11_rearranged');
                BR.bus.emit('event', { id: 'l11_rearranged' });
                L.rearr = true;
                applyRearr(W, L); // 真实换窗光：只动玩家 55m 外远楼
                BR.UI.toast('远处的某几栋楼里，有几扇窗户的灯光好像变了。', 3000);
              }
            }
          });
        });
      });
      // 上不去的楼梯：沿立面而上，终点是空白墙面
      poiList(map, 'anomaly_stairs').forEach(function (p) {
        var b2 = null;
        for (var bj = 0; bj < buildings.length; bj++) if (buildings[bj].id === p.data.bld) b2 = buildings[bj];
        if (!b2 || !b2.anomalyStairs) return;
        var asd = b2.anomalyStairs;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var bx = BR.tileCX(asd.tx) + asd.nx * (T / 2 + 0.25), bz = BR.tileCZ(asd.ty) + asd.nz * (T / 2 + 0.25);
          var yaw = Math.atan2(asd.nx, asd.nz);
          var metal = new THREE.MeshLambertMaterial({ color: 0x3a3e45 });
          var g = new THREE.Group();
          var steps = 12, rise = 0.30, run = 0.55;
          for (var si = 0; si < steps; si++) {
            var stp = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, run + 0.06), metal);
            stp.position.set(0, 0.35 + si * rise, -si * run);
            g.add(stp);
          }
          // 扶手
          [[-0.55], [0.55]].forEach(function (o) {
            var rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, steps * run), metal);
            rail.position.set(o[0], 0.35 + steps * rise + 0.85, -steps * run / 2 + run / 2);
            rail.rotation.x = Math.atan2(steps * rise, steps * run);
            g.add(rail);
          });
          // 顶部小平台：正对空白墙面，无门无窗
          var plat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 1.2), metal);
          plat.position.set(0, 0.35 + steps * rise, -steps * run - 0.4);
          g.add(plat);
          g.position.set(bx, 0, bz);
          g.rotation.y = yaw + Math.PI; // 朝向建筑
          W.reg(group, g);
        });
      });

      /* ---------- 街道路牌（细节） ---------- */
      (function () {
        var srng = hashRng('l11sign:' + map.seed);
        var names = ['11TH AVE', 'CONCRETE ST', 'MANHOLE RD', 'ECHO BLVD', 'RUST LANE', 'FOG ST'];
        var cands = [];
        for (var yy = 2; yy < map.h - 2; yy++)
          for (var xx = 2; xx < map.w - 2; xx++)
            if (map.tiles[yy * map.w + xx] === 1) cands.push([xx, yy]);
        var pts = [], guard = 0;
        if (cands.length) pts.push(srng.pick(cands));
        while (pts.length < 6 && guard++ < 200) {
          var c = srng.pick(cands), ok = true;
          for (var i = 0; i < pts.length; i++)
            if (Math.hypot(c[0] - pts[i][0], c[1] - pts[i][1]) < 12) { ok = false; break; }
          if (ok) pts.push(c);
        }
        pts.forEach(function (pt, si) {
          W.addChunkContent(pt[0], pt[1], function (group) {
            var x = BR.tileCX(pt[0]) + 1.1, z = BR.tileCZ(pt[1]) - 1.1;
            var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.0, 8),
              new THREE.MeshLambertMaterial({ color: 0x2c3138 }));
            pole.position.set(x, 1.5, z); W.reg(group, pole);
            var tex = signTexture([names[si % names.length]], 'rgba(120,160,200,0.9)');
            var plate = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65),
              new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
            plate._ownMat = true;
            plate.position.set(x, 2.7, z);
            plate.rotation.y = srng.next() * Math.PI;
            W.reg(group, plate);
          });
        });
      })();

      /* ---------- 废弃汽车剪影（v1.3 细节保留）：纯装饰，无交互，不挡路 ---------- */
      (function () {
        var crng = hashRng('l11car:' + map.seed);
        var cands = [];
        for (var yy = 3; yy < map.h - 3; yy++)
          for (var xx = 3; xx < map.w - 3; xx++) {
            if (map.tiles[yy * map.w + xx] !== 1) continue;
            // 路边：至少一侧是建筑，且前后 2 格都是路（不堵死）
            var side = (map.tiles[yy * map.w + xx + 1] === 0) || (map.tiles[yy * map.w + xx - 1] === 0) ||
                       (map.tiles[(yy + 1) * map.w + xx] === 0) || (map.tiles[(yy - 1) * map.w + xx] === 0);
            if (!side) continue;
            cands.push([xx, yy]);
          }
        var pts = [], guard = 0;
        while (pts.length < 2 && guard++ < 300 && cands.length) {
          var c = crng.pick(cands), ok = true, sideDx = 0, sideDz = 0;
          if (Math.hypot(c[0] - sp.tx, c[1] - sp.ty) < 8) ok = false; // 不挡出生
          // 记下建筑在哪一侧，车贴边停放
          if (ok) {
            if (map.tiles[c[1] * map.w + c[0] + 1] === 0) sideDx = 1;
            else if (map.tiles[c[1] * map.w + c[0] - 1] === 0) sideDx = -1;
            else if (map.tiles[(c[1] + 1) * map.w + c[0]] === 0) sideDz = 1;
            else sideDz = -1;
          }
          for (var i = 0; i < map.pois.length && ok; i++) {
            var p = map.pois[i];
            if (Math.hypot(p.tx - c[0], p.ty - c[1]) < 3) ok = false;
          }
          for (var j = 0; j < pts.length && ok; j++)
            if (Math.hypot(pts[j][0] - c[0], pts[j][1] - c[1]) < 10) ok = false;
          if (ok) pts.push([c[0], c[1], sideDx, sideDz]);
        }
        pts.forEach(function (pt) {
          W.addChunkContent(pt[0], pt[1], function (group) {
            // 贴建筑边停放（路缘 wreck，不占路心）
            var x = BR.tileCX(pt[0]) + pt[2] * 0.75, z = BR.tileCZ(pt[1]) + pt[3] * 0.75;
            var car = new THREE.Group();
            var paint = new THREE.MeshLambertMaterial({ color: [0x3a3f45, 0x4a3a30, 0x2e3a3f][pts.indexOf(pt) % 3] });
            var rust = new THREE.MeshLambertMaterial({ color: 0x4a3826 });
            var bodyM = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.7, 1.6), paint);
            bodyM.position.y = 0.6; car.add(bodyM);
            var cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.58, 1.45), paint);
            cab.position.set(-0.15, 1.2, 0); car.add(cab);
            var glass = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.38, 1.47),
              new THREE.MeshLambertMaterial({ color: 0x0c0e12 }));
            glass.position.set(-0.15, 1.22, 0); car.add(glass);
            var wg = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 10);
            var wm = new THREE.MeshLambertMaterial({ color: 0x141518 });
            [[-1.1, 0.8], [1.1, 0.8], [-1.1, -0.8], [1.1, -0.8]].forEach(function (o) {
              var w = new THREE.Mesh(wg, wm);
              w.rotation.x = Math.PI / 2;
              w.position.set(o[0], 0.34, o[1]); car.add(w);
            });
            // 锈蚀补丁
            var rp = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.06), rust);
            rp.position.set(0.7, 0.65, 0.82); car.add(rp);
            car.position.set(x, 0, z);
            // 车头沿路边方向（平行建筑立面）
            var along = pt[2] !== 0 ? Math.PI / 2 : 0;
            car.rotation.y = along + (crng.next() - 0.5) * 0.25;
            W.reg(group, car);
          });
        });
      })();

      /* ---------- 字条 / 街边补给箱 ---------- */
      var L11_NOTES = [
        ['拾荒者的字条', '城市很大，但别被"无限"骗了——街区就这么多，路都是通的。\n\n记住三个地方：广场、M.E.G. 前哨、那口能下去的井盖。'],
        ['褪色的传单', '无垠城市欢迎你！\n\n本市暂无市长，暂无法律，暂无夜晚——除了城堡那边。\n\n——M.E.G. 城市管理处（自封）'],
        ['潦草的字条', '墙薄的地方别挤！上次有人卡进去，再出来时已经在城另一头了。\n\n——一个好心人']
      ];
      poiList(map, 'note').forEach(function (p, i) {
        var nn = L11_NOTES[i % L11_NOTES.length];
        addNote(W, p.tx, p.ty, nn[0], nn[1], 'street' + i);
      });
      poiList(map, 'crate').forEach(function (p, i) {
        addCrate(W, p.tx, p.ty, (p.data && p.data.item) || 'empty', 'street' + i);
      });

      /* ---------- 薄墙 ---------- */
      BR.buildThinWalls(map, W);

      W.objective = '探索混凝土森林：找到那口能掀开的井盖（→下层），或去地铁站';
    },

    onEnter: function () {
      BR.UI.setObjective(BR.World.objective);
      BR.Audio.setAmbient('L11');
      setTimeout(function () { BR.UI.toast('无垠城市。空无一人的混凝土森林，只有风声和远处的金属呻吟。', 3600); }, 1200);
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player;
      BR.thinWallTick(dt);
      var L = W._l11;
      if (!L) return;
      // 带路 NPC（旧逻辑保留）
      if (L.guide && P && BR.Game.state === 'playing') {
        var npc = L.megNPC;
        if (!npc || !npc.group.parent) { L.guide = null; }
        else {
          var g = L.guide;
          var target = g.path[g.i];
          var dx = target.x - npc.group.position.x, dz = target.z - npc.group.position.z;
          var d = Math.hypot(dx, dz);
          if (d < 0.3) {
            g.i += g.dir;
            if (g.i >= g.path.length || g.i < 0) {
              if (!g.back) {
                g.back = true; g.dir = -1; g.i = Math.max(0, g.path.length - 2);
                BR.UI.toast('队员停下了："就送到这，地铁站往那个方向走，自己小心。"', 3600);
                BR.Audio.checkpoint();
              } else {
                npc.group.position.copy(npc.home);
                npc.group.rotation.y = npc.homeYaw;
                npc.body.position.y = 0.85;
                L.guide = null;
                if (W.state.events.indexOf('l11_meg_guide') < 0) {
                  W.state.events.push('l11_meg_guide');
                  BR.bus.emit('event', { id: 'l11_meg_guide' });
                }
                BR.UI.toast('M.E.G. 队员回到了前哨。');
              }
            } else {
              target = g.path[g.i];
              dx = target.x - npc.group.position.x; dz = target.z - npc.group.position.z;
              d = Math.hypot(dx, dz) || 0.001;
            }
          }
          if (L.guide && d >= 0.3) {
            var step = Math.min(d, 2.2 * dt);
            npc.group.position.x += dx / d * step;
            npc.group.position.z += dz / d * step;
            npc.group.rotation.y = Math.atan2(dx, dz);
            npc.body.position.y = 0.85 + Math.abs(Math.sin(W.time * 9)) * 0.06;
          }
        }
      }
      // 井盖开启动画：盖子滑出 + 翘起
      for (var mi = 0; mi < L.manholes.length; mi++) {
        var MH = L.manholes[mi];
        if (MH.opening > 0 && MH.opening < 1 && MH.lid) {
          MH.opening = Math.min(1, MH.opening + dt * 0.9);
          var e2 = 1 - Math.pow(1 - MH.opening, 2);
          MH.lid.position.set(MH.cx + 0.95 * e2, 0.055, MH.cz);
          MH.lid.rotation.z = 0.5 * e2;
          if (MH.opening >= 1) { MH.open = true; MH.opening = 0; }
        }
      }
      // 异常门推开动画
      for (var ai = 0; ai < L.anoDoors.length; ai++) {
        var AD = L.anoDoors[ai];
        if (AD.open && AD.anim < 1 && AD.door) {
          AD.anim = Math.min(1, AD.anim + dt * 1.4);
          AD.door.rotation.y = AD.baseYaw - 1.85 * AD.anim;
        }
      }
      // 交通灯：无规律变灯
      for (var ti = 0; ti < L.traflites.length; ti++) {
        var TL = L.traflites[ti];
        TL.t -= dt;
        if (TL.t <= 0) {
          TL.cycle++;
          var r = new BR.RNG((TL.seed + TL.cycle * 7919) >>> 0);
          if (TL.state === 'green') { TL.state = 'yellow'; TL.t = 1.5; }
          else if (TL.state === 'yellow') { TL.state = 'red'; TL.t = 4 + r.next() * 5; }
          else { TL.state = 'green'; TL.t = 5 + r.next() * 6; }
          if (L._applyTl) L._applyTl(TL);
        }
      }
    }
  };
})();

