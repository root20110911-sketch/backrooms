/* lv_l6.js —— Level 6「熄灯之时」内容搭建
 * 黑暗可玩性设计（不许纯黑屏）：
 *   1. 位置音频导航 —— 机房低鸣（machine）、楼梯海浪声（waves，Wikidot 原著线索：
 *      "The easiest way to find this stairwell is to listen for the faint sound of waves"）
 *   2. 应急灯微光 —— 稀疏红色应急灯（fixture 池）+ 值班室一盏常亮
 *   3. 荧光标记 —— 墙面微光绿条（纯视觉弱引导，不指向出口）
 *   4. 脚步回声分区 —— 机房/大厅/维修道/静音区/楼梯间混响各异（audio.js 分区覆盖）
 *   5. 手电 —— 值班室必出手电；L6 手电可用但不稳定（偶发微闪，游戏改编；
 *      原著称光源失效，为保证可玩性改为"可用但闪烁"）
 * 实体：无真实追逐实体（Wikidot：未发现实体，但"很少有人离开"）。
 *   只有环境演出"未知存在"：深黑暗中久留 → 幻听/肩膀触感 + 理智伤害，不致命（原创改编）。
 * 出口：楼梯间 → L7（原著连接，critical POI 保证可达）。
 * 交互全部走 W.addInteractable；prompt 用 BR.interactKeyLabel()。
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
  // 楼梯 → L7（原著连接）：优先 BR.Cutout.travelTo('L7', {mode:'door'})，未落地时兜底旧 API
  function travelStairL7() {
    if (BR.Cutout && typeof BR.Cutout.travelTo === 'function') {
      return BR.Cutout.travelTo('L7', { mode: 'door' }); // Promise<boolean>：busy 时 resolve(false)
    }
    travelTo('L7', 'walk');
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
  // 相邻墙法线（无相邻墙返回 null，不用缺省值冒充）
  function adjWallNormal(W, tx, ty) {
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var dx = dirs[i][0], dy = dirs[i][1];
      if (W.isWall(tx + dx, ty + dy)) return { x: -dx, z: -dy };
    }
    return null;
  }
  /* v2.5 F5 贴墙锚点（levels.js:159 涂鸦口径）：沿四向射线找最近的墙 tile，
   * 锚点 = 墙面 + 沿内法线（朝房间）back 米（back≤0.05）；法线朝房间。
   * 返回 {x, z, nx, nz, floorTx, floorTy}（floor 为墙内侧相邻地板 tile），无墙返回 null。 */
  function wallAnchor(W, tx, ty, maxSteps, back) {
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], best = null;
    for (var i = 0; i < 4; i++) {
      var dx = dirs[i][0], dy = dirs[i][1];
      for (var s = 1; s <= maxSteps; s++) {
        if (W.isWall(tx + dx * s, ty + dy * s)) {
          if (!best || s < best.s) best = { dx: dx, dy: dy, s: s };
          break;
        }
      }
    }
    if (!best) return null;
    var wx = tx + best.dx * best.s, wy = ty + best.dy * best.s, bk = (back == null ? 0.05 : back);
    return {
      x: BR.tileCX(wx) - best.dx * (T / 2 + bk),
      z: BR.tileCZ(wy) - best.dy * (T / 2 + bk),
      nx: -best.dx, nz: -best.dy,
      floorTx: wx - best.dx, floorTy: wy - best.dy
    };
  }
  /* v2.5 F5：BFS 找最近的「有相邻墙」地板 tile（应急灯选点约束用）。
   * 返回 {tx, ty, n}，maxR 内找不到返回 null。 */
  function nearestWallTile(W, tx, ty, maxR) {
    if (W.isWall(tx, ty)) return null;
    var seen = {}, q = [[tx, ty, 0]];
    seen[tx + ',' + ty] = 1;
    while (q.length) {
      var cur = q.shift(), cx = cur[0], cy = cur[1], d = cur[2];
      var n = adjWallNormal(W, cx, cy);
      if (n) return { tx: cx, ty: cy, n: n };
      if (d >= maxR) continue;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) {
        var nx = cx + dirs[i][0], ny = cy + dirs[i][1], k = nx + ',' + ny;
        if (seen[k] || W.isWall(nx, ny)) continue;
        seen[k] = 1; q.push([nx, ny, d + 1]);
      }
    }
    return null;
  }
  var ITEM_NAME = { almond: '杏仁水', bandage: '绷带', flashlight: '手电筒', berry: '迁跃浆果' };
  function hashRng(str) { return new BR.RNG(BR.hashSeed(str)); }
  function kl() { return (BR.interactKeyLabel ? BR.interactKeyLabel() : '【E】'); }

  function addNote(W, tx, ty, title, body, idSuffix) {
    var id = 'note_l6_' + tx + '_' + ty + '_' + (idSuffix || '0');
    // v2.5 F5（A2-W05）：旧锚点沿朝向向量 +1.1 把字条推离锚点墙 2.6m、无相邻墙时更远。
    // 改按 wallAnchor 射线找最近墙贴墙锚定（back=0.05，法线朝房间）；找不到墙就不建（不悬空）。
    var anch = wallAnchor(W, tx, ty, 8, 0.05);
    if (!anch) return;
    W.addChunkContent(anch.floorTx, anch.floorTy, function (group) {
      if (W.state.picked.indexOf(id) >= 0) return;
      var m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
        new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
      m.position.set(anch.x, 1.5, anch.z);
      m.rotation.y = Math.atan2(anch.nx, anch.nz);
      W.reg(group, m);
      W.addInteractable({
        id: id, kind: 'note', chunkKey: W.chunkKeyOf(anch.floorTx, anch.floorTy),
        meshes: [m], pos: m.position.clone(), radius: 2.4,
        prompt: function () { return kl() + '阅读字条'; },
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
    var id = 'crate_l6_' + tx + '_' + ty + '_' + (suffix || '0');
    W.addChunkContent(tx, ty, function (group) {
      var cm = BR.buildCrateMesh(W);
      cm.group.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
      W.reg(group, cm.group);
      W.addPropBox(cm.group.position.x, cm.group.position.z, 0.525, 0.525); // v2.5 道具碰撞：板条箱占地 1.05×1.05（buildCrateMesh wd=1.05）
      BR.wireCrateTwoStage(W, group, cm, { id: id, tx: tx, ty: ty, item: item || 'empty' });
    });
  }

  // 直接拾取（含手电筒：拾取即获得 hasFlashlight，与 levels.js addPickup 同语义）
  function addPickup(W, tx, ty, item, n, suffix) {
    var id = 'pick_l6_' + item + '_' + tx + '_' + ty + '_' + (suffix || '0');
    W.addChunkContent(tx, ty, function (group) {
      if (W.state.picked.indexOf(id) >= 0) return;
      var g = BR.itemMesh(item);
      var rng = new BR.RNG(BR.hashSeed(id));
      g.position.set(BR.tileCX(tx) + (rng.next() - 0.5) * 1.2, 0.02, BR.tileCZ(ty) + (rng.next() - 0.5) * 1.2);
      W.reg(group, g);
      W.addInteractable({
        id: id, kind: 'pickup', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: g.children.slice(), pos: g.position.clone().add(new THREE.Vector3(0, 0.3, 0)), radius: 2.4,
        prompt: function () { return kl() + '拾取' + (ITEM_NAME[item] || item) + (n > 1 ? ' ×' + n : ''); },
        canUse: function () { return true; },
        use: function () {
          if (item !== 'flashlight' && BR.Items && !BR.Items.canAdd(item, n)) {
            BR.UI.toast(BR.Items.fullReason(item, n));
            if (BR.Audio.doorLocked) BR.Audio.doorLocked();
            return;
          }
          if (item === 'flashlight') {
            BR.Player.hasFlashlight = true;
            BR.UI.toast('拾取了手电筒（按 F / 🔦 开关）——在这层楼，它是你唯一的眼睛。');
          } else {
            BR.Game.inv[item] = (BR.Game.inv[item] || 0) + n;
            BR.UI.toast('拾取了' + (ITEM_NAME[item] || item) + (n > 1 ? ' ×' + n : ''));
          }
          BR.Audio.pickup();
          W.state.picked.push(id);
          BR.bus.emit('picked', { id: id });
          W.removeInteractable(id);
          group.remove(g);
          BR.UI.updateInv();
        }
      });
    });
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

  /* 分区回声配置（audio.js setEchoOverride 用；quiet=null 表示死寂无回声） */
  var ZONE_ECHO = {
    duty:    { delay: 0.10, vol: 0.30 },
    hall:    { delay: 0.16, vol: 0.42, delay2: 0.28, vol2: 0.20 },
    machine: { delay: 0.20, vol: 0.50, delay2: 0.34, vol2: 0.26 },
    corr:    { delay: 0.07, vol: 0.25 },
    quiet:   null,
    stair:   { delay: 0.24, vol: 0.48, delay2: 0.40, vol2: 0.24 },
    mimic:   { delay: 0.12, vol: 0.35 }
  };
  // 离开关卡时清除回声覆盖（框架无 onExit，按 INTERACTION.md 用轮询兜底，避免污染别关脚步声）
  var _leaveWatch = null;
  function watchLeave() {
    if (_leaveWatch) { clearInterval(_leaveWatch); _leaveWatch = null; }
    _leaveWatch = setInterval(function () {
      if (!BR.Game || BR.Game.level !== 'L6') {
        if (BR.Audio && BR.Audio.setEchoOverride) BR.Audio.setEchoOverride(null);
        clearInterval(_leaveWatch); _leaveWatch = null;
      }
    }, 500);
  }

  /* ================= Level 定义 ================= */
  BR.Levels.L6 = {
    name: 'Level 6 ——「熄灯之时」',
    theme: {
      bg: 0x000000, fogNear: 5, fogFar: 26, ambient: 0x3a3f4a, ambInt: 0.65,
      sky: 0x05060a, ground: 0x0b0c0e, light: 0xff5a3a, lightInt: 0.5,
      wallH: 3.0, wall: 'l6_conc', floor: 'concreteFloor', ceil: 'ceiling',
      surface: 'concrete', fixtureEvery: 9999, hum: 0
    },

    buildContent: function (map, W) {
      var meta = map.meta.l6 || { zones: [], machineBlocks: [] };
      var L = (W._l6 = {
        zones: meta.zones || [], leds: [], lastZone: '##',
        stalkT: 45, darkT: 0, flickT: 0, flickOn: false,
        stair: meta.stairwell || { tx: 0, ty: 0 }
      });
      var prng = hashRng('l6build:' + map.seed);

      /* ---------- 值班室：常亮应急灯（出生安全可见性） ---------- */
      var duty = meta.duty;
      if (duty) {
        var dcx = BR.tileCX(duty.tx), dcz = BR.tileCZ(duty.ty);
        W.addChunkContent(duty.tx, duty.ty, function (group, chunk) {
          var dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0xff7a4a }));
          dome.position.set(dcx, 2.75, dcz); W.reg(group, dome);
          chunk.fixtures.push({ x: dcx, y: 2.6, z: dcz, phase: 0, flicker: false, bright: 1.2 });
        });
        // v2.5 F5（A2-W06）：旧公式假定出生 tile 紧贴北墙，牌悬在房间中央（离墙 6.06m）。
        // 改按 duty 房间北墙内面锚定：z = duty.y0*T + 0.06（back=0.06，面朝南/房间），
        // 内容登记在北墙内侧 tile 的区块，避免跨区块卸载。
        W.addChunkContent(duty.tx, duty.y0, function (group) {
          var plate = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7),
            new THREE.MeshBasicMaterial({ map: signTexture(['值班室', 'DUTY'], 'rgba(255,120,60,0.9)') }));
          plate._ownMat = true;
          plate.position.set(dcx, 2.1, duty.y0 * T + 0.06);
          W.reg(group, plate);
        });
      }

      /* ---------- 机房设备块 ---------- */
      (meta.machineBlocks || []).forEach(function (b, bi) {
        var cx = (b.x0 + 1) * T, cz = (b.y0 + 1) * T;
        W.addChunkContent(b.x0, b.y0, function (group) {
          var metal = W.mat('l6_metal');
          var body = new THREE.Mesh(new THREE.BoxGeometry(2 * T - 0.3, 2.2, 2 * T - 0.3), metal);
          body.position.set(cx, 1.1, cz); W.reg(group, body);
          // 顶部管道
          var pipeM = new THREE.MeshLambertMaterial({ color: 0x3f434a });
          for (var pi = 0; pi < 3; pi++) {
            var pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2 * T, 8), pipeM);
            pipe.rotation.z = Math.PI / 2;
            pipe.position.set(cx, 2.45 + pi * 0.32, cz - 1.4 + pi * 1.4);
            W.reg(group, pipe);
          }
          // 状态灯（tick 里闪）
          var led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0x30ff60 }));
          led.material = led.material.clone(); led._ownMat = true;
          // v2.5 F5（A2-01）：旧偏移 T-0.4 时 LED 埋在盒内永不可见。注意机房块 2×2 tile
          // 的可见面是世界墙体渲染的 tile 边界（块中心 ±T），金属盒（半宽 T-0.15）在墙体
          // 内部看不见——LED 必须越过 tile 面：中心放面外 0.03（球 r=0.07，外凸成灯珠、
          // 内嵌 0.04 不悬空）。朝向所在机房 zone 中心的一面（玩家活动侧）。
          var lz2 = null;
          for (var zi2 = 0; zi2 < L.zones.length; zi2++) {
            var zz = L.zones[zi2];
            if (zz.kind === 'machine' && b.x0 >= zz.x0 && b.x0 <= zz.x1 && b.y0 >= zz.y0 && b.y0 <= zz.y1) { lz2 = zz; break; }
          }
          var zdx = lz2 ? ((lz2.x0 + lz2.x1 + 1) / 2 * T - cx) : 0;
          var zdz = lz2 ? ((lz2.y0 + lz2.y1 + 1) / 2 * T - cz) : 1;
          if (Math.abs(zdx) >= Math.abs(zdz))
            led.position.set(cx + (zdx >= 0 ? 1 : -1) * (T + 0.03), 1.9, cz);
          else
            led.position.set(cx, 1.9, cz + (zdz >= 0 ? 1 : -1) * (T + 0.03));
          W.reg(group, led);
          L.leds.push({ mesh: led, phase: prng.next() * 6.28, on: true });
          var sh = BR.Textures.makeBlobShadow(3.4);
          if (sh) { sh.position.set(cx, 0.02, cz); W.reg(group, sh); }
        });
      });
      // 机房 hum 锚点 + 金属脚步区
      poiList(map, 'l6_machine').forEach(function (p) {
        var mx = BR.tileCX(p.tx), mz = BR.tileCZ(p.ty);
        W.addChunkContent(p.tx, p.ty, function () {
          BR.Audio.addLoop('l6m_' + p.tx + '_' + p.ty, 'machine', mx, mz, 0.5);
        });
        // 所在机房 zone → 金属脚步声
        for (var zi = 0; zi < L.zones.length; zi++) {
          var z = L.zones[zi];
          if (z.kind === 'machine' && p.tx >= z.x0 && p.tx <= z.x1 && p.ty >= z.y0 && p.ty <= z.y1) {
            W.addSurfaceZone(z.x0 * T, z.y0 * T, (z.x1 + 1) * T, (z.y1 + 1) * T, 'metal');
            break;
          }
        }
      });

      /* ---------- 应急灯（微光导航锚点） ---------- */
      poiList(map, 'l6_emlight').forEach(function (p, i) {
        // v2.5 F5（A2-02）：旧锚点 tileC + n*1.2 沿朝向推离墙、POI 无相邻墙时缺省法线必悬空
        //（实测 3/4 POI 四邻无墙）。修法是选点约束：落点先 BFS 移位到最近的「有相邻墙」
        // 地板 tile，再沿 -n 贴墙（灯心离墙面 0.15m，球半径 0.13，净间隙 0.02m 不悬空）；
        // 8 格内无 such tile 则不建（不硬贴远墙、不留无源光）。fixture 光源同点跟随。
        var spot = nearestWallTile(W, p.tx, p.ty, 8);
        if (!spot) return;
        var ex = BR.tileCX(spot.tx), ez = BR.tileCZ(spot.ty);
        var n = spot.n;
        var lx = ex - n.x * (T / 2 - 0.15), lz = ez - n.z * (T / 2 - 0.15);
        W.addChunkContent(spot.tx, spot.ty, function (group, chunk) {
          var dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
          dome.position.set(lx, 2.6, lz);
          W.reg(group, dome);
          var base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3),
            new THREE.MeshLambertMaterial({ color: 0x1c1e22 }));
          base.position.set(lx, 2.78, lz);
          W.reg(group, base);
          chunk.fixtures.push({ x: lx, y: 2.5, z: lz, phase: i * 2.3, flicker: true, bright: 0.8 });
          if (i % 2 === 0) BR.Audio.addLoop('l6f_' + p.tx + '_' + p.ty, 'flicker', ex, ez, 0.35);
        });
      });

      /* ---------- 荧光标记（弱引导，不指向出口） ---------- */
      poiList(map, 'l6_glow').forEach(function (p) {
        // v2.5 F5（A2-W07）：旧锚点沿 +n 推到对面墙且法线朝墙内（FrontSide 剔除，玩家看不见），
        // 对面开敞时悬空。改按 wallAnchor 射线找最近墙贴墙（back=0.03），朝向保持朝房间；
        // 找不到墙就不建。
        var anch = wallAnchor(W, p.tx, p.ty, 8, 0.03);
        if (!anch) return;
        W.addChunkContent(anch.floorTx, anch.floorTy, function (group) {
          var strip = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.09),
            new THREE.MeshBasicMaterial({
              color: 0x86ffb0, transparent: true, opacity: 0.5,
              blending: THREE.AdditiveBlending, depthWrite: false
            }));
          strip._ownMat = true;
          var r = hashRng('l6glow:' + map.seed + ':' + p.tx + '_' + p.ty);
          strip.position.set(anch.x, 1.55 + (r.next() - 0.5) * 0.3, anch.z);
          strip.rotation.y = Math.atan2(anch.nx, anch.nz);
          W.reg(group, strip);
        });
      });

      /* ---------- 楼梯间（→L7，原著连接） ---------- */
      poiList(map, 'l6_stairwell').forEach(function (p) {
        var sx = BR.tileCX(p.tx), sz = BR.tileCZ(p.ty);
        var ST = { descending: false };
        // 找最近的墙方向（POI 在房间中心，wallNormal 够不着墙）
        var wd = (function () {
          var best = null;
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
            for (var s = 1; s <= 5; s++) {
              if (W.isWall(p.tx + d[0] * s, p.ty + d[1] * s)) {
                if (!best || s < best.s) best = { x: d[0], z: d[1], s: s };
                break;
              }
            }
          });
          return best || { x: 0, z: 1, s: 2 };
        })();
        // 门贴在墙内侧（盒体半厚 0.06 + 离墙 0.06），朝向房间
        var doorX = sx + wd.x * (wd.s * T - T / 2 - 0.12);
        var doorZ = sz + wd.z * (wd.s * T - T / 2 - 0.12);
        var doorRotY = Math.atan2(-wd.x, -wd.z);
        W.addChunkContent(p.tx, p.ty, function (group) {
          // —— 装饰楼梯已移除（v2.5.1，用户裁定）——
          // 本关的下行实际是走到钢门前按 E 交互触发切出；v2.5 曾按 L7 口径在此
          // 重建过一套 7 级踏步+平台的装饰楼梯，但它既与「下行」语义矛盾、又未
          // 登记碰撞（拍摄时可穿入），故整套 prop 删除。楼梯间只保留钢门与
          // 「▼ 下行 / STAIRS」路牌，房间为空。
          // 钢门框 + 标识（贴最近的墙，朝向房间；门用薄盒体而非平面，避免共面射线 miss）
          var door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.4, 0.12),
            new THREE.MeshLambertMaterial({ map: BR.Textures.get('l6_door_steel') }));
          door.position.set(doorX, 1.2, doorZ);
          door.rotation.y = doorRotY;
          W.reg(group, door);
          var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75),
            new THREE.MeshBasicMaterial({ map: signTexture(['▼ 下行', 'STAIRS'], 'rgba(120,160,255,0.9)') }));
          sign._ownMat = true;
          sign.position.set(doorX, 2.75, doorZ);
          sign.rotation.y = doorRotY;
          W.reg(group, sign);
          // 海浪声（原著线索）
          BR.Audio.addLoop('l6_waves', 'waves', sx, sz, 0.55);
          W.addInteractable({
            id: 'l6_stairwell', kind: 'stairwell', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            // 交互点放在门处（房间中心的台阶会挡住 occlusion 射线，pos 不能放中心）
            meshes: [door], pos: new THREE.Vector3(doorX, 1.2, doorZ), radius: 3.4,
            prompt: function () {
              return ST.descending ? '……' : kl() + '走下楼梯（海浪声从下面传来）';
            },
            canUse: function () { return !ST.descending; },
            use: function () {
              if (ST.descending) return;
              ST.descending = true;
              BR.Input.setLocked(true);
              BR.Audio.doorCreak();
              BR.UI.toast('你摸着扶手走进黑暗，脚下传来空旷的回声……', 2400);
              // Level! bangEscaped 模式：按关存档标记"已逃脱"
              if (BR.Game && BR.Game.flags) BR.Game.flags.l6Escaped = true;
              setTimeout(function () {
                var done = travelStairL7();
                if (done && typeof done.then === 'function') done.then(function (ok) {
                  if (!ok) {
                    ST.descending = false;
                    BR.Input.setLocked(false);
                    BR.UI.toast('楼梯深处传来一声闷响——这次没能下去，稍后再试。', 2600);
                  }
                });
              }, 1100);
            }
          });
        });
      });

      /* ---------- "最安静的房间"（Wikidot 出哨致敬：电灯开关，千万别扳） ---------- */
      poiList(map, 'l6_switch').forEach(function (p) {
        var qx = BR.tileCX(p.tx), qz = BR.tileCZ(p.ty);
        var flipped = W.state.events.indexOf('l6_switch') >= 0;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var n = wallNormal(W, p.tx, p.ty);
          // 开关面板
          var plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.05),
            new THREE.MeshLambertMaterial({ color: 0x8a8d92 }));
          plate.position.set(qx + n.x * (T / 2 - 0.06), 1.45, qz + n.z * (T / 2 - 0.06));
          plate.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, plate);
          var lever = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06),
            new THREE.MeshLambertMaterial({ color: 0x2a2c30 }));
          lever.position.set(qx + n.x * (T / 2 - 0.1), flipped ? 1.38 : 1.52, qz + n.z * (T / 2 - 0.1));
          lever.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, lever);
          // 蜷缩的人影（纯黑剪影）
          var fig = new THREE.Group();
          var fb = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 1.0, 8),
            new THREE.MeshBasicMaterial({ color: 0x050506 }));
          fb.position.y = 0.55; fig.add(fb);
          var fh = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0x050506 }));
          fh.position.y = 1.2; fig.add(fh);
          fig.position.set(qx - n.x * 0.9, 0, qz - n.z * 0.9);
          fig.rotation.y = Math.atan2(n.x, n.z);
          fig.visible = !flipped;
          W.reg(group, fig);
          W.addInteractable({
            id: 'l6_switch', kind: 'l6_switch', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [plate], pos: new THREE.Vector3(qx + n.x, 1.45, qz + n.z), radius: 2.6,
            prompt: function () {
              return flipped ? '开关已经被扳过了' : kl() + '扳动电灯开关（他求你别扳）';
            },
            canUse: function () { return !flipped; },
            use: function () {
              if (flipped) return;
              flipped = true;
              lever.position.y = 1.38;
              fig.visible = false;
              BR.Audio.stinger();
              BR.Audio.whisperDeep();
              if (BR.Player && BR.Player.drainSanity) BR.Player.drainSanity(15);
              BR.UI.toast('灯闪了一下——没有亮。', 2200);
              setTimeout(function () {
                BR.UI.toast('黑暗里有什么东西动了一下。人影不见了。', 3000);
              }, 1600);
              if (W.state.events.indexOf('l6_switch') < 0) {
                W.state.events.push('l6_switch');
                BR.bus.emit('event', { id: 'l6_switch' });
              }
            }
          });
        });
      });

      /* ---------- 字条（原著/改编二分标注） ---------- */
      var L6_NOTES = [
        ['值班室守则',
          '【原著依据】Wikidot 记载：Level 6 里没有任何光源能正常工作；这里寂静得像一间' +
          '隔音房；偶尔能听见窸窣声、呼吸声、耳语。有人说在这层楼里找到过电灯开关——' +
          '千万别扳。\n\n【游戏改编】本关手电可用（但不太稳定），否则寸步难行。' +
          '机器的低鸣能帮你定位机房；想离开，就去找海浪声。\n\n——前任值班员'],
        ['维修日志（残页）',
          '……3 号机房的低鸣声越来越响了。电从哪来？没人知道。\n\n' +
          '记住：跟着声音走不会迷路。机器在的地方，路就是通的。' +
          '千万别在没开手电的时候停下来——黑暗里，有东西能"看见"你。\n\n' +
          '（字迹到这里就断了）'],
        ['潦草的字条',
          '别信你听到的声音！！\n\n它们学人说话学得太像了——昨天"老陈"叫我的名字，' +
          '可老陈上周就已经……\n\n捂住耳朵，往回走。别回应。'],
        ['水手的日记残页',
          '……第 9 天。还是没有光。\n\n但今晚我听见了海浪声。顺着海浪声走，' +
          '有一截向下的楼梯。门后是水，是海——总比这里强。\n\n' +
          '如果你也听见了，别犹豫，走下去。']
      ];
      poiList(map, 'note').forEach(function (p) {
        var nid = (p.data && p.data.noteId) || '';
        if (nid === 'L6_mimic') {
          addNote(W, p.tx, p.ty, '警告（血字）',
            '它们在学你说话。\n\n捂住耳朵，往回走。不要回应。不要停留。', 'mimic');
          return;
        }
        var i = parseInt((nid || 'L6_note0').replace('L6_note', ''), 10) || 0;
        var nn = L6_NOTES[i % L6_NOTES.length];
        addNote(W, p.tx, p.ty, nn[0], nn[1], 'n' + i);
      });

      /* ---------- 补给 ---------- */
      poiList(map, 'l6_flash').forEach(function (p) {
        addPickup(W, p.tx, p.ty, 'flashlight', 1, 'duty');
      });
      poiList(map, 'crate').forEach(function (p, i) {
        addCrate(W, p.tx, p.ty, (p.data && p.data.item) || 'empty', 's' + i);
      });

      /* ---------- 薄墙（随机切出） ---------- */
      BR.buildThinWalls(map, W);

      W.objective = '在黑暗中找到出路：顺着海浪声找到向下的楼梯（→Level 7）';
    },

    onEnter: function () {
      watchLeave();
      BR.UI.setObjective(BR.World.objective);
      BR.Audio.setAmbient('L6');
      var P = BR.Player;
      setTimeout(function () {
        if (BR.Game && BR.Game.level === 'L6')
          BR.UI.toast('Level 6 ——「熄灯之时」。伸手不见五指，只有机器的低鸣。', 3600);
      }, 900);
      setTimeout(function () {
        if (!BR.Game || BR.Game.level !== 'L6') return;
        if (P && !P.hasFlashlight)
          BR.UI.toast('值班室里应该还有手电——先找到它，它是你唯一的眼睛。', 3600);
        else
          BR.UI.toast('打开手电（F / 🔦）。记住：跟着声音走，海浪声那边有楼梯。', 3600);
      }, 4800);
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player;
      if (!W || !P) return;
      BR.thinWallTick(dt);
      var L = W._l6;
      if (!L) return;
      if (!BR.Game || BR.Game.state !== 'playing') return;

      /* 分区回声：tile 变化时才更新覆盖 */
      var ptx = Math.floor(P.pos.x / T), pty = Math.floor(P.pos.z / T);
      if (ptx !== L._ztx || pty !== L._zty) {
        L._ztx = ptx; L._zty = pty;
        var zk = null;
        for (var i = L.zones.length - 1; i >= 0; i--) {
          var z = L.zones[i];
          if (ptx >= z.x0 && ptx <= z.x1 && pty >= z.y0 && pty <= z.y1) { zk = z.kind; break; }
        }
        if (zk !== L.lastZone) {
          L.lastZone = zk;
          if (BR.Audio && BR.Audio.setEchoOverride)
            BR.Audio.setEchoOverride(zk ? (ZONE_ECHO[zk] || null) : null);
        }
      }

      /* 手电不稳定（游戏改编）：偶发微闪 */
      if (W.flashSpot && P.flashlightOn && P.hasFlashlight) {
        L.flickT -= dt;
        if (L.flickT <= 0) {
          if (L.flickOn) { L.flickOn = false; L.flickT = 0.08 + Math.random() * 0.25; }
          else {
            var r = Math.random();
            if (r < 0.06) { L.flickOn = true; L.flickT = 0.05 + Math.random() * 0.12; } // 短促熄灭
            else L.flickT = 2 + Math.random() * 6;
          }
        }
        W.flashSpot.intensity = L.flickOn ? 0.25 : (1.35 + Math.random() * 0.25);
      }

      /* 机房状态灯闪烁 */
      for (var li = 0; li < L.leds.length; li++) {
        var led = L.leds[li];
        var ph = (W.time * 2.2 + led.phase) % 6.2832;
        var on = ph < 4.4;
        if (on !== led.on) {
          led.on = on;
          led.mesh.material.color.setHex(on ? 0x30ff60 : 0x0a3314);
        }
      }

      /* 海浪声接近提示（原著线索的游戏化） */
      if (W.state.events.indexOf('l6_heard_waves') < 0) {
        var stx = BR.tileCX(L.stair.tx), stz = BR.tileCZ(L.stair.ty);
        if (Math.hypot(P.pos.x - stx, P.pos.z - stz) < 24) {
          W.state.events.push('l6_heard_waves');
          BR.bus.emit('event', { id: 'l6_heard_waves' });
          BR.Audio.checkpoint();
          BR.UI.toast('海浪声……越来越近了。楼梯就在这个方向。', 3200);
        }
      }

      /* "未知存在"：深黑暗中久留的幻听事件（环境演出，不致命） */
      var inDark = !P.flashlightOn || !P.hasFlashlight;
      if (inDark) L.darkT += dt; else L.darkT = 0;
      L.stalkT -= dt;
      if (L.stalkT <= 0) {
        var inMimic = L.lastZone === 'mimic';
        L.stalkT = (inMimic ? 22 : 40) + Math.random() * (inMimic ? 18 : 30);
        if (L.darkT > 15 && P.sanity > 5) {
          if (inMimic) {
            BR.Audio.whisper(); // 模仿的声音
            BR.UI.toast('黑暗里有人叫你的名字——别回应。', 2800);
          } else {
            BR.Audio.whisperDeep();
            BR.UI.toast('有什么东西擦着你的肩膀过去了……', 2800);
          }
          P.drainSanity(8);
          L.darkT = 0;
        }
      }
    }
  };

  // v2.0 P4：把 L6 登记进随机裂隙候选池（权重 6，接 cutout.js _extraRiftDests）。
  if (BR.Cutout && typeof BR.Cutout.registerRiftDest === 'function') BR.Cutout.registerRiftDest('L6', 6);
})();
