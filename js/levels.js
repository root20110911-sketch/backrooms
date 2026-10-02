/* levels.js —— 五关主题 + 关卡内容搭建（门/道具/事件/目标） */
(function () {
  const BR = window.BR;
  const T = BR.TILE;

  const ITEM_NAME = {
    almond: '杏仁水', bandage: '绷带', flashlight: '手电筒', berry: '迁跃浆果', food: '食物',
    cigarette: '香烟', gum: '口香糖', royal_ration: '皇家口粮', repellent: '笑魇驱散剂',
    firesalt: '火盐', painliquid: '痛液', cashew: '腰果水', battery: '电池'
  };

  /* ================= 主题 ================= */
  BR.Levels = {
    L0: {
      name: 'Level 0 ——「教学关卡」',
      theme: {
        bg: 0x0a0906, fogNear: 6, fogFar: 40, ambient: 0xbfb49a, ambInt: 0.62,
        sky: 0xfff2cc, ground: 0x3a3325, light: 0xffe9a8, lightInt: 0.95,
        wallH: 2.7, wall: 'wallpaper', floor: 'carpet', ceil: 'ceiling',
        surface: 'carpet', fixtureEvery: 4, hum: 0.5
      }
    },
    L1: {
      name: 'Level 1 ——「宜居地带」',
      theme: {
        bg: 0x070708, fogNear: 8, fogFar: 52, ambient: 0x6a6f76, ambInt: 0.45,
        sky: 0xdfe8ff, ground: 0x2a2c30, light: 0xf2f5ff, lightInt: 0.75,
        wallH: 3.2, wall: 'concrete', floor: 'concreteFloor', ceil: 'ceiling',
        surface: 'concrete', fixtureEvery: 6, hum: 0.4,
        flickerRate: 0.3, flickerDepth: 0.08
      }
    },
    L2: {
      name: 'Level 2 ——「废弃公共带」',
      theme: {
        bg: 0x050505, fogNear: 5, fogFar: 34, ambient: 0x555a60, ambInt: 0.42,
        sky: 0x9aa2ad, ground: 0x1c1e20, light: 0xffd9a0, lightInt: 0.7,
        wallH: 3.4, wall: 'concrete', floor: 'metal', ceil: 'metal',
        surface: 'metal', fixtureEvery: 8, hum: 0.25
      }
    },
    L3: {
      name: 'Level 3 ——「发电站」',
      theme: {
        bg: 0x040404, fogNear: 5, fogFar: 30, ambient: 0x4a4d52, ambInt: 0.38,
        sky: 0x8a8f96, ground: 0x1a1b1d, light: 0xffc890, lightInt: 0.65,
        wallH: 3.6, wall: 'brick', floor: 'tileFloor', ceil: 'metal',
        surface: 'tile', fixtureEvery: 9, hum: 0.2
      }
    },
    FUN: {
      name: 'Level Fun ——「享乐层」=)',
      theme: {
        bg: 0x0d0608, fogNear: 8, fogFar: 48, ambient: 0xd8a0b0, ambInt: 0.68,
        sky: 0xffd0e0, ground: 0x3a2a30, light: 0xffc0d8, lightInt: 1.0,
        wallH: 3.0, wall: 'partyWall', floor: 'partyFloor', ceil: 'ceiling',
        surface: 'tile', fixtureEvery: 4, hum: 0
      }
    }
  };

  /* ================= 通用搭建件 ================= */
  // 找相邻墙，返回从墙指向空地的法线
  function wallNormal(W, tx, ty) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      if (W.isWall(tx + dx, ty + dy)) return { x: -dx, z: -dy };
    }
    return { x: 0, z: 1 };
  }

  function addNote(W, tx, ty, title, body, opts) {
    opts = opts || {};
    const id = 'note_' + W.map.level + '_' + tx + '_' + ty;
    W.addChunkContent(tx, ty, (group) => {
      const n = wallNormal(W, tx, ty);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.75),
        new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') })
      );
      m.position.set(BR.tileCX(tx) + n.x * 1.1, 1.5, BR.tileCZ(ty) + n.z * 1.1);
      m.rotation.y = Math.atan2(n.x, n.z);
      W.reg(group, m);
      W.addInteractable({
        id, kind: 'note', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: [m], pos: m.position.clone(), radius: 2.4,
        prompt: () => '阅读字条',
        canUse: () => true,
        use: () => {
          BR.Audio.paper();
          BR.UI.showNote(title, body);
          if (!W.state.picked.includes(id)) {
            W.state.picked.push(id);
            BR.bus.emit('picked', { id });
          }
          if (opts.clue && !W.state.events.includes('clue_' + id)) {
            W.state.events.push('clue_' + id);
            BR.Game.flags.clues++;
            BR.UI.toast('你记下了一条离开的线索（' + BR.Game.flags.clues + '/2）');
            BR.bus.emit('event', { id: 'clue_' + id });
          }
        }
      });
    });
  }

  /* ================= 马尼拉房间 1:1 还原件 ================= */
  // 依据 research/manila.md（Wikidot 主 Wiki "The Manila Room"、Fandom Level 0 页面）。
  // 桌上散落文件：多语言穿墙指南（可阅读的装饰字条，非收集系统）。
  const MANILA_NOCLIP_TEXT =
    '【穿墙指南 / NO-CLIPPING GUIDE】\n\n' +
    '中文：\n' +
    '穿墙（No-Clipping）是最常见的跨层手段。找一面"不对劲"的墙——颜色发暗、\n' +
    '嗡鸣声调异常，或者看起来比实际更薄。把肩膀抵住墙角，闭眼，慢慢把\n' +
    '身体"挤"进去。成功时你会感到一阵失重，像掉进水里。\n\n' +
    '⚠ 警告：\n' +
    '1. 只在你知道目标楼层时尝试；穿墙可能把你送到任何地方，包括\n' +
    '   Level ! ——那里没有"回来"的说法。\n' +
    '2. 如果挤到一半听见身后有脚步声，立刻停下。那不是你的回声。\n\n' +
    'English:\n' +
    'NO-CLIPPING is the most common way to travel between levels. Find a wall\n' +
    'that feels "wrong" — darker in color, humming at a strange pitch, or\n' +
    'thinner than it should be. Press your shoulder into the corner, close\n' +
    'your eyes, and slowly push yourself "in". Success feels like falling\n' +
    'into water.\n\n' +
    '⚠ WARNINGS:\n' +
    '1. Only attempt when you know your target level. No-clipping can take\n' +
    '   you anywhere — including Level !, from which there is no coming back.\n' +
    '2. If you hear footsteps behind you halfway through, STOP.\n' +
    '   That is not your echo.\n\n' +
    '—— I.M.B.H. 印制 / Printed by I.M.B.H.';
  const MANILA_SURVIVAL_TEXT =
    '【马尼拉房间生存守则 / MANILA ROOM — SURVIVAL NOTES】\n\n' +
    '1. 这里没有已知的敌对实体，但墙里偶尔有敲击声，黑暗时最响。\n' +
    '   别去想墙里是什么。\n' +
    '   There are no known hostile entities here, but knocking sometimes\n' +
    '   comes from inside the walls — loudest in the dark.\n' +
    '   Don\'t think about what\'s in there.\n\n' +
    '2. 杏仁水按需取用，绷带在柜子里。食物和水由志愿者定期补给，\n' +
    '   请给后来的人留一点。\n' +
    '   Take almond water as needed; bandages are in the cabinet.\n' +
    '   Please leave some for those who come after you.\n\n' +
    '3. 在这里待太久，你会被"送"到 Level 1 或 Level 2。\n' +
    '   有人说这是诅咒，有人说这是仁慈。\n' +
    '   Stay too long and you will be "sent" to Level 1 or Level 2.\n' +
    '   Some call it a curse. Some call it mercy.\n\n' +
    '—— Manila Mary Foundation';
  // 墙上告示：Manila Mary Foundation 全文（research 第 4 节英文原文 + 中文翻译对照）
  const MANILA_POSTER_CN =
    '【中文译文】\n\n' +
    '你好，读到这张告示的人。我们是 Manila Mary 基金会，我们是来帮你的！\n\n' +
    '请随意取用这个房间里的食物和水，好好享受你应得的休息。你已经走完了\n' +
    '这段旅程中最艰难的一程。你所在的这个维度叫做"后室"（Backrooms）。\n' +
    '许多和你一样的人曾被困在这里，并在各处建立了社区和聚居地。你的目标\n' +
    '是抵达其中一个聚居地——因为你将在这个维度度过余生。\n\n' +
    '从你离开的地球来到这里，适应会很艰难，但不要失去希望。即使在这个\n' +
    '陌生的世界里，我们依然拥有彼此。在这片荒芜之地，我们将建造一个新的\n' +
    '未来。这个宏观世界中的全人类都同舟共济。\n\n' +
    '下面的柜子里，我们为你准备了下一步生存所需的文档。一旦你穿过那些\n' +
    '闪烁的墙壁，前方的远征将不会轻松。';
  const MANILA_POSTER_EN =
    '【英文原文 / Original】\n\n' +
    '"Hello to whoever is reading this. We are the Manila Mary Foundation\n' +
    'and we are here to help!\n\n' +
    'Please take any food or water in this room, and enjoy your well-earned\n' +
    'rest. You have completed the hardest part of the journey. The dimension\n' +
    'you found yourself in is called the Backrooms. Many others have gotten\n' +
    'stuck here and have built various communities and settlements throughout.\n' +
    'Your goal is to make it to one of these settlements, as you will be\n' +
    'living in this dimension for the rest of your life.\n\n' +
    'It is going to be a harsh adjustment from the Earth you left behind,\n' +
    'but do not lose hope. Even in this strange world, we still have each\n' +
    'other. In this desolate place, we will build a new future. All of\n' +
    'humanity in this macrocosm are in this together.\n\n' +
    'In the cupboards below we prepared documents on your next steps to\n' +
    'survive. Once you enter those flickering walls, the expedition ahead\n' +
    'will not be easy."';
  // 告示墙贴：马尼拉纸底 + 英文原文（小字），中文译文走阅读浮层
  function manilaPosterTexture() {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 640;
    const c = cv.getContext('2d');
    c.fillStyle = '#d9b77c'; c.fillRect(0, 0, 1024, 640);
    c.strokeStyle = '#5a4326'; c.lineWidth = 10; c.strokeRect(14, 14, 996, 612);
    c.fillStyle = '#3a2a16'; c.textAlign = 'center';
    c.font = 'bold 50px Georgia, serif';
    c.fillText('MANILA MARY FOUNDATION', 512, 88);
    c.strokeStyle = '#5a4326'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(80, 116); c.lineTo(944, 116); c.stroke();
    c.font = '23px Georgia, serif'; c.textAlign = 'left';
    const words = MANILA_POSTER_EN.replace('【英文原文 / Original】\n\n', '').replace(/"/g, '').split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach(w => {
      if ((cur + ' ' + w).length > 62) { lines.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    lines.slice(0, 15).forEach((ln, i) => c.fillText(ln, 70, 165 + i * 30));
    c.textAlign = 'center'; c.font = 'bold 26px sans-serif';
    const kl = (BR.interactKeyLabel ? BR.interactKeyLabel() : '【E】');
    c.fillText('—— 按 ' + kl + ' 阅读中文译文 ——', 512, 600);
    return new THREE.CanvasTexture(cv);
  }
  // 简易木椅
  function buildChairMesh() {
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: 0x6f5233 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.5), wood);
    seat.position.y = 0.45; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.07), wood);
    back.position.set(0, 0.75, -0.25); g.add(back);
    [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(pt => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), wood);
      leg.position.set(pt[0], 0.225, pt[1]); g.add(leg);
    });
    return g;
  }
  // 桌上散落纸张：可阅读的装饰字条（非收集系统，读完不消失、不记 picked）
  function addTablePaper(W, group, tx, ty, x, y, z, rot, title, body) {
    const id = 'manila_paper_' + Math.round(x * 10) + '_' + Math.round(z * 10);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.6),
      new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = rot;
    m.position.set(x, y, z);
    W.reg(group, m);
    W.addInteractable({
      id, kind: 'note', chunkKey: W.chunkKeyOf(tx, ty),
      meshes: [m], pos: m.position.clone(), radius: 2.6,
      prompt: () => (BR.interactKeyLabel ? BR.interactKeyLabel() : '【E】') + '阅读' + title,
      canUse: () => true,
      use: () => { BR.Audio.paper(); BR.UI.showNote(title, body); }
    });
  }
  // 马尼拉全黑 / 久留淡出共用的全屏黑幕（z 59，低于转场黑幕 z 60）
  function manilaOverlay(show, ms) {
    let el = document.getElementById('manila-blackout');
    if (!el) {
      el = document.createElement('div');
      el.id = 'manila-blackout';
      el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:59;';
      document.body.appendChild(el);
    }
    el.style.transition = 'opacity ' + ((ms || 600) / 1000) + 's ease';
    void el.offsetWidth; // 强制 reflow，保证 transition 生效
    el.style.opacity = show ? '1' : '0';
  }

  function itemMesh(item) {
    const g = new THREE.Group();
    if (item === 'almond') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.13),
        new THREE.MeshLambertMaterial({ color: 0xe8e0d0 }));
      b.position.y = 0.13; g.add(b);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x8a2a2a }));
      cap.position.y = 0.28; g.add(cap);
    } else if (item === 'bandage') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.17),
        new THREE.MeshLambertMaterial({ color: 0xf0ece2 }));
      b.position.y = 0.05; g.add(b);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.05),
        new THREE.MeshLambertMaterial({ color: 0xc03030 }));
      s.position.y = 0.1; g.add(s);
    } else if (item === 'flashlight') {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10),
        new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
      b.rotation.z = Math.PI / 2; b.position.y = 0.08; g.add(b);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.09, 10),
        new THREE.MeshLambertMaterial({ color: 0x555b62 }));
      h.rotation.z = Math.PI / 2; h.position.set(0.14, 0.08, 0); g.add(h);
    } else if (item === 'berry') {
      // 迁跃浆果：微光浆果簇
      const bm = new THREE.MeshLambertMaterial({ color: 0x7a3fd0 });
      [[-0.07, 0.07], [0.07, 0.07], [0, 0.16]].forEach(([x, y]) => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), bm);
        s.position.set(x, y, 0); g.add(s);
      });
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03),
        new THREE.MeshLambertMaterial({ color: 0x3f7a3a }));
      stem.position.y = 0.28; g.add(stem);
    } else if (item === 'food') {
      // 食物：罐头
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 12),
        new THREE.MeshLambertMaterial({ color: 0xb0a080 }));
      c.position.y = 0.08; g.add(c);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.025, 12),
        new THREE.MeshLambertMaterial({ color: 0x7a6a50 }));
      lid.position.y = 0.165; g.add(lid);
    } else if (item === 'cigarette') {
      // 香烟：细长白色烟卷 + 棕色滤嘴段
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.20, 8),
        new THREE.MeshLambertMaterial({ color: 0xf2efe8 }));
      c.rotation.z = Math.PI / 2; c.position.y = 0.05; g.add(c);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 8),
        new THREE.MeshLambertMaterial({ color: 0x8a5a2a }));
      f.rotation.z = Math.PI / 2; f.position.set(0.12, 0.05, 0); g.add(f);
    } else if (item === 'gum') {
      // 口香糖：粉色小方条 + 两端糖纸小锥体
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.07),
        new THREE.MeshLambertMaterial({ color: 0xf0a0c0 }));
      bar.position.y = 0.04; g.add(bar);
      const wrapM = new THREE.MeshLambertMaterial({ color: 0xc0c8d0 });
      [-1, 1].forEach(s => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 6), wrapM);
        cone.rotation.z = s * Math.PI / 2; cone.position.set(s * 0.115, 0.04, 0); g.add(cone);
      });
    } else if (item === 'royal_ration') {
      // 皇家口粮：军绿方罐头 + 顶部金色小皇冠（锥体+圆球）
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 12),
        new THREE.MeshLambertMaterial({ color: 0x4a5a30 }));
      can.position.y = 0.08; g.add(can);
      const gold = new THREE.MeshLambertMaterial({ color: 0xd8a820 });
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.07, 8), gold);
      crown.position.y = 0.195; g.add(crown);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), gold);
      orb.position.y = 0.24; g.add(orb);
    } else if (item === 'repellent') {
      // 笑魇驱散剂：白色喷雾瓶（瓶身+按压喷头）+ 半透明雾锥
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.20, 10),
        new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }));
      body.position.y = 0.10; g.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05),
        new THREE.MeshLambertMaterial({ color: 0x30343a }));
      head.position.y = 0.225; g.add(head);
      const mist = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 10),
        new THREE.MeshLambertMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35 }));
      mist.rotation.x = -Math.PI / 2.4; mist.position.set(0, 0.26, 0.12); g.add(mist);
    } else if (item === 'firesalt') {
      // 火盐：粗布束口小袋（压扁球体+束口）+ 袋口红色小火苗
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0x9a7a52 }));
      sack.scale.set(1, 0.75, 1); sack.position.y = 0.085; g.add(sack);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.06, 8),
        new THREE.MeshLambertMaterial({ color: 0x7a5c3a }));
      neck.position.y = 0.18; g.add(neck);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 8),
        new THREE.MeshBasicMaterial({ color: 0xff4a1a }));
      flame.position.y = 0.25; g.add(flame);
    } else if (item === 'painliquid') {
      // 痛液：深绿细颈小瓶 + 瓶身深色斑点
      const dark = new THREE.MeshLambertMaterial({ color: 0x1e5a2a });
      const vb = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.16, 10), dark);
      vb.position.y = 0.08; g.add(vb);
      const vn = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.09, 8), dark);
      vn.position.y = 0.20; g.add(vn);
      const spotM = new THREE.MeshLambertMaterial({ color: 0x0d2a12 });
      [[0.03, 0.06, 0.045], [-0.035, 0.10, 0.04], [0.01, 0.13, -0.05]].forEach(sp => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), spotM);
        s.position.set(sp[0], sp[1], sp[2]); g.add(s);
      });
    } else if (item === 'cashew') {
      // 腰果水：与杏仁水几乎一样的瓶子（陷阱）——液体略黄、多一道高光，视觉差细微
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.13),
        new THREE.MeshLambertMaterial({ color: 0xe9dcb4 }));
      b.position.y = 0.13; g.add(b);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x8a2a2a }));
      cap.position.y = 0.28; g.add(cap);
      const hl = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.18, 0.004), hl);
      h1.position.set(-0.05, 0.14, 0.067); g.add(h1);
      const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.10, 0.004), hl);
      h2.position.set(0.055, 0.12, 0.067); g.add(h2); // 第二道高光：唯一的视觉区别
    } else if (item === 'battery') {
      // 5 号电池：黑身 + 铜顶 + 黄色闪电标志（小方块拼）
      const bb = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.11, 10),
        new THREE.MeshLambertMaterial({ color: 0x1a1a1c }));
      bb.position.y = 0.055; g.add(bb);
      const cu = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10),
        new THREE.MeshLambertMaterial({ color: 0xb87333 }));
      cu.position.y = 0.125; g.add(cu);
      const boltM = new THREE.MeshBasicMaterial({ color: 0xffd820 });
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.005), boltM);
      b1.position.set(0.005, 0.06, 0.036); b1.rotation.z = 0.35; g.add(b1);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.005), boltM);
      b2.position.set(-0.005, 0.03, 0.036); b2.rotation.z = 0.35; g.add(b2);
    } else {
      // 未知道具兜底：通用小盒子，避免返回空 group
      const u = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshLambertMaterial({ color: 0x8a8a8a }));
      u.position.y = 0.1; g.add(u);
    }
    return g;
  }

  function addPickup(W, tx, ty, item, n, suffix) {
    const id = 'pick_' + item + '_' + tx + '_' + ty + '_' + (suffix || '0');
    W.addChunkContent(tx, ty, (group) => {
      if (W.state.picked.includes(id)) return;
      const g = itemMesh(item);
      const rng = new BR.RNG(BR.hashSeed(id));
      g.position.set(BR.tileCX(tx) + (rng.next() - 0.5) * 1.2, 0.02, BR.tileCZ(ty) + (rng.next() - 0.5) * 1.2);
      W.reg(group, g);
      W.addInteractable({
        id, kind: 'pickup', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: g.children.slice(), pos: g.position.clone().add(new THREE.Vector3(0, 0.3, 0)), radius: 2.4,
        prompt: () => '拾取' + ITEM_NAME[item] + (n > 1 ? ' ×' + n : ''),
        canUse: () => true,
        use: () => {
          if (item === 'flashlight') {
            BR.Player.hasFlashlight = true;
            BR.UI.toast('拾取了手电筒（按 F / 🔦 开关）');
          } else {
            BR.Game.inv[item] = (BR.Game.inv[item] || 0) + n;
            BR.UI.toast('拾取了' + ITEM_NAME[item] + (n > 1 ? ' ×' + n : ''));
          }
          BR.Audio.pickup();
          W.state.picked.push(id);
          BR.bus.emit('picked', { id });
          W.removeInteractable(id);
          group.remove(g);
          BR.UI.updateInv();
        }
      });
    });
  }

  /* ---------- 容器两段式交互（板条箱 / 柜子）共享件 ---------- */
  // 交互键标签：按键绑定由另一个工人负责的 input.js 提供（BR.Input.bindingLabel('interact')），
  // 未就绪时 fallback 为 'E'。prompt() 里调用；player.js 每 0.12s 会刷新 prompt()，绑定变更后自动更新。
  function interactKeyLabel() {
    return '【' + ((BR.Input && BR.Input.bindingLabel) ? BR.Input.bindingLabel('interact') : 'E') + '】';
  }
  BR.interactKeyLabel = interactKeyLabel;

  // 本 session 内开过的容器 id（箱/柜，运行时态，不进存档）：
  // 区分"老存档已开（openedCrates 有 id 即视为已处理完，区块重建/读档不重建箱内拾取，避免已拿物资复活）"
  // 与"本 session 内开过（区块卸载后重建时，若未拾取则重建箱内拾取）"。
  // 注意：W 在同一次页面会话内是单例（跨关 travel 复用），刷新页面/重进游戏后此表自然清空。
  function markLiveOpened(W, id) {
    W._liveOpened = W._liveOpened || {};
    W._liveOpened[id] = true;
  }
  function wasLiveOpened(W, id) {
    return !!(W._liveOpened && W._liveOpened[id]);
  }

  // 开盖小动画（setInterval 驱动约 350ms，不新增每帧射线/逻辑）
  const LID_OPEN = { rz: 1.9, x: -0.5, y: 1.1 };
  function setLidOpenPose(lid) { lid.rotation.z = LID_OPEN.rz; lid.position.set(LID_OPEN.x, LID_OPEN.y, 0); }
  function animLidOpen(lid) {
    const t0 = performance.now(), dur = 350;
    const frz = lid.rotation.z, fpos = lid.position.clone();
    const tpos = new THREE.Vector3(LID_OPEN.x, LID_OPEN.y, 0);
    const iv = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 2);
      lid.rotation.z = frz + (LID_OPEN.rz - frz) * e;
      lid.position.lerpVectors(fpos, tpos, e);
      if (k >= 1) clearInterval(iv);
    }, 16);
  }
  // 柜门开启动画（pivot 为 buildCabinetMesh 留在 userData.doorPivot 上的铰链组）
  const CAB_DOOR_OPEN = -1.85;
  function setCabinetDoorOpen(pivot) { pivot.rotation.y = CAB_DOOR_OPEN; }
  function animCabinetDoor(pivot) {
    const t0 = performance.now(), dur = 350;
    const iv = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      pivot.rotation.y = CAB_DOOR_OPEN * (1 - Math.pow(1 - k, 2));
      if (k >= 1) clearInterval(iv);
    }, 16);
  }

  // 敞口板条箱 mesh：四壁 + 底（能看见里面）+ 盖子。返回 {group, lid, parts}
  function buildCrateMesh(W) {
    const g = new THREE.Group();
    const wood = W.mat('crate');
    const parts = [];
    const t = 0.06, wd = 1.05, ht = 0.8;
    const wall = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
      m.position.set(x, y, z); g.add(m); parts.push(m);
    };
    wall(wd, ht, t, 0, ht / 2, wd / 2 - t / 2);
    wall(wd, ht, t, 0, ht / 2, -(wd / 2 - t / 2));
    wall(t, ht, wd - 2 * t, wd / 2 - t / 2, ht / 2, 0);
    wall(t, ht, wd - 2 * t, -(wd / 2 - t / 2), ht / 2, 0);
    wall(wd, t, wd, 0, t / 2, 0); // 底
    const lid = new THREE.Mesh(new THREE.BoxGeometry(wd, 0.12, wd), wood);
    lid.position.y = ht + 0.06; g.add(lid); parts.push(lid);
    return { group: g, lid, parts };
  }
  BR.buildCrateMesh = buildCrateMesh;

  // 容器内物资拾取（两段式的第二段）：可见 itemMesh + 隐形命中代理，kind 'pickup'。
  // pos 为物资底部中心世界坐标；chunkGroup 为 addChunkContent 的 group（随区块卸载，走 W.reg）。
  function spawnInnerPickup(W, chunkGroup, pos, pickId, item, tx, ty) {
    if (W.state.picked.includes(pickId)) return null; // 已拾取：不重建
    const ig = itemMesh(item);
    ig.position.copy(pos);
    // 命中代理：隐形大盒子（colorWrite 关，只参与射线不参与渲染），保证小 mesh 也能被射线稳定打中
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.8, 0.7),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false })
    );
    proxy.position.set(0, 0.25, 0);
    ig.add(proxy);
    W.reg(chunkGroup, ig);
    W.addInteractable({
      id: pickId, kind: 'pickup', chunkKey: W.chunkKeyOf(tx, ty),
      meshes: ig.children.slice(),
      pos: pos.clone().add(new THREE.Vector3(0, 0.25, 0)), radius: 2.6,
      prompt: () => BR.interactKeyLabel() + '拿起' + (ITEM_NAME[item] || item),
      canUse: () => true,
      use: () => {
        if (item === 'flashlight') {
          BR.Player.hasFlashlight = true;
          BR.UI.toast('拾取了手电筒（按 F / 🔦 开关）');
        } else {
          BR.Game.inv[item] = (BR.Game.inv[item] || 0) + 1;
          BR.UI.toast('拿起了' + (ITEM_NAME[item] || item));
        }
        BR.Audio.pickup();
        W.state.picked.push(pickId);
        BR.bus.emit('picked', { id: pickId });
        W.removeInteractable(pickId);
        chunkGroup.remove(ig);
        BR.UI.updateInv();
      }
    });
    return pickId;
  }

  // 板条箱两段式接线（L0/L1/L2/L3 共用）：
  //  第一段：交互"打开板条箱" → 掀盖动画 + 音效 + openedCrates 记录 + toast"箱子打开了，看看里面有什么"，
  //    同时在箱内刷出可见物资（kind 'pickup'，id 'cratepick_'+crateId，prompt"拿起"+物品名）；
  //    item==='empty' 时只 toast，不刷拾取；item==='flashlight' 也刷拾取（瞄准拿起获得手电）。
  //  第二段：准星对准箱内物资交互 → 进物品栏，记 picked，移除 mesh 与交互点。
  //  区块重建/读档：已开盖（本 session 内开过）且未拾取 → 重建箱内拾取；
  //    老存档（openedCrates 有 id 但非本 session 开）视为已处理完，不重建，避免已拿物资复活。
  function wireCrateTwoStage(W, chunkGroup, cm, o) {
    const id = o.id, item = o.item;
    const pickId = 'cratepick_' + id;
    const opened = W.state.openedCrates.includes(id);
    if (opened) setLidOpenPose(cm.lid);
    const innerPos = new THREE.Vector3(cm.group.position.x, 0.07, cm.group.position.z);
    if (opened && wasLiveOpened(W, id) && item !== 'empty' && !W.state.picked.includes(pickId)) {
      // 本 session 开过、还没拿：重建箱内拾取；箱体不再注册交互，避免挡住箱内物资的射线
      spawnInnerPickup(W, chunkGroup, innerPos, pickId, item, o.tx, o.ty);
      return;
    }
    if (opened) return; // 老存档已开 / 已拾取 / 空箱：纯装饰
    W.addInteractable({
      id, kind: 'crate', chunkKey: W.chunkKeyOf(o.tx, o.ty),
      meshes: cm.parts,
      pos: cm.group.position.clone().add(new THREE.Vector3(0, 1, 0)), radius: 2.6,
      prompt: () => BR.interactKeyLabel() + '打开板条箱',
      canUse: () => !W.state.openedCrates.includes(id),
      use: () => {
        if (W.state.openedCrates.includes(id)) return;
        animLidOpen(cm.lid);
        BR.Audio.doorCreak();
        W.state.openedCrates.push(id);
        markLiveOpened(W, id);
        BR.bus.emit('crate:opened', { id });
        W.removeInteractable(id); // 开盖后箱体移出射线检测，避免挡住箱内物资
        if (item === 'empty') {
          BR.UI.toast('箱子里只有灰尘。');
        } else {
          BR.UI.toast('箱子打开了，看看里面有什么');
          spawnInnerPickup(W, chunkGroup, innerPos, pickId, item, o.tx, o.ty);
        }
      }
    });
  }
  BR.wireCrateTwoStage = wireCrateTwoStage;

  function addCrate(W, poi) {
    const tx = poi.tx, ty = poi.ty;
    const id = 'crate_' + tx + '_' + ty;
    W.addChunkContent(tx, ty, (group) => {
      const cm = BR.buildCrateMesh(W);
      cm.group.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
      W.reg(group, cm.group);
      // 迁跃浆果来源之一：每只箱子 2% 概率（按箱子 id 确定性派生，保证复现；build 时即确定，重建一致）
      const item0 = (poi.data && poi.data.item) || 'empty';
      const item = (item0 !== 'flashlight' &&
        new BR.RNG(BR.hashSeed('crate_berry:' + id)).next() < 0.02) ? 'berry' : item0;
      BR.wireCrateTwoStage(W, group, cm, { id, tx, ty, item });
    });
  }

  // 迁跃浆果灌木：可采摘的稀有植物。交互后 inv.berry+1 并移除（一次性）。
  // POI 由 gen.js 旧关 placer 按极低概率放置（type:'berry_bush'）。
  function addBerryBush(W, p) {
    const tx = p.tx, ty = p.ty;
    const id = 'bush_' + tx + '_' + ty;
    W.addChunkContent(tx, ty, (group) => {
      if (W.state.picked.includes(id)) return; // 已采摘：存档恢复时不再出现
      const g = new THREE.Group();
      g.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
      const rng = new BR.RNG(BR.hashSeed(id)); // 布局确定性，不随加载变化
      const leaf = new THREE.MeshLambertMaterial({ color: 0x2e5a2e });
      for (let i = 0; i < 5; i++) { // 暗绿叶团
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.35 + rng.next() * 0.25, 8, 6), leaf);
        const a = rng.next() * 6.2832, r = 0.3 + rng.next() * 0.4;
        b.position.set(Math.cos(a) * r, 0.35 + rng.next() * 0.4, Math.sin(a) * r);
        g.add(b);
      }
      const bm = new THREE.MeshLambertMaterial({ color: 0x7a3fd0, emissive: 0x3a1060 });
      const berries = [];
      for (let i = 0; i < 6; i++) { // 微光浆果
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), bm);
        const a = rng.next() * 6.2832;
        s.position.set(Math.cos(a) * 0.45, 0.5 + rng.next() * 0.5, Math.sin(a) * 0.45);
        g.add(s); berries.push(s);
      }
      W.reg(group, g);
      W.addInteractable({
        id, kind: 'berry_bush', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: g.children.slice(), pos: g.position.clone().add(new THREE.Vector3(0, 0.8, 0)), radius: 2.6,
        prompt: () => '采摘迁跃浆果',
        canUse: () => true,
        use: () => {
          BR.Game.inv.berry = (BR.Game.inv.berry || 0) + 1;
          BR.Audio.pickup();
          BR.UI.toast('采到了迁跃浆果 ×1（说明：吃下去会随机传送，目标随机，可能更危险）');
          W.state.picked.push(id);
          BR.bus.emit('picked', { id });
          W.removeInteractable(id);
          group.remove(g);
          BR.UI.updateInv();
        }
      });
    });
  }

  // 薄墙（不稳定切出点）：注册位置，tick 里检测贴墙挤压
  function buildThinWalls(map, W) {
    W._thinWalls = (map.pois || []).filter(p => p.type === 'thin_wall').map(p => ({
      x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty),
      dx: p.data.dx || 0, dz: p.data.dz || 1,
      charge: 0, cool: 0, hintTold: false
    }));
  }
  function thinWallTick(dt) {
    const W = BR.World, P = BR.Player;
    if (!W._thinWalls || !P || BR.Game.state !== 'playing') return;
    for (const tw of W._thinWalls) {
      if (tw.cool > 0) { tw.cool -= dt; continue; }
      const d = Math.hypot(P.pos.x - tw.x, P.pos.z - tw.z);
      if (d > 1.7) { tw.charge = 0; continue; }
      const push = P.vel.x * tw.dx + P.vel.z * tw.dz; // 朝墙挤压
      if (push > 0.8) {
        tw.charge += dt;
        if (tw.charge > 0.3 && !tw.hintTold) { tw.hintTold = true; BR.UI.toast('这面墙……好像有点薄'); }
        if (tw.charge > 1.4) { tw.cool = 10; tw.charge = 0; noclipRandom(W, P); }
      } else tw.charge = Math.max(0, tw.charge - dt * 2);
    }
  }
  function noclipRandom(W, P) {
    // 野生切出：随机传送到同层较远的房间（带掉落转场，掩盖区块加载）
    if (BR.Trans.active) return; // 已有转场时不叠加
    const rooms = (W.map.rooms || []).filter(r =>
      Math.hypot(r.cx * T - P.pos.x, r.cy * T - P.pos.z) > 18);
    const r = rooms.length ? rooms[(Math.random() * rooms.length) | 0] : W.map.rooms[0];
    P.pos.set(BR.tileCX(Math.round(r.cx)), 0, BR.tileCZ(Math.round(r.cy)));
    P.vel.set(0, 0, 0);
    P.drainSanity(12);
    BR.Audio.stinger();
    BR.bus.emit('noclip:wild');
    BR.Trans.play('drop', { text: '你卡进了墙里……再睁眼，已经在别处了' });
  }
  // 挂到 BR 共享命名空间：L2/L3/FUN 在独立 IIFE 中，不在同一作用域，直接调用会 ReferenceError
  BR.buildThinWalls = buildThinWalls;
  BR.thinWallTick = thinWallTick;
  BR.addBerryBush = addBerryBush; // 迁跃浆果灌木建造器（L1/L2/L3 共用）

  /* ---------- 程序化家具（桌子/柜子）与家具拾取（L0 马尼拉房间 / L1 家具 POI 共用） ---------- */
  // 桌子：桌面 + 四腿，木纹色
  function buildTableMesh() {
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a6238 });
    const woodDark = new THREE.MeshLambertMaterial({ color: 0x64461f });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.8), wood);
    top.position.y = 0.72; g.add(top);
    const legG = new THREE.BoxGeometry(0.09, 0.72, 0.09);
    [[-0.56, -0.31], [0.56, -0.31], [-0.56, 0.31], [0.56, 0.31]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(legG, woodDark);
      leg.position.set(x, 0.36, z); g.add(leg);
    });
    return g;
  }
  // 柜子：柜体 + 可转动的左扇柜门（铰链在左边缘，门板相对铰链右偏；打开时整扇向左转出）
  // 铰链组挂在 g.userData.doorPivot，供 addFurniturePickup（container:'cabinet'）做开门动画
  function buildCabinetMesh() {
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: 0x77552e });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.5, 0.55), wood);
    body.position.y = 0.75; g.add(body);
    const trim = new THREE.MeshLambertMaterial({ color: 0x4a3013 });
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.09, 0.06, 0.59), trim);
    lip.position.y = 1.47; g.add(lip); // 顶部压条
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-0.5, 0.75, 0.30);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.34, 0.04), wood);
    door.position.set(0.49, 0, 0);
    doorPivot.add(door);
    const hm = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.06), hm);
    handle.position.set(0.88, 0.05, 0.05); // 跟门一起转
    doorPivot.add(handle);
    g.add(doorPivot);
    g.userData.doorPivot = doorPivot;
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.34, 0.045), trim);
    seam.position.set(0.5, 0.75, 0.29); g.add(seam); // 右边缘门缝线（装饰）
    return g;
  }
  function buildFurnitureMesh(kind) {
    return kind === 'cabinet' ? buildCabinetMesh() : buildTableMesh();
  }
  BR.buildFurnitureMesh = buildFurnitureMesh; // 家具 mesh 建造器（L1 复用）

  // 家具拾取交互（桌/柜）：
  //  container === 'cabinet' → 两段式：第一次交互"打开柜门"（柜门转动动画 + 音效），
  //    柜内刷出物资拾取（kind 'pickup'，id 'cabpick_'+原id，prompt"拿起"+物品名）；
  //    第二次准星对准柜内物资交互 → 进物品栏，记 picked，移除 mesh 与交互点。
  //    柜子 id 'cab_'+tx+'_'+ty+'_'+suffix，开门状态复用 W.state.openedCrates（自动进存档）；
  //    开门后柜体移出射线检测，避免挡住柜内物资。
  //    老存档兼容：旧一步流程拾取后 picked 里记的是原 id（fpick_…），同样视为已拾取，不重建。
  //  container === 'table'（默认）→ 一步拾取（原行为：准星对准桌上物资直接拿起）。
  // kind 复用 INTERACT_KINDS 已有的 'pickup'；柜门交互 kind 'cabinet'（world.js 已登记）。
  // opts: {tx, ty, item, suffix, group, fx, fz, topY, container, furniture}
  //   furniture 为 buildFurnitureMesh 返回的组（cabinet 时用来找柜门铰链 / 算柜内拾取位置）
  function addFurniturePickup(W, opts) {
    const item = opts.item;
    if (!item) return null;
    const id = 'fpick_' + item + '_' + opts.tx + '_' + opts.ty + '_' + (opts.suffix || 'furn');
    if (opts.container === 'cabinet') return addCabinetTwoStage(W, opts, id, item);
    // —— table / 默认：一步拾取（原逻辑） ——
    if (W.state.picked.includes(id)) return null; // 已拾取：存档/区块重建时不重建
    const ig = itemMesh(item);
    const rng = new BR.RNG(BR.hashSeed(id));
    ig.position.set(opts.fx + (rng.next() - 0.5) * 0.35, opts.topY,
      opts.fz + (rng.next() - 0.5) * 0.3);
    // 命中代理：隐形大盒子（colorWrite 关，只参与射线不参与渲染），
    // 保证小瓶子/绷带卷这类小 mesh 也能被屏幕中心射线稳定打中
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.8, 0.7),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false })
    );
    proxy.position.set(0, 0.25, 0);
    ig.add(proxy);
    W.reg(opts.group, ig);
    W.addInteractable({
      id, kind: 'pickup', chunkKey: W.chunkKeyOf(opts.tx, opts.ty),
      meshes: ig.children.slice(),
      pos: ig.position.clone().add(new THREE.Vector3(0, 0.25, 0)), radius: 2.6,
      prompt: () => BR.interactKeyLabel() + '拿起' + (ITEM_NAME[item] || item),
      canUse: () => true,
      use: () => {
        BR.Game.inv[item] = (BR.Game.inv[item] || 0) + 1;
        BR.Audio.pickup();
        BR.UI.toast('拿起了' + (ITEM_NAME[item] || item));
        W.state.picked.push(id);
        BR.bus.emit('picked', { id });
        W.removeInteractable(id);
        opts.group.remove(ig);
        BR.UI.updateInv();
      }
    });
    return id;
  }
  BR.addFurniturePickup = addFurniturePickup; // 家具拾取建造器（L1 复用）

  // 柜子两段式（addFurniturePickup container:'cabinet' 时调用）：
  //  第一段"打开柜门" → 柜门转动动画 + 音效 + openedCrates 记录 + toast，柜内刷出可见物资拾取；
  //  第二段准星对准柜内物资 → 拾取进物品栏。区块重建/读档规则同 wireCrateTwoStage。
  function addCabinetTwoStage(W, opts, id, item) {
    const cabId = 'cab_' + opts.tx + '_' + opts.ty + '_' + (opts.suffix || 'furn');
    const pickId = 'cabpick_' + id;
    const pivot = opts.furniture ? opts.furniture.userData.doorPivot : null;
    const opened = W.state.openedCrates.includes(cabId);
    if (opened && pivot) setCabinetDoorOpen(pivot); // 读档/重建：保持开门状态
    // 柜内拾取位置：柜门正前方敞口处，用柜子本地坐标换算（适配柜子朝向）
    const innerPos = (() => {
      const f = opts.furniture;
      if (f) {
        f.updateMatrixWorld(true);
        return f.localToWorld(new THREE.Vector3(0, 0.7, 0.44));
      }
      return new THREE.Vector3(opts.fx, 0.7, opts.fz);
    })();
    // 含老存档一步拾取（picked 里记的是原 id）：视为已拾取，不重建
    const picked = W.state.picked.includes(pickId) || W.state.picked.includes(id);
    if (opened && wasLiveOpened(W, cabId) && !picked) {
      // 本 session 内开过、还没拿：重建柜内拾取；柜体不再注册交互，避免挡住柜内物资的射线
      spawnInnerPickup(W, opts.group, innerPos, pickId, item, opts.tx, opts.ty);
      return cabId;
    }
    if (opened) return cabId; // 老存档已开 / 已拾取：纯装饰
    // 展平一层 children（含铰链组里的门板/把手），保证门板也能被射线打中
    const cabMeshes = [];
    if (opts.furniture) opts.furniture.children.forEach(c => {
      cabMeshes.push(c);
      if (c.children) c.children.forEach(cc => cabMeshes.push(cc));
    });
    W.addInteractable({
      id: cabId, kind: 'cabinet', chunkKey: W.chunkKeyOf(opts.tx, opts.ty),
      meshes: cabMeshes,
      pos: new THREE.Vector3(opts.fx, 1.0, opts.fz), radius: 2.6,
      prompt: () => BR.interactKeyLabel() + '打开柜门',
      canUse: () => !W.state.openedCrates.includes(cabId),
      use: () => {
        if (W.state.openedCrates.includes(cabId)) return;
        if (pivot) animCabinetDoor(pivot);
        BR.Audio.doorCreak();
        W.state.openedCrates.push(cabId);
        markLiveOpened(W, cabId);
        // main.js 的自动存档只监听 'crate:opened'，柜子开门同样触发一次，保证开门状态落盘
        BR.bus.emit('crate:opened', { id: cabId });
        W.removeInteractable(cabId); // 开门后柜体移出射线检测，避免挡住柜内物资
        if (W.state.picked.includes(id)) {
          // 老存档：旧一步流程已拾取过（picked 里记的是原 id），不再刷出，避免物资复活
          BR.UI.toast('柜门打开了，里面是空的。');
        } else {
          BR.UI.toast('柜门打开了，看看里面有什么');
          spawnInnerPickup(W, opts.group, innerPos, pickId, item, opts.tx, opts.ty);
        }
      }
    });
    return cabId;
  }

  // 所有门：按 exitTo 赋予转场行为
  function buildDoors(map, W) {    for (const d of map.doors) {
      const def = {
        id: d.id, tx: d.tx, ty: d.ty, axis: d.axis,
        locked: d.locked, label: d.label
      };
      if (d.label === '虚空之门') {
        def.solidWhenOpen = true;
        def.prompt = () => W.doors[d.id].open ? '关上虚空之门' : '推开虚空之门';
        def.use = (dd) => {
          W.setDoor(d.id, !dd.open);
          if (dd.open) {
            BR.UI.toast('门后只有翻涌的黑暗。你决定还是关上它。');
            BR.Audio.glitch();
          }
        };
      } else if (d.exitTo === 'L2') {
        def.prompt = () => '推开门，走进长走廊';
        def.use = () => {
          W.setDoor(d.id, true, true);
          BR.Audio.doorCreak();
          setTimeout(() => { if (BR.Game.state === 'playing') BR.Trans.play('corridor'); }, 600);
        };
      } else if (d.exitTo === 'L3') {
        def.prompt = () => '推开这扇没上锁的门';
        def.use = () => {
          W.setDoor(d.id, true);
          setTimeout(() => { if (BR.Game.state === 'playing') BR.Trans.play('gate'); }, 800);
        };
      } else if (d.exitTo === 'L1') {
        // FUN 员工通道
        def.prompt = () => BR.Game.flags.clues >= 2 ? '推开员工通道的门' : '🔒 员工通道（锁住了）';
        def.use = () => {
          const c = BR.Game.flags.clues;
          if (c >= 2) {
            W.setDoor(d.id, true);
            setTimeout(() => { if (BR.Game.state === 'playing') BR.Trans.play('fun_escape'); }, 800);
          } else {
            BR.Audio.doorLocked();
            BR.UI.toast('门纹丝不动。派对里一定藏着离开的线索……（' + c + '/2）');
          }
        };
      }
      W.addDoor(def);
    }
  }

  function poiList(map, type) {
    return (map.pois || []).filter(p => p.type === type);
  }

  /* ================= L0 ================= */
  BR.Levels.L0.buildContent = function (map, W) {
    buildDoors(map, W);
    // 异常墙：污渍 + 可触碰
    poiList(map, 'anomaly_wall').forEach(p => {
      const dx = p.data.dirx != null ? p.data.dirx : 0, dz = p.data.dirz != null ? p.data.dirz : 1;
      W.addChunkContent(p.tx, p.ty, (group) => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(1.7, 2.3),
          new THREE.MeshBasicMaterial({ map: BR.Textures.get('stain'), transparent: true, opacity: 0.92 })
        );
        m.position.set(BR.tileCX(p.tx) + dx * (T / 2 - 0.03), 1.35, BR.tileCZ(p.ty) + dz * (T / 2 - 0.03));
        m.rotation.y = Math.atan2(dx, dz);
        W.reg(group, m);
        BR.Audio.addLoop('whisper_l0', 'flicker', m.position.x, m.position.z, 0.25);
        W.addInteractable({
          id: 'anomaly', kind: 'anomaly', chunkKey: W.chunkKeyOf(p.tx, p.ty),
          meshes: [m], pos: m.position.clone(), radius: 2.6,
          prompt: () => '触碰这面墙（墙纸的颜色不太对劲）',
          canUse: () => true,
          use: () => { BR.bus.emit('anomaly:touch'); BR.Trans.play('noclip_wall'); }
        });
      });
    });
    // 红房间：红色灯光
    poiList(map, 'red_room').forEach(p => {
      W.addChunkContent(p.tx, p.ty, (group) => {
        const L = new THREE.PointLight(0xff2010, 1.4, 18, 2);
        L.position.set(BR.tileCX(p.tx), 2.2, BR.tileCZ(p.ty));
        W.reg(group, L);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(T * 2.4, T * 2.4),
          new THREE.MeshBasicMaterial({ map: BR.Textures.get('stain'), transparent: true, opacity: 0.35, color: 0xff5040 }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(BR.tileCX(p.tx), 0.02, BR.tileCZ(p.ty));
        W.reg(group, m);
      });
    });
    // 笔记
    const L0_NOTES = [
      ['前人的字条', '如果你看到这张字条，说明你也切出来了。\n\n别慌。跟着荧光灯走，找墙纸颜色不对的那面墙。\n\n——M.'],
      ['皱巴巴的字条', '第 47 天。地毯还是潮的。\n\n我发现这些房间没有两间是一样的，但出口……出口一直在"最不对劲"的地方。\n\n相信你的直觉。']
    ];
    poiList(map, 'note').forEach((p, i) => {
      const n = L0_NOTES[i % L0_NOTES.length];
      addNote(W, p.tx, p.ty, n[0], n[1]);
    });
    // 马尼拉房间：Level 0 的安全屋（1:1 还原 research/manila.md）
    // 契约（gen.js placeL0）：p.data = {x0,y0,x1,y1, doorTx, doorTy}，
    // (x0,y0)-(x1,y1) 为内部地板 tile 矩形（含边界），(doorTx,doorTy) 为唯一的门 tile（墙已由 gen 围好）。
    // 还原点：马尼拉纸色墙面+木地板 / 房间唯一一盏橙色顶灯（比 L0 暗、亮度波动）/
    // 中央八角桌+双椅 / 桌下柜两段式（逻辑不动）/ 桌上多语言穿墙指南（可读装饰）/
    // 墙上 Manila Mary Foundation 告示全文（中英对照）/ 靠近钢琴曲+嗡鸣减弱 /
    // 墙内敲击+短暂全黑 / 久留 3 分钟送往 L1。保留：安全区 r=6.5、理智回复、杏仁水/绷带。
    poiList(map, 'manila_room').forEach(p => {
      const d = p.data || {};
      // 兼容旧数据（仅 p.tx/p.ty 为房间中心）：退化为单 tile 房间
      const x0 = (d.x0 != null) ? d.x0 : p.tx, x1 = (d.x1 != null) ? d.x1 : p.tx;
      const y0 = (d.y0 != null) ? d.y0 : p.ty, y1 = (d.y1 != null) ? d.y1 : p.ty;
      const door = (d.doorTx != null && d.doorTy != null) ? { x: d.doorTx, y: d.doorTy } : null;
      const isDoor = (tx, ty) => !!(door && door.x === tx && door.y === ty);
      const cx = BR.tileCX((x0 + x1) / 2), cz = BR.tileCZ((y0 + y1) / 2);
      const tcx = Math.round((x0 + x1) / 2), tcy = Math.round((y0 + y1) / 2);
      const wallH = (BR.Levels.L0.theme.wallH || 2.7);
      // 供 world.js 跳过房间内 L0 荧光灯具（房间里只有一盏顶灯）；dispose 时清空
      W._manilaRect = { x0, y0, x1, y1 };
      const woodFloorMat = new THREE.MeshLambertMaterial({ color: 0x8f6b45 });
      const manilaWallMat = new THREE.MeshLambertMaterial({ color: 0xc7a06a }); // 马尼拉纸色（牛皮纸/米色）
      // 1) 木地板（颜色区分 L0 潮湿地毯）：逐 tile 一块，避免跨区块拉伸
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        W.addChunkContent(tx, ty, (group) => {
          const f = new THREE.Mesh(new THREE.PlaneGeometry(T, T), woodFloorMat);
          f.rotation.x = -Math.PI / 2;
          f.position.set(BR.tileCX(tx), 0.02, BR.tileCZ(ty));
          W.reg(group, f);
        });
      }
      // 2) 墙面马尼拉纸色贴面：只贴内墙面（门 tile 跳过），区别于 L0 单黄墙纸
      for (let ty = y0 - 1; ty <= y1 + 1; ty++) for (let tx = x0 - 1; tx <= x1 + 1; tx++) {
        if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) continue;
        if (!W.isWall(tx, ty) || isDoor(tx, ty)) continue;
        let nx = 0, nz = 0;
        if (tx < x0) nx = 1; else if (tx > x1) nx = -1;
        if (ty < y0) nz = 1; else if (ty > y1) nz = -1;
        if (!nx && !nz) continue;
        if (nx && nz) nz = 0; // 角 tile 取 x 向贴面
        const wtx = tx, wty = ty, wnx = nx, wnz = nz;
        W.addChunkContent(wtx, wty, (group) => {
          const v = new THREE.Mesh(new THREE.PlaneGeometry(T, wallH), manilaWallMat);
          v.position.set(BR.tileCX(wtx) + wnx * (T / 2 - 0.04), wallH / 2, BR.tileCZ(wty) + wnz * (T / 2 - 0.04));
          v.rotation.y = Math.atan2(wnx, wnz);
          W.reg(group, v);
        });
      }
      // 3) 房间唯一光源：顶灯（灯罩+灯泡+橙色点光），比 L0 暗、明显橙色调；亮度随时间波动（tick 里调制）
      W.addChunkContent(tcx, tcy, (group) => {
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.18, 12),
          new THREE.MeshLambertMaterial({ color: 0x3a2c1c }));
        shade.position.set(cx, wallH - 0.12, cz); W.reg(group, shade);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xffb45e }));
        bulb.position.set(cx, wallH - 0.25, cz); W.reg(group, bulb);
        const L = new THREE.PointLight(0xff8a35, 0.95, 16, 2);
        L.position.set(cx, wallH - 0.4, cz);
        W.reg(group, L);
        W._manilaLamp = L; W._manilaLampBase = 0.95;
      });
      // 4) 中央八角桌（8 边形桌面）+ 两把椅子（分列两侧、面向桌心）+ 桌上杏仁水拾取（原 manila_table 保留）
      W.addChunkContent(tcx, tcy, (group) => {
        const wood = new THREE.MeshLambertMaterial({ color: 0x6f5233 });
        const table = new THREE.Group();
        const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.09, 8), wood);
        top.position.y = 0.74; top.rotation.y = Math.PI / 8; table.add(top);
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.68, 8), wood);
        ped.position.y = 0.37; table.add(ped);
        const tbase = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.08, 8), wood);
        tbase.position.y = 0.04; table.add(tbase);
        table.position.set(cx, 0, cz);
        W.reg(group, table);
        [[cx - 1.85, cz, Math.PI / 2], [cx + 1.85, cz, -Math.PI / 2]].forEach(pt => {
          const ch = buildChairMesh();
          ch.position.set(pt[0], 0, pt[1]); ch.rotation.y = pt[2];
          W.reg(group, ch);
        });
        BR.addFurniturePickup(W, {
          tx: tcx, ty: tcy, item: 'almond', suffix: 'manila_table',
          group, fx: cx, fz: cz, topY: 0.80, container: 'table'
        });
        // 5) 桌上散落文件：多语言穿墙指南（可读装饰字条，非收集系统）
        addTablePaper(W, group, tcx, tcy, cx - 0.62, 0.795, cz + 0.30, 0.5, '《穿墙指南》', MANILA_NOCLIP_TEXT);
        addTablePaper(W, group, tcx, tcy, cx + 0.60, 0.795, cz - 0.28, -0.35, '《生存守则》', MANILA_SURVIVAL_TEXT);
      });
      // 6) 柜子（程序化：柜体+柜门）+ 柜中绷带拾取 —— 两段式逻辑保持不动（另一个工人刚升级过）
      let gtx = x1, gty = y1;
      if (isDoor(gtx, gty)) gtx = (x1 - 1 >= x0) ? x1 - 1 : x1;
      W.addChunkContent(gtx, gty, (group) => {
        const fx = BR.tileCX(gtx) + 0.7, fz = BR.tileCZ(gty) + 0.7;
        const cab = buildFurnitureMesh('cabinet');
        cab.position.set(fx, 0, fz);
        cab.rotation.y = Math.atan2(cx - fx, cz - fz); // 面向房间中心
        W.reg(group, cab);
        BR.addFurniturePickup(W, {
          tx: gtx, ty: gty, item: 'bandage', suffix: 'manila_cab',
          group, fx, fz, topY: 1.54, container: 'cabinet', furniture: cab
        });
      });
      // 7) 墙上 Manila Mary Foundation 告示（全文：英文原文贴墙 + 中英对照可读）
      let ptx = x0, pty = tcy;
      if (isDoor(ptx, pty)) ptx = x1;
      if (isDoor(ptx, pty)) { ptx = tcx; pty = y0; }
      W.addChunkContent(ptx, pty, (group) => {
        const n = wallNormal(W, ptx, pty);
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.94),
          new THREE.MeshBasicMaterial({ map: manilaPosterTexture() }));
        pm.position.set(BR.tileCX(ptx) + n.x * (T / 2 - 0.05), 1.62, BR.tileCZ(pty) + n.z * (T / 2 - 0.05));
        pm.rotation.y = Math.atan2(n.x, n.z);
        W.reg(group, pm);
        W.addInteractable({
          id: 'manila_poster_' + ptx + '_' + pty, kind: 'note', chunkKey: W.chunkKeyOf(ptx, pty),
          meshes: [pm], pos: pm.position.clone(), radius: 2.8,
          prompt: () => (BR.interactKeyLabel ? BR.interactKeyLabel() : '【E】') + '阅读基金会告示',
          canUse: () => true,
          use: () => {
            BR.Audio.paper();
            BR.UI.showNote('Manila Mary Foundation 告示', MANILA_POSTER_CN + '\n\n' + MANILA_POSTER_EN);
          }
        });
      });
      // 8) 旧马尼拉字条（文案不动）：贴在另一面墙上
      let ntx = x1, nty = tcy;
      if (isDoor(ntx, nty)) { ntx = x0; }
      if (isDoor(ntx, nty)) { ntx = tcx; nty = y1; }
      addNote(W, ntx, nty, '马尼拉房间',
        '如果你读到这个，说明你找到了马尼拉房间。\n\n这里没有实体。灯是暖的，补给是真的。\n\n待到理智恢复再走。记住它的位置——后室里这样的地方不多。\n\n——M.');
      W._manila = { x: cx, z: cz };
      (W._safeZones = W._safeZones || []).push({ x: cx, z: cz, r: 6.5 });
    });
    // Systems A：FUN 涂鸦（本游戏原创机制）——墙上涂鸦 "FUN =)" + 附近地板可爬洞口 → FUN
    // gen.js placeL0 以 8% 概率放 fun_graffiti / fun_hole2 POI
    poiList(map, 'fun_graffiti').forEach(p => {
      const n = wallNormal(W, p.tx, p.ty);
      W.addChunkContent(p.tx, p.ty, (group) => {
        // 涂鸦贴图：canvas 手绘 "FUN =)"
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 128;
        const cx2 = cv.getContext('2d');
        cx2.fillStyle = 'rgba(0,0,0,0)'; cx2.fillRect(0, 0, 256, 128);
        cx2.strokeStyle = '#ff4fd8'; cx2.lineWidth = 7; cx2.lineCap = 'round';
        cx2.font = 'bold 64px "Comic Sans MS", cursive, sans-serif';
        cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
        cx2.save();
        cx2.translate(128, 58); cx2.rotate(-0.06);
        cx2.strokeText('FUN =)', 0, 0);
        cx2.restore();
        // 滴漆
        cx2.fillStyle = '#ff4fd8';
        [[70, 96], [150, 100], [196, 94]].forEach(([dx, dy]) => {
          cx2.fillRect(dx, dy, 4, 14 + (dx % 3) * 6);
        });
        const tex = new THREE.CanvasTexture(cv);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95 }));
        m.position.set(BR.tileCX(p.tx) + n.x * (T / 2 - 0.04), 1.55, BR.tileCZ(p.ty) + n.z * (T / 2 - 0.04));
        m.rotation.y = Math.atan2(n.x, n.z);
        W.reg(group, m);
      });
    });
    poiList(map, 'fun_hole2').forEach(p => {
      W.addChunkContent(p.tx, p.ty, (group) => {
        const x = BR.tileCX(p.tx), z = BR.tileCZ(p.ty);
        // 地板上的黑洞 + 碎裂边缘
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.8, 18),
          new THREE.MeshBasicMaterial({ color: 0x000000 }));
        hole.rotation.x = -Math.PI / 2;
        hole.position.set(x, 0.025, z);
        W.reg(group, hole);
        const rim = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 18),
          W.mat('concrete'));
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(x, 0.03, z);
        W.reg(group, rim);
        // 隐约的派对音乐
        BR.Audio.addLoop('funhole2_' + p.tx + '_' + p.ty, 'flicker', x, z, 0.12);
        W.addInteractable({
          id: 'fun_hole2_' + p.tx + '_' + p.ty, kind: 'fun_hole',
          chunkKey: W.chunkKeyOf(p.tx, p.ty),
          meshes: [hole], pos: new THREE.Vector3(x, 1.2, z), radius: 2.6,
          prompt: () => '爬进地板上的洞口（隐约有音乐声……）',
          canUse: () => !BR.Cutout.busy,
          use: () => { BR.Cutout.travel('FUN', { kind: 'hole' }); }
        });
      });
    });
    buildThinWalls(map, W);
    W.objective = '探索 Level 0，找到那面"不太对劲"的墙';
  };

  BR.Levels.L0.onEnter = function () {
    BR.UI.setObjective(BR.World.objective);
    BR.Audio.setAmbient('L0');
  };

  BR.Levels.L0.tick = function (dt) {
    const W = BR.World, P = BR.Player;
    if (!P || BR.Game.state !== 'playing') return;
    thinWallTick(dt);
    if (W._manila && !W._manilaTold && Math.hypot(P.pos.x - W._manila.x, P.pos.z - W._manila.z) < 7) {
      W._manilaTold = true;
      BR.UI.toast('马尼拉房间。这里是安全的，待一会儿能恢复理智');
      BR.Audio.checkpoint();
    }
    // 马尼拉房间系统（1:1 还原）：钢琴曲+嗡鸣减弱 / 顶灯波动 / 墙内敲击+全黑 / 久留 3 分钟送往 L1
    if (W._manila) {
      const dM = Math.hypot(P.pos.x - W._manila.x, P.pos.z - W._manila.z);
      const inM = dM < 6.5, nearM = dM < 14;
      // 靠近：L0 嗡鸣减弱 + 舒缓钢琴曲；离开：恢复
      if (nearM && !W._manilaPiano) {
        W._manilaPiano = true;
        BR.Audio.manilaPianoStart(); BR.Audio.manilaHumDuck(true);
      } else if (!nearM && W._manilaPiano) {
        W._manilaPiano = false;
        BR.Audio.manilaPianoStop(); BR.Audio.manilaHumDuck(false);
      }
      // 顶灯亮度随时间轻微波动（全黑事件期间保持熄灭）
      W._manilaT = (W._manilaT || 0) + dt;
      if (W._manilaLamp && !W._manilaBlackout) {
        W._manilaLamp.intensity = W._manilaLampBase *
          (1 + 0.10 * Math.sin(W._manilaT * 1.4) + 0.05 * Math.sin(W._manilaT * 4.3 + 1.7));
      }
      // 久留 = 奖励性出口：房内停留超 3 分钟 → 淡出 → 传送到 L1（Fandom 设定）
      if (inM && !W._manilaSent) {
        W._manilaStay = (W._manilaStay || 0) + dt;
        if (W._manilaStay >= 150 && !W._manilaWarned) {
          W._manilaWarned = true;
          BR.UI.toast('你感到一阵恍惚……');
        }
        if (W._manilaStay >= 180) {
          W._manilaSent = true;
          manilaOverlay(true, 1400); // 淡出
          BR.UI.toast('世界在你眼前溶解……');
          setTimeout(() => {
            manilaOverlay(false, 600);
            if (BR.Game.state === 'playing' && !BR.Cutout.busy) {
              BR.Audio.manilaPianoStop(); BR.Audio.manilaHumDuck(false);
              BR.Cutout.travel('L1', { kind: 'manila' });
            } else {
              // 被打断（暂停等）：允许离开重进后再次触发
              W._manilaSent = false; W._manilaPiano = false;
            }
          }, 1500);
        }
      } else if (!inM) {
        W._manilaStay = 0; W._manilaWarned = false;
      }
      // 偶发：墙内敲击声 + 短暂全黑（2–4 秒，期间理智微降），随机 45–90 秒一次，仅在房内触发
      if (inM && !W._manilaSent && !W._manilaBlackout) {
        if (W._manilaEvtT == null) W._manilaEvtT = 45 + Math.random() * 45;
        W._manilaEvtT -= dt;
        if (W._manilaEvtT <= 0) {
          W._manilaEvtT = 45 + Math.random() * 45;
          W._manilaBlackout = true;
          W._manilaBlackoutT = 2 + Math.random() * 2;
          BR.Audio.knock();
          if (W._manilaLamp) W._manilaLamp.intensity = 0;
          manilaOverlay(true, 500);
          BR.UI.toast('墙里传来敲击声……灯灭了');
        }
      }
      if (W._manilaBlackout) {
        W._manilaBlackoutT -= dt;
        P.drainSanity(1.2 * dt); // 全黑期间理智微降
        if (W._manilaBlackoutT <= 0) {
          W._manilaBlackout = false;
          manilaOverlay(false, 800);
          if (W._manilaLamp) W._manilaLamp.intensity = W._manilaLampBase;
        }
      }
    }
    // 随机氛围事件：L0 无实体，孤独感里的不确定性（纯氛围 + 轻微理智压力，无实际伤害）
    W._l0ambT = (W._l0ambT == null ? 45 + Math.random() * 30 : W._l0ambT) - dt;
    if (W._l0ambT <= 0) {
      W._l0ambT = 60 + Math.random() * 60;
      const rr = Math.random();
      if (rr < 0.45) { BR.Audio.whisper(); }
      else if (rr < 0.75) { BR.Audio.flickerBuzz(); BR.UI.toast('头顶的荧光灯闪了一下'); }
      else { BR.UI.toast('你感觉……刚才有什么东西在看你'); P.drainSanity(2); }
    }
  };

  /* ================= L1 ================= */
  BR.Levels.L1.buildContent = function (map, W) {
    buildDoors(map, W);
    // 出口长走廊起点：标识 + 提示
    poiList(map, 'exit_corridor').forEach(p => {
      W.addChunkContent(p.tx, p.ty, (group) => {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5),
          new THREE.MeshBasicMaterial({ map: BR.Textures.get('exitSign') }));
        const dx = p.data.dirx != null ? p.data.dirx : 0, dz = p.data.dirz != null ? p.data.dirz : 1;
        s.position.set(BR.tileCX(p.tx) + dx * 2, 2.3, BR.tileCZ(p.ty) + dz * 2);
        s.rotation.y = Math.atan2(dx, dz);
        W.reg(group, s);
      });
      W._exitCorr = { x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty) };
    });
    // 安全屋：暖光
    poiList(map, 'safe_room').forEach(p => {
      W.addChunkContent(p.tx, p.ty, (group) => {
        const L = new THREE.PointLight(0xffd9a0, 1.1, 16, 2);
        L.position.set(BR.tileCX(p.tx), 2.4, BR.tileCZ(p.ty));
        W.reg(group, L);
        // 帐篷
        const tent = new THREE.Group();
        const c1 = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.8),
          new THREE.MeshLambertMaterial({ color: 0x4a5a3a, side: THREE.DoubleSide }));
        c1.position.set(0, 0.8, -0.55); c1.rotation.x = 0.6; tent.add(c1);
        const c2 = c1.clone(); c2.position.z = 0.55; c2.rotation.x = -0.6; tent.add(c2);
        tent.position.set(BR.tileCX(p.tx) + 1, 0, BR.tileCZ(p.ty));
        W.reg(group, tent);
      });
      (W._safeRooms = W._safeRooms || []).push({ x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty), told: false });
    });
    // 闪烁区
    poiList(map, 'blackout').forEach(p => {
      (W._blackouts = W._blackouts || []).push({
        x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty), r: (p.data.r || 4) * T, cd: 0
      });
    });
    // 天花板破洞 → FUN 支线
    poiList(map, 'fun_hole').forEach(p => {
      W.setOpenCeil(p.tx, p.ty);
      W.addChunkContent(p.tx, p.ty, (group) => {
        const x = BR.tileCX(p.tx), z = BR.tileCZ(p.ty), wallH = W.theme.wallH;
        // 光柱
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(1.25, 1.5, wallH, 14, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffd9ec, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
        );
        shaft.position.set(x, wallH / 2, z);
        W.reg(group, shaft);
        // 碎裂边缘
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.18, 8, 14),
          W.mat('concrete'));
        rim.rotation.x = Math.PI / 2;
        rim.position.set(x, wallH - 0.05, z);
        W.reg(group, rim);
        // 上方暖光
        const L = new THREE.PointLight(0xffc0d8, 1.3, 14, 2);
        L.position.set(x, wallH - 0.6, z);
        W.reg(group, L);
        // 隐约的派对音乐（用 tick 周期性触发）
        W._funHole = { x, z };
        W.addInteractable({
          id: 'fun_hole', kind: 'hole', chunkKey: W.chunkKeyOf(p.tx, p.ty),
          meshes: [shaft], pos: new THREE.Vector3(x, 1.6, z), radius: 2.6,
          prompt: () => '爬进天花板上的破洞（上面有音乐声……）',
          canUse: () => true,
          use: () => { BR.Trans.play('ceiling'); }
        });
      });
    });
    // 板条箱 / 笔记 / 地标
    poiList(map, 'crate').forEach(p => addCrate(W, p));
    // 迁跃浆果灌木（gen.js 极低概率放置）
    poiList(map, 'berry_bush').forEach(p => BR.addBerryBush(W, p));
    const L1_NOTES = [
      ['定居者的字条', '小径上有标记，跟着走能到安全屋。\n\n记住：最长的那条走廊不是幻觉，走到底就是出口。\n\n——M.'],
      ['潦草的字条', '灯开始闪的时候，千万别跑。\n蹲下来，贴着墙，等它过去。'],
      ['褪色的告示', 'M.E.G. 提醒：杏仁水是硬通货。\n不要相信天花板上的音乐。']
    ];
    poiList(map, 'note').forEach((p, i) => {
      const n = L1_NOTES[i % L1_NOTES.length];
      addNote(W, p.tx, p.ty, n[0], n[1]);
    });
    poiList(map, 'landmark').forEach(p => {
      W.addChunkContent(p.tx, p.ty, (group) => {
        // 补给堆：几个箱子
        for (let i = 0; i < 3; i++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), W.mat('crate'));
          b.position.set(BR.tileCX(p.tx) + (i - 1) * 1.1, 0.45, BR.tileCZ(p.ty) + (i % 2) * 0.9);
          b.rotation.y = i * 0.4;
          W.reg(group, b);
        }
      });
    });
    // 家具 POI（gen.js L1 放置）：p.data = {kind:'table'|'cabinet', item:'almond'|'bandage'|'food'|null}
    // 程序化桌子/柜子 mesh + 家具拾取；item 为 null 时只做装饰。
    // 柜子（kind:'cabinet'）走两段式（先开门再拿），桌子保持一步拾取。
    poiList(map, 'furniture').forEach((p, i) => {
      const d = p.data || {};
      const kind = (d.kind === 'cabinet') ? 'cabinet' : 'table';
      const item = d.item || null;
      W.addChunkContent(p.tx, p.ty, (group) => {
        const fx = BR.tileCX(p.tx), fz = BR.tileCZ(p.ty);
        const f = BR.buildFurnitureMesh(kind);
        f.position.set(fx, 0, fz);
        const rng = new BR.RNG(BR.hashSeed('furn_' + p.tx + '_' + p.ty));
        f.rotation.y = Math.floor(rng.next() * 4) * Math.PI / 2; // 确定性朝向
        W.reg(group, f);
        if (item) {
          BR.addFurniturePickup(W, {
            tx: p.tx, ty: p.ty, item, suffix: 'furn' + i,
            group, fx, fz, topY: kind === 'cabinet' ? 1.54 : 0.78,
            container: kind, furniture: f
          });
        }
      });
    });
    buildThinWalls(map, W);
    W.objective = '穿过那条异常长的走廊前往 Level 2（注意天花板上的动静）';
  };

  BR.Levels.L1.onEnter = function () {
    BR.UI.setObjective(BR.World.objective);
    BR.Audio.setAmbient('L1');
  };

  BR.Levels.L1.tick = function (dt) {
    const W = BR.World, P = BR.Player;
    if (!P || BR.Game.state !== 'playing') return;
    thinWallTick(dt);
    // 随机闪烁风暴：保证玩家一定能看到灯闪
    W._stormT = (W._stormT == null ? 18 + Math.random() * 22 : W._stormT) - dt;
    if (W._stormT <= 0) {
      W._stormT = 32 + Math.random() * 30;
      W.flickerStorm = { x: P.pos.x, z: P.pos.z, r: 15, t: 4.5 };
      BR.Audio.flickerBuzz();
      P.drainSanity(4);
      if (!W._stormTold) { W._stormTold = true; BR.UI.toast('头顶的灯开始疯狂闪烁——'); }
    }
    // 安全屋提示
    (W._safeRooms || []).forEach(s => {
      if (!s.told && Math.hypot(P.pos.x - s.x, P.pos.z - s.z) < 6) {
        s.told = true;
        BR.UI.toast('这里有前人留下的痕迹，感觉安全一些');
        BR.Audio.checkpoint();
      }
    });
    // 出口走廊提示
    if (W._exitCorr && !W._exitCorrTold && Math.hypot(P.pos.x - W._exitCorr.x, P.pos.z - W._exitCorr.z) < 7) {
      W._exitCorrTold = true;
      BR.UI.toast('这条走廊……看起来比别的更长');
    }
    // 闪烁事件
    (W._blackouts || []).forEach(b => {
      b.cd = Math.max(0, b.cd - dt);
      const inside = Math.hypot(P.pos.x - b.x, P.pos.z - b.z) < b.r;
      if (inside && b.cd <= 0 && !W.blackout) {
        b.cd = 40;
        W.setBlackout(true);
        BR.Audio.blackoutStart();
        BR.UI.toast('灯光开始剧烈闪烁——蹲下，贴墙，不要跑！');
        BR.bus.emit('blackout:start');
        setTimeout(() => {
          W.setBlackout(false);
          BR.Audio.blackoutEnd();
        }, 9000);
      }
    });
    // 天花板破洞的音乐
    if (W._funHole) {
      W._partyT = (W._partyT || 0) - dt;
      const d = Math.hypot(P.pos.x - W._funHole.x, P.pos.z - W._funHole.z);
      if (d < 14 && W._partyT <= 0) {
        W._partyT = 18;
        BR.Audio.partyStart();
      }
    }
  };
})();

  /* ================= L2 ================= */
  (function () {
    const BR = window.BR, T = BR.TILE;
    function poiList(map, type) { return (map.pois || []).filter(p => p.type === type); }
    function wallNormal(W, tx, ty) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of dirs) if (W.isWall(tx + dx, ty + dy)) return { x: -dx, z: -dy };
      return { x: 0, z: 1 };
    }

    BR.Levels.L2.buildContent = function (map, W) {
      // 门（含上锁/虚空/出口）
      for (const d of map.doors) {
        const def = { id: d.id, tx: d.tx, ty: d.ty, axis: d.axis, locked: d.locked, label: d.label };
        if (d.label === '虚空之门') {
          def.solidWhenOpen = true;
          def.prompt = () => W.doors[d.id].open ? '关上虚空之门' : '推开虚空之门';
          def.use = (dd) => {
            W.setDoor(d.id, !dd.open);
            if (dd.open) { BR.UI.toast('门后只有翻涌的黑暗。你决定还是关上它。'); BR.Audio.glitch(); }
          };
        } else if (d.exitTo === 'L3') {
          def.prompt = () => '推开这扇没上锁的门';
          def.use = () => {
            W.setDoor(d.id, true);
            // 门缝下透出微光 + 刻痕
            setTimeout(() => { if (BR.Game.state === 'playing') BR.Trans.play('gate'); }, 800);
          };
        }
        W.addDoor(def);
      }
      // 出口门加刻痕标记
      poiList(map, 'exit_door').forEach(p => {
        W.addChunkContent(p.tx, p.ty, (group) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
            new THREE.MeshBasicMaterial({ map: BR.Textures.get('stain'), transparent: true, opacity: 0.8, color: 0xcccccc }));
          const fx = BR.tileCX(p.data.fx != null ? p.data.fx : p.tx), fz = BR.tileCZ(p.data.fy != null ? p.data.fy : p.ty);
          m.position.set(fx, 1.5, fz);
          m.rotation.y = Math.atan2(BR.tileCX(p.tx) - fx, BR.tileCZ(p.ty) - fz);
          W.reg(group, m);
          const L = new THREE.PointLight(0xfff2cc, 0.8, 8, 2);
          L.position.set(fx, 0.25, fz);
          W.reg(group, L);
        });
      });
      // 蒸汽
      poiList(map, 'steam').forEach((p, si) => {
        const dx = p.data.dirx != null ? p.data.dirx : 0, dz = p.data.dirz != null ? p.data.dirz : 1, len = p.data.len || 4;
        for (let k = 0; k < len; k += 2) {
          W.addSteamVent('s' + si + '_' + k, p.tx + dx * k, p.ty + dz * k, dx, dz, 2);
        }
      });
      // 阀门
      poiList(map, 'valve').forEach(p => {
        W.addChunkContent(p.tx, p.ty, (group) => {
          const n = wallNormal(W, p.tx, p.ty);
          const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 18), W.mat('metal'));
          wheel.position.set(BR.tileCX(p.tx) + n.x * 1.25, 1.4, BR.tileCZ(p.ty) + n.z * 1.25);
          W.reg(group, wheel);
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), W.mat('metal'));
          stem.rotation.x = Math.PI / 2; stem.rotation.z = Math.PI / 2;
          stem.position.copy(wheel.position); stem.position.y -= 0.1;
          W.reg(group, stem);
          const id = 'valve_' + p.tx + '_' + p.ty;
          W.addInteractable({
            id, kind: 'valve', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [wheel], pos: wheel.position.clone(), radius: 2.4,
            prompt: () => '拧紧阀门（关闭附近蒸汽）',
            canUse: () => true,
            use: () => {
              BR.Audio.valve();
              wheel.rotation.z += 2.2;
              let n2 = 0;
              W._steamTimers = W._steamTimers || {};
              for (const v of W.steamVents) {
                if (Math.hypot(v.x - wheel.position.x, v.z - wheel.position.z) < 16) {
                  W.setSteam(v.id, false);
                  W._steamTimers[v.id] = 60;
                  n2++;
                }
              }
              BR.UI.toast(n2 ? '蒸汽暂时停了（约 60 秒），快过去！' : '附近没有蒸汽泄漏');
            }
          });
        });
      });
      // 管线装饰：沿墙随机管道
      W.addChunkContent(map.rooms[0].cx | 0, map.rooms[0].cy | 0, () => {});
      // 板条箱 / 笔记
      // 板条箱：两段式（先开盖，再瞄准箱内物资拾取），与 L0/L1 的 addCrate 共用接线
      const crate = (pp) => {
        const id = 'crate_' + pp.tx + '_' + pp.ty;
        W.addChunkContent(pp.tx, pp.ty, (group) => {
          const cm = BR.buildCrateMesh(W);
          cm.group.position.set(BR.tileCX(pp.tx), 0, BR.tileCZ(pp.ty));
          W.reg(group, cm.group);
          BR.wireCrateTwoStage(W, group, cm, {
            id, tx: pp.tx, ty: pp.ty, item: (pp.data && pp.data.item) || 'empty'
          });
        });
      };
      poiList(map, 'crate').forEach(crate);
      // 迁跃浆果灌木（gen.js 极低概率放置）
      poiList(map, 'berry_bush').forEach(p => BR.addBerryBush(W, p));
      const L2_NOTES = [
        ['油污的字条', '阀门只能关住蒸汽一会儿。想过去就快跑，或者贴着边蹭过去。\n\n别在里面待着，会烫伤。'],
        ['刻在墙上的字', '门缝下有光的那扇是真的。\n其他上锁的别白费力气。\n\n——前人']
      ];
      poiList(map, 'note').forEach((p, i) => {
        const nn = L2_NOTES[i % L2_NOTES.length];
        addNoteShared(W, p.tx, p.ty, nn[0], nn[1]);
      });
      W.objective = '找到那扇没上锁的门，前往 Level 3（小心蒸汽和管道阴影）';
      BR.buildThinWalls(map, W);
    };

    function addNoteShared(W, tx, ty, title, body) {
      const id = 'note_' + W.map.level + '_' + tx + '_' + ty;
      W.addChunkContent(tx, ty, (group) => {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        let n = { x: 0, z: 1 };
        for (const [dx, dy] of dirs) if (W.isWall(tx + dx, ty + dy)) { n = { x: -dx, z: -dy }; break; }
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
          new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
        m.position.set(BR.tileCX(tx) + n.x * 1.1, 1.5, BR.tileCZ(ty) + n.z * 1.1);
        m.rotation.y = Math.atan2(n.x, n.z);
        W.reg(group, m);
        W.addInteractable({
          id, kind: 'note', chunkKey: W.chunkKeyOf(tx, ty),
          meshes: [m], pos: m.position.clone(), radius: 2.4,
          prompt: () => '阅读字条', canUse: () => true,
          use: () => {
            BR.Audio.paper(); BR.UI.showNote(title, body);
            if (!W.state.picked.includes(id)) { W.state.picked.push(id); BR.bus.emit('picked', { id }); }
          }
        });
      });
    }

    BR.Levels.L2.onEnter = function () {
      BR.UI.setObjective(BR.World.objective);
      BR.Audio.setAmbient('L2');
      BR.UI.toast('空气里有铁锈和热气的味道');
    };
    BR.Levels.L2.tick = function (dt) {
      const W = BR.World;
      BR.thinWallTick(dt);
      if (W._steamTimers) {
        for (const id in W._steamTimers) {
          W._steamTimers[id] -= dt;
          if (W._steamTimers[id] <= 0) {
            delete W._steamTimers[id];
            for (const v of W.steamVents) if (v.id === id && !v.on) {
              v.on = true; v.points.visible = true;
              BR.Audio.addLoop('steam_' + id, 'steam', v.x, v.z, 0.5);
              BR.UI.toast('远处传来阀门松开的声音，蒸汽又冒出来了');
            }
          }
        }
      }
    };
  })();

  /* ================= L3 ================= */
  (function () {
    const BR = window.BR, T = BR.TILE;
    function poiList(map, type) { return (map.pois || []).filter(p => p.type === type); }
    function addNoteShared(W, tx, ty, title, body) {
      const id = 'note_' + W.map.level + '_' + tx + '_' + ty;
      W.addChunkContent(tx, ty, (group) => {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        let n = { x: 0, z: 1 };
        for (const [dx, dy] of dirs) if (W.isWall(tx + dx, ty + dy)) { n = { x: -dx, z: -dy }; break; }
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
          new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
        m.position.set(BR.tileCX(tx) + n.x * 1.1, 1.5, BR.tileCZ(ty) + n.z * 1.1);
        m.rotation.y = Math.atan2(n.x, n.z);
        W.reg(group, m);
        W.addInteractable({
          id, kind: 'note', chunkKey: W.chunkKeyOf(tx, ty),
          meshes: [m], pos: m.position.clone(), radius: 2.4,
          prompt: () => '阅读字条', canUse: () => true,
          use: () => {
            BR.Audio.paper(); BR.UI.showNote(title, body);
            if (!W.state.picked.includes(id)) { W.state.picked.push(id); BR.bus.emit('picked', { id }); }
          }
        });
      });
    }

    BR.Levels.L3.buildContent = function (map, W) {
      // 电梯
      poiList(map, 'elevator').forEach(p => {
        const dx = p.data.dirx != null ? p.data.dirx : 0, dz = p.data.dirz != null ? p.data.dirz : 1;
        const wx = p.tx + dx, wz = p.ty + dz;
        W.skipWall(wx, wz);
        W.addChunkContent(p.tx, p.ty, (group) => {
          const wallH = W.theme.wallH;
          const cx = BR.tileCX(wx), cz = BR.tileCZ(wz);
          const frame = new THREE.Group();
          frame.position.set(cx, 0, cz);
          frame.rotation.y = Math.atan2(-dx, -dz);
          const metal = W.mat('doorMetal');
          const p1 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 0.14), metal);
          p1.position.set(-0.56, 1.3, 0); frame.add(p1);
          const p2 = p1.clone(); p2.position.x = 0.56; frame.add(p2);
          const top = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.35, 0.5), metal);
          top.position.set(0, 2.78, 0); frame.add(top);
          const side1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.95, 0.5), metal);
          side1.position.set(-1.28, 1.47, 0); frame.add(side1);
          const side2 = side1.clone(); side2.position.x = 1.28; frame.add(side2);
          // 楼层指示灯
          const ind = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3),
            new THREE.MeshBasicMaterial({ color: 0x402010 }));
          ind.position.set(0, 3.05, 0.26); frame.add(ind);
          W.reg(group, frame);
          W.elevator = { panels: [p1, p2], ind };
          // 按钮（电梯左侧墙上）
          const bx = BR.tileCX(p.tx) + dx * 0.6 - dz * 1.6;
          const bz = BR.tileCZ(p.ty) + dz * 0.6 + dx * 1.6;
          const btn = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.12),
            new THREE.MeshLambertMaterial({ color: 0x8a8f96 }));
          btn.position.set(bx, 1.45, bz);
          const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10),
            new THREE.MeshBasicMaterial({ color: 0xff4030 }));
          dot.rotation.x = Math.PI / 2;
          dot.position.set(bx, 1.45, bz + (dz !== 0 ? 0.07 : 0));
          dot.position.x = bx + (dx !== 0 ? 0.07 : 0);
          W.reg(group, btn); W.reg(group, dot);
          W.addInteractable({
            id: 'elevator_btn', kind: 'elevator', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [btn, dot], pos: btn.position.clone(), radius: 2.6,
            prompt: () => '按下电梯按钮',
            canUse: () => true,
            use: () => {
              const g = BR.Game.flags.gens;
              if (g >= 3) { BR.Audio.elevatorDing(); BR.Trans.play('elevator'); }
              else {
                BR.Audio.doorLocked();
                BR.UI.toast('电梯没有电。先启动全部 3 台发电机（' + g + '/3）');
              }
            }
          });
        });
      });
      // 发电机（电力房及周边 3 台）
      // 放置修复：候选位若不是地板则向外环形搜索补足，保证 3 台必能放出（之前部分种子只放出 2 台导致无解）
      poiList(map, 'power_room').forEach(p => {
        const spots = [];
        const seenK = {};
        const tryAdd = (sx, sy) => {
          const k = sx + ',' + sy;
          if (seenK[k]) return;
          seenK[k] = 1;
          if (W.tile(sx, sy) !== 1) return;
          for (const s of spots) if (Math.abs(s[0] - sx) + Math.abs(s[1] - sy) < 2) return;
          spots.push([sx, sy]);
        };
        [[p.tx, p.ty], [p.tx + 2, p.ty], [p.tx - 2, p.ty], [p.tx, p.ty + 2]].forEach(([sx, sy]) => tryAdd(sx, sy));
        for (let rad = 1; rad <= 6 && spots.length < 3; rad++)
          for (let dx = -rad; dx <= rad && spots.length < 3; dx++)
            for (let dy = -rad; dy <= rad && spots.length < 3; dy++) {
              if (Math.abs(dx) + Math.abs(dy) !== rad) continue;
              tryAdd(p.tx + dx, p.ty + dy);
            }
        let n = 0;
        for (const [sx, sy] of spots.slice(0, 3)) {
          const i = n++;
          const id = 'gen_' + i;
          W.addChunkContent(sx, sy, (group) => {
            const g = new THREE.Group();
            g.position.set(BR.tileCX(sx), 0, BR.tileCZ(sy));
            g.rotation.y = i * 1.05;
            const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.7, 0.75), W.mat('metal'));
            body.position.y = 0.85; g.add(body);
            const on = W.state.events.includes('gen_' + id);
            const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.42),
              new THREE.MeshBasicMaterial({ color: on ? 0x20ff40 : 0xff3020 }));
            screen.position.set(0, 1.32, 0.39); g.add(screen);
            const hum = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.5), W.mat('pipe'));
            hum.position.y = 0.25; g.add(hum);
            W.reg(group, g);
            BR.Audio.addLoop('gen_' + id, 'machine', g.position.x, g.position.z, on ? 0.5 : 0.12);
            W.addInteractable({
              id: 'genbtn_' + id, kind: 'generator', chunkKey: W.chunkKeyOf(sx, sy),
              meshes: [body], pos: g.position.clone().add(new THREE.Vector3(0, 1.3, 0)), radius: 2.8,
              prompt: () => W.state.events.includes('gen_' + id) ? '发电机（运行中）' : '启动发电机',
              canUse: () => !W.state.events.includes('gen_' + id),
              use: () => {
                W.state.events.push('gen_' + id);
                BR.Game.flags.gens++;
                screen.material.color.setHex(0x20ff40);
                BR.Audio.checkpoint();
                BR.Audio.removeLoop('gen_' + id);
                BR.Audio.addLoop('gen_' + id, 'machine', g.position.x, g.position.z, 0.5);
                BR.bus.emit('event', { id: 'gen_' + id });
                if (BR.Game.flags.gens >= 3) {
                  BR.UI.toast('电力恢复了！电梯应该能用了');
                  BR.Audio.elevatorDing();
                } else BR.UI.toast('发电机启动（' + BR.Game.flags.gens + '/3）');
              }
            });
          });
        }
      });
      // 栅栏区
      poiList(map, 'fence_zone').forEach(p => {
        W.addChunkContent(p.tx, p.ty, (group) => {
          for (let a = 0; a < 8; a++) {
            const ang = a / 8 * Math.PI * 2;
            const f = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.3),
              new THREE.MeshBasicMaterial({ map: BR.Textures.get('rustFence'), transparent: true, side: THREE.DoubleSide }));
            f.position.set(BR.tileCX(p.tx) + Math.cos(ang) * 4.2, 1.15, BR.tileCZ(p.ty) + Math.sin(ang) * 4.2);
            f.rotation.y = -ang + Math.PI / 2;
            W.reg(group, f);
          }
        });
      });
      // 板条箱：两段式（先开盖，再瞄准箱内物资拾取），与 L0/L1 的 addCrate 共用接线
      poiList(map, 'crate').forEach(pp => {
        const id = 'crate_' + pp.tx + '_' + pp.ty;
        W.addChunkContent(pp.tx, pp.ty, (group) => {
          const cm = BR.buildCrateMesh(W);
          cm.group.position.set(BR.tileCX(pp.tx), 0, BR.tileCZ(pp.ty));
          W.reg(group, cm.group);
          BR.wireCrateTwoStage(W, group, cm, {
            id, tx: pp.tx, ty: pp.ty, item: (pp.data && pp.data.item) || 'empty'
          });
        });
      });
      // 迁跃浆果灌木（gen.js 极低概率放置）
      poiList(map, 'berry_bush').forEach(p => BR.addBerryBush(W, p));
      const L3_NOTES = [
        ['工程师日志', '三台发电机必须全开，电梯才有电。\n\n别一台一台试——全开。\n\n还有：跑起来之前，先想好往哪儿跑。'],
        ['血字', '它听得见。\n\n别出声。']
      ];
      poiList(map, 'note').forEach((p, i) => {
        const nn = L3_NOTES[i % L3_NOTES.length];
        addNoteShared(W, p.tx, p.ty, nn[0], nn[1]);
      });
      W.objective = '启动 3 台发电机，然后乘坐电梯离开';
      BR.buildThinWalls(map, W);
    };

    BR.Levels.L3.onEnter = function () {
      BR.UI.setObjective(BR.World.objective);
      BR.Audio.setAmbient('L3');
      BR.UI.toast('远处传来发电机的轰鸣，还有……别的声音');
    };
    BR.Levels.L3.tick = function (dt) {
      BR.thinWallTick(dt);
    };
  })();

  /* ================= FUN ================= */
  (function () {
    const BR = window.BR, T = BR.TILE;
    function poiList(map, type) { return (map.pois || []).filter(p => p.type === type); }

    BR.Levels.FUN.buildContent = function (map, W) {
      // 员工通道门
      for (const d of map.doors) {
        const def = { id: d.id, tx: d.tx, ty: d.ty, axis: d.axis, locked: false, label: d.label };
        def.prompt = () => BR.Game.flags.clues >= 2 ? '推开员工通道的门' : '🔒 员工通道（锁住了）';
        def.use = () => {
          const c = BR.Game.flags.clues;
          if (c >= 2) {
            W.setDoor(d.id, true);
            setTimeout(() => { if (BR.Game.state === 'playing') BR.Trans.play('fun_escape'); }, 800);
          } else {
            BR.Audio.doorLocked();
            BR.UI.toast('门纹丝不动。派对里一定藏着离开的线索……（' + c + '/2）');
          }
        };
        W.addDoor(def);
      }
      // 线索字条
      const CLUES = [
        ['藏在气球里的字条', '他们说这里没有出口。=)\n\n但清洁工说：员工通道的锁，认得"清醒"的人。\n再找一条线索，门就会认你。'],
        ['蛋糕底下的字条', '数过了吗？气球有 13 个。\n\n派对永远不会结束……除非你还记得自己是谁。\n\n带着两条线索，去找那扇不起眼的门。'],
        ['镜子上的口红字', '笑一个 =)\n\n你已经很接近了。']
      ];
      poiList(map, 'clue').forEach((p, i) => {
        const cc = CLUES[i % CLUES.length];
        const id = 'clue_' + W.map.level + '_' + p.data.clueId;
        W.addChunkContent(p.tx, p.ty, (group) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
            new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
          const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          let n = { x: 0, z: 1 };
          for (const [dx, dy] of dirs) if (W.isWall(p.tx + dx, p.ty + dy)) { n = { x: -dx, z: -dy }; break; }
          m.position.set(BR.tileCX(p.tx) + n.x * 1.1, 1.5, BR.tileCZ(p.ty) + n.z * 1.1);
          m.rotation.y = Math.atan2(n.x, n.z);
          W.reg(group, m);
          W.addInteractable({
            id, kind: 'clue', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [m], pos: m.position.clone(), radius: 2.4,
            prompt: () => '阅读字条',
            canUse: () => true,
            use: () => {
              BR.Audio.paper();
              BR.UI.showNote(cc[0], cc[1]);
              if (!W.state.events.includes('clue_' + id)) {
                W.state.events.push('clue_' + id);
                BR.Game.flags.clues++;
                BR.UI.toast('你记下了一条离开的线索（' + BR.Game.flags.clues + '/2）');
                BR.bus.emit('event', { id: 'clue_' + id });
              }
            }
          });
        });
      });
      // 改编声明字条（出生点）
      poiList(map, 'spawn').forEach(p => {
        const id = 'note_fun_meta';
        W.addChunkContent(p.tx + 1, p.ty, (group) => {
          if (W.tile(p.tx + 1, p.ty) !== 1) return;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
            new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
          m.position.set(BR.tileCX(p.tx + 1), 1.5, BR.tileCZ(p.ty));
          m.rotation.y = Math.PI;
          W.reg(group, m);
          W.addInteractable({
            id, kind: 'note', chunkKey: W.chunkKeyOf(p.tx + 1, p.ty),
            meshes: [m], pos: m.position.clone(), radius: 2.4,
            prompt: () => '阅读褪色的入场券', canUse: () => true,
            use: () => {
              BR.Audio.paper();
              BR.UI.showNote('褪色的入场券',
                '（游戏改编说明）\n\n按后室原作设定，Level Fun 没有可靠的出口。\n本作中可凭两条线索离开的"员工通道"，为游戏性改编，并非原作事实。\n\n——开发组');
              if (!W.state.picked.includes(id)) { W.state.picked.push(id); BR.bus.emit('picked', { id }); }
            }
          });
        });
      });
      // 蛋糕桌
      poiList(map, 'cake_table').forEach(p => {
        W.addChunkContent(p.tx, p.ty, (group) => {
          const g = new THREE.Group();
          const x = BR.tileCX(p.tx), z = BR.tileCZ(p.ty);
          g.position.set(x, 0, z);
          const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 1.1),
            new THREE.MeshLambertMaterial({ color: 0xf0e8f0 }));
          top.position.y = 0.78; g.add(top);
          [[-0.8, -0.45], [0.8, -0.45], [-0.8, 0.45], [0.8, 0.45]].forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.78, 0.09),
              new THREE.MeshLambertMaterial({ color: 0x8a7a8a }));
            leg.position.set(lx, 0.39, lz); g.add(leg);
          });
          const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.26, 16),
            new THREE.MeshLambertMaterial({ color: 0xfff0f5 }));
          cake.position.y = 0.96; g.add(cake);
          const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8),
            new THREE.MeshBasicMaterial({ color: 0xffd0e0 }));
          candle.position.y = 1.15; g.add(candle);
          W.reg(group, g);
          // 气球
          const rng = new BR.RNG(BR.hashSeed('balloon' + p.tx + p.ty));
          const cols = [0xff5060, 0x50a0ff, 0xffd050, 0x60e080, 0xc080ff];
          for (let i = 0; i < 6; i++) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10),
              new THREE.MeshLambertMaterial({ color: cols[i % cols.length] }));
            const a = rng.next() * 6.28, r = 1.6 + rng.next() * 1.6;
            b.position.set(x + Math.cos(a) * r, 2.2 + rng.next() * 0.8, z + Math.sin(a) * r);
            W.reg(group, b);
            const str = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.4, 4),
              new THREE.MeshBasicMaterial({ color: 0x888888 }));
            str.position.set(b.position.x, b.position.y - 0.9, b.position.z);
            W.reg(group, str);
          }
        });
      });
      // 派对海报（随机贴几张）
      (function () {
        const rng = new BR.RNG(BR.hashSeed('posters' + map.seed));
        const rooms = (map.rooms || []).slice(1, 6);
        rooms.forEach(r => {
          for (let i = 0; i < 2; i++) {
            const tx = Math.round(r.cx) + rng.int(-2, 2), ty = Math.round(r.cy) + rng.int(-2, 2);
            if (W.tile(tx, ty) !== 1) return;
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            let n = null;
            for (const [dx, dy] of dirs) if (W.isWall(tx + dx, ty + dy)) { n = { x: -dx, z: -dy }; break; }
            if (!n) return;
            W.addChunkContent(tx, ty, (group) => {
              const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4),
                new THREE.MeshBasicMaterial({ map: BR.Textures.get('posterFun') }));
              m.position.set(BR.tileCX(tx) + n.x * (T / 2 - 0.04), 1.7, BR.tileCZ(ty) + n.z * (T / 2 - 0.04));
              m.rotation.y = Math.atan2(n.x, n.z);
              W.reg(group, m);
            });
          }
        });
      })();
      // ===== Systems A：七色滑梯区（本游戏原创机制，追加）=====
      // LORE：后室原作中 Level Fun 没有滑梯出口；七色滑梯为本游戏原创的固定映射出口机制。
      // 映射（写死常量，见 BR.Cutout.SLIDE_MAP）：红→L0 / 橙→L37 / 黄→L11 / 绿→L1 /
      //   青→L7 / 蓝→L94(夜间抵达，危险) / 紫→L188。游戏内用海报/字条/痕迹留线索。
      (function buildSlideRoom() {
        const spawnR = map.rooms[0];
        const dist = r => Math.hypot(r.cx - spawnR.cx, r.cy - spawnR.cy);
        // 派对区深处：离出生点最远的 3 个房间里取最大的
        const cands = map.rooms.slice(1).sort((a, b) => dist(b) - dist(a)).slice(0, 3)
          .sort((a, b) => (b.w * b.h) - (a.w * a.h));
        const room = cands[0] || map.rooms[1] || map.rooms[0];
        const rx0 = room.x * T, rz0 = room.y * T, wM = room.w * T, hM = room.h * T;
        const ctx = Math.round(room.cx), cty = Math.round(room.cy);

        const defs = [
          { color: 'red',    c: 0xd8342c, shape: 'straight', hTop: 2.0, len: 5.2, w: 1.1 },
          { color: 'orange', c: 0xe8862a, shape: 'wavy',     hTop: 1.6, len: 5.2, w: 1.1 },
          { color: 'yellow', c: 0xe8c52a, shape: 'curved',   hTop: 1.8, len: 5.6, w: 1.0 },
          { color: 'green',  c: 0x3aa655, shape: 'wide',     hTop: 1.5, len: 5.0, w: 1.7 },
          { color: 'cyan',   c: 0x2aa8b8, shape: 'tube',     hTop: 1.9, len: 5.4, w: 1.2 },
          { color: 'blue',   c: 0x2a5ad8, shape: 'tall',     hTop: 2.6, len: 6.5, w: 1.0 },
          { color: 'purple', c: 0x8a3ad8, shape: 'bumpy',    hTop: 1.8, len: 5.2, w: 0.9 }
        ];
        // 每条滑梯不同的进入音效
        const SLIDE_SND = {
          red: () => BR.Audio.dropRumble(1.0),
          orange: () => BR.Audio.splash(),
          yellow: () => BR.Audio.paper(),
          green: () => BR.Audio.checkpoint(),
          cyan: () => BR.Audio.splash(),
          blue: () => BR.Audio.flickerBuzz(),
          purple: () => BR.Audio.glitch()
        };
        const perRow = (wM >= 19) ? 7 : 4;
        const rows = Math.ceil(defs.length / perRow);
        const spacing = Math.min(2.6, (wM - 3) / perRow);
        const rowDepth = (hM - 4.5) / rows;

        function textTex(lines, fg, bg) {
          const cv = document.createElement('canvas');
          cv.width = 256; cv.height = 160;
          const c2 = cv.getContext('2d');
          c2.fillStyle = bg || '#20242a'; c2.fillRect(0, 0, 256, 160);
          c2.fillStyle = fg || '#e8e2d2';
          c2.textAlign = 'center'; c2.textBaseline = 'middle';
          lines.forEach((ln, i) => {
            c2.font = (ln.big ? 'bold 44px' : '24px') + ' sans-serif';
            c2.fillText(ln.t, 128, 50 + i * 52);
          });
          return new THREE.CanvasTexture(cv);
        }
        // 滑道段：从 (z0,y0) 到 (z1,y1) 的斜面板
        function chuteSeg(parent, sx, z0, y0, z1, y1, w, mat, yaw) {
          const dz = z1 - z0, len = Math.hypot(dz, y1 - y0);
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, len + 0.15), mat);
          m.position.set(sx, (y0 + y1) / 2, (z0 + z1) / 2);
          m.rotation.x = Math.atan2(y0 - y1, dz);
          if (yaw) m.rotation.y = yaw;
          parent.add(m);
          return m;
        }
        function rails(parent, sx, z0, y0, z1, y1, w, mat, h, tilt) {
          [-1, 1].forEach(s => {
            const dz = z1 - z0, len = Math.hypot(dz, y1 - y0);
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, h || 0.35, len), mat);
            m.position.set(sx + s * (w / 2), (y0 + y1) / 2 + (h || 0.35) / 2, (z0 + z1) / 2);
            m.rotation.x = Math.atan2(y0 - y1, dz);
            if (tilt) m.rotation.z = -s * tilt;
            parent.add(m);
          });
        }

        W.addChunkContent(ctx, cty, (group) => {
          const g = new THREE.Group();
          W.reg(group, g);
          const built = []; // 供交互射线用
          defs.forEach((def, idx) => {
            const row = Math.floor(idx / perRow), col = idx % perRow;
            const n = Math.min(perRow, defs.length - row * perRow);
            const sx = rx0 + (wM - (n - 1) * spacing) / 2 + col * spacing;
            const zTop = rz0 + 2.2 + row * rowDepth;
            const len = Math.min(def.len, rowDepth - 2.2);
            const zBot = zTop + len;
            const mat = new THREE.MeshLambertMaterial({ color: def.c });
            const dark = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
            // 入口平台
            const plat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 1.5), dark);
            plat.position.set(sx, def.hTop - 0.12, zTop - 0.9);
            g.add(plat); built.push(plat);
            // 滑道（按形状）
            const yB = 0.35;
            if (def.shape === 'straight' || def.shape === 'wide' || def.shape === 'tall') {
              chuteSeg(g, sx, zTop, def.hTop, zBot, yB, def.w, mat);
              rails(g, sx, zTop, def.hTop, zBot, yB, def.w, mat);
            } else if (def.shape === 'wavy') {
              const segs = 3;
              for (let i = 0; i < segs; i++) {
                const zz0 = zTop + len * i / segs, zz1 = zTop + len * (i + 1) / segs;
                const yy0 = def.hTop + (yB - def.hTop) * i / segs, yy1 = def.hTop + (yB - def.hTop) * (i + 1) / segs;
                const xo = Math.sin(i * 1.2) * 0.35;
                chuteSeg(g, sx + xo, zz0, yy0, zz1, yy1, def.w, mat, (i % 2 ? -1 : 1) * 0.22);
              }
            } else if (def.shape === 'curved') {
              const segs = 4;
              let px = sx, pz = zTop, py = def.hTop, yaw = 0;
              for (let i = 0; i < segs; i++) {
                yaw += 0.24;
                const sl = len / segs;
                const nx = px + Math.sin(yaw) * sl, nz = pz + Math.cos(yaw) * sl;
                const ny = def.hTop + (yB - def.hTop) * (i + 1) / segs;
                const m = chuteSeg(g, (px + nx) / 2, pz, py, nz, ny, def.w, mat);
                m.rotation.y = yaw * 0.5;
                px = nx; pz = nz; py = ny;
              }
            } else if (def.shape === 'tube') {
              // U 形槽：底板 + 外张侧壁，近似管道滑梯
              chuteSeg(g, sx, zTop, def.hTop, zBot, yB, def.w, mat);
              rails(g, sx, zTop, def.hTop, zBot, yB, def.w, mat, 0.55, 0.35);
            } else { // bumpy
              const segs = 4;
              for (let i = 0; i < segs; i++) {
                const zz0 = zTop + len * i / segs, zz1 = zTop + len * (i + 1) / segs;
                let yy0 = def.hTop + (yB - def.hTop) * i / segs, yy1 = def.hTop + (yB - def.hTop) * (i + 1) / segs;
                if (i % 2 === 1) { yy0 += 0.1; yy1 += 0.1; }
                chuteSeg(g, sx, zz0, yy0, zz1, yy1, def.w, mat);
              }
              rails(g, sx, zTop, def.hTop, zBot, yB, def.w, mat);
            }
            // 入口彩色光带（黑暗中辨认颜色）
            const strip = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1),
              new THREE.MeshBasicMaterial({ color: def.c }));
            strip.position.set(sx, def.hTop + 0.9, zTop - 0.9);
            g.add(strip);
            // —— 线索（按 §2 映射表）——
            const cxHint = sx + 1.15;
            const hintY = 1.4;
            if (def.color === 'red') {
              // 褪色海报"回家"
              const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.25),
                new THREE.MeshBasicMaterial({ map: textTex([{ t: '回', big: true }, { t: '家', big: true }], '#c8b89a', '#3a3230'), transparent: true, opacity: 0.9 }));
              pm.position.set(cxHint, hintY, zTop - 0.9); pm.rotation.y = -Math.PI / 2;
              g.add(pm);
            } else if (def.color === 'orange') {
              // 梯口水渍
              const st = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3),
                new THREE.MeshBasicMaterial({ color: 0x1a3a55, transparent: true, opacity: 0.55 }));
              st.rotation.x = -Math.PI / 2; st.position.set(cxHint, 0.03, zTop - 0.4);
              g.add(st);
            } else if (def.color === 'yellow') {
              // 城市明信片（可读）
              const pc = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.38),
                new THREE.MeshBasicMaterial({ map: textTex([{ t: '11' }], '#d8b13a', '#2a3a5a') }));
              pc.position.set(cxHint, hintY, zTop - 0.9); pc.rotation.y = -Math.PI / 2;
              g.add(pc); built.push(pc);
              addSlideNote('slide_pc', cxHint, zTop - 0.9, pc, '城市明信片',
                '高楼、街道、电车……\n\n背面潦草地写着：11');
            } else if (def.color === 'green') {
              // 绿色荧光标记
              const mk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12),
                new THREE.MeshBasicMaterial({ color: 0x39ff6a }));
              mk.position.set(cxHint, hintY, zTop - 0.9);
              g.add(mk);
            } else if (def.color === 'cyan') {
              // 咸腥水渍 + 贝壳
              const st = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3),
                new THREE.MeshBasicMaterial({ color: 0x1a4a4a, transparent: true, opacity: 0.55 }));
              st.rotation.x = -Math.PI / 2; st.position.set(cxHint, 0.03, zTop - 0.4);
              g.add(st);
              for (let i = 0; i < 3; i++) {
                const sh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
                  new THREE.MeshLambertMaterial({ color: 0xe8e0d0 }));
                sh.scale.y = 0.5;
                sh.position.set(cxHint + (i - 1) * 0.25, 0.05, zTop + 0.15);
                g.add(sh);
              }
            } else if (def.color === 'blue') {
              // 星空贴纸 + 警告字条（夜间危险落点）
              const cv = document.createElement('canvas');
              cv.width = 128; cv.height = 128;
              const c2 = cv.getContext('2d');
              c2.fillStyle = '#0a1030'; c2.fillRect(0, 0, 128, 128);
              c2.fillStyle = '#fff';
              const srng = new BR.RNG(BR.hashSeed('stars' + sx));
              for (let i = 0; i < 40; i++) c2.fillRect(srng.next() * 128, srng.next() * 128, 2, 2);
              const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8),
                new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
              sp.position.set(cxHint, hintY, zTop - 0.9); sp.rotation.y = -Math.PI / 2;
              g.add(sp); built.push(sp);
              addSlideNote('slide_blue_warn', cxHint, zTop - 0.2, sp, '警告字条',
                '这条滑梯通向夜晚。\n\n做好准备再滑。');
            } else if (def.color === 'purple') {
              // 窗框碎片
              const fm = new THREE.MeshLambertMaterial({ color: 0x6a5a48 });
              [[-0.3, 0], [0.3, 0]].forEach(([ox]) => {
                const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), fm);
                v.position.set(cxHint + ox, 0.45, zTop - 0.9); g.add(v);
              });
              [[-0.25], [0.25]].forEach(([oy]) => {
                const h = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.08), fm);
                h.position.set(cxHint, 0.45 + oy, zTop - 0.9); g.add(h);
              });
            }
            // —— 滑梯入口交互 ——
            const dest = BR.Cutout.SLIDE_MAP[def.color].to;
            const cname = BR.Cutout.SLIDE_MAP[def.color].name;
            const entry = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
              new THREE.MeshBasicMaterial({ color: def.c, transparent: true, opacity: 0.0, depthWrite: false }));
            entry.position.set(sx + 1.2, 1.4, zTop - 0.9);
            g.add(entry);
            W.addInteractable({
              id: 'slide_' + def.color, kind: 'slide',
              chunkKey: W.chunkKeyOf(ctx, cty),
              meshes: [entry, plat], pos: entry.position.clone(), radius: 3.2,
              prompt: () => '爬上' + cname + '色滑梯',
              canUse: () => !BR.Cutout.busy,
              use: () => {
                if (BR.Cutout.busy) return;
                SLIDE_SND[def.color]();
                BR.UI.toast('你滑进了' + cname + '色滑梯……', 1500);
                BR.Cutout.travel(dest, { kind: 'slide' });
              }
            });
          });
          // 说明书（房间入口处，原创机制声明）
          const nx0 = rx0 + wM / 2, nz0 = rz0 + 1.2;
          const nm = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
            new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
          nm.position.set(nx0, 1.5, nz0);
          nm.rotation.y = Math.PI;
          g.add(nm);
          W.addInteractable({
            id: 'slide_meta', kind: 'note',
            chunkKey: W.chunkKeyOf(ctx, cty),
            meshes: [nm], pos: nm.position.clone(), radius: 2.4,
            prompt: () => '阅读褪色的说明书', canUse: () => true,
            use: () => {
              BR.Audio.paper();
              BR.UI.showNote('褪色的说明书',
                '（游戏原创机制说明）\n\n七色滑梯，派对区深处的固定出口。\n\n每条滑梯通向一个固定的楼层，颜色就是线索：\n红→家，橙→水，黄→城，绿→宜居，青→深海，蓝→夜晚，紫→窗。\n\n看好再滑。=)\n\n——开发组');
            }
          });
          function addSlideNote(id, hx, hz, mesh, title, body) {
            W.addInteractable({
              id: id, kind: 'note',
              chunkKey: W.chunkKeyOf(ctx, cty),
              meshes: [mesh], pos: new THREE.Vector3(hx, 1.4, hz), radius: 2.4,
              prompt: () => '阅读' + title, canUse: () => true,
              use: () => { BR.Audio.paper(); BR.UI.showNote(title, body); }
            });
          }
        });
      })();
      W.objective = '……留下来陪我们吧 =)';
      BR.buildThinWalls(map, W);
    };

    BR.Levels.FUN.onEnter = function () {
      BR.UI.setObjective(BR.World.objective);
      BR.Audio.setAmbient('FUN');
      BR.Audio.partyStart();
      setTimeout(() => BR.UI.toast('派对客们注意到你了 =)'), 2500);
    };
    BR.Levels.FUN.tick = function (dt) {
      const W = BR.World;
      BR.thinWallTick(dt);
      W._partyT = (W._partyT || 0) - dt;
      if (W._partyT <= 0 && BR.Game.state === 'playing') {
        W._partyT = 26;
        BR.Audio.partyStart();
      }
    };
  })();
