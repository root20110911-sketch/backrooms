/* lv_l7.js —— Level 7「深海恐惧症」关卡内容（v2.0 P2 四深度带 + 七层之物真 AI）
 * Fandom 版：金属舱室入口 → 舱盖/甲板 → 露天阴天海洋（小船）→ 四深度带（七层之物/深水区/L37 门）
 * 距离/深度均为游戏尺度改编（见 LORE.md），非原著数值。
 *
 * 七层之物 AI 的原著依据（A 路研究）：
 *  - 畏光 [Wikidot]：永居黑暗的眼睛对光极敏感，可用强光压制 → 手电直射驱散
 *  - 噪音招引 [Fandom]：无意的声响都可能引起它注意 → 保持安静/静止是反制
 *  - 巨浪而非主动捕食 [Fandom]：致命遭遇是它受惊逃窜掀起的巨浪 → strike=环境杀（巨浪+击退+伤害）
 *  - 栖息带 [Wikidot]：午夜带与深渊带上部 → 日光带/暮光带安全
 *  - L7↔L37 出入口两社区均无记载 → 深处门→L37 保持[本游戏改编]标注（LORE.md）
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

  /* ---- 四深度带：水面逐顶点颜色（v2.0 P2；与贴图相乘） ----
   * 日光带较亮青 → 暮光带转冷 → 午夜带深暗 → 深渊带近黑 */
  var SEA_COLS = [
    [0.60, 0.83, 0.84],
    [0.42, 0.59, 0.65],
    [0.22, 0.32, 0.38],
    [0.10, 0.15, 0.19]
  ];
  /* ---- 四深度带：水下雾（颜色/距离；Swim.tick 存雾之后再覆盖） ---- */
  var UW_FOG_COL = [0x1a4a56, 0x102e38, 0x060d12, 0x020507];
  var UW_FOG_FAR = [26, 18, 10, 7];
  var _uwTmpColor = null; // 懒初始化（Node 测试加载本文件时不碰 THREE）

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
    '5. 如果看到水面上有不反光的地方……那可能是条路。\n' +
    '6. 墙角那台破储物柜里有潜水服——下深水之前先穿上它。柜门掉了一半，但里面的东西还能用。\n\n——M.'
  ];

  // 值班表（贴在舱壁上）+ 航海日志残页（抽屉里）：纯叙事字条，不给机制
  var L7_DUTY_NOTE = [
    '发黄的值班表',
    '值班表（残页）\n\n' +
    '03:00 – 09:00　陈\n' +
    '09:00 – 15:00　M.\n' +
    '15:00 – 21:00　陈\n' +
    '21:00 – 03:00　（空）\n\n' +
    '下面有一行潦草的字：\n' +
    '“水位又涨了。上面说这周就撤，能带走的都带走，带不走的锁进柜子。\n' +
    '潜水服留给后来的人——如果还有后来的人。”'
  ];
  var L7_LOG_NOTE = [
    '发黄的航海日志残页',
    '……（前页缺失）\n\n' +
    '“第七天。水下那个发光的东西还在，它不像是灯，更像是瓷砖自己在发光。\n' +
    '老陈说别靠近，我同意。这地方不对劲，海也不对劲。\n\n' +
    '氧气只剩两瓶，舢板还能用。涨水之前我们必须走。\n' +
    '柜子上了锁，钥匙在老地方——开玩笑的，钥匙我弄丢了。”\n\n' +
    '……（后页缺失）'
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
      // 开放水域：物理海床按深度带 -6/-14/-26/-44（游戏尺度）。
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
        bands: null, debris: null, plankton: null, abyssLights: null
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

      /* ---- 0. 海洋 tile：去天花板（露天）；去室内迷宫墙体（只留舱室外墙） ----
       * v2.0 P2：全图处理——海洋矩形边界及以外的一切墙体都不再渲染
       * （视觉无边界：玩家到边缘看到的是雾+海平线+远景裙边），
       * 碰撞仍读 map.tiles（tile 0 挡住，边界无形但拦得住）。
       * 例外：入口舱室外扩一圈（inRing）的墙体保留。 */
      (function openOcean() {
        var ringX0 = entry.x - 1, ringY0 = entry.y - 1;
        var ringX1 = entry.x + entry.w, ringY1 = entry.y + entry.h;
        var mw = W.map.w, mh = W.map.h;
        function oceanFloor(tx, ty) {
          if (tx < oc.x0 || tx > oc.x1 || ty < oc.y0 || ty > oc.y1) return false;
          return W.map.tiles[ty * mw + tx] === 1;
        }
        for (var ty = 0; ty < mh; ty++) {
          for (var tx = 0; tx < mw; tx++) {
            var inRing = tx >= ringX0 && tx <= ringX1 && ty >= ringY0 && ty <= ringY1;
            if (inRing) continue; // 舱室外墙保留
            var tv = W.map.tiles[ty * mw + tx];
            if (tv === 1) { W.setOpenCeil(tx, ty); continue; } // 海洋/残留房间地板：露天
            if (tv === 0) {
              // 与海洋地板相邻 → 跳过（边界一圈 + 障碍物 tile 的默认墙体）；
              // 在海洋矩形之外 → 一律跳过（残留房间/地图边缘，不许出现墙/虚空穿帮）
              var outside = tx < oc.x0 || tx > oc.x1 || ty < oc.y0 || ty > oc.y1;
              var nb = oceanFloor(tx + 1, ty) || oceanFloor(tx - 1, ty) ||
                       oceanFloor(tx, ty + 1) || oceanFloor(tx, ty - 1);
              if (nb || outside) W.skipWall(tx, ty);
            }
          }
        }
        // 甲板 tile 也在露天下
        var dr = meta.deck;
        for (var dty = dr.y0; dty <= dr.y1; dty++)
          for (var dtx = dr.x0; dtx <= dr.x1; dtx++) W.setOpenCeil(dtx, dty);
      })();

      /* ---- 海面按深度带逐顶点着色（v2.0 P2；与 sea_detail 贴图相乘） ---- */
      function bandColorAt(x, z, out) {
        var bands = meta.bands, b0 = bands[0];
        var dt0 = Math.hypot(x / T - b0.ccx, z / T - b0.ccy);
        var bi = 3;
        for (var i = 0; i < 4; i++) { if (dt0 <= bands[i].r1) { bi = i; break; } }
        var FE = 2.5, cA = SEA_COLS[bi], cB = cA, k = 0; // 边界羽化
        if (bi < 3 && bands[bi].r1 - dt0 < FE) { cB = SEA_COLS[bi + 1]; k = 1 - (bands[bi].r1 - dt0) / FE; }
        if (bi > 0 && dt0 - bands[bi].r0 < FE) {
          var k2 = 1 - (dt0 - bands[bi].r0) / FE;
          if (k2 > k) { cB = SEA_COLS[bi - 1]; k = k2; }
        }
        out[0] = cA[0] + (cB[0] - cA[0]) * k;
        out[1] = cA[1] + (cB[1] - cA[1]) * k;
        out[2] = cA[2] + (cB[2] - cA[2]) * k;
      }
      function paintSeaColors(geo) {
        var pos = geo.attributes.position, n = pos.count;
        var cols = new Float32Array(n * 3), tmp = [0, 0, 0];
        for (var i = 0; i < n; i++) {
          bandColorAt(pos.array[i * 3], pos.array[i * 3 + 2], tmp);
          cols[i * 3] = tmp[0]; cols[i * 3 + 1] = tmp[1]; cols[i * 3 + 2] = tmp[2];
        }
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      }

      /* ---- 1. 海面：整片海洋单张连续网格（无接缝） + 天空反射 ---- */
      (function buildSea() {
        var geo = new THREE.PlaneGeometry(ox1w - ox0w, oz1w - oz0w, 72, 72);
        geo.rotateX(-Math.PI / 2);
        geo.translate(ocx, 0, ocz);
        paintSeaColors(geo); // v2.0 P2：日光带亮青 → 深渊带近黑
        var mat = new THREE.MeshPhongMaterial({
          color: 0xffffff, specular: 0x8fa3ad, shininess: 90,
          map: BR.Textures.get('sea_detail'),
          transparent: true, opacity: 0.93, side: THREE.DoubleSide,
          vertexColors: true
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

      /* ---- 1b. 远景水面裙边（v2.0 P2）：大平面延伸到雾外，海洋无可见边界 ----
       * 与内层海面用同一套带着色函数，矩形边缘处颜色连续；
       * 雾（fogFar 130）之外全雾色，玩家到地图边缘看到的是雾+海平线。 */
      (function buildSeaSkirt() {
        var sg = new THREE.PlaneGeometry(760, 760, 40, 40);
        sg.rotateX(-Math.PI / 2);
        sg.translate(ocx, 0, ocz);
        paintSeaColors(sg);
        var sm = new THREE.MeshPhongMaterial({
          color: 0xffffff, specular: 0x5a6d76, shininess: 40,
          vertexColors: true
        });
        trackMat(W, sm);
        var sk = new THREE.Mesh(sg, sm);
        sk.position.y = SURF - 0.03; // 紧贴内层海面之下（2cm，无可见断层）
        sk.frustumCulled = false;
        W.scene.add(sk);
        trackScene(sk);
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
          /* ---- P2：初始舱室升级 ----
           * 破损储物柜（潜水服必出）/ 抽屉桌（日志残页+电池+能量棒）/
           * 板条箱 ×2（叙事杂物+少量补给）/ 环境痕迹（水渍线/拖拽痕/翻倒椅/值班表）。
           * 容器全部走 BR.Container（对准开门→看内部真实物品→准星逐件拾取→存档），
           * 位置复用上面的 reserved()/takeFar() 空位逻辑，不挡楼梯/平台/门/出生点。
           */
          // —— 1. 破损储物柜：锈蚀双开门，右扇门掉了一半（视觉破损），左扇可开关 ——
          var lockerT = takeFar();
          if (lockerT) {
            var ltx = lockerT[0], lty = lockerT[1];
            var lfx = BR.tileCX(ltx), lfz = BR.tileCZ(lty);
            var rust = new THREE.MeshLambertMaterial({ color: 0x6e4526 });
            var rustD = new THREE.MeshLambertMaterial({ color: 0x402a16 });
            var rustP = new THREE.MeshLambertMaterial({ color: 0x8a5a30 });
            [rust, rustD, rustP].forEach(function (m) { trackMat(W, m); });
            var locker = new THREE.Group();
            locker.position.set(lfx, 0, lfz);
            locker.rotation.y = Math.round(Math.atan2(cx - lfx, cz - lfz) / (Math.PI / 2)) * Math.PI / 2; // 门朝舱室中心
            var LW = 1.2, LH = 1.9, LD = 0.6, lt2 = 0.04;
            function lp(w, h, d, m, x, y, z, parent) {
              var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
              ms.position.set(x, y, z); (parent || locker).add(ms); return ms;
            }
            lp(LW, LH, lt2, rustD, 0, LH / 2, -LD / 2 + lt2 / 2);    // 背板
            lp(lt2, LH, LD, rust, -LW / 2 + lt2 / 2, LH / 2, 0);     // 左侧板
            lp(lt2, LH, LD, rust, LW / 2 - lt2 / 2, LH / 2, 0);      // 右侧板
            lp(LW, lt2, LD, rust, 0, LH - lt2 / 2, 0);              // 顶板
            lp(LW, lt2, LD, rustD, 0, lt2 / 2, 0);                   // 底板
            lp(LW - 2 * lt2, lt2, LD - lt2, rustP, 0, LH * 0.55, 0); // 中层隔板
            for (var ri = 0; ri < 6; ri++) { // 锈斑补丁（侧板）
              var rpm = new THREE.Mesh(new THREE.PlaneGeometry(0.12 + rng.next() * 0.16, 0.1 + rng.next() * 0.2), rustD);
              var rside = ri % 2 ? 1 : -1;
              rpm.position.set(rside * (LW / 2 + 0.006), 0.3 + rng.next() * 1.3, (rng.next() - 0.5) * 0.4);
              rpm.rotation.y = rside * Math.PI / 2;
              locker.add(rpm);
            }
            // 左扇门（完好）：铰链在左，开启动画目标
            var doorPivot = new THREE.Group();
            doorPivot.position.set(-LW / 2 + 0.02, LH / 2, LD / 2 + 0.01);
            var ldw = LW / 2 - 0.05, ldh = LH - 0.2;
            lp(ldw, ldh, 0.04, rust, ldw / 2, 0, 0, doorPivot);
            for (var vi = 0; vi < 3; vi++) // 通风孔
              lp(ldw * 0.6, 0.03, 0.05, rustD, ldw / 2, 0.35 - vi * 0.12, 0, doorPivot);
            lp(0.05, 0.18, 0.06, rustD, ldw - 0.1, 0, 0.05, doorPivot); // 把手
            locker.add(doorPivot);
            locker.userData.doorPivot = doorPivot;
            // 右扇门（掉了一半）：只剩顶部铰链连着，向外下垂
            var brokenPivot = new THREE.Group();
            brokenPivot.position.set(LW / 4, LH - 0.12, LD / 2 + 0.02);
            lp(ldw, ldh, 0.04, rustP, 0, -ldh / 2, 0, brokenPivot);
            lp(0.05, 0.18, 0.06, rustD, ldw / 2 - 0.1, -ldh / 2 + 0.2, 0.05, brokenPivot);
            brokenPivot.rotation.x = 0.8;
            brokenPivot.rotation.z = -0.12;
            locker.add(brokenPivot);
            W.reg(group, locker);
            locker.updateMatrixWorld(true);
            var lockerMeshes = [];
            locker.children.forEach(function (c) {
              lockerMeshes.push(c);
              if (c.children) c.children.forEach(function (cc) { lockerMeshes.push(cc); });
            });
            // 柜内落点：局部坐标 → 世界（随柜体朝向旋转）
            function lockerInner(idx, entry) {
              return locker.localToWorld(new THREE.Vector3(
                entry.dx || 0, entry.y != null ? entry.y : 0.55, entry.dz || 0));
            }
            BR.Container.create(W, {
              id: 'locker_l7_' + ltx + '_' + lty, kind: 'cabinet', closable: true,
              tx: ltx, ty: lty, group: group, visual: { pivot: doorPivot },
              meshes: lockerMeshes, pos: new THREE.Vector3(lfx, 1.0, lfz),
              innerPosOf: lockerInner,
              contents: [ // 写死，不走随机：潜水服必出
                { item: 'diving_suit', dx: -0.32, dz: 0.02, y: 0.06 },
                { item: 'oxygen_tank', dx: 0.32, dz: -0.05, y: 0.06 },
                { item: 'bandage', dx: 0.2, dz: 0.08, y: 1.12 },
                { item: 'bandage', dx: -0.1, dz: -0.1, y: 1.12 }
              ],
              text: { open: '打开储物柜', openedToast: '储物柜打开了——潜水服还在，谢天谢地' },
              autosave: true,
              onPickup: function (pickId, entry, item) {
                if (item === 'diving_suit')
                  BR.UI.toast('拿到了深海潜水服！在背包里穿上它，再下深水');
              }
            });
          }
          // —— 2. 抽屉桌：金属桌 + 2 个抽屉（kind 'drawer'，P1 预留） ——
          var deskT = takeFar();
          var deskFx = 0, deskFz = 0, deskGroup = null;
          if (deskT) {
            deskFx = BR.tileCX(deskT[0]); deskFz = BR.tileCZ(deskT[1]);
            var dsteel = new THREE.MeshLambertMaterial({ color: 0x4e5458 });
            trackMat(W, dsteel);
            deskGroup = new THREE.Group();
            deskGroup.position.set(deskFx, 0, deskFz);
            function dp(w, h, d, m, x, y, z, parent) {
              var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
              ms.position.set(x, y, z); (parent || deskGroup).add(ms); return ms;
            }
            dp(1.5, 0.07, 0.85, steel, 0, 0.8, 0);                    // 桌面
            [[-0.69, -0.36], [0.69, -0.36], [-0.69, 0.36], [0.69, 0.36]].forEach(function (p2) {
              dp(0.06, 0.8, 0.06, steelD, p2[0], 0.4, p2[1]);         // 桌腿
            });
            dp(1.34, 0.42, 0.03, steelD, 0, 0.56, -0.36);             // 屉柜背板
            dp(0.03, 0.42, 0.75, steelD, -0.655, 0.56, 0);            // 屉柜左侧板
            dp(0.03, 0.42, 0.75, steelD, 0.655, 0.56, 0);             // 屉柜右侧板
            dp(1.34, 0.03, 0.75, steelD, 0, 0.365, 0);                // 屉柜底板
            dp(1.34, 0.03, 0.75, steelD, 0, 0.755, 0);                // 屉柜顶板
            dp(0.03, 0.42, 0.72, steelD, 0, 0.56, 0);                 // 中隔板
            W.reg(group, deskGroup);
          }
          // 抽屉滑动动画（drawer kind 默认无动画，这里覆盖）
          function slideDrawerTo(bin, z) {
            var from = bin.position.z, t0 = performance.now(), dur = 320;
            var iv = setInterval(function () {
              var k = Math.min(1, (performance.now() - t0) / dur);
              bin.position.z = from + (z - from) * (1 - Math.pow(1 - k, 2));
              if (k >= 1) { bin.position.z = z; clearInterval(iv); }
            }, 16);
          }
          function drawerAnim() {
            return {
              setOpen: function (v) { if (v && v.bin) v.bin.position.z = 0.45; },
              setClosed: function (v) { if (v && v.bin) v.bin.position.z = 0; },
              animOpen: function (v) { if (v && v.bin) slideDrawerTo(v.bin, 0.45); },
              animClose: function (v) { if (v && v.bin) slideDrawerTo(v.bin, 0); }
            };
          }
          function buildDrawerBin(lx) { // lx: 抽屉在桌下的 x 偏移
            var bin = new THREE.Group();
            bin.position.set(lx, 0, 0);
            function bp(w, h, d, m, x, y, z) {
              var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
              ms.position.set(x, y, z); bin.add(ms); return ms;
            }
            bp(0.62, 0.36, 0.04, steel, 0, 0.56, 0.36);      // 前面板
            bp(0.2, 0.05, 0.05, steelD, 0, 0.56, 0.41);       // 拉手
            bp(0.58, 0.03, 0.62, steelD, 0, 0.4, 0.02);       // 底板
            bp(0.03, 0.3, 0.62, steelD, -0.29, 0.55, 0.02);   // 左壁
            bp(0.03, 0.3, 0.62, steelD, 0.29, 0.55, 0.02);    // 右壁
            bp(0.58, 0.3, 0.03, steelD, 0, 0.55, -0.29);      // 后壁
            deskGroup.add(bin);
            return bin;
          }
          var logPaper = null, logNoteId = null;
          if (deskT) {
            var dtx = deskT[0], dty = deskT[1];
            // 左抽屉：发黄的航海日志残页（字条类线索）+ 备用电池
            var bin1 = buildDrawerBin(-0.335);
            logPaper = new THREE.Mesh(
              new THREE.PlaneGeometry(0.4, 0.55),
              new THREE.MeshBasicMaterial({ map: BR.Textures.get('note'), color: 0xcbb87a })
            );
            trackMat(W, logPaper.material);
            logPaper.rotation.x = -Math.PI / 2;
            logPaper.rotation.z = 0.18;
            logPaper.position.set(0.1, 0.425, 0.02); // bin 局部坐标
            logPaper.visible = false; // 关着时藏在屉里
            bin1.add(logPaper);
            var bin1Meshes = [];
            bin1.children.forEach(function (c) { bin1Meshes.push(c); });
            logNoteId = 'note7_logpage_' + dtx + '_' + dty;
            var logWorld = new THREE.Vector3(deskFx - 0.335 + 0.1, 0.5, deskFz + 0.45 + 0.02);
            function setLogNote(on) { // 日志残页只在抽屉打开时可读
              if (on) {
                logPaper.visible = true;
                W.addInteractable({
                  id: logNoteId, kind: 'note', chunkKey: W.chunkKeyOf(dtx, dty),
                  meshes: [logPaper], pos: logWorld.clone(), radius: 2.4,
                  prompt: function () { return BR.interactKeyLabel() + '阅读航海日志残页'; },
                  canUse: function () { return true; },
                  use: function () {
                    BR.Audio.paper();
                    BR.UI.showNote(L7_LOG_NOTE[0], L7_LOG_NOTE[1]);
                    if (W.state.picked.indexOf(logNoteId) < 0) {
                      W.state.picked.push(logNoteId);
                      BR.bus.emit('picked', { id: logNoteId });
                    }
                  }
                });
              } else {
                logPaper.visible = false;
                W.removeInteractable(logNoteId);
              }
            }
            var drawer1Id = BR.Container.create(W, {
              id: 'drawer_l7_1_' + dtx + '_' + dty, kind: 'drawer', closable: true,
              tx: dtx, ty: dty, group: group, visual: { bin: bin1 }, anim: drawerAnim(),
              meshes: bin1Meshes, pos: new THREE.Vector3(deskFx - 0.335, 0.6, deskFz + 0.45),
              innerBase: new THREE.Vector3(deskFx - 0.335, 0.42, deskFz + 0.45 + 0.02),
              contents: [{ item: 'battery', dx: -0.15, dz: 0.08 }],
              text: { open: '拉开抽屉', openedToast: '抽屉拉开了——有张发黄的纸，还有节电池' },
              autosave: true,
              onOpen: function () { setLogNote(true); },
              onClose: function () { setLogNote(false); }
            });
            // 区块重建/读档：抽屉本来就开着 → 补上日志纸条交互
            if (W.state.cabinetOpen[drawer1Id] === true) setLogNote(true);
            // 右抽屉：半块能量棒
            var bin2 = buildDrawerBin(0.335);
            var bin2Meshes = [];
            bin2.children.forEach(function (c) { bin2Meshes.push(c); });
            BR.Container.create(W, {
              id: 'drawer_l7_2_' + dtx + '_' + dty, kind: 'drawer', closable: true,
              tx: dtx, ty: dty, group: group, visual: { bin: bin2 }, anim: drawerAnim(),
              meshes: bin2Meshes, pos: new THREE.Vector3(deskFx + 0.335, 0.6, deskFz + 0.45),
              innerBase: new THREE.Vector3(deskFx + 0.335, 0.42, deskFz + 0.45 + 0.02),
              contents: [{ item: 'energy_bar', dx: 0.05, dz: -0.05 }],
              text: { open: '拉开抽屉', openedToast: '抽屉里有半块能量棒——包装都没拆' },
              autosave: true
            });
          }
          // —— 3. 板条箱 ×2：纯叙事杂物（静态）+ 少量实质补给 ——
          function buildJunkCrate(kind2) {
            var cT = takeFar(); if (!cT) return;
            var cfx = BR.tileCX(cT[0]), cfz = BR.tileCZ(cT[1]);
            var cm = BR.buildCrateMesh(W);
            cm.group.position.set(cfx, 0, cfz);
            cm.group.rotation.y = (rng.next() * 4 | 0) * Math.PI / 2;
            if (kind2 === 'rope') { // 绳索 + 破布
              var coil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 18),
                new THREE.MeshLambertMaterial({ color: 0x8a734f }));
              trackMat(W, coil.material);
              coil.rotation.x = -Math.PI / 2; coil.position.y = 0.12; cm.group.add(coil);
              var rag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.3),
                new THREE.MeshLambertMaterial({ color: 0x5a6a72 }));
              trackMat(W, rag.material);
              rag.position.set(0.15, 0.1, -0.15); rag.rotation.y = 0.5; cm.group.add(rag);
            } else { // 空罐头 + 破布
              for (var ci2 = 0; ci2 < 3; ci2++) {
                var can = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 10),
                  new THREE.MeshLambertMaterial({ color: 0x9a9a98 }));
                trackMat(W, can.material);
                can.position.set(-0.2 + ci2 * 0.2, 0.13, (rng.next() - 0.5) * 0.3);
                if (ci2 === 2) { can.rotation.z = Math.PI / 2; can.position.y = 0.09; } // 一只倒下的空罐头
                cm.group.add(can);
              }
              var rag2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.25),
                new THREE.MeshLambertMaterial({ color: 0x6a5a48 }));
              trackMat(W, rag2.material);
              rag2.position.set(0.1, 0.08, 0.2); rag2.rotation.y = -0.4; cm.group.add(rag2);
            }
            W.reg(group, cm.group);
            BR.Container.create(W, {
              id: 'crate_l7_' + kind2 + '_' + cT[0] + '_' + cT[1], kind: 'crate',
              tx: cT[0], ty: cT[1], group: group, visual: { lid: cm.lid },
              meshes: cm.parts, pos: new THREE.Vector3(cfx, 0.9, cfz),
              innerBase: new THREE.Vector3(cfx, 0.14, cfz),
              contents: kind2 === 'rope'
                ? [{ item: 'glowstick', dx: -0.12, dz: 0.1 }, { item: 'empty' }, { item: 'empty' }]
                : [{ item: 'bandage', dx: 0.1, dz: -0.08 }, { item: 'empty' }],
              text: kind2 === 'rope'
                ? { openedToast: '箱子里是盘绳索和破布——还有根荧光棒' }
                : { openedToast: '箱子里是几个空罐头——还有卷绷带' },
              autosave: true
            });
          }
          buildJunkCrate('rope');
          buildJunkCrate('cans');
          // —— 4. 环境痕迹（纯视觉，但有空间逻辑） ——
          // 4a. 墙上水渍线：膝盖高度（0.45m）——这里曾经进过水
          (function waterline() {
            var stain = new THREE.MeshBasicMaterial({ color: 0x24352c, transparent: true, opacity: 0.6 });
            var stainF = new THREE.MeshBasicMaterial({ color: 0x24352c, transparent: true, opacity: 0.25 });
            trackMat(W, stain); trackMat(W, stainF);
            var segs = [];
            function seg(x, z, rotY) {
              var s1 = new THREE.Mesh(new THREE.PlaneGeometry(T, 0.1), stain);
              s1.position.set(x, 0.47, z); s1.rotation.y = rotY; W.reg(group, s1);
              var s2 = new THREE.Mesh(new THREE.PlaneGeometry(T, 0.22), stainF);
              s2.position.set(x, 0.32, z); s2.rotation.y = rotY; W.reg(group, s2);
              segs.push([x, z, rotY]);
            }
            var ex = entry.x, ey = entry.y, ex1 = entry.x + entry.w - 1, ey1 = entry.y + entry.h - 1;
            for (var tx2 = ex; tx2 <= ex1; tx2++) {
              if (W.isWall(tx2, ey - 1)) seg(BR.tileCX(tx2), ey * T + 0.04, 0);
              if (W.isWall(tx2, ey1 + 1)) seg(BR.tileCX(tx2), (ey1 + 1) * T - 0.04, Math.PI);
            }
            for (var ty2 = ey; ty2 <= ey1; ty2++) {
              if (W.isWall(ex - 1, ty2)) seg(ex * T + 0.04, BR.tileCZ(ty2), Math.PI / 2);
              if (W.isWall(ex1 + 1, ty2)) seg((ex1 + 1) * T - 0.04, BR.tileCZ(ty2), -Math.PI / 2);
            }
            for (var di = 0; di < Math.min(6, segs.length); di++) { // 水渍下淌的 drip
              var sg = segs[(rng.next() * segs.length) | 0];
              var along2 = (rng.next() - 0.5) * (T - 0.4);
              var horiz = (sg[2] === 0 || sg[2] === Math.PI);
              var drip = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.28), stainF);
              drip.position.set(sg[0] + (horiz ? along2 : 0), 0.3, sg[1] + (horiz ? 0 : along2));
              drip.rotation.y = sg[2];
              W.reg(group, drip);
            }
          })();
          // 4b. 地上拖拽痕：从储物柜拖向舱门——撤离时有人拖走了重物
          if (lockerT) {
            var dragM = new THREE.MeshBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0.35 });
            trackMat(W, dragM);
            var dx0 = lfx, dz0 = lfz;
            var dx1 = meta.door.fx * T + T / 2, dz1 = meta.door.fy * T + T / 2;
            for (var gi = 0; gi < 3; gi++) {
              var gt = 0.35 + gi * 0.2;
              var dm = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.7), dragM);
              dm.rotation.x = -Math.PI / 2;
              dm.rotation.z = Math.atan2(dx1 - dx0, dz1 - dz0) + (rng.next() - 0.5) * 0.3;
              dm.position.set(dx0 + (dx1 - dx0) * gt, 0.035, dz0 + (dz1 - dz0) * gt);
              W.reg(group, dm);
            }
          }
          // 4c. 翻倒的椅子：撤离时的慌乱
          var tcT = takeFar();
          if (tcT) {
            var tcx = BR.tileCX(tcT[0]) + (rng.next() - 0.5) * 0.6;
            var tcz = BR.tileCZ(tcT[1]) + (rng.next() - 0.5) * 0.6;
            var tch = new THREE.Group();
            tch.position.set(tcx, 0.25, tcz);
            tch.rotation.set(0, rng.next() * 6.28, Math.PI / 2); // 侧翻
            function tb(w, h, d, m, x, y, z) {
              var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
              ms.position.set(x, y, z); tch.add(ms); return ms;
            }
            tb(0.45, 0.05, 0.45, steelD, 0, 0.46, 0);
            tb(0.45, 0.5, 0.05, steelD, 0, 0.75, 0.21);
            for (var tlg = 0; tlg < 4; tlg++)
              tb(0.05, 0.46, 0.05, steel, tlg < 2 ? -0.18 : 0.18, 0.23, tlg % 2 ? -0.18 : 0.18);
            W.reg(group, tch);
          }
          // 4d. 发黄的值班表：贴在墙上（叙事字条）
          (function dutyNote() {
            var cands = [];
            for (var ty3 = entry.y; ty3 < entry.y + entry.h; ty3++)
              for (var tx3 = entry.x; tx3 < entry.x + entry.w; tx3++) {
                if (W.map.tiles[ty3 * W.map.w + tx3] !== 1) continue;
                if (reserved(tx3, ty3)) continue;
                var onTaken = taken.some(function (p) { return p[0] === tx3 && p[1] === ty3; });
                if (onTaken) continue;
                var wallDir = null;
                var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                for (var d3 = 0; d3 < 4; d3++) {
                  if (W.isWall(tx3 + dirs[d3][0], ty3 + dirs[d3][1])) { wallDir = dirs[d3]; break; }
                }
                if (wallDir) cands.push([tx3, ty3, wallDir]);
              }
            if (!cands.length) return;
            var pick = cands[(rng.next() * cands.length) | 0];
            var nx = -pick[2][0], nz = -pick[2][1]; // 指向舱内
            var paperM = new THREE.Mesh(
              new THREE.PlaneGeometry(0.62, 0.85),
              new THREE.MeshBasicMaterial({ map: BR.Textures.get('note'), color: 0xd6c491 })
            );
            trackMat(W, paperM.material);
            paperM.position.set(BR.tileCX(pick[0]) + nx * 1.32, 1.6, BR.tileCZ(pick[1]) + nz * 1.32);
            paperM.rotation.y = Math.atan2(nx, nz);
            paperM.rotation.z = 0.04; // 微微歪斜，像很久没人管
            W.reg(group, paperM);
            var dnId = 'note7_duty_' + pick[0] + '_' + pick[1];
            W.addInteractable({
              id: dnId, kind: 'note', chunkKey: W.chunkKeyOf(pick[0], pick[1]),
              meshes: [paperM], pos: paperM.position.clone(), radius: 2.4,
              prompt: function () { return BR.interactKeyLabel() + '阅读值班表'; },
              canUse: function () { return true; },
              use: function () {
                BR.Audio.paper();
                BR.UI.showNote(L7_DUTY_NOTE[0], L7_DUTY_NOTE[1]);
                if (W.state.picked.indexOf(dnId) < 0) {
                  W.state.picked.push(dnId);
                  BR.bus.emit('picked', { id: dnId });
                }
              }
            });
          })();
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

      /* ---- 9. 四深度带环境（v2.0 P2）：真实环境差异 ----
       * 日光带：较亮水色 + 漂浮物；暮光带：冷色水 + 礁石/沉船残骸；
       * 午夜带：近黑水 + 岩柱/遗迹 + 发光浮游生物 + 水下浓雾（方向感干扰）；
       * 深渊带：极黑水 + 结构残片 + 未知光源；海床 -6/-14/-26/-44m。 */
      (function buildBands() {
        var bands = meta.bands;
        L.bands = bands;
        var bRng = new BR.RNG(BR.hashSeed(map.seed + ':l7bands'));
        var ccx = bands[0].ccx * T, ccz = bands[0].ccy * T;

        // 9a. 障碍物建模（tile 级碰撞已在 gen 布好；这里按 l7_obstacle POI 建视觉）
        poiList(map, 'l7_obstacle').forEach(function (p) {
          W.addChunkContent(p.tx, p.ty, function (group) {
            var kind = p.data.kind, rot = p.data.rot || 0;
            var g = new THREE.Group();
            g.position.set(BR.tileCX(p.tx), 0, BR.tileCZ(p.ty));
            g.rotation.y = rot;
            var cells = p.data.cells || [[0, 0]];
            if (kind === 'rock' || kind === 'column') {
              var rockM = new THREE.MeshLambertMaterial({ color: kind === 'rock' ? 0x3a4148 : 0x2c343c });
              trackMat(W, rockM);
              cells.forEach(function (cc) {
                var h = kind === 'rock' ? 1.5 + bRng.next() * 2.5 : 6 + bRng.next() * 9;
                var rr = kind === 'rock' ? 1.1 + bRng.next() * 0.7 : 0.9 + bRng.next() * 0.5;
                var rk = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 0), rockM);
                rk.scale.y = h / (rr * 2) * 1.4;
                rk.position.set(cc[0] * T, h / 2 - 1.5, cc[1] * T);
                rk.rotation.y = bRng.next() * 6.28;
                g.add(rk);
              });
            } else if (kind === 'wreck') {
              var wood = new THREE.MeshLambertMaterial({ color: 0x4a3b2c });
              var woodD = new THREE.MeshLambertMaterial({ color: 0x33291e });
              trackMat(W, wood); trackMat(W, woodD);
              cells.forEach(function (cc) {
                var hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.4), woodD);
                hull.position.set(cc[0] * T, 0.1, cc[1] * T);
                hull.rotation.z = 0.28; hull.rotation.y = bRng.next() * 0.6 - 0.3;
                g.add(hull);
              });
              var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7, 7), wood);
              mast.position.set(0.4, 2.6, 0.2); mast.rotation.z = 0.5;
              g.add(mast);
            } else { // ruin / frag：遗迹断墙与深渊结构残片
              var conc = new THREE.MeshLambertMaterial({ color: kind === 'ruin' ? 0x5a5e60 : 0x39424a });
              trackMat(W, conc);
              cells.forEach(function (cc) {
                var h2 = 1.2 + bRng.next() * (kind === 'ruin' ? 2.2 : 3.2);
                var seg = new THREE.Mesh(new THREE.BoxGeometry(2.7, h2, 0.5), conc);
                seg.position.set(cc[0] * T, h2 / 2 - 0.8, cc[1] * T);
                seg.rotation.y = (bRng.next() - 0.5) * 0.5;
                seg.rotation.z = (bRng.next() - 0.5) * 0.22;
                g.add(seg);
              });
            }
            W.reg(group, g);
          });
        });

        // 9b. 日光带漂浮物（场景级，随波漂移；少量）
        var woodM = new THREE.MeshLambertMaterial({ color: 0x5a4a36 }); trackMat(W, woodM);
        var barM = new THREE.MeshLambertMaterial({ color: 0x6a5a48 }); trackMat(W, barM);
        L.debris = [];
        for (var di = 0; di < 9; di++) {
          var ang = bRng.next() * 6.2832;
          var drad = bands[0].r0 + bRng.next() * Math.max(1, (bands[0].r1 - bands[0].r0) * 0.92);
          var dx0 = ccx + Math.cos(ang) * drad * T, dz0 = ccz + Math.sin(ang) * drad * T;
          var dm;
          if (di % 3 === 0) dm = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 9), barM);
          else if (di % 3 === 1) dm = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.35), woodM);
          else dm = new THREE.Mesh(new THREE.SphereGeometry(0.32, 9, 7), barM);
          dm.position.set(dx0, SURF + 0.06, dz0);
          dm.rotation.y = bRng.next() * 6.28;
          W.scene.add(dm); trackScene(dm);
          L.debris.push({ m: dm, x: dx0, z: dz0, ph: bRng.next() * 6.28, dr: 0.25 + bRng.next() * 0.4 });
        }

        // 9c. 午夜带发光浮游生物（水下光点群，缓慢漂移）
        // 分布：午夜带稀疏背景 + 围绕动静点/深处出口聚类（玩家实际到访处看得见）
        (function plankton() {
          var n = 260, pp = new Float32Array(n * 3), base = [];
          var r0 = bands[2].r0 * T, r1 = bands[2].r1 * T;
          var clusters = [];
          poiList(map, 'disturbance').forEach(function (p) {
            if ((p.data.band || 0) >= 2) clusters.push([BR.tileCX(p.tx), BR.tileCZ(p.ty)]);
          });
          var de0 = poiList(map, 'deep_exit')[0];
          if (de0) clusters.push([BR.tileCX(de0.tx), BR.tileCZ(de0.ty)]);
          function pushPt(px, py, pz) {
            var i = base.length;
            if (i >= n) return;
            pp[i * 3] = px; pp[i * 3 + 1] = py; pp[i * 3 + 2] = pz;
            base.push([px, py, pz, bRng.next() * 6.28]);
          }
          var i, a, rad, px, pz, py;
          for (i = 0; i < 100; i++) { // 背景：午夜带环域
            a = bRng.next() * 6.2832; rad = Math.sqrt(bRng.next()) * Math.max(1, r1 - r0) + r0;
            px = ccx + Math.cos(a) * rad; pz = ccz + Math.sin(a) * rad;
            pushPt(px, -1 - bRng.next() * 9, pz);
          }
          var per = Math.floor((n - 100) / Math.max(1, clusters.length));
          for (var ci = 0; ci < clusters.length; ci++) { // 聚类：锚点周围 25m
            for (i = 0; i < per; i++) {
              a = bRng.next() * 6.2832; rad = Math.sqrt(bRng.next()) * 25;
              px = clusters[ci][0] + Math.cos(a) * rad; pz = clusters[ci][1] + Math.sin(a) * rad;
              py = -1 - bRng.next() * 9;
              pushPt(px, py, pz);
            }
          }
          while (base.length < n) { // 补齐
            a = bRng.next() * 6.2832; rad = Math.sqrt(bRng.next()) * Math.max(1, r1 - r0) + r0;
            pushPt(ccx + Math.cos(a) * rad, -1 - bRng.next() * 9, ccz + Math.sin(a) * rad);
          }
          var pg = new THREE.BufferGeometry();
          pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
          var pm = new THREE.PointsMaterial({
            color: 0x86e8d4, size: 0.14, transparent: true, opacity: 0.65,
            depthWrite: false, blending: THREE.AdditiveBlending
          });
          trackMat(W, pm);
          var pts = new THREE.Points(pg, pm);
          pts.frustumCulled = false;
          W.scene.add(pts); trackScene(pts);
          L.plankton = { pts: pts, base: base, n: n };
        })();

        // 9d. 深渊带未知光源（远处冷光，呼吸式闪烁；精灵公告牌）
        L.abyssLights = [];
        for (var ai = 0; ai < 3; ai++) {
          var aa = bRng.next() * 6.2832;
          var arad = (bands[3].r0 + bRng.next() * Math.max(1, (bands[3].r1 - bands[3].r0) * 0.8)) * T;
          var lsm = new THREE.SpriteMaterial({
            color: 0x9fe0ff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false
          });
          trackMat(W, lsm);
          var sp = new THREE.Sprite(lsm);
          sp.scale.set(3.2, 3.2, 1);
          sp.position.set(ccx + Math.cos(aa) * arad, -6 - bRng.next() * 8, ccz + Math.sin(aa) * arad);
          W.scene.add(sp); trackScene(sp);
          L.abyssLights.push({ m: sp, ph: bRng.next() * 6.28, per: 5 + bRng.next() * 7 });
        }
      })();

      /* ---- 10. 深处出口（→L37）：瓷砖结构残片 + 光柱 + 气泡 ----
       * 触发：潜入结构内部（水平 <2.4m 且深度接近）才切换；不按高度全图传送。
       * 位置：午夜带/深渊带交界（v2.0 P2 从最深水区搬来），深度约 -9m（游戏尺度），氧气可达。
       * L7→L37 在两社区均无原著记载，本游戏改编（LORE.md 标注）。 */
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

      /* ---- 12. Swim 水 zone 注册（v2.0 P2：四深度带同心圆，由内向外注册） ----
       * zoneAt 按注册顺序返回首个命中：同心圆内层优先即得"所在带"。
       * 每带 holes 抠掉舱室与甲板（干区）；registerZone API 不动（kind/depth/waterY/holes/形状），
       * 物理海床 floor 按既有做法补在返回引用上（L37 未用该字段）。 */
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
          var dr2 = meta.deck;
          var holes = [
            { x0: (entry.x - 1) * T, z0: (entry.y - 1) * T, x1: (entry.x + entry.w + 1) * T, z1: (entry.y + entry.h + 1) * T },
            // 甲板：只抠甲板矩形本身（+0.4m 边），不向外扩一格——停靠点在甲板外 2 格，必须是水
            { x0: dr2.x0 * T - 0.4, z0: dr2.y0 * T - 0.4, x1: (dr2.x1 + 1) * T + 0.4, z1: (dr2.y1 + 1) * T + 0.4 }
          ];
          meta.bands.forEach(function (b) {
            var zo = BR.Swim.registerZone({
              kind: b.kind, depth: b.depth, waterY: SURF,
              cx: b.ccx * T, cz: b.ccy * T, r: b.r1 * T,
              holes: holes
            });
            if (zo) zo.floor = b.floor; // 物理海床：-6/-14/-26/-44（游戏尺度）
          });
        }
        BR.Swim.speedMul = 1; // 出生点干燥：复位
      }

      /* ---- 13. 七层之物：真实体 AI（v2.0 P2） ----
       * 巨大、永不完整出镜（远影/水下轮廓/出水一段躯体）。
       * 状态机：dormant（休眠，偶发低频声）→ lurk（午夜/深渊带游弋，水面扰动环）
       *        → stalk（被噪音/久留深水吸引；预警：水流声大+浪涌+远影）
       *        → strike（受惊掀巨浪：-30hp+击退+强制上浮；不秒杀）→ retreat。
       * 反制（原著依据）：保持安静静止[噪音招引] / 手电直射驱散[畏光] /
       *                  上浮到日光带[栖息带] / 躲进残骸阴影。
       * 公平性：不进日光带；stalk 最长 38s；strike 每轮一次；无血条 Boss。 */
      (function initCreature() {
        var home = poiList(map, 'leviathan')[0];
        var crng = new BR.RNG(BR.hashSeed(map.seed + ':l7creature'));
        L.entity = {
          rings: [], // 水面扰动环（与船涟漪共用数组，_updateRings 统一驱动）
          crng: crng,
          state: 'dormant',
          tState: 0,
          nextLurk: 150 + crng.next() * 150,  // 首次潜出：150~300s（低频出现）
          nextRumble: 25 + crng.next() * 30,  // 休眠期偶发低频声
          x: home ? BR.tileCX(home.tx) : ocx,
          z: home ? BR.tileCZ(home.ty) : ocz,
          y: -8,
          wx: 0, wz: 0,   // 游弋目标点
          lurkT: 0,
          stalkT: 0,
          warnStage: 0,
          noise: 0,       // 玩家噪音 0..1（疾游/快船/水花累积，安静衰减）
          deepTime: 0,    // 在午夜/深渊带的连续秒数
          stillTime: 0,   // 安静静止的连续秒数
          splashT: 99,
          wasHead: false,
          px: 0, pz: 0, pInit: false,
          sil: null,      // 远影 mesh
          breach: null, breachT: 0,
          strikeLift: 0,
          struck: false,
          _ringT: 0, _breachT: 20
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
      // v2.0 P3：从 L37 水下通道（deep_channel）游过来 → 落在深处出口结构旁
      // 水下（与去程对应），而非干燥舱室。只在"刚被放到出生点"时搬运，
      // 读档/死亡重试（存档坐标）不动。
      try {
        var cf7 = BR.Game && BR.Game._cameFrom;
        var from7 = (typeof cf7 === 'string') ? cf7 : (cf7 && cf7.from);
        if (from7 === 'L37' && BR.World && BR.World.map && BR.Player) {
          var sp7 = BR.World.spawnOf(BR.World.map);
          var P7 = BR.Player;
          if (Math.hypot(P7.pos.x - sp7.x, P7.pos.z - sp7.z) < 0.6) {
            var pois7 = BR.World.map.pois || [], dp7 = null, qj;
            for (qj = 0; qj < pois7.length; qj++) {
              if (pois7[qj].type === 'deep_exit') { dp7 = pois7[qj]; break; }
            }
            if (dp7) {
              var ex7 = BR.tileCX(dp7.tx), ez7 = BR.tileCZ(dp7.ty);
              P7.pos.set(ex7 + 3.5, -8, ez7); // 结构旁 3.5m，水下（结构中心 y=-9）
              P7.vel.set(0, 0, 0);
              P7.yaw = Math.atan2(3.5, 0); // 面向结构
              setTimeout(function () {
                if (BR.Game.state === 'playing')
                  BR.UI.toast('冰冷的水流把你推了出来。这里……是深海。', 3200);
              }, 1500);
            }
          }
        }
      } catch (e) { if (BR.warn) BR.warn('[L7] deep arrival failed', e); }
    },

    /* ---------- 七层之物：带判定 ---------- */
    _bandAt: function (L, x, z) {
      var bands = (L && L.bands) || [];
      if (!bands.length) return 0;
      var b0 = bands[0];
      var d = Math.hypot(x / T - b0.ccx, z / T - b0.ccy);
      for (var i = 0; i < bands.length; i++) if (d <= bands[i].r1) return i;
      return bands.length - 1;
    },
    _pickLurkPoint: function (L) {
      var E = L.entity, bands = L.bands, r = E.crng;
      var b = r.next() < 0.45 ? bands[3] : bands[2]; // 午夜带为主，深渊带上部为辅
      var rr = b.r0 + 1 + r.next() * Math.max(1, b.r1 - b.r0 - 2);
      var a = r.next() * 6.2832;
      return { x: b.ccx * T + Math.cos(a) * rr * T, z: b.ccy * T + Math.sin(a) * rr * T };
    },
    _moveCreature: function (E, dt, spd) {
      var dx = E.wx - E.x, dz = E.wz - E.z;
      var d = Math.hypot(dx, dz);
      if (d < 3) return true;
      E.x += dx / d * spd * dt;
      E.z += dz / d * spd * dt;
      E.y = -7 + Math.sin(E.tState * 0.5) * 1.5;
      return false;
    },

    /* ---------- 七层之物：远影（永不完整出镜） ---------- */
    _spawnSilhouette: function (W, L) {
      var E = L.entity;
      this._despawnSilhouette(W, L);
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
      g.position.set(E.x, -4.5, E.z);
      g.rotation.y = E.crng.next() * 6.28;
      W.scene.add(g);
      trackScene(g);
      E.sil = { g: g, mat: mat };
    },
    _updateSilhouette: function (W, L, dt, targetOp) {
      var E = L.entity, P = BR.Player;
      if (!E.sil) return;
      var s = E.sil;
      // 跟随实体（滞后半拍）
      s.g.position.x += (E.x - s.g.position.x) * Math.min(1, dt * 1.2);
      s.g.position.z += (E.z - s.g.position.z) * Math.min(1, dt * 1.2);
      s.g.position.y = -4.5 + Math.sin(L.t * 0.5) * 1.2; // 缓慢沉浮
      var d = Math.hypot(s.g.position.x - P.pos.x, s.g.position.z - P.pos.z);
      var want = (d < 30) ? 0 : targetOp; // 靠太近不给出镜
      var m = s.mat;
      if (m.opacity < want) m.opacity = Math.min(want, m.opacity + dt * 0.08);
      else m.opacity = Math.max(want, m.opacity - dt * 0.12);
    },
    _despawnSilhouette: function (W, L) {
      var E = L.entity;
      if (!E || !E.sil) return;
      var s = E.sil;
      var idx = sceneObjs.indexOf(s.g);
      if (idx >= 0) sceneObjs.splice(idx, 1);
      W.scene.remove(s.g);
      s.g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      try { s.mat.dispose(); } catch (e) {}
      E.sil = null;
    },

    /* ---------- 七层之物：水面扰动环（统一驱动；船涟漪 small 共用） ---------- */
    _spawnRing: function (W, L, x, z, big) {
      var E = L.entity;
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(1, 1.5, 28),
        new THREE.MeshBasicMaterial({ color: 0x9fb8c2, transparent: true, opacity: big ? 0.55 : 0.4, depthWrite: false, side: THREE.DoubleSide })
      );
      trackMat(W, ring.material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.2, z);
      W.scene.add(ring);
      trackScene(ring);
      E.rings.push({ m: ring, t: 0, small: !big });
    },
    _updateRings: function (W, L, dt) {
      var R = L.entity.rings;
      for (var i = R.length - 1; i >= 0; i--) {
        var rg = R[i];
        rg.t += dt;
        var grow = rg.small ? 2.4 : 7, fade = rg.small ? 0.5 : 0.16, op0 = rg.small ? 0.4 : 0.55;
        var s = 1 + rg.t * grow;
        rg.m.scale.set(s, s, 1);
        rg.m.position.y = L.seaY(rg.m.position.x, rg.m.position.z, L.t) + 0.06;
        rg.m.material.opacity = Math.max(0, op0 - rg.t * fade);
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

    /* ---------- 七层之物：躯体局部出水（只是一段，永不完整） ---------- */
    _spawnBreach: function (W, L, x, z) {
      var E = L.entity;
      var g = new THREE.Group();
      var mat = new THREE.MeshLambertMaterial({ color: 0x0b1013 });
      trackMat(W, mat);
      var arc = new THREE.Mesh(new THREE.TorusGeometry(15, 2.8, 8, 20, 1.15), mat);
      arc.rotation.z = Math.PI / 2 - 0.55;
      arc.rotation.y = E.crng.next() * 6.28;
      g.add(arc);
      g.position.set(x, -9, z);
      W.scene.add(g);
      trackScene(g);
      E.breach = { g: g, x: x, z: z, wit: false };
      E.breachT = 0;
      this._rumbleSwell(L, 0.7, 8);
    },
    _updateBreach: function (W, L, dt) {
      var E = L.entity;
      if (!E.breach) return;
      E.breachT += dt;
      var t = E.breachT, g = E.breach.g;
      var y;
      if (t < 2.5) y = -9 + (t / 2.5) * 12.5;
      else if (t < 4.5) y = 3.5 + Math.sin((t - 2.5) * 2.2) * 0.5;
      else y = 3.5 - ((t - 4.5) / 3) * 12.5;
      g.position.y = y;
      // 目击判定：注视 + 70m 内 → 轻微理智冲击（一次）
      if (!E.breach.wit && t > 1 && t < 7) {
        var P = BR.Player;
        var dx = E.breach.x - P.pos.x, dz = E.breach.z - P.pos.z;
        var d = Math.hypot(dx, dz);
        if (d < 70) {
          var fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
          if ((dx * fx + dz * fz) / Math.max(0.001, d) > 0.45) {
            E.breach.wit = true;
            P.drainSanity(4);
            BR.UI.toast('你看到的……只是它身体的一小部分。', 3200);
          }
        }
      }
      if (t >= 7.5) {
        var idx = sceneObjs.indexOf(g);
        if (idx >= 0) sceneObjs.splice(idx, 1);
        W.scene.remove(g);
        g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
        E.breach = null;
      }
    },

    /* ---------- 七层之物：反制判定 ---------- */
    // 畏光 [Wikidot]：手电直射（45m 内、视线夹角）→ 驱散
    _flashlightRepel: function (P, E) {
      if (!P.flashlightOn || !P.hasFlashlight) return false;
      var dx = E.x - P.pos.x, dz = E.z - P.pos.z;
      var d = Math.hypot(dx, dz);
      if (d > 45 || d < 1) return false;
      var cp = Math.cos(P.pitch || 0);
      var fx = -Math.sin(P.yaw) * cp, fy = Math.sin(P.pitch || 0), fz = -Math.cos(P.yaw) * cp;
      var ey = (P.pos.y || 0) + 1.5;
      var dot = (fx * dx + fy * (E.y - ey) + fz * dz) / d;
      return dot > 0.72;
    },
    // 残骸阴影：障碍物（礁石/沉船/岩柱/遗迹/残片）7m 内可藏身
    _nearStructure: function (L, x, z) {
      var W = BR.World;
      if (!W || !W.map) return false;
      var pois = W.map.pois || [];
      for (var i = 0; i < pois.length; i++) {
        var p = pois[i];
        if (p.type !== 'l7_obstacle') continue;
        if (Math.hypot(BR.tileCX(p.tx) - x, BR.tileCZ(p.ty) - z) < 7) return true;
      }
      return false;
    },
    _startRetreat: function (W, L, msg) {
      var E = L.entity;
      E.state = 'retreat'; E.tState = 0;
      L.chopTarget = 1;
      if (msg) BR.UI.toast(msg, 3000);
    },

    /* ---------- 七层之物：strike（巨浪环境杀 [Fandom]） ----
     * 不是追咬：它受惊逃窜掀起巨浪。-30hp + 击退 + 强制上浮；
     * 不秒杀（hurt 0.6s 冷却），无血条，不追击。 */
    _doStrike: function (W, L) {
      var E = L.entity, P = BR.Player;
      E.struck = true;
      E.state = 'strike'; E.tState = 0;
      E.strikeLift = 1.4;
      var dx = P.pos.x - E.x, dz = P.pos.z - E.z;
      var d = Math.max(0.001, Math.hypot(dx, dz));
      if (L.boat && L.boat.isRiding()) { // 巨浪把人掀下船
        try { L.boat.dismount(P); } catch (e) {}
        try { BR.Audio.splash(); } catch (e2) {}
      }
      if (P.vel) P.vel.set(dx / d * 9, 7.5, dz / d * 9);
      P.hurt(30, 'leviathan');
      P.drainSanity(8);
      this._spawnBreach(W, L, E.x, E.z); // 近处只给一段躯体
      for (var i = 0; i < 4; i++)
        this._spawnRing(W, L, E.x + (i - 1.5) * 3, E.z + (i - 1.5) * 2, true);
      L.chopTarget = 4; // 浪涌拉满
      this._rumbleSwell(L, 0.9, 8);
      try { BR.Audio.stinger(); } catch (e3) {}
      try { BR.Audio.splash(); } catch (e4) {}
      BR.UI.toast('巨浪！它受惊翻身掀起的浪墙把你狠狠抛向水面！', 3400);
    },

    /* ---------- 七层之物：状态机 ----------
     * dormant → lurk → stalk → strike → retreat；
     * 低频出现，每次行为随机（crng）；预警清晰（声音+视觉+toast）。 */
    _updateCreature: function (W, L, dt) {
      var E = L.entity, P = BR.Player;
      if (!E || !P || !P.pos) return;
      var r = E.crng;
      E.tState += dt;

      // ---- 感知：玩家速度 / 船速 / 水花 → 噪音 ----
      var px = P.pos.x, pz = P.pos.z, spd = 0;
      if (E.pInit) spd = Math.hypot(px - E.px, pz - E.pz) / Math.max(dt, 1e-4);
      E.px = px; E.pz = pz; E.pInit = true;
      var boatSpd = (L.boat && L.boat.state) ? Math.hypot(L.boat.state.vx, L.boat.state.vz) : 0;
      var headUnder = !!(BR.Swim && BR.Swim.headUnder);
      if (headUnder !== E.wasHead) { // 入/出水水花 = 噪音
        E.noise = Math.min(1, E.noise + 0.45);
        E.splashT = 0;
        E.wasHead = headUnder;
      }
      E.splashT += dt;
      if (spd > 3.2 || boatSpd > 3.0) E.noise = Math.min(1, E.noise + 0.55 * dt);
      else E.noise = Math.max(0, E.noise - 0.30 * dt);
      var band = this._bandAt(L, px, pz);
      if (band >= 2) E.deepTime += dt; else E.deepTime = 0;
      if (spd < 0.4 && boatSpd < 0.6 && E.splashT > 2) E.stillTime += dt; else E.stillTime = 0;
      var cdist = Math.hypot(E.x - px, E.z - pz);

      if (E.state === 'dormant') {
        E.nextRumble -= dt;
        if (E.nextRumble <= 0) {
          E.nextRumble = 45 + r.next() * 40;
          this._rumbleSwell(L, 0.28, 7); // 远处闷响：它在深处翻身
        }
        E.nextLurk -= dt;
        if (E.nextLurk <= 0) {
          var lp = this._pickLurkPoint(L);
          E.wx = lp.x; E.wz = lp.z;
          E.x = lp.x; E.z = lp.z; E.y = -8; // 从深处潜出
          E.lurkT = 60 + r.next() * 60;
          E.state = 'lurk'; E.tState = 0;
          this._spawnSilhouette(W, L);
        }
      } else if (E.state === 'lurk') {
        if (this._moveCreature(E, dt, 2.2)) { // 到达换目标点
          var lp2 = this._pickLurkPoint(L);
          E.wx = lp2.x; E.wz = lp2.z;
        }
        this._updateSilhouette(W, L, dt, 0.30);
        E._ringT -= dt;
        if (E._ringT <= 0) { // 水面扰动环：它在下面
          E._ringT = 6 + r.next() * 5;
          this._spawnRing(W, L, E.x, E.z, false);
        }
        E._breachT -= dt;
        if (E._breachT <= 0) { // 偶发远处出水一现（纯演出）
          E._breachT = 40 + r.next() * 40;
          var ba = r.next() * 6.2832;
          this._spawnBreach(W, L, E.x + Math.cos(ba) * 45, E.z + Math.sin(ba) * 45);
        }
        E.lurkT -= dt;
        if (band >= 2 && (E.noise > 0.7 || E.deepTime > 28)) {
          E.state = 'stalk'; E.tState = 0; E.stalkT = 0; E.warnStage = 0; E.struck = false;
          this._rumbleSwell(L, 0.55, 12);
          L.chopTarget = 1.8;
          BR.UI.toast('水下的声音变大了……水流在把你往某个方向推。', 3200);
        } else if (E.lurkT <= 0) {
          this._despawnSilhouette(W, L);
          E.state = 'dormant'; E.tState = 0;
          E.nextLurk = 150 + r.next() * 140;
          L.chopTarget = 1;
        }
      } else if (E.state === 'stalk') {
        E.stalkT += dt;
        var dx = px - E.x, dz = pz - E.z;
        var dd = Math.max(0.001, Math.hypot(dx, dz));
        var step = Math.min(3.0 * dt, dd); // 3.0m/s：比潜泳快、比快船慢，可甩掉
        E.x += dx / dd * step;
        E.z += dz / dd * step;
        E.y = -5 + Math.sin(E.tState * 0.6) * 1.5;
        this._updateSilhouette(W, L, dt, 0.42);
        L.chopTarget = 1.8 + Math.max(0, (40 - cdist) / 40) * 1.2; // 浪涌随接近增强
        this._rumbleSwell(L, 0.35 + Math.max(0, (40 - cdist) / 40) * 0.4, 4); // 水流声变大
        E._ringT -= dt;
        if (E._ringT <= 0) {
          E._ringT = Math.max(1.6, 4.5 - E.stalkT * 0.08);
          this._spawnRing(W, L, E.x, E.z, true);
        }
        // 预警分级（声音+视觉+toast，必须清晰）
        if (E.warnStage === 0 && (E.stalkT > 6 || cdist < 38)) {
          E.warnStage = 1;
          BR.UI.toast('有什么巨大的东西正在水下靠近——保持安静别动，或用手电照它！', 3600);
          try { BR.Audio.heartbeat(); } catch (e) {}
        } else if (E.warnStage === 1 && (E.stalkT > 14 || cdist < 24)) {
          E.warnStage = 2;
          BR.UI.toast('它就在你附近！上浮到浅水区，或者躲进残骸阴影里！', 3200);
          try { BR.Audio.stinger(); } catch (e2) {}
        }
        // 反制（公平躲避；任一成立即 retreat）
        // 栖息带 [Wikidot]：午夜带与深渊带上部 → 日光带/暮光带是安全区，它不追进
        if (band <= 1) this._startRetreat(W, L, '它没有追进浅水区。');
        else if (this._flashlightRepel(P, E)) this._startRetreat(W, L, '强光刺得它退缩了——它潜回了深渊。');
        else if (E.stillTime > 8) this._startRetreat(W, L, '你屏住呼吸一动不动，它失去了你的踪迹。');
        else if (E.stalkT > 10 && this._nearStructure(L, px, pz)) this._startRetreat(W, L, '残骸的阴影遮住了你，它游开了。');
        else if (E.stalkT > 38) this._startRetreat(W, L, '它在远处翻了个身，消失了。');
        else if (!E.struck && (cdist < 15 || (E.stalkT > 20 && E.noise > 0.55) || E.deepTime > 50)) {
          this._doStrike(W, L); // 惊醒→巨浪
        }
      } else if (E.state === 'strike') {
        if (E.strikeLift > 0) { // 强制上浮
          E.strikeLift -= dt;
          if (P.vel) P.vel.y = Math.max(P.vel.y, 6.5);
        }
        if (E.tState > 1.4) this._startRetreat(W, L, null);
      } else if (E.state === 'retreat') {
        var rdx = E.x - px, rdz = E.z - pz;
        var rdd = Math.max(0.001, Math.hypot(rdx, rdz));
        E.x += rdx / rdd * 4.5 * dt;
        E.z += rdz / rdd * 4.5 * dt;
        E.y = Math.max(-22, E.y - 6 * dt);
        this._updateSilhouette(W, L, dt, 0); // 淡出
        L.chopTarget += (1 - L.chopTarget) * Math.min(1, dt * 0.8);
        if (E.tState > 7) {
          this._despawnSilhouette(W, L);
          E.state = 'dormant'; E.tState = 0;
          E.nextLurk = 150 + r.next() * 140;
          E.noise = 0; E.deepTime = 0; E.stillTime = 0;
        }
      }

      this._updateRings(W, L, dt);
      this._updateBreach(W, L, dt);
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

    /* ---------- 船边扰动：船周小涟漪（只生成；扩散由 _updateRings 统一驱动） ---------- */
    _boatRipples: { n: 0 },
    _updateBoatRipples: function (W, L, dt) {
      var B = L.boat;
      if (!B || !L.entity) return;
      var moving = Math.hypot(B.state.vx, B.state.vz) > 0.6;
      this._boatRipples.n += dt;
      if (moving && this._boatRipples.n > 0.55) {
        this._boatRipples.n = 0;
        this._spawnRing(W, L, B.state.x, B.state.z, false);
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

      // 七层之物 AI（状态机；演出全部走 trackScene/clearSceneObjs 管线）
      this._updateCreature(W, L, dt);
      // 极低频包络
      if (L._rumbleHold > 0) L._rumbleHold -= dt;
      else L.rumbleTarget = Math.max(0, L.rumbleTarget - dt * 0.12);
      if (L.rumble) {
        try {
          var gv = L.rumble.g.gain;
          gv.setTargetAtTime(Math.min(0.9, L.rumbleTarget), BR.Audio._ctx.currentTime, 1.2);
        } catch (e) {}
      }

      // 水下视觉：按深度带调整透光（Swim.tick 存雾之后覆盖；出水由 Swim 恢复）
      var hu = !!(BR.Swim && BR.Swim.headUnder);
      if (W.scene && W.scene.fog && hu && BR.Swim._fogSaved) {
        var ub = this._bandAt(L, P.pos.x, P.pos.z); // 0 日光 … 3 深渊
        if (!_uwTmpColor) _uwTmpColor = new THREE.Color();
        W.scene.fog.color.lerp(_uwTmpColor.setHex(UW_FOG_COL[ub]), Math.min(1, dt * 2));
        W.scene.fog.far += (UW_FOG_FAR[ub] - W.scene.fog.far) * Math.min(1, dt * 2);
      }
      if (typeof document !== 'undefined')
        document.body.classList.toggle('l7deep', hu);

      // 深水理智侵蚀（叠加在黑暗侵蚀之上；午夜带约 2.35/s，深渊带约 3.05/s）
      if (BR.Swim && typeof BR.Swim.zoneAt === 'function') {
        var szn = BR.Swim.zoneAt(P.pos.x, P.pos.z);
        if (szn && szn.kind === 'deep') P.drainSanity(dt * (0.6 + 0.7 * (szn.depth || 1)));
      }

      // 四带环境演出更新：漂浮物随波 / 浮游生物漂移 / 未知光源呼吸闪烁
      if (L.debris) {
        for (var dbi = 0; dbi < L.debris.length; dbi++) {
          var db = L.debris[dbi];
          db.m.position.x = db.x + Math.sin(t * 0.05 + db.ph) * db.dr * 6;
          db.m.position.z = db.z + Math.cos(t * 0.04 + db.ph) * db.dr * 6;
          db.m.position.y = this._seaYAt(L, db.m.position.x, db.m.position.z, t) + 0.06;
          db.m.rotation.y += dt * 0.05;
        }
      }
      if (L.plankton) {
        var ppa = L.plankton.pts.geometry.attributes.position;
        for (var pli = 0; pli < L.plankton.n; pli++) {
          var bs = L.plankton.base[pli];
          ppa.array[pli * 3] = bs[0] + Math.sin(t * 0.25 + bs[3]) * 0.9;
          ppa.array[pli * 3 + 1] = bs[1] + Math.sin(t * 0.35 + bs[3] * 1.7) * 0.6;
        }
        ppa.needsUpdate = true;
      }
      if (L.abyssLights) {
        for (var ali = 0; ali < L.abyssLights.length; ali++) {
          var al = L.abyssLights[ali];
          var ak = Math.sin(t * 6.2832 / al.per + al.ph);
          al.m.material.opacity = Math.pow(Math.max(0, ak), 3) * 0.85;
        }
      }
    },

    _seaYAt: function (L, x, z, t) {
      return L.seaY(x, z, t);
    }
  };
})();
