/* main.js —— 游戏主流程：初始化 / 关卡切换 / 主循环 / 存档调度 */
(function () {
  const BR = window.BR;

  const G = {
    state: 'title',   // title|loading|playing|paused|dying|dead|ending
    level: 'L0',
    seed: 0,
    inv: {},
    flags: { clues: 0, gens: 0 },
    renderer: null,
    fps: 0, _fpsN: 0, _fpsT: 0,
    // 性能优化：动态分辨率（仅 quality=auto 时启用，手动档不干预）
    _dynOn: false, _dynSteps: null, _dynIdx: 0, _dynPr: null, _dynShadow: null,
    _dynLowN: 0, _dynHighN: 0, _dynCool: 0, _dynWarm: 0,
    _saveT: 0,
    checkpoint: null,
    // P0-4：异步关卡加载保护
    _loading: false,      // loadLevel 互斥锁
    _loadPromise: null,   // 进行中的加载 promise（去重返回）
    _loadFailCtx: null,   // 失败重试上下文 {level, opts}
    _prevLevel: null,     // 回滚快照 {valid, level, map, ws, px, pz, yaw}
    _rollbackActive: false,
    _loadError: null,
    _gotoTimer: 0,
    // P0-2：按关世界持久化——内存关卡缓存 {关id: {ws, deployed}}（深拷贝存入）；
    // 与 P0-4 回滚快照 _prevLevel 无关（那是失败回滚用的上一关快照）。
    _levelCache: {}
  };
  BR.Game = G;

  G.init = function () {
    var mark = function (s) { window.__brStep = s; };
    mark('textures'); BR.Textures.init();
    mark('input'); BR.Input.init();
    mark('ui'); BR.UI.init();
    // 先把菜单亮出来：后面 WebGL 若在平板上失败，用户看到菜单+提示，而不是黑屏
    BR.UI.showTitle();
    BR.UI.setPrompt(null);
    // P0-4：加载失败界面三按钮（真实可用）
    BR.$('btn-load-retry').onclick = () => this.retryLoad();
    BR.$('btn-load-rollback').onclick = () => this.rollbackLevel();
    BR.$('btn-load-title').onclick = () => this.backToTitle();
    mark('camera'); BR.Player.initCamera();
    mark('quality'); this.applyQuality();

    mark('renderer');
    const cv = BR.$('game-canvas');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
    } catch (e) {
      showBrErr('WebGL 初始化失败: ' + (e && e.message || e) + ' —— 请关闭其他标签页后刷新重试');
      return; // 菜单已显示，直接返回，不启动主循环
    }
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this._pr || 1.5));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    // v1.2：ACES 色调映射压住过曝，保留荧光灯泛黄感
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    // v2.4 W-shadowlight：实时阴影总开关（PCFSoft）；各画质档开/关见 applyQuality
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.applyQuality(); // renderer 就绪后重跑一次：阴影开关/尺寸落到真实 renderer 上

    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      if (BR.Player.camera) {
        BR.Player.camera.aspect = innerWidth / innerHeight;
        BR.Player.camera.updateProjectionMatrix();
      }
    });
    // 屏幕旋转不重置进度：只重设尺寸
    addEventListener('orientationchange', () => {
      setTimeout(() => {
        this.renderer.setSize(innerWidth, innerHeight);
        if (BR.Player.camera) {
          BR.Player.camera.aspect = innerWidth / innerHeight;
          BR.Player.camera.updateProjectionMatrix();
        }
      }, 300);
    });

    // 死亡事件
    BR.bus.on('died', (d) => {
      if (this.state !== 'playing') return;
      this.state = 'dying';
      BR.Input.setLocked(true);
      BR.Trans.play('fail', { cause: d.cause, skippable: false });
    });
    // 自动存档事件
    ['picked', 'door:opened', 'crate:opened', 'event'].forEach(ev =>
      BR.bus.on(ev, () => this.autosave()));

    // 首次手势启动音频
    const boot = () => { BR.Audio.init(); BR.Audio.setVolume(BR.Input.settings.vol); };
    addEventListener('pointerdown', boot, { once: true });
    addEventListener('touchstart', boot, { once: true });
    addEventListener('keydown', boot, { once: true });

    // 菜单已在 init 前段显示过，这里刷新一次种子行即可
    BR.UI.showTitle();
    this._lastT = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    BR.log('game init ok');
  };

  G.applyQuality = function () {
    const s = BR.Input.settings.quality || 'auto';
    let q = s;
    if (q === 'auto') {
      const small = Math.min(innerWidth, innerHeight) < 700;
      q = (BR.Input.isTouch && small) ? 'medium' : 'high';
    }
    const cfgs = {
      // v2.4 W-shadowlight：画质档扩展——分辨率(pr)/雾(fogScale)/灯光数(maxLights)/灯距(lightDist)/
      // 粒子(particles)/胶片颗粒(grain)/接触阴影(blobShadow)/实时阴影(shadow)。
      // shadow：0=关；1=开（桌面 1024 / 移动 512）；2=开（桌面 2048 / 移动 512）。
      // 阴影灯 = 玩家手电 SpotLight（每关唯一阴影灯，见 world.js W.setShadowLevel）。
      high:   { fogScale: 1.15, maxLights: 7, pr: 2,   grain: 1, particles: 1.0, lightDist: 24, blobShadow: 1, shadow: 2 },
      medium: { fogScale: 1.0,  maxLights: 5, pr: 1.5, grain: 1, particles: 0.7, lightDist: 20, blobShadow: 1, shadow: 1 },
      low:    { fogScale: 0.8,  maxLights: 3, pr: 1,   grain: 0, particles: 0.4, lightDist: 16, blobShadow: 1, shadow: 0 }
    };
    BR.QUALITY = cfgs[q] || cfgs.medium;
    this._pr = BR.QUALITY.pr;
    // 低画质：关掉胶片颗粒 overlay
    document.body.classList.toggle('fx-low', !BR.QUALITY.grain);
    if (this.renderer) this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this._pr));
    // v2.4 W-shadowlight：阴影开关真实生效（运行时切换 shadowMap 需重编译材质）
    const wantShadow = (BR.QUALITY.shadow | 0) > 0;
    if (this.renderer && this.renderer.shadowMap.enabled !== wantShadow) {
      this.renderer.shadowMap.enabled = wantShadow;
      if (BR.World && BR.World.scene) {
        BR.World.scene.traverse((o) => {
          if (!o.material) return;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const mt of ms) mt.needsUpdate = true;
        });
      }
    }
    if (BR.World && BR.World.setShadowLevel) BR.World.setShadowLevel(BR.QUALITY.shadow | 0);
    // H 路：灯池已存在（换关/设置页切画质）则立即按档重调灯距与粒子
    if (BR.World && BR.World.scene && BR.World.applyLightTuning) BR.World.applyLightTuning();
    // 性能优化：auto 档启用动态分辨率——以当前档为上限（cap），阶梯在 cap..1.0 之间；
    // 起步取 ≤1.5 的第一档（桌面 high 不再一上来就 pr=2 全速渲染），阴影起步 1 档
    // （桌面 1024 / 移动 512），帧率持续富余时由 _dynEval 先升阴影、再升分辨率回上限，
    // 持续不足时先降分辨率、到底再降阴影（下限 1，不自动关阴影，保观感）。
    // 手动档（high/medium/low）：_dynOn=false，本函数其余行为与以往完全一致。
    if (s === 'auto') {
      const cap = this._pr;
      const steps = [2, 1.75, 1.5, 1.25, 1.1, 1.0].filter(x => x <= cap + 1e-6);
      if (!steps.length || steps[0] !== cap) steps.unshift(cap);
      this._dynSteps = steps;
      let idx = steps.findIndex(x => x <= 1.5 + 1e-6);
      this._dynIdx = idx >= 0 ? idx : 0;
      this._dynPr = steps[this._dynIdx];
      this._dynShadow = Math.min(BR.QUALITY.shadow | 0, 1);
      this._dynLowN = 0; this._dynHighN = 0; this._dynCool = 0; this._dynWarm = 6;
      this._dynOn = true;
      if (this.renderer) this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this._dynPr));
      if (BR.World && BR.World.setShadowLevel && this._dynShadow !== (BR.QUALITY.shadow | 0)) {
        BR.World.setShadowLevel(this._dynShadow);
      }
    } else {
      this._dynOn = false; this._dynSteps = null; this._dynPr = null; this._dynShadow = null;
    }
    BR.log('quality', q);
  };

  /* 性能优化：动态分辨率评估（每产生一个 FPS 样本调用一次，样本约 0.5s）。
   * 防抖：切关/切档后宽限 6 个样本；每次调整后冷却 5 个样本；
   * 降档需连续 2 个样本 <45fps，升档需连续 6 个样本 >57fps（迟滞防横跳）。
   * 注：G.fps 由钳制后的 dt 累计，真实帧率 <20 时读数饱和在 20——仍 <45，
   * 降档方向不受影响；>57 区间读数真实，升档判断可信。 */
  G._dynEval = function (f) {
    if (!this._dynOn || !this.renderer || !this._dynSteps) return;
    if (this._dynWarm > 0) { this._dynWarm--; return; }
    if (this._dynCool > 0) this._dynCool--;
    if (f < 45) { this._dynLowN++; this._dynHighN = 0; }
    else if (f > 57) { this._dynHighN++; this._dynLowN = 0; }
    else { this._dynLowN = 0; this._dynHighN = 0; }
    const maxIdx = this._dynSteps.length - 1;
    if (this._dynLowN >= 2 && this._dynCool === 0) {
      if (this._dynIdx < maxIdx) {
        this._dynIdx++;
        this._dynPr = this._dynSteps[this._dynIdx];
        this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this._dynPr));
        this._dynCool = 5; this._dynLowN = 0;
        BR.log('dyn pr ->', this._dynPr, 'fps', f.toFixed(1));
      } else if (this._dynShadow > 1) {
        this._dynShadow--;
        if (BR.World && BR.World.setShadowLevel) BR.World.setShadowLevel(this._dynShadow);
        this._dynCool = 5; this._dynLowN = 0;
        BR.log('dyn shadow ->', this._dynShadow, 'fps', f.toFixed(1));
      }
    } else if (this._dynHighN >= 6 && this._dynCool === 0) {
      if (this._dynShadow < (BR.QUALITY.shadow | 0)) {
        this._dynShadow++;
        if (BR.World && BR.World.setShadowLevel) BR.World.setShadowLevel(this._dynShadow);
        this._dynCool = 5; this._dynHighN = 0;
        BR.log('dyn shadow ->', this._dynShadow, 'fps', f.toFixed(1));
      } else if (this._dynIdx > 0) {
        this._dynIdx--;
        this._dynPr = this._dynSteps[this._dynIdx];
        this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this._dynPr));
        this._dynCool = 5; this._dynHighN = 0;
        BR.log('dyn pr ->', this._dynPr, 'fps', f.toFixed(1));
      }
    }
  };

  /* ---------- 开局 / 读档 ---------- */
  G.newGame = function (seed) {
    this.seed = seed;
    this.level = 'L0';
    this.inv = {};
    this.flags = { clues: 0, gens: 0, riftCount: 0, berryCount: 0 };
    this._levelCache = {}; // P0-2：新开局清空关卡缓存
    BR.Save.clearSave();
    if (BR.Items) BR.Items.resetState(); // W9：新开局清道具运行时态
    BR.Input.ensureImmersive(); // 触屏：尝试全屏 + 锁横屏
    this.loadLevel('L0', { intro: true, drop: true, fresh: true });
  };

  G.continueGame = function () {
    const d = BR.Save.loadGame();
    if (!d) { BR.UI.toast('没有存档'); return; }
    this.seed = d.seed;
    this.inv = d.inv || {};
    this.flags = d.flags || { clues: 0, gens: 0 };
    // 可选字段向后兼容：老存档没有 riftCount/berryCount 时 ?? 0
    this.flags.riftCount = d.riftCount != null ? d.riftCount : 0;
    this.flags.berryCount = d.berryCount != null ? d.berryCount : 0;
    BR.Input.ensureImmersive();
    this.loadLevel(d.level, { saved: d, drop: true });
  };

  /* ---------- 关卡加载（P0-4：异步加载保护） ----------
   * 返回 Promise：成功 resolve / 失败 reject。
   * 互斥：进行中再次调用 → BR.warn + 返回已有的 _loadPromise（去重，不许并发 build）。
   * 调用方（newGame/continueGame/retryAfterDeath）不 await：内部挂载空 catch，
   * 避免 unhandledrejection；gotoLevel 的 race 仍能收到 reject（分支独立）。 */
  G.loadLevel = function (level, opts) {
    opts = opts || {};
    if (this._loading) {
      BR.warn('loadLevel re-entered, dedup ->', level);
      return this._loadPromise;
    }
    // 回滚快照：失败前保存上一关（map 引用即可；ws 深拷贝防 build 覆盖）
    let prevWs = null;
    try { prevWs = (BR.World && BR.World.state) ? JSON.parse(JSON.stringify(BR.World.state)) : null; }
    catch (e) { prevWs = (BR.World && BR.World.state) || null; }
    this._prevLevel = {
      valid: !!(BR.World && BR.World.map), // 只有曾经成功建过世界，回滚按钮才有效
      level: this.level,
      map: (BR.World && BR.World.map) || null,
      ws: prevWs,
      px: (BR.Player && BR.Player.pos) ? BR.Player.pos.x : 0,
      pz: (BR.Player && BR.Player.pos) ? BR.Player.pos.z : 0,
      yaw: (BR.Player && BR.Player.yaw) || 0
    };
    this._loadFailCtx = { level: level, opts: opts };
    this._loading = true;
    this._loadError = null;
    let resolveFn, rejectFn;
    this._loadPromise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
    this._loadPromise.catch(() => {}); // 内部自行处理：调用方不 await 也不触发 unhandledrejection
    const done = (err) => {
      this._loading = false;
      if (err) { this._loadFailed(err); rejectFn(err); }
      else { this._rollbackActive = false; resolveFn(); }
    };

    this.state = 'loading';
    this.level = level;
    BR.Input.setLocked(true);
    // v1.5 W8：层级切换清理全部持续输入（按住 W/下潜切关不残留）+ 玩家进 transition 态
    if (BR.Input.clearAll) BR.Input.clearAll();
    if (BR.Player && BR.Player.setState) BR.Player.setState('transition');
    BR.UI.show('screen-loading');
    this._hideLoadError(); // 清掉可能残留的失败界面，恢复 spinner
    BR.$('loading-text').textContent = '正在生成 ' + (BR.Levels[level] ? BR.Levels[level].name : level) + '……';

    // 下一帧再做重活，让 loading 先画出来
    setTimeout(() => {
      let map;
      try {
        map = BR.Gen.generate(level, this.seed); // P0-4：同步抛错 → 失败界面
      } catch (e) { done(e); return; }
      const FRESH_WS = function () { return { openedDoors: [], picked: [], openedCrates: [], events: [] }; };
      // P0-2：ws 来源优先级——
      // ① saved 路径：opts.saved.levels[level].ws（无则回退 opts.saved.ws，
      //    兼容 P0-4 回滚拼出的 v1 形 synthetic saved；再无则 fresh 空对象）；
      // ② travel 路径：内存关卡缓存 _levelCache[level].ws（返回旧关不断档）；
      // ③ 都没有 → fresh 空对象。
      // 字段名是 world.js/save.js/levels.js 三方硬约定，不许改。
      let ws;
      if (opts.saved) {
        const lvB = (opts.saved.levels && opts.saved.levels[level]) || null;
        ws = (lvB && lvB.ws) || opts.saved.ws || FRESH_WS();
        // saved 路径预热缓存：把存档里其它关的桶深拷贝进 _levelCache——
        // 否则读档后第一次普通跨关（travel 路径无 saved）去"存档里有、session 里没去过"
        // 的关会拿到 fresh 而不是旧桶。
        if (opts.saved.levels) {
          for (const k in opts.saved.levels) {
            if (k === level) continue;
            const b = opts.saved.levels[k];
            if (!b) continue;
            try {
              this._levelCache[k] = {
                ws: JSON.parse(JSON.stringify(b.ws || {})),
                deployed: JSON.parse(JSON.stringify(b.deployed || { glows: [], chalks: [], drops: [] }))
              };
            } catch (e) {}
          }
        }
      } else {
        const cached = (this._levelCache && this._levelCache[level]) || null;
        ws = (cached && cached.ws) || FRESH_WS();
      }
      // P0-4：.catch 全覆盖——build 拒绝 / .then 回调内抛错 → 失败界面
      BR.World.build(map, ws).then(() => {
          // H 路：灯池刚重建，按当前画质档调灯距/粒子（applyQuality 在开局已跑过，
          // 但那时灯池还不存在；设置页切画质则走 applyQuality 里的即时重调）
          if (BR.World.applyLightTuning) BR.World.applyLightTuning();
          // 性能优化：World.build 会按 QUALITY.shadow 重置阴影档，auto 动态档需在建后恢复
          if (this._dynOn && this._dynShadow != null && BR.World.setShadowLevel) BR.World.setShadowLevel(this._dynShadow);
          this._dynWarm = 6; // 切关宽限：建图突发开销不触发降档（约 3 秒样本）
          // 从事件恢复计数器
          this.flags.gens = ws.events.filter(e => e.indexOf('gen_') === 0).length;
          this.flags.clues = ws.events.filter(e => e.indexOf('clue_') === 0).length;
          const sp = BR.World.spawnOf(map);
          let px = sp.x, pz = sp.z, yaw = sp.yaw;
          if (opts.saved) { px = opts.saved.px; pz = opts.saved.pz; yaw = opts.saved.yaw; }
          // P0-1：reset 按加载路径参数化——'saved' 读档/死亡重试/回滚，
          // 'full' 新游戏，'travel' 普通跨关（保留 hp/sanity/hunger/stamina/
          // flashBat/手电/diveLight/氧气派生值；跨关不再免费回满）。
          // P0-1：travel 模式的 reset 本来就不清 diveLight，keepDive hack 已删除。
          BR.Player.reset(px, pz, yaw, opts.saved ? 'saved' : (opts.fresh ? 'full' : 'travel'));
          // v2.4 W-shadowlight：玩家自带手电筒，新开局默认开启（F 键/触屏手电按钮可开关）
          if (opts.fresh && BR.Player) { BR.Player.hasFlashlight = true; BR.Player.flashlightOn = true; }
          // v1.5 W8：读档恢复坐骑（工厂未注册/存档无坐骑时静默跳过）
          // 世界实例（W5 鸭子）：buildContent 已按存档生成同 id 实例，直接骑它，不新建
          if (opts.saved && opts.saved.mount && opts.saved.mount.kind && BR.Mounts) {
            try {
              let mh = null;
              const md = opts.saved.mount.data;
              if (md && md.id != null && BR.Mounts._instances) {
                mh = BR.Mounts._instances.find(h => {
                  try { const s = (h.getSave) ? h.getSave() : null; return s && s.id === md.id; }
                  catch (e) { return false; }
                }) || null;
                if (mh && mh.applySave) { try { mh.applySave(md); } catch (e) {} }
              }
              if (!mh) {
                mh = BR.Mounts.create(opts.saved.mount.kind, opts.saved.mount);
                if (mh && md && mh.applySave) { try { mh.applySave(md); } catch (e) {} }
              }
              if (mh) BR.Player.mount(mh);
            } catch (e) { BR.warn('mount restore failed', e); }
          }
          // Systems C-A：清理上一关的幻觉事件 + 画布模糊
          if (BR.SanityEvents) BR.SanityEvents.reset();
          if (opts.saved) {
            BR.Player.hp = opts.saved.hp != null ? opts.saved.hp : 100;
            BR.Player.sanity = opts.saved.sanity != null ? opts.saved.sanity : 100; // 存档读档恢复理智
            BR.Player.hunger = opts.saved.hunger != null ? opts.saved.hunger : 100; // 老存档缺 hunger 字段时默认 100
            BR.Player.flashBat = opts.saved.flashBat != null ? opts.saved.flashBat : 100; // 老存档缺 flashBat 字段时默认 100
            BR.Player.hasFlashlight = !!opts.saved.hasFlashlight;
          } else {
            // 非 L0：给基础物资（跨关不保留手电之外的消耗品也合理，但保留更友好）
            if (level !== 'L0' && !BR.Player.hasFlashlight && (this.inv.flashlight || 0) > 0) {
              BR.Player.hasFlashlight = true;
            }
          }
          // P0-3 根因修复：两条路径各走各的顺序——
          // 读档先 loadState（填 _pendingDeployed）再 onLevelBuilt（消费恢复）；
          // 普通跨关先 onTravel（填 _pendingDeployed）再 onLevelBuilt（消费恢复）。
          // （旧代码把 onLevelBuilt 放在最前、loadState/onTravel 放在最后，
          //  恢复时 stash 还是空的 → 本关部署物本次不恢复。）
          // W9：道具运行时态——读档恢复电量/装备/耐力/照明灯/已部署物；
          // 跨关则保留当前运行时态（autosave 已把旧关部署物写入 _savedDeployed）
          if (BR.Items) {
            if (opts.saved) {
              // P0-2：loadState 只认顶层 d.deployed（按关分桶 map）；v2 下从
              // opts.saved.levels 组装全关桶 map，用浅拷贝对象喂给 loadState——
              // 不污染 opts.saved 本身（checkpoint/死亡重试复用同一对象）；
              // P0-3 语义不变：仍是先 loadState（填 _pendingDeployed）再 onLevelBuilt（消费恢复）。
              // v1 形 synthetic saved（P0-4 回滚）无 levels → 沿用其顶层 deployed
              // （无则 null → loadState 走 keepDep，不清空内存旧桶）。
              let depForItems = null;
              if (opts.saved.levels) {
                depForItems = {};
                for (const k in opts.saved.levels) {
                  const b = opts.saved.levels[k];
                  if (b && b.deployed) depForItems[k] = b.deployed;
                }
              } else if (opts.saved.deployed) {
                depForItems = opts.saved.deployed;
              }
              BR.Items.loadState(Object.assign({}, opts.saved, { deployed: depForItems }));
            }
            else BR.Items.onTravel();
            // W9：恢复本关已部署道具（荧光棒/粉笔/丢弃物），读档与跨关共用
            BR.Items.onLevelBuilt();
          }
          BR.Player.camera.aspect = innerWidth / innerHeight;
          BR.Player.camera.updateProjectionMatrix();
          BR.Levels[level].onEnter();
          // W10：室内外曝光分开（theme.exposure；无则默认 0.85；室外关卡可设 1.0 提亮）
          if (this.renderer) {
            const thx = BR.Levels[level] && BR.Levels[level].theme;
            this.renderer.toneMappingExposure = (thx && thx.exposure != null) ? thx.exposure : 0.85;
          }
          BR.UI.updateInv();
          BR.UI.setPrompt(null);
          this.state = 'playing';
          BR.Input.setLocked(false);
          BR.UI.show(null);
          BR.Input.setTouchVisible(true);
          // 检查点 + 存档
          this.checkpoint = this.snapshot();
          this.autosave();
          BR.Input.checkOrient();
          const afterEnter = () => {
            // P0-4：只有仍在正常游玩才播开场——跨关失败（state='loadfail'）时不再劫持屏幕播 intro，
            // 否则 intro 的 BR.UI.show(null) 会盖掉失败界面。
            if (opts.intro && level === 'L0' && this.state === 'playing') {
              BR.Trans.play('intro');
              // v1.5 W2：开场操作提示改由首次动作触发（input.js firstHint），此处不再定时弹
            }
          };
          // 入场掉落感：新游戏 / 读档 / 重生（已有转场进行中时不叠加）
          if (opts.drop && !BR.Trans.active) {
            BR.Trans.play('drop', { text: opts.dropText }).then(afterEnter);
          } else afterEnter();
          done(null); // P0-4：成功 resolve（gotoLevel 的 race 在此结束）
        }).catch((e) => done(e)); // P0-4：build 拒绝 / .then 回调内抛错 → 失败界面
      }, 60);
    return this._loadPromise;
  };

  // P0-4：加载失败统一处理——解锁输入、弹失败界面（三按钮真实可用）
  G._loadFailed = function (err) {
    this._loading = false;
    this._loadError = err || new Error('unknown load error');
    const msg = (err && err.message) || String(err);
    BR.warn('loadLevel failed:', msg);
    // 回滚本身失败 → 直接回到标题，不再弹失败界面
    if (this._rollbackActive) {
      this._rollbackActive = false;
      this.backToTitle();
      return;
    }
    BR.Input.setLocked(false); // 任何失败路径都必须执行
    this.state = 'loadfail';
    BR.UI.show('screen-loading');
    BR.$('loading-text').textContent = '加载失败';
    const sp = BR.$('loading-spinner');
    if (sp) sp.style.display = 'none';
    const box = BR.$('loadfail-box');
    if (box) {
      box.style.display = 'block';
      const m = BR.$('loadfail-msg');
      if (m) m.textContent = '原因：' + msg;
      // 没有有效上一关（首次加载即失败）时隐藏"返回上一关"
      const rb = BR.$('btn-load-rollback');
      if (rb) rb.style.display = (this._prevLevel && this._prevLevel.valid) ? '' : 'none';
    }
  };

  G._hideLoadError = function () {
    const box = BR.$('loadfail-box');
    if (box) box.style.display = 'none';
    const sp = BR.$('loading-spinner');
    if (sp) sp.style.display = '';
  };

  // P0-4：[重试本关]——用失败时的上下文重跑
  G.retryLoad = function () {
    const ctx = this._loadFailCtx;
    if (!ctx || this._loading) return;
    BR.log('retryLoad', ctx.level);
    this.loadLevel(ctx.level, ctx.opts);
  };

  // P0-4：[返回上一关]——用快照重建旧世界；回滚本身失败 → 回到标题
  G.rollbackLevel = function () {
    const prev = this._prevLevel;
    if (this._loading) return;
    if (!prev || !prev.valid || !BR.Levels[prev.level]) { this.backToTitle(); return; }
    let map = prev.map;
    if (!map) {
      try { map = BR.Gen.generate(prev.level, this.seed); } // 确定性重建
      catch (e) { BR.warn('rollback regen failed', e); this.backToTitle(); return; }
    }
    const ws = prev.ws || { openedDoors: [], picked: [], openedCrates: [], events: [] };
    BR.log('rollbackLevel ->', prev.level);
    this._rollbackActive = true; // 回滚失败 → _loadFailed 直接回标题
    // 走标准 loadLevel（带完整失败保护）；用快照恢复玩家位置与基础状态
    this.loadLevel(prev.level, {
      saved: {
        ws: ws, px: prev.px, pz: prev.pz, yaw: prev.yaw,
        hp: 100, sanity: 100, hunger: 100, flashBat: 100,
        hasFlashlight: !!(BR.Player && BR.Player.hasFlashlight)
      },
      drop: true
    });
  };

  // P0-4：[回到标题]
  G.backToTitle = function () {
    this._loading = false;
    this._rollbackActive = false;
    this._loadFailCtx = null;
    BR.Input.setLocked(false);
    this.state = 'title';
    this._hideLoadError();
    BR.$('loading-text').textContent = '正在生成……';
    BR.UI.showTitle();
  };

  // 转场调用的跨关（存档跟随）
  // P0-4：loadLevel 返回 Promise（成功 resolve / 失败 reject）；60s 超时则 reject。
  // 旧的无超时 setInterval 轮询已删除（永不 resolve/reject 是根因之一）。
  G.gotoLevel = function (level, opts) {
    opts = opts || {};
    this.autosave();
    // P0-2：跨关前把当前关世界存入内存缓存（深拷贝；与 P0-4 回滚快照 _prevLevel 无关）。
    // 只在非加载中缓存：重入时 loadLevel 会去重，World.state 已不是旧关。
    if (!this._loading && BR.World && BR.World.state && this.level) {
      try {
        const ist = (BR.Items && BR.Items.saveState) ? BR.Items.saveState() : null;
        const depMap = (ist && ist.deployed) || {};
        const wsCopy = JSON.parse(JSON.stringify(BR.World.state));
        // 坐骑实例位置与 snapshot 对齐（getLevelSave 收集实时位置）
        try { wsCopy.mounts = (BR.Mounts && BR.Mounts.getLevelSave) ? BR.Mounts.getLevelSave() : {}; }
        catch (e) { wsCopy.mounts = {}; }
        this._levelCache[this.level] = {
          ws: wsCopy,
          deployed: JSON.parse(JSON.stringify(depMap[this.level] || { glows: [], chalks: [], drops: [] }))
        };
      } catch (e) { BR.warn('levelCache write failed', e); }
    }
    const loadP = this.loadLevel(level, opts); // 修复吞 opts 的 bug：透传给 loadLevel（如 drop/dropText/saved）
    const timeoutP = new Promise((_, reject) => {
      this._gotoTimer = setTimeout(() => reject(new Error('跨关超时（60s）: ' + level)), 60000);
    });
    return Promise.race([loadP, timeoutP]).then(
      (v) => { clearTimeout(this._gotoTimer); return v; },
      (e) => { clearTimeout(this._gotoTimer); throw e; }
    );
  };

  // P0-2：存档 v2 序列化实现在 save.js（S.serializeV2），此处薄封装；
  // 顶层不再有 ws/deployed（见 tools/SAVE_V2.md）；checkpoint 即 v2 snapshot。
  G.snapshot = function () { return BR.Save.serializeV2(); };

  G.autosave = function () {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    BR.Save.writeV2(this.snapshot()); // P0-2：落盘 v2 key（writeV2 自带 try/catch）
  };

  /* ---------- 死亡 / 重试 / 结局 ---------- */
  G.showDeath = function (cause) {
    this.state = 'dead';
    BR.Input.setLocked(true);
    BR.UI.showDeath(cause || 'default');
  };

  G.retryAfterDeath = function () {
    const cp = this.checkpoint;
    if (!cp) { location.reload(); return; }
    // 回到检查点：同种子同关，恢复检查点时刻的全部状态
    this.seed = cp.seed;
    this.inv = Object.assign({}, cp.inv);
    this.flags = Object.assign({}, cp.flags);
    BR.Trans.play('fade').then(() => {
      this.loadLevel(cp.level, { saved: cp, drop: true });
    });
  };

  G.gotoEnding = function () {
    this.state = 'ending';
    BR.Save.clearSave();
    BR.Audio.setAmbient('END');
    return new Promise((res) => setTimeout(() => {
      BR.UI.showEnding(
        '你切出来了',
        '电梯门开了。\n\n外面是白光，和久违的新鲜空气的味道。\n\n你回头看了一眼，身后的门缓缓关上，荧光灯的嗡鸣声越来越远。\n\n你切出来了。这一次，是切回了现实。\n\n—— 通关 ——\n\n（电梯的下行按钮还亮着……但这一次，你选择不回头。）'
      );
      res();
    }, 800));
  };

  /* ---------- 主循环 ---------- */
  G.loop = function (t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = (t - this._lastT) / 1000;
    this._lastT = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    // FPS
    this._fpsN++; this._fpsT += dt;
    if (this._fpsT >= 0.5) {
      this.fps = this._fpsN / this._fpsT; this._fpsN = 0; this._fpsT = 0;
      // 性能优化：动态分辨率只在游玩中评估（暂停/标题帧率不作数）
      if (this.state === 'playing') this._dynEval(this.fps);
    }

    if (this.state === 'playing' || this.state === 'paused') {
      if (this.state === 'playing') {
        BR.Player.update(dt, BR.Input, BR.World);
        BR.World.update(dt, BR.Player.pos.x, BR.Player.pos.z);
        const L = BR.Levels[this.level];
        if (L && L.tick) L.tick(dt);
        // Systems A：随机裂隙（关卡 tick 里不要再调，主循环统一调用，内部按帧去重）
        if (BR.Rifts) BR.Rifts.tick(dt);
        // Systems C-A：低理智特殊事件（运行时态，不进存档）
        if (BR.SanityEvents) BR.SanityEvents.tick(dt);
        // W9：新道具运行时 tick（急救包读条/荧光棒过期/照明灯耗电/浸水损坏/氧气瓶消耗）
        if (BR.Items) BR.Items.tick(dt);
        BR.Audio.updateListener(BR.Player.pos.x, BR.Player.pos.z, BR.Player.yaw);
        // 血条/理智条节流刷新
        this._barT = (this._barT || 0) + dt;
        if (this._barT > 0.25) { this._barT = 0; BR.UI.updateBars(); }
        // 周期存档
        this._saveT += dt;
        if (this._saveT > 25) { this._saveT = 0; this.autosave(); }
        // 每 60 秒更新一次检查点（死亡重试回到近期状态）
        this._cpT = (this._cpT || 0) + dt;
        if (this._cpT > 60) { this._cpT = 0; this.checkpoint = this.snapshot(); }
      }
      BR.UI.updateDebug();
      if (BR.World.scene) this.renderer.render(BR.World.scene, BR.Player.camera);
    }
  };

  // 启动（含诊断：init 抛错时把原因显示在屏幕上，而不是黑屏）
  var boot = function () {
    try { G.init(); window.__brStep = 'ok'; }
    catch (e) { showBrErr('INIT FAIL: ' + (e && e.message || e)); }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})();
