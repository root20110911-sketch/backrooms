/* lv_l11.js —— Level 11「无垠城市」内容搭建
 * 独立 IIFE，只用 BR.* 共享接口；不改动旧文件。
 * 核心：NPC 系统（meg_post 的 M.E.G. 队员 / wanderer_camp 的流浪者），
 * 用 interactable + showNote/toast 实现，不新增 screen。
 * 出口统一走 BR.Cutout.travel（Systems A 未落地前兜底 BR.Game.gotoLevel）。
 */
(function () {
  var BR = window.BR;
  var T = BR.TILE;

  /* ---------- 出口：统一切出状态机（Systems A 未落地时兜底） ---------- */
  function travelTo(to, kind) {
    if (!BR.Levels[to]) {
      BR.UI.toast('……那条路通向 ' + to + '，不过它好像还没被建造出来。');
      return;
    }
    if (BR.Cutout && typeof BR.Cutout.travel === 'function') {
      BR.Cutout.travel(to, { kind: kind || 'walk' });
      return;
    }
    // 兜底：直接跨关（Systems A 落地后自动走 Cutout）
    BR.Game.gotoLevel(to);
  }

  /* ---------- 本地小工具（跨 IIFE 不许调 levels.js 的内部函数，重写） ---------- */
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
      var g = new THREE.Group();
      g.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
      var wood = W.mat('crate');
      var box = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.8, 1.05), wood);
      box.position.y = 0.4; g.add(box);
      var lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 1.05), wood);
      lid.position.y = 0.86; g.add(lid);
      W.reg(group, g);
      if (W.state.openedCrates.indexOf(id) >= 0) { lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0); }
      W.addInteractable({
        id: id, kind: 'crate', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: [box, lid], pos: g.position.clone().add(new THREE.Vector3(0, 1, 0)), radius: 2.6,
        prompt: function () { return W.state.openedCrates.indexOf(id) >= 0 ? '空板条箱' : '打开板条箱'; },
        canUse: function () { return W.state.openedCrates.indexOf(id) < 0; },
        use: function () {
          if (W.state.openedCrates.indexOf(id) >= 0) return;
          lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0);
          BR.Audio.doorCreak();
          W.state.openedCrates.push(id);
          BR.bus.emit('crate:opened', { id: id });
          if (item === 'empty' || !item) {
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

  // 简单胶囊人 NPC：圆柱身体 + 球头
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

  function compass(dx, dy) { // dx: 东+ / dy: 南+
    var s = '';
    if (dy > 2) s += '南'; else if (dy < -2) s += '北';
    if (dx > 2) s += '东'; else if (dx < -2) s += '西';
    return s || '附近';
  }

  /* ================= Level 定义 ================= */
  BR.Levels.L11 = {
    name: 'Level 11 ——「无垠城市」',
    theme: {
      bg: 0x0b0e14, fogNear: 10, fogFar: 75, ambient: 0x8a90a8, ambInt: 0.6,
      sky: 0x27304a, ground: 0x23262c, light: 0xffd9a0, lightInt: 0.85,
      wallH: 3.6, wall: 'city_wall', floor: 'city_road', ceil: 'ceiling',
      surface: 'concrete', fixtureEvery: 9999, hum: 0.35
    },

    buildContent: function (map, W) {
      var L = (W._l11 = { guide: null, megNPC: null });

      // 开放天空：全部地板 tile 不盖天花板（城市是露天的）
      for (var ty = 0; ty < map.h; ty++)
        for (var tx = 0; tx < map.w; tx++)
          if (map.tiles[ty * map.w + tx] === 1) W.setOpenCeil(tx, ty);

      /* ---------- 广场（出生点，相对安全） ---------- */
      poiList(map, 'plaza').forEach(function (p) {
        var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          // 中央喷泉：石沿 + 水面 + 中柱
          var basin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.7, 14),
            new THREE.MeshLambertMaterial({ color: 0x6a6f76 }));
          basin.position.set(cx, 0.35, cz); W.reg(group, basin);
          var water = new THREE.Mesh(new THREE.CircleGeometry(1.45, 14),
            new THREE.MeshBasicMaterial({ color: 0x2a5a7a }));
          water.rotation.x = -Math.PI / 2; water.position.set(cx, 0.72, cz); W.reg(group, water);
          var col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 10),
            new THREE.MeshLambertMaterial({ color: 0x7a7f86 }));
          col.position.set(cx, 1.2, cz); W.reg(group, col);
          // 暖光
          var Li = new THREE.PointLight(0xffc37a, 1.3, 20, 2);
          Li.position.set(cx, 3.2, cz); W.reg(group, Li);
        });
        addNote(W, p.tx, p.ty, '褪色的城市导览图',
          '（游戏改编说明）\n\n按后室中文维基，Level 11「无垠城市」确有 M.E.G. 前哨与流浪者营地的记载。\n\n本作中"地铁→L2""流浪者指引→L94"等离开方式，为游戏性改编，并非原作事实。\n\n——开发组', 'meta');
      });

      /* ---------- MEG 前哨 ---------- */
      poiList(map, 'meg_post').forEach(function (p) {
        var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
        var pathTiles = (p.data && p.data.path) || null;
        W.addChunkContent(p.tx, p.ty, function (group, chunk) {
          var n = wallNormal(W, p.tx, p.ty);
          // 遮阳棚：四柱 + 顶布
          var awn = new THREE.Group();
          var cloth = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 2.6),
            new THREE.MeshLambertMaterial({ color: 0x8a7a2a }));
          cloth.position.y = 2.5; awn.add(cloth);
          [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]].forEach(function (o) {
            var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8),
              new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
            pole.position.set(o[0], 1.25, o[1]); awn.add(pole);
          });
          var table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.9),
            new THREE.MeshLambertMaterial({ color: 0x5a4a35 }));
          table.position.y = 0.8; awn.add(table);
          awn.position.set(cx + n.x * 0.4, 0, cz + n.z * 0.4);
          W.reg(group, awn);
          // MEG 旗帜牌（黄黑条纹）
          var flagTex = signTexture(['M.E.G.'], 'rgba(255,200,60,0.95)');
          var flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85),
            new THREE.MeshBasicMaterial({ map: flagTex }));
          flag.material._ownMat = true;
          flag.position.set(cx + n.x * 1.2, 2.2, cz + n.z * 1.2);
          flag.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, flag);
          var Li = new THREE.PointLight(0xffe0a0, 1.1, 16, 2);
          Li.position.set(cx, 2.6, cz); W.reg(group, Li);

          // NPC：M.E.G. 队员（深蓝制服 + 橙色臂章）
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

          // 交互：交谈 → 带路 → 指引去 L1
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
                // 首次交谈：补给 + 按状态给路线建议
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
                  '附近已知风险：\n· 地铁方向偶有薄墙，别贴着墙挤。\n· 晚上别跟流浪者去城堡——那是 Level 94 的地界。\n\n' +
                  '拿着这些补给（杏仁水×1、绷带×1），别客气。\n\n路线建议：\n' + line);
                ev.push('l11_meg_talk');
                BR.bus.emit('event', { id: 'l11_meg_talk' });
                BR.UI.toast('获得补给：杏仁水×1、绷带×1');
                return;
              }
              if (ev.indexOf('l11_meg_guide') < 0 && pathTiles && L.megNPC && L.megNPC.group.parent) {
                // 带路一小段：沿预设路点走约 20 米
                var wp = pathTiles.map(function (t) { return { x: BR.tileCX(t[0]), z: BR.tileCZ(t[1]) }; });
                L.guide = { path: wp, i: 1, dir: 1, back: false };
                BR.UI.toast('队员："跟上，送你一程。"（跟着他走约 20 米）');
                BR.Audio.checkpoint();
                return;
              }
              // 指引去 L1（对话后，不直接传送）
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
          // 篝火：石圈 + 火焰锥（发光）+ 暖光
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
          // 简易帐篷
          var tent = new THREE.Group();
          var c1 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.0),
            new THREE.MeshLambertMaterial({ color: 0x4a4438, side: THREE.DoubleSide }));
          c1.position.set(0, 0.9, -0.6); c1.rotation.x = 0.6; tent.add(c1);
          var c2 = c1.clone(); c2.position.z = 0.6; c2.rotation.x = -0.6; tent.add(c2);
          tent.position.set(cx + 1.8, 0, cz + 0.6);
          W.reg(group, tent);

          // NPC：流浪者（灰褐斗篷 + 兜帽）
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
              return '顺着流浪者指的路离开（→ Level 94）';
            },
            canUse: function () { return true; },
            use: function () {
              var ev = W.state.events;
              if (ev.indexOf('l11_w_heard') < 0) {
                BR.UI.showNote('流浪者',
                  '又一个掉进来的？坐，烤烤火。\n\n' +
                  '我在这儿住了三年，告诉你几件事：\n' +
                  '· 白天城里安全，但晚上别去城堡——那是 Level 94 的老巢。\n' +
                  '· 城郊有辆老式汽车，白天坐它能到 Level 94（记住，是白天）。\n' +
                  '· 想去别处？东南边有地铁入口，能到 Level 2。\n\n' +
                  '——营地后面那条小路一直走，翻过两道街，就是 Level 94 的城郊。想去的话，我指给你看。');
                ev.push('l11_w_heard');
                BR.bus.emit('event', { id: 'l11_w_heard' });
                return;
              }
              if (ev.indexOf('l11_w_trade') < 0 && (BR.Game.inv.bandage || 0) > 0) {
                BR.Game.inv.bandage--;
                BR.UI.updateInv();
                var subs = poiList(map, 'subway')[0];
                var dir = subs ? compass(subs.tx - p.tx, subs.ty - p.ty) : '东南';
                var dist = subs ? Math.round(Math.hypot(subs.tx - p.tx, subs.ty - p.ty) * T) : 0;
                BR.Audio.paper();
                BR.UI.toast('流浪者："地铁站在城市' + dir + '方向，约 ' + dist + ' 米，找发光的 SUBWAY 牌子，别走错。"');
                ev.push('l11_w_trade');
                BR.bus.emit('event', { id: 'l11_w_trade' });
                return;
              }
              BR.UI.toast('你沿着流浪者指的小路走出城市……');
              travelTo('L94', 'walk');
            }
          });
        });
      });

      /* ---------- 地铁入口（→L2，需探索发现） ---------- */
      poiList(map, 'subway').forEach(function (p) {
        var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
        W.addChunkContent(p.tx, p.ty, function (group) {
          var n = wallNormal(W, p.tx, p.ty);
          // 地铁入口：下行楼梯井（台阶在地面以上自后向前逐级下降，暗色围墙围合，读作"走下去"）
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
          stairs.rotation.y = Math.atan2(n.x, n.z); // 开口朝向开阔方向
          W.reg(group, stairs);
          // SUBWAY 霓虹牌
          var st2 = signTexture(['SUBWAY', '▼ 地铁'], 'rgba(90,220,255,0.95)');
          var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95),
            new THREE.MeshBasicMaterial({ map: st2 }));
          sign.material._ownMat = true;
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

      /* ---------- 商店（小房间 + 招牌 note 变体 + 免费样品箱） ---------- */
      var SHOP_NAMES = ['24小时便利店', '旧书店', '杏仁水专卖店', '五金修理铺', '流浪者杂货'];
      poiList(map, 'shop').forEach(function (p) {
        var idx = p.data.idx || 0;
        var name = SHOP_NAMES[idx % SHOP_NAMES.length];
        W.addChunkContent(p.tx, p.ty, function (group) {
          var n = wallNormal(W, p.tx, p.ty);
          // 招牌：霓虹底板
          var sm = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9),
            new THREE.MeshBasicMaterial({ map: BR.Textures.get('shop_sign') }));
          sm.position.set(BR.tileCX(p.tx) + n.x * 1.2, 2.5, BR.tileCZ(p.ty) + n.z * 1.2);
          sm.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, sm);
          // 雨棚
          var awn = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 1.1),
            new THREE.MeshLambertMaterial({ color: [0x7a2a2a, 0x2a5a7a, 0x6a6a2a, 0x3a6a3a, 0x5a3a6a][idx % 5] }));
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
                body += '店主在纸条上写：地铁站在城市最远的角落，找发光的 SUBWAY 牌子。\n\n货架上还有免费样品，自己拿。';
              else if (idx % SHOP_NAMES.length === 2)
                body += '杏仁水论瓶卖——可惜你没钱。店主看你可怜，留了一瓶样品在门口箱子里。';
              else
                body += '门虚掩着，里面没人，只有货架和灰。门口箱子里或许还有剩的东西。';
              BR.UI.showNote(name, body);
            }
          });
        });
        // 免费样品箱：商店相邻地板格
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d = 0; d < 4; d++) {
          var nx = p.tx + dirs[d][0], ny = p.ty + dirs[d][1];
          if (W.tile(nx, ny) === 1 && !(nx === p.tx && ny === p.ty)) {
            addCrate(W, nx, ny, p.data.item || 'almond', 'shop' + idx);
            break;
          }
        }
      });

      /* ---------- 路灯（复用 fixture 灯光池） ---------- */
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
          // 注册进区块 fixture，灯光池自动分配点光源
          chunk.fixtures.push({ x: x + 0.95, y: 4.1, z: z, phase: 0, flicker: false });
        });
      });

      /* ---------- 字条 / 街边补给箱 ---------- */
      var L11_NOTES = [
        ['拾荒者的字条', '城市很大，但别被"无限"骗了——街区就这么多，路都是通的。\n\n记住三个地方：广场、M.E.G. 前哨、地铁站。'],
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

      /* ---------- 远处剪影建筑（低成本 box，随区块卸载） ---------- */
      (function () {
        var srng = new BR.RNG(BR.hashSeed('skyline:' + map.seed));
        var edges = [];
        for (var i = 0; i < 16; i++) {
          var e = i % 4, off = 2 + srng.int(0, 50), tx, ty, ox, oz;
          if (e === 0) { tx = off; ty = 1; ox = 0; oz = -5; }
          else if (e === 1) { tx = off; ty = 54; ox = 0; oz = 5; }
          else if (e === 2) { tx = 1; ty = off; ox = -5; oz = 0; }
          else { tx = 54; ty = off; ox = 5; oz = 0; }
          edges.push({ tx: tx, ty: ty, ox: ox, oz: oz });
        }
        edges.forEach(function (s, si) {
          W.addChunkContent(s.tx, s.ty, function (group) {
            var bw = 5 + srng.int(0, 4), bd = 5 + srng.int(0, 4), bh = 10 + srng.int(0, 12);
            var shade = 0x141821 + srng.int(0, 3) * 0x000202;
            var b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd),
              new THREE.MeshLambertMaterial({ color: shade }));
            b.position.set(BR.tileCX(s.tx) + s.ox, bh / 2, BR.tileCZ(s.ty) + s.oz);
            W.reg(group, b);
            // 零星亮窗（发光小面片，低成本）
            var nw = srng.int(2, 5);
            for (var k = 0; k < nw; k++) {
              var win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7),
                new THREE.MeshBasicMaterial({ color: 0xffd98a }));
              var wy = 3 + srng.int(0, Math.max(1, (bh | 0) - 4));
              win.position.set(
                BR.tileCX(s.tx) + s.ox + (srng.chance(0.5) ? bw / 2 + 0.02 : -bw / 2 - 0.02),
                wy, BR.tileCZ(s.ty) + s.oz + (srng.next() - 0.5) * (bd - 1));
              win.rotation.y = srng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
              // 贴在朝内的一面
              if (s.oz < 0) { win.position.z = BR.tileCZ(s.ty) + s.oz + bd / 2 + 0.02; win.rotation.y = 0; }
              else if (s.oz > 0) { win.position.z = BR.tileCZ(s.ty) + s.oz - bd / 2 - 0.02; win.rotation.y = Math.PI; }
              else if (s.ox < 0) { win.position.x = BR.tileCX(s.tx) + s.ox + bw / 2 + 0.02; win.rotation.y = Math.PI / 2; }
              else { win.position.x = BR.tileCX(s.tx) + s.ox - bw / 2 - 0.02; win.rotation.y = -Math.PI / 2; }
              W.reg(group, win);
            }
          });
        });
      })();

      /* ---------- 薄墙（1~2 处随机切出；本关不放 chase 型实体） ---------- */
      BR.buildThinWalls(map, W);

      W.objective = '探索无垠城市：找 M.E.G. 前哨问路，或自己找到地铁站';
    },

    onEnter: function () {
      BR.UI.setObjective(BR.World.objective);
      BR.Audio.setAmbient('L11');
      setTimeout(function () { BR.UI.toast('无垠城市。灯还亮着，这里比别处"有人味"。', 3600); }, 1200);
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player;
      BR.thinWallTick(dt);
      var L = W._l11;
      if (!L || !L.guide) return;
      if (!P || BR.Game.state !== 'playing') return;
      var npc = L.megNPC;
      if (!npc || !npc.group.parent) { L.guide = null; return; } // 区块卸载则取消带路
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
          return;
        }
        target = g.path[g.i];
        dx = target.x - npc.group.position.x; dz = target.z - npc.group.position.z;
        d = Math.hypot(dx, dz) || 0.001;
      }
      var step = Math.min(d, 2.2 * dt);
      npc.group.position.x += dx / d * step;
      npc.group.position.z += dz / d * step;
      npc.group.rotation.y = Math.atan2(dx, dz);
      npc.body.position.y = 0.85 + Math.abs(Math.sin(W.time * 9)) * 0.06; // 走路摆动
    }
  };
})();
