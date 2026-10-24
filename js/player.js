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
    diveLight: null,      // 水下照明灯 {on:bool}（W9；无则 null；v2.4 起无耗电，charge 字段仅存档兼容保留）
    // 注：buoyancyModifier / oxygenMax / oxygenDrainMul 由 W8 在下方定义（救生衣/氧气瓶钩子）
    // —— 饥饿惩罚档位（调数值只改这 5 个，注释即文档） ——
    // HUNGER_WEAK = 33：饥饿 ≤33 进入"虚弱"，移速 × HUNGER_WEAK_MUL（总降速 28%，取代旧的 <25 ×0.9）
    // HUNGER_HEAL = 25：饥饿 <25 时回血 ×0.5（旧规则保留，提示 toast 保留）
    // STARVE：饥饿归零后，每 STARVE_TICK 秒扣 STARVE_DMG 点血（别太狠）
    HUNGER_WEAK: 33, HUNGER_WEAK_MUL: 0.72,
    HUNGER_HEAL: 25,
    STARVE_TICK: 5, STARVE_DMG: 2,
    hasFlashlight: false, flashlightOn: false,
    flashBat: 100,        // 遗留字段：v2.4 W-shadowlight 起无电量玩法（手电只有开/关），不再耗电；
                          // 字段保留仅为存档/读档兼容（save.js/main.js 仍读写它），游戏逻辑不再读取
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
     * 游泳（v2.0 P2 三维自由泳，MC 海洋更新手感）：
     *   深水（depth>=SWIM_DEEP，与 BR.Swim DEEP_LINE 对齐）进入浮力模式；
     *   空格=上浮(RISE_V)、C=下潜(DIVE_V)，按住持续，显式垂直输入优先；
     *   前进 + 视角俯仰 → 斜向游（抬头上游、俯视下游，PITCH_SWIM 开关默认开）；
     *   无输入 → 中性浮力悬停（vy→hoverT；bm=1 时 hoverT=0，深水不许僵硬上浮）；
     *   bm>1（救生衣）轻微上浮倾向，bm<1（潜水服）轻微下沉倾向且垂直阻尼更快（悬停更稳）；
     *   游泳↔涉水切换带 0.15 滞回（1.0 进 / 0.85 出），防镜头抖。
     *   （旧 FLOAT_OFF 漂浮回位语义已由悬停取代，常量保留防外部引用。）
     * 水体查询：D 路 BR.Levels.L37.waterAt（若已交付）优先，否则走共享 BR.Swim.zoneAt
     *   （L37/L7 通用）。地面高度：关卡可选 floorYAt(x,z)，默认 0。
     */
    JUMP_V: 7.0, GRAVITY: 22.0, TERMINAL_V: -16.0,
    BODY_H: 1.78,                 // 身体总高（头顶=脚底+1.78；站立眼高 1.62）
    SWIM_DEEP: 1.0,               // depth >= 此值进入游泳（与 BR.Swim DEEP_LINE 一致）
    SWIM_HYST: 0.15,              // 游泳退出滞回：depth < 0.85 才退回涉水
    FLOAT_OFF: 1.32,              // （旧）漂浮位常量；v2.0 P2 起悬停语义取代漂浮回位，仅保留防外部引用
    RISE_V: 2.8, DIVE_V: 2.4,     // 水中上浮 / 下潜速度
    // —— v2.0 P2：三维自由泳手感参数（调数值只改这里，注释即文档） ——
    // PITCH_SWIM：俯仰斜游开关（默认开）；PITCH_SWIM_V：满前进+极限俯仰时的垂直速度
    // HOVER_BIAS_V：悬停偏置（m/s 每单位 bm 偏差）：bm=1→0 中性悬停；
    //   bm=2.2（救生衣）→ +0.42 缓上浮；bm=0.85（潜水服）→ -0.05 微下沉
    // SWIM_VDAMP：垂直 damp 系数；bm<1（潜水服）时 ×1.4，悬停更稳
    // SWIM_ACCEL：水中水平加速度（陆地 cfg.ACCEL=26，水中更重、转向更平滑）
    PITCH_SWIM: true, PITCH_SWIM_V: 2.6,
    HOVER_BIAS_V: 0.35, SWIM_VDAMP: 6, SWIM_ACCEL: 6,
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

  /* P0-1：reset 参数化——mode ∈ 'full'（新游戏）| 'travel'（普通跨关）| 'saved'（读档/死亡重试/回滚）。
   * 'full'：旧行为 + 显式 hasFlashlight=false / flashlightOn=false
   *   （修"回到标题→新游戏"不刷新页面时手电状态带进新局的泄漏）。
   * 'travel'：只重置位置/速度/状态机/坐骑/临时 buff，保留 hp/sanity/hunger/stamina/
   *   flashBat/hasFlashlight/diveLight 与氧气派生值（buoyancyModifier/oxygenMax/
   *   oxygenDrainMul）；不碰任何资源数值。flashlightOn 保持（跨关连续性）。
   * 'saved'：先按 full 重置，再由 main.js 按存档值恢复（现有恢复逻辑保留）。
   * 注意：状态名字符串一律不改（审计 5.1 高风险耦合）；缺省 mode='full'（旧行为）。 */
  P.reset = function (x, z, yaw, mode) {
    const travel = (mode === 'travel');
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    this.yaw = yaw || 0; this.pitch = 0;
    if (!travel) {
      this.hp = 100; this.noise = 0; this.trauma = 0;
      this.sanity = 100; this.sanWhispT = 6; this.sanStingT = 20;
      this.hunger = 100; this._hungerWarned = false;
      // W9：耐力/肾上腺素/水下照明灯复位（浮力/氧气由 W8 的 clearOxygenGear 等复位）
      this.stamina = 100; this._staminaOut = false; this.adrenalineT = 0;
      this.diveLight = null;
      this._weakWarned = false; this._weakToastT = 40; this._starveT = 0; // 饥饿惩罚 E：虚弱字幕/归零掉血计时器
      this.flashBat = 100; // 遗留字段复位（无电量玩法，仅存档兼容）
      // P0-1：新游戏/读档基线显式清手电（回到标题→新游戏不刷新页面时的泄漏）
      this.hasFlashlight = false; this.flashlightOn = false;
    } else {
      // P0-1 travel：临时 buff/警告计时器仍复位；资源数值一律保留
      this.noise = 0; this.trauma = 0;
      this.sanWhispT = 6; this.sanStingT = 20;
      this._hungerWarned = false;
      this._staminaOut = false; this.adrenalineT = 0;
      this._weakWarned = false; this._weakToastT = 40; this._starveT = 0;
    }
    this.crouching = false; this.running = false;
    this.extDipY = 0; this.extRoll = 0; this.extPitch = 0; this.extFov = 0;
    this.eyeCur = C().EYE;
    // E 路（v1.4）：跳跃/游泳物理状态复位（存档不存 pos.y，读档/切关一律从地面开始）
    this.vel.y = 0;
    this._grounded = true; this._mode = 'land'; this._swim = false;
    this._headUnder = false; this._jumpPrev = false;
    this._extFloorY = 0; this._extFloorT = 0; this._physY = 0;
    // v1.5 W8：状态机 / 坐骑复位；travel 保留氧气装备派生值，full/saved 走 clearOxygenGear
    this.state = 'walk';
    this._gravOn = true; this._collide = true;
    this.mountHandle = null;
    if (!travel) {
      this.buoyancyModifier = 1.0;
      this.clearOxygenGear();
    }
    // 第三人称默认关闭，avatar 若已构建则隐藏（不销毁，下次切换复用）
    this.thirdPerson = false;
    if (this.avatar) this.avatar.visible = false;
    if (this._fpHands) this._fpHands.visible = false; // 第一人称手部同样隐藏复用
    this._reachT = 0; this._fpOp = 0; this._crouchK = 0; this._swimK = 0; // 姿态状态复位
  };

  P.toggleCrouch = function () {
    this.crouching = !this.crouching;
    BR.bus.emit('crouch', { on: this.crouching });
  };
  P.toggleFlashlight = function () {
    if (!this.hasFlashlight) { BR.UI.toast('你还没有手电筒'); return; }
    // v2.4 W-shadowlight：无电量玩法——手电只有开/关两种状态，不再因没电拒绝开启
    this.flashlightOn = !this.flashlightOn;
    BR.Audio.uiClick();
    BR.UI.toast(this.flashlightOn ? '手电筒：开' : '手电筒：关');
  };

  /* ================= 第三人称：程序化角色身体（W-playerbody v2.4） =================
   * "误入后室的普通人"：连帽衫 + 长裤 + 运动鞋。嵌套 pivot 做关节：
   *   腰(spine) → 颈(headG) / 肩(shL/shR) → 肘(elbL/elbR) → 手；
   *   髋(hips) → 大腿(legL/legR) → 膝(kneeL/kneeR) → 踝(ankL/ankR) → 鞋。
   * 程序化几何 + 共享 Lambert 材质；全身约 900 三角（build 时计数校验 <1500）。
   * 第一人称下 avatar.visible=false（update 第一人称分支保证），相机里看不到自己的头。
   */
  P.buildAvatar = function () {
    if (this.avatar) return this.avatar;
    const M = {
      hoodie: new THREE.MeshLambertMaterial({ color: 0x46525e }), // 暗蓝灰连帽衫
      pants: new THREE.MeshLambertMaterial({ color: 0x2e3238 }),  // 炭灰长裤
      skin: new THREE.MeshLambertMaterial({ color: 0xc99a72 }),   // 皮肤
      hair: new THREE.MeshLambertMaterial({ color: 0x1f1c19 }),   // 黑发
      shoe: new THREE.MeshLambertMaterial({ color: 0x23262c }),   // 鞋面
      sole: new THREE.MeshLambertMaterial({ color: 0x777b82 })    // 鞋底
    };
    this._avMats = M;
    const mesh = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.frustumCulled = false; // 小物件，避免裁剪抖动
      return m;
    };
    const piv = (x, y, z, parent) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };
    const root = new THREE.Group(); // 脚底，朝向=yaw，前方=-z
    // —— 骨盆 + 腿 ——
    const hips = piv(0, 0.96, 0, root);
    hips.add(mesh(new THREE.BoxGeometry(0.30, 0.18, 0.20), M.pants, 0, 0.02, 0));
    const mkLeg = (sx) => {
      const leg = piv(sx * 0.10, -0.02, 0, hips);                       // 髋关节
      leg.add(mesh(new THREE.CylinderGeometry(0.078, 0.066, 0.44, 8), M.pants, 0, -0.22, 0));
      const knee = piv(0, -0.44, 0, leg);                               // 膝
      knee.add(mesh(new THREE.CylinderGeometry(0.062, 0.054, 0.40, 8), M.pants, 0, -0.20, 0));
      const ank = piv(0, -0.40, 0, knee);                               // 踝
      ank.add(mesh(new THREE.BoxGeometry(0.105, 0.10, 0.27), M.shoe, 0, -0.045, -0.055));
      ank.add(mesh(new THREE.BoxGeometry(0.112, 0.03, 0.285), M.sole, 0, -0.085, -0.055));
      return { leg: leg, knee: knee, ank: ank };
    };
    const lL = mkLeg(-1), lR = mkLeg(1);
    // —— 腰 + 躯干（连帽衫）：挂在 hips 下，蹲伏时髋部下沉会带着上身一起走 ——
    const spine = piv(0, 0.06, 0, hips); // 相对髋 0.06（世界 1.02）
    spine.add(mesh(new THREE.CylinderGeometry(0.155, 0.135, 0.50, 10), M.hoodie, 0, 0.25, 0));
    spine.add(mesh(new THREE.BoxGeometry(0.22, 0.15, 0.05), M.hoodie, 0, 0.08, -0.145)); // 袋鼠兜
    const hood = mesh(new THREE.SphereGeometry(0.11, 8, 6), M.hoodie, 0, 0.44, 0.125);
    hood.scale.set(1.15, 0.72, 0.9);
    spine.add(hood);                                                     // 脑后垂着的兜帽
    // —— 头 ——
    const headG = piv(0, 0.50, 0, spine);                                // 颈
    headG.add(mesh(new THREE.SphereGeometry(0.115, 10, 8), M.skin, 0, 0.10, -0.01));
    // 头心 1.62 = 站立眼高；无五官（藏脸），头发盖住头顶/脑后
    const hair = mesh(new THREE.SphereGeometry(0.121, 10, 6, 0, Math.PI * 2, 0, 1.85),
      M.hair, 0, 0.112, 0.012);
    hair.scale.set(1.0, 1.0, 1.06);
    headG.add(hair);
    // —— 手臂 ——
    const mkArm = (sx) => {
      const sh = piv(sx * 0.215, 0.40, 0, spine);                      // 肩
      sh.add(mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.30, 8), M.hoodie, 0, -0.15, 0));
      const elb = piv(0, -0.30, 0, sh);                                // 肘
      elb.add(mesh(new THREE.CylinderGeometry(0.050, 0.044, 0.28, 8), M.hoodie, 0, -0.14, 0));
      const hand = mesh(new THREE.SphereGeometry(0.052, 8, 6), M.skin, 0, -0.305, -0.01);
      hand.scale.set(0.9, 1.3, 0.9);
      elb.add(hand);
      return { sh: sh, elb: elb };
    };
    const aL = mkArm(-1), aR = mkArm(1);
    root.visible = false;
    // 三角数自检（手机预算：全身 <1500）
    let tris = 0;
    root.traverse((o) => {
      if (o.isMesh && o.geometry) {
        const g = o.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
    });
    this._avTris = Math.round(tris);
    if (typeof console !== 'undefined') console.log('[playerbody] avatar tris=' + this._avTris);
    this.avatar = root;
    this._av = {
      root: root, hips: hips, spine: spine, headG: headG,
      legL: lL.leg, kneeL: lL.knee, ankL: lL.ank,
      legR: lR.leg, kneeR: lR.knee, ankR: lR.ank,
      shL: aL.sh, elbL: aL.elb, shR: aR.sh, elbR: aR.elb
    };
    return root;
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

  // 前伸包络：交互触发后 0.25s 探出、0.3s 收回（开门/拾取的手部示意）
  P._reachEnv = function () {
    const rk = this._reachT || 0;
    if (rk <= 0) return 0;
    if (rk > 0.30) return Math.min(1, (0.55 - rk) / 0.25);
    return rk / 0.30;
  };

  // avatar 姿态：走/跑步态（速度驱动）、蹲伏、交互前伸、待机呼吸、落地顿、游泳划水
  // （仅第三人称调用；第一人称手部走 _updateFpHands）
  P._updateAvatar = function (dt, world, moving, wantRun) {
    const av = this.buildAvatar();
    const sc = (world && world.scene) || (BR.World && BR.World.scene) || null;
    if (sc && av.parent !== sc) sc.add(av);
    av.visible = true;
    const A = this._av, cfg = C(), t = performance.now() * 0.001;
    const ck = this._crouchK || 0, reach = this._reachEnv();
    const landK = this.landDipT || 0; // 落地顿一下（与镜头 landDip 同源）
    // —— 游泳姿态系数：眼低于水面 → 身体前倾 + 划水 ——
    let swimZn = null;
    if (BR.Swim && typeof BR.Swim.zoneAt === 'function' && this.pos)
      swimZn = BR.Swim.zoneAt(this.pos.x, this.pos.z);
    const swimTarget = (swimZn && this.eyeY() < swimZn.waterY - 0.05) ? 1 : 0;
    this._swimK = BR.damp(this._swimK || 0, swimTarget, 6, dt);
    const sk = this._swimK;
    // 根：位置=脚底，朝向=yaw；游泳叠加浮力起伏 + 身体前倾
    av.position.set(this.pos.x,
      this.pos.y + Math.sin(t * 1.8) * 0.12 * sk,
      this.pos.z);
    av.rotation.set(0, this.yaw, 0);
    if (sk > 0.001) av.rotateX(-0.55 * sk);
    // —— 步态（速度驱动：幅度与频率都跟 hSpeed；bobPhase 频率已在 update 里按 hSpeed 推进） ——
    const sScale = this._swingScale();
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const spdK = Math.min(1, hSpeed / (cfg.RUN || 5.6));
    const amp = sScale * (moving ? (0.55 + 0.45 * spdK) * (wantRun ? 1.15 : 0.85) : 0);
    const step = Math.sin(this.bobPhase);
    // 腿：大腿摆动 + 膝盖在"前摆相位"弯曲 + 脚踝代偿（脚掌尽量贴地）
    const thighL = step * 0.95 * amp, thighR = -step * 0.95 * amp;
    const kneeL = -(0.10 + (moving ? 0.55 * Math.max(0, Math.sin(this.bobPhase - 1.1)) * amp : 0));
    const kneeR = -(0.10 + (moving ? 0.55 * Math.max(0, Math.sin(this.bobPhase - 1.1 + Math.PI)) * amp : 0));
    A.legL.rotation.x = thighL + ck * 0.70 + landK * 0.30;
    A.legR.rotation.x = thighR + ck * 0.70 + landK * 0.30;
    A.kneeL.rotation.x = kneeL - ck * 1.33 - landK * 0.45;
    A.kneeR.rotation.x = kneeR - ck * 1.33 - landK * 0.45;
    A.ankL.rotation.x = -kneeL * 0.55 + ck * 0.63 + landK * 0.22;
    A.ankR.rotation.x = -kneeR * 0.55 + ck * 0.63 + landK * 0.22;
    // 手臂：与同侧腿反相；肘常微屈，跑时更屈；交互时右手前伸
    const armAmp = amp * 0.7;
    const elbB = moving ? (wantRun ? 0.55 : 0.30) + 0.15 * Math.abs(step) : 0.22;
    A.shL.rotation.x = -step * armAmp + ck * 0.18 - reach * 0.25;
    A.shR.rotation.x = step * armAmp * (1 - reach) + ck * 0.18 + reach * 1.25;
    A.shL.rotation.z = 0.07; A.shR.rotation.z = -0.07; // 手臂微张，不贴躯干
    A.elbL.rotation.x = elbB - reach * 0.1;
    A.elbR.rotation.x = elbB * (1 - reach) + reach * 0.25;
    // 躯干：上身起伏（腿不动，脚不离地）+ 速度前倾 + 蹲伏前倾 + 落地顿
    // spine 是 hips 的子节点（相对 y 基准 0.06），髋部下沉自动带下上身
    const bobA = moving ? (wantRun ? 0.045 : 0.028) * sScale : 0;
    A.spine.position.y = 0.06 + Math.abs(Math.sin(this.bobPhase)) * bobA;
    A.hips.position.y = 0.96 - 0.30 * ck - landK * 0.07;
    const lean = (moving ? (wantRun ? 0.16 : 0.07) * (0.4 + 0.6 * spdK) : 0)
      + ck * 0.32 + landK * 0.22 + reach * 0.10;
    A.spine.rotation.x = lean;
    // 待机呼吸：胸廓微胀 + 头微动（走路时幅度压低，被步态掩盖）
    const br = Math.sin(t * 2.1) * 0.5 + 0.5;
    const brAmp = moving ? 0.35 : 1;
    A.spine.scale.set(1 + br * 0.006 * brAmp, 1 + br * 0.010 * brAmp, 1 + br * 0.012 * brAmp);
    A.headG.position.y = 0.50 + br * 0.008 * brAmp;
    A.headG.rotation.x = -lean * 0.5 + ck * -0.18 - landK * 0.10 + reach * 0.08
      + Math.sin(t * 0.9) * 0.02;
    A.headG.rotation.y = Math.sin(t * 0.53) * 0.05 * (moving ? 0.3 : 1); // 待机微转头
    // 游泳划水（与步态按 sk 混合）
    if (sk > 0.001) {
      const bl = (cur, tgt) => cur * (1 - sk) + tgt * sk;
      const s4 = Math.sin(t * 4.2), s4b = Math.sin(t * 4.2 + Math.PI);
      const s3 = Math.sin(t * 3.1), s3b = Math.sin(t * 3.1 + Math.PI);
      A.shL.rotation.x = bl(A.shL.rotation.x, s4 * 0.95);
      A.shR.rotation.x = bl(A.shR.rotation.x, s4b * 0.95);
      A.shL.rotation.z = bl(A.shL.rotation.z, 0.45);
      A.shR.rotation.z = bl(A.shR.rotation.z, -0.45);
      A.elbL.rotation.x = bl(A.elbL.rotation.x, 0.5 + 0.3 * Math.max(0, s4));
      A.elbR.rotation.x = bl(A.elbR.rotation.x, 0.5 + 0.3 * Math.max(0, s4b));
      A.legL.rotation.x = bl(A.legL.rotation.x, s3 * 0.35);
      A.legR.rotation.x = bl(A.legR.rotation.x, s3b * 0.35);
      A.kneeL.rotation.x = bl(A.kneeL.rotation.x, -(0.3 + 0.4 * Math.max(0, -s3)));
      A.kneeR.rotation.x = bl(A.kneeR.rotation.x, -(0.3 + 0.4 * Math.max(0, -s3b)));
      A.spine.rotation.x = bl(A.spine.rotation.x, 0.15);
      A.headG.rotation.x = bl(A.headG.rotation.x, -0.35);
      A.hips.position.y = bl(A.hips.position.y, 0.96);
    }
  };

  // 第三人称肩视角相机：身后 3.2m、上方 1.9m、右偏 0.5m；撞墙拉近，绝不穿墙
  P._updateThirdCamera = function (dt, world, wantRun, moving) {
    const cfg = C();
    const cam = this.camera;
    const ck = this._crouchK || 0;
    const headY = this.pos.y + (1.62 - 0.30 * ck); // 头心 1.62；蹲伏髋降 0.30 同步
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

  /* ================= 第一人称手部（AAA_REF 6.2 蹲伏露手，低成本） =================
   * 相机子节点：两只简化手臂（袖管 box + 手 sphere）。平时不可见；
   * 蹲伏时右手前探淡入（Outlast 式"试探的手"），交互（开门/拾取）时双手前伸。
   * 只在第一人称渲染；第三人称/坐骑态隐藏。透明材质独立实例，不污染身体材质。
   */
  P.buildFpHands = function () {
    if (this._fpHands) return this._fpHands;
    const sleeveM = new THREE.MeshLambertMaterial({ color: 0x3b4550, transparent: true, opacity: 0 });
    const skinM = new THREE.MeshLambertMaterial({ color: 0xc99a72, transparent: true, opacity: 0 });
    this._fpMats = [sleeveM, skinM];
    const g = new THREE.Group();
    const mkArm = (sx) => {
      const a = new THREE.Group();
      // 相机空间落位：右下区域，保证 pitch -0.15~-0.4 时手部在画面内（经 harness 实测帧定位）
      a.position.set(sx * 0.26, -0.20, -0.30);
      a.rotation.set(-0.15, sx * 0.30, sx * -0.08); // 向画面中央微收
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.34), sleeveM);
      sl.position.set(0, 0, -0.15);
      sl.frustumCulled = false;
      const hd = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skinM);
      hd.scale.set(0.85, 0.7, 1.2);
      hd.position.set(0, 0, -0.36); // 嵌进袖口，露在外面够大才看得见
      hd.frustumCulled = false;
      a.add(sl); a.add(hd); g.add(a);
      return a;
    };
    this._fpArmL = mkArm(-1);
    this._fpArmR = mkArm(1);
    g.visible = false;
    this._fpHands = g;
    return g;
  };

  P._updateFpHands = function (dt, world) {
    const g = this.buildFpHands();
    const sc = (world && world.scene) || (BR.World && BR.World.scene) || null;
    if (sc) {
      if (g.parent !== this.camera) this.camera.add(g);
      if (this.camera.parent !== sc) sc.add(this.camera); // 相机进场景，子节点才渲染
    }
    const ck = this._crouchK || 0, reach = this._reachEnv();
    const target = Math.max(ck * 0.75, reach); // 蹲伏 0.75 / 交互全显
    this._fpOp = BR.damp(this._fpOp || 0, target, 8, dt);
    const op = this._fpOp;
    g.visible = op > 0.01;
    if (!g.visible) return;
    for (const m of this._fpMats) m.opacity = op;
    // 蹲伏：右手前探（试探的手）；交互：双手前伸（落位经 harness 实测，保证在视锥内）
    this._fpArmR.position.z = -0.30 - ck * 0.08 - reach * 0.14;
    this._fpArmR.position.y = -0.20 + ck * 0.02 + reach * 0.05;
    this._fpArmR.rotation.x = -0.15 - ck * 0.12 - reach * 0.20;
    this._fpArmL.position.z = -0.30 - reach * 0.12;
    this._fpArmL.position.y = -0.20 + reach * 0.04;
    this._fpArmL.rotation.x = -0.15 - reach * 0.18;
  };

  P.hurt = function (n, cause) {
    if (BR.Dev && BR.Dev.infHp) { this.hp = 999; return; } // 开发者模式：无限生命——锁血（不是无敌穿墙）
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
    if (BR.Dev && BR.Dev.infSanity) return; // 开发者模式：无限理智——冻结 999
    if (BR.Game.state !== 'playing') return;
    this.sanity = Math.max(0, this.sanity - n);
  };
  P.restoreSanity = function (n) {
    if (BR.Dev && BR.Dev.infSanity) return; // 开发者模式：无限理智——冻结 999，不恢复
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
  P.setOxygenGear = function (max, drainMul, refill) {
    this.oxygenMax = (max != null && max > 0) ? max : 100;
    this.oxygenDrainMul = (drainMul != null && drainMul > 0) ? drainMul : 1;
    if (BR.Swim) {
      if (BR.Swim.breath > this.oxygenMax) BR.Swim.breath = this.oxygenMax;
      // v2.0 P2：refill=true 时把 breath 充满到上限（深海潜水服：呼吸条显示为满/极长）
      if (refill && isFinite(BR.Swim.breath)) BR.Swim.breath = this.oxygenMax;
    }
  };
  P.clearOxygenGear = function () {
    this.oxygenMax = 100;
    this.oxygenDrainMul = 1;
    // v2.0 P2：上限回落时把 breath 钳回 100（防潜水服 10000 残留变相续航）
    if (BR.Swim && BR.Swim.breath > 100) BR.Swim.breath = 100;
  };
  // v2.0 P2：是否穿着深海潜水服（供氧气 HUD / 游泳逻辑查询；装备态真值在 BR.Items.equipped）
  P.hasDivingSuit = function () {
    const I = BR.Items;
    return !!(I && I.equipped && I.equipped.suit);
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

  // 三维自由游泳垂直分量（v2.0 P2，MC 海洋更新手感）：
  // - 显式垂直输入优先：C=下潜（救生衣按 DIVE_V/bm 抵抗）、Space=上浮（救生衣按 RISE_V*bm 增强），按住持续
  // - 俯仰斜游：无显式垂直输入 + 前进时，按 pitch 给垂直分量（抬头上游、俯视下游），PITCH_SWIM 开关
  // - 悬停：无输入时 vy→hoverT 中性浮力悬停（bm=1 时 hoverT=0）——不许深水僵硬上浮、不许无法悬停
  // - bm>1（救生衣）轻微上浮倾向；bm<1（潜水服）轻微下沉倾向 + 垂直阻尼 ×1.4（悬停更稳）
  // - 全程 BR.damp 平滑，不硬锁高度；池底/水面钳制保留（头肩可出水，身体不出水）
  // - 性能：只用局部数字与 Math.sin，不 new 对象
  P._swimVertical = function (dt, w, jumpHeld, diveHeld, groundY, world, mvZ) {
    const bm = (this.buoyancyModifier > 0) ? this.buoyancyModifier : 1;
    const fz = (typeof mvZ === 'number') ? mvZ : 0;
    let vyT;
    if (diveHeld && !jumpHeld) vyT = -this.DIVE_V / bm;        // 下潜（救生衣抵抗）
    else if (jumpHeld && !diveHeld) vyT = this.RISE_V * bm;    // 上浮（救生衣增强）
    else {
      // 中性浮力悬停偏置：bm=1 → 0（悬停）；bm>1 → 缓上浮；bm<1 → 微下沉
      const hoverT = (bm - 1) * this.HOVER_BIAS_V;
      let pitchVy = 0;
      if (this.PITCH_SWIM && fz > 0.1 && this.pitch !== 0) {
        pitchVy = Math.sin(this.pitch) * fz * this.PITCH_SWIM_V;
      }
      vyT = hoverT + pitchVy;
    }
    const vk = (bm < 1) ? this.SWIM_VDAMP * 1.4 : this.SWIM_VDAMP; // 潜水服悬停更稳
    this.vel.y = BR.damp(this.vel.y, vyT, vk, dt);
    this.pos.y += this.vel.y * dt;
    // 池底
    const floorY = Math.max(groundY, (w.floor != null ? w.floor : 0));
    if (this.pos.y < floorY) { this.pos.y = floorY; if (this.vel.y < 0) this.vel.y = 0; }
    // 顶棚 / 水面：不许飞出水面（头肩可出水，身体留在水里）
    const maxY = Math.min(this._ceilY(world) - this.BODY_H, w.surface - 0.9);
    if (this.pos.y > maxY) { this.pos.y = maxY; if (this.vel.y > 0) this.vel.y = 0; }
  };

  P._stepVertical = function (dt, input, world, mvZ) {
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
      this._swimVertical(dt, w, jumpHeld, diveHeld, groundY, world, mvZ);
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
        // 开发者模式：无限体力——冻结 999（本帧不扣不回；帧末 pin 到 999）
        this._staminaOut = false;
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

    // v2.0 P2：水中水平加速度更低（SWIM_ACCEL），游动更重、转向更平滑；
    // _mode 为上一帧 _stepVertical 推导，1 帧延迟可接受
    const hAcc = (this._mode === 'swim') ? this.SWIM_ACCEL : cfg.ACCEL;
    this.vel.x = BR.damp(this.vel.x, tx, hAcc, dt);
    this.vel.z = BR.damp(this.vel.z, tz, hAcc, dt);
    if (mv.x === 0 && mv.z === 0) {
      this.vel.x = BR.damp(this.vel.x, 0, cfg.FRICTION, dt);
      this.vel.z = BR.damp(this.vel.z, 0, cfg.FRICTION, dt);
    }
    if (this._collide) world.moveCircle(this.pos, this.vel.x * dt, this.vel.z * dt, cfg.RADIUS);
    else { this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; }

    // E 路（v1.4）：跳跃 / 游泳垂直物理（真实位移，非镜头晃动）
    // v2.0 P2：把前进输入传给 _stepVertical（俯仰斜游用）
    this._stepVertical(dt, input, world, mv.z);

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

    // v2.4 W-shadowlight：删除手电耗电逻辑——无电量玩法，手电只有开/关两种状态，
    // 不再因没电自动关闭（flashBat 字段保留，仅存档兼容）

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

    // —— 姿态系数（第一/第三人称共用）：蹲伏平滑 + 交互前伸计时 ——
    // W-playerbody：_crouchK/_reachT 供第三人称身体与第一人称手部共用；不碰移动数值
    this._crouchK = BR.damp(this._crouchK || 0, this.crouching ? 1 : 0, 10, dt);
    this._reachT = Math.max(0, (this._reachT || 0) - dt);
    // —— 第三人称：身体跟随与动画 ——
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
    // 低理智：视线轻微游移（v2.0 P1：纳入"低理智特效"开关，off 时关闭）
    const sanityFxOff = input.settings && input.settings.sanityfx === 'off';
    const sanSway = (!sanityFxOff && this.sanity < 28) ? (28 - this.sanity) / 28 : 0;
    const swayX = sanSway * 0.02 * Math.sin(performance.now() * 0.0011);
    const swayY = sanSway * 0.02 * Math.cos(performance.now() * 0.0009);
    // v1.5 W8：坐骑态相机由 handle 全权驱动（位/旋转都自己写），跳过玩家相机逻辑
    if (this.mountHandle) {
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      this.landDipT = Math.max(0, this.landDipT - dt * 3);
      if (this._fpHands) this._fpHands.visible = false; // 坐骑态相机由 handle 驱动，手部不渲染
    } else
    if (this.thirdPerson) {
      // 肩视角（走独立逻辑，第一人称逻辑不动）
      if (this._fpHands) this._fpHands.visible = false; // 第三人称只渲染身体，不渲染相机手
      this._updateThirdCamera(dt, world, wantRun, moving);
    } else {
      if (this.avatar) this.avatar.visible = false; // 第一人称隐藏身体，避免看到头内部
      this._updateFpHands(dt, world); // W-playerbody：蹲伏露手 / 交互前伸（其余时间不可见）
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
      this._reachT = 0.55; // W-playerbody：交互前伸示意（开门/拾取，第三人称身体 + 第一人称手部共用）
      this._curIt.use();
    }
    // —— 开发者模式：作弊冻结（v2.2）——
    // 每帧末尾 pin 住 999：任何绕开 drainSanity/hurt 的直接扣减（腰果水、L4 未封窗、饿死等）
    // 都在这里被纠正；跑步消耗/伤害逻辑本身也已被对应钩子短路。sanity=999 时低理智特效不触发。
    if (BR.Dev) {
      if (BR.Dev.infStamina) { this.stamina = 999; this._staminaOut = false; }
      if (BR.Dev.infSanity) this.sanity = 999;
      if (BR.Dev.infHp) this.hp = 999;
    }
  };
})();
