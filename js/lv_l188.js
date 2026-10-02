/* lv_l188.js —— Level 188「百窗庭」内容构建
 * 原型：Fandom Backrooms Wiki Level 188 "The Windows"（酒店版）[本游戏改编]。
 *   中央中庭 + 四周多层窗户（暖黄安全窗 / 惨白危险窗 / 闭窗百叶 / 暗窗），
 *   环绕走廊 + 10 间客房（约 70% 房门上锁：开窗对应的房门被锁死） + 休息室 + 员工室。
 *   与 Wikidot Level 881 无关。
 *
 * POI 类型（gen_l188.js 放置）：
 *   spawn      出生点：狭窄破旧小房间
 *   balcony    阳台：俯瞰中庭（栏杆）
 *   hotel_room 客房 {num, winKind, locked}：床/床头柜/灯
 *   room_door  房门 {doorId, num, locked}：房号牌（门体走 map.doors → W.addDoor）
 *   lounge     休息室：沙发/收音机桌
 *   staff_room 员工室：储物柜/书桌
 *   radio      收音机 → L0（见下方 kind 清单）
 *   odd_window 异常窗 → L1（南墙下，惨白光 + 错误闪烁）
 *   stairwell  楼梯间 → L11（员工室北侧，向上）
 *   note / crate：字条 / 板条箱（kind 沿用 'note' / 'crate'）
 *
 * interactable kind 清单（供 Systems B 统一注册/放行）：
 *   'radio'      收音机：prompt 显示信号强度（离异常窗越近越强）；use → BR.Cutout.travel('L0')
 *   'odd_window' 异常窗：use → BR.Cutout.travel('L1')
 *   'stairwell'  楼梯间：use → BR.Cutout.travel('L11')
 *   （'note' / 'crate' / 'door' 为旧关已有 kind，直接复用）
 *
 * 观察式去路（不许挨个点门试运气）：
 *   - 全关 45 扇窗只有 odd_window 是可交互的；其余皆为装饰。
 *   - 线索：环境音里的静电强度随靠近异常窗增强（tick 调制，见 gen_l188.js 的 ambient）；
 *     收音机 prompt 显示信号格；字条 L188_note0 / note1 明示"南侧惨白窗/楼梯只能上"；
 *     首次靠近异常窗 7m 内给 toast 观察反馈。
 *   - 异常房间内容走氛围：惨白窗棂后隐约人影、收音机杂音、灯光闪烁差异；无跳脸。
 */
(function () {
  var BR = window.BR;
  var T = BR.TILE;
  var ITEM_NAME = { almond: '杏仁水', bandage: '绷带' };

  function px(tx) { return BR.tileCX(tx); }
  function pz(ty) { return BR.tileCZ(ty); }

  // 切出统一入口（Systems A 提供 BR.Cutout；未就绪时降级提示，不抛错）
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
      wallH: 7.5, wall: 'hotel_wall', floor: 'hotel_floor', ceil: 'hotel_ceil',
      surface: 'carpet', fixtureEvery: 6, flickerRate: 0.18
    },

    buildContent: function (map, W) {
      W._l188wins = {};   // id -> {glow, kind, phase, t}
      W._l188odd = null;  // {x, z} 异常窗世界坐标

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
      function glowPlane(w, h, texName) {
        var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ map: BR.Textures.get(texName) }));
        m._ownMat = true;
        return m;
      }

      /* ---------- 门（全部经 W.addDoor；生锈金属门观感走默认 doorMetal） ---------- */
      for (var di = 0; di < map.doors.length; di++) {
        (function (d) {
          W.addDoor({ id: d.id, tx: d.tx, ty: d.ty, axis: d.axis, locked: d.locked, label: d.label });
        })(map.doors[di]);
      }

      /* ---------- 房号牌（门上/门侧黄铜牌） ---------- */
      byType('room_door').forEach(function (p) {
        W.addChunkContent(p.tx, p.ty, function (group) {
          // 牌面朝向走廊一侧：找相邻地板
          var dirs = [[0, -1, Math.PI, 0], [0, 1, 0, 0], [-1, 0, Math.PI / 2, 0], [1, 0, -Math.PI / 2, 0]];
          var face = dirs[0];
          for (var i = 0; i < dirs.length; i++) {
            var dd = dirs[i];
            if (W.tile(p.tx + dd[0], p.ty + dd[1]) === 1) { face = dd; break; }
          }
          var c = document.createElement('canvas');
          c.width = 128; c.height = 64;
          var x = c.getContext('2d');
          x.fillStyle = '#2e2414'; x.fillRect(0, 0, 128, 64);
          x.strokeStyle = '#8a7340'; x.lineWidth = 4; x.strokeRect(4, 4, 120, 56);
          x.fillStyle = '#e8d9a0'; x.font = 'bold 34px sans-serif';
          x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(String(p.data.num), 64, 34);
          var tex = new THREE.CanvasTexture(c);
          var m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31),
            new THREE.MeshBasicMaterial({ map: tex }));
          m._ownMat = true;
          var wx = px(p.tx) + face[0] * (T / 2 + 0.06), wz = pz(p.ty) + face[1] * (T / 2 + 0.06);
          m.position.set(wx, 2.95, wz);
          m.rotation.y = face[2];
          W.reg(group, m);
          var m2 = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31),
            new THREE.MeshBasicMaterial({ map: tex }));
          m2._ownMat = true; // 背面也挂一块（走廊/房间双侧可见）
          m2.position.set(px(p.tx) - face[0] * (T / 2 + 0.06), 2.95, pz(p.ty) - face[1] * (T / 2 + 0.06));
          m2.rotation.y = face[2] + Math.PI;
          W.reg(group, m2);
        });
      });

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

      /* ---------- 中庭窗户（两层；暖黄/惨白/百叶/暗窗） ---------- */
      var winRng = new BR.RNG(BR.hashSeed(map.seed + ':l188wins'));
      function winKindOf(num) {
        if (num === '209') return 'odd';
        for (var i = 0; i < map.pois.length; i++) {
          var q = map.pois[i];
          if (q.type === 'hotel_room' && String(q.data.num) === String(num)) return q.data.winKind;
        }
        if (num === 'lounge') return 'warm';
        return winRng.pick(['warm', 'warm', 'warm', 'cold', 'cold', 'dark', 'blinds', 'warm', 'cold', 'dark']);
      }
      function texOfKind(kind) {
        return kind === 'warm' ? 'win_warm' : kind === 'cold' || kind === 'odd' ? 'win_cold' :
          kind === 'blinds' ? 'blinds' : 'win_dark';
      }
      // 在中庭墙面上放一扇窗：side S/W/E=真墙，N=阳台上方假立面
      // 各侧发光面必须在墙面/立面之前（viewer 侧），frame 略凸出墙面
      function addWindow(id, ctx2, wx, hy, wz, ry, kind, num) {
        var frameRy = (ry === Math.PI || ry === 0) ? 0 : Math.PI / 2;
        W.addChunkContent(ctx2[0], ctx2[1], function (group) {
          var frame = box(2.0, 2.4, 0.14, 0x241c12);
          frame.position.set(wx, hy, wz);
          frame.rotation.y = frameRy;
          W.reg(group, frame);
          var glow = glowPlane(1.7, 2.1, texOfKind(kind));
          // 发光面：框中心 viewer 侧 0.09（框半厚 0.07 + 0.02 间隙）
          var gx = wx, gz = wz, off = 0.09;
          if (ry === Math.PI) gz = wz - off;             // 南墙：朝北
          else if (ry === 0) gz = wz + off;              // 北立面：朝南
          else if (ry === Math.PI / 2) gx = wx - off;    // 西墙：朝东
          else gx = wx + off;                            // 东墙：朝西
          glow.position.set(gx, hy, gz);
          glow.rotation.y = ry;
          W.reg(group, glow);
          W._l188wins[id] = { glow: glow, kind: kind, phase: winRng.next() * 9, t: 0 };
          if (kind === 'odd') W._l188odd = { x: gx, z: gz };
          if (num) { // 窗下小房号牌
            var c = document.createElement('canvas');
            c.width = 128; c.height = 48;
            var x2 = c.getContext('2d');
            x2.fillStyle = '#241c10'; x2.fillRect(0, 0, 128, 48);
            x2.fillStyle = '#c8b078'; x2.font = 'bold 28px sans-serif';
            x2.textAlign = 'center'; x2.textBaseline = 'middle';
            x2.fillText(String(num), 64, 26);
            var pm = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.21),
              new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
            pm._ownMat = true;
            var poff = 0.1, pxx = wx, pzz = wz;
            if (ry === Math.PI) pzz -= poff; else if (ry === 0) pzz += poff;
            else if (ry === Math.PI / 2) pxx += poff; else pxx -= poff;
            pm.position.set(pxx, hy - 1.55, pzz);
            pm.rotation.y = ry;
            W.reg(group, pm);
          }
        });
      }
      var S = 107.93;   // 南墙窗框中心 z（墙面 z=108，框凸出）
      var WE = 59.93;   // 西墙窗框中心 x（墙面 x=60）
      var EA = 108.07;  // 东墙窗框中心 x（墙面 x=108）
      var NF = 66.22;   // 北立面窗框中心 z（立面 z=66.15）
      var sx;
      for (sx = 22; sx <= 34; sx += 2) { // 南墙：上下两层
        var numS = sx === 22 ? '208' : sx === 28 ? '209' : sx === 32 ? 'lounge' : null;
        var kS = winKindOf(numS || ('s' + sx)); // '209' → 'odd'（异常窗）
        addWindow('s0_' + sx, [sx, 36], px(sx), 1.7, S, Math.PI, kS, numS === 'lounge' ? '休息室' : numS);
        addWindow('s1_' + sx, [sx, 36], px(sx), 4.7, S, Math.PI, winKindOf('s1_' + sx), null);
      }
      var wy;
      for (wy = 24; wy <= 34; wy += 2) { // 西墙 / 东墙：上下两层
        var numW = wy === 24 ? '201' : wy === 30 ? '202' : wy === 34 ? '203' : null;
        var numE = wy === 24 ? '205' : wy === 30 ? '206' : wy === 34 ? '207' : null;
        addWindow('w0_' + wy, [19, wy], WE, 1.7, pz(wy), Math.PI / 2, winKindOf(numW || ('w' + wy)), numW);
        addWindow('w1_' + wy, [19, wy], WE, 4.7, pz(wy), Math.PI / 2, winKindOf('w1_' + wy), null);
        addWindow('e0_' + wy, [36, wy], EA, 1.7, pz(wy), -Math.PI / 2, winKindOf(numE || ('e' + wy)), numE);
        addWindow('e1_' + wy, [36, wy], EA, 4.7, pz(wy), -Math.PI / 2, winKindOf('e1_' + wy), null);
      }
      // 北立面（阳台上方假立面，营造上层楼感）
      W.addChunkContent(27, 21, function (group) {
        var fac = new THREE.Mesh(new THREE.PlaneGeometry(48, 4.8),
          new THREE.MeshBasicMaterial({ color: 0x0b0a08 }));
        fac._ownMat = true;
        fac.position.set(28 * T, 5.0, 66.15);
        W.reg(group, fac);
      });
      var nx;
      for (nx = 22; nx <= 34; nx += 2) {
        var numN = nx === 22 ? '210' : nx === 34 ? '211' : null;
        addWindow('n_' + nx, [nx, 21], px(nx), 4.9, NF, 0, winKindOf(numN || ('n' + nx)), numN);
      }
      // 中庭冷光（穹顶微光，氛围）
      W.addChunkContent(27, 28, function (group) {
        var L = new THREE.PointLight(0xbfd4ff, 0.45, 34, 2);
        L.position.set(px(27), 6.4, pz(28));
        W.reg(group, L);
      });

      /* ---------- 客房：床 / 床头柜 / 台灯 ---------- */
      byType('hotel_room').forEach(function (p) {
        W.addChunkContent(p.tx, p.ty, function (group) {
          var cx = px(p.tx), cz = pz(p.ty);
          var bedC = 0x4e4438;
          var bed = box(2.2, 0.45, 1.3, bedC);
          bed.position.set(cx - 0.3, 0.225, cz + 0.5);
          W.reg(group, bed);
          var pillow = box(0.55, 0.14, 0.9, 0x8a8272);
          pillow.position.set(cx - 1.1, 0.52, cz + 0.5);
          W.reg(group, pillow);
          var stand = box(0.55, 0.6, 0.55, 0x3a2c1c);
          stand.position.set(cx + 1.15, 0.3, cz + 0.5);
          W.reg(group, stand);
          if (p.data.winKind !== 'dark') { // 台灯（暗房无灯）
            var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 8),
              new THREE.MeshLambertMaterial({ color: 0x2a2018 }));
            pole._ownMat = true;
            pole.position.set(cx + 1.15, 0.85, cz + 0.5);
            W.reg(group, pole);
            var shade = glowPlane(0.34, 0.26, p.data.winKind === 'cold' ? 'win_cold' : 'win_warm');
            shade.position.set(cx + 1.15, 1.15, cz + 0.5);
            shade.rotation.y = Math.PI;
            W.reg(group, shade);
          }
          // 衣柜
          var cab = box(0.6, 1.9, 1.1, 0x3a2c1c);
          cab.position.set(cx + 1.4, 0.95, cz - 1.2);
          W.reg(group, cab);
        });
      });

      /* ---------- 休息室：沙发 / 茶几 / 地毯 / 落地灯 / 收音机 ---------- */
      (function () {
        var p = poi1('lounge'); if (!p) return;
        var cx = px(p.tx), cz = pz(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.2),
            new THREE.MeshLambertMaterial({ color: 0x4a2e28 }));
          rug._ownMat = true;
          rug.rotation.x = -Math.PI / 2;
          rug.position.set(cx, 0.02, cz);
          W.reg(group, rug);
          [[-1.6, 0], [1.6, Math.PI]].forEach(function (s) {
            var sofa = box(2.3, 0.75, 1.0, 0x44503e);
            sofa.position.set(cx + s[0], 0.375, cz - 1.2);
            sofa.rotation.y = s[1];
            W.reg(group, sofa);
            var back = box(2.3, 0.75, 0.28, 0x3a4434);
            back.position.set(cx + s[0], 0.95, cz - 1.2 + (s[1] ? 0.42 : -0.42));
            W.reg(group, back);
          });
          var table = box(1.5, 0.42, 0.85, 0x3a2c1c);
          table.position.set(cx, 0.21, cz - 1.2);
          W.reg(group, table);
          // 落地灯 + 暖光
          var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 1.7, 8),
            new THREE.MeshLambertMaterial({ color: 0x2a2018 }));
          pole._ownMat = true;
          pole.position.set(cx - 2.6, 0.85, cz + 1.4);
          W.reg(group, pole);
          var shade = glowPlane(0.5, 0.4, 'win_warm');
          shade.position.set(cx - 2.6, 1.85, cz + 1.4);
          W.reg(group, shade);
          var L = new THREE.PointLight(0xffc98a, 0.85, 14, 2);
          L.position.set(cx - 2.6, 2.1, cz + 1.4);
          W.reg(group, L);
          // 收音机桌 + 收音机
          var rtable = box(0.9, 0.72, 0.6, 0x3a2c1c);
          rtable.position.set(cx + 2, 0.36, cz + 1.2);
          W.reg(group, rtable);
          var radio = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.34, 0.3),
            new THREE.MeshLambertMaterial({ map: BR.Textures.get('radio_front') }));
          radio._ownMat = true;
          radio.position.set(cx + 2, 0.9, cz + 1.2);
          radio.rotation.y = Math.PI; // 前面板朝南（房间中央）
          W.reg(group, radio);
          var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6),
            new THREE.MeshLambertMaterial({ color: 0x777777 }));
          ant._ownMat = true;
          ant.position.set(cx + 2.2, 1.35, cz + 1.1);
          ant.rotation.z = -0.5;
          W.reg(group, ant);
          // 收音机交互 → L0
          var rp = poi1('radio');
          var rpx = rp ? px(rp.tx) : cx + 2, rpz = rp ? pz(rp.ty) : cz + 1.2;
          W.addInteractable({
            id: 'radio', kind: 'radio', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [radio], pos: new THREE.Vector3(rpx, 1.1, rpz), radius: 2.8,
            prompt: function () {
              var d = W._l188odd && BR.Player
                ? dist2D(BR.Player.pos.x, BR.Player.pos.z, W._l188odd.x, W._l188odd.z) : 99;
              return '📻 老式收音机（信号 ' + sigBars(d) + '）';
            },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.glitch();
              if (W.state.events.indexOf('l188_radio_used') < 0) {
                W.state.events.push('l188_radio_used');
                BR.bus.emit('event', { id: 'l188_radio_used' });
              }
              BR.UI.toast('你把旋钮拧到杂音最强的频段——有什么东西在"听"这一头。', 3600);
              cutoutTravel('L0', '收音机的杂音裹住你，把你拽了进去……');
            }
          });
        });
      })();

      /* ---------- 员工室：储物柜 / 书桌 / 楼梯间（→L11） ---------- */
      (function () {
        var p = poi1('staff_room'); if (!p) return;
        var cx = px(p.tx), cz = pz(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          for (var i = 0; i < 3; i++) { // 储物柜
            var lock = box(0.65, 1.9, 0.55, 0x4a5548);
            lock.position.set(cx + 1.9, 0.95, cz - 1.1 + i * 0.75);
            W.reg(group, lock);
          }
          var desk = box(1.6, 0.75, 0.8, 0x3a2c1c);
          desk.position.set(cx - 1.4, 0.375, cz + 1.2);
          W.reg(group, desk);
          // 楼梯间：北侧向上台阶 + 黑暗开口 + 铁栅门框
          var sx = px(42), sz0 = pz(41);
          for (var s = 0; s < 6; s++) {
            var step = box(2.2, 0.3, 0.52, 0x5c5c5e);
            step.position.set(sx, 0.15 + s * 0.3, sz0 - 0.7 - s * 0.5);
            W.reg(group, step);
          }
          var dark = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.0),
            new THREE.MeshBasicMaterial({ color: 0x000000 }));
          dark._ownMat = true;
          dark.position.set(sx, 2.2, sz0 - 3.9);
          W.reg(group, dark);
          [-1.25, 1.25].forEach(function (ox) {
            var post = box(0.16, 3.0, 0.16, 0x3d3d40);
            post.position.set(sx + ox, 1.5, sz0 - 3.85);
            W.reg(group, post);
          });
          var lin = box(2.7, 0.2, 0.2, 0x3d3d40);
          lin.position.set(sx, 3.05, sz0 - 3.85);
          W.reg(group, lin);
          var sp = poi1('stairwell');
          var stx = sp ? px(sp.tx) : sx, stz = sp ? pz(sp.ty) : sz0;
          W.addInteractable({
            id: 'stairwell', kind: 'stairwell', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [dark], pos: new THREE.Vector3(stx, 1.4, stz - 0.6), radius: 3.0,
            prompt: function () { return '楼梯间（向上，门没锁）'; },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.doorCreak();
              if (W.state.events.indexOf('l188_stair_used') < 0) {
                W.state.events.push('l188_stair_used');
                BR.bus.emit('event', { id: 'l188_stair_used' });
              }
              cutoutTravel('L11', '你沿着楼梯向上走去，身后的门轻轻合上了……');
            }
          });
        });
      })();

      /* ---------- 异常窗交互（→L1）：只有这一扇窗可交互 ---------- */
      (function () {
        var p = poi1('odd_window'); if (!p) return;
        W.addChunkContent(p.tx, p.ty, function (group) {
          // 交互锚点（窗体本身在 addWindow 里已建，这里只挂交互）
          var anchor = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.1),
            new THREE.MeshBasicMaterial({ visible: false }));
          var o = W._l188odd || { x: px(28), z: 107.9 };
          anchor.position.set(o.x, 1.7, o.z);
          anchor.rotation.y = Math.PI;
          W.reg(group, anchor);
          W.addInteractable({
            id: 'odd_window', kind: 'odd_window', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [anchor], pos: new THREE.Vector3(px(p.tx), 1.6, pz(p.ty)), radius: 3.2,
            prompt: function () { return '一扇透着惨白光的窗（209 房）'; },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.glitch();
              if (W.state.events.indexOf('l188_odd_used') < 0) {
                W.state.events.push('l188_odd_used');
                BR.bus.emit('event', { id: 'l188_odd_used' });
              }
              cutoutTravel('L1', '你翻过窗框——窗外是 Level 1 的走廊。');
            }
          });
        });
      })();

      /* ---------- 字条 ---------- */
      function addNote188(p) {
        var note = L188_NOTES[p.data.noteId];
        if (!note) return;
        var id = 'note_L188_' + p.tx + '_' + p.ty;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], n = { x: 0, z: 1 };
          for (var i = 0; i < dirs.length; i++) {
            var dx = dirs[i][0], dy = dirs[i][1];
            if (W.isWall(p.tx + dx, p.ty + dy)) { n = { x: -dx, z: -dy }; break; }
          }
          var m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
            new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
          m._ownMat = true;
          m.position.set(px(p.tx) + n.x * 1.1, 1.5, pz(p.ty) + n.z * 1.1);
          m.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, m);
          W.addInteractable({
            id: id, kind: 'note', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [m], pos: m.position.clone(), radius: 2.4,
            prompt: function () { return '阅读字条'; },
            canUse: function () { return true; },
            use: function () {
              BR.Audio.paper();
              BR.UI.showNote(note[0], note[1]);
              if (W.state.picked.indexOf(id) < 0) {
                W.state.picked.push(id);
                BR.bus.emit('picked', { id: id });
              }
            }
          });
        });
      }
      byType('note').forEach(addNote188);

      /* ---------- 板条箱 ---------- */
      function addCrate188(p) {
        var id = 'crate_L188_' + p.tx + '_' + p.ty;
        W.addChunkContent(p.tx, p.ty, function (group) {
          var g = new THREE.Group();
          g.position.set(px(p.tx), 0, pz(p.ty));
          var wood = W.mat('crate');
          var b = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.8, 1.05), wood);
          b.position.y = 0.4; g.add(b);
          var lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 1.05), wood);
          lid.position.y = 0.86; g.add(lid);
          W.reg(group, g);
          var opened = W.state.openedCrates.indexOf(id) >= 0;
          if (opened) { lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0); }
          W.addInteractable({
            id: id, kind: 'crate', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [b, lid], pos: g.position.clone().add(new THREE.Vector3(0, 1, 0)), radius: 2.6,
            prompt: function () { return W.state.openedCrates.indexOf(id) >= 0 ? '空板条箱' : '打开板条箱'; },
            canUse: function () { return W.state.openedCrates.indexOf(id) < 0; },
            use: function () {
              if (W.state.openedCrates.indexOf(id) >= 0) return;
              lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0);
              BR.Audio.doorCreak();
              W.state.openedCrates.push(id);
              BR.bus.emit('crate:opened', { id: id });
              var item = p.data.item || 'empty';
              if (item === 'empty') {
                BR.UI.toast('箱子里只有灰尘。');
              } else {
                BR.Game.inv[item] = (BR.Game.inv[item] || 0) + 1;
                BR.UI.toast('找到了' + ITEM_NAME[item] + '！');
                BR.Audio.pickup();
              }
              BR.UI.updateInv();
            }
          });
        });
      }
      byType('crate').forEach(addCrate188);

      W.objective = '观察中庭窗户的灯光，找出离开百窗庭的路（收音机 / 楼梯间 / 那扇不对劲的窗）';
    },

    onEnter: function () {
      BR.UI.setObjective(BR.World.objective || '观察中庭的窗户');
      BR.Audio.setAmbient('L188');
      var ev = BR.World.state ? BR.World.state.events : [];
      if (ev.indexOf('l188_entered') < 0) {
        ev.push('l188_entered');
        setTimeout(function () {
          BR.UI.toast('穿过门框——一座围着中庭的老酒店，窗户多得数不清。', 5200);
        }, 1200);
      }
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player;
      if (!P || BR.Game.state !== 'playing' || BR.Game.level !== 'L188') return;
      // 窗户闪烁：暖黄窗微妙呼吸；惨白窗偶发深跌落；异常窗不规则抽搐
      var wins = W._l188wins;
      if (wins) {
        for (var id in wins) {
          if (!wins.hasOwnProperty(id)) continue;
          var wn = wins[id];
          wn.t += dt;
          var col = wn.glow.material.color, v;
          if (wn.kind === 'odd') {
            var c = Math.sin(wn.t * 13.7) * Math.sin(wn.t * 7.3 + 1.3);
            var dip = c > 0.93 ? 0.42 : 1.0;
            v = (0.96 + 0.04 * Math.sin(wn.t * 29.0)) * dip;
            col.setScalar(v);
          } else if (wn.kind === 'warm') {
            v = 0.95 + 0.05 * Math.sin(wn.t * 8.0 + wn.phase);
            col.setScalar(v);
          } else if (wn.kind === 'cold') {
            v = 0.93 + 0.07 * Math.sin(wn.t * 4.6 + wn.phase);
            col.setScalar(v);
          }
          // dark / blinds：保持不动
        }
      }
      // 静电强度：离异常窗越近越强（观察式去路的核心线索）
      var sg = BR.Audio && BR.Audio._l188static;
      if (sg && W._l188odd && BR.Audio._ok) {
        var d = dist2D(P.pos.x, P.pos.z, W._l188odd.x, W._l188odd.z);
        var g = 0.55 * Math.max(0, 1 - d / 42);
        try { sg.gain.setTargetAtTime(g, BR.Audio._t(), 0.25); }
        catch (e) { sg.gain.value = g; }
        if (d < 7 && W.state.events.indexOf('l188_odd_hint') < 0) {
          W.state.events.push('l188_odd_hint');
          BR.UI.toast('这扇窗透出的惨白光……和别的都不一样。', 4200);
        }
      }
    }
  };
})();
