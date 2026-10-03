/* lv_l188.js —— Level 188「百窗庭」内容构建（v1.5 W7 重构）
 * 原型：Fandom Backrooms Wiki Level 188 "The Windows"（酒店版）[本游戏改编]。
 *   中央中庭 + 四周四层窗户（104 扇） + 环绕走廊 + 10 间 1F 客房 + 真二层（环廊 + 6 间客房，
 *   楼梯间淡入淡出换层） + 休息室 + 员工室。与 Wikidot Level 881 无关。
 *
 * 美术改编（参考用户提供的参考图4：Bilibili 后室 vlog 夜间庭院截图，只取场景本身）：
 *   四面高大深色住宅楼（wallH=12，四层窗，抬头有压迫感）围中央庭院；
 *   密集规律矩形窗，亮窗（暖黄/冷白）与黑窗交错，混有 1~2 扇异常蓝色亮窗；
 *   庭院=矩形草坪+十字步道+左侧浅水池+中央圆形铺装+地面蓝色小地灯；
 *   夜间无自然光（星空+人工光）。
 *
 * 窗户四态（map.meta.l188wins，确定性分配，卸载不重抽；状态进存档 W.state.l188win）：
 *   ①'curtain' 窗帘遮挡普通窗（其中一扇为"魔术窗帘"：交互后窗帘"消失"→随机切出）
 *   ②'room'    可观察普通房间（立体小场景：床/灯/桌剪影）
 *   ③'pool'/'party'/'city'/'deep' 异空间窗（L37 蓝绿泳池 / Level Fun 派对 /
 *       L11 夜城一角 / L7 深海一角——均为本游戏改编的局部立体小场景，非整关加载）
 *   ④'event'   事件窗（人影/异常事件）：明确交互后触发
 *   'travel'  可穿越窗：独立触发区 + 目标层级（走 BR.Cutout.travel，经 cutoutTravel 封装）
 *   'plain'   普通窗（warm/cold/dark/blinds/blue，亮/黑缓慢翻转；蓝窗为异常色永不翻转）
 * 观察/交互/穿越三分开：①②③纯展示无交互；④交互后触发事件；可穿越窗独立交互区。
 * 异空间/事件/穿越窗若带房号，其房门被未知力量锁死（gen_l188.js 耦合回填）。
 *
 * POI 类型（gen_l188.js 放置）：
 *   spawn / balcony / hotel_room{num,winKind,locked,w,h,x0,y0} / room_door{doorId,num,locked} /
 *   lounge / staff_room / radio / odd_window(→L1) / stairwell(→L11) /
 *   stair_up（1F 楼梯间→2F，真连楼层） / return_door（出生房北墙→来源层级） /
 *   emergency_exit{dx,dz,dest}（位置随机→已完成层级池） / note / crate / thin_wall
 *   2F 内容不走 POI（可达性抽查要求全部 POI 从 spawn 可达），经 map.meta.l188f2 构建。
 *
 * interactable kind 清单：
 *   'radio'/'odd_window'/'stairwell'（旧）/ 'stair_up' / 'stair_down' /
 *   'return_door' / 'emergency_exit' / 'event_window' / 'travel_window' /
 *   'magic_curtain' / 'cabinet'（客房衣柜，拾取）
 */
(function () {
  var BR = window.BR;
  var T = BR.TILE;
  var ITEM_NAME = { almond: '杏仁水', bandage: '绷带' };

  function px(tx) { return BR.tileCX(tx); }
  function pz(ty) { return BR.tileCZ(ty); }

  // 切出统一入口（Systems A 提供 BR.Cutout；未就绪时降级提示，不抛错）
  // 注：本工程实际 API 为 BR.Cutout.travel（cutout.js），任务书写的 travelTo 即指它。
  function cutoutTravel(to, dropText) {
    if (BR.Cutout && typeof BR.Cutout.travel === 'function') {
      BR.Cutout.travel(to, { kind: 'walk', dropText: dropText });
    } else {
      BR.UI.toast('这里似乎还没有接通……（切出系统未就绪）');
      if (BR.log) BR.log('[L188] BR.Cutout 缺失，无法前往 ' + to);
    }
  }

  function dist2D(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // 信号格：离异常窗越近越强
  function sigBars(d) {
    var n = d < 6 ? 5 : d < 12 ? 4 : d < 20 ? 3 : d < 32 ? 2 : 1;
    return '▁▂▃▄▅'.slice(0, n);
  }

  // 窗 → 观看者方向（从窗指向庭院/走廊一侧）
  function sideDir(side) {
    return side === 'S' ? { x: 0, z: -1 } : side === 'N' ? { x: 0, z: 1 } :
           side === 'W' ? { x: 1, z: 0 } : { x: -1, z: 0 };
  }

  // 楼梯换层黑场（关内换层，不走切出状态机）
  function stairFade(cb) {
    var f = document.getElementById('l188-stairfade');
    if (!f) {
      f = document.createElement('div');
      f.id = 'l188-stairfade';
      f.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;' +
        'pointer-events:none;transition:opacity .32s;z-index:65;';
      document.body.appendChild(f);
    }
    f.style.opacity = 1;
    setTimeout(function () {
      try { cb(); } finally { f.style.opacity = 0; }
    }, 340);
  }

  var L188_NOTES = {
    L188_note0: ['住客留言',
      '如果你住进来，记住三件事：\n' +
      '一，别在半夜数窗户，数不完的。\n' +
      '二，窗户分两种：暖黄的是别人家，惨白的是"开着"的——收音机靠近它就响得厉害。开着的窗对应的房门会被锁死，别白费力气。\n' +
      '三，闭着的窗（百叶窗）千万别去拉——上一个拉的人，连人带影都没了。\n' +
      '——209 房客'],
    L188_note1: ['员工守则（残页）',
      '……中庭一端的楼梯间只许员工通行。往上走，别回头，别应声。\n' +
      '失物招领处的收音机谁都不许动，它调的不是台，是"方向"。\n' +
      '——夜班主管'],
    L188_note2: ['褪色的入住登记卡',
      '百窗庭旅馆，188 号登记簿。\n' +
      '"本店共 10 间客房，中庭窗户数十扇，盏盏都亮着。"\n' +
      '（字迹到这里就断了，墨水洇开，像是被水泡过。）']
  };

  BR.Levels.L188 = {
    name: 'Level 188 ——「百窗庭」',
    theme: {
      bg: 0x05060a, fogNear: 10, fogFar: 70,
      ambient: 0x9a8a74, ambInt: 0.55,
      sky: 0x0a0c12, ground: 0x1a1512,
      light: 0xffd9a0, lightInt: 0.5,
      wallH: 12, wall: 'hotel_wall', floor: 'hotel_floor', ceil: 'hotel_ceil',
      surface: 'carpet', fixtureEvery: 6, flickerRate: 0.18
    },

    buildContent: function (map, W) {
      /* ---------- 存档态（W.state 即 ws，整体持久化；见 save.js 注释） ---------- */
      W.state.l188win = W.state.l188win || { wins: {}, fired: {}, curtainGone: {} };
      var winSave = W.state.l188win;
      winSave.wins = winSave.wins || {};
      winSave.fired = winSave.fired || {};
      winSave.curtainGone = winSave.curtainGone || {};

      var wins = map.meta.l188wins || [];
      W._l188wins = {};   // id -> {def, lit, glowMat?}（flip 状态；mesh 随区块重建）
      W._l188plateTex = {}; // 房号牌贴图缓存（buildContent 重置；W 跨关复用，旧贴图已在 dispose 释放）
      W._l188odd = null;  // {x, z} →L1 穿越窗世界坐标（静电/收音机信号用）
      W._l188anim = {};   // key -> 动画条目（区块重建时覆盖；tick 按距离选更新）
      W._l188winPos = []; // [{x, z, vkind}] 窗景近场声用
      W._l188winIds = {}; // regVoice 去重（区块重建不重复注册）

      function byType(t) {
        var out = [];
        for (var i = 0; i < map.pois.length; i++)
          if (map.pois[i].type === t) out.push(map.pois[i]);
        return out;
      }
      function poi1(t) { var a = byType(t); return a.length ? a[0] : null; }
      // 简单 box：返回 mesh（未入场），调用方自行定位后 W.reg + mesh._ownMat=true
      function box(w, h, d, color) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
          new THREE.MeshLambertMaterial({ color: color }));
        m._ownMat = true;
        return m;
      }
      function basicPlane(w, h, texName, color) {
        var mat = new THREE.MeshBasicMaterial({ color: color == null ? 0xffffff : color });
        if (texName) mat.map = BR.Textures.get(texName);
        var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        m._ownMat = true;
        return m;
      }
      function glowPlane(w, h, texName) { return basicPlane(w, h, texName); }
      function getWinState(id) {
        if (!winSave.wins[id]) winSave.wins[id] = { lit: true };
        return winSave.wins[id];
      }

      /* ---------- 门（1F 走 map.doors；2F 走 meta.l188f2.doors） ---------- */
      function addDoorDef(d) { W.addDoor({ id: d.id, tx: d.tx, ty: d.ty, axis: d.axis, locked: d.locked, label: d.label }); }
      for (var di = 0; di < map.doors.length; di++) addDoorDef(map.doors[di]);
      var f2 = map.meta.l188f2 || { rooms: [], doors: [] };
      for (var d2i = 0; d2i < f2.doors.length; d2i++) addDoorDef(f2.doors[d2i]);

      /* ---------- 房号牌（门上/门侧黄铜牌；1F 走 POI，2F 走 meta） ---------- */
      function doorPlate(tx, ty, num, doorId) {
        W.addChunkContent(tx, ty, function (group) {
          var dirs = [[0, -1, Math.PI, 0], [0, 1, 0, 0], [-1, 0, Math.PI / 2, 0], [1, 0, -Math.PI / 2, 0]];
          var face = dirs[0];
          for (var i = 0; i < dirs.length; i++) {
            var dd = dirs[i];
            if (W.tile(tx + dd[0], ty + dd[1]) === 1 || W.tile(tx + dd[0], ty + dd[1]) === 2) { face = dd; break; }
          }
          // 房号牌贴图按房号缓存：内容只与房号有关，区块重建时复用，不重复创建
          // （之前每次重建都 new CanvasTexture 并 push 进 _levelMats，造成贴图泄漏）
          W._l188plateTex = W._l188plateTex || {};
          var tex = W._l188plateTex[num];
          if (!tex) {
            var c = document.createElement('canvas');
            c.width = 128; c.height = 64;
            var x = c.getContext('2d');
            x.fillStyle = '#2e2414'; x.fillRect(0, 0, 128, 64);
            x.strokeStyle = '#8a7340'; x.lineWidth = 4; x.strokeRect(4, 4, 120, 56);
            x.fillStyle = '#e8d9a0'; x.font = 'bold 34px sans-serif';
            x.textAlign = 'center'; x.textBaseline = 'middle';
            x.fillText(String(num), 64, 34);
            tex = new THREE.CanvasTexture(c);
            W._l188plateTex[num] = tex;
            W._levelMats = W._levelMats || []; W._levelMats.push(tex);
          }
          var m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31),
            new THREE.MeshBasicMaterial({ map: tex }));
          m._ownMat = true;
          var wx = px(tx) + face[0] * (T / 2 + 0.06), wz = pz(ty) + face[1] * (T / 2 + 0.06);
          m.position.set(wx, 2.95, wz);
          m.rotation.y = face[2];
          W.reg(group, m);
        });
      }
      byType('room_door').forEach(function (p) { doorPlate(p.tx, p.ty, p.data.num); });
      f2.doors.forEach(function (d) { doorPlate(d.tx, d.ty, d.num); });

      /* ---------- 吊顶处理：中庭/阳台敞开（见星空）；客房内降吊顶到 3.4m ---------- */
      (function () {
        var tx, ty;
        for (tx = 20; tx <= 35; tx++)
          for (ty = 21; ty <= 35; ty++) W.setOpenCeil(tx, ty); // 阳台 + 中庭：夜间露天
        function dropCeil(cx, cz, w, h) {
          W.addChunkContent(Math.round(cx / T - 0.5), Math.round(cz / T - 0.5), function (group) {
            var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
              new THREE.MeshLambertMaterial({ map: BR.Textures.get('hotel_ceil') }));
            m._ownMat = true;
            m.rotation.x = Math.PI / 2; // 朝下
            m.position.set(cx, 3.4, cz);
            W.reg(group, m);
          });
        }
        W._l188dropCeil = dropCeil;
      })();

      /* ---------- 门框：出生房 → 阳台的敞开门洞 ---------- */
      W.addChunkContent(27, 20, function (group) {
        var wood = 0x3a2c1c;
        [-1.05, 1.05].forEach(function (ox) {
          var post = box(0.2, 2.7, 0.26, wood);
          post.position.set(px(27) + ox, 1.35, pz(20));
          W.reg(group, post);
        });
        var lin = box(2.5, 0.28, 0.3, wood);
        lin.position.set(px(27), 2.84, pz(20));
        W.reg(group, lin);
      });

      /* ---------- 出生房：破旧（床垫 + 纸屑） ---------- */
      (function () {
        var sp = poi1('spawn'); if (!sp) return;
        W._l188dropCeil(px(sp.tx), pz(sp.ty), 11.7, 11.7);
        W.addChunkContent(sp.tx, sp.ty, function (group) {
          var mat = box(1.9, 0.22, 0.95, 0x5c564a);
          mat.position.set(px(sp.tx) - 0.4, 0.11, pz(sp.ty) + 0.6);
          mat.rotation.y = 0.25;
          W.reg(group, mat);
          for (var i = 0; i < 4; i++) {
            var paper = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4),
              new THREE.MeshBasicMaterial({ color: 0xb8b0a0 }));
            paper._ownMat = true;
            paper.rotation.x = -Math.PI / 2;
            paper.rotation.z = i * 1.7;
            paper.position.set(px(sp.tx) + 0.8 - i * 0.45, 0.02, pz(sp.ty) - 0.7 + (i % 2) * 0.5);
            W.reg(group, paper);
          }
        });
      })();

      /* ---------- 返回门（出生房北墙→来源层级；W.state.l188_from 在 onEnter 记录） ---------- */
      (function () {
        var p = poi1('return_door'); if (!p) return;
        var dx = px(p.tx), dz = pz(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var z = (16 - 0.5) * T; // 北墙面 z=48（出生房北缘）
          var frame = box(1.5, 2.9, 0.18, 0x2e2018);
          frame.position.set(dx, 1.45, z + 0.05);
          W.reg(group, frame);
          var panel = box(1.2, 2.6, 0.1, 0x4a3a24);
          panel.position.set(dx, 1.3, z + 0.12);
          W.reg(group, panel);
          // "来时的路"标牌贴图同样按固定键缓存，避免区块重建时重复创建
          W._l188plateTex = W._l188plateTex || {};
          var tex = W._l188plateTex['return_sign'];
          if (!tex) {
            var c = document.createElement('canvas');
            c.width = 256; c.height = 64;
            var x2 = c.getContext('2d');
            x2.fillStyle = '#1c140c'; x2.fillRect(0, 0, 256, 64);
            x2.fillStyle = '#c8b078'; x2.font = 'bold 30px sans-serif';
            x2.textAlign = 'center'; x2.textBaseline = 'middle';
            x2.fillText('来时的路', 128, 34);
            tex = new THREE.CanvasTexture(c);
            W._l188plateTex['return_sign'] = tex;
            W._levelMats = W._levelMats || []; W._levelMats.push(tex);
          }
          var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25),
            new THREE.MeshBasicMaterial({ map: tex }));
          sign._ownMat = true;
          sign.position.set(dx, 2.95, z + 0.16);
          W.reg(group, sign);
          W.addInteractable({
            id: 'return_door', kind: 'return_door', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [panel], pos: new THREE.Vector3(dx, 1.4, z + 0.6), radius: 2.8,
            prompt: function () { return '🚪 来时的门（推门回去）'; },
            canUse: function () { return true; },
            use: function () {
              var dest = W.state.l188_from || 'L0';
              var dname = (BR.Levels[dest] && BR.Levels[dest].name) || dest;
              BR.Audio.doorCreak();
              cutoutTravel(dest, '你推开那扇门，回到了' + dname + '。');
            }
          });
        });
      })();

      /* ---------- 阳台栏杆（俯瞰中庭） ---------- */
      W.addChunkContent(27, 21, function (group) {
        var wood = 0x2e2018, z = 22 * T; // 中庭北边缘
        for (var x = 20 * T; x <= 36 * T; x += 3) {
          var post = box(0.13, 1.1, 0.13, wood);
          post.position.set(x, 0.55, z);
          W.reg(group, post);
        }
        var railTop = box(36 * T - 20 * T, 0.1, 0.15, wood);
        railTop.position.set(28 * T, 1.08, z);
        W.reg(group, railTop);
        var railMid = box(36 * T - 20 * T, 0.08, 0.1, wood);
        railMid.position.set(28 * T, 0.55, z);
        W.reg(group, railMid);
      });
      // 北立面（阳台上方假立面，12m 高墙体感，参考图4 的高度压迫感）
      W.addChunkContent(27, 21, function (group) {
        var fac = new THREE.Mesh(new THREE.PlaneGeometry(48, 12),
          new THREE.MeshBasicMaterial({ color: 0x0b0a08 }));
        fac._ownMat = true;
        fac.position.set(28 * T, 6.0, 66.15);
        W.reg(group, fac);
      });

      /* ---------- 中庭整体景观：草坪/交叉步道/浅水池/中央圆形铺装/灯柱/星空 ---------- */
      (function () {
        var cx0 = 20 * T, cx1 = 36 * T, cz0 = 22 * T, cz1 = 36 * T; // 60..108 / 66..108
        var ccx = (cx0 + cx1) / 2, ccz = (cz0 + cz1) / 2;           // 84 / 87
        W.addChunkContent(27, 28, function (group) {
          function groundPlane(w, h, tex, rx, ry, y) {
            var t = BR.Textures.get(tex);
            var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
              new THREE.MeshLambertMaterial({ map: t }));
            m._ownMat = true;
            m.rotation.x = -Math.PI / 2;
            m.position.set(ccx, y, ccz);
            W.reg(group, m);
            return m;
          }
          var grassT = BR.Textures.get('court_grass');
          grassT.wrapS = grassT.wrapT = THREE.RepeatWrapping; grassT.repeat.set(14, 12);
          var grass = groundPlane(cx1 - cx0, cz1 - cz0, 'court_grass', 0, 0, 0.02);
          grass.material.map = grassT;
          var pathT = BR.Textures.get('court_path');
          pathT.wrapS = pathT.wrapT = THREE.RepeatWrapping; pathT.repeat.set(16, 1);
          var pathX = groundPlane(cx1 - cx0 - 3, 2.4, 'court_path', 0, 0, 0.035);
          pathX.material.map = pathT;
          var pathT2 = BR.Textures.get('court_path');
          var pathZ = new THREE.Mesh(new THREE.PlaneGeometry(2.4, cz1 - cz0 - 3),
            new THREE.MeshLambertMaterial({ map: pathT2 }));
          pathZ._ownMat = true;
          pathZ.rotation.x = -Math.PI / 2;
          pathZ.position.set(ccx, 0.035, ccz);
          W.reg(group, pathZ);
          // 中央圆形铺装
          var circ = new THREE.Mesh(new THREE.CircleGeometry(4, 28),
            new THREE.MeshLambertMaterial({ map: BR.Textures.get('court_path') }));
          circ._ownMat = true;
          circ.rotation.x = -Math.PI / 2;
          circ.position.set(ccx, 0.05, ccz);
          W.reg(group, circ);
          // 浅水池（西侧，避开十字步道）：池沿 + 微动水面
          var poolX = 75, poolZ = 90.8, pw = 5.4, pd = 3.4;
          var rimC = 0x6a6a6e;
          [[0, -pd / 2, pw + 0.5, 0.5], [0, pd / 2, pw + 0.5, 0.5],
           [-pw / 2, 0, 0.5, pd + 0.5], [pw / 2, 0, 0.5, pd + 0.5]].forEach(function (r) {
            var rim = box(r[2], 0.5, r[3], rimC);
            rim.position.set(poolX + r[0], 0.25, poolZ + r[1]);
            W.reg(group, rim);
          });
          var wgeo = new THREE.PlaneGeometry(pw - 0.3, pd - 0.3, 8, 5);
          var water = new THREE.Mesh(wgeo, new THREE.MeshBasicMaterial({
            color: 0x2e7f96, transparent: true, opacity: 0.88
          }));
          water._ownMat = true;
          water.rotation.x = -Math.PI / 2;
          water.position.set(poolX, 0.32, poolZ);
          W.reg(group, water);
          W._l188anim['courtpool'] = {
            kind: 'water', m: water, geo: wgeo,
            base: wgeo.attributes.position.array.slice(),
            ph: 1.7, x: poolX, z: poolZ, amp: 0.035
          };
          // 地面蓝色小地灯（参考图4：沿十字步道两侧的地埋蓝灯）
          var gndBlue = new THREE.MeshBasicMaterial({ color: 0x3a7bff });
          function gndLight(lx, lz) {
            var gl = new THREE.Mesh(new THREE.CircleGeometry(0.16, 10), gndBlue);
            gl.rotation.x = -Math.PI / 2;
            gl.position.set(lx, 0.07, lz);
            W.reg(group, gl);
          }
          var gi;
          for (gi = 66; gi <= 102; gi += 6) { // 东西步道（z=87，宽 2.4）两侧
            if (gi < 79 || gi > 89) { gndLight(gi, 85.0); }      // 避中央圆铺装
            if (gi < 71 || gi > 89) { gndLight(gi, 89.0); }      // 避圆铺装与西侧浅水池
          }
          for (gi = 72; gi <= 102; gi += 6) { // 南北步道（x=84，宽 2.4）两侧
            if (gi < 83 || gi > 91) { gndLight(81.9, gi); gndLight(86.1, gi); }
          }
          // 中央圆形铺装周围两盏蓝光源
          [[78.5, 87, 0x3a7bff], [89.5, 87, 0x3a7bff]].forEach(function (bl) {
            var bpl = new THREE.PointLight(bl[2], 0.6, 12, 2);
            bpl.position.set(bl[0], 0.8, bl[1]);
            W.reg(group, bpl);
          });
          // 灯柱 ×4（其中两盏带真实光源）
          [[70.5, 76.5, true], [97.5, 76.5, false], [70.5, 97.5, false], [97.5, 97.5, true]].forEach(function (L) {
            var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.1, 8),
              new THREE.MeshLambertMaterial({ color: 0x1c1c20 }));
            pole._ownMat = true;
            pole.position.set(L[0], 1.55, L[1]);
            W.reg(group, pole);
            var lampM = glowPlane(0.55, 0.4, 'win_warm');
            lampM.position.set(L[0], 3.25, L[1]);
            lampM.rotation.y = Math.PI / 4;
            W.reg(group, lampM);
            if (L[2]) {
              var pl = new THREE.PointLight(0xffc98a, 0.75, 15, 2);
              pl.position.set(L[0], 3.4, L[1]);
              W.reg(group, pl);
            }
          });
          // 长椅 ×2
          [[84, 79.5, 0], [84, 94.5, Math.PI]].forEach(function (b) {
            var bench = box(2.2, 0.12, 0.55, 0x3a2c1c);
            bench.position.set(b[0], 0.55, b[1]);
            W.reg(group, bench);
            [-0.9, 0.9].forEach(function (ox) {
              var leg = box(0.12, 0.55, 0.5, 0x2a2018);
              leg.position.set(b[0] + ox, 0.27, b[1]);
              W.reg(group, leg);
            });
          });
          // 星空（无自然光：星星不照明，只做视觉）
          var starGeo = new THREE.BufferGeometry();
          var sp = new Float32Array(300 * 3);
          var srng = new BR.RNG(BR.hashSeed(map.seed + ':l188stars'));
          for (var si = 0; si < 300; si++) {
            sp[si * 3] = 55 + srng.next() * 58;
            sp[si * 3 + 1] = 22 + srng.next() * 30;
            sp[si * 3 + 2] = 60 + srng.next() * 52;
          }
          starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
          var stars = new THREE.Points(starGeo,
            new THREE.PointsMaterial({ color: 0xcdd8ff, size: 0.55, sizeAttenuation: true }));
          stars._ownMat = true;
          W.reg(group, stars);
          // 中庭冷光（穹顶微光，氛围）
          var CL = new THREE.PointLight(0xbfd4ff, 0.45, 36, 2);
          CL.position.set(ccx, 8.2, ccz);
          W.reg(group, CL);
          W.addSurfaceZone(cx0, cz0, cx1, cz1, 'carpet'); // 草地脚步偏软
        });
      })();

      /* ================= Part 2：窗户四态 / 楼梯 / 出口 / 客房 / 装扮 / 旧内容 ================= */

      /* ---------- 窗户四态构建器（map.meta.l188wins；104 扇；确定性分配；状态进存档） ----------
       * 视差方案（参考图4 的凸窗/飘窗）：plain 窗保持扁平发光面；
       * 其余各态做"凸窗展示盒"——向庭院侧凸出 1.1m 的开盒：背板贴图 + 近景道具，
       * 真实视差、近物遮远物。不为每扇窗加载整个层级，只用局部立体小场景。 */
      var bayInnerMat = new THREE.MeshLambertMaterial({ color: 0x241c12, side: THREE.DoubleSide });
      W._levelMats = W._levelMats || [];
      W._levelMats.push(bayInnerMat);

      (function buildWindows() {
        if (!wins.length) return;
        function plainTex(sub) {
          return sub === 'warm' ? 'win_warm' : sub === 'cold' ? 'win_cold' :
            sub === 'blue' ? 'win_blue' : sub === 'blinds' ? 'blinds' : 'win_dark';
        }
        function subLit(sub) { return sub === 'warm' || sub === 'cold' || sub === 'blue'; }
        // 凸窗局域坐标 → 世界坐标（w.ry ∈ {0, π, ±π/2}；local +z 朝庭院/观看者）
        function loc(w, lx, ly, lz) {
          var c = Math.cos(w.ry), s = Math.sin(w.ry);
          return { x: w.x + lx * c + lz * s, y: w.y + ly, z: w.z - lx * s + lz * c };
        }
        function bayMesh(group, w, geo, mat, lx, ly, lz, lry, lrx, own) {
          var m = new THREE.Mesh(geo, mat);
          var p = loc(w, lx, ly, lz);
          m.position.set(p.x, p.y, p.z);
          m.rotation.y = w.ry + (lry || 0);
          if (lrx) m.rotation.x = lrx;
          if (own) m._ownMat = true;
          W.reg(group, m);
          return m;
        }
        function bayPlane(group, w, bw, bh, tex, color, lx, ly, lz, lry, lrx) {
          var mat = tex ? new THREE.MeshBasicMaterial({ map: BR.Textures.get(tex) }) :
            (color != null ? new THREE.MeshBasicMaterial({ color: color }) : bayInnerMat);
          return bayMesh(group, w, new THREE.PlaneGeometry(bw, bh), mat,
            lx, ly, lz, lry, lrx, mat !== bayInnerMat);
        }
        function bayBoxMesh(group, w, bw, bh, bd, color, lx, ly, lz) {
          return bayMesh(group, w, new THREE.BoxGeometry(bw, bh, bd),
            new THREE.MeshLambertMaterial({ color: color }), lx, ly, lz, 0, 0, true);
        }
        // 凸窗盒：宽 bw 高 bh，向庭院凸出 bd；背板在墙端（local z≈0）朝向观看者，
        // 开口朝庭院（local z=bd），窗框在开口外沿。local +z 恒朝庭院/观看者，
        // 因此背板必须在 z≈0 端——之前误放在 z=bd 端会导致背板挡住盒内布景。
        function bayShell(group, w, bw, bh, bd) {
          var hw = bw / 2, hh = bh / 2;
          var back = bayPlane(group, w, bw, bh, null, null, 0, 0, 0.06, 0, 0);
          bayPlane(group, w, bd, bh, null, null, -hw, 0, bd / 2, Math.PI / 2, 0);
          bayPlane(group, w, bd, bh, null, null, hw, 0, bd / 2, -Math.PI / 2, 0);
          bayPlane(group, w, bw, bd, null, null, 0, hh, bd / 2, 0, Math.PI / 2);
          bayPlane(group, w, bw, bd, null, null, 0, -hh, bd / 2, 0, -Math.PI / 2);
          var fc = 0x151009; // 窗框（开口外沿） + 窗台
          var fz = bd - 0.02;
          bayBoxMesh(group, w, bw + 0.24, 0.12, 0.18, fc, 0, hh + 0.06, fz);
          bayBoxMesh(group, w, bw + 0.24, 0.12, 0.18, fc, 0, -hh - 0.06, fz);
          bayBoxMesh(group, w, 0.12, bh + 0.24, 0.18, fc, -hw - 0.06, 0, fz);
          bayBoxMesh(group, w, 0.12, bh + 0.24, 0.18, fc, hw + 0.06, 0, fz);
          bayBoxMesh(group, w, bw + 0.4, 0.1, 0.34, 0x2e2118, 0, -hh - 0.14, bd + 0.02);
          return back;
        }
        function setBackTex(back, tex) {
          back.material = new THREE.MeshBasicMaterial({ map: BR.Textures.get(tex) });
          back._ownMat = true;
        }
        function frontPos(w, d) {
          var dir = sideDir(w.side);
          return { x: w.x + dir.x * d, z: w.z + dir.z * d };
        }
        function regVoice(w, vkind) { // 窗景近场声注册（防区块重建重复）
          if (W._l188winIds[w.id]) return;
          W._l188winIds[w.id] = true;
          W._l188winPos.push({ x: w.x, z: w.z, vkind: vkind });
        }

        /* ① plain：扁平发光面（暖/冷/黑/帘/蓝；蓝窗永不翻转） */
        function buildPlain(group, w) {
          var st = getWinState(w.id);
          if (st.lit == null) st.lit = true;
          var sub = w.sub;
          var litNow = st.lit && subLit(sub);
          var m = bayPlane(group, w, 1.4, 1.9, plainTex(litNow ? sub : 'dark'), null, 0, 0, 0.06, 0, 0);
          var fc = 0x151009;
          bayBoxMesh(group, w, 1.64, 0.1, 0.12, fc, 0, 1.0, 0.04);
          bayBoxMesh(group, w, 1.64, 0.1, 0.12, fc, 0, -1.0, 0.04);
          bayBoxMesh(group, w, 0.1, 2.1, 0.12, fc, -0.77, 0, 0.04);
          bayBoxMesh(group, w, 0.1, 2.1, 0.12, fc, 0.77, 0, 0.04);
          W._l188wins[w.id] = { def: w, mesh: m, sub: sub, litTex: plainTex(sub), nextFlip: 0 };
        }

        /* ①帘 curtain：窗帘遮挡普通窗（原著：别去拉窗帘）；magic 可触发"消失" */
        function buildCurtain(group, w, magic) {
          var back = bayShell(group, w, 1.8, 2.3, 1.1);
          setBackTex(back, 'win_dark');
          var gone = magic && winSave.curtainGone[w.id];
          var cm = bayPlane(group, w, 1.7, 2.2, 'win_curtain', null, 0, 0, 0.35, 0, 0);
          if (gone) cm.visible = false; // 已"消失"：只剩黑洞
          if (magic && !gone) {
            var fp = frontPos(w, 1.8);
            W.addInteractable({
              id: 'magiccurtain_' + w.id, kind: 'magic_curtain',
              chunkKey: W.chunkKeyOf(w.tx, w.ty),
              meshes: [cm], pos: new THREE.Vector3(fp.x, w.y, fp.z), radius: 3.4,
              prompt: function () { return '🎭 拉开这扇窗帘（它看起来不太对劲）'; },
              canUse: function () { return !winSave.curtainGone[w.id]; },
              use: function () {
                winSave.curtainGone[w.id] = true;
                BR.Audio.doorCreak();
                BR.UI.toast('窗帘自己滑开了——后面没有墙，只有一条向下的走廊。', 3000);
                W._l188anim['curt_' + w.id] = {
                  kind: 'slide', m: cm, t: 0, dur: 1.5, x: w.x, z: w.z, noCull: true,
                  fromX: cm.position.x, toX: cm.position.x + 1.7,
                  done: function () {
                    cm.visible = false;
                    // 切出倒计时走游戏时间（tick 驱动），不依赖 setTimeout，
                    // 避免低帧率/切后台时序漂移
                    W._l188anim['curtgo_' + w.id] = {
                      kind: 'delay', t: 0, dur: 0.8, x: w.x, z: w.z, noCull: true,
                      done: function () {
                        var dest = new BR.RNG(BR.hashSeed(w.id + ':gone'))
                          .pick(['L0', 'L1', 'L11', 'L37', 'FUN']);
                        cutoutTravel(dest, '你被"消失"的窗帘带到了别处。');
                      }
                    };
                  }
                };
              }
            });
          }
          regVoice(w, 'event');
        }

        /* ② room：可观察的普通房间（床 + 床头柜台灯，近物遮远物） */
        function buildRoom(group, w) {
          var back = bayShell(group, w, 1.8, 2.3, 1.1);
          setBackTex(back, 'room_warm');
          bayBoxMesh(group, w, 0.95, 0.32, 0.55, 0x4a3a28, -0.3, -0.85, 0.62);
          bayBoxMesh(group, w, 0.95, 0.2, 0.5, 0x8a7a5c, -0.3, -0.6, 0.62);
          bayBoxMesh(group, w, 0.3, 0.5, 0.3, 0x2e2018, 0.55, -0.75, 0.7);
          bayPlane(group, w, 0.34, 0.26, 'win_warm', null, 0.55, -0.32, 0.72, 0, 0);
        }

        /* ③ pool：L37 蓝绿泳池（瓷砖柱 + 微动水面） */
        function buildPool(group, w) {
          var back = bayShell(group, w, 2.0, 2.4, 1.1);
          setBackTex(back, 'pool_tile');
          [-0.62, 0.62].forEach(function (sx) {
            bayMesh(group, w, new THREE.CylinderGeometry(0.11, 0.13, 2.2, 10),
              new THREE.MeshLambertMaterial({ color: 0x9fb8a8 }), sx, -0.1, 0.7, 0, 0, true);
          });
          var wgeo = new THREE.PlaneGeometry(1.7, 0.85, 6, 3);
          var wm = bayMesh(group, w, wgeo,
            new THREE.MeshBasicMaterial({ color: 0x3fb8d8, transparent: true, opacity: 0.9 }),
            0, -0.72, 0.6, 0, -Math.PI / 2, true);
          W._l188anim['pool_' + w.id] = {
            kind: 'water', m: wm, geo: wgeo,
            base: wgeo.attributes.position.array.slice(),
            ph: (w.x + w.z) % 6.28, x: w.x, z: w.z, amp: 0.03
          };
          regVoice(w, 'pool');
        }

        /* ③ party：Level Fun 派对（派对桌 + 浮动气球 + 彩带背板） */
        function buildParty(group, w) {
          var back = bayShell(group, w, 2.0, 2.4, 1.1);
          setBackTex(back, 'party_back');
          bayBoxMesh(group, w, 1.0, 0.08, 0.6, 0x6a4a2a, 0, -0.55, 0.62);
          bayBoxMesh(group, w, 0.08, 0.5, 0.08, 0x3a2c1c, -0.4, -0.85, 0.62);
          bayBoxMesh(group, w, 0.08, 0.5, 0.08, 0x3a2c1c, 0.4, -0.85, 0.62);
          var cols = [0xe84a5a, 0x4a9ae8, 0xf2c14a];
          var items = [];
          cols.forEach(function (c, i) {
            var b = bayMesh(group, w, new THREE.SphereGeometry(0.17, 10, 8),
              new THREE.MeshBasicMaterial({ color: c }),
              -0.5 + i * 0.5, 0.3 + (i % 2) * 0.18, 0.66, 0, 0, true);
            // 气球绳
            bayBoxMesh(group, w, 0.02, 0.75, 0.02, 0xcccccc, -0.5 + i * 0.5, -0.15 + (i % 2) * 0.18, 0.66);
            items.push({ m: b, baseY: b.position.y, ph: i * 2.1 });
          });
          W._l188anim['party_' + w.id] = { kind: 'balloon', items: items, x: w.x, z: w.z };
          regVoice(w, 'party');
        }

        /* ③ city：少量其他已完成层级局部（L11 无垠城市一角，本游戏改编） */
        function buildCity(group, w) {
          var back = bayShell(group, w, 2.0, 2.4, 1.1);
          setBackTex(back, 'city_night');
          bayBoxMesh(group, w, 0.5, 1.5, 0.3, 0x0c0e14, -0.45, -0.3, 0.8);
          bayBoxMesh(group, w, 0.4, 1.1, 0.3, 0x0c0e14, 0.4, -0.5, 0.85);
          bayPlane(group, w, 0.1, 0.1, 'win_warm', null, -0.45, 0.1, 0.96, 0, 0);
          bayPlane(group, w, 0.1, 0.1, 'win_cold', null, 0.4, -0.2, 0.96, 0, 0);
          regVoice(w, 'city');
        }

        /* ③ deep：L7 深海感（深蓝背板 + 浮游光点） */
        function buildDeep(group, w) {
          var back = bayShell(group, w, 2.0, 2.4, 1.1);
          setBackTex(back, 'deep_blue');
          var cols = [0x7fd8ff, 0xa8fff0, 0x5aa8ff];
          var items = [];
          for (var i = 0; i < 5; i++) {
            var mt = bayPlane(group, w, 0.09, 0.09, null, cols[i % 3],
              -0.7 + ((i * 37) % 140) / 100, -0.8 + ((i * 53) % 140) / 100,
              0.55 + (i % 3) * 0.14, 0, 0);
            items.push({ m: mt, bx: mt.position.x, by: mt.position.y, bz: mt.position.z, seed: i * 1.7 });
          }
          W._l188anim['deep_' + w.id] = { kind: 'mote', items: items, x: w.x, z: w.z };
          regVoice(w, 'deep');
        }

        /* ④ event：事件窗（人影 / 灯光抽搐）——明确交互后触发 */
        function buildEvent(group, w) {
          var back = bayShell(group, w, 1.8, 2.3, 1.1);
          setBackTex(back, w.variant === 'figure' ? 'win_dark' : 'room_warm');
          if (w.variant === 'figure') {
            var dark = new THREE.MeshBasicMaterial({ color: 0x2b3550 }); // 深蓝灰剪影（背板近黑，保证可见）
            var torso = bayMesh(group, w, new THREE.BoxGeometry(0.42, 1.1, 0.24), dark, 0, -0.35, 0.55, 0, 0, true);
            var head = bayMesh(group, w, new THREE.SphereGeometry(0.16, 10, 8), dark, 0, 0.38, 0.55, 0, 0, true);
            // 眼睛：两点亮红（0.085m，5m 外约 12px，保证可辨）
            var eyeM = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
            bayMesh(group, w, new THREE.PlaneGeometry(0.085, 0.085), eyeM, -0.06, 0.4, 0.72, 0, 0, true);
            bayMesh(group, w, new THREE.PlaneGeometry(0.085, 0.085), eyeM, 0.06, 0.4, 0.72, 0, 0, true);
            var dir = sideDir(w.side);
            W._l188anim['fig_' + w.id] = {
              kind: 'figure', m: torso, m2: head, ph: (w.x * 0.7 + w.z) % 6.28,
              bx: torso.position.x, by: torso.position.y, bz: torso.position.z,
              hx: head.position.x, hy: head.position.y, hz: head.position.z,
              dirx: dir.x, dirz: dir.z, lunge: 0, x: w.x, z: w.z
            };
          } else { // flicker：灯光抽搐
            var fl = bayPlane(group, w, 1.7, 2.2, 'win_warm', null, 0, 0, 0.95, 0, 0);
            W._l188anim['fli_' + w.id] = { kind: 'flicker', m: fl, t: Math.random() * 10, x: w.x, z: w.z };
          }
          if (!winSave.fired[w.id]) {
            var fp = frontPos(w, 1.8);
            W.addInteractable({
              id: 'eventwin_' + w.id, kind: 'event_window',
              chunkKey: W.chunkKeyOf(w.tx, w.ty),
              meshes: [back], pos: new THREE.Vector3(fp.x, w.y, fp.z), radius: 3.6,
              prompt: function () { return '👁 凑近看那扇窗（感觉被注视着）'; },
              canUse: function () { return !winSave.fired[w.id]; },
              use: function () {
                winSave.fired[w.id] = true;
                BR.Audio.doorCreak();
                BR.UI.toast(w.variant === 'figure' ?
                  '人影猛地贴近了玻璃——然后窗里只剩黑暗。' :
                  '灯光剧烈闪烁了几下，像有什么东西在窗后快速经过。', 3200);
                BR.Player.drainSanity(w.variant === 'figure' ? 10 : 6);
                var an = W._l188anim['fig_' + w.id];
                if (an) an.lunge = 1.2;
              }
            });
          }
          regVoice(w, 'event');
        }

        /* travel：可穿越窗（独立触发区 + 目标层级；对应房门已锁死） */
        function buildTravel(group, w) {
          var back = bayShell(group, w, 2.0, 2.4, 1.1);
          setBackTex(back, w.variant || 'corridor_l1');
          var sh = bayPlane(group, w, 1.9, 2.3, 'shimmer', null, 0, 0, 0.5, 0, 0);
          sh.material.transparent = true;
          sh.material.opacity = 0.5;
          W._l188anim['shim_' + w.id] = { kind: 'shimmer', m: sh, ph: (w.x + w.z) % 6.28, x: w.x, z: w.z };
          var fp = frontPos(w, 1.8);
          var dname = (BR.Levels[w.dest] && BR.Levels[w.dest].name) || w.dest;
          var label = w.num === '209' ? '209 房的窗' : '这扇泛着微光的窗';
          W.addInteractable({
            id: 'travelwin_' + w.id, kind: 'travel_window',
            chunkKey: W.chunkKeyOf(w.tx, w.ty),
            meshes: [back], pos: new THREE.Vector3(fp.x, w.y, fp.z), radius: 3.4,
            prompt: function () { return '🌀 穿过' + label + ' → ' + dname; },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.checkpoint();
              cutoutTravel(w.dest, '你翻过窗框，落进了' + dname + '。');
            }
          });
          if (w.dest === 'L1' && w.num === '209') W._l188odd = { x: w.x, z: w.z };
          regVoice(w, 'travel');
        }

        /* 分发：每扇窗按 meta.state 构建 */
        wins.forEach(function (w) {
          W.addChunkContent(w.tx, w.ty, function (group) {
            switch (w.state) {
              case 'plain': buildPlain(group, w); break;
              case 'curtain': buildCurtain(group, w, !!w.magic); break;
              case 'room': buildRoom(group, w); break;
              case 'pool': buildPool(group, w); break;
              case 'party': buildParty(group, w); break;
              case 'city': buildCity(group, w); break;
              case 'deep': buildDeep(group, w); break;
              case 'event': buildEvent(group, w); break;
              case 'travel': buildTravel(group, w); break;
              default: buildPlain(group, w); break;
            }
          });
        });
      })();

      /* ---------- 楼梯间：1F 上楼 / 2F 下楼（关内淡入淡出换层，真连楼层） ---------- */
      (function buildStairs() {
        function stairSteps(group, cx, cz, up) {
          for (var i = 0; i < 6; i++) {
            var k = up ? i : 5 - i;
            var st = box(1.6, 0.18, 0.5, 0x3a3230);
            st.position.set(cx, 0.3 + k * 0.32, cz + (up ? -1.2 + i * 0.28 : 1.2 - i * 0.28));
            W.reg(group, st);
          }
          var rail = box(0.08, 1.0, 2.4, 0x6a5a3a);
          rail.position.set(cx + 0.9, 1.4, cz);
          W.reg(group, rail);
        }
        var up = poi1('stair_up'); // (37,39)：1F 楼梯间大厅
        if (up) {
          W.addChunkContent(up.tx, up.ty, function (group) {
            stairSteps(group, px(up.tx), pz(up.ty), true);
            var mk = box(0.9, 0.5, 0.3, 0x8a7340);
            mk.position.set(px(up.tx), 1.1, pz(up.ty) + 1.2);
            W.reg(group, mk);
            W.addInteractable({
              id: 'stair_up', kind: 'stair_up', chunkKey: W.chunkKeyOf(up.tx, up.ty),
              meshes: [mk], pos: new THREE.Vector3(px(up.tx), 1.2, pz(up.ty) + 0.6), radius: 2.6,
              prompt: function () { return '🪜 爬上楼梯（二楼）'; },
              canUse: function () { return true; },
              use: function () {
                BR.Audio.doorCreak();
                stairFade(function () {
                  W._l188onF2 = true;
                  BR.Player.pos.set(px(37), 0, pz(52));
                  BR.Player.vel.set(0, 0, 0);
                  BR.Player.yaw = Math.PI;
                  BR.UI.toast('二楼走廊。空气更冷了。', 2600);
                });
              }
            });
          });
        }
        // 2F 楼梯间大厅（meta.l188f2.stairDown = {tx:37, ty:52}）
        W.addChunkContent(37, 52, function (group) {
          stairSteps(group, px(37), pz(52), false);
          var mk = box(0.9, 0.5, 0.3, 0x8a7340);
          mk.position.set(px(37), 1.1, pz(52) - 1.2);
          W.reg(group, mk);
          W.addInteractable({
            id: 'stair_down', kind: 'stair_down', chunkKey: W.chunkKeyOf(37, 52),
            meshes: [mk], pos: new THREE.Vector3(px(37), 1.2, pz(52) - 0.6), radius: 2.6,
            prompt: function () { return '🪜 走下楼梯（一楼）'; },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.doorCreak();
              stairFade(function () {
                W._l188onF2 = false;
                BR.Player.pos.set(px(37), 0, pz(39));
                BR.Player.vel.set(0, 0, 0);
                BR.Player.yaw = 0;
                BR.UI.toast('一楼楼梯间。', 2200);
              });
            }
          });
        });
      })();

      /* ---------- 紧急出口（位置随机；目的地=已完成层级池） ---------- */
      (function buildEmergencyExit() {
        var p = poi1('emergency_exit'); if (!p) return;
        var dx = p.data.dx || 0, dz = p.data.dz || 0;
        var dest = p.data.dest || 'L0';
        W.addChunkContent(p.tx, p.ty, function (group) {
          var wx = px(p.tx) + dx * (T / 2 - 0.1), wz = pz(p.ty) + dz * (T / 2 - 0.1);
          var doorM = box(1.3, 2.7, 0.16, 0x1e3a24);
          doorM.position.set(wx, 1.35, wz);
          doorM.rotation.y = Math.atan2(dx, dz);
          W.reg(group, doorM);
          var sign = basicPlane(0.9, 0.3, 'exit_sign');
          sign.position.set(wx + dx * 0.12, 2.62, wz + dz * 0.12);
          sign.rotation.y = Math.atan2(dx, dz);
          W.reg(group, sign);
          var dname = (BR.Levels[dest] && BR.Levels[dest].name) || dest;
          W.addInteractable({
            id: 'emergency_exit', kind: 'emergency_exit',
            chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [doorM],
            pos: new THREE.Vector3(wx - dx * 1.2, 1.4, wz - dz * 1.2), radius: 2.8,
            prompt: function () { return '🚨 紧急出口（推开）'; },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.doorCreak();
              cutoutTravel(dest, '你撞开紧急出口，来到了' + dname + '。');
            }
          });
        });
      })();

      /* ---------- 客房（三布局 std/twin/desk；衣柜交互；窗帘装扮；降吊顶） ---------- */
      (function buildRooms() {
        function buildOneRoom(x0, y0, w, h, num, locked, ctx, cty) {
          var cx = (x0 + w / 2) * T, cz = (y0 + h / 2) * T;
          var layout = new BR.RNG(BR.hashSeed('room:' + num)).pick(['std', 'twin', 'desk']);
          W._l188dropCeil(cx, cz, w * T - 0.3, h * T - 0.3);
          W.addChunkContent(ctx, cty, function (group) {
            function bed(bx, bz, bw2) {
              var b = box(bw2, 0.4, 1.9, 0x4a3a28); b.position.set(bx, 0.2, bz); W.reg(group, b);
              var m2 = box(bw2 - 0.1, 0.18, 1.8, 0x8a7a5c); m2.position.set(bx, 0.48, bz); W.reg(group, m2);
              var pil = box(bw2 - 0.3, 0.14, 0.4, 0xb0a890); pil.position.set(bx, 0.6, bz - 0.6); W.reg(group, pil);
            }
            if (layout === 'std') bed(cx - 1.2, cz, 1.6);
            else if (layout === 'twin') { bed(cx - 2.0, cz, 1.1); bed(cx + 0.4, cz, 1.1); }
            else {
              bed(cx - 1.6, cz + 0.8, 1.4);
              var dk = box(1.4, 0.08, 0.7, 0x4a3a24); dk.position.set(cx + 1.6, 0.75, cz - 1.0); W.reg(group, dk);
              [-0.6, 0.6].forEach(function (o) {
                var leg = box(0.08, 0.75, 0.08, 0x3a2c1c);
                leg.position.set(cx + 1.6 + o, 0.37, cz - 1.0); W.reg(group, leg);
              });
              var ch = box(0.45, 0.5, 0.45, 0x2e2620); ch.position.set(cx + 1.6, 0.25, cz - 0.2); W.reg(group, ch);
            }
            // 衣柜（可交互；确定性掉落；一次性，W.state.picked 持久化）
            var cab = box(1.1, 2.2, 0.6, 0x3a2c1c);
            cab.position.set(cx + w * T / 2 - 1.0, 1.1, cz - h * T / 2 + 0.8);
            W.reg(group, cab);
            var cabId = 'cabinet_' + num;
            if (W.state.picked.indexOf(cabId) < 0 && !locked) {
              var loot = new BR.RNG(BR.hashSeed('cab:' + num)).pick(['almond', 'bandage', 'almond', 'empty']);
              W.addInteractable({
                id: cabId, kind: 'cabinet', chunkKey: W.chunkKeyOf(ctx, cty),
                meshes: [cab], pos: new THREE.Vector3(cab.position.x, 1.2, cab.position.z + 1.0), radius: 2.6,
                prompt: function () { return '🗄 打开衣柜'; },
                canUse: function () { return W.state.picked.indexOf(cabId) < 0; },
                use: function () {
                  W.state.picked.push(cabId);
                  BR.Audio.doorCreak();
                  if (loot === 'empty') { BR.UI.toast('衣柜里只有几件发霉的旧衣服。', 2400); return; }
                  BR.Game.inv[loot] = (BR.Game.inv[loot] || 0) + 1;
                  BR.UI.updateInv();
                  BR.UI.toast('在衣柜里找到：' + (ITEM_NAME[loot] || loot) + '。', 2600);
                }
              });
            }
            // 房内窗（winKind 装扮；blinds 另加窗帘布）
            var wk = 'warm';
            var hit = byType('hotel_room').filter(function (q) { return q.data.num === num; })[0];
            if (hit && hit.data.winKind) wk = hit.data.winKind;
            var wtx = wk === 'warm' ? 'win_warm' : wk === 'cold' ? 'win_cold' :
              wk === 'blinds' ? 'blinds' : 'win_dark';
            var wp = basicPlane(1.3, 1.7, wtx);
            wp.position.set(cx, 1.8, cz - h * T / 2 + 0.12);
            W.reg(group, wp);
            if (wk === 'blinds') {
              var cu = basicPlane(1.2, 1.6, 'win_curtain');
              cu.position.set(cx, 1.8, cz - h * T / 2 + 0.2);
              W.reg(group, cu);
            }
          });
        }
        byType('hotel_room').forEach(function (p) {
          var d = p.data || {};
          buildOneRoom(d.x0, d.y0, d.w, d.h, d.num, d.locked, p.tx, p.ty);
        });
        (f2.rooms || []).forEach(function (fr) { // 2F 客房（tile=2 区）
          buildOneRoom(fr.x, fr.y, fr.w, fr.h, fr.num, fr.locked,
            Math.round(fr.x + (fr.w - 1) / 2), Math.round(fr.y + (fr.h - 1) / 2));
        });
      })();

      /* ---------- 走廊装扮：灯具 / 转角植物 / 长椅 ---------- */
      (function dressCorridors() {
        function lampAt(tx, ty) {
          W.addChunkContent(tx, ty, function (group) {
            var m = basicPlane(0.7, 0.35, 'win_warm');
            m.rotation.x = Math.PI / 2;
            m.position.set(px(tx), 3.05, pz(ty));
            W.reg(group, m);
          });
        }
        var ci;
        for (ci = 22; ci <= 35; ci += 4) { lampAt(17, ci); lampAt(38, ci); }
        for (ci = 18; ci <= 44; ci += 5) { lampAt(ci, 37); }
        [[17, 36], [38, 36], [17, 22], [38, 22]].forEach(function (c) { // 转角植物
          W.addChunkContent(c[0], c[1], function (group) {
            var potM = new THREE.MeshLambertMaterial({ color: 0x5a3a28 });
            var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.45, 10), potM);
            pot._ownMat = true;
            pot.position.set(px(c[0]) + 0.9, 0.22, pz(c[1]) + 0.9);
            W.reg(group, pot);
            for (var i = 0; i < 3; i++) {
              var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.3 - i * 0.07, 0.7, 8),
                new THREE.MeshLambertMaterial({ color: 0x1e4a24 }));
              leaf._ownMat = true;
              leaf.position.set(px(c[0]) + 0.9, 0.8 + i * 0.45, pz(c[1]) + 0.9);
              W.reg(group, leaf);
            }
          });
        });
        [[20, 37], [42, 37]].forEach(function (c) { // 南走廊长椅
          W.addChunkContent(c[0], c[1], function (group) {
            var b = box(2.0, 0.12, 0.5, 0x3a2c1c);
            b.position.set(px(c[0]), 0.5, pz(c[1]) - 0.9);
            W.reg(group, b);
            [-0.8, 0.8].forEach(function (o) {
              var leg = box(0.12, 0.5, 0.45, 0x2a2018);
              leg.position.set(px(c[0]) + o, 0.25, pz(c[1]) - 0.9);
              W.reg(group, leg);
            });
          });
        });
      })();

      /* ---------- 保留旧内容：休息室 / 员工室 / 收音机 / L11 楼梯 / 字条 / 板条箱 / 薄墙 ---------- */
      (function buildLegacy() {
        var lounge = poi1('lounge'); // 休息室 (25..32, 39..44)
        if (lounge) {
          W._l188dropCeil(px(28), pz(41), 20, 14);
          W.addChunkContent(28, 41, function (group) {
            [[80.5, 123, 0], [87.5, 129, Math.PI]].forEach(function (s) {
              var sofa = box(2.4, 0.55, 0.9, 0x4a2c3a);
              sofa.position.set(s[0], 0.35, s[1]); sofa.rotation.y = s[2];
              W.reg(group, sofa);
              var backr = box(2.4, 0.7, 0.25, 0x3a2230);
              backr.position.set(s[0] - Math.sin(s[2]) * 0.5, 0.85, s[1] - Math.cos(s[2]) * 0.5);
              W.reg(group, backr);
            });
            var tbl = box(1.2, 0.4, 0.7, 0x3a2c1c);
            tbl.position.set(84, 0.2, 126); W.reg(group, tbl);
          });
        }
        var staff = poi1('staff_room'); // 员工室 (40..44, 39..43)
        if (staff) {
          W._l188dropCeil(px(42), pz(41), 14, 12);
          W.addChunkContent(42, 41, function (group) {
            for (var i = 0; i < 3; i++) { // 货架
              var sh = box(2.2, 0.08, 0.5, 0x4a3a24);
              sh.position.set(px(43), 0.8 + i * 0.6, pz(42) + 1.2);
              W.reg(group, sh);
            }
            var dk = box(1.6, 0.08, 0.8, 0x3a2c1c);
            dk.position.set(px(41), 0.75, pz(40) - 1.0); W.reg(group, dk);
          });
        }
        var radio = poi1('radio'); // 休息室收音机
        if (radio) {
          W.addChunkContent(radio.tx, radio.ty, function (group) {
            var rx = px(radio.tx), rz = pz(radio.ty);
            var bodyM = box(0.7, 0.45, 0.28, 0x2e2620);
            bodyM.position.set(rx, 1.05, rz);
            W.reg(group, bodyM);
            var faceM = basicPlane(0.6, 0.3, 'radio_front');
            faceM.position.set(rx, 1.05, rz + 0.15);
            W.reg(group, faceM);
            var ant = box(0.03, 0.7, 0.03, 0x888888);
            ant.position.set(rx + 0.25, 1.6, rz);
            W.reg(group, ant);
            W.addInteractable({
              id: 'radio_l188', kind: 'radio',
              chunkKey: W.chunkKeyOf(radio.tx, radio.ty),
              meshes: [bodyM], pos: new THREE.Vector3(rx, 1.1, rz + 0.6), radius: 2.6,
              prompt: function () {
                var d = W._l188odd ? dist2D(rx, rz, W._l188odd.x, W._l188odd.z) : 99;
                return '📻 收音机（信号 ' + sigBars(d) + '）';
              },
              canUse: function () { return true; },
              use: function () {
                var d = W._l188odd ? dist2D(rx, rz, W._l188odd.x, W._l188odd.z) : 99;
                BR.UI.toast(d < 25 ?
                  '杂音里混着规律的滴答声——来自中庭方向。信号' + sigBars(d) :
                  '只有杂音。把它搬到中庭窗户附近试试？信号' + sigBars(d), 3000);
              }
            });
          });
        }
        var sw = poi1('stairwell'); // 员工室楼梯间 → L11（旧逻辑保留）
        if (sw) {
          W.addChunkContent(sw.tx, sw.ty, function (group) {
            var sx = px(sw.tx), sz = pz(sw.ty);
            for (var i = 0; i < 5; i++) {
              var st = box(1.4, 0.16, 0.45, 0x3a3230);
              st.position.set(sx, 0.25 + i * 0.3, sz - 1.0 + i * 0.26);
              W.reg(group, st);
            }
            var mk = box(0.8, 0.4, 0.25, 0x8a7340);
            mk.position.set(sx, 1.0, sz + 1.1);
            W.reg(group, mk);
            W.addInteractable({
              id: 'stairwell_l11', kind: 'stairwell',
              chunkKey: W.chunkKeyOf(sw.tx, sw.ty),
              meshes: [mk], pos: new THREE.Vector3(sx, 1.1, sz + 0.5), radius: 2.6,
              prompt: function () { return '🪜 员工楼梯（向下，标着 L11）'; },
              canUse: function () { return true; },
              use: function () {
                BR.Audio.doorCreak();
                cutoutTravel('L11', '楼梯一直向下，你走进了无垠城市。');
              }
            });
          });
        }
        byType('note').forEach(function (p) { // 字条
          var nn = L188_NOTES[p.data.noteId] || ['字条', '……'];
          W.addChunkContent(p.tx, p.ty, function (group) {
            var m = basicPlane(0.5, 0.65, 'note');
            m.position.set(px(p.tx), 1.5, pz(p.ty) - 1.2);
            W.reg(group, m);
            var nid = 'note_l188_' + p.tx + '_' + p.ty;
            W.addInteractable({
              id: nid, kind: 'note', chunkKey: W.chunkKeyOf(p.tx, p.ty),
              meshes: [m], pos: m.position.clone(), radius: 2.4,
              prompt: function () { return '📄 阅读字条'; },
              canUse: function () { return true; },
              use: function () {
                BR.Audio.paper();
                BR.UI.showNote(nn[0], nn[1]);
                if (W.state.picked.indexOf(nid) < 0) W.state.picked.push(nid);
              }
            });
          });
        });
        byType('crate').forEach(function (p) { // 板条箱（两段式开启）
          W.addChunkContent(p.tx, p.ty, function (group) {
            var cm = BR.buildCrateMesh(W);
            cm.group.position.set(px(p.tx), 0, pz(p.ty));
            W.reg(group, cm.group);
            BR.wireCrateTwoStage(W, group, cm, {
              id: 'crate_l188_' + p.tx + '_' + p.ty,
              tx: p.tx, ty: p.ty, item: (p.data && p.data.item) || 'empty'
            });
          });
        });
        if (BR.buildThinWalls) BR.buildThinWalls(map, W); // 薄墙（贴墙挤压跨关切出）
      })();

      W.objective = '探索百窗庭：数一数亮着的窗，或从异常的窗户离开';
    }, // end buildContent

    onEnter: function () {
      var W = BR.World;
      // 记录来源层级（返回门用）。BR.Game._cameFrom 可能是字符串（lv 手动设置）
      // 或 {from, kind, t} 对象（Cutout.travel 设置），两种都兼容。
      try {
        var cf = BR.Game && BR.Game._cameFrom;
        var from = 'L0';
        if (typeof cf === 'string') from = cf;
        else if (cf && typeof cf.from === 'string') from = cf.from;
        if (from === 'L188') from = 'L0';
        W.state.l188_from = from;
      } catch (e) { W.state.l188_from = 'L0'; }
      W._l188t = 0; W._l188sndT = 0; W._l188flipT = 1;
      BR.Audio.setAmbient('L188');
      if (BR.UI && W.objective) BR.UI.setObjective(W.objective);
      setTimeout(function () {
        if (BR.Game.state === 'playing')
          BR.UI.toast('百窗庭。夜色里四面高楼围着你，窗户亮着，像没睡的人。', 3600);
      }, 1200);
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player;
      if (!W || !P || BR.Game.state !== 'playing') return;
      if (BR.thinWallTick) BR.thinWallTick(dt);
      var t = (W._l188t = (W._l188t || 0) + dt);
      var px0 = P.pos.x, pz0 = P.pos.z;
      var key, i;

      /* —— 动画：只更新 45m 内（低频更新画面，不为每扇窗全量跑）；
         noCull 条目（玩家刚触发的序列）不受距离裁剪，避免走开导致序列卡死 —— */
      for (key in W._l188anim) {
        var an = W._l188anim[key];
        if (!an) continue;
        var dx = (an.x || 0) - px0, dz = (an.z || 0) - pz0;
        if (!an.noCull && dx * dx + dz * dz > 2025) continue;
        if (an.kind === 'water') {
          var pos = an.geo.attributes.position, base = an.base;
          for (i = 0; i < pos.count; i++) {
            var bx = base[i * 3], by = base[i * 3 + 1];
            pos.array[i * 3 + 2] = Math.sin(t * 2.2 + bx * 3.1 + an.ph) * an.amp +
              Math.cos(t * 1.7 + by * 4.2) * an.amp * 0.6;
          }
          pos.needsUpdate = true;
        } else if (an.kind === 'balloon') {
          for (i = 0; i < an.items.length; i++) {
            var it = an.items[i];
            it.m.position.y = it.baseY + Math.sin(t * 1.4 + it.ph) * 0.12;
          }
        } else if (an.kind === 'mote') {
          for (i = 0; i < an.items.length; i++) {
            var mo = an.items[i];
            mo.m.position.set(mo.bx + Math.sin(t * 0.5 + mo.seed) * 0.16,
              mo.by + Math.sin(t * 0.7 + mo.seed * 2.0) * 0.13,
              mo.bz + Math.cos(t * 0.42 + mo.seed) * 0.1);
          }
        } else if (an.kind === 'figure') {
          if (an.lunge > 0) { // 事件触发：人影前冲
            an.lunge -= dt;
            var k = Math.max(0, an.lunge) / 1.2;
            var off = (1 - k) * 0.55;
            an.m.position.set(an.bx + an.dirx * off, an.by, an.bz + an.dirz * off);
            an.m2.position.set(an.hx + an.dirx * off, an.hy, an.hz + an.dirz * off);
          } else {
            var swy = Math.sin(t * 0.9 + an.ph) * 0.06;
            an.m.position.x = an.bx + swy;
            an.m2.position.x = an.hx + swy;
          }
        } else if (an.kind === 'flicker') {
          an.t += dt;
          an.m.visible = (Math.sin(an.t * 31) + Math.sin(an.t * 17.3)) > -0.6;
        } else if (an.kind === 'shimmer') {
          an.m.material.opacity = 0.38 + Math.sin(t * 2.4 + an.ph) * 0.18;
        } else if (an.kind === 'slide') { // 魔术窗帘滑动
          an.t += dt;
          var p = Math.min(1, an.t / an.dur);
          an.m.position.x = an.fromX + (an.toX - an.fromX) * p * p;
          if (p >= 1 && !an.doneCalled) {
            an.doneCalled = true;
            delete W._l188anim[key];
            an.done();
          }
        } else if (an.kind === 'delay') { // 通用游戏时间延迟（魔术窗帘切出倒计时等）
          an.t += dt;
          if (an.t >= an.dur && !an.doneCalled) {
            an.doneCalled = true;
            delete W._l188anim[key];
            an.done();
          }
        }
      }

      /* —— 普通窗翻转（偶尔；蓝窗/黑窗/帘窗永不翻转；状态进存档） —— */
      W._l188flipT -= dt;
      if (W._l188flipT <= 0) {
        W._l188flipT = 0.6;
        for (key in W._l188wins) {
          var e = W._l188wins[key];
          if (!e || (e.sub !== 'warm' && e.sub !== 'cold')) continue;
          var edx = e.def.x - px0, edz = e.def.z - pz0;
          if (edx * edx + edz * edz > 3600) continue;
          if (!e.nextFlip) e.nextFlip = t + 15 + Math.random() * 40;
          if (t >= e.nextFlip) {
            e.nextFlip = t + 25 + Math.random() * 50;
            var wl = W.state.l188win.wins;
            var st = wl[key] || (wl[key] = { lit: true });
            st.lit = !st.lit;
            e.mesh.material.map = BR.Textures.get(st.lit ? e.litTex : 'win_dark');
            e.mesh.material.needsUpdate = true;
          }
        }
      }

      /* —— 窗景近场声：0.25s 一次；距离 + 遮挡衰减；仅靠近对应窗口轻微出现 —— */
      W._l188sndT -= dt;
      if (W._l188sndT <= 0 && BR.Audio) {
        W._l188sndT = 0.25;
        var voices = BR.Audio._l188voices;
        if (voices && W._l188winPos.length) {
          var kinds = ['pool', 'party', 'city', 'deep', 'event', 'travel'];
          for (var vi = 0; vi < kinds.length; vi++) {
            var vk = kinds[vi], bw = null, bd = 1e9;
            for (i = 0; i < W._l188winPos.length; i++) {
              var wp = W._l188winPos[i];
              if (wp.vkind !== vk) continue;
              var ddx = wp.x - px0, ddz = wp.z - pz0;
              var dd = Math.sqrt(ddx * ddx + ddz * ddz);
              if (dd < bd) { bd = dd; bw = wp; }
            }
            var target = 0;
            if (bw && bd < 26) {
              var occ = occlWalls(W, px0, pz0, bw.x, bw.z);
              target = 0.5 * Math.max(0, 1 - bd / 26) * Math.pow(0.22, occ);
            }
            try { voices[vk].gain.setTargetAtTime(target, BR.Audio._t(), 0.3); }
            catch (ee) { /* 音频未就绪 */ }
          }
          // 窗户静电：靠近任一异常窗
          var statG = BR.Audio._l188static;
          if (statG) {
            var sd = 1e9;
            for (i = 0; i < W._l188winPos.length; i++) {
              var sp2 = W._l188winPos[i];
              var sdx = sp2.x - px0, sdz = sp2.z - pz0;
              var sdd = Math.sqrt(sdx * sdx + sdz * sdz);
              if (sdd < sd) sd = sdd;
            }
            var starget = sd < 30 ? 0.35 * Math.max(0, 1 - sd / 30) : 0;
            try { statG.gain.setTargetAtTime(starget, BR.Audio._t(), 0.4); } catch (ee2) {}
          }
        }
      }
    }
  };

  // 遮挡计数：玩家→窗口连线穿过几格墙（tile=0；tile=2 视为可通过）
  function occlWalls(W, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var steps = Math.max(1, Math.floor(dist / 1.5));
    var n = 0;
    for (var i = 1; i < steps; i++) {
      var tx = Math.floor((ax + dx * i / steps) / T);
      var ty = Math.floor((az + dz * i / steps) / T);
      if (W.tile(tx, ty) === 0) { n++; if (n >= 3) break; }
    }
    return n;
  }
})();
