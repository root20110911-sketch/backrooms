/* levels.js —— 五关主题 + 关卡内容搭建（门/道具/事件/目标） */
(function () {
  const BR = window.BR;
  const T = BR.TILE;

  const ITEM_NAME = {
    almond: '杏仁水', bandage: '绷带', flashlight: '手电筒', berry: '迁跃浆果', food: '食物',
    cigarette: '香烟', gum: '口香糖', royal_ration: '皇家口粮', repellent: '笑魇驱散剂',
    firesalt: '火盐', painliquid: '痛液', cashew: '腰果水',
    // W9 新增 9 种（显示名；数值与逻辑在 js/items.js 注册表）
    energy_bar: '能量棒', medkit: '急救包', glowstick: '荧光棒',
    chalk: '标记粉笔', oxygen_tank: '便携氧气瓶', dive_light: '水下照明灯',
    life_vest: '救生衣', dry_bag: '防水物资袋', adrenaline: '肾上腺素',
    // v2.0 P2 新增：深海潜水服
    diving_suit: '深海潜水服'
  };

  /* ================= 通风管固定映射（v2.2 W-exits） =================
   * 用户需求："通风管道可以直接切入固定的层级"。实现为确定性映射：
   * 起点层 → 固定目标层；边框色 = 目标层主题色（全游戏统一），玩家看颜色即知去向。
   * 映射表（文档即契约，另见 LORE.md「通风管」节与各关内的 M.E.G. 管路图字条）：
   *   L0 通风管 → L1（绿色边框）    L1 通风管 → L2（琥珀色边框）    L2 通风管 → L3（蓝色边框）
   * 无条件、无随机：走近看交互提示即显示目的地，钻进去必达。放置为种子确定性
   * （map.seed + ':vent:' + level 派生 RNG），同一种子同位置，可复现、可测试。
   */
  BR.VENT_ROUTES = { L0: 'L1', L1: 'L2', L2: 'L3' };
  BR.VENT_COLORS = { L1: 0x39ff6a, L2: 0xffb347, L3: 0x6ab8ff };
  BR.VENT_COLOR_NAMES = { L1: '绿色', L2: '琥珀色', L3: '蓝色' };

  /* ================= 主题 ================= */
  BR.Levels = {
    L0: {
      name: 'Level 0 ——「教学关卡」',
      theme: {
        // v2.4 W-l0gen：经典后室黄调回调——ambient/sky/light 色相压向病态黄
        // （强度不动，归 W-shadowlight）；灯具加密 4→3（阵列感），flickerRate 显式化
        // 供 W-shadowlight 的坏灯状态机取用（world.js 按 fixture 记 phase/flicker/bright）。
        bg: 0x0a0906, fogNear: 6, fogFar: 40, ambient: 0xc7b169, ambInt: 0.62,
        sky: 0xffedb5, ground: 0x3a3325, light: 0xffdf9a, lightInt: 0.95,
        wallH: 2.7, wall: 'wallpaper', floor: 'carpet', ceil: 'ceiling',
        surface: 'carpet', fixtureEvery: 3, flickerRate: 0.15, hum: 0.5
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
      let n = wallNormal(W, tx, ty);
      let ax = tx, ay = ty; // 锚点地板 tile（缺省 = POI tile；无邻墙兜底时移到墙面旁的地板 tile）
      // v2.5 F6 兜底：POI 四邻无墙时 wallNormal 只给缺省法线、公式无墙可贴（实测
      // L0(38,35)/L1(30,17) 四邻皆地板，字条仍浮空）——按同心环（≤3 格）找最近墙
      // tile 的可用面（该面外侧须为地板），把锚点移到该面旁的地板 tile，之后仍走
      // 下方统一的地板锚点公式。有邻墙时本兜底不触发，行为与公式直改完全一致。
      const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      if (!DIRS4.some(([dx, dy]) => W.isWall(tx + dx, ty + dy))) {
        let best = null;
        for (let r = 1; r <= 3; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const wx = tx + dx, wy = ty + dy;
            if (!W.isWall(wx, wy)) continue;
            for (const [fx, fy] of DIRS4) {
              if (W.isWall(wx + fx, wy + fy)) continue; // 该面被墙挡住，不可贴
              const fcx = BR.tileCX(wx) + fx * (T / 2), fcz = BR.tileCZ(wy) + fy * (T / 2);
              const d = Math.hypot(fcx - BR.tileCX(tx), fcz - BR.tileCZ(ty));
              if (!best || d < best.d) best = { d, wx, wy, fx, fy };
            }
          }
        }
        if (best) { ax = best.wx + best.fx; ay = best.wy + best.fy; n = { x: best.fx, z: best.fy }; }
      }
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.75),
        new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') })
      );
      m.position.set(BR.tileCX(ax) - n.x * (T / 2 - 0.04), 1.5, BR.tileCZ(ay) - n.z * (T / 2 - 0.04));
      m.rotation.y = Math.atan2(n.x, n.z);
      W.reg(group, m);
      W.addInteractable({
        id, kind: 'note', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: [m], pos: m.position.clone(), radius: 2.4,
        prompt: () => BR.interactKeyLabel() + '阅读字条',
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

  // 通用：环境涂鸦 decal（Systems D）——gen.js placeGraffiti 按种子登记的 'graffiti' POI。
  // 贴墙：position = tile中心 - 法线*(T/2-0.04)（法线 n 为墙→房间方向），
  // 正面朝房间：rotation.y = atan2(n.x, n.z)；rotation.z 做面内轻微倾斜（手绘感）。
  // 材质按 (text|sub|color|arrow) 复用（BR.Textures.graffitiMaterial 缓存），每处涂鸦 1 个 draw call。
  // 注意：贴墙物锚点统一用地板锚点公式 -n*(T/2-ε)（v2.5 F6：addNote 与马尼拉告示已由
  // 错误的 +n 公式改为与涂鸦一致的 -n 公式，此前字条/告示离墙 1.55~5.2m 浮空，见审计 A1-01~04）。
  function buildGraffitiDecals(map, W) {
    const list = (map.pois || []).filter(p => p.type === 'graffiti');
    for (const p of list) {
      const d = p.data || {};
      // v1.5.1：build 时二次校验——法线背后必须是墙（recarve 可能改了地形）；
      // 不是墙就换方向，4 个方向都没墙直接跳过不建，杜绝浮空涂鸦
      let n = { x: d.nx || 0, z: (d.nz == null ? 1 : d.nz) };
      let arrow = d.arrow || null, fellBack = false;
      const wallAt = (tx, ty) => { try { return W.isWall(tx, ty); } catch (e) { return false; } };
      if (!wallAt(p.tx - n.x, p.ty - n.z)) {
        fellBack = true;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        n = null;
        for (const [dx, dy] of dirs) {
          if (wallAt(p.tx + dx, p.ty + dy)) { n = { x: -dx, z: -dy }; break; }
        }
        if (!n) continue; // 无墙可贴：跳过
      }
      if (fellBack) arrow = null; // 换了方向：箭头可能指错，丢掉只留文字
      W.addChunkContent(p.tx, p.ty, (group) => {
        const w = d.w || 2.0;
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(w, w * 0.5),
          BR.Textures.graffitiMaterial(d.text || '?', d.sub || null, d.color || '#d8d2c0', arrow)
        );
        m.position.set(BR.tileCX(p.tx) - n.x * (T / 2 - 0.04), d.y || 1.5, BR.tileCZ(p.ty) - n.z * (T / 2 - 0.04));
        m.rotation.y = Math.atan2(n.x, n.z);
        m.rotation.z = d.rot || 0;
        W.reg(group, m);
      });
    }
  }
  BR.buildGraffitiDecals = buildGraffitiDecals;

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
  // H 路：CanvasTexture 缓存。原先每次区块构建都 new 一张 1024x640 贴图并上传 GPU，
  // 而 unload 时材质没有 _ownMat 标记、从不 dispose → GPU 贴图越建越多。内容固定，缓存一张复用。
  let _manilaPosterTex = null;
  function manilaPosterTexture() {
    if (_manilaPosterTex) return _manilaPosterTex;
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
    _manilaPosterTex = new THREE.CanvasTexture(cv);
    return _manilaPosterTex;
  }
  // 简易木椅
  function buildChairMesh() {
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: 0x6f5233 });
    const seat = new THREE.Mesh(boxGeo(0.5, 0.07, 0.5), wood);
    seat.position.y = 0.45; g.add(seat);
    const back = new THREE.Mesh(boxGeo(0.5, 0.55, 0.07), wood);
    back.position.set(0, 0.75, -0.25); g.add(back);
    [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(pt => {
      const leg = new THREE.Mesh(boxGeo(0.06, 0.45, 0.06), wood);
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
      const b = new THREE.Mesh(boxGeo(0.2, 0.26, 0.13),
        new THREE.MeshLambertMaterial({ color: 0xe8e0d0 }));
      b.position.y = 0.13; g.add(b);
      const cap = new THREE.Mesh(boxGeo(0.08, 0.05, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x8a2a2a }));
      cap.position.y = 0.28; g.add(cap);
    } else if (item === 'bandage') {
      const b = new THREE.Mesh(boxGeo(0.24, 0.1, 0.17),
        new THREE.MeshLambertMaterial({ color: 0xf0ece2 }));
      b.position.y = 0.05; g.add(b);
      const s = new THREE.Mesh(boxGeo(0.24, 0.02, 0.05),
        new THREE.MeshLambertMaterial({ color: 0xc03030 }));
      s.position.y = 0.1; g.add(s);
    } else if (item === 'flashlight') {
      const b = new THREE.Mesh(cylGeo(0.05, 0.05, 0.22, 10),
        new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
      b.rotation.z = Math.PI / 2; b.position.y = 0.08; g.add(b);
      const h = new THREE.Mesh(cylGeo(0.07, 0.06, 0.09, 10),
        new THREE.MeshLambertMaterial({ color: 0x555b62 }));
      h.rotation.z = Math.PI / 2; h.position.set(0.14, 0.08, 0); g.add(h);
    } else if (item === 'berry') {
      // 迁跃浆果：微光浆果簇
      const bm = new THREE.MeshLambertMaterial({ color: 0x7a3fd0 });
      [[-0.07, 0.07], [0.07, 0.07], [0, 0.16]].forEach(([x, y]) => {
        const s = new THREE.Mesh(sphGeo(0.075, 8, 6), bm);
        s.position.set(x, y, 0); g.add(s);
      });
      const stem = new THREE.Mesh(boxGeo(0.03, 0.16, 0.03),
        new THREE.MeshLambertMaterial({ color: 0x3f7a3a }));
      stem.position.y = 0.28; g.add(stem);
    } else if (item === 'food') {
      // 食物：罐头
      const c = new THREE.Mesh(cylGeo(0.09, 0.09, 0.16, 12),
        new THREE.MeshLambertMaterial({ color: 0xb0a080 }));
      c.position.y = 0.08; g.add(c);
      const lid = new THREE.Mesh(cylGeo(0.095, 0.095, 0.025, 12),
        new THREE.MeshLambertMaterial({ color: 0x7a6a50 }));
      lid.position.y = 0.165; g.add(lid);
    } else if (item === 'cigarette') {
      // 香烟：细长白色烟卷 + 棕色滤嘴段
      const c = new THREE.Mesh(cylGeo(0.018, 0.018, 0.20, 8),
        new THREE.MeshLambertMaterial({ color: 0xf2efe8 }));
      c.rotation.z = Math.PI / 2; c.position.y = 0.05; g.add(c);
      const f = new THREE.Mesh(cylGeo(0.02, 0.02, 0.06, 8),
        new THREE.MeshLambertMaterial({ color: 0x8a5a2a }));
      f.rotation.z = Math.PI / 2; f.position.set(0.12, 0.05, 0); g.add(f);
    } else if (item === 'gum') {
      // 口香糖：粉色小方条 + 两端糖纸小锥体
      const bar = new THREE.Mesh(boxGeo(0.16, 0.035, 0.07),
        new THREE.MeshLambertMaterial({ color: 0xf0a0c0 }));
      bar.position.y = 0.04; g.add(bar);
      const wrapM = new THREE.MeshLambertMaterial({ color: 0xc0c8d0 });
      [-1, 1].forEach(s => {
        const cone = new THREE.Mesh(coneGeo(0.035, 0.07, 6), wrapM);
        cone.rotation.z = s * Math.PI / 2; cone.position.set(s * 0.115, 0.04, 0); g.add(cone);
      });
    } else if (item === 'royal_ration') {
      // 皇家口粮：军绿方罐头 + 顶部金色小皇冠（锥体+圆球）
      const can = new THREE.Mesh(cylGeo(0.09, 0.09, 0.16, 12),
        new THREE.MeshLambertMaterial({ color: 0x4a5a30 }));
      can.position.y = 0.08; g.add(can);
      const gold = new THREE.MeshLambertMaterial({ color: 0xd8a820 });
      const crown = new THREE.Mesh(coneGeo(0.05, 0.07, 8), gold);
      crown.position.y = 0.195; g.add(crown);
      const orb = new THREE.Mesh(sphGeo(0.022, 8, 6), gold);
      orb.position.y = 0.24; g.add(orb);
    } else if (item === 'repellent') {
      // 笑魇驱散剂：白色喷雾瓶（瓶身+按压喷头）+ 半透明雾锥
      const body = new THREE.Mesh(cylGeo(0.06, 0.065, 0.20, 10),
        new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }));
      body.position.y = 0.10; g.add(body);
      const head = new THREE.Mesh(boxGeo(0.05, 0.05, 0.05),
        new THREE.MeshLambertMaterial({ color: 0x30343a }));
      head.position.y = 0.225; g.add(head);
      const mist = new THREE.Mesh(coneGeo(0.09, 0.22, 10),
        new THREE.MeshLambertMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35 }));
      mist.rotation.x = -Math.PI / 2.4; mist.position.set(0, 0.26, 0.12); g.add(mist);
    } else if (item === 'firesalt') {
      // 火盐：粗布束口小袋（压扁球体+束口）+ 袋口红色小火苗
      const sack = new THREE.Mesh(sphGeo(0.11, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0x9a7a52 }));
      sack.scale.set(1, 0.75, 1); sack.position.y = 0.085; g.add(sack);
      const neck = new THREE.Mesh(cylGeo(0.035, 0.05, 0.06, 8),
        new THREE.MeshLambertMaterial({ color: 0x7a5c3a }));
      neck.position.y = 0.18; g.add(neck);
      const flame = new THREE.Mesh(coneGeo(0.03, 0.09, 8),
        new THREE.MeshBasicMaterial({ color: 0xff4a1a }));
      flame.position.y = 0.25; g.add(flame);
    } else if (item === 'painliquid') {
      // 痛液：深绿细颈小瓶 + 瓶身深色斑点
      const dark = new THREE.MeshLambertMaterial({ color: 0x1e5a2a });
      const vb = new THREE.Mesh(cylGeo(0.055, 0.06, 0.16, 10), dark);
      vb.position.y = 0.08; g.add(vb);
      const vn = new THREE.Mesh(cylGeo(0.02, 0.035, 0.09, 8), dark);
      vn.position.y = 0.20; g.add(vn);
      const spotM = new THREE.MeshLambertMaterial({ color: 0x0d2a12 });
      [[0.03, 0.06, 0.045], [-0.035, 0.10, 0.04], [0.01, 0.13, -0.05]].forEach(sp => {
        const s = new THREE.Mesh(sphGeo(0.018, 6, 5), spotM);
        s.position.set(sp[0], sp[1], sp[2]); g.add(s);
      });
    } else if (item === 'cashew') {
      // 腰果水：与杏仁水几乎一样的瓶子（陷阱）——液体略黄、多一道高光，视觉差细微
      const b = new THREE.Mesh(boxGeo(0.2, 0.26, 0.13),
        new THREE.MeshLambertMaterial({ color: 0xe9dcb4 }));
      b.position.y = 0.13; g.add(b);
      const cap = new THREE.Mesh(boxGeo(0.08, 0.05, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x8a2a2a }));
      cap.position.y = 0.28; g.add(cap);
      const hl = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const h1 = new THREE.Mesh(boxGeo(0.025, 0.18, 0.004), hl);
      h1.position.set(-0.05, 0.14, 0.067); g.add(h1);
      const h2 = new THREE.Mesh(boxGeo(0.014, 0.10, 0.004), hl);
      h2.position.set(0.055, 0.12, 0.067); g.add(h2); // 第二道高光：唯一的视觉区别
    } else if (item === 'energy_bar') {
      // 能量棒：棕色扁条 + 金色锯齿包装边
      const bar = new THREE.Mesh(boxGeo(0.22, 0.05, 0.1),
        new THREE.MeshLambertMaterial({ color: 0x6a3f1a }));
      bar.position.y = 0.035; g.add(bar);
      const wrapM = new THREE.MeshLambertMaterial({ color: 0xd8a820 });
      [-1, 1].forEach(s => {
        const e = new THREE.Mesh(boxGeo(0.03, 0.055, 0.1), wrapM);
        e.position.set(s * 0.125, 0.035, 0); g.add(e);
      });
    } else if (item === 'medkit') {
      // 急救包：白箱 + 红十字
      const bx = new THREE.Mesh(boxGeo(0.26, 0.14, 0.18),
        new THREE.MeshLambertMaterial({ color: 0xf0ece2 }));
      bx.position.y = 0.07; g.add(bx);
      const crossM = new THREE.MeshBasicMaterial({ color: 0xc03030 });
      const c1 = new THREE.Mesh(boxGeo(0.1, 0.03, 0.005), crossM);
      c1.position.set(0, 0.08, 0.095); g.add(c1);
      const c2 = new THREE.Mesh(boxGeo(0.03, 0.1, 0.005), crossM);
      c2.position.set(0, 0.08, 0.095); g.add(c2);
      const hd = new THREE.Mesh(boxGeo(0.12, 0.03, 0.04),
        new THREE.MeshLambertMaterial({ color: 0x8a8578 }));
      hd.position.y = 0.155; g.add(hd);
    } else if (item === 'glowstick') {
      // 荧光棒：微光绿细管（MeshBasic 自发光观感）
      const st = new THREE.Mesh(cylGeo(0.028, 0.028, 0.26, 8),
        new THREE.MeshBasicMaterial({ color: 0x9dffb0 }));
      st.rotation.z = Math.PI / 2; st.position.y = 0.05; g.add(st);
    } else if (item === 'chalk') {
      // 标记粉笔：白色短棍 + 旁边一个小箭头标记
      const ch = new THREE.Mesh(cylGeo(0.025, 0.025, 0.14, 8),
        new THREE.MeshLambertMaterial({ color: 0xf2ecd8 }));
      ch.rotation.z = Math.PI / 2; ch.position.set(-0.05, 0.03, 0); g.add(ch);
      const arw = new THREE.Mesh(coneGeo(0.05, 0.1, 4),
        new THREE.MeshBasicMaterial({ color: 0xf2ecd8 }));
      arw.rotation.x = -Math.PI / 2; arw.rotation.y = Math.PI / 4;
      arw.position.set(0.12, 0.03, 0); g.add(arw);
    } else if (item === 'oxygen_tank') {
      // 便携氧气瓶：蓝色小气瓶 + 阀门
      const tk = new THREE.Mesh(cylGeo(0.07, 0.07, 0.24, 10),
        new THREE.MeshLambertMaterial({ color: 0x2a6a9a }));
      tk.position.y = 0.12; g.add(tk);
      const vv = new THREE.Mesh(boxGeo(0.05, 0.05, 0.05),
        new THREE.MeshLambertMaterial({ color: 0x8a8578 }));
      vv.position.y = 0.265; g.add(vv);
    } else if (item === 'dive_light') {
      // 水下照明灯：黄黑防水手电 + 大灯头
      const bd = new THREE.Mesh(cylGeo(0.05, 0.05, 0.2, 10),
        new THREE.MeshLambertMaterial({ color: 0xd8a820 }));
      bd.rotation.z = Math.PI / 2; bd.position.y = 0.07; g.add(bd);
      const hd = new THREE.Mesh(cylGeo(0.08, 0.06, 0.1, 10),
        new THREE.MeshLambertMaterial({ color: 0x2a2a2e }));
      hd.rotation.z = Math.PI / 2; hd.position.set(0.14, 0.07, 0); g.add(hd);
      const lens = new THREE.Mesh(cylGeo(0.06, 0.06, 0.02, 10),
        new THREE.MeshBasicMaterial({ color: 0xbfe8ff }));
      lens.rotation.z = Math.PI / 2; lens.position.set(0.19, 0.07, 0); g.add(lens);
    } else if (item === 'life_vest') {
      // 救生衣：橙色马甲（压扁盒体 + 反光条）
      const vs = new THREE.Mesh(boxGeo(0.3, 0.22, 0.12),
        new THREE.MeshLambertMaterial({ color: 0xd8622a }));
      vs.position.y = 0.11; g.add(vs);
      const rp = new THREE.Mesh(boxGeo(0.3, 0.04, 0.125),
        new THREE.MeshBasicMaterial({ color: 0xf2e9c8 }));
      rp.position.y = 0.13; g.add(rp);
    } else if (item === 'dry_bag') {
      // 防水物资袋：深蓝卷口袋 + 卷口
      const bg = new THREE.Mesh(cylGeo(0.11, 0.12, 0.24, 10),
        new THREE.MeshLambertMaterial({ color: 0x1e3a5a }));
      bg.position.y = 0.12; g.add(bg);
      const roll = new THREE.Mesh(cylGeo(0.115, 0.115, 0.05, 10),
        new THREE.MeshLambertMaterial({ color: 0x2a4a72 }));
      roll.position.y = 0.26; g.add(roll);
    } else if (item === 'adrenaline') {
      // 肾上腺素：注射器（透明管 + 针头 + 推杆）
      const tb = new THREE.Mesh(cylGeo(0.03, 0.03, 0.16, 8),
        new THREE.MeshLambertMaterial({ color: 0xd8e8f0, transparent: true, opacity: 0.7 }));
      tb.rotation.z = Math.PI / 2; tb.position.y = 0.05; g.add(tb);
      const nd = new THREE.Mesh(cylGeo(0.006, 0.006, 0.08, 6),
        new THREE.MeshBasicMaterial({ color: 0xb0b8c0 }));
      nd.rotation.z = Math.PI / 2; nd.position.set(0.12, 0.05, 0); g.add(nd);
      const pl = new THREE.Mesh(boxGeo(0.03, 0.05, 0.05),
        new THREE.MeshLambertMaterial({ color: 0xc03030 }));
      pl.position.set(-0.09, 0.05, 0); g.add(pl);
    } else {
      // 未知道具兜底：通用小盒子，避免返回空 group
      const u = new THREE.Mesh(boxGeo(0.2, 0.2, 0.2),
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
          // W9：背包满/堆叠满时拒绝拾取，物品留在世界（不记 picked、不移除 mesh）
          if (item !== 'flashlight' && BR.Items && !BR.Items.canAdd(item, n)) {
            BR.UI.toast(BR.Items.fullReason(item, n));
            if (BR.Audio.doorLocked) BR.Audio.doorLocked();
            return;
          }
          if (item === 'flashlight') {
            BR.Player.hasFlashlight = true;
            BR.UI.toast('拾取了手电筒（按 F / 🔦 开关）');
          } else if (item === 'dive_light') {
            // W9：水下照明灯唯一，不占 inv 数量
            BR.Items.add('dive_light', 1);
            BR.UI.toast('拾取了水下照明灯（背包中使用开关）');
          } else {
            BR.Game.inv[item] = (BR.Game.inv[item] || 0) + n;
            if (BR.Items && item === 'oxygen_tank') BR.Items._chargesOf(item); // 补齐独立电量
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
  BR.itemMesh = itemMesh; // Systems C-A：低理智假补给复用真杏仁水 mesh

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
  // W9：柜门关闭姿态（瞬时）与关门动画（开门动画的逆过程，约 350ms）
  function setCabinetDoorClosed(pivot) { pivot.rotation.y = 0; }
  function animCabinetDoorClose(pivot) {
    const t0 = performance.now(), dur = 350;
    const from = pivot.rotation.y;
    const iv = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      pivot.rotation.y = from * (1 - (1 - Math.pow(1 - k, 2)));
      if (k >= 1) { pivot.rotation.y = 0; clearInterval(iv); }
    }, 16);
  }
  function animCabinetDoor(pivot) {
    const t0 = performance.now(), dur = 350;
    const iv = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      pivot.rotation.y = CAB_DOOR_OPEN * (1 - Math.pow(1 - k, 2));
      if (k >= 1) clearInterval(iv);
    }, 16);
  }

  /* ================= BR.Container：通用容器机制（v2.0 P1-B） =================
   * 把已有的两段式容器交互（板条箱 wireCrateTwoStage / 柜子 addCabinetTwoStage）
   * 抽成的通用引擎。旧函数现为薄封装，行为/文案/音效/id 方案/存档语义逐项保留。
   *
   * ---- API ----
   *   BR.Container.create(W, opts) → 容器 id
   *   opts = {
   *     id,                          // 容器 id（驱动 openedCrates / RNG 种子 / cabinetOpen；老存档 id 方案原样保留）
   *     kind: 'cabinet'|'crate'|'drawer', // 决定默认文案/动画/交互 kind；drawer 为 P2 预留
   *     tx, ty,                      // 所在 tile（算 chunkKey）
   *     group,                       // addChunkContent 的 chunk group（柜内拾取 mesh 走 W.reg，随区块卸载）
   *     visual,                      // 动画目标：crate 传 {lid}，cabinet 传 {pivot}（doorPivot）
   *     anim,                        // 可选覆盖 {setOpen,setClosed,animOpen,animClose}；缺省按 kind 取内置
   *     meshes,                      // 开门交互的射线目标（柜体展平 mesh / 箱体 parts）
   *     doorMeshes,                   // 可关闭容器：关门交互的射线目标（缺省用 meshes）
   *     pos,                         // Vector3：开门交互中心
   *     closePos,                     // Vector3：关门交互中心（缺省 = pos）
   *     radius,                       // 交互半径（缺省 2.6）
   *     interactKind,                 // addInteractable 的 kind（缺省 crate→'crate'，其余→'cabinet'，均已在 world.js 登记）
   *     contents: [{item, count, dx, dz, y, label}],
   *                                  // 内容物；item==='empty'/缺省 = 空位；count>1 展开为多件逐件拾取
   *                                  // dx/dz/y 可逐件定死落点，不给则按 id 派生种子 RNG 确定性排布（不用 Math.random）
   *     pickIdOf(idx, entry),          // 逐件拾取 id；缺省 id+'_pick_'+idx（确定性；旧容器由封装层传 legacy 方案）
   *     innerPosOf(idx, entry),        // 逐件落点 Vector3；缺省见上
   *     legacyPicked(),                // 老存档兼容钩子：true 视为"已取完"（如柜子旧一步流程 picked 里记的是原 fpick id）
   *     closable,                      // true → 开后可关闭；开关态记 W.state.cabinetOpen[id]（进存档）
   *     text: {open, close, openedToast, emptyToast, closedToast}, // 覆盖默认文案
   *     sfxOpen, sfxClose,             // 覆盖默认 doorCreak
   *     autosave,                      // 开/关后直接调 BR.Game.autosave()
   *     onOpen(id), onClose(id), onPickup(pickId, entry, item)
   *   }
   * ---- 状态（全部走 W.state，自动进按关存档；world.js/save.js 不许动，只用已有字段） ----
   *   openedCrates: 容器 id → 曾经开过；picked: 逐件 pickId → 该件已取；
   *   cabinetOpen: {容器id: 当前开/关}（可关闭容器；老存档无此字段时视为开着，走旧规则）。
   * ---- 区块卸载重建 ----
   *   chunk unload 按 chunkKey 清掉交互点；重建时 create() 按 W.state 恢复姿态与未取物品。
   *   非关闭式容器沿用旧规则：老存档（非本 session 开）的已开容器视为已处理完，不重建箱内拾取；
   *   本 session 内开过的，未取物品重建。可关闭容器按 cabinetOpen 精确恢复（含读档）。
   * ---- P2（L7 破损储物柜）调用示例 ----
   *   BR.Container.create(W, {
   *     id: 'locker_l7_' + tx + '_' + ty, kind: 'cabinet', closable: true,
   *     tx: tx, ty: ty, group: group, visual: { pivot: lockerMesh.userData.doorPivot },
   *     meshes: lockerMeshes, pos: new THREE.Vector3(fx, 1.0, fz),
   *     contents: [{ item: 'diving_suit' }, { item: 'oxygen_tank' }, { item: 'bandage', count: 2 }],
   *     text: { open: '打开储物柜', openedToast: '储物柜打开了，看看里面有什么' },
   *     onPickup: function (pickId, entry) { BR.log('locker picked', pickId); }
   *   });
   *   // 必出潜水服：contents 里写死 {item:'diving_suit'} 即可，不走随机；
   *   // 落点想手工摆就给每件 dx/dz/y，否则引擎按 id 种子 RNG 自动排（确定性，读档/重建一致）。
   * ============================================================================ */
  BR.Container = (function () {
    // 各 kind 默认文案（调用方 text 可覆盖任一项；保持与旧实现逐字一致）
    const KIND_TEXT = {
      crate:   { open: '打开板条箱', openedToast: '箱子打开了，看看里面有什么', emptyToast: '箱子里只有灰尘。' },
      cabinet: { open: '打开柜门', close: '关上柜门', openedToast: '柜门打开了，看看里面有什么',
                 emptyToast: '柜门打开了，里面是空的。', closedToast: '柜门关上了' },
      drawer:  { open: '打开抽屉', close: '关上抽屉', openedToast: '抽屉打开了，看看里面有什么',
                 emptyToast: '抽屉是空的。', closedToast: '抽屉关上了' }
    };
    // 各 kind 默认动画（复用本文件既有函数；visual 缺目标时静默跳过）
    const KIND_ANIM = {
      crate: {
        setOpen: (v) => { if (v && v.lid) setLidOpenPose(v.lid); },
        setClosed: () => {},
        animOpen: (v) => { if (v && v.lid) animLidOpen(v.lid); },
        animClose: () => {}
      },
      cabinet: {
        setOpen: (v) => { if (v && v.pivot) setCabinetDoorOpen(v.pivot); },
        setClosed: (v) => { if (v && v.pivot) setCabinetDoorClosed(v.pivot); },
        animOpen: (v) => { if (v && v.pivot) animCabinetDoor(v.pivot); },
        animClose: (v) => { if (v && v.pivot) animCabinetDoorClose(v.pivot); }
      },
      drawer: { setOpen: () => {}, setClosed: () => {}, animOpen: () => {}, animClose: () => {} }
    };
    const txt = (kind, key, over) =>
      (over && over[key] != null) ? over[key] : ((KIND_TEXT[kind] || KIND_TEXT.crate)[key] || '');

    // contents 展平：[{item,count}] → 每件独立条目（count>1 展开为多件，各自独立 picked）
    function expandContents(contents) {
      const out = [];
      (contents || []).forEach((e, i) => {
        const n = Math.max(1, (e.count | 0) || 1);
        for (let k = 0; k < n; k++)
          out.push({ item: e.item, src: i, sub: k, dx: e.dx, dz: e.dz, y: e.y, label: e.label });
      });
      return out;
    }
    const spawnable = (e) => e.item && e.item !== 'empty';

    // 默认逐件落点：每件序号独立派生种子（id+':lx'+idx），任意子集重建都落在同一位置；
    // 基点取 opts.innerBase（缺省 opts.pos 的 x/z，y 缺省 0.5）。全程 BR.RNG，不用 Math.random。
    function defaultInnerPosOf(opts, id) {
      return (idx, entry) => {
        const rx = new BR.RNG(BR.hashSeed(id + ':lx' + idx));
        const rz = new BR.RNG(BR.hashSeed(id + ':lz' + idx));
        const base = opts.innerBase || opts.pos || { x: 0, y: 0.5, z: 0 };
        const dx = entry.dx != null ? entry.dx : (rx.next() - 0.5) * 0.55;
        const dz = entry.dz != null ? entry.dz : (rz.next() - 0.5) * 0.45;
        const y = entry.y != null ? entry.y : (base.y != null ? base.y : 0.5);
        return new THREE.Vector3(base.x + dx, y, base.z + dz);
      };
    }

    function create(W, opts) {
      opts = opts || {};
      const id = opts.id;
      const kind = opts.kind || 'crate';
      const tx = opts.tx, ty = opts.ty;
      const chunkKey = W.chunkKeyOf(tx, ty);
      const group = opts.group;
      const visual = opts.visual || {};
      const anim = opts.anim || KIND_ANIM[kind] || KIND_ANIM.crate;
      const text = opts.text || {};
      const closable = !!opts.closable;
      const entries = expandContents(opts.contents);
      const radius = opts.radius || 2.6;
      const iKind = opts.interactKind || (kind === 'crate' ? 'crate' : 'cabinet');
      const pickIdOf = opts.pickIdOf || ((idx) => id + '_pick_' + idx);
      const pickIds = entries.map((e, idx) => pickIdOf(idx, e));
      const entryOf = {};
      pickIds.forEach((pid, idx) => { entryOf[pid] = entries[idx]; });
      const innerPosOf = opts.innerPosOf || defaultInnerPosOf(opts, id);
      const legacyPicked = (typeof opts.legacyPicked === 'function') ? opts.legacyPicked : (() => false);
      const spIdx = entries.map((e, i) => spawnable(e) ? i : -1).filter((i) => i >= 0);
      const allPicked = () => {
        if (legacyPicked()) return true;
        for (const i of spIdx) if (!W.state.picked.includes(pickIds[i])) return false;
        return true;
      };

      // 状态字段沿用旧方案（全部进 W.state，随按关存档）
      W.state.cabinetOpen = W.state.cabinetOpen || {};
      const isOpenNow = () => W.state.cabinetOpen[id] === true;

      // 柜内逐件 mesh 引用（可关闭容器：关门时移除 mesh；区块重建时旧引用失效，先清）
      const innerMap = () => (W._containerInner = W._containerInner || {});
      const setInnerRefs = (refs) => { if (refs) innerMap()[id] = refs; else delete innerMap()[id]; };
      const clearInnerMeshes = () => {
        const refs = innerMap()[id];
        if (refs) refs.forEach((r) => { if (r && r.group && r.group.parent) r.group.parent.remove(r.group); });
        setInnerRefs(null);
      };
      setInnerRefs(null);

      function spawnAllUnpicked() {
        const refs = [];
        for (const i of spIdx) {
          if (W.state.picked.includes(pickIds[i])) continue; // 已取：不重建
          const r = spawnInnerPickup(W, group, innerPosOf(i, entries[i]), pickIds[i],
            entries[i].item, tx, ty,
            (pid, it) => { if (typeof opts.onPickup === 'function') opts.onPickup(pid, entryOf[pid], it); });
          if (r && r.group) refs.push(r);
        }
        if (refs.length) setInnerRefs(refs);
        return refs.length;
      }

      function registerOpen() {
        W.removeInteractable(id);
        W.addInteractable({
          id, kind: iKind, chunkKey,
          meshes: opts.meshes || [],
          pos: opts.pos.clone(), radius,
          prompt: () => BR.interactKeyLabel() + txt(kind, 'open', text),
          canUse: () => closable ? !isOpenNow() : !W.state.openedCrates.includes(id),
          use: () => { open(); }
        });
      }
      const closeId = id + '_close';
      function registerClose() {
        W.removeInteractable(closeId);
        W.addInteractable({
          id: closeId, kind: iKind, chunkKey,
          meshes: (opts.doorMeshes && opts.doorMeshes.length) ? opts.doorMeshes : (opts.meshes || []),
          pos: (opts.closePos || opts.pos).clone(), radius,
          prompt: () => BR.interactKeyLabel() + txt(kind, 'close', text),
          canUse: () => isOpenNow(),
          use: () => { close(); }
        });
      }

      function open() {
        if (closable ? isOpenNow() : W.state.openedCrates.includes(id)) return;
        if (anim.animOpen) anim.animOpen(visual);
        (opts.sfxOpen || (() => BR.Audio.doorCreak()))();
        if (!W.state.openedCrates.includes(id)) W.state.openedCrates.push(id);
        markLiveOpened(W, id);
        if (closable) W.state.cabinetOpen[id] = true;
        BR.bus.emit('crate:opened', { id, kind });
        if (typeof opts.onOpen === 'function') opts.onOpen(id);
        W.removeInteractable(id); // 开后容器本体移出射线检测，避免挡住柜内物资
        // 文案保持旧语义：无内容物 / 老存档一步拾取过 → emptyToast 且不刷出，否则 openedToast
        if (spIdx.length === 0 || legacyPicked()) BR.UI.toast(txt(kind, 'emptyToast', text));
        else { BR.UI.toast(txt(kind, 'openedToast', text)); spawnAllUnpicked(); }
        if (closable) registerClose();
        if (opts.autosave && BR.Game.autosave) BR.Game.autosave();
      }

      function close() {
        if (!closable || !isOpenNow()) return;
        if (anim.animClose) anim.animClose(visual);
        (opts.sfxClose || (() => BR.Audio.doorCreak()))();
        W.state.cabinetOpen[id] = false;
        // 关闭态：柜内拾取移出射线检测 + 移除 mesh（不许隔门拿；重开时重建）
        pickIds.forEach((pid) => W.removeInteractable(pid));
        clearInnerMeshes();
        W.removeInteractable(closeId);
        registerOpen();
        BR.UI.toast(txt(kind, 'closedToast', text));
        if (typeof opts.onClose === 'function') opts.onClose(id);
        if (opts.autosave && BR.Game.autosave) BR.Game.autosave();
      }

      // —— 初始装配（区块构建 / 重建 / 读档） ——
      const opened = W.state.openedCrates.includes(id);
      if (!opened) {
        if (anim.setClosed) anim.setClosed(visual);
        registerOpen();
      } else if (allPicked()) {
        // 已取完：纯装饰，按开合姿态
        if (closable) {
          if (isOpenNow()) { if (anim.setOpen) anim.setOpen(visual); registerClose(); }
          else { if (anim.setClosed) anim.setClosed(visual); registerOpen(); }
        } else if (anim.setOpen) anim.setOpen(visual);
      } else if (closable) {
        // 开过但未取完：按 cabinetOpen 恢复（老存档无该字段 → 默认开着，走旧规则）
        const shouldOpen = W.state.cabinetOpen[id] !== false;
        W.state.cabinetOpen[id] = shouldOpen;
        if (shouldOpen) {
          if (anim.setOpen) anim.setOpen(visual);
          spawnAllUnpicked();
          registerClose();
        } else {
          if (anim.setClosed) anim.setClosed(visual);
          registerOpen();
        }
      } else {
        // 非关闭式 + 开过未取完：沿用旧规则——仅本 session 内开过的才重建箱内拾取；
        // 老存档（openedCrates 有 id 但非本 session 开）视为已处理完，不重建，避免已拿物资复活。
        // 箱体不再注册交互，避免挡住箱内物资的射线。
        if (anim.setOpen) anim.setOpen(visual);
        if (wasLiveOpened(W, id)) spawnAllUnpicked();
      }

      // 对外控制句柄（测试/其它调用方），沿用旧 W._cabCtl 挂载点
      if (closable) {
        W._cabCtl = W._cabCtl || {};
        W._cabCtl[id] = { open, close, isOpen: isOpenNow };
      }
      return id;
    }

    return { create };
  })();

  // H 路：几何体复用缓存（性能）。
  // 根因：旧代码里箱/柜/桌/椅/灌木/拾取每次构建都 new 一批几何体，
  // 而 world.js unloadChunkMeshes 只 dispose 顶层 disposable 自身的 geometry
  // （Group 子件的不管），导致 renderer.info.memory.geometries 随切关/区块重载无界增长
  // （实测每切关 +12，几次切关后 swiftshader 渲染器直接崩掉 "Target closed"）。
  // 这些部件尺寸固定，改成按尺寸缓存、永久共享（与 world.js sharedGeo 同策略，永不 dispose），
  // 从根上消灭泄漏。注意：只用于 Group 子件；直接 W.reg 的单个 Mesh 不用（unload 会 dispose
  // 掉它的 geometry——共享几何被 dispose 只是多一次重传，不致命，但没必要）。
  const _geoCache = {};
  function boxGeo(w, h, d) {
    const k = 'b' + w.toFixed(3) + ',' + h.toFixed(3) + ',' + d.toFixed(3);
    return _geoCache[k] || (_geoCache[k] = new THREE.BoxGeometry(w, h, d));
  }
  function sphGeo(r, a, b) {
    const k = 's' + r.toFixed(3) + ',' + (a || 8) + ',' + (b || 6);
    return _geoCache[k] || (_geoCache[k] = new THREE.SphereGeometry(r, a || 8, b || 6));
  }
  function cylGeo(rt, rb, h, s) {
    const k = 'c' + rt.toFixed(3) + ',' + rb.toFixed(3) + ',' + h.toFixed(3) + ',' + (s || 8);
    return _geoCache[k] || (_geoCache[k] = new THREE.CylinderGeometry(rt, rb, h, s || 8));
  }
  function coneGeo(r, h, s) {
    const k = 'k' + r.toFixed(3) + ',' + h.toFixed(3) + ',' + (s || 8);
    return _geoCache[k] || (_geoCache[k] = new THREE.ConeGeometry(r, h, s || 8));
  }

  // H 路：容器/家具/灌木底部的接触阴影（blob）。
  // group 为 addChunkContent 的 chunk group，走 W.reg 登记 → 随区块卸载自动 dispose 几何体；
  // 材质是 textures.js 里的共享单例，不释放。画质档 blobShadow=0 时 makeBlobShadow 返回 null。
  function addPropShadow(W, group, x, z, r) {
    if (!BR.Textures || !BR.Textures.makeBlobShadow) return;
    const sh = BR.Textures.makeBlobShadow(r);
    if (!sh) return;
    sh.position.set(x, 0.02, z);
    W.reg(group, sh);
  }

  // 敞口板条箱 mesh：四壁 + 底（能看见里面）+ 盖子。返回 {group, lid, parts}
  function buildCrateMesh(W) {
    const g = new THREE.Group();
    const wood = W.mat('crate');
    const parts = [];
    const t = 0.06, wd = 1.05, ht = 0.8;
    const wall = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(boxGeo(w, h, d), wood);
      m.position.set(x, y, z); g.add(m); parts.push(m);
    };
    wall(wd, ht, t, 0, ht / 2, wd / 2 - t / 2);
    wall(wd, ht, t, 0, ht / 2, -(wd / 2 - t / 2));
    wall(t, ht, wd - 2 * t, wd / 2 - t / 2, ht / 2, 0);
    wall(t, ht, wd - 2 * t, -(wd / 2 - t / 2), ht / 2, 0);
    wall(wd, t, wd, 0, t / 2, 0); // 底
    const lid = new THREE.Mesh(boxGeo(wd, 0.12, wd), wood);
    lid.position.y = ht + 0.06; g.add(lid); parts.push(lid);
    return { group: g, lid, parts };
  }
  BR.buildCrateMesh = buildCrateMesh;

  // 容器内物资拾取（两段式的第二段）：可见 itemMesh + 隐形命中代理，kind 'pickup'。
  // pos 为物资底部中心世界坐标；chunkGroup 为 addChunkContent 的 group（随区块卸载，走 W.reg）。
  // onUse(pickId, item)：可选，BR.Container 的 onPickup 钩子透传。
  function spawnInnerPickup(W, chunkGroup, pos, pickId, item, tx, ty, onUse) {
    if (W.state.picked.includes(pickId)) return null; // 已拾取：不重建
    const ig = itemMesh(item);
    ig.position.copy(pos);
    // 命中代理：隐形大盒子（colorWrite 关，只参与射线不参与渲染），保证小 mesh 也能被射线稳定打中
    const proxy = new THREE.Mesh(
      boxGeo(0.7, 0.8, 0.7),
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
        // W9：背包满/堆叠满时拒绝，物品留在容器内（不记 picked）
        if (item !== 'flashlight' && BR.Items && !BR.Items.canAdd(item, 1)) {
          BR.UI.toast(BR.Items.fullReason(item, 1));
          if (BR.Audio.doorLocked) BR.Audio.doorLocked();
          return;
        }
        if (item === 'flashlight') {
          BR.Player.hasFlashlight = true;
          BR.UI.toast('拾取了手电筒（按 F / 🔦 开关）');
        } else if (item === 'dive_light') {
          BR.Items.add('dive_light', 1);
          BR.UI.toast('拿起了水下照明灯（背包中使用开关）');
        } else {
          BR.Game.inv[item] = (BR.Game.inv[item] || 0) + 1;
          if (BR.Items && item === 'oxygen_tank') BR.Items._chargesOf(item);
          BR.UI.toast('拿起了' + (ITEM_NAME[item] || item));
        }
        BR.Audio.pickup();
        W.state.picked.push(pickId);
        BR.bus.emit('picked', { id: pickId });
        W.removeInteractable(pickId);
        chunkGroup.remove(ig);
        BR.UI.updateInv();
        if (typeof onUse === 'function') onUse(pickId, item);
      }
    });
    return { pickId: pickId, group: ig };
  }

  // 板条箱两段式接线（L0/L1/L2/L3 共用）：
  //  第一段：交互"打开板条箱" → 掀盖动画 + 音效 + openedCrates 记录 + toast"箱子打开了，看看里面有什么"，
  //    同时在箱内刷出可见物资（kind 'pickup'，id 'cratepick_'+crateId，prompt"拿起"+物品名）；
  //    item==='empty' 时只 toast，不刷拾取；item==='flashlight' 也刷拾取（瞄准拿起获得手电）。
  //  第二段：准星对准箱内物资交互 → 进物品栏，记 picked，移除 mesh 与交互点。
  //  区块重建/读档：已开盖（本 session 内开过）且未拾取 → 重建箱内拾取；
  //    老存档（openedCrates 有 id 但非本 session 开）视为已处理完，不重建，避免已拿物资复活。
  //  v2.0 P1-B：实现迁移到 BR.Container.create（单物品容器；行为/文案/音效/id/存档语义不变）。
  function wireCrateTwoStage(W, chunkGroup, cm, o) {
    const id = o.id, item = o.item;
    return BR.Container.create(W, {
      id, kind: 'crate', tx: o.tx, ty: o.ty, group: chunkGroup,
      visual: { lid: cm.lid },
      meshes: cm.parts,
      pos: cm.group.position.clone().add(new THREE.Vector3(0, 1, 0)),
      contents: [{ item }],
      pickIdOf: () => 'cratepick_' + id, // 老存档 id 方案保留
      innerPosOf: () => new THREE.Vector3(cm.group.position.x, 0.10, cm.group.position.z)
    });
  }
  BR.wireCrateTwoStage = wireCrateTwoStage;

  function addCrate(W, poi) {
    const tx = poi.tx, ty = poi.ty;
    const id = 'crate_' + tx + '_' + ty;
    W.addChunkContent(tx, ty, (group) => {
      const cm = BR.buildCrateMesh(W);
      cm.group.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
      // v2.5 道具碰撞：板条箱占地为 buildCrateMesh 的 wd=1.05 见方（方形盒，四壁同宽），半宽/半深各 1.05/2
      W.addPropBox(cm.group.position.x, cm.group.position.z, 0.525, 0.525);
      W.reg(group, cm.group);
      addPropShadow(W, group, cm.group.position.x, cm.group.position.z, 0.8); // H 路：接触阴影
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
      // v2.5 道具碰撞：灌木叶团/浆果分布半径约 0.55（在本钩子的已采摘早退之后，采摘后重建不再登记）
      // tag 用灌木稳定 id：采摘成功时 W.removePropByTag(id) 立即清碰撞，不等区块卸载
      W.addPropCircle(g.position.x, g.position.z, 0.55, { tag: id });
      const rng = new BR.RNG(BR.hashSeed(id)); // 布局确定性，不随加载变化
      const leaf = new THREE.MeshLambertMaterial({ color: 0x2e5a2e });
      for (let i = 0; i < 5; i++) { // 暗绿叶团
        // H 路：用单位球共享几何体 + 缩放（原先每团 new 一个随机半径球体，无法缓存）
        const b = new THREE.Mesh(sphGeo(1, 8, 6), leaf);
        b.scale.setScalar(0.35 + rng.next() * 0.25);
        const a = rng.next() * 6.2832, r = 0.3 + rng.next() * 0.4;
        b.position.set(Math.cos(a) * r, 0.35 + rng.next() * 0.4, Math.sin(a) * r);
        g.add(b);
      }
      const bm = new THREE.MeshLambertMaterial({ color: 0x7a3fd0, emissive: 0x3a1060 });
      const berries = [];
      for (let i = 0; i < 6; i++) { // 微光浆果
        const s = new THREE.Mesh(sphGeo(0.07, 8, 6), bm);
        const a = rng.next() * 6.2832;
        s.position.set(Math.cos(a) * 0.45, 0.5 + rng.next() * 0.5, Math.sin(a) * 0.45);
        g.add(s); berries.push(s);
      }
      W.reg(group, g);
      addPropShadow(W, group, g.position.x, g.position.z, 0.7); // H 路：接触阴影
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
          W.removePropByTag(id);
          group.remove(g);
          BR.UI.updateInv();
        }
      });
    });
  }

  // 薄墙（不稳定切出点）：注册位置，tick 里检测贴墙挤压
  // opts.cross：目的地池（数组）—— 充满后走 BR.Cutout.travel(kind 'rift') 跨关切出；
  //   不传则保持旧行为：同层野生切出（noclipRandom）。L0/L1/L2/L3/FUN 均不传。
  function buildThinWalls(map, W, opts) {
    opts = opts || {};
    const twPois = (map.pois || []).filter(p => p.type === 'thin_wall');
    W._thinWalls = twPois.map(p => ({
      x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty),
      dx: p.data.dx || 0, dz: p.data.dz || 1,
      charge: 0, cool: 0, hintTold: false,
      cross: (opts.cross && opts.cross.length) ? opts.cross.slice() : null
    }));
    // v2.5 道具碰撞：本函数实际不生成网格/墙段（只登记 POI 供 thinWallTick 挤压检测），
    // 没有“段生成处/mesh AABB”可挂；粒度退到每个 POI 一段：薄墙位于该地板 tile 朝
    // (dx,dz) 一侧的 tile 边界上（相邻墙 tile 本身已是 tile 碰撞，此盒是地板侧的冗余封边，
    // 半厚 0.08、沿墙长一整 tile 即半长 T/2）。登记放进该 tile 的区块钩子，与其他道具同
    // 生命周期：区块卸载按 chunkKey 清除、重建钩子重跑重新登记；不改变 thinWallTick 的
    // 距离/挤压判定（玩家仍可贴到边界前蓄力切出）。
    for (const p of twPois) {
      const dx = p.data.dx || 0, dz = p.data.dz || 1;
      const bx = BR.tileCX(p.tx) + dx * (T / 2), bz = BR.tileCZ(p.ty) + dz * (T / 2);
      W.addChunkContent(p.tx, p.ty, () => {
        if (dx) W.addPropBox(bx, bz, 0.08, T / 2);
        else W.addPropBox(bx, bz, T / 2, 0.08);
      });
    }
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
        if (tw.charge > 1.4) { tw.cool = 10; tw.charge = 0; wildCutout(W, P, tw); }
      } else tw.charge = Math.max(0, tw.charge - dt * 2);
    }
  }
  // 野生切出：tw.cross 有目的地池 → 走统一切出状态机跨关（kind 'rift'）；
  //   否则回退到同层随机传送（noclipRandom，旧行为）。
  function wildCutout(W, P, tw) {
    const pool = (tw.cross || []).filter(lv => lv !== BR.Game.level && BR.Levels[lv]);
    if (pool.length && BR.Cutout && typeof BR.Cutout.travel === 'function' &&
        !BR.Cutout.busy && !BR.Trans.active) {
      const to = pool[(Math.random() * pool.length) | 0];
      P.drainSanity(12);
      BR.Audio.stinger();
      BR.bus.emit('noclip:wild');
      BR.UI.toast('墙面像水一样漾开——你掉了进去……', 2600);
      BR.Cutout.travel(to, { kind: 'rift' });
      return;
    }
    noclipRandom(W, P); // 兜底：切出系统未就绪 / 无可用目的地时同层传送
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

  /* ---------- 通风管（v2.2 W-exits）：固定映射切出点 ---------- */
  // 常驻位置循环声的跨关清理：W.dispose 包一层（world.js 非本 worker 领地，不改其源码）。
  // 每关 buildContent 里调一次即可（幂等）；换关/重建世界时自动停掉本关的循环声。
  function ensureLoopCleanup(W, ids) {
    W._loopCleanupIds = W._loopCleanupIds || [];
    for (const id of ids) if (W._loopCleanupIds.indexOf(id) < 0) W._loopCleanupIds.push(id);
    if (W._loopCleanupWrapped) return;
    W._loopCleanupWrapped = true;
    const _dispose = W.dispose.bind(W);
    W.dispose = function () {
      if (BR.Audio && BR.Audio.removeLoop) {
        for (const id of (this._loopCleanupIds || [])) { try { BR.Audio.removeLoop(id); } catch (e) {} }
      }
      _dispose();
    };
  }

  // 在关卡内放置通风管（墙面格栅 + 目标色边框 + 交互钻入）。
  // level 必须在 BR.VENT_ROUTES 中；want 为数量（L0/L1/L2 各 2）。
  // 放置规则：非出生房间的地板格、贴一面墙、离出生点 ≥5 格、从出生点 BFS 可达、
  // 不压已有 POI tile。全部满足才放（宁缺毋滥，绝不挡路/卡死）。
  function buildVents(map, W, level) {
    const dest = BR.VENT_ROUTES[level];
    W._vents = []; // 每关重建时重置（W 为单例，dispose 不清自定义字段）
    if (!dest || !BR.Levels[dest]) return 0;
    const color = BR.VENT_COLORS[dest] == null ? 0x9fd8ff : BR.VENT_COLORS[dest];
    const colorName = BR.VENT_COLOR_NAMES[dest] || '灰色';
    const destName = BR.Levels[dest].name;
    const rng = new BR.RNG(BR.hashSeed(map.seed + ':vent:' + level));
    const sp = (map.pois || []).find(p => p.type === 'spawn');
    const rooms = (map.rooms || []).filter(r => r.tag !== 'spawn');
    if (!rooms.length || !sp) return 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const poiTiles = {};
    (map.pois || []).forEach(p => { poiTiles[p.ty * map.w + p.tx] = 1; });
    const doorTiles = {};
    (map.doors || []).forEach(d => { doorTiles[d.ty * map.w + d.tx] = 1; });
    const used = {};
    let placed = 0, guard = 0;
    const want = 2;
    while (placed < want && guard++ < 240) {
      const r = rooms[(rng.next() * rooms.length) | 0];
      if (r.w <= 0 || r.h <= 0) continue;
      const tx = r.x + ((rng.next() * r.w) | 0), ty = r.y + ((rng.next() * r.h) | 0);
      if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1) continue;
      const idx = ty * map.w + tx;
      if (map.tiles[idx] !== 1) continue;
      if (poiTiles[idx] || doorTiles[idx] || used[idx]) continue;
      if (Math.hypot(tx - sp.tx, ty - sp.ty) < 5) continue; // 别糊脸
      let wall = null;
      for (const dd of dirs) {
        const nx = tx + dd[0], ny = ty + dd[1];
        if (map.tiles[ny * map.w + nx] !== 1 && !doorTiles[ny * map.w + nx]) { wall = dd; break; }
      }
      if (!wall) continue;
      if (!BR.Gen.reachable(map, sp.tx, sp.ty, tx, ty)) continue;
      used[idx] = 1;
      buildVentGrate(W, tx, ty, wall, dest, destName, color, colorName, level);
      // 可测试性：记录已放置通风管（e2e 冒烟用；本函数开头已重置）
      W._vents.push({ tx: tx, ty: ty, dest: dest });
      placed++;
      // 第一个通风管旁放一张 M.E.G. 管路图字条（颜色→层级对照表，玩家可学会）：
      // 在管子周围 3 格内螺旋搜索合适的字条位（地板、非 POI/门/已用）
      if (placed === 1) {
        let nb = null;
        for (let rad = 1; rad <= 3 && !nb; rad++) {
          for (let dy = -rad; dy <= rad && !nb; dy++) {
            for (let dx2 = -rad; dx2 <= rad && !nb; dx2++) {
              if (Math.max(Math.abs(dx2), Math.abs(dy)) !== rad) continue;
              const bx = tx + dx2, by = ty + dy;
              if (bx < 1 || by < 1 || bx >= map.w - 1 || by >= map.h - 1) continue;
              const bi = by * map.w + bx;
              if (bi === idx) continue;
              if (map.tiles[bi] !== 1 || poiTiles[bi] || doorTiles[bi] || used[bi]) continue;
              nb = [bx, by];
            }
          }
        }
        if (nb) addNote(W, nb[0], nb[1], 'M.E.G. 通风管路图', ventMapNoteBody());
      }
    }
    return placed;
  }
  function ventMapNoteBody() {
    return 'M.E.G. 前哨站手抄，贴在管子旁边：\n\n' +
      '这几层的通风管是通的，钻进去会切到固定的层级。\n' +
      '记住边框的颜色就行，管子只认颜色不认位置：\n\n' +
      '绿色边框 → Level 1「宜居地带」\n' +
      '琥珀色边框 → Level 2「废弃公共带」\n' +
      '蓝色边框 → Level 3「发电站」\n\n' +
      '——别钻没有颜色边框的管子，那是死的。';
  }
  // 墙面通风格栅：深色框体 + 百叶 + 目标色顶条 + 微光
  function buildVentGrate(W, tx, ty, wall, dest, destName, color, colorName, level) {
    const id = 'vent_' + level + '_' + tx + '_' + ty;
    W.addChunkContent(tx, ty, (group) => {
      const x = BR.tileCX(tx), z = BR.tileCZ(ty);
      const g = new THREE.Group();
      const dark = new THREE.MeshLambertMaterial({ color: 0x1a1c1e });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 0.1), dark);
      g.add(frame);
      const slatM = new THREE.MeshLambertMaterial({ color: 0x3d4145 });
      for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.06), slatM);
        s.position.set(0, -0.32 + i * 0.21, 0.045);
        s.rotation.x = 0.5;
        g.add(s);
      }
      // 目标色顶条（可学习的固定映射视觉锚点）
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.09, 0.12),
        new THREE.MeshBasicMaterial({ color: color }));
      stripe.position.y = 0.545;
      g.add(stripe);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.2),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
      glow.position.z = 0.02;
      g.add(glow);
      g.position.set(x + wall[0] * (T / 2 - 0.08), 1.05, z + wall[1] * (T / 2 - 0.08));
      // wall 为 tile→墙方向；格栅正面（百叶/色条/微光）须朝房间（-wall），旧值会让正面贴进墙里
      g.rotation.y = Math.atan2(-wall[0], -wall[1]);
      W.reg(group, g);
      // v2.2-fix：交互射线（world.js rayInteract）是非递归的，Group 本身 raycast 为空，
      // meshes 传 Group 会导致准星永远命中不了通风管。展平成 Mesh 数组（与 L4 等关一致）。
      const ventMeshes = [];
      g.traverse(function (o) { if (o.isMesh) ventMeshes.push(o); });
      W.addInteractable({
        id, kind: 'vent', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: ventMeshes, pos: new THREE.Vector3(x, 1.05, z), radius: 2.8,
        prompt: () => '钻进通风管（' + colorName + '边框 → ' + destName + '）',
        canUse: () => true,
        use: () => {
          BR.UI.toast('你钻进通风管，向' + colorName + '的另一头爬去……', 2200);
          BR.bus.emit('vent:enter', { id: id, from: level, to: dest });
          BR.Cutout.travelTo(dest, { mode: 'door', dropText: '你从通风管爬出来，拍掉身上的灰——' + destName + '。' });
        }
      });
    });
  }

  /* ---------- 程序化家具（桌子/柜子）与家具拾取（L0 马尼拉房间 / L1 家具 POI 共用） ---------- */
  // 桌子：桌面 + 四腿，木纹色
  function buildTableMesh() {
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a6238 });
    const woodDark = new THREE.MeshLambertMaterial({ color: 0x64461f });
    const top = new THREE.Mesh(boxGeo(1.3, 0.09, 0.8), wood);
    top.position.y = 0.72; g.add(top);
    const legG = boxGeo(0.09, 0.72, 0.09);
    [[-0.56, -0.31], [0.56, -0.31], [-0.56, 0.31], [0.56, 0.31]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(legG, woodDark);
      leg.position.set(x, 0.36, z); g.add(leg);
    });
    return g;
  }
  // 柜子：敞口柜体（背板/侧板/顶/底/隔板，前面敞开）+ 可转动的左扇柜门
  // （H 路：旧版是实心盒子，柜门打开后"里面"看不见，物资只能浮在柜前；
  //  改成真敞口，柜内拾取放在隔板上，位置/视觉才合理）
  // 铰链组挂在 g.userData.doorPivot，供 addCabinetTwoStage 做开门动画
  function buildCabinetMesh() {
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: 0x77552e });
    const trim = new THREE.MeshLambertMaterial({ color: 0x4a3013 });
    const inner = new THREE.MeshLambertMaterial({ color: 0x241a0e }); // 柜内暗色
    const Wd = 1.05, Ht = 1.5, Dp = 0.55, th = 0.05;
    const panel = (w, h, d, x, y, z, m) => {
      const p = new THREE.Mesh(boxGeo(w, h, d), m || wood);
      p.position.set(x, y, z); g.add(p); return p;
    };
    panel(Wd, Ht, th, 0, Ht / 2, -Dp / 2 + th / 2, inner); // 背板
    panel(th, Ht, Dp, -Wd / 2 + th / 2, Ht / 2, 0);        // 左侧板
    panel(th, Ht, Dp, Wd / 2 - th / 2, Ht / 2, 0);         // 右侧板
    panel(Wd, th, Dp, 0, Ht - th / 2, 0);                  // 顶板
    panel(Wd, th, Dp, 0, th / 2, 0);                       // 底板
    panel(Wd - 2 * th, th, Dp - th, 0, Ht * 0.55, 0);      // 中层隔板（物资放这层）
    const lip = new THREE.Mesh(boxGeo(Wd + 0.04, 0.06, Dp + 0.04), trim);
    lip.position.y = Ht + 0.03; g.add(lip); // 顶部压条
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-Wd / 2 + 0.02, Ht / 2, Dp / 2 + 0.01);
    const door = new THREE.Mesh(boxGeo(Wd - 0.07, Ht - 0.16, 0.04), wood);
    door.position.set((Wd - 0.07) / 2, 0, 0);
    doorPivot.add(door);
    const hm = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const handle = new THREE.Mesh(boxGeo(0.05, 0.2, 0.06), hm);
    handle.position.set(Wd - 0.16, 0.05, 0.05); // 跟门一起转
    doorPivot.add(handle);
    g.add(doorPivot);
    g.userData.doorPivot = doorPivot;
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
    // v2.5 道具碰撞：在柜子分支 return 之前登记，保证柜/桌两种容器与桌子已拾取早退路径都覆盖
    // （家具本体在拾取后仍存在）；尺寸对 buildCabinetMesh（1.05×0.55）/ buildTableMesh 桌面（1.3×0.8）各取一半。
    // opts.skipPropCollider 为真时跳过（马尼拉八角圆桌已按圆单独登记，避免被通用 table 矩形重复登记）。
    if (!opts.skipPropCollider) {
      if (opts.container === 'cabinet') {
        W.addPropBox(opts.fx, opts.fz, 0.53, 0.28, { rot: opts.furniture ? opts.furniture.rotation.y : 0 });
      } else {
        W.addPropBox(opts.fx, opts.fz, 0.65, 0.40, opts.furniture ? { rot: opts.furniture.rotation.y } : undefined);
      }
    }
    if (opts.container === 'cabinet') return addCabinetTwoStage(W, opts, id, item);
    // H 路：家具底部接触阴影（桌/柜调用方已把 furniture mesh 摆好，位置取 fx/fz）
    addPropShadow(W, opts.group, opts.fx, opts.fz, opts.container === 'cabinet' ? 0.75 : 1.0);
    // —— table / 默认：一步拾取（原逻辑） ——
    if (W.state.picked.includes(id)) return null; // 已拾取：存档/区块重建时不重建
    const ig = itemMesh(item);
    const rng = new BR.RNG(BR.hashSeed(id));
    ig.position.set(opts.fx + (rng.next() - 0.5) * 0.35, opts.topY,
      opts.fz + (rng.next() - 0.5) * 0.3);
    // 命中代理：隐形大盒子（colorWrite 关，只参与射线不参与渲染），
    // 保证小瓶子/绷带卷这类小 mesh 也能被屏幕中心射线稳定打中
    const proxy = new THREE.Mesh(
      boxGeo(0.7, 0.8, 0.7),
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
        // W9：背包满/堆叠满时拒绝，物品留在桌上
        if (BR.Items && !BR.Items.canAdd(item, 1)) {
          BR.UI.toast(BR.Items.fullReason(item, 1));
          if (BR.Audio.doorLocked) BR.Audio.doorLocked();
          return;
        }
        if (item === 'dive_light' && BR.Items) {
          BR.Items.add('dive_light', 1);
        } else {
          BR.Game.inv[item] = (BR.Game.inv[item] || 0) + 1;
          if (BR.Items && item === 'oxygen_tank') BR.Items._chargesOf(item);
        }
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
  // 柜子两段式 + W9 开合（addFurniturePickup container:'cabinet' 时调用）：
  //  第一段"打开柜门" → 柜门转动动画 + 音效 + openedCrates 记录 + toast，柜内刷出可见物资拾取；
  //  第二段准星对准柜内物资 → 拾取进物品栏。开门后柜门可再"关上"（关门动画），
  //  关闭态柜内拾取移出射线检测（不许隔门拿）；再打开恢复。
  //  状态：openedCrates=曾经开过（旧语义）；W.state.cabinetOpen[cabId]=当前开合（新，入存档）。
  //  区块重建/读档按 cabinetOpen 恢复姿态与拾取；老存档无 cabinetOpen 时 opened 即视为开着走旧规则。
  //  v2.0 P1-B：实现迁移到 BR.Container.create（可关闭单物品容器；行为/文案/音效/id/存档语义不变）。
  function addCabinetTwoStage(W, opts, id, item) {
    const cabId = 'cab_' + opts.tx + '_' + opts.ty + '_' + (opts.suffix || 'furn');
    // H 路：柜体底部接触阴影（原位置保留）
    addPropShadow(W, opts.group, opts.fx, opts.fz, 0.75);
    const pivot = opts.furniture ? opts.furniture.userData.doorPivot : null;
    const innerPos = (() => {
      const f = opts.furniture;
      if (f) {
        f.updateMatrixWorld(true);
        return f.localToWorld(new THREE.Vector3(0, 0.95, 0.05));
      }
      return new THREE.Vector3(opts.fx, 0.95, opts.fz);
    })();
    // 展平一层 children（含铰链组里的门板/把手），保证门板也能被射线打中
    const cabMeshes = [];
    if (opts.furniture) opts.furniture.children.forEach(c => {
      cabMeshes.push(c);
      if (c.children) c.children.forEach(cc => cabMeshes.push(cc));
    });
    const doorMeshes = [];
    if (pivot) pivot.children.forEach(c => doorMeshes.push(c));
    return BR.Container.create(W, {
      id: cabId, kind: 'cabinet', closable: true,
      tx: opts.tx, ty: opts.ty, group: opts.group,
      visual: { pivot },
      meshes: cabMeshes.length ? cabMeshes : [],
      doorMeshes: doorMeshes.length ? doorMeshes : cabMeshes,
      pos: new THREE.Vector3(opts.fx, 1.0, opts.fz),
      closePos: new THREE.Vector3(opts.fx, 1.2, opts.fz),
      contents: [{ item }],
      pickIdOf: () => 'cabpick_' + id, // 老存档 id 方案保留
      // 老存档一步拾取（picked 里记的是原 fpick id）：视为已拾取，不重建
      legacyPicked: () => W.state.picked.includes(id),
      innerPosOf: () => innerPos.clone(),
      autosave: true // 旧实现开/关后直接调 BR.Game.autosave()（main.js 只监听 'crate:opened' 做自动存档）
    });
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
      } else if (d.exitTo === 'L0_EXIT') {
        // v1.5.1：L0 主出口（游戏性改编）——金属门 + 绿色 EXIT 灯牌 → Level 1「宜居地带」
        def.prompt = () => '推开门，前往 Level 1「宜居地带」';
        def.use = () => {
          W.setDoor(d.id, true, true);
          BR.Audio.doorCreak();
          BR.UI.toast('门后透出不一样的光……');
          setTimeout(() => { if (BR.Game.state === 'playing') BR.Cutout.travelTo('L1', { mode: 'door' }); }, 700);
        };
      }
      W.addDoor(def);
    }
  }

  function poiList(map, type) {
    return (map.pois || []).filter(p => p.type === type);
  }

  /* ================= L0 ================= */

  /* ---------- v1.5 W2：L0 分区式空间重做（生成重做） ----------
   * gen.js 只给毛坯（4 个重叠大厅 + 半墙 + 柱阵 + 马尼拉房间），真正的空间结构在这里重写。
   * 旧版 wiki Level 0："randomly segmented rooms, hallways"、"no two rooms are identical"；
   * 连续地毯 + 吊顶 + 荧光灯由主题提供。做法（v1.5 W2 分区式）：
   *  1) 外轮廓咬边：把大厅矩形外轮廓啃出不规则缺口（只挖墙→地）；
   *  2) 4×4 分区定性：开阔区 / 连续隔断区 / 柱密区 / 短暂狭窄区
   *     （保底：开阔≥2、隔断≥2、柱密≥1、狭窄≥1）；
   *  3) 分区施工：不同长度（3~9）墙段、半隔断（不贴区边）、1~2 个宽窄不一（1~4）的开口，
   *     双段同线相邻段开口强制错位；段端偶发转角延伸（转角遮挡 + 偶发局部死路）；
   *     柱密区为偏心柱群（抖动网格 + 随机整体偏移，8 邻域不相连）；狭窄区为平行双墙夹 2 tile 短窄道；
   *  4) 分区间连接：相邻分区边界开 1~2 个 3~5 tile 宽开口（只拆自己砌的墙），
   *     偶发渐窄过渡（阶梯短墙漏斗）；大空间之间用宽开口/墙体缺口连接，不全靠细隧道；
   *  5) 单向修改（只地→墙；马尼拉整块 + 门 + 全部 POI + 房间中心受保护），
   *     收尾全地板 BFS、只拆自己砌的墙，保证出生点能走到每一块地板
   *     （不许整区块封闭；允许少量局部死路）。
   * 回环：分区边界多开口天然形成回环；分支：隔断段 + 柱群形成多方向分支。
   * 确定性：独立 RNG 流 new BR.RNG(seed ^ 0x51F7A9)，禁用 Math.random/Date。
   * 时机：W.build 中 buildContent 先于区块几何构建执行，改 map.tiles 对几何/碰撞/灯具同时生效。
   */
  BR.Levels.L0.recarveMap = function (map) {
    if (!map || map.level !== 'L0') return;
    var MW = map.w, MH = map.h;
    var rng = new BR.RNG((map.seed ^ 0x51F7A9) >>> 0);
    var TI = function (x, y) { return y * MW + x; };
    var inB = function (x, y) { return x >= 2 && y >= 2 && x <= MW - 3 && y <= MH - 3; };

    // ---- 保护区：马尼拉整块（含门与外圈）、全部 POI tile、房间中心点 ----
    var prot = {};
    var protect = function (x, y) { if (x >= 0 && y >= 0 && x < MW && y < MH) prot[TI(x, y)] = 1; };
    map.pois.forEach(function (p) {
      protect(p.tx, p.ty);
      if (p.type === 'manila_room' && p.data) {
        for (var yy = p.data.y0 - 1; yy <= p.data.y1 + 1; yy++)
          for (var xx = p.data.x0 - 1; xx <= p.data.x1 + 1; xx++) protect(xx, yy);
      }
      if (p.type === 'thin_wall' && p.data) protect(p.tx + (p.data.dx || 0), p.ty + (p.data.dz || 0));
      if (p.type === 'anomaly_wall' && p.data) protect(p.tx + (p.data.dirx || 0), p.ty + (p.data.dirz || 0));
      // v1.5.1：涂鸦背后的墙也保护——防止 recarve 挖掉导致贴花浮空（data 存墙→房间法线，墙在 tile-n 方向）
      if ((p.type === 'graffiti' || p.type === 'fun_graffiti') && p.data && (p.data.nx || p.data.nz))
        protect(p.tx - p.data.nx, p.ty - p.data.nz);
    });
    // v1.5.1：L0 边界豁口通道（gen.js openL0Borders 挖的）不受分区施工重写
    (map.meta.l0BorderCorr || []).forEach(function (i) { prot[i] = 1; });
    map.doors.forEach(function (d) { protect(d.tx, d.ty); });
    (map.rooms || []).forEach(function (r) { protect(Math.round(r.cx), Math.round(r.cy)); });

    var doorSet = {};
    map.doors.forEach(function (d) { doorSet[TI(d.tx, d.ty)] = 1; });
    var passable = function (x, y) {
      if (x < 0 || y < 0 || x >= MW || y >= MH) return false;
      var i = TI(x, y);
      return map.tiles[i] === 1 || !!doorSet[i];
    };

    // ---- 1) 外轮廓咬边：两遍，啃掉贴边墙 ----
    var carved = 0, ps, ex, ey;
    for (ps = 0; ps < 2; ps++) {
      for (ey = 2; ey <= MH - 3; ey++) for (ex = 2; ex <= MW - 3; ex++) {
        var ei = TI(ex, ey);
        if (map.tiles[ei] !== 0 || prot[ei]) continue;
        var f4 = 0, f8 = 0;
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          if (map.tiles[TI(ex + ox, ey + oy)] === 1) { f8++; if (!ox || !oy) f4++; }
        }
        if (f4 >= 1 && f8 <= 4 && rng.chance(0.30)) { map.tiles[ei] = 1; carved++; }
      }
    }

    // ---- 2) 分区定性：4×4 分区（每区 14×14 tiles），保底每种性格 ≥ 指定数 ----
    // 只有有地板的分区才参与定性（大厅只覆盖上部约 2/3，底部行为空洞 void）
    var ZN = 4, ZW = 14, zkind = [], zi;
    var zrect = function (i) {
      return [Math.max(2, (i % ZN) * ZW), Math.max(2, ((i / ZN) | 0) * ZW)];
    };
    var zfloor = [], zactive = [];
    for (zi = 0; zi < ZN * ZN; zi++) {
      var zr = zrect(zi), zx0 = zr[0], zy0 = zr[1];
      var zx1 = Math.min(MW - 3, zx0 + ZW - 1), zy1 = Math.min(MH - 3, zy0 + ZW - 1), fl = 0;
      for (var zy = zy0; zy <= zy1; zy++)
        for (var zx = zx0; zx <= zx1; zx++) if (map.tiles[TI(zx, zy)] === 1) fl++;
      zfloor.push(fl);
      zactive.push(fl >= 30);
    }
    var wpick = function (pairs) {
      var r = rng.next(), acc = 0;
      for (var i = 0; i < pairs.length; i++) { acc += pairs[i][1]; if (r < acc) return pairs[i][0]; }
      return pairs[pairs.length - 1][0];
    };
    // v2.4 W-l0gen：经典后室是"单调隔间"而非关卡式分区——权重向 part 倾斜，
    // open/narrow 只保留少量（保底数不动：test-gen.js 断言 open≥2/part≥2/pilar≥1/narrow≥1），
    // 让"到处都一样"的重复压抑感成为主调；柱密区保留（经典柱林）。
    for (zi = 0; zi < ZN * ZN; zi++)
      zkind.push(zactive[zi] ? wpick([['open', 0.15], ['part', 0.50], ['pilar', 0.25], ['narrow', 0.10]]) : 'void');
    var zneed = { open: 2, part: 2, pilar: 1, narrow: 1 }, zg = 0, zkk;
    while (zg++ < 80) { // 保底循环：每次补一个缺额，必收敛（活跃区远多于需求 6）
      var zok = true;
      for (zkk in zneed) {
        var zc = 0;
        for (zi = 0; zi < zkind.length; zi++) if (zkind[zi] === zkk) zc++;
        if (zc < zneed[zkk]) {
          zok = false;
          var ri2;
          do { ri2 = rng.int(0, zkind.length - 1); } while (!zactive[ri2]);
          zkind[ri2] = zkk; break;
        }
      }
      if (zok) break;
    }
    var zcount = { open: 0, part: 0, pilar: 0, narrow: 0, void: 0 };
    for (zi = 0; zi < zkind.length; zi++) zcount[zkind[zi]]++;

    // ---- 3) 分区施工 ----
    var myWalls = {}, nSeg = 0, nDbl = 0, nCorner = 0, nPillar = 0, nGate = 0, nFunnel = 0;
    var buildWall = function (x, y) {
      if (!inB(x, y)) return;
      var i = TI(x, y);
      if (prot[i] || map.tiles[i] !== 1) return;
      map.tiles[i] = 0; myWalls[i] = 1;
    };
    var clearMyWall = function (x, y) {
      if (x < 0 || y < 0 || x >= MW || y >= MH) return;
      var i = TI(x, y);
      if (myWalls[i]) { map.tiles[i] = 1; delete myWalls[i]; }
    };
    // 一段隔墙：起点 (sx,sy)，沿 (dx,dy) 走 len 格；prevGap 为同线上一段开口中心（错位用）
    var drawSeg = function (sx, sy, dx, dy, len, prevGap) {
      var gw = Math.min(rng.int(1, 4), len); // 开口宽窄不一
      var ng = 1 + (rng.chance(0.5) ? 1 : 0);
      var gaps = [], g;
      for (g = 0; g < ng; g++) {
        var gs = rng.int(0, Math.max(0, len - gw));
        var gc = gs + (gw - 1) / 2;
        if (prevGap != null && Math.abs(gc - prevGap) < 3) { // 错位开口
          gs += (gc < prevGap ? -1 : 1) * (2 + rng.int(0, 2));
          gs = Math.max(0, Math.min(Math.max(0, len - gw), gs));
          gc = gs + (gw - 1) / 2;
        }
        gaps.push([gs, gs + gw - 1]);
        prevGap = gc;
      }
      var inGap = function (k, gl) {
        for (var q = 0; q < gl.length; q++)
          if (k >= gl[q][0] && k <= gl[q][1]) return true;
        return false;
      };
      for (var k = 0; k < len; k++) if (!inGap(k, gaps)) buildWall(sx + dx * k, sy + dy * k);
      nSeg++;
      var exx = sx + dx * (len - 1), eyy = sy + dy * (len - 1);
      for (var e = 0; e < 2; e++) { // 段端转角延伸：转角遮挡，偶发形成局部死路
        if (!rng.chance(0.20)) continue;
        var bx = e ? exx : sx, by = e ? eyy : sy;
        var sd = rng.chance(0.5) ? 1 : -1;
        var px = -dy * sd, py = dx * sd, ext = 2 + rng.int(0, 2);
        for (var k3 = 1; k3 <= ext; k3++) buildWall(bx + px * k3, by + py * k3);
        nCorner++;
      }
      return prevGap;
    };
    // 独立柱：8 邻域全空才立柱（偏心由调用方给抖动坐标）
    var putPillar = function (x, y) {
      if (!inB(x, y)) return false;
      var pi = TI(x, y);
      if (prot[pi] || map.tiles[pi] !== 1) return false;
      for (var ay = -1; ay <= 1; ay++) for (var ax = -1; ax <= 1; ax++) {
        if (!ax && !ay) continue;
        var ni = TI(x + ax, y + ay);
        if (map.tiles[ni] !== 1 || prot[ni]) return false;
      }
      map.tiles[pi] = 0; myWalls[pi] = 1; nPillar++;
      return true;
    };
    var scatterPillars = function (x0, y0, x1, y1, count) {
      var gd = 0, done = 0;
      while (done < count && gd++ < 60) {
        if (x0 > x1 || y0 > y1) break;
        if (putPillar(rng.int(x0, x1), rng.int(y0, y1))) done++;
      }
    };
    for (zi = 0; zi < zkind.length; zi++) {
      var qx0 = Math.max(2, (zi % ZN) * ZW), qy0 = Math.max(2, ((zi / ZN) | 0) * ZW);
      var qx1 = Math.min(MW - 3, qx0 + ZW - 1), qy1 = Math.min(MH - 3, qy0 + ZW - 1);
      var qk = zkind[zi], sgi, hz, ln, wx, wy;
      if (qk === 'void') continue; // 空洞分区不施工
      if (qk === 'open') {
        // 开阔区：偶发半隔断 + 偏心散柱，保持开阔
        // v2.4 W-l0gen：开阔区也不许完全空（0.35→0.5），否则大片白地像竞技场不像后室
        if (rng.chance(0.50)) {
          hz = rng.chance(0.5); ln = rng.int(3, 6);
          wx = rng.int(qx0 + 2, Math.max(qx0 + 2, qx1 - (hz ? ln : 1) - 2));
          wy = rng.int(qy0 + 2, Math.max(qy0 + 2, qy1 - (hz ? 1 : ln) - 2));
          drawSeg(wx, wy, hz ? 1 : 0, hz ? 0 : 1, ln, null);
        }
        scatterPillars(qx0 + 1, qy0 + 1, qx1 - 1, qy1 - 1, rng.int(3, 6));
      } else if (qk === 'part') {
        // 连续隔断区：1~2 组"双段同线"（两段之间留 2~4 格缺口，同线相邻段开口强制错位）
        // ＋偶发单段；全部半隔断（不贴区边）
        // v2.4 W-l0gen：隔断加密（经典后室=隔间重复）——双段组 2~3 组，单段概率 0.5→0.65
        var nd = 2 + rng.int(0, 1), di;
        for (di = 0; di < nd; di++) {
          hz = rng.chance(0.5);
          var l1 = rng.int(3, 6), l2 = rng.int(3, 6), gb = rng.int(2, 4);
          var tl = l1 + gb + l2, dx = hz ? 1 : 0, dy = hz ? 0 : 1;
          wx = rng.int(qx0 + 2, Math.max(qx0 + 2, qx1 - (hz ? tl : 1) - 2));
          wy = rng.int(qy0 + 2, Math.max(qy0 + 2, qy1 - (hz ? 1 : tl) - 2));
          var r1 = drawSeg(wx, wy, dx, dy, l1, null);
          drawSeg(wx + dx * (l1 + gb), wy + dy * (l1 + gb), dx, dy, l2, r1); // 错位开口
        }
        if (rng.chance(0.65)) {
          hz = rng.chance(0.5); ln = rng.int(4, 9);
          wx = rng.int(qx0 + 2, Math.max(qx0 + 2, qx1 - (hz ? ln : 1) - 2));
          wy = rng.int(qy0 + 2, Math.max(qy0 + 2, qy1 - (hz ? 1 : ln) - 2));
          drawSeg(wx, wy, hz ? 1 : 0, hz ? 0 : 1, ln, null);
        }
        if (rng.chance(0.5)) scatterPillars(qx0 + 1, qy0 + 1, qx1 - 1, qy1 - 1, rng.int(2, 4));
      } else if (qk === 'pilar') {
        // 柱密区：偏心柱群（间距 3 网格 + 随机整体偏移 + 22% 随机缺柱；
        // 每根 30% 概率再抖动 ±1，抖位放不下则回落到网格位；8 邻域不相连，不可能围死人）
        var ox = rng.int(0, 2), oy = rng.int(0, 2), cy2, cx2;
        for (cy2 = qy0 + 1 + oy; cy2 <= qy1 - 1; cy2 += 3)
          for (cx2 = qx0 + 1 + ox; cx2 <= qx1 - 1; cx2 += 3) {
            if (rng.chance(0.22)) continue;
            var jx = cx2, jy = cy2;
            if (rng.chance(0.3)) { jx += rng.int(-1, 1); jy += rng.int(-1, 1); }
            if (!putPillar(jx, jy)) putPillar(cx2, cy2);
          }
      } else {
        // 短暂狭窄区：平行双墙夹 2 tile 窄道（6~10 长），两端清出宽开口
        hz = rng.chance(0.5); ln = rng.int(6, 10);
        wx = rng.int(qx0 + 3, Math.max(qx0 + 3, qx1 - (hz ? ln : 4) - 3));
        wy = rng.int(qy0 + 3, Math.max(qy0 + 3, qy1 - (hz ? 4 : ln) - 3));
        var kk3, exx2, eoo;
        if (hz) {
          for (kk3 = 0; kk3 < ln; kk3++) { buildWall(wx + kk3, wy); buildWall(wx + kk3, wy + 3); }
          for (exx2 = -1; exx2 <= 1; exx2++)
            for (eoo = 1; eoo <= 2; eoo++) {
              clearMyWall(wx - eoo, wy + 1 + exx2); clearMyWall(wx + ln - 1 + eoo, wy + 1 + exx2);
            }
        } else {
          for (kk3 = 0; kk3 < ln; kk3++) { buildWall(wx, wy + kk3); buildWall(wx + 3, wy + kk3); }
          for (exx2 = -1; exx2 <= 1; exx2++)
            for (eoo = 1; eoo <= 2; eoo++) {
              clearMyWall(wx + 1 + exx2, wy - eoo); clearMyWall(wx + 1 + exx2, wy + ln - 1 + eoo);
            }
        }
        nDbl++;
      }
    }

    // ---- 4) 分区间连接：相邻分区边界开 1~2 个 3~5 tile 宽开口（只拆自己砌的墙） ----
    // 大空间之间用宽开口/墙体缺口连接，不全靠细隧道；25% 概率做渐窄过渡（阶梯短墙漏斗）
    var zoneGate = function (bx0, by0, bx1, by1) {
      var len = Math.max(bx1 - bx0, by1 - by0) + 1;
      var ng = 1 + (rng.chance(0.5) ? 1 : 0), gi;
      for (gi = 0; gi < ng; gi++) {
        var gw = rng.int(3, 5);
        var gs = rng.int(0, Math.max(0, len - gw)), ge = gs + gw - 1, kk;
        var vert = (bx0 === bx1);
        for (kk = gs; kk <= ge; kk++) {
          var gx = vert ? bx0 : bx0 + kk, gy = vert ? by0 + kk : by0;
          for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++)
            clearMyWall(gx + ox, gy + oy);
        }
        nGate++;
        if (rng.chance(0.25)) { // 渐窄过渡：门洞两端各加一段 2 格阶梯短墙，形成漏斗
          for (var e = 0; e < 2; e++) {
            var ee = (e === 0 ? gs - 1 : ge + 1), s2;
            for (s2 = 1; s2 <= 2; s2++) {
              if (vert) { buildWall(bx0 - s2, by0 + ee); buildWall(bx0 + s2, by0 + ee); }
              else { buildWall(bx0 + ee, by0 - s2); buildWall(bx0 + ee, by0 + s2); }
            }
          }
          nFunnel++;
        }
      }
    };
    var gzx, gzy;
    for (gzy = 0; gzy < ZN; gzy++) for (gzx = 0; gzx < ZN; gzx++) {
      var bxx = (gzx + 1) * ZW, byy = (gzy + 1) * ZW;
      var ziA = gzy * ZN + gzx;
      if (gzx + 1 < ZN && bxx >= 2 && bxx <= MW - 3 &&
          zactive[ziA] && zactive[ziA + 1]) // 只在两个活跃分区之间开门
        zoneGate(bxx, Math.max(2, gzy * ZW), bxx, Math.min(MH - 3, (gzy + 1) * ZW - 1));
      if (gzy + 1 < ZN && byy >= 2 && byy <= MH - 3 &&
          zactive[ziA] && zactive[ziA + ZN])
        zoneGate(Math.max(2, gzx * ZW), byy, Math.min(MW - 3, (gzx + 1) * ZW - 1), byy);
    }

    // ---- 5) 连通修复：只拆自己砌的墙 ----
    // 0-1 BFS：从所有不可达地板出发，穿地板 cost 0、穿 myWall cost 1、原墙不可穿；
    // 每轮拆除"贴着可达区且离不可达区最近"的 myWall（bridge 即 cost==1 的特例，
    // 拐角连拆的"帽子"情形也能逐轮啃开）。原图全连通，故必收敛。
    var spawn = null;
    map.pois.forEach(function (p) { if (p.type === 'spawn') spawn = p; });
    function bfsReach() {
      var dist = new Int32Array(MW * MH).fill(-1);
      var qx = [spawn.tx], qy = [spawn.ty], head = 0;
      if (!passable(spawn.tx, spawn.ty)) return dist;
      dist[TI(spawn.tx, spawn.ty)] = 0;
      while (head < qx.length) {
        var x = qx[head], y = qy[head]; head++;
        var d0 = dist[TI(x, y)];
        var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var k = 0; k < 4; k++) {
          var nx = x + nb[k][0], ny = y + nb[k][1];
          if (!passable(nx, ny)) continue;
          var ni = TI(nx, ny);
          if (dist[ni] !== -1) continue;
          dist[ni] = d0 + 1; qx.push(nx); qy.push(ny);
        }
      }
      return dist;
    }
    function bfsCost(dist) {
      var INF = 1e9, c2 = new Int32Array(MW * MH).fill(INF), dq = [];
      for (var y = 0; y < MH; y++) for (var x = 0; x < MW; x++) {
        var i = TI(x, y);
        if ((map.tiles[i] === 1 || doorSet[i]) && dist[i] < 0) { c2[i] = 0; dq.unshift(i); }
      }
      while (dq.length) {
        var cur = dq.shift(), cx = cur % MW, cy = ((cur / MW) | 0);
        var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var k = 0; k < 4; k++) {
          var nx = cx + nb[k][0], ny = cy + nb[k][1];
          if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
          var ni = TI(nx, ny), mine = !!myWalls[ni];
          if (map.tiles[ni] !== 1 && !doorSet[ni] && !mine) continue; // 原墙不可穿
          var nc = c2[cur] + (mine ? 1 : 0);
          if (nc < c2[ni]) { c2[ni] = nc; if (mine) dq.push(ni); else dq.unshift(ni); }
        }
      }
      return c2;
    }
    var repaired = 0;
    for (var it = 0; it < 500; it++) {
      var dist = bfsReach(), bad = false, sx2, sy2;
      for (sy2 = 1; sy2 < MH - 1 && !bad; sy2++) for (sx2 = 1; sx2 < MW - 1; sx2++) {
        if (passable(sx2, sy2) && dist[TI(sx2, sy2)] < 0) { bad = true; break; }
      }
      if (!bad) break;
      var c2 = bfsCost(dist), best = Infinity, cand = [], key;
      for (key in myWalls) {
        var ki = +key, wx = ki % MW, wy = ((ki / MW) | 0), touchR = false;
        var nb2 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var b = 0; b < 4; b++) {
          var ax = wx + nb2[b][0], ay = wy + nb2[b][1];
          if (passable(ax, ay) && dist[TI(ax, ay)] >= 0) { touchR = true; break; }
        }
        if (!touchR) continue;
        var d2 = c2[ki];
        if (d2 < best) { best = d2; cand = [ki]; }
        else if (d2 === best) cand.push(ki);
      }
      if (!cand.length) break; // 理论上到不了：原图全连通
      for (var r2 = 0; r2 < cand.length; r2++) {
        map.tiles[cand[r2]] = 1; delete myWalls[cand[r2]]; repaired++;
      }
    }

    map.meta.l0recarve = {
      carved: carved, segs: nSeg, dbl: nDbl, corner: nCorner,
      pillars: nPillar, repaired: repaired, walls: Object.keys(myWalls).length,
      zones: zcount, zoneKinds: zkind, gates: nGate, funnels: nFunnel
    };
  };

  BR.Levels.L0.buildContent = function (map, W) {
    BR.Levels.L0.recarveMap(map); // v1.5 W2：分区式空间重写（马尼拉/门/POI 受保护）
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
    // v1.5.1：L0 主出口（游戏性改编）——金属门 + 绿色 EXIT 灯牌 + 门缝透光
    // v2.2 W-exits：可发现性加强——灯牌加大+双面、绿色光柱（房间内远处可见）、
    // 点光增强、常驻电流声引导（60m 内按距离衰减+声像，换关自动清理）。
    poiList(map, 'main_exit').forEach(p => {
      const dx = (p.data.fx - p.tx), dz = (p.data.fy - p.ty); // 门 → 房间内方向
      const nx = Math.sign(dx), nz = Math.sign(dz);
      W.addChunkContent(p.tx, p.ty, (group) => {
        const wx = BR.tileCX(p.tx), wz = BR.tileCZ(p.ty);
        const faceA = Math.atan2(nx, nz);
        // 绿色 EXIT 灯牌（canvas 手绘），双面
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
        const g2 = cv.getContext('2d');
        g2.fillStyle = '#061206'; g2.fillRect(0, 0, 256, 96);
        g2.strokeStyle = '#39ff6a'; g2.lineWidth = 6; g2.strokeRect(4, 4, 248, 88);
        g2.fillStyle = '#39ff6a'; g2.font = 'bold 56px sans-serif';
        g2.textAlign = 'center'; g2.textBaseline = 'middle';
        g2.fillText('EXIT', 128, 52);
        const signTex = new THREE.CanvasTexture(cv);
        const signMat = new THREE.MeshBasicMaterial({ map: signTex });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.7), signMat);
        sign.position.set(wx + nx * 0.35, 2.35, wz + nz * 0.35);
        sign.rotation.y = faceA; W.reg(group, sign);
        const signBack = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.7), signMat);
        signBack.position.copy(sign.position);
        signBack.rotation.y = faceA + Math.PI; W.reg(group, signBack);
        // 门缝透光：门底一条冷白色光带（房间内侧）
        const slit = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.8, 0.09),
          new THREE.MeshBasicMaterial({ color: 0xd8f4ff }));
        slit.position.set(wx + nx * (T / 2 - 0.06), 0.055, wz + nz * (T / 2 - 0.06));
        slit.rotation.y = faceA; W.reg(group, slit);
        // 绿色光柱：房间内远处可见的垂直信标
        const wallH = (W.theme && W.theme.wallH) || 2.7;
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.9, 1.1, wallH, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x39ff6a, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
        shaft.position.set(wx + nx * 1.2, wallH / 2, wz + nz * 1.2);
        W.reg(group, shaft);
        // 绿色点光：增强
        const gl = new THREE.PointLight(0x39ff6a, 1.15, 18, 2);
        gl.position.set(wx + nx * 1.2, 2.3, wz + nz * 1.2); W.reg(group, gl);
        // 交互走门自带的 door 交互（推门 → L1），牌子只做视觉指引
      });
      // 电流声引导（灯牌是通电的）：常驻，60m 内可闻
      ensureLoopCleanup(W, ['l0_exit_buzz']);
      BR.Audio.addLoop('l0_exit_buzz', 'buzz',
        BR.tileCX(p.tx) + nx * 1.5, BR.tileCZ(p.ty) + nz * 1.5, 0.45);
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
      ['前人的字条', '如果你看到这张字条，说明你也切出来了。\n\n别慌。跟着荧光灯走，找墙纸颜色不对的那面墙。\n\n对了：夜里如果隐约听见钢琴声，顺着走——暖光的地方是安全的，有个叫"马尼拉房间"的地方，待在里面能缓过来。\n\n——M.'],
      ['皱巴巴的字条', '第 47 天。地毯还是潮的。\n\n我发现这些房间没有两间是一样的，但出口……出口一直在"最不对劲"的地方。\n\n相信你的直觉。'],
      ['发黄的字条', '第 61 天。\n\n隔墙的位置好像和昨天不一样了。走过的路，回头就不一样。\n\n别相信记忆。跟着灯走。\n\n——M.'],
      ['潦草的字条', '别在没灯的地方待太久，脑子会坏掉。\n\n手电筒是最有用的东西——开着它，找有灯的地方走。\n\n绿色 EXIT 灯牌下面有扇门，推开能离开这里。']
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
        // v2.5 道具碰撞：中央八角圆桌按圆柱半径 1.05 登记为圆（下方 addFurniturePickup 补
        // skipPropCollider，避免再被通用 table 矩形重复登记）
        W.addPropCircle(cx, cz, 1.05);
        [[cx - 1.85, cz, Math.PI / 2], [cx + 1.85, cz, -Math.PI / 2]].forEach(pt => {
          const ch = buildChairMesh();
          ch.position.set(pt[0], 0, pt[1]); ch.rotation.y = pt[2];
          W.reg(group, ch);
          // v2.5 道具碰撞：椅子坐面 0.5×0.5，半宽/半深各 0.25，带其 rotation.y
          W.addPropBox(pt[0], pt[1], 0.25, 0.25, { rot: pt[2] });
        });
        BR.addFurniturePickup(W, {
          tx: tcx, ty: tcy, item: 'almond', suffix: 'manila_table',
          group, fx: cx, fz: cz, topY: 0.80, container: 'table',
          skipPropCollider: true
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
        pm.position.set(BR.tileCX(ptx) - n.x * (T / 2 - 0.05), 1.62, BR.tileCZ(pty) - n.z * (T / 2 - 0.05));
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
      // v1.5.1：门缝透出暖光——门外一条暖色光带，远处可见，subtle 指引
      if (door) {
        const rcx2 = (x0 + x1) / 2, rcy2 = (y0 + y1) / 2;
        let ox = 0, oz = 0;
        if (door.x < x0) ox = -1; else if (door.x > x1) ox = 1;
        else if (door.y < y0) oz = -1; else if (door.y > y1) oz = 1;
        W.addChunkContent(door.x, door.y, (group) => {
          const strip = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.85, 0.14),
            new THREE.MeshBasicMaterial({ color: 0xffb45e }));
          strip.position.set(BR.tileCX(door.x) + ox * (T / 2 - 0.03), 0.075, BR.tileCZ(door.y) + oz * (T / 2 - 0.03));
          strip.rotation.y = Math.atan2(ox, oz);
          W.reg(group, strip);
          // 淡光晕
          const glow = new THREE.Mesh(new THREE.PlaneGeometry(T * 1.6, 0.5),
            new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.28 }));
          glow.position.set(BR.tileCX(door.x) + ox * (T / 2 + 0.4), 0.28, BR.tileCZ(door.y) + oz * (T / 2 + 0.4));
          glow.rotation.y = Math.atan2(ox, oz);
          W.reg(group, glow);
        });
      }
    });
    // Systems A：FUN 涂鸦（本游戏原创机制）——墙上涂鸦 "FUN =)" + 附近地板可爬洞口 → FUN
    // gen.js placeL0 以 8% 概率放 fun_graffiti / fun_hole2 POI
    poiList(map, 'fun_graffiti').forEach(p => {
      // v1.5.1：优先用 gen 存的法线并校验背后是墙；没有就 wallNormal 找；都没有直接跳过（防浮空）
      let n = null;
      const pd = p.data || {};
      const wallAtF = (tx, ty) => { try { return W.isWall(tx, ty); } catch (e) { return false; } };
      if ((pd.nx || pd.nz) && wallAtF(p.tx - pd.nx, p.ty - pd.nz)) n = { x: pd.nx, z: pd.nz };
      if (!n) {
        const wn = wallNormal(W, p.tx, p.ty);
        if (wallAtF(p.tx - wn.x, p.ty - wn.z)) n = wn;
      }
      if (!n) return; // 无墙可贴：跳过
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
        // v1.5.1：贴墙用 -n（法线 n 为墙→房间方向；旧 +n 会把贴花放到 tile 房间一侧浮空）
        m.position.set(BR.tileCX(p.tx) - n.x * (T / 2 - 0.04), 1.55, BR.tileCZ(p.ty) - n.z * (T / 2 - 0.04));
        m.rotation.y = Math.atan2(n.x, n.z);
        W.reg(group, m);
      });
    });
    // v1.5 W2：洞口改为真实空间开口——坑 tile 翻为墙体（碰撞：玩家无法穿过坑体，
    // 只能走到坑沿）+ skipWall 跳过墙面渲染；内容钩子建造深坑几何（坑壁/坑底微光/碎裂边缘），
    // 不再是地板贴图黑圆 + 按键交互。玩家靠近坑沿即失足坠入（进入触发，见 L0.tick）。
    // 翻墙前做切面检查：若翻墙会断开连通，回退为可行走坑口
    // （setOpenFloor 跳过地板实例 + 踩入坑口中心触发）。
    poiList(map, 'fun_hole2').forEach(p => {
      const TI = (tx, ty) => ty * map.w + tx;
      const hx = BR.tileCX(p.tx), hz = BR.tileCZ(p.ty);
      const pitRng = new BR.RNG(BR.hashSeed('funpit_' + map.seed + '_' + p.tx + '_' + p.ty));
      const sp0 = map.pois.find(q => q.type === 'spawn');
      const doorSet = {};
      map.doors.forEach(d => { doorSet[TI(d.tx, d.ty)] = 1; });
      const pass0 = (x, y) => {
        if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
        const i = TI(x, y);
        return map.tiles[i] === 1 || !!doorSet[i];
      };
      // 切面检查：假设坑 tile 不可走，出生点仍须能走到其余全部地板
      const seen = new Uint8Array(map.w * map.h);
      const qx = [sp0.tx], qy = [sp0.ty];
      let solid = true, qh = 0;
      if (pass0(sp0.tx, sp0.ty)) seen[TI(sp0.tx, sp0.ty)] = 1;
      const nb4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      while (qh < qx.length) {
        const x = qx[qh], y = qy[qh]; qh++;
        for (let k = 0; k < 4; k++) {
          const nx = x + nb4[k][0], ny = y + nb4[k][1];
          if (!pass0(nx, ny) || (nx === p.tx && ny === p.ty)) continue;
          const ni = TI(nx, ny);
          if (seen[ni]) continue;
          seen[ni] = 1; qx.push(nx); qy.push(ny);
        }
      }
      outer: for (let yy = 1; yy < map.h - 1; yy++)
        for (let xx = 1; xx < map.w - 1; xx++) {
          if (!pass0(xx, yy) || (xx === p.tx && yy === p.ty)) continue;
          if (!seen[TI(xx, yy)]) { solid = false; break outer; }
        }
      if (solid) {
        map.tiles[TI(p.tx, p.ty)] = 0; // 翻为墙：碰撞（坑沿挡住玩家）
        W.skipWall(p.tx, p.ty);        // 跳过墙面渲染，由钩子建深坑
      } else {
        W.setOpenFloor(p.tx, p.ty);    // 回退：可行走坑口（极少发生）
      }
      W.addChunkContent(p.tx, p.ty, (group) => {
        const mouth = solid ? T * 0.96 : T * 0.55; // 实心坑整 tile 开口；可行走坑口中央小口
        const hw = mouth / 2, depth = 2.6;
        const dark = new THREE.MeshLambertMaterial({ color: 0x0a0908 });
        const mkShaftWall = (w, px, pz, ry) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(w, depth), dark);
          m.position.set(px, -depth / 2 + 0.02, pz); m.rotation.y = ry;
          W.reg(group, m);
        };
        mkShaftWall(mouth, hx, hz - hw, 0);
        mkShaftWall(mouth, hx, hz + hw, Math.PI);
        mkShaftWall(mouth, hx - hw, hz, Math.PI / 2);
        mkShaftWall(mouth, hx + hw, hz, -Math.PI / 2);
        // 坑底：黑暗 + 隐约的品红微光（派对声光从下面透上来）
        const bot = new THREE.Mesh(new THREE.PlaneGeometry(mouth, mouth),
          new THREE.MeshBasicMaterial({ color: 0x050304 }));
        bot.rotation.x = -Math.PI / 2; bot.position.set(hx, -depth, hz);
        W.reg(group, bot);
        const glow = new THREE.PointLight(0xff4fd8, 0.85, 7, 2);
        glow.position.set(hx, -depth + 0.7, hz);
        W.reg(group, glow);
        if (!solid) {
          // 可行走坑口：在原地板位置铺带方洞的地板环（地板实例已被 setOpenFloor 跳过）
          const shape = new THREE.Shape();
          shape.moveTo(-T / 2, -T / 2); shape.lineTo(T / 2, -T / 2);
          shape.lineTo(T / 2, T / 2); shape.lineTo(-T / 2, T / 2); shape.closePath();
          const holePath = new THREE.Path();
          holePath.moveTo(-hw, -hw); holePath.lineTo(hw, -hw);
          holePath.lineTo(hw, hw); holePath.lineTo(-hw, hw); holePath.closePath();
          shape.holes.push(holePath);
          const fg = new THREE.Mesh(new THREE.ShapeGeometry(shape), W.mat(W.theme.floor || 'carpet'));
          fg.rotation.x = -Math.PI / 2; fg.position.set(hx, 0.001, hz);
          W.reg(group, fg);
        }
        // 碎裂边缘：确定性碎石块围住坑口
        const rubble = new THREE.MeshLambertMaterial({ color: 0x8a8578 });
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 + pitRng.next() * 0.5;
          const rr = hw + 0.12 + pitRng.next() * 0.25;
          const s = 0.16 + pitRng.next() * 0.22;
          const rock = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s * 0.9), rubble);
          rock.position.set(hx + Math.cos(a) * rr, s * 0.28, hz + Math.sin(a) * rr);
          rock.rotation.set(pitRng.next() * 0.6, pitRng.next() * Math.PI, pitRng.next() * 0.6);
          W.reg(group, rock);
        }
        // 隐约的派对音乐
        BR.Audio.addLoop('funhole2_' + p.tx + '_' + p.ty, 'flicker', hx, hz, 0.12);
      });
      W._funPit = { x: hx, z: hz, solid: solid };
    });
    buildThinWalls(map, W);
    // v2.2 W-exits：通风管（固定映射 L0→L1，绿色边框）+ M.E.G. 管路图字条
    buildVents(map, W, 'L0');
    W.objective = '探索 Level 0，找到那面"不太对劲"的墙——或绿色 EXIT 门、绿色边框通风管';
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
    // v1.5.1：钢琴声传播加大——32m 外隐约可闻（音量随距离），14m 内正常音量。 subtle 指引，不破坏氛围。
    if (W._manila) {
      const dM = Math.hypot(P.pos.x - W._manila.x, P.pos.z - W._manila.z);
      const inM = dM < 6.5, nearM = dM < 14, hearM = dM < 32;
      // 靠近：L0 嗡鸣减弱 + 舒缓钢琴曲；离开：恢复
      if (hearM && !W._manilaPiano) {
        W._manilaPiano = true; W._manilaPianoFar = !nearM;
        BR.Audio.manilaPianoStart(); BR.Audio.manilaHumDuck(true);
        if (W._manilaPianoFar) BR.Audio.manilaPianoLevel(0.35);
      } else if (!hearM && W._manilaPiano) {
        W._manilaPiano = false;
        BR.Audio.manilaPianoStop(); BR.Audio.manilaHumDuck(false);
      } else if (W._manilaPiano && !!W._manilaPianoFar === nearM) {
        // 跨过 14m 边界时调整音量
        W._manilaPianoFar = !nearM;
        BR.Audio.manilaPianoLevel(nearM ? 1 : 0.35);
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
    // FUN 深坑（v1.5 W2）：真实空间开口 + 碰撞（坑沿挡住）+ 进入触发。
    // 靠近坑沿即失足坠入 → FUN，不再是按键交互。
    if (W._funPit && !BR.Cutout.busy) {
      const fp = W._funPit;
      const dp = Math.hypot(P.pos.x - fp.x, P.pos.z - fp.z);
      if (dp < (fp.solid ? 2.0 : 0.95)) {
        W._funPit = null; // 防止重复触发
        BR.UI.toast('你脚下一滑，掉了进去……', 2200);
        BR.Cutout.travel('FUN', { kind: 'hole' });
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

  /* v1.5: levels.js 拆分，共享 helpers 给 levels2.js */
  BR._lvShare = { ITEM_NAME, wallNormal, addNote, buildGraffitiDecals, manilaPosterTexture, buildChairMesh, addTablePaper, manilaOverlay, itemMesh, addPickup, interactKeyLabel, markLiveOpened, wasLiveOpened, setLidOpenPose, animLidOpen, setCabinetDoorOpen, setCabinetDoorClosed, animCabinetDoorClose, animCabinetDoor, boxGeo, sphGeo, cylGeo, coneGeo, addPropShadow, buildCrateMesh, spawnInnerPickup, wireCrateTwoStage, addCrate, addBerryBush, buildThinWalls, thinWallTick, wildCutout, noclipRandom, buildTableMesh, buildCabinetMesh, buildFurnitureMesh, addFurniturePickup, addCabinetTwoStage, buildDoors, poiList, buildVents, ensureLoopCleanup, Container: BR.Container };
})();
