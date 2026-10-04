/* player.js —— 第一人称角色控制：移动/碰撞/视角/脚步/受伤 */
(function () {
  const BR = window.BR;
  const C = () => BR.Config;

  const P = {
    pos: new THREE.Vector3(0, 0, 0),  // 脚底
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    crouching: false, running: false,
    hp: 100, noise: 0,
    sanity: 100,          // 理智 0..100：黑暗/实体/断电侵蚀，杏仁水与安全屋恢复
    hunger: 100,          // 饥饿 0..100：随时间缓慢下降，食物恢复
    // —— W9：耐力 0..100（疾跑消耗，耗尽后需恢复到 exhaustedAt 才能再跑；能量棒恢复） ——
    stamina: 100,
    _staminaOut: false,   // 耐力耗尽锁存
    adrenalineT: 0,       // 肾上腺素剩余秒数（>0 时加速+不耗耐力+无视虚弱）
    diveLight: null,      // 水下照明灯 {charge:0..100, on:bool}（W9；无则 null）
    // 注：buoyancyModifier / oxygenMax / oxygenDrainMul 由 W8 在下方定义（救生衣/氧气瓶钩子）
    // —— 饥饿惩罚档位（调数值只改这 5 个，注释即文档） ——
    // HUNGER_WEAK = 33：饥饿 ≤33 进入"虚弱"，移速 × HUNGER_WEAK_MUL（总降速 28%，取代旧的 <25 ×0.9）
    // HUNGER_HEAL = 25：饥饿 <25 时回血 ×0.5（旧规则保留，提示 toast 保留）
    // STARVE：饥饿归零后，每 STARVE_TICK 秒扣 STARVE_DMG 点血（别太狠）
    HUNGER_WEAK: 33, HUNGER_WEAK_MUL: 0.72,
    HUNGER_HEAL: 25,
    STARVE_TICK: 5, STARVE_DMG: 2,
    hasFlashlight: false, flashlightOn: false,
    flashBat: 100,        // 手电电池 0..100：开灯时 1.2/s 耗电，归零自动关灯；电池道具 +60
    camera: null,
    bobPhase: 0, stepAcc: 0,
    trauma: 0,           // 镜头震动 0..1
    landDipT: 0,
    // 外部镜头偏移（掉落转场等写入，update 中应用，不与转场抢相机）
    extDipY: 0, extRoll: 0, extPitch: 0, extFov: 0,
    hurtCd: 0,
    sanWhispT: 6, sanStingT: 20,
    eyeCur: 1.62,
    // —— 第三人称：火柴人 avatar + 肩视角 ——
    thirdPerson: false,
    avatar: null,   // 延迟到第一次切换第三人称时构建（平板默认第一人称，不占内存）
    _av: null,      // avatar 部件引用 {torso,head,armL,armR,legL,legR}
    /* —— E 路（v1.4）：跳跃 / 游泳物理 ——
     * JUMP_V/GRAVITY：初速 7 m/s + 重力 22 m/s² → 顶点约 1.11 m、滞空约 0.64 s；
     * 仅落地可跳（边沿触发，长按不连跳）；顶棚按 BODY_H 截断；落地冲击 >3.5 m/s 触发 landDip。
     * 游泳：深水（depth>=SWIM_DEEP，与 BR.Swim DEEP_LINE 对齐）进入浮力模式；
     *   空格=上浮(RISE_V)、C=下潜(DIVE_V)，无输入时以 (floatY-pos)*2.2 的速率逐渐漂回
     *   FLOAT_OFF 下的漂浮位（眼高=水面+0.3，头部在水上），不瞬间弹回；
     *   游泳↔涉水切换带 0.15 滞回（1.0 进 / 0.85 出），防镜头抖。
     * 水体查询：D 路 BR.Levels.L37.waterAt（若已交付）优先，否则走共享 BR.Swim.zoneAt
     *   （L37/L7 通用）。地面高度：关卡可选 floorYAt(x,z)，默认 0。
     */
    JUMP_V: 7.0, GRAVITY: 22.0, TERMINAL_V: -16.0,
    BODY_H: 1.78,                 // 身体总高（头顶=脚底+1.78；站立眼高 1.62）
    SWIM_DEEP: 1.0,               // depth >= 此值进入游泳（与 BR.Swim DEEP_LINE 一致）
    SWIM_HYST: 0.15,              // 游泳退出滞回：depth < 0.85 才退回涉水
    FLOAT_OFF: 1.32,              // 漂浮时脚底=水面-1.32（眼=水面+0.30）
    RISE_V: 2.8, DIVE_V: 2.4,     // 水中上浮 / 下潜速度
    _grounded: true,              // 是否在地面上（仅落地可跳）
    _mode: 'land',                // 'land' | 'wade'（浅水涉行）| 'swim'（游泳）
    _swim: false,                 // 游泳滞回锁存
    _headUnder: false,            // 头部是否在水下（眼高<水面，带滞后）
    _jumpPrev: false,             // 上一帧跳跃键状态（边沿检测）
    _extFloorY: 0, _extFloorT: 0, // 外部支撑面（L37 跳水台等直接写 pos.y 的旧逻辑）
    _physY: 0,                   // 本物理步结束时的 pos.y（下帧对比，检测外部写入）
    /* —— v1.5 W8：玩家状态机 ——
     * state ∈ walk（步行）| air（空中）| wade（浅水涉行）| swim（游泳漂浮）
     *          | under（水下）| boat（乘船）| duck（乘鸭子）
     *          | transition（层级切换）| disabled（失行动力）
     * 状态由 _updateStateMachine 每帧从物理事实推导（坐骑态由 mount/dismount 显式驱动）。
     * _enterState/_exitState 负责恢复：重力开关 _gravOn、碰撞开关 _collide、
     * 速度清理（_clearMotion）、相机/输入在 update 分支里按 state 处理。
     */
    state: 'walk',
    _gravOn: true,               // 重力开关：游泳/坐骑/切换/失能时关闭
    _collide: true,              // 碰撞开关：坐骑态关闭（handle 自己处理碰撞）
    mountHandle: null,           // 当前坐骑 handle（BR.Mounts 接口），null=未乘坐
    // —— v1.5 W8：救生衣 / 氧气瓶钩子（供 W9 道具调用） ——
    // buoyancyModifier：浮力倍率。救生衣 → 设 >1（如 1.5）：回漂/上浮更快，
    //   下潜速度按 DIVE_V/bm 衰减（"下潜需更主动输入"）；出水/卸下后 W9 负责恢复 1.0。
    buoyancyModifier: 1.0,
    oxygenMax: 100,              // 闭气上限（秒数换算：Swim.breath 100≈25s）；氧气瓶 → 提高
    oxygenDrainMul: 1            // 闭气消耗倍率；高效氧气瓶 → <1
  };
  BR.Player = P;

  /* ================= v1.5 W8：坐骑注册表 =================
   * W3（船）/ W5（鸭子）调用：
   *   BR.Mounts.register('boat', (opts) => handle)
   *   BR.Mounts.register('duck', (opts) => handle)
   * handle 接口（W3/W5 实现时必须提供）：
   *   {
   *     kind: 'boat',              // 注册时的 kind（register 会回填）
   *     stateName: 'boat',         // 映射到玩家状态机：'boat' | 'duck'（缺省 'boat'）
   *     update(dt, input, player), // 每帧调用：驱动自身移动，负责写 player.pos
   *     getSeatPos(),              // → THREE.Vector3：玩家身体应处位置（座位）
   *     findDismountSpot(),        // → {x,y,z} | null：下坐骑落点（null=原地）
   *     getSave(),                 // → 可 JSON 化的坐骑运行时态（可选）
   *     applySave(data),           // ← 读档恢复（可选）
   *     onMount(player),           // 可选：上坐骑时
   *     onDismount(player)         // 可选：下坐骑时
   *   }
   * 玩家侧：BR.Player.mount(handle) / BR.Player.dismount()。
   */
  /* ================= v1.5 W8：坐骑注册表 =================
   * 稳定 API（W3 船 / W5 鸭子）：
   *   BR.Mounts.register(kind, factory) —— 注册坐骑工厂。factory 签名二选一：
   *       function (opts)      —— 通用（create 用，opts 透传）；
   *       function (W, spot)   —— 世界实例（spawn 用；W5 鸭子即此式）。
   *   BR.Mounts.create(kind, opts) —— 工厂(opts) 建 handle，接口校验不过返回 null。
   *   BR.Mounts.kinds() —— 已注册 kind 列表。
   * 世界实例管理（W5 鸭子：每关卡按 POI 生成若干实例，位置进存档）：
   *   BR.Mounts.install() —— 幂等初始化（关卡 buildContent 开头调一次）。
   *   BR.Mounts.spawn(kind, W, spot) —— 工厂(W, spot) 建实例，追踪进 _instances。
   *   BR.Mounts.get(kind) —— 取已注册工厂（无则 null）。
   *   BR.Mounts.clearLevel() —— 逐个 dispose（有则调；当前正骑的不碰）并清空 _instances。
   *   BR.Mounts.savedFor(id) —— 取该实例存档（读档恢复用；读 W.state.mounts）。
   *   BR.Mounts.getLevelSave() —— 收集全部实例 getSave() → {id: data}（供存档流程）。
   *   BR.Mounts.applyLevelSave(data) —— 注入读档数据（不用 W.state 时的手动路径）。
   * 玩家上下坐骑（BR.Player.mount/dismount 的薄封装）：
   *   BR.Mounts.mount(handle) / BR.Mounts.dismount() /
   *   BR.Mounts.active —— 当前坐骑 handle（未骑乘为 null；只读）。
   * handle 接口（玩家侧契约）：{update(dt,input,player), getSeatPos(),
   *   findDismountSpot()->{x,y,z}|null, getSave()/applySave(), kind?, stateName?}
   * update 里 handle 对 player.pos 有全权（玩家 update 不再覆盖，只清速度）。
   */
  BR.Mounts = {
    _kinds: {},
    _instances: [],
    _levelSave: null,
    register: function (kind, factory) {
      if (typeof kind !== 'string' || typeof factory !== 'function') return false;
      this._kinds[kind] = factory;
      return true;
    },
    get: function (kind) { return this._kinds[kind] || null; },
    create: function (kind, opts) {
      const f = this._kinds[kind];
      if (!f) return null;
      try {
        const h = f(opts || {});
        if (h && typeof h.update === 'function' && typeof h.getSeatPos === 'function' &&
            typeof h.findDismountSpot === 'function') {
          h.kind = kind;
          if (!h.stateName) h.stateName = 'boat';
          return h;
        }
      } catch (e) { if (BR.warn) BR.warn('Mounts.create failed', kind, e); }
      return null;
    },
    kinds: function () { return Object.keys(this._kinds); },
    // —— 世界实例管理（W5 鸭子） ——
    install: function () {
      if (!this._instances) this._instances = [];
      return this;
    },
    spawn: function (kind, W, spot) {
      const f = this._kinds[kind];
      if (!f) return null;
      let h = null;
      try { h = f(W, spot || {}); } catch (e) { if (BR.warn) BR.warn('Mounts.spawn failed', kind, e); }
      if (!h || typeof h.update !== 'function') return null;
      h.kind = h.kind || kind;
      if (h.stateName !== 'boat' && h.stateName !== 'duck') h.stateName = (kind === 'boat') ? 'boat' : 'duck';
      this._instances.push(h);
      return h;
    },
    clearLevel: function () {
      const cur = (BR.Player && BR.Player.mountHandle) || null;
      for (const h of this._instances) {
        if (h && h !== cur && typeof h.dispose === 'function') {
          try { h.dispose(); } catch (e) {}
        }
      }
      this._instances = [];
      this._levelSave = null;
    },
    savedFor: function (id) {
      if (this._levelSave && this._levelSave[id] != null) return this._levelSave[id];
      try {
        const W = BR.World;
        if (W && W.state && W.state.mounts && W.state.mounts[id] != null) return W.state.mounts[id];
      } catch (e) {}
      return null;
    },
    getLevelSave: function () {
      const out = {};
      for (const h of this._instances) {
        if (!h || typeof h.getSave !== 'function') continue;
        try { const d = h.getSave(); if (d && d.id != null) out[d.id] = d; } catch (e) {}
      }
      return out;
    },
    applyLevelSave: function (data) { this._levelSave = data || null; },
    // —— 玩家上下（薄封装，实际逻辑在 BR.Player） ——
    mount: function (h) { return (BR.Player && BR.Player.mount(h)) || false; },
    dismount: function () { if (BR.Player) BR.Player.dismount(); }
  };
  Object.defineProperty(BR.Mounts, 'active', {
    get: function () { return (BR.Player && BR.Player.mountHandle) || null; },
    configurable: true
  });

  P.initCamera = function () {
    this.camera = new THREE.PerspectiveCamera(C().FOV, innerWidth / innerHeight, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
  };
  P.eyeY = function () { return this.pos.y + this.eyeCur; };

  P.reset = function (x, z, yaw) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    this.yaw = yaw || 0; this.pitch = 0;
    this.hp = 100; this.noise = 0; this.trauma = 0;
    this.sanity = 100; this.sanWhispT = 6; this.sanStingT = 20;
    this.hunger = 100; this._hungerWarned = false;
    // W9：耐力/肾上腺素/水下照明灯复位（浮力/氧气由 W8 的 clearOxygenGear 等复位）
    this.stamina = 100; this._staminaOut = false; this.adrenalineT = 0;
    this.diveLight = null;
    this._weakWarned = false; this._weakToastT = 40; this._starveT = 0; // 饥饿惩罚 E：虚弱字幕/归零掉血计时器
    this.flashBat = 100; // 手电电池回满
    this.crouching = false; this.running = false;
    this.extDipY = 0; this.extRoll = 0; this.extPitch = 0; this.extFov = 0;
    this.eyeCur = C().EYE;
    // E 路（v1.4）：跳跃/游泳物理状态复位（存档不存 pos.y，读档/切关一律从地面开始）
    this.vel.y = 0;
    this._grounded = true; this._mode = 'land'; this._swim = false;
    this._headUnder = false; this._jumpPrev = false;
    this._extFloorY = 0; this._extFloorT = 0; this._physY = 0;
    // v1.5 W8：状态机 / 坐骑 / 装备钩子复位
    this.state = 'walk';
    this._gravOn = true; this._collide = true;
    this.mountHandle = null;
    this.buoyancyModifier = 1.0;
    this.clearOxygenGear();
    // 第三人称默认关闭，avatar 若已构建则隐藏（不销毁，下次切换复用）
    this.thirdPerson = false;
    if (this.avatar) this.avatar.visible = false;
  };

  P.toggleCrouch = function () {
    this.crouching = !this.crouching;
    BR.bus.emit('crouch', { on: this.crouching });
  };
  P.toggleFlashlight = function () {
    if (!this.hasFlashlight) { BR.UI.toast('你还没有手电筒'); return; }
    if (!this.flashlightOn && this.flashBat <= 0) { BR.UI.toast('手电筒没电了，找块电池吧'); return; }
    this.flashlightOn = !this.flashlightOn;
    BR.Audio.uiClick();
    BR.UI.toast(this.flashlightOn ? '手电筒：开' : '手电筒：关');
  };

  /* ================= 第三人称：极简 3D 火柴人 =================
   * 圆柱身体、四肢圆柱 + 末端圆球（r128 没有 CapsuleGeometry，用
   * CylinderGeometry + SphereGeometry 拼）、头一个大圆球。
   * 单色深灰哑光 MeshLambertMaterial，全身共 10 个 mesh，
   * 四肢用 pivot Group 包裹以便摆动。
   */
  P.buildAvatar = function () {
    if (this.avatar) return this.avatar;
    const mat = new THREE.MeshLambertMaterial({ color: 0x3b4046 }); // 单色深灰哑光，材质复用
    const mesh = (geo, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.frustumCulled = false; // 小物件，避免裁剪抖动
      return m;
    };
    const g = new THREE.Group();
    // 躯干：圆柱 r0.11 h0.62，中心 y=1.05（6 段，性能审查：avatar 总三角 <500）
    const torso = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 6), 0, 1.05, 0);
    g.add(torso);
    // 头：大圆球 r0.16，y=1.58
    const head = mesh(new THREE.SphereGeometry(0.16, 10, 8), 0, 1.58, 0);
    g.add(head);
    // 四肢：pivot Group + 圆柱 + 末端圆球
    const mkLimb = (r, len, jointR, px, py) => {
      const piv = new THREE.Group();
      piv.position.set(px, py, 0);
      piv.add(mesh(new THREE.CylinderGeometry(r, r, len, 6), 0, -len / 2, 0));
      piv.add(mesh(new THREE.SphereGeometry(jointR, 6, 4), 0, -len, 0));
      g.add(piv);
      return piv;
    };
    const armL = mkLimb(0.05, 0.55, 0.065, -0.19, 1.30); // 手臂
    const armR = mkLimb(0.05, 0.55, 0.065, 0.19, 1.30);
    const legL = mkLimb(0.065, 0.62, 0.085, -0.10, 0.72); // 腿
    const legR = mkLimb(0.065, 0.62, 0.085, 0.10, 0.72);
    g.visible = false;
    this.avatar = g;
    this._av = { torso, head, armL, armR, legL, legR };
    return g;
  };

  // 切换第三人称（input.js 的按键绑定调用；判空由调用方负责）
  P.toggleThirdPerson = function () {
    this.thirdPerson = !this.thirdPerson;
    if (this.thirdPerson) {
      const av = this.buildAvatar();
      const sc = (BR.World && BR.World.scene) || null;
      if (sc && av.parent !== sc) sc.add(av);
      av.visible = true;
    } else if (this.avatar) {
      this.avatar.visible = false; // 第一人称隐藏，避免看到头内部
    }
    if (BR.bus && BR.bus.emit) BR.bus.emit('thirdperson', { on: this.thirdPerson });
    return this.thirdPerson;
  };

  // 低画质：四肢摆动幅度减半
  P._swingScale = function () {
    const q = BR.QUALITY;
    return (q && q.maxLights <= 3) ? 0.5 : 1;
  };

  // avatar 跟随 P.pos/yaw + 四肢动画（仅第三人称调用）
  P._updateAvatar = function (dt, world, moving, wantRun) {
    const av = this.buildAvatar();
    const sc = (world && world.scene) || (BR.World && BR.World.scene) || null;
    if (sc && av.parent !== sc) sc.add(av);
    av.visible = true;
    const A = this._av;
    // 蹲伏下沉系数（平滑）
    this._crouchK = BR.damp(this._crouchK || 0, this.crouching ? 1 : 0, 10, dt);
    const ck = this._crouchK;
    // —— F1 游泳姿态：眼睛低于所在水域水面 → 身体前倾 + 手脚划水 + 浮力起伏 ——
    // （第一人称下 avatar 隐藏，姿态只影响第三人称显示；_swimK 供逻辑测试读取）
    let swimZn = null;
    if (BR.Swim && typeof BR.Swim.zoneAt === 'function' && this.pos)
      swimZn = BR.Swim.zoneAt(this.pos.x, this.pos.z);
    const swimTarget = (swimZn && this.eyeY() < swimZn.waterY - 0.05) ? 1 : 0;
    this._swimK = BR.damp(this._swimK || 0, swimTarget, 6, dt);
    const sk = this._swimK;
    // 位置=脚底，朝向=yaw；蹲下时整体下沉；游泳时叠加浮力上下浮动
    av.position.set(this.pos.x,
      this.pos.y - 0.38 * ck + Math.sin(performance.now() * 0.0018) * 0.12 * sk,
      this.pos.z);
    av.rotation.set(0, this.yaw, 0);
    if (sk > 0.001) av.rotateX(-0.55 * sk); // 绕本地 X 轴前倾（朝向无关）
    // 四肢摆动：按 bobPhase 正弦，手臂与腿反相；幅度小；游泳时走划水
    const swing = this._swingScale() * (wantRun ? 0.85 : 0.55) * (1 - 0.85 * sk);
    if (moving) {
      const s = Math.sin(this.bobPhase);
      A.armL.rotation.x = s * swing;
      A.armR.rotation.x = -s * swing;
      A.legL.rotation.x = -s * swing;
      A.legR.rotation.x = s * swing;
    } else {
      // 静止：四肢回正 + 轻微呼吸起伏
      for (const p of [A.armL, A.armR, A.legL, A.legR])
        p.rotation.x = BR.damp(p.rotation.x, 0, 8, dt);
      const br = Math.sin(performance.now() * 0.002) * 0.012;
      A.torso.position.y = 1.05 + br;
      A.head.position.y = 1.58 + br;
    }
    if (moving) { A.torso.position.y = 1.05; A.head.position.y = 1.58; }
    // 蹲下：手臂下摆、腿微屈
    A.armL.rotation.x += ck * 0.35;
    A.armR.rotation.x += ck * 0.35;
    A.legL.rotation.x += ck * 0.5;
    A.legR.rotation.x += ck * 0.5;
    // F1 游泳划水：手臂交替大幅划动 + 向两侧张开，腿交替打水（rotation.z 取绝对值防累加）
    if (sk > 0.001) {
      const st = performance.now() * 0.001;
      A.armL.rotation.x += Math.sin(st * 4.2) * 0.9 * sk;
      A.armR.rotation.x += Math.sin(st * 4.2 + Math.PI) * 0.9 * sk;
      A.legL.rotation.x += Math.sin(st * 3.1) * 0.55 * sk;
      A.legR.rotation.x += Math.sin(st * 3.1 + Math.PI) * 0.55 * sk;
      A.armL.rotation.z = 0.4 * sk;
      A.armR.rotation.z = -0.4 * sk;
    } else {
      A.armL.rotation.z = 0;
      A.armR.rotation.z = 0;
    }
  };

  // 第三人称肩视角相机：身后 3.2m、上方 1.9m、右偏 0.5m；撞墙拉近，绝不穿墙
  P._updateThirdCamera = function (dt, world, wantRun, moving) {
    const cfg = C();
    const cam = this.camera;
    const ck = this._crouchK || 0;
    const headY = this.pos.y + (1.58 - 0.38 * ck);
    const hx = this.pos.x, hz = this.pos.z;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // 前
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);  // 右
    // 期望机位偏移（yaw 方向）：后 3.2m、上 1.9m、右 0.5m；pitch 抬头则机位下压
    const dx = -fx * 3.2 + rx * 0.5;
    const dz = -fz * 3.2 + rz * 0.5;
    const dy = 1.9 - this.pitch * 2.2;
    const wallH = (world && world.theme && world.theme.wallH) || 3;
    // 相机碰撞：从头部向目标机位小步进，撞墙（circleFree）或顶到天花板就停
    const N = 14;
    let px = hx, py = headY, pz = hz;
    const canStep = world && typeof world.circleFree === 'function';
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const nx = hx + dx * t, nz = hz + dz * t;
      const ny = Math.min(headY + dy * t, wallH - 0.25);
      if (ny < 0.35) break;
      if (canStep && !world.circleFree(nx, nz, 0.28)) break;
      px = nx; py = ny; pz = nz;
    }
    cam.position.set(px, py, pz);
    // lookAt 头部前方（pitch 影响俯仰）
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    cam.lookAt(hx + fx * cp * 2, headY + sp * 2 - 0.15, hz + fz * cp * 2);
    const fovT = (wantRun && moving ? cfg.FOV_RUN : cfg.FOV) + (this.extFov || 0);
    if (Math.abs(cam.fov - fovT) > 0.1) {
      cam.fov = BR.damp(cam.fov, fovT, 6, dt);
      cam.updateProjectionMatrix();
    }
  };

  P.hurt = function (n, cause) {
    if (BR.Game.state !== 'playing' || this.hurtCd > 0 && cause !== 'steam') return;
    this.hp -= n;
    if (cause !== 'steam') this.hurtCd = 0.6;
    this.trauma = Math.min(1, this.trauma + n * 0.03);
    BR.bus.emit('hurt', { hp: this.hp, cause });
    if (this.hp <= 0) {
      this.hp = 0;
      this.setState('disabled'); // v1.5 W8：失行动力（reset/读档时回 walk）
      BR.bus.emit('died', { cause });
    }
  };
  P.heal = function (n) {
    // 饥饿过低（< HUNGER_HEAL，即 25）时回血减半（旧规则保留）
    if (this.hunger < this.HUNGER_HEAL) n *= 0.5;
    this.hp = Math.min(100, this.hp + n);
    BR.bus.emit('heal', { hp: this.hp });
  };
  P.eat = function (n) {
    this.hunger = Math.min(100, this.hunger + n);
  };
  // —— 饥饿档位移速倍率（E：饥饿惩罚深化） ——
  // 健康（hunger > HUNGER_WEAK）：×1.0；虚弱（≤ HUNGER_WEAK）：× HUNGER_WEAK_MUL（降速 28%）
  P.hungerSpeedMul = function () {
    return this.hunger <= this.HUNGER_WEAK ? this.HUNGER_WEAK_MUL : 1;
  };
  // —— 理智 ——
  P.drainSanity = function (n) {
    if (BR.Dev && BR.Dev.infSanity) return; // 开发者模式：无限理智
    if (BR.Game.state !== 'playing') return;
    this.sanity = Math.max(0, this.sanity - n);
  };
  P.restoreSanity = function (n) {
    this.sanity = Math.min(100, this.sanity + n);
  };
  P.landDip = function () { this.landDipT = 1; };
  P.shake = function (amt) { this.trauma = Math.min(1, this.trauma + amt); };

  /* ================= v1.5 W8：玩家状态机 =================
   * 状态表（enter/exit 行为）：
   *   walk/air/wade ：重力开、碰撞开、输入正常
   *   swim/under    ：重力关（走浮力平滑逻辑）、碰撞开、跳跃键=上浮/下潜键=下潜
   *   boat/duck     ：重力关、碰撞关（handle 自己处理）、输入转交给 handle.update
   *   transition    ：重力关、输入忽略、速度清零（层级切换中）
   *   disabled      ：重力关、输入忽略、速度清零（失行动力，如死亡）
   * 切换时 _exitState 清残留速度（出水/下坐骑不许带异常速度），_enterState
   * 恢复重力/碰撞开关；相机沿用现有第一/第三人称逻辑（pos 驱动，无需重置）。
   */
  P.setState = function (next) {
    if (!next || this.state === next) return;
    const prev = this.state;
    this._exitState(prev, next);
    this.state = next;
    this._enterState(next, prev);
    if (BR.bus) BR.bus.emit('playerstate', { prev: prev, next: next });
  };
  // 上/下坐骑、游泳↔陆地：不许残留异常速度
  P._clearMotion = function () {
    this.vel.set(0, 0, 0);
    this._grounded = true;
    this._jumpPrev = false;
  };
  P._exitState = function (prev, next) {
    if (prev === 'boat' || prev === 'duck' ||
        prev === 'transition' || prev === 'disabled') {
      this._clearMotion();
    }
    // 出水（swim/under → walk/wade/air）：钳制垂直残留速度，防"弹射"
    if ((prev === 'swim' || prev === 'under') &&
        (next === 'walk' || next === 'wade' || next === 'air')) {
      this.vel.y = BR.clamp(this.vel.y, -4, 1.5);
    }
  };
  P._enterState = function (next, prev) {
    this._gravOn = !(next === 'swim' || next === 'under' ||
      next === 'boat' || next === 'duck' ||
      next === 'transition' || next === 'disabled');
    this._collide = !(next === 'boat' || next === 'duck');
    if (next === 'transition' || next === 'disabled') this._clearMotion();
    if (next === 'swim' || next === 'under') {
      // 水里不能蹲：强制起身，防蹲伏眼高与漂浮位打架
      if (this.crouching) { this.crouching = false; BR.bus.emit('crouch', { on: false }); }
    }
    if (next === 'boat' || next === 'duck') {
      // 上坐骑：强制起身 + 关手电？不——手电保持，只清蹲伏
      if (this.crouching) { this.crouching = false; BR.bus.emit('crouch', { on: false }); }
    }
  };
  // 每帧从物理事实推导状态（坐骑/切换/失能态由显式 API 驱动，这里不碰）
  P._updateStateMachine = function () {
    if (this.mountHandle) return;
    if (this.state === 'transition' || this.state === 'disabled') return;
    let next;
    if (this._mode === 'swim') next = this._headUnder ? 'under' : 'swim';
    else if (this._mode === 'wade') next = 'wade';
    else next = this._grounded ? 'walk' : 'air';
    if (next !== this.state) this.setState(next);
  };
  // 是否在水中（游泳/潜水）：供 input.js 的 dive 动作做陆地/水中语义分支
  P.isSwimmingState = function () {
    return this.state === 'swim' || this.state === 'under';
  };

  /* ================= v1.5 W8：坐骑上下 ================= */
  P.mount = function (handle) {
    // 接口校验：handle 必须实现玩家侧契约（update/getSeatPos/findDismountSpot）
    if (!handle || typeof handle.update !== 'function' ||
        typeof handle.getSeatPos !== 'function' ||
        typeof handle.findDismountSpot !== 'function') return false;
    if (this.mountHandle) this.dismount(true); // 已在坐骑上：先静默下旧的
    this.mountHandle = handle;
    this._clearMotion();
    // stateName 优先用 handle 自报；没写时按 kind 推断（W5 鸭子没写 stateName → duck）
    let st = handle.stateName;
    if (st !== 'boat' && st !== 'duck') st = (handle.kind === 'boat') ? 'boat' : 'duck';
    handle.stateName = st;
    this.setState(st);
    // 初始摆放到座位（之后每帧由 handle 全权驱动 pos）
    try {
      const seat = handle.getSeatPos();
      if (seat && isFinite(seat.x) && isFinite(seat.z)) {
        this.pos.set(seat.x, isFinite(seat.y) ? seat.y : this.pos.y, seat.z);
      }
    } catch (e) {}
    try { if (typeof handle.onMount === 'function') handle.onMount(this); } catch (e) {}
    BR.UI.toast(handle.kind === 'duck' ? '骑上了鸭子！' : '上了船');
    BR.bus.emit('mount', { kind: handle.kind, state: this.state });
    return true;
  };
  P.dismount = function (silent) {
    const h = this.mountHandle;
    if (!h) return false;
    let spot = null;
    try { spot = (typeof h.findDismountSpot === 'function') ? h.findDismountSpot() : null; } catch (e) {}
    if (spot && isFinite(spot.x) && isFinite(spot.z)) {
      this.pos.set(spot.x, (spot.y != null && isFinite(spot.y)) ? spot.y : this.pos.y, spot.z);
    }
    try { if (typeof h.onDismount === 'function') h.onDismount(this); } catch (e) {}
    this.mountHandle = null;
    this._clearMotion();          // 下坐骑不许残留异常速度
    this.setState('walk');        // 后续 _updateStateMachine 按水域/地面纠正
    if (!silent) BR.UI.toast('下了坐骑');
    BR.bus.emit('dismount', { kind: h.kind });
    return true;
  };
  P.isMounted = function () { return !!this.mountHandle; };

  /* ================= v1.5 W8：氧气接口（W9 氧气瓶调用） =================
   * 真值仍在 BR.Swim.breath（lv_l37.js 的 tick 负责增减，已按
   * P.oxygenDrainMul / P.oxygenMax 接入）；这里只提供读写与装备钩子。
   */
  P.getOxygen = function () {
    return (BR.Swim && isFinite(BR.Swim.breath)) ? BR.Swim.breath : 100;
  };
  P.setOxygenGear = function (max, drainMul) {
    this.oxygenMax = (max != null && max > 0) ? max : 100;
    this.oxygenDrainMul = (drainMul != null && drainMul > 0) ? drainMul : 1;
    if (BR.Swim && BR.Swim.breath > this.oxygenMax) BR.Swim.breath = this.oxygenMax;
  };
  P.clearOxygenGear = function () {
    this.oxygenMax = 100;
    this.oxygenDrainMul = 1;
  };

  /* ================= E 路（v1.4）：跳跃 / 游泳垂直物理 =================
   * 真实位移（pos.y = 脚底世界高度），非镜头晃动。
   * 对外事件（audio.js 等可订阅，无需改 player.js）：
   *   BR.bus 'jump' —— 起跳；'land' {impact} —— 落地（impact=触地瞬间下落速度）
   *   'splash'/'dive'/'surface' 由 BR.Swim.tick 在进出水时发出（既有）。
   * 切出安全：所有跨关传送均为 interact use() 显式触发或 Cutout.busy 守卫；
   *   唯一 proximity 触发是随机裂隙 hole 形态，已在 cutout.js 加 pos.y<0.45 守卫，
   *   跳跃/上浮穿过其触发区不再误切出。
   */
  // 地面高度查询：关卡可提供 floorYAt(x,z)（高台/跳板等），默认 0
  P._groundYAt = function (x, z) {
    try {
      const lvl = BR.Game && BR.Levels && BR.Levels[BR.Game.level];
      if (lvl && typeof lvl.floorYAt === 'function') {
        const y = lvl.floorYAt(x, z);
        if (isFinite(y)) return y;
      }
    } catch (e) {}
    return 0;
  };
  // 水体查询 → {surface, floor, depth} | null
  // 优先级：① D 路任务约定接口 BR.Levels.L37.waterAt(x,z)；
  //          ② D 路实现中（v1.4 并行开发）：BR.Gen.L37waterAt(map,x,z)；
  //          ③ 共享 BR.Swim.zoneAt（L37/L7 通用兜底）。
  // 每层都做形状校验 + try/catch，D 路未交付或中间态异常时自动降级，不抛错。
  P._waterAt = function (x, z) {
    const pick = (r) => (r && isFinite(r.surface) && isFinite(r.depth)) ?
      { surface: r.surface, floor: isFinite(r.floor) ? r.floor : 0, depth: r.depth } : null;
    try {
      const L = BR.Levels && BR.Levels.L37;
      if (L && typeof L.waterAt === 'function') {
        const dw = pick(L.waterAt(x, z));
        if (dw) return dw;
      }
    } catch (e) {}
    try {
      if (BR.Gen && typeof BR.Gen.L37waterAt === 'function' && BR.World && BR.World.map) {
        const gw = pick(BR.Gen.L37waterAt(BR.World.map, x, z));
        if (gw) return gw;
      }
    } catch (e) {}
    if (BR.Swim && typeof BR.Swim.zoneAt === 'function') {
      const zn = BR.Swim.zoneAt(x, z);
      // L7 v1.5：深海 zone 可带 floor（物理海床深度）；缺省 0（L37 等旧关卡不变）
      if (zn) return { surface: zn.waterY, floor: isFinite(zn.floor) ? zn.floor : 0, depth: zn.depth, zone: zn };
    }
    return null;
  };
  // 顶棚高度：关卡主题 wallH，默认 3
  P._ceilY = function (world) {
    return (world && world.theme && world.theme.wallH) || 3;
  };

  // 游泳垂直分量：浮力 + 阻尼（无输入时逐渐漂回水面，不瞬间弹回）
  // v1.5 W8：buoyancyModifier（救生衣钩子）——>1 时回漂/上浮更快、
  // 下潜速度按 DIVE_V/bm 衰减（下潜需更主动输入）；全程 BR.damp 平滑，不硬锁高度。
  P._swimVertical = function (dt, w, jumpHeld, diveHeld, groundY, world) {
    const floatY = w.surface - this.FLOAT_OFF;
    const bm = (this.buoyancyModifier > 0) ? this.buoyancyModifier : 1;
    let vyT;
    if (diveHeld && !jumpHeld) vyT = -this.DIVE_V / bm;        // 下潜（救生衣抵抗）
    else if (jumpHeld && !diveHeld) vyT = this.RISE_V * bm;    // 上浮（救生衣增强）
    else vyT = BR.clamp((floatY - this.pos.y) * 2.2 * bm, -1.4 * bm, 1.6 * bm); // 漂浮回位
    this.vel.y = BR.damp(this.vel.y, vyT, 6, dt);
    this.pos.y += this.vel.y * dt;
    // 池底
    const floorY = Math.max(groundY, (w.floor != null ? w.floor : 0));
    if (this.pos.y < floorY) { this.pos.y = floorY; if (this.vel.y < 0) this.vel.y = 0; }
    // 顶棚 / 水面：不许飞出水面（头肩可出水，身体留在水里）
    const maxY = Math.min(this._ceilY(world) - this.BODY_H, w.surface - 0.9);
    if (this.pos.y > maxY) { this.pos.y = maxY; if (this.vel.y > 0) this.vel.y = 0; }
  };

  P._stepVertical = function (dt, input, world) {
    // —— 外部支撑检测：L37 跳水台 damp 等旧逻辑在 level.tick 里直接写 pos.y ——
    // 本帧若 pos.y 被外部抬升（>0.003），视为临时支撑面（0.18s 记忆，持续抬升则刷新）；
    // 被外部下压则立即清除。level.tick 在 player.update 之后跑，故用帧间差值检测。
    const lastY = (this._physY == null ? this.pos.y : this._physY);
    const extDy = this.pos.y - lastY;
    if (extDy > 0.003) {
      this._extFloorY = this.pos.y; this._extFloorT = 0.18;
      if (this.vel.y < 0) this.vel.y = 0;
    } else if (extDy < -0.003) {
      this._extFloorT = 0;
    } else {
      this._extFloorT = Math.max(0, (this._extFloorT || 0) - dt);
    }
    let groundY = this._groundYAt(this.pos.x, this.pos.z);
    if (this._extFloorT > 0 && this._extFloorY > groundY) groundY = this._extFloorY;

    // —— 水体状态机（滞回：depth>=1.0 进游泳，<0.85 才退回涉水，防抖） ——
    const w = this._waterAt(this.pos.x, this.pos.z);
    if (w && w.depth >= this.SWIM_DEEP) this._swim = true;
    else if (!w || w.depth < this.SWIM_DEEP - this.SWIM_HYST) this._swim = false;
    const mode = !w ? 'land' : (this._swim ? 'swim' : 'wade');
    this._mode = mode;
    // 头部入水（与 BR.Swim.tick 同阈值：入水 eye<surface-0.05，出水需 eye>surface+0.08）
    if (w) {
      const ey = this.eyeY();
      this._headUnder = this._headUnder ? (ey < w.surface + 0.08) : (ey < w.surface - 0.05);
    } else this._headUnder = false;

    const jumpHeld = !!(input.jumpHeld || input.touchJump);
    const diveHeld = !!(input.diveHeld || input.touchDive);
    const jumpPressed = jumpHeld && !this._jumpPrev; // 边沿触发：长按不连跳
    this._jumpPrev = jumpHeld;

    if (mode === 'swim') {
      this._grounded = false;
      this._swimVertical(dt, w, jumpHeld, diveHeld, groundY, world);
    } else {
      // —— 陆地 / 浅水涉行：重力 + 跳跃 ——
      if (this._grounded && jumpPressed) {
        this.vel.y = this.JUMP_V;
        this._grounded = false;
        if (input && input.firstHint) input.firstHint('jump'); // v1.5 W8：桌面首次跳跃提示
        BR.bus.emit('jump', {});
      }
      if (!this._grounded) {
        this.vel.y = Math.max(this.TERMINAL_V, this.vel.y - this.GRAVITY * dt);
        this.pos.y += this.vel.y * dt;
        // 撞顶棚：截断
        const maxY = this._ceilY(world) - this.BODY_H;
        if (this.pos.y > maxY) { this.pos.y = maxY; if (this.vel.y > 0) this.vel.y = 0; }
        // 落地
        if (this.pos.y <= groundY && this.vel.y <= 0) {
          const impact = -this.vel.y;
          this.pos.y = groundY; this.vel.y = 0; this._grounded = true;
          if (impact > 3.5) { this.landDip(); BR.bus.emit('land', { impact: impact }); }
        }
      } else {
        // 站立：吸附支撑面（跟随外部抬升，如跳水台）
        this.pos.y = groundY; this.vel.y = 0;
      }
    }
    this._physY = this.pos.y;
    // v1.5 W8：状态机从物理事实推导（坐骑态由 mount/dismount 显式驱动，不在这里改）
    this._updateStateMachine();
  };

  P.update = function (dt, input, world) {
    if (BR.Game.state !== 'playing') return;
    const cfg = C();
    this.hurtCd = Math.max(0, this.hurtCd - dt);

    // —— 视角 ——
    const lk = input.consumeLook();
    this.yaw -= lk.dx * input.sens();
    this.pitch -= lk.dy * input.sens();
    this.pitch = BR.clamp(this.pitch, -1.45, 1.45);

    // —— 移动输入 ——
    // v1.5 W8：坐骑态 → handle 全权驱动（玩家速度清零，pos/camera 由 handle 写；
    // 玩家 update 不再用 getSeatPos 覆盖，mount() 只在上坐骑瞬间摆位一次）。
    // transition/disabled → 忽略移动输入（_enterState 已清速度）。
    let wantRun = false, moving = false, hSpeed = 0;
    if (this.mountHandle) {
      this.vel.set(0, 0, 0);
      try { this.mountHandle.update(dt, input, this); }
      catch (e) { BR.warn('mount update failed', e); this.dismount(true); }
      // handle 的 update 里可能调 dismount（如下鸭）：mountHandle 已空则跳过后续坐骑逻辑
      this.running = false;
      this.noise = BR.damp(this.noise, 0, 6, dt);
    } else if (this.state !== 'disabled' && this.state !== 'transition') {
    const mv = input.getMove(); // {x:右, z:前} -1..1
    wantRun = (input.runHeld || input.runToggle) && mv.z > 0.1 && !this.crouching;
    if (wantRun && input.firstHint) input.firstHint('run'); // v1.5 W2：首次疾跑提示
    // —— W9：耐力 ——
    // 疾跑且移动时 7/s 消耗；平时 14/s 回复；耗尽后锁存，需回到 30 才能再跑。
    // 肾上腺素（adrenalineT>0）期间：不耗耐力、移速 ×1.25、无视饥饿虚弱减速。
    const stamCfg = (BR.Items && BR.Items.CONFIG && BR.Items.CONFIG.stamina) || null;
    const adrenOn = this.adrenalineT > 0;
    if (adrenOn) this.adrenalineT = Math.max(0, this.adrenalineT - dt);
    if (stamCfg && !adrenOn) {
      if (BR.Dev && BR.Dev.infStamina) {
        // 开发者模式：无限体力——不扣且回满
        this.stamina = stamCfg.max; this._staminaOut = false;
      } else if (wantRun) {
        // 注意：moving 在下面才算出；这里用输入强度近似（疾跑要求 mv.z>0.1 已保证在动）
        // v1.5 W6：staminaDrainMul 钩子（默认 1；Level ! 追逐时置 0，肾上腺素爆发不耗耐力）
        const drainMul = (this.staminaDrainMul != null) ? this.staminaDrainMul : 1;
        this.stamina = Math.max(0, this.stamina - stamCfg.drain * drainMul * dt);
        if (this.stamina <= 0 && !this._staminaOut) {
          this._staminaOut = true;
          BR.UI.toast('耐力耗尽……走一会儿恢复', 2200);
        }
      } else {
        this.stamina = Math.min(stamCfg.max, this.stamina + stamCfg.regen * dt);
      }
      if (this._staminaOut && this.stamina >= stamCfg.exhaustedAt) this._staminaOut = false;
      if (this._staminaOut) wantRun = false;
    }
    this.running = wantRun;
    var speed = this.crouching ? cfg.CROUCH : (wantRun ? cfg.RUN : cfg.WALK);
    // 饥饿惩罚 E：虚弱档（≤33）移速 ×0.72（总降速 28%）；档位见 hungerSpeedMul 注释
    // W9：肾上腺素期间无视虚弱减速
    if (!adrenOn) speed *= this.hungerSpeedMul();
    if (adrenOn) speed *= (BR.Items.CONFIG.adrenaline.speedMul || 1.25);
    // 扩建钩子：游泳/涉水减速（BR.Swim 由水关卡提供，未加载时为 undefined）
    if (BR.Swim && BR.Swim.speedMul) speed *= BR.Swim.speedMul;
    // 世界方向（yaw=0 面向 -z）
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const tx = (rx * mv.x + fx * mv.z) * speed;
    const tz = (rz * mv.x + fz * mv.z) * speed;

    this.vel.x = BR.damp(this.vel.x, tx, cfg.ACCEL, dt);
    this.vel.z = BR.damp(this.vel.z, tz, cfg.ACCEL, dt);
    if (mv.x === 0 && mv.z === 0) {
      this.vel.x = BR.damp(this.vel.x, 0, cfg.FRICTION, dt);
      this.vel.z = BR.damp(this.vel.z, 0, cfg.FRICTION, dt);
    }
    if (this._collide) world.moveCircle(this.pos, this.vel.x * dt, this.vel.z * dt, cfg.RADIUS);
    else { this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; }

    // E 路（v1.4）：跳跃 / 游泳垂直物理（真实位移，非镜头晃动）
    this._stepVertical(dt, input, world);

    hSpeed = Math.hypot(this.vel.x, this.vel.z);
    moving = hSpeed > 0.4;

    // —— 噪音（实体听觉用） ——
    const target = !moving ? 0 : this.crouching ? 0.15 : wantRun ? 1.0 : 0.45;
    this.noise = BR.damp(this.noise, target, 6, dt);
    } else {
      // transition/disabled：速度已在 _enterState 清零；噪音衰减
      this.running = false;
      this.noise = BR.damp(this.noise, 0, 6, dt);
    }

    // —— 理智：黑暗/断电侵蚀，明亮处与安全屋恢复 ——
    // v1.5.1 修：手电开/灯下（dark<0.1）缓慢回 +0.3/s；dim 区（0.1–0.55）-0.25/s；
    // 真黑区（dark>0.55）-(1.2+dark*2.2)/s；断电 -2.5/s；安全屋 +5/s。
    // 目标：会用手电、靠灯走能探索 10 分钟以上；黑区/断电硬扛仍会掉。
    // 实体 proximity 侵蚀在 entities.js 里，保留不动。
    const dark = world.darknessAt ? world.darknessAt(this.pos.x, this.pos.z) : 0;
    const inSafe = world.safeZoneAt ? world.safeZoneAt(this.pos.x, this.pos.z) : false;
    if (inSafe) this.restoreSanity(dt * 5);
    else if (world.blackout) this.drainSanity(dt * 2.5);
    else if (dark > 0.55) this.drainSanity(dt * (1.2 + dark * 2.2));
    else if (dark >= 0.1) this.drainSanity(dt * 0.25);
    else this.restoreSanity(dt * 0.3);
    // —— 低理智幻觉：耳语/惊吓/视线晃动 ——
    // Systems C-A：<30 用立体声飘忽耳语并加密（4~9s），<15 再加密（2.5~5.5s）
    if (this.sanity < 38) {
      this.sanWhispT -= dt;
      if (this.sanWhispT <= 0) {
        if (this.sanity < 15) { this.sanWhispT = 2.5 + Math.random() * 3; BR.Audio.whisperDeep(); }
        else if (this.sanity < 30) { this.sanWhispT = 4 + Math.random() * 5; BR.Audio.whisperDeep(); }
        else { this.sanWhispT = 7 + Math.random() * 9; BR.Audio.whisper(); }
        if (this.sanity < 22) BR.UI.toast('你听见有人在叫你的名字……');
      }
    }
    if (this.sanity < 20) {
      this.sanStingT -= dt;
      if (this.sanStingT <= 0) {
        this.sanStingT = 16 + Math.random() * 14;
        BR.Audio.stinger(); this.shake(0.3);
      }
    }
    if (BR.UI.setSanityFx) BR.UI.setSanityFx(this.sanity);

    // —— 饥饿：随时间缓慢下降（0.1/s，100 点约撑 16~17 分钟）——
    if (this.hunger > 0) this.hunger = Math.max(0, this.hunger - dt * 0.1);
    // E：虚弱档（≤33）偶尔字幕"好饿……走不动了"——进入时一次 + 每 40 秒一次；hunger ≥40 后重置
    if (this.hunger <= this.HUNGER_WEAK) {
      if (!this._weakWarned) {
        this._weakWarned = true; this._weakToastT = 40;
        BR.UI.toast('好饿……走不动了', 2600);
      } else {
        this._weakToastT = (this._weakToastT == null ? 40 : this._weakToastT) - dt;
        if (this._weakToastT <= 0) {
          this._weakToastT = 40;
          BR.UI.toast('好饿……走不动了', 2600);
        }
      }
    } else if (this.hunger >= 40) { this._weakWarned = false; this._weakToastT = 40; }
    // E：饥饿归零——每 STARVE_TICK 秒扣 STARVE_DMG 血（绕开 hurt 的 hurtCd/创伤，纯持续掉血）
    if (this.hunger <= 0) {
      this._starveT = (this._starveT || 0) + dt;
      if (this._starveT >= this.STARVE_TICK) {
        this._starveT -= this.STARVE_TICK;
        this.hp = Math.max(0, this.hp - this.STARVE_DMG);
        BR.bus.emit('hurt', { hp: this.hp, cause: 'starve' });
        if (this.hp <= 0) { this.setState('disabled'); BR.bus.emit('died', { cause: 'starve' }); }
      }
    } else this._starveT = 0;
    if (this.hunger < 25 && !this._hungerWarned) {
      this._hungerWarned = true;
      BR.UI.toast('你饿得发慌，回血变慢了，找点吃的吧！', 3200);
    } else if (this.hunger >= 30) this._hungerWarned = false;

    // —— 手电电池：开灯时 1.2/s 耗电，归零自动关灯 ——
    if (this.flashlightOn && this.hasFlashlight) {
      this.flashBat = Math.max(0, this.flashBat - dt * 1.2);
      if (this.flashBat <= 0) {
        this.flashlightOn = false;
        BR.UI.toast('手电筒没电了！');
        if (BR.UI.updateInv) BR.UI.updateInv();
      }
    }

    // —— 蹲伏眼高 ——
    const eyeT = this.crouching ? cfg.CROUCH_EYE : cfg.EYE;
    this.eyeCur = BR.damp(this.eyeCur, eyeT, 10, dt);

    // —— headbob + 脚步 ——
    // 镜头晃动设置：on=1 / weak=0.45 / off=0
    const hbSet = (input.settings && input.settings.headbob) || 'on';
    const hb = hbSet === 'off' ? 0 : (hbSet === 'weak' ? 0.45 : 1);
    const runK = wantRun ? 1.75 : 1;   // 冲刺幅度加大
    if (moving) {
      this.bobPhase += dt * (4 + hSpeed * 1.6);
      this.stepAcc += hSpeed * dt;
      if (this.stepAcc >= cfg.STEP_LEN) {
        this.stepAcc = 0;
        // W10：步行/跑/游泳/涉水分开反馈（跑的音量由 footstep 内部随机+runK 步频体现）
        if (this._mode === 'swim') BR.Audio.swimStroke();
        else if (this._mode === 'wade') BR.Audio.wadeStep();
        else BR.Audio.footstep(world.surfaceAt(this.pos.x, this.pos.z), BR.Game && BR.Game.level);
        if (wantRun) BR.bus.emit('noise', { level: 1 });
      }
    } else {
      this.bobPhase = BR.damp(this.bobPhase, Math.round(this.bobPhase / Math.PI) * Math.PI, 8, dt);
    }
    const bobY = moving ? Math.abs(Math.sin(this.bobPhase)) * (this.crouching ? 0.03 : 0.055) * hb * runK : 0;
    const bobX = moving ? Math.sin(this.bobPhase) * 0.035 * hb * runK : 0;
    const bobRoll = moving ? Math.sin(this.bobPhase) * 0.014 * hb * runK : 0;

    // —— 第三人称：火柴人跟随与动画 ——
    if (this.thirdPerson) this._updateAvatar(dt, world, moving, wantRun);

    // —— 镜头 ——
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.landDipT = Math.max(0, this.landDipT - dt * 3);
    // W10：减镜头晃动设置（shakecam：on=1 / weak=0.45 / off=0），进设置并保存
    const shkSet = (input.settings && input.settings.shakecam) || 'on';
    const shk = shkSet === 'off' ? 0 : (shkSet === 'weak' ? 0.45 : 1);
    const sh = this.trauma * this.trauma * shk;
    const shx = sh * 0.12 * Math.sin(performance.now() * 0.09);
    const shy = sh * 0.12 * Math.cos(performance.now() * 0.073);
    // 低理智：视线轻微游移
    const sanSway = this.sanity < 28 ? (28 - this.sanity) / 28 : 0;
    const swayX = sanSway * 0.02 * Math.sin(performance.now() * 0.0011);
    const swayY = sanSway * 0.02 * Math.cos(performance.now() * 0.0009);
    // v1.5 W8：坐骑态相机由 handle 全权驱动（位/旋转都自己写），跳过玩家相机逻辑
    if (this.mountHandle) {
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      this.landDipT = Math.max(0, this.landDipT - dt * 3);
    } else
    if (this.thirdPerson) {
      // 肩视角（走独立逻辑，第一人称逻辑不动）
      this._updateThirdCamera(dt, world, wantRun, moving);
    } else {
      if (this.avatar) this.avatar.visible = false; // 第一人称隐藏，避免看到头内部
      // F1：水中浮力感 —— 第一人称镜头轻微上下浮动（第三人称走 avatar 浮动）
      const buoyY = (BR.Swim && BR.Swim.inWater) ? Math.sin(performance.now() * 0.0016) * 0.06 : 0;
      this.camera.position.set(
      this.pos.x + bobX * Math.cos(this.yaw),
      this.eyeY() + bobY - this.landDipT * 0.22 + shy + (this.extDipY || 0) + buoyY,
      this.pos.z - bobX * Math.sin(this.yaw)
    );
    this.camera.rotation.set(
      this.pitch + shx * 0.4 + swayX + (this.extPitch || 0),
      this.yaw + swayY,
      shx * 0.3 + bobRoll + (this.extRoll || 0)
    );
    const fovT = (wantRun && moving ? cfg.FOV_RUN : cfg.FOV) + (this.extFov || 0);
    if (Math.abs(this.camera.fov - fovT) > 0.1) {
      this.camera.fov = BR.damp(this.camera.fov, fovT, 6, dt);
      this.camera.updateProjectionMatrix();
    }
    }

    // —— 交互射线（屏幕中心） ——
    this._intCd = Math.max(0, (this._intCd || 0) - dt);
    if (this._intCd === 0) {
      this._intCd = 0.12;
      // 修：复用 scratch 向量（每 0.12s 一次也避免 GC 抖动）
      this._intV = this._intV || new THREE.Vector3();
      this._intO = this._intO || new THREE.Vector3();
      this._intE = this._intE || new THREE.Euler(0, 0, 0, 'YXZ');
      // 第三人称：交互射线从玩家眼位沿视角方向发出（不用肩视角相机位）
      const dir = this.thirdPerson
        ? this._intV.set(0, 0, -1).applyEuler(this._intE.set(this.pitch, this.yaw, 0))
        : this._intV.set(0, 0, -1).applyEuler(this.camera.rotation);
      const origin = this.thirdPerson
        ? this._intO.set(this.pos.x, this.eyeY(), this.pos.z)
        : this.camera.position;
      const hit = world.rayInteract(origin, dir, cfg.INTERACT_DIST + 1.2);
      const cur = hit && hit.it.canUse() ? hit.it : null;
      if (cur !== this._curIt) {
        this._curIt = cur;
        BR.UI.setPrompt(cur ? cur.prompt() : null);
      } else if (cur) BR.UI.setPrompt(cur.prompt()); // 刷新动态文本
    }
    if (input.consumeInteract() && this._curIt) {
      this._curIt.use();
    }
  };
})();
