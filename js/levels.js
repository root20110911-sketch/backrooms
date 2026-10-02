/* levels.js —— 五关主题 + 关卡内容搭建（门/道具/事件/目标） */
(function () {
  const BR = window.BR;
  const T = BR.TILE;

  const ITEM_NAME = { almond: '杏仁水', bandage: '绷带', flashlight: '手电筒' };

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

  function addCrate(W, poi) {
    const tx = poi.tx, ty = poi.ty;
    const id = 'crate_' + tx + '_' + ty;
    W.addChunkContent(tx, ty, (group) => {
      const g = new THREE.Group();
      g.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
      const wood = W.mat('crate');
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.8, 1.05), wood);
      box.position.y = 0.4; g.add(box);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 1.05), wood);
      lid.position.y = 0.86; g.add(lid);
      W.reg(group, g);
      const opened = W.state.openedCrates.includes(id);
      if (opened) { lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0); }
      W.addInteractable({
        id, kind: 'crate', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: [box, lid], pos: g.position.clone().add(new THREE.Vector3(0, 1, 0)), radius: 2.6,
        prompt: () => W.state.openedCrates.includes(id) ? '空板条箱' : '打开板条箱',
        canUse: () => !W.state.openedCrates.includes(id),
        use: () => {
          if (W.state.openedCrates.includes(id)) return;
          lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0);
          BR.Audio.doorCreak();
          W.state.openedCrates.push(id);
          BR.bus.emit('crate:opened', { id });
          const item = poi.data.item || 'empty';
          if (item === 'empty') {
            BR.UI.toast('箱子里只有灰尘。');
          } else if (item === 'flashlight') {
            BR.Player.hasFlashlight = true;
            BR.UI.toast('找到了手电筒！（按 F / 🔦 开关）');
            BR.Audio.pickup();
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
      const dx = p.data.dirx || 0, dz = p.data.dirz || 1;
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
    // 马尼拉房间：Level 0 的安全屋（暖光+补给+回理智）
    poiList(map, 'manila_room').forEach(p => {
      const cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
      W.addChunkContent(p.tx, p.ty, (group) => {
        const L = new THREE.PointLight(0xffc37a, 1.6, 20, 2);
        L.position.set(cx, 2.3, cz);
        W.reg(group, L);
        const rug = new THREE.Mesh(new THREE.PlaneGeometry(T * 2.2, T * 2.2),
          new THREE.MeshBasicMaterial({ map: BR.Textures.get('carpet'), color: 0xcf9a5a, transparent: true, opacity: 0.9 }));
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(cx, 0.02, cz);
        W.reg(group, rug);
      });
      // 补给箱：固定杏仁水；绷带放相邻空地
      addCrate(W, { tx: p.tx, ty: p.ty, data: { item: 'almond' } });
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => !W.isWall(p.tx + dx, p.ty + dy));
      if (nb) addCrate(W, { tx: p.tx + nb[0], ty: p.ty + nb[1], data: { item: 'bandage' } });
      addNote(W, p.tx, p.ty, '马尼拉房间',
        '如果你读到这个，说明你找到了马尼拉房间。\n\n这里没有实体。灯是暖的，补给是真的。\n\n待到理智恢复再走。记住它的位置——后室里这样的地方不多。\n\n——M.');
      W._manila = { x: cx, z: cz };
      (W._safeZones = W._safeZones || []).push({ x: cx, z: cz, r: 6.5 });
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
  };

  /* ================= L1 ================= */
  BR.Levels.L1.buildContent = function (map, W) {
    buildDoors(map, W);
    // 出口长走廊起点：标识 + 提示
    poiList(map, 'exit_corridor').forEach(p => {
      W.addChunkContent(p.tx, p.ty, (group) => {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5),
          new THREE.MeshBasicMaterial({ map: BR.Textures.get('exitSign') }));
        const dx = p.data.dirx || 0, dz = p.data.dirz || 1;
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
        const dx = p.data.dirx || 0, dz = p.data.dirz || 1, len = p.data.len || 4;
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
                  W._steamTimers[v.id] = 90;
                  n2++;
                }
              }
              BR.UI.toast(n2 ? '蒸汽暂时停了（约 90 秒），快过去！' : '附近没有蒸汽泄漏');
            }
          });
        });
      });
      // 管线装饰：沿墙随机管道
      W.addChunkContent(map.rooms[0].cx | 0, map.rooms[0].cy | 0, () => {});
      // 板条箱 / 笔记
      const crate = (pp) => {
        const id = 'crate_' + pp.tx + '_' + pp.ty;
        W.addChunkContent(pp.tx, pp.ty, (group) => {
          const g = new THREE.Group();
          g.position.set(BR.tileCX(pp.tx), 0, BR.tileCZ(pp.ty));
          const wood = W.mat('crate');
          const box = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.8, 1.05), wood);
          box.position.y = 0.4; g.add(box);
          const lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 1.05), wood);
          lid.position.y = 0.86; g.add(lid);
          W.reg(group, g);
          const opened = W.state.openedCrates.includes(id);
          if (opened) { lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0); }
          const ITEM_NAME = { almond: '杏仁水', bandage: '绷带' };
          W.addInteractable({
            id, kind: 'crate', chunkKey: W.chunkKeyOf(pp.tx, pp.ty),
            meshes: [box, lid], pos: g.position.clone().add(new THREE.Vector3(0, 1, 0)), radius: 2.6,
            prompt: () => W.state.openedCrates.includes(id) ? '空板条箱' : '打开板条箱',
            canUse: () => !W.state.openedCrates.includes(id),
            use: () => {
              if (W.state.openedCrates.includes(id)) return;
              lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0);
              BR.Audio.doorCreak();
              W.state.openedCrates.push(id);
              BR.bus.emit('crate:opened', { id });
              const item = pp.data.item || 'empty';
              if (item === 'empty') BR.UI.toast('箱子里只有灰尘。');
              else {
                BR.Game.inv[item] = (BR.Game.inv[item] || 0) + 1;
                BR.UI.toast('找到了' + ITEM_NAME[item] + '！');
                BR.Audio.pickup();
              }
              BR.UI.updateInv();
            }
          });
        });
      };
      poiList(map, 'crate').forEach(crate);
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
        const dx = p.data.dirx || 0, dz = p.data.dirz || 1;
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
      poiList(map, 'power_room').forEach(p => {
        const spots = [[p.tx, p.ty], [p.tx + 2, p.ty], [p.tx - 2, p.ty], [p.tx, p.ty + 2]];
        let n = 0;
        for (const [sx, sy] of spots) {
          if (n >= 3) break;
          if (W.tile(sx, sy) !== 1) continue;
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
      // 板条箱
      poiList(map, 'crate').forEach(pp => {
        const id = 'crate_' + pp.tx + '_' + pp.ty;
        W.addChunkContent(pp.tx, pp.ty, (group) => {
          const g = new THREE.Group();
          g.position.set(BR.tileCX(pp.tx), 0, BR.tileCZ(pp.ty));
          const wood = W.mat('crate');
          const box = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.8, 1.05), wood);
          box.position.y = 0.4; g.add(box);
          const lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 1.05), wood);
          lid.position.y = 0.86; g.add(lid);
          W.reg(group, g);
          const opened = W.state.openedCrates.includes(id);
          if (opened) { lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0); }
          const ITEM_NAME = { almond: '杏仁水', bandage: '绷带' };
          W.addInteractable({
            id, kind: 'crate', chunkKey: W.chunkKeyOf(pp.tx, pp.ty),
            meshes: [box, lid], pos: g.position.clone().add(new THREE.Vector3(0, 1, 0)), radius: 2.6,
            prompt: () => W.state.openedCrates.includes(id) ? '空板条箱' : '打开板条箱',
            canUse: () => !W.state.openedCrates.includes(id),
            use: () => {
              if (W.state.openedCrates.includes(id)) return;
              lid.rotation.z = 1.9; lid.position.set(-0.5, 1.1, 0);
              BR.Audio.doorCreak();
              W.state.openedCrates.push(id);
              BR.bus.emit('crate:opened', { id });
              const item = pp.data.item || 'empty';
              if (item === 'empty') BR.UI.toast('箱子里只有灰尘。');
              else {
                BR.Game.inv[item] = (BR.Game.inv[item] || 0) + 1;
                BR.UI.toast('找到了' + ITEM_NAME[item] + '！');
                BR.Audio.pickup();
              }
              BR.UI.updateInv();
            }
          });
        });
      });
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
