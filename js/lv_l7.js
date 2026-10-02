/* lv_l7.js —— Level 7「深海恐惧症」关卡内容
 * 入口房间（干燥安全参照）→ 一望无际的昏暗海洋（浅滩/深水区/动静点/利维坦）
 * 复用 BR.Swim（L37 交付前为本文件内置的降级实现：仅浅水减速）。
 */
(function () {
  var BR = window.BR;
  var T = BR.TILE;

  /* ================= BR.Swim 复用 / 降级 =================
   * 契约（与 L37 任务约定）：BR.Swim.registerZone({x, z, r, depth, kind})
   *   kind: 'ocean'（海面大 zone，矩形用 x0/z0/x1/z1；holes:[{x0,z0,x1,z1}] 为干区洞，
   *           L7 用它把干燥的入口房间抠掉）| 'deep'（深水区圆形）
   *   BR.Swim.tick(dt) 每帧由关卡 tick 调用；player.js 读 BR.Swim.speedMul。
   * L37 未交付时：安装极简降级实现（仅浅水减速 speedMul=0.6，深水 0.45；
   *   无闭气/溺水系统，coordinator 集成 L37 的完整 BR.Swim 时会被替换）。
   */
  var SWIM_DEGRADED = false;
  function ensureSwim() {
    if (BR.Swim && typeof BR.Swim.registerZone === 'function' && typeof BR.Swim.tick === 'function') {
      SWIM_DEGRADED = false;
      return; // L37 的完整实现已存在，直接复用
    }
    SWIM_DEGRADED = true;
    var zones = [];
    function inRect(P, z) {
      if (P.pos.x < z.x0 || P.pos.x > z.x1 || P.pos.z < z.z0 || P.pos.z > z.z1) return false;
      var holes = z.holes; // 干区洞（入口房间）：洞内不算水
      if (holes) for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        if (P.pos.x >= h.x0 && P.pos.x <= h.x1 && P.pos.z >= h.z0 && P.pos.z <= h.z1) return false;
      }
      return true;
    }
    BR.Swim = {
      _l7shim: true,
      speedMul: 1,
      zones: zones,
      registerZone: function (z) { zones.push(z); },
      clearZones: function () { zones.length = 0; this.speedMul = 1; },
      tick: function (dt) {
        var P = BR.Player;
        if (!P || BR.Game.state !== 'playing' || BR.Game.level !== 'L7') { this.speedMul = 1; return; }
        var deep = false, wet = false;
        for (var i = 0; i < zones.length; i++) {
          var z = zones[i], hit = false;
          if (z.x0 != null) hit = inRect(P, z); // 矩形 zone
          else hit = Math.hypot(P.pos.x - z.x, P.pos.z - z.z) <= z.r; // 圆形 zone
          if (hit) { if (z.kind === 'deep') deep = true; else wet = true; }
        }
        this.speedMul = deep ? 0.45 : (wet ? 0.6 : 1);
      }
    };
  }

  /* ================= 跨关（Cutout 统一转场；Systems A 未交付时降级） ================= */
  function travelTo(to, kind) {
    BR.Game._cameFrom = 'L7'; // 返回契约：入口门读 BR.Game._cameFrom || 'L0'
    if (BR.Swim) BR.Swim.speedMul = 1; // 离开前复位减速
    if (BR.Cutout && typeof BR.Cutout.travel === 'function') {
      BR.Cutout.travel(to, { kind: kind });
    } else {
      // Systems A 未交付时的降级：淡出后跨关
      if (BR.Trans && !BR.Trans.active) BR.Trans.play('fade');
      setTimeout(function () { BR.Game.gotoLevel(to); }, 700);
    }
  }

  /* ================= 小工具（levels.js 的 helpers 不可跨 IIFE 调用，自备） ================= */
  function poiList(map, type) {
    return (map.pois || []).filter(function (p) { return p.type === type; });
  }
  function trackMat(W, m) { // 本关材质：随 W.dispose 释放
    W._levelMats = W._levelMats || [];
    W._levelMats.push(m);
    return m;
  }
  function wallNormal(W, tx, ty) {
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      if (W.isWall(tx + dirs[i][0], ty + dirs[i][1])) return { x: -dirs[i][0], z: -dirs[i][1] };
    }
    return { x: 0, z: 1 };
  }
  // 字条（墙面纸片 + 交互）
  function addNote7(W, tx, ty, title, body) {
    var id = 'note_L7_' + tx + '_' + ty;
    W.addChunkContent(tx, ty, function (group) {
      var n = wallNormal(W, tx, ty);
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.75),
        new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') })
      );
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

  var L7_ENTRY_NOTE = [
    '门边的字条',
    '如果你读到这张字条，说明你已经站在了深海的边缘。\n\n' +
    '门外是一望无际的海，越深的地方越黑。记住三件事：\n\n' +
    '1. 返回这扇门，可回到你来的地方。\n' +
    '2. 别在深水区停留太久——注意你的呼吸。\n' +
    '3. 如果看到水面上有不反光的地方……那可能是条路。\n\n——M.'
  ];

  /* ================= Level 定义 ================= */
  BR.Levels.L7 = {
    name: 'Level 7 ——「深海恐惧症」',
    theme: {
      bg: 0x030608, fogNear: 6, fogFar: 60, ambient: 0x2a3f52, ambInt: 0.55,
      sky: 0x1a2f42, ground: 0x0a141c, light: 0x7fb8d8, lightInt: 0.5,
      wallH: 3.2, wall: 'ocean_wall', floor: 'ocean_floor', ceil: 'ocean_floor',
      surface: 'concrete', fixtureEvery: 40, hum: 0.15
    },

    buildContent: function (map, W) {
      ensureSwim();
      var L = (W._l7 = { rollT: 0, t: 0, pulses: [], deepZones: [], waterMats: [], baseFogFar: 0 });
      var meta = map.meta.l7;
      var oc = meta.ocean, entry = meta.entryRoom;
      var ox0w = oc.x0 * T, oz0w = oc.y0 * T, ox1w = (oc.x1 + 1) * T, oz1w = (oc.y1 + 1) * T;
      var ocx = (ox0w + ox1w) / 2, ocz = (oz0w + oz1w) / 2;

      /* ---- 1. 入口房间：干燥混凝土覆层 + 暖光（安全参照） ---- */
      (function buildEntryRoom() {
        var ex0 = entry.x * T, ez0 = entry.y * T;
        var ew = entry.w * T, eh = entry.h * T;
        var cx = ex0 + ew / 2, cz = ez0 + eh / 2;
        W.addChunkContent(entry.x, entry.y, function (group) {
          // 干燥混凝土覆层（区别于海底沙地）
          var fm = new THREE.Mesh(
            new THREE.PlaneGeometry(ew, eh),
            new THREE.MeshLambertMaterial({ map: BR.Textures.get('concreteFloor') })
          );
          trackMat(W, fm.material);
          fm.rotation.x = -Math.PI / 2;
          fm.position.set(cx, 0.02, cz);
          W.reg(group, fm);
          // 暖光：安全感
          var pl = new THREE.PointLight(0xffd9a0, 1.1, 15, 2);
          pl.position.set(cx, 2.3, cz);
          W.reg(group, pl);
        });
      })();

      /* ---- 2. 海面：整片海洋的半透明水体 ---- */
      W.addChunkContent(Math.round((oc.x0 + oc.x1) / 2), Math.round((oc.y0 + oc.y1) / 2), function (group) {
        var wm = new THREE.Mesh(
          new THREE.PlaneGeometry(ox1w - ox0w, oz1w - oz0w),
          new THREE.MeshBasicMaterial({ color: 0x0e2c40, transparent: true, opacity: 0.55, depthWrite: false })
        );
        trackMat(W, wm.material);
        wm.rotation.x = -Math.PI / 2;
        wm.position.set(ocx, 0.35, ocz);
        W.reg(group, wm);
        L.waterMats.push(wm.material);
      });

      /* ---- 3. 海底起伏：岩石堆（确定性散布，纯装饰） ---- */
      (function buildRocks() {
        var cands = [], x, y;
        for (y = oc.y0; y <= oc.y1; y++)
          for (x = oc.x0; x <= oc.x1; x++) {
            if (x >= entry.x - 1 && x <= entry.x + entry.w && y >= entry.y - 1 && y <= entry.y + entry.h) continue;
            if (W.map.tiles[y * W.map.w + x] === 1) cands.push([x, y]);
          }
        var rng = new BR.RNG(BR.hashSeed(map.seed + ':l7rocks'));
        var rockMat = trackMat(W, new THREE.MeshLambertMaterial({ color: 0x11161d }));
        var placed = 0, guard = 0;
        while (placed < 46 && guard++ < 300 && cands.length) {
          var c = cands[(rng.next() * cands.length) | 0];
          var px = BR.tileCX(c[0]) + (rng.next() - 0.5) * 1.6;
          var pz = BR.tileCZ(c[1]) + (rng.next() - 0.5) * 1.6;
          (function (xx, zz) {
            W.addChunkContent(c[0], c[1], function (group) {
              var rh = 0.8 + rng.next() * 1.7, rr = 0.5 + rng.next() * 0.9;
              var rock = new THREE.Mesh(new THREE.CylinderGeometry(0.08, rr, rh, 7), rockMat);
              rock.position.set(xx, rh / 2 - 0.1, zz);
              rock.rotation.y = rng.next() * 6.28;
              W.reg(group, rock);
            });
          })(px, pz);
          placed++;
        }
      })();

      /* ---- 4. 字条 + 补给 ---- */
      poiList(map, 'note').forEach(function (p) {
        if (p.data.noteId === 'L7_entry') addNote7(W, p.tx, p.ty, L7_ENTRY_NOTE[0], L7_ENTRY_NOTE[1]);
      });
      poiList(map, 'cache').forEach(function (p) {
        var id = 'l7cache_' + p.tx + '_' + p.ty;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = new THREE.Group();
          g.position.set(BR.tileCX(p.tx), 0, BR.tileCZ(p.ty));
          var wood = W.mat('crate');
          var box = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.8, 1.05), wood);
          box.position.y = 0.4; g.add(box);
          var lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 1.05), wood);
          lid.position.y = 0.86; g.add(lid);
          W.reg(group, g);
          W.addInteractable({
            id: id, kind: 'cache', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [box, lid], pos: g.position.clone().add(new THREE.Vector3(0, 1, 0)), radius: 2.6,
            prompt: function () { return W.state.picked.indexOf(id) >= 0 ? '空补给箱' : '打开补给箱'; },
            canUse: function () { return W.state.picked.indexOf(id) < 0; },
            use: function () {
              if (W.state.picked.indexOf(id) >= 0) return;
              lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0);
              BR.Audio.doorCreak();
              W.state.picked.push(id);
              var items = p.data.items || ['almond'];
              items.forEach(function (it) {
                if (it === 'flashlight') BR.Player.hasFlashlight = true;
                else BR.Game.inv[it] = (BR.Game.inv[it] || 0) + 1;
              });
              BR.Audio.pickup();
              BR.UI.toast('补给：杏仁水 ×2、绷带 ×1');
              BR.UI.updateInv();
              BR.bus.emit('picked', { id: id });
            }
          });
        });
      });

      /* ---- 5. 入口门：返回来处（重力异常演出 + Cutout） ---- */
      poiList(map, 'entry_door').forEach(function (p) {
        var doorId = p.data.doorId;
        W.addDoor({
          id: doorId, tx: p.tx, ty: p.ty, axis: 'x', locked: false,
          label: '锈蚀的舱门',
          prompt: function () { return '推开舱门（回到你来的地方）'; },
          use: function (d) {
            W.setDoor(doorId, true);
            BR.Audio.doorCreak();
            // 高度/重力异常演出：1 秒镜头倾斜 + 失重 toast（不翻转）
            L.rollT = 1.0;
            BR.UI.toast('跨出这扇门的瞬间，一阵强烈的失重感攫住了你……', 2600);
            setTimeout(function () {
              if (BR.Game.state !== 'playing' || BR.Game.level !== 'L7') return;
              var back = (BR.Game && BR.Game._cameFrom) || 'L0';
              travelTo(back, 'walk');
            }, 900);
          }
        });
      });

      /* ---- 6. 深水区：低能见度覆层（视觉） + Swim zone 注册 ---- */
      poiList(map, 'deep_zone').forEach(function (p, i) {
        var zx = BR.tileCX(p.tx), zz = BR.tileCZ(p.ty);
        var zr = (p.data.r || 7) * T;
        L.deepZones.push({ x: zx, z: zz, r: zr, depth: p.data.depth || 1 });
        W.addChunkContent(p.tx, p.ty, function (group) {
          // 深水覆层：越深越暗
          var dm = new THREE.Mesh(
            new THREE.CircleGeometry(zr, 24),
            new THREE.MeshBasicMaterial({ color: 0x020608, transparent: true, opacity: 0.30 + 0.12 * (p.data.depth || 1), depthWrite: false })
          );
          trackMat(W, dm.material);
          dm.rotation.x = -Math.PI / 2;
          dm.position.set(zx, 0.37, zz);
          W.reg(group, dm);
        });
      });

      /* ---- 7. 动静点：视觉脉冲 + 未知低频音效（不放实体） ---- */
      poiList(map, 'disturbance').forEach(function (p, i) {
        var dx = BR.tileCX(p.tx), dz = BR.tileCZ(p.ty);
        var lid = 'l7_dist_' + i;
        W.addChunkContent(p.tx, p.ty, function (group) {
          // 远处水面下的微光：缓慢扩散的环
          var ring = new THREE.Mesh(
            new THREE.RingGeometry(0.8, 1.1, 32),
            new THREE.MeshBasicMaterial({ color: 0x2a6a8a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
          );
          trackMat(W, ring.material);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(dx, 0.42, dz);
          W.reg(group, ring);
          var glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 12, 10),
            new THREE.MeshBasicMaterial({ color: 0x1a4a62, transparent: true, opacity: 0.5 })
          );
          trackMat(W, glow.material);
          glow.position.set(dx, 0.6, dz);
          W.reg(group, glow);
          L.pulses.push({ ring: ring, glow: glow, phase: i * 2.1 });
          // 未知音效：深海低频隆隆（位置循环）
          BR.Audio.addLoop(lid, 'machine', dx, dz, 0.55);
        });
      });

      /* ---- 8. 深处出口：发光上升流 →L37 ---- */
      poiList(map, 'deep_exit').forEach(function (p) {
        var ex = BR.tileCX(p.tx), ez = BR.tileCZ(p.ty);
        var eid = 'l7_deep_exit';
        W.addChunkContent(p.tx, p.ty, function (group) {
          var col = new THREE.Mesh(
            new THREE.CylinderGeometry(1.1, 1.7, 7, 16, 1, true),
            new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.30, depthWrite: false, side: THREE.DoubleSide })
          );
          trackMat(W, col.material);
          col.position.set(ex, 3.2, ez);
          W.reg(group, col);
          var core = new THREE.Mesh(
            new THREE.CylinderGeometry(0.45, 0.7, 7, 12, 1, true),
            new THREE.MeshBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
          );
          trackMat(W, core.material);
          core.position.set(ex, 3.2, ez);
          W.reg(group, core);
          L.pulses.push({ ring: col, glow: core, phase: 0, spin: true });
          W.addInteractable({
            id: eid, kind: 'exit', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [col, core], pos: new THREE.Vector3(ex, 1.6, ez), radius: 3.0,
            prompt: function () { return '踏入发光的上升流（深处出口）'; },
            canUse: function () { return true; },
            use: function () { travelTo('L37', 'water'); }
          });
        });
      });

      /* ---- 9. 异常切出点：水面不反光的区域 →L0（需观察发现） ---- */
      poiList(map, 'anomaly_exit').forEach(function (p) {
        var ax = BR.tileCX(p.tx), az = BR.tileCZ(p.ty);
        var aid = 'l7_anomaly_exit';
        W.addChunkContent(p.tx, p.ty, function (group) {
          // 哑光暗斑：与周围反光水面形成反差，低调到需要仔细观察
          var patch = new THREE.Mesh(
            new THREE.CircleGeometry(2.0, 20),
            new THREE.MeshBasicMaterial({ color: 0x010304, transparent: true, opacity: 0.88, depthWrite: false })
          );
          trackMat(W, patch.material);
          patch.rotation.x = -Math.PI / 2;
          patch.position.set(ax, 0.39, az);
          W.reg(group, patch);
          W.addInteractable({
            id: aid, kind: 'exit', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [patch], pos: new THREE.Vector3(ax, 0.8, az), radius: 2.6,
            prompt: function () { return '这片水面……不反光（异常）'; },
            canUse: function () { return true; },
            use: function () { travelTo('L0', 'walk'); }
          });
        });
      });

      /* ---- 10. 注册 Swim 水 zone（海面大 zone + 深水区） ---- */
      if (BR.Swim && typeof BR.Swim.clearZones === 'function') BR.Swim.clearZones();
      if (BR.Swim && typeof BR.Swim.registerZone === 'function') {
        // 海面大 zone（矩形；holes 把干燥的入口房间抠掉，保证出生点无减速）
        BR.Swim.registerZone({
          kind: 'ocean', depth: 0,
          x0: ox0w, z0: oz0w, x1: ox1w, z1: oz1w,
          holes: [{ x0: entry.x * T, z0: entry.y * T, x1: (entry.x + entry.w) * T, z1: (entry.y + entry.h) * T }]
        });
        L.deepZones.forEach(function (z) {
          BR.Swim.registerZone({ kind: 'deep', depth: z.depth, x: z.x, z: z.z, r: z.r });
        });
      }
      if (BR.Swim) BR.Swim.speedMul = 1; // 出生点干燥：复位

      W.objective = '在深海中找到离开的方法。入口房间是安全的——返回那扇门可回到你来的地方。';
    },

    onEnter: function () {
      BR.UI.setObjective(BR.World.objective || '探索 Level 7');
      BR.Audio.setAmbient('L7');
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player, L = W._l7;
      if (!P || BR.Game.state !== 'playing' || !L) return;

      // Swim：水 zone 减速 / 闭气（L37 完整版接管；降级版只做减速）
      if (BR.Swim && typeof BR.Swim.tick === 'function') BR.Swim.tick(dt);
      L.t += dt;

      // 重力异常演出：P.extRoll 1 秒倾斜衰减（不翻转；有转场进行时不抢通道）
      if (L.rollT > 0) {
        if (!BR.Trans.active) {
          L.rollT -= dt;
          var k = Math.max(0, L.rollT);
          P.extRoll = 0.35 * k;
          if (L.rollT <= 0) P.extRoll = 0;
        }
      }

      // 水面微动
      for (var i = 0; i < L.waterMats.length; i++) {
        L.waterMats[i].opacity = 0.52 + 0.06 * Math.sin(L.t * 0.8);
      }
      // 动静点脉冲 / 上升流旋转
      for (var j = 0; j < L.pulses.length; j++) {
        var pu = L.pulses[j], ph = L.t * 1.4 + pu.phase;
        if (pu.spin) { pu.ring.rotation.y += dt * 0.6; pu.glow.rotation.y -= dt * 0.9; }
        else {
          var s = 1 + 0.8 * (0.5 + 0.5 * Math.sin(ph));
          pu.ring.scale.set(s, s, 1);
          pu.ring.material.opacity = 0.35 * (1 - 0.5 * (0.5 + 0.5 * Math.sin(ph)));
          pu.glow.material.opacity = 0.35 + 0.25 * Math.sin(ph * 1.3);
        }
      }

      // 深水区低能见度：雾距离随玩家位置平滑变化
      var inDeep = false;
      for (var d = 0; d < L.deepZones.length; d++) {
        var z = L.deepZones[d];
        if (Math.hypot(P.pos.x - z.x, P.pos.z - z.z) <= z.r) { inDeep = true; break; }
      }
      if (W.scene && W.scene.fog) {
        if (!L.baseFogFar) L.baseFogFar = W.scene.fog.far;
        var target = inDeep ? 20 : L.baseFogFar;
        W.scene.fog.far += (target - W.scene.fog.far) * Math.min(1, dt * 2);
      }
    }
  };

  // 供测试/调试：是否处于 Swim 降级模式
  BR.Levels.L7._swimDegraded = function () { return SWIM_DEGRADED; };
})();
