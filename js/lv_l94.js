/* lv_l94.js —— Level 94「动画」（定格动画风草坡小镇）+ 昼夜循环系统
 *
 * 独立 IIFE，注册 BR.Levels.L94。不修改任何现有文件。
 *
 * 昼夜系统：dayT 0~1 循环，一昼夜 240 秒（白天 150s / 夜晚 90s）。
 *   白天 day   —— 明亮柔和，环境音 L94（轻音乐+风声），watcher 静止（可观察记住位置）
 *   黄昏 dusk  —— 前兆：toast + 环境音变调 L94D（风渐强+低鸣）+ watcher 眼睛发光 + 颗粒加重
 *   夜晚 night —— 环境音 L94N（风声+心跳，音乐停止），雾色深蓝，watcher 巡逻/追击（视距18/速度4.2）
 *                城堡吊桥放下（可交互 →L188），汽车出口关闭
 *   黎明 dawn  —— 到天亮，toast，眼睛熄灭，环境音回 L94
 * 躲到天亮是合法策略：藏身点内蹲伏静止，watcher 搜不到你（见 watcher 行为参数）。
 *
 * watcher 实体：POI type 'watcher'（data:{mode}）由本关 gen 放置，
 *   builder + AI 由 entities.js 集成（交付片段见汇报），本文件只做 POI，不直接生成实体。
 * 出口统一走 BR.Cutout.travel（Systems A 提供；未加载时降级为 BR.Game.gotoLevel）。
 */
(function () {
  var BR = window.BR;
  var T = BR.TILE;

  /* ================= 昼夜参数 ================= */
  var DAY_LEN = 240;              // 一昼夜 240 秒
  var DAY_FRAC = 150 / 240;       // 白天 150s，夜晚 90s（dayT >= 0.625 为夜）
  var DUSK_LEN = 14;              // 黄昏前兆 14 秒
  var DAWN_LEN = 8;               // 黎明 8 秒

  // 各时段视觉目标（白天/黄昏/夜晚/黎明）
  var VIS = {
    day:   { bg: 0x8fc3e8, fog: 0x9fcbe8, fogNear: 10, fogFar: 72, amb: 0xfff1d6, ambInt: 0.85,
             sky: 0xbfe0ff, gnd: 0x5a7a44, hemiInt: 0.35, expo: 0.90,
             grain: null, grainAnim: '0.9s', win: 0x9fc4d8 },
    dusk:  { bg: 0xc97a3e, fog: 0xcf8850, fogNear: 8,  fogFar: 58, amb: 0xffb37a, ambInt: 0.70,
             sky: 0xe8a060, gnd: 0x4a5a38, hemiInt: 0.30, expo: 0.80,
             grain: '0.10', grainAnim: '0.7s', win: 0xd8a050 },
    night: { bg: 0x050914, fog: 0x0a1430, fogNear: 6,  fogFar: 46, amb: 0x33406e, ambInt: 0.50,
             sky: 0x1a2444, gnd: 0x0a0f1a, hemiInt: 0.22, expo: 0.66,
             grain: '0.16', grainAnim: '0.45s', win: 0xffd94d },
    dawn:  { bg: 0xa8c8e0, fog: 0xb0cfe8, fogNear: 9,  fogFar: 66, amb: 0xffe8c8, ambInt: 0.80,
             sky: 0xcfe4f8, gnd: 0x557040, hemiInt: 0.33, expo: 0.86,
             grain: null, grainAnim: '0.9s', win: 0x9fc4d8 }
  };

  function phaseOf(dayT) {
    if (dayT >= DAY_FRAC) return 'night';
    if (dayT >= DAY_FRAC - DUSK_LEN / DAY_LEN) return 'dusk';
    if (dayT < DAWN_LEN / DAY_LEN) return 'dawn';
    return 'day';
  }

  var L = {
    name: 'Level 94 ——「动画」',
    theme: {
      bg: 0x8fc3e8, fogNear: 10, fogFar: 72, ambient: 0xfff1d6, ambInt: 0.85,
      sky: 0xbfe0ff, ground: 0x5a7a44, light: 0xfff4d0, lightInt: 0.7,
      wallH: 3.2, wall: 'town_wall', floor: 'town_grass', ceil: 'ceiling',
      surface: 'grass', fixtureEvery: 10000, hum: 0
    },
    _dayT: 0.10, _phase: 'day', _grainSet: null, _hideTold: false,

    /* 供 entities.js watcher AI 查询：现在是不是夜晚 */
    isNight: function () { return this._dayT >= DAY_FRAC; },
    dayT: function () { return this._dayT; },
    /* 测试/调试用：直接跳时间 */
    setDayT: function (t) {
      this._dayT = ((t % 1) + 1) % 1;
      var ph = phaseOf(this._dayT);
      if (ph !== this._phase) this.setPhase(ph);
      this.applyVisual(0.016, true);
    },

    setPhase: function (p) {
      var prev = this._phase;
      this._phase = p;
      if (BR.Game.flags) BR.Game.flags.l94_dayT = this._dayT; // 存档向后兼容：可选字段
      this._hideTold = false;
      if (p === 'dusk') {
        // —— 夜晚前兆：第一次进的玩家靠这三样能活下来 ——
        BR.UI.toast('太阳西斜，天色发暗——"它们"快醒了，找藏身点躲好', 5000);
        BR.Audio.setAmbient('L94D'); // 音乐变调：风渐强 + 低鸣
        setWatcherEyes(0xff5030);    // watcher 眼睛发光
        BR.UI.toast('画面颗粒加重', 2500);
        if (BR.Audio.stinger) BR.Audio.stinger();
      } else if (p === 'night') {
        BR.UI.toast('夜幕降临。观察者开始巡逻——蹲伏静止可以躲开它们', 5000);
        BR.Audio.setAmbient('L94N'); // 音乐停止：只剩风声 + 心跳
      } else if (p === 'dawn') {
        BR.UI.toast('天亮了。观察者退回原地——白天暂时安全', 4000);
        BR.Audio.setAmbient('L94');
        setWatcherEyes(0x3a3a44);
      } else if (p === 'day' && prev !== 'dawn') {
        BR.Audio.setAmbient('L94');
        setWatcherEyes(0x3a3a44);
      }
    },

    applyVisual: function (dt, snap) {
      var W = BR.World;
      if (!W || !W.scene) return;
      var v = VIS[this._phase] || VIS.day;
      if (!v._ready) {
        v._bg = new THREE.Color(v.bg); v._fog = new THREE.Color(v.fog);
        v._amb = new THREE.Color(v.amb); v._sky = new THREE.Color(v.sky);
        v._gnd = new THREE.Color(v.gnd); v._win = new THREE.Color(v.win);
        v._ready = true;
      }
      var k = snap ? 1 : (1 - Math.exp(-1.6 * dt));
      W.scene.background.lerp(v._bg, k);
      var fog = W.scene.fog;
      if (fog && fog.isFog) {
        fog.color.lerp(v._fog, k);
        fog.near += (v.fogNear - fog.near) * k;
        fog.far += (v.fogFar - fog.far) * k;
      }
      if (W._amb) {
        W._amb.color.lerp(v._amb, k);
        W._amb.intensity += (v.ambInt - W._amb.intensity) * k;
      }
      if (W._hemi) {
        W._hemi.color.lerp(v._sky, k);
        W._hemi.groundColor.lerp(v._gnd, k);
        W._hemi.intensity += (v.hemiInt - W._hemi.intensity) * k;
      }
      if (BR.Game.renderer) {
        var re = BR.Game.renderer;
        re.toneMappingExposure += (v.expo - re.toneMappingExposure) * k;
      }
      // 定格动画颗粒感：行内覆盖 #fx-grain（不改 css）
      var gr = document.getElementById('fx-grain');
      if (gr && (snap || this._grainSet !== this._phase)) {
        gr.style.opacity = (v.grain == null) ? '' : v.grain;
        gr.style.animationDuration = v.grainAnim;
        this._grainSet = this._phase;
      }
      // 小屋窗户随昼夜变色
      if (W._l94 && W._l94.winMat) W._l94.winMat.color.lerp(v._win, k);
    },

    onEnter: function () {
      BR.UI.setObjective(BR.World.objective || '探索 Level 94');
      var f = BR.Game.flags || {};
      this._dayT = (typeof f.l94_dayT === 'number') ? (((f.l94_dayT % 1) + 1) % 1) : 0.10;
      this._phase = phaseOf(this._dayT);
      this._grainSet = null;
      this._hideTold = false;
      BR.Audio.setAmbient(this._phase === 'night' ? 'L94N' : (this._phase === 'dusk' ? 'L94D' : 'L94'));
      this.applyVisual(0.016, true); // 立刻贴合当前时段，避免穿帮
      BR.UI.toast('Level 94「动画」：白天安全，夜晚有"观察者"出没——注意天色变化', 5000);
    },

    tick: function (dt) {
      var W = BR.World, P = BR.Player;
      if (!W || !W.map || W.map.level !== 'L94') return;
      if (!P || BR.Game.state !== 'playing') return;
      BR.thinWallTick(dt); // "布景裂缝"挤压检测（跨关切出走统一状态机）
      // 推进昼夜
      this._dayT += dt / DAY_LEN;
      if (this._dayT >= 1) this._dayT -= 1;
      var ph = phaseOf(this._dayT);
      if (ph !== this._phase) this.setPhase(ph);
      this.applyVisual(dt, false);
      // 卡通剪影：上下浮动 + 缓慢漂移 + billboard 朝向；材质按昼夜淡入淡出
      var LW = W._l94;
      if (LW) {
        if (LW.fmat) {
          var nk = (this._phase === 'night' || this._phase === 'dusk') ? 1 : 0;
          for (var fk in LW.fmat) {
            if (!LW.fmat.hasOwnProperty(fk)) continue;
            var fe = LW.fmat[fk];
            var tgt = nk ? fe.nightOp : fe.dayOp;
            fe.mat.opacity += (tgt - fe.mat.opacity) * Math.min(1, dt * 1.5);
          }
        }
        if (LW.floaters) {
          for (var q = 0; q < LW.floaters.length; q++) {
            var f = LW.floaters[q];
            if (!f || !f.m || !f.m.parent) continue; // 区块未加载时跳过
            f.m.position.y = f.by + Math.sin(W.time * f.sp + f.ph) * f.amp;
            f.m.position.x = f.bx + Math.sin(W.time * f.sp * 0.35 + f.ph * 1.3) * f.drift;
            // billboard 朝向玩家；头顶正上方时防 lookAt 退化（否则 plane 侧对相机成一条线）
            var bdx = P.pos.x - f.m.position.x, bdz = P.pos.z - f.m.position.z;
            if (bdx * bdx + bdz * bdz < 0.25) { bdx = 0.5; bdz = 0; }
            f.m.lookAt(f.m.position.x + bdx, f.m.position.y, f.m.position.z + bdz);
          }
        }
      }
      // 城堡吊桥动画：白天收起 / 夜晚放下
      var c = W._l94 && W._l94.castle;
      if (c && c.hinge) {
        var target = this.isNight() ? 0.12 : 1.25;
        c.hinge.rotation.x += (target - c.hinge.rotation.x) * (1 - Math.exp(-2.5 * dt));
      }
      // 藏身点躲藏提示（每夜一次）
      if (this._phase === 'night' && !this._hideTold && P.crouching && W._l94) {
        var hzs = W._l94.hideouts || [];
        for (var i = 0; i < hzs.length; i++) {
          if (Math.hypot(P.pos.x - hzs[i].x, P.pos.z - hzs[i].z) < hzs[i].r) {
            this._hideTold = true;
            BR.UI.toast('你屏住呼吸躲在藏身点里——保持蹲伏静止，观察者搜不到你', 4500);
            break;
          }
        }
      }
    },

    buildContent: function (map, W) {
      W._l94 = { hideouts: [], winMat: null, castle: null, numTex: {}, floaters: [], fmat: {} };
      // 露天小镇：全部地板格去掉天花板（用公开 API，无跨关泄漏）
      for (var ty = 0; ty < map.h; ty++) {
        for (var tx = 0; tx < map.w; tx++) {
          if (map.tiles[ty * map.w + tx] === 1) W.setOpenCeil(tx, ty);
        }
      }
      // 小屋窗户共享材质（昼夜变色；随关卡释放）
      W._l94.winMat = trackMat(W, new THREE.MeshBasicMaterial({ color: 0x9fc4d8 }));
      // 藏身点区域（纯数据，不随区块重建重复）
      poiList(map, 'hideout').forEach(function (p) {
        W._l94.hideouts.push({ x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty), r: 3.4 });
      });
      poiList(map, 'house').forEach(function (p) { buildHouse(W, p); });
      poiList(map, 'car').forEach(function (p) { buildCar(W, p); });
      poiList(map, 'castle').forEach(function (p) { buildCastle(W, p); });
      poiList(map, 'cache').forEach(function (p) { buildCache(W, p); });
      poiList(map, 'hideout').forEach(function (p) { buildHideout(W, p); });
      var notes = L94_NOTES();
      poiList(map, 'note').forEach(function (p, i) { addNoteL94(W, p, notes[i % notes.length]); });
      poiList(map, 'crate').forEach(function (p) { addCrateL94(W, p); });
      // watcher POI：实体由 entities.js 集成（Systems B），此处不建模
      /* ---------- 卡通剪影：飘动的云 / 星星 / 月亮 / 小鸟（2D plane，轻量） ---------- */
      buildFloaters(map, W);
      /* ---------- 卡通高饱和色块：小屋旁的色块灌木 ---------- */
      buildColorBlobs(map, W);
      /* ---------- 薄墙（"布景裂缝"）：贴墙挤压后跨关切出（走统一切出状态机） ---------- */
      BR.buildThinWalls(map, W, { cross: ['L0', 'L11', 'L188'] });
      W.objective = '白天：开走老式汽车前往 Level 11；夜晚：可冒险登上城堡吊桥（→Level 188，高风险）。天黑前找藏身点躲好';
    }
  };
  // v1.5 W6：Level 94「动画」退役 —— 被 Level !「不想死就快跑！」(id 'bang') 替换。
  // 注册已摘除（index.html 的 script 标签已移除）；老存档 level='l94' 由 js/save.js 迁移到 'bang'。
  // BR.Levels.L94 = L;  // RETIRED 2026-10-03

  /* ================= 工具 ================= */
  function poiList(map, type) {
    return (map.pois || []).filter(function (p) { return p.type === type; });
  }
  // 关卡级材质：挂到 W._levelMats，world.dispose 时统一释放
  function trackMat(W, m) {
    W._levelMats = W._levelMats || [];
    W._levelMats.push(m);
    return m;
  }
  // 出口统一走 Cutout（Systems A 提供；未加载时降级直达，保证可玩）
  function travel(to, kind, dropText) {
    if (BR.Cutout && typeof BR.Cutout.travel === 'function') {
      BR.Cutout.travel(to, { kind: kind, dropText: dropText });
    } else {
      if (BR.log) BR.log('[L94] BR.Cutout 未加载，降级 gotoLevel(' + to + ')');
      BR.Game.gotoLevel(to);
    }
  }
  // 黄昏/黎明：watcher 眼睛发光 / 熄灭（entities.js 集成后生效；未集成时静默跳过）
  function setWatcherEyes(hex) {
    if (!BR.Entities || !BR.Entities.list) return;
    for (var i = 0; i < BR.Entities.list.length; i++) {
      var e = BR.Entities.list[i];
      if (e.type !== 'watcher' || !e.group || !e.group.userData) continue;
      var em = e.group.userData.eyeMat;
      if (em && em.color && typeof em.color.setHex === 'function') em.color.setHex(hex);
    }
  }

  /* ================= 内容搭建 ================= */
  function numTexture(W, no) {
    if (W._l94.numTex[no]) return W._l94.numTex[no];
    var c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    var x = c.getContext('2d');
    x.fillStyle = '#3a2e1e'; x.fillRect(0, 0, 128, 64);
    x.strokeStyle = '#c8a860'; x.lineWidth = 6; x.strokeRect(3, 3, 122, 58);
    x.fillStyle = '#ffd94d'; x.font = 'bold 40px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(no) + '号', 64, 34);
    var t = trackMat(W, new THREE.CanvasTexture(c));
    W._l94.numTex[no] = t;
    return t;
  }

  // 小房子（带编号门牌）
  function buildHouse(W, p) {
    var no = (p.data && p.data.no) || 1;
    var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
    var rng = new BR.RNG(BR.hashSeed(p.id));
    var rotY = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    W.addChunkContent(p.tx, p.ty, function (group) {
      var g = new THREE.Group();
      g.position.set(cx, 0, cz);
      g.rotation.y = rotY;
      var body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 2.4), W.mat('town_wall'));
      body.position.y = 1.0; g.add(body);
      var roof = new THREE.Mesh(new THREE.ConeGeometry(2.15, 1.25, 4),
        trackMat(W, new THREE.MeshLambertMaterial({ color: 0xa8503c })));
      roof.position.y = 2.62; roof.rotation.y = Math.PI / 4; g.add(roof);
      var door = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.4),
        trackMat(W, new THREE.MeshLambertMaterial({ color: 0x6b4a2e })));
      door.position.set(0, 0.7, 1.21); g.add(door);
      var plate = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.36),
        new THREE.MeshBasicMaterial({ map: numTexture(W, no), transparent: true }));
      plate.position.set(0, 1.72, 1.22); g.add(plate);
      var winMat = W._l94.winMat;
      [-0.85, 0.85].forEach(function (wx) {
        var win = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), winMat);
        win.position.set(wx, 1.25, 1.21); g.add(win);
      });
      W.reg(group, g);
      var id = 'house_' + p.tx + '_' + p.ty;
      var lores = [
        '窗帘后好像有人影，但你敲门时，里面安静得过分。',
        '烟囱冒着烟，可这镇上……你没见过一个镇民。',
        '门把手是温热的。你决定还是别进去。'
      ];
      W.addInteractable({
        id: id, kind: 'house', chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [door, plate], pos: new THREE.Vector3(cx, 1.2, cz), radius: 3.0,
        prompt: function () { return no + '号小屋（门从里面锁上了）'; },
        canUse: function () { return true; },
        use: function () { BR.UI.toast(lores[(no - 1) % lores.length]); BR.Audio.doorLocked(); }
      });
    });
  }

  // 老式汽车（白天出口 →L11）
  function buildCar(W, p) {
    var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
    W.addChunkContent(p.tx, p.ty, function (group) {
      var g = new THREE.Group();
      g.position.set(cx, 0, cz);
      g.rotation.y = (p.data && p.data.yaw) || 0.5;
      var red = trackMat(W, new THREE.MeshLambertMaterial({ color: 0xc0392b }));
      var cream = trackMat(W, new THREE.MeshLambertMaterial({ color: 0xf0e6d0 }));
      var dark = trackMat(W, new THREE.MeshLambertMaterial({ color: 0x2a2a2e }));
      var body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.65, 4.0), red);
      body.position.y = 0.72; g.add(body);
      var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 1.9), cream);
      cabin.position.set(0, 1.32, -0.25); g.add(cabin);
      var wg = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
      [[-0.95, 1.25], [0.95, 1.25], [-0.95, -1.25], [0.95, -1.25]].forEach(function (wp) {
        var wh = new THREE.Mesh(wg, dark);
        wh.rotation.z = Math.PI / 2;
        wh.position.set(wp[0], 0.36, wp[1]); g.add(wh);
      });
      var hlMat = trackMat(W, new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
      [-0.6, 0.6].forEach(function (hx) {
        var hm = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), hlMat);
        hm.position.set(hx, 0.85, 2.02); g.add(hm);
      });
      var bump = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.25),
        trackMat(W, new THREE.MeshLambertMaterial({ color: 0x9aa0a8 })));
      bump.position.set(0, 0.45, 2.05); g.add(bump);
      W.reg(group, g);
      W.addInteractable({
        id: 'car_exit', kind: 'car_exit', chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [body, cabin], pos: new THREE.Vector3(cx, 1.2, cz), radius: 3.2,
        prompt: function () {
          return L.isNight() ? '老式汽车（夜里开车太危险了——等天亮吧）' : '开走老式汽车（→Level 11）';
        },
        canUse: function () { return !L.isNight(); },
        use: function () {
          BR.Audio.doorCreak();
          travel('L11', 'walk', '你发动了老爷车，沿着土路开出了动画镇……');
        }
      });
    });
  }

  // 悬浮城堡（夜晚出口 →L188）：装饰性大地标 + 夜晚放下的吊桥
  function buildCastle(W, p) {
    var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
    W.addChunkContent(p.tx, p.ty, function (group) {
      var g = new THREE.Group();
      g.position.set(cx, 0, cz);
      var dais = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 0.35, 18), W.mat('town_wall'));
      dais.position.y = 0.17; g.add(dais);
      // 悬浮城堡 billboard（十字交叉）
      var cm = trackMat(W, new THREE.MeshBasicMaterial({
        map: BR.Textures.get('castle_far'), transparent: true,
        side: THREE.DoubleSide, depthWrite: false
      }));
      var b1 = new THREE.Mesh(new THREE.PlaneGeometry(34, 21), cm);
      b1.position.y = 12; g.add(b1);
      var b2 = new THREE.Mesh(new THREE.PlaneGeometry(34, 21), cm);
      b2.position.y = 12; b2.rotation.y = Math.PI / 2; g.add(b2);
      // 悬浮岩底
      var rock = new THREE.Mesh(new THREE.ConeGeometry(7, 6, 7),
        trackMat(W, new THREE.MeshLambertMaterial({ color: 0x3a3348 })));
      rock.position.y = 3.4; rock.rotation.x = Math.PI; g.add(rock);
      // 吊桥：铰链在石台边缘，白天收起（竖起）/ 夜晚放下（放平）
      var hinge = new THREE.Group();
      hinge.position.set(0, 0.5, 3.0);
      var pgeo = new THREE.BoxGeometry(1.8, 0.18, 9);
      pgeo.translate(0, 0, -4.5);
      var plank = new THREE.Mesh(pgeo, trackMat(W, new THREE.MeshLambertMaterial({ color: 0x7a5a38 })));
      hinge.add(plank);
      hinge.rotation.x = 1.25; // 初始收起
      g.add(hinge);
      W.reg(group, g);
      W._l94.castle = { hinge: hinge };
      W.addInteractable({
        id: 'castle_exit', kind: 'castle_exit', chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [dais], pos: new THREE.Vector3(cx, 1.4, cz), radius: 3.8,
        prompt: function () {
          return L.isNight() ? '登上吊桥，进入城堡（→Level 188，高风险）' : '吊桥收起来了——只有夜晚才会放下';
        },
        canUse: function () { return L.isNight(); },
        use: function () {
          travel('L188', 'walk', '你踏上吊桥，走进悬浮城堡的光里……');
        }
      });
    });
  }

  // 补给藏匿点
  function buildCache(W, p) {
    var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
    W.addChunkContent(p.tx, p.ty, function (group) {
      var g = new THREE.Group();
      g.position.set(cx, 0, cz);
      var mound = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8),
        trackMat(W, new THREE.MeshLambertMaterial({ color: 0x5d8f42 })));
      mound.scale.set(1, 0.45, 1); mound.position.y = 0.1; g.add(mound);
      var box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), W.mat('crate'));
      box.position.set(0.2, 0.35, 0); box.rotation.y = 0.4; g.add(box);
      W.reg(group, g);
      var id = 'cache_' + p.tx + '_' + p.ty;
      W.addInteractable({
        id: id, kind: 'cache', chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [box], pos: new THREE.Vector3(cx, 0.9, cz), radius: 2.6,
        prompt: function () {
          return (W.state.picked.indexOf(id) >= 0) ? '空藏匿点' : '翻找补给藏匿点';
        },
        canUse: function () { return W.state.picked.indexOf(id) < 0; },
        use: function () {
          W.state.picked.push(id);
          BR.Game.inv.almond = (BR.Game.inv.almond || 0) + 2;
          BR.Game.inv.berry = (BR.Game.inv.berry || 0) + 1; // 迁跃浆果：L94 藏匿点为固定来源之一
          BR.Audio.pickup();
          BR.UI.toast('找到了杏仁水 ×2、迁跃浆果 ×1（说明：目标随机，可能更危险）');
          BR.UI.showNote('藏匿点的字条',
            '补给留给夜里回不来的人：杏仁水、绷带，自己拿。\n\n记住：蹲下，别动，别出声。它们靠"看见"找你。\n\n——M.');
          BR.bus.emit('picked', { id: id });
          BR.UI.updateInv();
        }
      });
    });
  }

  // 藏身点：可进小屋 + 灌木
  function buildHideout(W, p) {
    var cx = BR.tileCX(p.tx), cz = BR.tileCZ(p.ty);
    W.addChunkContent(p.tx, p.ty, function (group) {
      var g = new THREE.Group();
      g.position.set(cx, 0, cz);
      var wood = trackMat(W, new THREE.MeshLambertMaterial({ color: 0x6b4a2e }));
      var leaf = trackMat(W, new THREE.MeshLambertMaterial({ color: 0x2e6b2e }));
      [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]].forEach(function (cp) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.2, 8), wood);
        post.position.set(cp[0], 1.1, cp[1]); g.add(post);
      });
      var roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.14, 2.9), wood);
      roof.position.y = 2.25; g.add(roof);
      var thatch = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.1, 3.1), leaf);
      thatch.position.y = 2.36; g.add(thatch);
      var rng = new BR.RNG(BR.hashSeed(p.id));
      for (var i = 0; i < 7; i++) {
        var b = new THREE.Mesh(new THREE.SphereGeometry(0.5 + rng.next() * 0.4, 8, 6), leaf);
        var a = rng.next() * 6.2832, r = 1.9 + rng.next() * 0.9;
        b.position.set(Math.cos(a) * r, 0.35, Math.sin(a) * r);
        b.scale.y = 0.75;
        g.add(b);
      }
      W.reg(group, g);
      W.addInteractable({
        id: 'hideout_' + p.tx + '_' + p.ty, kind: 'hideout', chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [roof], pos: new THREE.Vector3(cx, 1.2, cz), radius: 3.2,
        prompt: function () { return '躲进灌木小屋'; },
        canUse: function () { return true; },
        use: function () {
          BR.UI.toast('你钻进灌木小屋。蹲下（C / 蹲按钮）保持静止，观察者就搜不到你', 4500);
        }
      });
    });
  }

  // 卡通剪影 canvas 纹理（云 / 星星 / 月亮 / 小鸟），关卡级共用 4 张
  function floaterTexture(W, kind) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    var x = c.getContext('2d');
    x.clearRect(0, 0, 128, 128);
    var i, a, r, px2, py2;
    if (kind === 'cloud') {
      var blobs = [[44, 78, 26], [72, 68, 32], [98, 80, 22], [60, 88, 24], [86, 90, 24]];
      x.beginPath();
      for (i = 0; i < blobs.length; i++) {
        x.moveTo(blobs[i][0] + blobs[i][2], blobs[i][1]);
        x.arc(blobs[i][0], blobs[i][1], blobs[i][2], 0, 6.2832);
      }
      x.fillStyle = '#ffffff'; x.fill();
      x.strokeStyle = '#3a5a8a'; x.lineWidth = 5; x.stroke();
    } else if (kind === 'star') {
      x.beginPath();
      for (i = 0; i < 10; i++) {
        a = -Math.PI / 2 + i * Math.PI / 5; r = (i % 2 === 0) ? 44 : 19;
        px2 = 64 + Math.cos(a) * r; py2 = 64 + Math.sin(a) * r;
        if (i === 0) x.moveTo(px2, py2); else x.lineTo(px2, py2);
      }
      x.closePath();
      x.fillStyle = '#ffd94d'; x.fill();
      x.strokeStyle = '#c87818'; x.lineWidth = 5; x.stroke();
    } else if (kind === 'moon') {
      x.fillStyle = '#fdf6d8';
      x.beginPath(); x.arc(58, 64, 40, 0, 6.2832); x.fill();
      x.globalCompositeOperation = 'destination-out'; // 咬出月牙（透明，与昼夜天空色无关）
      x.beginPath(); x.arc(78, 50, 32, 0, 6.2832); x.fill();
      x.globalCompositeOperation = 'source-over';
    } else { // bird：卡通"m"形小鸟剪影
      x.strokeStyle = '#2a3a5a'; x.lineWidth = 7; x.lineCap = 'round';
      x.beginPath(); x.arc(44, 70, 22, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
      x.beginPath(); x.arc(84, 70, 22, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
    }
    return trackMat(W, new THREE.CanvasTexture(c));
  }
  // 飘动的 2D 卡通剪影：云（白天）/ 星星+月亮（夜晚）/ 小鸟（白天）
  // 随区块加载/卸载（与城堡 billboard 一致）；tick 里做上下浮动 + 缓慢漂移 +  billboard 朝向
  function buildFloaters(map, W) {
    var T = BR.TILE;
    var spawnP = null;
    for (var spi = 0; spi < map.pois.length; spi++)
      if (map.pois[spi].type === 'spawn') { spawnP = map.pois[spi]; break; }
    var defs = [
      { kind: 'cloud', n: 5, y0: 9, y1: 13, w: 7.0, amp: 0.9, drift: 2.5, night: 0, op: 0.95 },
      { kind: 'star', n: 7, y0: 11, y1: 16, w: 1.8, amp: 0.35, drift: 0.5, night: 1, op: 1.0 },
      { kind: 'moon', n: 1, y0: 15, y1: 15, w: 4.5, amp: 0.25, drift: 0.3, night: 1, op: 1.0 },
      { kind: 'bird', n: 3, y0: 8, y1: 11, w: 2.2, amp: 0.7, drift: 7.0, night: 0, op: 0.95 }
    ];
    var idx = 0;
    defs.forEach(function (d) {
      // 每种剪影一个共享材质（不挂 _ownMat，随关卡释放；tick 按昼夜整体淡入淡出）
      var mat = trackMat(W, new THREE.MeshBasicMaterial({
        map: floaterTexture(W, d.kind), transparent: true, depthWrite: false, opacity: d.night ? 0 : d.op
      }));
      W._l94.fmat[d.kind] = { mat: mat, dayOp: d.night ? 0 : d.op, nightOp: d.night ? d.op : 0 };
      for (var i = 0; i < d.n; i++, idx++) {
        (function (fi2, dd) {
          var frng = new BR.RNG(BR.hashSeed(map.seed + ':l94float:' + fi2));
          // 前两朵云锚定在出生点附近（进关抬头即见，定死卡通风格第一印象）
          var anchor = (dd.kind === 'cloud' && fi2 < 2 && spawnP) ? [[7, 4], [-6, 8]][fi2] : null;
          var fx = anchor
            ? Math.max(2, Math.min(map.w - 3, spawnP.tx + anchor[0])) * T
            : (2 + frng.next() * (map.w - 4)) * T;
          var fz = anchor
            ? Math.max(2, Math.min(map.h - 3, spawnP.ty + anchor[1])) * T
            : (2 + frng.next() * (map.h - 4)) * T;
          var fy = dd.y0 + frng.next() * Math.max(0.01, dd.y1 - dd.y0);
          var ftx = Math.max(1, Math.min(map.w - 2, Math.round(fx / T)));
          var fty = Math.max(1, Math.min(map.h - 2, Math.round(fz / T)));
          W.addChunkContent(ftx, fty, function (group) {
            var m = new THREE.Mesh(new THREE.PlaneGeometry(dd.w, dd.w * 0.75), mat);
            m.position.set(fx, fy, fz);
            m.userData.f2 = 'floater';
            W.reg(group, m); // mesh 不挂 _ownMat：材质关卡级共用，不随区块释放
            W._l94.floaters[fi2] = {
              m: m, kind: dd.kind, bx: fx, by: fy, bz: fz, ph: frng.next() * 6.2832,
              sp: 0.5 + frng.next() * 0.7, amp: dd.amp, drift: dd.drift
            };
          });
        })(idx, d);
      }
    });
  }
  // 卡通高饱和色块：每间小屋旁一丛三色灌木球
  function buildColorBlobs(map, W) {
    var cols = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0x9b59b6, 0xe67e22];
    var mats = cols.map(function (cc) {
      return trackMat(W, new THREE.MeshLambertMaterial({ color: cc }));
    });
    poiList(map, 'house').forEach(function (p, hi) {
      W.addChunkContent(p.tx, p.ty, function (group) {
        var brng = new BR.RNG(BR.hashSeed('l94blob:' + p.id));
        var g = new THREE.Group();
        g.position.set(BR.tileCX(p.tx) + (brng.next() - 0.5) * 3.4, 0,
          BR.tileCZ(p.ty) + (brng.next() - 0.5) * 3.4);
        for (var b = 0; b < 3; b++) {
          var s = new THREE.Mesh(new THREE.SphereGeometry(0.42 + brng.next() * 0.3, 10, 8),
            mats[(hi + b) % mats.length]);
          var a = brng.next() * 6.2832, rr = 0.3 + brng.next() * 0.5;
          s.position.set(Math.cos(a) * rr, 0.35, Math.sin(a) * rr);
          s.scale.y = 0.8;
          g.add(s);
        }
        g.userData.f2 = 'colorblob';
        W.reg(group, g);
      });
    });
  }

  function L94_NOTES() {
    return [
      ['褪色的镇民告示',
        '欢迎来到动画镇！\n\n镇规三条：\n一、白天出门，夜晚回家；\n二、看见"高个子"站在原地别慌，白天它不动；\n三、天黑后如果回不了家，灌木小屋里蹲好，别出声。\n\n——镇长'],
      ['孩子的蜡笔画',
        '画上是黄色的太阳和一座小房子。背面歪歪扭扭地写着：\n\n"妈妈说，太阳下山前一定要回家，不然长脖子叔叔会来找我。"'],
      ['卡车司机的字条',
        '我的老伙计（那辆红色老爷车）还能开。白天开车离开镇子，往哪儿都行。\n\n晚上千万别打它的主意——车灯会把"它们"引来。']
    ];
  }

  // 字条（本关独立实现，不依赖 levels.js 第一个 IIFE 的 addNote）
  function addNoteL94(W, p, note) {
    var id = 'note_L94_' + p.tx + '_' + p.ty;
    W.addChunkContent(p.tx, p.ty, function (group) {
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.75),
        new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') })
      );
      m.position.set(BR.tileCX(p.tx), 1.5, BR.tileCZ(p.ty));
      m.rotation.y = (p.tx * 7 + p.ty * 13) % 6.28;
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

  // 板条箱（两段式：开盖 → 瞄准拿取；与 L0/L1 共用接线，id 不变）
  var CRATE_NAMES = { almond: '杏仁水', bandage: '绷带', flashlight: '手电筒' };
  function addCrateL94(W, p) {
    var tx = p.tx, ty = p.ty;
    var id = 'crate_L94_' + tx + '_' + ty;
    W.addChunkContent(tx, ty, function (group) {
      var cm = BR.buildCrateMesh(W);
      cm.group.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
      W.reg(group, cm.group);
      BR.wireCrateTwoStage(W, group, cm, { id: id, tx: tx, ty: ty, item: p.data.item || 'almond' });
    });
  }
})();
