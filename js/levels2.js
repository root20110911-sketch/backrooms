/* levels2.js —— L1/L2/L3/FUN 关卡内容（v1.5 由 levels.js 拆分，逻辑未动） */
(function () {
  const BR = window.BR;
  const T = BR.TILE;
  const { ITEM_NAME, wallNormal, addNote, buildGraffitiDecals, manilaPosterTexture, buildChairMesh, addTablePaper, manilaOverlay, itemMesh, addPickup, interactKeyLabel, markLiveOpened, wasLiveOpened, setLidOpenPose, animLidOpen, setCabinetDoorOpen, setCabinetDoorClosed, animCabinetDoorClose, animCabinetDoor, boxGeo, sphGeo, cylGeo, coneGeo, addPropShadow, buildCrateMesh, spawnInnerPickup, wireCrateTwoStage, addCrate, addBerryBush, buildThinWalls, thinWallTick, wildCutout, noclipRandom, buildTableMesh, buildCabinetMesh, buildFurnitureMesh, addFurniturePickup, addCabinetTwoStage, buildDoors, poiList } = BR._lvShare;

  /* ================= L1 ================= */

  /* ---------- M.E.G. 前哨交易站（POI 'meg_shop'，gen.js placeMegShopL1 放置） ----------
   * 柜台桌 + 帐篷围挡 + 暖灯 + M.E.G. 旗 + 队员 NPC。
   * NPC 是 player.js 简笔小人 avatar 的同比例复刻（圆柱身体 + 圆弧手脚 + 圆头，
   * 独立建造，不占用玩家第三人称 avatar），深蓝制服 + 作战帽 + 橙色臂章表示身份；
   * 待机摆动在 L1.tick 里做。交互 kind 'shop'（world.js 已登记）打开交易面板。 */
  function buildMegTraderNPC() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x2a3a5a }); // M.E.G. 深蓝制服
    const skin = new THREE.MeshLambertMaterial({ color: 0xd8b090 });
    const mesh = (geo, m, x, y, z) => {
      const mm = new THREE.Mesh(geo, m);
      mm.position.set(x, y, z); mm.frustumCulled = false;
      return mm;
    };
    const torso = mesh(cylGeo(0.11, 0.11, 0.62, 6), mat, 0, 1.05, 0);
    g.add(torso);
    // 橙色臂章（M.E.G. 标识，套在躯干上部）
    g.add(mesh(cylGeo(0.125, 0.125, 0.12, 6),
      new THREE.MeshLambertMaterial({ color: 0xff8c1a }), 0, 1.24, 0));
    const head = mesh(sphGeo(0.16, 10, 8), skin, 0, 1.58, 0);
    g.add(head);
    // 作战帽：圆顶 + 前檐
    const capM = new THREE.MeshLambertMaterial({ color: 0x1a2440 });
    g.add(mesh(cylGeo(0.17, 0.175, 0.1, 10), capM, 0, 1.70, 0));
    g.add(mesh(cylGeo(0.24, 0.24, 0.02, 10), capM, 0, 1.66, 0.10));
    const mkLimb = (r, len, jointR, px, py) => {
      const piv = new THREE.Group();
      piv.position.set(px, py, 0);
      piv.add(mesh(cylGeo(r, r, len, 6), mat, 0, -len / 2, 0));
      piv.add(mesh(sphGeo(jointR, 6, 4), mat, 0, -len, 0));
      g.add(piv);
      return piv;
    };
    const armL = mkLimb(0.05, 0.55, 0.065, -0.19, 1.30);
    const armR = mkLimb(0.05, 0.55, 0.065, 0.19, 1.30);
    const legL = mkLimb(0.065, 0.62, 0.085, -0.10, 0.72);
    const legR = mkLimb(0.065, 0.62, 0.085, 0.10, 0.72);
    return { group: g, torso, head, armL, armR, legL, legR };
  }

  // H 路：同 manilaPosterTexture，缓存复用（每建一次 M.E.G. 柜台就 new 一张贴图从不释放）
  let _megFlagTex = null;
  function megFlagTexture() {
    if (_megFlagTex) return _megFlagTex;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#141a28'; x.fillRect(0, 0, 512, 256);
    // 上下黄黑警示条纹（M.E.G. 标识色）
    for (let i = 0; i < 16; i++) {
      x.fillStyle = i % 2 ? '#141a28' : '#e8b820';
      x.fillRect(i * 32, 0, 32, 22); x.fillRect(i * 32, 234, 32, 22);
    }
    x.textAlign = 'center';
    x.fillStyle = '#e8b820'; x.font = 'bold 84px sans-serif';
    x.fillText('M.E.G.', 256, 128);
    x.fillStyle = '#f2f6ff'; x.font = 'bold 44px sans-serif';
    x.fillText('前哨交易站', 256, 196);
    _megFlagTex = new THREE.CanvasTexture(c);
    return _megFlagTex;
  }

  function buildMegShop(W, p) {
    const tx = p.tx, ty = p.ty;
    const cx = BR.tileCX(tx), cz = BR.tileCZ(ty);
    const n = wallNormal(W, tx, ty); // 指向房间内部的法线：NPC 背靠墙，柜台朝房间
    const chunkKey = W.chunkKeyOf(tx, ty);
    const wallH = W.theme.wallH || 3.4;
    W.addChunkContent(tx, ty, (group) => {
      const reg = (o) => W.reg(group, o);
      const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
      // —— 队员 NPC（柜台后，背靠墙） ——
      const npc = buildMegTraderNPC();
      const nx = cx - n.x * 1.0, nz = cz - n.z * 1.0;
      npc.group.position.set(nx, 0, nz);
      npc.group.rotation.y = Math.atan2(-n.x, -n.z);
      reg(npc.group);
      W._shopNPC = Object.assign({ t: 0 }, npc);
      // —— 柜台桌（NPC 与玩家之间） ——
      const counter = new THREE.Group();
      const top = new THREE.Mesh(boxGeo(1.8, 0.1, 0.9), lam(0x6f5233));
      top.position.y = 0.85; counter.add(top);
      const legG = boxGeo(0.1, 0.85, 0.1);
      const legM = lam(0x4a3013);
      [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]].forEach(([lx, lz]) => {
        const l = new THREE.Mesh(legG, legM); l.position.set(lx, 0.425, lz); counter.add(l);
      });
      // 台面摆几瓶"样品"杏仁水（装饰，不可拿）
      const bottleM = lam(0xd8c890);
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(cylGeo(0.07, 0.07, 0.28, 8), bottleM);
        b.position.set(-0.55 + i * 0.3, 1.04, (i % 2) * 0.2 - 0.1);
        counter.add(b);
      }
      const ccx = cx + n.x * 0.35, ccz = cz + n.z * 0.35;
      counter.position.set(ccx, 0, ccz);
      counter.rotation.y = Math.atan2(n.x, n.z);
      reg(counter);
      // —— 帐篷：四柱 + 帆布顶 ——
      const tent = new THREE.Group();
      const poleM = lam(0x3a3f45);
      const poleG = cylGeo(0.05, 0.05, 2.4, 8);
      [[-1.5, -1.1], [1.5, -1.1], [-1.5, 1.1], [1.5, 1.1]].forEach(([ox, oz]) => {
        const pole = new THREE.Mesh(poleG, poleM);
        pole.position.set(ox, 1.2, oz); tent.add(pole);
      });
      const cloth = new THREE.Mesh(boxGeo(3.5, 0.08, 2.7), lam(0x7a7448));
      cloth.position.y = 2.42; tent.add(cloth);
      tent.position.set(ccx, 0, ccz);
      tent.rotation.y = Math.atan2(n.x, n.z);
      reg(tent);
      // —— 两侧围挡（矮板，黄黑条纹漆） ——
      const barM = lam(0x8a7a2a);
      const ba = Math.atan2(n.x, n.z);
      [-1, 1].forEach(s => {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 2.4), barM);
        bar.position.set(ccx + n.z * s * 1.7, 0.45, ccz - n.x * s * 1.7);
        bar.rotation.y = ba; // 长轴顺柜台朝向（前后）
        reg(bar);
      });
      // —— 暖灯：吊线 + 灯泡 + 点光源 ——
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, wallH - 2.1, 6), lam(0x222222));
      wire.position.set(ccx, (wallH + 2.1) / 2, ccz); reg(wire);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
      bulb.position.set(ccx, 2.0, ccz); reg(bulb);
      const warm = new THREE.PointLight(0xffc37a, 1.25, 18, 2);
      warm.position.set(ccx, 2.0, ccz); reg(warm);
      // —— M.E.G. 旗（挂在帐篷前沿，朝房间） ——
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85),
        new THREE.MeshBasicMaterial({ map: megFlagTexture() }));
      flag.material._ownMat = true;
      const fa = Math.atan2(n.x, n.z);
      flag.position.set(ccx + n.x * 1.15, 2.05, ccz + n.z * 1.15);
      flag.rotation.y = fa;
      reg(flag);
      // —— 交互：打开交易面板 ——
      // 命中代理：隐形大盒子罩住柜台 + NPC（参考 addFurniturePickup 的做法），
      // 保证屏幕中心射线稳定命中，平板玩家不用像素级瞄准
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 1.9, 1.8),
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false })
      );
      proxy.position.set(ccx, 0.95, ccz);
      proxy.rotation.y = Math.atan2(n.x, n.z);
      reg(proxy);
      W.addInteractable({
        id: 'meg_shop', kind: 'shop', chunkKey,
        meshes: [proxy, top, npc.torso, npc.head], pos: new THREE.Vector3(ccx, 1.2, ccz), radius: 3.6,
        prompt: () => (BR.Input && BR.Input.isTouch)
          ? '点 ◎ 按钮与 M.E.G. 队员交易' // 触屏：不写键盘按键，写触控说明
          : (BR.interactKeyLabel ? BR.interactKeyLabel() : '【E】') + '与 M.E.G. 队员交易',
        canUse: () => !BR.UI._shopOpen,
        use: () => { BR.Audio.uiClick(); BR.UI.openShop(); }
      });
    });
  }

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
    // M.E.G. 前哨交易站（柜台 + 帐篷围挡 + 暖灯 + 队员 NPC + 商店交互）
    poiList(map, 'meg_shop').forEach(p => buildMegShop(W, p));
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
    // M.E.G. 队员待机摆动（柜台后，活人感；商店面板打开时 state=paused，tick 不跑，静止也合理）
    const npc = W._shopNPC;
    if (npc && npc.group.parent) {
      npc.t += dt;
      npc.group.rotation.z = Math.sin(npc.t * 0.9) * 0.022;
      npc.head.position.y = 1.58 + Math.sin(npc.t * 1.35) * 0.012;
      npc.armL.rotation.x = Math.sin(npc.t * 1.1) * 0.07;
      npc.armR.rotation.x = Math.sin(npc.t * 1.1 + 1.3) * 0.07;
    }
    // 随机闪烁风暴：保证玩家一定能看到灯闪
    // 断电期间暂停"下一次风暴"计时（叠加规则见 world.js updateRandomBlackout 注释）：
    // 断电时灯全灭，风暴闪了也看不见，等电恢复后再掷，避免两者抢档期打架。
    if (!W.blackout) {
      W._stormT = (W._stormT == null ? 18 + Math.random() * 22 : W._stormT) - dt;
      if (W._stormT <= 0) {
        W._stormT = 32 + Math.random() * 30;
        W.flickerStorm = { x: P.pos.x, z: P.pos.z, r: 15, t: 4.5 };
        BR.Audio.flickerBuzz();
        P.drainSanity(4);
        if (!W._stormTold) { W._stormTold = true; BR.UI.toast('头顶的灯开始疯狂闪烁——'); }
      }
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
          prompt: () => BR.interactKeyLabel() + '阅读字条', canUse: () => true,
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
          prompt: () => BR.interactKeyLabel() + '阅读字条', canUse: () => true,
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
            prompt: () => BR.interactKeyLabel() + '阅读字条',
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
      //   青→L7 / 蓝→bang（v1.5 W6：94→! 替换；已逃脱则重抽） / 紫→L188。游戏内用海报/字条/痕迹留线索。
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
                '这条滑梯通向 Level !。\n\n听见警报就跑，别回头。');
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
                // v1.5 W6：蓝滑梯→Level !；若已逃脱过（flags.bangEscaped），
                // 不再送回，改送其他已完成层级（目的地走 BR.Bang.pickCompletedDest）
                let slideDest = dest;
                if (def.color === 'blue' && BR.Game.flags && BR.Game.flags.bangEscaped &&
                    BR.Bang && BR.Bang.pickCompletedDest) {
                  slideDest = BR.Bang.pickCompletedDest();
                  BR.UI.toast('滑梯转了个弯——它记得你已经逃出去过。', 2200);
                }
                BR.Cutout.travel(slideDest, { kind: 'slide' });
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
                '（游戏原创机制说明）\n\n七色滑梯，派对区深处的固定出口。\n\n每条滑梯通向一个固定的楼层，颜色就是线索：\n红→家，橙→水，黄→城，绿→宜居，青→深海，蓝→跑！，紫→窗。\n\n看好再滑。=)\n\n——开发组');
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
