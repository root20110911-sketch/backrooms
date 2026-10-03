/* lv_l7.js —— Level 7「深海恐惧症」关卡内容（v1.5 彻底重构）
 * Fandom 版：金属舱室入口 → 舱盖/甲板 → 露天阴天海洋（小船）→ 深海（实体/深水区/L37 门）
 * 距离/深度均为游戏尺度改编（见 LORE.md），非原著数值。
 *
 * 复用：BR.Swim（lv_l37.js 的完整实现；本文件不再自带降级 shim）。
 * 小船：经 BR.Mounts.register('boat', factory) 注册（W8 提供完整版 BR.Mounts；
 *   若不存在，本文件内置最小 register 实现保证船可用，W8 版加载后自动让位）。
 * L7→L37：只调 BR.Cutout.travelTo('L37', {mode:'swim'})（W10 提供），
 *   不存在时回退到既有 BR.Cutout.travel('L37', {kind:'water'})；不自己写传送。
 */
(function () {
  var BR = window.BR;
  var T = BR.TILE;

  /* ================= BR.Mounts 最小实现（W8 完整版未加载时兜底） ================= */
  if (!BR.Mounts) {
    BR.Mounts = {
      _factories: {},
      _note: 'minimal shim (lv_l7); replaced by W8 full version when present',
      register: function (name, factory) { this._factories[name] = factory; return factory; },
      getFactory: function (name) { return this._factories[name]; }
    };
  }

  /* ================= 小船 handle 工厂 =================
   * handle 接口（任务约定）：
   *   update(dt, input, player) / getSeatPos() /
   *   findDismountSpot() -> {x,z}|null / getSave() / applySave(save)
   *   + board(player) / dismount(player) / isRiding()（关卡内使用）
   */
  function boatFactory(W, opts) {
    opts = opts || {};
    var seaY = opts.seaY || function () { return 0.15; };
    var bounds = opts.bounds || { x0: 0, z0: 0, x1: 100, z1: 100 };
    var blockedFn = opts.blockedFn || function () { return false; };
    var timeFn = opts.timeFn || function () { return (BR.World && BR.World.time) || 0; };

    var st = {
      x: opts.x || 0, z: opts.z || 0, yaw: opts.yaw || 0,
      vx: 0, vz: 0, riding: false
    };

    /* ---- 船体网格（小舢板：船体/舷边/长凳/船桨） ---- */
    var g = new THREE.Group();
    var wood = new THREE.MeshLambertMaterial({ color: 0x4a3b2c });
    var woodD = new THREE.MeshLambertMaterial({ color: 0x33291e });
    var metal = new THREE.MeshLambertMaterial({ color: 0x5a5e62 });
    function box(w, h, d, m, x, y, z, rz) {
      var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      ms.position.set(x, y, z);
      if (rz) ms.rotation.z = rz;
      g.add(ms);
      return ms;
    }
    // 船底 + 上翘船头/船尾
    box(1.7, 0.28, 3.4, woodD, 0, 0.05, 0);
    var bow = box(1.7, 0.28, 1.0, woodD, 0, 0.32, -1.95); bow.rotation.x = 0.5;
    var stern = box(1.7, 0.28, 0.8, woodD, 0, 0.28, 1.9); stern.rotation.x = -0.45;
    // 舷边
    box(0.12, 0.55, 3.4, wood, -0.85, 0.42, 0);
    box(0.12, 0.55, 3.4, wood, 0.85, 0.42, 0);
    box(1.82, 0.55, 0.12, wood, 0, 0.42, -1.7);
    box(1.82, 0.55, 0.12, wood, 0, 0.42, 1.7);
    // 长凳 ×2 + 船桨
    box(1.5, 0.09, 0.4, wood, 0, 0.45, -0.7);
    box(1.5, 0.09, 0.4, wood, 0, 0.45, 0.7);
    var oar = box(0.07, 0.07, 2.2, woodD, 0.3, 0.5, 0.2); oar.rotation.y = 0.5;
    // 金属包角
    box(1.86, 0.1, 0.14, metal, 0, 0.62, -1.7);
    box(1.86, 0.1, 0.14, metal, 0, 0.62, 1.7);
    g.rotation.order = 'YXZ';
    g.userData.isBoat = true;

    function clampBoat() {
      var m = 2.2;
      st.x = Math.max(bounds.x0 + m, Math.min(bounds.x1 - m, st.x));
      st.z = Math.max(bounds.z0 + m, Math.min(bounds.z1 - m, st.z));
    }

    var handle = {
      mesh: g,
      state: st,
      kind: 'boat',        // W8 契约：P.mount 按 kind/stateName 推断玩家状态
      stateName: 'boat',
      update: function (dt, input, player) {
        var mv = (input && typeof input.getMove === 'function') ? input.getMove() : { x: 0, z: 0 };
        if (st.riding) {
          // 桌面方向键 + 手机摇杆：左右转向、前后加减速（run=加速）
          st.yaw -= mv.x * 1.25 * dt;
          var fast = false;
          try { fast = !!(input.runHeld || input.runToggle); } catch (e) {}
          var spd = mv.z * (fast ? 5.4 : 3.4);
          var fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);
          st.vx = BR.damp(st.vx, fx * spd, 2.2, dt);
          st.vz = BR.damp(st.vz, fz * spd, 2.2, dt);
          var nx = st.x + st.vx * dt, nz = st.z + st.vz * dt;
          // 碰撞：墙 tile / 甲板区不可进入（分轴滑动）
          if (!blockedFn(nx, st.z)) st.x = nx; else st.vx *= 0.2;
          if (!blockedFn(st.x, nz)) st.z = nz; else st.vz *= 0.2;
          clampBoat();
        } else {
          st.vx = BR.damp(st.vx, 0, 1.5, dt);
          st.vz = BR.damp(st.vz, 0, 1.5, dt);
          st.x += st.vx * dt; st.z += st.vz * dt;
          clampBoat();
        }
        // 随浪起伏：高度 + 纵摇/横摇（由波面斜率驱动）
        var t = timeFn();
        var y = seaY(st.x, st.z, t);
        g.position.set(st.x, y + 0.10, st.z);
        var e = 1.4;
        var sx = (seaY(st.x + e, st.z, t) - seaY(st.x - e, st.z, t)) / (2 * e);
        var sz = (seaY(st.x, st.z + e, t) - seaY(st.x, st.z - e, t)) / (2 * e);
        g.rotation.y = st.yaw;
        g.rotation.x = sz * 1.1;
        g.rotation.z = -sx * 1.1;
        // 乘船时玩家固定在座位（level tick 在 player.update 之后跑，此处覆盖即为最终位）
        // v1.5 W8 契约：坐骑态由 P.update 经 mountHandle 调 update，handle 对 player.pos
        // 与相机有全权（玩家 update 不再覆盖）。未乘时由关卡 tick 驱动漂流/波浪。
        if (st.riding && player && player.pos) {
          var seat = this.getSeatPos();
          player.pos.x = seat.x; player.pos.z = seat.z;
          player.pos.y = seat.y;
          player.vel.x = 0; player.vel.z = 0; player.vel.y = 0;
          player._grounded = true;
          var cam = player.camera;
          if (cam) {
            if (player.thirdPerson && typeof player._updateThirdCamera === 'function') {
              var bspd = Math.hypot(st.vx, st.vz);
              try { player._updateThirdCamera(dt, BR.World, false, bspd > 0.6); } catch (e2) {}
            } else {
              cam.position.set(seat.x, seat.y + 1.25, seat.z); // 坐姿眼高
              cam.rotation.order = 'YXZ';
              cam.rotation.set(player.pitch || 0, player.yaw || 0, 0);
            }
          }
          // 乘船中也持续写存档（mid-ride 存档读到的是当前位置）
          if (W && W.state) W.state.boatSave = this.getSave();
        }
        // 交互物守卫：区块卸载会按 chunkKey 清掉交互物，船是场景级对象，缺失则补回
        if (W && W.interactables && !W._boatItGone) {
          var found = false;
          for (var i = 0; i < W.interactables.length; i++)
            if (W.interactables[i].id === 'l7_boat') { found = true; break; }
          if (!found && handle._itDef) {
            try { W.addInteractable(handle._itDef); } catch (e) {}
          }
        }
        // 位置存档（W.state 随 snapshot/autosave 持久化；不复制不消失）
        if (W && W.state) W.state.boatSave = this.getSave();
      },
      getSeatPos: function () {
        // 座位：船中心偏后 0.5m，座位面高出船体基准 0.55m
        var ox = Math.sin(st.yaw) * 0.5, oz = Math.cos(st.yaw) * 0.5;
        return new THREE.Vector3(st.x + ox, g.position.y + 0.55, st.z + oz);
      },
      deckY: function () { return g.position.y + 0.55; },
      findDismountSpot: function () {
        // 船两侧 2.6m 找水面落点（排除墙 tile 与甲板区）
        var px = Math.cos(st.yaw), pz = -Math.sin(st.yaw); // 右舷方向
        var cands = [
          [st.x + px * 2.6, st.z + pz * 2.6],
          [st.x - px * 2.6, st.z - pz * 2.6],
          [st.x - Math.sin(st.yaw) * 3.0, st.z - Math.cos(st.yaw) * 3.0]
        ];
        for (var i = 0; i < cands.length; i++) {
          var cx = cands[i][0], cz = cands[i][1];
          var tx = Math.floor(cx / T), ty = Math.floor(cz / T);
          if (W.isWall(tx, ty)) continue;
          if (blockedFn(cx, cz)) continue;
          if (cx < bounds.x0 || cx > bounds.x1 || cz < bounds.z0 || cz > bounds.z1) continue;
          return { x: cx, z: cz };
        }
        return null;
      },
      onMount: function (player) {
        st.riding = true;
        try { BR.Audio.splash(); } catch (e) {}
        if (W && W.state) W.state.boatSave = this.getSave();
      },
      onDismount: function (player) {
        st.riding = false;
        if (player && player.pos) {
          // 主动下船→游泳：P.dismount 已按 findDismountSpot 摆好 x/z，这里放入水中
          var t = timeFn();
          player.pos.y = seaY(player.pos.x, player.pos.z, t) - 1.0;
          player.vel.set(0, 0, 0);
          player._grounded = false;
        }
        try { BR.Audio.splash(); } catch (e) {}
        if (W && W.state) W.state.boatSave = this.getSave();
      },
      board: function (player) {
        // 走 W8 玩家坐骑状态机（P.mount）：state='boat'，重力/碰撞关闭，
        // P.update 每帧经 mountHandle 调本 handle.update
        var P = player || BR.Player;
        if (!P || typeof P.mount !== 'function') return false;
        return !!P.mount(handle); // onMount 里置 st.riding=true
      },
      dismount: function (player) {
        if (!st.riding) return false;
        var spot = this.findDismountSpot();
        if (!spot) { BR.UI.toast('这边不好下船，换个开阔位置', 2000); return false; }
        var P = player || BR.Player;
        // 走 W8 的 P.dismount：内部再调 findDismountSpot 摆位 + onDismount 入水
        if (P && typeof P.dismount === 'function') P.dismount();
        else st.riding = false;
        return true;
      },
      isRiding: function () { return st.riding; },
      getSave: function () {
        return {
          x: +st.x.toFixed(2), z: +st.z.toFixed(2),
          yaw: +st.yaw.toFixed(3), riding: st.riding ? 1 : 0
        };
      },
      applySave: function (s) {
        if (!s) return;
        if (isFinite(s.x)) st.x = s.x;
        if (isFinite(s.z)) st.z = s.z;
        if (isFinite(s.yaw)) st.yaw = s.yaw;
        st.riding = false; // 读档不恢复乘坐：人站在船边水面，船不复制不消失
        clampBoat();
      },
      dispose: function () {
        if (W && W.scene) W.scene.remove(g);
        g.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }
    };
    return handle;
  }
  // 注册（W8 的完整版 BR.Mounts 同样走 register；最小实现兜底时直接可用）
  if (BR.Mounts && typeof BR.Mounts.register === 'function') {
    try { BR.Mounts.register('boat', boatFactory); } catch (e) {}
  }

  /* ================= 场景级对象管理（海面/云/船，不进区块） ================= */
  var sceneObjs = [];
  function trackScene(o) { sceneObjs.push(o); return o; }
  function clearSceneObjs() {
    for (var i = 0; i < sceneObjs.length; i++) {
      var o = sceneObjs[i];
      try {
        if (o._l7handle && o._l7handle.dispose) o._l7handle.dispose();
        else {
          if (o.parent) o.parent.remove(o);
          o.traverse(function (c) {
            if (c.geometry) c.geometry.dispose();
            if (c.material) {
              var ms = Array.isArray(c.material) ? c.material : [c.material];
              for (var k = 0; k < ms.length; k++) { try { ms[k].dispose(); } catch (e) {} }
            }
          });
        }
      } catch (e) {}
    }
    sceneObjs.length = 0;
  }

  /* ================= 跨关（Cutout 统一转场） ================= */
  function travelTo(to, kind) {
    BR.Game._cameFrom = 'L7'; // 返回契约：入口舱盖读 BR.Game._cameFrom || 'L0'
    if (BR.Swim) BR.Swim.speedMul = 1; // 离开前复位减速
    if (BR.Cutout && typeof BR.Cutout.travel === 'function') {
      BR.Cutout.travel(to, { kind: kind });
    } else {
      if (BR.Trans && !BR.Trans.active) BR.Trans.play('fade');
      setTimeout(function () { BR.Game.gotoLevel(to); }, 700);
    }
  }
  // L7→L37：W10 提供的 travelTo 优先（{mode:'swim'}），不存在时走既有 Cutout.travel
  function goL37() {
    BR.Game._cameFrom = 'L7';
    if (BR.Swim) BR.Swim.speedMul = 1;
    if (BR.Cutout && typeof BR.Cutout.travelTo === 'function') {
      BR.Cutout.travelTo('L37', { mode: 'swim' });
    } else {
      travelTo('L37', 'water');
    }
  }

  /* ================= 小工具 ================= */
  function poiList(map, type) {
    return (map.pois || []).filter(function (p) { return p.type === type; });
  }
  function trackMat(W, m) {
    W._levelMats = W._levelMats || [];
    W._levelMats.push(m);
    return m;
  }
  function inTileRect(x, z, r) {
    return x >= r.x0 * T && x <= (r.x1 + 1) * T && z >= r.y0 * T && z <= (r.y1 + 1) * T;
  }

  // 字条（舱壁纸片 + 交互）
  function addNote7(W, tx, ty, title, body) {
    var id = 'note_L7_' + tx + '_' + ty;
    W.addChunkContent(tx, ty, function (group) {
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var n = { x: 0, z: 1 };
      for (var i = 0; i < 4; i++) {
        if (W.isWall(tx + dirs[i][0], ty + dirs[i][1])) { n = { x: -dirs[i][0], z: -dirs[i][1] }; break; }
      }
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
    '舱壁上的字条',
    '如果你读到这张字条，说明你已经站在了深海的边缘。\n\n' +
    '这间舱室是干燥的，在这里你可以慢慢熟悉操作。\n\n' +
    '1. 爬上楼梯，推开舱盖——外面是海。甲板边的舢板可以用（对准按 E 登船，方向键/WASD 或摇杆驾驶，再按 E 下船）。\n' +
    '2. 水里按住 C 下潜、空格上浮。只有头部没入水下才会消耗氧气，脚沾水没关系；出水后氧气会恢复。\n' +
    '3. 别在深水区停留太久——注意你的呼吸。\n' +
    '4. 深处有一截发光的瓷砖结构，潜进去看看。\n' +
    '5. 如果看到水面上有不反光的地方……那可能是条路。\n\n——M.'
  ];

  /* ================= Level 定义 ================= */
  BR.Levels.L7 = {
    name: 'Level 7 ——「深海恐惧症」',
    theme: {
      bg: 0x59616a, fogNear: 10, fogFar: 130, ambient: 0x8b95a0, ambInt: 0.75,
      sky: 0x9aa4ad, ground: 0x232b31, light: 0xcfd8de, lightInt: 0.45,
      wallH: 3.2, wall: 'rust_metal', floor: 'abyss', ceil: 'rust_dark',
      surface: 'metal', fixtureEvery: 1000, hum: 0
    },

    // 地面高度查询（楼梯坡道/平台/甲板/船座；player.js _groundYAt 钩子）
    floorYAt: function (x, z) {
      var L = BR.World && BR.World._l7;
      if (!L || !L.geom) return 0;
      var gm = L.geom;
      if (L.boat && L.boat.isRiding()) return L.boat.deckY();
      if (inTileRect(x, z, gm.deckTiles)) return gm.deckH;
      var dtx = Math.floor(x / T), dty = Math.floor(z / T);
      if ((dtx === gm.door.tx && dty === gm.door.ty) ||
          (dtx === gm.landing.tx && dty === gm.landing.ty)) return gm.deckH;
      if (!gm.stairFlat && dtx === gm.stair.tx && dty === gm.stair.ty) {
        var cx = BR.tileCX(gm.stair.tx), cz = BR.tileCZ(gm.stair.ty);
        var along = (x - cx) * gm.dnx + (z - cz) * gm.dny; // 沿外法线：平台侧 +1.5
        var k = (along + 1.5) / 3;
        return gm.deckH * Math.max(0, Math.min(1, k));
      }
      // 开放水域：物理海床（深水 -10/-16/-24，浅滩 -26；游戏尺度）。
      // 纯物理下限、无视觉地板（正常海域不许铺贴脚平坦地板）；潜水 _swimVertical
      // 用 max(groundY, w.floor)，这里返回海床才能潜到底。
      try {
        if (BR.Swim && typeof BR.Swim.zoneAt === 'function') {
          var wz = BR.Swim.zoneAt(x, z);
          if (wz && isFinite(wz.floor)) return wz.floor;
        }
      } catch (e) {}
      return 0;
    },

    buildContent: function (map, W) {
      clearSceneObjs();
      var L = (W._l7 = {
        t: 0, chop: 1, chopTarget: 1, geom: null, boat: null,
        seaMesh: null, seaGeo: null, cloudTexs: [],
        gate: null, entity: null, rumble: null, rumbleTarget: 0,
        deepZones: [], pulses: []
      });
      var meta = map.meta.l7;
      var oc = meta.ocean, entry = meta.entryRoom;
      var ox0w = oc.x0 * T, oz0w = oc.y0 * T, ox1w = (oc.x1 + 1) * T, oz1w = (oc.y1 + 1) * T;
      var ocx = (ox0w + ox1w) / 2, ocz = (oz0w + oz1w) / 2;
      var SURF = 0.15; // 物理/视觉海平面基准（游戏尺度）

      // 几何快照（floorYAt 用）
      L.geom = {
        deckH: meta.deckH, deckTiles: meta.deck,
        door: meta.door, landing: meta.landing,
        stair: meta.stair, stairFlat: !!meta.stair.flat,
        dnx: meta.door.nx, dny: meta.door.ny
      };

      /* ---- 海面波函数（船/海面网格/扰动环共用；单网格保证跨区块连续） ---- */
      function seaY(x, z, t) {
        var c = L.chop;
        return SURF
          + Math.sin(x * 0.11 + t * 0.7) * 0.055 * c
          + Math.sin(z * 0.13 - t * 0.55) * 0.045 * c
          + Math.sin((x + z) * 0.05 + t * 0.32) * 0.035 * c;
      }
      L.seaY = seaY;

      /* ---- 0. 海洋 tile：去天花板（露天）；去室内迷宫墙体（只留舱室外墙） ---- */
      (function openOcean() {
        var ringX0 = entry.x - 1, ringY0 = entry.y - 1;
        var ringX1 = entry.x + entry.w, ringY1 = entry.y + entry.h;
        for (var ty = oc.y0; ty <= oc.y1; ty++) {
          for (var tx = oc.x0; tx <= oc.x1; tx++) {
            var inRing = tx >= ringX0 && tx <= ringX1 && ty >= ringY0 && ty <= ringY1;
            var isFloor = (W.map.tiles[ty * W.map.w + tx] === 1);
            if (isFloor && !inRing) W.setOpenCeil(tx, ty); // 海洋无天花板
            // 墙体：海洋边界的室内墙全部跳过（舱室外墙保留）
            if (!isFloor && !inRing) {
              if (W.map.tiles[ty * W.map.w + tx] === 0) {
                var nb = (tx + 1 <= oc.x1 && W.map.tiles[ty * W.map.w + tx + 1] === 1) ||
                         (tx - 1 >= oc.x0 && W.map.tiles[ty * W.map.w + tx - 1] === 1) ||
                         (ty + 1 <= oc.y1 && W.map.tiles[(ty + 1) * W.map.w + tx] === 1) ||
                         (ty - 1 >= oc.y0 && W.map.tiles[(ty - 1) * W.map.w + tx] === 1);
                if (nb) W.skipWall(tx, ty);
              }
            }
          }
        }
        // 甲板 tile 也在露天下
        var dr = meta.deck;
        for (var dty = dr.y0; dty <= dr.y1; dty++)
          for (var dtx = dr.x0; dtx <= dr.x1; dtx++) W.setOpenCeil(dtx, dty);
      })();

      /* ---- 1. 海面：整片海洋单张连续网格（无接缝） + 天空反射 ---- */
      (function buildSea() {
        var geo = new THREE.PlaneGeometry(ox1w - ox0w, oz1w - oz0w, 72, 72);
        geo.rotateX(-Math.PI / 2);
        geo.translate(ocx, 0, ocz);
        var mat = new THREE.MeshPhongMaterial({
          color: 0x2b3d44, specular: 0x8fa3ad, shininess: 90,
          map: BR.Textures.get('sea_detail'),
          transparent: true, opacity: 0.93, side: THREE.DoubleSide
        });
        trackMat(W, mat);
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 0; // 顶点 Y 由 seaY 直接写入（含 SURF 基准）
        mesh.frustumCulled = false;
        W.scene.add(mesh);
        trackScene(mesh);
        L.seaMesh = mesh; L.seaGeo = geo;
        L._seaBase = geo.attributes.position.array.slice(); // xz 基准（y 列将被覆写）
        // 海面细节贴图缓慢漂移（纹理级波动，与顶点波叠加）
        var dt2 = BR.Textures.get('sea_detail');
        if (dt2) { dt2.wrapS = dt2.wrapT = THREE.RepeatWrapping; }
      })();

      /* ---- 2. 阴天云层：两层灰云平面（fog:false，保证阴天穹顶可见） ---- */
      (function buildClouds() {
        var ct = BR.Textures.get('overcast');
        if (ct) { ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.repeat.set(3, 3); }
        for (var i = 0; i < 2; i++) {
          var cm = new THREE.Mesh(
            new THREE.PlaneGeometry(420, 420),
            new THREE.MeshBasicMaterial({
              map: ct || null, color: i ? 0x6b7278 : 0x878e94,
              transparent: true, opacity: i ? 0.85 : 0.96,
              depthWrite: false, fog: false
            })
          );
          trackMat(W, cm.material);
          cm.rotation.x = Math.PI / 2; // 法线朝下
          cm.position.set(ocx, 52 + i * 16, ocz);
          cm.renderOrder = -10;
          W.scene.add(cm);
          trackScene(cm);
          L.cloudTexs.push({ tex: ct, sp: i ? -0.0045 : 0.003 });
        }
      })();

      /* ---- 3. 深渊：海面下的黑暗（海水向下变暗；物理海床在其上 4m） ---- */
      (function buildAbyss() {
        var am = new THREE.Mesh(
          new THREE.PlaneGeometry(400, 400),
          new THREE.MeshBasicMaterial({ color: 0x020507 })
        );
        trackMat(W, am.material);
        am.rotation.x = -Math.PI / 2;
        am.position.set(ocx, -30, ocz);
        W.scene.add(am);
        trackScene(am);
      })();

      /* ---- 4. 金属舱室内部：地板覆层/上下铺/折叠椅/置物架/积水/暖光 ---- */
      (function buildCabin() {
        var ex0 = entry.x * T, ez0 = entry.y * T;
        var ew = entry.w * T, eh = entry.h * T;
        var cx = ex0 + ew / 2, cz = ez0 + eh / 2;
        var rng = new BR.RNG(BR.hashSeed(map.seed + ':l7cabin'));
        var stairT = meta.stair, landT = meta.landing;
        // 避让集合：楼梯/平台/门内/字条/补给 tile
        var noteP = poiList(map, 'note')[0], cacheP = poiList(map, 'cache')[0];
        function reserved(tx, ty) {
          if (tx === stairT.tx && ty === stairT.ty) return true;
          if (tx === landT.tx && ty === landT.ty) return true;
          if (tx === meta.door.fx && ty === meta.door.fy) return true;
          if (noteP && Math.hypot(tx - noteP.tx, ty - noteP.ty) < 1.2) return true;
          if (cacheP && Math.hypot(tx - cacheP.tx, ty - cacheP.ty) < 1.2) return true;
          return false;
        }
        var free = [];
        for (var ty = entry.y; ty < entry.y + entry.h; ty++)
          for (var tx = entry.x; tx < entry.x + entry.w; tx++)
            if (W.map.tiles[ty * W.map.w + tx] === 1 && !reserved(tx, ty)) free.push([tx, ty]);
        function takeFar() { // 取尽量分散的空 tile
          if (!free.length) return null;
          var bi = 0, bd = -1;
          for (var t = 0; t < Math.min(12, free.length); t++) {
            var i = (rng.next() * free.length) | 0, c = free[i], md = 1e9;
            for (var j = 0; j < taken.length; j++)
              md = Math.min(md, Math.hypot(c[0] - taken[j][0], c[1] - taken[j][1]));
            if (taken.length === 0) md = Math.hypot(c[0] - (entry.x + entry.w / 2), c[1] - (entry.y + entry.h / 2));
            if (md > bd) { bd = md; bi = i; }
          }
          var p = free.splice(bi, 1)[0]; taken.push(p); return p;
        }
        var taken = [];
        W.addChunkContent(entry.x, entry.y, function (group) {
          var steel = new THREE.MeshLambertMaterial({ color: 0x565b60 });
          var steelD = new THREE.MeshLambertMaterial({ color: 0x3a3d40 });
          var cloth = new THREE.MeshLambertMaterial({ color: 0x5a6a72 });
          var wood = new THREE.MeshLambertMaterial({ color: 0x5c4a36 });
          [steel, steelD, cloth, wood].forEach(function (m) { trackMat(W, m); });
          function bx(w, h, d, m, x, y, z) {
            var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
            ms.position.set(x, y, z); W.reg(group, ms); return ms;
          }
          // 地板覆层：钢板（盖住 abyss 贴图，舱内可辨认）
          var fl = new THREE.Mesh(
            new THREE.PlaneGeometry(ew, eh),
            new THREE.MeshLambertMaterial({ map: BR.Textures.get('deck_plate') })
          );
          trackMat(W, fl.material);
          fl.rotation.x = -Math.PI / 2;
          fl.position.set(cx, 0.02, cz);
          W.reg(group, fl);
          W.addSurfaceZone(ex0, ez0, ex0 + ew, ez0 + eh, 'metal');
          // 暖光：安全感（灯池之外独立 1 盏，随区块释放）
          var pl = new THREE.PointLight(0xffd9a0, 1.05, 16, 2);
          pl.position.set(cx, 2.4, cz);
          W.reg(group, pl);
          // 上下铺 ×1（靠墙）：钢架 + 两层床垫 + 枕头
          var bunkT = takeFar();
          if (bunkT) {
            var bx0 = BR.tileCX(bunkT[0]), bz0 = BR.tileCZ(bunkT[1]);
            var rot = (rng.next() * 2 | 0) * Math.PI / 2;
            var bg = new THREE.Group(); bg.position.set(bx0, 0, bz0); bg.rotation.y = rot;
            function bb(w, h, d, m, x, y, z) {
              var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
              ms.position.set(x, y, z); bg.add(ms); return ms;
            }
            for (var li = 0; li < 4; li++) // 床柱
              bb(0.09, 1.7, 0.09, steelD, li < 2 ? -0.95 : 0.95, 0.85, li % 2 ? -0.45 : 0.45);
            bb(2.0, 0.08, 1.0, steelD, 0, 0.42, 0);   // 下层床板
            bb(2.0, 0.08, 1.0, steelD, 0, 1.32, 0);   // 上层床板
            bb(1.9, 0.16, 0.9, cloth, 0, 0.54, 0);    // 下层床垫
            bb(1.9, 0.16, 0.9, cloth, 0, 1.44, 0);    // 上层床垫
            bb(0.5, 0.12, 0.7, cloth, -0.6, 0.66, 0); // 枕头
            W.reg(group, bg);
          }
          // 折叠椅 ×2
          for (var ci = 0; ci < 2; ci++) {
            var chT = takeFar(); if (!chT) break;
            var chx = BR.tileCX(chT[0]) + (rng.next() - 0.5), chz = BR.tileCZ(chT[1]) + (rng.next() - 0.5);
            var ch = new THREE.Group(); ch.position.set(chx, 0, chz); ch.rotation.y = rng.next() * 6.28;
            function cb(w, h, d, m, x, y, z) {
              var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
              ms.position.set(x, y, z); ch.add(ms); return ms;
            }
            cb(0.45, 0.05, 0.45, steelD, 0, 0.46, 0);      // 座面
            cb(0.45, 0.5, 0.05, steelD, 0, 0.75, 0.21);     // 靠背
            for (var lg = 0; lg < 4; lg++)                  // 椅腿
              cb(0.05, 0.46, 0.05, steel, lg < 2 ? -0.18 : 0.18, 0.23, lg % 2 ? -0.18 : 0.18);
            W.reg(group, ch);
          }
          // 临时置物架：立柱 + 层板 + 杂物箱/罐
          var shT = takeFar();
          if (shT) {
            var shx = BR.tileCX(shT[0]), shz = BR.tileCZ(shT[1]);
            var sh = new THREE.Group(); sh.position.set(shx, 0, shz); sh.rotation.y = (rng.next() * 2 | 0) * Math.PI / 2;
            function sb(w, h, d, m, x, y, z) {
              var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
              ms.position.set(x, y, z); sh.add(ms); return ms;
            }
            for (var si2 = 0; si2 < 4; si2++)
              sb(0.07, 1.8, 0.07, steelD, si2 < 2 ? -0.7 : 0.7, 0.9, si2 % 2 ? -0.35 : 0.35);
            for (var lv = 0; lv < 3; lv++) sb(1.5, 0.06, 0.8, steel, 0, 0.35 + lv * 0.6, 0);
            for (var bi2 = 0; bi2 < 5; bi2++) // 杂物
              sb(0.28 + rng.next() * 0.2, 0.25 + rng.next() * 0.25, 0.3, bi2 % 2 ? wood : cloth,
                (rng.next() - 0.5) * 1.0, 0.5 + ((rng.next() * 3) | 0) * 0.6, (rng.next() - 0.5) * 0.4);
            W.reg(group, sh);
          }
          // 膝盖高积水：半透明水面（0.45m），下透舱内钢板地面
          var pdT = takeFar();
          if (pdT) {
            var pdx = BR.tileCX(pdT[0]), pdz = BR.tileCZ(pdT[1]);
            var pm = new THREE.Mesh(
              new THREE.PlaneGeometry(2.6, 2.6),
              new THREE.MeshPhongMaterial({
                color: 0x3d5a66, transparent: true, opacity: 0.42,
                shininess: 120, specular: 0xaac4d0, depthWrite: false
              })
            );
            trackMat(W, pm.material);
            pm.rotation.x = -Math.PI / 2;
            pm.position.set(pdx, 0.45, pdz);
            W.reg(group, pm);
            L.puddleRect = { x0: pdx - 1.3, z0: pdz - 1.3, x1: pdx + 1.3, z1: pdz + 1.3 };
          }
        });
      })();

      /* ---- 5. 楼梯（可走） + 平台 + 甲板 + 栏杆 ---- */
      (function buildStairsDeck() {
        var dr = meta.deck, door = meta.door;
        var dnx = door.nx, dny = door.ny, deckH = meta.deckH;
        W.addChunkContent(door.tx, door.ty, function (group) {
          var steel = new THREE.MeshLambertMaterial({ color: 0x4e5357 });
          var steelD = new THREE.MeshLambertMaterial({ color: 0x35383b });
          trackMat(W, steel); trackMat(W, steelD);
          var deckMat = new THREE.MeshLambertMaterial({ map: BR.Textures.get('deck_plate') });
          trackMat(W, deckMat);
          function bx(w, h, d, m, x, y, z, ry) {
            var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
            ms.position.set(x, y, z);
            if (ry) ms.rotation.y = ry;
            W.reg(group, ms); return ms;
          }
          // 平台（门内侧 tile）：顶面 deckH
          bx(T, 0.1, T, deckMat, BR.tileCX(meta.landing.tx), deckH - 0.05, BR.tileCZ(meta.landing.ty));
          bx(T, deckH - 0.1, T, steelD, BR.tileCX(meta.landing.tx), (deckH - 0.1) / 2, BR.tileCZ(meta.landing.ty));
          // 楼梯：4 级台阶（坡道 tile 上，沿外法线上升）
          if (!meta.stair.flat) {
            var scx = BR.tileCX(meta.stair.tx), scz = BR.tileCZ(meta.stair.ty);
            for (var sN = 0; sN < 4; sN++) {
              var frac = (sN + 1) / 4; // 1..4 级，顶级接平台
              var off = -1.5 + (sN + 0.5) * 0.75; // 沿外法线 -1.125..+1.125
              bx(2.2, 0.09, 0.75, deckMat,
                scx + dnx * off - dny * 0, deckH * frac - 0.045,
                scz + dny * off + dnx * 0,
                dnx !== 0 ? Math.PI / 2 : 0);
            }
            // 楼梯侧板
            bx(0.08, deckH, 3.0, steelD, scx - dny * 1.15, deckH / 2, scz + dnx * 1.15, dnx !== 0 ? Math.PI / 2 : 0);
            bx(0.08, deckH, 3.0, steelD, scx + dny * 1.15, deckH / 2, scz - dnx * 1.15, dnx !== 0 ? Math.PI / 2 : 0);
          }
          // 甲板：浮筒平台（顶面 deckH），支撑柱入水
          var dX0 = dr.x0 * T, dZ0 = dr.y0 * T;
          var dW = (dr.x1 - dr.x0 + 1) * T, dD = (dr.y1 - dr.y0 + 1) * T;
          var dcx = dX0 + dW / 2, dcz = dZ0 + dD / 2;
          bx(dW, 0.12, dD, deckMat, dcx, deckH - 0.06, dcz);
          bx(dW, deckH - 0.12, dD, steelD, dcx, (deckH - 0.12) / 2, dcz);
          for (var pi = 0; pi < 4; pi++) { // 支撑柱
            var post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8), steelD);
            post.position.set(dX0 + (pi % 2 ? dW - 0.4 : 0.4), -0.6, dZ0 + (pi < 2 ? 0.4 : dD - 0.4));
            W.reg(group, post);
          }
          // 栏杆：甲板三边（门侧与停船侧开口）
          var railH = 1.0;
          function rail(x0, z0, x1, z1) {
            var len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / 1.5) + 1);
            for (var ri = 0; ri < n; ri++) {
              var k = ri / (n - 1);
              var rp = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, railH, 6), steel);
              rp.position.set(x0 + (x1 - x0) * k, deckH + railH / 2, z0 + (z1 - z0) * k);
              W.reg(group, rp);
            }
            var top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), steel);
            top.position.set((x0 + x1) / 2, deckH + railH, (z0 + z1) / 2);
            top.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
            W.reg(group, top);
          }
          // 外边缘（远离舱室的一边）+ 两侧（停船侧留开口：只建一半）
          var ox = dnx, oz = dny; // 外法线
          var fx0 = dcx + ox * dW / 2 * Math.abs(ox) + ox * dD / 2 * Math.abs(oz);
          // 简化：外边整段栏杆；两侧各半段（靠外一半），门侧不建
          if (Math.abs(ox) > 0.5) { // 门在 ±x 墙
            var xe = dcx + ox * dW / 2;
            rail(xe, dZ0, xe, dZ0 + dD);
            rail(dcx - ox * dW / 2, dZ0, xe, dZ0);
            rail(dcx - ox * dW / 2, dZ0 + dD, xe, dZ0 + dD);
          } else { // 门在 ±z 墙
            var ze = dcz + oz * dD / 2;
            rail(dX0, ze, dX0 + dW, ze);
            rail(dX0, dcz - oz * dD / 2, dX0, ze);
            rail(dX0 + dW, dcz - oz * dD / 2, dX0 + dW, ze);
          }
          W.addSurfaceZone(dX0, dZ0, dX0 + dW, dZ0 + dD, 'metal');
        });
      })();

      /* ---- 6. 字条 + 补给箱 ---- */
      poiList(map, 'note').forEach(function (p) {
        if (p.data.noteId === 'L7_entry') addNote7(W, p.tx, p.ty, L7_ENTRY_NOTE[0], L7_ENTRY_NOTE[1]);
      });
      poiList(map, 'cache').forEach(function (p) {
        var id = 'l7cache_' + p.tx + '_' + p.ty;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = new THREE.Group();
          g.position.set(BR.tileCX(p.tx), 0, BR.tileCZ(p.ty));
          var wood = W.mat('crate');
          var boxM = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.8, 1.05), wood);
          boxM.position.y = 0.4; g.add(boxM);
          var lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 1.05), wood);
          lid.position.y = 0.86; g.add(lid);
          W.reg(group, g);
          W.addInteractable({
            id: id, kind: 'cache', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [boxM, lid], pos: g.position.clone().add(new THREE.Vector3(0, 1, 0)), radius: 2.6,
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

      /* ---- 7. 舱盖门：推开见海（步行出舱，不传送） ---- */
      poiList(map, 'entry_door').forEach(function (p) {
        var doorId = p.data.doorId;
        W.addDoor({
          id: doorId, tx: p.tx, ty: p.ty, axis: p.data.axis || 'x', locked: false,
          label: '舱盖',
          prompt: function () { return '推开舱盖'; },
          use: function (d) {
            W.setDoor(doorId, true);
            BR.Audio.doorCreak();
            BR.UI.toast('舱盖外是灰色的海。风里有咸腥味。', 2600);
          }
        });
      });

      /* ---- 8. 小船：停靠在甲板侧（BR.Mounts 注册 + 场景级实例） ---- */
      (function buildBoat() {
        var moor = poiList(map, 'boat_mooring')[0];
        var bx = moor ? moor.data.x : ocx + 6, bz = moor ? moor.data.z : ocz + 6;
        var byaw = moor ? moor.data.yaw : 0;
        var dr = meta.deck;
        var boat = boatFactory(W, {
          x: bx, z: bz, yaw: byaw,
          seaY: seaY,
          timeFn: function () { return L.t; },
          bounds: { x0: ox0w + 2, z0: oz0w + 2, x1: ox1w - 2, z1: oz1w - 2 },
          blockedFn: function (x, z) {
            // 甲板区（tile 矩形）不可驶入；墙 tile 不可驶入
            if (x >= dr.x0 * T - 0.6 && x <= (dr.x1 + 1) * T + 0.6 &&
                z >= dr.y0 * T - 0.6 && z <= (dr.y1 + 1) * T + 0.6) return true;
            return W.isWall(Math.floor(x / T), Math.floor(z / T));
          }
        });
        // 读档恢复位置（不复制不消失）
        if (W.state && W.state.boatSave) boat.applySave(W.state.boatSave);
        W.scene.add(boat.mesh);
        trackScene(boat.mesh);
        boat.mesh._l7handle = boat;
        L.boat = boat;
        var itDef = {
          id: 'l7_boat', kind: 'boat', chunkKey: W.chunkKeyOf(Math.floor(bx / T), Math.floor(bz / T)),
          meshes: (function () { var ms = []; boat.mesh.traverse(function (o) { if (o.isMesh) ms.push(o); }); return ms; })(),
          pos: new THREE.Vector3(bx, 1, bz), radius: 3.4,
          prompt: function () { return boat.isRiding() ? '下船' : '登船'; },
          canUse: function () { return !BR.Cutout || !BR.Cutout.busy; },
          use: function () {
            if (boat.isRiding()) boat.dismount(BR.Player);
            else boat.board(BR.Player);
          }
        };
        boat._itDef = itDef;
        W.addInteractable(itDef);
        if (W.INTERACT_KINDS && W.INTERACT_KINDS.indexOf('boat') < 0)
          W.INTERACT_KINDS.push('boat');
      })();

      /* ---- 9. 深水区：低能见度覆层（视觉） + Swim zone 注册 ---- */
      poiList(map, 'deep_zone').forEach(function (p) {
        var zx = BR.tileCX(p.tx), zz = BR.tileCZ(p.ty);
        var zr = (p.data.r || 7) * T;
        L.deepZones.push({ x: zx, z: zz, r: zr, depth: p.data.depth || 1 });
        W.addChunkContent(p.tx, p.ty, function (group) {
          var dm = new THREE.Mesh(
            new THREE.CircleGeometry(zr, 24),
            new THREE.MeshBasicMaterial({ color: 0x050a0e, transparent: true, opacity: 0.30 + 0.10 * (p.data.depth || 1), depthWrite: false })
          );
          trackMat(W, dm.material);
          dm.rotation.x = -Math.PI / 2;
          dm.position.set(zx, SURF + 0.02, zz);
          W.reg(group, dm);
        });
      });

      /* ---- 10. 深处出口（→L37）：瓷砖结构残片 + 光柱 + 气泡 ----
       * 触发：潜入结构内部（水平 <2.4m 且深度接近）才切换；不按高度全图传送。
       * 位置：最深水区，深度约 -9m（游戏尺度），氧气/补给可达。 */
      poiList(map, 'deep_exit').forEach(function (p) {
        var ex = BR.tileCX(p.tx), ez = BR.tileCZ(p.ty);
        var gy = -9; // 结构中心深度（游戏尺度改编）
        var eid = 'l7_deep_exit';
        L.gate = { x: ex, y: gy, z: ez, bubbles: null, glowMat: null, shaftMat: null, used: false };
        W.addChunkContent(p.tx, p.ty, function (group) {
          var tileM = new THREE.MeshLambertMaterial({ map: BR.Textures.get('pool_tile') });
          trackMat(W, tileM);
          // 倾斜的瓷砖残片框架（呼应 L37 泳池房）
          var frame = new THREE.Group();
          frame.position.set(ex, gy, ez);
          frame.rotation.z = 0.21; frame.rotation.x = -0.12;
          function fb(w, h, d, x, y, z) {
            var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tileM);
            m.position.set(x, y, z); frame.add(m); return m;
          }
          fb(3.4, 0.35, 0.35, 0, 2.0, 0); fb(3.4, 0.35, 0.35, 0, -2.0, 0);
          fb(0.35, 4.35, 0.35, -1.55, 0, 0); fb(0.35, 4.35, 0.35, 1.55, 0, 0);
          W.reg(group, frame);
          // 内部微光
          var glow = new THREE.Mesh(
            new THREE.PlaneGeometry(2.6, 3.6),
            new THREE.MeshBasicMaterial({
              color: 0x9fdcff, transparent: true, opacity: 0.35,
              blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
            })
          );
          trackMat(W, glow.material);
          glow.position.set(ex, gy, ez);
          glow.rotation.y = 0.4;
          W.reg(group, glow);
          L.gate.glowMat = glow.material;
          // 上升光柱（水面可见的视觉线索）
          var shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(1.0, 1.6, 11, 12, 1, true),
            new THREE.MeshBasicMaterial({
              color: 0x6fc4e8, transparent: true, opacity: 0.16,
              blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
            })
          );
          trackMat(W, shaft.material);
          shaft.position.set(ex, gy + 5.5, ez);
          W.reg(group, shaft);
          L.gate.shaftMat = shaft.material;
          // 冷光（随区块释放的独立光源）
          var gl2 = new THREE.PointLight(0x86cfe8, 0.9, 20, 2);
          gl2.position.set(ex, gy + 1, ez);
          W.reg(group, gl2);
          // 气泡粒子
          var bn = 46, bp = new Float32Array(bn * 3), bseed = [];
          var brng = new BR.RNG(BR.hashSeed(map.seed + ':l7bubbles'));
          for (var bi = 0; bi < bn; bi++) {
            bp[bi * 3] = ex + (brng.next() - 0.5) * 2.4;
            bp[bi * 3 + 1] = gy - 2 + brng.next() * 4;
            bp[bi * 3 + 2] = ez + (brng.next() - 0.5) * 2.4;
            bseed.push(brng.next() * 6.28);
          }
          var bgeo = new THREE.BufferGeometry();
          bgeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
          var bmat = new THREE.PointsMaterial({ color: 0xbfe8ff, size: 0.14, transparent: true, opacity: 0.7, depthWrite: false });
          trackMat(W, bmat);
          var pts = new THREE.Points(bgeo, bmat);
          W.reg(group, pts);
          L.gate.bubbles = { pts: pts, seed: bseed, n: bn, x: ex, y: gy, z: ez };
        });
      });

      /* ---- 11. 异常切出点：水面不反光的区域 →L0（需观察发现） ---- */
      poiList(map, 'anomaly_exit').forEach(function (p) {
        var ax = BR.tileCX(p.tx), az = BR.tileCZ(p.ty);
        var aid = 'l7_anomaly_exit';
        W.addChunkContent(p.tx, p.ty, function (group) {
          var patch = new THREE.Mesh(
            new THREE.CircleGeometry(2.0, 20),
            new THREE.MeshBasicMaterial({ color: 0x010304, transparent: true, opacity: 0.88, depthWrite: false })
          );
          trackMat(W, patch.material);
          patch.rotation.x = -Math.PI / 2;
          patch.position.set(ax, SURF + 0.03, az);
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

      /* ---- 12. Swim 水 zone 注册（深水优先；舱室/甲板抠干洞） ---- */
      if (BR.Swim) {
        if (typeof BR.Swim.clearZones === 'function') BR.Swim.clearZones();
        if (typeof BR.Swim.registerZone === 'function') {
          // 膝盖高积水（舱内）：depth 0.3 → 涉行；waterY 0.45
          if (L.puddleRect) {
            BR.Swim.registerZone({
              kind: 'puddle', depth: 0.3, waterY: 0.45,
              x0: L.puddleRect.x0, z0: L.puddleRect.z0,
              x1: L.puddleRect.x1, z1: L.puddleRect.z1
            });
          }
          // 深水区（游戏尺度：海床 -10/-16/-24m）
          var floors = [-10, -16, -24];
          L.deepZones.forEach(function (z) {
            var zo = BR.Swim.registerZone({
              kind: 'deep', depth: z.depth, cx: z.x, cz: z.z, r: z.r,
              waterY: SURF
            });
            // 注：BR.Swim.registerZone 只透传 kind/depth/waterY/holes/形状，
            // 不复制 floor 字段（L37 未用该字段）。深海需要真实可下潜深度，
            // 这里在返回的 zone 对象（即 zones 数组内同一引用）上直接补物理海床。
            if (zo) zo.floor = floors[(z.depth - 1)] || -16;
          });
          // 海面大 zone（游戏尺度：海床 -26m；holes 抠掉舱室与甲板）
          var dr2 = meta.deck;
          var oz = BR.Swim.registerZone({
            kind: 'ocean', depth: 1.6, waterY: SURF, floor: -26,
            x0: ox0w, z0: oz0w, x1: ox1w, z1: oz1w,
            holes: [
              { x0: (entry.x - 1) * T, z0: (entry.y - 1) * T, x1: (entry.x + entry.w + 1) * T, z1: (entry.y + entry.h + 1) * T },
              { x0: dr2.x0 * T - 0.4, z0: dr2.y0 * T - 0.4, x1: (dr2.x1 + 1) * T + 0.4, z1: (dr2.y1 + 1) * T + 0.4 }
            ]
          });
          if (oz) oz.floor = -26;
        }
        BR.Swim.speedMul = 1; // 出生点干燥：复位
      }

      /* ---- 13. 深海实体：环境演出系统（非追逐怪） ----
       * 远处巨大不完整轮廓 + 极低频声 + 局部水面变化 + 超尺度身体局部；
       * 从不靠近玩家（<40m 则消退重排），从不完整出镜。 */
      (function initEntity() {
        var anchors = poiList(map, 'disturbance').map(function (p) {
          return { x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty) };
        });
        var home = poiList(map, 'leviathan')[0];
        var erng = new BR.RNG(BR.hashSeed(map.seed + ':l7entity'));
        L.entity = {
          anchors: anchors,
          homeX: home ? BR.tileCX(home.tx) : ocx,
          homeZ: home ? BR.tileCZ(home.ty) : ocz,
          rng: erng,
          nextSil: 55 + erng.next() * 70,   // 远影：55~125s 后首次
          sil: null, silT: 0,
          nextSurf: 170 + erng.next() * 130, // 身体局部出水：170~300s 后首次
          surf: null, surfT: 0,
          nextBoom: 30 + erng.next() * 40,   // 纯声音动静
          rings: [] // 水面扰动环
        };
      })();

      W.objective = '在深海中找到离开的方法。舱室是安全的——推开舱盖，看看外面的海。';
    },

    onEnter: function () {
      if (BR.Swim) BR.Swim._dryAmb = 'L7';
      BR.UI.setObjective(BR.World.objective || '探索 Level 7');
      BR.Audio.setAmbient('L7');
      if (BR.World._l7) BR.World._l7.t = 0;
      BR.UI.toast('舱室里很安静。舱盖在楼梯上面。', 3600);
    },

    /* ---------- 深海实体：远影 ---------- */
    _spawnSilhouette: function (W, L) {
      var P = BR.Player, E = L.entity, rng = E.rng;
      // 选锚点：距玩家 60~110m 优先，否则随机远点
      var cands = E.anchors.filter(function (a) {
        var d = Math.hypot(a.x - P.pos.x, a.z - P.pos.z);
        return d >= 55 && d <= 115;
      });
      var ax, az;
      if (cands.length) { var c = cands[(rng.next() * cands.length) | 0]; ax = c.x; az = c.z; }
      else {
        var ang = rng.next() * 6.2832, r = 70 + rng.next() * 30;
        ax = P.pos.x + Math.cos(ang) * r; az = P.pos.z + Math.sin(ang) * r;
      }
      var g = new THREE.Group();
      var mat = new THREE.MeshBasicMaterial({ color: 0x0a1116, transparent: true, opacity: 0 });
      trackMat(W, mat);
      // 不完整轮廓：三段错开的巨大暗影（只在水下隐约可见）
      var s1 = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
      s1.scale.set(22, 5, 7); s1.position.set(0, 0, 0); g.add(s1);
      var s2 = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
      s2.scale.set(13, 3.4, 4.5); s2.position.set(20, 1.5, 6); s2.rotation.y = 0.5; g.add(s2);
      var s3 = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
      s3.scale.set(9, 2.6, 3.6); s3.position.set(-19, -1, -5); s3.rotation.y = -0.4; g.add(s3);
      g.position.set(ax, -4.5, az);
      g.rotation.y = rng.next() * 6.28;
      W.scene.add(g);
      trackScene(g);
      E.sil = { g: g, mat: mat, x: ax, z: az };
      E.silT = 0;
      this._rumbleSwell(L, 0.5, 14);
      L.chopTarget = 1.8; // 局部水面变化：浪涌增强
    },
    _updateSilhouette: function (W, L, dt) {
      var E = L.entity, P = BR.Player;
      if (!E.sil) return;
      E.silT += dt;
      var d = Math.hypot(E.sil.x - P.pos.x, E.sil.z - P.pos.z);
      var m = E.sil.mat, done = false;
      if (d < 42) { // 靠太近：消退，绝不近距离出镜
        m.opacity = Math.max(0, m.opacity - dt * 0.25);
        if (m.opacity <= 0) done = true;
      } else if (E.silT < 8) m.opacity = Math.min(0.34, m.opacity + dt * 0.05);      // 显现
      else if (E.silT < 20) m.opacity = 0.30 + Math.sin(E.silT * 0.8) * 0.05;        // 悬留
      else { m.opacity = Math.max(0, m.opacity - dt * 0.04); if (m.opacity <= 0) done = true; } // 消退
      E.sil.g.position.y = -4.5 + Math.sin(E.silT * 0.5) * 1.2; // 缓慢沉浮
      if (done) {
        var idx = sceneObjs.indexOf(E.sil.g);
        if (idx >= 0) sceneObjs.splice(idx, 1);
        W.scene.remove(E.sil.g);
        E.sil.g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
        try { m.dispose(); } catch (e) {}
        E.sil = null;
        E.nextSil = 100 + E.rng.next() * 90; // 下一次：100~190s 后（不许频繁出镜）
        L.chopTarget = 1;
      }
    },

    /* ---------- 深海实体：超尺度身体局部出水 ---------- */
    _spawnSurfacing: function (W, L) {
      var P = BR.Player, E = L.entity, rng = E.rng;
      var ang = rng.next() * 6.2832, r = 42 + rng.next() * 18; // 42~60m：只许远观
      var ax = P.pos.x + Math.cos(ang) * r, az = P.pos.z + Math.sin(ang) * r;
      var g = new THREE.Group();
      var mat = new THREE.MeshLambertMaterial({ color: 0x0b1013 });
      trackMat(W, mat);
      // 巨大弧形躯体局部（只是一段，永不完整）
      var arc = new THREE.Mesh(new THREE.TorusGeometry(15, 2.8, 8, 20, 1.15), mat);
      arc.rotation.z = Math.PI / 2 - 0.55;
      arc.rotation.y = rng.next() * 6.28;
      g.add(arc);
      g.position.set(ax, -9, az);
      W.scene.add(g);
      trackScene(g);
      E.surf = { g: g, x: ax, z: az, witnessed: false };
      E.surfT = 0;
      this._rumbleSwell(L, 0.85, 10);
      L.chopTarget = 2.2;
      // 水花扰动环
      for (var i = 0; i < 3; i++) {
        var ring = new THREE.Mesh(
          new THREE.RingGeometry(1, 1.5, 28),
          new THREE.MeshBasicMaterial({ color: 0x9fb8c2, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
        );
        trackMat(W, ring.material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(ax, 0.2, az);
        W.scene.add(ring);
        trackScene(ring);
        E.rings.push({ m: ring, t: -i * 0.8 });
      }
      BR.UI.toast('远处的海面……有什么东西翻了一下。', 3000);
    },
    _updateSurfacing: function (W, L, dt) {
      var E = L.entity, P = BR.Player;
      if (!E.surf) return;
      E.surfT += dt;
      var t = E.surfT, g = E.surf.g;
      // 9 秒：上浮 → 悬留 → 下潜
      var y;
      if (t < 3) y = -9 + (t / 3) * 12.5;
      else if (t < 5.5) y = 3.5 + Math.sin((t - 3) * 2.2) * 0.5;
      else y = 3.5 - ((t - 5.5) / 3.5) * 12.5;
      g.position.y = y;
      // 目击判定：注视 + 70m 内 → 轻微理智冲击（一次）
      if (!E.surf.witnessed && t > 1 && t < 8) {
        var dx = E.surf.x - P.pos.x, dz = E.surf.z - P.pos.z;
        var d = Math.hypot(dx, dz);
        if (d < 70) {
          var fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
          if ((dx * fx + dz * fz) / Math.max(0.001, d) > 0.45) {
            E.surf.witnessed = true;
            P.drainSanity(4);
            BR.UI.toast('你看到的……只是它身体的一小部分。', 3200);
          }
        }
      }
      // 扰动环扩散（实体出水的大环；船涟漪 small 由 _updateBoatRipples 专管，这里跳过防双重驱动）
      for (var i = E.rings.length - 1; i >= 0; i--) {
        var rg = E.rings[i];
        if (rg.small) continue;
        rg.t += dt;
        if (rg.t < 0) continue;
        var s = 2 + rg.t * 7;
        rg.m.scale.set(s, s, 1);
        rg.m.material.opacity = Math.max(0, 0.5 - rg.t * 0.16);
        if (rg.m.material.opacity <= 0) {
          var ix = sceneObjs.indexOf(rg.m);
          if (ix >= 0) sceneObjs.splice(ix, 1);
          W.scene.remove(rg.m);
          rg.m.geometry.dispose();
          try { rg.m.material.dispose(); } catch (e) {}
          E.rings.splice(i, 1);
        }
      }
      if (t >= 9) {
        var idx = sceneObjs.indexOf(g);
        if (idx >= 0) sceneObjs.splice(idx, 1);
        W.scene.remove(g);
        g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
        E.surf = null;
        E.nextSurf = 200 + E.rng.next() * 120; // 下一次：200~320s 后
        L.chopTarget = 1;
      }
    },

    /* ---------- 极低频声（infrasound）：事件 swell ---------- */
    _ensureRumble: function (L) {
      if (L.rumble || !BR.Audio._ok || !BR.Audio._ctx) return;
      try {
        var ctx = BR.Audio._ctx;
        var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 26;
        var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 39;
        var g = ctx.createGain(); g.gain.value = 0;
        o1.connect(g); o2.connect(g);
        g.connect(BR.Audio._sfx || BR.Audio._master || ctx.destination);
        o1.start(); o2.start();
        L.rumble = { g: g };
      } catch (e) { L.rumble = null; }
    },
    _rumbleSwell: function (L, peak, dur) {
      this._ensureRumble(L);
      L.rumbleTarget = Math.max(L.rumbleTarget, peak);
      L._rumbleHold = Math.max(L._rumbleHold || 0, dur);
    },

    /* ---------- 船边扰动：船周小涟漪 ---------- */
    _boatRipples: { n: 0 },
    _updateBoatRipples: function (W, L, dt) {
      var B = L.boat;
      if (!B) return;
      var moving = Math.hypot(B.state.vx, B.state.vz) > 0.6;
      this._boatRipples.n += dt;
      if (moving && this._boatRipples.n > 0.55) {
        this._boatRipples.n = 0;
        var ring = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1.15, 24),
          new THREE.MeshBasicMaterial({ color: 0xaac2cc, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide })
        );
        trackMat(W, ring.material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(B.state.x, L.seaY(B.state.x, B.state.z, L.t) + 0.06, B.state.z);
        W.scene.add(ring);
        trackScene(ring);
        L.entity.rings.push({ m: ring, t: 0, small: true });
      }
      // 复用 entity.rings 做涟漪扩散（small 标记：更快消失）
      var R = L.entity.rings;
      for (var i = R.length - 1; i >= 0; i--) {
        var rg = R[i];
        if (!rg.small) continue;
        rg.t += dt;
        var s = 1 + rg.t * 2.4;
        rg.m.scale.set(s, s, 1);
        rg.m.position.y = L.seaY(rg.m.position.x, rg.m.position.z, L.t) + 0.06;
        rg.m.material.opacity = Math.max(0, 0.4 - rg.t * 0.5);
        if (rg.m.material.opacity <= 0) {
          var ix = sceneObjs.indexOf(rg.m);
          if (ix >= 0) sceneObjs.splice(ix, 1);
          W.scene.remove(rg.m);
          rg.m.geometry.dispose();
          try { rg.m.material.dispose(); } catch (e) {}
          R.splice(i, 1);
        }
      }
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player, L = W._l7;
      if (!P || BR.Game.state !== 'playing' || !L) return;
      L.t += dt;
      var t = L.t;

      // Swim：水 zone / 闭气（头部浸没才耗氧：BR.Swim.tick 按 headUnder 判定）
      if (BR.Swim && typeof BR.Swim.tick === 'function') BR.Swim.tick(dt);

      // 海面顶点波（单网格；法线隔帧重算）
      if (L.seaGeo) {
        var pos = L.seaGeo.attributes.position, arr = pos.array, base = L._seaBase;
        for (var vi = 0; vi < pos.count; vi++) {
          var bx0 = base[vi * 3], bz0 = base[vi * 3 + 2];
          arr[vi * 3 + 1] = this._seaYAt(L, bx0, bz0, t);
        }
        pos.needsUpdate = true;
        L._nrmTick = (L._nrmTick || 0) + 1;
        if (L._nrmTick % 2 === 0) L.seaGeo.computeVertexNormals();
      }
      // 云层漂移
      for (var ci = 0; ci < L.cloudTexs.length; ci++) {
        var c = L.cloudTexs[ci];
        if (c.tex) { c.tex.offset.x = (t * c.sp) % 1; }
      }
      // 浪涌系数回归
      L.chop += (L.chopTarget - L.chop) * Math.min(1, dt * 0.5);

      // 小船：乘船时由 P.update 经 mountHandle 驱动（W8 契约）；
      // 未乘时关卡 tick 驱动漂流/波浪/存档，避免一帧调两次
      if (L.boat) {
        try { if (!L.boat.isRiding()) L.boat.update(dt, null, P); } catch (e) {}
        this._updateBoatRipples(W, L, dt);
      }

      // 深处出口：潜入结构内部才触发（水平<2.4m 且深度接近；不按高度全图传送）
      var G = L.gate;
      if (G && !G.used && !(BR.Cutout && BR.Cutout.busy)) {
        var hd = Math.hypot(P.pos.x - G.x, P.pos.z - G.z);
        var vd = Math.abs(P.pos.y - G.y);
        var headUnder = !!(BR.Swim && BR.Swim.headUnder);
        if (hd < 2.4 && vd < 3.2 && headUnder) {
          G.used = true;
          BR.UI.toast('你游进了那截发光的结构……水流把你往里带。', 2400);
          setTimeout(function () { goL37(); }, 1200);
        }
        // 气泡上升 + 微光呼吸
        if (G.bubbles) {
          var bp = G.bubbles.pts.geometry.attributes.position, bn = G.bubbles.n;
          for (var bi = 0; bi < bn; bi++) {
            var yy = bp.array[bi * 3 + 1] + dt * (0.5 + (bi % 5) * 0.12);
            if (yy > G.bubbles.y + 2.4) yy = G.bubbles.y - 2;
            bp.array[bi * 3 + 1] = yy;
            bp.array[bi * 3] = G.bubbles.x + Math.sin(t * 1.4 + G.bubbles.seed[bi]) * 1.2;
          }
          bp.needsUpdate = true;
        }
        if (G.glowMat) G.glowMat.opacity = 0.30 + 0.12 * Math.sin(t * 2.1);
        if (G.shaftMat) G.shaftMat.opacity = 0.13 + 0.05 * Math.sin(t * 1.3);
      }

      // 深海实体调度（长周期；不许频繁出镜）
      var E = L.entity;
      if (E) {
        E.nextSil -= dt; E.nextSurf -= dt; E.nextBoom -= dt;
        if (E.nextSil <= 0 && !E.sil) this._spawnSilhouette(W, L);
        if (E.nextSurf <= 0 && !E.surf) this._spawnSurfacing(W, L);
        if (E.nextBoom <= 0) {
          E.nextBoom = 50 + E.rng.next() * 45;
          this._rumbleSwell(L, 0.3, 7); // 纯声音：远处闷响
        }
        this._updateSilhouette(W, L, dt);
        this._updateSurfacing(W, L, dt);
      }
      // 极低频包络
      if (L._rumbleHold > 0) L._rumbleHold -= dt;
      else L.rumbleTarget = Math.max(0, L.rumbleTarget - dt * 0.12);
      if (L.rumble) {
        try {
          var gv = L.rumble.g.gain;
          gv.setTargetAtTime(Math.min(0.9, L.rumbleTarget), BR.Audio._ctx.currentTime, 1.2);
        } catch (e) {}
      }

      // 水下视觉：有限透光（非蓝色滤镜）—— Swim.tick 之后覆盖雾色
      var hu = !!(BR.Swim && BR.Swim.headUnder);
      if (W.scene && W.scene.fog) {
        if (hu) {
          // 深水附加：越深越暗（gate 深度约 -9m；按玩家深度微调 fog）
          var depthK = Math.max(0, Math.min(1, (0.15 - P.pos.y) / 12));
          W.scene.fog.color.setHex(0x0a1216);
          var wantFar = 13 - depthK * 5;
          W.scene.fog.far += (wantFar - W.scene.fog.far) * Math.min(1, dt * 2);
        }
      }
      if (typeof document !== 'undefined')
        document.body.classList.toggle('l7deep', hu);

      // 深水区理智侵蚀（叠加在黑暗侵蚀之上；系数随 depth 1..3）
      if (BR.Swim && typeof BR.Swim.zoneAt === 'function') {
        var szn = BR.Swim.zoneAt(P.pos.x, P.pos.z);
        if (szn && szn.kind === 'deep') P.drainSanity(dt * (1.0 + 0.8 * (szn.depth || 1)));
      }
    },

    _seaYAt: function (L, x, z, t) {
      return L.seaY(x, z, t);
    }
  };
})();
